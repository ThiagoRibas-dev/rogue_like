import type { JSX } from 'preact';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { getActiveCartridgeUI } from '../cartridge_ui_registry.ts';
import { useUiSelector } from '../core/ui_store.ts';

/**
 * Generic Tier 1 Console modal host mounted inside `<AppUiRoot />`.
 * Renders any Preact-enabled `CartridgeModalDescriptor` dynamically without
 * requiring static `<div class="modal-overlay">` blocks in `index.html`.
 */
export function ConsoleModalHost(): JSX.Element | null {
  const gameState = useUiSelector((snap) => snap.gameState);
  const modalsVersion = useUiSelector((snap) => snap.domainVersions[PresentationDomain.Modals]);
  const inventoryVersion = useUiSelector((snap) => snap.domainVersions[PresentationDomain.Inventory]);
  void modalsVersion;
  void inventoryVersion;

  if (!gameState) return null;

  if (gameState.uiMode !== UIMode.CartridgeModal && gameState.uiMode !== UIMode.Inventory) {
    return null;
  }

  const uiDef = getActiveCartridgeUI(gameState);
  if (!uiDef) return null;

  const activeId =
    gameState.uiMode === UIMode.CartridgeModal
      ? gameState.activeCartridgeModalId
      : uiDef.modals['inventory']
        ? 'inventory'
        : 'character_sheet';

  if (!activeId) return null;

  const descriptor = uiDef.modals[activeId];
  if (!descriptor?.renderPreact) return null;

  return <>{descriptor.renderPreact(gameState)}</>;
}
