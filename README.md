# Roguelike Template

A modern, highly-extensible, browser-based traditional roguelike engine featuring both **Turn-Based** and **Real-Time with Pause (RTwP)** modes,  **Systemic Narrative** systems, and a  **Data-Driven** architecture. Built with **TypeScript**, **Vite**, and **ROT.js**. 

## ✨ Current Features

### 🎮 Core Gameplay
- **Dual-Mode Engine** — Play as a traditional **turn-based** roguelike or toggle into **Real-Time with Pause (RTwP)** mode with speed controls (1×, 2×, 4×) and command queuing
- **Seeded Determinism** — Every run is reproducible with the same seed via a shared RNG wrapper
- **Save/Load** — Auto-saves to `localStorage`; manual export/import of save files
- **Permadeath** — Game Over screen with contextual death message and cause
- **Full Input Rebinding** — Customize every keyboard control
- **Accessibility** — UI/font scaling, high-contrast mode, animation reduction

### 🗺️ Exploration & Map
- **Procedural Generation** — `ROT.Map.Digger` room-and-corridor dungeons, plus cellular automata (caves) and BSP (urban/village) biome generators
- **Field of View & Fog of War** — Precise shadowcasting; explored-but-not-visible tiles are dimmed; player-centered camera with viewport scrolling
- **Interconnected World** — Multi-level dungeons, lateral transitions (walk off map edges, enter buildings), and hand-crafted static hubs (taverns, camps)
- **Encounter Director** — Procedurally generates tactical combat rooms by spending Challenge Rating (CR) budgets across objectives, advantages, hazards, and chaos
- **Interactive Terrain** — Open/close doors (block FOV), hidden traps (damage, poison, teleport), shallow water (2× movement cost), fountains, altars/shrines, and locked containers

### 🧟 Combat & AI
- **Bump-to-Attack** — Walk into enemies to melee; full stat system (HP, attack, defense, speed)
- **Unified Damage Pipeline** — Melee, traps, spells, and fields all produce damage instances with semantic tags processed by a centralized damage system
- **Death System** — XP rewards, item drops, death messages, and player permadeath
- **Floating Combat Text** — Damage numbers, blocks, and effects animate over entities on the map
- **Composable AI** — Entities use data-driven profiles mixing hunt, wander, flee, ranged, and spell-casting behaviors
- **Faction System** — Hostility matrix determines who attacks whom; view faction standings in the UI
- **Status Effects** — Poison (DoT), Haste (speed+), Weakness (atk-), Stun (skip turn), Confusion (random move), Regeneration; all displayed in the HUD with remaining duration

### 🎒 Items & Inventory
- **Full Inventory System** — Pick up (`G`), drop, equip/unequip items; weight-based capacity
- **Equipment Slots** — Paper-doll panel supporting arbitrary limb configurations (head, torso, hands, fingers, etc.) with dynamic stat calculation
- **Consumables** — Health potions, scrolls of confusion, scrolls of identify, food items
- **Identification** — Unidentified items show randomized placeholder names; identify via Scroll of Identify or identify-on-use
- **Throwing** — Throw items at targets (rocks, knives, potions, bombs) with projectile resolution
- **Item Coatings** — Dip weapons in poison/fire for finite on-hit charges
- **Wands & Zapping** — Fire wands with beam, bolt, or cone AoE patterns
- **Containers** — Open chests and containers with dedicated UI panel; traps and locks on containers

### 🔥 Environmental Fields
- **Spreadable Fields** — Fire, smoke, and poison gas persist on tiles, tick each turn, decay, and spread
- **Field Interactions** — Smoke blocks FOV, poison gas applies poison, fire ignites flammable tags, water extinguishes fire — all resolved through the reaction system
- **Data-Driven Definitions** — Fields are defined in JSON with configurable intensity, duration, damage, status effects, and sight-blocking

### 💬 Dialogue, Personality & Social
- **Branching Dialogue** — Tree-based conversation modal with gated options
- **Personality & Memory** — NPCs possess personality facets and core memories, remembering past interactions, grudges, and faction standing to drive reactions
- **Knowledge Brokering** — NPCs dynamically learn rumors and facts about world events, which can be acquired via `gossip` and `ask_about`
- **Declarative Quests** — JSON-defined objectives (kill, gather, talk) with quest journal UI
- **Procedural Quests** — Randomized bounties generated at runtime from JSON templates
- **In-Context Wiki** — Clickable highlighted keywords in dialogue/quests for encyclopedia-style tooltips

### 💰 Trade & Economics
- **Dynamic Pricing** — Item prices scale with faction standing, NPC personality (greedy vs generous), and temporary social states
- **Barter System** — Trade items directly with NPCs to offset gold costs
- **Procedural Restocking** — Merchants dynamically generate fetch quests when their supply of requested goods is depleted

### 🦹 Villains & Investigation
- **Background Schemes** — Villain masterminds tick on the scheduler independently, pursuing goals without player input
- **Minion Recruitment** — Villains dispatch agreements and agents across areas
- **Clue Generation** — Defeating minions drops randomized clues tied to active schemes
- **Investigation Board** — `V` key opens a conspiracy board showing known suspects and discovered clues
- **Token Pools** — Bag pattern ensures unique villains and items cannot be duplicated

### 🔐 Interaction Verbs & Reactions
- **12 Canonical Verbs** — `apply`, `throw`, `kick`, `open`, `close`, `lock`, `unlock`, `dip`, `zap`, `ignite`, `read`, `eat`
- **Combinatorial Reaction System** — All interactions are resolved by matching verb + source tags + target tags against declarative JSON reactions. New mechanics (dipping, sacrificing, alchemy) can be authored entirely in data without writing code

### 📦 Campaign System
- **Campaign Selection** — Choose from multiple campaigns on New Game
- **Mod Loading** — Install `.zip` campaigns from the Main Menu; validated against Zod schemas
- **Themes & Tilesets** — Per-campaign ASCII glyphs, color palettes, and message log templates
- **Hybrid Loader** — Merges built-in (`public/`) and installed (IndexedDB) campaigns into a single list

### 🛠️ Built-in Campaign Editor
- **Workspace** — Toggle from Main Menu with editor state preserved across playtest round-trips
- **Zod-Driven Forms** — Auto-generated JSON editors with reference dropdowns and live validation
- **Undo/Redo** — `Ctrl+Z`/`Ctrl+Shift+Z` using JSON Patch (RFC 6902) deltas
- **Drag-and-Drop** — Reorder arrays, drag items from sidebar to link IDs
- **Visual Tools** — World area graph (node-link), faction matrix (2D data-grid), dialogue tree editor, tile grid painter, live map previews
- **Encounter Director Sandbox** — Preview procedural encounter generation with budget breakdowns
- **AI Arena** — Headless simulation of entity combat with telemetry
- **Scheme Accelerator** — Fast-forward villain schemes to test investigation flow
- **Campaign Validator** — Full integrity audit (reachability, cross-references, trigger loops); blocks export on fatal errors
- **Playtest Mode** — One-click playtest serializes the campaign and launches the game; editor restores exact state on return
- **IndexedDB Storage** — Workspaces saved to browser database; ZIP export/import for sharing

## 🚀 Quick Start

### Prerequisites
- [Bun](https://bun.sh/) (Fast all-in-one JavaScript runtime and package manager)

### Installation
1. Clone the repository.
2. Install dependencies:
   ```bash
   bun install
   ```
3. Start the development server:
   ```bash
   bun run dev
   ```
4. Open the local URL (usually `http://localhost:5173`) in your browser to play.

### Building for Production
To compile the strict TypeScript and build the optimized Vite bundle for deployment (e.g., to itch.io or GitHub Pages):
```bash
bun run build
```

## 🏗️ Architecture Highlights

This codebase enforces very strict architectural rules and heavily leans into several established software design patterns to ensure long-term maintainability:

- **Entity-Component-System (ECS-lite)**: Logic is entirely decoupled from data. Entities are simply branded numeric IDs. Components are plain data interfaces. Systems are pure functions.
- **Data-Driven Design (Registry/Prefab Pattern)**: Campaigns, entities, items, and map features are defined entirely in Zod-validated JSON schemas, allowing for trivial modding without touching core logic or relying on Object-Oriented inheritance.
- **The Command Pattern (Intent System)**: UI events and Keypresses do not execute logic directly. Instead, they push declarative `Intents` to a queue, which the engine processes later. This decouples input from simulation, making RTwP modes possible.
- **Combinatorial Reactions & Triggers**: An event-reactive engine evaluates tag-based and verb-based conditions to deterministically resolve complex interactions (like dipping, zapping, or burning) and spawn consequences entirely from JSON schemas.
- **Strict Immutable State Management**: The `GameState` object is an immutable snapshot of a single turn. Systems take the current state and return a brand new state object, making saving, loading, and time-travel debugging trivial.
- **Model-View-Controller (MVC) UI Separation**: The UI is strictly layered. The DOM acts purely as a dumb View (`src/rendering/ui/`), the Controller handles user input and dispatches intents (`src/core/input_handler.ts`), and the ECS acts as the Model.
- **The "Token Pool" (Bag) Pattern**: Used for global spawn limits and probability distribution (e.g., ensuring a "Unique Boss" only spawns once) without requiring expensive `O(N)` entity loops.
- **Sleep/Wake Boundary (Persistence)**: Handling level transitions by archiving components to a global memory pool when unloading areas, and injecting them back when the area reloads, allowing persistent NPCs to exist decoupled from specific maps.
- **JSON Patch (RFC 6902)**: Used exclusively in the Editor tools to compute state deltas and provide undo/redo functionality over the data-driven JSON registries.
- **Subsystem Encapsulation**: Third-party libraries like `ROT.js` are never called directly by game logic. They are wrapped in `src/core/` modules (e.g., `rng.ts`, `scheduler.ts`) to ensure deterministic behavior.

## 📁 Repository Structure

```text
├── AGENTS.md               # Strict rules and guidelines for development
├── docs/                   # Architectural documentation and Milestones
├── src/
│   ├── constants/          # All magic numbers, keybinds, and color configs
│   ├── core/               # Wrappers for ROT.js (ECS, RNG, Scheduling)
│   ├── map/                # Tile definitions, procedural generation, FOV
│   ├── rendering/          # Canvas drawing and HTML HUD updates
│   ├── systems/            # Pure logic functions (Combat, Movement, AI)
│   ├── types/              # Interfaces and generic type unions
│   └── utils/              # Helper functions (Grid math, assertions)
├── index.html              # The premium retro-modern console UI wrapper
└── main.ts                 # The bootstrap entry point
```

## 📖 Documentation

For a deep dive into how the engine is built and how to extend it, please refer to:
- `docs/ARCHITECTURE.md`: High-level system design and decision logs.
- `docs/MILESTONES.md`: The roadmap from a MVP to a systemic engine with narrative and adversarial layers.
- `AGENTS.md`: The core tenets of how code must be written for this project.

## 🛠️ Scripts
- `bun run dev`: Starts the Vite hot-reloading development server.
- `bun run build`: Runs the TypeScript compiler and builds the production bundle.
- `bun scripts/map-codebase.ts`: Generates a quick-reference summary of all exported functions and types in the codebase.
