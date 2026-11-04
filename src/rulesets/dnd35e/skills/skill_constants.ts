import type { AbilityId, StatModifier } from '../types/dnd35e.types.ts';

/** Minimum whole ranks required in a source skill to grant a +2 Synergy bonus. */
export const SYNERGY_REQUIRED_RANKS = 5;

/** Untyped bonus granted per qualifying 5-rank skill synergy (`+2`). */
export const SYNERGY_BONUS_AMOUNT = 2;

/** Minimum whole ranks at which epic additional synergy increments begin (`25`). */
export const EPIC_SYNERGY_INITIAL_RANKS = 25;

/** Rank interval for each additional +2 epic synergy bonus above 5 ranks (`20`). */
export const EPIC_SYNERGY_INTERVAL_RANKS = 20;

/** Offset added to Total Hit Dice for maximum class skill ranks (`HD + 3`). */
export const CLASS_SKILL_RANK_CAP_OFFSET = 3;

/** Fixed d20 substitute value when Taking 10. */
export const TAKE_10_VALUE = 10;

/** Fixed d20 substitute value when Taking 20. */
export const TAKE_20_VALUE = 20;

/** Action duration multiplier when Taking 20 (`20x` standard duration). */
export const TAKE_20_DURATION_MULTIPLIER = 20;

/** Deterministic RNG threshold for 50/50 tie-breaking when opposed check totals and modifiers are equal. */
export const OPPOSED_CHECK_TIE_COIN_FLIP_THRESHOLD = 0.5;

/** Diplomacy DC to shift Hostile -> Unfriendly (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_UNFRIENDLY_DC = 20;

/** Diplomacy DC to shift Hostile -> Indifferent (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_INDIFFERENT_DC = 25;

/** Diplomacy DC to shift Hostile -> Friendly (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_FRIENDLY_DC = 35;

/** Diplomacy DC to shift Hostile -> Helpful (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_HELPFUL_DC = 50;

/** Diplomacy DC to shift Unfriendly -> Indifferent (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_INDIFFERENT_DC = 15;

/** Diplomacy DC to shift Unfriendly -> Friendly (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_FRIENDLY_DC = 25;

/** Diplomacy DC to shift Unfriendly -> Helpful (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_HELPFUL_DC = 40;

/** Diplomacy DC to shift Indifferent -> Friendly (PHB p. 72). */
export const DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC = 15;

/** Diplomacy DC to shift Indifferent -> Helpful (PHB p. 72). */
export const DIPLOMACY_INDIFFERENT_TO_HELPFUL_DC = 30;

/** Diplomacy DC to shift Friendly -> Helpful (PHB p. 72). */
export const DIPLOMACY_FRIENDLY_TO_HELPFUL_DC = 20;

/** Base DC offset (`10 + CR/HD`) for Monster Lore Knowledge checks (PHB p. 78). */
export const MONSTER_LORE_BASE_DC = 10;

/** Maximum effective check result for an untrained Knowledge check (PHB p. 78). */
export const MONSTER_LORE_UNTRAINED_MAX_CAP = 10;

/** Margin interval (`5` points above DC) granting an additional piece of Monster Lore info. */
export const MONSTER_LORE_REVEAL_INTERVAL = 5;

/** Standard DC (`15`) for Heal First Aid and Long-Term Care checks (PHB p. 75). */
export const HEAL_SKILL_STANDARD_DC = 15;

/** Base DC (`15 + spellLevel`) to identify a spell being cast with Spellcraft (PHB p. 82). */
export const SPELLCRAFT_IDENTIFY_CASTING_BASE_DC = 15;

/** Base DC (`20 + spellLevel`) to decipher a scroll or identify an active aura with Spellcraft (PHB p. 82). */
export const SPELLCRAFT_DECIPHER_OR_AURA_BASE_DC = 20;

/** Trap Search / Disable Device DC threshold (`20`) above which the Trapfinding feature is required. */
export const TRAPFINDING_REQUIRED_MIN_DC = 20;

/** Failure margin (`-5` or worse) on Disable Device that accidentally springs the trap (PHB p. 72). */
export const DISABLE_DEVICE_MISHAP_MARGIN = -5;

/** Default Simple Lock DC (`20`) for Open Lock checks when no custom difficulty is specified (PHB p. 79). */
export const OPEN_LOCK_DEFAULT_SIMPLE_DC = 20;

/** Use Magic Device DC (`20`) to activate a wand (PHB p. 85). */
export const UMD_ACTIVATE_WAND_DC = 20;

/** Bluff Feint penalty (`-4`) against a creature of a different body morphology / non-humanoid (PHB p. 68). */
export const FEINT_NON_HUMANOID_PENALTY = -4;

/** Bluff Feint penalty (`-8`) against a creature of animal intelligence (Int 1 or 2) (PHB p. 68). */
export const FEINT_ANIMAL_INTELLIGENCE_PENALTY = -8;

/** Declarative definition of a D&D 3.5e skill for check resolution. */
export interface SkillCheckDefinition {
  readonly skillId: string;
  readonly keyAbility: AbilityId;
  readonly trainedOnly: boolean;
  readonly acpMultiplier: 0 | 1 | 2;
  readonly synergyFromSkills: ReadonlyArray<string>;
  readonly take10Allowed?: boolean;
  readonly take20Allowed?: boolean;
}

/** Input parameters for `resolveSkillCheck`. */
export interface SkillCheckParams {
  readonly definition: SkillCheckDefinition;
  readonly rawRanks: number;
  readonly allSkillRanks: Readonly<Record<string, number>>;
  readonly keyAbilityModifier: number;
  readonly armorCheckPenalty: number;
  readonly modifiers?: ReadonlyArray<StatModifier>;
  readonly dc: number;
  readonly takeMode?: 'roll' | 'take10' | 'take20';
  readonly isThreatenedOrDistracted?: boolean;
  readonly carriesPenaltyOnFailure?: boolean;
  readonly forcedNaturalRoll?: number;
}

/** Result of a resolved Skill Check or Ability Check. */
export interface SkillCheckResult {
  readonly allowed: boolean;
  readonly blockedReason?: string;
  readonly naturalRoll: number;
  readonly wholeRanks: number;
  readonly synergyBonus: number;
  readonly acpApplied: number;
  readonly totalModifier: number;
  readonly totalRoll: number;
  readonly dc: number;
  readonly success: boolean;
  readonly durationMultiplier: number;
}
