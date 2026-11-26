import type { JSX } from 'preact';
import { createToggleFactionsAction } from '../../../actions/core.actions.ts';
import {
  DEFAULT_STANDING_FRIENDLY_THRESHOLD,
  DEFAULT_STANDING_HOSTILE_THRESHOLD
} from '../../../constants/reputation.constants.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { ComponentType, type MemoryComponent } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, type BadgeTone } from '../primitives/DataDisplay.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

/**
 * Factions & Reputation modal rendering current faction standings with semantic status tones.
 */
export function FactionsModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Factions) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const memory = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent | undefined;
  const factionIds = Object.keys(state.campaign.factions);
  const friendlyThreshold =
    state.campaign.rules.reputation?.friendlyStandingThreshold ?? DEFAULT_STANDING_FRIENDLY_THRESHOLD;
  const hostileThreshold =
    state.campaign.rules.reputation?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD;

  const handleClose = (): void => {
    queuePlayerIntent(createToggleFactionsAction(playerId));
  };

  return (
    <ModalShell
      title="Factions & Standings"
      subtitle="Your diplomatic standing across regional powers"
      size="md"
      onClose={handleClose}
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div className="ui-card-stack">
        {factionIds.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ui-text-muted)' }}>No known factions.</div>
        ) : (
          factionIds.map((factionId) => {
            const standing = memory?.factionStandings[factionId] ?? 0;
            const factionDef = state.campaign.factions[factionId];

            let tone: BadgeTone = 'neutral';
            let relationText = 'Neutral';
            if (standing >= friendlyThreshold) {
              tone = 'success';
              relationText = 'Friendly';
            } else if (standing <= hostileThreshold) {
              tone = 'danger';
              relationText = 'Hostile';
            } else if (standing < 0) {
              tone = 'warning';
              relationText = 'Unfriendly';
            } else if (standing > 0) {
              tone = 'info';
              relationText = 'Amicable';
            }

            return (
              <div key={factionId} className="ui-faction-row">
                <strong>{factionDef?.name ?? factionId}</strong>
                <Badge tone={tone}>{`${relationText} (${standing})`}</Badge>
              </div>
            );
          })
        )}
      </div>
    </ModalShell>
  );
}
