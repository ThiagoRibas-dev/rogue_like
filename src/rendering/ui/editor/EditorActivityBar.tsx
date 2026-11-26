import type { JSX } from 'preact';
import { getRuleset } from '../../../rulesets/registry.ts';
import { VIEW_GROUPS } from '../../editor/editor_config.ts';
import { editorStore, useEditorSelector } from './editor_store.ts';

/**
 * Left vertical Activity Bar mapping auto-discovered `VIEW_GROUPS` scoped by active ruleset.
 */
export function EditorActivityBar(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const activeGroupId = useEditorSelector((s) => s.activeGroupId);
  const docVersion = useEditorSelector((s) => s.documentVersion);
  void docVersion;

  if (!controller) return null;

  const doc = controller.getDocument();
  const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);

  return (
    <nav className="ui-editor-activity-bar" aria-label="Campaign Editor Sections">
      {activeGroups.map((group) => {
        const isActive = activeGroupId === group.id;
        return (
          <button
            key={group.id}
            type="button"
            className={`ui-editor-activity-btn ${isActive ? 'is-active' : ''}`}
            data-group={group.id}
            aria-pressed={isActive}
            title={group.description ? `${group.label}\n\n${group.description}` : group.label}
            onClick={() => {
              if (activeGroupId !== group.id) {
                editorStore.selectGroup(group.id);
              }
            }}
          >
            <span className="ui-editor-activity-btn__icon" aria-hidden="true">
              {group.icon}
            </span>
            <span className="ui-editor-activity-btn__label">{group.label.split(' ')[0] ?? group.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
