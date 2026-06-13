import * as ROT from 'rot-js';
import { type GameState, type EntityId, UIMode } from '../types/game-state.types.ts';
import {
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type InteractableComponent
} from '../types/components.types.ts';
import { addComponent, createEntity, spawnEntity, spawnItem, getComponent } from './ecs.ts';
import { initEngine, startEngine, addActor, clearScheduler } from './scheduler.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { generateArea } from '../map/generator.ts';
import { loadCampaign } from './loader.ts';
import { loadGame, deleteSave } from './save.ts';
import { IntentType, type ChangeAreaIntent } from '../types/intents.types.ts';

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

export async function startNewGame(
  campaignId: string,
  currentState: GameState,
  display: ROT.Display,
  setGlobalState: (s: GameState) => void
): Promise<void> {
  const newCampaign = await loadCampaign(campaignId);

  let state = {
    ...currentState,
    campaignId,
    campaign: newCampaign
  };

  display.setOptions({
    width: newCampaign.theme.ui.displayWidth,
    height: newCampaign.theme.ui.displayHeight,
    fontSize: newCampaign.theme.ui.fontSize,
    fontFamily: newCampaign.theme.ui.fontFamily,
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });

  deleteSave();
  clearScheduler();
  initEngine();

  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = [...POTION_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);
  const scrollDesc = [...SCROLL_DESCRIPTORS].sort(() => ROT.RNG.getUniform() - 0.5);

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

  const {
    map: initialMap,
    startPos,
    portals,
    rooms
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
    areas: new Map(),
    persistentEntities: new Map(),
    identifiedItems: new Set(),
    itemUnidentifiedNames,
    visualEffects: [],
    isRotated: state.isRotated,
    is3D: state.is3D,
    zoomLevel: state.zoomLevel,
    playerCommandQueue: [],
    investigation: {
      knownActors: [],
      discoveredClues: [],
      exposedAgreements: []
    }
  };

  // Spawn the player entity
  const [stateAfterPlayerSpawn] = spawnEntity(state, 'player', startPos.x, startPos.y);
  state = stateAfterPlayerSpawn;

  // Pre-seed the MVP Mastermind (Bandit King)
  const mastermindId = state.nextEntityId as EntityId;
  state = { ...state, nextEntityId: state.nextEntityId + 1 };
  const schemeComp: import('../types/components.types.ts').SchemeComponent = {
    type: ComponentType.Scheme,
    schemeId: 'bandit_uprising',
    currentPhase: 0,
    activeMinions: []
  };
  const mastermindActor: import('../types/components.types.ts').ActorComponent = {
    type: ComponentType.Actor,
    speed: 100
  };
  state = {
    ...state,
    persistentEntities: new Map([
      ...state.persistentEntities.entries(),
      [mastermindId, { areaId: 'world', components: [schemeComp, mastermindActor] }]
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
    const interactable: InteractableComponent = {
      type: ComponentType.Interactable,
      intents: [
        {
          type: IntentType.ChangeArea,
          targetAreaId: portal.connection.targetAreaId,
          targetX: portal.connection.targetX,
          targetY: portal.connection.targetY
        } as ChangeAreaIntent
      ]
    };

    state = addComponent(state, stairId, pos);
    state = addComponent(state, stairId, renderCmp);
    state = addComponent(state, stairId, interactable);
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
    if (record.components.find((c) => c.type === ComponentType.Actor)) {
      addActor(id);
    }
  }

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
      if (record.components.find((c) => c.type === ComponentType.Actor)) {
        addActor(id);
      }
    }

    setGlobalState(state);
    startEngine();
  }
}
