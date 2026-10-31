/**
 * Domain types and serializable component payloads for the D&D 3.5e ruleset cartridge.
 */

/** The six canonical D&D 3.5e ability score identifiers. */
export type AbilityId = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** Ordered list of all six ability score IDs. */
export const ALL_ABILITY_IDS: ReadonlyArray<AbilityId> = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/**
 * State of a single ability score on an entity.
 * When `base === null`, the ability is a Nonability (`—`), such as `CON: null` on Undead/Constructs.
 */
export interface AbilityScoreState {
  readonly base: number | null;
  readonly inherentBonus: number;
  readonly damage: number;
  readonly drain: number;
  readonly tempPenalty: number;
}

/** Map of all six ability score states for a D&D 3.5e entity. */
export type AbilityScoresRecord = Readonly<Record<AbilityId, AbilityScoreState>>;

/** Collapse state resulting from one or more active ability scores dropping to 0. */
export type AbilityCollapseState = 'normal' | 'unconscious' | 'helpless_paralyzed' | 'dead';

/** Roll context governing whether natural 1 and natural 20 trigger automatic failure/success. */
export type D20RollMode = 'attack' | 'save' | 'skill_check' | 'ability_check' | 'caster_level_check' | 'initiative';

/** Detailed breakdown of a parsed and rolled dice expression (`NdX+C`, `4d6kh3`). */
export interface DiceRollResult {
  readonly expression: string;
  readonly total: number;
  readonly rolls: ReadonlyArray<number>;
  readonly keptRolls: ReadonlyArray<number>;
  readonly flatModifier: number;
}

/** Result of a single d20 roll with natural 1 / 20 evaluation. */
export interface D20RollResult {
  readonly mode: D20RollMode;
  readonly naturalRoll: number;
  readonly modifier: number;
  readonly total: number;
  readonly isAutoSuccess: boolean;
  readonly isAutoFailure: boolean;
}

/** Canonical D&D 3.5e bonus types (including compound enhancement targets). */
export type BonusType =
  | 'alchemical'
  | 'armor'
  | 'armor_enhancement'
  | 'circumstance'
  | 'competence'
  | 'deflection'
  | 'dodge'
  | 'enhancement'
  | 'inherent'
  | 'insight'
  | 'luck'
  | 'morale'
  | 'natural_armor'
  | 'natural_armor_enhancement'
  | 'profane'
  | 'racial'
  | 'resistance'
  | 'sacred'
  | 'shield'
  | 'shield_enhancement'
  | 'size'
  | 'untyped';

/** Source origin tag used for dynamic Antimagic Field suppression. */
export type ModifierSourceOrigin = 'ex' | 'su' | 'sp' | 'spell' | 'magical' | 'mundane';

/** A single typed stat modifier entry evaluated at query time. */
export interface StatModifier {
  readonly targetStat: string;
  readonly value: number;
  readonly bonusType: BonusType;
  readonly sourceId: string;
  readonly origin?: ModifierSourceOrigin;
}

/** Contextual flags passed when resolving typed modifiers or Armor Class. */
export interface StatQueryContext {
  readonly inAntimagicField?: boolean;
  readonly ignoreArmorAndNatural?: boolean;
  readonly ignorePositiveDexAndDodge?: boolean;
  readonly maxDexBonus?: number;
}

/** Itemized Armor Class triplet and breakdown DTO. */
export interface ACBreakdownDTO {
  readonly fullAC: number;
  readonly touchAC: number;
  readonly flatFootedAC: number;
  readonly baseAC: number;
  readonly dexContribution: number;
  readonly sizeContribution: number;
  readonly modifierTotal: number;
}

/** Base Attack Bonus progression curve identifiers. */
export type BabCurveType = 'full' | 'three_quarters' | 'half';

/** Base Saving Throw progression curve identifiers. */
export type SaveCurveType = 'good' | 'poor';

/** The three D&D 3.5e saving throw categories. */
export type SaveType = 'fort' | 'ref' | 'will';

/** A single Hit Die / Class Level track contributing to an entity's chassis. */
export interface HitDieTrack {
  readonly trackId: string;
  readonly levels: number;
  readonly hitDieSides: number;
  readonly babCurve: BabCurveType;
  readonly fortCurve: SaveCurveType;
  readonly refCurve: SaveCurveType;
  readonly willCurve: SaveCurveType;
  readonly skillPointsPerLevel: number;
}

/** Aggregated progression chassis computed across all racial HD and class tracks. */
export interface AggregatedChassis {
  readonly totalHD: number;
  readonly ecl: number;
  readonly xpCurrentFloor: number;
  readonly xpNextLevelThreshold: number;
  readonly totalBab: number;
  readonly iterativeBabSequence: ReadonlyArray<number>;
  readonly baseSaves: Readonly<Record<SaveType, number>>;
  readonly generalFeatSlots: number;
  readonly abilityIncreaseCount: number;
  readonly maxHp: number;
}

/** The 9 canonical D&D 3.5e creature size categories. */
export type CreatureSizeCategory =
  'fine' | 'diminutive' | 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan' | 'colossal';

/** Reach configuration in feet for an entity or weapon. */
export interface ReachProfile {
  readonly minReachFt: number;
  readonly maxReachFt: number;
  readonly hasFlexibleReach?: boolean;
}

/** Cover degrees evaluated by corner-to-corner raycasting. */
export type CoverState = 'none' | 'soft' | 'standard' | 'improved' | 'total';

/** Ambient tile illumination states. */
export type IlluminationLevel = 'bright' | 'shadowy' | 'darkness';

/** Multi-spectrum sensory profile for an observer entity. */
export interface SensoryProfile {
  readonly lowLightVision: boolean;
  readonly darkvisionRangeFt: number;
  readonly blindsenseRangeFt: number;
  readonly blindsightRangeFt: number;
  readonly tremorsenseRangeFt: number;
  readonly scentRangeFt: number;
}

/** 6-second round 5-tier action economy and AoO budget state. */
export interface DnD35ActionBudget {
  readonly standardRemaining: number;
  readonly moveRemaining: number;
  readonly movementRemainingFt: number;
  readonly swiftRemaining: number;
  readonly immediateUsedOffTurn: boolean;
  readonly fiveFootStepAvailable: boolean;
  readonly canMoveFurtherThisRound: boolean;
  readonly distanceMovedThisRoundFt: number;
  readonly aooRemaining: number;
  readonly aooMax: number;
  readonly isFlatFooted: boolean;
  readonly hasCombatReflexes: boolean;
  readonly reactorsThisOpportunity: ReadonlyArray<number>;
  readonly movementAoOReactorsThisRound: ReadonlyArray<number>;
}

/** Damage types supported by the D&D 3.5e damage & resistance pipeline. */
export type DnD35DamageType =
  | 'bludgeoning'
  | 'piercing'
  | 'slashing'
  | 'acid'
  | 'cold'
  | 'electricity'
  | 'fire'
  | 'sonic'
  | 'force'
  | 'positive'
  | 'negative'
  | 'untyped';

/** Damage Reduction rule (`DR X / bypassTag` or `-` unbypassable). */
export interface DamageReductionRule {
  readonly amount: number;
  readonly bypassTags: ReadonlyArray<string>;
  readonly requireAllTags?: boolean;
}

/** Vitality state tracking lethal HP, nonlethal damage, and `-1..-9 / -10` status. */
export type VitalityStatus = 'healthy' | 'staggered' | 'disabled' | 'dying' | 'stable' | 'dead';

/** Canonical D&D 3.5e condition identifiers. */
export type DnD35ConditionId =
  | 'blinded'
  | 'dazzled'
  | 'deafened'
  | 'entangled'
  | 'exhausted'
  | 'fatigued'
  | 'frightened'
  | 'grappled'
  | 'helpless'
  | 'nauseated'
  | 'panicked'
  | 'paralyzed'
  | 'prone'
  | 'shaken'
  | 'sickened'
  | 'staggered'
  | 'stunned'
  | 'unconscious';

/** Capability classification governing Antimagic, SR, AoO, and Concentration rules. */
export type CapabilityClassification = 'spell' | 'ex' | 'sp' | 'su';

/** Serializable D&D 3.5e entity payload stored inside `RulesetDataComponent.data`. */
export interface DnD35EntityData {
  readonly archetypeId: string;
  readonly sizeCategory: CreatureSizeCategory;
  readonly abilityScores: AbilityScoresRecord;
  readonly tracks: ReadonlyArray<HitDieTrack>;
  readonly weaponDice: string;
  readonly weaponDamageType: DnD35DamageType;
  readonly weaponCritThreatMin: number;
  readonly weaponCritMultiplier: number;
  readonly weaponBypassTags: ReadonlyArray<string>;
  readonly armorBonus: number;
  readonly shieldBonus: number;
  readonly naturalArmorBonus: number;
  readonly damageReduction?: DamageReductionRule;
  readonly energyResistance: Readonly<Record<string, number>>;
  readonly immunities: ReadonlyArray<string>;
  readonly vulnerabilities: ReadonlyArray<string>;
  readonly nonlethalDamage: number;
  readonly tempHp: number;
  readonly isStable: boolean;
  readonly conditions: ReadonlyArray<DnD35ConditionId>;
  readonly feats: ReadonlyArray<string>;
  readonly skillRanks: Readonly<Record<string, number>>;
}
