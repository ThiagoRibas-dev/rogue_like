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
import { spawnEntity, spawnItem, addComponent } from '../../core/ecs.ts';
import { generateArea } from '../../map/generator.ts';
import { compilePhases } from '../../systems/scheme_compiler.ts';
import { DEFAULT_GLOBAL_DRAMA_BUDGET } from '../../constants/pacing.constants.ts';

/**
 * Headless helper to create an entity.
 */
export function createEntity(state: GameState): [GameState, EntityId] {
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
 * Creates the initial mock GameState for a headless fuzzer run.
 */
export function createMockFuzzerState(campaignConfig: Readonly<CampaignData>): GameState {
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
      bg: 'transparent',
      spriteId: portal.connection.direction === 'up' ? 'stairs_up' : 'stairs_down'
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
