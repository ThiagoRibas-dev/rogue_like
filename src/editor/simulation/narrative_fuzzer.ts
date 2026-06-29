import * as ROT from 'rot-js';
import type { FuzzerOptions, FuzzerReport, FuzzerTelemetry, FuzzerError, FuzzerErrorType } from './fuzzer.types.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import {
  type EntityId,
  type GameState,
  UIMode,
  EngineMode,
  type PersistentEntityRecord,
  toEntityId
} from '../../types/game-state.types.ts';
import {
  ComponentType,
  type IdentityComponent,
  type TagsComponent,
  type InteractionScoreComponent,
  type ChronicleComponent,
  type MemoryComponent,
  type DirectorBudgetComponent,
  type SchemeComponent,
  type ActorComponent
} from '../../types/components.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { GameEventType } from '../../types/events.types.ts';
import { spawnEntity, spawnItem, getComponent, queryEntities, addComponent } from '../../core/ecs.ts';
import { generateArea } from '../../map/generator.ts';
import { compilePhases } from '../../systems/scheme_compiler.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../../constants/pacing.constants.ts';
import { applyIntentWithCost } from '../../core/game-loop.ts';
import { processStatusEffectsTick, shouldSkipTurn } from '../../systems/status-effect.system.ts';
import { processDamageSystem } from '../../systems/damage.system.ts';
import { processDeathSystem } from '../../systems/death.system.ts';
import { processSchemeTurn } from '../../systems/scheme.system.ts';
import { processAITurn } from '../../systems/ai.system.ts';

// Custom error classes for runaway loops
export class TriggerRunawayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerRunawayError';
  }
}

/**
 * Creates the initial mock GameState for a headless fuzzer run.
 */
function createMockFuzzerState(campaignConfig: Readonly<CampaignData>): GameState {
  const campaign = JSON.parse(JSON.stringify(campaignConfig)) as CampaignData;
  const startingAreaId = campaign.rules.map.startingAreaId;

  // Generate the area
  const { map, startPos, portals, rooms, placedEntities } = generateArea(campaign, startingAreaId);

  let nextEntityId = 1;
  const factionEntityIds: Record<string, EntityId> = {};
  const areaEntityIds: Record<string, EntityId> = {};
  const initialPersistentEntities = new Map<EntityId, PersistentEntityRecord>();

  // Initialize factions
  for (const factionId of Object.keys(campaign.factions)) {
    const id = nextEntityId++ as EntityId;
    factionEntityIds[factionId] = id;
    initialPersistentEntities.set(id, {
      areaId: 'world',
      components: {
        [ComponentType.Identity]: {
          type: ComponentType.Identity,
          name: factionId,
          mannerisms: []
        } as IdentityComponent,
        [ComponentType.Tags]: { type: ComponentType.Tags, tags: ['faction'] } as TagsComponent,
        [ComponentType.InteractionScore]: {
          type: ComponentType.InteractionScore,
          score: 0
        } as InteractionScoreComponent,
        [ComponentType.Chronicle]: {
          type: ComponentType.Chronicle,
          pis: 0,
          scars: [],
          coreMemories: [],
          eventExcerpts: []
        } as ChronicleComponent,
        [ComponentType.Memory]: {
          type: ComponentType.Memory,
          grudges: [],
          factionStandings: {},
          facts: [],
          knowledge: {}
        } as MemoryComponent
      }
    });
  }

  // Initialize areas
  for (const [areaId, def] of Object.entries(campaign.areas)) {
    const id = nextEntityId++ as EntityId;
    areaEntityIds[areaId] = id;
    initialPersistentEntities.set(id, {
      areaId: 'world',
      components: {
        [ComponentType.Identity]: {
          type: ComponentType.Identity,
          name: def.name || areaId,
          mannerisms: []
        } as IdentityComponent,
        [ComponentType.Tags]: { type: ComponentType.Tags, tags: ['area', ...(def.tags || [])] } as TagsComponent,
        [ComponentType.InteractionScore]: {
          type: ComponentType.InteractionScore,
          score: 0
        } as InteractionScoreComponent,
        [ComponentType.DirectorBudget]: {
          type: ComponentType.DirectorBudget,
          budgetModifier: 0
        } as DirectorBudgetComponent,
        [ComponentType.Chronicle]: {
          type: ComponentType.Chronicle,
          pis: 0,
          scars: [],
          coreMemories: [],
          eventExcerpts: []
        } as ChronicleComponent,
        [ComponentType.Memory]: {
          type: ComponentType.Memory,
          grudges: [],
          factionStandings: {},
          facts: [],
          knowledge: {}
        } as MemoryComponent
      }
    });
  }

  let state: GameState = {
    campaignId: 'fuzz_run',
    campaign,
    dynamicQuests: {},
    entities: [],
    components: new Map(),
    map,
    nextEntityId,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    messages: [],
    events: [],
    currentAreaId: startingAreaId,
    areas: new Map(),
    persistentEntities: initialPersistentEntities,
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
    zoomLevel: 1.0,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    playerCommandQueue: [],
    activeRooms: rooms,
    lastSpawnTurn: 0,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
    factionEntityIds,
    areaEntityIds,
    investigation: { knownActors: [], exposedAgreements: [], lastClueTurn: 0 },
    historicalLedger: [],
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    dramaTracker: {
      globalBudget: DEFAULT_GLOBAL_DRAMA_BUDGET,
      domainBudgets: {},
      activeCooldowns: {},
      lastMajorEventTurn: 0
    },
    telemetry: {
      playerDeaths: 0,
      damageTaken: 0,
      resourcesConsumed: 0,
      questsCompleted: 0
    }
  };

  // Spawn the player
  const playerTemplateId =
    Object.entries(campaign.entities).find(
      ([, e]) => e.tags?.includes('actor') && e.roleTags?.includes('protein')
    )?.[0] ?? 'player';
  const finalPlayerTemplate = campaign.entities[playerTemplateId] ? playerTemplateId : 'player';

  // Make sure we have a player template of some kind, even if it's default
  if (!campaign.entities[finalPlayerTemplate]) {
    // Inject a dummy player template to prevent spawnEntity crash
    campaign.entities[finalPlayerTemplate] = {
      id: finalPlayerTemplate,
      name: 'Player',
      glyph: '@',
      fg: '#ffffff',
      bg: 'transparent',
      isActor: true,
      fighter: { maxHp: 100, attack: 10, defense: 5 },
      tags: ['actor']
    };
  }

  const [stateAfterPlayer] = spawnEntity(state, finalPlayerTemplate, startPos.x, startPos.y);
  state = stateAfterPlayer;

  // Pre-seed the Mastermind
  const recipeKeys = Object.keys(campaign.schemeRecipes || {});
  if (recipeKeys.length > 0) {
    const recipeId = recipeKeys[0]!;
    const mastermindId = state.nextEntityId as EntityId;
    state = { ...state, nextEntityId: state.nextEntityId + 1 };
    const schemeComp: SchemeComponent = {
      type: ComponentType.Scheme,
      recipeId,
      currentPhase: 0,
      activeMinions: [],
      phases: compilePhases(campaign, recipeId),
      conspiracyAwareness: 0
    };
    const mastermindActor: ActorComponent = {
      type: ComponentType.Actor,
      speed: 100
    };
    state = {
      ...state,
      persistentEntities: new Map([
        ...state.persistentEntities.entries(),
        [
          mastermindId,
          {
            areaId: 'world',
            components: {
              [ComponentType.Scheme]: schemeComp,
              [ComponentType.Actor]: mastermindActor
            }
          }
        ]
      ])
    };
  }

  // Spawn placed entities and portals
  for (const portal of portals) {
    let stairId: EntityId;
    [state, stairId] = createEntity(state);

    state = addComponent(state, stairId, { type: ComponentType.Position, x: portal.x, y: portal.y });
    state = addComponent(state, stairId, {
      type: ComponentType.Renderable,
      glyph: portal.connection.direction === 'up' ? '<' : '>',
      fg: '#fff',
      bg: 'transparent'
    });
    state = addComponent(state, stairId, {
      type: ComponentType.Portal,
      targetAreaId: portal.connection.targetAreaId,
      targetX: portal.connection.targetX,
      targetY: portal.connection.targetY
    });
    state = addComponent(state, stairId, { type: ComponentType.Tags, tags: ['portal'] });
  }

  if (placedEntities) {
    for (const ent of placedEntities) {
      if (campaign.items[ent.templateId]) {
        [state] = spawnItem(state, ent.templateId, ent.x, ent.y);
      } else if (campaign.entities[ent.templateId]) {
        [state] = spawnEntity(state, ent.templateId, ent.x, ent.y, ent.dynamicTraits, ent.inventory);
      }
    }
  }

  return state;
}

/**
 * Headless helper to create an entity (duplicate of ecs.ts creation to avoid circular deps if any, but directly importing here is fine).
 */
function createEntity(state: GameState): [GameState, EntityId] {
  const newId = toEntityId(state.nextEntityId);
  const nextEntities = [...state.entities, newId];
  const nextComponents = new Map(state.components);
  nextComponents.set(newId, {});
  return [
    {
      ...state,
      entities: nextEntities,
      components: nextComponents,
      nextEntityId: state.nextEntityId + 1
    },
    newId
  ];
}

/**
 * Headless player AI generating random movement / actions to drive the narrative.
 */
function generatePlayerFuzzerIntent(state: GameState, playerEnt: EntityId): Intent {
  const playerPos = getComponent(state, playerEnt, ComponentType.Position);
  if (!playerPos) {
    return { type: IntentType.Wait, entityId: playerEnt };
  }

  // 1. If adjacent to portal/stairs, change area (10% chance to reduce infinite back-and-forth transitions)
  if (ROT.RNG.getUniform() < 0.1) {
    for (const entId of state.entities) {
      const portal = getComponent(state, entId, ComponentType.Portal);
      const pos = getComponent(state, entId, ComponentType.Position);
      if (portal && pos && Math.abs(pos.x - playerPos.x) <= 1 && Math.abs(pos.y - playerPos.y) <= 1) {
        return {
          type: IntentType.ChangeArea,
          entityId: playerEnt,
          targetAreaId: portal.targetAreaId,
          targetX: portal.targetX,
          targetY: portal.targetY
        };
      }
    }
  }

  // 2. Pick up items under the player
  for (const entId of state.entities) {
    const item = getComponent(state, entId, ComponentType.Item);
    const pos = getComponent(state, entId, ComponentType.Position);
    if (item && pos && pos.x === playerPos.x && pos.y === playerPos.y) {
      return {
        type: IntentType.PickUp,
        entityId: playerEnt
      };
    }
  }

  // 3. Attack adjacent enemies
  for (const entId of state.entities) {
    const fighter = getComponent(state, entId, ComponentType.Fighter);
    const pos = getComponent(state, entId, ComponentType.Position);
    const isPlayer = getComponent(state, entId, ComponentType.Player) !== undefined;
    if (fighter && pos && !isPlayer && Math.abs(pos.x - playerPos.x) <= 1 && Math.abs(pos.y - playerPos.y) <= 1) {
      return {
        type: IntentType.MeleeAttack,
        entityId: playerEnt,
        defenderId: entId
      };
    }
  }

  // 4. Random walk to passable neighbor
  const directions = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 }
  ];

  // Shuffle directions using ROT.RNG
  const shuffledDirs = [...directions];
  for (let i = shuffledDirs.length - 1; i > 0; i--) {
    const j = Math.floor(ROT.RNG.getUniform() * (i + 1));
    const temp = shuffledDirs[i]!;
    shuffledDirs[i] = shuffledDirs[j]!;
    shuffledDirs[j] = temp;
  }

  for (const dir of shuffledDirs) {
    const nx = playerPos.x + dir.dx;
    const ny = playerPos.y + dir.dy;

    if (nx >= 0 && nx < state.map.width && ny >= 0 && ny < state.map.height) {
      const idx = ny * state.map.width + nx;
      const tile = state.map.tiles[idx];
      if (tile && !tile.tileId.includes('wall')) {
        return {
          type: IntentType.Move,
          entityId: playerEnt,
          dx: dir.dx,
          dy: dir.dy
        };
      }
    }
  }

  return { type: IntentType.Wait, entityId: playerEnt };
}

/**
 * Ticks a single actor's turn in a pure-functional headless state.
 */
function tickHeadlessTurn(state: GameState, entityId: EntityId): GameState {
  let tempState = state;

  // 1. Tick status effects, damage, death
  tempState = processStatusEffectsTick(tempState, entityId);
  tempState = processDamageSystem(tempState);
  tempState = processDeathSystem(tempState);

  const fighter = getComponent(tempState, entityId, ComponentType.Fighter);
  const isActor = getComponent(tempState, entityId, ComponentType.Actor) !== undefined;
  if (!fighter && !isActor) {
    return tempState; // Already dead / removed
  }

  if (shouldSkipTurn(tempState, entityId)) {
    return tempState;
  }

  const isPlayer = getComponent(tempState, entityId, ComponentType.Player) !== undefined;
  const isScheme = getComponent(tempState, entityId, ComponentType.Scheme) !== undefined;

  if (isPlayer) {
    const intent = generatePlayerFuzzerIntent(tempState, entityId);
    const result = applyIntentWithCost(tempState, intent);
    tempState = result.state;
  } else if (isScheme) {
    try {
      tempState = processSchemeTurn(tempState, entityId);
    } catch (e) {
      // Let it continue but log if needed
    }
  } else {
    // AI Turn
    let aiTurnState = tempState;
    const aiComponent = getComponent(aiTurnState, entityId, ComponentType.AI);
    if (aiComponent && aiComponent.cooldowns) {
      const newCooldowns: Record<string, number> = {};
      let changed = false;
      for (const [key, val] of Object.entries(aiComponent.cooldowns)) {
        if (val > 0) {
          newCooldowns[key] = val - 1;
          changed = true;
        } else {
          newCooldowns[key] = 0;
        }
      }
      if (changed) {
        aiTurnState = addComponent(aiTurnState, entityId, { ...aiComponent, cooldowns: newCooldowns });
      }
    }

    const aiResult = processAITurn(aiTurnState, entityId);
    aiTurnState = aiResult.state;
    const intent = aiResult.intent;

    if (intent !== null) {
      const result = applyIntentWithCost(aiTurnState, intent);
      tempState = result.state;
    } else {
      tempState = aiTurnState;
    }
  }

  return tempState;
}

/**
 * Runs a batch of headless fuzzer simulations.
 */
export function runFuzzerBatch(campaign: Readonly<CampaignData>, options: FuzzerOptions): FuzzerReport {
  const results: FuzzerTelemetry[] = [];

  for (let i = 0; i < options.runs; i++) {
    const seed = options.seedOverride || Math.floor(Math.random() * 1000000).toString();
    ROT.RNG.setSeed(Number(seed));

    let state = createMockFuzzerState(campaign);

    let turns = 0;
    let error: FuzzerError | null = null;
    const timeline: string[] = [];

    let dramaCount = 0;
    let clueCount = 0;
    let schemeMutations = 0;

    // Detect save-size and turns stalled details
    let lastSaveSize = 0;

    while (turns < options.maxTurns && !state.isGameOver) {
      turns++;

      // We collect actors that can take actions
      const activeActors = state.entities.filter((id) => getComponent(state, id, ComponentType.Actor) !== undefined);
      const persistentActors = Array.from(state.persistentEntities.entries())
        .filter(([, record]) => record.components[ComponentType.Actor] !== undefined)
        .map(([id]) => id);

      const allActors = [...activeActors, ...persistentActors];

      const startEventsCount = state.historicalLedger.length;

      // Executing turns for all active actors
      try {
        for (const actorId of allActors) {
          state = tickHeadlessTurn(state, actorId);
        }
      } catch (err) {
        const type: FuzzerErrorType =
          err instanceof Error && err.message.includes('TriggerRunawayError')
            ? 'runaway_trigger'
            : 'unhandled_exception';
        error = {
          type,
          message: err instanceof Error ? err.message : String(err),
          turn: turns,
          seed
        };
        break;
      }

      // Check softlocks: if player is dead or game is over, we stop
      const players = queryEntities(state, [ComponentType.Player]);
      if (players.length === 0) {
        timeline.push(`Turn ${turns}: Player died.`);
        break;
      }

      // Process new events from historicalLedger to trace timeline and metrics
      const newLedgerEvents = state.historicalLedger.slice(startEventsCount);
      for (const event of newLedgerEvents) {
        let isNarrativeRelevant = false;
        let eventSummary = event.summary || '';

        switch (event.type) {
          case GameEventType.NemesisPromoted:
            isNarrativeRelevant = true;
            dramaCount++;
            eventSummary = eventSummary || `Nemesis Promoted: Entity ${event.entityId} to Rank ${event.newRankId}`;
            break;
          case GameEventType.CoreValueViolated:
            isNarrativeRelevant = true;
            dramaCount++;
            eventSummary = eventSummary || `Core Value Violated: Entity ${event.entityId}`;
            break;
          case GameEventType.SchemeMutatedArea:
            isNarrativeRelevant = true;
            schemeMutations++;
            eventSummary = eventSummary || `Scheme Mutated Area: ${event.areaId}`;
            break;
          case GameEventType.ClueDiscovered:
            isNarrativeRelevant = true;
            clueCount++;
            eventSummary = eventSummary || `Clue Discovered: ${event.clueId}`;
            break;
          case GameEventType.QuestCompleted:
            isNarrativeRelevant = true;
            eventSummary = eventSummary || `Quest Completed: ${event.questId}`;
            break;
          case GameEventType.SchemeAdvanced:
            isNarrativeRelevant = true;
            dramaCount++;
            eventSummary = eventSummary || `Scheme Advanced: ${event.schemeId} to Phase ${event.newPhase}`;
            break;
          case GameEventType.RivalryResolved:
            isNarrativeRelevant = true;
            dramaCount++;
            eventSummary = eventSummary || `Rivalry Resolved: ${event.rivalryId}`;
            break;
        }

        if (isNarrativeRelevant) {
          timeline.push(`Turn ${turns}: ${eventSummary}`);
        }
      }

      // Softlock detection: if globalTurn isn't advancing but fuzzer ticks continue
      if (turns > 50 && state.globalTurn === 0) {
        error = {
          type: 'softlock',
          message: 'Softlock: globalTurn is not advancing despite player inputs/ticks.',
          turn: turns,
          seed
        };
        break;
      }

      // Check save-size explosion
      if (turns % 50 === 0) {
        try {
          const serialized = JSON.stringify(state);
          lastSaveSize = serialized.length;
          if (lastSaveSize > 5 * 1024 * 1024) {
            // > 5MB
            error = {
              type: 'save_bloat',
              message: `Save bloat: State serialized size reached ${lastSaveSize} bytes.`,
              turn: turns,
              seed
            };
            break;
          }
        } catch (e) {
          // JSON circular error or similar
          error = {
            type: 'unhandled_exception',
            message: `JSON Serialization failed during bloat check: ${String(e)}`,
            turn: turns,
            seed
          };
          break;
        }
      }

      if (options.stopOnFirstError && error) break;
    }

    results.push({
      seed,
      turnsElapsed: turns,
      error,
      events: timeline,
      dramaCount,
      clueCount,
      schemeMutations,
      finalSaveSize: lastSaveSize
    });

    if (options.stopOnFirstError && error) break;
  }

  return compileFuzzerReport(results);
}

/**
 * Aggregates results of multiple runs into a FuzzerReport.
 */
function compileFuzzerReport(results: ReadonlyArray<FuzzerTelemetry>): FuzzerReport {
  const totalRuns = results.length;
  const failedRuns = results.filter((r) => r.error !== null).length;
  const successfulRuns = totalRuns - failedRuns;

  const avgTurns = totalRuns > 0 ? results.reduce((sum, r) => sum + r.turnsElapsed, 0) / totalRuns : 0;
  const avgSaveSize = totalRuns > 0 ? results.reduce((sum, r) => sum + r.finalSaveSize, 0) / totalRuns : 0;

  // Average drama events per hour (assuming 1 hour = ~1000 turns)
  const totalTurns = results.reduce((sum, r) => sum + r.turnsElapsed, 0);
  const totalDrama = results.reduce((sum, r) => sum + r.dramaCount, 0);
  const avgDramaEventsPerHour = totalTurns > 0 ? (totalDrama / totalTurns) * 1000 : 0;

  const totalClues = results.reduce((sum, r) => sum + r.clueCount, 0);
  const clueToEventRatio = totalDrama > 0 ? totalClues / totalDrama : 0;

  return {
    results,
    aggregate: {
      totalRuns,
      successfulRuns,
      failedRuns,
      avgTurns,
      avgDramaEventsPerHour,
      clueToEventRatio,
      avgSaveSize
    }
  };
}
