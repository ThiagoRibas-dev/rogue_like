import { closeTopModal, openModal, toggleModal as toggleModalBase } from '../../core/modal_manager.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';
import type { UIHotbarModel } from '../../types/ui_adapter.types.ts';

/**
 * Command button contributed by a ruleset cartridge for the HUD Command Dock.
 */
export interface CartridgeDockCommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly modalId: string;
  readonly defaultKey: string;
  readonly isAvailable?: ((state: GameState, playerId: EntityId) => boolean) | undefined;
}

/**
 * Floating alert ribbon contributed by a ruleset cartridge for the HUD Alerts container.
 */
export interface CartridgeHudAlertDescriptor {
  readonly label: string;
  readonly detail: string;
  readonly severity: 'critical' | 'warning' | 'info';
  readonly onClick?: (() => void) | undefined;
}

/**
 * Modal dialog definition contributed by a ruleset cartridge.
 */
export interface CartridgeModalDescriptor {
  readonly modalId: string;
  readonly overlayElementId?: string | undefined;
  readonly allowEscapeClose: boolean;
  readonly render: (state: GameState) => void;
}

/**
 * Domain-Driven UI contract implemented by a ruleset cartridge UI adapter.
 */
export interface CartridgeUIDefinition {
  readonly rulesetId: RulesetId;
  readonly defaultThemeMode?: 'parchment' | 'retro-crt' | undefined;
  readonly onStartNewGame?: ((state: GameState) => GameState) | undefined;
  readonly dockCommands?: ReadonlyArray<CartridgeDockCommandDescriptor> | undefined;
  readonly projectHudAlerts?:
    ((state: GameState, playerId: EntityId) => ReadonlyArray<CartridgeHudAlertDescriptor>) | undefined;
  readonly renderHudPanel?: ((container: HTMLElement, state: GameState, playerId: EntityId) => void) | undefined;
  readonly renderInspectorExtension?:
    ((container: HTMLElement, state: GameState, targetId: EntityId) => boolean) | undefined;
  readonly getHotbarData?: ((state: GameState, playerId: EntityId, activeBank?: number) => UIHotbarModel) | undefined;
  readonly onToggleStance?: ((state: GameState, playerId: EntityId, stanceId: string) => void) | undefined;
  readonly onStepStance?: ((state: GameState, playerId: EntityId, stanceId: string, delta: number) => void) | undefined;
  readonly onExecuteHotbarSlot?:
    ((state: GameState, playerId: EntityId, slotIndex: number, activeBank: number) => void) | undefined;
  readonly modals: Readonly<Record<string, CartridgeModalDescriptor>>;
}

/** Internal registry of cartridge UI adapters keyed by rulesetId. */
const cartridgeUIRegistry: Record<string, CartridgeUIDefinition> = {};

/**
 * Registers a ruleset cartridge UI adapter.
 *
 * @param uiDef The CartridgeUIDefinition to register.
 */
export function registerCartridgeUI(uiDef: CartridgeUIDefinition): void {
  cartridgeUIRegistry[uiDef.rulesetId] = uiDef;
}

/**
 * Retrieves the registered CartridgeUIDefinition for a given RulesetId.
 *
 * @param rulesetId Target ruleset ID.
 * @returns CartridgeUIDefinition or undefined if none registered.
 */
export function getCartridgeUI(rulesetId: RulesetId | undefined): CartridgeUIDefinition | undefined {
  if (!rulesetId) return undefined;
  return cartridgeUIRegistry[rulesetId];
}

/**
 * Resolves the active CartridgeUIDefinition for the loaded campaign ruleset.
 *
 * @param state The current GameState.
 * @returns CartridgeUIDefinition or undefined.
 */
export function getActiveCartridgeUI(state: GameState): CartridgeUIDefinition | undefined {
  const rulesetId = state.campaign?.manifest?.rulesetId;
  return getCartridgeUI(rulesetId);
}

/**
 * Reports whether a specific cartridge modal is currently active.
 *
 * @param state The current GameState.
 * @param modalId Optional modal identifier to check.
 * @returns True when the cartridge modal is active.
 */
export function isCartridgeModalOpen(state: GameState, modalId?: string): boolean {
  if (state.uiMode !== UIMode.CartridgeModal) return false;
  if (modalId === undefined) return true;
  return state.activeCartridgeModalId === modalId;
}

/**
 * Opens a cartridge modal using the Console modal manager.
 *
 * @param state The current GameState.
 * @param modalId Target modal ID.
 * @returns Updated GameState with modal open.
 */
export function openCartridgeModal(state: GameState, modalId: string): GameState {
  return openModal(state, UIMode.CartridgeModal, modalId);
}

/**
 * Closes the active modal using the Console modal manager.
 *
 * @param state The current GameState.
 * @returns Updated GameState.
 */
export function closeCartridgeModal(state: GameState): GameState {
  if (state.uiMode === UIMode.Inventory) {
    return { ...state, uiMode: UIMode.Game };
  }
  return closeTopModal(state);
}

/**
 * Toggles a cartridge modal open or closed.
 *
 * @param state The current GameState.
 * @param modalId Target modal ID.
 * @returns Updated GameState.
 */
export function toggleCartridgeModal(state: GameState, modalId: string): GameState {
  return toggleModalBase(state, UIMode.CartridgeModal, modalId);
}

/**
 * Invokes the active cartridge's new-game initialization hook if provided.
 *
 * @param state The freshly initialized GameState.
 * @returns Processed GameState (e.g. entering character creation).
 */
export function applyCartridgeNewGameHook(state: GameState): GameState {
  const uiDef = getActiveCartridgeUI(state);
  if (uiDef?.onStartNewGame) {
    return uiDef.onStartNewGame(state);
  }
  return state;
}

/**
 * Renders the active cartridge modal dialog if one is open.
 *
 * @param state The current GameState.
 */
export function renderActiveCartridgeModal(state: GameState): void {
  const uiDef = getActiveCartridgeUI(state);
  if (!uiDef) return;

  const activeId =
    state.uiMode === UIMode.CartridgeModal
      ? state.activeCartridgeModalId
      : state.uiMode === UIMode.Inventory
        ? uiDef.modals['inventory']
          ? 'inventory'
          : 'character_sheet'
        : undefined;

  for (const descriptor of Object.values(uiDef.modals)) {
    if (descriptor.overlayElementId) {
      const el = document.getElementById(descriptor.overlayElementId);
      if (el) {
        if (descriptor.modalId === activeId) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    }
  }

  if (activeId && uiDef.modals[activeId]) {
    uiDef.modals[activeId].render(state);
  }
}

/**
 * Renders the active cartridge's HUD panel extension (e.g. Tactical Doctrine Bar) into container.
 *
 * @param container The DOM slot container.
 * @param state The current GameState.
 * @param playerId The player's EntityId.
 */
export function renderCartridgeHudPanel(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const uiDef = getActiveCartridgeUI(state);
  if (uiDef?.renderHudPanel) {
    uiDef.renderHudPanel(container, state, playerId);
  } else {
    container.replaceChildren();
  }
}

/**
 * Extends the entity inspector view with cartridge-specific ruleset breakdown if available.
 *
 * @param container The inspector DOM container.
 * @param state The current GameState.
 * @param targetId The inspected entity ID.
 * @returns True if a cartridge extension was rendered.
 */
export function renderCartridgeInspectorExtension(
  container: HTMLElement,
  state: GameState,
  targetId: EntityId
): boolean {
  const uiDef = getActiveCartridgeUI(state);
  if (uiDef?.renderInspectorExtension) {
    return uiDef.renderInspectorExtension(container, state, targetId);
  }
  return false;
}
