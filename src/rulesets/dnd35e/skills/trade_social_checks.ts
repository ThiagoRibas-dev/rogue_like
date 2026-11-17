import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  type AttitudeComponent,
  type AttitudeTier,
  ComponentType,
  type MemoryComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type {
  DialogueSkillCheckResult,
  TradePriceModifierContext,
  TradePriceModifierResult,
  TradeSocialSkillResult
} from '../../../types/ruleset.types.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { resolveDemoralizeCheck, resolveDiplomacyCheck } from '../skills.ts';
import { DEMORALIZE_BASE_DC, evaluateActorSkillCheck } from './skill_verb_helpers.ts';

const ATTITUDE_PRICE_DELTAS: Readonly<Record<AttitudeTier, number>> = {
  hostile: 0.35,
  unfriendly: 0.15,
  indifferent: 0,
  neutral: 0,
  friendly: -0.08,
  helpful: -0.15
};

const APPRAISE_TRADE_DC = 15;
const APPRAISE_MARKUP_DISCOUNT = -0.1;
const BLUFF_TRADE_DISCOUNT = -0.15;
const BLUFF_TRADE_PENALTY = 0.15;
const DIPLOMACY_HAGGLE_DISCOUNT = -0.15;
const DIPLOMACY_HAGGLE_PENALTY = 0.1;
const INTIMIDATE_HAGGLE_DISCOUNT = -0.2;
const INTIMIDATE_HAGGLE_PENALTY = 0.25;
const MIN_SESSION_MARKUP_MOD = -0.4;
const MAX_SESSION_MARKUP_MOD = 0.6;
const HAGGLE_ANNOYED_DURATION = 15;
const APPRAISE_RANK_BONUS_LOW = 4;
const APPRAISE_RANK_BONUS_HIGH = 8;
const DIPLOMACY_PASSIVE_DIVISOR = 100;
const DIPLOMACY_PASSIVE_MAX_DISCOUNT = 0.1;

function clampSessionMarkup(val: number): number {
  return Math.max(MIN_SESSION_MARKUP_MOD, Math.min(MAX_SESSION_MARKUP_MOD, Number(val.toFixed(2))));
}

/**
 * Computes D&D 3.5e price modifier adjustments based on NPC attitude, passive Diplomacy goodwill,
 * and buyer Appraise expertise (improving resale value toward PHB 50% fair market price).
 */
export function evaluateDnD35eTradePriceModifier(
  state: GameState,
  context: TradePriceModifierContext
): TradePriceModifierResult {
  const attitudeComp = getComponent(state, context.shopEntityId, ComponentType.Attitude) as
    AttitudeComponent | undefined;
  const attitude: AttitudeTier = attitudeComp?.attitude ?? 'indifferent';
  const attitudeDelta = ATTITUDE_PRICE_DELTAS[attitude];

  const { check: dipCheck } = evaluateActorSkillCheck(state, context.buyerEntityId, 'diplomacy', 0, 'take10');
  const diplomacyDiscount =
    dipCheck.totalModifier > 0
      ? -Math.min(
          DIPLOMACY_PASSIVE_MAX_DISCOUNT,
          (Math.floor(dipCheck.totalModifier / 2) * 2) / DIPLOMACY_PASSIVE_DIVISOR
        )
      : 0;

  const { check: appraiseCheck } = evaluateActorSkillCheck(state, context.buyerEntityId, 'appraise', 0, 'take10');
  let sellBonus = 0;
  if (context.isSellingToShop) {
    if (appraiseCheck.totalModifier >= APPRAISE_RANK_BONUS_HIGH) {
      sellBonus = 0.15;
    } else if (appraiseCheck.totalModifier >= APPRAISE_RANK_BONUS_LOW) {
      sellBonus = 0.08;
    }
  }

  const annotations: string[] = [];
  if (attitude !== 'indifferent' && attitude !== 'neutral') {
    const pct = Math.round(attitudeDelta * 100);
    annotations.push(`Attitude (${attitude}): ${pct >= 0 ? `+${pct}%` : `${pct}%`}`);
  }
  if (diplomacyDiscount < 0) {
    annotations.push(`Diplomacy (+${dipCheck.totalModifier}): ${Math.round(diplomacyDiscount * 100)}%`);
  }
  if (sellBonus > 0) {
    annotations.push(`Appraise (+${appraiseCheck.totalModifier}): +${Math.round(sellBonus * 100)}% resale`);
  }

  return {
    markupDelta: attitudeDelta + diplomacyDiscount,
    ...(sellBonus > 0 ? { sellMultiplierBonus: sellBonus } : {}),
    annotations
  };
}

/**
 * Resolves a D&D 3.5e social haggling skill attempt inside Trade UI (`appraise`, `diplomacy`, `bluff`, `intimidate`).
 */
export function resolveDnD35eTradeSocialSkill(
  state: GameState,
  actorId: EntityId,
  npcId: EntityId,
  skillId: string
): TradeSocialSkillResult | null {
  const npcMemory = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined;
  const currentSessionMod = npcMemory?.sessionMarkupModifier ?? 0;

  switch (skillId) {
    case 'appraise': {
      const { check } = evaluateActorSkillCheck(state, actorId, 'appraise', APPRAISE_TRADE_DC, 'roll');
      let nextState = state;
      if (check.success && npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: clampSessionMarkup(currentSessionMod + APPRAISE_MARKUP_DISCOUNT)
        });
      }
      const message = check.success
        ? `Appraise check succeeded (${check.totalRoll} vs DC ${APPRAISE_TRADE_DC})! You spot fair market margins (-10% markup).`
        : `Appraise check failed (${check.totalRoll} vs DC ${APPRAISE_TRADE_DC}). You cannot leverage a sharper valuation.`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return { state: nextState, success: check.success, rollTotal: check.totalRoll, dc: APPRAISE_TRADE_DC, message };
    }

    case 'diplomacy': {
      const attitudeComp = getComponent(state, npcId, ComponentType.Attitude) as AttitudeComponent | undefined;
      const currentAttitude: AttitudeTier = attitudeComp?.attitude ?? 'indifferent';
      const dc = currentAttitude === 'friendly' || currentAttitude === 'helpful' ? 20 : 15;
      const { check } = evaluateActorSkillCheck(state, actorId, 'diplomacy', dc, 'roll');
      const result = resolveDiplomacyCheck(currentAttitude, check.totalRoll);
      const success = result.changed || result.newAttitude === 'friendly' || result.newAttitude === 'helpful';

      let nextState = addComponent(state, npcId, {
        type: ComponentType.Attitude,
        attitude: result.newAttitude
      });
      if (npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: clampSessionMarkup(
            currentSessionMod + (success ? DIPLOMACY_HAGGLE_DISCOUNT : DIPLOMACY_HAGGLE_PENALTY)
          )
        });
      }
      const message = success
        ? `Diplomacy succeeded (${check.totalRoll} vs DC ${dc})! Merchant attitude: ${result.newAttitude} (-15% markup).`
        : `Diplomacy stalled (${check.totalRoll} vs DC ${dc}). Merchant grows impatient (+10% markup).`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return { state: nextState, success, rollTotal: check.totalRoll, dc, message };
    }

    case 'bluff': {
      const { check: npcSenseCheck } = evaluateActorSkillCheck(state, npcId, 'sense_motive', 0, 'take10');
      const opposedDc = 10 + npcSenseCheck.totalModifier;
      const { check: bluffCheck } = evaluateActorSkillCheck(state, actorId, 'bluff', opposedDc, 'roll');
      let nextState = state;
      if (npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: clampSessionMarkup(
            currentSessionMod + (bluffCheck.success ? BLUFF_TRADE_DISCOUNT : BLUFF_TRADE_PENALTY)
          ),
          ...(bluffCheck.success ? {} : { annoyedDuration: HAGGLE_ANNOYED_DURATION })
        });
      }
      const message = bluffCheck.success
        ? `Bluff succeeded (${bluffCheck.totalRoll} vs Sense Motive ${opposedDc})! You talk the merchant into a -15% discount.`
        : `Bluff failed (${bluffCheck.totalRoll} vs Sense Motive ${opposedDc})! Merchant sees through your pitch (+15% markup).`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return {
        state: nextState,
        success: bluffCheck.success,
        rollTotal: bluffCheck.totalRoll,
        dc: opposedDc,
        message
      };
    }

    case 'intimidate': {
      const { check: intimidateCheck } = evaluateActorSkillCheck(
        state,
        actorId,
        'intimidate',
        DEMORALIZE_BASE_DC,
        'roll'
      );
      const { check: npcSenseCheck, dndData: npcDnd } = evaluateActorSkillCheck(
        state,
        npcId,
        'sense_motive',
        0,
        'take10'
      );
      const npcChassis = aggregateProgressionChassis(npcDnd.tracks, 0);
      const npcWisMod = npcSenseCheck.totalModifier - npcSenseCheck.wholeRanks - npcSenseCheck.synergyBonus;
      const opposeDc = DEMORALIZE_BASE_DC + Math.max(1, npcChassis.totalHD) + npcWisMod;
      const success = resolveDemoralizeCheck(intimidateCheck.totalRoll, Math.max(1, npcChassis.totalHD), npcWisMod);

      let nextState = state;
      if (npcMemory) {
        nextState = addComponent(nextState, npcId, {
          ...npcMemory,
          sessionMarkupModifier: clampSessionMarkup(
            currentSessionMod + (success ? INTIMIDATE_HAGGLE_DISCOUNT : INTIMIDATE_HAGGLE_PENALTY)
          ),
          ...(success ? {} : { annoyedDuration: HAGGLE_ANNOYED_DURATION })
        });
      }
      const message = success
        ? `Intimidate succeeded (${intimidateCheck.totalRoll} vs DC ${opposeDc})! Merchant yields a -20% concession.`
        : `Intimidate failed (${intimidateCheck.totalRoll} vs DC ${opposeDc})! Merchant stiffens rates (+25% markup).`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return { state: nextState, success, rollTotal: intimidateCheck.totalRoll, dc: opposeDc, message };
    }

    default:
      return null;
  }
}

/**
 * Evaluates a `skill_check` dialogue consequence using full D&D 3.5e 4-Stage Stat DAG modifiers.
 */
export function evaluateDnD35eDialogueSkillCheck(
  state: GameState,
  actorId: EntityId,
  npcId: EntityId | undefined,
  skillId: string,
  dc: number
): DialogueSkillCheckResult {
  let effectiveDc = dc;
  if (effectiveDc <= 0 && npcId !== undefined && (skillId === 'bluff' || skillId === 'intimidate')) {
    const { check: npcSenseCheck } = evaluateActorSkillCheck(state, npcId, 'sense_motive', 0, 'take10');
    effectiveDc = 10 + npcSenseCheck.totalModifier;
  }
  const { check } = evaluateActorSkillCheck(state, actorId, skillId, effectiveDc, 'roll');
  const label = skillId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const breakdown = `[${label}: ${check.totalRoll} (d20=${check.naturalRoll} + ${check.totalModifier}) vs DC ${effectiveDc}]`;
  const nextState = addMessage(
    state,
    `${breakdown} — ${check.success ? 'Success!' : 'Failed.'}`,
    MessageLogCategory.System
  );
  return {
    state: nextState,
    success: check.success,
    rollTotal: check.totalRoll,
    dc: effectiveDc,
    margin: check.totalRoll - effectiveDc,
    breakdown
  };
}

/**
 * Returns the actor's static skill modifier for declarative `skill_modifier` dialogue predicates.
 */
export function getDnD35eActorSkillModifier(state: Readonly<GameState>, actorId: EntityId, skillId: string): number {
  return evaluateActorSkillCheck(state as GameState, actorId, skillId, 0, 'take10').check.totalModifier;
}
