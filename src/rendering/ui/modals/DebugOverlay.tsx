import type { JSX } from 'preact';
import { createToggleDebugAction } from '../../../actions/core.actions.ts';
import { getComponent, getEntitiesAtPosition } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { computeRenderRollingStats, computeTurnRollingStats, perfTracker } from '../../../core/performance.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { ComponentType, type FieldComponent } from '../../../types/components.types.ts';
import {
  type DebugTriggerTraceEvent,
  type GameEvent,
  GameEventType,
  type ReactionResolvedEvent
} from '../../../types/events.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

const MAX_DEBUG_EVENTS = 100;

function formatStandardEvent(event: GameEvent): string {
  switch (event.type) {
    case GameEventType.EntityMoved:
      return `[${event.type}] Entity ${event.entityId} to ${event.x},${event.y}`;
    case GameEventType.EntityDamaged:
      return `[${event.type}] Entity ${event.entityId} took ${event.amount} dmg`;
    case GameEventType.EntityDied:
      return `[${event.type}] Entity ${event.victimId} died`;
    case GameEventType.ItemPickedUp:
      return `[${event.type}] Entity ${event.entityId} picked up ${event.itemId}`;
    case GameEventType.ItemDropped:
      return `[${event.type}] Entity ${event.entityId} dropped ${event.itemId}`;
    case GameEventType.TrapTriggered:
      return `[${event.type}] Entity ${event.entityId} triggered ${event.triggerId}`;
    case GameEventType.TileEntered:
      return `[${event.type}] Entity ${event.entityId} entered tile ${event.tileTag} at ${event.x},${event.y}`;
    default: {
      const { type, ...rest } = event as unknown as Record<string, unknown>;
      return `[${String(type)}] ${JSON.stringify(rest)}`;
    }
  }
}

/**
 * Developer Debug Overlay modal presenting rolling performance telemetry,
 * trigger/reaction event trace ledger, and spatial field metrics under the cursor.
 */
export function DebugOverlay(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const debugVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Debug]);
  void debugVer;

  if (!state || state.uiMode !== UIMode.Debug) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const activeFields = state.entities.filter((id) => {
    const comp = state.components.get(id);
    return comp?.[ComponentType.Field] !== undefined;
  }).length;

  const turnStats = computeTurnRollingStats();
  const renderStats = computeRenderRollingStats();
  const tb = perfTracker.lastTurnBreakdown;
  const rb = perfTracker.lastRenderBreakdown;
  const recentEvents = state.events.slice(-MAX_DEBUG_EVENTS);

  const cursorX = state.inspectMode?.active
    ? state.inspectMode.x
    : state.targetingMode?.active
      ? state.targetingMode.x
      : undefined;
  const cursorY = state.inspectMode?.active
    ? state.inspectMode.y
    : state.targetingMode?.active
      ? state.targetingMode.y
      : undefined;

  const cursorZ = state.inspectMode?.active
    ? (state.inspectMode.z ?? 0)
    : state.targetingMode?.active
      ? (state.targetingMode.z ?? 0)
      : 0;

  const fieldsAtCursor: FieldComponent[] = [];
  if (cursorX !== undefined && cursorY !== undefined) {
    const entitiesAt = getEntitiesAtPosition(state, cursorX, cursorY, cursorZ);
    for (const eId of entitiesAt) {
      const field = getComponent(state, eId, ComponentType.Field) as FieldComponent | undefined;
      if (field) fieldsAtCursor.push(field);
    }
  }

  const handleClose = (): void => {
    queuePlayerIntent(createToggleDebugAction(playerId));
  };

  return (
    <ModalShell
      title="Developer Debug & Event Telemetry"
      subtitle="Rolling frame/turn timings, trigger traces, and spatial field readout"
      size="xl"
      onClose={handleClose}
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
        <div className="ui-debug-perf">
          <div style={{ fontWeight: 700, borderBottom: '1px solid var(--ui-border-subtle)', marginBottom: '4px' }}>
            ⚡ PERF TELEMETRY (Rolling / Peak)
          </div>
          <div>
            {`Turn: ${perfTracker.lastTurnTimeMs.toFixed(2)} ms (avg ${turnStats.avgTotalMs.toFixed(2)} | peak ${perfTracker.maxTurnTimeMs.toFixed(2)} | slow ${perfTracker.slowTurnCount}/${perfTracker.turnCount})`}
          </div>
          <div style={{ color: 'var(--ui-text-secondary)' }}>
            {`↳ Dispatch ${tb.dispatchActionMs.toFixed(2)} | Stab ${tb.stabilizationMs.toFixed(2)} | Cadence ${tb.cadenceAndLedgerMs.toFixed(2)} | FOV ${tb.fovAndExploreMs.toFixed(2)} ms`}
          </div>
          <div>
            {`Render: ${perfTracker.lastRenderTimeMs.toFixed(2)} ms (avg ${renderStats.avgTotalMs.toFixed(2)} | peak ${perfTracker.maxRenderTimeMs.toFixed(2)} | slow ${perfTracker.slowRenderFrameCount}/${perfTracker.renderFrameCount})`}
          </div>
          <div style={{ color: 'var(--ui-text-secondary)' }}>
            {`↳ Snap ${rb.snapshotBuildMs.toFixed(2)} | Draw ${rb.canvasDrawMs.toFixed(2)} (${rb.drawCalls} calls) | Ovl ${rb.overlaysMs.toFixed(2)} | HUD ${rb.hudDomainMs.toFixed(2)} | Mod ${rb.modalsDomainMs.toFixed(2)} ms`}
          </div>
          <div>
            {`AI: ${perfTracker.lastAITimeMs.toFixed(2)} ms (peak ${perfTracker.maxAITimeMs.toFixed(2)} | calls ${perfTracker.aiCallCount} | yields ${perfTracker.schedulerSliceYields})`}
          </div>
          <div>
            {`World: Entities ${state.entities.length} | Fields ${activeFields} | Hover Δ ${perfTracker.hoverTileChanges}`}
          </div>
        </div>

        <div className="ui-debug-events" aria-label="Recent game event trace">
          {recentEvents.map((event, idx) => {
            if (event.type === GameEventType.DebugTriggerTrace) {
              const trace = event as DebugTriggerTraceEvent;
              return (
                <div key={`evt_${idx}`} className="ui-debug-event" data-kind="trigger">
                  <div>{`🔥 TRIGGER [${trace.triggerId}] executed`}</div>
                  <div style={{ marginLeft: '8px', color: 'var(--ui-text-secondary)' }}>
                    {`↳ Caused by: ${trace.triggeringEvent.type}`}
                  </div>
                  <div style={{ marginLeft: '8px', color: 'var(--ui-status-success)' }}>
                    {`↳ Fired: [${trace.executedConsequences.join(', ')}]`}
                  </div>
                </div>
              );
            }
            if (event.type === GameEventType.ReactionResolved) {
              const trace = event as ReactionResolvedEvent;
              return (
                <div key={`evt_${idx}`} className="ui-debug-event" data-kind="reaction">
                  <div>{`⚡ REACTION [${trace.reactionId}] resolved`}</div>
                  <div style={{ marginLeft: '8px', color: 'var(--ui-text-secondary)' }}>
                    {`↳ Match: ${trace.whyMatched}`}
                  </div>
                  <div style={{ marginLeft: '8px', color: 'var(--ui-text-secondary)' }}>
                    {`↳ Source: ${trace.sourceId} | Target: ${JSON.stringify(trace.target)}`}
                  </div>
                </div>
              );
            }
            return (
              <div key={`evt_${idx}`} className="ui-debug-event">
                {formatStandardEvent(event)}
              </div>
            );
          })}
        </div>

        {cursorX !== undefined && cursorY !== undefined && fieldsAtCursor.length > 0 ? (
          <div className="ui-debug-perf">
            <strong>{`Fields at ${cursorX},${cursorY}:`}</strong>
            {fieldsAtCursor.map((f, idx) => (
              <div key={`fld_${idx}`}>{`[${f.fieldType}] Intensity: ${f.intensity}, Duration: ${f.duration}`}</div>
            ))}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
