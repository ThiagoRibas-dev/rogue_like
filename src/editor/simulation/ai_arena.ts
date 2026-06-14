import { EngineMode, UIMode, type GameState } from '../../types/game-state.types.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { spawnEntity, getComponent, addComponent } from '../../core/ecs.ts';
import { processAITurn } from '../../systems/ai.system.ts';
import { processStatusEffectsTick } from '../../systems/status-effect.system.ts';
import { processDamageSystem } from '../../systems/damage.system.ts';
import { processDeathSystem } from '../../systems/death.system.ts';
import { dispatchAction } from '../../actions/action.registry.ts';

export interface ArenaResult {
  logs: string[];
}

export function runAIArena(
  combatantAId: string,
  combatantBId: string,
  campaign: CampaignData,
  maxTurns: number = 100
): ArenaResult {
  // Initialize mock state
  let state: GameState = {
    campaignId: 'arena',
    campaign,
    dynamicQuests: {},
    entities: [],
    components: new Map(),
    map: {
      width: 10,
      height: 10,
      tiles: []
    },
    nextEntityId: 1,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    messages: [],
    events: [],
    currentAreaId: 'arena',
    areas: new Map(),
    persistentEntities: new Map(),
    spatialIndex: new Map(),
    isGameOver: false,
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
    investigation: { knownActors: [], discoveredClues: [], exposedAgreements: [] }
  };

  // Setup the map coordinates properly so distance checks work
  const tiles = [];
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 10; x++) {
      tiles.push({ tileId: 'floor', explored: true, x, y });
    }
  }
  state = { ...state, map: { ...state.map, tiles } };

  // Spawn A at (2, 5)
  const [stateAfterA, entA] = spawnEntity(state, combatantAId, 2, 5);
  state = stateAfterA;

  // Spawn B at (7, 5)
  const [stateAfterB, entB] = spawnEntity(state, combatantBId, 7, 5);
  state = stateAfterB;

  // Inject grudges to ensure mutual hostility
  const memA = getComponent(state, entA, ComponentType.Memory);
  if (memA) {
    state = addComponent(state, entA, { ...memA, grudges: [...memA.grudges, entB.toString()] });
  } else {
    state = addComponent(state, entA, {
      type: ComponentType.Memory,
      grudges: [entB.toString()],
      factionStandings: {},
      facts: []
    });
  }

  const memB = getComponent(state, entB, ComponentType.Memory);
  if (memB) {
    state = addComponent(state, entB, { ...memB, grudges: [...memB.grudges, entA.toString()] });
  } else {
    state = addComponent(state, entB, {
      type: ComponentType.Memory,
      grudges: [entA.toString()],
      factionStandings: {},
      facts: []
    });
  }

  const logs: string[] = [`=== Simulation Started: ${combatantAId} vs ${combatantBId} ===`];

  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    logs.push(`\n--- Turn ${turns} ---`);

    for (const actor of [entA, entB]) {
      // Check if actor is still alive
      const fighter = getComponent(state, actor, ComponentType.Fighter);
      if (!fighter || fighter.hp <= 0) continue;

      const prevMessageCount = state.messages.length;

      // 1. Tick status effects
      state = processStatusEffectsTick(state, actor);
      state = processDamageSystem(state);
      state = processDeathSystem(state);

      if ((getComponent(state, actor, ComponentType.Fighter)?.hp ?? 0) <= 0) {
        continue; // Died to DoT
      }

      // 2. Evaluate AI Turn
      const intent = processAITurn(state, actor);

      if (intent) {
        // 3. Execute Intent
        const result = dispatchAction(state, intent);
        state = result.state;

        // 4. Resolve Combat Damage & Death
        state = processDamageSystem(state);
        state = processDeathSystem(state);

        // Discard events for arena to save memory
        state = { ...state, events: [] };
      } else {
        logs.push(`${actor === entA ? combatantAId : combatantBId} waits.`);
      }

      // 5. Extract new messages
      if (state.messages.length > prevMessageCount) {
        const newMessages = state.messages.slice(prevMessageCount);
        for (const msg of newMessages) {
          logs.push(msg.text);
        }
      }
    }

    // Check if simulation ended
    const fighterA = getComponent(state, entA, ComponentType.Fighter);
    const fighterB = getComponent(state, entB, ComponentType.Fighter);

    if (!fighterA || fighterA.hp <= 0) {
      logs.push(`\n>>> ${combatantAId} died. ${combatantBId} wins! <<<`);
      break;
    }
    if (!fighterB || fighterB.hp <= 0) {
      logs.push(`\n>>> ${combatantBId} died. ${combatantAId} wins! <<<`);
      break;
    }
  }

  if (turns >= maxTurns) {
    logs.push(`\n>>> Simulation ended after ${maxTurns} turns (Draw) <<<`);
  }

  return { logs };
}
