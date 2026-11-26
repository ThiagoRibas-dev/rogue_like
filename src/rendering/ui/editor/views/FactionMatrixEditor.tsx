import type { JSX } from 'preact';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { FactionRelationEnum } from '../../../../types/campaign.types.ts';
import type { PatchOperation } from '../../../../utils/json-patch.ts';
import { Button, IconButton } from '../../primitives/Button.tsx';
import { Select } from '../../primitives/FormControls.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';
import { escapeJsonPointerSegment } from '../editor_store.ts';

/** Props for `<FactionMatrixEditor />`. */
export interface FactionMatrixEditorProps {
  readonly controller: EditorController;
  readonly basePath: string;
}

/**
 * 2D Preact Faction Relations Matrix grid styled via semantic `--ui-*` status classes.
 */
export function FactionMatrixEditor({ controller, basePath }: FactionMatrixEditorProps): JSX.Element {
  const doc = controller.getDocument();
  const factionIds = Object.keys(doc.factions);

  const handleAddFaction = async (): Promise<void> => {
    const newId = await dialogService.prompt({
      title: 'New Faction',
      placeholder: 'Enter a unique faction ID',
      confirmLabel: 'Create',
      validator: (val) => {
        const clean = val.trim();
        if (!/^[a-z0-9_-]+$/.test(clean)) return 'ID must be lowercase alphanumeric, dashes, or underscores.';
        if (factionIds.includes(clean)) return 'A faction with that ID already exists.';
        return null;
      }
    });
    if (!newId) return;
    const cleanId = newId.trim();
    const ops: PatchOperation[] = [];
    const newRow: Record<string, string> = {};
    for (const existingId of factionIds) {
      newRow[existingId] = 'neutral';
    }
    newRow[cleanId] = 'friendly';
    ops.push({ op: 'add', path: `${basePath}/${escapeJsonPointerSegment(cleanId)}`, value: newRow });
    for (const existingId of factionIds) {
      ops.push({
        op: 'add',
        path: `${basePath}/${escapeJsonPointerSegment(existingId)}/${escapeJsonPointerSegment(cleanId)}`,
        value: 'neutral'
      });
    }
    controller.applyOperations(ops);
  };

  const handleRemoveFaction = async (rowId: string): Promise<void> => {
    const ok = await dialogService.confirm({
      title: 'Remove Faction',
      message: `Completely remove faction "${rowId}" and all matrix entries?`,
      confirmLabel: 'Remove',
      danger: true
    });
    if (!ok) return;

    const ops: PatchOperation[] = [{ op: 'remove', path: `${basePath}/${escapeJsonPointerSegment(rowId)}` }];
    for (const otherId of factionIds) {
      if (otherId !== rowId) {
        ops.push({
          op: 'remove',
          path: `${basePath}/${escapeJsonPointerSegment(otherId)}/${escapeJsonPointerSegment(rowId)}`
        });
      }
    }
    controller.applyOperations(ops);
  };

  const relationOptions = FactionRelationEnum.options.map((opt) => ({
    value: opt,
    label: opt.toUpperCase()
  }));

  return (
    <div className="ui-editor-factions">
      <div className="ui-editor-factions__header">
        <h3>Faction Relations Matrix</h3>
        <Button size="sm" variant="primary" onClick={() => void handleAddFaction()}>
          + Add Faction
        </Button>
      </div>

      {factionIds.length === 0 ? (
        <div className="ui-editor-muted">No factions defined.</div>
      ) : (
        <div className="ui-editor-factions__table-wrap">
          <table className="ui-editor-factions__table">
            <thead>
              <tr>
                <th />
                {factionIds.map((id) => (
                  <th key={id}>{id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {factionIds.map((rowId) => (
                <tr key={rowId}>
                  <th>
                    <div className="ui-editor-factions__row-head">
                      <span>{rowId}</span>
                      <IconButton
                        ariaLabel={`Remove faction ${rowId}`}
                        variant="danger"
                        onClick={() => void handleRemoveFaction(rowId)}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </th>
                  {factionIds.map((colId) => {
                    if (rowId === colId) {
                      return (
                        <td key={colId} className="ui-editor-factions__diag">
                          —
                        </td>
                      );
                    }
                    const currentRelation = doc.factions[rowId]?.[colId] ?? 'neutral';
                    return (
                      <td key={colId}>
                        <Select
                          className={`ui-editor-rel-select is-${currentRelation}`}
                          value={currentRelation}
                          options={relationOptions}
                          ariaLabel={`Relation ${rowId} to ${colId}`}
                          onChange={(next) =>
                            controller.applyOperations([
                              {
                                op: 'replace',
                                path: `${basePath}/${escapeJsonPointerSegment(rowId)}/${escapeJsonPointerSegment(colId)}`,
                                value: next
                              }
                            ])
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
