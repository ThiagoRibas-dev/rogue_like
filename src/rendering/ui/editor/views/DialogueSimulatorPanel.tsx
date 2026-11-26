import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { evaluateCondition } from '../../../../systems/trigger.system.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { DialogueTree } from '../../../../types/dialogue.types.ts';
import { type GameEvent, GameEventType } from '../../../../types/events.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { Button } from '../../primitives/Button.tsx';
import { FormField, TextInput } from '../../primitives/FormControls.tsx';

interface SimNodeResult {
  readonly nodeId: string;
  readonly options: ReadonlyArray<{ readonly index: number; readonly text: string; readonly passed: boolean }>;
}

/** Props for `<DialogueSimulatorPanel />`. */
export interface DialogueSimulatorPanelProps {
  readonly controller: EditorController;
  readonly tree: DialogueTree;
  readonly basePath: string;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * Pure Preact emergent dialogue condition simulator & inline validation summary.
 */
export function DialogueSimulatorPanel({
  controller,
  tree,
  basePath,
  errors
}: DialogueSimulatorPanelProps): JSX.Element {
  const [factsText, setFactsText] = useState<string>('');
  const [knowledgeText, setKnowledgeText] = useState<string>('');
  const [factionsJson, setFactionsJson] = useState<string>('{"goblins": 0}');
  const [simError, setSimError] = useState<string | null>(null);
  const [results, setResults] = useState<ReadonlyArray<SimNodeResult> | null>(null);

  const runMockTest = (): void => {
    let factionsObj: Record<string, number>;
    try {
      const parsed: unknown = JSON.parse(factionsJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setSimError('Faction Standing must be a JSON object mapping faction IDs to numbers.');
        return;
      }
      factionsObj = parsed as Record<string, number>;
      setSimError(null);
    } catch {
      setSimError('Invalid JSON in Faction Standing.');
      return;
    }

    const factsArr = factsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const knowledgeDict: Record<string, { id: string; type: 'secret'; description: string; tags: string[] }> = {};
    for (const k of knowledgeText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      knowledgeDict[k] = { id: k, type: 'secret', description: '', tags: [] };
    }

    const mockState = {
      campaign: { ...controller.getDocument() },
      components: new Map([
        [1 as EntityId, [{ type: ComponentType.Player }]],
        [
          2 as EntityId,
          [
            {
              type: ComponentType.Memory,
              facts: factsArr,
              factionStandings: factionsObj,
              grudges: [],
              knowledge: knowledgeDict
            }
          ]
        ]
      ])
    } as unknown as GameState;

    const dummyEvent = { type: GameEventType.EntityMoved } as unknown as GameEvent;
    const nodeResults: SimNodeResult[] = [];

    for (const [nodeId, node] of Object.entries(tree.nodes || {})) {
      const optResults = (node.options || []).map((opt, idx) => {
        let passed = true;
        for (const cond of opt.conditions || []) {
          const evalCond = {
            ...cond,
            _npcEntityId: 2 as EntityId,
            entityId: 2 as EntityId,
            _playerEntityId: 1 as EntityId
          };
          if (!evaluateCondition(mockState, dummyEvent, evalCond)) {
            passed = false;
            break;
          }
        }
        return { index: idx, text: opt.text, passed };
      });
      nodeResults.push({ nodeId, options: optResults });
    }

    setResults(nodeResults);
  };

  const treeErrors = (errors ?? []).filter((e) => e.path.startsWith(basePath));

  return (
    <div className="ui-editor-dialogue-sim">
      <h3>Emergent Simulator</h3>
      <p className="ui-editor-muted">Mock NPC memory values to test condition gating on dialogue options.</p>

      <FormField label="Facts (comma separated)">
        <TextInput value={factsText} ariaLabel="Simulator facts" onInput={setFactsText} />
      </FormField>
      <FormField label="Knowledge IDs (comma separated)">
        <TextInput value={knowledgeText} ariaLabel="Simulator knowledge IDs" onInput={setKnowledgeText} />
      </FormField>
      <FormField label="Faction Standing (JSON)" error={simError}>
        <textarea
          className="ui-input ui-editor-json-textarea"
          value={factionsJson}
          aria-label="Simulator faction standings"
          onInput={(e) => setFactionsJson((e.target as HTMLTextAreaElement).value)}
        />
      </FormField>

      <Button variant="primary" size="sm" onClick={runMockTest}>
        Test Validity (Mock)
      </Button>

      {results ? (
        <div className="ui-editor-dialogue-sim__results">
          {results.map((node) => (
            <div key={node.nodeId} className="ui-editor-dialogue-sim__node">
              <strong>Node: {node.nodeId}</strong>
              {node.options.length === 0 ? (
                <div className="ui-editor-muted">No options.</div>
              ) : (
                node.options.map((o) => (
                  <div key={o.index} className={o.passed ? 'is-pass' : 'is-fail'}>
                    [{o.passed ? 'PASS' : 'BLOCKED'}] Option {o.index}: {o.text}
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      ) : null}

      {treeErrors.length > 0 ? (
        <div className="ui-editor-error-box">
          <strong>Validation Errors ({treeErrors.length})</strong>
          {treeErrors.map((err, i) => (
            <div key={`${err.path}_${i}`}>
              {err.path}: {err.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
