import * as ROT from 'rot-js';
import { type EntityId, UIMode } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { getComponent } from '../ecs.ts';
import { loadCampaignRegistry } from '../loader.ts';
import { clearScheduler } from '../scheduler.ts';
import { installCampaign, getInstalledCampaign, uninstallCampaign } from '../campaign_store.ts';
import { readCampaignFromZip } from '../../editor/workspace_file_service.ts';
import { hasSaveGame, getSaveData, CampaignNotFoundError } from '../save.ts';
import { setGameState, queuePlayerIntent, getGameState } from '../game-loop.ts';
import { startNewGame, continueGame } from '../bootstrap.ts';
import { startSandboxEncounter } from '../bootstrap_sandbox.ts';
import { populateRulesetList, populateCampaignList } from '../../rendering/ui.ts';
import { applyCartridgeNewGameHook } from '../../rendering/ui/cartridge_ui_registry.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';
import { getAllRulesets, getRuleset } from '../../rulesets/registry.ts';
import { syncDisplayLayout } from '../../rendering/display.ts';
import { invalidateViewportSnapshot } from '../../rendering/presenter.ts';
import { markAllDomainsDirty } from '../presentation_queue.ts';
import {
  createToggleEngineModeAction,
  createTogglePauseAction,
  createSetRTwPSpeedAction,
  createToggleRotatedAction,
  createToggle3DAction,
  createSetZoomLevelAction
} from '../../actions/core.actions.ts';
import { createDebugFastForwardSchemesAction, createDebugPromoteAction } from '../../actions/debug.actions.ts';
import { ZOOM_STEP_DELTA } from '../../constants/display.constants.ts';
import { initRNG } from '../rng.ts';

export let selectedRulesetId: RulesetId = 'classic';
export let selectedCampaignId: string | null = null;

export function setSelectedRulesetId(id: RulesetId): void {
  selectedRulesetId = id;
}

export function setSelectedCampaignId(id: string | null): void {
  selectedCampaignId = id;
}

export function getPlayerId(): EntityId | undefined {
  return getGameState().entities.find((id) => getComponent(getGameState(), id, ComponentType.Player));
}

/**
 * Refreshes the ruleset list in the ruleset selection modal.
 */
export function refreshRulesetList(): void {
  const rulesets = getAllRulesets();
  populateRulesetList(rulesets, selectedRulesetId, (rulesetId) => {
    selectedRulesetId = rulesetId;
  });
}

/**
 * Refreshes the campaign list in the campaign selection modal, filtered by the selected ruleset.
 */
export async function refreshCampaignList(): Promise<void> {
  const registry = await loadCampaignRegistry();
  const activeRuleset = getRuleset(selectedRulesetId);
  const rulesetLabel = document.getElementById('campaign-select-ruleset-label');
  if (rulesetLabel) {
    rulesetLabel.textContent = `Ruleset: ${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.name}`;
  }
  const filteredCampaigns = registry.campaigns.filter((c) => (c.rulesetId ?? 'classic') === selectedRulesetId);
  selectedCampaignId = null;
  populateCampaignList(
    filteredCampaigns,
    (campaign) => {
      selectedCampaignId = campaign.id;
    },
    async (campaignId) => {
      if (hasSaveGame()) {
        const saveStr = getSaveData();
        if (saveStr && saveStr.includes(`"campaignId":"${campaignId}"`)) {
          if (!confirm('Uninstalling this campaign will orphan your current save file. Continue?')) {
            return;
          }
        }
      } else {
        if (!confirm('Are you sure you want to uninstall this campaign?')) return;
      }
      try {
        await uninstallCampaign(campaignId);
        selectedCampaignId = null;
        await refreshCampaignList();
      } catch (err) {
        alert(`Failed to uninstall campaign: ${(err as Error).message}`);
      }
    }
  );
}

/**
 * Binds DOM action buttons and editor playtest hooks.
 */
export function bindDOMControls(display: ROT.Display): void {
  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    refreshRulesetList();
    setGameState({ ...getGameState(), uiMode: UIMode.RulesetSelect });
  });

  document.getElementById('btn-ruleset-back')?.addEventListener('click', () => {
    setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
  });

  document.getElementById('btn-ruleset-next')?.addEventListener('click', () => {
    refreshCampaignList()
      .then(() => {
        setGameState({ ...getGameState(), uiMode: UIMode.CampaignSelect });
      })
      .catch(console.error);
  });

  document.getElementById('btn-campaign-back')?.addEventListener('click', () => {
    refreshRulesetList();
    setGameState({ ...getGameState(), uiMode: UIMode.RulesetSelect });
  });

  const fileInstallCampaign = document.getElementById('file-install-campaign') as HTMLInputElement | null;
  document.getElementById('btn-install-campaign')?.addEventListener('click', () => {
    fileInstallCampaign?.click();
  });

  fileInstallCampaign?.addEventListener('change', async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const campaignData = await readCampaignFromZip(file);
      const existing = await getInstalledCampaign(campaignData.manifest.id);
      if (existing) {
        if (!confirm(`Campaign "${campaignData.manifest.name}" is already installed. Overwrite?`)) {
          target.value = '';
          return;
        }
      }
      await installCampaign(campaignData);
      await refreshCampaignList();
      alert(`Campaign "${campaignData.manifest.name}" installed successfully!`);
      target.value = '';
    } catch (err) {
      alert(`Failed to install campaign: ${(err as Error).message}`);
      console.error(err);
      target.value = '';
    }
  });

  document.getElementById('btn-campaign-start')?.addEventListener('click', (e) => {
    if (selectedCampaignId) {
      const btn = e.target as HTMLButtonElement;
      const originalText = btn.textContent;
      btn.textContent = 'Loading...';
      btn.disabled = true;

      setTimeout(() => {
        startNewGame(selectedCampaignId!, getGameState(), display, (newState) => {
          setGameState(applyCartridgeNewGameHook(newState));
        }).finally(() => {
          btn.textContent = originalText;
          btn.disabled = false;
        });
      }, 50);
    }
  });

  document.getElementById('btn-continue')?.addEventListener('click', () => {
    continueGame((newState) => {
      syncDisplayLayout(display, newState);
      setGameState(newState);
      invalidateViewportSnapshot();
      markAllDomainsDirty();
    }).catch((err) => {
      if (err instanceof CampaignNotFoundError) {
        alert(`Failed to load save game: ${err.message}\n\nPlease reinstall the missing campaign or start a new game.`);
      } else {
        throw err;
      }
    });
  });

  document.getElementById('btn-return-menu')?.addEventListener('click', () => {
    setGameState({ ...getGameState(), uiMode: UIMode.MainMenu });
  });

  document.getElementById('btn-dev-tools')?.addEventListener('click', () => {
    clearScheduler();
    setGameState({ ...getGameState(), uiMode: UIMode.Editor });
  });

  document.getElementById('btn-engine-mode')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createToggleEngineModeAction(pId));
  });
  document.getElementById('btn-pause')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createTogglePauseAction(pId));
  });
  document.getElementById('btn-speed-1')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 1));
  });
  document.getElementById('btn-speed-2')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 2));
  });
  document.getElementById('btn-speed-4')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createSetRTwPSpeedAction(pId, 4));
  });

  document.getElementById('btn-toggle-rotate')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createToggleRotatedAction(pId));
  });
  document.getElementById('btn-toggle-3d')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createToggle3DAction(pId));
  });
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createSetZoomLevelAction(pId, ZOOM_STEP_DELTA));
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createSetZoomLevelAction(pId, -ZOOM_STEP_DELTA));
  });

  document.getElementById('btn-debug-ff-schemes')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createDebugFastForwardSchemesAction(pId, 10));
  });
  document.getElementById('btn-debug-promote')?.addEventListener('click', () => {
    const pId = getPlayerId();
    if (pId) queuePlayerIntent(createDebugPromoteAction(pId));
  });

  // Editor playtest bootstrapping
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
        (newState) => {
          setGameState(newState);
        },
        undefined,
        spawnOverride
      ).catch(console.error);
    }, 50);
  }

  // Sandbox playtest event from Editor
  window.addEventListener('PlaySandboxEncounter', (e: Event) => {
    const customEvent = e as CustomEvent;
    const generatedArea = customEvent.detail.generatedArea;
    if (!generatedArea) return;

    clearScheduler();
    startSandboxEncounter('default', getGameState(), display, generatedArea, (newState) => {
      setGameState(newState);
    }).catch(console.error);
  });
}
