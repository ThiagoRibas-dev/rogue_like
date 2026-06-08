import * as ROT from 'rot-js';
import type { EntityId } from '../types/game-state.types.ts';
import { processTurn } from './game-loop.ts';

class SchedulerActor {
  constructor(public readonly id: EntityId) {}

  act(): void {
    processTurn(this.id);
  }
}

const scheduler = new ROT.Scheduler.Action<SchedulerActor>();
let engine: ROT.Engine | null = null;

const actors = new Map<EntityId, SchedulerActor>();

export function initEngine(): void {
  engine = new ROT.Engine(scheduler);
}

export function startEngine(): void {
  if (engine) engine.start();
}

export function lockEngine(): void {
  if (engine) engine.lock();
}

export function unlockEngine(): void {
  if (engine) engine.unlock();
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
}
