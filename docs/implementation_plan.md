# Implementation Plan — Ruleset Base-Content 404 Elimination & Floor-Transition Entity ID Collision Fix

**Date:** 2026-11-24  
**Research Reference:** [research_notes.md](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/research_notes.md)  
**Tiers Affected:** Tier 1 Core Console (`src/types/`, `src/core/loader/`, `src/core/ecs/`, `src/core/save.ts`, `src/systems/map/`, `src/systems/map.system.ts`) & Tier 2 Ruleset Cartridges (`src/rulesets/classic/`, `src/rulesets/dnd35e/`)  
**Explicit Exclusions (Out of Scope per User Request):** Fog-of-War entity rendering (`src/rendering/viewport_snapshot.ts`) and `megacampaign`'s optional `relationship_thresholds.json`.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner | Evicted / Legacy Path |
|---|---|---|
| Declaration of base ruleset content files (`items`/`entities`/`status`/`effects`) | `RulesetContract.getBaseContentFiles?()` (`classic_ruleset.ts`, `dnd35e_ruleset.ts`) | Speculative 4-file probe in `loadRulesetBaseContent`, `run-validator.ts`, & `tests/helpers.ts` |
| Fetching declared ruleset base content without 404s | [`src/core/loader/system_content_loader.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader/system_content_loader.ts) | Unconditional `fetchOptionalJson` for non-existent `{classic,dnd35e}/{items,entities,status,effects}.json` |
| Monotonic `nextEntityId` / `nextItemInstanceId` across floor generation | [`src/systems/map/map_generation_spawner.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_generation_spawner.ts) | Returning `nextEntities` & `nextComponents` while discarding `tempState.nextEntityId` / `tempState.nextItemInstanceId` |
| Monotonic `nextEntityId` / `nextItemInstanceId` across wake respawns | [`src/systems/map/map_wake_respawn.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_wake_respawn.ts) | Copying respawned entities out of `tempState` without updating `nextState` ID counters |
| Floor transition counter commit | [`src/systems/map.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts) | Inheriting stale pre-transition `state.nextEntityId` / `state.nextItemInstanceId` on `nextState` |
| Collision-free Entity ID allocation & save healing | [`src/core/ecs/ecs_core.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts) & [`src/core/save.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/save.ts) | Unchecked `nextComponents.set(newId, {})` overwrite & trusting poisoned save `sState.nextEntityId` |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / Mechanism | Passes "New Content Mod" Litmus Test? |
|---|---|---|---|
| Determining which base JSON files a ruleset cartridge loads | `if (rulesetId === 'dnd35e') fetch('status.json')` in `system_content_loader.ts`, or adding empty `{}` stub JSON files | Optional `RulesetContract.getBaseContentFiles?(): ReadonlyArray<RulesetBaseFileDescriptor>` mirrored by `validateRulesetDiskParity()` | Yes — any new cartridge or disk addition declares its base files cleanly in cartridge metadata with zero Tier 1 branching |
| Preventing new entities/doors/stairs from colliding across floor transitions | Special-casing `stairs_up` or `iron_gate` IDs into negative/reserved ranges | Returning & committing monotonic `nextEntityId` / `nextItemInstanceId` from all `tempState` spawners + universal `isEntityIdInUse` guard in `createEntity` + high-water-mark clamp on load | Yes — applies uniformly to every entity type (portals, doors, monsters, chests, corpses, fields, items) |

---

## 3. Step-by-Step Implementation & Code Snippets

### Task 1: Eliminate Ruleset Base-Content 404 Errors (`getBaseContentFiles`)

#### 1.1 Add `RulesetBaseContentKey`, `RulesetBaseFileDescriptor`, and `getBaseContentFiles?()` — `src/types/ruleset.types.ts`
Add beside `RulesetSystemFileDescriptor` and `getSystemContentFiles?()`:

```ts
/**
 * Supported campaign registry keys populated by cartridge base content files.
 */
export type RulesetBaseContentKey = 'items' | 'entities' | 'status' | 'effects';

/**
 * Descriptor declaring a root-level base JSON file loaded from `public/data/rulesets/<rulesetId>/`.
 */
export interface RulesetBaseFileDescriptor {
  readonly key: RulesetBaseContentKey;
  readonly filename: string;
}
```

Inside `RulesetContract`:
```ts
  /**
   * Returns the list of declarative base registry files loaded from `public/data/rulesets/<rulesetId>/`.
   * Rulesets omitting this hook (or returning `[]`) issue zero base-content fetches.
   * @returns Array of base content file descriptors.
   */
  getBaseContentFiles?(): ReadonlyArray<RulesetBaseFileDescriptor>;
```

#### 1.2 Declare Exact Base Content Files Per Cartridge
- **`src/rulesets/classic/classic_ruleset.ts`** (right below `getSystemContentFiles()`):
```ts
  getBaseContentFiles() {
    return [];
  },
```
- **`src/rulesets/dnd35e/dnd35e_ruleset.ts`**:
```ts
const DND35E_BASE_CONTENT_FILES: ReadonlyArray<RulesetBaseFileDescriptor> = [
  { key: 'status', filename: 'status.json' },
  { key: 'effects', filename: 'effects.json' }
];
```
And inside `dnd35eRulesetContract`:
```ts
  getBaseContentFiles(): ReadonlyArray<RulesetBaseFileDescriptor> {
    return DND35E_BASE_CONTENT_FILES;
  },
```

#### 1.3 Update `loadRulesetBaseContent` — `src/core/loader/system_content_loader.ts`
Replace the unconditional 4-file `fetchOptionalJson` calls with descriptor-driven fetching (emitting **0 network requests** when `getBaseContentFiles()` is empty):

```ts
export async function loadRulesetBaseContent(rulesetId: RulesetId): Promise<{
  readonly items: Record<string, unknown>;
  readonly entities: Record<string, unknown>;
  readonly status: Record<string, unknown>;
  readonly effects: Record<string, unknown>;
}> {
  const ruleset = getRuleset(rulesetId);
  const baseDescriptors = ruleset.getBaseContentFiles?.() ?? [];
  if (baseDescriptors.length === 0) {
    return { items: {}, entities: {}, status: {}, effects: {} };
  }

  const rulesetBasePath = `${import.meta.env.BASE_URL}data/rulesets/${ruleset.id}`;
  const loaded = await Promise.all(
    baseDescriptors.map(async (desc) => ({
      key: desc.key,
      data: await fetchOptionalJson(`${rulesetBasePath}/${desc.filename}`)
    }))
  );

  const buckets: Record<'items' | 'entities' | 'status' | 'effects', Record<string, unknown>> = {
    items: {},
    entities: {},
    status: {},
    effects: {}
  };
  for (const entry of loaded) {
    buckets[entry.key] = { ...buckets[entry.key], ...entry.data };
  }
  return buckets;
}
```

#### 1.4 Sync Disk Loaders & Parity Validator — `scripts/run-validator.ts` & `tests/helpers.ts`
- In both [`scripts/run-validator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/scripts/run-validator.ts#L343-L351) and [`tests/helpers.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/tests/helpers.ts#L72-L80), iterate `ruleset.getBaseContentFiles?.() ?? []` instead of `['items', 'entities', 'status', 'effects']`:
```ts
  const baseDescriptors = ruleset.getBaseContentFiles?.() ?? [];
  for (const desc of baseDescriptors) {
    const baseRecord = readRulesetJson(desc.filename);
    if (Object.keys(baseRecord).length > 0) {
      campaignData[desc.key] = {
        ...baseRecord,
        ...((campaignData[desc.key] as Record<string, unknown> | undefined) ?? {})
      };
    }
  }
```
- In `validateRulesetDiskParity()` (`scripts/run-validator.ts`), enforce symmetric parity for `getBaseContentFiles()`:
  1. Every descriptor in `ruleset.getBaseContentFiles?.() ?? []` exists on disk.
  2. Every root-level `items.json`, `entities.json`, `status.json`, or `effects.json` present on disk in `public/data/rulesets/<rulesetId>/` is declared in `getBaseContentFiles()`.

---

### Task 2: Fix Floor-Transition & Respawn Entity ID Counter Drops + Defensive Guards

#### 2.1 Return Updated ID Counters from `generateAndPopulateAreaFloor` — `src/systems/map/map_generation_spawner.ts`
Update the return type signature and returned object at [`map_generation_spawner.ts:87-95,222-230`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_generation_spawner.ts#L222-L230):

```ts
): {
  targetMap: GameMap;
  targetRooms: ReadonlyArray<RoomBounds>;
  targetLastSpawnTurn: number;
  spawnX: number;
  spawnY: number;
  nextEntities: ReadonlyArray<EntityId>;
  nextComponents: Map<EntityId, Readonly<Record<string, Component>>>;
  nextEntityId: number;
  nextItemInstanceId: number;
} {
  ...
  return {
    targetMap,
    targetRooms,
    targetLastSpawnTurn,
    spawnX,
    spawnY,
    nextEntities: tempState.entities,
    nextComponents: tempState.components as Map<EntityId, Readonly<Record<string, Component>>>,
    nextEntityId: tempState.nextEntityId,
    nextItemInstanceId: tempState.nextItemInstanceId
  };
}
```

#### 2.2 Propagate ID Counters in `wakeSavedAreaFloor` — `src/systems/map/map_wake_respawn.ts`
At [`map_wake_respawn.ts:202-234`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_wake_respawn.ts#L202-L234), apply `tempState.nextEntityId` and `tempState.nextItemInstanceId` onto `nextState`:

```ts
      nextEntities = [...tempState.entities];
      nextComponents = tempState.components as Map<EntityId, Readonly<Record<string, Component>>>;

      nextState = {
        ...nextState,
        nextEntityId: tempState.nextEntityId,
        nextItemInstanceId: tempState.nextItemInstanceId,
        events: [
          ...nextState.events,
          {
            type: GameEventType.AreaRespawned,
            areaId: targetAreaId,
            newEntitiesSpawned: directorResult.newEntities.length
          }
        ]
      };
```

#### 2.3 Commit Updated ID Counters in `processChangeAreaIntent` — `src/systems/map.system.ts`
At [`map.system.ts:135-277`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts#L135-L277), preserve `nextEntityId` and `nextItemInstanceId` across both saved-area wake and fresh area generation:

```ts
  let nextEntityId = state.nextEntityId;
  let nextItemInstanceId = state.nextItemInstanceId;
  ...
  if (savedTargetArea !== undefined) {
    ...
    state = wakeResult.state;
    nextEntityId = state.nextEntityId;
    nextItemInstanceId = state.nextItemInstanceId;
    ...
  } else {
    const genResult = generateAndPopulateAreaFloor(state, targetAreaId, spawnX, spawnY, nextPersistentEntities);
    targetMap = genResult.targetMap;
    targetRooms = genResult.targetRooms;
    targetLastSpawnTurn = genResult.targetLastSpawnTurn;
    spawnX = genResult.spawnX;
    spawnY = genResult.spawnY;
    nextEntities = genResult.nextEntities;
    nextComponents = genResult.nextComponents;
    nextEntityId = genResult.nextEntityId;
    nextItemInstanceId = genResult.nextItemInstanceId;
  }
  ...
  let nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    map: targetMap,
    nextEntityId,
    nextItemInstanceId,
    currentAreaId: targetAreaId,
    activeRooms: targetRooms,
    lastSpawnTurn: targetLastSpawnTurn,
    areas: nextAreas,
    persistentEntities: nextPersistentEntities,
    fovNeedsUpdate: true,
    cachedFov: new Set()
  };
```

#### 2.4 Collision Guard in `createEntity` — `src/core/ecs/ecs_core.ts`
Protect live entities (and dormant/persistent areas) even if an earlier save or test fixture had a stale `nextEntityId`:

```ts
function isEntityIdInUse(state: GameState, id: EntityId): boolean {
  if (state.components.has(id)) return true;
  if (state.persistentEntities?.has(id)) return true;
  if (state.areas) {
    for (const area of state.areas.values()) {
      if (area.components.has(id)) return true;
    }
  }
  return false;
}

export function createEntity(state: GameState): [GameState, EntityId] {
  let candidateId = state.nextEntityId;
  let newId: EntityId = toEntityId(candidateId);
  while (isEntityIdInUse(state, newId)) {
    candidateId++;
    newId = toEntityId(candidateId);
  }

  const nextEntities: ReadonlyArray<EntityId> = [...state.entities, newId];
  const nextComponents: Map<EntityId, Readonly<Record<string, Component>>> = new Map(state.components);
  nextComponents.set(newId, {});

  const nextState: GameState = {
    ...state,
    entities: nextEntities,
    components: nextComponents,
    nextEntityId: candidateId + 1
  };

  return [nextState, newId];
}
```

#### 2.5 High-Water-Mark Clamp in `deserializeGameState` — `src/core/save.ts`
Compute `Math.max(sState.nextEntityId, maxExistingId + 1)` across `entities`, `components`, `persistentEntities`, `areas`, `factionEntityIds`, and `areaEntityIds` on save load so previously poisoned saves immediately self-heal.

---

### Task 3: Regression Tests & SSOT Sync

1. Create `tests/floor_transition_entity_id_and_loader.test.ts`:
   - Transition from `shroudgarde_courtyard` to `shroudgarde_inn_cellar` (`realms-of-shroudgarde`) via `processChangeAreaIntent`: assert `state.nextEntityId` exceeds the maximum ID on Floor 2, record all `Portal` (`stairs_up`, `stairs_down`) and door (`iron_gate`) entities, spawn 20+ new entities/items/fields (including `createEntity` + `removeEntity`), and assert zero portals or doors were overwritten or removed.
   - Revisit a floor whose `respawnTimerTurns` triggers director reinforcement in `wakeSavedAreaFloor`: assert `state.nextEntityId` advances past newly spawned entities.
   - Verify `createEntity` and `deserializeGameState` heal/skip stale `nextEntityId` without overwriting existing components.
   - Verify `classicRulesetContract.getBaseContentFiles?.() ?? []` is empty (`loadRulesetBaseContent('classic')` makes 0 `fetch` calls) and `dnd35eRulesetContract.getBaseContentFiles?.()` matches `status.json` + `effects.json` only.
2. Update `docs/ssot/ssot_console.json` (reflecting new `RulesetBaseContentKey`, `RulesetBaseFileDescriptor`, and updated `createEntity`/`deserializeGameState` behavior if applicable), run `bun scripts/map-codebase.ts`, and execute `./verify.sh`.

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| `RulesetContract.getBaseContentFiles?()` & `loadRulesetBaseContent` | `classicRulesetContract` returns `[]`; `dnd35eRulesetContract` returns `status.json` & `effects.json`; mocks omitting hook default to `[]` | Zero speculative Chrome 404 network errors when loading `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, or `shroudgarde` | Synced identically in `scripts/run-validator.ts` (`validateRulesetDiskParity`) and `tests/helpers.ts` |
| Return `nextEntityId` / `nextItemInstanceId` in `generateAndPopulateAreaFloor` & `wakeSavedAreaFloor` + commit in `processChangeAreaIntent` | Checked all callers of both functions (`src/systems/map.system.ts` is the sole caller) | Subsequent corpses, fields, projectiles, loot, and summons receive strictly fresh IDs; Floor 2 `stairs_up`, `stairs_down`, and `iron_gate` doors remain intact | Eliminates cross-floor ID collision across all campaigns (`realms-of-shroudgarde`, `default`, `megacampaign`, `dnd35e-crypt`, `shroudgarde`) |
| `createEntity` `isEntityIdInUse` guard & `deserializeGameState` high-water-mark clamp | All ECS allocations and browser/JSON save loads | Protects and self-heals existing saves created before the floor-transition fix | Zero performance regression (`Map.has` across live, persistent, and saved area maps) |

---

## 5. Verification Plan

1. Run `./verify.sh` across all 8 stages (`tsc --noEmit`, `prettier`, `eslint`, `depcruise` + file length, `knip`, `bun test`, `vite build`, `run-validator.ts` including disk parity & SSOT parity).
2. **Manual Playtest Scenario:** Start `realms-of-shroudgarde`, open Chrome DevTools Console + Network tab (confirm 0 `404`s on `/data/rulesets/...`), take the stairs down to `Shroudgarde Inn Cellar`, walk around, fight enemies / trigger spell effects and actor turns, and confirm both the `<` stairs back up and all `#`/`/` iron portcullises remain intact and interactable.
