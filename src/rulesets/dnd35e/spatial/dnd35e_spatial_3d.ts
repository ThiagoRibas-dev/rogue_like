import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { getTileDefAt, isInMapBounds } from '../../../map/map_accessor.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type MovementModes,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { resolveTypedModifiersWithBreakdown } from '../modifiers/stacking_engine.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import { DEFAULT_FEET_PER_Z_LEVEL } from '../../../constants/world_chunk.constants.ts';

/** Standard melee attack bonus granted by occupying higher ground (PHB p. 151). */
export const HIGH_GROUND_MELEE_ATTACK_BONUS = 1;

/** Default Fly speed in feet when granted via rule override (`can_fly`) without an explicit speed modifier. */
const DEFAULT_MAGIC_FLY_SPEED_FT = 60;

/** Distance fallen in feet per 1d6 bludgeoning falling damage in D&D 3.5e (PHB p. 303). */
const DND35_FALLING_FEET_PER_DIE = 10;

/** Tumble DC to treat a fall as 10 feet shorter when conscious (PHB p. 84). */
const TUMBLE_FALL_REDUCTION_DC = 15;

/** Feet negated per successful Tumble falling check. */
const TUMBLE_FALL_REDUCTION_FT = 10;

/** Default Climb DC for rough/climbable vertical surfaces (PHB p. 69). */
const DEFAULT_CLIMB_CHECK_DC = 15;

/** Climb DC for steeper/difficult vertical obstacle tiles (`movementCost >= 200`). */
const STEEP_CLIMB_CHECK_DC = 20;

const CARDINAL_NEIGHBOR_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
];

/** Standard D&D 3.5e Medium biped land speed in feet when no explicit mode is declared. */
const DEFAULT_DND35_LAND_SPEED_FT = 30;

/**
 * Resolves live D&D 3.5e `MovementModes` by combining intrinsic entity movement speeds
 * with active DAG semantic flight tags (`fly_active`, `flying`, `flight:good`) emitted by *Fly* bundles.
 */
export function resolveDnD35eMovementModes(state: GameState, entityId: EntityId): MovementModes | undefined {
  const staticModes = getDnD35EntityData(state, entityId).movementModes;
  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const canFlyOverride =
    dag?.ruleOverrides?.some((r) => r.ruleKey === 'can_fly' && r.value === true) === true ||
    dag?.selfTags.includes('fly_active') === true ||
    dag?.selfTags.includes('flying') === true ||
    dag?.selfTags.some((t) => t.startsWith('flight:')) === true;

  if (!canFlyOverride) {
    return staticModes;
  }

  const staticFly = staticModes?.fly ?? 0;
  const effectiveSpeed = Math.max(staticFly, DEFAULT_MAGIC_FLY_SPEED_FT);
  return {
    ...(staticModes ?? {}),
    land: staticModes?.land ?? dag?.dagResult.speed ?? DEFAULT_DND35_LAND_SPEED_FT,
    fly: effectiveSpeed
  };
}

/**
 * Evaluates D&D 3.5e High Ground melee combat modifier:
 * an attacker standing strictly above the defender (`attackerPos.z > defenderPos.z`) gains `+1` on melee attacks.
 */
export function evaluateDnD35eElevationCombat(
  state: Readonly<GameState>,
  attackerId: EntityId,
  defenderId: EntityId
): { readonly attackBonus: number; readonly label?: string | undefined } {
  const attackerPos = getComponent(state as GameState, attackerId, ComponentType.Position) as
    PositionComponent | undefined;
  const defenderPos = getComponent(state as GameState, defenderId, ComponentType.Position) as
    PositionComponent | undefined;
  if (!attackerPos || !defenderPos) return { attackBonus: 0 };

  if ((attackerPos.z ?? 0) > (defenderPos.z ?? 0)) {
    return { attackBonus: HIGH_GROUND_MELEE_ATTACK_BONUS, label: 'High Ground +1' };
  }
  return { attackBonus: 0 };
}

/**
 * Resolves D&D 3.5e falling impact when an entity lands after dropping `fellLevels`:
 * honors `immune_falling_damage` rule overrides (*Feather Fall*), `slow_fall_ft` modifiers,
 * DC 15 Tumble checks (`-10 ft`), and `1d6` per `10 ft` lethal bludgeoning damage.
 */
export function resolveDnD35eFallLanded(
  state: GameState,
  entityId: EntityId,
  fellLevels: number,
  _landX: number,
  _landY: number,
  _landZ: number
): GameState {
  if (fellLevels <= 0) return state;

  const feetPerZ = state.campaign.rules.map.feetPerZLevel ?? DEFAULT_FEET_PER_Z_LEVEL;
  const rawFallFt = fellLevels * feetPerZ;
  const name = resolveEntityDisplayName(state, entityId, 'Someone');
  const dag = evaluateDnD35eEntityDAG(state, entityId);

  if (
    dag?.ruleOverrides?.some((r) => r.ruleKey === 'immune_falling_damage' && r.value === true) === true ||
    dag?.selfTags.includes('feather_fall_active') === true ||
    dag?.selfTags.includes('immune_falling_damage') === true
  ) {
    return addMessage(
      state,
      `${name} floats gently down via Feather Fall (0 falling damage).`,
      MessageLogCategory.System
    );
  }

  const dndData = getDnD35EntityData(state, entityId);
  const slowFallMods = (dag?.statModifiers ?? dndData.statModifiers ?? []).filter(
    (m) => m.targetStat === 'slow_fall_ft'
  );
  const slowFallFt =
    slowFallMods.length > 0
      ? resolveTypedModifiersWithBreakdown(slowFallMods, { selfTags: dag?.selfTags ?? [] }).total
      : 0;

  let effectiveFallFt = Math.max(0, rawFallFt - slowFallFt);

  // Intentional/trained fall: automatic DC 15 Tumble check to treat fall as 10 ft shorter
  if (effectiveFallFt > 0 && dag) {
    const tumbleMod = dag.resolvedSkills['tumble']?.totalModifier ?? 0;
    if ((dndData.skillRanks?.['tumble'] ?? 0) > 0) {
      const tumbleRoll = rollD20('skill_check', tumbleMod);
      if (tumbleRoll.total >= TUMBLE_FALL_REDUCTION_DC) {
        effectiveFallFt = Math.max(0, effectiveFallFt - TUMBLE_FALL_REDUCTION_FT);
      }
    }
  }

  const diceCount = Math.floor(effectiveFallFt / DND35_FALLING_FEET_PER_DIE);
  if (diceCount <= 0) {
    return addMessage(
      state,
      `${name} drops ${rawFallFt} ft and lands safely without injury.`,
      MessageLogCategory.System
    );
  }

  const dmgAmount = Math.max(1, evaluateDiceExpression(`${diceCount}d6`).total);
  let nextState = addMessage(
    state,
    `${name} falls ${rawFallFt} ft and suffers ${dmgAmount} falling damage (${diceCount}d6)!`,
    MessageLogCategory.CombatHit
  );

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    const existingDmg = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    const instance = {
      amount: dmgAmount,
      tags: ['falling', 'bludgeoning'] as const
    };
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Damage,
      instances: existingDmg ? [...existingDmg.instances, instance] : [instance]
    });
  }

  return nextState;
}

/**
 * Validates and resolves D&D 3.5e vertical movement adjustments via Flight, Stairs/Ladders/Ramps,
 * native Climb speeds, or Climb skill checks adjacent to climbable wall faces.
 */
export function evaluateDnD35eAltitudeAdjustment(
  state: Readonly<GameState>,
  entityId: EntityId,
  _dz: number,
  targetX: number,
  targetY: number,
  targetZ: number
): { readonly allowed: boolean; readonly reason?: string | undefined } {
  const pos = getComponent(state as GameState, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return { allowed: false };
  const fromZ = pos.z ?? 0;

  const modes = resolveDnD35eMovementModes(state as GameState, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return { allowed: true };
  }

  const curDef = getTileDefAt(state, pos.x, pos.y, fromZ);
  const targetDef = getTileDefAt(state, targetX, targetY, targetZ);
  if (curDef?.verticalLink !== undefined || targetDef?.verticalLink !== undefined) {
    return { allowed: true };
  }

  const isAdjacentClimbable = CARDINAL_NEIGHBOR_OFFSETS.some(([ox, oy]) => {
    const curWall = isInMapBounds(state.map, pos.x + ox, pos.y + oy, fromZ)
      ? getTileDefAt(state, pos.x + ox, pos.y + oy, fromZ)
      : undefined;
    const tgtWall = isInMapBounds(state.map, targetX + ox, targetY + oy, targetZ)
      ? getTileDefAt(state, targetX + ox, targetY + oy, targetZ)
      : undefined;
    return curWall?.isClimbable === true || tgtWall?.isClimbable === true;
  });

  if (curDef?.isClimbable !== true && targetDef?.isClimbable !== true && !isAdjacentClimbable) {
    return { allowed: true };
  }

  if (modes?.climb !== undefined && modes.climb > 0) {
    return { allowed: true };
  }

  const dag = evaluateDnD35eEntityDAG(state as GameState, entityId);
  const climbMod = dag?.resolvedSkills['climb']?.totalModifier ?? dag?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const climbDc = (targetDef?.movementCost ?? 100) >= 200 ? STEEP_CLIMB_CHECK_DC : DEFAULT_CLIMB_CHECK_DC;
  const climbRoll = rollD20('skill_check', climbMod);
  if (climbRoll.total >= climbDc) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: `Climb check failed (${climbRoll.total} vs DC ${climbDc})!`
  };
}
