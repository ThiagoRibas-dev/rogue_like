# AGENTS.md — Roguelike Project (TypeScript + ROT.js + Vite)

## 0. Golden Rules

1. **Basics.** When starting a new conversation, look at the last 5 git commit messages for context. Never commit or push to a git repository.
2. **NEVER assume. ASK.** If a task is ambiguous, under-specified, or could be interpreted multiple ways, stop and ask clarifying questions or discuss the changes before writing any code. List your assumptions explicitly and ask the user to confirm. 
3. **NEVER hallucinate APIs.** If you are unsure whether a function, method, class, or config option exists in ROT.js, Vite, or any dependency, say so. Do not invent plausible-sounding API calls. Refer to the documentation or ask the user to verify.
4. **Push back and propose alternatives.** Do not blindly agree with the user. If a requested architecture, design, or query is flawed, misunderstood, over engineered, or outright wrong, point it out. Offer alternatives with arguments and comparisons. However, if the instructions are clear, comprehensive, and correct, execute them.
5. **NEVER use `any`.** There are zero acceptable uses of `any` in this project. Use `unknown` + type narrowing, generics, or branded types instead.
6. **NEVER use magic strings or magic numbers.** Every literal value that controls game behavior must be a named constant or enum member. No exceptions.
7. **Prefer SMALL, reviewable changes.** Each response should address one logical change. Do not refactor unrelated code while implementing a feature.

---

## 1. Project Overview

| Key              | Value                                           |
| ---------------- | ----------------------------------------------- |
| Genre            | Traditional turn-based roguelike (grid, ASCII)  |
| Language          | TypeScript (strict mode)                        |
| Roguelike Toolkit | ROT.js (rot-js on npm)                         |
| Package Manager  | bun                                             |
| Bundler          | Vite                                            |
| Target           | Modern browsers (ES2022+), deployed to itch.io  |
| Architecture     | Entity-Component-System (ECS-lite, no framework)|
| State Management | Immutable game state passed through turns        |

---

## 2. TypeScript Rules

### Compiler Settings (tsconfig.json is the source of truth)

The project uses the strictest possible TS config. Agents must write code that
compiles cleanly under these settings:

```jsonc
{
  "compilerOptions": {
    "strict": true,                   // enables all strict checks
    "noUncheckedIndexedAccess": true,  // array/map access returns T | undefined
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "verbatimModuleSyntax": true
  }
}
```

### Type Discipline

- **All function signatures must have explicit return types.** Do not rely on
  inference for anything exported or non-trivial.
  ```ts
  // ✅ Good
  function getDamage(attacker: Fighter, defender: Fighter): number { ... }

  // ❌ Bad — inferred return
  function getDamage(attacker: Fighter, defender: Fighter) { ... }
  ```

- **All function parameters must be typed.** No implicit `any` through laziness.

- **Prefer `interface` for object shapes. Use `type` for unions, intersections,
  and mapped types.**

- **Use branded types for IDs** to prevent accidentally passing a MonsterID
  where an ItemID is expected:
  ```ts
  type EntityId = number & { readonly __brand: unique symbol };
  ```

- **Use `readonly` aggressively.** Default to `readonly` on properties and
  `ReadonlyArray<T>` / `Readonly<T>` on parameters. Only remove `readonly`
  when mutation is explicitly required and justified with a comment.

- **Use `satisfies` over `as`.**
  ```ts
  // ✅ Good — validates AND narrows
  const config = { maxHp: 30 } satisfies FighterStats;

  // ❌ Bad — silently lies to the compiler
  const config = { maxHp: 30 } as FighterStats;
  ```

- **Use exhaustive switch checks:**
  ```ts
  function assertNever(x: never): never {
    throw new Error(`Unexpected value: ${x}`);
  }
  ```
  Every `switch` on a union/enum must include a `default: return assertNever(x)`
  so that adding a new variant causes a compile error everywhere it matters.

---

## 3. Constants & Enums — No Magic Values

### Rules

1. **Every numeric literal that affects gameplay** (damage, HP, map dimensions,
   FOV radius, spawn rates, weights) must be a named constant in the
   appropriate `constants` file.
2. **Every string that acts as a key or tag** (component names, tile types,
   action types, AI states) must be an `enum` or a `const` object `as const`.
3. **Prefer `const enum` for internal enums** (they are erased at compile time).
   Use regular `enum` only if the value must exist at runtime (e.g.,
   serialization).
4. **Group constants by domain:**

```
src/constants/
├── map.constants.ts      // MAP_WIDTH, MAP_HEIGHT, MAX_ROOMS, etc.
├── combat.constants.ts   // BASE_ATTACK, BASE_DEFENSE, XP_PER_LEVEL, etc.
├── fov.constants.ts      // FOV_RADIUS, LIGHT_WALL, etc.
├── ui.constants.ts       // SCREEN_WIDTH, SCREEN_HEIGHT, BAR_WIDTH, etc.
├── spawning.constants.ts // MAX_MONSTERS_PER_ROOM, SPAWN_TABLE, etc.
└── colors.constants.ts   // COLOR_PLAYER, COLOR_ORC, COLOR_WALL, etc.
```

### Example

```ts
// ❌ Bad
display.draw(x, y, "@", "#ff0", "#000");

// ✅ Good
import { Glyph, Color } from "@/constants";

display.draw(x, y, Glyph.Player, Color.PlayerFg, Color.BackgroundDefault);
```

---

## 4. Project Structure

```
my-roguelike/
├── AGENTS.md                     ← You are here
├── README.md                     ← Human-facing project overview
├── docs/
│   └── ARCHITECTURE.md           ← High-level system design doc (see §8)
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── verify.bat                    ← runs tsc && vite build
├── scripts/
│   └── map-codebase.ts           ← generates a summary of all exports (see §8)
└── src/
    ├── main.ts                   ← entry point: bootstraps Display, starts game
    ├── types/
    │   ├── components.types.ts   ← all component interfaces
    │   ├── actions.types.ts      ← action discriminated union
    │   └── game-state.types.ts   ← GameState, GameMap, Tile, etc.
    ├── constants/                ← (see §3)
    ├── core/
    │   ├── ecs.ts                ← createEntity, addComponent, query, removeEntity
    │   ├── game-loop.ts          ← handleInput → resolveAction → updateFOV → render
    │   ├── scheduler.ts          ← wraps ROT.Scheduler.Speed
    │   └── rng.ts                ← wraps ROT.RNG; single seeded instance
    ├── map/
    │   ├── generator.ts          ← dungeon generation (uses ROT.Map.Digger)
    │   ├── tile.ts               ← Tile type definitions
    │   └── fov.ts                ← wraps ROT.FOV.PreciseShadowcasting
    ├── systems/                  ← pure-ish functions: (state, action) → state
    │   ├── movement.system.ts
    │   ├── combat.system.ts
    │   ├── ai.system.ts
    │   ├── inventory.system.ts
    │   └── death.system.ts
    ├── rendering/
    │   ├── renderer.ts           ← draws map + entities via ROT.Display
    │   ├── ui.ts                 ← HUD, message log, health bars
    │   └── camera.ts             ← viewport / scrolling logic
    └── utils/
        ├── direction.ts          ← Direction enum, delta vectors
        ├── grid.ts               ← coordToIndex, indexToCoord, isInBounds
        └── assert.ts             ← assertDefined, assertNever helpers
```

### Rules for File Organization

- **One concern per file.** If a file has both "dungeon generation" and
  "rendering" in it, split it.
- **No circular imports.** The dependency graph flows DOWN:
  `main → core → systems → map/rendering → types/constants/utils`.
  `types`, `constants`, and `utils` may NEVER import from upper layers.
- **Barrel files (`index.ts`) are BANNED.** They cause bundling issues, make
  the dependency graph ambiguous, and hide where things come from. Always use
  direct, explicit imports.
- **Files should not exceed ~250 lines.** If a file is growing past this, it
  likely contains multiple responsibilities. Split it proactively.

---

## 5. ECS Patterns

For the full high-level ECS architecture, see [docs/ARCHITECTURE.md](file:///d:/Projects/Game%20Dev/rogue-like/docs/ARCHITECTURE.md).

### Rules for Components and Systems
- **Components are plain data objects** — interfaces with no methods.
  ```ts
  interface PositionComponent {
    readonly type: "Position";
    x: number;
    y: number;
  }
  ```
- **Systems must be pure functions** that take state and return new state (or mutate in a clearly documented, controlled way).
- **Entities are numeric IDs** (using branded types), not class instances. Do not use objects for entities.
- **When adding a component type, you MUST:**
  1. Add it to the `ComponentType` enum.
  2. Add its interface to `components.types.ts`.
  3. Update the `ComponentMap` discriminated union.

---

## 6. ROT.js-Specific Guidelines

For the subsystem wrapper design details, see [docs/ARCHITECTURE.md](file:///d:/Projects/Game%20Dev/rogue-like/docs/ARCHITECTURE.md).

### Rules
- **Encapsulate ROT.js calls**: Do not use `ROT.FOV.*`, `ROT.Map.*`, etc. directly inside gameplay systems or rendering modules. Use the corresponding project wrappers (`fov.ts`, `generator.ts`, `scheduler.ts`, `rng.ts`).
- **Seeded RNG only**: Never call `Math.random()` directly. You must use the shared `ROT.RNG` instance exported from `src/core/rng.ts` to ensure gameplay is deterministic.
- **Use Speed Scheduler**: Use the energy-based Speed Scheduler (`ROT.Scheduler.Speed`) wrapper for turn scheduling.
- **Keyboard handling**: Use the `ROT.KEYS` constants, never raw keycodes.

---

## 7. Workflow & Process

### Before Writing Code

1. **Read the relevant source files** the user references. Summarize your
   understanding of the current state back to the user before proposing changes.
2. **State your plan** in a numbered list of steps. Wait for confirmation if
   the change touches more than 2 files.
3. **Check for existing utilities** in `utils/`, `constants/`, and `types/`
   before creating anything new. Duplication is a bug.

### While Writing Code

4. **Run the check script mentally.** Before presenting code, verify:
   - No `any` types.
   - No magic literals.
   - All functions have explicit return types.
   - All switch statements are exhaustive.
   - No unused imports or variables.
5. **Add a JSDoc comment** to every exported function, type, and constant.
   Include `@param`, `@returns`, and a one-line description at minimum.
6. **Name things precisely.** `processEntities` is bad. `applyMeleeDamage` is
   good. Variable names should make the code read like prose.

### After Writing Code

7. **Identify downstream effects.** If you changed an interface or enum, list
   every file that will need to be updated and present those changes too.
8. **Suggest a test scenario.** Describe a manual play-test action the user can
   take to verify the change works (e.g., "Walk into an orc. You should see a
   damage message in the log and the orc's HP should decrease.").

---

## 8. Documentation & Codebase Mapping

### docs/ARCHITECTURE.md

Maintain [docs/ARCHITECTURE.md](file:///d:/Projects/Game%20Dev/rogue-like/docs/ARCHITECTURE.md) to document high-level design:
- Project summary & architectural diagrams.
- Summaries of major subsystems (Map Gen, FOV, ECS, Combat, Rendering, etc.).
- A "Decision Log" documenting non-obvious design choices.

**This file must be updated whenever a system is added or significantly changed.**

### Codebase Map Script

`scripts/map-codebase.ts` should be a runnable script (via `bun scripts/map-codebase.ts`) that
scans `src/` and prints:
- Every exported function, class, type, enum, and constant.
- The file it lives in.
- Its JSDoc summary line (if present).

This gives agents and humans a quick reference without reading every file.
Keep this script up to date.

---

## 9. Common Pitfalls — Do NOT

| ❌ Don't                                      | ✅ Do Instead                                     |
| --------------------------------------------- | ------------------------------------------------ |
| Use `any`                                     | Use `unknown`, generics, or proper types          |
| Use raw string keys for components            | Use the `ComponentType` enum                      |
| Call `Math.random()`                          | Use the shared `ROT.RNG` instance from `rng.ts`   |
| Import from ROT.js in more than one file per subsystem | Use the project's wrapper modules      |
| Create a `God` class or `GameManager`         | Use systems as focused functions                  |
| Put rendering logic in a system               | Systems return state; renderer reads state        |
| Store derived state (e.g., visible tile cache)| Recompute in the render pass from FOV             |
| Use `setTimeout` / `setInterval` for turns    | Use ROT.Scheduler; this is a turn-based game      |
| Mutate arrays/objects you don't own            | Clone or use immutable update patterns            |
| Skip the plan step for multi-file changes     | Always state the plan and get confirmation first  |
| Leak subsystem knowledge into the game loop   | Subsystems expose query helpers (e.g., `shouldSkipTurn()`); the core loop calls those instead of inspecting registries or component internals directly |
| Forget that entities own other entities via ID| Traverse and migrate foreign keys (like inventory items) when moving entities between distinct ECS states (e.g., floor transitions). |

---

## 10. Reference Docs

When in doubt, consult these canonical sources:

- **ROT.js:** https://ondras.github.io/rot.js/hp/ and the GitHub wiki
- **TypeScript Handbook:** https://www.typescriptlang.org/docs/handbook/
- **Roguelike Tutorial (Python, but the design patterns transfer 1:1):**
  https://rogueliketutorials.com/
- **Vite:** https://vitejs.dev/guide/

---

## 11. Lessons Learned

- **ROT.js TypeScript Definitions:** In modern versions of ROT.js (v2+), certain type interfaces such as `DisplayOptions` are not explicitly exported from the main `index.d.ts` module.
- **`exactOptionalPropertyTypes`:** The project uses the strict `exactOptionalPropertyTypes: true` TypeScript compiler option. This means you **cannot** explicitly assign `undefined` to an optional property (e.g., `const obj: { foo?: string } = { foo: undefined };` will throw a compiler error). You must either conditionally construct the object to completely omit the property, or update the interface to explicitly accept undefined (e.g., `foo?: string | undefined;`).