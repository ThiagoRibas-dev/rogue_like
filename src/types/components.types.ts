/**
 * Enum defining the types of components available in the Entity-Component-System.
 */
export const enum ComponentType {
  Position = "Position",
  Renderable = "Renderable",
  Player = "Player",
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
 * Discriminated union of all component types in the game.
 */
export type Component = PositionComponent | RenderableComponent | PlayerComponent;
