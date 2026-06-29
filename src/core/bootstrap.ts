import * as ROT from 'rot-js';
import { generateArea } from '../map/generator.ts';
import { syncDisplayLayout } from '../rendering/display.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import type { ActorComponent, SchemeComponent } from '../types/components.types.ts';
import {
  ComponentType,
  type PortalComponent,
  type PositionComponent,
  type RenderableComponent,
  type TagsComponent,
  type IdentityComponent,
  type InteractionScoreComponent,
  type DirectorBudgetComponent,
  type ChronicleComponent,
  type MemoryComponent
} from '../types/components.types.ts';
import { type EntityId, type GameState, UIMode, type PersistentEntityRecord } from '../types/game-state.types.ts';
import { addComponent, createEntity, getComponent, spawnEntity, spawnItem } from './ecs.ts';
import { loadCampaign } from './loader.ts';
import { compilePhases } from '../systems/scheme_compiler.ts';
import { rng, initRNG } from './rng.ts';
import { startRecording } from './replay.ts';
import { deleteSave, loadGame } from './save.ts';
import { setTelemetryStore } from './telemetry.ts';
import { addActor, clearScheduler, initEngine, startEngine } from './scheduler.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';

const POTION_DESCRIPTORS = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Murky',
  'Bubbling',
  'Clear',
  'Swirling',
  'Thick'
];
const SCROLL_DESCRIPTORS = ['Scorched', 'Runed', 'Faded', 'Tattered', 'Glowing', 'Crumbling', 'Blood-Stained', 'Dusty'];

/**
 * Deterministically shuffles an array using Fisher-Yates and the global RNG.
 *
 * @param array The array to shuffle.
 * @returns A new shuffled array.
 */
function shuffle<T>(array: ReadonlyArray<T>): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng.getUniform() * (i + 1)) as number;
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

export async function startNewGame(
  campaignId: string,
  currentState: GameState,
  display: ROT.Display,
  setGlobalState: (s: GameState) => void,
  seed?: number
): Promise<void> {
  const finalSeed = initRNG(seed);
  startRecording(campaignId, finalSeed);

  const newCampaign = await loadCampaign(campaignId);

  let state = {
    ...currentState,
    campaignId,
    campaign: newCampaign
  };

  display.setOptions({
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });
  syncDisplayLayout(display, state);

  deleteSave();
  clearScheduler();
  initEngine();

  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = shuffle(POTION_DESCRIPTORS);
  const scrollDesc = shuffle(SCROLL_DESCRIPTORS);

  let pIdx = 0;
  let sIdx = 0;

  for (const [id, def] of Object.entries(state.campaign.items)) {
    if (def.category === 'consumable') {
      if (def.id.includes('potion')) {
        itemUnidentifiedNames.set(id, `${potionDesc[pIdx++ % potionDesc.length]} Potion`);
      } else if (def.id.includes('scroll')) {
        itemUnidentifiedNames.set(id, `${scrollDesc[sIdx++ % scrollDesc.length]} Scroll`);
      }
    }
  }

  let nextEntityId = state.nextEntityId || 1;
  const factionEntityIds: Record<string, EntityId> = {};
  const areaEntityIds: Record<string, EntityId> = {};
  const initialPersistentEntities = new Map<EntityId, PersistentEntityRecord>();

  for (const factionId of Object.keys(newCampaign.factions)) {
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

  for (const [areaId, def] of Object.entries(newCampaign.areas)) {
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

  const {
    map: initialMap,
    startPos,
    portals,
    rooms,
    placedEntities
  } = generateArea(state.campaign, state.campaign.rules.map.startingAreaId);

  state = {
    ...state,
    map: initialMap,
    uiMode: UIMode.Game,
    isGameOver: false,
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    messages: [],
    currentAreaId: state.campaign.rules.map.startingAreaId,
    activeRooms: rooms,
    lastSpawnTurn: 0,
    areas: new Map(),
    persistentEntities: initialPersistentEntities,
    nextEntityId,
    identifiedItems: new Set(),
    itemUnidentifiedNames,
    visualEffects: [],
    isRotated: state.isRotated,
    is3D: state.is3D,
    zoomLevel: state.zoomLevel,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    playerCommandQueue: [],
    investigation: {
      knownActors: [],
      exposedAgreements: [],
      lastClueTurn: 0
    },
    historicalLedger: [],
    factionEntityIds,
    areaEntityIds,
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
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

  // Spawn the player entity
  const [stateAfterPlayerSpawn] = spawnEntity(state, 'player', startPos.x, startPos.y);
  state = stateAfterPlayerSpawn;

  // Pre-seed the MVP Mastermind (Bandit King)
  const mastermindId = state.nextEntityId as EntityId;
  state = { ...state, nextEntityId: state.nextEntityId + 1 };
  const schemeComp: SchemeComponent = {
    type: ComponentType.Scheme,
    recipeId: 'bandit_uprising',
    currentPhase: 0,
    activeMinions: [],
    phases: compilePhases(state.campaign, 'bandit_uprising'),
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

  // Spawn monsters in rooms
  for (let i = 1; i < rooms.length; i++) {
    const room = rooms[i];
    if (!room) continue;

    const numMonsters = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxMonstersPerRoom);
    for (let m = 0; m < numMonsters; m++) {
      const mx = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const my = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const template =
        ROT.RNG.getWeightedValue(state.campaign.rules.spawning.spawnWeights as Record<string, number>) || 'orc';
      [state] = spawnEntity(state, template, mx, my);
    }

    // Spawn items in this room
    const numItems = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxItemsPerRoom);
    for (let n = 0; n < numItems; n++) {
      const ix = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const iy = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const itemId =
        ROT.RNG.getWeightedValue(state.campaign.rules.spawning.lootTable as Record<string, number>) || 'health_potion';
      [state] = spawnItem(state, itemId, ix, iy);
    }
  }

  // Spawn the portals for the first floor
  for (const portal of portals) {
    let stairId: EntityId;
    [state, stairId] = createEntity(state);

    const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
    const renderCmp: RenderableComponent = {
      type: ComponentType.Renderable,
      glyph:
        portal.connection.direction === 'up'
          ? (state.campaign.theme.glyphs.stairsUp ?? '<')
          : (state.campaign.theme.glyphs.stairsDown ?? '>'),
      fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
      bg: state.campaign.theme.colors.transparent ?? 'transparent'
    };
    const portalComp: PortalComponent = {
      type: ComponentType.Portal,
      targetAreaId: portal.connection.targetAreaId,
      targetX: portal.connection.targetX,
      targetY: portal.connection.targetY
    };
    const tagsCmp: TagsComponent = {
      type: ComponentType.Tags,
      tags: ['portal']
    };

    state = addComponent(state, stairId, pos);
    state = addComponent(state, stairId, renderCmp);
    state = addComponent(state, stairId, portalComp);
    state = addComponent(state, stairId, tagsCmp);
  }

  if (placedEntities) {
    for (const ent of placedEntities) {
      if (state.campaign.items[ent.templateId]) {
        [state] = spawnItem(state, ent.templateId, ent.x, ent.y);
      } else if (state.campaign.entities[ent.templateId]) {
        [state] = spawnEntity(state, ent.templateId, ent.x, ent.y, ent.dynamicTraits, ent.inventory);
      } else {
        console.warn(`Placed entity template ${ent.templateId} not found in registries.`);
      }
    }
  }

  state = updateExploredTiles(state);
  state = addMessage(state, 'Welcome to the Dungeon, Adventurer!', MessageLogCategory.System);

  for (const id of state.entities) {
    const actor = getComponent(state, id, ComponentType.Actor);
    if (actor) {
      addActor(id);
    }
  }

  for (const [id, record] of state.persistentEntities.entries()) {
    if (record.components[ComponentType.Actor]) {
      addActor(id);
    }
  }

  setTelemetryStore(state.telemetry);
  setGlobalState(state);
  startEngine();
}

export async function continueGame(setGlobalState: (s: GameState) => void): Promise<void> {
  const loadedState = await loadGame();
  if (loadedState) {
    const state = { ...loadedState, playerCommandQueue: [] };

    clearScheduler();
    initEngine();

    for (const id of state.entities) {
      const actor = getComponent(state, id, ComponentType.Actor);
      if (actor) {
        addActor(id);
      }
    }

    for (const [id, record] of state.persistentEntities.entries()) {
      if (record.components[ComponentType.Actor]) {
        addActor(id);
      }
    }

    setGlobalState(state);
    startEngine();
  }
}

export async function startSandboxEncounter(
  campaignId: string,
  currentState: GameState,
  display: ROT.Display,
  generatedArea: import('../map/generator.ts').GeneratedArea,
  setGlobalState: (s: GameState) => void
): Promise<void> {
  const newCampaign = await loadCampaign(campaignId);

  let state: GameState = {
    ...currentState,
    campaignId,
    campaign: newCampaign,
    isSandbox: true
  };

  display.setOptions({
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });
  syncDisplayLayout(display, state);

  clearScheduler();
  initEngine();

  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = shuffle(POTION_DESCRIPTORS);
  const scrollDesc = shuffle(SCROLL_DESCRIPTORS);

  let pIdx = 0;
  let sIdx = 0;

  for (const [id, def] of Object.entries(state.campaign.items)) {
    if (def.category === 'consumable') {
      if (def.id.includes('potion')) {
        itemUnidentifiedNames.set(id, `${potionDesc[pIdx++ % potionDesc.length]} Potion`);
      } else if (def.id.includes('scroll')) {
        itemUnidentifiedNames.set(id, `${scrollDesc[sIdx++ % scrollDesc.length]} Scroll`);
      }
    }
  }

  let nextEntityId = state.nextEntityId || 1;
  const factionEntityIds: Record<string, EntityId> = {};
  const areaEntityIds: Record<string, EntityId> = {};
  const initialPersistentEntities = new Map<EntityId, PersistentEntityRecord>();

  for (const factionId of Object.keys(newCampaign.factions)) {
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

  for (const [areaId, def] of Object.entries(newCampaign.areas)) {
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

  const { map, startPos, rooms, placedEntities } = generatedArea;

  state = {
    ...state,
    map,
    uiMode: UIMode.Game,
    isGameOver: false,
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    messages: [],
    currentAreaId: state.campaign.rules.map.startingAreaId,
    activeRooms: rooms ?? [],
    lastSpawnTurn: 0,
    areas: new Map(),
    persistentEntities: initialPersistentEntities,
    nextEntityId,
    identifiedItems: new Set(),
    itemUnidentifiedNames,
    visualEffects: [],
    isRotated: state.isRotated,
    is3D: state.is3D,
    zoomLevel: state.zoomLevel,
    fovNeedsUpdate: true,
    cachedFov: new Set(),
    playerCommandQueue: [],
    investigation: {
      knownActors: [],
      exposedAgreements: [],
      lastClueTurn: 0
    },
    historicalLedger: [],
    factionEntityIds,
    areaEntityIds,
    nemesisSlots: {},
    vacancyTurns: {},
    globalTurn: 0,
    lastCheatDeathTurn: -9999,
    pendingKnowledge: [],
    pendingRumors: [],
    pendingRivalries: [],
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

  // Spawn the player entity
  const playerTemplateId =
    Object.entries(newCampaign.entities).find(
      ([, e]) => e.tags?.includes('actor') && e.roleTags?.includes('protein')
    )?.[0] ?? 'player';
  const [stateAfterPlayerSpawn] = spawnEntity(
    state,
    newCampaign.entities[playerTemplateId] ? playerTemplateId : 'player',
    startPos.x,
    startPos.y
  );
  state = stateAfterPlayerSpawn;

  if (placedEntities) {
    for (const ent of placedEntities) {
      if (state.campaign.items[ent.templateId]) {
        [state] = spawnItem(state, ent.templateId, ent.x, ent.y);
      } else if (state.campaign.entities[ent.templateId]) {
        [state] = spawnEntity(
          state,
          ent.templateId,
          ent.x,
          ent.y,
          ent.dynamicTraits,
          ent.preExistingEntityId ? undefined : undefined
        ); // Ignoring inventory for now or we can pass it if we add it to GeneratedArea
      } else {
        console.warn(`Placed entity template ${ent.templateId} not found in registries.`);
      }
    }
  }

  state = updateExploredTiles(state);
  state = addMessage(state, 'Entering Encounter Sandbox...', MessageLogCategory.System);

  for (const id of state.entities) {
    const actor = getComponent(state, id, ComponentType.Actor);
    if (actor) {
      addActor(id);
    }
  }

  setTelemetryStore(state.telemetry);
  setGlobalState(state);
  startEngine();
}
