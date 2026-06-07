/**
 * Enum defining the types of components available in the Entity-Component-System.
 */
export const enum ComponentType {
  Position = 'Position',
  Renderable = 'Renderable',
  Player = 'Player',
  Actor = 'Actor',
  Interactable = 'Interactable',
  GodMode = 'GodMode',
  Fighter = 'Fighter',
  AI = 'AI'
}

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
}

/**
 * Tag component indicating that the entity is the player.
 */
export interface PlayerComponent {
  readonly type: ComponentType.Player;
}

/**
 * Component indicating the entity takes turns in the scheduler.
 */
export interface ActorComponent {
  readonly type: ComponentType.Actor;
  readonly speed: number;
}

/**
 * Component indicating the entity can be interacted with, yielding Intents.
 */
import type { Intent } from './intents.types.ts';

export interface InteractableComponent {
  readonly type: ComponentType.Interactable;
  readonly intents: ReadonlyArray<Intent>;
}

/**
 * Component indicating the entity takes no damage (cheat).
 */
export interface GodModeComponent {
  readonly type: ComponentType.GodMode;
}

/**
 * Component representing the combat stats of an entity.
 */
export interface FighterComponent {
  readonly type: ComponentType.Fighter;
  readonly maxHp: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
}

/**
 * Enum defining the types of AI behavior.
 */
export const enum AIBehavior {
  BasicMelee = 'basic_melee'
}

/**
 * Component representing the AI behavior type of an entity.
 */
export interface AIComponent {
  readonly type: ComponentType.AI;
  readonly behavior: AIBehavior;
  readonly aggroRadius?: number;
  readonly wanders?: boolean;
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
  | AIComponent;
