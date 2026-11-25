/**
 * @file Declarative target category filtering for D&D 3.5e spells, effect units, and activated abilities.
 */

import { getComponent, getEntitiesAtPosition } from '../../../core/ecs.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type TagsComponent,
  type TrapComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getFactionRelation, isHostile } from '../../../utils/faction.ts';
import { getMapZBounds, getTileDefAt, isInMapBounds, isMultiZMap } from '../../../map/map_accessor.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { DND35E_DEATH_HP_THRESHOLD } from '../combat/damage_vitality.ts';
import type { DnD35TargetCategory } from '../types/system/effect_system.types.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';
import { computeAoEAffectedSquares, computeAoEAffectedSquares3D, type AoETemplateShape } from './aoe_rest.ts';

const ALLEGIANCE_CATEGORIES: ReadonlySet<DnD35TargetCategory> = new Set(['self', 'ally', 'enemy', 'neutral']);

/** Returns true if a spell or its effect units contain harmful offensive effects. */
export function isOffensiveDnD35Spell(spell: DnD35SpellDefinition): boolean {
  if (spell.effectUnits.length > 0) {
    return spell.effectUnits.some(
      (u) => u.type === 'damage' || u.type === 'save_or_die' || u.type === 'energy_drain' || u.type === 'ability_harm'
    );
  }
  return Boolean(spell.damageDice);
}

/**
 * Determines whether an actor is alive (including `0 HP` Disabled and negative HP above its
 * resolved `deathHpThreshold`, e.g. via Diehard or threshold-expanding feats/spells) and lacks `DeathComponent`.
 */
function isActorAliveForTargeting(state: GameState, candidateId: EntityId): boolean {
  const fighter = getComponent(state, candidateId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return false;
  if (getComponent(state, candidateId, ComponentType.Death) !== undefined) return false;
  const dag = evaluateDnD35eEntityDAG(state, candidateId);
  const conIsNull = dag?.dndData.abilityScores?.con?.base === null;
  const deathHpThreshold = dag?.dagResult.deathHpThreshold ?? (conIsNull ? 0 : DND35E_DEATH_HP_THRESHOLD);
  return fighter.hp > deathHpThreshold;
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

  const isLivingCreature = isActorAliveForTargeting(state, candidateId);
  const isCorpse = death !== undefined || (fighter !== undefined && !isLivingCreature) || tags.includes('corpse');
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
  targetPos: { readonly x: number; readonly y: number; readonly z?: number | undefined },
  spell: DnD35SpellDefinition,
  areaMultiplier: number,
  skipAllies = false
): ReadonlyArray<EntityId> {
  const isArea =
    spell.targeting?.mode === 'area' ||
    spell.aoeShape === 'burst' ||
    spell.aoeShape === 'spread' ||
    spell.aoeShape === 'cone' ||
    spell.aoeShape === 'line' ||
    spell.aoeShape === 'emanation';
  const hasNonCasterUnits =
    spell.effectUnits.length > 0
      ? spell.effectUnits.some((u) => u.type !== 'spatial_field' && u.type !== 'summon' && u.targetRole !== 'caster')
      : Boolean(spell.damageDice);

  const isSelfAnchoredField = spell.effectUnits.some((u) => u.type === 'spatial_field' && u.anchorToCaster);
  if (isSelfAnchoredField) {
    return [casterId];
  }
  if (
    (spell.range === 'personal' || spell.targeting?.mode === 'personal') &&
    (!isArea || spell.aoeRadiusFt <= 0 || !hasNonCasterUnits)
  ) {
    return [casterId];
  }

  const validCategories = spell.targeting?.validTargetCategories;
  const shouldSkipAllies = skipAllies && isOffensiveDnD35Spell(spell);
  const excludesCasterFromPersonalAoE =
    spell.range === 'personal' &&
    !(validCategories?.includes('self') ?? false) &&
    (isOffensiveDnD35Spell(spell) ||
      spell.effectUnits.some((u) => u.type === 'condition' && u.curesConditions.length === 0));
  const isEligible = (id: EntityId): boolean => {
    if (excludesCasterFromPersonalAoE && id === casterId) {
      return false;
    }
    if (validCategories !== undefined && validCategories.length > 0) {
      if (!matchesTargetCategoryFilter(state, casterId, id, validCategories)) return false;
    } else {
      if (!isActorAliveForTargeting(state, id)) return false;
    }
    if (shouldSkipAllies && (id === casterId || !isHostile(state, casterId, id))) {
      return false;
    }
    return true;
  };

  if (isArea && spell.aoeRadiusFt > 0) {
    const shape: AoETemplateShape =
      spell.aoeShape === 'cone' || spell.aoeShape === 'line' || spell.aoeShape === 'burst' ? spell.aoeShape : 'spread';
    const origin =
      shape === 'cone' || shape === 'line' || spell.range === 'personal'
        ? { x: casterPos.x, y: casterPos.y, z: casterPos.z ?? 0 }
        : { x: targetPos.x, y: targetPos.y, z: targetPos.z ?? casterPos.z ?? 0 };
    const multiZ = isMultiZMap(state.map);
    const zBounds = getMapZBounds(state.map);
    const squareKeys = new Set<string>();
    if (multiZ) {
      const isWallAt3D = (x: number, y: number, z: number): boolean => {
        if (z < zBounds.minZ || z > zBounds.maxZ || !isInMapBounds(state.map, x, y, z)) return true;
        const def = getTileDefAt(state, x, y, z);
        if (!def) return true;
        return !def.walkable && def.isOpenAir !== true;
      };
      const affected3D = computeAoEAffectedSquares3D(
        shape,
        origin,
        { x: targetPos.x, y: targetPos.y, z: targetPos.z ?? casterPos.z ?? 0 },
        spell.aoeRadiusFt * areaMultiplier,
        isWallAt3D
      );
      for (const p of affected3D) {
        squareKeys.add(`${p.x},${p.y},${p.z}`);
      }
    } else {
      const isWallAt = (x: number, y: number): boolean => {
        if (!isInMapBounds(state.map, x, y)) return true;
        return !(getTileDefAt(state, x, y)?.walkable ?? false);
      };
      const affectedSquares = computeAoEAffectedSquares(
        shape,
        origin,
        targetPos,
        spell.aoeRadiusFt * areaMultiplier,
        isWallAt
      );
      for (const p of affectedSquares) {
        squareKeys.add(`${p.x},${p.y},0`);
      }
    }
    return state.entities.filter((id) => {
      const p = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
      if (!p || !isEligible(id)) return false;
      const w = Math.max(1, p.footprintWidth ?? 1);
      const h = Math.max(1, p.footprintHeight ?? 1);
      const pz = p.z ?? 0;
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) {
          if (squareKeys.has(`${p.x + dx},${p.y + dy},${pz}`)) {
            return true;
          }
        }
      }
      return false;
    });
  }

  const entitiesHere = getEntitiesAtPosition(state, targetPos.x, targetPos.y, targetPos.z ?? 0);
  const eligibleHere = entitiesHere.filter((id) => isEligible(id));
  if (eligibleHere.length === 0) return [];
  const preferredActor = eligibleHere.find((id) => isActorAliveForTargeting(state, id));
  return [preferredActor ?? eligibleHere[0]!];
}

/** Predicts hostile, allied, and self victims caught within a candidate spell cast footprint. */
export function predictSpellAoEVictims(
  state: GameState,
  casterId: EntityId,
  casterPos: PositionComponent,
  targetPos: { readonly x: number; readonly y: number; readonly z?: number | undefined },
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
  const livingActors = allTargetIds.filter((id) => isActorAliveForTargeting(state, id));
  const hostileIds = livingActors.filter((id) => id !== casterId && isHostile(state, casterId, id));
  const allyIds = livingActors.filter((id) => id !== casterId && !isHostile(state, casterId, id));
  const hitsSelf = livingActors.includes(casterId);
  return { allTargetIds, hostileIds, allyIds, hitsSelf };
}
