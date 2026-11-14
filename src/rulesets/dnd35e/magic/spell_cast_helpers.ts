/**
 * @file Pre-cast preparation helpers for D&D 3.5e spell resolution:
 * metamagic summarization, range calculation, action budget consumption, slot expenditure,
 * equipped Arcane Spell Failure lookup, and target/AoE enumeration.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type ItemComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { isHostile } from '../../../utils/faction.ts';
import { computeAoEAffectedSquares, type AoETemplateShape } from './aoe_rest.ts';
import { getSpontaneousMetamagicActionType, type MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { computeClassLevelSlotSummaries, reconcilePreparedSlots } from './spellbook_slots.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ActionBudget, DnD35ClassSpellbookState } from '../types/dnd35e.types.ts';
import type { DnD35ItemDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';

/** Context payload describing a player or AI spell cast request. */
export interface DnD35SpellCastContext {
  readonly classId: string;
  readonly spellId: string;
  readonly slotId?: string | undefined;
  readonly spellLevel?: number | undefined;
  readonly convertedSpellId?: string | undefined;
  readonly metamagicFeatIds?: ReadonlyArray<string> | undefined;
}

/** Aggregated metamagic state computed from active feat IDs. */
export interface MetamagicSummary {
  readonly flags: MetamagicSpellModifiers;
  readonly slotBump: number;
  readonly isQuickened: boolean;
  readonly hasNonQuickenMetamagic: boolean;
  readonly rangeMultiplier: number;
  readonly areaMultiplier: number;
}

/** Computes spell range in 5-ft grid squares for UI targeting and runtime validation. */
export function computeSpellRangeTiles(
  range: DnD35SpellDefinition['range'],
  casterLevel: number,
  rangeMultiplier = 1
): number {
  if (range === 'personal') return 0;
  if (range === 'touch') return 1;
  if (range === 'unlimited') return 999;
  const rangeFt =
    range === 'close'
      ? 25 + Math.floor(casterLevel / 2) * 5
      : range === 'medium'
        ? 100 + casterLevel * 10
        : range === 'long'
          ? 400 + casterLevel * 40
          : 25;
  return Math.max(1, Math.floor((rangeFt * rangeMultiplier) / FEET_PER_GRID_SQUARE));
}

/** Summarizes metamagic flags and slot/range/area adjustments from active feat and rod IDs. */
export function summarizeMetamagic(
  featIds: ReadonlyArray<string> | undefined,
  sysContent: DnD35SystemContent | undefined
): MetamagicSummary {
  const flags = { empower: false, maximize: false, extend: false, widen: false, silent: false, still: false };
  let isQuickened = false;
  let hasNonQuicken = false;
  let slotBump = 0;
  let rangeMultiplier = 1;
  let areaMultiplier = 1;

  for (const fid of featIds ?? []) {
    const isRod = fid.startsWith('rod:');
    const desc = sysContent?.feats?.[isRod ? `${fid.slice(4)}_spell` : fid]?.metamagicDescriptor;
    if (!desc) continue;
    if (!isRod) slotBump += desc.slotLevelAdjustment;
    if ((desc.empowerDamageMultiplier ?? 0) > 1) {
      flags.empower = true;
      hasNonQuicken = true;
    }
    if (desc.maximizeVariableDice) {
      flags.maximize = true;
      hasNonQuicken = true;
    }
    if ((desc.durationMultiplier ?? 0) > 1) {
      flags.extend = true;
      hasNonQuicken = true;
    }
    if ((desc.areaMultiplier ?? 0) > 1) {
      flags.widen = true;
      areaMultiplier = Math.max(areaMultiplier, desc.areaMultiplier ?? 1);
      hasNonQuicken = true;
    }
    if ((desc.rangeMultiplier ?? 0) > 1) {
      rangeMultiplier = Math.max(rangeMultiplier, desc.rangeMultiplier ?? 1);
      hasNonQuicken = true;
    }
    if (desc.suppressVerbalComponent) {
      flags.silent = true;
      hasNonQuicken = true;
    }
    if (desc.suppressSomaticComponent) {
      flags.still = true;
      hasNonQuicken = true;
    }
    if (desc.actionTimeOverride === 'swift') isQuickened = true;
    else if (desc.actionTimeOverride === 'full_round') hasNonQuicken = true;
  }

  return { flags, slotBump, isQuickened, hasNonQuickenMetamagic: hasNonQuicken, rangeMultiplier, areaMultiplier };
}

/** Validates and consumes the appropriate 5-tier action economy pip for a cast spell. */
export function consumeSpellActionBudget(
  budget: DnD35ActionBudget | undefined,
  castingTime: DnD35SpellDefinition['castingTime'],
  isSpontaneous: boolean,
  meta: MetamagicSummary
): { readonly allowed: boolean; readonly budget?: DnD35ActionBudget | undefined; readonly reason?: string } {
  if (!budget) return { allowed: true };

  if (meta.isQuickened || castingTime === 'swift' || castingTime === 'immediate') {
    if (budget.swiftRemaining < 1) return { allowed: false, reason: 'No Swift action remaining this round.' };
    return { allowed: true, budget: { ...budget, swiftRemaining: budget.swiftRemaining - 1 } };
  }

  const spMetaAction = getSpontaneousMetamagicActionType(isSpontaneous, meta.hasNonQuickenMetamagic);
  if (castingTime === 'full_round' || castingTime === '1_round' || spMetaAction === 'full_round') {
    if (budget.standardRemaining < 1 || budget.moveRemaining < 1) {
      return { allowed: false, reason: 'Requires a Full-Round Action (Standard + Move).' };
    }
    return {
      allowed: true,
      budget: {
        ...budget,
        standardRemaining: 0,
        moveRemaining: 0,
        movementRemainingFt: 0,
        canMoveFurtherThisRound: false
      }
    };
  }

  if (budget.standardRemaining < 1) return { allowed: false, reason: 'No Standard action remaining this round.' };
  return { allowed: true, budget: { ...budget, standardRemaining: budget.standardRemaining - 1 } };
}

/** Expends the appropriate prepared or spontaneous daily spell slot on the caster's class spellbook. */
export function expendCasterSpellSlot(
  book: DnD35ClassSpellbookState,
  spell: DnD35SpellDefinition,
  castContext: DnD35SpellCastContext,
  slotBump: number,
  state: GameState,
  casterId: EntityId,
  sysContent: DnD35SystemContent | undefined
): { readonly ok: boolean; readonly updatedBook: DnD35ClassSpellbookState; readonly reason?: string } {
  if (book.castingMode === 'prepared') {
    const dndData = getDnD35EntityData(state, casterId);
    const hydratedSlots =
      book.preparedSlots && book.preparedSlots.length > 0
        ? [...book.preparedSlots]
        : [
            ...reconcilePreparedSlots(
              book,
              computeClassLevelSlotSummaries(book, dndData, dndData.abilityScores, sysContent),
              sysContent?.spells
            )
          ];

    const targetIdx =
      castContext.slotId !== undefined
        ? hydratedSlots.findIndex(
            (s) => s.slotId === castContext.slotId && !s.expended && s.preparedSpellId !== undefined
          )
        : hydratedSlots.findIndex((s) => s.preparedSpellId === castContext.spellId && !s.expended);

    if (targetIdx === -1) {
      return { ok: false, updatedBook: book, reason: `No unexpended prepared slot available for ${spell.name}.` };
    }
    hydratedSlots[targetIdx] = { ...hydratedSlots[targetIdx]!, expended: true };
    const preparedSpellIds = hydratedSlots
      .filter((s) => s.preparedSpellId !== undefined && !s.expended)
      .map((s) => s.preparedSpellId!);
    return { ok: true, updatedBook: { ...book, preparedSlots: hydratedSlots, preparedSpellIds } };
  }

  const baseLevel = castContext.spellLevel ?? spell.levelByClass[book.classId] ?? spell.level;
  const effectiveLevel = baseLevel + slotBump;
  if (effectiveLevel > 9 || effectiveLevel > book.maxCastableSpellLevel) {
    return {
      ok: false,
      updatedBook: book,
      reason: `Adjusted spell level ${effectiveLevel} exceeds max castable level.`
    };
  }

  const lvlKey = String(effectiveLevel);
  const used = book.spontaneousSlotsUsedByLevel?.[lvlKey] ?? 0;
  const maxDaily = book.spellsPerDay[lvlKey] ?? 0;
  if (maxDaily > 0 && used >= maxDaily) {
    return { ok: false, updatedBook: book, reason: `No Level ${effectiveLevel} spell slots remaining.` };
  }
  return {
    ok: true,
    updatedBook: {
      ...book,
      spontaneousSlotsUsedByLevel: { ...(book.spontaneousSlotsUsedByLevel ?? {}), [lvlKey]: used + 1 }
    }
  };
}

/** Sums equipped armor + shield Arcane Spell Failure % (capped at 100%). */
export function collectEquippedArcaneSpellFailure(state: GameState, casterId: EntityId): number {
  const equip = getComponent(state, casterId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equip) return 0;
  let totalAsf = 0;
  for (const slot of equip.slots) {
    if (slot.equippedItem === null || slot.suppressed === true) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const def = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    totalAsf += def?.armorStats?.arcaneSpellFailure ?? 0;
  }
  return Math.min(100, totalAsf);
}

/** Enumerates all living actor EntityIds affected at `targetPos` or across an AoE template. */
export function enumerateSpellTargets(
  state: GameState,
  casterId: EntityId,
  casterPos: PositionComponent,
  targetPos: { readonly x: number; readonly y: number },
  spell: DnD35SpellDefinition,
  areaMultiplier: number
): ReadonlyArray<EntityId> {
  const isSelfAnchoredField = spell.effectUnits.some((u) => u.type === 'spatial_field' && u.anchorToCaster);
  if (spell.range === 'personal' || spell.targeting?.mode === 'personal' || isSelfAnchoredField) {
    return [casterId];
  }

  const isArea =
    spell.targeting?.mode === 'area' ||
    spell.aoeShape === 'burst' ||
    spell.aoeShape === 'spread' ||
    spell.aoeShape === 'cone' ||
    spell.aoeShape === 'line' ||
    spell.aoeShape === 'emanation';

  if (isArea && spell.aoeRadiusFt > 0) {
    const shape: AoETemplateShape =
      spell.aoeShape === 'cone' || spell.aoeShape === 'line' || spell.aoeShape === 'burst' ? spell.aoeShape : 'spread';
    const origin = shape === 'cone' || shape === 'line' ? { x: casterPos.x, y: casterPos.y } : targetPos;
    const isWallAt = (x: number, y: number): boolean => {
      if (x < 0 || x >= state.map.width || y < 0 || y >= state.map.height) return true;
      const tile = state.map.tiles[y * state.map.width + x];
      return !tile || !(state.campaign.tiles[tile.tileId]?.walkable ?? false);
    };
    const affectedSquares = computeAoEAffectedSquares(
      shape,
      origin,
      targetPos,
      spell.aoeRadiusFt * areaMultiplier,
      isWallAt
    );
    const squareKeys = new Set(affectedSquares.map((p) => `${p.x},${p.y}`));
    return state.entities.filter((id) => {
      const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
      const p = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
      return f !== undefined && f.hp > 0 && p !== undefined && squareKeys.has(`${p.x},${p.y}`);
    });
  }

  const entitiesHere = state.spatialIndex.get(`${targetPos.x},${targetPos.y}`) ?? [];
  const targetActor = entitiesHere.find((id) => {
    const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    return f !== undefined && f.hp > 0;
  });
  return targetActor !== undefined ? [targetActor] : [];
}

/** Returns true if any living hostile creature threatens the caster within adjacent 5-ft melee reach. */
export function isCasterThreatenedInMelee(state: GameState, casterId: EntityId, casterPos: PositionComponent): boolean {
  for (const id of state.entities) {
    if (id === casterId || !isHostile(state, casterId, id)) continue;
    const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    const p = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
    if (f && f.hp > 0 && p && Math.max(Math.abs(p.x - casterPos.x), Math.abs(p.y - casterPos.y)) <= 1) return true;
  }
  return false;
}
