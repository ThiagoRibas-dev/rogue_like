import { EngineMode, UIMode, type GameState } from '../types/game-state.types.ts';

/**
 * A single frame on the transient modal stack.
 */
interface ModalFrame {
  readonly mode: UIMode;
  readonly cartridgeModalId?: string | undefined;
}

/**
 * Transient LIFO modal stack.
 *
 * Deliberately in memory only: the stack is never serialized into `GameState`, so
 * no save migration is involved. `GameState.uiMode` remains the authoritative
 * rendered mode; the stack only supplies nesting order and pause restoration.
 */
const modalStack: ModalFrame[] = [];

/**
 * Pause state captured when the outermost modal was opened, restored on full close.
 * Undefined means no modal is open.
 */
let baselinePaused: boolean | undefined;

/**
 * Pushes a modal mode onto the stack.
 * @param mode The UIMode being opened.
 * @param cartridgeModalId Optional identifier when opening a cartridge modal.
 */
export function pushModal(mode: UIMode, cartridgeModalId?: string): void {
  modalStack.push({ mode, ...(cartridgeModalId !== undefined ? { cartridgeModalId } : {}) });
}

/**
 * Pops the top modal mode off the stack.
 * @returns The popped UIMode, or undefined when the stack was already empty.
 */
export function popModal(): UIMode | undefined {
  const frame = modalStack.pop();
  return frame?.mode;
}

/**
 * Returns the top modal frame on the stack.
 * @returns ModalFrame or undefined if empty.
 */
export function getCurrentModalFrame(): ModalFrame | undefined {
  return modalStack[modalStack.length - 1];
}

/**
 * Returns the UIMode of the top modal frame.
 * @returns The current modal UIMode, or undefined when no modal is open.
 */
export function getCurrentModal(): UIMode | undefined {
  return getCurrentModalFrame()?.mode;
}

/**
 * Returns the active cartridge modal ID of the top frame, if any.
 */
export function getCurrentCartridgeModalId(): string | undefined {
  return getCurrentModalFrame()?.cartridgeModalId;
}

/**
 * Reports whether any modal is currently open.
 * @returns True when the stack is non-empty.
 */
export function hasModalsOpen(): boolean {
  return modalStack.length > 0;
}

/**
 * Opens a modal if it is not the active one, otherwise closes the top modal.
 *
 * Uses both the rendered `uiMode` and the stack top so a state loaded from disk
 * (where the transient stack is empty) still closes rather than re-opening.
 *
 * @param state The current GameState.
 * @param mode The modal UIMode to toggle.
 * @param cartridgeModalId Optional cartridge modal identifier.
 * @returns The updated GameState.
 */
export function toggleModal(state: GameState, mode: UIMode, cartridgeModalId?: string): GameState {
  const isCartridge = mode === UIMode.CartridgeModal;
  const currentFrame = getCurrentModalFrame();
  const isOpen = isCartridge
    ? (state.uiMode === UIMode.CartridgeModal && state.activeCartridgeModalId === cartridgeModalId) ||
      (currentFrame?.mode === UIMode.CartridgeModal && currentFrame?.cartridgeModalId === cartridgeModalId)
    : state.uiMode === mode || currentFrame?.mode === mode;

  return isOpen ? closeTopModal(state) : openModal(state, mode, cartridgeModalId);
}

/**
 * Clears the transient stack and forgets the pause baseline.
 * Call on new game, save load, and campaign switch so a persisted `uiMode`
 * naming a modal cannot desync from an empty stack.
 */
export function clearModals(): void {
  modalStack.length = 0;
  baselinePaused = undefined;
}

/**
 * Opens a modal: records the pause baseline on first entry and pauses RTwP.
 *
 * @param state The current GameState.
 * @param mode The modal UIMode to open.
 * @param cartridgeModalId Optional cartridge modal identifier.
 * @returns The updated GameState with `uiMode` set and RTwP paused.
 */
export function openModal(state: GameState, mode: UIMode, cartridgeModalId?: string): GameState {
  if (modalStack.length === 0) baselinePaused = state.rtwpState.paused;
  pushModal(mode, cartridgeModalId);

  const paused = state.engineMode === EngineMode.RTwP ? true : state.rtwpState.paused;
  return {
    ...state,
    uiMode: mode,
    ...(cartridgeModalId !== undefined ? { activeCartridgeModalId: cartridgeModalId } : {}),
    rtwpState: { ...state.rtwpState, paused }
  };
}

/**
 * Closes the top modal and, when the stack empties, restores the pause state that
 * existed before the outermost modal was opened. This preserves a manual pause
 * instead of force-resuming the simulation.
 *
 * @param state The current GameState.
 * @returns The updated GameState with `uiMode` and pause state restored.
 */
export function closeTopModal(state: GameState): GameState {
  popModal();

  const nextFrame = getCurrentModalFrame();
  const nextMode = nextFrame?.mode ?? UIMode.Game;
  const nextCartridgeId = nextFrame?.cartridgeModalId;
  let paused = state.rtwpState.paused;

  if (!hasModalsOpen()) {
    const restoredPause = baselinePaused;
    baselinePaused = undefined;
    // If no baseline was ever captured the stack is out of sync with a persisted
    // `uiMode` (e.g. loading a save made while a modal was open). Leaving the pause
    // flag untouched is always safer than force-resuming the simulation.
    if (restoredPause !== undefined && state.engineMode === EngineMode.RTwP) {
      paused = restoredPause;
    }
  }

  const nextState: GameState = {
    ...state,
    uiMode: nextMode,
    rtwpState: { ...state.rtwpState, paused }
  };
  if (nextCartridgeId !== undefined) {
    return { ...nextState, activeCartridgeModalId: nextCartridgeId };
  }
  const { activeCartridgeModalId: _ignored, ...cleanState } = nextState;
  return cleanState as GameState;
}
