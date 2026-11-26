import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { listEditorWorkspaces } from '../../../core/campaign_store.ts';
import { loadCampaign, loadCampaignRegistry } from '../../../core/loader.ts';
import { getAllRulesets } from '../../../rulesets/registry.ts';
import type { CampaignRegistryEntry } from '../../../types/campaign.types.ts';
import { Badge } from '../primitives/DataDisplay.tsx';
import { Panel } from '../primitives/Panel.tsx';
import { dialogService, toastService } from '../primitives/dialog_service.ts';
import { editorStore, useEditorSelector } from './editor_store.ts';

interface WorkspaceListItem {
  readonly id: string;
  readonly name: string;
  readonly lastModified: string;
}

/**
 * Welcome splash view allowing authors to resume browser workspaces or open a bundled campaign.
 */
export function EditorSplash(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const [workspaces, setWorkspaces] = useState<ReadonlyArray<WorkspaceListItem> | null>(null);
  const [campaigns, setCampaigns] = useState<ReadonlyArray<CampaignRegistryEntry> | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listEditorWorkspaces()
      .then((list) => {
        if (!cancelled) setWorkspaces(list);
      })
      .catch((err) => {
        console.error('Failed to list editor workspaces:', err);
        if (!cancelled) setWorkspaces([]);
      });

    loadCampaignRegistry()
      .then((registry) => {
        if (!cancelled) setCampaigns(registry.campaigns);
      })
      .catch((err) => {
        console.error('Failed to load bundled campaign registry:', err);
        if (!cancelled) setCampaigns([]);
      });

    return (): void => {
      cancelled = true;
    };
  }, []);

  if (!controller) return null;

  const handleOpenWorkspace = async (workspaceId: string): Promise<void> => {
    setLoadingId(workspaceId);
    try {
      await controller.loadFromIDB(workspaceId);
      editorStore.selectGroup('core');
      toastService.push('Workspace loaded.', 'success');
    } catch (err) {
      await dialogService.alert({
        title: 'Workspace Load Error',
        message: `Failed to load workspace: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setLoadingId(null);
    }
  };

  const handleOpenBundled = async (entry: CampaignRegistryEntry): Promise<void> => {
    setLoadingId(entry.id);
    try {
      const campaignDoc = await loadCampaign(entry.id);
      controller.resetDocument(campaignDoc);
      editorStore.selectGroup('core');
      toastService.push(`Opened "${entry.name}".`, 'success');
    } catch (err) {
      await dialogService.alert({
        title: 'Campaign Load Error',
        message: `Failed to load campaign: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setLoadingId(null);
    }
  };

  const rulesets = getAllRulesets();

  return (
    <div className="ui-editor-splash">
      <div className="ui-editor-splash__hero">
        <h2>Campaign Creator Workspace</h2>
        <p>Resume a saved IndexedDB draft, clone a bundled campaign, or click New in the toolbar.</p>
      </div>

      <div className="ui-editor-splash__columns">
        <Panel title="Saved Workspaces (Browser Storage)">
          {workspaces === null ? (
            <p className="ui-editor-muted">Loading saved workspaces...</p>
          ) : workspaces.length === 0 ? (
            <p className="ui-editor-muted">No saved browser workspaces found.</p>
          ) : (
            <div className="ui-editor-splash__list">
              {workspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  className="ui-editor-splash__card"
                  disabled={loadingId !== null}
                  onClick={() => void handleOpenWorkspace(ws.id)}
                >
                  <div>
                    <strong>{ws.name}</strong>
                    <div className="ui-editor-muted">ID: {ws.id}</div>
                  </div>
                  <Badge tone="accent">Resume</Badge>
                </button>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Bundled Campaigns (Disk)">
          {campaigns === null ? (
            <p className="ui-editor-muted">Loading bundled campaigns...</p>
          ) : (
            <div className="ui-editor-splash__list">
              {rulesets.map((rs) => {
                const matching = campaigns.filter((c) => (c.rulesetId ?? 'classic') === rs.id);
                if (matching.length === 0) return null;
                return (
                  <div key={rs.id} className="ui-editor-splash__group">
                    <div className="ui-editor-splash__group-title">
                      {rs.metadata.badgeIcon} {rs.metadata.name}
                    </div>
                    {matching.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="ui-editor-splash__card"
                        disabled={loadingId !== null}
                        onClick={() => void handleOpenBundled(c)}
                      >
                        <div>
                          <strong>{c.name}</strong>
                          <div className="ui-editor-muted">{c.description}</div>
                        </div>
                        <Badge tone="success">Open</Badge>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
