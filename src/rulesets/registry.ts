import type { GameState } from '../types/game-state.types.ts';
import type { RulesetContract, RulesetId } from '../types/ruleset.types.ts';
import { classicRulesetContract } from './classic/classic_ruleset.ts';
import { dnd35eRulesetContract } from './dnd35e/dnd35e_ruleset.ts';

/** Internal map of registered Ruleset Cartridges keyed by RulesetId. */
const rulesetRegistry: Record<RulesetId, RulesetContract> = {
  classic: classicRulesetContract,
  dnd35e: dnd35eRulesetContract
};

/**
 * Registers or overrides a Ruleset Cartridge contract at runtime.
 *
 * @param contract The RulesetContract implementation to register.
 */
export function registerRuleset(contract: RulesetContract): void {
  rulesetRegistry[contract.id] = contract;
}

/**
 * Retrieves the registered RulesetContract for a given RulesetId.
 * Falls back to `classic` if an unknown ID is encountered at runtime.
 *
 * @param rulesetId The identifier of the ruleset cartridge.
 * @returns The matching RulesetContract.
 */
export function getRuleset(rulesetId: RulesetId | undefined): RulesetContract {
  if (!rulesetId) {
    return rulesetRegistry.classic;
  }
  return rulesetRegistry[rulesetId] ?? rulesetRegistry.classic;
}

/**
 * Returns all registered Ruleset Cartridges in canonical display order.
 *
 * @returns ReadonlyArray of registered RulesetContract instances.
 */
export function getAllRulesets(): ReadonlyArray<RulesetContract> {
  return Object.values(rulesetRegistry);
}

/**
 * Resolves the active RulesetContract for the given GameState from its campaign manifest.
 *
 * @param state The active GameState.
 * @returns The active RulesetContract for the loaded campaign.
 */
export function getActiveRuleset(state: GameState): RulesetContract {
  const rulesetId = state.campaign?.manifest?.rulesetId;
  return getRuleset(rulesetId);
}

export {
  applyCharacterCreationToPlayer,
  applyLevelUpToActor,
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  ELITE_ABILITY_ARRAY,
  getSkillMaxRanks,
  type LevelUpChoice,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  POINT_BUY_PRESETS,
  rebuildActorStateFromLevelHistory,
  rollAbilityScores4d6DropLowest,
  STARTING_EQUIPMENT_PACKAGES,
  validateSpecialistSchoolSelection
} from './dnd35e/character_builder.ts';
export { evaluatePrerequisiteAST } from './dnd35e/prerequisites.ts';
export {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  calculateMulticlassXpMultiplier,
  computeEffectiveClassCastingLevel,
  computeXpThresholdForLevel,
  getClassLevelRow
} from './dnd35e/progression.ts';
export { getDnD35EntityData } from './dnd35e/srd_registry.ts';
export { ALL_ABILITY_IDS, type DnD35Alignment, type DnD35SpellSchool } from './dnd35e/types/dnd35e.types.ts';
export { getDnD35SystemContent } from './dnd35e/types/dnd35e_system.types.ts';
