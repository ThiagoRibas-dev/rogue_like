import type { JSX } from 'preact';
import { getRuleset } from '../../../rulesets/registry.ts';
import { type CampaignData, CampaignCategorySchemas, CampaignDataSchema } from '../../../types/campaign.types.ts';
import { getCategoryAuthoringLevel, VIEW_GROUPS } from '../../editor/editor_config.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, type BadgeTone } from '../primitives/DataDisplay.tsx';
import { Tabs } from '../primitives/Tabs.tsx';
import { EditorSplash } from './EditorSplash.tsx';
import {
  editorStore,
  escapeJsonPointerSegment,
  resolveCategoryReferenceKind,
  useEditorSelector
} from './editor_store.ts';
import { ZodFormRenderer } from './forms/ZodFormRenderer.tsx';
import { SimulationLab } from './labs/SimulationLab.tsx';
import { AreaEditor } from './views/AreaEditor.tsx';
import { DialogueEditor } from './views/DialogueEditor.tsx';
import { FactionMatrixEditor } from './views/FactionMatrixEditor.tsx';
import { TriggerComposer } from './views/TriggerComposer.tsx';
import { WorldGraph } from './views/WorldGraph.tsx';

function getAuthoringBadgeMeta(level: 'Static' | 'Blueprint' | 'Dynamic'): {
  readonly code: string;
  readonly tone: BadgeTone;
} {
  switch (level) {
    case 'Static':
      return { code: 'ST', tone: 'info' };
    case 'Blueprint':
      return { code: 'BP', tone: 'warning' };
    case 'Dynamic':
      return { code: 'DYN', tone: 'accent' };
  }
}

/**
 * Main right-hand Campaign Editor workspace routing between the Welcome Splash,
 * category tabs, Zod-generated forms, and specialized domain/simulation editors.
 */
export function EditorWorkspace(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const activeGroupId = useEditorSelector((s) => s.activeGroupId);
  const activeTabId = useEditorSelector((s) => s.activeTabId);
  const activeItemId = useEditorSelector((s) => s.activeItemId);
  const sidebarCollapsed = useEditorSelector((s) => s.sidebarCollapsed);
  const errors = useEditorSelector((s) => s.errors);
  const deepReport = useEditorSelector((s) => s.deepReport);
  const docVersion = useEditorSelector((s) => s.documentVersion);
  void docVersion;

  if (!controller) return null;

  if (!activeGroupId) {
    return (
      <main className="ui-editor-workspace" aria-label="Campaign Editor Welcome">
        <EditorSplash />
      </main>
    );
  }

  const doc = controller.getDocument();
  const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
  const group = activeGroups.find((g) => g.id === activeGroupId);
  if (!group) {
    return (
      <main className="ui-editor-workspace">
        <EditorSplash />
      </main>
    );
  }

  const resolvedTab = group.tabs.find((t) => t.id === activeTabId) ?? group.tabs[0];
  if (!resolvedTab) return null;

  const combinedErrors = deepReport ? [...errors, ...deepReport.errors] : errors;

  const tabItems = group.tabs.map((tab) => {
    if (tab.id === 'simulation' || tab.id === 'triggerComposer' || !(tab.id in CampaignDataSchema.shape)) {
      return { id: tab.id, label: tab.label };
    }
    const level = getCategoryAuthoringLevel(tab.id as keyof CampaignData);
    const meta = getAuthoringBadgeMeta(level);
    return {
      id: tab.id,
      label: tab.label,
      badge: (
        <Badge tone={meta.tone} title={`Authoring Level: ${level}`}>
          {meta.code}
        </Badge>
      )
    };
  });

  const renderTabContent = (): JSX.Element => {
    if (resolvedTab.id === 'factions') {
      return <FactionMatrixEditor controller={controller} basePath="/factions" />;
    }

    if (resolvedTab.id === 'triggerComposer') {
      return <TriggerComposer controller={controller} />;
    }

    if (resolvedTab.id === 'simulation') {
      return <SimulationLab controller={controller} />;
    }

    const categoryKey = resolvedTab.id as keyof CampaignData;

    if (resolvedTab.panelType === 'dictionary') {
      if (!activeItemId) {
        if (categoryKey === 'areas') {
          return <WorldGraph doc={doc} onSelectNode={(id) => editorStore.selectItem(id)} />;
        }
        return (
          <div className="ui-editor-placeholder">
            <h3>No Item Selected</h3>
            <p className="ui-editor-muted">
              Select an entry from the left sidebar or click &quot;+ Add&quot; to create a new {resolvedTab.label}{' '}
              entry.
            </p>
          </div>
        );
      }

      const dict = (doc[categoryKey] as Record<string, unknown> | undefined) ?? {};
      const item = dict[activeItemId];
      if (item === undefined) {
        return (
          <div className="ui-editor-placeholder">
            <h3>Entry Not Found</h3>
            <p className="ui-editor-muted">
              Entry &quot;{activeItemId}&quot; does not exist in {resolvedTab.label}.
            </p>
          </div>
        );
      }

      const itemObj =
        item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
      const itemTitle =
        (typeof itemObj?.name === 'string' && itemObj.name) ||
        (typeof itemObj?.title === 'string' && itemObj.title) ||
        activeItemId;
      const basePath = `/${categoryKey}/${escapeJsonPointerSegment(activeItemId)}`;
      const level = getCategoryAuthoringLevel(categoryKey);
      const levelMeta = getAuthoringBadgeMeta(level);
      const refKind = resolveCategoryReferenceKind(categoryKey);

      return (
        <div className="ui-editor-item-view">
          <div className="ui-editor-workspace__header">
            <div className="ui-editor-workspace__title-row">
              <h2 className="ui-editor-workspace__title">
                {itemTitle} <span className="ui-editor-muted">({activeItemId})</span>
              </h2>
              <Badge tone={levelMeta.tone}>{level}</Badge>
            </div>
            <Button size="sm" onClick={() => editorStore.setWhereUsedTarget({ kind: refKind, id: activeItemId })}>
              🔍 Where Used
            </Button>
          </div>

          {categoryKey === 'areas' ? (
            <AreaEditor
              controller={controller}
              area={item as CampaignData['areas'][string]}
              basePath={basePath}
              errors={combinedErrors}
            />
          ) : categoryKey === 'dialogues' ? (
            <DialogueEditor
              controller={controller}
              tree={item as NonNullable<CampaignData['dialogues']>[string]}
              basePath={basePath}
              errors={combinedErrors}
            />
          ) : (
            <ZodFormRenderer
              controller={controller}
              schema={CampaignCategorySchemas[categoryKey]}
              value={item}
              basePath={basePath}
              errors={combinedErrors}
            />
          )}
        </div>
      );
    }

    const level = getCategoryAuthoringLevel(categoryKey);
    const levelMeta = getAuthoringBadgeMeta(level);
    const singletonSchema = CampaignDataSchema.shape[categoryKey];

    return (
      <div className="ui-editor-item-view">
        <div className="ui-editor-workspace__header">
          <div className="ui-editor-workspace__title-row">
            <h2 className="ui-editor-workspace__title">{resolvedTab.label}</h2>
            <Badge tone={levelMeta.tone}>{level}</Badge>
          </div>
        </div>
        <ZodFormRenderer
          controller={controller}
          schema={singletonSchema}
          value={doc[categoryKey]}
          basePath={`/${categoryKey}`}
          errors={combinedErrors}
        />
      </div>
    );
  };

  return (
    <main className="ui-editor-workspace" aria-label={`${group.label} Workspace`}>
      <div className="ui-editor-workspace__tabbar">
        {sidebarCollapsed && resolvedTab.panelType === 'dictionary' ? (
          <Button size="sm" onClick={() => editorStore.setSidebarCollapsed(false)}>
            ▶ Show List
          </Button>
        ) : null}
        <Tabs
          ariaLabel={`${group.label} Tabs`}
          activeTabId={resolvedTab.id}
          tabs={tabItems}
          onSelectTab={(id) => editorStore.selectTab(id as keyof CampaignData | 'simulation' | 'triggerComposer')}
        />
      </div>

      <div className="ui-editor-workspace__content">{renderTabContent()}</div>
    </main>
  );
}
