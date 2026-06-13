# Roguelike Template

A modern, highly-extensible, browser-based traditional roguelike engine featuring both **Turn-Based** and **Real-Time with Pause (RTwP)** modes,  **Systemic Narrative** systems, and a  **Data-Driven** architecture. Built with **TypeScript**, **Vite**, and **ROT.js**. 

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
