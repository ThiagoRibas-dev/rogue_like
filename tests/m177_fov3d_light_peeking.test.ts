import { describe, expect, it } from 'bun:test';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { addComponent, getComponent, spawnEntity, spawnItem, updateSpatialIndex } from '../src/core/ecs.ts';
import { setHoveredTile } from '../src/core/hover_state.ts';
import { computeFOV } from '../src/map/fov.ts';
import { has3DLineOfSight } from '../src/map/fov_3d.ts';
import { setTileIdAt, toMapTileKey } from '../src/map/map_accessor.ts';
import { buildInspectTooltip } from '../src/rendering/inspect_tooltip.ts';
import { buildTacticalViewportData } from '../src/rendering/tactical_snapshot.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import { evaluateDynamicLightAtTile } from '../src/systems/light_emitter.system.ts';
import { processProjectileThrow } from '../src/systems/projectile.system.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildWatchtowerState(campaign: CampaignData): GameState {
  return buildGameState({
    ...campaign,
    rules: {
      ...campaign.rules,
      map: {
        ...campaign.rules.map,
        startingAreaId: 'watchtower_overlook'
      }
    }
  });
}

describe('Milestone 177: 3D FOV, Vertical Lighting, Camera Peeking & Multi-Z Renderer', () => {
  it('allows 3D line of sight downward over open_air parapet while blocking through solid opaque ceiling', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = buildWatchtowerState(campaign);

    // From upper lookout (9, 4, 1) looking down over open_air edge into ground courtyard (9, 5, 0)
    expect(has3DLineOfSight(state, 9, 4, 1, 9, 5, 0)).toBe(true);

    // Compute 3D FOV from balcony (9, 4, 1): ground tile (9, 5, 0) should be visible!
    const fov = computeFOV(state, 9, 4, 6, 1);
    expect(fov.has(toMapTileKey(state.map, 9, 5, 0))).toBe(true);

    // Solid stone_floor covers cellar (4, 2, -1) beneath ground stone_floor (4, 2, 0) -> LoS blocked vertically
    expect(has3DLineOfSight(state, 3, 1, 1, 4, 2, -1)).toBe(false);
  });

  it('propagates dynamic light emitters across open Z strata and respects floor occlusion', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildWatchtowerState(campaign);

    const [s1, torchHolderId] = spawnEntity(state, 'goblin', 3, 2, undefined, undefined, 1);
    state = addComponent(s1, torchHolderId, {
      type: ComponentType.LightEmitter,
      radiusFt: 20,
      shadowyRadiusFt: 40,
      isLit: true,
      burnsFuel: false,
      fuelMinutesRemaining: 60,
      maxFuelMinutes: 60
    });
    state = updateSpatialIndex(state, torchHolderId);

    // Ground courtyard directly below open_air receives bright light from elevated emitter
    expect(evaluateDynamicLightAtTile(state, 3, 2, 0)).toBe('bright');

    // Underground cellar tile behind solid stone_floor (4, 2, 0) stays in darkness
    expect(evaluateDynamicLightAtTile(state, 4, 2, -1)).toBe('darkness');
  });

  it('supports camera Z-peeking intents (< / PageUp / Home) and depth-dims lower floors in ViewportSnapshot', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildWatchtowerState(campaign);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, {
      type: ComponentType.Position,
      x: 9,
      y: 4,
      z: 1
    });
    state = updateSpatialIndex(state, playerId);
    state = {
      ...state,
      map: { ...state.map, isFullyExplored: true },
      cachedFov: computeFOV(state, 9, 4, 8, 1)
    };

    // Snapshotting from z=1 sees open_air courtyard on z=1 fall through to depthOffset=1 ground cell on z=0
    const snap = buildViewportSnapshot(state, 13, 9);
    const courtyardCell = snap.cells.find((c) => (c.z ?? 0) === 0 && (c.depthOffset ?? 0) === 1);
    expect(courtyardCell).toBeDefined();
    expect(courtyardCell?.depthOffset).toBe(1);

    // Adjust camera peek downward (free immediate action -> success: false) and reset cleanly
    const downRes = dispatchAction(state, {
      type: IntentType.AdjustCameraZ,
      entityId: playerId,
      dz: -1,
      isImmediate: true
    });
    expect(downRes.success).toBe(false);
    expect(downRes.state.cameraZOffset).toBe(-1);

    const resetRes = dispatchAction(downRes.state, {
      type: IntentType.AdjustCameraZ,
      entityId: playerId,
      dz: 0,
      reset: true,
      isImmediate: true
    });
    expect(resetRes.success).toBe(false);
    expect(resetRes.state.cameraZOffset).toBe(0);

    // Sanity check sealing an opening with solid stone_floor blocks vertical LoS downward
    const sealed = setTileIdAt(state.map, 9, 5, 'stone_floor', 1);
    expect(has3DLineOfSight({ ...state, map: sealed }, 9, 4, 1, 9, 5, 0)).toBe(false);
  });

  it('aligns mouse hover inspect Z with active viewZ, hides occluded Z=-1 HP badges, and throws 3D projectiles across open_air', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildWatchtowerState(campaign);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    state = addComponent(state, playerId, {
      type: ComponentType.Position,
      x: 9,
      y: 4,
      z: 1
    });
    const [sHidden, hiddenEnemyId] = spawnEntity(state, 'goblin', 4, 2, undefined, undefined, -1);
    state = {
      ...updateSpatialIndex(sHidden, playerId),
      map: { ...sHidden.map, isFullyExplored: true },
      cachedFov: computeFOV(sHidden, 9, 4, 8, 1)
    };

    // Mouse hover over empty tile (10, 4) while player is at (9, 4, 1) inspects z=1 (not z=0!)
    setHoveredTile({ x: 10, y: 4 });
    try {
      const tipSameZ = buildInspectTooltip(state, 3, 0, 13, 9);
      expect(tipSameZ.sections.some((s) => s.value.includes('(Z:1)'))).toBe(true);

      // Mouse hover over (9, 4) (player's z=1 tile) inspects the player on z=1 rather than ground z=0 stone floor
      setHoveredTile({ x: 9, y: 4 });
      const tipPlayerZ1 = buildInspectTooltip(state, 3, 0, 13, 9);
      expect(tipPlayerZ1.sections.some((s) => s.value.includes('Adventurer'))).toBe(true);

      // Mouse hover over open_air courtyard (5, 2) drills down to visible z=0 ground tile
      setHoveredTile({ x: 5, y: 2 });
      const tipOpenAir = buildInspectTooltip(state, 3, 0, 13, 9);
      expect(tipOpenAir.sections.some((s) => s.value.includes('(Z:0)'))).toBe(true);
    } finally {
      setHoveredTile(null);
    }

    // Tactical overlay must NOT show enemy HP bar on z=-1 beneath solid z=0 floor even when z=1 is open_air
    const tac = buildTacticalViewportData(state, 0, 0, 13, 9, state.cachedFov);
    const leakedBadge = tac.unitBadges.find((b) => b.vx === 4 && b.vy === 2);
    expect(leakedBadge).toBeUndefined();
    expect(hiddenEnemyId).toBeGreaterThan(0);

    // 3D thrown projectile from rooftop (9, 4, 1) over open_air down onto target (9, 5, 0) hits cleanly!
    const [sLowTarget, lowGoblinId] = spawnEntity(state, 'goblin', 9, 5, undefined, undefined, 0);
    const [sStone, stoneId] = spawnEntity(sLowTarget, 'goblin', 9, 4, undefined, undefined, 1);
    // Spawn a throwing knife inside player's inventory
    const [sItem, knifeId] = spawnItem(sStone, 'throwing_knife', 0, 0);
    void stoneId;
    let throwState = addComponent(sItem, playerId, {
      type: ComponentType.Inventory,
      items: [knifeId],
      capacity: 10
    });
    const throwRes = processProjectileThrow(throwState, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'throw',
      toolEntityId: knifeId,
      target: { type: 'entity', entityId: lowGoblinId }
    });
    expect(throwRes.success).toBe(true);
    const dmg = getComponent(throwRes.state, lowGoblinId, ComponentType.Damage);
    expect(dmg?.instances.length).toBe(1);
    const knifePos = getComponent(throwRes.state, knifeId, ComponentType.Position);
    expect(knifePos?.x).toBe(9);
    expect(knifePos?.y).toBe(5);
    expect(knifePos?.z ?? 0).toBe(0);
  });
});
