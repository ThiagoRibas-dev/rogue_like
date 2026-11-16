/**
 * @file Reactive off-turn Counterspell interrupt resolution (`on_enemy_spell_cast`).
 * Evaluates hostile spellcasters with an active `'counterspell'` reaction policy,
 * validates Line of Effect & Immediate Action economy, rolls `Spellcraft` (`DC 15 + spell.level`),
 * and expends a counterable spell slot (`resolveCounterspellAttempt`) to fizzle the enemy spell.
 */

import { getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type IdentityComponent,
  type PositionComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { isHostile } from '../../../utils/faction.ts';
import { coordToIndex, isInBounds } from '../../../utils/grid.ts';
import { useImmediateAction } from '../action_economy_reactions.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { resolveSkillCheck } from '../skills.ts';
import { evaluateCover } from '../spatial/cover_senses.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ClassSpellbookState } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';
import { resolveCounterspellAttempt } from './metamagic_dispel.ts';
import { computeClassLevelSlotSummaries, reconcilePreparedSlots } from './spellbook_slots.ts';

/** Base Spellcraft DC required to identify an incoming enemy spell for counterspelling (PHB p. 82 & 170). */
export const SPELLCRAFT_COUNTERSPELL_BASE_DC = 15;

interface SelectedCounterSlot {
  readonly classId: string;
  readonly counterSpellId: string;
  readonly updatedBook: DnD35ClassSpellbookState;
}

function findBestCounterspellSlot(
  state: GameState,
  reactorId: EntityId,
  targetSpell: DnD35SpellDefinition,
  hasImprovedCounterspell: boolean,
  sysContent: DnD35SystemContent | undefined
): SelectedCounterSlot | undefined {
  const reactorDnd = getDnD35EntityData(state, reactorId);
  const spellbooks = reactorDnd.spellbooksByClass ?? {};
  const candidates: Array<SelectedCounterSlot & { readonly priority: number }> = [];

  for (const [classId, rawBook] of Object.entries(spellbooks)) {
    if (rawBook.castingMode === 'prepared') {
      const slots =
        rawBook.preparedSlots && rawBook.preparedSlots.length > 0
          ? [...rawBook.preparedSlots]
          : [
              ...reconcilePreparedSlots(
                rawBook,
                computeClassLevelSlotSummaries(rawBook, reactorDnd, reactorDnd.abilityScores, sysContent),
                sysContent?.spells
              )
            ];

      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        if (slot.expended || !slot.preparedSpellId) continue;
        const candSpell = sysContent?.spells?.[slot.preparedSpellId];
        const isDispel = candSpell?.effectUnits.some((u) => u.type === 'dispel') === true;
        const ok = resolveCounterspellAttempt(slot.preparedSpellId, targetSpell.id, {
          isUniversalCounterspell: isDispel,
          hasImprovedCounterspell,
          reactorSchool: candSpell?.school,
          targetSchool: targetSpell.school,
          reactorLevel: candSpell?.level ?? slot.spellLevel,
          targetLevel: targetSpell.level
        });
        if (!ok) continue;

        const nextSlots = [...slots];
        nextSlots[i] = { ...slot, expended: true };
        const preparedSpellIds = nextSlots
          .filter((s) => s.preparedSpellId !== undefined && !s.expended)
          .map((s) => s.preparedSpellId!);
        const priority = slot.preparedSpellId === targetSpell.id ? 0 : isDispel ? 1 : 2;
        candidates.push({
          classId,
          counterSpellId: slot.preparedSpellId,
          updatedBook: { ...rawBook, preparedSlots: nextSlots, preparedSpellIds },
          priority
        });
      }
      continue;
    }

    for (const knownId of rawBook.knownSpellIds) {
      const candSpell = sysContent?.spells?.[knownId];
      const spellLvl = candSpell?.levelByClass[classId] ?? candSpell?.level;
      if (spellLvl === undefined || spellLvl > rawBook.maxCastableSpellLevel) continue;
      const lvlKey = String(spellLvl);
      const used = rawBook.spontaneousSlotsUsedByLevel?.[lvlKey] ?? 0;
      const maxDaily = rawBook.spellsPerDay[lvlKey] ?? 0;
      if (maxDaily <= 0 || used >= maxDaily) continue;

      const isDispel = candSpell?.effectUnits.some((u) => u.type === 'dispel') === true;
      const ok = resolveCounterspellAttempt(knownId, targetSpell.id, {
        isUniversalCounterspell: isDispel,
        hasImprovedCounterspell,
        reactorSchool: candSpell?.school,
        targetSchool: targetSpell.school,
        reactorLevel: spellLvl,
        targetLevel: targetSpell.level
      });
      if (!ok) continue;

      const priority = knownId === targetSpell.id ? 0 : isDispel ? 1 : 2;
      candidates.push({
        classId,
        counterSpellId: knownId,
        updatedBook: {
          ...rawBook,
          spontaneousSlotsUsedByLevel: { ...(rawBook.spontaneousSlotsUsedByLevel ?? {}), [lvlKey]: used + 1 }
        },
        priority
      });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0];
}

/**
 * Scans hostile actors with an armed `'on_enemy_spell_cast'` counterspell reaction policy
 * and attempts a reactive Immediate Action counterspell against `casterId`'s spell.
 */
export function evaluateReactiveCounterspellInterrupt(
  state: GameState,
  casterId: EntityId,
  casterPos: PositionComponent,
  spell: DnD35SpellDefinition,
  sysContent: DnD35SystemContent | undefined,
  forcedSpellcraftRoll?: number
): { readonly state: GameState; readonly countered: boolean; readonly reactorId?: EntityId | undefined } {
  const isWallAt = (x: number, y: number): boolean => {
    if (!isInBounds(x, y, state.map.width, state.map.height)) return true;
    const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
    return !tile || !(state.campaign.tiles[tile.tileId]?.transparent ?? false);
  };

  for (const candId of state.entities) {
    if (candId === casterId) continue;
    const fighter = getComponent(state, candId, ComponentType.Fighter) as FighterComponent | undefined;
    const candPos = getComponent(state, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !candPos || !isHostile(state, casterId, candId)) continue;

    const doctrine = getComponent(state, candId, ComponentType.TacticalDoctrine) as
      TacticalDoctrineComponent | undefined;
    const policy = doctrine?.reactionPolicies?.['counterspell'];
    if (!policy?.enabled || policy.trigger !== 'on_enemy_spell_cast') continue;

    if (evaluateCover(candPos, casterPos, isWallAt).blocksLineOfEffect) continue;

    const candDag = evaluateDnD35eEntityDAG(state, candId);
    if (!candDag) continue;
    const activeBudget = candDag.dndData.actionBudget ?? hydrateEntityRoundActionBudget(state, candId);
    const immRes = useImmediateAction(activeBudget, false);
    if (!immRes.allowed && state.engineMode === EngineMode.TurnBased) continue;

    const hasImproved =
      candDag.selfTags.includes('trait:improved_counterspell') ||
      (candDag.dndData.feats ?? []).includes('improved_counterspell');
    const selectedSlot = findBestCounterspellSlot(state, candId, spell, hasImproved, sysContent);
    if (!selectedSlot) continue;

    const spellcraftDc = SPELLCRAFT_COUNTERSPELL_BASE_DC + spell.level;
    const spellcraftDef = sysContent?.skills?.['spellcraft'];
    const resolvedSpellcraft = candDag.resolvedSkills['spellcraft'];
    const rawRanks = resolvedSpellcraft?.rawRanks ?? candDag.dndData.skillRanks['spellcraft'] ?? 0;
    const intMod = resolvedSpellcraft?.keyAbilityModifier ?? candDag.dagResult.effectiveAbilityModifiers.int;

    const checkSucceeded = spellcraftDef
      ? resolveSkillCheck({
          definition: {
            skillId: spellcraftDef.id,
            keyAbility: resolvedSpellcraft?.keyAbility ?? spellcraftDef.keyAbility,
            trainedOnly: spellcraftDef.trainedOnly,
            acpMultiplier: spellcraftDef.acpMultiplier,
            synergyFromSkills: spellcraftDef.synergyFromSkills,
            take10Allowed: spellcraftDef.take10Allowed,
            take20Allowed: spellcraftDef.take20Allowed
          },
          rawRanks: resolvedSpellcraft?.effectiveRanks ?? rawRanks,
          allSkillRanks: candDag.dndData.skillRanks,
          keyAbilityModifier: intMod,
          armorCheckPenalty: candDag.armorCheckPenalty,
          modifiers: resolvedSpellcraft?.modifierBreakdown.activeModifiers ?? [],
          dc: spellcraftDc,
          ...(forcedSpellcraftRoll !== undefined ? { forcedNaturalRoll: forcedSpellcraftRoll } : {})
        }).success
      : (resolvedSpellcraft?.trained ?? rawRanks >= 1) &&
        (forcedSpellcraftRoll ?? 10) + (resolvedSpellcraft?.totalModifier ?? rawRanks + intMod) >= spellcraftDc;

    if (!checkSucceeded) continue;

    const rawCandDnd = getDnD35EntityData(state, candId);
    let nextState = setDnD35EntityData(state, candId, {
      ...rawCandDnd,
      spellbooksByClass: {
        ...(rawCandDnd.spellbooksByClass ?? {}),
        [selectedSlot.classId]: selectedSlot.updatedBook
      },
      actionBudget: immRes.allowed ? immRes.budget : activeBudget
    });

    const reactorName =
      (getComponent(nextState, candId, ComponentType.Identity) as IdentityComponent | undefined)?.name ?? 'Spellcaster';
    const counterSpellName = sysContent?.spells?.[selectedSlot.counterSpellId]?.name ?? selectedSlot.counterSpellId;
    nextState = addMessage(
      nextState,
      `${reactorName} counterspells ${spell.name} with ${counterSpellName}!`,
      MessageLogCategory.CombatMiss
    );
    return { state: nextState, countered: true, reactorId: candId };
  }

  return { state, countered: false };
}
