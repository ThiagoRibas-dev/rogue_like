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

/** Canonical D&D 3.5e bonus types (including compound enhancement targets and DAG sub-stat step types). */
export type BonusType =
  | 'alchemical'
  | 'armor'
  | 'armor_enhancement'
  | 'base'
  | 'circumstance'
  | 'competence'
  | 'deflection'
  | 'dodge'
  | 'enhancement'
  | 'form_override'
  | 'haste'
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
  | 'size_step'
  | 'threat_expansion'
  | 'untyped';

/**
 * Orthogonal lifecycle/UI classification derived from the root segment of `sourcePath`.
 * Does NOT alter D&D 3.5e `BonusType` stacking rules; used for UI breakdown columns
 * and bulk layer suppression (e.g., suppressing `'equipment'` when gear melds into a Wild Shape form).
 */
export type OriginLayer = 'base' | 'racial' | 'progression' | 'form' | 'equipment' | 'temporary' | 'environment';

/** Source origin tag used for dynamic Antimagic Field suppression. */
export type ModifierSourceOrigin = 'ex' | 'su' | 'sp' | 'spell' | 'magical' | 'mundane';

/**
 * Tag-based condition required for a conditional stat modifier to apply.
 */
export interface StatModifierCondition {
  readonly selfTagsAll?: ReadonlyArray<string> | undefined;
  readonly selfTagsAny?: ReadonlyArray<string> | undefined;
  readonly selfTagsNone?: ReadonlyArray<string> | undefined;
  readonly targetTagsAll?: ReadonlyArray<string> | undefined;
  readonly targetTagsAny?: ReadonlyArray<string> | undefined;
  readonly targetTagsNone?: ReadonlyArray<string> | undefined;
  readonly effectTagsAny?: ReadonlyArray<string> | undefined;
}

/**
 * A single typed stat modifier entry evaluated at query time.
 * `sourcePath` records the slash-delimited causal lineage (e.g., `"template:ghost/subtype:incorporeal/deflection_ac"`
 * or `"type:construct/trait:construct_bonus_hp"`) for fast prefix revocation, suppression, and UI breadcrumbs.
 */
export interface StatModifier {
  readonly targetStat: string;
  readonly value: number;
  readonly bonusType: BonusType;
  readonly sourceId: string;
  readonly sourcePath?: string | undefined;
  readonly origin?: ModifierSourceOrigin | undefined;
  /** Optional descriptor tags on the effect itself (e.g. `['force']` on Mage Armor / Shield spells). */
  readonly effectTags?: ReadonlyArray<string> | undefined;
  readonly condition?: StatModifierCondition | undefined;
}

/**
 * Runtime lookup index mapping hierarchical `sourcePath` lineages and target stats
 * to their active `StatModifier` entries.
 */
export interface EffectProvenanceIndex {
  readonly byPathPrefix: Readonly<Record<string, ReadonlyArray<StatModifier>>>;
  readonly byNode: Readonly<Record<string, ReadonlyArray<StatModifier>>>;
  readonly byTargetStat: Readonly<Record<string, ReadonlyArray<StatModifier>>>;
}

/** Contextual flags passed when resolving typed modifiers or Armor Class. */
export interface StatQueryContext {
  readonly inAntimagicField?: boolean | undefined;
  readonly ignoreArmorAndNatural?: boolean | undefined;
  readonly ignorePositiveDexAndDodge?: boolean | undefined;
  /**
   * When true alongside `ignoreArmorAndNatural: true`, armor/shield modifiers carrying
   * `effectTags: ['force']` (such as Mage Armor or Shield) remain active against incorporeal touch attacks.
   */
  readonly againstIncorporealTouch?: boolean | undefined;
  readonly maxDexBonus?: number | undefined;
  readonly selfTags?: ReadonlyArray<string> | undefined;
  readonly targetTags?: ReadonlyArray<string> | undefined;
  readonly effectTags?: ReadonlyArray<string> | undefined;
  /** Optional set of `OriginLayer`s to suppress during evaluation (e.g. melded equipment). */
  readonly suppressedOriginLayers?: ReadonlyArray<OriginLayer> | undefined;
}

/** Reason why a modifier was completely excluded prior to bonus-type competition. */
export type ModifierSuppressionReason =
  'antimagic' | 'tag_condition' | 'touch_attack' | 'flat_footed' | 'origin_suppressed';

/** Record of a modifier that passed filtering but lost same-type bonus competition. */
export interface ShadowedModifierEntry {
  readonly modifier: StatModifier;
  readonly shadowedBySourcePath: string;
}

/** Record of a modifier that was suppressed by context rules before bonus competition. */
export interface SuppressedModifierEntry {
  readonly modifier: StatModifier;
  readonly reason: ModifierSuppressionReason;
}

/** Full diagnostic and UI breakdown of a resolved stat or sub-stat node. */
export interface StatResolutionBreakdown {
  readonly total: number;
  readonly activeModifiers: ReadonlyArray<StatModifier>;
  readonly shadowedModifiers: ReadonlyArray<ShadowedModifierEntry>;
  readonly suppressedModifiers: ReadonlyArray<SuppressedModifierEntry>;
  readonly byOriginLayer: Readonly<Record<OriginLayer, number>>;
}

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
  readonly explicitBab?: number | undefined;
  readonly explicitFort?: number | undefined;
  readonly explicitRef?: number | undefined;
  readonly explicitWill?: number | undefined;
  readonly trackCategory?: 'racial_hd' | 'pc' | 'npc' | 'prestige' | undefined;
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

/** Complete diagnostic and numeric breakdown of a single resolved Ability Score. */
export interface DnD35AbilityResolution {
  readonly abilityId: AbilityId;
  readonly rawState: AbilityScoreState;
  readonly modifierBreakdown: StatResolutionBreakdown;
  readonly effectiveScore: number | null;
  readonly effectiveModifier: number;
}

/** Complete diagnostic and numeric breakdown of a single resolved Saving Throw. */
export interface DnD35SaveResolution {
  readonly saveType: SaveType;
  readonly baseSave: number;
  readonly abilityId: AbilityId;
  readonly abilityModifier: number;
  readonly modifierBreakdown: StatResolutionBreakdown;
  readonly total: number;
}

/** Complete diagnostic and numeric breakdown of a single resolved Skill on an actor. */
export interface DnD35SkillResolution {
  readonly skillId: string;
  readonly rawRanks: number;
  readonly effectiveRanks: number;
  readonly trained: boolean;
  readonly keyAbility: AbilityId;
  readonly keyAbilityModifier: number;
  readonly synergyBonus: number;
  readonly acpApplied: number;
  readonly modifierBreakdown: StatResolutionBreakdown;
  readonly miscModifier: number;
  readonly totalModifier: number;
}
