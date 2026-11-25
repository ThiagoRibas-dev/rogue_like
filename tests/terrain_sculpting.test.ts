import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent, getEntitiesAtPosition, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { getTileIdAt, setTileIdAt } from '../src/map/map_accessor.ts';
import { evaluateStructuralSupport } from '../src/map/structural_support.ts';
import { executeDnD35eSpellCast } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { processApplyIntent } from '../src/systems/apply.system.ts';
import {
  constructTerrainTile,
  mineTerrainTile,
  sculptTerrainVoxel,
  tickTimedTerrainReverts
} from '../src/systems/construction.system.ts';
import { unpackFluidCell } from '../src/systems/physics/fluid_codec.ts';
import { getFluidByteAt } from '../src/map/map_accessor.ts';
import { ComponentType, type FighterComponent, type ItemComponent, type PositionComponent } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Milestone 181: Dynamic Terrain Sculpting, Construction, Cave-Ins & D&D 3.5e Spells', () => {
  it('mines stone walls into floors with boulder yields via ApplyIntent and constructs new walls', () => {
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
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 1, y: 1, z: 0 });

    // Stone wall at (0, 1, 0) in safe_hub
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_wall');
    const applyMine = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'mine',
      target: { type: 'tile', x: 0, y: 1, z: 0 }
    });
    expect(applyMine.success).toBe(true);
    state = applyMine.state;
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_floor');

    // Dropped stone_boulder at (0, 1, 0) can then reconstruct a wall via blueprint
    const droppedBoulders = getEntitiesAtPosition(state, 0, 1, 0).filter(
      (id) => (getComponent(state, id, ComponentType.Item) as ItemComponent | undefined)?.itemId === 'stone_boulder'
    );
    expect(droppedBoulders.length).toBe(1);

    const buildRes = constructTerrainTile(state, playerId, 0, 1, 0, 'stone_wall_blueprint');
    expect(buildRes.success).toBe(true);
    state = buildRes.state;
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_wall');
    expect(
      getEntitiesAtPosition(state, 0, 1, 0).filter((id) => getComponent(state, id, ComponentType.Item) !== undefined).length
    ).toBe(0);
    void mineTerrainTile;
  });

  it('triggers connected structural cave-ins on unsupported upper floors when pillars are sculpted away', () => {
    const baseCampaign = loadCampaignFromDisk('default');
    const campaign = {
      ...baseCampaign,
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'watchtower_overlook' }
      }
    };
    let state = buildGameState(campaign);

    // Build an isolated unsupported floating stone floor at z = 1 (4, 6, 1) with no support below or within span
    // First clear nearby upper walls/floors around (4, 6, 1) and test direct support check
    expect(evaluateStructuralSupport(state, 9, 2, 1)).toBe(true);

    // Sculpt a ceiling column at (9, 2, 0) while checking support, then construct isolated overhang far from load-bearing walls
    // Replace z=0 ground around (6,6,0) with open_air? Wait: watchtower_overlook z=0..1 spans minZ=-1..maxZ=1.
    // Clear (5,6,0), (6,6,0), (7,6,0) to open_air, put goblin on (6,6,1) stone_floor, then remove last support pillar at (6,6,0)!
    let map = setTileIdAt(state.map, 6, 6, 'stone_floor', 1);
    map = setTileIdAt(map, 6, 6, 'stone_wall', 0);
    map = setTileIdAt(map, 6, 6, 'stone_floor', -1);
    state = { ...state, map };
    expect(evaluateStructuralSupport(state, 6, 6, 1)).toBe(true);

    let goblinId;
    [state, goblinId] = spawnEntity(state, 'goblin', 6, 6, undefined, undefined, 1);
    let victimId;
    [state, victimId] = spawnEntity(state, 'orc', 6, 6, undefined, undefined, -1);

    // Sculpt away the load-bearing support pillar at (6,6,0) -> (6,6,1) collapses to open_air and drops goblin + damages orc!
    state = sculptTerrainVoxel(state, 6, 6, 0, 'open_air');
    expect(getTileIdAt(state.map, 6, 6, 1)).toBe('open_air');
    const goblinPos = getComponent(state, goblinId, ComponentType.Position) as PositionComponent;
    expect(goblinPos.z ?? -99).toBe(-1);
    const orcDamage = getComponent(state, victimId, ComponentType.Damage);
    expect((orcDamage?.instances.length ?? 0) > 0 || (getComponent(state, victimId, ComponentType.Fighter) as FighterComponent).hp < 10).toBe(true);
    void spawnItem;
  });

  it('executes D&D 3.5e Stone Shape, Passwall (with timed revert), Transmute Rock to Mud, and Create Water declaratively', () => {
    const baseCampaign = loadCampaignFromDisk('dnd35e-crypt');
    const defaultCampaign = loadCampaignFromDisk('default');
    const watchtowerArea = defaultCampaign.areas['watchtower_overlook']!;
    const campaign = {
      ...baseCampaign,
      tiles: { ...baseCampaign.tiles, ...defaultCampaign.tiles },
      areas: { ...baseCampaign.areas, watchtower_overlook: watchtowerArea },
      rules: {
        ...baseCampaign.rules,
        map: { ...baseCampaign.rules.map, startingAreaId: 'watchtower_overlook' }
      }
    };
    let state = buildGameState(campaign);
    const casterId = state.entities.find((e) => state.components.get(e)?.[ComponentType.Player])!;
    state = addComponent(state, casterId, { type: ComponentType.Position, x: 1, y: 1, z: 0 });

    const dnd = getDnD35EntityData(state, casterId);
    state = setDnD35EntityData(state, casterId, {
      ...dnd,
      tracks: [{ trackKind: 'class', sourceId: 'wizard', level: 9 }],
      abilityScores: {
        ...dnd.abilityScores,
        int: { ...dnd.abilityScores.int, base: 18 }
      },
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          governingAbility: 'int',
          effectiveCasterLevel: 9,
          maxCastableSpellLevel: 5,
          knownSpells: ['stone_shape', 'passwall', 'transmute_rock_to_mud', 'create_water'],
          spellsPerDay: { '0': 4, '3': 4, '4': 4, '5': 4 },
          preparedSpellIds: ['create_water', 'stone_shape', 'passwall', 'transmute_rock_to_mud'],
          preparedSlots: [
            { slotId: 'wiz_0_0', slotLevel: 0, slotKind: 'general', preparedSpellId: 'create_water', expended: false },
            { slotId: 'wiz_4_0', slotLevel: 4, slotKind: 'general', preparedSpellId: 'stone_shape', expended: false },
            { slotId: 'wiz_5_0', slotLevel: 5, slotKind: 'general', preparedSpellId: 'passwall', expended: false },
            {
              slotId: 'wiz_5_1',
              slotLevel: 5,
              slotKind: 'general',
              preparedSpellId: 'transmute_rock_to_mud',
              expended: false
            }
          ]
        }
      }
    });

    // 1. Stone Shape carves stone_wall at (0, 1, 0) permanently into stone_floor
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_wall');
    const stoneRes = executeDnD35eSpellCast(state, casterId, { x: 0, y: 1, z: 0 }, { spellId: 'stone_shape', classId: 'wizard', spellLevel: 4 });
    expect(stoneRes.success).toBe(true);
    state = stoneRes.state;
    expect(getTileIdAt(state.map, 0, 1, 0)).toBe('stone_floor');

    // 2. Passwall opens temporary tunnel at (1, 0, 0), safely ejects standing actors on revert
    expect(getTileIdAt(state.map, 1, 0, 0)).toBe('stone_wall');
    const passRes = executeDnD35eSpellCast(state, casterId, { x: 1, y: 0, z: 0 }, { spellId: 'passwall', classId: 'wizard', spellLevel: 5 });
    expect(passRes.success).toBe(true);
    state = passRes.state;
    expect(getTileIdAt(state.map, 1, 0, 0)).toBe('stone_floor');
    expect((state.colonyState?.timedTerrainReverts.length ?? 0)).toBe(1);

    state = addComponent(state, casterId, { type: ComponentType.Position, x: 1, y: 0, z: 0 });
    const revertTurn = state.colonyState!.timedTerrainReverts[0]!.revertTurn;
    state = tickTimedTerrainReverts({ ...state, globalTurn: revertTurn });
    expect(getTileIdAt(state.map, 1, 0, 0)).toBe('stone_wall');
    const ejectedPos = getComponent(state, casterId, ComponentType.Position) as PositionComponent;
    expect(ejectedPos.x === 1 && ejectedPos.y === 0).toBe(false);
    state = addComponent(state, casterId, { type: ComponentType.Position, x: 1, y: 1, z: 0 });

    // 3. Transmute Rock to Mud turns solid wall at (3, 0, 0) into stone_floor + mud fluid
    const mudRes = executeDnD35eSpellCast(state, casterId, { x: 3, y: 0, z: 0 }, { spellId: 'transmute_rock_to_mud', classId: 'wizard', spellLevel: 5 });
    expect(mudRes.success).toBe(true);
    state = mudRes.state;
    expect(getTileIdAt(state.map, 3, 0, 0)).toBe('stone_floor');
    expect(unpackFluidCell(getFluidByteAt(state.map, 3, 0, 0)).kind).toBe('mud');

    // 4. Create Water spawns cellular water across open stone_floor at (4, 2, 0)
    const waterRes = executeDnD35eSpellCast(state, casterId, { x: 4, y: 2, z: 0 }, { spellId: 'create_water', classId: 'wizard', spellLevel: 0 });
    expect(waterRes.success).toBe(true);
    state = waterRes.state;
    expect(unpackFluidCell(getFluidByteAt(state.map, 4, 2, 0)).kind).toBe('water');
    expect(unpackFluidCell(getFluidByteAt(state.map, 4, 2, 0)).depth).toBeGreaterThan(0);
  }, 15000);
});
