import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent, spawnEntity, spawnItem, updateSpatialIndex } from '../src/core/ecs.ts';
import { validateChargeLine } from '../src/rulesets/dnd35e/combat/charge_resolver.ts';
import { resolveOnDropCleaveFollowup } from '../src/rulesets/dnd35e/combat/combat_exchange_phases.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { resolveCaltropsStepHazard } from '../src/rulesets/dnd35e/combat/floor_hazard_resolver.ts';
import { computeAoEAffectedSquares3D } from '../src/rulesets/dnd35e/magic/aoe_rest.ts';
import { evaluateCover3D } from '../src/rulesets/dnd35e/spatial/cover_senses.ts';
import {
  evaluateDnD35eAltitudeAdjustment,
  evaluateDnD35eElevationCombat,
  HIGH_GROUND_MELEE_ATTACK_BONUS,
  resolveDnD35eFallLanded,
  resolveDnD35eMovementModes
} from '../src/rulesets/dnd35e/spatial/dnd35e_spatial_3d.ts';
import { measureDnD35Distance3DFt } from '../src/rulesets/dnd35e/spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { spawnField } from '../src/systems/field.system.ts';
import { isEntitySupportedAt, resolveGravityForEntity } from '../src/systems/gravity.system.ts';
import { processStatusEffectsTick } from '../src/systems/status-effect.system.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent
} from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildDnD35WatchtowerState(campaign: CampaignData): GameState {
  return buildGameState({
    ...campaign,
    manifest: {
      ...campaign.manifest,
      rulesetId: 'dnd35e'
    },
    rules: {
      ...campaign.rules,
      map: {
        ...campaign.rules.map,
        startingAreaId: 'watchtower_overlook'
      }
    }
  });
}

describe('Milestone 179: Z-Aware RulesetContract Hooks & D&D 3.5e 3D Mechanics', () => {
  const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');
  it('computes 3D D&D 1-2-1-2 diagonal distance, 3D cover edge-grazing, and 3D spherical AoE radii', () => {
    // Straight 2-level drop = 10 ft; 2 horizontal + 2 vertical = 15 ft under 1-2-1-2 symmetry
    expect(measureDnD35Distance3DFt(0, 0, 0, 0, 0, 2)).toBe(10);
    expect(measureDnD35Distance3DFt(0, 0, 0, 2, 0, 2)).toBe(15);

    // 3D cover through solid wall at intermediate voxel returns total cover
    const totalCover = evaluateCover3D(
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 0 },
      (x) => x === 2
    );
    expect(totalCover.coverState).toBe('total');
    expect(totalCover.blocksLineOfEffect).toBe(true);

    // Parapet edge-grazing cover across Z step grants standard cover (+4 AC)
    const parapetCover = evaluateCover3D(
      { x: 0, y: 0, z: 1 },
      { x: 4, y: 0, z: 0 },
      (x, _y, z) => x === 2 && z === 1
    );
    expect(parapetCover.coverState).toBe('standard');

    // Spherical Fireball burst centered at (5, 5, 1) reaches (5, 5, 0) and (5, 5, 2)
    const fireballSquares = computeAoEAffectedSquares3D(
      'burst',
      { x: 5, y: 5, z: 1 },
      { x: 5, y: 5, z: 1 },
      10,
      () => false
    );
    expect(fireballSquares.some((s) => s.x === 5 && s.y === 5 && s.z === 0)).toBe(true);
    expect(fireballSquares.some((s) => s.x === 5 && s.y === 5 && s.z === 2)).toBe(true);
  });

  it('grants +1 High Ground melee bonus and resolves Fly DAG hovering + expiration falling', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildDnD35WatchtowerState(campaign);

    const [s1, highActorId] = spawnEntity(state, 'goblin', 3, 2, undefined, undefined, 1);
    const [s2, lowActorId] = spawnEntity(s1, 'goblin', 3, 2, undefined, undefined, 0);
    state = updateSpatialIndex(s2, lowActorId);

    expect(evaluateDnD35eElevationCombat(state, highActorId, lowActorId).attackBonus).toBe(
      HIGH_GROUND_MELEE_ATTACK_BONUS
    );
    expect(evaluateDnD35eElevationCombat(state, lowActorId, highActorId).attackBonus).toBe(0);

    // Attach Fly status effect granting fly_active/flying while hovering over open_air at (3, 2, 1)
    state = addComponent(state, highActorId, {
      type: ComponentType.StatusEffects,
      activeEffects: [
        {
          effectId: 'fly',
          duration: 1,
          grantedTags: ['fly_active', 'flying']
        }
      ]
    });

    const modesWhileFlying = resolveDnD35eMovementModes(state, highActorId);
    expect(modesWhileFlying?.fly).toBeGreaterThan(0);
    expect(isEntitySupportedAt(state, highActorId, 3, 2, 1)).toBe(true);

    // When Fly expires in status-effect tick, actor loses flight and drops down to z=0!
    state = processStatusEffectsTick(state, highActorId);
    const postPos = getComponent(state, highActorId, ComponentType.Position);
    expect(postPos?.z ?? 0).toBe(0);
  });

  it('applies 1d6 per 10 ft fall damage unless negated by Feather Fall override and allows Climb skill scaling', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildDnD35WatchtowerState(campaign);

    const [s1, victimId] = spawnEntity(state, 'goblin', 3, 2, undefined, undefined, 0);
    state = addComponent(s1, victimId, {
      type: ComponentType.Fighter,
      hp: 30,
      maxHp: 30,
      attack: 4,
      defense: 0
    } satisfies FighterComponent);

    // Fall of 4 levels (20 ft -> 2d6 damage)
    const hurtState = resolveDnD35eFallLanded(state, victimId, 4, 3, 2, 0);
    const dmg = getComponent(hurtState, victimId, ComponentType.Damage) as DamageComponent | undefined;
    expect(dmg?.instances.length).toBe(1);
    expect(dmg!.instances[0]!.amount).toBeGreaterThanOrEqual(2);
    expect(dmg!.instances[0]!.tags).toContain('falling');

    // Fall of 4 levels with Feather Fall active -> 0 damage!
    const ffActor = addComponent(state, victimId, {
      type: ComponentType.StatusEffects,
      activeEffects: [
        {
          effectId: 'feather_fall',
          duration: 3,
          grantedTags: ['feather_fall_active']
        }
      ]
    });
    const safeState = resolveDnD35eFallLanded(ffActor, victimId, 4, 3, 2, 0);
    expect(getComponent(safeState, victimId, ComponentType.Damage)).toBeUndefined();

    // Climb skill auto-pass on high climb rank near a climbable face
    const [s2, climberId] = spawnEntity(state, 'goblin', 8, 4, undefined, undefined, 0);
    const baseData = getDnD35EntityData(s2, climberId);
    const climberState = addComponent(s2, climberId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: {
        ...baseData,
        skillRanks: { ...baseData.skillRanks, climb: 30 }
      }
    });
    const climbRes = evaluateDnD35eAltitudeAdjustment(climberState, climberId, 1, 8, 4, 1);
    expect(climbRes.allowed).toBe(true);

    // Console gravity wrapper check using ruleset hook override cleanly
    const fallFromZ1 = resolveGravityForEntity(
      addComponent(state, victimId, {
        type: ComponentType.Position,
        x: 3,
        y: 2,
        z: 1
      }),
      victimId
    );
    expect(fallFromZ1.fellLevels).toBe(1);
  });

  it('honors DAG ruleOverrides without hardcoded spell tags, scopes fields/caltrops by Z, and enforces Z reach on Charge & Cleave', () => {
    const defaultCampaign = loadCampaignFromDisk('default');
    let state = buildDnD35WatchtowerState(defaultCampaign);

    // Custom campaign item mod emitting ruleOverrides only (no fly_active / feather_fall_active tag strings)
    const customItemId = 'zephyr_boots_mod';
    const watchtowerWithMod: CampaignData = {
      ...state.campaign,
      systemContent: dndCampaign.systemContent,
      items: {
        ...state.campaign.items,
        [customItemId]: {
          id: customItemId,
          name: 'Boots of Zephyr Gliding',
          glyph: ']',
          fg: '#74b9ff',
          bg: 'transparent',
          category: 'armor',
          weight: 1,
          slot: 'foot',
          effectBundle: {
            bundleId: 'zephyr_boots_bundle',
            name: 'Zephyr Gliding',
            category: 'trait',
            usageMode: 'passive',
            modifiers: [],
            ruleOverrides: [
              { id: 'zb_fly', ruleKey: 'can_fly', value: true },
              { id: 'zb_ff', ruleKey: 'immune_falling_damage', value: true }
            ],
            grantedTags: [],
            immunities: [],
            vulnerabilities: [],
            energyResistances: {},
            activatedAbilities: [],
            classSkillsAdded: [],
            grantedFeats: [],
            virtualFeatGrants: []
          }
        }
      }
    };
    state = { ...state, campaign: watchtowerWithMod };

    const [sMod, modActorId] = spawnEntity(state, 'goblin', 3, 2, undefined, undefined, 1);
    const [sBoots, bootsId] = spawnItem(sMod, customItemId, 0, 0);
    const modEquippedState = addComponent(sBoots, modActorId, {
      type: ComponentType.Equipment,
      slots: [{ id: 'foot_1', slotType: 'foot', equippedItem: bootsId }]
    });
    expect(resolveDnD35eMovementModes(modEquippedState, modActorId)?.fly).toBeGreaterThan(0);
    const ffRes = resolveDnD35eFallLanded(modEquippedState, modActorId, 4, 3, 2, 0);
    expect(getComponent(ffRes, modActorId, ComponentType.Damage)).toBeUndefined();

    // Floor hazards & fields spawned on z=1 do NOT trigger on ground actor at z=0, and DO trigger on z=1
    const [sCaltropField] = spawnField(state, 'caltrops', 9, 3, 1, 10, undefined, undefined, 1);
    const [sFloorActor, floorActorId] = spawnEntity(sCaltropField, 'goblin', 9, 3, undefined, undefined, 0);
    const z0Step = resolveCaltropsStepHazard(sFloorActor, floorActorId, 9, 3, 20);
    expect(z0Step.triggered).toBe(false);
    const z1ActorState = addComponent(sFloorActor, floorActorId, {
      type: ComponentType.Position,
      x: 9,
      y: 3,
      z: 1
    });
    const z1Step = resolveCaltropsStepHazard(z1ActorState, floorActorId, 9, 3, 20);
    expect(z1Step.triggered).toBe(true);

    // Charge & Cleave reject targets out of vertical Z reach (player on ground z=0 vs enemy hovering on rooftop z=1 / z=2)
    const [sAtk, attackerId] = spawnEntity(state, 'goblin', 3, 4, undefined, undefined, 0);
    const [sHighDef, highDefId] = spawnEntity(sAtk, 'goblin', 6, 4, undefined, undefined, 2);
    const [sDropped, droppedId] = spawnEntity(sHighDef, 'goblin', 4, 4, undefined, undefined, 0);
    const chargeRes = validateChargeLine(sDropped, attackerId, highDefId);
    expect(chargeRes.valid).toBe(false);

    const attackerDag = evaluateDnD35eEntityDAG(sDropped, attackerId)!;
    const cleaveRes = resolveOnDropCleaveFollowup(
      sDropped,
      attackerId,
      droppedId,
      attackerDag.attackRoutine.strikes[0]!,
      10,
      { ...attackerDag, hasCleave: true },
      0
    );
    expect(cleaveRes.cleavesUsed).toBe(0);
  });
});
