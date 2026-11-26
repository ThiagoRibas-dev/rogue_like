import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { loadCampaignRegistry } from '../../../core/loader.ts';
import { createNewCampaign } from '../../../editor/workspace_file_service.ts';
import { getAllRulesets } from '../../../rulesets/registry.ts';
import type { CampaignRegistryEntry } from '../../../types/campaign.types.ts';
import type { RulesetId } from '../../../types/ruleset.types.ts';
import { Button } from '../primitives/Button.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { dialogService, toastService } from '../primitives/dialog_service.ts';
import { editorStore, useEditorSelector } from './editor_store.ts';

interface CampaignTemplateOption {
  readonly id?: string | undefined;
  readonly name: string;
  readonly desc: string;
  readonly icon: string;
}

/**
 * Accessible `<ModalShell>` wizard for creating a new ruleset-scoped campaign workspace.
 * Discovers rulesets from `getAllRulesets()` and clone templates dynamically from `campaigns/registry.json`.
 */
export function NewCampaignModal(): JSX.Element | null {
  const isOpen = useEditorSelector((s) => s.newCampaignModalOpen);
  const controller = useEditorSelector((s) => s.controller);

  const rulesets = getAllRulesets();
  const [selectedRulesetId, setSelectedRulesetId] = useState<RulesetId>(() => rulesets[0]?.id ?? 'classic');
  const [registryEntries, setRegistryEntries] = useState<ReadonlyArray<CampaignRegistryEntry>>([]);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    loadCampaignRegistry()
      .then((reg) => {
        if (!cancelled) setRegistryEntries(reg.campaigns);
      })
      .catch((err) => {
        console.error('Failed to load bundled campaign registry for wizard:', err);
        if (!cancelled) setRegistryEntries([]);
      });
    return (): void => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen || !controller) return null;

  const activeRuleset = rulesets.find((rs) => rs.id === selectedRulesetId) ?? rulesets[0];
  const activeName = activeRuleset?.metadata.name ?? selectedRulesetId;
  const matchingBundled = registryEntries.filter((entry) => (entry.rulesetId ?? 'classic') === selectedRulesetId);

  const options: ReadonlyArray<CampaignTemplateOption> = [
    {
      name: `Blank Slate (${activeName})`,
      desc: `Fresh minimal canvas pre-configured for ${activeName}.`,
      icon: '✨'
    },
    ...matchingBundled.map((entry) => ({
      id: entry.id,
      name: `Clone: ${entry.name}`,
      desc: entry.description,
      icon: '📦'
    }))
  ];

  const handleSelectTemplate = async (templateId: string | undefined): Promise<void> => {
    setIsCreating(true);
    try {
      const doc = await createNewCampaign(selectedRulesetId, templateId);
      controller.resetDocument(doc);
      editorStore.selectGroup('core');
      editorStore.setNewCampaignModalOpen(false);
      toastService.push(`Created "${doc.manifest.name}" workspace.`, 'success');
    } catch (err) {
      await dialogService.alert({
        title: 'Create Campaign Failed',
        message: `Failed to create campaign: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <ModalShell
      title="Create New Campaign Workspace"
      subtitle="Select a ruleset cartridge and starting template"
      size="md"
      isOpen={isOpen}
      onClose={() => editorStore.setNewCampaignModalOpen(false)}
      footer={
        <Button onClick={() => editorStore.setNewCampaignModalOpen(false)} disabled={isCreating}>
          Cancel
        </Button>
      }
    >
      <div className="ui-editor-new-wizard">
        <div className="ui-editor-new-wizard__section-label">1. Select RPG Ruleset</div>
        <div className="ui-editor-new-wizard__rulesets">
          {rulesets.map((rs) => {
            const active = rs.id === selectedRulesetId;
            return (
              <button
                key={rs.id}
                type="button"
                className={`ui-editor-splash__card ${active ? 'is-active' : ''}`}
                aria-pressed={active}
                disabled={isCreating}
                onClick={() => setSelectedRulesetId(rs.id)}
              >
                <span className="ui-editor-icon-lg">{rs.metadata.badgeIcon}</span>
                <div>
                  <strong>{rs.metadata.name}</strong>
                  <div className="ui-editor-muted">{rs.metadata.shortLabel}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="ui-editor-new-wizard__section-label">2. Choose Starting Template</div>
        <div className="ui-editor-splash__list">
          {options.map((opt) => (
            <button
              key={opt.id ?? 'blank'}
              type="button"
              className="ui-editor-splash__card"
              disabled={isCreating}
              onClick={() => void handleSelectTemplate(opt.id)}
            >
              <span className="ui-editor-icon-lg">{opt.icon}</span>
              <div>
                <strong>{opt.name}</strong>
                <div className="ui-editor-muted">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
