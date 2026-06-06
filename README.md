# Roguelike Template: Hall of the Goblin King

A modern, highly-extensible, browser-based traditional roguelike engine built with **TypeScript**, **Vite**, and **ROT.js**. 

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

This codebase enforces very strict architectural rules to ensure long-term maintainability:

- **Strict TypeScript**: Compiled with maximum strictness (`noImplicitAny`, `exactOptionalPropertyTypes`, etc.). There are zero `any` types in this codebase.
- **Pure ECS (Entity-Component-System)**: Logic is entirely decoupled from data. Entities are simply branded numeric IDs. Components are plain data interfaces. Systems are pure functions.
- **Immutable State**: The `GameState` object is an immutable snapshot of a single turn. Systems take the current state and return a brand new state object, making saving, loading, and time-travel debugging trivial.
- **No Magic Values**: Every string and number that affects gameplay logic is extracted into the `src/constants/` directory.
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
- `docs/MILESTONES.md`: The roadmap from MVP to full Real-Time-with-Pause (RTwP) depth.
- `AGENTS.md`: The core tenets of how code must be written for this project.

## 🛠️ Scripts
- `bun run dev`: Starts the Vite hot-reloading development server.
- `bun run build`: Runs the TypeScript compiler and builds the production bundle.
- `bun scripts/map-codebase.ts`: Generates a quick-reference summary of all exported functions and types in the codebase.
