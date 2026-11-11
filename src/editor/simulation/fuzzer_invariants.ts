import * as ROT from 'rot-js';
import type { FuzzerError } from '../../types/fuzzer.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { getComponent } from '../../core/ecs.ts';

export const MAX_SAVE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
export const SOFTLOCK_TURN_THRESHOLD = 50;
export const BLOAT_CHECK_INTERVAL = 50;

/**
 * Custom error class for infinite or runaway trigger loops in simulation.
 */
export class TriggerRunawayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerRunawayError';
  }
}

/**
 * Checks for softlock where ticks occur without globalTurn advancing.
 */
export function checkFuzzerSoftlock(turns: number, globalTurn: number, seed: string): FuzzerError | null {
  if (turns > SOFTLOCK_TURN_THRESHOLD && globalTurn === 0) {
    return {
      type: 'softlock',
      message: 'Softlock: globalTurn is not advancing despite player inputs/ticks.',
      turn: turns,
      seed
    };
  }
  return null;
}

/**
 * Checks for save-state serialization bloat or serialization errors.
 */
export function checkSaveBloat(
  turns: number,
  state: GameState,
  seed: string,
  lastSaveSize: number
): { readonly error: FuzzerError | null; readonly saveSize: number } {
  if (turns % BLOAT_CHECK_INTERVAL !== 0) {
    return { error: null, saveSize: lastSaveSize };
  }
  try {
    const serialized = JSON.stringify(state);
    const saveSize = serialized.length;
    if (saveSize > MAX_SAVE_SIZE_BYTES) {
      return {
        error: {
          type: 'save_bloat',
          message: `Save bloat: State serialized size reached ${saveSize} bytes.`,
          turn: turns,
          seed
        },
        saveSize
      };
    }
    return { error: null, saveSize };
  } catch (e) {
    return {
      error: {
        type: 'unhandled_exception',
        message: `JSON Serialization failed during bloat check: ${String(e)}`,
        turn: turns,
        seed
      },
      saveSize: lastSaveSize
    };
  }
}

/**
 * Headless player AI generating random movement / actions to drive the narrative.
 */
export function generatePlayerFuzzerIntent(state: GameState, playerEnt: EntityId): Intent {
  const playerPos = getComponent(state, playerEnt, ComponentType.Position);
  if (!playerPos) {
    return { type: IntentType.Wait, entityId: playerEnt };
  }

  // 1. If adjacent to portal/stairs, change area (10% chance to reduce infinite back-and-forth transitions)
  if (ROT.RNG.getUniform() < 0.1) {
    for (const entId of state.entities) {
      const portal = getComponent(state, entId, ComponentType.Portal);
      const pos = getComponent(state, entId, ComponentType.Position);
      if (portal && pos && Math.abs(pos.x - playerPos.x) <= 1 && Math.abs(pos.y - playerPos.y) <= 1) {
        return {
          type: IntentType.ChangeArea,
          entityId: playerEnt,
          targetAreaId: portal.targetAreaId,
          targetX: portal.targetX,
          targetY: portal.targetY
        };
      }
    }
  }

  // 2. Pick up items under the player
  for (const entId of state.entities) {
    const item = getComponent(state, entId, ComponentType.Item);
    const pos = getComponent(state, entId, ComponentType.Position);
    if (item && pos && pos.x === playerPos.x && pos.y === playerPos.y) {
      return {
        type: IntentType.PickUp,
        entityId: playerEnt
      };
    }
  }

  // 3. Attack adjacent enemies
  for (const entId of state.entities) {
    const fighter = getComponent(state, entId, ComponentType.Fighter);
    const pos = getComponent(state, entId, ComponentType.Position);
    const isPlayer = getComponent(state, entId, ComponentType.Player) !== undefined;
    if (fighter && pos && !isPlayer && Math.abs(pos.x - playerPos.x) <= 1 && Math.abs(pos.y - playerPos.y) <= 1) {
      return {
        type: IntentType.MeleeAttack,
        entityId: playerEnt,
        defenderId: entId
      };
    }
  }

  // 4. Random walk to passable neighbor
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ];

  // Shuffle directions using ROT.RNG
  const shuffledDirs = [...directions];
  for (let i = shuffledDirs.length - 1; i > 0; i--) {
    const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
    const temp = shuffledDirs[i]!;
    shuffledDirs[i] = shuffledDirs[j]!;
    shuffledDirs[j] = temp;
  }

  for (const dir of shuffledDirs) {
    const nx = playerPos.x + dir.dx;
    const ny = playerPos.y + dir.dy;

    if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
      const idx = ny * state.map.width + nx;
      const tile = state.map.tiles[idx];
      if (tile && !tile.tileId.includes('wall')) {
        return {
          type: IntentType.Move,
          entityId: playerEnt,
          dx: dir.dx,
          dy: dir.dy
        };
      }
    }
  }

  return { type: IntentType.Wait, entityId: playerEnt };
}
