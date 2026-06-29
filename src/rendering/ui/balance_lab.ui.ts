import type { EditorController } from '../editor_ui.ts';
import { runBalanceSimulations } from '../../editor/balance_simulator.ts';

/**
 * Renders the Balance Lab simulation tab in the Simulation Lab.
 */
export function renderBalanceLab(controller: EditorController, container: HTMLElement): void {
  container.innerHTML = `
    <div class="workspace-header">
      <h2 class="workspace-title">Automated Balance QA</h2>
    </div>
    <div style="padding: 1rem; display: flex; flex-direction: column; gap: 1rem; height: 100%;">
      <!-- Controls -->
      <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; background: var(--bg-darker); border: 1px solid var(--border-color); padding: 1rem; border-radius: 4px;">
        <div>
          <label style="display: block; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem;">Simulation Runs</label>
          <input type="number" id="balance-runs" class="editor-input" style="width: 80px;" value="50" min="1" max="200" />
        </div>
        <div style="margin-top: 1.25rem; margin-left: auto;">
          <button id="btn-balance-run" class="editor-btn" style="padding: 0.5rem 1.25rem;">▶ Run Balance Pass</button>
        </div>
      </div>

      <!-- Results View -->
      <div id="balance-output-container" style="display: none; flex-direction: column; gap: 1.5rem; flex-grow: 1;">
        <!-- Combat Balance -->
        <div style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem;">
          <h3 style="margin: 0 0 1rem 0; font-size: 1rem; color: var(--text-bright); border-bottom: 1px solid #333; padding-bottom: 0.25rem;">⚔ Combat Arena Balance (Orc vs Player)</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Player Victory Rate</div>
              <div id="balance-metric-winrate" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div id="balance-warning-winrate" style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;"></div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Avg Fight Duration</div>
              <div id="balance-metric-duration" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">turns to resolve</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Avg Health Lost</div>
              <div id="balance-metric-hplost" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">HP per win</div>
            </div>
          </div>
        </div>

        <!-- Hunger System -->
        <div style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem;">
          <h3 style="margin: 0 0 1rem 0; font-size: 1rem; color: var(--text-bright); border-bottom: 1px solid #333; padding-bottom: 0.25rem;">🍖 Hunger & Starvation Pressure</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Turns to Starve</div>
              <div id="balance-metric-starve" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div id="balance-warning-starve" style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">average gameplay turns</div>
            </div>
          </div>
        </div>

        <!-- Scheme Pacing -->
        <div style="background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; padding: 1rem;">
          <h3 style="margin: 0 0 1rem 0; font-size: 1rem; color: var(--text-bright); border-bottom: 1px solid #333; padding-bottom: 0.25rem;">♟ Nemesis Scheme Pacing (500 Turns)</h3>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Scheme Escalations</div>
              <div id="balance-metric-escalations" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">average phase advancements</div>
            </div>
            <div style="background: rgba(0,0,0,0.3); border: 1px solid #333; border-radius: 4px; padding: 0.75rem; text-align: center;">
              <div style="font-size: 0.8rem; color: var(--text-dim);">Conspiracy Awareness</div>
              <div id="balance-metric-awareness" style="font-size: 1.5rem; font-weight: bold; margin-top: 0.25rem;">-</div>
              <div style="font-size: 0.75rem; color: #888; margin-top: 0.25rem;">average mastermind progress</div>
            </div>
          </div>
        </div>
      </div>

      <div id="balance-placeholder" style="flex-grow: 1; display: flex; align-items: center; justify-content: center; background: var(--bg-darker); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-dim); font-style: italic;">
        Click "Run Balance Pass" to execute automated gameplay balance metrics.
      </div>
    </div>
  `;

  const btnRun = container.querySelector('#btn-balance-run') as HTMLButtonElement | null;
  const runsInp = container.querySelector('#balance-runs') as HTMLInputElement | null;
  const placeholder = container.querySelector('#balance-placeholder') as HTMLElement | null;
  const outputContainer = container.querySelector('#balance-output-container') as HTMLElement | null;

  const metricWinRate = container.querySelector('#balance-metric-winrate') as HTMLElement | null;
  const warningWinRate = container.querySelector('#balance-warning-winrate') as HTMLElement | null;
  const metricDuration = container.querySelector('#balance-metric-duration') as HTMLElement | null;
  const metricHpLost = container.querySelector('#balance-metric-hplost') as HTMLElement | null;
  const metricStarve = container.querySelector('#balance-metric-starve') as HTMLElement | null;
  const warningStarve = container.querySelector('#balance-warning-starve') as HTMLElement | null;
  const metricEscalations = container.querySelector('#balance-metric-escalations') as HTMLElement | null;
  const metricAwareness = container.querySelector('#balance-metric-awareness') as HTMLElement | null;

  btnRun?.addEventListener('click', () => {
    if (!runsInp) return;

    if (btnRun) {
      btnRun.disabled = true;
      btnRun.textContent = '⏳ Running Sim...';
    }

    if (placeholder) placeholder.style.display = 'none';
    if (outputContainer) outputContainer.style.display = 'flex';

    setTimeout(() => {
      try {
        const runs = parseInt(runsInp.value, 10);
        const report = runBalanceSimulations(controller.getDocument(), runs);

        // 1. Render Win Rate
        if (metricWinRate && warningWinRate) {
          const rate = report.combat.victoryRate * 100;
          metricWinRate.textContent = `${rate.toFixed(0)}%`;

          if (rate < 40) {
            metricWinRate.style.color = '#e74c3c'; // Danger red
            warningWinRate.textContent = '🛑 Extreme Danger (Player dies frequently)';
            warningWinRate.style.color = '#e74c3c';
          } else if (rate > 90) {
            metricWinRate.style.color = '#f1c40f'; // Warning yellow
            warningWinRate.textContent = '⚠️ Too Easy (Monster poses no threat)';
            warningWinRate.style.color = '#f1c40f';
          } else {
            metricWinRate.style.color = '#2ecc71'; // Balanced green
            warningWinRate.textContent = '🟢 Balanced (Good challenge margin)';
            warningWinRate.style.color = '#2ecc71';
          }
        }

        // 2. Render Combat Duration & HP Lost
        if (metricDuration) {
          metricDuration.textContent = report.combat.avgTurns.toFixed(1);
        }
        if (metricHpLost) {
          metricHpLost.textContent = report.combat.avgHpLost.toFixed(1);
        }

        // 3. Render Hunger Starvation
        if (metricStarve && warningStarve) {
          const turns = report.hunger.avgTurnsToStarve;
          metricStarve.textContent = turns.toFixed(0);

          if (turns < 200) {
            warningStarve.textContent = '⚠️ Extreme Starvation pressure!';
            warningStarve.style.color = '#e74c3c';
          } else if (turns > 1200) {
            warningStarve.textContent = '⚠️ Low Starvation pressure (Energy is cheap)';
            warningStarve.style.color = '#f1c40f';
          } else {
            warningStarve.textContent = '🟢 Moderate survival pressure';
            warningStarve.style.color = '#2ecc71';
          }
        }

        // 4. Render Schemes
        if (metricEscalations) {
          metricEscalations.textContent = report.schemes.avgEscalations.toFixed(2);
        }
        if (metricAwareness) {
          metricAwareness.textContent = report.schemes.avgConspiracyAwareness.toFixed(1);
        }
      } catch (err) {
        console.error(err);
        alert(`Balance Simulation failed: ${(err as Error).message}`);
      } finally {
        if (btnRun) {
          btnRun.disabled = false;
          btnRun.textContent = '▶ Run Balance Pass';
        }
      }
    }, 50);
  });
}
