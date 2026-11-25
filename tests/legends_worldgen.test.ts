import { describe, expect, test } from 'bun:test';
import { STREAMING_OVERWORLD_SITE_SPAN_CHUNKS } from '../src/constants/macro_world.constants.ts';
import { generateContinentalMacroWorld } from '../src/map/worldgen_continent.ts';
import {
  buildLegendsInputFromCampaign,
  generateLegendsWorldSync,
  seedGameStateFromLegends,
  simulateWorldLegendsAsync
} from '../src/systems/macro/legends_simulator.ts';
import { ComponentType, type ChronicleComponent, type IdentityComponent } from '../src/types/components.types.ts';
import { runLegendsWorldgenOffload } from '../src/worker/worker_bridge.ts';
import type { WorkerProgressPayload } from '../src/worker/worker.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 48 M185: Offline Multi-Century Legends Worldgen', () => {
  test('generateContinentalMacroWorld produces deterministic terrain, rivers, roads, and nearby showcase sites', () => {
    const campaign = loadCampaignFromDisk('default');
    const input = buildLegendsInputFromCampaign(campaign, 48185);
    const macroA = generateContinentalMacroWorld({ ...input, width: 24, height: 24, siteCount: 10 });
    const macroB = generateContinentalMacroWorld({ ...input, width: 24, height: 24, siteCount: 10 });

    expect(macroA).toEqual(macroB);
    expect(macroA.continent.cells.length).toBe(24 * 24);
    expect(macroA.continent.cells.some((c) => c.biome === 'ocean')).toBe(true);
    expect(macroA.continent.cells.some((c) => c.hasRoad)).toBe(true);

    const sites = Object.values(macroA.sites);
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const nearbyCount = sites.filter(
      (s) => Math.max(Math.abs(s.chunkX), Math.abs(s.chunkY)) <= STREAMING_OVERWORLD_SITE_SPAN_CHUNKS
    ).length;
    expect(nearbyCount).toBeGreaterThanOrEqual(1);
  });

  test('simulateWorldLegendsAsync streams progress payloads and generates Eras, Figures, Ruins, and Artifacts', async () => {
    const campaign = loadCampaignFromDisk('default');
    const input = {
      ...buildLegendsInputFromCampaign(campaign, 5511),
      historyYears: 120,
      siteCount: 10
    };

    const gen = simulateWorldLegendsAsync(input);
    const progressSteps: WorkerProgressPayload[] = [];
    let next = gen.next();
    while (!next.done) {
      progressSteps.push(next.value);
      next = gen.next();
    }
    const archiveMacro = next.value;

    expect(progressSteps.length).toBeGreaterThanOrEqual(4);
    expect(progressSteps[progressSteps.length - 1]!.progress).toBe(1);
    expect(archiveMacro.legends.eras.length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(archiveMacro.legends.figures).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(archiveMacro.legends.artifacts).length).toBeGreaterThanOrEqual(1);
    expect(archiveMacro.legends.events.length).toBeGreaterThan(10);
    expect(Object.values(archiveMacro.sites).some((s) => s.status === 'ruined' || s.archetype === 'ruin')).toBe(true);

    // Worker offload fallback returns identical deterministic result in headless tests
    const offloadUpdates: WorkerProgressPayload[] = [];
    const offloaded = await runLegendsWorldgenOffload(input, (p) => offloadUpdates.push(p));
    expect(offloaded).toEqual(archiveMacro);
    expect(offloadUpdates.length).toBe(progressSteps.length);
  });

  test('seedGameStateFromLegends promotes surviving legends into persistentEntities and populates historicalLedger', () => {
    const campaign = loadCampaignFromDisk('default');
    const baseState = buildGameState(campaign, 4805);
    const input = {
      ...buildLegendsInputFromCampaign(campaign, 4805),
      historyYears: 80,
      siteCount: 8
    };
    const macroWorld = generateLegendsWorldSync(input);
    const seeded = seedGameStateFromLegends(baseState, macroWorld);

    expect(seeded.macroWorld).toBeDefined();
    expect(seeded.historicalLedger.length).toBeGreaterThan(baseState.historicalLedger.length);
    expect(seeded.persistentEntities.size).toBeGreaterThan(baseState.persistentEntities.size);

    const seededLegends = Object.values(seeded.macroWorld!.legends.figures).filter(
      (f) => f.seededEntityId !== undefined
    );
    expect(seededLegends.length).toBeGreaterThan(0);

    const sampleRecord = seeded.persistentEntities.get(seededLegends[0]!.seededEntityId!);
    expect(sampleRecord).toBeDefined();
    const identity = sampleRecord?.components[ComponentType.Identity] as IdentityComponent | undefined;
    const chronicle = sampleRecord?.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
    const faction = sampleRecord?.components[ComponentType.Faction];
    expect(identity?.name).toBe(seededLegends[0]!.name);
    expect(chronicle?.coreMemories.length).toBeGreaterThan(0);
    expect(faction).toBeDefined();
  });
});
