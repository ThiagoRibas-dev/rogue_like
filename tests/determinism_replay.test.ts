import { describe, expect, test } from 'bun:test';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { initRNG } from '../src/core/rng.ts';
import { applyIntentWithCost } from '../src/core/game-loop.ts';
import { getComponent, queryEntities } from '../src/core/ecs.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { serializeGameState } from '../src/core/save.ts';

function runDeterministicSession(seed: number): GameState {
  initRNG(seed);
  const campaign = loadCampaignFromDisk('default');
  let state = buildGameState(campaign);

  const players = queryEntities(state, [ComponentType.Player]);
  const playerId = players[0]!;

  const stepOffsets: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
    [0, 0],
    [1, 1],
    [-1, -1],
    [0, 0],
    [1, 0],
    [-1, 0]
  ];

  for (const [dx, dy] of stepOffsets) {
    if (dx === 0 && dy === 0) {
      state = applyIntentWithCost(state, {
        type: IntentType.Wait,
        entityId: playerId
      }).state;
    } else {
      state = applyIntentWithCost(state, {
        type: IntentType.Move,
        entityId: playerId,
        dx,
        dy
      }).state;
    }
  }

  return state;
}

describe('Strict Seed Determinism & Headless Replay Invariants', () => {
  test('two independent runs with identical RNG seed and intent sequence produce identical GameState', () => {
    const stateA = runDeterministicSession(1337);
    const stateB = runDeterministicSession(1337);

    const playerA = queryEntities(stateA, [ComponentType.Player])[0]!;
    const playerB = queryEntities(stateB, [ComponentType.Player])[0]!;

    expect(playerA).toBe(playerB);
    expect(getComponent(stateA, playerA, ComponentType.Position)).toEqual(
      getComponent(stateB, playerB, ComponentType.Position)
    );
    expect(getComponent(stateA, playerA, ComponentType.Fighter)).toEqual(
      getComponent(stateB, playerB, ComponentType.Fighter)
    );
    expect(stateA.nextEntityId).toBe(stateB.nextEntityId);
    expect(stateA.globalTurn).toBe(stateB.globalTurn);
    expect(stateA.messages).toEqual(stateB.messages);

    // Compare full serialized state (excluding global cumulative telemetry counters)
    const dtoA = { ...serializeGameState(stateA), telemetry: undefined };
    const dtoB = { ...serializeGameState(stateB), telemetry: undefined };
    expect(dtoA).toEqual(dtoB);
  });
});
