import { describe, expect, test } from 'bun:test';
import { DEFAULT_AUTO_PAUSE_SETTINGS } from '../src/constants/autopause.constants.ts';
import { detectAutoPauseSignals, resetAutoPauseTracking } from '../src/core/auto_pause_signals.ts';
import { addComponent, getComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { computeActorTacticalLandSpeedFt } from '../src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts';
import {
  evaluateConcealmentAndSenses,
  resolveTileLightReading
} from '../src/rulesets/dnd35e/spatial/cover_senses.ts';
import {
  applyFlourPouchDust,
  breakActorStealth,
  canActorEnterStealth,
  DUSTED_STATUS_ID,
  evaluateStealthDetection,
  isActorDusted,
  isActorHalfSpeedStealthing,
  isActorStealthed,
  toggleActorFastStealth,
  toggleActorStealth
} from '../src/rulesets/dnd35e/spatial/stealth_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { processAITurn } from '../src/systems/ai.system.ts';
import { processApplyIntent } from '../src/systems/apply.system.ts';
import { runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import {
  evaluateDynamicLightAtTile,
  igniteLightEmitter,
  isPointWithinEmitterCone,
  processActorLightEmittersTick,
  refuelLightEmitter
} from '../src/systems/light_emitter.system.ts';
import {
  emitSoundEvent,
  propagateSoundField,
  SOUND_DB_COMBAT,
  SOUND_DB_DOOR_KICK,
  tickAIAlertnessDecay
} from '../src/systems/sound.system.ts';
import {
  ComponentType,
  type AIComponent,
  type InventoryComponent,
  type LightEmitterComponent,
  type PositionComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function setMapTileAt(state: GameState, x: number, y: number, tileId: string): GameState {
  const idx = coordToIndex(x, y, state.map.width);
  const nextTiles = state.map.tiles.map((t, i) => (i === idx ? { ...t, tileId } : t));
  return { ...state, map: { ...state.map, tiles: nextTiles } };
}

function addItemToActorInventory(state: GameState, actorId: EntityId, itemId: string): [GameState, EntityId] {
  const [afterSpawn, itemEntityId] = spawnItem(state, itemId, 1, 1);
  const inv = (getComponent(afterSpawn, actorId, ComponentType.Inventory) as InventoryComponent | undefined) ?? {
    type: ComponentType.Inventory,
    items: [],
    baseCapacity: 20
  };
  const nextState = addComponent(afterSpawn, actorId, {
    ...inv,
    items: [...inv.items, itemEntityId]
  });
  return [nextState, itemEntityId];
}

function getFloorAndWallTileIds(state: GameState): { floorId: string; wallId: string } {
  const entries = Object.entries(state.campaign.tiles);
  const floorId = entries.find(([, t]) => t.walkable && t.transparent)?.[0] ?? 'floor';
  const wallId = entries.find(([, t]) => !t.walkable && !t.transparent)?.[0] ?? 'wall';
  return { floorId, wallId };
}

function clearOpenRoom(state: GameState, floorId: string, x1: number, y1: number, x2: number, y2: number): GameState {
  let s = state;
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      s = setMapTileAt(s, x, y, floorId);
    }
  }
  return s;
}

describe('Milestone 155: Acoustics, Dynamic LightEmitterComponent & Symmetric 6s-Cadence Stealth', () => {
  test('1. Acoustic sound ripple attenuates through walls/doors, alerts AI to investigate lastHeardPos, and logs directional player cues', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const baseState = buildGameState(campaign);
    const { floorId, wallId } = getFloorAndWallTileIds(baseState);
    let state = clearOpenRoom(baseState, floorId, 2, 2, 16, 12);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 4, y: 6 });

    // Place a solid wall barrier at x=7 to verify attenuation vs open corridor
    for (let y = 2; y <= 12; y++) {
      state = setMapTileAt(state, 7, y, wallId);
    }
    const wallMap = propagateSoundField(state, 4, 6, 30);
    expect(wallMap.get('6,6')).toBe(20);
    // Crossing solid wall (25 dB attenuation) drops 20 - 25 <= 0 -> sound does not penetrate thin whisper
    expect(wallMap.get('8,6')).toBeUndefined();

    // Open a doorway gap at (7, 6) and spawn a hostile guard beyond it at (10, 6)
    state = setMapTileAt(state, 7, 6, floorId);
    const enemyTemplateId =
      Object.keys(state.campaign.entities).find((id) => {
        const def = state.campaign.entities[id];
        return def !== undefined && def.factionId !== 'player' && def.ai !== undefined;
      }) ?? Object.keys(state.campaign.entities).find((id) => state.campaign.entities[id]?.factionId !== 'player')!;
    const [afterEnemy, guardId] = spawnEntity(state, enemyTemplateId, 10, 6);
    state = addComponent(afterEnemy, guardId, { type: ComponentType.Attitude, attitude: 'hostile' });
    const existingAi = getComponent(state, guardId, ComponentType.AI) as AIComponent | undefined;
    if (!existingAi) {
      const firstProfile = Object.keys(state.campaign.ai)[0] ?? 'aggressive';
      state = addComponent(state, guardId, { type: ComponentType.AI, profileId: firstProfile, aggroRadius: 8 });
    }

    const soundRes = emitSoundEvent(state, 5, 6, SOUND_DB_DOOR_KICK, playerId, { cueLabel: 'a door splintering' });
    state = soundRes.state;
    expect(soundRes.heardByEntityIds).toContain(guardId);

    const guardAi = getComponent(state, guardId, ComponentType.AI) as AIComponent;
    expect(guardAi.alertnessState).toBe('alerted');
    expect(guardAi.lastHeardPos).toEqual({ x: 5, y: 6 });

    // Put guard outside aggroRadius (shrink aggroRadius to 1) so AI uses acoustic investigation fallback
    state = addComponent(state, guardId, { ...guardAi, aggroRadius: 1 });
    const aiTurn = processAITurn(state, guardId);
    expect(aiTurn.intent?.type).toBe(IntentType.Move);
    if (aiTurn.intent?.type === IntentType.Move) {
      expect(aiTurn.intent.dx).toBe(-1); // Moves west toward (5, 6)
    }

    // Directional cue for player when unseen actor makes loud noise outside FOV
    state = {
      ...state,
      map: {
        ...state.map,
        tiles: state.map.tiles.map((t) => ({ ...t, visible: false }))
      }
    };
    const unseenSound = emitSoundEvent(state, 10, 6, SOUND_DB_COMBAT, guardId, { cueLabel: 'clashing steel' });
    expect(unseenSound.state.messages.some((m) => m.text.includes('You hear clashing steel to the east.'))).toBe(true);

    // Alertness decays cleanly back to unaware
    let decayedState = addComponent(unseenSound.state, guardId, {
      ...guardAi,
      alertnessState: 'suspicious',
      alertnessDecayTurns: 1
    });
    decayedState = tickAIAlertnessDecay(decayedState, guardId);
    expect((getComponent(decayedState, guardId, ComponentType.AI) as AIComponent).alertnessState).toBe('unaware');
  });

  test('2. Dynamic LightEmitterComponent supports radial torches, directional bullseye cones, ignite/refuel, fuel drain, and NPC symmetry', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const baseState = buildGameState(campaign);
    const { floorId, wallId } = getFloorAndWallTileIds(baseState);
    let state = clearOpenRoom(baseState, floorId, 2, 2, 20, 14);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 5, y: 6, facing: 'east' });

    // Darkness ambient baseline
    expect(resolveTileLightReading(state, 8, 6, 'darkness').level).toBe('darkness');

    // Give player a bullseye lantern (60-ft cone east) and try igniting without flint_and_steel
    const [s1, lanternId] = addItemToActorInventory(state, playerId, 'bullseye_lantern');
    state = s1;
    const failedIgnite = igniteLightEmitter(state, playerId, lanternId);
    expect(failedIgnite.success).toBe(false);

    // Add flint_and_steel and ignite via ApplyIntent('ignite')
    const [s2, flintId] = addItemToActorInventory(state, playerId, 'flint_and_steel');
    state = s2;
    const ignited = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'ignite',
      target: { type: 'item', itemEntityId: lanternId },
      toolEntityId: flintId
    });
    expect(ignited.success).toBe(true);
    state = ignited.state;

    // Cone illuminates east (8, 6), NOT west behind carrier (3, 6)
    expect(isPointWithinEmitterCone(5, 6, 8, 6, 'east', 60)).toBe(true);
    expect(isPointWithinEmitterCone(5, 6, 3, 6, 'east', 60)).toBe(false);
    expect(resolveTileLightReading(state, 8, 6, 'darkness').level).toBe('bright');
    expect(resolveTileLightReading(state, 3, 6, 'darkness').level).toBe('darkness');

    // Solid wall blocks dynamic light beam
    state = setMapTileAt(state, 7, 6, wallId);
    expect(evaluateDynamicLightAtTile(state, 9, 6)).toBe('darkness');

    // Fuel drain burns out when reaching 0, and dip with oil_flask refuels it
    const curEmitter = getComponent(state, lanternId, ComponentType.LightEmitter) as LightEmitterComponent;
    state = addComponent(state, lanternId, { ...curEmitter, fuelTurns: 1 });
    state = processActorLightEmittersTick(state, playerId);
    const burnedOut = getComponent(state, lanternId, ComponentType.LightEmitter) as LightEmitterComponent;
    expect(burnedOut.fuelTurns).toBe(0);
    expect(burnedOut.isLit).toBe(false);

    const [s3, oilId] = addItemToActorInventory(state, playerId, 'oil_flask');
    state = s3;
    const refueled = refuelLightEmitter(state, playerId, lanternId, oilId);
    expect(refueled.success).toBe(true);
    state = refueled.state;
    expect((getComponent(state, lanternId, ComponentType.LightEmitter) as LightEmitterComponent).fuelTurns).toBe(3600);

    // Symmetry: an NPC guard carrying a lit torch illuminates tiles around the guard
    const enemyTemplateId = Object.keys(state.campaign.entities).find((id) => state.campaign.entities[id]?.factionId === 'monsters') ??
      Object.keys(state.campaign.entities).find((id) => state.campaign.entities[id]?.factionId !== 'player')!;
    const [s4, guardId] = spawnEntity(state, enemyTemplateId, 15, 6);
    const [s5, torchId] = addItemToActorInventory(s4, guardId, 'torch');
    state = addComponent(s5, torchId, {
      type: ComponentType.LightEmitter,
      radiusFt: 20,
      shadowyRadiusFt: 40,
      fuelTurns: 600,
      maxFuelTurns: 600,
      isLit: true
    });
    expect(resolveTileLightReading(state, 17, 6, 'darkness').level).toBe('bright');
  });

  test('3. Manual Stealth defaults to half-speed (+ Fast Stealth toggle), obeys 6s round cadence, and breaks instantly WITHOUT auto-pause', () => {
    resetAutoPauseTracking();
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const baseState = buildGameState(campaign);
    const { floorId } = getFloorAndWallTileIds(baseState);
    let state = clearOpenRoom(baseState, floorId, 2, 2, 16, 12);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 5, y: 5 });

    const normalSpeedFt = computeActorTacticalLandSpeedFt(state, playerId, 30);
    expect(normalSpeedFt).toBeGreaterThanOrEqual(15);
    const expectedHalfSpeedFt = Math.max(5, Math.floor(normalSpeedFt / 2 / 5) * 5);

    // Enter Stealth manually (unobserved) -> half speed by default
    const entered = toggleActorStealth(state, playerId, { forcedHideD20: 15, forcedMoveSilentlyD20: 15 });
    expect(entered.isStealthed).toBe(true);
    state = entered.state;
    expect(isActorStealthed(state, playerId)).toBe(true);
    expect(isActorHalfSpeedStealthing(state, playerId)).toBe(true);
    expect(computeActorTacticalLandSpeedFt(state, playerId, 30)).toBe(expectedHalfSpeedFt);

    // Toggle Fast Stealth -> full speed restored
    state = toggleActorFastStealth(state, playerId, true);
    expect(isActorHalfSpeedStealthing(state, playerId)).toBe(false);
    expect(computeActorTacticalLandSpeedFt(state, playerId, 30)).toBe(normalSpeedFt);

    // 6-second round cadence prevents repeated mid-round rolls ("no death by a thousand rolls")
    const midRound = evaluateStealthDetection(state, playerId, 'round_cadence');
    expect(midRound.skippedDueToCadence).toBe(true);
    expect(midRound.broken).toBe(false);

    // Instant break without auto-pause
    const beforeBreak = state;
    const afterBreak = breakActorStealth(state, playerId, 'attacked');
    expect(isActorStealthed(afterBreak, playerId)).toBe(false);
    const autoPauseCheck = detectAutoPauseSignals(beforeBreak, afterBreak, DEFAULT_AUTO_PAUSE_SETTINGS);
    expect(autoPauseCheck.reason).toBeUndefined();

    // 1-round re-stealth cooldown enforced immediately after break, lifted on next round
    expect(canActorEnterStealth(afterBreak, playerId).allowed).toBe(false);
    const nextRoundState = { ...afterBreak, globalTurn: (afterBreak.globalTurn ?? 0) + 1 };
    expect(canActorEnterStealth(nextRoundState, playerId).allowed).toBe(true);
  });

  test('4. Sensory counters (Darkvision, Scent, Tremorsense) and flour_pouch counter-invisibility dust (50% -> 20% miss chance)', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const baseState = buildGameState(campaign);
    const { floorId } = getFloorAndWallTileIds(baseState);
    let state = clearOpenRoom(baseState, floorId, 2, 2, 16, 12);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 5, y: 5 });

    // Move any pre-spawned map monsters behind walls / far away so player enters Stealth unobserved
    for (const eid of state.entities) {
      if (eid === playerId) continue;
      if (getComponent(state, eid, ComponentType.Fighter) !== undefined) {
        state = addComponent(state, eid, { type: ComponentType.Position, x: 0, y: 0 });
      }
    }

    // Enter Stealth while unobserved
    const stealthRes = toggleActorStealth(state, playerId, { forcedHideD20: 18, forcedMoveSilentlyD20: 18 });
    expect(stealthRes.isStealthed).toBe(true);
    state = stealthRes.state;

    // Spawn hostile creature with Tremorsense 60 ft at (8, 5)
    const enemyTemplateId =
      Object.keys(state.campaign.entities).find((id) => {
        const def = state.campaign.entities[id];
        return id !== 'player' && def !== undefined && def.faction !== 'player' && def.fighter !== undefined;
      }) ?? Object.keys(state.campaign.entities).find((id) => id !== 'player')!;
    const [afterEnemy, hunterId] = spawnEntity(state, enemyTemplateId, 8, 5);
    state = addComponent(afterEnemy, hunterId, { type: ComponentType.Attitude, attitude: 'hostile' });
    if (getComponent(state, hunterId, ComponentType.Fighter) === undefined) {
      state = addComponent(state, hunterId, {
        type: ComponentType.Fighter,
        hp: 20,
        maxHp: 20,
        attack: 4,
        defense: 2,
        xp: 0,
        level: 1,
        xpGiven: 50
      });
    }
    const hunterDnd = getDnD35EntityData(state, hunterId);
    state = setDnD35EntityData(state, hunterId, {
      ...hunterDnd,
      senses: {
        lowLightVision: false,
        darkvisionRangeFt: 60,
        blindsenseRangeFt: 0,
        blindsightRangeFt: 0,
        tremorsenseRangeFt: 60,
        scentRangeFt: 30
      }
    });

    // Advance 1 round so cadence check executes -> Tremorsense immediately detects grounded stealthed player
    state = { ...state, globalTurn: (state.globalTurn ?? 0) + 1 };
    const detected = evaluateStealthDetection(state, playerId, 'round_cadence');
    expect(detected.broken).toBe(true);
    expect(detected.reason).toBe('tremorsense');
    state = detected.state;

    // Invisible target normally has 50% Total Concealment miss chance; flour_pouch dust cuts it to 20% and blocks Hide
    const baseInvisible = evaluateConcealmentAndSenses(
      'bright',
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      {
        lowLightVision: false,
        darkvisionRangeFt: 0,
        blindsenseRangeFt: 0,
        blindsightRangeFt: 0,
        tremorsenseRangeFt: 0,
        scentRangeFt: 0
      },
      { targetInvisible: true }
    );
    expect(baseInvisible.missChancePercent).toBe(50);

    const dustRes = applyFlourPouchDust(state, playerId, 8, 5);
    state = dustRes.state;
    expect(dustRes.dustedEntityIds).toContain(hunterId);
    expect(isActorDusted(state, hunterId)).toBe(true);
    expect(canActorEnterStealth(state, hunterId).allowed).toBe(false);

    const dustedInvisible = evaluateConcealmentAndSenses(
      'bright',
      { x: 5, y: 5 },
      { x: 6, y: 5 },
      {
        lowLightVision: false,
        darkvisionRangeFt: 0,
        blindsenseRangeFt: 0,
        blindsightRangeFt: 0,
        tremorsenseRangeFt: 0,
        scentRangeFt: 0
      },
      { targetInvisible: true, targetDusted: true }
    );
    expect(dustedInvisible.missChancePercent).toBe(20);
    expect(dustedInvisible.visible).toBe(true);
    expect(DUSTED_STATUS_ID).toBe('dusted');

    // Turn start cleanly runs without errors when dusted & lit emitters are active
    const ticked = runActorTurnStart(state, playerId);
    expect(ticked).toBeDefined();
  });
});
