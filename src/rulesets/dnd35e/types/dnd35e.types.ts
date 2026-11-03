import type { MovementModes } from '../../../types/components.types.ts';

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

/** Complete resolved state of an actor across the 4-Stage Sub-Stat DAG. */
export interface DnD35ResolvedActorStats {
  readonly effectiveSize: CreatureSizeCategory;
  readonly sizeRankIndex: number;
  readonly sizeWinningSourcePath: string;
  readonly effectiveAbilities: AbilityScoresRecord;
  readonly effectiveAbilityModifiers: Readonly<Record<AbilityId, number>>;
  readonly naturalArmorBreakdown: StatResolutionBreakdown;
  readonly wornArmorBreakdown: StatResolutionBreakdown;
  readonly wornShieldBreakdown: StatResolutionBreakdown;
  readonly acBreakdown: ACBreakdownDTO;
  readonly acResolution: StatResolutionBreakdown;
  readonly touchAcResolution: StatResolutionBreakdown;
  readonly flatFootedAcResolution: StatResolutionBreakdown;
  readonly attackBonus: number;
  readonly damageBonus: number;
  readonly maxHp: number;
  readonly saves: Readonly<Record<SaveType, number>>;
  readonly speed: number;
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

/**
 * Chronological ledger entry for a single Character Level (1..20) on an actor.
 * Enables exact multiclass interleaving, retroactive CON HP recalculation, and O(1) permanent level drain rollback.
 */
export interface DnD35CharacterLevelRecord {
  readonly characterLevel: number;
  readonly classId: string;
  readonly classLevel: number;
  readonly hpRolled: number;
  readonly abilityScoreIncrease?: AbilityId | undefined;
  readonly addedSkillRanks: Readonly<Record<string, number>>;
  readonly selectedFeats: ReadonlyArray<string>;
  readonly selectedAcfs: ReadonlyArray<string>;
  readonly learnedSpells: ReadonlyArray<string>;
  readonly advancedSpellcastingClassIds?: ReadonlyArray<string> | undefined;
  readonly learnedSpellsByClass?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
}

/** Per-class isolated spellbook / spellcasting state for multiclass casters. */
export interface DnD35ClassSpellbookState {
  readonly classId: string;
  readonly castingMode: 'prepared' | 'spontaneous';
  readonly castingTradition: 'arcane' | 'divine';
  readonly spellAcquisitionMode: 'spellbook_scribed' | 'spontaneous_known' | 'prayerbook_full_list';
  readonly governingAbility: AbilityId;
  readonly effectiveCasterLevel: number;
  readonly maxCastableSpellLevel: number;
  readonly knownSpellIds: ReadonlyArray<string>;
  readonly preparedSpellIds: ReadonlyArray<string>;
  readonly spellsPerDay: Readonly<Record<string, number>>;
  readonly domainSpellSlots?: Readonly<Record<string, number>> | undefined;
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
  readonly requireAllTags?: boolean | undefined;
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

/**
 * On-hit poison, disease, or curse rider attached to a natural or manufactured attack.
 */
export interface OnHitRiderDescriptor {
  readonly riderId: string;
  readonly type: 'poison' | 'disease' | 'energy_drain' | 'curse' | 'paralysis';
  readonly delivery: 'injury' | 'contact';
  readonly saveType: SaveType;
  readonly dc: number;
  readonly initialEffectDescription: string;
  readonly secondaryEffectDescription?: string | undefined;
  readonly secondaryDelayRounds?: number | undefined;
}

/**
 * Natural weapon attack configuration (claws, bites, gores, slams, stingers, tentacles).
 */
export interface NaturalWeaponDescriptor {
  readonly id: string;
  readonly name: string;
  readonly naturalType:
    'bite' | 'claw' | 'gore' | 'slam' | 'sting' | 'tentacle' | 'talon' | 'tail_slap' | 'wings' | 'crush' | 'tail_sweep';
  readonly isPrimary: boolean;
  readonly count: number;
  readonly damageDice: string;
  readonly damageType: DnD35DamageType;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
  readonly reachFt?: number | undefined;
  readonly riders?: ReadonlyArray<OnHitRiderDescriptor> | undefined;
}

/** The nine canonical D&D 3.5e alignment codes. */
export type DnD35Alignment = 'LG' | 'NG' | 'CG' | 'LN' | 'N' | 'CN' | 'LE' | 'NE' | 'CE';

/** The eight canonical D&D 3.5e arcane schools plus universal. */
export type DnD35SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation'
  | 'universal';

/** Serializable D&D 3.5e entity payload stored inside `RulesetDataComponent.payload`. */
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
  readonly damageReduction?: DamageReductionRule | undefined;
  readonly energyResistance: Readonly<Record<string, number>>;
  readonly immunities: ReadonlyArray<string>;
  readonly vulnerabilities: ReadonlyArray<string>;
  readonly nonlethalDamage: number;
  readonly tempHp: number;
  readonly isStable: boolean;
  readonly conditions: ReadonlyArray<DnD35ConditionId>;
  readonly feats: ReadonlyArray<string>;
  readonly skillRanks: Readonly<Record<string, number>>;
  readonly creatureType?: string | undefined;
  readonly subtypes?: ReadonlyArray<string> | undefined;
  readonly levelAdjustment?: number | undefined;
  readonly spellResistance?: number | undefined;
  readonly senses?: SensoryProfile | undefined;
  readonly movementModes?: MovementModes | undefined;
  readonly naturalWeapons?: ReadonlyArray<NaturalWeaponDescriptor> | undefined;
  readonly hasPounce?: boolean | undefined;
  readonly singleActionsOnly?: boolean | undefined;
  readonly statModifiers?: ReadonlyArray<StatModifier> | undefined;
  readonly anatomyBodyPlan?: 'humanoid_biped' | 'quadruped' | 'marilith_6arm' | 'avian' | 'serpentine' | undefined;
  readonly raceId?: string | undefined;
  readonly alignment?: DnD35Alignment | undefined;
  readonly favoredClass?: string | undefined;
  readonly selectedAcfs?: ReadonlyArray<string> | undefined;
  readonly domains?: ReadonlyArray<string> | undefined;
  readonly arcaneSchool?: DnD35SpellSchool | undefined;
  readonly prohibitedSchools?: ReadonlyArray<DnD35SpellSchool> | undefined;
  readonly favoredEnemies?: ReadonlyArray<{ readonly creatureType: string; readonly bonus: number }> | undefined;
  readonly combatStyle?: 'archery' | 'two_weapon' | undefined;
  readonly knownSpells?: ReadonlyArray<string> | undefined;
  readonly preparedSpells?: ReadonlyArray<string> | undefined;
  readonly spellbooksByClass?: Readonly<Record<string, DnD35ClassSpellbookState>> | undefined;
  readonly scalingPools?: Readonly<Record<string, number>> | undefined;
  readonly activeClassFeatures?: ReadonlyArray<string> | undefined;
  readonly spentLiteracySkillPoints?: boolean | undefined;
  readonly enforceMulticlassXpPenalty?: boolean | undefined;
  readonly levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord> | undefined;
  readonly negativeLevels?: number | undefined;
  readonly suppressedBundleIds?: ReadonlyArray<string> | undefined;
}
