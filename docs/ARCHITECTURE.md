# Architecture — Roguelike Project

A traditional turn-based ASCII/grid roguelike game built for modern browsers.

---

## 1. Project Summary

This project is a grid-based traditional roguelike game featuring dual **Turn-Based** and **Real-Time with Pause (RTwP)** engine modes, built using TypeScript, ROT.js, and Vite. It runs natively in web browsers and is structured to compile efficiently and run deterministically. It uses an Entity-Component-System (ECS) architecture for managing game entities and state.

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
- **View Controls**: Implements dynamic CSS 3D transforms (Rotate 45° and 3D Tilt) on the canvas wrapper to achieve a flexible 2.5D visual style without complicating the underlying 2D ROT.js renderer.

### Items & Inventory
- **Registries**: Items and Effects are defined declaratively in JSON registries and loaded into the `GameState`. They are pure data objects keyed by string IDs.
- **Inventory System**: The player has an `InventoryComponent` holding references to item `EntityId`s. Picking up an item removes its `PositionComponent` (taking it off the map); dropping it restores it.
- **Equipment & Stats**: Equipment modifies stats dynamically at query time via `getEffectiveStats()` and `getEffectiveCapacity()`, rather than mutating base values on `FighterComponent` or `InventoryComponent`.
- **Item Effects**: Consumable effects are dispatched by `effects.system.ts` based on their declarative definitions.

### Status Effects Engine
- **Declarative Effects**: A declarative `StatusEffectDefinition` registry describes the effect behavior (duration, stat modifiers, per-turn damage/heal, and flags like `stunned` or `skipTurn`).
- **Processing**: The `status-effect.system.ts` processes these ticks every turn, removing expired effects and modifying stats dynamically in conjunction with `getEffectiveStats()`.

### AI Pipeline & Factions
- **Composable Behaviors**: AI logic is split into discrete modules (`hunt`, `flee`, `ranged`, `wander`). These are composed into data-driven AI Profiles (e.g., `MeleeAggressive`, `RangedArcher`).
- **Faction Matrix**: Hostility is determined by looking up `FactionId`s in a `HOSTILITY_MATRIX`, replacing hardcoded "player vs monster" logic to allow infighting and neutral NPCs.
- **Line of Sight & Cooldowns**: AI modules utilize the FOV system (`computeFOV`) to ensure they only attack visible targets, and the `AIComponent` statefully tracks ability cooldowns to prevent spell spam.

### Save & Persistence
- **State Serialization**: The `GameState` is strictly immutable and contains all active data, making serialization to JSON for `localStorage` saving trivial via `src/core/save.ts`.
- **Inactive Levels**: Non-active floors are stored in a compressed/serialized format within the `GameState` and swapped back into active ECS arrays upon level transitions.

### Triggers & Interactive Terrain
- **Data-Driven Terrain**: Terrain features like doors and shallow water define interaction outcomes and movement costs directly in their JSON definitions.
- **Traps & Triggers**: Handled by `trigger.system.ts`, hidden entities like traps use a `TrapComponent` to process effects when a unit steps on them.

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

### Composable AI Behavior Pipeline
- **Decision**: AI logic is split into discrete, pure functions (behaviors like `hunt`, `flee`, `ranged`). Entities receive an `AIProfileId` referencing a data-driven list of behaviors. During an entity's turn, the pipeline evaluates these behaviors in priority order until one returns an executable `Intent`.
- **Rationale**: Replaces a monolithic `if/else` block with a pluggable architecture. It allows us to build complex entity types (e.g., a cowardly mage who flees and casts spells) purely by mixing and matching existing behaviors in data.

### Data-Driven Faction Matrix
- **Decision**: Entity hostility is resolved by looking up their respective `FactionId`s in a global `HOSTILITY_MATRIX`, rather than hardcoding "player vs monsters".
- **Rationale**: Lays the groundwork for complex relationships (e.g., monster infighting, neutral NPCs, allied summons) without littering combat code with explicit type checks. It easily extends into the Modding milestone, as the matrix can be loaded from JSON.

### Player Knowledge vs Physical Properties (ECS Domain Modeling)
- **Decision**: Information that represents the player's memory or global knowledge (e.g., whether an item type is "Identified") is stored as a global set on `GameState` rather than an `identified: boolean` flag on individual `ItemComponent` instances.
- **Rationale**: An ECS component should represent a localized physical property of an entity. The player's memory is not a physical property of the sword sitting on the floor. If we used an instance flag, using a "Scroll of Identify" would require iterating over and mutating every single item across all active and inactive dungeon levels (an O(N) operation that breaks the encapsulation of inactive floors). By modeling this as Global Player Knowledge, any rendering system can instantly check the global set without mutating entity instances. This also perfectly supports future features like "Amnesia" spells or pre-identified starting loadouts.

### Campaign Data Format & Validation
- **Decision**: Campaign data (entities, items, map tiles, effects, etc.) is stored as JSON files bundled in the application and loaded dynamically at runtime via `fetch()`. A global registry (`public/data/campaigns.json`) acts as the single source of truth for all available campaigns and their basic metadata. We use `zod` for defining schemas, which provides both runtime validation and TypeScript type inference. The built-in TS constants have been deleted, and all subsystems read registry data directly from the loaded campaign state (attached to `GameState`). The base game itself is just the `default` campaign.
- **Rationale**: JSON is universally supported and familiar to modders. The central `campaigns.json` registry allows the frontend to easily list and select campaigns without needing a dynamic backend to read directory contents. While `zod` adds ~50KB to the bundle, it provides an invaluable single source of truth for our data definitions, ensuring that malformed mod JSONs throw precise, human-readable errors immediately upon loading, rather than causing cryptic undefined behavior during gameplay.

### Data-Driven Polymorphism over Routing Logic
- **Decision**: When building scalable architectures (like our Intents/Actions system), avoid writing centralized "routing" logic (massive `switch` or `if/else` trees) that determines how a piece of data behaves based on its type. Instead, encode meta-properties directly into the data shape (e.g., adding `isImmediate: true` directly to an Intent interface). 
- **Rationale**: This respects the Open-Closed Principle, allowing new data types to be added without modifying the core engine loops.

### Token Pools over O(N) Verification (The "Bag" Pattern)
- **Decision**: When enforcing global limits (e.g., "spawn a maximum of 1 Unique Boss" or "only 3 Elite Guards per level"), do not run an O(N) loop over all existing entities to count them at query time. Instead, initialize a stateful data structure (a "bag" or "deck") containing tokens representing the allowed spawns. When an entity is spawned, its token is popped from the pool.
- **Rationale**: Pre-structuring the data avoids expensive loops during gameplay. If an entity's token is not in the bag, it physically cannot be drawn, providing 100% reliable limit enforcement for free. This elegantly handles both Uniques (N=1) and Extinction mechanics (N=50) with the exact same logic.
