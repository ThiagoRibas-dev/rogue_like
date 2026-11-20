import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, queryEntities, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { hydrateEntityRoundActionBudget } from '../src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts';
import { executeEightHourRest } from '../src/rulesets/dnd35e/magic/rest_recovery.ts';
import {
  attemptEscapeOrBreakRestraints,
  MASTERWORK_MANACLES_BREAK_DC,
  MASTERWORK_MANACLES_ESCAPE_ARTIST_DC,
  STANDARD_MANACLES_BREAK_DC,
  STANDARD_MANACLES_ESCAPE_ARTIST_DC
} from '../src/rulesets/dnd35e/skills/dungeon_skill_verbs.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { processApplyIntent } from '../src/systems/apply.system.ts';
import { processEquipItemIntent } from '../src/systems/inventory/equipment_slots.ts';
import { triggerActiveAreaRespawnIfDue } from '../src/systems/map/map_wake_respawn.ts';
import {
  evaluatePartyCampPreparedness,
  evaluateSleepingActorAwareness,
  executeWatchChunkedBulkRest,
  resolveWatchAmbushCycle,
  SLEEPING_STATUS_ID
} from '../src/systems/rest.system.ts';
import { applyStatusEffect, processStatusEffectsTick } from '../src/systems/status-effect.system.ts';
import { resolveAreaRestPressure } from '../src/systems/world_clock.system.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import {
  ComponentType,
  type FighterComponent,
  type SchemeComponent,
  type StatusEffectsComponent
} from '../src/types/components.types.ts';
import { EngineMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 153: Per-Area Rest Pressure ("Doom Clock"), Bulk Schemes, Camp Ambushes & Logistics', () => {
  const sharedCampaign = loadCampaignFromDisk('dnd35e-crypt');

  test('1. Per-area RestPressureConfig layers over campaign rules and scales respawnRateMultiplier', () => {
    let state = buildGameState(sharedCampaign);

    // safe_hub has safeRest: true, ambushChancePerWatch: 0, respawnRateMultiplier: 0
    const hubPressure = resolveAreaRestPressure(state, 'safe_hub');
    expect(hubPressure.safeRest).toBe(true);
    expect(hubPressure.ambushChancePerWatch).toBe(0);
    expect(hubPressure.respawnRateMultiplier).toBe(0);

    // dungeon_1 has safeRest: false, ambushChancePerWatch: 0.15, watchDurationHours: 2
    const dungeonPressure = resolveAreaRestPressure(state, 'dungeon_1');
    expect(dungeonPressure.safeRest).toBe(false);
    expect(dungeonPressure.ambushChancePerWatch).toBe(0.15);
    expect(dungeonPressure.watchDurationHours).toBe(2);

    // bandit_stronghold has schemeTickMultiplier: 2, respawnRateMultiplier: 1.5
    const strongholdPressure = resolveAreaRestPressure(state, 'bandit_stronghold');
    expect(strongholdPressure.ambushChancePerWatch).toBe(0.25);
    expect(strongholdPressure.schemeTickMultiplier).toBe(2);
    expect(strongholdPressure.respawnRateMultiplier).toBe(1.5);

    // Verify respawnRateMultiplier: 2 halves effective respawnTimerTurns (10 -> 5 turns)
    const fastRespawnState = {
      ...state,
      currentAreaId: 'dungeon_1',
      globalTurn: 6,
      lastSpawnTurn: 0,
      campaign: {
        ...state.campaign,
        areas: {
          ...state.campaign.areas,
          dungeon_1: {
            ...state.campaign.areas['dungeon_1']!,
            respawnTimerTurns: 10,
            restPressure: {
              ...dungeonPressure,
              respawnRateMultiplier: 2
            }
          }
        }
      }
    };
    const respawnRes = triggerActiveAreaRespawnIfDue(fastRespawnState);
    expect(respawnRes.state.lastSpawnTurn).toBe(6);
  });

  test('2. Bulk time advancement ticks villain Schemes (scaled by schemeTickMultiplier) and emits digest notes', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Spawn a mastermind entity with an active 2-phase scheme
    let mastermindId;
    [state, mastermindId] = createEntity(state);
    const recipeId = 'corrupt_the_sanctum';
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        schemeRecipes: {
          ...state.campaign.schemeRecipes,
          [recipeId]: {
            id: recipeId,
            name: 'Corrupt the Sanctum',
            description: 'Corrupt the sanctum',
            villainArchetypeId: 'cult_leader',
            phases: []
          }
        }
      }
    };
    const schemeComp: SchemeComponent = {
      type: ComponentType.Scheme,
      recipeId,
      currentPhase: 0,
      activeMinions: [],
      phases: [
        {
          id: 'phase_0',
          description: 'Gather Cultists',
          requiredAgreements: 0,
          mutations: [{ targetAreaId: 'dungeon_1', addedTags: ['scheme_corrupted'], budgetModifier: 5 }]
        },
        {
          id: 'phase_1',
          description: 'Summon Avatar',
          requiredAgreements: 1
        }
      ]
    };
    state = addComponent(state, mastermindId, schemeComp);

    // Advance 30 turns in bandit_stronghold (schemeTickMultiplier: 2 -> interval 25 instead of 50)
    state = { ...state, currentAreaId: 'bandit_stronghold' };
    const bulkRes = advanceWorldTimeBulk(state, 30, playerId);
    const afterScheme = getComponent(bulkRes.state, mastermindId, ComponentType.Scheme)!;
    expect(afterScheme.currentPhase).toBeGreaterThan(0);
    expect(bulkRes.summaryEvents.some((s) => s.includes('Villain'))).toBe(true);
  });

  test('3. Watch-chunked camp ambushes: camp gear reduces risk, watch check determines surprise (flat_footed), and rest aborts at partial elapsed turns', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Move to dungeon_1 (watchDurationHours: 2 = 1200 turns, ambushChancePerWatch: 0.15)
    state = { ...state, currentAreaId: 'dungeon_1', cachedFov: new Set<number>() };

    // Remove pre-spawned dungeon monsters so rest safety passes initially
    for (const eid of [...state.entities]) {
      if (eid === playerId) continue;
      if (getComponent(state, eid, ComponentType.Fighter)) {
        state = addComponent(state, eid, { type: ComponentType.Position, x: 75, y: 45 });
      }
    }

    // Without camp gear: preparedness reduction = 0
    expect(evaluatePartyCampPreparedness(state, playerId).ambushRiskReduction).toBe(0);

    // Add bedroll, tent, and torch to player inventory -> 2 camp_gear (0.06) + 1 light_source (0.03) = 0.09 reduction
    let bedrollId;
    let tentId;
    let torchId;
    [state, bedrollId] = spawnItem(state, 'bedroll', playerPos.x, playerPos.y);
    [state, tentId] = spawnItem(state, 'tent', playerPos.x, playerPos.y);
    [state, torchId] = spawnItem(state, 'torch', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory) ?? { type: ComponentType.Inventory, items: [] };
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, bedrollId, tentId, torchId]
    });

    const prep = evaluatePartyCampPreparedness(state, playerId);
    expect(prep.campGearCount).toBe(2);
    expect(prep.hasCampLight).toBe(true);
    expect(prep.ambushRiskReduction).toBeCloseTo(0.09, 5);

    // Effective ambush chance in dungeon_1 is now 0.15 - 0.09 = 0.06.
    // A roll of 0.10 would have ambushed without camp gear (0.10 < 0.15), but is safe with camp gear (0.10 >= 0.06)!
    const safeCycle = resolveWatchAmbushCycle(state, playerId, 0.1, 10);
    expect(safeCycle.ambushed).toBe(false);

    // Now force an ambush roll of 0.01 (< 0.06) AND a failed watch perception d20 roll of 1 -> ambushed & surprised (flat_footed)
    const startTurn = state.globalTurn;
    const bulkAmbush = executeWatchChunkedBulkRest(state, playerId, 4800, undefined, 0.01, 1);
    expect(bulkAmbush.interruptedReason).toContain('ambushed');
    // Interrupted after the first 2-hour watch shift (1200 turns), not the full 4800 turns!
    expect(bulkAmbush.turnsAdvanced).toBe(1200);
    expect(bulkAmbush.state.globalTurn).toBe(startTurn + 1200);
    expect(getDnD35EntityData(bulkAmbush.state, playerId).conditions).toContain('flat_footed');

    // Sleeping NPC awareness check: -10 penalty on Listen while 'sleeping' status is active
    let guardId;
    [state, guardId] = spawnEntity(state, 'goblin', playerPos.x + 3, playerPos.y);
    state = applyStatusEffect(state, guardId, SLEEPING_STATUS_ID, 100);
    const failedWake = evaluateSleepingActorAwareness(state, guardId, 15, 10);
    expect(failedWake.wokeUp).toBe(false);
    expect(getDnD35EntityData(failedWake.state, guardId).conditions).toContain('flat_footed');

    const succeededWake = evaluateSleepingActorAwareness(state, guardId, 5, 18);
    expect(succeededWake.wokeUp).toBe(true);
    const guardStatuses = getComponent(succeededWake.state, guardId, ComponentType.StatusEffects);
    expect(guardStatuses?.activeEffects.some((e) => e.effectId === SLEEPING_STATUS_ID) ?? false).toBe(false);
  });

  test('4. Quick-draw container (bandoleer / potion_belt) grants 1 free EquipItem per round without spending Move action', () => {
    let state = buildGameState(sharedCampaign, EngineMode.TurnBased);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Spawn 2 daggers and a bandoleer into player inventory
    let bandoleerId;
    let dagger1Id;
    let dagger2Id;
    [state, bandoleerId] = spawnItem(state, 'bandoleer', playerPos.x, playerPos.y);
    [state, dagger1Id] = spawnItem(state, 'dagger', playerPos.x, playerPos.y);
    [state, dagger2Id] = spawnItem(state, 'dagger', playerPos.x, playerPos.y);
    state = addComponent(state, playerId, {
      type: ComponentType.Inventory,
      items: [bandoleerId, dagger1Id, dagger2Id],
      baseCapacity: 30
    });

    // Hydrate fresh round action budget (1 Standard, 1 Move)
    const freshBudget = hydrateEntityRoundActionBudget(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      actionBudget: freshBudget
    });

    // Without bandoleer equipped: equipping dagger1 (index 1) costs a Move action (moveRemaining: 1 -> 0)
    const withoutBeltRes = applyIntentWithCost(state, {
      type: IntentType.EquipItem,
      entityId: playerId,
      itemIndex: 1
    });
    expect(getDnD35EntityData(withoutBeltRes.state, playerId).actionBudget?.moveRemaining).toBe(0);

    // Equip the bandoleer first and reset round budget
    const withBandoleerEquipped = processEquipItemIntent(state, playerId, 0).state;
    let readyState = setDnD35EntityData(withBandoleerEquipped, playerId, {
      ...getDnD35EntityData(withBandoleerEquipped, playerId),
      actionBudget: hydrateEntityRoundActionBudget(withBandoleerEquipped, playerId)
    });

    // 1st EquipItem of dagger1 (index 1) with bandoleer equipped is FREE (moveRemaining stays 1, quickDrawContainerUsedThisRound = true)
    const firstQuickDraw = applyIntentWithCost(readyState, {
      type: IntentType.EquipItem,
      entityId: playerId,
      itemIndex: 1
    });
    const budgetAfterFirst = getDnD35EntityData(firstQuickDraw.state, playerId).actionBudget!;
    expect(budgetAfterFirst.moveRemaining).toBe(1);
    expect(budgetAfterFirst.standardRemaining).toBe(1);
    expect(budgetAfterFirst.quickDrawContainerUsedThisRound).toBe(true);
    expect(firstQuickDraw.energyCost).toBe(0);

    // 2nd EquipItem in the same round (index 2) consumes the Move action normally (moveRemaining: 1 -> 0)
    const secondEquip = applyIntentWithCost(firstQuickDraw.state, {
      type: IntentType.EquipItem,
      entityId: playerId,
      itemIndex: 2
    });
    expect(getDnD35EntityData(secondEquip.state, playerId).actionBudget?.moveRemaining).toBe(0);
  });

  test('5. Two-Stage Poison & Antitoxin: secondary stage fires on turn 10 and antitoxin grants +5 alchemical Fort resistance', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Drink an antitoxin vial via processApplyIntent ('drink')
    let antitoxinId;
    [state, antitoxinId] = spawnItem(state, 'antitoxin', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory)!;
    state = addComponent(state, playerId, { ...inv, items: [...inv.items, antitoxinId] });

    const drinkRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'drink',
      target: { type: 'entity', entityId: playerId },
      toolEntityId: antitoxinId
    });
    expect(drinkRes.success).toBe(true);
    state = drinkRes.state;

    const statusesAfterDrink = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent;
    expect(statusesAfterDrink.activeEffects.some((e) => e.effectId === 'antitoxin')).toBe(true);

    // Apply 2-stage poison (duration 12, secondaryTriggerAfterTurns: 10)
    state = applyStatusEffect(state, playerId, 'poison', 12);
    for (let i = 1; i <= 9; i++) {
      state = processStatusEffectsTick(state, playerId);
      const eff = getComponent(state, playerId, ComponentType.StatusEffects)?.activeEffects.find(
        (e) => e.effectId === 'poison'
      );
      expect(eff?.elapsedTurns).toBe(i);
      expect(eff?.secondaryResolved).toBe(false);
    }

    // On tick 10, secondary stage triggers and logs the (+5 alchemical) Fortitude save
    state = processStatusEffectsTick(state, playerId);
    const effAfter10 = getComponent(state, playerId, ComponentType.StatusEffects)?.activeEffects.find(
      (e) => e.effectId === 'poison'
    );
    expect(effAfter10?.secondaryResolved).toBe(true);
    expect(state.messages.some((m) => m.text.includes('(+5 alchemical)'))).toBe(true);
  });

  test('6. Healer’s Kit: 2x Long-Term Care rest recovery, DC 15 limp cure, and pending secondary poison neutralization', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Configure player at Level 4 with 10/30 HP, 2 STR ability damage, 'limping' status, and 'healers_kit' in inventory (+2 circumstance, skillRanks.heal = 3 -> Take 10 + 3 + 2 = 15 >= DC 15!)
    let kitId;
    [state, kitId] = spawnItem(state, 'healers_kit', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory)!;
    state = addComponent(state, playerId, { ...inv, items: [...inv.items, kitId] });

    const baseDnd = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...baseDnd,
      tracks: [{ ...baseDnd.tracks[0]!, levels: 4 }],
      skillRanks: { ...baseDnd.skillRanks, heal: 3 },
      abilityScores: {
        ...baseDnd.abilityScores,
        str: { ...baseDnd.abilityScores.str, damage: 2 }
      }
    });
    const fighter = getComponent(state, playerId, ComponentType.Fighter)!;
    state = addComponent(state, playerId, { ...fighter, hp: 10, maxHp: 30, level: 4 });
    state = applyStatusEffect(state, playerId, 'limping', 100);
    state = applyStatusEffect(state, playerId, 'poison', 15);

    // Use 'heal' verb on self -> cures 'limping' and neutralizes pending secondary poison stage!
    // Force high heal ranks so roll always passes DC 15
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      skillRanks: { ...baseDnd.skillRanks, heal: 14 }
    });
    const healVerbRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'heal',
      target: { type: 'entity', entityId: playerId }
    });
    expect(healVerbRes.success).toBe(true);
    state = healVerbRes.state;
    const statusesAfterHeal = getComponent(state, playerId, ComponentType.StatusEffects);
    expect(statusesAfterHeal?.activeEffects.some((e) => e.effectId === 'limping') ?? false).toBe(false);
    expect(statusesAfterHeal?.activeEffects.find((e) => e.effectId === 'poison')?.secondaryResolved).toBe(true);

    // Clear poison so safe rest can proceed, then verify 8-hour rest with healers_kit heals 2x (4 HD * 2 = +8 HP, and -2 STR damage -> 0)
    state = addComponent(state, playerId, { type: ComponentType.StatusEffects, activeEffects: [] });
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      skillRanks: { heal: 3 } // Take 10 + 3 ranks + 2 kit = 15 (Long-Term Care DC 15)
    });
    const afterRest = executeEightHourRest(state, playerId);
    const healedFighter = getComponent(afterRest, playerId, ComponentType.Fighter) as FighterComponent;
    expect(healedFighter.hp).toBe(18); // 10 + (4 * 2) = 18
    expect(getDnD35EntityData(afterRest, playerId).abilityScores.str.damage).toBe(0); // 2 - 2 = 0
  });

  test('7. Manacles & Masterwork Manacles bind helpless/sleeping targets (DC 30/26 vs 35/28) and support Escape Artist / Break', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    let banditId;
    let manaclesId;
    let mwManaclesId;
    [state, banditId] = spawnEntity(state, 'bandit', playerPos.x + 1, playerPos.y);
    [state, manaclesId] = spawnItem(state, 'manacles', playerPos.x, playerPos.y);
    [state, mwManaclesId] = spawnItem(state, 'masterwork_manacles', playerPos.x, playerPos.y);

    // 1. Applying manacles to an awake, un-incapacitated target fails
    const awakeRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'apply',
      target: { type: 'entity', entityId: banditId },
      toolEntityId: manaclesId
    });
    expect(awakeRes.success).toBe(false);

    // 2. Render target unconscious -> applying standard manacles succeeds with DC 30 / 26
    state = setDnD35EntityData(state, banditId, {
      ...getDnD35EntityData(state, banditId),
      conditions: ['unconscious']
    });
    const bindStd = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'apply',
      target: { type: 'entity', entityId: banditId },
      toolEntityId: manaclesId
    });
    expect(bindStd.success).toBe(true);
    state = bindStd.state;
    const boundDnd = getDnD35EntityData(state, banditId);
    expect(boundDnd.conditions).toContain('bound');
    expect(boundDnd.restraintBinding).toEqual({
      escapeArtistDc: STANDARD_MANACLES_ESCAPE_ARTIST_DC,
      breakDc: STANDARD_MANACLES_BREAK_DC,
      restraintItemId: 'manacles'
    });

    // 3. Apply masterwork_manacles -> upgrades DCs to 35 / 28
    const bindMw = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'apply',
      target: { type: 'entity', entityId: banditId },
      toolEntityId: mwManaclesId
    });
    expect(bindMw.success).toBe(true);
    state = bindMw.state;
    expect(getDnD35EntityData(state, banditId).restraintBinding).toEqual({
      escapeArtistDc: MASTERWORK_MANACLES_ESCAPE_ARTIST_DC,
      breakDc: MASTERWORK_MANACLES_BREAK_DC,
      restraintItemId: 'masterwork_manacles'
    });

    // 4. Attempt Escape Artist with low skill fails; with high skill succeeds and removes 'bound'
    const failedEscape = attemptEscapeOrBreakRestraints(state, banditId, 'escape_artist', 10);
    expect(failedEscape.success).toBe(false);
    expect(getDnD35EntityData(failedEscape.state, banditId).conditions).toContain('bound');

    state = setDnD35EntityData(state, banditId, {
      ...getDnD35EntityData(state, banditId),
      skillRanks: { escape_artist: 20 }
    });
    const succeededEscape = attemptEscapeOrBreakRestraints(state, banditId, 'escape_artist', 18);
    expect(succeededEscape.success).toBe(true);
    expect(getDnD35EntityData(succeededEscape.state, banditId).conditions).not.toContain('bound');
    expect(getDnD35EntityData(succeededEscape.state, banditId).restraintBinding).toBeUndefined();
  });
});
