/**
 * @file Side-mounted command dock specifications and display render-mode hot-swap controller.
 */

import type * as ROT from 'rot-js';
import {
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleFactionsAction,
  createToggleInvestigationAction,
  createToggleLedgerAction,
  createToggleLegendsAction,
  createToggleQuestsAction,
  createToggleSettingsAction,
  createWaitAction
} from '../../actions/core.actions.ts';
import { createToggleInspectAction } from '../../actions/inspect.actions.ts';
import { createPickUpAction, createToggleInventoryAction } from '../../actions/inventory.actions.ts';
import { createToggleTargetingAction } from '../../actions/targeting.actions.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { getSettings, updateSettings } from '../../core/settings.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { configureDisplayForCampaign, syncDisplayLayout, syncFogOverlayCanvas } from '../display.ts';
import { invalidateViewportSnapshot } from '../presenter.ts';
import { isEffectiveSpriteMode } from '../procedural_sprites.ts';

/**
 * Declarative specification for a button in the side command dock.
 */
export interface DockCommandSpec {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly commandId: string;
  readonly fallbackBadge?: string | undefined;
  readonly activeMode?: UIMode | undefined;
  readonly onTrigger: (state: GameState, playerEntityId: EntityId) => void;
}

/** Canonical Console Command Dock buttons bound to `CommandRegistry` IDs. */
export const DOCK_COMMANDS: ReadonlyArray<DockCommandSpec> = [
  {
    id: 'dock-btn-inventory',
    label: 'Pack',
    icon: '🎒',
    commandId: 'panel.inventory',
    fallbackBadge: 'I',
    activeMode: UIMode.Inventory,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInventoryAction(pId))
  },
  {
    id: 'dock-btn-pickup',
    label: 'Get',
    icon: '✋',
    commandId: 'action.pick_up',
    fallbackBadge: 'G',
    onTrigger: (_s, pId) => queuePlayerIntent(createPickUpAction(pId))
  },
  {
    id: 'dock-btn-aim',
    label: 'Aim',
    icon: '🎯',
    commandId: 'action.target_toggle',
    fallbackBadge: 'R',
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleTargetingAction(pId))
  },
  {
    id: 'dock-btn-look',
    label: 'Look',
    icon: '🔍',
    commandId: 'action.inspect',
    fallbackBadge: 'X',
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInspectAction(pId))
  },
  {
    id: 'dock-btn-wait',
    label: 'Wait',
    icon: '⏳',
    commandId: 'move.wait',
    fallbackBadge: 'Space',
    onTrigger: (_s, pId) => queuePlayerIntent(createWaitAction(pId))
  },
  {
    id: 'dock-btn-quests',
    label: 'Quests',
    icon: '📜',
    commandId: 'panel.quests',
    fallbackBadge: 'Q',
    activeMode: UIMode.Quests,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleQuestsAction(pId))
  },
  {
    id: 'dock-btn-factions',
    label: 'Factions',
    icon: '⚑',
    commandId: 'panel.factions',
    fallbackBadge: 'L',
    activeMode: UIMode.Factions,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleFactionsAction(pId))
  },
  {
    id: 'dock-btn-investigation',
    label: 'Board',
    icon: '🕵️',
    commandId: 'panel.investigation',
    fallbackBadge: 'K',
    activeMode: UIMode.Investigation,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInvestigationAction(pId))
  },
  {
    id: 'dock-btn-dossier',
    label: 'Nemesis',
    icon: '💀',
    commandId: 'panel.dossier',
    fallbackBadge: 'N',
    activeMode: UIMode.Dossier,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleDossierAction(pId))
  },
  {
    id: 'dock-btn-ledger',
    label: 'Ledger',
    icon: '📖',
    commandId: 'panel.ledger',
    fallbackBadge: 'Shift+L',
    activeMode: UIMode.Ledger,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleLedgerAction(pId))
  },
  {
    id: 'dock-btn-legends',
    label: 'Legends',
    icon: '🗺️',
    commandId: 'panel.legends',
    fallbackBadge: 'Shift+H',
    activeMode: UIMode.Legends,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleLegendsAction(pId))
  },
  {
    id: 'dock-btn-debug',
    label: 'Debug',
    icon: '⚡',
    commandId: 'panel.debug',
    fallbackBadge: '`',
    activeMode: UIMode.Debug,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleDebugAction(pId))
  },
  {
    id: 'dock-btn-settings',
    label: 'Config',
    icon: '⚙️',
    commandId: 'system.open_settings',
    fallbackBadge: 'Esc',
    activeMode: UIMode.Settings,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleSettingsAction(pId))
  }
];

let activeDisplayRef: ROT.Display | null = null;

/**
 * Registers the active ROT.Display reference so the HUD render-mode toggle can hot-swap between 2D Tiles and ASCII.
 */
export function setHudDockDisplayRef(display: ROT.Display): void {
  activeDisplayRef = display;
}

/**
 * Re-configures the mounted ROT.Display and invalidates viewport snapshots after visual display
 * settings (`renderMode` or `preferredSpritePack`) change at runtime.
 */
export function applyDisplaySettingsUpdate(state: GameState): void {
  if (activeDisplayRef) {
    activeDisplayRef.clear();
    const basePath = `${import.meta.env.BASE_URL}data/campaigns/${state.campaignId}`;
    configureDisplayForCampaign(activeDisplayRef, state.campaign, basePath)
      .then(() => {
        if (!activeDisplayRef) return;
        syncFogOverlayCanvas(state.campaign);
        syncDisplayLayout(activeDisplayRef, state);
        invalidateViewportSnapshot();
        markAllDomainsDirty();
      })
      .catch(console.error);
  } else {
    invalidateViewportSnapshot();
    markAllDomainsDirty();
  }
}

/**
 * Cycles or toggles between 2D Sprite Tiles mode and Classic ASCII mode at runtime.
 */
export function toggleRenderMode(state: GameState): void {
  const currentlySprites = isEffectiveSpriteMode(state.campaign);
  const nextMode = currentlySprites ? 'ascii' : 'sprites';
  const currentSettings = getSettings();

  updateSettings({
    visualFeedback: {
      ...currentSettings.visualFeedback,
      renderMode: nextMode
    }
  });

  applyDisplaySettingsUpdate(state);
}
