import * as ROT from 'rot-js';
import { type EntityId, UIMode, EngineMode } from '../types/game-state.types.ts';
import { processTurn, getGameState } from './game-loop.ts';
import { saveCheckpoint } from './persistence_service.ts';
import {
  FRAME_BUDGET_MS,
  MAX_RTWP_DRAIN_ITERATIONS,
  RTWP_MS_PER_100_DURATION,
  DEFAULT_ACTOR_TURN_DURATION,
  MAX_ACCUMULATED_RTWP_TIME
} from '../constants/scheduler.constants.ts';
import { recordSchedulerSliceYield } from './performance.ts';

class SchedulerActor {
  constructor(public readonly id: EntityId) {}

  act(): void {
    processTurn(this.id);
  }
}

const scheduler = new ROT.Scheduler.Action<SchedulerActor>();
const actors = new Map<EntityId, SchedulerActor>();

let isEngineLocked = true;
let isTurnProcessing = false;
let accumulatedTime = 0;
let lastFrameTime = 0;
let rtwpLoopId = 0;
let sliceYieldTimerId: ReturnType<typeof setTimeout> | null = null;

/**
 * Initializes the ROT.js scheduler and resets engine run states.
 */
export function initEngine(): void {
  scheduler.clear();
  actors.clear();
  isEngineLocked = true;
  isTurnProcessing = false;
  accumulatedTime = 0;
  if (sliceYieldTimerId !== null) {
    clearTimeout(sliceYieldTimerId);
    sliceYieldTimerId = null;
  }
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rtwpLoopId);
  }
}

/**
 * Starts execution of the scheduling engine in turn-based or real-time loop.
 */
export function startEngine(): void {
  isEngineLocked = false;
  const state = getGameState();
  if (state.engineMode === EngineMode.TurnBased) {
    runTurnBasedLoop();
  } else {
    lastFrameTime = performance.now();
    if (typeof requestAnimationFrame !== 'undefined') {
      rtwpLoopId = requestAnimationFrame(rtwpLoop);
    }
  }
}

/**
 * Halts scheduling loops until unlocked.
 */
export function lockEngine(): void {
  isEngineLocked = true;
  isTurnProcessing = false;
  if (sliceYieldTimerId !== null) {
    clearTimeout(sliceYieldTimerId);
    sliceYieldTimerId = null;
  }
}

/**
 * Resumes turn scheduling (turn-based only).
 */
export function unlockEngine(): void {
  if (!isEngineLocked && isTurnProcessing) return;
  isEngineLocked = false;
  const state = getGameState();
  if (state.engineMode === EngineMode.TurnBased) {
    if (!isTurnProcessing) {
      runTurnBasedLoop();
    }
  }
}

/**
 * Returns whether a turn slicing operation is currently active.
 */
export function isTurnProcessingActive(): boolean {
  return isTurnProcessing;
}

/**
 * Seamlessly transitions scheduling loops between turn-based and real-time execution modes.
 */
export function switchEngineMode(mode: EngineMode): void {
  saveCheckpoint(getGameState());
  if (mode === EngineMode.RTwP) {
    if (sliceYieldTimerId !== null) {
      clearTimeout(sliceYieldTimerId);
      sliceYieldTimerId = null;
    }
    isTurnProcessing = false;
    isEngineLocked = false;
    lastFrameTime = performance.now();
    if (typeof requestAnimationFrame !== 'undefined') {
      rtwpLoopId = requestAnimationFrame(rtwpLoop);
    }
  } else {
    if (typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rtwpLoopId);
    }
    isEngineLocked = true;
    unlockEngine(); // Resume turn-based execution
  }
}

/**
 * Cooperative frame-budgeted turn-based loop.
 * Slices long AI cascades into 4ms chunks to preserve 60 FPS responsiveness.
 */
function runTurnBasedLoop(): void {
  if (isEngineLocked) {
    isTurnProcessing = false;
    return;
  }
  isTurnProcessing = true;
  const sliceStart = performance.now();

  while (!isEngineLocked) {
    // Exceeded frame budget: yield cooperatively to browser
    if (performance.now() - sliceStart >= FRAME_BUDGET_MS) {
      recordSchedulerSliceYield();
      sliceYieldTimerId = setTimeout(() => {
        sliceYieldTimerId = null;
        if (!isEngineLocked) {
          runTurnBasedLoop();
        } else {
          isTurnProcessing = false;
        }
      }, 0);
      return;
    }

    const actor = scheduler.next();
    if (!actor) break;
    try {
      actor.act();
    } catch (e) {
      console.error(`Error in turn-based loop for actor ${actor.id}:`, e);
      removeActor(actor.id);
    }
  }

  isTurnProcessing = false;
}

/**
 * Bounded RTwP loop with iteration and time-slice caps to prevent frame freezes.
 */
function rtwpLoop(time: number): void {
  const state = getGameState();
  if (state.engineMode !== EngineMode.RTwP) return;

  rtwpLoopId = requestAnimationFrame(rtwpLoop);

  // If paused or showing a menu/inventory, do not accumulate time
  if (state.rtwpState.paused || state.uiMode !== UIMode.Game || state.targetingMode?.active || isEngineLocked) {
    lastFrameTime = time;
    return;
  }

  const deltaMs = time - lastFrameTime;
  lastFrameTime = time;

  const speed = state.rtwpState.speedMultiplier;
  const durationDelta = (deltaMs / RTWP_MS_PER_100_DURATION) * DEFAULT_ACTOR_TURN_DURATION * speed;
  accumulatedTime += durationDelta;

  if (accumulatedTime > MAX_ACCUMULATED_RTWP_TIME) {
    accumulatedTime = MAX_ACCUMULATED_RTWP_TIME;
  }

  let iterations = 0;
  const sliceStart = performance.now();

  while (accumulatedTime >= 0 && !isEngineLocked && iterations < MAX_RTWP_DRAIN_ITERATIONS) {
    if (performance.now() - sliceStart >= FRAME_BUDGET_MS) {
      recordSchedulerSliceYield();
      break;
    }

    const prevTime = scheduler.getTime();
    const actor = scheduler.next();
    if (!actor) break;

    try {
      actor.act();
    } catch (e) {
      console.error(`Error in RTwP loop for actor ${actor.id}:`, e);
      removeActor(actor.id);
    }

    const newTime = scheduler.getTime();
    accumulatedTime -= Math.max(0, newTime - prevTime);
    iterations++;
  }
}

/**
 * Enrolls an entity actor into scheduling queue with action parameters.
 */
export function addActor(id: EntityId, repeat: boolean = true, initialDuration: number = 0): void {
  if (actors.has(id)) return;
  const actor = new SchedulerActor(id);
  actors.set(id, actor);
  scheduler.add(actor, repeat, initialDuration);
}

/**
 * Evicts an entity from the scheduler queue.
 */
export function removeActor(id: EntityId): void {
  const actor = actors.get(id);
  if (actor) {
    scheduler.remove(actor);
    actors.delete(id);
  }
}

/**
 * Injects step duration weights back into scheduling actions.
 */
export function setTurnDuration(duration: number): void {
  scheduler.setDuration(duration);
}

/**
 * Destroys all scheduling states and cancels animation timers.
 */
export function clearScheduler(): void {
  scheduler.clear();
  actors.clear();
  isEngineLocked = true;
  isTurnProcessing = false;
  if (sliceYieldTimerId !== null) {
    clearTimeout(sliceYieldTimerId);
    sliceYieldTimerId = null;
  }
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rtwpLoopId);
  }
}
