import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import {
  DISTRACTED_FLANKED_STATUS_ID,
  removeStatusEffectById,
  syncSpatialFlankingGraph
} from '../spatial/flanking_graph.ts';
import type { DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';

/** Canonical status ID applied when Paladin's Smite Evil pool is armed. */
export const SMITE_EVIL_ACTIVE_STATUS_ID = 'pool_smite_evil_active';

/** Sentinel duration (`99`) for Distracting Attack so it lasts until cleared at attacker's next turn start. */
const DISTRACTING_ATTACK_SENTINEL_DURATION = 99;

/** Minimum distance moved in feet (`10 ft`) qualifying an attack as a Charge / post-move rush. */
export const CHARGE_MOVEMENT_MIN_FT = 10;

/** Whirling Frenzy attack roll penalty across all strikes in the round (`-2`). */
export const WHIRLING_FRENZY_ATTACK_PENALTY = -2;

const WHIRLING_FRENZY_STR_BASE = 4;
const WHIRLING_FRENZY_STR_GREATER = 6;
const WHIRLING_FRENZY_STR_MIGHTY = 8;
const WHIRLING_FRENZY_DODGE_BASE = 2;
const WHIRLING_FRENZY_DODGE_GREATER = 3;
const WHIRLING_FRENZY_DODGE_MIGHTY = 4;
const RAGE_STAT_BASE = 4;
const RAGE_STAT_GREATER = 6;
const RAGE_STAT_MIGHTY = 8;
const RAGE_WILL_BASE = 2;
const RAGE_WILL_GREATER = 3;
const RAGE_WILL_MIGHTY = 4;
const RAGE_AC_PENALTY = -2;

/** Resolved Smite Evil & Charging Smite attack/damage context for a single strike. */
export interface SmiteStrikeContext {
  readonly isSmiteAttempt: boolean;
  readonly isChargingSmiteAttack: boolean;
  readonly smiteTargetWasEvil: boolean;
  readonly smiteAttackBonus: number;
  readonly smiteDamageBonus: number;
}

/**
 * Resolves whether Smite Evil and/or Charging Smite (`trait:charging_smite`) apply to the current melee strike:
 * - Requires `status:pool_smite_evil_active` on attacker.
 * - Grants `+max(0, CHA)` to attack and `+smiteLevel` to damage against `alignment:evil` targets.
 * - With `trait:charging_smite` on a Charge (`>= 10 ft` moved or `stance:charge`), grants `+2 * smiteLevel` extra damage (`3 * smiteLevel` total).
 */
export function resolveSmiteAndChargeContext(params: {
  readonly attackerData: DnD35EntityData;
  readonly attackerSelfTags: ReadonlyArray<string>;
  readonly defenderSelfTags: ReadonlyArray<string>;
  readonly attackerChaMod: number;
  readonly isChargeAttack: boolean;
}): SmiteStrikeContext {
  const { attackerData, attackerSelfTags, defenderSelfTags, attackerChaMod, isChargeAttack } = params;
  const isSmiteAttempt = attackerSelfTags.includes(`status:${SMITE_EVIL_ACTIVE_STATUS_ID}`);
  if (!isSmiteAttempt) {
    return {
      isSmiteAttempt: false,
      isChargingSmiteAttack: false,
      smiteTargetWasEvil: false,
      smiteAttackBonus: 0,
      smiteDamageBonus: 0
    };
  }

  const smiteTargetWasEvil = defenderSelfTags.includes('alignment:evil');
  const paladinLevels = (attackerData.tracks ?? [])
    .filter((t) => t.trackId === 'paladin')
    .reduce((sum, t) => sum + t.levels, 0);
  const smiteLevel = Math.max(1, attackerData.scalingPools?.['smite_evil_damage_level'] ?? paladinLevels);
  const hasChargingSmite =
    attackerSelfTags.includes('trait:charging_smite') || attackerSelfTags.includes('feature:charging_smite');
  const isChargingSmiteAttack = isChargeAttack && hasChargingSmite;

  if (!smiteTargetWasEvil) {
    return {
      isSmiteAttempt: true,
      isChargingSmiteAttack,
      smiteTargetWasEvil: false,
      smiteAttackBonus: 0,
      smiteDamageBonus: 0
    };
  }

  return {
    isSmiteAttempt: true,
    isChargingSmiteAttack,
    smiteTargetWasEvil: true,
    smiteAttackBonus: Math.max(0, attackerChaMod),
    smiteDamageBonus: isChargingSmiteAttack ? smiteLevel * 3 : smiteLevel
  };
}

/**
 * Resolves the actor's Sneak Attack d6 dice count declaratively from `scalingPools.sneak_attack_dice`
 * (falling back to feature tag count when no scalingPool was hydrated).
 */
export function resolveSneakAttackDiceCount(
  attackerData: DnD35EntityData,
  attackerSelfTags: ReadonlyArray<string>
): number {
  const poolDice = attackerData.scalingPools?.['sneak_attack_dice'] ?? 0;
  if (poolDice > 0) return poolDice;

  const featureSneakDice = attackerSelfTags.filter((t) => t.startsWith('feature:sneak_attack_')).length;
  return featureSneakDice;
}

/**
 * Resolves Sneak Attack & **Penetrating Strike** (`trait:penetrating_strike`) precision damage dice on hit:
 * - Eligible if `isFlanking` OR (`isTargetDeniedDex` when not negated by Uncanny Dodge).
 * - Normal targets (`!targetImmuneToCrits`): rolls `${sneakAttackDice}d6` precision damage.
 * - Crit-immune targets when **flanked** by an attacker with `trait:penetrating_strike`:
 *   rolls `floor(sneakAttackDice / 2)d6` precision damage (`Dungeonscape p. 13`).
 */
export function resolvePrecisionDamageOnHit(params: {
  readonly sneakAttackDice: number;
  readonly isFlanking: boolean;
  readonly isTargetDeniedDex: boolean;
  readonly targetImmuneToCrits: boolean;
  readonly fortificationNegated: boolean;
  readonly concealmentMissChance: number;
  readonly attackerSelfTags: ReadonlyArray<string>;
}): { readonly damage: number; readonly diceUsed: number; readonly usedPenetratingStrike: boolean } {
  const {
    sneakAttackDice,
    isFlanking,
    isTargetDeniedDex,
    targetImmuneToCrits,
    fortificationNegated,
    concealmentMissChance,
    attackerSelfTags
  } = params;

  if (sneakAttackDice <= 0 || concealmentMissChance > 0) {
    return { damage: 0, diceUsed: 0, usedPenetratingStrike: false };
  }

  if (!isFlanking && !isTargetDeniedDex) {
    return { damage: 0, diceUsed: 0, usedPenetratingStrike: false };
  }

  const hasPenetratingStrike =
    attackerSelfTags.includes('trait:penetrating_strike') || attackerSelfTags.includes('feature:penetrating_strike');

  if (targetImmuneToCrits || fortificationNegated) {
    if (isFlanking && hasPenetratingStrike) {
      const halfDice = Math.floor(sneakAttackDice / 2);
      if (halfDice <= 0) {
        return { damage: 0, diceUsed: 0, usedPenetratingStrike: false };
      }
      const roll = evaluateDiceExpression(`${halfDice}d6`);
      return { damage: Math.max(0, roll.total), diceUsed: halfDice, usedPenetratingStrike: true };
    }
    return { damage: 0, diceUsed: 0, usedPenetratingStrike: false };
  }

  const roll = evaluateDiceExpression(`${sneakAttackDice}d6`);
  return { damage: Math.max(0, roll.total), diceUsed: sneakAttackDice, usedPenetratingStrike: false };
}

/**
 * Applies post-strike state updates for milestone ACFs:
 * 1. Consumes `pool_smite_evil_active` status effect; if Charging Smite missed, refunds 1 `smite_evil` pool charge.
 * 2. Applies `distracted_flanked` to defender on hit when attacker has `trait:distracting_attack`, updating the Relational Flanking Graph.
 * 3. Applies `decisive_strike_aoo_active` to attacker when executing Decisive Strike so AoOs before next turn deal `2x` damage.
 */
export function finalizeStrikeAcfStateUpdates(params: {
  readonly state: GameState;
  readonly attackerId: EntityId;
  readonly defenderId: EntityId;
  readonly attackerSelfTags: ReadonlyArray<string>;
  readonly hit: boolean;
  readonly smiteCtx: SmiteStrikeContext;
  readonly isDecisiveStrike: boolean;
}): GameState {
  let runningState = params.state;
  const { attackerId, defenderId, attackerSelfTags, hit, smiteCtx, isDecisiveStrike } = params;

  if (smiteCtx.isSmiteAttempt) {
    runningState = removeStatusEffectById(runningState, attackerId, SMITE_EVIL_ACTIVE_STATUS_ID);
    if (smiteCtx.isChargingSmiteAttack && (!hit || !smiteCtx.smiteTargetWasEvil)) {
      const poolComp = getComponent(runningState, attackerId, ComponentType.ResourcePool) as
        ResourcePoolComponent | undefined;
      const smiteEntry = poolComp?.pools['smite_evil'];
      if (poolComp && smiteEntry && smiteEntry.current < smiteEntry.max) {
        runningState = addComponent(runningState, attackerId, {
          ...poolComp,
          pools: {
            ...poolComp.pools,
            smite_evil: {
              ...smiteEntry,
              current: Math.min(smiteEntry.max, smiteEntry.current + 1)
            }
          }
        });
        runningState = addMessage(
          runningState,
          '[Charging Smite] Charge strike failed to smite — Smite Evil attempt is not expended!',
          MessageLogCategory.System
        );
      }
    }
  }

  if (isDecisiveStrike) {
    runningState = applyStatusEffect(runningState, attackerId, 'decisive_strike_aoo_active', 1, attackerId);
  }

  if (
    hit &&
    (attackerSelfTags.includes('trait:distracting_attack') || attackerSelfTags.includes('feature:distracting_attack'))
  ) {
    runningState = applyStatusEffect(
      runningState,
      defenderId,
      DISTRACTED_FLANKED_STATUS_ID,
      DISTRACTING_ATTACK_SENTINEL_DURATION,
      attackerId
    );
    runningState = syncSpatialFlankingGraph(runningState);
    runningState = addMessage(
      runningState,
      '[Distracting Attack] Target is off-balance and treated as flanked until your next turn!',
      MessageLogCategory.CombatHit
    );
  }

  return runningState;
}

/**
 * Emits D&D 3.5e `StatModifier`s for active **Whirling Frenzy** (`UA p. 66`) or **Rage** (`PHB p. 25`),
 * scaling with `greater` / `mighty` traits and checking live activation flags (`doctrine.whirlingFrenzy`,
 * `status:pool_whirling_frenzy_active`, or `status:rage_active`).
 */
export function collectRageAndFrenzyModifiers(
  selfTags: ReadonlyArray<string>,
  doctrine?: TacticalDoctrineComponent
): ReadonlyArray<StatModifier> {
  const mods: StatModifier[] = [];
  const whirlingActive =
    doctrine?.whirlingFrenzy === true ||
    selfTags.includes('status:pool_whirling_frenzy_active') ||
    selfTags.includes('status:whirling_frenzy_active');

  if (whirlingActive) {
    const isMighty = selfTags.includes('trait:mighty_whirling_frenzy') || selfTags.includes('trait:mighty_rage');
    const isGreater =
      !isMighty && (selfTags.includes('trait:greater_whirling_frenzy') || selfTags.includes('trait:greater_rage'));
    const strVal = isMighty
      ? WHIRLING_FRENZY_STR_MIGHTY
      : isGreater
        ? WHIRLING_FRENZY_STR_GREATER
        : WHIRLING_FRENZY_STR_BASE;
    const dodgeVal = isMighty
      ? WHIRLING_FRENZY_DODGE_MIGHTY
      : isGreater
        ? WHIRLING_FRENZY_DODGE_GREATER
        : WHIRLING_FRENZY_DODGE_BASE;

    mods.push(
      {
        targetStat: 'str',
        value: strVal,
        bonusType: 'untyped',
        sourceId: 'whirling_frenzy_str',
        sourcePath: 'stance:whirling_frenzy/str',
        origin: 'ex'
      },
      {
        targetStat: 'ac',
        value: dodgeVal,
        bonusType: 'dodge',
        sourceId: 'whirling_frenzy_ac',
        sourcePath: 'stance:whirling_frenzy/ac',
        origin: 'ex'
      },
      {
        targetStat: 'ref',
        value: dodgeVal,
        bonusType: 'dodge',
        sourceId: 'whirling_frenzy_ref',
        sourcePath: 'stance:whirling_frenzy/ref',
        origin: 'ex'
      },
      {
        targetStat: 'attack',
        value: WHIRLING_FRENZY_ATTACK_PENALTY,
        bonusType: 'untyped',
        sourceId: 'whirling_frenzy_attack',
        sourcePath: 'stance:whirling_frenzy/attack',
        origin: 'ex'
      },
      {
        targetStat: 'extra_full_bab_attacks',
        value: 1,
        bonusType: 'untyped',
        sourceId: 'whirling_frenzy_extra_attack',
        sourcePath: 'stance:whirling_frenzy/extra_attack',
        origin: 'ex'
      }
    );
    return mods;
  }

  if (selfTags.includes('status:rage_active')) {
    const isMighty = selfTags.includes('trait:mighty_rage');
    const isGreater = !isMighty && selfTags.includes('trait:greater_rage');
    const statVal = isMighty ? RAGE_STAT_MIGHTY : isGreater ? RAGE_STAT_GREATER : RAGE_STAT_BASE;
    const willVal = isMighty ? RAGE_WILL_MIGHTY : isGreater ? RAGE_WILL_GREATER : RAGE_WILL_BASE;

    mods.push(
      {
        targetStat: 'str',
        value: statVal,
        bonusType: 'untyped',
        sourceId: 'rage_str',
        sourcePath: 'status:rage_active/str',
        origin: 'ex'
      },
      {
        targetStat: 'con',
        value: statVal,
        bonusType: 'untyped',
        sourceId: 'rage_con',
        sourcePath: 'status:rage_active/con',
        origin: 'ex'
      },
      {
        targetStat: 'will',
        value: willVal,
        bonusType: 'morale',
        sourceId: 'rage_will',
        sourcePath: 'status:rage_active/will',
        origin: 'ex'
      },
      {
        targetStat: 'ac',
        value: RAGE_AC_PENALTY,
        bonusType: 'untyped',
        sourceId: 'rage_ac',
        sourcePath: 'status:rage_active/ac',
        origin: 'ex'
      }
    );
  }

  return mods;
}
