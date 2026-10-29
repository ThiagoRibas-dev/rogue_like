import type { GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { saveGame } from './save.ts';
import { saveCurrentReplay } from './replay.ts';

/** Default debounce interval for non-critical game state writes in milliseconds. */
export const DEFAULT_PERSISTENCE_DEBOUNCE_MS = 500;

/**
 * Service managing debounced and transactional persistence for game states,
 * avoiding synchronous disk/storage bottlenecks in tight simulation loops.
 */
class PersistenceService {
  private pendingState: GameState | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly defaultDebounceMs = DEFAULT_PERSISTENCE_DEBOUNCE_MS;

  /**
   * Schedules a debounced save of the GameState. Cancels any previously pending timer.
   * @param state The GameState to save.
   * @param delayMs Optional custom delay in milliseconds.
   */
  scheduleDebouncedSave(state: GameState, delayMs: number = this.defaultDebounceMs): void {
    if (state.isSandbox || state.uiMode !== UIMode.Game) {
      return;
    }
    this.pendingState = state;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout((): void => {
      this.flushPendingSave();
    }, delayMs);
  }

  /**
   * Immediately saves the GameState as a transactional checkpoint (e.g. turn settle, pause, area change).
   * @param state The GameState to checkpoint.
   */
  saveCheckpoint(state: GameState): void {
    if (state.isSandbox) {
      return;
    }
    this.cancelPendingSave();
    saveGame(state);
  }

  /**
   * Flushes any pending debounced save immediately to localStorage.
   */
  flushPendingSave(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingState !== null) {
      const stateToSave = this.pendingState;
      this.pendingState = null;
      saveGame(stateToSave);
    }
  }

  /**
   * Cancels any pending scheduled save without writing.
   */
  cancelPendingSave(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingState = null;
  }

  /**
   * Checkpoints game over and flushes replay buffer.
   * @param state The terminal GameState.
   */
  checkpointGameOver(state: GameState): void {
    this.cancelPendingSave();
    saveCurrentReplay();
    saveGame(state);
  }

  /**
   * Whether a debounced save is currently pending in the timer queue.
   * @returns True if a save is scheduled.
   */
  hasPendingSave(): boolean {
    return this.pendingState !== null;
  }
}

/**
 * Singleton instance of PersistenceService.
 */
export const persistenceService = new PersistenceService();

/**
 * Schedules a debounced save of the game state.
 * @param state The current GameState.
 * @param delayMs Optional debounce delay in ms.
 */
export function scheduleDebouncedSave(state: GameState, delayMs?: number): void {
  persistenceService.scheduleDebouncedSave(state, delayMs);
}

/**
 * Immediately saves the GameState as a transactional checkpoint.
 * @param state The GameState to checkpoint.
 */
export function saveCheckpoint(state: GameState): void {
  persistenceService.saveCheckpoint(state);
}

/**
 * Flushes any pending debounced save immediately to localStorage.
 */
export function flushPendingSave(): void {
  persistenceService.flushPendingSave();
}

/**
 * Cancels any pending scheduled save without writing.
 */
export function cancelPendingSave(): void {
  persistenceService.cancelPendingSave();
}

/**
 * Checkpoints game over and flushes replay buffer.
 * @param state The terminal GameState.
 */
export function checkpointGameOver(state: GameState): void {
  persistenceService.checkpointGameOver(state);
}

/**
 * Checks whether a save is currently pending in the queue.
 * @returns True if a save is queued.
 */
export function hasPendingSave(): boolean {
  return persistenceService.hasPendingSave();
}
