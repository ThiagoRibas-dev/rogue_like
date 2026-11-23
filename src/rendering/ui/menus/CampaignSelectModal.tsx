import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import {
  installCampaignFromFile,
  openRulesetSelectMenu,
  setSelectedCampaignId,
  startSelectedCampaign,
  uninstallSelectedCampaign
} from '../../../core/session/session_dom.ts';
import { getRuleset } from '../../../rulesets/registry.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, StatChip } from '../primitives/DataDisplay.tsx';
import { ListBox, type ListBoxItem } from '../primitives/ListBox.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel, SplitPane } from '../primitives/Panel.tsx';

/**
 * Campaign Selection Modal with roving keyboard navigation (`ListBox`), `.zip` installation,
 * and campaign metadata inspection.
 */
export function CampaignSelectModal(): JSX.Element | null {
  const uiMode = useUiSelector((s) => s.gameState?.uiMode ?? null);
  const selectedRulesetId = useUiSelector((s) => s.selectedRulesetId);
  const selectedCampaignId = useUiSelector((s) => s.selectedCampaignId);
  const campaigns = useUiSelector((s) => s.availableCampaigns);
  const isStarting = useUiSelector((s) => s.isStartingCampaign);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (uiMode !== UIMode.CampaignSelect) {
    return null;
  }

  const activeRuleset = getRuleset(selectedRulesetId);
  const selectedCampaign = campaigns.find((c) => c.id === selectedCampaignId) ?? campaigns[0] ?? null;

  const items: ReadonlyArray<ListBoxItem> = campaigns.map((c) => {
    const icon = c.source === 'installed' ? '📦' : c.source === 'editor' ? '🛠️' : '🏛️';
    return {
      id: c.id,
      label: `${icon} ${c.name}`,
      subtitle: `By ${c.author}`,
      meta: <Badge tone="neutral">{c.version}</Badge>
    };
  });

  return (
    <ModalShell
      title="Select Campaign"
      subtitle={`System: ${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.name}`}
      size="xl"
      fullHeight
      onClose={(): void => openRulesetSelectMenu()}
      headerActions={
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={(): void => {
              fileInputRef.current?.click();
            }}
          >
            Install Campaign (.zip)
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={(e): void => {
              const target = e.currentTarget;
              const file = target.files?.[0];
              if (file) {
                void installCampaignFromFile(file).finally(() => {
                  target.value = '';
                });
              }
            }}
          />
        </>
      }
      footer={
        <>
          <Button variant="secondary" size="md" onClick={(): void => openRulesetSelectMenu()}>
            Back to Rulesets
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!selectedCampaign || isStarting}
            onClick={(): void => {
              if (selectedCampaign) {
                startSelectedCampaign(selectedCampaign.id);
              }
            }}
          >
            {isStarting ? 'Loading...' : 'Start Adventure'}
          </Button>
        </>
      }
    >
      <SplitPane
        leftWidth="minmax(320px, max-content)"
        left={
          <Panel title="Available Campaigns">
            <ListBox
              items={items}
              selectedId={selectedCampaign?.id ?? null}
              ariaLabel="Campaigns"
              emptyMessage="No campaigns installed for this game system."
              onSelect={(id): void => setSelectedCampaignId(id)}
              onActivate={(id): void => {
                setSelectedCampaignId(id);
                startSelectedCampaign(id);
              }}
            />
          </Panel>
        }
        right={
          selectedCampaign ? (
            <Panel
              title={selectedCampaign.name}
              headerActions={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Badge tone="accent">{selectedCampaign.source ?? 'built-in'}</Badge>
                  {selectedCampaign.source === 'installed' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(): void => {
                        void uninstallSelectedCampaign(selectedCampaign.id);
                      }}
                    >
                      Uninstall
                    </Button>
                  ) : null}
                </div>
              }
            >
              <div className="ui-selection-detail">
                <p className="ui-selection-detail-desc">{selectedCampaign.description}</p>
                <div className="ui-selection-meta-grid">
                  <StatChip label="Author" value={selectedCampaign.author} />
                  <StatChip label="Version" value={selectedCampaign.version} />
                  <StatChip label="Map Dimensions" value={selectedCampaign.mapSize} />
                  <StatChip label="Starting Area" value={selectedCampaign.startingAreaId} />
                </div>
              </div>
            </Panel>
          ) : (
            <Panel title="No Campaign Selected">
              <p className="ui-selection-detail-desc">Select or install a campaign to inspect its details.</p>
            </Panel>
          )
        }
      />
    </ModalShell>
  );
}
