import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { runAIArena } from '../../../../editor/simulation/ai_arena.ts';
import { Button } from '../../primitives/Button.tsx';
import { FormField, NumberInput, Select } from '../../primitives/FormControls.tsx';

const DEFAULT_ARENA_TURNS = 100;
const MIN_ARENA_TURNS = 1;
const MAX_ARENA_TURNS = 1000;

/** Props for `<AiArena />`. */
export interface AiArenaProps {
  readonly controller: EditorController;
}

/**
 * Emergent AI Arena workspace pitting two entity templates against each other head-to-head.
 */
export function AiArena({ controller }: AiArenaProps): JSX.Element {
  const doc = controller.getDocument();
  const actors = Object.values(doc.entities).filter((e) => e.isActor);

  const [actorA, setActorA] = useState<string>(() => actors[0]?.id ?? '');
  const [actorB, setActorB] = useState<string>(() => actors[1]?.id ?? actors[0]?.id ?? '');
  const [maxTurns, setMaxTurns] = useState<number>(DEFAULT_ARENA_TURNS);
  const [logText, setLogText] = useState<string>('Select combatants and run the simulation.');
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const actorOptions = actors.map((a) => ({ value: a.id, label: `${a.name} (${a.id})` }));

  const handleRun = (): void => {
    if (!actorA || !actorB) {
      setLogText('Please select both combatants.');
      return;
    }
    setIsRunning(true);
    setLogText('Running simulation...');

    setTimeout(() => {
      try {
        const result = runAIArena(actorA, actorB, controller.getDocument(), maxTurns);
        setLogText(result.logs.join('\n'));
      } catch (err: unknown) {
        setLogText(`Simulation Error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsRunning(false);
      }
    }, 30);
  };

  return (
    <div className="ui-editor-lab-pane">
      <div className="ui-editor-lab-controls">
        <FormField label="Combatant A">
          <Select value={actorA} ariaLabel="Combatant A" options={actorOptions} onChange={setActorA} />
        </FormField>
        <div className="ui-editor-arena-vs">VS</div>
        <FormField label="Combatant B">
          <Select value={actorB} ariaLabel="Combatant B" options={actorOptions} onChange={setActorB} />
        </FormField>
        <FormField label="Max Turns">
          <NumberInput
            value={maxTurns}
            min={MIN_ARENA_TURNS}
            max={MAX_ARENA_TURNS}
            ariaLabel="Max Turns"
            onChange={setMaxTurns}
          />
        </FormField>
        <div className="ui-editor-lab-actions">
          <Button variant="primary" disabled={isRunning || actors.length === 0} onClick={handleRun}>
            {isRunning ? 'Running...' : '▶ Run Simulation'}
          </Button>
        </div>
      </div>

      <div className="ui-editor-lab-section">
        <h4>Combat Log</h4>
        <pre className="ui-editor-log">{logText}</pre>
      </div>
    </div>
  );
}
