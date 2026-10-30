import * as ROT from 'rot-js';
import type { GeneratedArea } from '../map/generator.ts';
import { syncDisplayLayout, configureDisplayForCampaign } from '../rendering/display.ts';
import { updateExploredTiles } from '../systems/map.system.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { ComponentType } from '../types/components.types.ts';
import { type GameState, UIMode } from '../types/game-state.types.ts';
import { getComponent, spawnEntity, spawnItem } from './ecs.ts';
import { loadCampaign } from './loader.ts';
import { setTelemetryStore } from './telemetry.ts';
import { addActor, clearScheduler, initEngine, startEngine } from './scheduler.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../constants/pacing.constants.ts';
import { initializeCampaignWorldEntities } from './bootstrap.ts';

/**
 * Bootstraps and starts a test encounter sandbox for the encounter director
 * or developer encounter testing.
 *
 * @param campaignId The campaign identifier to load.
 * @param currentState The current game state to extend.
 * @param display The ROT.js display instance to attach.
 * @param generatedArea The generated area data to place entities in.
 * @param setGlobalState State setter callback for the session controller.
 */
export async function startSandboxEncounter(
  campaignId: string,
  currentState: GameState,
  display: ROT.Display,
  generatedArea: GeneratedArea,
  setGlobalState: (s: GameState) => void
): Promise<void> {
  const newCampaign = await loadCampaign(campaignId);

  let state: GameState = {
    ...currentState,
    campaignId,
    campaign: newCampaign,
    isSandbox: true
  };

  const basePath = `${import.meta.env.BASE_URL}data/campaigns/${campaignId}`;
  await configureDisplayForCampaign(display, newCampaign, basePath);

  display.setOptions({
    bg: newCampaign.theme.colors.background ?? '#000000',
    fg: newCampaign.theme.colors.playerFg ?? '#ffffff'
  });
  syncDisplayLayout(display, state);

  clearScheduler();
  initEngine();

  const { itemUnidentifiedNames, factionEntityIds, areaEntityIds, initialPersistentEntities, nextEntityId } =
    initializeCampaignWorldEntities(newCampaign, state.nextEntityId || 1);

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
        );
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
