import { afterEach, describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { getGameState, processTurn, queuePlayerIntent, setGameState } from '../src/core/game-loop.ts';
import { clearInputQueue } from '../src/core/input_queue.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { cancelPendingSave } from '../src/core/persistence_service.ts';
import { clearScheduler, initEngine } from '../src/core/scheduler.ts';
import {
  canDnD35eActorPerformIntent,
  hasDnD35eActorActedThisTurn,
  onDnD35eActorTurnStart,
  resolveDnD35eActionEnergyCost
} from '../src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts';
import { resolveDnD35eMeleeAttack } from '../src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { NaturalWeaponDescriptor } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { processAITurn } from '../src/systems/ai.system.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildOpenArenaState(): { state: GameState; playerId: EntityId } {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  let state = buildGameState(campaign);
  const width = 20;
  const height = 20;
  const tiles = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ tileId: 'stone_floor', x, y, explored: true });
    }
  }
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) throw new Error('Player entity missing');

  const playerComponents = state.components.get(playerId);
  const cleanComponents = new Map();
  if (playerComponents) {
    cleanComponents.set(playerId, playerComponents);
  }

  state = {
    ...state,
    engineMode: EngineMode.TurnBased,
    entities: [playerId],
    components: cleanComponents,
    spatialIndex: new Map(),
    isSandbox: true,
    map: { width, height, tiles, isFullyExplored: true }
  };

  state = addComponent(state, playerId, { type: ComponentType.Position, x: 2, y: 5 });
  const playerFighter = getComponent(state, playerId, ComponentType.Fighter)!;
  state = addComponent(state, playerId, { ...playerFighter, hp: 200, maxHp: 200 });
  return { state, playerId };
}

function spawnHostileNpc(
  state: GameState,
  x: number,
  y: number,
  options?: {
    readonly profileId?: string;
    readonly hp?: number;
    readonly naturalWeapons?: ReadonlyArray<NaturalWeaponDescriptor>;
  }
): { state: GameState; npcId: EntityId } {
  let [nextState, npcId] = createEntity(state);
  nextState = addComponent(nextState, npcId, { type: ComponentType.Actor, speed: 100 });
  nextState = addComponent(nextState, npcId, { type: ComponentType.Position, x, y });
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.Identity,
    name: 'Test Ravager',
    mannerisms: ['aggressive']
  });
  const hp = options?.hp ?? 40;
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.Fighter,
    hp,
    maxHp: hp,
    attack: 12,
    defense: 12,
    level: 4,
    xp: 0,
    xpGiven: 50
  });
  nextState = addComponent(nextState, npcId, { type: ComponentType.Faction, factionId: 'monster' });
  nextState = addComponent(nextState, npcId, { type: ComponentType.Attitude, attitude: 'hostile' });
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.AI,
    profileId: options?.profileId ?? 'aggressive_melee',
    aggroRadius: 12,
    wanders: true,
    cooldowns: { roar: 3 }
  });

  const baseData = getDnD35EntityData(nextState, npcId);
  nextState = setDnD35EntityData(nextState, npcId, {
    ...baseData,
    abilityScores: {
      str: { base: 18, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      dex: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      con: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
      cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
    },
    ...(options?.naturalWeapons ? { naturalWeapons: options.naturalWeapons } : {})
  });

  return { state: nextState, npcId };
}

const MULTI_CLAW_WEAPONS: ReadonlyArray<NaturalWeaponDescriptor> = [
  {
    id: 'bite',
    name: 'Bite',
    naturalType: 'bite',
    isPrimary: true,
    count: 1,
    damageDice: '1d6',
    damageType: 'piercing',
    critThreatMin: 20,
    critMultiplier: 2
  },
  {
    id: 'claw',
    name: 'Claw',
    naturalType: 'claw',
    isPrimary: false,
    count: 2,
    damageDice: '1d4',
    damageType: 'slashing',
    critThreatMin: 20,
    critMultiplier: 2
  }
];

afterEach(() => {
  cancelPendingSave();
  clearInputQueue();
  clearScheduler();
});

describe('D&D 3.5e NPC Symmetric Action Budget & AI Integration', () => {
  test('1. Multi-step moving NPC ticks status effects and AI cooldowns strictly ONCE per round', () => {
    let { state, playerId } = buildOpenArenaState();
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        ai: {
          ...state.campaign.ai,
          test_hunter: {
            id: 'test_hunter',
            behaviors: [{ behaviorId: 'hunt', aggroRadius: 12 }]
          }
        }
      }
    };

    const spawned = spawnHostileNpc(state, 8, 5, { profileId: 'test_hunter', hp: 40 });
    state = spawned.state;
    const npcId = spawned.npcId;

    // Apply built-in 'poison' (2 damage/turn) with duration 5
    state = addComponent(state, npcId, {
      type: ComponentType.StatusEffects,
      activeEffects: [{ effectId: 'poison', duration: 5, sourceEntityId: playerId }]
    });

    initEngine();
    setGameState(state);

    // Enemy is 6 tiles (30 ft) away -> takes 5 intra-round move steps (energyCost 0) then 1 Standard Attack at x=3
    for (let slice = 0; slice < 6; slice++) {
      processTurn(npcId);
    }

    const postState = getGameState();
    const npcPos = getComponent(postState, npcId, ComponentType.Position)!;
    expect(npcPos.x).toBe(3);

    // Poison damage (2 HP -> 38 HP), duration (5 -> 4), and AI cooldown (3 -> 2) ticked strictly ONCE
    const npcFighter = getComponent(postState, npcId, ComponentType.Fighter)!;
    expect(npcFighter.hp).toBe(38);
    const statuses = getComponent(postState, npcId, ComponentType.StatusEffects);
    expect(statuses?.activeEffects[0]?.duration).toBe(4);
    const aiComp = getComponent(postState, npcId, ComponentType.AI);
    expect(aiComp?.cooldowns?.['roar']).toBe(2);
  });

  test('2. Multi-attack monster moving 15 ft into melee makes ONLY 1 Standard Attack strike (never Full-Attack)', async () => {
    let { state } = buildOpenArenaState();
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        ai: {
          ...state.campaign.ai,
          test_hunter: {
            id: 'test_hunter',
            behaviors: [{ behaviorId: 'hunt', aggroRadius: 12 }]
          }
        }
      }
    };

    // Place monster at x=6 (4 tiles = 20 ft away from player at x=2)
    const spawned = spawnHostileNpc(state, 6, 5, {
      profileId: 'test_hunter',
      naturalWeapons: MULTI_CLAW_WEAPONS
    });
    state = spawned.state;
    const npcId = spawned.npcId;

    initEngine();
    setGameState(state);

    // Player waits cleanly, letting ROT.Scheduler advance through NPC's entire round (allow frame-budget yields to settle)
    queuePlayerIntent({ type: IntentType.Wait, entityId: state.entities[0]! });
    await new Promise((resolve) => setTimeout(resolve, 30));

    const finalState = getGameState();
    const npcPos = getComponent(finalState, npcId, ComponentType.Position)!;
    // Closed distance from x=6 -> x=3 (moved 15 ft)
    expect(npcPos.x).toBe(3);
    // Round completed: budget cleared when back at player's turn
    expect(getDnD35EntityData(finalState, npcId).actionBudget).toBeUndefined();

    // Also verify directly with applyIntentWithCost that 3 steps + 1 MeleeAttack yields strictly 1 strike log entry (Standard Attack)
    let directState = onDnD35eActorTurnStart(state, npcId);
    for (let s = 0; s < 3; s++) {
      const m = applyIntentWithCost(directState, { type: IntentType.Move, entityId: npcId, dx: -1, dy: 0 });
      expect(m.energyCost).toBe(0);
      directState = m.state;
    }
    const logCountBefore = directState.messages.length;
    const atkRes = applyIntentWithCost(directState, {
      type: IntentType.MeleeAttack,
      entityId: npcId,
      defenderId: state.entities[0]!
    });
    expect(atkRes.success).toBe(true);
    expect(atkRes.energyCost).toBe(100);
    const strikeCount = atkRes.state.messages
      .slice(logCountBefore)
      .filter((m) => m.text.startsWith('[d20:'))
      .reduce((sum, m) => sum + (m.count ?? 1), 0);
    expect(strikeCount).toBe(1);
  });

  test('3. Multi-attack monster starting adjacent executes full multi-strike Full-Attack routine', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const spawned = spawnHostileNpc(baseState, 3, 5, { naturalWeapons: MULTI_CLAW_WEAPONS });
    const turnState = onDnD35eActorTurnStart(spawned.state, spawned.npcId);
    const logCountBefore = turnState.messages.length;

    // Starting adjacent (distanceMovedThisRoundFt === 0, moveRemaining >= 1): executes Bite + 2 Claws = 3 strikes
    const res = resolveDnD35eMeleeAttack(turnState, {
      type: IntentType.MeleeAttack,
      entityId: spawned.npcId,
      defenderId: playerId
    });
    expect(res.success).toBe(true);
    const strikeCount = res.state.messages
      .slice(logCountBefore)
      .filter((m) => m.text.startsWith('[d20:'))
      .reduce((sum, m) => sum + (m.count ?? 1), 0);
    expect(strikeCount).toBe(3);

    const endCost = resolveDnD35eActionEnergyCost(
      res.state,
      { type: IntentType.MeleeAttack, entityId: spawned.npcId, defenderId: playerId },
      100,
      turnState
    );
    expect(endCost.energyCost).toBe(100);
  });

  test('4. Per-entity Single-Actions-Only (Zombie/Staggered) and Nauseated budgets restrict actions symmetrically', () => {
    const { state: baseState, playerId } = buildOpenArenaState();

    // Staggered / Zombie NPC: singleActionsOnly = true -> standardRemaining: 1, moveRemaining: 0
    const zombSpawn = spawnHostileNpc(baseState, 6, 5, { naturalWeapons: MULTI_CLAW_WEAPONS });
    let zState = setDnD35EntityData(zombSpawn.state, zombSpawn.npcId, {
      ...getDnD35EntityData(zombSpawn.state, zombSpawn.npcId),
      singleActionsOnly: true
    });
    zState = onDnD35eActorTurnStart(zState, zombSpawn.npcId);
    const zBudget = getDnD35EntityData(zState, zombSpawn.npcId).actionBudget!;
    expect(zBudget.standardRemaining).toBe(1);
    expect(zBudget.moveRemaining).toBe(0);

    // Even when starting adjacent, a Zombie with singleActionsOnly cannot Full-Attack (moveRemaining === 0 -> 1 strike only!)
    const adjZombie = addComponent(zState, zombSpawn.npcId, { type: ComponentType.Position, x: 3, y: 5 });
    const logCountBefore = adjZombie.messages.length;
    const zAtk = resolveDnD35eMeleeAttack(adjZombie, {
      type: IntentType.MeleeAttack,
      entityId: zombSpawn.npcId,
      defenderId: playerId
    });
    const zStrikeCount = zAtk.state.messages
      .slice(logCountBefore)
      .filter((m) => m.text.startsWith('[d20:'))
      .reduce((sum, m) => sum + (m.count ?? 1), 0);
    expect(zStrikeCount).toBe(1);

    // If the Zombie steps 1 square first (downgrading Standard -> Move), standardRemaining drops to 0 so it cannot also attack!
    const zMove = applyIntentWithCost(zState, { type: IntentType.Move, entityId: zombSpawn.npcId, dx: -1, dy: 0 });
    expect(zMove.energyCost).toBe(0);
    expect(getDnD35EntityData(zMove.state, zombSpawn.npcId).actionBudget?.standardRemaining).toBe(0);
    expect(
      canDnD35eActorPerformIntent(zMove.state, {
        type: IntentType.MeleeAttack,
        entityId: zombSpawn.npcId,
        defenderId: playerId
      })
    ).toBe(false);

    // Nauseated actor: standardRemaining: 0, moveRemaining: 1, swiftRemaining: 0 -> Move allowed, Attack blocked
    const nauSpawn = spawnHostileNpc(baseState, 6, 6);
    let nState = setDnD35EntityData(nauSpawn.state, nauSpawn.npcId, {
      ...getDnD35EntityData(nauSpawn.state, nauSpawn.npcId),
      conditions: ['nauseated']
    });
    nState = onDnD35eActorTurnStart(nState, nauSpawn.npcId);
    const nBudget = getDnD35EntityData(nState, nauSpawn.npcId).actionBudget!;
    expect(nBudget.standardRemaining).toBe(0);
    expect(nBudget.moveRemaining).toBe(1);
    expect(nBudget.swiftRemaining).toBe(0);
    expect(
      canDnD35eActorPerformIntent(nState, { type: IntentType.Move, entityId: nauSpawn.npcId, dx: -1, dy: 0 })
    ).toBe(true);
    expect(
      canDnD35eActorPerformIntent(nState, {
        type: IntentType.MeleeAttack,
        entityId: nauSpawn.npcId,
        defenderId: playerId
      })
    ).toBe(false);
  });

  test('5. Declarative extra_standard_actions StatModifier grants 2 Standard actions in one round', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const spawned = spawnHostileNpc(baseState, 4, 5);
    let state = setDnD35EntityData(spawned.state, spawned.npcId, {
      ...getDnD35EntityData(spawned.state, spawned.npcId),
      statModifiers: [
        {
          targetStat: 'extra_standard_actions',
          value: 1,
          bonusType: 'untyped',
          sourceId: 'quickness',
          sourcePath: 'trait:quickness',
          origin: 'su'
        }
      ]
    });

    state = onDnD35eActorTurnStart(state, spawned.npcId);
    const budget = getDnD35EntityData(state, spawned.npcId).actionBudget!;
    expect(budget.standardRemaining).toBe(2);
    expect(budget.moveRemaining).toBe(1);

    // Step 1 closes to adjacent (x=4 -> x=3), consuming Move action and allowing 2 Standard Attacks in sequence
    const step1 = applyIntentWithCost(state, { type: IntentType.Move, entityId: spawned.npcId, dx: -1, dy: 0 });
    expect(step1.success).toBe(true);
    expect(step1.energyCost).toBe(0);

    const atk1 = applyIntentWithCost(step1.state, {
      type: IntentType.MeleeAttack,
      entityId: spawned.npcId,
      defenderId: playerId
    });
    expect(atk1.success).toBe(true);
    // Still has 1 Standard action left!
    expect(atk1.energyCost).toBe(0);
    expect(getDnD35EntityData(atk1.state, spawned.npcId).actionBudget?.standardRemaining).toBe(1);

    const atk2 = applyIntentWithCost(atk1.state, {
      type: IntentType.MeleeAttack,
      entityId: spawned.npcId,
      defenderId: playerId
    });
    expect(atk2.success).toBe(true);
    expect(atk2.energyCost).toBe(100);
    expect(getDnD35EntityData(atk2.state, spawned.npcId).actionBudget).toBeUndefined();
  });

  test('6. Ranged/Caster AI holds position cleanly after spending Standard action instead of charging or wandering', () => {
    let { state } = buildOpenArenaState();
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        effects: {
          ...state.campaign.effects,
          arcane_bolt: {
            id: 'arcane_bolt',
            type: 'damage_nearest',
            value: 4,
            range: 6,
            message: 'An arcane bolt strikes {target} for {value} damage!',
            tags: ['spell', 'magic']
          }
        },
        ai: {
          ...state.campaign.ai,
          archer_mage_test: {
            id: 'archer_mage_test',
            behaviors: [
              { behaviorId: 'ranged', effectId: 'arcane_bolt', abilityName: 'Arcane Bolt', range: 6 },
              { behaviorId: 'hunt', aggroRadius: 12 },
              { behaviorId: 'wander' }
            ]
          }
        }
      }
    };

    // Player at (2, 5), Caster at (6, 5) -> distance = 4 (inside range 6)
    const spawned = spawnHostileNpc(state, 6, 5, { profileId: 'archer_mage_test' });
    state = onDnD35eActorTurnStart(spawned.state, spawned.npcId);

    // Slice 1: Chooses ranged ability -> succeeds -> energyCost 0 (1 Move action still remaining)
    const turn1 = processAITurn(state, spawned.npcId);
    expect(turn1.intent?.type).toBe(IntentType.UseAbility);
    const res1 = applyIntentWithCost(turn1.state, turn1.intent!);
    expect(res1.success).toBe(true);
    expect(res1.energyCost).toBe(0);
    expect(hasDnD35eActorActedThisTurn(res1.state, spawned.npcId)).toBe(true);
    expect(getDnD35EntityData(res1.state, spawned.npcId).actionBudget?.standardRemaining).toBe(0);
    expect(getDnD35EntityData(res1.state, spawned.npcId).actionBudget?.moveRemaining).toBe(1);

    // Slice 2: ranged is blocked by standardRemaining === 0; hunt refuses melee charge; wander sees hasActorActedThisTurn -> returns null!
    const turn2 = processAITurn(res1.state, spawned.npcId);
    expect(turn2.intent).toBeNull();
    const posAfter = getComponent(res1.state, spawned.npcId, ComponentType.Position)!;
    expect(posAfter.x).toBe(6);
    expect(posAfter.y).toBe(5);
  });
});
