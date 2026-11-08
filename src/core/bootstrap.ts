import * as ROT from 'rot-js';
import { generateArea } from '../map/generator.ts';
import { syncDisplayLayout, configureDisplayForCampaign } from '../rendering/display.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { clearModals } from './modal_manager.ts';
import { resetAutoPauseTracking } from './auto_pause.ts';
import type { ActorComponent, SchemeComponent } from '../types/components.types.ts';
import {
  ComponentType,
  type PortalComponent,
  type PositionComponent,
  type RenderableComponent,
  type TagsComponent
} from '../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../types/game-state.types.ts';
import { addComponent, createEntity, getComponent, spawnEntity, spawnItem } from './ecs.ts';
import { loadCampaign } from './loader.ts';
import { compilePhases } from '../systems/scheme_compiler.ts';
import { initRNG } from './rng.ts';
import { startRecording } from './replay.ts';
import { deleteSave } from './save.ts';
import { setTelemetryStore } from './telemetry.ts';
import { addActor, clearScheduler, initEngine, startEngine } from './scheduler.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';
import {
  type InitialCampaignWorldEntities,
  initializeCampaignWorldEntities,
  continueGame
} from './bootstrap/world_entities_bootstrap.ts';

export type { InitialCampaignWorldEntities };
export { initializeCampaignWorldEntities, continueGame };

export interface SpawnOverride {
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
}

export async function startNewGame(
  campaignId: string,
  currentState: GameState,
  display: ROT.Display,
  setGlobalState: (s: GameState) => void,
  seed?: number,
  spawnOverride?: SpawnOverride
): Promise<void> {
  const finalSeed = initRNG(seed);
  startRecording(campaignId, finalSeed);

  clearModals();
  resetAutoPauseTracking();

  const newCampaign = await loadCampaign(campaignId);

  let state = {
    ...currentState,
    campaignId,
    campaign: newCampaign
  };

  const basePath = `${import.meta.env.BASE_URL}data/campaigns/${campaignId}`;
  await configureDisplayForCampaign(display, newCampaign, basePath);

  display.setOptions({
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });
  syncDisplayLayout(display, state);

  deleteSave();
  clearScheduler();
  initEngine();

  const { itemUnidentifiedNames, factionEntityIds, areaEntityIds, initialPersistentEntities, nextEntityId } =
    initializeCampaignWorldEntities(state.campaign, state.nextEntityId || 1);

  const initialAreaId = spawnOverride?.areaId ?? state.campaign.rules.map.startingAreaId;
  const { map: initialMap, startPos, portals, rooms, placedEntities } = generateArea(state.campaign, initialAreaId);

  state = {
    ...state,
    map: initialMap,
    uiMode: UIMode.Game,
    isGameOver: false,
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    messages: [],
    currentAreaId: initialAreaId,
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

  const spawnX = spawnOverride?.x ?? startPos.x;
  const spawnY = spawnOverride?.y ?? startPos.y;
  const [stateAfterPlayerSpawn] = spawnEntity(state, 'player', spawnX, spawnY);
  state = stateAfterPlayerSpawn;

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

    const numItems = ROT.RNG.getUniformInt(0, state.campaign.rules.spawning.maxItemsPerRoom);
    for (let n = 0; n < numItems; n++) {
      const ix = ROT.RNG.getUniformInt(room.left + 1, room.right - 1);
      const iy = ROT.RNG.getUniformInt(room.top + 1, room.bottom - 1);
      const itemId =
        ROT.RNG.getWeightedValue(state.campaign.rules.spawning.lootTable as Record<string, number>) || 'health_potion';
      [state] = spawnItem(state, itemId, ix, iy);
    }
  }

  for (const portal of portals) {
    let stairId: EntityId;
    [state, stairId] = createEntity(state);

    const stairTileKey = portal.connection.direction === 'up' ? 'stairs_up' : 'stairs_down';
    const pos: PositionComponent = { type: ComponentType.Position, x: portal.x, y: portal.y };
    const renderCmp: RenderableComponent = {
      type: ComponentType.Renderable,
      glyph:
        portal.connection.direction === 'up'
          ? (state.campaign.theme.glyphs.stairsUp ?? '<')
          : (state.campaign.theme.glyphs.stairsDown ?? '>'),
      fg: state.campaign.theme.colors.stairsFg ?? '#ffffff',
      bg: state.campaign.theme.colors.transparent ?? 'transparent',
      spriteId: state.campaign.tiles[stairTileKey]?.spriteId ?? stairTileKey
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
