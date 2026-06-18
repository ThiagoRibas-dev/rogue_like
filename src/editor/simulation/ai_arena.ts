import { dispatchAction } from '../../actions/action.registry.ts';
import { addComponent, getComponent, spawnEntity } from '../../core/ecs.ts';
import { processAITurn } from '../../systems/ai.system.ts';
import { processDamageSystem } from '../../systems/damage.system.ts';
import { processDeathSystem } from '../../systems/death.system.ts';
import { processStatusEffectsTick } from '../../systems/status-effect.system.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import { EngineMode, UIMode, type EntityId, type GameState } from '../../types/game-state.types.ts';

export interface ArenaTelemetry {
  readonly winner: 'a' | 'b' | 'draw';
  readonly turnsElapsed: number;
  readonly damageDealtA: number;
  readonly damageDealtB: number;
  readonly finalHpA: number;
  readonly finalHpB: number;
}

export interface ArenaResult {
  readonly logs: ReadonlyArray<string>;
  readonly telemetry: ArenaTelemetry;
}

export interface ArenaOptions {
  readonly mapWidth?: number;
  readonly mapHeight?: number;
  readonly mapTiles?: ReadonlyArray<{
    readonly tileId: string;
    readonly x: number;
    readonly y: number;
    readonly explored?: boolean;
  }>;
  readonly placementA?: { readonly x: number; readonly y: number };
  readonly placementB?: { readonly x: number; readonly y: number };
  readonly spawnExtraEntities?: ReadonlyArray<{
    readonly templateId: string;
    readonly x: number;
    readonly y: number;
  }>;
}

/**
 * Collects arena state for later aggregation.
 */
interface ArenaDamageTracker {
  damageToA: number;
  damageToB: number;
}

/**
 * Runs a head-to-head AI arena simulation.
 *
 * @param combatantAId  Template ID for combatant A.
 * @param combatantBId  Template ID for combatant B.
 * @param campaign      Campaign data with entity/item/etc registries.
 * @param maxTurns      Maximum simulation turns before declaring a draw.
 * @param options       Optional overrides for map layout, placement, extra entities.
 * @returns ArenaResult with logs and structured telemetry.
 */
export function runAIArena(
  combatantAId: string,
  combatantBId: string,
  campaign: CampaignData,
  maxTurns: number = 100,
  options?: ArenaOptions
): ArenaResult {
  const mapWidth = options?.mapWidth ?? 10;
  const mapHeight = options?.mapHeight ?? 10;
  const placementA = options?.placementA ?? { x: 2, y: 5 };
  const placementB = options?.placementB ?? { x: 7, y: 5 };

  // Initialize mock state
  let state: GameState = {
    campaignId: 'arena',
    campaign,
    dynamicQuests: {},
    entities: [],
    components: new Map(),
    map: {
      width: mapWidth,
      height: mapHeight,
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
    zoomLevel: 1.4,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    playerCommandQueue: [],
    investigation: { knownActors: [], discoveredClues: [], exposedAgreements: [] }
  };

  // Setup the map tiles: use provided tiles or fall back to a flat arena
  const tiles: Array<{ tileId: string; explored: boolean; x: number; y: number }> = [];
  if (options?.mapTiles && options.mapTiles.length > 0) {
    for (const t of options.mapTiles) {
      tiles.push({ tileId: t.tileId, explored: t.explored ?? true, x: t.x, y: t.y });
    }
  } else {
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        tiles.push({ tileId: 'floor', explored: true, x, y });
      }
    }
  }
  state = { ...state, map: { ...state.map, tiles } };

  // Spawn A at placement position
  const [stateAfterA, entA] = spawnEntity(state, combatantAId, placementA.x, placementA.y);
  state = stateAfterA;

  // Spawn B at placement position
  const [stateAfterB, entB] = spawnEntity(state, combatantBId, placementB.x, placementB.y);
  state = stateAfterB;

  // Spawn extra entities (e.g., from Director)
  const extraEntityIds: EntityId[] = [];
  if (options?.spawnExtraEntities) {
    for (const extra of options.spawnExtraEntities) {
      const [s, eid] = spawnEntity(state, extra.templateId, extra.x, extra.y);
      state = s;
      extraEntityIds.push(eid);

      // Make extra entities hostile to both A and B
      const mem = getComponent(state, eid, ComponentType.Memory);
      if (mem) {
        state = addComponent(state, eid, {
          ...mem,
          grudges: [...mem.grudges, entA.toString(), entB.toString()]
        });
      } else {
        state = addComponent(state, eid, {
          type: ComponentType.Memory,
          grudges: [entA.toString(), entB.toString()],
          factionStandings: {},
          facts: []
        });
      }
    }
  }

  // Inject grudges to ensure mutual hostility
  const allGrudgesA = [entB.toString(), ...extraEntityIds.map((id) => id.toString())];
  const allGrudgesB = [entA.toString(), ...extraEntityIds.map((id) => id.toString())];

  const memA = getComponent(state, entA, ComponentType.Memory);
  if (memA) {
    state = addComponent(state, entA, { ...memA, grudges: [...memA.grudges, ...allGrudgesA] });
  } else {
    state = addComponent(state, entA, {
      type: ComponentType.Memory,
      grudges: allGrudgesA,
      factionStandings: {},
      facts: []
    });
  }

  const memB = getComponent(state, entB, ComponentType.Memory);
  if (memB) {
    state = addComponent(state, entB, { ...memB, grudges: [...memB.grudges, ...allGrudgesB] });
  } else {
    state = addComponent(state, entB, {
      type: ComponentType.Memory,
      grudges: allGrudgesB,
      factionStandings: {},
      facts: []
    });
  }

  const logs: string[] = [`=== Simulation Started: ${combatantAId} vs ${combatantBId} ===`];
  if (extraEntityIds.length > 0) {
    logs.push(`  + ${extraEntityIds.length} extra entities spawned.`);
  }

  // Telemetry tracking
  const tracker: ArenaDamageTracker = { damageToA: 0, damageToB: 0 };

  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    logs.push(`\n--- Turn ${turns} ---`);

    const allActors = [entA, entB, ...extraEntityIds];

    for (const actor of allActors) {
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
        const startHpA = getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0;
        const startHpB = getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0;

        const result = dispatchAction(state, intent);
        state = result.state;

        // 4. Resolve Combat Damage & Death
        state = processDamageSystem(state);
        state = processDeathSystem(state);

        // Track damage via HP deltas
        const afterHpA = getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0;
        const afterHpB = getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0;

        if (actor.toString() === entA.toString()) {
          tracker.damageToB += startHpB - afterHpB;
        } else if (actor.toString() === entB.toString()) {
          tracker.damageToA += startHpA - afterHpA;
        } else {
          // Extra entity — count damage to A and B
          tracker.damageToA += startHpA - afterHpA;
          tracker.damageToB += startHpB - afterHpB;
        }

        // Discard events for arena to save memory
        state = { ...state, events: [] };
      } else {
        const name = actor === entA ? combatantAId : actor === entB ? combatantBId : `extra_${actor}`;
        logs.push(`${name} waits.`);
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

  const finalHpA = Math.max(0, getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0);
  const finalHpB = Math.max(0, getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0);

  let winner: ArenaTelemetry['winner'] = 'draw';
  if (finalHpA <= 0 && finalHpB > 0) winner = 'b';
  else if (finalHpB <= 0 && finalHpA > 0) winner = 'a';

  if (turns >= maxTurns) {
    logs.push(`\n>>> Simulation ended after ${maxTurns} turns (Draw) <<<`);
  }

  const telemetry: ArenaTelemetry = {
    winner,
    turnsElapsed: turns,
    damageDealtA: tracker.damageToB,
    damageDealtB: tracker.damageToA,
    finalHpA,
    finalHpB
  };

  return { logs, telemetry };
}

/**
 * Runs a batch arena simulation where the player (as AI) fights all Director-spawned entities
 * one at a time, in a generated map context.
 *
 * @param playerTemplateId   The entity template ID for the player.
 * @param directorEntities   Entities spawned by the Encounter Director.
 * @param campaign           Campaign data.
 * @param map                The generated map (width, height, tiles).
 * @param playerStart        Player start position on the map.
 * @param maxTurns           Max turns per 1v1 engagement.
 * @returns Aggregate telemetry and per-engagement results.
 */
export function runEncounterArena(
  playerTemplateId: string,
  directorEntities: ReadonlyArray<{ readonly templateId: string; readonly x: number; readonly y: number }>,
  campaign: CampaignData,
  map: {
    readonly width: number;
    readonly height: number;
    readonly tiles: ReadonlyArray<{ readonly tileId: string; readonly x: number; readonly y: number }>;
  },
  playerStart: { readonly x: number; readonly y: number },
  maxTurns: number = 100
): {
  readonly results: ReadonlyArray<ArenaResult>;
  readonly aggregate: {
    readonly playerWins: number;
    readonly enemyWins: number;
    readonly draws: number;
    readonly avgTurns: number;
    readonly avgPlayerHpRemaining: number;
  };
} {
  const results: ArenaResult[] = [];

  for (const entity of directorEntities) {
    // Place player near the entity but at a distance
    const playerX = Math.max(1, Math.min(map.width - 2, playerStart.x));
    const playerY = Math.max(1, Math.min(map.height - 2, playerStart.y));

    const result = runAIArena(playerTemplateId, entity.templateId, campaign, maxTurns, {
      mapWidth: map.width,
      mapHeight: map.height,
      mapTiles: map.tiles,
      placementA: { x: playerX, y: playerY },
      placementB: { x: entity.x, y: entity.y }
    });
    results.push(result);
  }

  const nonDraws = results.filter((r) => r.telemetry.winner !== 'draw');
  const playerWins = results.filter((r) => r.telemetry.winner === 'a').length;
  const enemyWins = results.filter((r) => r.telemetry.winner === 'b').length;
  const draws = results.filter((r) => r.telemetry.winner === 'draw').length;
  const avgTurns = results.length > 0 ? results.reduce((s, r) => s + r.telemetry.turnsElapsed, 0) / results.length : 0;
  const avgPlayerHpRemaining =
    nonDraws.length > 0
      ? nonDraws.filter((r) => r.telemetry.winner === 'a').reduce((s, r) => s + r.telemetry.finalHpA, 0) /
      nonDraws.length
      : 0;

  return {
    results,
    aggregate: { playerWins, enemyWins, draws, avgTurns, avgPlayerHpRemaining }
  };
}
