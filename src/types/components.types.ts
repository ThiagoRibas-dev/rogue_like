import type {
  ActorComponent,
  AIComponent,
  AttitudeComponent,
  ChronicleComponent,
  ControllerLinkComponent,
  FactionComponent,
  FighterComponent,
  GodModeComponent,
  HungerComponent,
  IdentityComponent,
  InteractionScoreComponent,
  LaborProfileComponent,
  MemoryComponent,
  NeedsComponent,
  NemesisComponent,
  PlayerComponent,
  ResourcePoolComponent,
  StatusEffectsComponent,
  TacticalDoctrineComponent
} from './components/actor_components.types.ts';
import type {
  CoatingComponent,
  EquipmentComponent,
  InventoryComponent,
  ItemComponent,
  PropertyOverlayComponent
} from './components/item_components.types.ts';
import type {
  AgreementComponent,
  BreathComponent,
  ClueComponent,
  CorpseComponent,
  CrossingComponent,
  DamageComponent,
  DeathComponent,
  DialogueComponent,
  DirectorBudgetComponent,
  EdgeTransitionComponent,
  FieldComponent,
  IdentityMaskComponent,
  InteractableComponent,
  LightEmitterComponent,
  LockComponent,
  PersistentComponent,
  PortalComponent,
  PositionComponent,
  QuestLogComponent,
  ReligionComponent,
  RenderableComponent,
  RulesetDataComponent,
  SchemeComponent,
  ServicesComponent,
  ShopComponent,
  StructuralComponent,
  TagsComponent,
  TemplateComponent,
  TraitsComponent,
  TrapComponent
} from './components/world_components.types.ts';
export type { InteractionChain, InteractionFrame, InteractionFrameKind } from './interaction_provenance.types.ts';

// Re-export Actor Components & Types (AGENTS.md Rule 8 & 15)
export type {
  PlayerComponent,
  FlightManeuverability,
  MovementModes,
  ActorComponent,
  GodModeComponent,
  FighterComponent,
  AIAlertnessState,
  AIComponent,
  HungerComponent,
  FactionComponent
} from './components/actor_components.types.ts';
export type {
  StatusEffectPolarity,
  ActiveStatusEffect,
  StatusEffectsComponent,
  AttitudeTier,
  AttitudeComponent,
  IdentityComponent,
  Thought,
  KnowledgeItem,
  RumorItem,
  MemoryComponent,
  ChronicleEvent,
  ChronicleComponent,
  NemesisComponent,
  InteractionScoreComponent,
  CompanionStance,
  ControllerLinkComponent,
  ResourceRefreshCycle,
  ResourcePoolEntry,
  ResourcePoolComponent,
  WeaponGripMode,
  ImmediateReactionTrigger,
  ImmediateReactionPolicy,
  StealthStanceState,
  TacticalDoctrineComponent,
  MoodTier,
  InspirationKind,
  MentalBreakKind,
  ActiveInspirationState,
  ActiveMentalBreakState,
  CanonicalNeedId,
  NeedMeterState,
  NeedsComponent,
  ActiveLaborJobState,
  LaborProfileComponent
} from './components/actor_components.types.ts';

// Re-export Item & Equipment Components & Types
export { toItemInstanceId } from './components/item_components.types.ts';
export type {
  ItemInstanceId,
  ItemComponent,
  CoatingComponent,
  InventoryComponent,
  EquipmentSlotInstance,
  EquipmentComponent,
  PropertyOverlayLayer,
  PropertyOverlayComponent
} from './components/item_components.types.ts';

// Re-export World & Narrative Components & Types
export type {
  CardinalFacing,
  PositionComponent,
  RenderableComponent,
  InteractableComponent,
  TrapComponent,
  TagsComponent,
  TraitsComponent,
  PortalComponent,
  EdgeTransitionComponent,
  PersistentComponent,
  TemplateComponent,
  LockComponent,
  QuestState,
  QuestLogComponent,
  DamageInstance,
  DamageComponent,
  DeathComponent,
  SchemeComponent,
  AgreementComponent,
  ClueComponent,
  FieldComponent,
  DialogueComponent,
  ShopComponent,
  ServiceDefinition,
  ServicesComponent,
  DirectorBudgetComponent,
  RulesetDataComponent,
  CrossingKind,
  CrossingComponent,
  BreathComponent,
  LightEmitterComponent,
  StructuralObjectSize,
  StructuralComponent,
  CorpseComponent,
  ReligionComponent,
  IdentityMaskComponent
} from './components/world_components.types.ts';

/**
 * Enum defining the types of components available in the Entity-Component-System.
 */
export const enum ComponentType {
  Position = 'Position',
  Renderable = 'Renderable',
  Coating = 'Coating',
  Player = 'Player',
  Actor = 'Actor',
  Interactable = 'Interactable',
  GodMode = 'GodMode',
  Fighter = 'Fighter',
  AI = 'AI',
  Item = 'Item',
  Inventory = 'Inventory',
  Equipment = 'Equipment',
  StatusEffects = 'StatusEffects',
  Faction = 'Faction',
  Hunger = 'Hunger',
  Trap = 'Trap',
  Tags = 'Tags',
  Traits = 'Traits',
  Portal = 'Portal',
  EdgeTransition = 'EdgeTransition',
  Persistent = 'Persistent',
  Memory = 'Memory',
  QuestLog = 'QuestLog',
  Template = 'Template',
  Damage = 'Damage',
  Death = 'Death',
  Scheme = 'Scheme',
  Agreement = 'Agreement',
  Clue = 'Clue',
  Lock = 'Lock',
  Field = 'Field',
  Dialogue = 'Dialogue',
  Attitude = 'Attitude',
  Identity = 'Identity',
  Chronicle = 'Chronicle',
  Shop = 'Shop',
  Services = 'Services',
  Nemesis = 'Nemesis',
  InteractionScore = 'InteractionScore',
  DirectorBudget = 'DirectorBudget',
  RulesetData = 'RulesetData',
  PropertyOverlay = 'PropertyOverlay',
  ControllerLink = 'ControllerLink',
  ResourcePool = 'ResourcePool',
  TacticalDoctrine = 'TacticalDoctrine',
  Crossing = 'Crossing',
  Breath = 'Breath',
  LightEmitter = 'LightEmitter',
  Structural = 'Structural',
  Corpse = 'Corpse',
  Religion = 'Religion',
  IdentityMask = 'IdentityMask',
  Needs = 'Needs',
  LaborProfile = 'LaborProfile'
}

/**
 * Discriminated union of all component types in the game.
 */
export type Component =
  | PositionComponent
  | RenderableComponent
  | PlayerComponent
  | ActorComponent
  | InteractableComponent
  | GodModeComponent
  | FighterComponent
  | AIComponent
  | ItemComponent
  | InventoryComponent
  | EquipmentComponent
  | StatusEffectsComponent
  | FactionComponent
  | HungerComponent
  | TrapComponent
  | TagsComponent
  | TraitsComponent
  | PortalComponent
  | EdgeTransitionComponent
  | PersistentComponent
  | TemplateComponent
  | MemoryComponent
  | QuestLogComponent
  | DamageComponent
  | DeathComponent
  | SchemeComponent
  | AgreementComponent
  | ClueComponent
  | LockComponent
  | FieldComponent
  | CoatingComponent
  | DialogueComponent
  | AttitudeComponent
  | IdentityComponent
  | ChronicleComponent
  | ShopComponent
  | ServicesComponent
  | NemesisComponent
  | InteractionScoreComponent
  | DirectorBudgetComponent
  | RulesetDataComponent
  | PropertyOverlayComponent
  | ControllerLinkComponent
  | ResourcePoolComponent
  | TacticalDoctrineComponent
  | CrossingComponent
  | BreathComponent
  | LightEmitterComponent
  | StructuralComponent
  | CorpseComponent
  | ReligionComponent
  | IdentityMaskComponent
  | NeedsComponent
  | LaborProfileComponent;
