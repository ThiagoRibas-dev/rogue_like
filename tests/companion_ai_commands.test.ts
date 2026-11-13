import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { handleModalKey, isModalUIMode } from '../src/core/input/modal_input.ts';
import { clearInputQueue } from '../src/core/input_queue.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { cancelPendingSave } from '../src/core/persistence_service.ts';
import { clearScheduler, initEngine } from '../src/core/scheduler.ts';
import { applyCharacterCreationToPlayer } from '../src/rulesets/dnd35e/builder/builder_hydrator_creation.ts';
import { onDnD35eActorTurnStart, resolveDnD35eActionEnergyCost } from '../src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts';
import { syncActorCompanionsAndFamiliars } from '../src/rulesets/dnd35e/companions.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { processAITurn } from '../src/systems/ai.system.ts';
import { getValidVerbsForTarget, getVerbOptionsForTarget, processApplyIntent } from '../src/systems/apply.system.ts';
import { COMPANION_ORDERS_DIALOGUE_ID } from '../src/systems/companion_commands.system.ts';
import { processSelectDialogueOptionIntent } from '../src/actions/dialogue.actions.ts';
import { processMoveIntent } from '../src/systems/movement.system.ts';
import { processFireAimedIntent } from '../src/systems/targeting.system.ts';
import { applyConsequence } from '../src/systems/trigger.system.ts';
import { ComponentType, type ControllerLinkComponent } from '../src/types/components.types.ts';
import { GameEventType } from '../src/types/events.types.ts';
import { EngineMode, UIMode, type EntityId, type GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { ApplyIntent, MeleeAttackIntent, MoveIntent } from '../src/types/intents/intent.union.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function findPlayerId(state: GameState): EntityId {
  const pid = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (pid === undefined) throw new Error('Player entity missing');
  return pid;
}

function buildOpenArenaState(rulesetCampaign = 'dnd35e-crypt'): { state: GameState; playerId: EntityId } {
  const campaign = loadCampaignFromDisk(rulesetCampaign);
  let state = buildGameState(campaign);
  const width = 20;
  const height = 20;
  const tiles = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      tiles.push({ tileId: 'stone_floor', x, y, explored: true });
    }
  }
  const playerId = findPlayerId(state);
  const playerComponents = state.components.get(playerId);
  const cleanComponents = new Map();
  if (playerComponents) {
    cleanComponents.set(playerId, playerComponents);
  }
  state = {
    ...state,
    entities: [playerId],
    components: cleanComponents,
    spatialIndex: new Map(),
    map: { width, height, tiles, isFullyExplored: true }
  };

  state = addComponent(state, playerId, { type: ComponentType.Position, x: 5, y: 5 });
  return { state, playerId };
}

function spawnCompanion(
  state: GameState,
  controllerId: EntityId,
  x: number,
  y: number,
  stance: ControllerLinkComponent['stance'] = 'defensive',
  commandTargetId?: EntityId
): { state: GameState; companionId: EntityId } {
  let nextState: GameState;
  let compId: EntityId;
  [nextState, compId] = createEntity(state);
  nextState = addComponent(nextState, compId, { type: ComponentType.Actor, speed: 100 });
  nextState = addComponent(nextState, compId, { type: ComponentType.Position, x, y });
  nextState = addComponent(nextState, compId, {
    type: ComponentType.Renderable,
    glyph: 'w',
    fg: '#c0a080',
    bg: '#000000'
  });
  nextState = addComponent(nextState, compId, {
    type: ComponentType.Identity,
    name: 'Timber Wolf',
    mannerisms: ['loyal']
  });
  nextState = addComponent(nextState, compId, {
    type: ComponentType.Fighter,
    hp: 15,
    maxHp: 15,
    attack: 4,
    defense: 14,
    level: 2,
    xp: 0,
    xpGiven: 0
  });
  nextState = addComponent(nextState, compId, { type: ComponentType.Faction, factionId: 'player' });
  nextState = addComponent(nextState, compId, { type: ComponentType.Attitude, attitude: 'helpful' });
  nextState = addComponent(nextState, compId, { type: ComponentType.AI, profileId: 'companion_default' });
  nextState = addComponent(nextState, compId, {
    type: ComponentType.ControllerLink,
    controllerEntityId: controllerId,
    tags: ['animal_companion'],
    shareInitiative: true,
    stance,
    ...(commandTargetId !== undefined ? { commandTargetId } : {})
  });
  return { state: nextState, companionId: compId };
}

function spawnEnemy(state: GameState, x: number, y: number, hp = 12): { state: GameState; enemyId: EntityId } {
  let nextState: GameState;
  let enemyId: EntityId;
  [nextState, enemyId] = createEntity(state);
  nextState = addComponent(nextState, enemyId, { type: ComponentType.Actor, speed: 100 });
  nextState = addComponent(nextState, enemyId, { type: ComponentType.Position, x, y });
  nextState = addComponent(nextState, enemyId, {
    type: ComponentType.Identity,
    name: 'Goblin Marauder',
    mannerisms: ['fierce']
  });
  nextState = addComponent(nextState, enemyId, {
    type: ComponentType.Fighter,
    hp,
    maxHp: hp,
    attack: 2,
    defense: 12,
    level: 1,
    xp: 0,
    xpGiven: 25
  });
  nextState = addComponent(nextState, enemyId, { type: ComponentType.Faction, factionId: 'monster' });
  nextState = addComponent(nextState, enemyId, { type: ComponentType.Attitude, attitude: 'hostile' });
  return { state: nextState, enemyId };
}

describe('Companion AI, Stances, Focus-Target Directives & Corridor Swap', () => {
  test('D&D 3.5e companion spawning attaches AIComponent on an adjacent walkable tile and preserves stance on resync', () => {
    const { state: baseState, playerId } = buildOpenArenaState('dnd35e-crypt');
    const created = applyCharacterCreationToPlayer(baseState, playerId, {
      raceId: 'human',
      classId: 'druid',
      alignment: 'neutral_good',
      abilityMethod: 'point_buy',
      pointBuyBudget: 25,
      baseAbilityScores: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { handle_animal: 4, survival: 4 },
      selectedFeats: ['spell_focus_conjuration'],
      knownSpells: [],
      equipmentPackageId: 'druid_standard',
      animalCompanionId: 'wolf'
    });

    const companionId = created.entities.find(
      (id) => getComponent(created, id, ComponentType.ControllerLink)?.controllerEntityId === playerId
    );
    expect(companionId).toBeDefined();

    const ai = getComponent(created, companionId!, ComponentType.AI);
    expect(ai?.profileId).toBe('companion_default');

    const playerPos = getComponent(created, playerId, ComponentType.Position)!;
    const compPos = getComponent(created, companionId!, ComponentType.Position)!;
    const dist = Math.max(Math.abs(playerPos.x - compPos.x), Math.abs(playerPos.y - compPos.y));
    expect(dist).toBe(1);

    const equip = getComponent(created, companionId!, ComponentType.Equipment);
    expect(equip).toBeDefined();

    const withAggressive = processApplyIntent(created, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'order_attack',
      target: { type: 'entity', entityId: companionId! }
    }).state;

    const resynced = syncActorCompanionsAndFamiliars(withAggressive, playerId);
    const linkAfter = getComponent(resynced, companionId!, ComponentType.ControllerLink);
    expect(linkAfter?.stance).toBe('aggressive');
  });

  test('followBehavior moves companion toward master when outside followDistance and halts once adjacent/within range', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const { state: s1, companionId } = spawnCompanion(baseState, playerId, 11, 5, 'defensive');

    const farTurn = processAITurn(s1, companionId);
    expect(farTurn.intent).not.toBeNull();
    expect(farTurn.intent?.type).toBe(IntentType.Move);
    const moveIntent = farTurn.intent as MoveIntent;
    expect(moveIntent.dx).toBe(-1);

    const { state: s2, companionId: closeCompId } = spawnCompanion(baseState, playerId, 7, 5, 'defensive');
    const closeTurn = processAITurn(s2, closeCompId);
    expect(closeTurn.intent).toBeNull();
  });

  test('stance rules govern passive, defensive, aggressive, and hold behaviors', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    // Companion adjacent to hostile at (6, 6); player at (5, 5)
    const { state: sEnemy, enemyId: adjacentEnemy } = spawnEnemy(baseState, 6, 6);
    // Distant hostile at (10, 5) — within companion aggroRadius (6) from companion at (6, 5), but > defendRadius (3) from player at (5, 5)
    const { state: sEnemies } = spawnEnemy(sEnemy, 10, 5);

    // 1. Passive: ignores even adjacent hostile, follows instead
    const { state: sPassive, companionId: passId } = spawnCompanion(sEnemies, playerId, 6, 5, 'passive');
    expect(processAITurn(sPassive, passId).intent).toBeNull();

    // 2. Defensive: ignores distant hostile at (10,5), only attacks threat near master/self
    const { state: sDefNoAdj } = spawnEnemy(baseState, 10, 5);
    const { state: sDef, companionId: defId } = spawnCompanion(sDefNoAdj, playerId, 7, 5, 'defensive');
    expect(processAITurn(sDef, defId).intent).toBeNull();

    // 3. Aggressive: pursues distant hostile at (10, 5)
    const { state: sAgg, companionId: aggId } = spawnCompanion(sDefNoAdj, playerId, 7, 5, 'aggressive');
    const aggTurn = processAITurn(sAgg, aggId);
    expect(aggTurn.intent?.type).toBe(IntentType.Move);
    expect((aggTurn.intent as MoveIntent).dx).toBe(1);

    // 4. Hold: attacks adjacent enemy in melee, but does NOT move if enemy is 2 tiles away
    const { state: sHoldAdj, companionId: holdAdjId } = spawnCompanion(sEnemy, playerId, 6, 5, 'hold');
    const holdAdjTurn = processAITurn(sHoldAdj, holdAdjId);
    expect(holdAdjTurn.intent?.type).toBe(IntentType.MeleeAttack);
    expect((holdAdjTurn.intent as MeleeAttackIntent).defenderId).toBe(adjacentEnemy);

    const { state: sHoldFar, companionId: holdFarId } = spawnCompanion(sDefNoAdj, playerId, 1, 5, 'hold');
    expect(processAITurn(sHoldFar, holdFarId).intent).toBeNull();
  });

  test('focus-target directive prioritizes commandTargetId over nearer hostiles and clears when target dies', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const { state: s1, enemyId: nearGoblin } = spawnEnemy(baseState, 6, 6);
    const { state: s2, enemyId: bossEnemy } = spawnEnemy(s1, 6, 4);
    const { state: s3, companionId } = spawnCompanion(s2, playerId, 6, 5, 'defensive');

    // Issue order_target directly on bossEnemy
    const verbsOnEnemy = getValidVerbsForTarget(s3, playerId, { type: 'entity', entityId: bossEnemy });
    expect(verbsOnEnemy).toContain('order_target');

    const ordered = processApplyIntent(s3, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'order_target',
      target: { type: 'entity', entityId: bossEnemy }
    } as ApplyIntent).state;

    expect(getComponent(ordered, companionId, ComponentType.ControllerLink)?.commandTargetId).toBe(bossEnemy);

    // Even though nearGoblin is equally close, companion attacks commanded bossEnemy
    const turn = processAITurn(ordered, companionId);
    expect(turn.intent?.type).toBe(IntentType.MeleeAttack);
    expect((turn.intent as MeleeAttackIntent).defenderId).toBe(bossEnemy);
    expect(nearGoblin).not.toBe(bossEnemy);

    // Simulate bossEnemy dying (hp -> 0): next AI turn auto-clears stale commandTargetId
    const bossFighter = getComponent(ordered, bossEnemy, ComponentType.Fighter)!;
    const bossDead = addComponent(ordered, bossEnemy, { ...bossFighter, hp: 0 });
    const postDeathTurn = processAITurn(bossDead, companionId);
    expect(getComponent(postDeathTurn.state, companionId, ComponentType.ControllerLink)?.commandTargetId).toBeUndefined();
  });

  test('command dialogue, aiming order_target, and set_companion_stance consequence update companion stance cleanly', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const { state: s1, enemyId } = spawnEnemy(baseState, 8, 5);
    const { state: s2, companionId } = spawnCompanion(s1, playerId, 6, 5, 'passive');

    // Open __companion_orders__ dialogue via 'command' verb
    const opened = processApplyIntent(s2, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'command',
      target: { type: 'entity', entityId: companionId }
    }).state;
    expect(opened.uiMode).toBe(UIMode.Dialogue);
    expect(opened.activeDialogue?.treeId).toBe(COMPANION_ORDERS_DIALOGUE_ID);

    // Select Aggressive option from synthetic dialogue
    const selected = processSelectDialogueOptionIntent(opened, {
      type: IntentType.SelectDialogueOption,
      entityId: playerId,
      optionId: 'opt_aggressive',
      isImmediate: true
    }).state;
    expect(selected.uiMode).toBe(UIMode.Game);
    expect(getComponent(selected, companionId, ComponentType.ControllerLink)?.stance).toBe('aggressive');

    // Open targeting mode via order_target verb on companion, aim onto enemy, and confirm FireAimedIntent
    const targeting = processApplyIntent(selected, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'order_target',
      target: { type: 'entity', entityId: companionId }
    }).state;
    expect(targeting.targetingMode?.active).toBe(true);
    expect(targeting.targetingMode?.context?.companionEntityId).toBe(companionId);

    const aimed: GameState = {
      ...targeting,
      targetingMode: {
        ...targeting.targetingMode!,
        x: 8,
        y: 5
      }
    };
    const confirmed = processFireAimedIntent(aimed, {
      type: IntentType.FireAimed,
      entityId: playerId
    }).state;
    expect(confirmed.targetingMode).toBeUndefined();
    expect(getComponent(confirmed, companionId, ComponentType.ControllerLink)?.commandTargetId).toBe(enemyId);

    // Consequence direct check
    const held = applyConsequence(
      confirmed,
      { type: GameEventType.DialogueSelected, dialogueId: COMPANION_ORDERS_DIALOGUE_ID, optionId: 'opt_hold' },
      { type: 'set_companion_stance', stance: 'hold', targetId: String(companionId) }
    );
    expect(getComponent(held, companionId, ComponentType.ControllerLink)?.stance).toBe('hold');
  });

  test('player bumping into a friendly companion in a corridor swaps tiles instead of blocking movement', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    const { state: s1, companionId } = spawnCompanion(baseState, playerId, 6, 5, 'defensive');

    const moved = processMoveIntent(s1, {
      type: IntentType.Move,
      entityId: playerId,
      dx: 1,
      dy: 0
    });

    expect(moved.success).toBe(true);
    expect(getComponent(moved.state, playerId, ComponentType.Position)).toEqual({
      type: ComponentType.Position,
      x: 6,
      y: 5
    });
    expect(getComponent(moved.state, companionId, ComponentType.Position)).toEqual({
      type: ComponentType.Position,
      x: 5,
      y: 5
    });
  });

  test('verb menu execution preserves Turn-Based result states (Dialogue) and modal_input handles Dialogue/Trade/Services', () => {
    const makeKeyEvent = (key: string): KeyboardEvent => {
      let prevented = false;
      return {
        key,
        preventDefault: (): void => {
          prevented = true;
        },
        get defaultPrevented(): boolean {
          return prevented;
        }
      } as unknown as KeyboardEvent;
    };

    expect(isModalUIMode(UIMode.Dialogue)).toBe(true);
    expect(isModalUIMode(UIMode.Trade)).toBe(true);
    expect(isModalUIMode(UIMode.Services)).toBe(true);

    const { state: baseState, playerId } = buildOpenArenaState();
    const { state: s1, companionId } = spawnCompanion(baseState, playerId, 6, 5, 'defensive');
    const target = { type: 'entity' as const, entityId: companionId };
    const availableVerbs = getValidVerbsForTarget(s1, playerId, target);
    const verbOptions = getVerbOptionsForTarget(s1, playerId, target);

    initEngine();
    clearInputQueue();
    try {
      setGameState({
        ...s1,
        isSandbox: true,
        uiMode: UIMode.VerbMenu,
        verbMenu: { target, availableVerbs, verbOptions }
      });

      const commandIdx = availableVerbs.indexOf('command');
      expect(commandIdx).toBeGreaterThanOrEqual(0);

      // Fix 1: Selecting 'command' from VerbMenu transitions into UIMode.Dialogue without being overwritten.
      handleModalKey(makeKeyEvent(String(commandIdx + 1)), getGameState(), playerId);
      const afterCommand = getGameState();
      expect(afterCommand.uiMode).toBe(UIMode.Dialogue);
      expect(afterCommand.verbMenu).toBeUndefined();
      expect(afterCommand.activeDialogue?.treeId).toBe(COMPANION_ORDERS_DIALOGUE_ID);

      // Fix 2: Pressing '1' in Dialogue selects the first option (Aggressive) and closes dialogue.
      handleModalKey(makeKeyEvent('1'), getGameState(), playerId);
      const afterOpt = getGameState();
      expect(afterOpt.uiMode).toBe(UIMode.Game);
      expect(afterOpt.activeDialogue).toBeUndefined();
      expect(getComponent(afterOpt, companionId, ComponentType.ControllerLink)?.stance).toBe('aggressive');

      // Re-open Dialogue and press Escape to verify CloseDialogueIntent closes cleanly.
      setGameState({
        ...afterOpt,
        uiMode: UIMode.Dialogue,
        activeDialogue: {
          treeId: COMPANION_ORDERS_DIALOGUE_ID,
          currentNodeId: 'root',
          npcEntityId: companionId
        }
      });
      handleModalKey(makeKeyEvent('Escape'), getGameState(), playerId);
      expect(getGameState().uiMode).toBe(UIMode.Game);
      expect(getGameState().activeDialogue).toBeUndefined();

      // Trade/Services Escape handling
      setGameState({ ...getGameState(), uiMode: UIMode.Trade, activeTrade: { npcEntityId: companionId } });
      handleModalKey(makeKeyEvent('Escape'), getGameState(), playerId);
      expect(getGameState().uiMode).toBe(UIMode.Game);
      expect(getGameState().activeTrade).toBeUndefined();
    } finally {
      clearInputQueue();
      clearScheduler();
      cancelPendingSave();
    }
  });

  test('huntBehavior routes around friendly blockers and walls instead of stalling', () => {
    const { state: baseState, playerId } = buildOpenArenaState();
    // Player at (5, 5), aggressive companion at (4, 5), enemy at (6, 5): straight line is blocked by player.
    const { state: sEnemy } = spawnEnemy(baseState, 6, 5);
    const { state: sBlocked, companionId } = spawnCompanion(sEnemy, playerId, 4, 5, 'aggressive');

    const sidestepTurn = processAITurn(sBlocked, companionId);
    expect(sidestepTurn.intent?.type).toBe(IntentType.Move);
    const sidestepMove = sidestepTurn.intent as MoveIntent;
    expect(sidestepMove.dx).toBe(1);
    expect(Math.abs(sidestepMove.dy)).toBe(1);

    // Wall barrier at x = 5, y = 4..6 separating companion (4, 5) from enemy (6, 5)
    const wallTiles = baseState.map.tiles.map((t) =>
      t.x === 5 && t.y >= 4 && t.y <= 6 ? { ...t, tileId: 'stone_wall' } : t
    );
    const walledBase: GameState = {
      ...baseState,
      map: { ...baseState.map, tiles: wallTiles }
    };
    const { state: sWalledEnemy } = spawnEnemy(walledBase, 6, 5);
    const { state: sWalled, companionId: walledCompId } = spawnCompanion(sWalledEnemy, playerId, 4, 5, 'aggressive');

    const detourTurn = processAITurn(sWalled, walledCompId);
    expect(detourTurn.intent?.type).toBe(IntentType.Move);
    const detourMove = detourTurn.intent as MoveIntent;
    // Must not step directly onto the blocked wall at (5, 5)
    expect(detourMove.dx === 1 && detourMove.dy === 0).toBe(false);
  });

  test('resolveDnD35eActionEnergyCost scales !isPlayer MoveIntent per-step energy instead of 100-tick round cost', () => {
    const { state: baseState, playerId } = buildOpenArenaState('dnd35e-crypt');
    const { state: sEnemy, enemyId } = spawnEnemy(baseState, 8, 5);
    const { state: s1, companionId } = spawnCompanion(sEnemy, playerId, 6, 5, 'defensive');
    const turnStartedState = onDnD35eActorTurnStart(s1, companionId);

    const moveCost = resolveDnD35eActionEnergyCost(
      turnStartedState,
      { type: IntentType.Move, entityId: companionId, dx: 1, dy: 0 },
      100
    );
    expect(moveCost.energyCost).toBe(17);

    const attackCost = resolveDnD35eActionEnergyCost(
      turnStartedState,
      { type: IntentType.MeleeAttack, entityId: companionId, defenderId: enemyId },
      100
    );
    expect(attackCost.energyCost).toBe(100);
  });

  test('Druid Turn-Based movement uses 30 ft tactical speed and walks Wolf companion alongside mid-round moves', () => {
    const { state: baseState, playerId } = buildOpenArenaState('dnd35e-crypt');
    const created = applyCharacterCreationToPlayer(baseState, playerId, {
      raceId: 'human',
      classId: 'druid',
      alignment: 'neutral_good',
      abilityMethod: 'point_buy',
      pointBuyBudget: 25,
      baseAbilityScores: { str: 10, dex: 12, con: 14, int: 10, wis: 16, cha: 10 },
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { handle_animal: 4, survival: 4 },
      selectedFeats: ['spell_focus_conjuration'],
      knownSpells: [],
      equipmentPackageId: 'druid_standard',
      animalCompanionId: 'wolf'
    });

    const companionId = created.entities.find(
      (id) => getComponent(created, id, ComponentType.ControllerLink)?.controllerEntityId === playerId
    );
    expect(companionId).toBeDefined();

    // Wolf JSON defaults to 30 ft land speed (17 ticks/step), and scales to 10 ticks/step when given 50 ft land speed
    const wolfTurnState = onDnD35eActorTurnStart(
      { ...created, engineMode: EngineMode.TurnBased },
      companionId!
    );
    const wolfBaseCost = resolveDnD35eActionEnergyCost(
      wolfTurnState,
      { type: IntentType.Move, entityId: companionId!, dx: 1, dy: 0 },
      100
    );
    expect(wolfBaseCost.energyCost).toBe(17);

    const fastWolfState = setDnD35EntityData(wolfTurnState, companionId!, {
      ...getDnD35EntityData(wolfTurnState, companionId!),
      movementModes: { land: 50 }
    });
    const fastWolfCost = resolveDnD35eActionEnergyCost(
      fastWolfState,
      { type: IntentType.Move, entityId: companionId!, dx: 1, dy: 0 },
      100
    );
    expect(fastWolfCost.energyCost).toBe(10);

    // Place companion at (3, 5) behind player at (5, 5), then move player right 5 times in TurnBased mode
    let simState: GameState = {
      ...created,
      engineMode: EngineMode.TurnBased
    };
    simState = addComponent(simState, companionId!, { type: ComponentType.Position, x: 3, y: 5 });
    simState = onDnD35eActorTurnStart(simState, playerId);

    const step1 = applyIntentWithCost(simState, {
      type: IntentType.Move,
      entityId: playerId,
      dx: 1,
      dy: 0
    });
    expect(step1.success).toBe(true);
    expect(step1.energyCost).toBe(0);

    const dndAfterStep1 = getDnD35EntityData(step1.state, playerId);
    expect(dndAfterStep1.actionBudget?.movementRemainingFt).toBe(25);

    const compAfterStep1 = getComponent(step1.state, companionId!, ComponentType.Position)!;
    // Player is now at (6, 5); companion moved from (3, 5) to (4, 5) to maintain followDistance 2
    expect(compAfterStep1.x).toBe(4);
    expect(compAfterStep1.y).toBe(5);

    // Continue walking east through step 11 (mid-round zero-cost steps) and verify companion stays within followDistance 2
    simState = step1.state;
    let totalEnergyCost = step1.energyCost;
    for (let step = 2; step <= 11; step++) {
      const res = applyIntentWithCost(simState, {
        type: IntentType.Move,
        entityId: playerId,
        dx: 1,
        dy: 0
      });
      expect(res.success).toBe(true);
      expect(res.energyCost).toBe(0);
      simState = res.state;
      totalEnergyCost += res.energyCost;
    }
    expect(totalEnergyCost).toBe(0);
    const compAfterMidRound = getComponent(simState, companionId!, ComponentType.Position)!;
    const playerAfterMidRound = getComponent(simState, playerId, ComponentType.Position)!;
    const midRoundGap = Math.max(
      Math.abs(playerAfterMidRound.x - compAfterMidRound.x),
      Math.abs(playerAfterMidRound.y - compAfterMidRound.y)
    );
    expect(midRoundGap).toBeLessThanOrEqual(2);

    // Step 12 completes the 60 ft Double Move (12 * 5 ft = 60 ft at 30 ft land speed) and commits full-round energyCost 100
    const step12 = applyIntentWithCost(simState, {
      type: IntentType.Move,
      entityId: playerId,
      dx: 1,
      dy: 0
    });
    expect(step12.success).toBe(true);
    expect(step12.energyCost).toBe(100);

    // At the end of the round the scheduler invokes the companion's AI turn to close any remaining gap
    const compTurn = processAITurn(step12.state, companionId!);
    expect(compTurn.intent?.type).toBe(IntentType.Move);
    const compMove = applyIntentWithCost(compTurn.state, compTurn.intent!);
    expect(compMove.success).toBe(true);
    const compAfterCatchup = getComponent(compMove.state, companionId!, ComponentType.Position)!;
    const playerAfterWalk = getComponent(compMove.state, playerId, ComponentType.Position)!;
    const finalGap = Math.max(
      Math.abs(playerAfterWalk.x - compAfterCatchup.x),
      Math.abs(playerAfterWalk.y - compAfterCatchup.y)
    );
    expect(finalGap).toBeLessThanOrEqual(2);
  });
});
