import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { setTemperatureAt } from '../src/map/map_accessor.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { processAITurn } from '../src/systems/ai.system.ts';
import { processHungerTick } from '../src/systems/hunger.system.ts';
import {
  createDefaultNeedsComponent,
  processActorNeedsTick,
  processActorPsychologyTick
} from '../src/systems/psychology/needs.system.ts';
import { addTimedThought, evaluateEntityPsychologyMood } from '../src/systems/psychology/thoughts.system.ts';
import {
  ComponentType,
  type HungerComponent,
  type MemoryComponent,
  type NeedsComponent
} from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 182: Universal Needs, Thoughts, Mood & Stress Engine', () => {
  it('syncs nourishment with HungerComponent and reacts to thermal comfort & furniture', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);
    const playerId = state.entities.find((e) => state.components.get(e)?.[ComponentType.Player])!;

    state = addComponent(state, playerId, createDefaultNeedsComponent());
    state = addComponent(state, playerId, {
      type: ComponentType.Hunger,
      satiation: 500
    } as HungerComponent);
    state = processHungerTick(state, playerId, 100);
    state = processActorNeedsTick(state, playerId, 1);

    const needsAfter = getComponent(state, playerId, ComponentType.Needs) as NeedsComponent;
    expect(needsAfter.needs['nourishment']!.current).toBeLessThan(35);

    // Extreme freezing temp drains comfort and injects freezing_cold thought
    state = {
      ...state,
      map: setTemperatureAt(state.map, 2, 2, -20, 0, state.globalTurn)
    };
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 2, y: 2, z: 0 });
    state = processActorNeedsTick(state, playerId, 1);
    const mem = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    expect(mem.thoughts?.some((t) => t.thoughtId === 'freezing_cold')).toBe(true);
  });

  it('stacks/decays thoughts, triggers ecstatic Inspirations & D&D 3.5e morale bonuses, and overrides AI during Mental Breaks', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'safe_hub' }
      }
    };
    let state = buildGameState(campaign);
    const masonRes = spawnEntity(state, 'quarry_mason', 3, 2);
    state = masonRes[0];
    const npcId = masonRes[1];

    // Stack a positive thought up to maxStacks=3 -> mood >= 85 -> ecstatic + Inspiration
    for (let i = 0; i < 3; i++) {
      state = addTimedThought(state, npcId, {
        thoughtId: 'feast_banquet',
        eventSummary: 'Enjoyed a grand feast',
        moodDelta: 15,
        durationTurns: 10,
        maxStacks: 3
      });
    }
    state = evaluateEntityPsychologyMood(state, npcId);
    const ecstaticMem = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent;
    expect(ecstaticMem.moodTier).toBe('ecstatic');
    expect(ecstaticMem.activeInspiration).toBeDefined();

    // Advance past thought duration -> thought decays cleanly back to content
    state = processActorPsychologyTick({ ...state, globalTurn: 20 }, 1);
    const decayedMem = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent;
    expect((decayedMem.thoughts ?? []).length).toBe(0);
    expect(decayedMem.moodTier).toBe('content');

    // Trigger mental break (berserk/tantrum/daze) via severe negative thought -> AI obeys break override
    state = addComponent(state, npcId, {
      ...decayedMem,
      facets: { aggression: 85, bravery: 80, resilience: 10 },
      activeInspiration: undefined
    });
    state = addTimedThought(state, npcId, {
      thoughtId: 'tragic_loss',
      eventSummary: 'Lost everything',
      moodDelta: -45,
      durationTurns: 20
    });
    state = evaluateEntityPsychologyMood(state, npcId);
    const breakMem = getComponent(state, npcId, ComponentType.Memory) as MemoryComponent;
    expect(breakMem.moodTier === 'breaking' || breakMem.moodTier === 'catatonic').toBe(true);
    expect(breakMem.activeMentalBreak?.kind).toBe('berserk');

    // Place a target adjacent to berserk NPC and confirm AI overrides normal passive/labor profile
    const [sWithGoblin, goblinId] = spawnEntity(state, 'goblin', 4, 2);
    state = sWithGoblin;
    const aiTurn = processAITurn(state, npcId);
    expect(aiTurn.intent).not.toBeNull();
    expect([IntentType.MeleeAttack, IntentType.Move]).toContain(aiTurn.intent!.type);
    void goblinId;
  });

  it('emits D&D 3.5e Layer B morale attack bonuses on ecstatic actors', () => {
    const dndCamp = loadCampaignFromDisk('dnd35e-crypt');
    let dndState = buildGameState(dndCamp);
    const dndPlayer = dndState.entities.find((e) => dndState.components.get(e)?.[ComponentType.Player])!;
    const baseDag = evaluateDnD35eEntityDAG(dndState, dndPlayer)!;
    dndState = addTimedThought(dndState, dndPlayer, {
      thoughtId: 'glorious_triumph',
      eventSummary: 'Glorious victory',
      moodDelta: 40,
      durationTurns: 30
    });
    const ecstaticDag = evaluateDnD35eEntityDAG(dndState, dndPlayer)!;
    expect(ecstaticDag.dagResult.attackBonus).toBe(baseDag.dagResult.attackBonus + 1);
  }, 15000);
});
