/**
 * @file Declarative target category filtering for D&D 3.5e spells, effect units, and activated abilities.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type TagsComponent,
  type TrapComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getFactionRelation, isHostile } from '../../../utils/faction.ts';
import type { DnD35TargetCategory } from '../types/system/effect_system.types.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';
import { computeAoEAffectedSquares, type AoETemplateShape } from './aoe_rest.ts';

const ALLEGIANCE_CATEGORIES: ReadonlySet<DnD35TargetCategory> = new Set(['self', 'ally', 'enemy', 'neutral']);

/** Returns true if a spell or its effect units contain harmful offensive effects. */
export function isOffensiveDnD35Spell(spell: DnD35SpellDefinition): boolean {
  if (spell.damageDice) return true;
  return spell.effectUnits.some(
    (u) => u.type === 'damage' || u.type === 'save_or_die' || u.type === 'energy_drain' || u.type === 'ability_harm'
  );
}

/**
 * Evaluates whether `candidateId` matches a composable `validTargetCategories` list relative to `sourceId`.
 * Supports combining allegiance filters (`self`, `ally`, `enemy`, `neutral`) with structural entity kinds
 * (`creature`, `object`, `door`, `wall`, `trap`, `corpse`).
 */
export function matchesTargetCategoryFilter(
  state: GameState,
  sourceId: EntityId,
  candidateId: EntityId,
  validCategories: ReadonlyArray<DnD35TargetCategory>
): boolean {
  if (validCategories.length === 0) return true;

  const fighter = getComponent(state, candidateId, ComponentType.Fighter) as FighterComponent | undefined;
  const death = getComponent(state, candidateId, ComponentType.Death);
  const trap = getComponent(state, candidateId, ComponentType.Trap) as TrapComponent | undefined;
  const lock = getComponent(state, candidateId, ComponentType.Lock);
  const item = getComponent(state, candidateId, ComponentType.Item);
  const tags = (getComponent(state, candidateId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];

  const isLivingCreature = fighter !== undefined && fighter.hp > 0 && death === undefined;
  const isCorpse = death !== undefined || (fighter !== undefined && fighter.hp <= 0) || tags.includes('corpse');
  const isDoor = lock !== undefined || tags.includes('door');
  const isWall = tags.includes('wall');
  const isTrap = trap !== undefined && !trap.triggered;
  const isObject =
    item !== undefined || tags.includes('object') || tags.includes('container') || tags.includes('chest');

  const categorySet = new Set(validCategories);
  const hasAllegianceFilter = validCategories.some((c) => ALLEGIANCE_CATEGORIES.has(c));

  if (isLivingCreature) {
    if (hasAllegianceFilter) {
      if (candidateId === sourceId) return categorySet.has('self');
      const relation = getFactionRelation(state, sourceId, candidateId);
      if (relation === 'friendly') return categorySet.has('ally');
      if (relation === 'hostile') return categorySet.has('enemy');
      return categorySet.has('neutral');
    }
    return categorySet.has('creature');
  }

  if (isCorpse && categorySet.has('corpse')) return true;
  if (isDoor && categorySet.has('door')) return true;
  if (isWall && categorySet.has('wall')) return true;
  if (isTrap && categorySet.has('trap')) return true;
  if (isObject && categorySet.has('object')) return true;

  return false;
}

/** Enumerates all eligible target EntityIds affected at `targetPos` or across an AoE template. */
export function enumerateSpellTargets(
  state: GameState,
  casterId: EntityId,
  casterPos: PositionComponent,
  targetPos: { readonly x: number; readonly y: number },
  spell: DnD35SpellDefinition,
  areaMultiplier: number,
  skipAllies = false
): ReadonlyArray<EntityId> {
  const isSelfAnchoredField = spell.effectUnits.some((u) => u.type === 'spatial_field' && u.anchorToCaster);
  if (spell.range === 'personal' || spell.targeting?.mode === 'personal' || isSelfAnchoredField) {
    return [casterId];
  }

  const validCategories = spell.targeting?.validTargetCategories;
  const shouldSkipAllies = skipAllies && isOffensiveDnD35Spell(spell);
  const isEligible = (id: EntityId): boolean => {
    if (validCategories !== undefined && validCategories.length > 0) {
      if (!matchesTargetCategoryFilter(state, casterId, id, validCategories)) return false;
    } else {
      const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
      if (f === undefined || f.hp <= 0) return false;
    }
    if (shouldSkipAllies && (id === casterId || !isHostile(state, casterId, id))) {
      return false;
    }
    return true;
  };

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
      const p = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
      return p !== undefined && squareKeys.has(`${p.x},${p.y}`) && isEligible(id);
    });
  }

  const entitiesHere = state.spatialIndex.get(`${targetPos.x},${targetPos.y}`) ?? [];
  const targetEntity = entitiesHere.find((id) => isEligible(id));
  return targetEntity !== undefined ? [targetEntity] : [];
}

/** Predicts hostile, allied, and self victims caught within a candidate spell cast footprint. */
export function predictSpellAoEVictims(
  state: GameState,
  casterId: EntityId,
  casterPos: PositionComponent,
  targetPos: { readonly x: number; readonly y: number },
  spell: DnD35SpellDefinition,
  areaMultiplier = 1,
  skipAllies = false
): {
  readonly allTargetIds: ReadonlyArray<EntityId>;
  readonly hostileIds: ReadonlyArray<EntityId>;
  readonly allyIds: ReadonlyArray<EntityId>;
  readonly hitsSelf: boolean;
} {
  const allTargetIds = enumerateSpellTargets(state, casterId, casterPos, targetPos, spell, areaMultiplier, skipAllies);
  const livingActors = allTargetIds.filter((id) => {
    const f = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    return f !== undefined && f.hp > 0;
  });
  const hostileIds = livingActors.filter((id) => id !== casterId && isHostile(state, casterId, id));
  const allyIds = livingActors.filter((id) => id !== casterId && !isHostile(state, casterId, id));
  const hitsSelf = livingActors.includes(casterId);
  return { allTargetIds, hostileIds, allyIds, hitsSelf };
}
