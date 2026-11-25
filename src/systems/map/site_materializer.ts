import {
  BURNT_SITE_EMBER_TEMP_DELTA_C,
  BURNT_SITE_MAX_EMBER_TEMP_C,
  BURNT_SITE_SMOKE_DURATION,
  BURNT_SITE_SMOKE_RADIUS,
  CARAVAN_DEFAULT_MARKUP,
  CARAVAN_MAX_SHOP_ITEMS,
  MAX_MATERIALIZED_DELTA_IDS,
  SITE_BURN_TRAUMA_MOOD_DELTA,
  SITE_RAID_TRAUMA_DURATION_TURNS,
  SITE_RAID_TRAUMA_MAX_STACKS,
  SITE_RAID_TRAUMA_MOOD_DELTA
} from '../../constants/macro_world.constants.ts';
import { CHUNK_DIRTY_PERSIST, CHUNK_DIRTY_REGION, CHUNK_DIRTY_TEMP } from '../../constants/world_chunk.constants.ts';
import { addComponent, getComponent, removeComponent, spawnEntity, spawnItem } from '../../core/ecs.ts';
import {
  findRandomWalkableCoord,
  getTileDefAt,
  isInMapBounds,
  markMapPhysicsDirtyAt,
  setTemperatureAt,
  setTileIdAt
} from '../../map/map_accessor.ts';
import { createMacroRng } from '../../map/worldgen_continent.ts';
import { getPaletteIndexForTileId } from '../../map/tile_palette.ts';
import { cloneWorldChunk } from '../../map/world_chunk.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type IdentityComponent,
  type MemoryComponent,
  type ShopComponent
} from '../../types/components.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type {
  HistoricalArtifactRecord,
  MacroCaravanRecord,
  MacroSiteDelta,
  MacroSiteRecord
} from '../../types/macro_world.types.ts';
import type { ChunkedWorldGrid, TilePaletteRegistry, WorldChunk } from '../../types/world-chunk.types.ts';
import { packWorldCoord3D } from '../../utils/grid.ts';
import { spawnField } from '../field.system.ts';
import { addTimedThought } from '../psychology/thoughts.system.ts';

interface MaterializationTileSet {
  readonly floorTileId: string | undefined;
  readonly wallTileId: string | undefined;
  readonly burntTileId: string | undefined;
}

function resolveMaterializationTileSet(campaign: Readonly<CampaignData>): MaterializationTileSet {
  const entries = Object.entries(campaign.tiles);
  const floorEntry =
    entries.find(
      ([, def]) =>
        def.walkable && def.transparent && def.isOpenAir !== true && def.verticalLink === undefined && !def.hazardKind
    ) ?? entries.find(([, def]) => def.walkable);
  const wallEntry =
    entries.find(([, def]) => !def.walkable && !def.transparent && def.isLoadBearing === true) ??
    entries.find(([, def]) => !def.walkable && !def.transparent);
  const burntEntry =
    entries.find(([, def]) => def.tags?.includes('burnt') || def.tags?.includes('rubble')) ??
    (floorEntry?.[1].burnedTileId && campaign.tiles[floorEntry[1].burnedTileId]
      ? ([floorEntry[1].burnedTileId, campaign.tiles[floorEntry[1].burnedTileId]!] as const)
      : undefined) ??
    floorEntry;

  return {
    floorTileId: floorEntry?.[0],
    wallTileId: wallEntry?.[0],
    burntTileId: burntEntry?.[0]
  };
}

function findTemplateIdByCriteria(
  campaign: Readonly<CampaignData>,
  predicate: (tpl: CampaignData['entities'][string]) => boolean
): string | undefined {
  for (const [id, tpl] of Object.entries(campaign.entities)) {
    if (id === 'player') continue;
    if (predicate(tpl)) return id;
  }
  return undefined;
}

function findItemIdsByTags(
  campaign: Readonly<CampaignData>,
  preferredTags: ReadonlyArray<string>,
  maxCount: number
): ReadonlyArray<string> {
  const results: string[] = [];
  for (const [id, def] of Object.entries(campaign.items)) {
    if (results.length >= maxCount) break;
    if (preferredTags.length === 0 || preferredTags.some((t) => def.tags?.includes(t))) {
      results.push(id);
    }
  }
  if (results.length === 0) {
    for (const [id, def] of Object.entries(campaign.items)) {
      if (results.length >= maxCount) break;
      if (def.equippable !== undefined || def.category === 'consumable' || def.tags?.includes('valuable')) {
        results.push(id);
      }
    }
  }
  return results;
}

function findArtifactBaseItemId(campaign: Readonly<CampaignData>, preferredItemId?: string): string | undefined {
  if (preferredItemId && campaign.items[preferredItemId]) return preferredItemId;
  for (const [id, def] of Object.entries(campaign.items)) {
    if (def.tags?.includes('artifact_base') || def.isArtifact === true) return id;
  }
  for (const [id, def] of Object.entries(campaign.items)) {
    if (def.tags?.includes('valuable') || def.equippable !== undefined) return id;
  }
  return Object.keys(campaign.items)[0];
}

function stampChunkStructure(
  chunk: WorldChunk,
  palette: TilePaletteRegistry,
  tiles: MaterializationTileSet,
  mode: 'intact' | 'burnt' | 'ruined'
): WorldChunk {
  const next = cloneWorldChunk(chunk);
  const floorIdx = tiles.floorTileId ? getPaletteIndexForTileId(palette, tiles.floorTileId) : 0;
  const wallIdx = tiles.wallTileId ? getPaletteIndexForTileId(palette, tiles.wallTileId) : 0;
  const burntIdx = tiles.burntTileId ? getPaletteIndexForTileId(palette, tiles.burntTileId) : floorIdx;

  const minC = Math.max(1, Math.floor(chunk.size / 4));
  const maxC = Math.min(chunk.size - 2, minC + 5);
  const doorX = Math.floor((minC + maxC) / 2);

  for (let ly = minC; ly <= maxC; ly++) {
    for (let lx = minC; lx <= maxC; lx++) {
      const idx = ly * chunk.size + lx;
      const isPerimeter = lx === minC || lx === maxC || ly === minC || ly === maxC;
      if (isPerimeter) {
        const isDoor = lx === doorX && ly === maxC;
        const isRuinedGap = mode === 'ruined' && (lx + ly) % 3 === 0;
        if (isDoor || isRuinedGap) {
          if (floorIdx > 0) next.tileType[idx] = mode === 'burnt' ? burntIdx : floorIdx;
        } else if (wallIdx > 0) {
          next.tileType[idx] = wallIdx;
        }
      } else {
        if (mode === 'burnt') {
          if (burntIdx > 0) next.tileType[idx] = burntIdx;
          next.temperature[idx] = Math.min(250, (next.temperature[idx] ?? 20) + BURNT_SITE_EMBER_TEMP_DELTA_C);
        } else if (floorIdx > 0) {
          next.tileType[idx] = floorIdx;
        }
      }
    }
  }

  return {
    ...next,
    dirtyFlags: next.dirtyFlags | CHUNK_DIRTY_PERSIST | CHUNK_DIRTY_REGION | (mode === 'burnt' ? CHUNK_DIRTY_TEMP : 0)
  };
}

function findSmokeFieldId(campaign: Readonly<CampaignData>): string | undefined {
  for (const [id, def] of Object.entries(campaign.fields)) {
    if (def.tags?.includes('smoke')) return id;
  }
  for (const [id, def] of Object.entries(campaign.fields)) {
    if (def.blocksSight === true && (def.damagePerTurn ?? 0) === 0 && def.statusEffectId === undefined) {
      return id;
    }
  }
  return undefined;
}

function appendMaterializedIds(
  existing: ReadonlyArray<string>,
  additions: ReadonlyArray<string>
): ReadonlyArray<string> {
  if (additions.length === 0) return existing;
  const merged = Array.from(new Set([...existing, ...additions]));
  if (merged.length <= MAX_MATERIALIZED_DELTA_IDS) return merged;

  const pinnedStamps = merged.filter((id) => id.startsWith('chunk_stamp:') || id.startsWith('area_stamp:'));
  const volatileDeltas = merged.filter((id) => !id.startsWith('chunk_stamp:') && !id.startsWith('area_stamp:'));
  const remainingQuota = Math.max(0, MAX_MATERIALIZED_DELTA_IDS - pinnedStamps.length);
  return [...pinnedStamps, ...volatileDeltas.slice(-remainingQuota)];
}

function spawnCaravanEntities(state: GameState, caravan: MacroCaravanRecord, wx: number, wy: number): GameState {
  let nextState = state;
  const merchantTplId = findTemplateIdByCriteria(
    nextState.campaign,
    (t) => t.shop !== undefined || Boolean(t.tags?.includes('merchant'))
  );
  if (merchantTplId) {
    let merchId: EntityId;
    [nextState, merchId] = spawnEntity(nextState, merchantTplId, wx, wy, undefined, undefined, 0);
    const cargoItems = findItemIdsByTags(nextState.campaign, caravan.cargoTags, 4);
    if (cargoItems.length > 0) {
      const existingShop = getComponent(nextState, merchId, ComponentType.Shop) as ShopComponent | undefined;
      const spawnedItemIds: EntityId[] = [];
      for (const itemId of cargoItems) {
        let itemEntId: EntityId;
        [nextState, itemEntId] = spawnItem(nextState, itemId, wx, wy, 0);
        nextState = removeComponent(nextState, itemEntId, ComponentType.Position);
        spawnedItemIds.push(itemEntId);
      }
      nextState = addComponent(nextState, merchId, {
        type: ComponentType.Shop,
        inventory: [...(existingShop?.inventory ?? []), ...spawnedItemIds],
        markupMultiplier: existingShop?.markupMultiplier ?? CARAVAN_DEFAULT_MARKUP,
        buyTags: existingShop?.buyTags ?? ['valuable', 'weapon'],
        sellTags: existingShop?.sellTags ?? ['valuable', 'weapon', 'consumable']
      } satisfies ShopComponent);
    }

    const mem = getComponent(nextState, merchId, ComponentType.Memory) as MemoryComponent | undefined;
    if (mem) {
      nextState = addComponent(nextState, merchId, {
        ...mem,
        knowledge: {
          ...mem.knowledge,
          [`caravan_${caravan.id}`]: {
            id: `caravan_${caravan.id}`,
            type: 'rumor',
            description: `Our caravan traveled from ${caravan.originSiteId} carrying ${caravan.cargoTags.join(', ')}.`,
            tags: ['caravan', caravan.factionId]
          }
        }
      });
    }
  }

  const guardTplId = findTemplateIdByCriteria(
    nextState.campaign,
    (t) =>
      Boolean(t.tags?.includes('guard')) ||
      (t.isActor === true && t.fighter !== undefined && t.faction === caravan.factionId)
  );
  if (guardTplId) {
    [nextState] = spawnEntity(nextState, guardTplId, wx + 1, wy, undefined, undefined, 0);
  }
  return nextState;
}

function spawnSiteDeltaEffects(
  state: GameState,
  site: MacroSiteRecord,
  delta: MacroSiteDelta,
  originX: number,
  originY: number,
  originZ: number
): GameState {
  let nextState = state;
  if (delta.kind === 'site_burned' || delta.kind === 'site_raided') {
    const requestedTags = delta.actorTemplateTags ?? [];
    const survivorTplId =
      (requestedTags.length > 0
        ? findTemplateIdByCriteria(
            nextState.campaign,
            (t) => t.isActor === true && requestedTags.some((tag) => t.tags?.includes(tag))
          )
        : undefined) ??
      findTemplateIdByCriteria(nextState.campaign, (t) => t.tags?.includes('survivor') === true) ??
      findTemplateIdByCriteria(nextState.campaign, (t) => t.isActor === true && t.enablePsychology === true) ??
      findTemplateIdByCriteria(nextState.campaign, (t) => t.isActor === true && t.tags?.includes('town') === true);
    if (survivorTplId) {
      let survId: EntityId;
      [nextState, survId] = spawnEntity(nextState, survivorTplId, originX, originY, undefined, undefined, originZ);
      const existingChron = getComponent(nextState, survId, ComponentType.Chronicle) as ChronicleComponent | undefined;
      const scars = [...(existingChron?.scars ?? [])];
      if (delta.scarText && !scars.includes(delta.scarText)) scars.push(delta.scarText);
      nextState = addComponent(nextState, survId, {
        type: ComponentType.Chronicle,
        pis: existingChron?.pis ?? 10,
        scars,
        coreMemories: [...(existingChron?.coreMemories ?? []), delta.summary],
        eventExcerpts: existingChron?.eventExcerpts ?? []
      });
      nextState = addTimedThought(nextState, survId, {
        thoughtId: 'site_raid_trauma',
        eventSummary: delta.summary,
        moodDelta: delta.kind === 'site_burned' ? SITE_BURN_TRAUMA_MOOD_DELTA : SITE_RAID_TRAUMA_MOOD_DELTA,
        durationTurns: SITE_RAID_TRAUMA_DURATION_TURNS,
        maxStacks: SITE_RAID_TRAUMA_MAX_STACKS
      });
    }

    if (delta.kind === 'site_burned') {
      const smokeFieldId = findSmokeFieldId(nextState.campaign);
      const emberX = isInMapBounds(nextState.map, originX + 1, originY, originZ) ? originX + 1 : originX;
      if (isInMapBounds(nextState.map, emberX, originY, originZ)) {
        if (smokeFieldId) {
          [nextState] = spawnField(
            nextState,
            smokeFieldId,
            emberX,
            originY,
            BURNT_SITE_SMOKE_RADIUS,
            BURNT_SITE_SMOKE_DURATION,
            undefined,
            undefined,
            originZ
          );
        }
        nextState = {
          ...nextState,
          map: setTemperatureAt(
            nextState.map,
            emberX,
            originY,
            Math.min(BURNT_SITE_MAX_EMBER_TEMP_C, 20 + BURNT_SITE_EMBER_TEMP_DELTA_C),
            originZ,
            nextState.globalTurn
          )
        };
      }
    }
  } else if (delta.kind === 'caravan_arrived') {
    const merchantTplId = findTemplateIdByCriteria(
      nextState.campaign,
      (t) => t.shop !== undefined || Boolean(t.tags?.includes('merchant'))
    );
    if (merchantTplId) {
      let merchId: EntityId;
      [nextState, merchId] = spawnEntity(nextState, merchantTplId, originX, originY + 1, undefined, undefined, originZ);
      const cargoItems = findItemIdsByTags(nextState.campaign, delta.itemTemplateTags ?? [], CARAVAN_MAX_SHOP_ITEMS);
      if (cargoItems.length > 0) {
        const existingShop = getComponent(nextState, merchId, ComponentType.Shop) as ShopComponent | undefined;
        const spawnedItemIds: EntityId[] = [];
        for (const itemId of cargoItems) {
          let itemEntId: EntityId;
          [nextState, itemEntId] = spawnItem(nextState, itemId, originX, originY + 1, originZ);
          nextState = removeComponent(nextState, itemEntId, ComponentType.Position);
          spawnedItemIds.push(itemEntId);
        }
        nextState = addComponent(nextState, merchId, {
          type: ComponentType.Shop,
          inventory: [...(existingShop?.inventory ?? []), ...spawnedItemIds],
          markupMultiplier: existingShop?.markupMultiplier ?? CARAVAN_DEFAULT_MARKUP,
          buyTags: existingShop?.buyTags ?? ['valuable', 'weapon'],
          sellTags: existingShop?.sellTags ?? ['valuable', 'weapon', 'consumable']
        } satisfies ShopComponent);
      }
      const mem = getComponent(nextState, merchId, ComponentType.Memory) as MemoryComponent | undefined;
      if (mem) {
        nextState = addComponent(nextState, merchId, {
          ...mem,
          knowledge: {
            ...mem.knowledge,
            [delta.id]: {
              id: delta.id,
              type: 'rumor',
              description: delta.summary,
              tags: ['caravan', ...(delta.factionId ? [delta.factionId] : [])]
            }
          }
        });
      }
    }
  } else if (delta.kind === 'site_rebuilt') {
    const guardTplId = findTemplateIdByCriteria(
      nextState.campaign,
      (t) =>
        Boolean(t.tags?.includes('guard')) ||
        (t.isActor === true && t.faction === site.factionId && t.fighter !== undefined)
    );
    if (guardTplId) {
      [nextState] = spawnEntity(nextState, guardTplId, originX, originY, undefined, undefined, originZ);
    }
  }
  return nextState;
}

function materializeSiteArtifacts(
  state: GameState,
  site: MacroSiteRecord,
  wx: number,
  wy: number,
  wz: number
): GameState {
  if (!state.macroWorld || site.artifactIds.length === 0) return state;
  let nextState = state;
  const nextArtifacts: Record<string, HistoricalArtifactRecord> = { ...state.macroWorld.legends.artifacts };

  for (const aid of site.artifactIds) {
    const art = nextArtifacts[aid];
    if (!art || art.materializedEntityId !== undefined) continue;
    const baseItemId = findArtifactBaseItemId(nextState.campaign, art.baseItemId);
    if (!baseItemId) continue;
    let itemEntId: EntityId;
    [nextState, itemEntId] = spawnItem(nextState, baseItemId, wx, wy, wz);
    const identity: IdentityComponent = {
      type: ComponentType.Identity,
      name: art.name,
      title: 'Ancient Relic',
      mannerisms: [art.description]
    };
    const chronicle: ChronicleComponent = {
      type: ComponentType.Chronicle,
      pis: 50,
      scars: [],
      coreMemories: [art.description],
      eventExcerpts: []
    };
    nextState = addComponent(nextState, itemEntId, identity);
    nextState = addComponent(nextState, itemEntId, chronicle);
    nextArtifacts[aid] = { ...art, materializedEntityId: itemEntId };
  }

  return {
    ...nextState,
    macroWorld: {
      ...nextState.macroWorld!,
      legends: {
        ...nextState.macroWorld!.legends,
        artifacts: nextArtifacts
      }
    }
  };
}

/**
 * Checks whether any currently loaded `cz === 0` chunk has unmaterialized sites, deltas, or caravans.
 */
export function hasUnmaterializedMacroActivityForGrid(
  state: Readonly<GameState>,
  grid: Readonly<ChunkedWorldGrid>
): boolean {
  const macro = state.macroWorld;
  if (!macro) return false;
  const realized = new Set(macro.materializedDeltaIds);

  for (const site of Object.values(macro.sites)) {
    const chunk = grid.chunks.get(packWorldCoord3D(site.chunkX, site.chunkY, 0));
    if (!chunk) continue;
    const stampKey = `chunk_stamp:${grid.areaId}:${site.chunkX},${site.chunkY}:${site.id}`;
    if (!realized.has(stampKey)) return true;
  }
  for (const delta of macro.pendingSiteDeltas) {
    if (realized.has(delta.id)) continue;
    const site = macro.sites[delta.siteId];
    if (site && grid.chunks.has(packWorldCoord3D(site.chunkX, site.chunkY, 0))) return true;
  }
  for (const caravan of Object.values(macro.caravans)) {
    const cKey = `caravan_stamp:${caravan.id}:${caravan.chunkX},${caravan.chunkY}`;
    if (!realized.has(cKey) && grid.chunks.has(packWorldCoord3D(caravan.chunkX, caravan.chunkY, 0))) return true;
  }
  return false;
}

/**
 * Idempotently materializes Ring 2 sites, pending site mutation deltas, artifacts, and passing caravans
 * onto a waking `WorldChunk` (`cz === 0`) without duplicating actors or items on subsequent reloads.
 *
 * @param state Current immutable GameState (whose `map.chunkGrid` already contains `chunk`).
 * @param chunk Newly woken `WorldChunk`.
 * @param areaId Active streaming area ID.
 * @returns Updated GameState, updated `WorldChunk`, and count of newly materialized features.
 */
export function materializeMacroSitesForChunk(
  state: GameState,
  chunk: WorldChunk,
  areaId: string
): { readonly state: GameState; readonly chunk: WorldChunk; readonly materializedCount: number } {
  const macro = state.macroWorld;
  const grid = state.map.chunkGrid;
  if (!macro || !grid || chunk.cz !== 0) {
    return { state, chunk, materializedCount: 0 };
  }

  const realized = new Set(macro.materializedDeltaIds);
  const matchingSites = Object.values(macro.sites).filter((s) => s.chunkX === chunk.cx && s.chunkY === chunk.cy);
  const matchingCaravans = Object.values(macro.caravans).filter(
    (c) =>
      c.chunkX === chunk.cx && c.chunkY === chunk.cy && !realized.has(`caravan_stamp:${c.id}:${chunk.cx},${chunk.cy}`)
  );

  if (matchingSites.length === 0 && matchingCaravans.length === 0) {
    return { state, chunk, materializedCount: 0 };
  }

  let nextState = state;
  let workingChunk = chunk;
  const tileSet = resolveMaterializationTileSet(nextState.campaign);
  const newlyMaterializedKeys: string[] = [];
  let materializedCount = 0;

  const centerOffset = Math.floor(workingChunk.size / 2);
  const baseWx = workingChunk.cx * workingChunk.size + centerOffset;
  const baseWy = workingChunk.cy * workingChunk.size + centerOffset;

  for (const site of matchingSites) {
    const stampKey = `chunk_stamp:${areaId}:${chunk.cx},${chunk.cy}:${site.id}`;
    const siteDeltas = macro.pendingSiteDeltas.filter((d) => d.siteId === site.id && !realized.has(d.id));
    const pendingRaidOrBurn = siteDeltas.filter((d) => d.kind === 'site_burned' || d.kind === 'site_raided');
    let stampedBurntStructure = false;

    if (!realized.has(stampKey)) {
      const mode: 'intact' | 'burnt' | 'ruined' =
        site.status === 'burned' || site.status === 'raided'
          ? 'burnt'
          : site.status === 'ruined' || site.archetype === 'ruin'
            ? 'ruined'
            : 'intact';
      workingChunk = stampChunkStructure(workingChunk, grid.palette, tileSet, mode);
      if (mode === 'burnt') stampedBurntStructure = true;

      // Write updated chunk into state.map.chunkGrid before spawning entities/fields onto those coordinates
      const nextChunks = new Map(nextState.map.chunkGrid!.chunks);
      const packed = packWorldCoord3D(workingChunk.cx, workingChunk.cy, workingChunk.cz);
      nextChunks.set(packed, workingChunk);
      const nextDirtyKeys = new Set(nextState.map.chunkGrid!.dirtyChunkKeys);
      nextDirtyKeys.add(packed);
      nextState = {
        ...nextState,
        map: {
          ...nextState.map,
          chunkGrid: {
            ...nextState.map.chunkGrid!,
            chunks: nextChunks,
            dirtyChunkKeys: nextDirtyKeys
          }
        }
      };

      // Spawn site inhabitants/ruins/artifacts cleanly; defer burnt/raided spawn to pending delta if present
      if (mode === 'burnt') {
        if (pendingRaidOrBurn.length === 0) {
          nextState = spawnSiteDeltaEffects(
            nextState,
            site,
            {
              id: stampKey,
              tick: macro.currentTick,
              siteId: site.id,
              kind: site.status === 'burned' ? 'site_burned' : 'site_raided',
              scarText: 'burned_cheek',
              summary: `${site.name} bears fresh scars from a recent raid.`
            },
            baseWx,
            baseWy,
            0
          );
        }
      } else if (mode === 'ruined') {
        const raiderTplId = findTemplateIdByCriteria(
          nextState.campaign,
          (t) => t.tags?.includes('raider') === true || t.tags?.includes('bandit') === true || t.attitude === 'hostile'
        );
        if (raiderTplId) {
          [nextState] = spawnEntity(nextState, raiderTplId, baseWx - 1, baseWy, undefined, undefined, 0);
        }
        nextState = materializeSiteArtifacts(nextState, site, baseWx, baseWy, 0);
      } else {
        const guardTplId = findTemplateIdByCriteria(
          nextState.campaign,
          (t) =>
            Boolean(t.tags?.includes('guard')) ||
            (t.isActor === true && t.tags?.includes('town') === true && t.fighter !== undefined)
        );
        if (guardTplId) {
          [nextState] = spawnEntity(nextState, guardTplId, baseWx, baseWy, undefined, undefined, 0);
        }
        nextState = materializeSiteArtifacts(nextState, site, baseWx + 1, baseWy, 0);
      }

      newlyMaterializedKeys.push(stampKey);
      materializedCount += 1;
    }

    // Apply unmaterialized Ring 2 deltas targeting this site without duplicating raid/burn effects
    const latestRaidBurnId = pendingRaidOrBurn[pendingRaidOrBurn.length - 1]?.id;
    for (const delta of siteDeltas) {
      const isRaidOrBurn = delta.kind === 'site_burned' || delta.kind === 'site_raided';
      if (isRaidOrBurn) {
        if (delta.id !== latestRaidBurnId) {
          newlyMaterializedKeys.push(delta.id);
          continue;
        }
        if (!stampedBurntStructure) {
          workingChunk = stampChunkStructure(workingChunk, grid.palette, tileSet, 'burnt');
          stampedBurntStructure = true;
          const nextChunks = new Map(nextState.map.chunkGrid!.chunks);
          const packed = packWorldCoord3D(workingChunk.cx, workingChunk.cy, workingChunk.cz);
          nextChunks.set(packed, workingChunk);
          nextState = {
            ...nextState,
            map: { ...nextState.map, chunkGrid: { ...nextState.map.chunkGrid!, chunks: nextChunks } }
          };
        }
      }
      nextState = spawnSiteDeltaEffects(nextState, site, delta, baseWx, baseWy, 0);
      newlyMaterializedKeys.push(delta.id);
      materializedCount += 1;
    }
  }

  for (const caravan of matchingCaravans) {
    nextState = spawnCaravanEntities(nextState, caravan, baseWx - 1, baseWy + 1);
    newlyMaterializedKeys.push(`caravan_stamp:${caravan.id}:${chunk.cx},${chunk.cy}`);
    materializedCount += 1;
  }

  if (newlyMaterializedKeys.length === 0) {
    return { state: nextState, chunk: workingChunk, materializedCount: 0 };
  }

  const latestMacro = nextState.macroWorld!;
  const updatedChunks = new Map(nextState.map.chunkGrid!.chunks);
  const packed = packWorldCoord3D(workingChunk.cx, workingChunk.cy, workingChunk.cz);
  updatedChunks.set(packed, workingChunk);
  const updatedDirtyKeys = new Set(nextState.map.chunkGrid!.dirtyChunkKeys);
  updatedDirtyKeys.add(packed);

  nextState = {
    ...nextState,
    map: {
      ...nextState.map,
      chunkGrid: {
        ...nextState.map.chunkGrid!,
        chunks: updatedChunks,
        dirtyChunkKeys: updatedDirtyKeys
      }
    },
    macroWorld: {
      ...latestMacro,
      materializedDeltaIds: appendMaterializedIds(latestMacro.materializedDeltaIds, newlyMaterializedKeys)
    },
    events: [
      ...nextState.events,
      {
        type: GameEventType.SiteMaterialized,
        siteId: matchingSites[0]?.id ?? matchingCaravans[0]?.targetSiteId ?? 'caravan',
        areaId,
        materializedCount
      }
    ]
  };

  return { state: nextState, chunk: workingChunk, materializedCount };
}

/**
 * Idempotently materializes initial site state, artifacts, and Ring 2 mutations for finite areas
 * declaring `macroSiteId` (or mapped via `rules.macroWorld.areaSiteBindings`) upon area load or wake.
 *
 * @param state Current immutable GameState.
 * @param areaId Active finite area identifier.
 * @returns Updated GameState.
 */
export function materializeMacroSitesForArea(state: GameState, areaId: string): GameState {
  const macro = state.macroWorld;
  if (!macro) return state;

  const areaDef = state.campaign.areas[areaId];
  const siteId = areaDef?.macroSiteId ?? state.campaign.rules.macroWorld?.areaSiteBindings?.[areaId];
  if (!siteId) return state;

  const site = macro.sites[siteId];
  if (!site) return state;

  const realized = new Set(macro.materializedDeltaIds);
  const stampKey = `area_stamp:${areaId}:${site.id}`;
  const pending = macro.pendingSiteDeltas.filter((d) => d.siteId === siteId && !realized.has(d.id));
  const pendingRaidOrBurn = pending.filter((d) => d.kind === 'site_burned' || d.kind === 'site_raided');
  const needsInitialStamp = !realized.has(stampKey);
  if (!needsInitialStamp && pending.length === 0) return state;

  let nextState = state;
  const rngFn = createMacroRng(macro.worldSeed, site.x * 131 + site.y * 17);
  const walkableCoord = findRandomWalkableCoord(nextState, rngFn, undefined, 0);
  const cx = walkableCoord?.x ?? Math.floor(nextState.map.width / 2);
  const cy = walkableCoord?.y ?? Math.floor(nextState.map.height / 2);
  const tiles = resolveMaterializationTileSet(nextState.campaign);
  const appliedIds: string[] = [];
  let materializedCount = 0;

  if (needsInitialStamp) {
    if ((site.status === 'burned' || site.status === 'raided') && pendingRaidOrBurn.length === 0) {
      if (tiles.burntTileId && getTileDefAt(nextState, cx, cy, 0)?.walkable) {
        nextState = {
          ...nextState,
          map: markMapPhysicsDirtyAt(
            setTileIdAt(nextState.map, cx, cy, tiles.burntTileId, 0),
            cx,
            cy,
            0,
            CHUNK_DIRTY_TEMP,
            nextState.globalTurn
          )
        };
      }
      nextState = spawnSiteDeltaEffects(
        nextState,
        site,
        {
          id: stampKey,
          tick: macro.currentTick,
          siteId: site.id,
          kind: site.status === 'burned' ? 'site_burned' : 'site_raided',
          scarText: 'burned_cheek',
          summary: `${site.name} bears fresh scars from a recent raid.`
        },
        cx,
        cy,
        0
      );
      materializedCount += 1;
    } else if (site.status === 'ruined' || site.archetype === 'ruin') {
      const raiderTplId = findTemplateIdByCriteria(
        nextState.campaign,
        (t) => t.tags?.includes('raider') === true || t.tags?.includes('bandit') === true || t.attitude === 'hostile'
      );
      if (raiderTplId && getTileDefAt(nextState, cx, cy, 0)?.walkable) {
        [nextState] = spawnEntity(nextState, raiderTplId, cx, cy, undefined, undefined, 0);
      }
      nextState = materializeSiteArtifacts(nextState, site, cx, cy, 0);
      materializedCount += 1;
    } else if (site.artifactIds.length > 0) {
      nextState = materializeSiteArtifacts(nextState, site, cx, cy, 0);
      materializedCount += 1;
    }
    appliedIds.push(stampKey);
  }

  const latestRaidBurnId = pendingRaidOrBurn[pendingRaidOrBurn.length - 1]?.id;
  for (const delta of pending) {
    const isRaidOrBurn = delta.kind === 'site_burned' || delta.kind === 'site_raided';
    if (isRaidOrBurn && delta.id !== latestRaidBurnId) {
      appliedIds.push(delta.id);
      continue;
    }
    if (isRaidOrBurn && tiles.burntTileId) {
      const targetDef = getTileDefAt(nextState, cx, cy, 0);
      if (targetDef?.walkable) {
        nextState = {
          ...nextState,
          map: markMapPhysicsDirtyAt(
            setTileIdAt(nextState.map, cx, cy, tiles.burntTileId, 0),
            cx,
            cy,
            0,
            CHUNK_DIRTY_TEMP,
            nextState.globalTurn
          )
        };
      }
    }
    nextState = spawnSiteDeltaEffects(nextState, site, delta, cx, cy, 0);
    appliedIds.push(delta.id);
    materializedCount += 1;
  }

  return {
    ...nextState,
    macroWorld: {
      ...nextState.macroWorld!,
      materializedDeltaIds: appendMaterializedIds(nextState.macroWorld!.materializedDeltaIds, appliedIds)
    },
    ...(materializedCount > 0
      ? {
          events: [
            ...nextState.events,
            {
              type: GameEventType.SiteMaterialized,
              siteId: site.id,
              areaId,
              materializedCount
            }
          ]
        }
      : {})
  };
}
