import type { MovementModes } from '../../../types/components.types.ts';
import type {
  AbilityId,
  AbilityScoresRecord,
  ACBreakdownDTO,
  CreatureSizeCategory,
  DnD35AbilityResolution,
  DnD35SaveResolution,
  HitDieTrack,
  SaveType,
  SensoryProfile,
  StatModifier,
  StatResolutionBreakdown
} from './stats.types.ts';

// Re-export all stats and modifier types
export * from './stats.types.ts';

/** Complete resolved state of an actor across the 4-Stage Sub-Stat DAG. */
export interface DnD35ResolvedActorStats {
  readonly effectiveSize: CreatureSizeCategory;
  readonly sizeRankIndex: number;
  readonly sizeWinningSourcePath: string;
  readonly effectiveAbilities: AbilityScoresRecord;
  readonly effectiveAbilityModifiers: Readonly<Record<AbilityId, number>>;
  readonly abilityBreakdowns?: Readonly<Record<AbilityId, DnD35AbilityResolution>> | undefined;
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
  readonly deathHpThreshold?: number | undefined;
  readonly saves: Readonly<Record<SaveType, number>>;
  readonly saveBreakdowns?: Readonly<Record<SaveType, DnD35SaveResolution>> | undefined;
  readonly speed: number;
  readonly fortificationPercent?: number | undefined;
  readonly concealmentMissChancePercent?: number | undefined;
  readonly flankingBonus?: number | undefined;
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
  readonly combatStyle?: 'archery' | 'two_weapon' | undefined;
  readonly favoredEnemyAdded?: string | undefined;
  readonly favoredEnemyBoosted?: string | undefined;
  readonly rogueSpecialAbility?: string | undefined;
  readonly deityFavoredWeaponId?: string | undefined;
  readonly familiarId?: string | undefined;
  readonly animalCompanionId?: string | undefined;
}

/** Kind of spell slot available in D&D 3.5e Grimoires. */
export type DnD35SpellSlotKind = 'general' | 'domain' | 'specialist';

/** Structured prepared spell slot entry for a specific spell level. */
export interface DnD35PreparedSlotEntry {
  readonly slotId: string;
  readonly spellLevel: number;
  readonly slotKind: DnD35SpellSlotKind;
  readonly preparedSpellId?: string | undefined;
  readonly expended: boolean;
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
  readonly preparedSlots?: ReadonlyArray<DnD35PreparedSlotEntry> | undefined;
  readonly spontaneousSlotsUsedByLevel?: Readonly<Record<string, number>> | undefined;
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
  readonly diagonalsMovedThisRound?: number | undefined;
  readonly aooRemaining: number;
  readonly aooMax: number;
  readonly isFlatFooted: boolean;
  readonly hasCombatReflexes: boolean;
  readonly reactorsThisOpportunity: ReadonlyArray<number>;
  readonly movementAoOReactorsThisRound: ReadonlyArray<number>;
  readonly hasActedThisRound?: boolean | undefined;
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
  | 'flat_footed'
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
  readonly grantedTags?: ReadonlyArray<string> | undefined;
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
  readonly spontaneousDomainId?: string | undefined;
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
  readonly deityFavoredWeaponId?: string | undefined;
  readonly familiarId?: string | undefined;
  readonly animalCompanionId?: string | undefined;
  readonly companions?: ReadonlyArray<DnD35CompanionEntry> | undefined;
  readonly rogueSpecialAbilities?: ReadonlyArray<string> | undefined;
  readonly footprint?: { readonly width: number; readonly height: number } | undefined;
  readonly footprintsBySize?:
    Readonly<Record<string, { readonly width: number; readonly height: number } | undefined>> | undefined;
  readonly isCompletelyFillingSpace?: boolean | undefined;
  readonly actionBudget?: DnD35ActionBudget | undefined;
  readonly flankingRelations?: DnD35FlankingRelations | undefined;
  /** Light Blindness acclimation state (`'blinded'` on abrupt entry, `'acclimated'` on turn start). */
  readonly lightExposure?: 'blinded' | 'acclimated' | undefined;
}

/** Relational flanking tracking lists maintained on each combatant entity. */
export interface DnD35FlankingRelations {
  /** Entity IDs that this actor is currently flanking. */
  readonly flankingTargetIds: ReadonlyArray<number>;
  /** Entity IDs that are currently flanking this actor. */
  readonly flankedByEntityIds: ReadonlyArray<number>;
}

/** Bonded companion, familiar, mount, cohort, or hireling registered to an actor. */
export interface DnD35CompanionEntry {
  readonly id: string;
  readonly raceId: string;
  readonly name?: string | undefined;
  readonly tags: ReadonlyArray<string>;
  readonly entityId?: number | undefined;
}
