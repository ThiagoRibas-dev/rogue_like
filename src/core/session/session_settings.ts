import { buildTelemetryExportPayload } from '../performance.ts';
import { getRenderDebugMetrics } from '../../rendering/render_debug.ts';
import { dialogService } from '../../rendering/ui/primitives/dialog_service.ts';
import { getGameState } from '../game-loop.ts';
import { loadCampaignRegistry } from '../loader.ts';
import { markAllDomainsDirty } from '../presentation_queue.ts';
import { getActiveReplay } from '../replay.ts';
import { getSaveData, setSaveData } from '../save.ts';

/** Downloads the current active replay log as a JSON file. */
export function triggerReplayDownload(): void {
  const replay = getActiveReplay();
  if (replay) {
    const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_replay_${replay.campaignId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    void dialogService.alert({
      title: 'No Active Replay',
      message: 'No active replay found!'
    });
  }
}

/** Exports the current performance, subsystem timing, and render debug telemetry snapshot as a JSON file. */
export function triggerTelemetryDownload(): void {
  const state = getGameState();
  const payload = buildTelemetryExportPayload(state, getRenderDebugMetrics());
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `roguelike_telemetry_${state.campaignId}_turn${state.globalTurn}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Exports the current local save game as a downloadable JSON file. */
export function triggerSaveExportDownload(): void {
  const data = getSaveData();
  if (data) {
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roguelike_save_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

/** Imports a save game JSON file after validating its campaign existence. */
export async function importSaveFromFile(file: File): Promise<void> {
  try {
    const content = await file.text();
    const parsed = JSON.parse(content) as { readonly campaignId?: string };

    if (!parsed.campaignId) {
      throw new Error('Save file is missing required campaign information.');
    }

    const registry = await loadCampaignRegistry();
    const exists = registry.campaigns.some((c) => c.id === parsed.campaignId);
    if (!exists) {
      throw new Error(
        `This save requires campaign "${parsed.campaignId}", which is not installed. Please install it first.`
      );
    }

    setSaveData(content);
    markAllDomainsDirty();
    await dialogService.alert({
      title: 'Save Imported',
      message: 'Save game imported successfully!'
    });
  } catch (err) {
    await dialogService.alert({
      title: 'Import Failed',
      message: `Failed to import save: ${(err as Error).message}`
    });
  }
}
