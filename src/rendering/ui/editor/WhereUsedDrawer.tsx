import type { JSX } from 'preact';
import { buildReferenceIndex, queryUsages } from '../../../editor/reference_index.ts';
import { IconButton } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { editorStore, useEditorSelector } from './editor_store.ts';

/**
 * Right-hand Preact drawer displaying every campaign reference pointing at the inspected entry.
 */
export function WhereUsedDrawer(): JSX.Element | null {
  const controller = useEditorSelector((s) => s.controller);
  const target = useEditorSelector((s) => s.whereUsedTarget);
  const docVersion = useEditorSelector((s) => s.documentVersion);
  void docVersion;

  if (!controller || !target) return null;

  const index = buildReferenceIndex(controller.getDocument());
  const usages = queryUsages(index, target.kind, target.id);

  return (
    <aside className="ui-editor-where-used" aria-label={`Where Used: ${target.kind}:${target.id}`}>
      <div className="ui-editor-where-used__header">
        <div>
          <h3>Where Used</h3>
          <div className="ui-editor-muted">
            {target.kind}: <strong>{target.id}</strong>
          </div>
        </div>
        <IconButton ariaLabel="Close Where Used drawer" onClick={() => editorStore.setWhereUsedTarget(null)}>
          ✕
        </IconButton>
      </div>

      {usages.length === 0 ? (
        <p className="ui-editor-muted">No usages found for this reference.</p>
      ) : (
        <>
          <div className="ui-editor-badge-row">
            <Badge tone="accent">
              {usages.length} reference{usages.length === 1 ? '' : 's'}
            </Badge>
          </div>
          <ul className="ui-editor-where-used__list">
            {usages.map((usage, idx) => (
              <li key={`${usage.sourcePath}_${idx}`}>
                <button
                  type="button"
                  className="ui-editor-where-used__row"
                  onClick={() => editorStore.navigateToPath(usage.sourcePath)}
                >
                  {usage.sourcePath}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}
