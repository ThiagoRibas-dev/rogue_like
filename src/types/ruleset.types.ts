import { z } from 'zod';
import type { Verb } from '../constants/verbs.constants.ts';
import type { CampaignData, CurrencyConfig, StatusEffectDefinition } from './campaign.types.ts';
import type { ActiveStatusEffect, MovementModes } from './components.types.ts';
import type { CardinalFacing } from './components/world_components.types.ts';
import type { GameEvent } from './events.types.ts';
import type { EntityId, GameState, TargetingContext } from './game-state.types.ts';
import type { MeleeAttackIntent, UseAbilityIntent } from './intents/combat.intents.ts';
import type { ApplyIntent, ApplyIntentTarget } from './intents/interaction.intents.ts';
import type { Intent } from './intents/intent.union.ts';

/**
 * Describes a campaign verification warning or error containing pathway keys and details.
 */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
  readonly fixSuggestion?: string;
}

/**
 * Detailed report containing lists of errors and warnings.
 */
export interface ValidationReport {
  readonly errors: ReadonlyArray<ValidationError>;
  readonly warnings: ReadonlyArray<ValidationError>;
}

/**
 * Campaign Editor panel rendering mode.
 */
export type ViewPanelType = 'singleton' | 'dictionary' | 'custom';

/**
 * Tab descriptor inside a Campaign Editor ViewGroup.
 */
export interface TabDefinition {
  id: keyof CampaignData | 'simulation' | 'triggerComposer';
  label: string;
  panelType: ViewPanelType;
}

/**
 * Activity-bar group descriptor for the Campaign Editor.
 */
export interface ViewGroup {
  id: string;
  icon: string;
  label: string;
  description?: string;
  tabs: TabDefinition[];
}

/**
 * Canonical Zod schema for supported RPG ruleset cartridge identifiers.
 */
export const RulesetIdSchema = z.enum(['classic', 'dnd35e']);

/**
 * Union type of supported RPG ruleset cartridge identifiers.
 */
export type RulesetId = z.infer<typeof RulesetIdSchema>;

/**
 * The effective combat and movement stats for an entity returned by the active ruleset.
 */
export interface EffectiveStats {
  readonly attack: number;
  readonly defense: number;
  readonly maxHp: number;
  readonly speed: number;
}

/**
 * Ruleset-agnostic spatial footprint, reach, and traversal capabilities for an actor.
 */
export interface ActorSpatialProfile {
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly sizeRankIndex: number;
  readonly naturalReachTiles: number;
  readonly canShareTile: boolean;
  readonly subTileScale: number;
  readonly isHelpless: boolean;
  readonly isIncorporeal: boolean;
  readonly isFlying: boolean;
  readonly isCompletelyFillingSpace: boolean;
}

/** 3-tier passability classification for a map tile under an entity's active movement modes. */
export type TilePassabilityTier = 'unimpeded' | 'difficult' | 'hazardous' | 'solid_obstacle';

/** Canonical displacement modes processed by the Tier 1 spatial displacement kernel. */
export type DisplacementMode = 'voluntary_walk' | 'charge_step' | 'forced_push' | 'forced_pull' | 'teleport' | 'swap';

/** Declarative evaluation of a tile's traversal tier and cost under active movement modes. */
export interface TileTraversalEvaluation {
  readonly passability: TilePassabilityTier;
  readonly moveCostMultiplier: number;
  readonly triggersSolidCollision: boolean;
  readonly blocksCharge: boolean;
  readonly hazardKind?: string | undefined;
}

/** Policy and provenance metadata attached to a spatial displacement step. */
export interface DisplacementContext {
  readonly mode: DisplacementMode;
  readonly isForced: boolean;
  readonly provokesAoO: boolean;
  readonly sourceEntityId?: EntityId | undefined;
  readonly ignoresDifficultTerrainForCharge?: boolean | undefined;
}

/** Result of executing an atomic spatial displacement step or multi-step vector displacement. */
export interface DisplacementResult {
  readonly state: GameState;
  readonly moved: boolean;
  readonly stepsMoved: number;
  readonly finalPos: { readonly x: number; readonly y: number };
  readonly stopReason:
    'completed' | 'solid_obstacle' | 'entity_blocker' | 'hazard_halted' | 'difficult_terrain_blocked' | 'out_of_bounds';
  readonly collidedTileId?: string | undefined;
  readonly collidedEntityId?: EntityId | undefined;
  readonly events: ReadonlyArray<GameEvent>;
}

/**
 * Presentational DTO for a single HUD stat socket pill (e.g., ATK/DEF in classic or BAB/AC in dnd35e).
 */
export interface HudStatSocketDTO {
  readonly label: string;
  readonly value: string;
}

/**
 * Presentational DTO projected by the active ruleset for the left-hand HUD Vitals Plate.
 */
export interface HudVitalsDTO {
  readonly levelLabel: string;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly hpPercent: number;
  readonly xpPercent: number;
  readonly xpText: string;
  readonly primaryStat: HudStatSocketDTO;
  readonly secondaryStat: HudStatSocketDTO;
}

/**
 * Descriptive metadata for a registered Ruleset Cartridge displayed in Ruleset Selection and Editor UIs.
 */
export interface RulesetMetadata {
  readonly id: RulesetId;
  readonly name: string;
  readonly shortLabel: string;
  readonly badgeIcon: string;
  readonly version: string;
  readonly description: string;
  readonly features: ReadonlyArray<string>;
}

/**
 * Descriptor declaring a System Content JSON file loaded from `public/data/rulesets/<rulesetId>/`.
 */
export interface RulesetSystemFileDescriptor {
  readonly key: string;
  readonly filename: string;
}

/**
 * Domain-Driven Contract implemented by every pluggable Ruleset Cartridge (`src/rulesets/<rulesetId>/`).
 */
export interface RulesetContract {
  readonly id: RulesetId;
  readonly metadata: RulesetMetadata;

  /**
   * Computes effective combat and movement statistics for an actor entity.
   * @param state The current GameState.
   * @param entityId The target entity ID.
   * @returns The computed EffectiveStats.
   */
  getEffectiveActorStats(state: GameState, entityId: EntityId): EffectiveStats;

  /**
   * Resolves a melee attack intent according to the ruleset's combat mechanics.
   * @param state The current GameState.
   * @param intent The MeleeAttackIntent to resolve.
   * @returns The updated GameState and whether the action succeeded.
   */
  resolveMeleeAttack(state: GameState, intent: MeleeAttackIntent): { state: GameState; success: boolean };

  /**
   * Processes pending DamageComponent instances across entities according to ruleset mitigation and vitality rules.
   * @param state The current GameState.
   * @returns The updated GameState.
   */
  processDamage(state: GameState): GameState;

  /**
   * Grants experience points to an entity and processes ruleset level-up thresholds.
   * @param state The current GameState.
   * @param entityId The recipient entity ID.
   * @param amount The XP amount to award.
   * @returns The updated GameState.
   */
  grantActorXp(state: GameState, entityId: EntityId, amount: number): GameState;

  /**
   * Projects player vitals and primary/secondary combat stat sockets for the HUD Vitals Plate.
   * @param state The current GameState.
   * @param playerEntityId The player entity ID.
   * @returns The projected HudVitalsDTO, or null if the player lacks combat components.
   */
  projectHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null;

  /**
   * Returns the Campaign Editor activity bar view groups scoped to this ruleset.
   * @param baseGroups The default engine ViewGroups.
   * @returns The ruleset-scoped ViewGroups array.
   */
  getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup>;

  /**
   * Returns the list of declarative System Content files loaded from `public/data/rulesets/<rulesetId>/`.
   * @returns Array of system file descriptors.
   */
  getSystemContentFiles?(): ReadonlyArray<RulesetSystemFileDescriptor>;

  /**
   * Optional hook to parse and validate raw system content records into the ruleset's typed representation.
   * @param raw The raw system content record map loaded from disk/network.
   * @returns The validated and typed system content record map.
   */
  parseSystemContent?(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>>;

  /**
   * Optional ruleset-specific campaign validator hook invoked during deep campaign validation.
   * @param campaign The campaign document being validated.
   * @returns Array of ruleset-specific validation errors or warnings.
   */
  validateCampaignRuleset?(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError>;

  /**
   * Optional hook to resolve ruleset-specific skill/interaction verbs (`search`, `unlock`, `disarm`, `heal`, `persuade`, `intimidate`, `feint`).
   * @param state The current GameState.
   * @param intent The ApplyIntent to resolve.
   * @returns Resolved `{ state, success, events }`, or `null` if the verb is not handled by the ruleset.
   */
  resolveSkillVerb?(
    state: GameState,
    intent: ApplyIntent
  ): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null;

  /**
   * Optional hook returning context-valid ruleset verbs for a given target tile or entity.
   * @param state The current GameState.
   * @param sourceEntityId The acting entity ID.
   * @param target The ApplyIntentTarget.
   * @returns Array of valid Verb identifiers.
   */
  getValidRulesetVerbsForTarget?(
    state: GameState,
    sourceEntityId: EntityId,
    target: ApplyIntentTarget
  ): ReadonlyArray<Verb>;

  /**
   * Optional hook validating whether an actor can activate a wand (e.g. Spell Trigger or Use Magic Device DC 20).
   * @param state The current GameState.
   * @param entityId The acting entity ID.
   * @returns `{ allowed: boolean; state: GameState }`.
   */
  validateWandActivation?(state: GameState, entityId: EntityId): { allowed: boolean; state: GameState };

  /**
   * Optional hook projecting Monster Lore / ruleset inspection lines for an inspected entity.
   * @param state The current GameState.
   * @param targetEntityId The inspected entity ID.
   * @returns Array of `{ value: string; color: string }` description lines.
   */
  projectInspectLoreLines?(
    state: GameState,
    targetEntityId: EntityId
  ): ReadonlyArray<{ readonly value: string; readonly color: string }>;

  /**
   * Optional hook invoked at the start of an actor's turn (after status ticks and Console reaction resets).
   * @param state The current GameState.
   * @param entityId The actor whose turn is starting.
   * @returns Updated GameState.
   */
  onActorTurnStart?(state: GameState, entityId: EntityId): GameState;

  /**
   * Optional hook invoked immediately after an actor completes a single movement step to `(toPos.x, toPos.y)`.
   * @param state The current GameState.
   * @param entityId The moving entity ID.
   * @param fromPos Origin tile coordinate.
   * @param toPos Destination tile coordinate.
   * @param displacementContext Optional Tier 1 displacement policy metadata (forced/teleport/charge/walk).
   * @returns Updated GameState.
   */
  onActorMovementStep?(
    state: GameState,
    entityId: EntityId,
    fromPos: { readonly x: number; readonly y: number },
    toPos: { readonly x: number; readonly y: number },
    displacementContext?: DisplacementContext
  ): GameState;

  /**
   * Optional hook returning the ruleset-specific `MovementModes` profile for an entity.
   * @param state The current GameState.
   * @param entityId The actor entity ID.
   */
  getEntityMovementModes?(state: GameState, entityId: EntityId): MovementModes | undefined;

  /**
   * Optional hook checking whether an AI actor can and should execute an explicit Charge action against `defenderId`.
   * @param state The current GameState.
   * @param attackerId The charging actor entity ID.
   * @param defenderId The hostile target entity ID.
   */
  evaluateCombatChargeIntent?(state: GameState, attackerId: EntityId, defenderId: EntityId): boolean;

  /**
   * Optional hook resolving ruleset-specific action budget consumption and turn energy cost (`0` if turn continues, `> 0` if turn ends).
   * @param state The current GameState (after intent execution).
   * @param intent The intent being applied.
   * @param baseEnergyCost The baseline energy cost computed by Console.
   * @param preActionState Optional GameState snapshot captured before the intent handler executed.
   * @returns Updated GameState and effective energy cost.
   */
  resolveActionEnergyCost?(
    state: GameState,
    intent: Intent,
    baseEnergyCost: number,
    preActionState?: GameState
  ): { readonly state: GameState; readonly energyCost: number };

  /**
   * Optional hook checking whether an actor currently has sufficient intra-turn action resources
   * to execute a candidate Intent during their active turn.
   * @param state The current GameState.
   * @param intent Candidate Intent to check.
   * @returns True if the actor can currently perform the intent.
   */
  canActorPerformIntent?(state: GameState, intent: Intent): boolean;

  /**
   * Optional hook returning true if the actor has already expended any movement or action
   * resources during their current turn.
   * @param state The current GameState.
   * @param entityId The acting entity ID.
   * @returns True if the actor has already acted or moved this turn.
   */
  hasActorActedThisTurn?(state: GameState, entityId: EntityId): boolean;

  /**
   * Optional hook returning true if the actor is mid-way through a multi-step movement pool
   * that still has remaining movement distance in their active turn.
   * @param state The current GameState.
   * @param entityId The acting entity ID.
   * @returns True if the actor still has an active in-progress move pool.
   */
  hasActorMovementInProgress?(state: GameState, entityId: EntityId): boolean;

  /**
   * Optional hook resolving an aimed targeting action (e.g. spell cast or targeted ability) confirmed at `targetPos`.
   * @param state The current GameState (with targetingMode already cleared).
   * @param actorId The acting entity ID.
   * @param targetPos The confirmed world tile coordinates.
   * @param context The active TargetingContext metadata.
   * @returns Updated GameState and whether the aimed action succeeded/consumed an action.
   */
  resolveAimedAction?(
    state: GameState,
    actorId: EntityId,
    targetPos: { readonly x: number; readonly y: number },
    context: TargetingContext
  ): { readonly state: GameState; readonly success: boolean };

  /**
   * Optional hook resolving a ruleset-specific `UseAbilityIntent` (e.g., class or domain resource-pool abilities).
   * Returns `null` if the intent is not handled by the ruleset.
   *
   * @param state The current GameState.
   * @param intent The UseAbilityIntent to resolve.
   * @returns `{ state, success }` or `null`.
   */
  resolveUseAbility?(
    state: GameState,
    intent: UseAbilityIntent
  ): { readonly state: GameState; readonly success: boolean } | null;

  /**
   * Optional hook returning ruleset-resolved spatial footprint, reach, size rank, and traversal flags.
   *
   * @param state The current GameState.
   * @param entityId The actor entity ID.
   * @param facing Optional movement facing used to orient non-square footprints.
   */
  resolveActorSpatialProfile?(state: GameState, entityId: EntityId, facing?: CardinalFacing): ActorSpatialProfile;

  /**
   * Optional hook synchronizing an entity's PositionComponent footprint and spatial index after spawn or size change.
   *
   * @param state The current GameState.
   * @param entityId The entity ID to synchronize.
   */
  syncActorSpatialFootprint?(state: GameState, entityId: EntityId): GameState;

  /**
   * Optional hook invoked whenever one or more full game hours elapse on the world clock
   * (e.g., hourly nonlethal natural healing).
   *
   * @param state The current GameState.
   * @param hoursElapsed Positive integer count of hours crossed.
   * @returns Updated GameState.
   */
  onWorldHourElapsed?(state: GameState, hoursElapsed: number): GameState;

  /**
   * Optional hook returning the number of hands/limbs required to wield/equip an item (and optional block reason if unwieldable).
   */
  resolveItemHandRequirement?(
    state: GameState,
    entityId: EntityId,
    itemEntityId: EntityId
  ): { readonly requiredHands: number; readonly blockedReason?: string };

  /**
   * Optional hook returning the ruleset's canonical multi-denomination currency configuration
   * when a campaign's `rules.json` does not supply an explicit override.
   */
  getDefaultCurrencyConfig?(): CurrencyConfig;

  /**
   * Optional hook allowing a ruleset cartridge to adjust shop buy/sell pricing
   * (e.g. Appraise accuracy, Charisma/Diplomacy discounts, Alignment/Guild bias).
   */
  evaluateTradePriceModifier?(state: GameState, context: TradePriceModifierContext): TradePriceModifierResult | null;

  /**
   * Optional hook declaring the social haggling actions exposed in the Trade UI for this ruleset.
   */
  getTradeSocialActions?(): ReadonlyArray<TradeSocialActionDescriptor>;

  /**
   * Optional hook resolving a cartridge-specific social haggle skill check during trade
   * (`appraise`, `diplomacy`, `bluff`, `intimidate`).
   */
  resolveTradeSocialSkill?(
    state: GameState,
    actorId: EntityId,
    npcId: EntityId,
    skillId: string
  ): TradeSocialSkillResult | null;

  /**
   * Optional hook evaluating a skill check triggered inside branching dialogue nodes (`skill_check`).
   */
  evaluateDialogueSkillCheck?(
    state: GameState,
    actorId: EntityId,
    npcId: EntityId | undefined,
    skillId: string,
    dc: number
  ): DialogueSkillCheckResult;

  /**
   * Optional hook returning an actor's static skill modifier for declarative `skill_modifier` predicates.
   */
  getActorSkillModifier?(state: Readonly<GameState>, actorId: EntityId, skillId: string): number;

  /**
   * Optional hook invoked at the end of `spawnEntity` to hydrate ruleset components,
   * combat HP/BAB/level, and spatial footprints from templates and archetypes.
   */
  onEntitySpawned?(state: GameState, entityId: EntityId): GameState;

  /**
   * Optional hook computing kill XP reward according to ruleset laws (e.g. DMG Table 2-6 CR vs ECL).
   */
  resolveKillXpReward?(state: Readonly<GameState>, killerId: EntityId, victimId: EntityId): number;

  /**
   * Optional hook invoked when a party or camp is surprised during an ambush (e.g., applying `'flat_footed'`).
   */
  onAmbushSurprise?(state: GameState, surprisedEntityIds: ReadonlyArray<EntityId>): GameState;

  /**
   * Optional hook resolving a secondary saving throw stage on an active multi-stage status effect (e.g., 10-turn poison secondary damage).
   */
  resolveStatusSecondaryStage?(
    state: GameState,
    entityId: EntityId,
    activeEffect: ActiveStatusEffect,
    statusDef: StatusEffectDefinition
  ): { readonly state: GameState; readonly resisted: boolean };

  /**
   * Optional hook checking whether an actor is exempt from underwater breath depletion / drowning
   * (e.g., `trait:water_breathing`, `type:undead`, `type:construct`, or nonability CON).
   */
  isActorImmuneToDrowning?(state: Readonly<GameState>, entityId: EntityId): boolean;

  /**
   * Optional hook computing an actor's maximum breath-holding capacity in rounds (e.g., `2 * CON` in D&D 3.5e).
   */
  getActorMaxBreathTurns?(state: Readonly<GameState>, entityId: EntityId): number;

  /**
   * Optional hook invoked when a world-owned crossing entity beneath an occupant is cut, destroyed, or melted,
   * dropping the non-flying occupant into the underlying hazard tile (`x, y`).
   */
  onCrossingCollapsedForOccupant?(state: GameState, occupantId: EntityId, x: number, y: number): GameState;

  /**
   * Optional hook invoked when a non-player entity dies at `(x, y)` before removal (e.g., spawning an arcane caster's spellbook).
   */
  onEntityDied?(state: GameState, victimId: EntityId, x: number, y: number, killerId?: EntityId): GameState;
}

/** Context passed to `RulesetContract.evaluateTradePriceModifier`. */
export interface TradePriceModifierContext {
  readonly shopEntityId: EntityId;
  readonly buyerEntityId: EntityId;
  readonly isSellingToShop: boolean;
}

/** Price multiplier adjustments contributed by the active ruleset cartridge. */
export interface TradePriceModifierResult {
  readonly markupDelta: number;
  readonly sellMultiplierBonus?: number | undefined;
  readonly annotations?: ReadonlyArray<string> | undefined;
}

/** Declarative button descriptor for a ruleset-supported trade haggle verb in the Trade UI. */
export interface TradeSocialActionDescriptor {
  readonly verb: 'persuade' | 'appraise' | 'haggle' | 'intimidate';
  readonly skillId: string;
  readonly label: string;
}

/** Outcome of a ruleset-driven social skill attempt inside a trade session. */
export interface TradeSocialSkillResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly rollTotal: number;
  readonly dc: number;
  readonly message: string;
}

/** Outcome of a ruleset-driven `skill_check` consequence inside dialogue. */
export interface DialogueSkillCheckResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly rollTotal: number;
  readonly dc: number;
  readonly margin: number;
  readonly breakdown: string;
}
