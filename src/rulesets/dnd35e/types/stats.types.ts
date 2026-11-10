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
