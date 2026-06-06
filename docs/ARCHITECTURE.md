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

### Persistent Level Transitions via State Swapping
- **Decision**: We store the maps and non-player entities of inactive levels in a `levels` dictionary on the global `GameState`, swapping them into active ECS arrays only when transitioning floors.
- **Rationale**: Keeps active ECS queries and rendering passes lightweight since they only iterate over entities on the player's current floor, while fully preserving the state and layout of visited floors for traditional roguelike progression.

### Pre-emptive Data-Driven Architecture
- **Decision**: We strictly avoid Object-Oriented inheritance (classes/subclasses) for game entities. We prefer string IDs over TypeScript `enums`, and we design Actions to emit generic `Intents` (events) rather than executing hardcoded logic directly.
- **Rationale**: This paves the way for our end-goal of Modding & Extensibility. By using a "Prefab" pattern (plain TypeScript objects that mirror JSON schemas) and an Event-driven action system, we ensure that logic is never "baked in" to the engine. This makes the transition to loading external `.json`/`.yaml` campaigns and content trivial later on.
