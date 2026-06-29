import { GameEventType, type GameEvent } from '../types/events.types.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from './ecs.ts';
import { getGameState } from './game-loop.ts';
import type { TelemetryMetrics } from '../types/game-state.types.ts';

const telemetryQueue: GameEvent[] = [];
let isIdleCallbackScheduled = false;

type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// In-memory store that holds the latest telemetry data until it's saved.
let telemetryStore: Mutable<TelemetryMetrics> = {
  playerDeaths: 0,
  damageTaken: 0,
  resourcesConsumed: 0,
  questsCompleted: 0
};

/**
 * Retrieves the current metrics in the background telemetry store.
 */
export function getTelemetryStore(): TelemetryMetrics {
  return telemetryStore;
}

/**
 * Overwrites the telemetry store (used when loading a save or starting a new game).
 */
export function setTelemetryStore(metrics: TelemetryMetrics): void {
  telemetryStore = { ...metrics };
}

/**
 * Pushes events into the async background queue to be parsed into metrics without blocking the main thread.
 */
export function pushTelemetryEvents(events: readonly GameEvent[]): void {
  if (events.length === 0) return;
  telemetryQueue.push(...events);

  if (!isIdleCallbackScheduled) {
    isIdleCallbackScheduled = true;
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(processTelemetryQueue);
    } else {
      setTimeout(processTelemetryQueue, 0);
    }
  }
}

function processTelemetryQueue(deadline?: IdleDeadline): void {
  isIdleCallbackScheduled = false;

  let state;
  try {
    state = getGameState();
  } catch (e) {
    // Game state might not be fully initialized yet
    return;
  }

  while (telemetryQueue.length > 0) {
    if (deadline && deadline.timeRemaining() <= 0) {
      isIdleCallbackScheduled = true;
      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(processTelemetryQueue);
      } else {
        setTimeout(processTelemetryQueue, 0);
      }
      return;
    }

    const event = telemetryQueue.shift();
    if (!event) continue;

    switch (event.type) {
      case GameEventType.EntityDamaged: {
        const isPlayer = getComponent(state, event.entityId, ComponentType.Player) !== undefined;
        if (isPlayer) {
          telemetryStore.damageTaken += event.amount;
        }
        break;
      }
      case GameEventType.EntityDied: {
        const isPlayer = getComponent(state, event.victimId, ComponentType.Player) !== undefined;
        if (isPlayer) {
          telemetryStore.playerDeaths += 1;
        }
        break;
      }
      case GameEventType.ItemUsed: {
        const isPlayer = getComponent(state, event.entityId, ComponentType.Player) !== undefined;
        if (isPlayer) {
          telemetryStore.resourcesConsumed += 1;
        }
        break;
      }
      case GameEventType.QuestCompleted: {
        telemetryStore.questsCompleted += 1;
        break;
      }
    }
  }
}
