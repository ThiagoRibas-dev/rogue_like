import { addComponent, getComponent } from '../../../core/ecs.ts';
import { rng } from '../../../core/rng.ts';
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
  TradeSocialActionDescriptor,
  TradeSocialSkillResult
} from '../../../types/ruleset.types.ts';
import {
  clampSessionMarkup,
  createDefaultMemoryComponent,
  getTradeSkillHaggleStatus,
  HAGGLE_ANNOYED_DURATION,
  recordTradeHaggleOutcomeFacts
} from '../../../utils/trade.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { resolveDemoralizeCheck, resolveDiplomacyCheck } from '../skills.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import { DEMORALIZE_BASE_DC, evaluateActorSkillCheck, resolveActorWisModFromDAG } from './skill_verb_helpers.ts';

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
const APPRAISE_TRADE_PENALTY = 0.08;
const APPRAISE_FAIL_PENALTY_CHANCE = 0.5;
const APPRAISE_RESALE_BONUS_HIGH = 0.15;
const APPRAISE_RESALE_BONUS_LOW = 0.08;
const BLUFF_TRADE_DISCOUNT = -0.15;
const BLUFF_TRADE_PENALTY = 0.15;
const DIPLOMACY_HAGGLE_DISCOUNT = -0.15;
const DIPLOMACY_HAGGLE_PENALTY = 0.1;
const DIPLOMACY_HAGGLE_DC_HIGH = 20;
const DIPLOMACY_HAGGLE_DC_STANDARD = 15;
const DIPLOMACY_FAIL_ANNOYED_CHANCE = 0.5;
const INTIMIDATE_HAGGLE_DISCOUNT = -0.2;
const INTIMIDATE_HAGGLE_PENALTY = 0.25;
const APPRAISE_RANK_BONUS_LOW = 4;
const APPRAISE_RANK_BONUS_HIGH = 8;
const DIPLOMACY_PASSIVE_DIVISOR = 100;
const DIPLOMACY_PASSIVE_MAX_DISCOUNT = 0.1;
const DIPLOMACY_EVEN_RANK_STEP = 2;
const SENSE_MOTIVE_PASSIVE_BASE = 10;
const PERCENT_MULTIPLIER = 100;

const DND35E_TRADE_SOCIAL_ACTIONS: ReadonlyArray<TradeSocialActionDescriptor> = [
  { label: 'Diplomacy', verb: 'persuade', skillId: 'diplomacy' },
  { label: 'Appraise', verb: 'appraise', skillId: 'appraise' },
  { label: 'Bluff (Haggle)', verb: 'haggle', skillId: 'bluff' },
  { label: 'Intimidate', verb: 'intimidate', skillId: 'intimidate' }
];

/**
 * Returns the canonical declarative list of social bargaining actions for D&D 3.5e Trade UI.
 */
export function getDnD35eTradeSocialActions(): ReadonlyArray<TradeSocialActionDescriptor> {
  return DND35E_TRADE_SOCIAL_ACTIONS;
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
          (Math.floor(dipCheck.totalModifier / DIPLOMACY_EVEN_RANK_STEP) * DIPLOMACY_EVEN_RANK_STEP) /
            DIPLOMACY_PASSIVE_DIVISOR
        )
      : 0;

  const { check: appraiseCheck } = evaluateActorSkillCheck(state, context.buyerEntityId, 'appraise', 0, 'take10');
  let sellBonus = 0;
  if (context.isSellingToShop) {
    if (appraiseCheck.totalModifier >= APPRAISE_RANK_BONUS_HIGH) {
      sellBonus = APPRAISE_RESALE_BONUS_HIGH;
    } else if (appraiseCheck.totalModifier >= APPRAISE_RANK_BONUS_LOW) {
      sellBonus = APPRAISE_RESALE_BONUS_LOW;
    }
  }

  const annotations: string[] = [];
  if (attitude !== 'indifferent' && attitude !== 'neutral') {
    const pct = Math.round(attitudeDelta * PERCENT_MULTIPLIER);
    annotations.push(`Attitude (${attitude}): ${pct >= 0 ? `+${pct}%` : `${pct}%`}`);
  }
  if (diplomacyDiscount < 0) {
    annotations.push(`Diplomacy (+${dipCheck.totalModifier}): ${Math.round(diplomacyDiscount * PERCENT_MULTIPLIER)}%`);
  }
  if (sellBonus > 0) {
    annotations.push(
      `Appraise (+${appraiseCheck.totalModifier}): +${Math.round(sellBonus * PERCENT_MULTIPLIER)}% resale`
    );
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
  const npcMemory: MemoryComponent =
    (getComponent(state, npcId, ComponentType.Memory) as MemoryComponent | undefined) ?? createDefaultMemoryComponent();
  const currentSessionMod = npcMemory.sessionMarkupModifier ?? 0;
  const haggleStatus = getTradeSkillHaggleStatus(npcMemory, skillId);

  if (haggleStatus.locked) {
    const message = `The merchant refuses any further ${skillId} attempts right now.`;
    return {
      state: addMessage(state, message, MessageLogCategory.System),
      success: false,
      rollTotal: 0,
      dc: 0,
      message
    };
  }
  if (!haggleStatus.canAttempt) {
    const message = `You have already pushed ${skillId} bargaining as far as the merchant will allow.`;
    return {
      state: addMessage(state, message, MessageLogCategory.System),
      success: false,
      rollTotal: 0,
      dc: 0,
      message
    };
  }

  switch (skillId) {
    case 'appraise': {
      const { check } = evaluateActorSkillCheck(state, actorId, 'appraise', APPRAISE_TRADE_DC, 'roll');
      const penaltyTriggered = !check.success && rng.getUniform() < APPRAISE_FAIL_PENALTY_CHANCE;
      const markupDelta = check.success ? APPRAISE_MARKUP_DISCOUNT : penaltyTriggered ? APPRAISE_TRADE_PENALTY : 0;
      const updatedMemory: MemoryComponent = {
        ...npcMemory,
        sessionMarkupModifier: clampSessionMarkup(currentSessionMod + markupDelta),
        facts: recordTradeHaggleOutcomeFacts(npcMemory.facts, 'appraise', check.success)
      };
      let nextState = addComponent(state, npcId, updatedMemory);
      const message = check.success
        ? `Appraise check succeeded (${check.totalRoll} vs DC ${APPRAISE_TRADE_DC})! You spot fair market margins (-10% markup).`
        : penaltyTriggered
          ? `Appraise check failed (${check.totalRoll} vs DC ${APPRAISE_TRADE_DC}). Merchant spots your misread (+8% markup) and locks Appraise.`
          : `Appraise check failed (${check.totalRoll} vs DC ${APPRAISE_TRADE_DC}). You cannot leverage a sharper valuation.`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return { state: nextState, success: check.success, rollTotal: check.totalRoll, dc: APPRAISE_TRADE_DC, message };
    }

    case 'diplomacy': {
      const attitudeComp = getComponent(state, npcId, ComponentType.Attitude) as AttitudeComponent | undefined;
      const currentAttitude: AttitudeTier = attitudeComp?.attitude ?? 'indifferent';
      const dc =
        currentAttitude === 'friendly' || currentAttitude === 'helpful'
          ? DIPLOMACY_HAGGLE_DC_HIGH
          : DIPLOMACY_HAGGLE_DC_STANDARD;
      const { check } = evaluateActorSkillCheck(state, actorId, 'diplomacy', dc, 'roll');
      const result = resolveDiplomacyCheck(currentAttitude, check.totalRoll);
      const success = result.changed || result.newAttitude === 'friendly' || result.newAttitude === 'helpful';
      const becameAnnoyed = !success && rng.getUniform() < DIPLOMACY_FAIL_ANNOYED_CHANCE;

      let nextState = addComponent(state, npcId, {
        type: ComponentType.Attitude,
        attitude: result.newAttitude
      });
      nextState = addComponent(nextState, npcId, {
        ...npcMemory,
        sessionMarkupModifier: clampSessionMarkup(
          currentSessionMod + (success ? DIPLOMACY_HAGGLE_DISCOUNT : DIPLOMACY_HAGGLE_PENALTY)
        ),
        facts: recordTradeHaggleOutcomeFacts(npcMemory.facts, 'diplomacy', success),
        ...(becameAnnoyed ? { annoyedDuration: HAGGLE_ANNOYED_DURATION } : {})
      });
      const message = success
        ? `Diplomacy succeeded (${check.totalRoll} vs DC ${dc})! Merchant attitude: ${result.newAttitude} (-15% markup).`
        : `Diplomacy stalled (${check.totalRoll} vs DC ${dc}). Merchant grows impatient (+10% markup).`;
      nextState = addMessage(nextState, message, MessageLogCategory.System);
      return { state: nextState, success, rollTotal: check.totalRoll, dc, message };
    }

    case 'bluff': {
      const { check: npcSenseCheck } = evaluateActorSkillCheck(state, npcId, 'sense_motive', 0, 'take10');
      const opposedDc = SENSE_MOTIVE_PASSIVE_BASE + npcSenseCheck.totalModifier;
      const { check: bluffCheck } = evaluateActorSkillCheck(state, actorId, 'bluff', opposedDc, 'roll');
      let nextState = addComponent(state, npcId, {
        ...npcMemory,
        sessionMarkupModifier: clampSessionMarkup(
          currentSessionMod + (bluffCheck.success ? BLUFF_TRADE_DISCOUNT : BLUFF_TRADE_PENALTY)
        ),
        facts: recordTradeHaggleOutcomeFacts(npcMemory.facts, 'bluff', bluffCheck.success),
        ...(bluffCheck.success ? {} : { annoyedDuration: HAGGLE_ANNOYED_DURATION })
      });
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
      const npcDnd = getDnD35EntityData(state, npcId);
      const npcHd = Math.max(1, npcDnd ? aggregateProgressionChassis(npcDnd.tracks, 0).totalHD : 1);
      const npcWisMod = resolveActorWisModFromDAG(state, npcId);
      const opposeDc = DEMORALIZE_BASE_DC + npcHd + npcWisMod;
      const success = resolveDemoralizeCheck(intimidateCheck.totalRoll, npcHd, npcWisMod);

      let nextState = addComponent(state, npcId, {
        ...npcMemory,
        sessionMarkupModifier: clampSessionMarkup(
          currentSessionMod + (success ? INTIMIDATE_HAGGLE_DISCOUNT : INTIMIDATE_HAGGLE_PENALTY)
        ),
        facts: recordTradeHaggleOutcomeFacts(npcMemory.facts, 'intimidate', success),
        ...(success ? {} : { annoyedDuration: HAGGLE_ANNOYED_DURATION })
      });
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

const OPPOSED_DIALOGUE_SKILL_DC_RESOLVERS: Readonly<Record<string, (state: GameState, npcId: EntityId) => number>> = {
  bluff: (state, npcId) => {
    const { check: npcSenseCheck } = evaluateActorSkillCheck(state, npcId, 'sense_motive', 0, 'take10');
    return SENSE_MOTIVE_PASSIVE_BASE + npcSenseCheck.totalModifier;
  },
  intimidate: (state, npcId) => {
    const npcDnd = getDnD35EntityData(state, npcId);
    const npcHd = Math.max(1, npcDnd ? aggregateProgressionChassis(npcDnd.tracks, 0).totalHD : 1);
    const npcWisMod = resolveActorWisModFromDAG(state, npcId);
    return DEMORALIZE_BASE_DC + npcHd + npcWisMod;
  }
};

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
  const opposedResolver = npcId !== undefined ? OPPOSED_DIALOGUE_SKILL_DC_RESOLVERS[skillId] : undefined;
  const effectiveDc =
    dc <= 0 && opposedResolver !== undefined && npcId !== undefined ? opposedResolver(state, npcId) : dc;
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
