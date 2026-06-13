import { loadCampaign } from '../core/loader.ts';
import { GameEventType } from '../types/events.types.ts';
import { processGlobalTriggers } from '../systems/trigger.system.ts';
import type { GameState, EntityId } from '../types/game-state.types.ts';
import { EngineMode, UIMode } from '../types/game-state.types.ts';
import { createEntity, addComponent } from '../core/ecs.ts';
import { ComponentType } from '../types/components.types.ts';

/**
 * Headless state-diffing runner to validate that a campaign's triggers
 * function correctly without requiring a full browser DOM.
 */
export async function runHeadlessSmokeTest(campaignId: string = 'default'): Promise<boolean> {
  console.log(`Starting headless smoke test for campaign: ${campaignId}`);
  try {
    const campaign = await loadCampaign(campaignId);

    // Initialize a mock game state
    let state: GameState = {
      campaignId,
      campaign,
      entities: [],
      components: new Map(),
      map: { width: 10, height: 10, tiles: [] },
      nextEntityId: 1,
      nextItemInstanceId: 1,
      nextQuestId: 1,
      dynamicQuests: {},
      messages: [],
      events: [],
      currentAreaId: 'test_area',
      areas: new Map(),
      persistentEntities: new Map(),
      spatialIndex: new Map(),
      isGameOver: false,
      uiMode: UIMode.Game,
      identifiedItems: new Set(),
      itemUnidentifiedNames: new Map(),
      engineMode: EngineMode.TurnBased,
      rtwpState: { paused: false, speedMultiplier: 1 },
      visualEffects: [],
      isRotated: false,
      is3D: false,
      zoomLevel: 1.0,
      playerCommandQueue: [],
      investigation: {
        knownActors: [],
        discoveredClues: [],
        exposedAgreements: []
      }
    };

    // Set up a mock victim entity with an agreement
    const [stateAfterCreate, victimId] = createEntity(state);
    state = stateAfterCreate;
    state = addComponent(state, victimId, {
      type: ComponentType.Position,
      x: 5,
      y: 5
    });
    state = addComponent(state, victimId, {
      type: ComponentType.Agreement,
      agreementId: 'test_agreement',
      mastermindId: 999 as unknown as EntityId,
      leverageUsed: 'money'
    });

    // Mock an agreement in the campaign data for the test
    state.campaign.agreements['test_agreement'] = {
      id: 'test_agreement',
      task: 'do bad things',
      incriminatingWeight: 1,
      clueTemplates: ['test_clue_template']
    };

    // Push the EntityDiedEvent
    state = {
      ...state,
      events: [
        {
          type: GameEventType.EntityDied,
          victimId,
          killerId: 999 as unknown as EntityId,
          tags: []
        }
      ]
    };

    console.log('Dispatching EntityDiedEvent to processGlobalTriggers...');
    const nextState = processGlobalTriggers(state);

    // Assert that a clue was spawned
    const spawnedClues = nextState.entities.filter((eId) =>
      nextState.components.get(eId)?.some((c) => c.type === ComponentType.Clue)
    );

    if (spawnedClues.length > 0) {
      console.log('✅ Smoke Test Passed: Clue successfully spawned via declarative trigger!');
      return true;
    } else {
      console.error('❌ Smoke Test Failed: No clue was spawned. Trigger engine did not fire correctly.');
      return false;
    }
  } catch (err) {
    console.error('❌ Smoke Test Exception:', err);
    return false;
  }
}
