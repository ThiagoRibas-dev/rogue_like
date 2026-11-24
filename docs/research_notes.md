# Research Notes — Ruleset 404 Elimination, Floor Transition Entity ID Collision & Fog-of-War Persistence

**Date:** 2026-11-24  
**Scope:** Bug Investigation & Architecture Research (Ruleset Base-Content 404s + Disappearing Doors/Stairs on Floor Transitions)  
**Target Tiers:** Tier 1 Core Console (`src/core/loader/`, `src/core/ecs/`, `src/core/save.ts`, `src/systems/`, `src/rendering/`, `src/types/`) & Tier 2 Ruleset Cartridges (`src/rulesets/classic/`, `src/rulesets/dnd35e/`)

---

## 1. Executive Summary of Findings

Three separate root causes — one browser-console 404 loading bug, one **critical ECS entity ID collision bug**, and one Fog-of-War rendering gap — explain every symptom observed:

1. **Chrome Console `404` Errors (`data/rulesets/{classic,dnd35e}/*.json`):** [`loadRulesetBaseContent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader/system_content_loader.ts#L107-L122) speculatively `fetch()`es all four legacy base filenames (`items.json`, `entities.json`, `status.json`, `effects.json`) for every ruleset without querying the cartridge for which base files actually exist on disk.
2. **Critical Bug — Doors & Stairs Up Deleted/Overwritten After Moving & Running Actor Turns on Floor 2 (`shroudgarde_inn_cellar`):** Both [`generateAndPopulateAreaFloor`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_generation_spawner.ts#L81-L231) and [`wakeSavedAreaFloor`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_wake_respawn.ts#L104-L245) spawn new floor entities into a local `tempState`, incrementing `tempState.nextEntityId` and `tempState.nextItemInstanceId`, and then **discard both counters** when returning to [`processChangeAreaIntent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts#L87-L304). Because portals (`stairs_up`, `stairs_down`) and doors (`iron_gate`) are the **first entities allocated** on a newly generated floor, subsequent `createEntity()` calls (spell fields/auras, projectiles, corpses, loot drops, summons) re-allocate their exact `EntityId`s and overwrite their components in `state.components`!
3. **Visual Gap — Explored Doors & Stairs Vanish Out of FOV:** [`buildViewportSnapshot`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts#L103-L173) gates **all** entity rendering strictly behind `if (isVisible)`. Because stairs (`ComponentType.Portal`) and doors (`Structural.isDoor` / `iron_gate`) are entities sitting atop bare walkable floor tiles (`crypt_floor`), walking out of FOV / `fovRadius` causes them to visually disappear into blank floor until the player regains line of sight.

---

## 2. Detailed Cross-Referenced Analysis

### Issue 1: Chrome Console `404` Errors on Ruleset Base Content

- **Observed Console Errors:**
  - `classic` (`default` campaign): 4 × `404` for `data/rulesets/classic/{items,entities,status,effects}.json`.
  - `dnd35e` (`realms-of-shroudgarde`): 2 × `404` for `data/rulesets/dnd35e/{items,entities}.json`.
- **On-Disk State Verified:**
  - `public/data/rulesets/classic/` does not exist at all (`classic` defines items/entities/status/effects per-campaign and returns `[]` from [`classicRulesetContract.getSystemContentFiles()`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/classic/classic_ruleset.ts#L34-L36)).
  - `public/data/rulesets/dnd35e/` contains `status.json` and `effects.json` (`200 OK`), while SRD items are modular files under `items/<id>.json` loaded via [`dnd35eRulesetContract.getSystemContentFiles()`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/dnd35e_ruleset.ts#L240-L242) (`DND35E_SYSTEM_CONTENT_FILES`), and entities are campaign-defined. Neither `dnd35e/items.json` nor `dnd35e/entities.json` exists.
  - All 5 optional campaign files (`knowledge_propagation.json`, `rumor_propagation.json`, `nemesis_hierarchies.json`, `relationship_thresholds.json`, `trigger_templates.json`) exist on disk in `default`, `dnd35e-crypt`, `realms-of-shroudgarde`, and `shroudgarde` (only `megacampaign` omits `relationship_thresholds.json`).
- **Mechanism in Code:**
  - [`loadCampaign`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader.ts#L168-L171) calls `loadRulesetBaseContent(rulesetId)` alongside `loadRulesetSystemContent(rulesetId)`.
  - [`loadRulesetBaseContent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader/system_content_loader.ts#L107-L122) hardcodes 4 unconditional calls to [`fetchOptionalJson`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader/system_content_loader.ts#L43-L51). Although `fetchOptionalJson` returns `{}` when `!res.ok`, Chrome still emits red console `Failed to load resource: 404` errors before JS runs.
  - By contrast, [`loadRulesetSystemContent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/loader/system_content_loader.ts#L83-L100) only fetches paths explicitly declared by `ruleset.getSystemContentFiles?.()`, and [`validateRulesetDiskParity`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/scripts/run-validator.ts#L568-L620) guarantees 100% parity with disk.
  - Note: [`scripts/run-validator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/scripts/run-validator.ts#L343-L351) and [`tests/helpers.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/tests/helpers.ts#L72-L80) mirror the same `['items', 'entities', 'status', 'effects']` loop on disk and should stay laterally aligned.

---

### Issue 2 (Critical): Disappearing Doors & Stairs Up on Newly Generated Floors (`EntityId` Collision)

- **Why Floor 2 (`shroudgarde_inn_cellar`) Loses `stairs_up` and `iron_gate` Doors Specifically:**
  - [`public/data/campaigns/realms-of-shroudgarde/areas.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/campaigns/realms-of-shroudgarde/areas.json#L169-L197) defines `shroudgarde_inn_cellar` with `"generatorType": "digger"`, `"door": "iron_gate"`, and two connections (`shroudgarde_courtyard` `'up'`, `megadungeon_hub` `'down'`).
  - [`generator_stages.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/map/generator_stages.ts#L256-L263) places floor tiles (`palette.floor` = `crypt_floor`) under every door coordinate and pushes `{ templateId: palette.door, x: dx, y: dy }` (`iron_gate`) at the front of `finalPlacedEntities`.
  - When transitioning into `shroudgarde_inn_cellar` for the first time, [`processChangeAreaIntent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts#L187-L195) calls [`generateAndPopulateAreaFloor`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_generation_spawner.ts#L81-L231):
    1. Line `120`: creates `let tempState: GameState = { ...state, entities: [], components: new Map(), map: targetMap };` — copying `state.nextEntityId` (say `N`).
    2. Lines `122-177`: allocates the **first two IDs** (`N`, `N+1`) for `generated.portals` (`stairs_up`, `stairs_down`) via `createEntity(tempState)`.
    3. Lines `179-220`: allocates the **next batch of IDs** (`N+2`, `N+3`, ...) for `generated.placedEntities` — starting with **every `iron_gate` door**, followed by monsters and items (`spawnEntity` / `spawnItem`, which call `createEntity` and `promoteItemTemplate` incrementing `tempState.nextEntityId` and `tempState.nextItemInstanceId`).
    4. Lines `222-230`: returns `{ targetMap, targetRooms, targetLastSpawnTurn, spawnX, spawnY, nextEntities: tempState.entities, nextComponents: tempState.components }` — **OMITTING `tempState.nextEntityId` and `tempState.nextItemInstanceId`!**
  - Back in [`processChangeAreaIntent`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map.system.ts#L265-L277), `nextState` inherits `...state`, keeping the **stale** pre-transition `state.nextEntityId` (`N`) and `state.nextItemInstanceId`!
  - **The exact same bug exists in [`wakeSavedAreaFloor`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_wake_respawn.ts#L202-L245):** when a revisited area triggers Encounter Director respawns, `tempState` spawns new entities/items via `spawnItem`/`spawnEntity` (lines `210-218`), copies `nextEntities` and `nextComponents`, and **drops `tempState.nextEntityId` and `tempState.nextItemInstanceId`**.
- **Destructive Sequence During Gameplay Turns:**
  - As soon as combat/exploration begins on Floor 2 and any system allocates a new entity via [`createEntity`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts#L9-L25) (corpses on monster death, spell fields/emanations, arrows/thrown items, dropped loot, summons):
    - `createEntity` allocates `newId = state.nextEntityId` (`N`) — the exact ID owned by `stairs_up`!
    - Line `15` executes `nextComponents.set(newId, {})`, **immediately erasing the `Portal`, `Position`, `Renderable`, and `Tags` components of `stairs_up`**.
    - Subsequent entity spawns (`N+1`, `N+2`, `N+3`, ...) overwrite `stairs_down` and then each `iron_gate` door in allocation order!
    - When those transient entities later expire via [`removeEntity`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_core.ts#L156-L166) (e.g., field expiration or projectile cleanup), the collided IDs are removed from `state.entities` and `state.spatialIndex` altogether.
- **Full Audit of `tempState` and `nextEntityId` / `nextItemInstanceId` Propagation Across `src/`:**
  - Inspected every match of `tempState` and `nextEntityId` across `src/`:
    - `src/core/ecs/ecs_core.ts` (`createEntity`): increments `nextEntityId`, but blindly overwrites `nextComponents.set(newId, {})` even if `state.components.has(newId)` (important when loading an older save already poisoned by stale `nextEntityId`).
    - `src/core/save.ts` ([`deserializeGameState`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/save.ts#L192-L242)): restores `sState.nextEntityId` directly without clamping above the maximum existing `EntityId` across `sState.entities`, `sState.components`, `sState.persistentEntities`, and `sState.areas`.
    - No other `tempState` sites drop `nextEntityId` or `nextItemInstanceId`.

---

### Issue 3 (Visual): Explored Doors & Stairs Vanish in Fog of War

- In [`buildViewportSnapshot`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/viewport_snapshot.ts#L71-L173):
  - `isExplored` and `isVisible` are computed per tile (`lines 72-73`).
  - Explored terrain tiles render dimmed (`wallDimFg` / `floorDimFg` in ASCII, `fogCells` `alpha: 0.55` in sprite mode).
  - Entity lookup via `state.spatialIndex.get(\`${mapX},${mapY}\`)` runs **strictly inside `if (isVisible)`** (`line 103`).
  - Because `Portal` stairs are bare floor tiles underneath a `Portal` entity (`stairs_up` tile is NOT stamped onto the map grid when spawned by [`map_generation_spawner.ts:149-176`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/map/map_generation_spawner.ts#L149-L176)) and `iron_gate` / `wooden_door` sit atop `palette.floor`, stepping out of FOV makes explored doors and stairs disappear visually (even though [`buildInspectTooltip`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/inspect_tooltip.ts#L289-L313) still reveals them when hovering explored tiles).
  - [`drawCell`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/display.ts#L210-L217) draws the top entity in `entities[]` using `top.fg` / `top.spriteId`; therefore in Fog of War (`!isVisible && isExplored`), rendering static architectural entities (`Portal` / door) with `wallDimFg` (or `entityFg` muted to dim wall color in ASCII, and normal `spriteId` beneath `0.55` fog overlay in sprite mode) preserves explored dungeon memory cleanly while keeping actors, items, chests, traps, corpses, and fields strictly hidden outside active FOV.

---

## 3. Architectural Rules & SSOT Ownership Mapping

Per `AGENTS.md` and `docs/SSOT_CONSOLE.md`:
- **Rule 4 & Rule 5:** Research compiled before `implementation_plan.md`; wait for confirmation before Step 4 and approval before writing code.
- **Rule 8 (Bug Analysis First):** Root causes verified from source before modifying runtime logic.
- **Rule 11 & Rule 12:** Strict TypeScript (no `any`, `exactOptionalPropertyTypes: true`), named constants (no magic literals).
- **Rule 15 (Cascading Effects):** Mapped across Upstream / Downstream / Lateral below.
- **Rule 16 (Tier 1 vs Tier 2):** Base-file declarations live on Tier 2 (`RulesetContract.getBaseContentFiles?()`); Tier 1 loader (`system_content_loader.ts`) consumes them agnostically without inspecting ruleset IDs.
- **Rule 21 (Zero Content-ID Branching):** Fog-of-War static feature check uses structural ECS components/tags (`ComponentType.Portal`, `Structural.isDoor === true`, `Tags` containing `'door'` or `'portal'`) — never `templateId === 'iron_gate'`.

| Responsibility | Canonical SSOT Owner (`ssot_console.json` / `ssot_dnd35e.json`) | Interaction |
|---|---|---|
| Ruleset base/system content loading | `src/core/loader/system_content_loader.ts` | Reads `RulesetContract.getBaseContentFiles?()` |
| Ruleset disk-parity & campaign validation | `scripts/run-validator.ts` + `tests/helpers.ts` | Mirrors `getBaseContentFiles?()` on disk |
| Core entity ID allocation | `src/core/ecs/ecs_core.ts` | `createEntity` collision guard |
| Area generation & population | `src/systems/map/map_generation_spawner.ts` | Must return `nextEntityId` & `nextItemInstanceId` |
| Area wake & director respawn | `src/systems/map/map_wake_respawn.ts` | Must propagate `nextEntityId` & `nextItemInstanceId` |
| Floor transition orchestrator | `src/systems/map.system.ts` | Applies `genResult` ID counters into `nextState` |
| Save game rehydration | `src/core/save.ts` | Clamps `nextEntityId` above all existing area/persistent IDs |
| Viewport DTO snapshot projection | `src/rendering/viewport_snapshot.ts` | Projects explored static architectural entities in Fog of War |

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| **1. Add `RulesetContract.getBaseContentFiles?()` & use in `loadRulesetBaseContent`** | Implemented optionally by `dnd35eRulesetContract` (`status.json`, `effects.json`) and omitted/`[]` on `classicRulesetContract`; test mocks without it default safely to `[]` | `loadCampaign` merges only declared base files; Chrome console has zero speculative 404s | Mirrors `getSystemContentFiles?()` in `scripts/run-validator.ts`, `tests/helpers.ts`, and `validateRulesetDiskParity()` |
| **2. Return & propagate `nextEntityId` / `nextItemInstanceId` from `generateAndPopulateAreaFloor` & `wakeSavedAreaFloor`** | Callers of `generateAndPopulateAreaFloor` (`map.system.ts`) and `wakeSavedAreaFloor` (`map.system.ts`) | Preserves unique monotonic `EntityId`s and `ItemInstanceId`s across floor transitions, respawns, corpses, fields, projectiles, and summons | Eliminates ID collisions between `stairs_up`, `stairs_down`, `iron_gate` doors, and transient/spawned actors across all campaigns & tests |
| **3. Guard `createEntity` against live ID reuse + clamp `nextEntityId` on `deserializeGameState`** | Any `GameState` loaded from older saves (`localStorage` / JSON save files) or handcrafted test fixtures | Existing save files with stale `nextEntityId` heal on load and never overwrite portals, doors, or player items | Companion defense alongside `map_generation_spawner.ts` and `map_wake_respawn.ts` |
| **4. Render explored static architectural entities (`Portal` / `isDoor`) when `isExplored && !isVisible`** | Reads existing `state.spatialIndex`, `ComponentType.Portal`, `ComponentType.Structural`, `ComponentType.Tags`, `ComponentType.Renderable` (`actor`/`item`/`field` excluded) | `ViewportSnapshot.cells` & `glyphOverlays` keep explored stairs and doors visible (dimmed in ASCII, under `0.55` fog in sprites); mobile units & loot stay hidden | Matches `inspect_tooltip.ts` explored-tile behavior; respects `renderer.ts` `cellEquals` dirty-diffing |

---

## 5. Open Questions / Assumptions to Confirm Before Step 4

1. **Scope of Explored Fog-of-War Entity Rendering:** I assume only static architectural fixtures — **Portals (`<`, `>`, `O`) and Doors (`+`, `/`, `#`)** (excluding `Actor`, `Fighter`, `Item`, `Field`, and `Corpse` entities) — should remain visible when `isExplored && !isVisible`. Chests, ground items, corpses, and monsters should remain hidden outside active FOV unless you also want unopened chests or fixed furniture (`Structural` non-actors?) remembered in Fog of War. Please confirm which you prefer!
2. **Optional `relationship_thresholds.json` in `megacampaign`:** Only `megacampaign` omits `relationship_thresholds.json` (which only fails silently via `parseOptionalResponse` if played); our target issue (`realms-of-shroudgarde` & `default`) already has all 5 optional campaign files on disk. Confirming we should keep `megacampaign` out of scope here unless you want all optional campaign 404s eliminated too.
