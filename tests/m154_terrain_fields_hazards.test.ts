import { describe, expect, test } from 'bun:test';
import { addComponent, getComponent, queryEntities, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import {
  applyAndConsumeWeaponCoatingOnHit,
  resolveCaltropsStepHazard,
  resolveCraftAlchemyPotionIdentification,
  resolveDipWeaponCoating,
  resolveSlipperyFloorStepHazard
} from '../src/rulesets/dnd35e/combat/floor_hazard_resolver.ts';
import {
  evaluateActorTileHazardOccupation,
  extinguishActorFireInWater,
  getShallowWaterStealthAndTumblePenalty,
  resolveDeepWaterSwimCheck,
  resolveGapJumpTraversal,
  resolvePitClimbTraversal,
  resolveRigCrossingWithGear
} from '../src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { processActorBreathTick } from '../src/systems/breath.system.ts';
import { destroyCrossingEntity, queryCrossingAtPosition, spawnCrossingEntity } from '../src/systems/crossing.system.ts';
import { queryActiveFieldsAtPosition, spawnField } from '../src/systems/field.system.ts';
import { createInteractionChain, resolveInteractionOriginator } from '../src/systems/interaction_provenance.system.ts';
import { processEquipItemIntent } from '../src/systems/inventory/equipment_slots.ts';
import { runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import { canTraverseTile, processMoveIntent } from '../src/systems/movement.system.ts';
import { evaluateTileTraversal } from '../src/systems/movement_displacement.ts';
import { applyStatusEffect } from '../src/systems/status-effect.system.ts';
import {
  type BreathComponent,
  type CoatingComponent,
  ComponentType,
  type DamageComponent,
  type EquipmentComponent,
  type InventoryComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function setMapTileAt(state: GameState, x: number, y: number, tileId: string): GameState {
  const idx = coordToIndex(x, y, state.map.width);
  const nextTiles = state.map.tiles.map((t, i) => (i === idx ? { ...t, tileId } : t));
  return {
    ...state,
    map: {
      ...state.map,
      tiles: nextTiles
    }
  };
}

describe('Milestone 154: Universal Terrain Traversal, Crossing Entities, Elemental Field Chemistry & Weapon Coatings', () => {
  const sharedCampaign = loadCampaignFromDisk('dnd35e-crypt');

  test('1. World-owned CrossingComponent overrides deep_water/pit passability symmetrically and drops occupants on collapse', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const pitX = playerPos.x + 1;
    const pitY = playerPos.y;

    state = {
      ...state,
      campaign: {
        ...state.campaign,
        tiles: {
          ...state.campaign.tiles,
          pit_trap_hole: {
            id: 'pit_trap_hole',
            name: 'Open Pit',
            glyph: 'O',
            fg: '#111111',
            bg: '#000000',
            walkable: false,
            blocksSight: false,
            tags: ['pit'],
            requiredMovementModes: ['fly']
          }
        }
      }
    };
    state = setMapTileAt(state, pitX, pitY, 'pit_trap_hole');

    const pitTileDef = state.campaign.tiles['pit_trap_hole']!;
    // Without a crossing, land walker cannot traverse pit tile
    expect(canTraverseTile(pitTileDef, { walk: 30 }, state, pitX, pitY)).toBe(false);

    // Spawn a world-owned ladder_span crossing at (pitX, pitY)
    let crossingId: EntityId;
    [state, crossingId] = spawnCrossingEntity({
      state,
      x: pitX,
      y: pitY,
      crossingKind: 'ladder_span'
    });

    expect(queryCrossingAtPosition(state, pitX, pitY)?.crossing.crossingKind).toBe('ladder_span');
    // Now both player and any AI monster can traverse (pitX, pitY) via the world-owned crossing!
    expect(canTraverseTile(pitTileDef, { walk: 30 }, state, pitX, pitY)).toBe(true);
    const evalRes = evaluateTileTraversal(pitTileDef, { walk: 30 }, state, pitX, pitY);
    expect(evalRes.passability).toBe('difficult');

    // Place a non-flying monster directly on the crossing, then collapse the crossing
    let goblinId: EntityId;
    [state, goblinId] = spawnEntity(state, 'skeleton', pitX, pitY);
    state = destroyCrossingEntity(state, crossingId);

    expect(queryCrossingAtPosition(state, pitX, pitY)).toBeUndefined();
    const goblinData = getDnD35EntityData(state, goblinId);
    expect(goblinData.conditions).toContain('prone');
    const goblinDmg = getComponent(state, goblinId, ComponentType.Damage) as DamageComponent | undefined;
    expect((goblinDmg?.instances.length ?? 0) > 0).toBe(true);
  });

  test('2. Shallow water extinguishes non-magical fire, costs 2x movement, and imposes -2 Move Silently / Tumble', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    state = {
      ...state,
      campaign: {
        ...state.campaign,
        tiles: {
          ...state.campaign.tiles,
          shallow_pool: {
            id: 'shallow_pool',
            name: 'Shallow Pool',
            glyph: '~',
            fg: '#3498db',
            bg: '#1b4f72',
            walkable: true,
            blocksSight: false,
            tags: ['shallow_water', 'water']
          }
        },
        status: {
          ...state.campaign.status,
          burning: {
            id: 'burning',
            name: 'Burning',
            duration: 3,
            effects: []
          }
        }
      }
    };
    state = setMapTileAt(state, playerPos.x, playerPos.y, 'shallow_pool');

    const shallowTile = state.campaign.tiles['shallow_pool']!;
    const traversal = evaluateTileTraversal(shallowTile, { walk: 30 }, state, playerPos.x, playerPos.y);
    expect(traversal.passability).toBe('difficult');
    expect(traversal.moveCostMultiplier).toBe(2);

    expect(getShallowWaterStealthAndTumblePenalty(state, playerId)).toBe(-2);

    state = applyStatusEffect(state, playerId, 'burning', 3, playerId);
    const beforeStatus = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent;
    expect(beforeStatus.activeEffects.some((e) => e.effectId === 'burning')).toBe(true);

    state = extinguishActorFireInWater(state, playerId);
    const afterStatus = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
    expect(afterStatus?.activeEffects.some((e) => e.effectId === 'burning') ?? false).toBe(false);
  });

  test('3. Deep water Swim check applies 2x live M150 ACP, sinks on failure, ticks BreathComponent to drowning, and exempts undead', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // Give the player heavy armor so live ACP is negative (-6 for full_plate)
    let plateId: EntityId;
    [state, plateId] = spawnItem(state, 'full_plate', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    const plateIdx = inv.items.length;
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, plateId]
    });
    state = processEquipItemIntent(state, playerId, plateIdx).state;

    // Fail Swim check (forced d20 = 2 vs DC 10 with 2x ACP penalty)
    const swimFail = resolveDeepWaterSwimCheck(state, playerId, {
      isRoughWater: false,
      forcedD20: 2
    });
    state = swimFail.state;
    expect(swimFail.success).toBe(false);
    expect(swimFail.sank).toBe(true);
    expect(swimFail.totalRoll).toBeLessThan(swimFail.dc);

    const breathComp = getComponent(state, playerId, ComponentType.Breath) as BreathComponent | undefined;
    expect(breathComp?.isSubmerged).toBe(true);

    // Set remainingTurns to 1 and tick BreathComponent -> queues lethal drowning damage at 0
    state = addComponent(state, playerId, {
      ...breathComp!,
      remainingTurns: 1
    });
    state = processActorBreathTick(state, playerId);
    const drownDmg = getComponent(state, playerId, ComponentType.Damage) as DamageComponent | undefined;
    expect(drownDmg?.instances.some((d) => d.tags.includes('drowning')) ?? false).toBe(true);

    // Undead monster is immune to drowning
    let skeletonId: EntityId;
    [state, skeletonId] = spawnEntity(state, 'skeleton', playerPos.x + 1, playerPos.y);
    const skelData = getDnD35EntityData(state, skeletonId);
    state = setDnD35EntityData(state, skeletonId, {
      ...skelData,
      creatureType: 'undead'
    });
    const skelSwim = resolveDeepWaterSwimCheck(state, skeletonId, {
      isRoughWater: false,
      forcedD20: 1
    });
    const skelBreath = getComponent(skelSwim.state, skeletonId, ComponentType.Breath) as BreathComponent | undefined;
    expect(skelBreath).toBeUndefined();
  });

  test('4. Gap Jump (running vs standing + Reflex DC 15 ledge catch), Pit Climb (+2 climbers_kit), and Use Rope / Ladder rigging', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const gapX = playerPos.x + 1;
    const gapY = playerPos.y;
    const landX = playerPos.x + 2;
    const landY = playerPos.y;

    // Standing jump across 5-ft gap has DC 10 (5 * 2); failing Jump AND failing Reflex DC 15 drops actor into pit
    const failedJump = resolveGapJumpTraversal({
      state,
      entityId: playerId,
      pitX: gapX,
      pitY: gapY,
      landingX: landX,
      landingY: landY,
      hasRunningStart: false,
      forcedJumpD20: 1,
      forcedReflexD20: 1
    });
    expect(failedJump.success).toBe(false);
    expect(failedJump.caughtLedge).toBe(false);
    expect(failedJump.fellInPit).toBe(true);
    expect(failedJump.dc).toBe(10);
    expect(getDnD35EntityData(failedJump.state, playerId).conditions).toContain('prone');

    // Equip climber's kit in inventory -> grants +2 circumstance bonus on Climb DC 15
    let kitId: EntityId;
    [state, kitId] = spawnItem(state, 'climbers_kit', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, kitId]
    });

    const climbRes = resolvePitClimbTraversal({
      state,
      entityId: playerId,
      targetX: gapX,
      targetY: gapY,
      forcedD20: 14
    });
    expect(climbRes.success).toBe(true);

    // Add silk_rope + grappling_hook and rig a world-owned rope_line crossing over a pit tile
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        tiles: {
          ...state.campaign.tiles,
          pit_trap_hole: {
            id: 'pit_trap_hole',
            name: 'Open Pit',
            glyph: 'O',
            fg: '#111111',
            bg: '#000000',
            walkable: false,
            blocksSight: false,
            tags: ['pit'],
            requiredMovementModes: ['fly']
          }
        }
      }
    };
    state = setMapTileAt(state, gapX, gapY, 'pit_trap_hole');
    let ropeId: EntityId;
    let hookId: EntityId;
    [state, ropeId] = spawnItem(state, 'silk_rope', playerPos.x, playerPos.y);
    [state, hookId] = spawnItem(state, 'grappling_hook', playerPos.x, playerPos.y);
    const inv2 = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, {
      ...inv2,
      items: [...inv2.items, ropeId, hookId]
    });

    const rigRes = resolveRigCrossingWithGear({
      state,
      entityId: playerId,
      targetX: gapX,
      targetY: gapY,
      forcedD20: 10
    });
    expect(rigRes.success).toBe(true);
    expect(queryCrossingAtPosition(rigRes.state, gapX, gapY)?.crossing.crossingKind).toBe('rope_line');
  });

  test('5. Tag-driven FieldInteractionRule chemistry: oil+fire chain ignition, water+cold frozen_surface & fire melt, water+electricity shock, fire+water steam_cloud', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const x0 = playerPos.x + 1;
    const y0 = playerPos.y;
    const x1 = playerPos.x + 2;
    const y1 = playerPos.y;

    // 5a. Spawn oil at (x0, y0) and adjacent (x1, y1), then ignite (x0, y0) with fire -> both tiles ignite into fire!
    [state] = spawnField(state, 'oil', x0, y0, 1, 10);
    [state] = spawnField(state, 'oil', x1, y1, 1, 10);
    [state] = spawnField(state, 'fire', x0, y0, 1, 5);

    const fieldsAt0 = queryActiveFieldsAtPosition(state, x0, y0);
    const fieldsAt1 = queryActiveFieldsAtPosition(state, x1, y1);
    expect(fieldsAt0.some((f) => f.field.fieldType === 'fire')).toBe(true);
    expect(fieldsAt1.some((f) => f.field.fieldType === 'fire')).toBe(true);
    expect(fieldsAt1.some((f) => f.field.fieldType === 'oil')).toBe(false);

    // 5b. Water + Cold spawns a frozen_surface CrossingComponent; Fire melts it!
    const wx = playerPos.x;
    const wy = playerPos.y + 1;
    [state] = spawnField(state, 'water', wx, wy, 1, 10);
    [state] = spawnField(state, 'cold', wx, wy, 1, 5);
    expect(queryCrossingAtPosition(state, wx, wy)?.crossing.crossingKind).toBe('frozen_surface');

    [state] = spawnField(state, 'fire', wx, wy, 1, 5);
    expect(queryCrossingAtPosition(state, wx, wy)).toBeUndefined();

    // 5c. Fire + Water produces a sight-blocking steam_cloud
    const sx = playerPos.x;
    const sy = playerPos.y - 1;
    [state] = spawnField(state, 'fire', sx, sy, 1, 5);
    [state] = spawnField(state, 'water', sx, sy, 1, 5);
    const steamFields = queryActiveFieldsAtPosition(state, sx, sy);
    expect(steamFields.some((f) => f.field.fieldType === 'steam_cloud')).toBe(true);
    expect(state.campaign.fields['steam_cloud']?.blocksSight).toBe(true);

    // 5d. Water + Electricity conducts shock damage to occupant on connected water tile
    let goblinId: EntityId;
    const ex = playerPos.x + 1;
    const ey = playerPos.y + 1;
    [state, goblinId] = spawnEntity(state, 'skeleton', ex, ey);
    [state] = spawnField(state, 'water', ex, ey, 1, 10);
    [state] = spawnField(state, 'electricity', ex, ey, 1, 3);
    const gobDmg = getComponent(state, goblinId, ComponentType.Damage) as DamageComponent | undefined;
    expect(gobDmg?.instances.some((d) => d.tags.includes('electricity')) ?? false).toBe(true);
  });

  test('6. Weapon dipping (oil_flask, holy_water, poison with 5% natural-1 mishap unless Poison Use) and on-hit coating charge consumption', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    let swordId: EntityId;
    let poisonVialId: EntityId;
    let holyWaterId: EntityId;
    [state, swordId] = spawnItem(state, 'longsword', playerPos.x, playerPos.y);
    [state, poisonVialId] = spawnItem(state, 'antitoxin', playerPos.x, playerPos.y);
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        items: {
          ...state.campaign.items,
          antitoxin: {
            ...(state.campaign.items['antitoxin'] ?? {
              id: 'antitoxin',
              name: 'Shadow Venom Vial',
              description: 'Injury poison',
              glyph: '!',
              fg: '#2ecc71',
              category: 'consumable'
            }),
            tags: ['poison']
          }
        }
      }
    };
    [state, holyWaterId] = spawnItem(state, 'holy_water', playerPos.x, playerPos.y);

    // Equip the longsword
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    const swordIdx = inv.items.length;
    state = addComponent(state, playerId, {
      ...inv,
      items: [...inv.items, swordId, poisonVialId, holyWaterId]
    });
    state = processEquipItemIntent(state, playerId, swordIdx).state;

    // Without feature:poison_use, a natural 1 causes self-poisoning mishap
    const mishapRes = resolveDipWeaponCoating({
      state,
      actorId: playerId,
      targetItemEntityId: swordId,
      coatingSourceEntityId: poisonVialId,
      forcedMishapD20: 1
    });
    expect(mishapRes.success).toBe(false);
    expect(mishapRes.poisonMishap).toBe(true);

    // With feature:poison_use (e.g. Assassin), natural 1 does NOT cause mishap
    const pData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...pData,
      activeClassFeatures: [...(pData.activeClassFeatures ?? []), 'poison_use']
    });
    const safePoisonRes = resolveDipWeaponCoating({
      state,
      actorId: playerId,
      targetItemEntityId: swordId,
      coatingSourceEntityId: poisonVialId,
      forcedMishapD20: 1
    });
    expect(safePoisonRes.success).toBe(true);
    expect(safePoisonRes.poisonMishap).toBe(false);

    // Coat weapon with holy_water and hit an undead target -> deals 2d4 positive bonus damage and consumes charge
    const holyDip = resolveDipWeaponCoating({
      state: safePoisonRes.state,
      actorId: playerId,
      targetItemEntityId: swordId,
      coatingSourceEntityId: holyWaterId
    });
    expect(holyDip.success).toBe(true);
    const coatingBefore = getComponent(holyDip.state, swordId, ComponentType.Coating) as CoatingComponent | undefined;
    expect(coatingBefore?.charges).toBe(1);

    let skeletonId: EntityId;
    [state, skeletonId] = spawnEntity(holyDip.state, 'skeleton', playerPos.x + 1, playerPos.y);
    const hitRes = applyAndConsumeWeaponCoatingOnHit(state, playerId, skeletonId, ['type:undead']);
    expect(hitRes.bonusDamage).toBeGreaterThanOrEqual(2);
    expect(getComponent(hitRes.state, swordId, ComponentType.Coating)).toBeUndefined();
  });

  test('7. Floor step hazards (caltrops 1 dmg + limping, marbles/grease Balance -> prone) and Craft (Alchemy) DC 15 potion identification', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const hx = playerPos.x + 1;
    const hy = playerPos.y;

    state = {
      ...state,
      campaign: {
        ...state.campaign,
        fields: {
          ...state.campaign.fields,
          caltrops: {
            id: 'caltrops',
            name: 'Caltrops',
            glyph: '^',
            fg: '#95a5a6',
            bg: 'transparent',
            blocksSight: false,
            tags: ['caltrops']
          },
          marbles: {
            id: 'marbles',
            name: 'Marbles',
            glyph: ':',
            fg: '#bdc3c7',
            bg: 'transparent',
            blocksSight: false,
            tags: ['marbles']
          }
        },
        status: {
          ...state.campaign.status,
          limping: {
            id: 'limping',
            name: 'Limping (Half Speed)',
            duration: 10,
            effects: []
          }
        }
      }
    };

    [state] = spawnField(state, 'caltrops', hx, hy, 1, 10);
    const caltropStep = resolveCaltropsStepHazard(state, playerId, hx, hy, 18);
    expect(caltropStep.triggered).toBe(true);
    expect(caltropStep.hit).toBe(true);
    const afterCaltropStatus = getComponent(caltropStep.state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent;
    expect(afterCaltropStatus.activeEffects.some((e) => e.effectId === 'limping')).toBe(true);

    const mx = playerPos.x + 2;
    const my = playerPos.y;
    [state] = spawnField(caltropStep.state, 'marbles', mx, my, 1, 10);
    const marbleStep = resolveSlipperyFloorStepHazard(state, playerId, mx, my, 1);
    expect(marbleStep.triggered).toBe(true);
    expect(marbleStep.fellProne).toBe(true);
    expect(getDnD35EntityData(marbleStep.state, playerId).conditions).toContain('prone');

    // Craft (Alchemy) DC 15 identifies an unknown potion/alchemical vial
    let potionId: EntityId;
    [state, potionId] = spawnItem(marbleStep.state, 'antitoxin', playerPos.x, playerPos.y);
    const idRes = resolveCraftAlchemyPotionIdentification(state, playerId, potionId, 18);
    expect(idRes.success).toBe(true);
    expect(idRes.state.identifiedItems.has('antitoxin')).toBe(true);
  });

  test('8. Single pit-entry fall invariant, crossing movement, ladder/rope consumption, single-transaction transmutation, weapon-bound coating, footAC, and InteractionChain provenance', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const pitX = playerPos.x + 1;
    const pitY = playerPos.y;

    state = {
      ...state,
      campaign: {
        ...state.campaign,
        tiles: {
          ...state.campaign.tiles,
          open_pit: {
            id: 'open_pit',
            name: 'Open Pit',
            glyph: 'O',
            fg: '#111111',
            bg: '#000000',
            walkable: false,
            blocksSight: false,
            tags: ['pit'],
            requiredMovementModes: ['fly']
          }
        }
      }
    };
    state = setMapTileAt(state, pitX, pitY, 'open_pit');

    // 1. Single pit-entry fall invariant: entering pit deals fall damage ONCE; subsequent turn start inside pit does NOT re-apply fall damage
    let victimId: EntityId;
    [state, victimId] = spawnEntity(state, 'skeleton', pitX, pitY);
    state = evaluateActorTileHazardOccupation(state, victimId, pitX, pitY, { isTurnStart: false });
    const entryDmgCount = (getComponent(state, victimId, ComponentType.Damage) as DamageComponent | undefined)?.instances.length ?? 0;
    expect(entryDmgCount).toBe(1);
    expect(getDnD35EntityData(state, victimId).conditions).toContain('prone');

    const afterTurnStart = runActorTurnStart(state, victimId);
    const turnStartDmgCount =
      (getComponent(afterTurnStart, victimId, ComponentType.Damage) as DamageComponent | undefined)?.instances.length ?? 0;
    expect(turnStartDmgCount).toBe(0);

    // Clear victim from pit so player can deploy crossing gear and walk onto the crossing via processMoveIntent
    state = addComponent(state, victimId, { type: ComponentType.Position, x: playerPos.x - 2, y: playerPos.y });

    // 2. resolveRigCrossingWithGear consumes ladder_10ft to spawn a ladder_span crossing
    let ladderId: EntityId;
    [state, ladderId] = spawnItem(state, 'ladder_10ft', playerPos.x, playerPos.y);
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, { ...inv, items: [...inv.items, ladderId] });

    const deployLadder = resolveRigCrossingWithGear({
      state,
      entityId: playerId,
      targetX: pitX,
      targetY: pitY
    });
    expect(deployLadder.success).toBe(true);
    state = deployLadder.state;
    expect(queryCrossingAtPosition(state, pitX, pitY)?.crossing.crossingKind).toBe('ladder_span');
    expect((getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent).items).not.toContain(ladderId);

    // 3. processMoveIntent allows walking onto the unwalkable pit tile because a world-owned crossing spans (pitX, pitY)
    const moveOverCrossing = processMoveIntent(state, {
      type: IntentType.Move,
      entityId: playerId,
      dx: 1,
      dy: 0
    });
    expect(moveOverCrossing.success).toBe(true);
    expect(getComponent(moveOverCrossing.state, playerId, ComponentType.Position)).toMatchObject({ x: pitX, y: pitY });

    // 4. Single-transaction fire-on-oil transmutation leaves only the transmuted 'fire' field, never duplicate raw + transmuted
    const fx = playerPos.x;
    const fy = playerPos.y + 2;
    const oilChain = createInteractionChain(playerId, { kind: 'action', actionId: 'deploy_oil', actorId: playerId });
    const fireChain = createInteractionChain(playerId, { kind: 'action', actionId: 'deploy_fire', actorId: playerId });
    [state] = spawnField(state, 'oil', fx, fy, 0, 10, undefined, oilChain);
    [state] = spawnField(state, 'fire', fx, fy, 0, 5, undefined, fireChain);
    const transmutedFields = queryActiveFieldsAtPosition(state, fx, fy);
    expect(transmutedFields.length).toBe(1);
    expect(transmutedFields[0]?.field.fieldType).toBe('fire');
    expect(resolveInteractionOriginator(transmutedFields[0]!.field.interaction!)).toBe(playerId);

    // 5. Weapon-entity-bound coating consumption & multi-hop InteractionChain provenance
    let mainSwordId: EntityId;
    let offDaggerId: EntityId;
    let oilFlaskId: EntityId;
    [state, mainSwordId] = spawnItem(state, 'longsword', playerPos.x, playerPos.y);
    [state, offDaggerId] = spawnItem(state, 'dagger', playerPos.x, playerPos.y);
    [state, oilFlaskId] = spawnItem(state, 'oil_flask', playerPos.x, playerPos.y);
    state = addComponent(state, playerId, {
      type: ComponentType.Equipment,
      slots: [
        { id: 'main_hand', slotType: 'main_hand', equippedItem: mainSwordId },
        { id: 'off_hand', slotType: 'off_hand', equippedItem: offDaggerId }
      ]
    } as EquipmentComponent);

    const dipMain = resolveDipWeaponCoating({
      state,
      actorId: playerId,
      targetItemEntityId: mainSwordId,
      coatingSourceEntityId: oilFlaskId
    });
    expect(dipMain.success).toBe(true);
    state = dipMain.state;
    const mainCoating = getComponent(state, mainSwordId, ComponentType.Coating) as CoatingComponent;
    expect(mainCoating.interaction?.originatorEntityId).toBe(playerId);
    expect(mainCoating.interaction?.frames.some((f) => f.kind === 'item' && f.role === 'consumable')).toBe(true);

    // Striking with the uncoated off-hand dagger must NOT consume the main-hand sword's coating!
    const offHit = applyAndConsumeWeaponCoatingOnHit(state, playerId, victimId, [], offDaggerId);
    expect(offHit.bonusDamage).toBe(0);
    expect(getComponent(offHit.state, mainSwordId, ComponentType.Coating)).toBeDefined();

    // Striking with the coated main-hand sword decrements its 2-charge oil coating to 1, then removes it on the second strike, while threading InteractionChain provenance
    const mainHit1 = applyAndConsumeWeaponCoatingOnHit(offHit.state, playerId, victimId, [], mainSwordId);
    expect(mainHit1.bonusDamage).toBeGreaterThanOrEqual(1);
    expect((getComponent(mainHit1.state, mainSwordId, ComponentType.Coating) as CoatingComponent | undefined)?.charges).toBe(1);
    const mainHit = applyAndConsumeWeaponCoatingOnHit(mainHit1.state, playerId, victimId, [], mainSwordId);
    expect(mainHit.bonusDamage).toBeGreaterThanOrEqual(1);
    expect(getComponent(mainHit.state, mainSwordId, ComponentType.Coating)).toBeUndefined();
    const victimDmg = getComponent(mainHit.state, victimId, ComponentType.Damage) as DamageComponent;
    const coatingDmgInst = victimDmg.instances[victimDmg.instances.length - 1]!;
    expect(coatingDmgInst.interaction?.originatorEntityId).toBe(playerId);
    expect(coatingDmgInst.interaction?.frames.some((f) => f.kind === 'effect' && f.effectKind === 'coating')).toBe(true);

    // 6. Caltrops uses dagResult.acBreakdown.footAC and is bypassed when moving at half speed or slower
    const dag = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(dag.dagResult.acBreakdown.footAC).toBeGreaterThanOrEqual(10);
    const cx = playerPos.x - 1;
    const cy = playerPos.y;
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        fields: {
          ...state.campaign.fields,
          caltrops: {
            id: 'caltrops',
            name: 'Caltrops',
            glyph: '^',
            fg: '#95a5a6',
            bg: 'transparent',
            blocksSight: false,
            tags: ['caltrops']
          }
        }
      }
    };
    [state] = spawnField(state, 'caltrops', cx, cy, 0, 10);
    const halfSpeedBypass = resolveCaltropsStepHazard(state, playerId, cx, cy, 20, { isHalfSpeedOrSlower: true });
    expect(halfSpeedBypass.triggered).toBe(false);
    expect(halfSpeedBypass.hit).toBe(false);
  });
});

