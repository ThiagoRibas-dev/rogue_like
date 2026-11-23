import type { JSX } from 'preact';
import { getComponent } from '../../../core/ecs.ts';
import { returnToMainMenu } from '../../../core/session/session_dom.ts';
import { triggerReplayDownload } from '../../../core/session/session_settings.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel } from '../primitives/Panel.tsx';

/**
 * Declarative Game Over modal displaying player level, area, final combat chronicle messages,
 * and replay download option.
 */
export function GameOverModal(): JSX.Element | null {
  const gameState = useUiSelector((s) => s.gameState);
  if (!gameState || gameState.uiMode !== UIMode.GameOver) {
    return null;
  }

  const player = gameState.entities.find((id) => getComponent(gameState, id, ComponentType.Player));
  const level = player ? (getComponent(gameState, player, ComponentType.Fighter)?.level ?? 1) : 1;
  const areaName = gameState.campaign.areas[gameState.currentAreaId]?.name ?? gameState.currentAreaId;
  const lastMessages = gameState.messages.slice(-5);

  return (
    <ModalShell
      title="You Have Fallen"
      subtitle={`Reached Level ${level} in ${areaName}`}
      size="md"
      onClose={(): void => returnToMainMenu()}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={(): void => triggerReplayDownload()}>
            Download Run Replay
          </Button>
          <Button variant="primary" size="md" onClick={(): void => returnToMainMenu()}>
            Return to Main Menu
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <p className="ui-selection-detail-desc">
          Your expedition ended at Level {level} inside {areaName}.
        </p>
        <Panel title="Final Chronicle Entries">
          <div className="ui-gameover-log" role="log" aria-label="Final combat messages">
            {lastMessages.length === 0 ? (
              <span>No final chronicle messages recorded.</span>
            ) : (
              lastMessages.map((msg, idx) => (
                <div key={`death_msg_${idx}`} className={msg.cssClass ? `log-entry ${msg.cssClass}` : 'log-entry'}>
                  {msg.text}
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </ModalShell>
  );
}
