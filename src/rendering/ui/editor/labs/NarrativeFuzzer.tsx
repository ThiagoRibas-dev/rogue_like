import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { FuzzerReport, FuzzerTelemetry } from '../../../../types/fuzzer.types.ts';
import { runFuzzerOffload } from '../../../../worker/worker_bridge.ts';
import { Accordion } from '../../primitives/Accordion.tsx';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { Checkbox, FormField, NumberInput, TextInput } from '../../primitives/FormControls.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';

const DEFAULT_BATCH_RUNS = 10;
const MIN_BATCH_RUNS = 1;
const MAX_BATCH_RUNS = 200;
const DEFAULT_MAX_TURNS = 500;
const MIN_MAX_TURNS = 50;
const MAX_MAX_TURNS = 5000;

/** Props for `<NarrativeFuzzer />`. */
export interface NarrativeFuzzerProps {
  readonly controller: EditorController;
}

/**
 * Emergent Narrative Fuzzer running batch headless playthroughs via worker offload and allowing visual seed replay.
 */
export function NarrativeFuzzer({ controller }: NarrativeFuzzerProps): JSX.Element {
  const [runs, setRuns] = useState<number>(DEFAULT_BATCH_RUNS);
  const [maxTurns, setMaxTurns] = useState<number>(DEFAULT_MAX_TURNS);
  const [seedOverride, setSeedOverride] = useState<string>('');
  const [stopOnFirstError, setStopOnFirstError] = useState<boolean>(true);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progressText, setProgressText] = useState<string>('');
  const [report, setReport] = useState<FuzzerReport | null>(null);
  const [crashError, setCrashError] = useState<string | null>(null);

  const handleRun = async (): Promise<void> => {
    setIsRunning(true);
    setCrashError(null);
    setProgressText('Running headless simulations...');

    try {
      const nextReport = await runFuzzerOffload(
        controller.getDocument(),
        {
          runs,
          maxTurns,
          seedOverride: seedOverride.trim() || undefined,
          stopOnFirstError
        },
        (progress) => {
          setProgressText(`${progress.message} (${Math.round(progress.progress * 100)}%)`);
        }
      );
      setReport(nextReport);
    } catch (err: unknown) {
      setCrashError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  };

  const handleReplay = async (seed: string): Promise<void> => {
    const confirmed = await dialogService.confirm({
      title: 'Replay Seed Visually?',
      message: `Save current workspace and visually playtest with Seed: ${seed}?`,
      confirmLabel: 'Launch Playtest'
    });
    if (!confirmed) return;

    sessionStorage.setItem('editor_active_document', JSON.stringify(controller.getDocument()));
    sessionStorage.setItem('editor_playtest', 'true');
    sessionStorage.setItem('editor_playtest_seed', seed);
    window.location.reload();
  };

  return (
    <div className="ui-editor-lab-pane">
      <div className="ui-editor-lab-controls">
        <FormField label="Batch Runs">
          <NumberInput
            value={runs}
            min={MIN_BATCH_RUNS}
            max={MAX_BATCH_RUNS}
            ariaLabel="Batch Runs"
            onChange={setRuns}
          />
        </FormField>

        <FormField label="Max Turns / Run">
          <NumberInput
            value={maxTurns}
            min={MIN_MAX_TURNS}
            max={MAX_MAX_TURNS}
            ariaLabel="Max Turns per Run"
            onChange={setMaxTurns}
          />
        </FormField>

        <FormField label="Seed Override">
          <TextInput value={seedOverride} placeholder="Random" ariaLabel="Seed Override" onInput={setSeedOverride} />
        </FormField>

        <Checkbox label="Stop on first error" checked={stopOnFirstError} onChange={setStopOnFirstError} />

        <div className="ui-editor-lab-actions">
          <Button variant="primary" disabled={isRunning} onClick={() => void handleRun()}>
            {isRunning ? `⏳ ${progressText || 'Running...'}` : '▶ Run Fuzzer'}
          </Button>
        </div>
      </div>

      {crashError ? <div className="ui-editor-error-box">Fuzzer Crash: {crashError}</div> : null}

      {!report && !isRunning ? (
        <div className="ui-editor-placeholder">Click &quot;Run Fuzzer&quot; to start batch testing.</div>
      ) : null}

      {report ? (
        <>
          <div className="ui-editor-metrics-grid">
            <div className="ui-editor-metric-card">
              <div className="ui-editor-muted">Passed / Failed</div>
              <strong>
                {report.aggregate.successfulRuns} / {report.aggregate.failedRuns}
              </strong>
            </div>
            <div className="ui-editor-metric-card">
              <div className="ui-editor-muted">Avg Turns Elapsed</div>
              <strong>{report.aggregate.avgTurns.toFixed(0)}</strong>
            </div>
            <div className="ui-editor-metric-card">
              <div className="ui-editor-muted">Drama Events / kTurns</div>
              <strong>{report.aggregate.avgDramaEventsPerHour.toFixed(1)}</strong>
            </div>
            <div className="ui-editor-metric-card">
              <div className="ui-editor-muted">Clue-to-Event Ratio</div>
              <strong>{report.aggregate.clueToEventRatio.toFixed(2)}</strong>
            </div>
            <div className="ui-editor-metric-card">
              <div className="ui-editor-muted">Avg Save Size</div>
              <strong>{(report.aggregate.avgSaveSize / 1024).toFixed(1)} KB</strong>
            </div>
          </div>

          <div className="ui-editor-lab-section">
            <h4>Simulated Runs ({report.results.length})</h4>
            <div className="ui-editor-fuzzer-list">
              {report.results.map((run: FuzzerTelemetry, idx: number) => (
                <Accordion
                  key={`${run.seed}_${idx}`}
                  title={`Run #${idx + 1} • Seed: ${run.seed} (${run.events.length} events)`}
                  defaultExpanded={Boolean(run.error)}
                  badge={
                    <Badge tone={run.error ? 'danger' : 'success'}>
                      {run.error ? `FAIL: ${run.error.type.toUpperCase()}` : 'PASS'}
                    </Badge>
                  }
                >
                  <div className="ui-editor-row--end">
                    <Button size="sm" variant="primary" onClick={() => void handleReplay(run.seed)}>
                      ▶ Replay Visually
                    </Button>
                  </div>
                  {run.error ? (
                    <div className="ui-editor-error-box">
                      Error at Turn {run.error.turn}: {run.error.message}
                    </div>
                  ) : null}
                  <pre className="ui-editor-log ui-editor-log--compact">
                    {run.events.length > 0 ? run.events.join('\n') : 'No narrative events recorded.'}
                  </pre>
                </Accordion>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
