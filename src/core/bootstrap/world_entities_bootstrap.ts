import type { CampaignData } from '../../types/campaign.types.ts';
import {
  ComponentType,
  type TagsComponent,
  type IdentityComponent,
  type InteractionScoreComponent,
  type DirectorBudgetComponent,
  type ChronicleComponent,
  type MemoryComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState, PersistentEntityRecord } from '../../types/game-state.types.ts';
import { getComponent } from '../ecs.ts';
import { rng } from '../rng.ts';
import { clearModals } from '../modal_manager.ts';
import { resetAutoPauseTracking } from '../auto_pause.ts';
import { loadGame } from '../save.ts';
import { addActor, clearScheduler, initEngine, startEngine } from '../scheduler.ts';

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

export interface InitialCampaignWorldEntities {
  readonly itemUnidentifiedNames: Map<string, string>;
  readonly factionEntityIds: Record<string, EntityId>;
  readonly areaEntityIds: Record<string, EntityId>;
  readonly initialPersistentEntities: Map<EntityId, PersistentEntityRecord>;
  readonly nextEntityId: EntityId;
}

/**
 * Initializes unidentified item descriptions and registers faction/area
 * world-level persistent entities for a new campaign instance.
 *
 * @param campaign The campaign definition to initialize world entities from.
 * @param startEntityId The starting entity ID counter.
 * @returns Initialized world entity mappings and incremented nextEntityId.
 */
export function initializeCampaignWorldEntities(
  campaign: CampaignData,
  startEntityId: number = 1
): InitialCampaignWorldEntities {
  const itemUnidentifiedNames = new Map<string, string>();
  const potionDesc = shuffle(POTION_DESCRIPTORS);
  const scrollDesc = shuffle(SCROLL_DESCRIPTORS);

  let pIdx = 0;
  let sIdx = 0;

  for (const [id, def] of Object.entries(campaign.items)) {
    if (def.category === 'consumable') {
      if (def.id.includes('potion')) {
        itemUnidentifiedNames.set(id, `${potionDesc[pIdx++ % potionDesc.length]} Potion`);
      } else if (def.id.includes('scroll')) {
        itemUnidentifiedNames.set(id, `${scrollDesc[sIdx++ % scrollDesc.length]} Scroll`);
      }
    }
  }

  let nextEntityId = startEntityId;
  const factionEntityIds: Record<string, EntityId> = {};
  const areaEntityIds: Record<string, EntityId> = {};
  const initialPersistentEntities = new Map<EntityId, PersistentEntityRecord>();

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

  return {
    itemUnidentifiedNames,
    factionEntityIds,
    areaEntityIds,
    initialPersistentEntities,
    nextEntityId: nextEntityId as EntityId
  };
}

/**
 * Loads a saved game session from persistent storage and re-initializes the scheduler.
 */
export async function continueGame(setGlobalState: (s: GameState) => void): Promise<void> {
  const loadedState = await loadGame();
  if (loadedState) {
    const state = { ...loadedState, playerCommandQueue: [] };

    clearModals();
    resetAutoPauseTracking();

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
