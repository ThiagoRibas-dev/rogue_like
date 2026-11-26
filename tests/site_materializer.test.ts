import { describe, expect, test } from 'bun:test';
import { MAX_MATERIALIZED_DELTA_IDS } from '../src/constants/macro_world.constants.ts';
import { DEFAULT_CHUNK_SIZE } from '../src/constants/world_chunk.constants.ts';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { createInitialStreamingGrid } from '../src/map/chunk_generator.ts';
import { getTemperatureAt, setTemperatureAt } from '../src/map/map_accessor.ts';
import { processActorNeedsTick } from '../src/systems/psychology/needs.system.ts';
import { advanceWorkshopBillWork, enqueueCraftingBill, registerWorkshop } from '../src/systems/labor/workshop.system.ts';
import { buildLegendsInputFromCampaign, generateLegendsWorldSync, seedGameStateFromLegends } from '../src/systems/macro/legends_simulator.ts';
import { updateStreamingWorldWindow } from '../src/systems/map/chunk_streaming.ts';
import { materializeMacroSitesForArea, materializeMacroSitesForChunk } from '../src/systems/map/site_materializer.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type FieldComponent,
  type IdentityComponent,
  type MemoryComponent,
  type NeedsComponent,
  type ShopComponent
} from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { packWorldCoord3D } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 48 M186: Idempotent Chunk & Area Site Materialization', () => {
  test('Materializes burned raid sites (embers, smoke field, scarred traumatized survivors), ancient tomb artifacts, and caravans idempotently', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4806);
    const input = buildLegendsInputFromCampaign(campaign, 4806);
    const baseMacro = generateLegendsWorldSync({ ...input, historyYears: 30, siteCount: 6 });

    const frontierDef = campaign.areas['endless_frontier']!;
    const grid = createInitialStreamingGrid(campaign, frontierDef, 0, 0);

    // Position 3 distinct sites on loaded chunks (0,0), (1,0), (-1,0) and a caravan at (0,1)
    const centerX = Math.floor(baseMacro.continent.width / 2);
    const centerY = Math.floor(baseMacro.continent.height / 2);

    const modifiedMacro = {
      ...baseMacro,
      sites: {
        site_intact: {
          ...Object.values(baseMacro.sites)[0]!,
          id: 'site_intact',
          name: 'Oakford',
          archetype: 'town' as const,
          status: 'intact' as const,
          x: centerX,
          y: centerY,
          chunkX: 0,
          chunkY: 0,
          artifactIds: []
        },
        site_burned: {
          ...Object.values(baseMacro.sites)[0]!,
          id: 'site_burned',
          name: 'Ashwatch',
          archetype: 'hamlet' as const,
          status: 'burned' as const,
          x: centerX + 1,
          y: centerY,
          chunkX: 1,
          chunkY: 0,
          artifactIds: []
        },
        site_ruin: {
          ...Object.values(baseMacro.sites)[0]!,
          id: 'site_ruin',
          name: 'Sunken Vault',
          archetype: 'ruin' as const,
          status: 'ruined' as const,
          x: centerX - 1,
          y: centerY,
          chunkX: -1,
          chunkY: 0,
          artifactIds: ['art_test']
        }
      },
      caravans: {
        caravan_1: {
          id: 'caravan_1',
          factionId: 'town',
          originSiteId: 'site_intact',
          targetSiteId: 'site_burned',
          x: centerX,
          y: centerY + 1,
          chunkX: 0,
          chunkY: 1,
          cargoTags: ['valuable'],
          escortStrength: 15,
          goodsValue: 80,
          progressTurns: 1
        }
      },
      legends: {
        ...baseMacro.legends,
        artifacts: {
          art_test: {
            id: 'art_test',
            name: 'Dawnwarden Signet',
            creatorFigureId: 'fig_1',
            forgedYear: 42,
            currentSiteId: 'site_ruin',
            ownerHistoryFigureIds: ['fig_1'],
            description: 'Forged in Year 42 before the fall of Sunken Vault.'
          }
        }
      }
    };

    state = seedGameStateFromLegends(
      {
        ...state,
        currentAreaId: 'endless_frontier',
        map: { width: 0, height: 0, tiles: [], chunkGrid: grid }
      },
      modifiedMacro
    );

    const beforeEntitiesCount = state.entities.length;
    for (const chunk of Array.from(state.map.chunkGrid!.chunks.values())) {
      if (chunk.cz !== 0) continue;
      state = materializeMacroSitesForChunk(state, chunk, 'endless_frontier').state;
    }

    expect(state.entities.length).toBeGreaterThan(beforeEntitiesCount);

    // Burned site at chunk (1,0) spawned ember heat, smoke field, and traumatized scarred survivor
    const burnedWx = 1 * DEFAULT_CHUNK_SIZE + Math.floor(DEFAULT_CHUNK_SIZE / 2);
    const burnedWy = Math.floor(DEFAULT_CHUNK_SIZE / 2);
    expect(getTemperatureAt(state.map, burnedWx, burnedWy, 0)).toBeGreaterThan(20);

    const smokeFields = state.entities
      .map((id) => getComponent(state, id, ComponentType.Field) as FieldComponent | undefined)
      .filter((f) => f !== undefined && f.fieldType === 'smoke');
    expect(smokeFields.length).toBeGreaterThanOrEqual(1);

    const scarredTraumaActors = state.entities.filter((id) => {
      const chron = getComponent(state, id, ComponentType.Chronicle) as ChronicleComponent | undefined;
      const mem = getComponent(state, id, ComponentType.Memory) as MemoryComponent | undefined;
      return Boolean(
        chron &&
          chron.scars.length > 0 &&
          mem?.thoughts?.some((t) => t.thoughtId === 'site_raid_trauma')
      );
    });
    expect(scarredTraumaActors.length).toBeGreaterThanOrEqual(1);

    // Ancient ruin spawned Dawnwarden Signet with custom IdentityComponent
    const relicEntityId = state.macroWorld!.legends.artifacts['art_test']!.materializedEntityId;
    expect(relicEntityId).toBeDefined();
    const relicIdentity = getComponent(state, relicEntityId!, ComponentType.Identity) as IdentityComponent | undefined;
    expect(relicIdentity?.name).toBe('Dawnwarden Signet');

    // Passing caravan spawned ShopComponent merchant + knowledge rumor
    const caravanMerchants = state.entities.filter((id) => {
      const shop = getComponent(state, id, ComponentType.Shop) as ShopComponent | undefined;
      const mem = getComponent(state, id, ComponentType.Memory) as MemoryComponent | undefined;
      return Boolean(shop && shop.inventory.length > 0 && mem?.knowledge['caravan_caravan_1']);
    });
    expect(caravanMerchants.length).toBeGreaterThanOrEqual(1);

    // Idempotency: re-running chunk materialization and streaming window changes nothing
    const afterCount = state.entities.length;
    const chunk0 = state.map.chunkGrid!.chunks.get(packWorldCoord3D(0, 0, 0))!;
    const secondPass = materializeMacroSitesForChunk(state, chunk0, 'endless_frontier');
    expect(secondPass.materializedCount).toBe(0);
    expect(secondPass.state.entities.length).toBe(afterCount);

    // Evicting distant chunk and stepping back into it remains idempotent
    let stepped = updateStreamingWorldWindow(secondPass.state, 200, 0, { anchorZ: 0, enablePrefetch: false });
    stepped = updateStreamingWorldWindow(stepped, 0, 0, { anchorZ: 0, enablePrefetch: false });
    const relicCountAfterReentry = stepped.entities.filter((id) => id === relicEntityId).length;
    expect(relicCountAfterReentry).toBe(1);
  });

  test('materializeMacroSitesForArea applies linked Ring 2 pending deltas onto finite areas idempotently', () => {
    const campaign = loadCampaignFromDisk('default');
    const customCampaign = {
      ...campaign,
      rules: {
        ...campaign.rules,
        macroWorld: {
          ...campaign.rules.macroWorld!,
          areaSiteBindings: { safe_hub: 'site_1' }
        }
      }
    };
    let state = buildGameState(customCampaign, 4807);
    const input = buildLegendsInputFromCampaign(customCampaign, 4807);
    const macro = generateLegendsWorldSync({ ...input, historyYears: 20, siteCount: 6 });

    state = seedGameStateFromLegends(state, {
      ...macro,
      pendingSiteDeltas: [
        {
          id: 'finite_raid_delta_1',
          tick: 1,
          siteId: 'site_1',
          kind: 'site_raided',
          scarText: 'raider_slash',
          summary: 'Raiders struck the outskirts of town!'
        }
      ]
    });

    const initialCount = state.entities.length;
    const afterAreaWake = materializeMacroSitesForArea(state, 'safe_hub');
    expect(afterAreaWake.entities.length).toBeGreaterThan(initialCount);
    expect(afterAreaWake.macroWorld?.materializedDeltaIds).toContain('finite_raid_delta_1');

    // Second wake call does not duplicate entities
    const secondWake = materializeMacroSitesForArea(afterAreaWake, 'safe_hub');
    expect(secondWake.entities.length).toBe(afterAreaWake.entities.length);
  });

  test('Burned site with matching pendingSiteDelta spawns survivor & smoke only once and preserves chunk_stamp across cap eviction', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 4812);
    const input = buildLegendsInputFromCampaign(campaign, 4812);
    const baseMacro = generateLegendsWorldSync({ ...input, historyYears: 20, siteCount: 6 });

    const frontierDef = campaign.areas['endless_frontier']!;
    const grid = createInitialStreamingGrid(campaign, frontierDef, 0, 0);
    const centerX = Math.floor(baseMacro.continent.width / 2);
    const centerY = Math.floor(baseMacro.continent.height / 2);

    const overflowIds = Array.from({ length: MAX_MATERIALIZED_DELTA_IDS + 25 }, (_, i) => `old_delta_${i}`);
    const site1 = Object.values(baseMacro.sites)[0]!;
    state = seedGameStateFromLegends(
      {
        ...state,
        currentAreaId: 'endless_frontier',
        map: { width: 0, height: 0, tiles: [], chunkGrid: grid }
      },
      {
        ...baseMacro,
        sites: {
          site_both: {
            ...site1,
            id: 'site_both',
            name: 'Charred Stead',
            status: 'burned',
            x: centerX,
            y: centerY,
            chunkX: 0,
            chunkY: 0,
            artifactIds: []
          }
        },
        pendingSiteDeltas: [
          {
            id: 'pending_burn_both',
            tick: 2,
            siteId: 'site_both',
            kind: 'site_burned',
            scarText: 'burned_cheek',
            summary: 'Raiders torched Charred Stead!'
          }
        ],
        materializedDeltaIds: overflowIds
      }
    );

    const chunk0 = state.map.chunkGrid!.chunks.get(packWorldCoord3D(0, 0, 0))!;
    const firstPass = materializeMacroSitesForChunk(state, chunk0, 'endless_frontier');
    const survivors = firstPass.state.entities.filter((id) => {
      const mem = getComponent(firstPass.state, id, ComponentType.Memory) as MemoryComponent | undefined;
      return Boolean(mem?.thoughts?.some((t) => t.thoughtId === 'site_raid_trauma'));
    });
    expect(survivors.length).toBe(1);
    expect(
      firstPass.state.macroWorld?.materializedDeltaIds.includes('chunk_stamp:endless_frontier:0,0:site_both')
    ).toBe(true);
    expect(firstPass.state.macroWorld?.materializedDeltaIds.length).toBeLessThanOrEqual(MAX_MATERIALIZED_DELTA_IDS);
  });

  test('caravan_arrived delta stocks ShopComponent cargo and skips smoke gracefully when campaign defines no smoke field', () => {
    const campaign = loadCampaignFromDisk('default');
    const smokelessCampaign = {
      ...campaign,
      fields: {
        fire: campaign.fields['fire']!
      }
    };
    let state = buildGameState(smokelessCampaign, 4813);
    const frontierDef = smokelessCampaign.areas['endless_frontier']!;
    const grid = createInitialStreamingGrid(smokelessCampaign, frontierDef, 0, 0);
    const baseMacro = generateLegendsWorldSync({
      ...buildLegendsInputFromCampaign(smokelessCampaign, 4813),
      historyYears: 20,
      siteCount: 4
    });
    const centerX = Math.floor(baseMacro.continent.width / 2);
    const centerY = Math.floor(baseMacro.continent.height / 2);

    state = seedGameStateFromLegends(
      {
        ...state,
        currentAreaId: 'endless_frontier',
        map: { width: 0, height: 0, tiles: [], chunkGrid: grid }
      },
      {
        ...baseMacro,
        sites: {
          site_trade: {
            ...Object.values(baseMacro.sites)[0]!,
            id: 'site_trade',
            name: 'Tradeford',
            status: 'burned',
            x: centerX,
            y: centerY,
            chunkX: 0,
            chunkY: 0,
            artifactIds: []
          }
        },
        caravans: {},
        pendingSiteDeltas: [
          {
            id: 'caravan_delta_test',
            tick: 3,
            siteId: 'site_trade',
            kind: 'caravan_arrived',
            factionId: 'town',
            itemTemplateTags: ['valuable'],
            summary: 'A caravan reached Tradeford.'
          }
        ]
      }
    );

    const chunk0 = state.map.chunkGrid!.chunks.get(packWorldCoord3D(0, 0, 0))!;
    const res = materializeMacroSitesForChunk(state, chunk0, 'endless_frontier');
    const shops = res.state.entities
      .map((id) => getComponent(res.state, id, ComponentType.Shop) as ShopComponent | undefined)
      .filter((s): s is ShopComponent => s !== undefined && s.inventory.length > 0);
    expect(shops.length).toBeGreaterThanOrEqual(1);
    const smokeCount = res.state.entities
      .map((id) => getComponent(res.state, id, ComponentType.Field) as FieldComponent | undefined)
      .filter((f) => f?.fieldType === 'smoke').length;
    expect(smokeCount).toBe(0);
  });

  test('Resolves custom rules.psychology.thoughtDefinitions and MacroSiteDelta.thoughtOverride across site materializer, needs, and workshop', () => {
    const campaign = loadCampaignFromDisk('default');
    const customCampaign = {
      ...campaign,
      rules: {
        ...campaign.rules,
        psychology: {
          ...campaign.rules.psychology,
          thoughtDefinitions: {
            site_burned: {
              thoughtId: 'ash_bereavement',
              moodDelta: -30,
              durationTurns: 200,
              maxStacks: 3,
              summaryTemplate: 'Tragedy: {summary}'
            },
            freezing_cold: {
              thoughtId: 'frostbite_chill',
              moodDelta: -20,
              durationTurns: 45
            },
            crafted_item: {
              thoughtId: 'masterwork_pride',
              moodDelta: 12,
              durationTurns: 90,
              maxStacks: 4
            }
          }
        },
        macroWorld: {
          ...campaign.rules.macroWorld!,
          areaSiteBindings: { safe_hub: 'site_1' }
        }
      }
    };

    let state = buildGameState(customCampaign, 4820);
    const input = buildLegendsInputFromCampaign(customCampaign, 4820);
    const macro = generateLegendsWorldSync({ ...input, historyYears: 20, siteCount: 6 });
    state = seedGameStateFromLegends(state, {
      ...macro,
      pendingSiteDeltas: [
        {
          id: 'custom_burn_delta',
          tick: 1,
          siteId: 'site_1',
          kind: 'site_burned',
          scarText: 'ash_scar',
          summary: 'Ashwatch burned to cinders!'
        }
      ]
    });

    const afterBurnMaterialize = materializeMacroSitesForArea(state, 'safe_hub');
    const burnThoughts = afterBurnMaterialize.entities
      .map((id) => getComponent(afterBurnMaterialize, id, ComponentType.Memory) as MemoryComponent | undefined)
      .flatMap((m) => m?.thoughts ?? []);

    expect(
      burnThoughts.some(
        (t) =>
          t.thoughtId === 'ash_bereavement' &&
          t.moodDelta === -30 &&
          t.eventSummary === 'Tragedy: Ashwatch burned to cinders!'
      )
    ).toBe(true);

    // Second pending delta with explicit per-delta thoughtOverride
    const withOverrideDelta: GameState = {
      ...afterBurnMaterialize,
      macroWorld: {
        ...afterBurnMaterialize.macroWorld!,
        pendingSiteDeltas: [
          ...afterBurnMaterialize.macroWorld!.pendingSiteDeltas,
          {
            id: 'override_raid_delta',
            tick: 2,
            siteId: 'site_1',
            kind: 'site_raided',
            summary: 'Bandits plundered the granary.',
            thoughtOverride: {
              thoughtId: 'granary_loss',
              moodDelta: -9,
              durationTurns: 75
            }
          }
        ]
      }
    };
    const afterMaterialize = materializeMacroSitesForArea(withOverrideDelta, 'safe_hub');
    const overrideThoughts = afterMaterialize.entities
      .map((id) => getComponent(afterMaterialize, id, ComponentType.Memory) as MemoryComponent | undefined)
      .flatMap((m) => m?.thoughts ?? []);
    expect(overrideThoughts.some((t) => t.thoughtId === 'granary_loss' && t.moodDelta === -9)).toBe(true);

    // Needs emitter respects rules.psychology.thoughtDefinitions.freezing_cold
    const playerId = afterMaterialize.entities.find(
      (id) => getComponent(afterMaterialize, id, ComponentType.Player) !== undefined
    )!;
    const baseColdMap = {
      width: 10,
      height: 10,
      tiles: Array.from({ length: 100 }, (_, idx) => ({
        x: idx % 10,
        y: Math.floor(idx / 10),
        tileId: 'stone_floor',
        explored: true
      }))
    };
    const coldNeedsState: GameState = {
      ...afterMaterialize,
      components: new Map(afterMaterialize.components),
      map: setTemperatureAt(baseColdMap, 1, 1, -15, 0, 0)
    };
    const withColdPos = addComponent(coldNeedsState, playerId, {
      type: ComponentType.Position,
      x: 1,
      y: 1,
      z: 0
    });
    const withNeeds = addComponent(
      addComponent(withColdPos, playerId, {
        type: ComponentType.Needs,
        needs: { rest: { current: 80, max: 100, decayPerInterval: 1 } }
      } as NeedsComponent),
      playerId,
      {
        type: ComponentType.Memory,
        factionStandings: {},
        grudges: [],
        facts: [],
        knowledge: {}
      } as MemoryComponent
    );
    const afterNeeds = processActorNeedsTick(withNeeds, playerId, 1);
    const needsMem = getComponent(afterNeeds, playerId, ComponentType.Memory) as MemoryComponent;
    expect(needsMem.thoughts?.some((t) => t.thoughtId === 'frostbite_chill' && t.moodDelta === -20)).toBe(true);

    // Workshop crafting emitter respects rules.psychology.thoughtDefinitions.crafted_item
    const [wsState, wsId] = spawnEntity(afterNeeds, 'masonry_workshop', 1, 1);
    let craftState = registerWorkshop(wsState, wsId, 'workshop:masonry');
    craftState = enqueueCraftingBill(craftState, wsId, {
      billId: 'bill_stone_test',
      recipeId: 'cut_stone_blocks',
      targetCount: 1
    });
    craftState = {
      ...craftState,
      campaign: {
        ...craftState.campaign,
        rules: {
          ...craftState.campaign.rules,
          craftingRecipes: {
            cut_stone_blocks: {
              id: 'cut_stone_blocks',
              name: 'Cut Stone Blocks',
              workshopTag: 'workshop:masonry',
              requiredInputs: [],
              workUnits: 1,
              outputs: [{ itemId: 'cut_stone_block', count: 1 }]
            }
          }
        }
      }
    };
    const craftRes = advanceWorkshopBillWork(craftState, playerId, wsId);
    const craftMem = getComponent(craftRes.state, playerId, ComponentType.Memory) as MemoryComponent;
    expect(craftMem.thoughts?.some((t) => t.thoughtId === 'masterwork_pride' && t.moodDelta === 12)).toBe(true);
  });
});
