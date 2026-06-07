import * as ROT from 'rot-js';
import type { EntityId } from '../types/game-state.types.ts';
import { processTurn } from './game-loop.ts';

class SchedulerActor {
  constructor(
    public readonly id: EntityId,
    private speed: number
  ) {}

  act(): void {
    processTurn(this.id);
  }

  getSpeed(): number {
    return this.speed;
  }
}

const scheduler = new ROT.Scheduler.Speed<SchedulerActor>();
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

export function addActor(id: EntityId, speed: number): void {
  if (actors.has(id)) return;
  const actor = new SchedulerActor(id, speed);
  actors.set(id, actor);
  scheduler.add(actor, true);
}

export function removeActor(id: EntityId): void {
  const actor = actors.get(id);
  if (actor) {
    scheduler.remove(actor);
    actors.delete(id);
  }
}

export function clearScheduler(): void {
  scheduler.clear();
  actors.clear();
}
