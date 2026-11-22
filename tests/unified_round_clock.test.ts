import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_ACTOR_TURN_DURATION,
  DND_ROUND_DURATION_MS,
  HALF_ROUND_ENERGY_COST,
  RTWP_IDLE_WAIT_DURATION,
  RTWP_MS_PER_100_DURATION
} from '../src/constants/scheduler.constants.ts';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { applyIntentWithCost, getGameState, processTurn, setGameState } from '../src/core/game-loop.ts';
import { clearInputQueue, enqueueIntent } from '../src/core/input_queue.ts';
import { initRNG } from '../src/core/rng.ts';
import { clearScheduler, getActorRemainingScheduleTime, addActor } from '../src/core/scheduler.ts';
import { buildTurnStatusRibbon } from '../src/rendering/ui/hud_alerts.ui.ts';
import { canDnD35eActorPerformIntent, resolveDnD35eActionEnergyCost } from '../src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { queryCrossingAtPosition, spawnCrossingEntity } from '../src/systems/crossing.system.ts';
import { queryActiveFieldsAtPosition, spawnField } from '../src/systems/field.system.ts';
import { applyStatusEffect } from '../src/systems/status-effect.system.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import {
  ComponentType,
  type FighterComponent,
  type LightEmitterComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../src/types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildRtwpArena(): { state: GameState; playerId: EntityId } {
  initRNG(42);
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  let state = { ...buildGameState(campaign), engineMode: EngineMode.RTwP };
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
  const width = 20;
  const height = 20;
  const tiles = Array.from({ length: width * height }, (_, idx) => ({
    tileId: 'stone_floor',
    x: idx % width,
    y: Math.floor(idx / width),
    discovered: true
  }));
  state = {
    ...state,
    map: { ...state.map, width, height, tiles },
    rtwpState: { ...state.rtwpState, paused: false, speedMultiplier: 1.0 }
  };
  state = addComponent(state, playerId, { type: ComponentType.Position, x: 2, y: 10 });
  const pData = getDnD35EntityData(state, playerId);
  state = setDnD35EntityData(state, playerId, {
    ...pData,
    armorBonus: 0,
    shieldBonus: 0,
    movementModes: { land: 30 },
    actionBudget: undefined
  });
  return { state, playerId };
}

describe('Milestone 151: Unified 6-Second Round Clock across TB & RTwP', () => {
  test('uses 6000ms = 100 duration baseline and formats RTwP recovery seconds on 6-second round scale', () => {
    expect(DND_ROUND_DURATION_MS).toBe(6000);
    expect(RTWP_MS_PER_100_DURATION).toBe(6000);
    expect(DEFAULT_ACTOR_TURN_DURATION).toBe(100);
    expect(HALF_ROUND_ENERGY_COST).toBe(50);

    const { state, playerId } = buildRtwpArena();
    clearScheduler();
    addActor(playerId, true, 50);
    setGameState(state);

    const halfRoundRibbon = buildTurnStatusRibbon(state, playerId);
    expect(halfRoundRibbon.label).toBe('⏳ Recovering: 3.0s');

    const fastRibbon = buildTurnStatusRibbon(
      { ...state, rtwpState: { ...state.rtwpState, speedMultiplier: 2.0 } },
      playerId
    );
    expect(fastRibbon.label).toBe('⏳ Recovering: 1.5s');

    clearScheduler();
  });

  test('normal 30 ft Move costs exactly 50 energy (3.0s) over 6 steps + Standard Attack 50 energy (3.0s) = 100 energy (6.0s)', () => {
    let { state, playerId } = buildRtwpArena();
    const stepEnergies: number[] = [];

    for (let i = 0; i < 6; i++) {
      const res = applyIntentWithCost(state, { type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 });
      expect(res.success).toBe(true);
      stepEnergies.push(res.energyCost);
      state = res.state;
    }

    expect(stepEnergies).toEqual([8, 9, 8, 8, 9, 8]);
    expect(stepEnergies.reduce((sum, e) => sum + e, 0)).toBe(HALF_ROUND_ENERGY_COST);
    expect(getDnD35EntityData(state, playerId).actionBudget?.standardRemaining).toBe(1);
    expect(getDnD35EntityData(state, playerId).actionBudget?.moveRemaining).toBe(0);

    let goblinId: EntityId;
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    [state, goblinId] = spawnEntity(state, 'goblin', pPos.x + 1, pPos.y);

    const atkRes = applyIntentWithCost(state, {
      type: IntentType.MeleeAttack,
      entityId: playerId,
      defenderId: goblinId
    });
    expect(atkRes.success).toBe(true);
    expect(atkRes.energyCost).toBe(HALF_ROUND_ENERGY_COST);
    expect(getDnD35EntityData(atkRes.state, playerId).actionBudget).toBeUndefined();
  });

  test('per-actor speed modulation: Haste (60 ft -> 12 steps = 50 energy), Difficult Terrain (2x), and Heavy Armor Dwarf (20 ft -> 4 steps = 50 energy)', () => {
    // 1. Haste (+30 ft = 60 ft total) covers 12 squares in 50 energy (3.0s)
    const hasted = buildRtwpArena();
    const hastedData = getDnD35EntityData(hasted.state, hasted.playerId);
    let hState = setDnD35EntityData(hasted.state, hasted.playerId, {
      ...hastedData,
      statModifiers: [
        ...(hastedData.statModifiers ?? []),
        {
          targetStat: 'speed',
          value: 30,
          bonusType: 'enhancement',
          sourceId: 'spell:haste',
          origin: 'spell'
        }
      ]
    });
    let hasteMoveEnergy = 0;
    for (let i = 0; i < 12; i++) {
      const res = applyIntentWithCost(hState, { type: IntentType.Move, entityId: hasted.playerId, dx: 1, dy: 0 });
      expect(res.success).toBe(true);
      hasteMoveEnergy += res.energyCost;
      hState = res.state;
    }
    expect(hasteMoveEnergy).toBe(HALF_ROUND_ENERGY_COST);

    // 2. Difficult Terrain doubles per-tile cost cleanly (~17 energy/sq for 30 ft actor)
    const difficult = buildRtwpArena();
    const diffTiles = difficult.state.map.tiles.map((t, idx) => {
      const x = idx % difficult.state.map.width;
      const y = Math.floor(idx / difficult.state.map.width);
      return x === 3 && y === 10 ? { ...t, tileId: 'mud' } : t;
    });
    const dCampaign = {
      ...difficult.state.campaign,
      tiles: {
        ...difficult.state.campaign.tiles,
        mud: { ...difficult.state.campaign.tiles['stone_floor']!, id: 'mud', name: 'Mud', movementCost: 200 }
      }
    };
    const diffState: GameState = {
      ...difficult.state,
      campaign: dCampaign,
      map: { ...difficult.state.map, tiles: diffTiles }
    };
    const diffStep = applyIntentWithCost(diffState, { type: IntentType.Move, entityId: difficult.playerId, dx: 1, dy: 0 });
    expect(diffStep.energyCost).toBe(17);

    // 3. Heavy Armor Dwarf (20 ft land speed) covers 4 squares in 50 energy (3.0s)
    const slow = buildRtwpArena();
    const slowDnd = getDnD35EntityData(slow.state, slow.playerId);
    let slowState = setDnD35EntityData(slow.state, slow.playerId, {
      ...slowDnd,
      movementModes: { land: 20 }
    });
    let slowEnergy = 0;
    for (let i = 0; i < 4; i++) {
      const res = applyIntentWithCost(slowState, { type: IntentType.Move, entityId: slow.playerId, dx: 1, dy: 0 });
      expect(res.success).toBe(true);
      slowEnergy += res.energyCost;
      slowState = res.state;
    }
    expect(slowEnergy).toBe(HALF_ROUND_ENERGY_COST);
  });

  test('runActorTurnStart fires strictly once per 100-energy round in RTwP across sub-round moves and idle ticks', () => {
    const { state, playerId } = buildRtwpArena();
    clearScheduler();
    clearInputQueue();
    let buffState = applyStatusEffect(state, playerId, 'haste', 5, playerId);
    setGameState(buffState);
    addActor(playerId, true, 0);

    // Turn 1 start ticks status effect (duration 5 -> 4) and advances globalTurn (+1)
    enqueueIntent({ type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 });
    processTurn(playerId);
    const afterStep1 = getGameState();
    const turnAfterStep1 = afterStep1.globalTurn;
    const durAfterStep1 = (
      getComponent(afterStep1, playerId, ComponentType.StatusEffects) as StatusEffectsComponent
    ).activeEffects.find((e) => e.effectId === 'haste')!.duration;
    expect(durAfterStep1).toBe(4);

    // Second step in the same round must NOT re-trigger runActorTurnStart or decrement haste again
    enqueueIntent({ type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 });
    processTurn(playerId);
    const afterStep2 = getGameState();
    expect(afterStep2.globalTurn).toBe(turnAfterStep1);
    const durAfterStep2 = (
      getComponent(afterStep2, playerId, ComponentType.StatusEffects) as StatusEffectsComponent
    ).activeEffects.find((e) => e.effectId === 'haste')!.duration;
    expect(durAfterStep2).toBe(4);

    clearScheduler();
    clearInputQueue();
  });

  test('toggling EngineMode between RTwP and TurnBased mid-round preserves DnD35ActionBudget and completes exact 100-energy round', () => {
    const { state, playerId } = buildRtwpArena();
    let cur = applyIntentWithCost(state, { type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 }).state;
    cur = applyIntentWithCost(cur, { type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 }).state;

    const midBudget = getDnD35EntityData(cur, playerId).actionBudget;
    expect(midBudget).toBeDefined();
    expect(midBudget!.rtwpMoveEnergySpentThisRound).toBe(17);
    expect(midBudget!.movementRemainingFt).toBe(20);
    expect(midBudget!.standardRemaining).toBe(1);

    // Switch mid-round to TurnBased
    const tbState: GameState = { ...cur, engineMode: EngineMode.TurnBased };
    expect(canDnD35eActorPerformIntent(tbState, { type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 })).toBe(
      true
    );

    const tbMove = applyIntentWithCost(tbState, { type: IntentType.Move, entityId: playerId, dx: 1, dy: 0 });
    expect(tbMove.energyCost).toBe(0);
    expect(getDnD35EntityData(tbMove.state, playerId).actionBudget?.movementRemainingFt).toBe(15);

    // Full Attack vs Standard Wait in RTwP respects remaining round actions
    const endWait = resolveDnD35eActionEnergyCost(
      { ...tbMove.state, engineMode: EngineMode.RTwP },
      { type: IntentType.Wait, entityId: playerId },
      DEFAULT_ACTOR_TURN_DURATION
    );
    expect(endWait.energyCost).toBe(DEFAULT_ACTOR_TURN_DURATION);
    expect(getDnD35EntityData(endWait.state, playerId).actionBudget).toBeUndefined();
    expect(getActorRemainingScheduleTime(playerId)).toBe(0);
    expect(RTWP_IDLE_WAIT_DURATION).toBe(2);
  });

  test('advanceWorldTimeBulk shares local elapsed-time tick across status effects, light emitters, crossings, fields, and breath drowning interruption', () => {
    let { state, playerId } = buildRtwpArena();

    // 1. Add a 10-turn status effect, a lit light emitter on player with 25 fuelTurns, a 5-turn crossing, and a 5-turn field
    state = applyStatusEffect(state, playerId, 'antitoxin', 10, playerId);
    state = addComponent(state, playerId, {
      type: ComponentType.LightEmitter,
      radiusFt: 20,
      shadowyRadiusFt: 40,
      fuelTurns: 25,
      maxFuelTurns: 100,
      isLit: true
    });
    [state] = spawnCrossingEntity({
      state,
      x: 5,
      y: 10,
      crossingKind: 'frozen_surface',
      durationTurns: 5
    });
    [state] = spawnField(state, 'oil', 6, 10, 0, 5);

    // Advance 8 turns via advanceWorldTimeBulk -> crossing (5 turns) and field (5 turns) expire, status has 2 turns left, light has 17 fuelTurns left
    const bulk8 = advanceWorldTimeBulk(state, 8, playerId);
    state = bulk8.state;
    expect(bulk8.turnsAdvanced).toBe(8);
    expect(queryCrossingAtPosition(state, 5, 10)).toBeUndefined();
    expect(queryActiveFieldsAtPosition(state, 6, 10).length).toBe(0);
    const remStatus = (getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent).activeEffects.find(
      (e) => e.effectId === 'antitoxin'
    );
    expect(remStatus?.duration).toBe(2);
    expect((getComponent(state, playerId, ComponentType.LightEmitter) as LightEmitterComponent).fuelTurns).toBe(17);

    // 2. Submerge player with 2 turns of breath remaining and attempt a 100-turn skip -> drowns and interrupts immediately!
    state = addComponent(state, playerId, {
      type: ComponentType.Breath,
      remainingTurns: 2,
      maxTurns: 20,
      isSubmerged: true
    });
    const drownSkip = advanceWorldTimeBulk(state, 100, playerId);
    expect(drownSkip.turnsAdvanced).toBeLessThan(100);
    expect(drownSkip.interruptedReason).toBeDefined();
    expect((getComponent(drownSkip.state, playerId, ComponentType.Fighter) as FighterComponent).hp).toBeLessThanOrEqual(0);
  });
});

