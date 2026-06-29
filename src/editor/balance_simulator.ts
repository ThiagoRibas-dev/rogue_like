import type { CampaignData } from '../types/campaign.types.ts';
import { initRNG } from '../core/rng.ts';
import { ComponentType } from '../types/components.types.ts';
import type { FighterComponent, SchemeComponent } from '../types/components.types.ts';
import { spawnEntity } from '../core/ecs.ts';
import { applyIntentWithCost } from '../core/game-loop.ts';
import { createMoveAction } from '../actions/core.actions.ts';
import { IntentType } from '../types/intents/intent.enum.ts';
import { toEntityId, type GameState, EngineMode, UIMode } from '../types/game-state.types.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';
import { compilePhases } from '../systems/scheme_compiler.ts';
import { processSchemeTurn } from '../systems/scheme.system.ts';

export interface BalanceReport {
  combat: {
    victoryRate: number;
    avgTurns: number;
    avgHpLost: number;
  };
  hunger: {
    avgTurnsToStarve: number;
  };
  schemes: {
    avgEscalations: number;
    avgConspiracyAwareness: number;
  };
}

/**
 * Runs a suite of headless automated simulations to test combat, hunger, and scheme balance.
 */
export function runBalanceSimulations(campaign: CampaignData, runs: number): BalanceReport {
  // Set deterministic seed for the balance run
  initRNG(42);

  let combatWins = 0;
  let totalCombatTurns = 0;
  let totalHpLost = 0;

  let totalTurnsToStarve = 0;

  let totalEscalations = 0;
  let totalConspiracyAwareness = 0;

  // 1. COMBAT SIMULATION (Headless AI Arena fights)
  for (let i = 0; i < runs; i++) {
    // Setup a mock mini combat state
    let state = createMockGameState(campaign);
    const [state1, player] = spawnEntity(state, 'player', 5, 5);
    const [state2, monster] = spawnEntity(state1, 'orc', 5, 6);
    state = state2;

    let turns = 0;
    let victory = false;
    const initialPlayerHp = (state.components.get(player)?.[ComponentType.Fighter] as FighterComponent)?.hp ?? 30;

    // Simulate turn-by-turn bumping attacks
    while (turns < 100) {
      turns++;

      // Player attacks monster (bumper action)
      const pIntent = {
        type: IntentType.MeleeAttack,
        entityId: player,
        defenderId: monster
      } as const;
      const result = applyIntentWithCost(state, pIntent);
      state = result.state;

      // Check if monster died
      const monsterFighter = state.components.get(monster)?.[ComponentType.Fighter] as FighterComponent | undefined;
      if (!monsterFighter || monsterFighter.hp <= 0) {
        victory = true;
        break;
      }

      // Monster attacks player
      const mIntent = {
        type: IntentType.MeleeAttack,
        entityId: monster,
        defenderId: player
      } as const;
      const mResult = applyIntentWithCost(state, mIntent);
      state = mResult.state;

      // Check if player died
      const playerFighter = state.components.get(player)?.[ComponentType.Fighter] as FighterComponent | undefined;
      if (!playerFighter || playerFighter.hp <= 0) {
        victory = false;
        break;
      }
    }

    if (victory) {
      combatWins++;
      const finalPlayerHp = (state.components.get(player)?.[ComponentType.Fighter] as FighterComponent)?.hp ?? 0;
      totalHpLost += Math.max(0, initialPlayerHp - finalPlayerHp);
    }
    totalCombatTurns += turns;
  }

  // 2. HUNGER SIMULATION
  for (let i = 0; i < runs; i++) {
    let state = createMockGameState(campaign);
    const [state1, player] = spawnEntity(state, 'player', 5, 5);
    state = state1;

    let turns = 0;
    while (turns < 2000) {
      turns++;
      // Move north and south repeatedly (burns hunger energy)
      const dy = turns % 2 === 0 ? 1 : -1;
      const moveIntent = createMoveAction(player, 0, dy);
      const result = applyIntentWithCost(state, moveIntent);
      state = result.state;

      // If player died of starvation/damage
      const fighter = state.components.get(player)?.[ComponentType.Fighter] as FighterComponent | undefined;
      if (!fighter || fighter.hp <= 0) {
        break;
      }
    }
    totalTurnsToStarve += turns;
  }

  // 3. SCHEMES ESCALATION SIMULATION
  for (let i = 0; i < runs; i++) {
    let state = createMockGameState(campaign);
    const mastermindId = toEntityId(state.nextEntityId);
    state = {
      ...state,
      nextEntityId: state.nextEntityId + 1,
      persistentEntities: new Map([
        [
          mastermindId,
          {
            areaId: 'world',
            components: {
              [ComponentType.Scheme]: {
                type: ComponentType.Scheme,
                recipeId: 'bandit_uprising',
                currentPhase: 0,
                activeMinions: [],
                phases: compilePhases(campaign, 'bandit_uprising'),
                conspiracyAwareness: 0
              },
              [ComponentType.Actor]: {
                type: ComponentType.Actor,
                speed: 100
              }
            }
          }
        ]
      ])
    };

    let turns = 0;
    let escalations = 0;
    while (turns < 500) {
      turns++;
      // Process scheme turn
      const nextState = processSchemeTurn(state, mastermindId);
      const prevScheme = state.persistentEntities.get(mastermindId)?.components[ComponentType.Scheme] as
        | SchemeComponent
        | undefined;
      const nextScheme = nextState.persistentEntities.get(mastermindId)?.components[ComponentType.Scheme] as
        | SchemeComponent
        | undefined;

      if (prevScheme && nextScheme && nextScheme.currentPhase > prevScheme.currentPhase) {
        escalations++;
      }
      state = nextState;
    }

    totalEscalations += escalations;
    const finalScheme = state.persistentEntities.get(mastermindId)?.components[ComponentType.Scheme] as
      | SchemeComponent
      | undefined;
    totalConspiracyAwareness += finalScheme?.conspiracyAwareness ?? 0;
  }

  return {
    combat: {
      victoryRate: combatWins / runs,
      avgTurns: totalCombatTurns / runs,
      avgHpLost: combatWins > 0 ? totalHpLost / combatWins : 0
    },
    hunger: {
      avgTurnsToStarve: totalTurnsToStarve / runs
    },
    schemes: {
      avgEscalations: totalEscalations / runs,
      avgConspiracyAwareness: totalConspiracyAwareness / runs
    }
  };
}

function createMockGameState(campaign: CampaignData): GameState {
  return {
    campaignId: 'default',
    campaign,
    dynamicQuests: {},
    entities: [],
    components: new Map(),
    map: {
      width: 10,
      height: 10,
      tiles: Array.from({ length: 100 }, (_, i) => ({
        tileId: 'floor',
        x: i % 10,
        y: Math.floor(i / 10),
        explored: true
      }))
    },
    fovNeedsUpdate: false,
    cachedFov: new Set(),
    nextEntityId: 1,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    messages: [],
    events: [],
    currentAreaId: 'area1',
    activeRooms: [],
    lastSpawnTurn: 0,
    areas: new Map(),
    persistentEntities: new Map(),
    spatialIndex: new Map(),
    isGameOver: false,
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    uiMode: UIMode.Game,
    identifiedItems: new Set(),
    itemUnidentifiedNames: new Map(),
    engineMode: EngineMode.TurnBased,
    visualEffects: [],
    rtwpState: { paused: false, speedMultiplier: 1 },
    isRotated: false,
    is3D: false,
    zoomLevel: 1,
    playerCommandQueue: [],
    investigation: { knownActors: [], exposedAgreements: [], lastClueTurn: 0 },
    historicalLedger: [],
    factionEntityIds: {},
    areaEntityIds: {},
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
    dramaTracker: {
      globalBudget: DEFAULT_GLOBAL_DRAMA_BUDGET,
      domainBudgets: {},
      activeCooldowns: {},
      lastMajorEventTurn: 0
    },
    telemetry: { playerDeaths: 0, damageTaken: 0, resourcesConsumed: 0, questsCompleted: 0 }
  };
}
