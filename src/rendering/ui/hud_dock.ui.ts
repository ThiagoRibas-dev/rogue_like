/**
 * @file Side-mounted clickable command dock with live hotkey badges derived from `getSettings().keybinds`,
 * 2D Tiles vs. ASCII runtime toggle, and foldable side-panel controls.
 */

import * as ROT from 'rot-js';
import {
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleFactionsAction,
  createToggleInvestigationAction,
  createToggleLedgerAction,
  createToggleQuestsAction,
  createToggleSettingsAction,
  createWaitAction
} from '../../actions/core.actions.ts';
import { createToggleInspectAction } from '../../actions/inspect.actions.ts';
import { createPickUpAction, createToggleInventoryAction } from '../../actions/inventory.actions.ts';
import { createToggleTargetingAction } from '../../actions/targeting.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty, markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { getSettings, updateSettings, type ActionType } from '../../core/settings.ts';
import { ComponentType } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { configureDisplayForCampaign, syncDisplayLayout, syncFogOverlayCanvas } from '../display.ts';
import { invalidateViewportSnapshot } from '../presenter.ts';
import { isEffectiveSpriteMode } from '../procedural_sprites.ts';

/**
 * Declarative specification for a button in the side command dock.
 */
interface DockCommandSpec {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly actionKey?: ActionType | undefined;
  readonly fallbackBadge?: string | undefined;
  readonly activeMode?: UIMode | undefined;
  readonly onTrigger: (state: GameState, playerEntityId: EntityId) => void;
}

const DOCK_COMMANDS: ReadonlyArray<DockCommandSpec> = [
  {
    id: 'dock-btn-inventory',
    label: 'Pack',
    icon: '🎒',
    actionKey: 'inventory',
    activeMode: UIMode.Inventory,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInventoryAction(pId))
  },
  {
    id: 'dock-btn-pickup',
    label: 'Get',
    icon: '✋',
    actionKey: 'pick_up',
    onTrigger: (_s, pId) => queuePlayerIntent(createPickUpAction(pId))
  },
  {
    id: 'dock-btn-aim',
    label: 'Aim',
    icon: '🎯',
    actionKey: 'target_toggle',
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleTargetingAction(pId))
  },
  {
    id: 'dock-btn-look',
    label: 'Look',
    icon: '🔍',
    actionKey: 'inspect',
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInspectAction(pId))
  },
  {
    id: 'dock-btn-wait',
    label: 'Wait',
    icon: '⏳',
    actionKey: 'wait',
    fallbackBadge: 'SPC',
    onTrigger: (_s, pId) => queuePlayerIntent(createWaitAction(pId))
  },
  {
    id: 'dock-btn-quests',
    label: 'Quests',
    icon: '📜',
    actionKey: 'quests',
    activeMode: UIMode.Quests,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleQuestsAction(pId))
  },
  {
    id: 'dock-btn-factions',
    label: 'Factions',
    icon: '⚑',
    actionKey: 'factions',
    activeMode: UIMode.Factions,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleFactionsAction(pId))
  },
  {
    id: 'dock-btn-investigation',
    label: 'Board',
    icon: '🕵️',
    actionKey: 'investigation',
    activeMode: UIMode.Investigation,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleInvestigationAction(pId))
  },
  {
    id: 'dock-btn-dossier',
    label: 'Dossier',
    icon: '💀',
    actionKey: 'dossier',
    activeMode: UIMode.Dossier,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleDossierAction(pId))
  },
  {
    id: 'dock-btn-ledger',
    label: 'Ledger',
    icon: '📖',
    actionKey: 'ledger',
    activeMode: UIMode.Ledger,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleLedgerAction(pId))
  },
  {
    id: 'dock-btn-debug',
    label: 'Debug',
    icon: '⚡',
    fallbackBadge: '`',
    activeMode: UIMode.Debug,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleDebugAction(pId))
  },
  {
    id: 'dock-btn-settings',
    label: 'Config',
    icon: '⚙️',
    fallbackBadge: 'ESC',
    activeMode: UIMode.Settings,
    onTrigger: (_s, pId) => queuePlayerIntent(createToggleSettingsAction(pId))
  }
];

let activeDisplayRef: ROT.Display | null = null;

/**
 * Registers the active ROT.Display reference so the HUD render-mode toggle can hot-swap between 2D Tiles and ASCII.
 *
 * @param display The ROT.Display instance.
 */
export function setHudDockDisplayRef(display: ROT.Display): void {
  activeDisplayRef = display;
}

/**
 * Cycles or toggles between 2D Sprite Tiles mode and Classic ASCII mode at runtime.
 *
 * @param state The current GameState.
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

  if (activeDisplayRef) {
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
 * Formats the primary keybind badge for an action.
 */
function formatKeyBadge(actionKey: ActionType | undefined, fallback: string | undefined): string {
  if (actionKey !== undefined) {
    const bound = getSettings().keybinds[actionKey]?.[0];
    if (bound === ' ') return 'SPC';
    if (bound) return bound.toUpperCase();
  }
  return fallback ?? '';
}

/**
 * Renders the side-mounted command dock with clickable buttons and live hotkey badges.
 *
 * @param state The current GameState.
 */
export function renderHudDock(state: GameState): void {
  const container = document.getElementById('hud-command-dock');
  if (!container) return;

  container.replaceChildren();

  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  // Render 2D Tiles / ASCII Toggle Button at top of dock
  const renderModeBtn = document.createElement('button');
  renderModeBtn.type = 'button';
  const inSpriteMode = isEffectiveSpriteMode(state.campaign);
  renderModeBtn.className = inSpriteMode ? 'dock-cmd-btn active' : 'dock-cmd-btn';
  renderModeBtn.title = 'Toggle between 2D Pixel Sprites and Classic ASCII';

  const modeIcon = document.createElement('span');
  modeIcon.className = 'dock-cmd-icon';
  modeIcon.textContent = inSpriteMode ? '🖼️' : '🔤';

  const modeLabel = document.createElement('span');
  modeLabel.className = 'dock-cmd-label';
  modeLabel.textContent = inSpriteMode ? '2D Tiles' : 'ASCII';

  const modeBadge = document.createElement('kbd');
  modeBadge.className = 'dock-cmd-key';
  modeBadge.textContent = 'MODE';

  renderModeBtn.appendChild(modeIcon);
  renderModeBtn.appendChild(modeLabel);
  renderModeBtn.appendChild(modeBadge);
  renderModeBtn.addEventListener('click', () => {
    toggleRenderMode(state);
    markDomainDirty(PresentationDomain.HUD);
  });
  container.appendChild(renderModeBtn);

  for (const spec of DOCK_COMMANDS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = spec.id;
    const isActive =
      (spec.activeMode !== undefined && state.uiMode === spec.activeMode) ||
      (spec.actionKey === 'target_toggle' && Boolean(state.targetingMode?.active)) ||
      (spec.actionKey === 'inspect' && Boolean(state.inspectMode?.active));

    btn.className = isActive ? 'dock-cmd-btn active' : 'dock-cmd-btn';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'dock-cmd-icon';
    iconSpan.textContent = spec.icon;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'dock-cmd-label';
    labelSpan.textContent = spec.label;

    const keyBadge = document.createElement('kbd');
    keyBadge.className = 'dock-cmd-key';
    keyBadge.textContent = formatKeyBadge(spec.actionKey, spec.fallbackBadge);

    btn.appendChild(iconSpan);
    btn.appendChild(labelSpan);
    btn.appendChild(keyBadge);

    btn.addEventListener('click', () => {
      spec.onTrigger(state, playerEntityId);
    });

    container.appendChild(btn);
  }
}
