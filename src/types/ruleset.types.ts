import { z } from 'zod';
import type { Verb } from '../constants/verbs.constants.ts';
import type { CampaignData } from './campaign.types.ts';
import type { GameEvent } from './events.types.ts';
import type { EntityId, GameState } from './game-state.types.ts';
import type { MeleeAttackIntent } from './intents/combat.intents.ts';
import type { ApplyIntent, ApplyIntentTarget } from './intents/interaction.intents.ts';

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
}
