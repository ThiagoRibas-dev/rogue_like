import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type FighterComponent,
  type RulesetDataComponent,
  type TemplateComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getDnD35Archetype } from '../archetype_resolver.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { getDnD35EntityData } from '../srd_registry.ts';

/** Standard XP unit multiplier for equal-CR encounters (`300 XP` per Effective Character Level at ECL >= 3, or CR * 300 at ECL 1-3). */
const DMG_BASE_XP_PER_ECL = 300;

/** Max CR difference above or below killer ECL before Table 2-6 caps out (trivial <= -8 awards 0 XP). */
const DMG_MAX_LOWER_CR_DELTA = -8;
const DMG_MAX_HIGHER_CR_DELTA = 7;

/** Fractional multiplier table indexed by integer `delta = round(CR) - effectiveColumnEcl`. */
function getCrDeltaMultiplier(delta: number): number {
  if (delta <= DMG_MAX_LOWER_CR_DELTA) return 0;
  const clampedDelta = Math.min(DMG_MAX_HIGHER_CR_DELTA, delta);
  const absDelta = Math.abs(clampedDelta);
  const halfSteps = Math.floor(absDelta / 2);
  const hasOdd = absDelta % 2 === 1;

  if (clampedDelta >= 0) {
    return Math.pow(2, halfSteps) * (hasOdd ? 1.5 : 1);
  }
  const factor = Math.pow(0.5, halfSteps) * (hasOdd ? 2 / 3 : 1);
  return factor;
}

/**
 * Computes D&D 3.5e DMG Table 2-6 XP award for defeating a creature of Challenge Rating `cr`
 * against an adventurer of Effective Character Level `killerEcl`.
 *
 * @param cr Defeated creature's Challenge Rating (supports fractions such as `0.25`, `0.33`, `0.5`, and integer CR `1..25`).
 * @param killerEcl Killer's Effective Character Level (`>= 1`).
 * @returns Integer XP award.
 */
export function computeDnD35eCrXp(cr: number, killerEcl: number): number {
  const safeEcl = Math.max(1, Math.floor(killerEcl));
  const safeCr = Math.max(0.125, cr);

  // DMG Table 2-6 treats ECL 1-3 identically for CR 1-3 (300 * CR) and scales CR >= 4 from column L=3.
  if (safeEcl <= 3) {
    if (safeCr < 1) {
      return Math.max(10, Math.round(DMG_BASE_XP_PER_ECL * safeCr));
    }
    if (safeCr <= 3) {
      return Math.round(DMG_BASE_XP_PER_ECL * safeCr);
    }
    const baseAtCol3 = DMG_BASE_XP_PER_ECL * 3;
    const mult = getCrDeltaMultiplier(Math.round(safeCr) - 3);
    return Math.max(0, Math.round(baseAtCol3 * mult));
  }

  // ECL >= 4: fractional CR < 1 scales down from CR 1 relative to ECL (CR 1 is delta 1 - safeEcl, then multiplied by safeCr).
  if (safeCr < 1) {
    const crOneXp = Math.round(DMG_BASE_XP_PER_ECL * safeEcl * getCrDeltaMultiplier(1 - safeEcl));
    return Math.max(0, Math.round(crOneXp * safeCr));
  }

  const baseAtEcl = DMG_BASE_XP_PER_ECL * safeEcl;
  const delta = Math.round(safeCr) - safeEcl;
  const mult = getCrDeltaMultiplier(delta);
  return Math.max(0, Math.round(baseAtEcl * mult));
}

/**
 * Resolves the effective Challenge Rating of an entity from its RulesetData, Template, Archetype,
 * or hit-die progression.
 */
export function resolveDnD35eEntityCr(state: GameState, entityId: EntityId): number | undefined {
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  const payloadCr = rulesetComp?.payload['cr'];
  if (typeof payloadCr === 'number' && payloadCr > 0) {
    return payloadCr;
  }

  const templateComp = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const template = templateComp ? state.campaign.entities[templateComp.templateId] : undefined;
  const templateRulesetCr = template?.rulesetData?.['cr'];
  if (typeof templateRulesetCr === 'number' && templateRulesetCr > 0) {
    return templateRulesetCr;
  }

  const archetypeKey = template?.archetypeId ?? template?.id;
  if (archetypeKey) {
    const arch = getDnD35Archetype(state.campaign.systemContent, archetypeKey);
    if (arch?.cr !== undefined && arch.cr > 0) {
      return arch.cr;
    }
  }

  return undefined;
}

/**
 * Implements `RulesetContract.resolveKillXpReward` using D&D 3.5e DMG Table 2-6 CR-vs-ECL scaling.
 */
export function resolveDnD35eKillXpReward(
  state: GameState,
  killerId: EntityId | undefined,
  victimId: EntityId
): number {
  const victimFighter = getComponent(state, victimId, ComponentType.Fighter) as FighterComponent | undefined;
  const explicitCr = resolveDnD35eEntityCr(state, victimId);

  // If the victim lacks any archetype/CR metadata, honor its manual fighter.xpGiven field cleanly.
  if (explicitCr === undefined) {
    return Math.max(0, victimFighter?.xpGiven ?? 0);
  }

  let killerEcl = 1;
  if (killerId !== undefined) {
    const killerFighter = getComponent(state, killerId, ComponentType.Fighter) as FighterComponent | undefined;
    const killerDnd = getDnD35EntityData(state, killerId);
    const chassis = aggregateProgressionChassis(killerDnd.tracks, 0, killerDnd.levelAdjustment ?? 0);
    killerEcl = Math.max(1, killerFighter?.level ?? chassis.ecl);
  }

  return computeDnD35eCrXp(explicitCr, killerEcl);
}
