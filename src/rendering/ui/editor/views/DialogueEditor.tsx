import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { DialogueOptionSchema, type DialogueTree } from '../../../../types/dialogue.types.ts';
import type { PatchOperation } from '../../../../utils/json-patch.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { FormField, Select } from '../../primitives/FormControls.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';
import { getReferenceOptions } from '../../ui_utils.ts';
import { escapeJsonPointerSegment } from '../editor_store.ts';
import { ZodFormRenderer } from '../forms/ZodFormRenderer.tsx';
import { DialogueSimulatorPanel } from './DialogueSimulatorPanel.tsx';

/** Props for `<DialogueEditor />`. */
export interface DialogueEditorProps {
  readonly controller: EditorController;
  readonly tree: DialogueTree;
  readonly basePath: string;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * Specialized Dialogue Tree Preact editor pairing node cards, `<ModalShell>` option triggers editor,
 * and `<DialogueSimulatorPanel />`.
 */
export function DialogueEditor({ controller, tree, basePath, errors }: DialogueEditorProps): JSX.Element {
  const [editingOption, setEditingOption] = useState<{ readonly nodeId: string; readonly optIdx: number } | null>(null);

  const doc = controller.getDocument();
  const nodes = tree.nodes || {};
  const rumorOptions = getReferenceOptions('injectRumorId', doc) ?? [];

  const handleAddNode = async (): Promise<void> => {
    const newNodeId = await dialogService.prompt({
      title: 'New Dialogue Node',
      placeholder: 'Enter Node ID',
      confirmLabel: 'Create',
      validator: (val) => {
        const clean = val.trim();
        if (!/^[a-z0-9_-]+$/.test(clean)) return 'ID must be lowercase alphanumeric, dashes, or underscores.';
        if (nodes[clean]) return 'A node with that ID already exists.';
        return null;
      }
    });
    if (!newNodeId) return;
    const cleanId = newNodeId.trim();
    controller.applyOperations([
      {
        op: 'add',
        path: `${basePath}/nodes/${escapeJsonPointerSegment(cleanId)}`,
        value: { id: cleanId, text: 'New text', options: [] }
      }
    ]);
  };

  const handleAddOption = async (nodeId: string, optionCount: number): Promise<void> => {
    const newOptId = await dialogService.prompt({
      title: `New Option in "${nodeId}"`,
      placeholder: 'Enter Option ID',
      confirmLabel: 'Add Option',
      validator: (val) =>
        /^[a-z0-9_-]+$/.test(val.trim()) ? null : 'ID must be lowercase alphanumeric, dashes, or underscores.'
    });
    if (!newOptId) return;
    const cleanId = newOptId.trim();
    controller.applyOperations([
      {
        op: 'add',
        path: `${basePath}/nodes/${escapeJsonPointerSegment(nodeId)}/options/${optionCount}`,
        value: { id: cleanId, text: 'New Option', conditions: [], consequences: [] }
      }
    ]);
  };

  const modalOption =
    editingOption && nodes[editingOption.nodeId]?.options[editingOption.optIdx]
      ? nodes[editingOption.nodeId]!.options[editingOption.optIdx]
      : null;

  return (
    <div className="ui-editor-split">
      <div className="ui-editor-split__left">
        <div className="ui-editor-row--between">
          <h3>Dialogue: {tree.id}</h3>
          <Button size="sm" variant="primary" onClick={() => void handleAddNode()}>
            + Add Node
          </Button>
        </div>

        <div className="ui-editor-node-list">
          {Object.entries(nodes).map(([nodeId, node]) => {
            const safeNodeKey = escapeJsonPointerSegment(nodeId);
            const nodePath = `${basePath}/nodes/${safeNodeKey}`;
            const dynamicType = node.dynamicType ?? 'none';

            return (
              <div key={nodeId} className="ui-editor-node-card" data-field-path={nodePath}>
                <div className="ui-editor-node-card__header">
                  <strong>
                    Node: {nodeId} {nodeId === tree.startNodeId ? <Badge tone="success">START</Badge> : null}
                  </strong>
                </div>

                <FormField label="Dialogue Text">
                  <textarea
                    className="ui-input ui-editor-textarea-sm"
                    value={node.text}
                    aria-label={`Dialogue text for ${nodeId}`}
                    onInput={(e) =>
                      controller.applyOperations(
                        [{ op: 'replace', path: `${nodePath}/text`, value: (e.target as HTMLTextAreaElement).value }],
                        true
                      )
                    }
                  />
                </FormField>

                <FormField label="Dynamic Type">
                  <Select
                    value={dynamicType}
                    ariaLabel={`Dynamic type for ${nodeId}`}
                    options={[
                      { value: 'none', label: 'None (Static)' },
                      { value: 'ask_about', label: 'Type: ask_about' },
                      { value: 'gossip', label: 'Type: gossip' },
                      { value: 'trade', label: 'Type: trade' },
                      { value: 'inject_rumor', label: 'Type: inject_rumor' }
                    ]}
                    onChange={(val) => {
                      const ops: PatchOperation[] = [];
                      if (val === 'none') {
                        if (node.dynamicType !== undefined) ops.push({ op: 'remove', path: `${nodePath}/dynamicType` });
                        if (node.injectRumorId !== undefined)
                          ops.push({ op: 'remove', path: `${nodePath}/injectRumorId` });
                      } else {
                        ops.push({ op: 'add', path: `${nodePath}/dynamicType`, value: val });
                        if (val !== 'inject_rumor' && node.injectRumorId !== undefined) {
                          ops.push({ op: 'remove', path: `${nodePath}/injectRumorId` });
                        }
                      }
                      if (ops.length > 0) controller.applyOperations(ops);
                    }}
                  />
                </FormField>

                {node.dynamicType === 'inject_rumor' ? (
                  <FormField label="Inject Rumor ID">
                    <Select
                      value={node.injectRumorId ?? ''}
                      ariaLabel={`Inject rumor for ${nodeId}`}
                      options={[{ value: '', label: '-- Select a Rumor --' }, ...rumorOptions]}
                      onChange={(val) =>
                        controller.applyOperations([
                          val
                            ? { op: 'add', path: `${nodePath}/injectRumorId`, value: val }
                            : { op: 'remove', path: `${nodePath}/injectRumorId` }
                        ])
                      }
                    />
                  </FormField>
                ) : null}

                <div className="ui-editor-node-card__options">
                  {node.options.map((opt, optIdx) => (
                    <div key={`${nodeId}_opt_${optIdx}`} className="ui-editor-node-card__opt-row">
                      <span>
                        <strong>&gt;</strong> {opt.text}{' '}
                        <em className="ui-editor-muted">(-&gt; {opt.nextNodeId || 'END'})</em>
                      </span>
                      <Button size="sm" onClick={() => setEditingOption({ nodeId, optIdx })}>
                        Edit Triggers
                      </Button>
                    </div>
                  ))}
                  <div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleAddOption(nodeId, node.options.length)}
                    >
                      + Add Option
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-editor-split__right">
        <DialogueSimulatorPanel controller={controller} tree={tree} basePath={basePath} errors={errors} />
      </div>

      {editingOption && modalOption ? (
        <ModalShell
          title={`Edit Option Triggers (${editingOption.nodeId} #${editingOption.optIdx + 1})`}
          size="lg"
          onClose={() => setEditingOption(null)}
          footer={
            <Button variant="primary" onClick={() => setEditingOption(null)}>
              Done
            </Button>
          }
        >
          <ZodFormRenderer
            controller={controller}
            schema={DialogueOptionSchema}
            value={modalOption}
            basePath={`${basePath}/nodes/${escapeJsonPointerSegment(editingOption.nodeId)}/options/${editingOption.optIdx}`}
            errors={errors}
          />
        </ModalShell>
      ) : null}
    </div>
  );
}
