import type { JSX } from 'preact';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { projectHudAlertsList } from '../hud_alerts.ui.ts';

/** Props for `<AlertsStack />`. */
export interface AlertsStackProps {
  readonly state: GameState;
  readonly playerId: EntityId;
}

/**
 * Right-edge RimWorld-style floating alert ribbons stack (turn readiness, critical wounds,
 * visible hostiles/nemeses, hunger, statuses, active quests, and cartridge alerts).
 */
export function AlertsStack({ state, playerId }: AlertsStackProps): JSX.Element {
  const alerts = projectHudAlertsList(state, playerId);

  return (
    <div className="ui-alerts-stack" role="region" aria-label="Tactical Alerts">
      {alerts.map((alert, idx) => (
        <button
          key={`alert_${alert.label}_${idx}`}
          type="button"
          className="ui-alert-ribbon"
          data-severity={alert.severity}
          onClick={(): void => {
            alert.onClick?.();
          }}
        >
          <span style={{ fontWeight: 700 }}>{alert.label}</span>
          <span style={{ color: 'var(--ui-text-secondary)' }}>{alert.detail}</span>
        </button>
      ))}
    </div>
  );
}
