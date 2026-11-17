import { addComponent, getComponent, removeComponent } from '../../../core/ecs.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type StatusEffectsComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getFactionRelation, isHostile } from '../../../utils/faction.ts';
import { isFlankingTarget } from './cover_senses.ts';
import { computeRectFootprintSquares, measureFootprintToFootprintDistanceFt } from './footprint_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { FEET_PER_GRID_SQUARE, SIZE_METRICS } from './grid_geometry.ts';
import type { DnD35EntityData, DnD35FlankingRelations } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Canonical status effect ID applied while an entity is actively flanking one or more targets. */
export const FLANKING_STATUS_ID = 'flanking';

/** Canonical status effect ID applied while an entity is being flanked by one or more attackers. */
export const FLANKED_STATUS_ID = 'flanked';

/** Canonical status effect ID applied by Ranger's Distracting Attack (`until start of attacker's next turn`). */
export const DISTRACTED_FLANKED_STATUS_ID = 'distracted_flanked';

/** Sentinel duration for geometry-synchronized flanking statuses (managed by `syncSpatialFlankingGraph`). */
const GEOMETRY_SYNC_STATUS_DURATION = 9999;

/** Minimum rogue-level advantage needed to out-flank Improved Uncanny Dodge (`4`). */
const UNCANNY_DODGE_OUTFLANK_MARGIN = 4;

/**
 * Removes a specific status effect by `effectId` from an entity's `StatusEffectsComponent`.
 */
export function removeStatusEffectById(
  state: GameState,
  entityId: EntityId,
  effectId: string,
  onlySourceEntityId?: EntityId
): GameState {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statuses || statuses.activeEffects.length === 0) return state;

  const filtered = statuses.activeEffects.filter((eff) => {
    if (eff.effectId !== effectId) return true;
    if (onlySourceEntityId !== undefined && eff.sourceEntityId !== onlySourceEntityId) return true;
    return false;
  });

  if (filtered.length === statuses.activeEffects.length) return state;
  if (filtered.length === 0) {
    return removeComponent(state, entityId, ComponentType.StatusEffects);
  }
  return addComponent(state, entityId, {
    type: ComponentType.StatusEffects,
    activeEffects: filtered
  });
}

function getActiveStatusIds(state: GameState, entityId: EntityId): ReadonlyArray<string> {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statuses) return [];
  return statuses.activeEffects.filter((e) => e.duration > 0).map((e) => e.effectId);
}

interface SpatialFootprintRef {
  readonly x: number;
  readonly y: number;
  readonly footprintWidth?: number | undefined;
  readonly footprintHeight?: number | undefined;
}

function canThreatenTarget(
  posA: SpatialFootprintRef,
  posB: SpatialFootprintRef,
  reachTiles: number,
  tagsA: ReadonlyArray<string>,
  dataA: DnD35EntityData
): boolean {
  if (reachTiles <= 0) {
    return false;
  }
  const conditions = dataA.conditions ?? [];
  if (
    conditions.includes('helpless') ||
    conditions.includes('paralyzed') ||
    conditions.includes('stunned') ||
    conditions.includes('unconscious') ||
    tagsA.includes('condition:helpless')
  ) {
    return false;
  }
  const distFt = measureFootprintToFootprintDistanceFt(
    posA.x,
    posA.y,
    posA.footprintWidth ?? 1,
    posA.footprintHeight ?? 1,
    posB.x,
    posB.y,
    posB.footprintWidth ?? 1,
    posB.footprintHeight ?? 1
  );
  return distFt <= reachTiles * FEET_PER_GRID_SQUARE;
}

function isDefenderImmuneToFlanking(
  defenderData: DnD35EntityData,
  defenderTags: ReadonlyArray<string>,
  attackerData: DnD35EntityData
): boolean {
  if (
    defenderTags.includes('trait:all_around_vision') ||
    defenderTags.includes('trait:immune_flanking') ||
    (defenderData.immunities?.includes('flanking') ?? false)
  ) {
    return true;
  }

  const hasImprovedUncannyDodge =
    defenderTags.includes('feature:improved_uncanny_dodge') ||
    defenderTags.includes('trait:improved_uncanny_dodge') ||
    (defenderData.activeClassFeatures?.includes('improved_uncanny_dodge') ?? false);
  if (!hasImprovedUncannyDodge) {
    return false;
  }

  const defTracks = defenderData.tracks ?? [];
  const atkTracks = attackerData.tracks ?? [];
  const defUncannyLvl =
    defenderData.scalingPools?.['uncanny_dodge_effective_level'] ?? defTracks.reduce((sum, t) => sum + t.levels, 0);
  const atkRogueLvl =
    attackerData.scalingPools?.['uncanny_dodge_effective_level'] ??
    attackerData.scalingPools?.['sneak_attack_dice'] ??
    atkTracks.filter((t) => t.trackId === 'rogue').reduce((sum, t) => sum + t.levels, 0);
  return atkRogueLvl < defUncannyLvl + UNCANNY_DODGE_OUTFLANK_MARGIN;
}

/**
 * Evaluates whether `attackerId` is flanking `defenderId`, accounting for:
 * - Standard 180-degree opposite-side geometry (`isFlankingTarget`)
 * - Target-side `status:distracted_flanked` (e.g., Ranger's *Distracting Attack*)
 * - Solo flanking (`trait:flank_alone` / `rule:flank_alone`)
 * - Offset / adjacent pair flanking (`trait:offset_flanking` / `trait:island_of_blades` / `trait:adaptable_flanker`)
 * - Defender flanking immunities (`trait:all_around_vision`, `improved_uncanny_dodge`)
 */
export function evaluateEntityFlankingTarget(params: {
  readonly state: GameState;
  readonly attackerId: EntityId;
  readonly defenderId: EntityId;
  readonly attackerPos: SpatialFootprintRef;
  readonly defenderPos: SpatialFootprintRef;
  readonly attackerData: DnD35EntityData;
  readonly defenderData: DnD35EntityData;
  readonly attackerSelfTags: ReadonlyArray<string>;
  readonly defenderSelfTags: ReadonlyArray<string>;
}): boolean {
  const {
    state,
    attackerId,
    defenderId,
    attackerPos,
    defenderPos,
    attackerData,
    defenderData,
    attackerSelfTags,
    defenderSelfTags
  } = params;

  if (attackerId === defenderId) return false;

  const attackerReachFt =
    SIZE_METRICS[attackerData.sizeCategory ?? 'medium']?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE;
  const attackerReach = Math.floor(attackerReachFt / FEET_PER_GRID_SQUARE);
  if (!canThreatenTarget(attackerPos, defenderPos, attackerReach, attackerSelfTags, attackerData)) {
    return false;
  }

  if (isDefenderImmuneToFlanking(defenderData, defenderSelfTags, attackerData)) {
    return false;
  }

  // Target-side virtual flanked condition (e.g. Distracting Attack)
  const defenderStatuses = getActiveStatusIds(state, defenderId);
  if (
    defenderSelfTags.includes('status:distracted_flanked') ||
    defenderStatuses.includes(DISTRACTED_FLANKED_STATUS_ID)
  ) {
    return true;
  }

  // Solo flanking rule override
  if (attackerSelfTags.includes('trait:flank_alone') || attackerSelfTags.includes('rule:flank_alone')) {
    return true;
  }

  const threateningAllyPositions: Array<{ readonly x: number; readonly y: number }> = [];
  for (const otherId of state.entities) {
    if (otherId === attackerId || otherId === defenderId) continue;
    const otherFighter = getComponent(state, otherId, ComponentType.Fighter) as FighterComponent | undefined;
    const otherPos = getComponent(state, otherId, ComponentType.Position) as PositionComponent | undefined;
    if (!otherFighter || otherFighter.hp <= 0 || !otherPos) continue;

    const isAlly =
      getFactionRelation(state, attackerId, otherId) === 'friendly' ||
      (!isHostile(state, attackerId, otherId) && isHostile(state, otherId, defenderId));
    if (!isAlly) continue;

    const otherData = getDnD35EntityData(state, otherId);
    const otherReachFt = SIZE_METRICS[otherData.sizeCategory ?? 'medium']?.naturalReachTallFt ?? FEET_PER_GRID_SQUARE;
    const otherReach = Math.floor(otherReachFt / FEET_PER_GRID_SQUARE);
    if (otherReach <= 0) continue;
    const distToDefFt = measureFootprintToFootprintDistanceFt(
      otherPos.x,
      otherPos.y,
      otherPos.footprintWidth ?? 1,
      otherPos.footprintHeight ?? 1,
      defenderPos.x,
      defenderPos.y,
      defenderPos.footprintWidth ?? 1,
      defenderPos.footprintHeight ?? 1
    );
    if (distToDefFt <= otherReach * FEET_PER_GRID_SQUARE) {
      const allySquares = computeRectFootprintSquares(
        otherPos.x,
        otherPos.y,
        otherPos.footprintWidth ?? 1,
        otherPos.footprintHeight ?? 1
      );
      for (const sq of allySquares) {
        threateningAllyPositions.push(sq);
      }
    }
  }

  if (threateningAllyPositions.length === 0) {
    return false;
  }

  // Offset / Island of Blades style flanking override: any threatening ally in a distinct square suffices
  const hasOffsetFlanking =
    attackerSelfTags.includes('trait:offset_flanking') ||
    attackerSelfTags.includes('trait:island_of_blades') ||
    attackerSelfTags.includes('trait:adaptable_flanker');
  if (hasOffsetFlanking) {
    return threateningAllyPositions.some((ally) => ally.x !== attackerPos.x || ally.y !== attackerPos.y);
  }

  const attackerSquares = computeRectFootprintSquares(
    attackerPos.x,
    attackerPos.y,
    attackerPos.footprintWidth ?? 1,
    attackerPos.footprintHeight ?? 1
  );
  const defenderSquares = computeRectFootprintSquares(
    defenderPos.x,
    defenderPos.y,
    defenderPos.footprintWidth ?? 1,
    defenderPos.footprintHeight ?? 1
  );

  for (const atkSq of attackerSquares) {
    for (const defSq of defenderSquares) {
      if (isFlankingTarget(atkSq, threateningAllyPositions, defSq, false)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Recomputes relational flanking pairs (`flankingTargetIds`, `flankedByEntityIds`) across all living
 * combatants in `GameState`, persisting `flankingRelations` on `DnD35EntityData` and synchronizing
 * `'flanking'` and `'flanked'` status effects in `StatusEffectsComponent`.
 */
export function syncSpatialFlankingGraph(state: GameState): GameState {
  const sysContent = getDnD35SystemContent(state.campaign);
  const combatants: Array<{
    readonly id: EntityId;
    readonly pos: PositionComponent;
    readonly data: DnD35EntityData;
    readonly tags: ReadonlyArray<string>;
  }> = [];

  for (const id of state.entities) {
    const fighter = getComponent(state, id, ComponentType.Fighter) as FighterComponent | undefined;
    const pos = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !pos) continue;

    const data = getDnD35EntityData(state, id);
    const sit = resolveEntitySituationalTagContext(state, id, data);
    const rawTags = (getComponent(state, id, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    const statusTags = getActiveStatusIds(state, id).map((s) => `status:${s}`);
    const tags = projectDnD35ActorSemanticTags(
      data,
      [...rawTags, ...statusTags],
      sit,
      sysContent?.classes,
      sysContent?.skills,
      sysContent?.domains,
      sysContent?.feats
    );
    combatants.push({ id, pos, data, tags });
  }

  const flankingMap = new Map<EntityId, number[]>();
  const flankedByMap = new Map<EntityId, number[]>();
  for (const c of combatants) {
    flankingMap.set(c.id, []);
    flankedByMap.set(c.id, []);
  }

  for (const atk of combatants) {
    for (const def of combatants) {
      if (atk.id === def.id || !isHostile(state, atk.id, def.id)) continue;
      const isFlank = evaluateEntityFlankingTarget({
        state,
        attackerId: atk.id,
        defenderId: def.id,
        attackerPos: atk.pos,
        defenderPos: def.pos,
        attackerData: atk.data,
        defenderData: def.data,
        attackerSelfTags: atk.tags,
        defenderSelfTags: def.tags
      });
      if (isFlank) {
        flankingMap.get(atk.id)!.push(def.id);
        flankedByMap.get(def.id)!.push(atk.id);
      }
    }
  }

  let runningState = state;
  for (const c of combatants) {
    const flankingTargetIds = flankingMap.get(c.id) ?? [];
    const flankedByEntityIds = flankedByMap.get(c.id) ?? [];
    const nextRelations: DnD35FlankingRelations = { flankingTargetIds, flankedByEntityIds };
    const prevRelations = c.data.flankingRelations;
    const changed =
      !prevRelations ||
      prevRelations.flankingTargetIds.length !== flankingTargetIds.length ||
      prevRelations.flankedByEntityIds.length !== flankedByEntityIds.length ||
      prevRelations.flankingTargetIds.some((id, idx) => id !== flankingTargetIds[idx]) ||
      prevRelations.flankedByEntityIds.some((id, idx) => id !== flankedByEntityIds[idx]);

    if (changed) {
      runningState = setDnD35EntityData(runningState, c.id, {
        ...getDnD35EntityData(runningState, c.id),
        flankingRelations: nextRelations
      });
    }

    const activeIds = getActiveStatusIds(runningState, c.id);
    if (flankingTargetIds.length > 0 && !activeIds.includes(FLANKING_STATUS_ID)) {
      runningState = applyStatusEffect(runningState, c.id, FLANKING_STATUS_ID, GEOMETRY_SYNC_STATUS_DURATION);
    } else if (flankingTargetIds.length === 0 && activeIds.includes(FLANKING_STATUS_ID)) {
      runningState = removeStatusEffectById(runningState, c.id, FLANKING_STATUS_ID);
    }

    if (flankedByEntityIds.length > 0 && !activeIds.includes(FLANKED_STATUS_ID)) {
      runningState = applyStatusEffect(runningState, c.id, FLANKED_STATUS_ID, GEOMETRY_SYNC_STATUS_DURATION);
    } else if (flankedByEntityIds.length === 0 && activeIds.includes(FLANKED_STATUS_ID)) {
      runningState = removeStatusEffectById(runningState, c.id, FLANKED_STATUS_ID);
    }
  }

  return runningState;
}
