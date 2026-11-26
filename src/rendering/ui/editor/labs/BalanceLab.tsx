import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { type BalanceReport, runBalanceSimulations } from '../../../../editor/balance_simulator.ts';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { FormField, NumberInput } from '../../primitives/FormControls.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';

const DEFAULT_BALANCE_RUNS = 50;
const MIN_BALANCE_RUNS = 1;
const MAX_BALANCE_RUNS = 200;
const LOW_WIN_RATE_PCT = 40;
const HIGH_WIN_RATE_PCT = 90;
const MIN_HUNGER_TURNS = 200;
const MAX_HUNGER_TURNS = 1200;

/** Props for `<BalanceLab />`. */
export interface BalanceLabProps {
  readonly controller: EditorController;
}

/**
 * Automated Balance QA simulator computing combat win-rates, hunger survival pressure, and scheme pacing.
 */
export function BalanceLab({ controller }: BalanceLabProps): JSX.Element {
  const [runs, setRuns] = useState<number>(DEFAULT_BALANCE_RUNS);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [report, setReport] = useState<BalanceReport | null>(null);

  const handleRun = (): void => {
    setIsRunning(true);
    setTimeout(() => {
      try {
        const nextReport = runBalanceSimulations(controller.getDocument(), runs);
        setReport(nextReport);
      } catch (err: unknown) {
        void dialogService.alert({
          title: 'Balance Simulation Failed',
          message: err instanceof Error ? err.message : String(err)
        });
      } finally {
        setIsRunning(false);
      }
    }, 30);
  };

  const winPct = report ? report.combat.victoryRate * 100 : 0;
  const winTone = winPct < LOW_WIN_RATE_PCT ? 'danger' : winPct > HIGH_WIN_RATE_PCT ? 'warning' : 'success';
  const winNotice =
    winPct < LOW_WIN_RATE_PCT
      ? 'Extreme Danger (Player dies frequently)'
      : winPct > HIGH_WIN_RATE_PCT
        ? 'Too Easy (Monster poses no threat)'
        : 'Balanced (Good challenge margin)';

  const starveTurns = report?.hunger.avgTurnsToStarve ?? 0;
  const starveTone = starveTurns < MIN_HUNGER_TURNS ? 'danger' : starveTurns > MAX_HUNGER_TURNS ? 'warning' : 'success';
  const starveNotice =
    starveTurns < MIN_HUNGER_TURNS
      ? 'Extreme starvation pressure'
      : starveTurns > MAX_HUNGER_TURNS
        ? 'Low starvation pressure (energy is cheap)'
        : 'Moderate survival pressure';

  return (
    <div className="ui-editor-lab-pane">
      <div className="ui-editor-lab-controls">
        <FormField label="Simulation Runs">
          <NumberInput
            value={runs}
            min={MIN_BALANCE_RUNS}
            max={MAX_BALANCE_RUNS}
            ariaLabel="Balance Simulation Runs"
            onChange={setRuns}
          />
        </FormField>
        <div className="ui-editor-lab-actions">
          <Button variant="primary" disabled={isRunning} onClick={handleRun}>
            {isRunning ? '⏳ Running Sim...' : '▶ Run Balance Pass'}
          </Button>
        </div>
      </div>

      {!report ? (
        <div className="ui-editor-placeholder">Click &quot;Run Balance Pass&quot; to execute automated QA metrics.</div>
      ) : (
        <>
          <div className="ui-editor-lab-section">
            <h4>⚔ Combat Arena Balance</h4>
            <div className="ui-editor-metrics-grid">
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Player Victory Rate</div>
                <strong>{winPct.toFixed(0)}%</strong>
                <Badge tone={winTone}>{winNotice}</Badge>
              </div>
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Avg Fight Duration</div>
                <strong>{report.combat.avgTurns.toFixed(1)}</strong>
                <div className="ui-editor-muted">turns to resolve</div>
              </div>
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Avg Health Lost</div>
                <strong>{report.combat.avgHpLost.toFixed(1)}</strong>
                <div className="ui-editor-muted">HP per win</div>
              </div>
            </div>
          </div>

          <div className="ui-editor-lab-section">
            <h4>🍖 Hunger &amp; Starvation Pressure</h4>
            <div className="ui-editor-metrics-grid">
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Turns to Starve</div>
                <strong>{starveTurns.toFixed(0)}</strong>
                <Badge tone={starveTone}>{starveNotice}</Badge>
              </div>
            </div>
          </div>

          <div className="ui-editor-lab-section">
            <h4>♟ Nemesis Scheme Pacing (500 Turns)</h4>
            <div className="ui-editor-metrics-grid">
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Scheme Escalations</div>
                <strong>{report.schemes.avgEscalations.toFixed(2)}</strong>
                <div className="ui-editor-muted">avg phase advancements</div>
              </div>
              <div className="ui-editor-metric-card">
                <div className="ui-editor-muted">Conspiracy Awareness</div>
                <strong>{report.schemes.avgConspiracyAwareness.toFixed(1)}</strong>
                <div className="ui-editor-muted">avg mastermind progress</div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
