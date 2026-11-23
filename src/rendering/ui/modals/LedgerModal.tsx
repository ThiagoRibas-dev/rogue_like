import type { JSX } from 'preact';
import { createToggleLedgerAction } from '../../../actions/core.actions.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { getHighImportanceEvents } from '../../../systems/ledger_queries.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

/**
 * Historical World Ledger modal displaying high-importance world events in reverse chronological order.
 */
export function LedgerModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const debugVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Debug]);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  void debugVer;
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Ledger) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const sortedEvents = [...getHighImportanceEvents(state)].reverse();

  const handleClose = (): void => {
    queuePlayerIntent(createToggleLedgerAction(playerId));
  };

  return (
    <ModalShell
      title="World Historical Ledger"
      subtitle="Chronicle of high-importance world events"
      size="lg"
      onClose={handleClose}
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div className="ui-card-stack">
        {sortedEvents.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ui-text-muted)' }}>
            No high importance events recorded yet.
          </div>
        ) : (
          sortedEvents.map((event) => {
            const turn = event.id ? event.id.split('_')[1] : '?';
            return (
              <div key={event.id} className="ui-ledger-entry">
                <strong style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-accent-secondary)' }}>
                  {`Turn ${turn}`}
                </strong>
                <span style={{ fontSize: 'var(--ui-font-sm)' }}>{event.summary || event.type}</span>
                <span
                  style={{
                    fontSize: '11px',
                    fontFamily: 'var(--ui-font-mono)',
                    color: 'var(--ui-text-muted)'
                  }}
                >
                  {`ID: ${event.id}`}
                </span>
              </div>
            );
          })
        )}
      </div>
    </ModalShell>
  );
}
