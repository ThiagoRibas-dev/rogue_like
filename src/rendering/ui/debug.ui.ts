import { type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  GameEventType,
  type GameEvent,
  type DebugTriggerTraceEvent,
  type ReactionResolvedEvent
} from '../../types/events.types.ts';
import { getComponent } from '../../core/ecs.ts';
import { ComponentType, type FieldComponent } from '../../types/components.types.ts';

export function renderDebugOverlay(state: GameState): void {
  const overlay = document.getElementById('debug-overlay');
  if (!overlay) return;

  if (state.uiMode !== UIMode.Debug) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');

  const ledgerContainer = document.getElementById('debug-event-ledger');
  if (!ledgerContainer) return;

  // We only want to render new events, but for simplicity we will re-render all of them
  // or the last N events if the list gets too long.
  ledgerContainer.innerHTML = '';

  const maxEvents = 100;
  const eventsToRender = state.events.slice(-maxEvents);

  for (const event of eventsToRender) {
    const entry = document.createElement('div');
    entry.style.padding = '4px';
    entry.style.borderBottom = '1px solid #333';
    entry.style.wordBreak = 'break-word';

    if (event.type === GameEventType.DebugTriggerTrace) {
      const trace = event as DebugTriggerTraceEvent;
      entry.style.color = '#f1c40f'; // Yellow for triggers
      entry.style.backgroundColor = 'rgba(241, 196, 15, 0.1)';

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.textContent = `🔥 TRIGGER [${trace.triggerId}] executed`;

      const cause = document.createElement('div');
      cause.style.color = '#ccc';
      cause.style.marginLeft = '8px';
      cause.textContent = `↳ Caused by: ${trace.triggeringEvent.type}`;

      const consequences = document.createElement('div');
      consequences.style.color = '#2ecc71';
      consequences.style.marginLeft = '8px';
      consequences.textContent = `↳ Fired: [${trace.executedConsequences.join(', ')}]`;

      entry.appendChild(title);
      entry.appendChild(cause);
      entry.appendChild(consequences);
    } else if (event.type === GameEventType.ReactionResolved) {
      const trace = event as ReactionResolvedEvent;
      entry.style.color = '#3498db'; // Blue for reactions
      entry.style.backgroundColor = 'rgba(52, 152, 219, 0.1)';

      const title = document.createElement('div');
      title.style.fontWeight = 'bold';
      title.textContent = `⚡ REACTION [${trace.reactionId}] resolved`;

      const match = document.createElement('div');
      match.style.color = '#ccc';
      match.style.marginLeft = '8px';
      match.textContent = `↳ Match: ${trace.whyMatched}`;

      const details = document.createElement('div');
      details.style.color = '#ccc';
      details.style.marginLeft = '8px';
      details.textContent = `↳ Source: ${trace.sourceId} | Target: ${JSON.stringify(trace.target)}`;

      entry.appendChild(title);
      entry.appendChild(match);
      entry.appendChild(details);
    } else {
      entry.style.color = '#bdc3c7'; // Standard light gray
      entry.textContent = formatStandardEvent(event);
    }

    ledgerContainer.appendChild(entry);
  }

  // Auto-scroll to bottom
  ledgerContainer.scrollTop = ledgerContainer.scrollHeight;

  // Render Field Metrics under cursor
  let fieldsInfo = document.getElementById('debug-fields-info');
  if (!fieldsInfo) {
    fieldsInfo = document.createElement('div');
    fieldsInfo.id = 'debug-fields-info';
    fieldsInfo.style.marginTop = '16px';
    fieldsInfo.style.padding = '8px';
    fieldsInfo.style.border = '1px solid #555';
    fieldsInfo.style.backgroundColor = 'rgba(0,0,0,0.8)';
    overlay.appendChild(fieldsInfo);
  }

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

  if (cursorX !== undefined && cursorY !== undefined) {
    const key = `${cursorX},${cursorY}`;
    const entitiesAt = state.spatialIndex.get(key) || [];
    const fieldsAt = entitiesAt
      .map((eId) => getComponent(state, eId, ComponentType.Field) as FieldComponent | undefined)
      .filter(Boolean);

    if (fieldsAt.length > 0) {
      fieldsInfo.innerHTML =
        `<strong>Fields at ${cursorX},${cursorY}:</strong><br/>` +
        fieldsAt.map((f) => `[${f!.fieldType}] Intensity: ${f!.intensity}, Duration: ${f!.duration}`).join('<br/>');
      fieldsInfo.style.display = 'block';
    } else {
      fieldsInfo.style.display = 'none';
    }
  } else {
    fieldsInfo.style.display = 'none';
  }
}

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
      // Fallback: just show the type and dump the rest as JSON string, omitting the type
      const { type, ...rest } = event as unknown as Record<string, unknown>;
      return `[${type}] ${JSON.stringify(rest)}`;
    }
  }
}
