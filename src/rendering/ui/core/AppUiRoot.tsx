import { type JSX, render } from 'preact';
import { HelpReminderChip } from '../hud/HelpReminderChip.tsx';
import { HudRoot } from '../hud/HudRoot.tsx';
import { VerbMenuPopover } from '../hud/VerbMenuPopover.tsx';
import { CampaignSelectModal } from '../menus/CampaignSelectModal.tsx';
import { GameOverModal } from '../menus/GameOverModal.tsx';
import { LoadingOverlay } from '../menus/LoadingOverlay.tsx';
import { MainMenu } from '../menus/MainMenu.tsx';
import { RulesetSelectModal } from '../menus/RulesetSelectModal.tsx';
import { SettingsModal } from '../menus/SettingsModal.tsx';
import { ConsoleModalHost } from '../modals/ConsoleModalHost.tsx';
import { DebugOverlay } from '../modals/DebugOverlay.tsx';
import { DialogueModal } from '../modals/DialogueModal.tsx';
import { FactionsModal } from '../modals/FactionsModal.tsx';
import { HelpModal } from '../modals/HelpModal.tsx';
import { InvestigationModal } from '../modals/InvestigationModal.tsx';
import { LedgerModal } from '../modals/LedgerModal.tsx';
import { NemesisDossierModal } from '../modals/NemesisDossierModal.tsx';
import { QuestsModal } from '../modals/QuestsModal.tsx';
import { TradeModal } from '../modals/TradeModal.tsx';
import { DialogHost } from '../primitives/DialogHost.tsx';
import { ToastHost } from '../primitives/ToastHost.tsx';
import { TooltipHost } from '../primitives/TooltipHost.tsx';

let mountedContainer: HTMLElement | null = null;

/**
 * Root Preact UI shell mounted into `#ui-root` as a sibling of `#game-canvas-wrapper`.
 * Hosts declarative overlays, HUD, menus, modals, dialogs, tooltips, and help without
 * touching the ROT.js canvas DOM container.
 *
 * @returns Root shell anchor element.
 */
export function AppUiRoot(): JSX.Element {
  return (
    <div className="ui-shell-anchor" data-ui-shell="ready">
      <HudRoot />
      <VerbMenuPopover />
      <MainMenu />
      <RulesetSelectModal />
      <CampaignSelectModal />
      <GameOverModal />
      <SettingsModal />
      <TradeModal />
      <DialogueModal />
      <QuestsModal />
      <FactionsModal />
      <InvestigationModal />
      <NemesisDossierModal />
      <LedgerModal />
      <DebugOverlay />
      <ConsoleModalHost />
      <HelpModal />
      <LoadingOverlay />
      <DialogHost />
      <ToastHost />
      <TooltipHost />
      <HelpReminderChip />
    </div>
  );
}

/**
 * Idempotently mounts `<AppUiRoot />` into the provided DOM container.
 *
 * @param container Target mount element (typically `#ui-root`).
 */
export function mountAppUiRoot(container: HTMLElement): void {
  mountedContainer = container;
  render(<AppUiRoot />, container);
}

/**
 * Unmounts the Preact UI root if currently mounted (primarily for tests).
 */
export function unmountAppUiRoot(): void {
  if (mountedContainer) {
    render(null, mountedContainer);
    mountedContainer = null;
  }
}
