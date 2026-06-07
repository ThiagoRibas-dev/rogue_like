import * as ROT from 'rot-js';
import { Direction } from '../utils/direction.ts';

/**
 * Maps ROT.js key constants to directional movement intents.
 * This abstracts raw key codes into game-specific semantic directions.
 */
export const MOVEMENT_KEYS: Readonly<Record<number, Direction>> = {
  // Arrow Keys
  [ROT.KEYS.VK_UP]: Direction.North,
  [ROT.KEYS.VK_DOWN]: Direction.South,
  [ROT.KEYS.VK_LEFT]: Direction.West,
  [ROT.KEYS.VK_RIGHT]: Direction.East,

  // WASD
  [ROT.KEYS.VK_W]: Direction.North,
  [ROT.KEYS.VK_S]: Direction.South,
  [ROT.KEYS.VK_A]: Direction.West,
  [ROT.KEYS.VK_D]: Direction.East,

  // Vi Keys
  [ROT.KEYS.VK_K]: Direction.North,
  [ROT.KEYS.VK_J]: Direction.South,
  [ROT.KEYS.VK_H]: Direction.West,
  [ROT.KEYS.VK_L]: Direction.East,

  // Numpad Orthogonal
  [ROT.KEYS.VK_NUMPAD8]: Direction.North,
  [ROT.KEYS.VK_NUMPAD2]: Direction.South,
  [ROT.KEYS.VK_NUMPAD4]: Direction.West,
  [ROT.KEYS.VK_NUMPAD6]: Direction.East,
};

/**
 * The key used to trigger a "Wait" action.
 */
export const WAIT_KEY = ROT.KEYS.VK_SPACE;

/**
 * Debug/Cheat tools keys (Must be used with Shift modifier).
 */
export const DEBUG_REVEAL_MAP_KEY = ROT.KEYS.VK_R;
export const DEBUG_GOD_MODE_KEY = ROT.KEYS.VK_G;
export const DEBUG_SPAWN_ENTITY_KEY = ROT.KEYS.VK_E;

/**
 * Targeting / Aiming keys.
 */
export const TARGET_TOGGLE_KEY = ROT.KEYS.VK_F;
export const TARGET_CONFIRM_KEY = ROT.KEYS.VK_RETURN;
