import * as ROT from 'rot-js';
import { createToggleSettingsAction } from '../../actions/core.actions.ts';
import { readCampaignFromZip } from '../../editor/workspace_file_service.ts';
import { syncDisplayLayout } from '../../rendering/display.ts';
import { invalidateViewportSnapshot } from '../../rendering/presenter.ts';
import { applyCartridgeNewGameHook } from '../../rendering/ui/cartridge_ui_registry.ts';
import { applySettingsToDOM } from '../../rendering/ui/core/apply_settings.ts';
import { uiStore } from '../../rendering/ui/core/ui_store.ts';
import { dialogService } from '../../rendering/ui/primitives/dialog_service.ts';
import { ComponentType } from '../../types/components.types.ts';
import { type EntityId, UIMode } from '../../types/game-state.types.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';
import { continueGame, startNewGame } from '../bootstrap.ts';
import { startSandboxEncounter } from '../bootstrap_sandbox.ts';
import { getInstalledCampaign, installCampaign, uninstallCampaign } from '../campaign_store.ts';
import { getComponent } from '../ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../game-loop.ts';
import { loadCampaignRegistry } from '../loader.ts';
import { markAllDomainsDirty } from '../presentation_queue.ts';
import { initRNG } from '../rng.ts';
import { CampaignNotFoundError, getSaveData, hasSaveGame } from '../save.ts';
import { clearScheduler } from '../scheduler.ts';

export let selectedRulesetId: RulesetId = 'classic';
export let selectedCampaignId: string | null = null;
let boundDisplay: ROT.Display | null = null;

/** Sets the currently selected ruleset ID in both session state and `uiStore`. */
export function setSelectedRulesetId(id: RulesetId): void {
  selectedRulesetId = id;
  uiStore.updateMenuSelection({ selectedRulesetId: id });
}

/** Sets the currently selected campaign ID in both session state and `uiStore`. */
export function setSelectedCampaignId(id: string | null): void {
  selectedCampaignId = id;
  uiStore.updateMenuSelection({ selectedCampaignId: id });
}

/** Finds the active player entity ID in the current game state. */
export function getPlayerId(): EntityId | undefined {
  return getGameState().entities.find((id) => getComponent(getGameState(), id, ComponentType.Player));
}

/** Synchronizes the selected ruleset state into `uiStore` for `<RulesetSelectModal />`. */
export function refreshRulesetList(): void {
  uiStore.updateMenuSelection({ selectedRulesetId });
}

/** Uninstalls a user-installed campaign after confirmation via `dialogService`. */
export async function uninstallSelectedCampaign(campaignId: string): Promise<void> {
  let confirmMsg = 'Are you sure you want to uninstall this campaign?';
  if (hasSaveGame()) {
    const saveStr = getSaveData();
    if (saveStr && saveStr.includes(`"campaignId":"${campaignId}"`)) {
      confirmMsg = 'Uninstalling this campaign will orphan your current save file. Continue?';
    }
  }
  const confirmed = await dialogService.confirm({
    title: 'Uninstall Campaign',
    message: confirmMsg,
    confirmLabel: 'Uninstall',
    danger: true
  });
  if (!confirmed) return;

  try {
    await uninstallCampaign(campaignId);
    setSelectedCampaignId(null);
    await refreshCampaignList();
  } catch (err) {
    await dialogService.alert({
      title: 'Uninstall Failed',
      message: `Failed to uninstall campaign: ${(err as Error).message}`
    });
  }
}

/** Installs a campaign `.zip` archive via `dialogService` prompts and refreshes the campaign registry. */
export async function installCampaignFromFile(file: File): Promise<void> {
  try {
    const campaignData = await readCampaignFromZip(file);
    const existing = await getInstalledCampaign(campaignData.manifest.id);
    if (existing) {
      const overwrite = await dialogService.confirm({
        title: 'Overwrite Campaign',
        message: `Campaign "${campaignData.manifest.name}" is already installed. Overwrite?`,
        confirmLabel: 'Overwrite'
      });
      if (!overwrite) return;
    }
    await installCampaign(campaignData);
    await refreshCampaignList();
    setSelectedCampaignId(campaignData.manifest.id);
    await dialogService.alert({
      title: 'Campaign Installed',
      message: `Campaign "${campaignData.manifest.name}" installed successfully!`
    });
  } catch (err) {
    await dialogService.alert({
      title: 'Install Failed',
      message: `Failed to install campaign: ${(err as Error).message}`
    });
  }
}

/** Refreshes the campaign list filtered by the selected ruleset inside `uiStore`. */
export async function refreshCampaignList(): Promise<void> {
  const registry = await loadCampaignRegistry();
  const filteredCampaigns = registry.campaigns.filter((c) => (c.rulesetId ?? 'classic') === selectedRulesetId);
  const firstId = filteredCampaigns[0]?.id ?? null;
  setSelectedCampaignId(firstId);
  uiStore.updateMenuSelection({
    availableCampaigns: filteredCampaigns,
    selectedCampaignId: firstId
  });
}

/** Navigates to the Ruleset Selection screen. */
export function openRulesetSelectMenu(): void {
  refreshRulesetList();
  setGameState({ ...getGameState(), uiMode: UIMode.RulesetSelect });
  applySettingsToDOM();
  markAllDomainsDirty();
}

/** Navigates to the Campaign Selection screen for the selected ruleset. */
export async function openCampaignSelectMenu(rulesetId?: RulesetId): Promise<void> {
  if (rulesetId) {
    setSelectedRulesetId(rulesetId);
  }
  await refreshCampaignList();
  setGameState({ ...getGameState(), uiMode: UIMode.CampaignSelect });
  applySettingsToDOM();
  markAllDomainsDirty();
}

/** Returns to the Main Menu screen. */
export function returnToMainMenu(): void {
  setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
  applySettingsToDOM();
  markAllDomainsDirty();
}

/** Enters the Campaign Editor / Dev Tools workspace. */
export function openEditorMode(): void {
  clearScheduler();
  setGameState({ ...getGameState(), uiMode: UIMode.Editor });
  applySettingsToDOM();
  markAllDomainsDirty();
}

/** Opens the Settings modal (optionally activating a specific tab such as `'keybinds'`). */
export function openSettingsModal(initialTab: string | null = null): void {
  uiStore.setSettingsInitialTab(initialTab);
  const pId = getPlayerId();
  if (pId && getGameState().uiMode === UIMode.Game) {
    queuePlayerIntent(createToggleSettingsAction(pId));
  } else {
    setGameState({ ...getGameState(), uiMode: UIMode.Settings });
  }
  markAllDomainsDirty();
}

/** Closes the Settings modal back to gameplay or Main Menu. */
export function closeSettingsModal(): void {
  const pId = getPlayerId();
  if (pId && getGameState().entities.length > 0) {
    queuePlayerIntent(createToggleSettingsAction(pId));
  } else {
    setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
  }
  applySettingsToDOM();
  markAllDomainsDirty();
}

/** Launches a new game session for the selected campaign. */
export function startSelectedCampaign(campaignIdOverride?: string): void {
  const targetId = campaignIdOverride ?? selectedCampaignId;
  if (!targetId || !boundDisplay) return;
  const display = boundDisplay;
  uiStore.updateMenuSelection({ isStartingCampaign: true });
  setTimeout(() => {
    startNewGame(targetId, getGameState(), display, (newState) => {
      setGameState(applyCartridgeNewGameHook(newState));
      applySettingsToDOM();
      markAllDomainsDirty();
    }).finally(() => {
      uiStore.updateMenuSelection({ isStartingCampaign: false });
    });
  }, 50);
}

/** Continues an existing saved game session. */
export function continueSavedGame(): void {
  if (!boundDisplay) return;
  const display = boundDisplay;
  continueGame((newState) => {
    syncDisplayLayout(display, newState);
    setGameState(newState);
    applySettingsToDOM();
    invalidateViewportSnapshot();
    markAllDomainsDirty();
  }).catch((err) => {
    if (err instanceof CampaignNotFoundError) {
      void dialogService.alert({
        title: 'Load Save Failed',
        message: `Failed to load save game: ${err.message}\n\nPlease reinstall the missing campaign or start a new game.`
      });
    } else {
      throw err;
    }
  });
}

/** Binds the active ROT.Display reference and Campaign Editor playtest / sandbox session hooks. */
export function bindDOMControls(display: ROT.Display): void {
  boundDisplay = display;

  if (sessionStorage.getItem('editor_playtest') === 'true') {
    sessionStorage.removeItem('editor_playtest');
    const playtestSeed = sessionStorage.getItem('editor_playtest_seed');
    if (playtestSeed) {
      sessionStorage.removeItem('editor_playtest_seed');
      initRNG(Number(playtestSeed));
    }
    const spawnOverrideRaw = sessionStorage.getItem('editor_playtest_spawn');
    let spawnOverride: { areaId: string; x: number; y: number } | undefined;
    if (spawnOverrideRaw) {
      try {
        const parsed = JSON.parse(spawnOverrideRaw);
        if (
          parsed &&
          typeof parsed.areaId === 'string' &&
          typeof parsed.x === 'number' &&
          typeof parsed.y === 'number'
        ) {
          spawnOverride = parsed;
        }
      } catch {
        // Ignore invalid spawn override
      }
      sessionStorage.removeItem('editor_playtest_spawn');
    }
    setTimeout(() => {
      startNewGame(
        'default',
        getGameState(),
        display,
        (newState) => setGameState(newState),
        undefined,
        spawnOverride
      ).catch(console.error);
    }, 50);
  }

  window.addEventListener('PlaySandboxEncounter', (e: Event) => {
    const customEvent = e as CustomEvent;
    const generatedArea = customEvent.detail.generatedArea;
    if (!generatedArea) return;
    clearScheduler();
    startSandboxEncounter('default', getGameState(), display, generatedArea, (newState) =>
      setGameState(newState)
    ).catch(console.error);
  });
}
