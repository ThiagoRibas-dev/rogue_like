import * as ROT from 'rot-js';
import { type EntityId, UIMode, EngineMode } from '../types/game-state.types.ts';
import { processTurn, getGameState } from './game-loop.ts';

class SchedulerActor {
  constructor(public readonly id: EntityId) {}

  act(): void {
    processTurn(this.id);
  }
}

const scheduler = new ROT.Scheduler.Action<SchedulerActor>();
const actors = new Map<EntityId, SchedulerActor>();

let isEngineLocked = true;
let accumulatedTime = 0;
let lastFrameTime = 0;
let rtwpLoopId = 0;

export function initEngine(): void {
  scheduler.clear();
  actors.clear();
  isEngineLocked = true;
  accumulatedTime = 0;
  cancelAnimationFrame(rtwpLoopId);
}

export function startEngine(): void {
  isEngineLocked = false;
  const state = getGameState();
  if (state.engineMode === EngineMode.TurnBased) {
    runTurnBasedLoop();
  } else {
    lastFrameTime = performance.now();
    rtwpLoopId = requestAnimationFrame(rtwpLoop);
  }
}

export function lockEngine(): void {
  isEngineLocked = true;
}

export function unlockEngine(): void {
  if (!isEngineLocked) return;
  isEngineLocked = false;
  const state = getGameState();
  if (state.engineMode === EngineMode.TurnBased) {
    runTurnBasedLoop();
  }
}

export function switchEngineMode(mode: EngineMode): void {
  if (mode === EngineMode.RTwP) {
    isEngineLocked = false;
    lastFrameTime = performance.now();
    rtwpLoopId = requestAnimationFrame(rtwpLoop);
  } else {
    cancelAnimationFrame(rtwpLoopId);
    isEngineLocked = true;
    unlockEngine(); // Resume turn-based execution
  }
}

function runTurnBasedLoop(): void {
  while (!isEngineLocked) {
    const actor = scheduler.next();
    if (!actor) break;
    actor.act();
  }
}

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

  // 500ms = 100 duration at 1x speed
  const durationDelta = (deltaMs / 500) * 100 * speed;
  accumulatedTime += durationDelta;

  while (accumulatedTime >= 0 && !isEngineLocked) {
    const prevTime = scheduler.getTime();
    const actor = scheduler.next();
    if (!actor) break;

    actor.act();

    const newTime = scheduler.getTime();
    accumulatedTime -= Math.max(0, newTime - prevTime);
  }
}

export function addActor(id: EntityId, repeat: boolean = true, initialDuration: number = 0): void {
  if (actors.has(id)) return;
  const actor = new SchedulerActor(id);
  actors.set(id, actor);
  scheduler.add(actor, repeat, initialDuration);
}

export function removeActor(id: EntityId): void {
  const actor = actors.get(id);
  if (actor) {
    scheduler.remove(actor);
    actors.delete(id);
  }
}

export function setTurnDuration(duration: number): void {
  scheduler.setDuration(duration);
}

export function clearScheduler(): void {
  scheduler.clear();
  actors.clear();
  isEngineLocked = true;
  cancelAnimationFrame(rtwpLoopId);
}
