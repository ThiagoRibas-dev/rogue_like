import type { ComponentType } from '../components.types.ts';
import type { EntityId } from '../game-state.types.ts';
import type { Intent } from '../intents/intent.union.ts';
import type { PhaseBlock } from '../campaign/social.ts';

/**
 * Component representing the coordinates of an entity on the grid.
 */
export interface PositionComponent {
  readonly type: ComponentType.Position;
  readonly x: number;
  readonly y: number;
}

/**
 * Component representing the visual properties of an entity.
 */
export interface RenderableComponent {
  readonly type: ComponentType.Renderable;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  readonly spriteId?: string;
}

/**
 * Component that makes an entity interactable, holding the list of supported intents.
 */
export interface InteractableComponent {
  readonly type: ComponentType.Interactable;
  readonly intents: ReadonlyArray<Intent>;
}

/**
 * Component representing a hidden trap that triggers when stepped on.
 */
export interface TrapComponent {
  readonly type: ComponentType.Trap;
  readonly triggerId: string;
  readonly triggered: boolean;
}

/**
 * Component holding semantic string tags (e.g., 'undead', 'fire_aligned').
 */
export interface TagsComponent {
  readonly type: ComponentType.Tags;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Component holding mechanical traits (e.g., 'Regeneration', 'Fragile').
 */
export interface TraitsComponent {
  readonly type: ComponentType.Traits;
  readonly traits: ReadonlyArray<string>;
}

/**
 * Component representing a portal to another area.
 */
export interface PortalComponent {
  readonly type: ComponentType.Portal;
  readonly targetAreaId: string;
  readonly targetX?: number | undefined;
  readonly targetY?: number | undefined;
}

/**
 * Component marking an entity that has walked off the edge of the map.
 */
export interface EdgeTransitionComponent {
  readonly type: ComponentType.EdgeTransition;
  readonly targetAreaId: string;
}

/**
 * Component marking an entity as persistent (survives map transitions).
 */
export interface PersistentComponent {
  readonly type: ComponentType.Persistent;
}

/**
 * Stores the original ID of the template from which this entity was spawned.
 */
export interface TemplateComponent {
  readonly type: ComponentType.Template;
  readonly templateId: string;
}

/**
 * Component for tracking access state on doors, chests, and containers.
 */
export interface LockComponent {
  readonly type: ComponentType.Lock;
  readonly difficulty: number;
  readonly keyTag?: string | undefined;
  readonly locked: boolean;
  readonly jammed?: boolean | undefined;
  readonly breakable?: boolean | undefined;
}

/**
 * Represents the state of a single quest.
 */
export interface QuestState {
  readonly questId: string;
  readonly status: 'active' | 'completed' | 'failed';
  readonly objectiveProgress: Record<string, number>;
}

/**
 * Tracks active and completed quests for an entity (usually the player).
 */
export interface QuestLogComponent {
  readonly type: ComponentType.QuestLog;
  readonly quests: Readonly<Record<string, QuestState>>;
  readonly activeTriggers?: Readonly<Record<string, ReadonlyArray<string>>>;
}

/**
 * Represents a single instance of damage, containing amounts, source, and tags.
 */
export interface DamageInstance {
  readonly amount: number;
  readonly sourceEntityId?: EntityId | undefined;
  readonly tags: ReadonlyArray<string>;
}

/**
 * Component holding incoming damage events to be processed by the damage system.
 */
export interface DamageComponent {
  readonly type: ComponentType.Damage;
  readonly instances: ReadonlyArray<DamageInstance>;
}

/**
 * Component marking an entity as dead, to be processed by the death system.
 */
export interface DeathComponent {
  readonly type: ComponentType.Death;
  readonly killerId?: EntityId | undefined;
  readonly causeOfDeath?: string | undefined;
}

/**
 * Component tracking villainous mastermind schemes and their phases.
 */
export interface SchemeComponent {
  readonly type: ComponentType.Scheme;
  readonly recipeId: string;
  readonly currentPhase: number;
  readonly activeMinions: ReadonlyArray<EntityId>;
  readonly phases: ReadonlyArray<PhaseBlock>;
  readonly schemeTargetId?: EntityId | undefined;
  readonly isLeaderless?: boolean | undefined;
  readonly conspiracyAwareness?: number | undefined;
}

/**
 * Component representing an agreement/contract between masterminds and minions.
 */
export interface AgreementComponent {
  readonly type: ComponentType.Agreement;
  readonly mastermindId: EntityId;
  readonly agreementId: string;
  readonly leverageUsed: 'money' | 'ideology' | 'coercion' | 'ego';
  readonly targetAreaId?: string | undefined;
  readonly isFulfilled?: boolean | undefined;
}

/**
 * Component marking an item or entity as a discoverable clue.
 */
export interface ClueComponent {
  readonly type: ComponentType.Clue;
  readonly clueId: string;
  readonly text: string;
  readonly implicatesEntityId: EntityId;
}

/**
 * Component representing a hazard field tile or mobile aura/emanation.
 */
export interface FieldComponent {
  readonly type: ComponentType.Field;
  readonly fieldType: string;
  readonly intensity: number;
  readonly duration: number;
  readonly spreadRuleId?: string | undefined;
  readonly anchorEntityId?: EntityId | undefined;
  readonly radiusFt?: number | undefined;
  readonly sourceEntityId?: EntityId | undefined;
  readonly blocksLoS?: boolean | undefined;
  readonly blocksLoE?: boolean | undefined;
  readonly suppressedTags?: ReadonlyArray<string> | undefined;
  readonly movementCostMultiplier?: number | undefined;
  readonly spellId?: string | undefined;
  readonly castId?: string | undefined;
  readonly casterLevel?: number | undefined;
  /** Per-cast save/SR memory keyed by stringified occupant EntityId ('saved' | 'failed' | 'sr_blocked'). */
  readonly auraSaveMemory?: Readonly<Record<string, 'saved' | 'failed' | 'sr_blocked'>> | undefined;
  /** Optional illumination override descriptor for [Light] and [Darkness] fields. */
  readonly illuminationOverride?:
    | {
        readonly level: 'bright' | 'shadowy' | 'darkness';
        readonly spellLevel: number;
        readonly descriptors?: ReadonlyArray<string> | undefined;
        readonly yieldsToDescriptors?: ReadonlyArray<string> | undefined;
      }
    | undefined;
}

/**
 * Component identifying that an NPC supports dialogue conversations.
 */
export interface DialogueComponent {
  readonly type: ComponentType.Dialogue;
  readonly dialogueId: string;
}

/**
 * Component defining merchant data including inventory, markup, and trade rules.
 */
export interface ShopComponent {
  readonly type: ComponentType.Shop;
  readonly inventory: ReadonlyArray<EntityId>;
  readonly markupMultiplier: number;
  readonly buyTags: ReadonlyArray<string>;
  readonly sellTags: ReadonlyArray<string>;
  readonly supplierHierarchyId?: string | undefined;
}

/**
 * Defines a service that can be purchased from an NPC.
 */
export interface ServiceDefinition {
  readonly serviceId: string;
  readonly name: string;
  readonly cost: number;
  readonly effectId: string;
}

/**
 * Component representing services offered by an NPC.
 */
export interface ServicesComponent {
  readonly type: ComponentType.Services;
  readonly services: ReadonlyArray<ServiceDefinition>;
}

/**
 * Component defining the Director's budget modifier and scaling for an area or mastermind.
 */
export interface DirectorBudgetComponent {
  readonly type: ComponentType.DirectorBudget;
  readonly budgetModifier: number;
}

/**
 * Component storing isolated, JSON-serializable ruleset cartridge state on an entity.
 */
export interface RulesetDataComponent {
  readonly type: ComponentType.RulesetData;
  readonly rulesetId: 'classic' | 'dnd35e';
  readonly payload: Readonly<Record<string, unknown>>;
}
