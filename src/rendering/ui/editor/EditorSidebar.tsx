import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { z } from 'zod';
import { getRuleset } from '../../../rulesets/registry.ts';
import { type CampaignData, CampaignCategorySchemas, unwrapZodSchema } from '../../../types/campaign.types.ts';
import { VIEW_GROUPS } from '../../editor/editor_config.ts';
import { Button, IconButton } from '../primitives/Button.tsx';
import { TextInput } from '../primitives/FormControls.tsx';
import { dialogService } from '../primitives/dialog_service.ts';
import { useRovingFocus } from '../primitives/focus_hooks.ts';
import {
  editorStore,
  escapeJsonPointerSegment,
  resolveCategoryReferenceKind,
  useEditorSelector
} from './editor_store.ts';

function buildDefaultDictionaryEntry(categoryKey: keyof CampaignData, newId: string): unknown {
  const itemSchema = unwrapZodSchema(CampaignCategorySchemas[categoryKey]);
  if (itemSchema instanceof z.ZodArray) {
    return [];
  }
  if (itemSchema instanceof z.ZodRecord) {
    return {};
  }
  if (itemSchema instanceof z.ZodObject) {
    const shape = itemSchema.shape as Record<string, z.ZodTypeAny>;
    const entry: Record<string, unknown> = {};
    if ('id' in shape) entry.id = newId;
    if ('name' in shape) entry.name = 'New Item';
    if ('title' in shape) entry.title = 'New Item';
    return entry;
  }
  return { id: newId, name: 'New Item' };
}

function validateNewDictionaryKey(value: string, existingDict: Readonly<Record<string, unknown>>): string | null {
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    return 'ID must contain only alphanumeric characters, dashes, or underscores.';
  }
  if (value in existingDict) {
    return 'An item with that ID already exists.';
  }
  return null;
}

/**
 * Collapsible, resizable Campaign Editor dictionary sidebar with roving keyboard focus,
 * schema-aware Add/Duplicate/Delete, drag-and-drop reference linking, and Where-Used triggers.
 */
export function EditorSidebar(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const activeGroupId = useEditorSelector((s) => s.activeGroupId);
  const activeTabId = useEditorSelector((s) => s.activeTabId);
  const activeItemId = useEditorSelector((s) => s.activeItemId);
  const searchFilter = useEditorSelector((s) => s.searchFilter);
  const sidebarWidth = useEditorSelector((s) => s.sidebarWidth);
  const sidebarCollapsed = useEditorSelector((s) => s.sidebarCollapsed);
  const docVersion = useEditorSelector((s) => s.documentVersion);
  void docVersion;

  const listRef = useRef<HTMLDivElement>(null);

  const doc = controller?.getDocument();
  const activeGroups = doc ? getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS) : [];
  const group = activeGroups.find((g) => g.id === activeGroupId);
  const tab = group?.tabs.find((t) => t.id === activeTabId);
  const isVisible = Boolean(
    controller && activeGroupId && activeTabId && tab?.panelType === 'dictionary' && !sidebarCollapsed
  );

  const categoryKey = (tab?.id ?? 'entities') as keyof CampaignData;
  const rawDict = isVisible && doc ? (doc[categoryKey] as Record<string, unknown> | undefined) : undefined;
  const dict = rawDict ?? {};
  const term = searchFilter.trim().toLowerCase();

  const keys = isVisible
    ? Object.keys(dict).filter((key) => {
        if (!term) return true;
        const item = dict[key];
        const obj = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : null;
        const label = String(obj?.name ?? obj?.title ?? key).toLowerCase();
        return key.toLowerCase().includes(term) || label.includes(term);
      })
    : [];

  const selectedIndex = activeItemId ? Math.max(0, keys.indexOf(activeItemId)) : 0;
  const roving = useRovingFocus({
    count: keys.length,
    orientation: 'vertical',
    controlledIndex: activeItemId && keys.includes(activeItemId) ? selectedIndex : undefined,
    onIndexChange: (idx) => {
      const targetKey = keys[idx];
      if (!targetKey) return;
      editorStore.selectItem(targetKey);
      const optionBtns = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
      optionBtns?.[idx]?.focus();
    },
    onActivate: (idx) => {
      const targetKey = keys[idx];
      if (targetKey) editorStore.selectItem(targetKey);
    }
  });

  if (!controller || !tab || !isVisible) {
    return null;
  }

  const handleAdd = async (): Promise<void> => {
    const newId = await dialogService.prompt({
      title: `New ${tab.label} Entry`,
      placeholder: 'Enter a unique ID (e.g. iron_sword)',
      confirmLabel: 'Create',
      validator: (val) => validateNewDictionaryKey(val.trim(), dict)
    });
    if (!newId) return;
    const cleanId = newId.trim();
    const entry = buildDefaultDictionaryEntry(categoryKey, cleanId);
    if (rawDict === undefined) {
      controller.applyOperations([{ op: 'add', path: `/${categoryKey}`, value: { [cleanId]: entry } }]);
    } else {
      controller.applyOperations([
        { op: 'add', path: `/${categoryKey}/${escapeJsonPointerSegment(cleanId)}`, value: entry }
      ]);
    }
    editorStore.selectItem(cleanId);
  };

  const handleDuplicate = async (key: string): Promise<void> => {
    const newId = await dialogService.prompt({
      title: `Duplicate "${key}"`,
      defaultValue: `${key}_copy`,
      placeholder: 'Enter a unique ID',
      confirmLabel: 'Duplicate',
      validator: (val) => validateNewDictionaryKey(val.trim(), dict)
    });
    if (!newId) return;
    const cleanId = newId.trim();
    const copy = JSON.parse(JSON.stringify(dict[key])) as unknown;
    if (copy && typeof copy === 'object' && !Array.isArray(copy)) {
      const rec = copy as Record<string, unknown>;
      if ('id' in rec) rec.id = cleanId;
      if (typeof rec.name === 'string') rec.name = `${rec.name} (Copy)`;
      if (typeof rec.title === 'string') rec.title = `${rec.title} (Copy)`;
    }
    controller.applyOperations([
      { op: 'add', path: `/${categoryKey}/${escapeJsonPointerSegment(cleanId)}`, value: copy }
    ]);
    editorStore.selectItem(cleanId);
  };

  const handleDelete = async (key: string): Promise<void> => {
    const confirmed = await dialogService.confirm({
      title: 'Delete Entry',
      message: `Are you sure you want to delete "${key}" from ${tab.label}?`,
      confirmLabel: 'Delete',
      danger: true
    });
    if (!confirmed) return;
    controller.applyOperations([{ op: 'remove', path: `/${categoryKey}/${escapeJsonPointerSegment(key)}` }]);
    if (activeItemId === key) {
      editorStore.selectItem(null);
    }
  };

  const refKind = resolveCategoryReferenceKind(categoryKey);

  return (
    <aside className="ui-editor-sidebar" style={{ width: `${sidebarWidth}px` }} aria-label={`${tab.label} Entries`}>
      <div className="ui-editor-sidebar__header">
        <TextInput
          type="search"
          value={searchFilter}
          placeholder={`Filter ${tab.label}...`}
          ariaLabel={`Filter ${tab.label}`}
          onInput={(val) => editorStore.setSearchFilter(val)}
        />
        <Button size="sm" variant="primary" onClick={() => void handleAdd()}>
          + Add
        </Button>
      </div>

      <div
        ref={listRef}
        className="ui-editor-sidebar__list"
        role="listbox"
        aria-label={tab.label}
        onKeyDown={roving.handleKeyDown}
      >
        {keys.length === 0 ? (
          <div className="ui-editor-sidebar__empty">No matching entries.</div>
        ) : (
          keys.map((key, idx) => {
            const rawItem = dict[key];
            const itemObj =
              rawItem && typeof rawItem === 'object' && !Array.isArray(rawItem)
                ? (rawItem as Record<string, unknown>)
                : null;
            const displayLabel =
              (typeof itemObj?.name === 'string' && itemObj.name) ||
              (typeof itemObj?.title === 'string' && itemObj.title) ||
              key;
            const glyph = (typeof itemObj?.glyph === 'string' && itemObj.glyph) || '•';
            const fg = typeof itemObj?.fg === 'string' ? itemObj.fg : undefined;
            const bg = typeof itemObj?.bg === 'string' ? itemObj.bg : undefined;
            const isActive = activeItemId === key;

            return (
              <div
                key={key}
                className={`ui-editor-sidebar__item ${isActive ? 'is-active' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer?.setData('application/x-editor-ref', JSON.stringify({ id: key, category: tab.id }));
                  if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'link';
                  }
                }}
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  tabIndex={roving.getTabIndex(idx)}
                  className="ui-editor-sidebar__item-btn"
                  onClick={() => {
                    roving.setActiveIndex(idx);
                    editorStore.selectItem(key);
                  }}
                  title={`${displayLabel} (${key})`}
                >
                  <span
                    className="ui-editor-sidebar__glyph"
                    style={{
                      ...(fg ? { color: fg } : {}),
                      ...(bg ? { backgroundColor: bg } : {})
                    }}
                  >
                    {glyph}
                  </span>
                  <span className="ui-editor-sidebar__name">{displayLabel}</span>
                </button>
                <div className="ui-editor-sidebar__actions">
                  <IconButton
                    ariaLabel={`Where Used for ${key}`}
                    title="Find Where Used"
                    onClick={() => editorStore.setWhereUsedTarget({ kind: refKind, id: key })}
                  >
                    🔍
                  </IconButton>
                  <IconButton
                    ariaLabel={`Duplicate ${key}`}
                    title="Duplicate"
                    onClick={() => void handleDuplicate(key)}
                  >
                    📋
                  </IconButton>
                  <IconButton
                    ariaLabel={`Delete ${key}`}
                    title="Delete"
                    variant="danger"
                    onClick={() => void handleDelete(key)}
                  >
                    ✕
                  </IconButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
