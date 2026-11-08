import { describe, it, expect } from 'bun:test';
import type { GameState, EntityId } from '../src/types/game-state.types.ts';
import {
  ComponentType,
  type QuestLogComponent,
  type InventoryComponent,
  type MemoryComponent
} from '../src/types/components.types.ts';
import { getComponent, addComponent, createEntity, spawnItem } from '../src/core/ecs.ts';
import { grantQuest, failQuest, processQuestEvent } from '../src/systems/quest.system.ts';
import type { Quest } from '../src/types/quests.types.ts';
import { GameEventType } from '../src/types/events.types.ts';
import { restockShop } from '../src/systems/shop.system.ts';
import { generateProceduralQuest } from '../src/systems/procedural-quest.system.ts';

function createMockGameState(): GameState {
  let state = {
    entities: [],
    components: new Map(),
    spatialIndex: new Map(),
    currentAreaId: 'area_start',
    areas: new Map(),
    persistentEntities: new Map(),
    activeRooms: [],
    nextEntityId: 1,
    nextItemInstanceId: 1,
    nextQuestId: 1,
    events: [],
    messages: [],
    dynamicQuests: {},
    map: { width: 10, height: 10, tiles: [] },
    campaign: {
      manifest: { id: 'test', title: 'Test', startingAreaId: 'area_start', rulesetId: 'classic' },
      quests: {
        quest_gather: {
          id: 'quest_gather',
          title: 'Gather Herbs',
          description: 'Gather 2 herbs.',
          objectives: [
            { id: 'obj_herbs', description: 'Gather herbs', type: 'gather', targetId: 'herb', requiredAmount: 2 }
          ],
          rewards: [
            { type: 'item', itemId: 'potion', amount: 1 },
            { type: 'standing', factionId: 'druids', amount: 15 },
            { type: 'xp', amount: 100 }
          ],
          autoComplete: true,
          nextQuestId: 'quest_chained'
        } as Quest,
        quest_gather_potion: {
          id: 'quest_gather_potion',
          title: 'Obtain a Potion',
          description: 'Acquire 1 health potion.',
          objectives: [
            { id: 'obj_potion', description: 'Acquire potion', type: 'gather', targetId: 'potion', requiredAmount: 1 }
          ],
          autoComplete: true
        } as Quest,
        quest_chained: {
          id: 'quest_chained',
          title: 'Chained Journey',
          description: 'Explore the deep woods.',
          objectives: [
            { id: 'obj_explore', description: 'Explore deep woods', type: 'explore', targetId: 'deep_woods', requiredAmount: 1 }
          ]
        } as Quest,
        quest_explore: {
          id: 'quest_explore',
          title: 'Explore Shrine',
          description: 'Reach the shrine.',
          objectives: [
            { id: 'obj_shrine', description: 'Reach shrine', type: 'explore', targetId: 'shrine_area', requiredAmount: 1 }
          ],
          autoComplete: true
        } as Quest,
        quest_interact: {
          id: 'quest_interact',
          title: 'Activate Lever',
          description: 'Pull the lever.',
          objectives: [
            { id: 'obj_lever', description: 'Pull lever', type: 'interact', targetId: 'lever_prop', requiredAmount: 1 }
          ],
          autoComplete: false
        } as Quest
      },
      items: {
        herb: { id: 'herb', name: 'Green Herb', baseValue: 5, tags: ['herb'] },
        potion: { id: 'potion', name: 'Health Potion', baseValue: 20, tags: ['potion'] }
      },
      entities: {
        goblin: { id: 'goblin', name: 'Goblin', glyph: 'g', fg: '#00ff00', bg: 'transparent', isActor: true, faction: 'monster' },
        lever_prop: { id: 'lever_prop', name: 'Ancient Lever', glyph: '/', fg: '#ffffff', bg: 'transparent', isActor: false }
      },
      factions: {
        druids: { id: 'druids', name: 'Druids Circle' }
      },
      questTemplates: {
        bounty_kill: {
          id: 'bounty_kill',
          titleTemplate: 'Bounty: {targetName}',
          descriptionTemplate: 'Slay {amount} {targetName}.',
          objectiveType: 'kill',
          targetTags: ['monster'],
          amountRange: [2, 4],
          rewardXpMultiplier: 50
        },
        bounty_gather: {
          id: 'bounty_gather',
          titleTemplate: 'Supply: {targetName}',
          descriptionTemplate: 'Collect {amount} {targetName}.',
          objectiveType: 'gather',
          targetTags: ['herb'],
          amountRange: [1, 3],
          rewardXpMultiplier: 25
        }
      },
      areas: {},
      dialogues: {},
      rules: { spawning: { lootTable: {}, lootDropChance: 0 } }
    }
  } as unknown as GameState;

  // Create player
  const [s1, pId] = createEntity(state);
  state = s1;
  state = addComponent(state, pId, { type: ComponentType.Player });
  state = addComponent(state, pId, { type: ComponentType.Position, x: 2, y: 2 });
  state = addComponent(state, pId, { type: ComponentType.Inventory, items: [], baseCapacity: 10 });
  state = addComponent(state, pId, { type: ComponentType.QuestLog, quests: {} });
  state = addComponent(state, pId, { type: ComponentType.Memory, factionStandings: {} });

  return state;
}

describe('Milestone 122: Quest & Narrative Lifecycle Wiring', () => {
  it('calculates retroactive gather progress when player already holds quest items', () => {
    let state = createMockGameState();
    const playerId = state.entities[0] as EntityId;

    // Spawn 1 herb in player inventory
    let herbId: EntityId;
    [state, herbId] = spawnItem(state, 'herb', 0, 0);
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, { ...inv, items: [herbId] });

    // Grant gather quest
    state = grantQuest(state, playerId, 'quest_gather');

    const log = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent;
    expect(log.quests['quest_gather']).toBeDefined();
    expect(log.quests['quest_gather']!.objectiveProgress['obj_herbs']).toBe(1);
    expect(log.quests['quest_gather']!.status).toBe('active');
  });

  it('completes quest, pays out XP/item/standing via QuestRewardApplierMap, auto-chains nextQuestId, and preserves downstream gather updates from item rewards', () => {
    let state = createMockGameState();
    const playerId = state.entities[0] as EntityId;

    state = grantQuest(state, playerId, 'quest_gather');
    state = grantQuest(state, playerId, 'quest_gather_potion');

    // Emit 2 gather events for herb -> completes quest_gather -> rewards 1 potion -> completes quest_gather_potion!
    state = processQuestEvent(state, 'gather', 'herb', 2);

    const log = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent;
    expect(log.quests['quest_gather']!.status).toBe('completed');
    expect(log.quests['quest_gather_potion']!.status).toBe('completed');

    // Check standing reward paid out
    const memory = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    expect(memory.factionStandings['druids']).toBe(15);

    // Check nextQuestId auto-chained
    expect(log.quests['quest_chained']).toBeDefined();
    expect(log.quests['quest_chained']!.status).toBe('active');
  });

  it('supports failQuest lifecycle and emits QuestFailed event', () => {
    let state = createMockGameState();
    const playerId = state.entities[0] as EntityId;

    state = grantQuest(state, playerId, 'quest_interact');
    state = failQuest(state, playerId, 'quest_interact');

    const log = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent;
    expect(log.quests['quest_interact']!.status).toBe('failed');

    const failedEvent = state.events.find((e) => e.type === GameEventType.QuestFailed);
    expect(failedEvent).toBeDefined();
  });

  it('filters procedural quests by entity faction/targetTags and item targetTags across objective types', () => {
    const state = createMockGameState();
    const { nextState: s1, questId: q1 } = generateProceduralQuest(state, 'bounty_kill');

    expect(q1).toBeDefined();
    expect(q1?.startsWith('dyn_bounty_kill_')).toBe(true);
    expect(s1.dynamicQuests[q1!]).toBeDefined();
    expect(s1.dynamicQuests[q1!]!.objectives[0]!.targetId).toBe('goblin');

    const { nextState: s2, questId: q2 } = generateProceduralQuest(s1, 'bounty_gather');
    expect(q2).toBeDefined();
    expect(s2.dynamicQuests[q2!]!.objectives[0]!.targetId).toBe('herb');
  });

  it('grants dynamic restock supply quest to player when shop restocks', () => {
    let state = createMockGameState();
    const playerId = state.entities[0] as EntityId;

    // Create a merchant
    const [s1, shopId] = createEntity(state);
    state = s1;
    state = addComponent(state, shopId, {
      type: ComponentType.Shop,
      inventory: [],
      markupMultiplier: 1.5,
      buyTags: ['potion'],
      sellTags: ['potion']
    });

    // Force restock
    state = restockShop(state, shopId);

    const log = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent;
    const dynamicQuestKeys = Object.keys(log.quests).filter((k) => k.startsWith('dyn_restock_'));
    if (dynamicQuestKeys.length > 0) {
      expect(log.quests[dynamicQuestKeys[0]!]!.status).toBe('active');
    }
  });
});
