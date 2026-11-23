import { addComponent, consumeResourcePool, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type ResourcePoolComponent
} from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { isHostile } from '../../../utils/faction.ts';
import { coordToIndex } from '../../../utils/grid.ts';
import { consumeStandardActionFromBudget } from '../action_economy.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { hydrateEntityRoundActionBudget } from '../cartridge/dnd35e_turn_budget.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { evaluateCover } from '../spatial/cover_senses.ts';
import {
  measureFootprintToFootprintDistanceFt,
  syncDnD35eActorSpatialFootprint
} from '../spatial/footprint_resolver.ts';
import { resolveTypedModifiers } from '../modifiers/stacking_engine.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { executeWildShapePoolActivation } from '../wild_shape.ts';
import { executeInvisibleFistImmediate, initiateAbruptJauntTargeting } from './immediate_reactions.ts';

/** Maximum burst range of Turn/Rebuke Undead in feet (`60 ft`, PHB p. 159). */
export const TURN_UNDEAD_RANGE_FT = 60;

/** Undead with HD <= floor(turningLevel / 2) are destroyed rather than turned (PHB p. 159). */
const TURN_UNDEAD_DESTROY_DIVISOR = 2;

/** Duration of Turned status effect in combat rounds (`10` rounds = 1 minute). */
const TURNED_DURATION_ROUNDS = 10;

/** Default duration for activated pool buff effects (`5` rounds). */
const POOL_BUFF_DURATION_ROUNDS = 5;

/** Turning Check table threshold step (`3` per +/-1 HD shift). */
const TURNING_CHECK_STEP = 3;

/** Baseline turning check threshold yielding `+0` HD delta (`10`). */
const TURNING_CHECK_BASELINE = 10;

/** Minimum/maximum turning check relative HD shift (`-4` to `+4`). */
const TURNING_CHECK_MAX_DELTA = 4;

/** Turning damage dice expression (`2d6`). */
const TURNING_DAMAGE_DICE = '2d6';

/** Bonus to turning damage per effective turning level (`+1`). */
const TURNING_DAMAGE_PER_LEVEL = 1;

/** Minimum total HD on a lay-on-hands / healing pool fallback (`2`). */
const HEAL_POOL_FALLBACK_MULTIPLIER = 2;

function getEffectiveActorLevel(dndData: DnD35EntityData): number {
  let total = 0;
  for (const track of dndData.tracks) {
    total += track.levels;
  }
  return Math.max(1, total);
}

function getEffectiveTurningLevel(
  dndData: DnD35EntityData,
  statModifiers: ReadonlyArray<StatModifier> = [],
  selfTags: ReadonlyArray<string> = []
): number {
  const poolLvl = dndData.scalingPools?.['turn_undead_level'];
  const clericTrack = dndData.tracks.find((t) => t.trackId === 'cleric');
  const baseLevel =
    poolLvl !== undefined && poolLvl > 0
      ? poolLvl
      : clericTrack && clericTrack.levels > 0
        ? clericTrack.levels
        : getEffectiveActorLevel(dndData);
  const bonus = resolveTypedModifiers(
    statModifiers.filter((m) => m.targetStat === 'effective_turning_level'),
    { selfTags }
  );
  return Math.max(1, baseLevel + bonus);
}

function computeTurnCheckMaxHdDelta(checkTotal: number): number {
  if (checkTotal <= 0) return -TURNING_CHECK_MAX_DELTA;
  const raw = Math.floor((checkTotal - TURNING_CHECK_BASELINE) / TURNING_CHECK_STEP);
  return Math.max(-TURNING_CHECK_MAX_DELTA, Math.min(TURNING_CHECK_MAX_DELTA, raw));
}

function isTargetUndead(state: GameState, targetId: EntityId): { readonly undead: boolean; readonly hd: number } {
  const targetData = getDnD35EntityData(state, targetId);
  const creatureType = targetData.creatureType?.toLowerCase() ?? '';
  const hasUndeadTag =
    creatureType === 'undead' ||
    (targetData.subtypes?.some((t) => t.toLowerCase().includes('undead')) ?? false) ||
    targetData.raceId?.toLowerCase().includes('undead') === true ||
    targetData.abilityScores?.con?.base === null;

  const isConstruct = creatureType === 'construct';
  const undead = creatureType === 'undead' || (hasUndeadTag && !isConstruct);
  const hd = Math.max(
    1,
    targetData.tracks.reduce((sum, t) => sum + t.levels, 0)
  );
  return { undead, hd };
}

function resolveTurnUndeadPool(state: GameState, actorId: EntityId, poolId: string, abilityLabel: string): GameState {
  const actorPos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  const dag = evaluateDnD35eEntityDAG(state, actorId);
  const dndData = dag?.dndData ?? getDnD35EntityData(state, actorId);
  const chaMod = dag?.dagResult.effectiveAbilityModifiers.cha ?? 0;
  const turningLevel = getEffectiveTurningLevel(
    dndData,
    dag?.statModifiers ?? dndData.statModifiers ?? [],
    dag?.selfTags ?? []
  );
  const isGreaterTurning = poolId.includes('greater');

  const checkRoll = rollD20('ability_check', chaMod);
  const maxHdAffected = turningLevel + computeTurnCheckMaxHdDelta(checkRoll.total);
  const dmgRoll = evaluateDiceExpression(TURNING_DAMAGE_DICE);
  let remainingHdBudget = Math.max(0, dmgRoll.total + turningLevel * TURNING_DAMAGE_PER_LEVEL + chaMod);

  let nextState = addMessage(
    state,
    `${abilityLabel}: Turning check ${checkRoll.total} (up to ${maxHdAffected} HD), Turning damage ${remainingHdBudget} HD within ${TURN_UNDEAD_RANGE_FT} ft.`,
    MessageLogCategory.CombatHit
  );

  if (!actorPos) {
    return nextState;
  }

  const isWallAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) return true;
    const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
    if (!tile) return true;
    const def = state.campaign.tiles[tile.tileId];
    return def === undefined || !def.transparent;
  };

  interface TurnCandidate {
    readonly id: EntityId;
    readonly distFt: number;
    readonly hd: number;
    readonly name: string;
  }

  const candidates: TurnCandidate[] = [];
  for (const candId of nextState.entities) {
    if (candId === actorId) continue;
    const fighter = getComponent(nextState, candId, ComponentType.Fighter) as FighterComponent | undefined;
    const pos = getComponent(nextState, candId, ComponentType.Position) as PositionComponent | undefined;
    if (!fighter || fighter.hp <= 0 || !pos) continue;
    if (!isHostile(nextState, actorId, candId)) continue;

    const distFt = measureFootprintToFootprintDistanceFt(
      actorPos.x,
      actorPos.y,
      actorPos.footprintWidth ?? 1,
      actorPos.footprintHeight ?? 1,
      pos.x,
      pos.y,
      pos.footprintWidth ?? 1,
      pos.footprintHeight ?? 1
    );
    if (distFt > TURN_UNDEAD_RANGE_FT) continue;

    const cover = evaluateCover(actorPos, pos, isWallAt);
    if (cover.blocksLineOfEffect) continue;

    const undeadCheck = isTargetUndead(nextState, candId);
    if (!undeadCheck.undead) continue;

    candidates.push({
      id: candId,
      distFt,
      hd: undeadCheck.hd,
      name: resolveEntityDisplayName(nextState, candId, `Undead #${candId}`)
    });
  }

  // Turn closest eligible undead first (PHB p. 159)
  candidates.sort((a, b) => a.distFt - b.distFt || a.hd - b.hd);

  let affectedCount = 0;
  for (const cand of candidates) {
    if (cand.hd > maxHdAffected || cand.hd > remainingHdBudget) continue;
    remainingHdBudget -= cand.hd;
    affectedCount += 1;

    const destroyThreshold = Math.floor(turningLevel / TURN_UNDEAD_DESTROY_DIVISOR);
    if (isGreaterTurning || cand.hd <= destroyThreshold) {
      const targetFighter = getComponent(nextState, cand.id, ComponentType.Fighter) as FighterComponent | undefined;
      if (targetFighter) {
        nextState = addComponent(nextState, cand.id, { ...targetFighter, hp: 0 });
      }
      nextState = addComponent(nextState, cand.id, { type: ComponentType.Death, killerId: actorId });
      nextState = addFloatingText(nextState, cand.id, 'DESTROYED!', '#f1c40f');
      nextState = addMessage(
        nextState,
        `${cand.name} (${cand.hd} HD) is destroyed by radiant turning energy!`,
        MessageLogCategory.CombatHit
      );
    } else {
      nextState = applyStatusEffect(nextState, cand.id, 'turned', TURNED_DURATION_ROUNDS, actorId);
      nextState = applyStatusEffect(nextState, cand.id, 'stun', 1, actorId);
      nextState = addFloatingText(nextState, cand.id, 'TURNED!', '#ffeaa7');
      nextState = addMessage(
        nextState,
        `${cand.name} (${cand.hd} HD) recoils in terror (Turned for ${TURNED_DURATION_ROUNDS} rounds)!`,
        MessageLogCategory.CombatHit
      );
    }
  }

  if (affectedCount === 0) {
    nextState = addMessage(nextState, 'No eligible undead within 60 ft were affected.', MessageLogCategory.System);
  }

  return nextState;
}

/**
 * Executes an activated class or domain resource-pool ability from the hotbar
 * (e.g., Turn Undead, Greater Turning, Lay on Hands, Barbarian Rage, Smite, Domain Powers).
 * Validates remaining pool charges and TurnBased Standard Action budget before resolving.
 *
 * @param state Current immutable GameState.
 * @param actorId Entity activating the pool ability.
 * @param poolId ResourcePoolComponent key (e.g., `'turn_undead'`, `'rage'`, `'lay_on_hands'`).
 * @returns `{ state, success }`.
 */
export function executeDnD35eResourcePoolAbility(
  state: GameState,
  actorId: EntityId,
  poolId: string
): { readonly state: GameState; readonly success: boolean } {
  const poolComp = getComponent(state, actorId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const entry = poolComp?.pools[poolId];
  const label = entry?.label ?? poolId.replace(/_/g, ' ');

  const normalizedId = poolId.toLowerCase();
  if (normalizedId === 'invisible_fist') {
    return executeInvisibleFistImmediate(state, actorId, true);
  }
  if (normalizedId === 'abrupt_jaunt') {
    return initiateAbruptJauntTargeting(state, actorId);
  }

  const dndData = getDnD35EntityData(state, actorId);
  const consumeStandardAndCharge = (
    baseState: GameState,
    spendCharge: boolean
  ): { readonly state: GameState; readonly allowed: boolean } => {
    let nextBudget = dndData.actionBudget;
    if (baseState.engineMode === EngineMode.TurnBased) {
      const activeBudget = dndData.actionBudget ?? hydrateEntityRoundActionBudget(baseState, actorId);
      const stdRes = consumeStandardActionFromBudget(activeBudget);
      if (!stdRes.allowed) {
        return {
          state: addMessage(baseState, `${label}: No Standard Action remaining this round.`, MessageLogCategory.System),
          allowed: false
        };
      }
      nextBudget = stdRes.budget;
    }
    let next = baseState;
    if (spendCharge) {
      if (!entry || entry.current <= 0) {
        return {
          state: addMessage(baseState, `${label}: No uses remaining today.`, MessageLogCategory.System),
          allowed: false
        };
      }
      const consumed = consumeResourcePool(baseState, actorId, poolId, 1);
      if (!consumed.allowed) {
        return {
          state: addMessage(baseState, `${label}: Unable to expend pool charge.`, MessageLogCategory.System),
          allowed: false
        };
      }
      next = consumed.state;
    }
    if (nextBudget !== undefined) {
      next = setDnD35EntityData(next, actorId, { ...getDnD35EntityData(next, actorId), actionBudget: nextBudget });
    }
    return { state: next, allowed: true };
  };

  if (normalizedId === 'wild_shape') {
    const druidLevel = Math.max(
      1,
      dndData.scalingPools?.['wild_shape_level'] ??
        dndData.tracks.find((t) => t.trackId === 'druid')?.levels ??
        getEffectiveActorLevel(dndData)
    );
    const wsResult = executeWildShapePoolActivation({
      state,
      actorId,
      druidLevel,
      races: getDnD35SystemContent(state.campaign)?.races ?? {},
      label,
      consumeActionAndCharge: consumeStandardAndCharge
    });
    return wsResult.success
      ? { state: syncDnD35eActorSpatialFootprint(wsResult.state, actorId), success: true }
      : wsResult;
  }

  if (!entry || entry.current <= 0) {
    return {
      state: addMessage(state, `${label}: No uses remaining today.`, MessageLogCategory.System),
      success: false
    };
  }
  const step = consumeStandardAndCharge(state, true);
  if (!step.allowed) return { state: step.state, success: false };
  let nextState = step.state;
  if (normalizedId.includes('turn') || normalizedId.includes('rebuke')) {
    return {
      state: resolveTurnUndeadPool(nextState, actorId, normalizedId, label),
      success: true
    };
  }

  if (normalizedId.includes('lay_on_hands') || normalizedId.includes('wholeness') || normalizedId.includes('heal')) {
    const fighter = getComponent(nextState, actorId, ComponentType.Fighter) as FighterComponent | undefined;
    if (fighter) {
      const dag = evaluateDnD35eEntityDAG(nextState, actorId);
      const chaMod = Math.max(1, dag?.dagResult.effectiveAbilityModifiers.cha ?? 1);
      const level = getEffectiveActorLevel(dndData);
      const healAmount = Math.max(HEAL_POOL_FALLBACK_MULTIPLIER, level * chaMod);
      const newHp = Math.min(fighter.maxHp, fighter.hp + healAmount);
      nextState = addComponent(nextState, actorId, { ...fighter, hp: newHp });
      nextState = addFloatingText(nextState, actorId, `+${newHp - fighter.hp} HP`, '#2ecc71');
      nextState = addMessage(
        nextState,
        `${label} restores ${newHp - fighter.hp} HP (${newHp}/${fighter.maxHp}).`,
        MessageLogCategory.System
      );
      return { state: nextState, success: true };
    }
  }

  const hasHealingHymn =
    (dndData.activeClassFeatures ?? []).includes('healing_hymn') ||
    (dndData.feats ?? []).includes('healing_hymn') ||
    normalizedId === 'healing_hymn';

  let buffStatusId: string;
  if (normalizedId.includes('rage')) {
    buffStatusId = 'rage_active';
  } else if (normalizedId === 'healing_hymn' || (normalizedId === 'bardic_music' && hasHealingHymn)) {
    buffStatusId = 'healing_hymn_active';
  } else {
    buffStatusId = `pool_${normalizedId}_active`;
  }
  nextState = applyStatusEffect(nextState, actorId, buffStatusId, POOL_BUFF_DURATION_ROUNDS, actorId);
  nextState = addFloatingText(nextState, actorId, label.toUpperCase(), '#ffd166');
  const activationMsg =
    buffStatusId === 'healing_hymn_active'
      ? `Activated ${label} (${entry.current - 1}/${entry.max} uses remaining): Healing spells within 30 ft are empowered.`
      : `Activated ${label} (${entry.current - 1}/${entry.max} uses remaining).`;
  return {
    state: addMessage(nextState, activationMsg, MessageLogCategory.System),
    success: true
  };
}
