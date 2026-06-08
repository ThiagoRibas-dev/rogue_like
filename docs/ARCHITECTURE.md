# Architecture — Roguelike Project

A traditional turn-based ASCII/grid roguelike game built for modern browsers.

---

## 1. Project Summary

This project is a grid-based, turn-based roguelike game built using TypeScript, ROT.js, and Vite. The game runs natively in web browsers and is structured to compile efficiently and run deterministically. It uses an Entity-Component-System (ECS) architecture for managing game entities and state.

---

## 2. Module Dependency Graph

The dependency graph flows strictly downward. Circular imports are banned. Modules at lower layers (e.g., `types`, `constants`, `utils`) may never import from upper layers.

```
       [ main.ts ]  (Entry point, bootstrapping, event listeners)
            │
            ▼
       [ core/ ]    (Game loop, scheduler, RNG, ECS core)
            │
            ▼
     [ systems/ ]   (Pure game logic: movement, combat, AI, death)
       │        │
       ▼        ▼
  [ map/ ]    [ rendering/ ]  (Dungeon generation, FOV | drawing, camera, HUD)
       │        │
       └────┬───┘
            ▼
[ types/ | constants/ | utils/ ]  (Shared definitions, static data, helpers)
```

---

## 3. Major Subsystems

### Entity-Component-System (ECS-lite)
We use a low-overhead, framework-free ECS:
- **Entities** are simple numeric IDs (`EntityId` branded type), not class instances.
- **Components** are pure data objects (TS interfaces) with no methods. They are stored in a `ReadonlyMap<EntityId, ReadonlyArray<Component>>` within the global `GameState`.
- **Systems** are pure functions that query components, process game state changes, and return new state.

### Map Generation & FOV
- **Generator**: Uses `ROT.Map.Digger` wrapped in `src/map/generator.ts` to create standard room-and-corridor layouts.
- **FOV**: Uses `ROT.FOV.PreciseShadowcasting` wrapped in `src/map/fov.ts` to calculate light and visible cells based on wall transparency.

### Turn Scheduler
Turn management is wrapped in `src/core/scheduler.ts` using `ROT.Scheduler.Speed`. This speed/energy-based scheduler handles entities with varying speeds (e.g., fast monsters moving twice as often as the player).

### Random Number Generator (RNG)
A single seeded `ROT.RNG` instance is exported from `src/core/rng.ts`. All gameplay randomness (map generation, combat damage rolls, AI choices) must use this instance to enable deterministic replays and debugging.

### Rendering & Camera
- **Renderer**: Translates map tiles and entities into characters and colors drawn on `ROT.Display`.
- **Camera**: Handles camera scrolling/viewport offsets, keeping the player centered when maps are larger than the screen dimensions.
- **UI & HUD**: Draws HTML overlays (health bars, logs, status) surrounding the main canvas.

### Items & Inventory
- **Registries**: Items and Effects are defined declaratively in `src/constants/items.constants.ts` and `effects.constants.ts`. They are pure data objects keyed by string IDs.
- **Inventory System**: The player has an `InventoryComponent` holding references to item `EntityId`s. Picking up an item removes its `PositionComponent` (taking it off the map); dropping it restores it.
- **Equipment & Stats**: Equipment modifies stats dynamically at query time via `getEffectiveStats()` and `getEffectiveCapacity()`, rather than mutating base values on `FighterComponent` or `InventoryComponent`.
- **Item Effects**: Consumable effects are dispatched by `effects.system.ts` based on their declarative definitions.

---

## 4. Decision Log

### Flat Array for Tile Map
- **Decision**: We store the map's tile grid in a single flat array (`Tile[]`) rather than a 2D array (`Tile[][]`).
- **Rationale**: Index mathematics (`index = y * width + x`) is faster in JavaScript engine runtimes, avoids nested array checks, and makes state serialization/saving trivial.

### Speed Scheduler as Default
- **Decision**: We use `ROT.Scheduler.Speed` from day one rather than `ROT.Scheduler.Simple`.
- **Rationale**: While slightly more complex to set up, it enables varied entity speeds (haste, slow, weapon speed weights) without requiring a major refactor of the turn engine later.

### Encapsulated ROT.js Wrappers
- **Decision**: No direct `ROT.js` usage is allowed in systems or rendering modules. All calls must pass through custom project wrappers (e.g., `fov.ts`, `generator.ts`, `scheduler.ts`, `rng.ts`).
- **Rationale**: Minimizes coupling with the external library. If we decide to swap out ROT.js or upgrade to a version with breaking changes, the modifications are localized to single files.

### Data-Driven Tile Registry
- **Decision**: Map tiles reference string IDs (e.g., `"stone_wall"`, `"stone_floor"`) instead of numeric or enum types, resolving their properties from a shared `TILE_REGISTRY` database.
- **Rationale**: This decouples tile rendering and mechanical properties (walkability, transparency) from the map structure itself. It makes it extremely simple to serialize and save maps, add new tilesets, and load tile configurations from external YAML/JSON configuration files without modifying core movement or rendering code.

### Status Effect Flags Describe Mechanics, Not Flavor
- **Decision**: Behavioral flags on `StatusEffectDefinition` describe the *mechanical effect* (e.g., `skipTurn`, `confused`) rather than the *flavor* (e.g., `stunned`, `frozen`, `asleep`). The game loop queries a generic `shouldSkipTurn()` helper and never inspects specific effect IDs or names.
- **Rationale**: If flags were named after flavor (like `stunned`), every new skip-turn variant (Freeze, Paralysis, Sleep) would require either a new flag plus code changes in the game loop, or overloading a misleadingly-named flag. By naming flags after their mechanical consequence, any number of flavor effects can reuse `skipTurn: true` in their data definition and the game loop handles them all identically without modification. This keeps domain-specific knowledge inside the status-effect system and its data registry, where it belongs.

### Persistent Level Transitions via State Swapping
- **Decision**: We store the maps and non-player entities of inactive levels in a `levels` dictionary on the global `GameState`, swapping them into active ECS arrays only when transitioning floors.
- **Rationale**: Keeps active ECS queries and rendering passes lightweight since they only iterate over entities on the player's current floor, while fully preserving the state and layout of visited floors for traditional roguelike progression.

### Pre-emptive Data-Driven Architecture
- **Decision**: We strictly avoid Object-Oriented inheritance (classes/subclasses) for game entities. We prefer string IDs over TypeScript `enums`, and we design Actions to emit generic `Intents` (events) rather than executing hardcoded logic directly.
- **Rationale**: This paves the way for our end-goal of Modding & Extensibility. By using a "Prefab" pattern (plain TypeScript objects that mirror JSON schemas) and an Event-driven action system, we ensure that logic is never "baked in" to the engine. This makes the transition to loading external `.json`/`.yaml` campaigns and content trivial later on.

### Engine Input Architecture (Command Queue vs Promises)
- **Decision**: We use a decoupled input architecture. Keyboard and Network listeners run entirely outside the `ROT.Engine` loop. They push "Intents" into an entity's Command Queue. When it's an entity's turn to `act()`, it simply pops from the queue or, if the queue is empty, calls `engine.lock()` to await input.
- **Rationale**: While `async/await` Promises are more idiomatic modern JavaScript, a decoupled queue makes transitioning to Real-Time with Pause (RTwP) or Multiplayer trivial in the future, as the engine doesn't inherently halt on `await` calls; it only pauses when explicitly commanded via `lock()`.

### Global Overrides vs O(N) Iteration
- **Decision**: For state alterations that affect an entire collection identically (e.g., revealing the entire map, global buffs, freezing time), we prefer adding a boolean flag/override property to the parent object (e.g., `GameMap.isFullyExplored`) rather than iterating and mutating every single child object.
- **Rationale**: Rebuilding large immutable arrays (like 4,000+ map tiles) is computationally cheap but causes massive memory allocation spikes, which eventually triggers Garbage Collection pauses. Using global override flags avoids allocation entirely and scales safely to massive maps.

### "Bonus at Query Time" Stat Model
- **Decision**: Equipment bonuses are *never* baked into `FighterComponent` or `InventoryComponent`. Instead, a utility like `getEffectiveStats()` dynamically sums the base stats with equipment bonuses on demand.
- **Rationale**: If we mutated base stats when equipping/unequipping, we risk desyncs or permanent stat damage if an item is forcibly removed or destroyed. By computing the sum at query time, we compose cleanly with future stat modifiers like level-up gains or magical curses without refactoring combat logic.

### Declarative Item Effects Registry
- **Decision**: Item effects are defined as pure data objects (`ItemEffectDefinition`) mapped by string ID (`ITEM_EFFECTS`). The effect processor (`effects.system.ts`) interprets this data rather than executing inline functions.
- **Rationale**: Function closures cannot be serialized or safely synced over a network. Data objects can be trivially serialized for save/load (M7) and ultimately moved out of TypeScript into JSON/YAML configuration files for Modding (M9).

### Entity Ownership and Foreign Keys
- **Decision**: The ECS flattens the entity hierarchy. Components (like `InventoryComponent` or `EquipmentComponent`) do not "contain" other entities; they only store their `EntityId` (effectively a foreign key). When migrating an entity between distinct state boundaries (e.g., transitioning between map floors), the engine must manually traverse and package these owned "child" entities.
- **Rationale**: If we fail to resolve these foreign keys during a transition, the parent entity arrives in the new state holding IDs for items that were left behind in the previous state's arrays, resulting in soft-locks or missing components.
