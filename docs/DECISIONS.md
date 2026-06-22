# Decision Log — Roguelike Project

This document records architectural decisions whose rationale is **non-obvious or counter-intuitive** — things a developer might get wrong without the explanation. Routine design rationale is documented inline in [ARCHITECTURE.md](./ARCHITECTURE.md).

---

### Event Routing Buckets

- **Decision**: Rather than global event listeners or `O(N)` queries every frame, we use cached inverted indexes (buckets) stored on related components (e.g., `QuestLogComponent.activeTriggers`).
- **Rationale**: Turns `O(Quests × Objectives)` operations into `O(1)` lookups during high-frequency combat events, isolating cost to the moment a quest is granted or completed.

### Global Overrides vs O(N) Iteration

- **Decision**: For state alterations affecting an entire collection identically (e.g., revealing the full map, global buffs), we add a boolean flag to the parent object (e.g., `GameMap.isFullyExplored`) rather than iterating and mutating every child.
- **Rationale**: Rebuilding large immutable arrays (4,000+ tiles) is cheap but causes massive memory allocation spikes triggering GC pauses. Global flags avoid allocation entirely and scale to massive maps.

### Player Knowledge vs Physical Properties (ECS Domain Modeling)

- **Decision**: Player memory (e.g., whether an item type is "Identified") is stored as a global set on `GameState`, not as an `identified: boolean` on individual `ItemComponent` instances.
- **Rationale**: An ECS component should represent a localized physical property. Using a "Scroll of Identify" with instance flags would require mutating every item across all active and inactive areas — an `O(N)` operation breaking inactive floor encapsulation. A global set enables instant `O(1)` checks without entity mutation.

### Data-Driven Polymorphism over Routing Logic

- **Decision**: Avoid centralized routing logic (massive `switch`/`if-else` trees) that determines behavior by type. Instead, encode meta-properties directly into data shapes (e.g., `isImmediate: true` on an Intent interface).
- **Rationale**: Respects the Open-Closed Principle — new data types can be added without modifying core engine loops.

### Token Pools over O(N) Verification (The "Bag" Pattern)

- **Decision**: When enforcing global limits (e.g., "max 1 Unique Boss", "only 3 Elite Guards per level"), initialize a stateful pool of tokens representing allowed spawns. Spawning pops a token from the pool.
- **Rationale**: Pre-structuring data avoids expensive runtime loops. If a token isn't in the bag, it physically cannot be drawn — providing 100% reliable limit enforcement. Handles both Uniques (N=1) and Extinction mechanics (N=50) with identical logic.

### Encounter Director Reachability & Pathing Overheads

- **Decision**: During procedural generation, the Encounter Director skips `ROT.Path.AStar` verification for randomly placed entities blocking paths.
- **Rationale**: Running AStar on every candidate spawn creates immense computational overhead and latency spikes during area transitions. We rely on statistical improbability of random placement creating perfect soft-locks. Will revisit if this becomes a persistent gameplay issue.
