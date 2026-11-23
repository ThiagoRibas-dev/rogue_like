import type { JSX } from 'preact';
import { openCampaignSelectMenu, returnToMainMenu, setSelectedRulesetId } from '../../../core/session/session_dom.ts';
import { getAllRulesets, getRuleset } from '../../../rulesets/registry.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import type { RulesetId } from '../../../types/ruleset.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { ListBox, type ListBoxItem } from '../primitives/ListBox.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel, SplitPane } from '../primitives/Panel.tsx';

/**
 * Ruleset Selection Modal with roving keyboard navigation (`ListBox`) and live ruleset detail pane.
 */
export function RulesetSelectModal(): JSX.Element | null {
  const uiMode = useUiSelector((s) => s.gameState?.uiMode ?? null);
  const selectedRulesetId = useUiSelector((s) => s.selectedRulesetId);

  if (uiMode !== UIMode.RulesetSelect) {
    return null;
  }

  const rulesets = getAllRulesets();
  const activeRuleset = getRuleset(selectedRulesetId);

  const items: ReadonlyArray<ListBoxItem> = rulesets.map((rs) => ({
    id: rs.metadata.id,
    label: `${rs.metadata.badgeIcon} ${rs.metadata.name}`,
    subtitle: rs.metadata.version,
    meta: <Badge tone="neutral">{rs.metadata.shortLabel}</Badge>
  }));

  const handleSelect = (id: string): void => {
    setSelectedRulesetId(id as RulesetId);
  };

  const handleNext = (): void => {
    void openCampaignSelectMenu(selectedRulesetId);
  };

  return (
    <ModalShell
      title="Choose Game System"
      subtitle="Select the ruleset and combat system for your adventure"
      size="xl"
      fullHeight
      onClose={(): void => returnToMainMenu()}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={(): void => returnToMainMenu()}>
            Back to Main Menu
          </Button>
          <Button variant="primary" size="md" onClick={handleNext}>
            Next: Choose Campaign
          </Button>
        </>
      }
    >
      <SplitPane
        leftWidth="minmax(320px, max-content)"
        left={
          <Panel title="Game Systems">
            <ListBox
              items={items}
              selectedId={selectedRulesetId}
              ariaLabel="Game systems"
              onSelect={handleSelect}
              onActivate={(id): void => {
                setSelectedRulesetId(id as RulesetId);
                void openCampaignSelectMenu(id as RulesetId);
              }}
            />
          </Panel>
        }
        right={
          <Panel
            title={`${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.name}`}
            headerActions={<Badge tone="accent">{activeRuleset.metadata.version}</Badge>}
          >
            <div className="ui-selection-detail">
              <p className="ui-selection-detail-desc">{activeRuleset.metadata.description}</p>
              <div>
                <h4 className="ui-panel__title" style={{ marginBottom: '8px' }}>
                  Key Features
                </h4>
                <ul className="ui-selection-feature-list">
                  {activeRuleset.metadata.features.map((feat, idx) => (
                    <li key={`${activeRuleset.metadata.id}_feat_${idx}`}>{feat}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Panel>
        }
      />
    </ModalShell>
  );
}
