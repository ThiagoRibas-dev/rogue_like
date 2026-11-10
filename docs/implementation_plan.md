# Implementation Plan: Hotbar Keys, RTwP Transition, Declarative Stances & Turn-Based Multi-Step Action Economy

## 1. Architectural Mandates & Context

### Governing Rules (`AGENTS.md`)
- **Rule 11 (Zero `any`)**: All new variables, handlers, and interfaces must use explicit strict types or generics.
- **Rule 12 (Zero Magic Literals)**: All movement costs, speeds, and action budgets use defined constants (`FEET_PER_GRID_SQUARE = 5`, `STANDARD_TURN_DURATION = 100`, etc.).
- **Rule 15 (Cascading Effects Matrix)**: Enumerate Upstream, Downstream, and Lateral effects before and during implementation.
- **Rule 16 (Three-Tier Placement Heuristic)**:
  - **Tier 1 (Core Console Engine)**: `src/core/scheduler.ts` (actor queue reset without loop killing), `src/core/input_handler.ts` / `src/core/input/shortcut_input.ts` (top-row key binding), and `src/rendering/ui/hud_bottom_dock.ui.ts` / `console_hotbar.ui.ts` (dock pips and End Turn button).
  - **Tier 2 (Ruleset Cartridge)**: `src/rulesets/dnd35e/action_economy.ts` (action budget evaluation), `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` (live dynamic action pips from `DnD35ActionBudget` + declarative stance projection from `TacticalDialDescriptor`).
  - **Tier 3 (System & Campaign Content)**: Declarative ability definitions in `public/data/rulesets/dnd35e/` and starting archetype presets in `archetype_resolver.ts`.
- **Rule 17 (Baseline Rules + Declarative Overrides — No Feat/Content Spaghetti)**: Evict all `if (feats.has('power_attack'))` and hardcoded stance buttons; project stances and dials dynamically from `extractActorTacticalDials` and active `effectBundle`s.
- **Rule 20 (Three-Horizon Computation Boundaries)**: Fix Horizon 1 character creation hydration in `applyCharacterCreationToPlayer` so the placeholder archetype's default feats never bleed into a newly minted character's `levelHistory`.

---

## 2. Detailed Technical Breakdown & Proposed Code Changes

### Step 1: Hotbar Keyboard Controls (`1`–`9`, `0`, `-`, `=`) Without Input Conflicts

#### Analysis of Keystroke Routing & Potential Conflicts
1. **Top-row vs Numpad**:
   - In `settings.ts`, `move_south` is bound to `['arrowdown', 's', 'j', '2']`, `move_west` to `['4']`, `move_east` to `['6']`, `move_north` to `['8']`.
   - In standard browser `KeyboardEvent`:
     - Pressing top-row `2`: `event.code === 'Digit2'`, `event.key === '2'`.
     - Pressing numpad `2`: `event.code === 'Numpad2'`, `event.key === '2'`.
   - In `src/core/settings.ts`, `isAction(event, action)` checks:
     `binds.some(b => b.toLowerCase() === event.key.toLowerCase() || b.toLowerCase() === event.code.toLowerCase())`.
   - Because `settings.ts` matches against `event.key === '2'`, pressing top-row `2` currently matches `move_south`!
   - Furthermore, `src/core/input/shortcut_input.ts:73` previously intercepted `1`, `3`, `5` only (to dodge `2`, `4`, `6`, `8`):
     ```ts
     // Legacy snippet in shortcut_input.ts:
     if (event.key === '1' || event.key === '3' || event.key === '5') {
       if (triggerQuickBeltSlot(getGameState(), playerEntityId, Number(event.key) - 1)) {
         event.preventDefault();
         return true;
       }
     }
     ```
2. **Resolution**:
   - In `src/core/input/shortcut_input.ts`, handle top-row hotbar keys using `event.code` (`Digit1`..`Digit0`, `Minus`, `Equal`), while also accepting `event.key` (`'1'`..`'0'`, `'-'`, `'='`) **when `event.code` is not a `Numpad` code**.
   - Map keys to hotbar slot indices:
     - `'Digit1'` or `'1'` -> slot index 0
     - `'Digit2'` or `'2'` -> slot index 1
     - ...
     - `'Digit9'` or `'9'` -> slot index 8
     - `'Digit0'` or `'0'` -> slot index 9
     - `'Minus'` or `'-'` -> slot index 10
     - `'Equal'` or `'='` -> slot index 11
   - Route through a single canonical execution helper:
     ```ts
     export function executeHotbarSlot(state: GameState, playerEntityId: EntityId, slotIndex: number): boolean {
       const cartridgeUI = getActiveCartridgeUI(state);
       if (cartridgeUI?.onExecuteHotbarSlot) {
         cartridgeUI.onExecuteHotbarSlot(state, playerEntityId, slotIndex, 1);
         return true;
       }
       return triggerQuickBeltSlot(state, playerEntityId, slotIndex);
     }
     ```
   - In `src/core/settings.ts`, update default numpad movement bindings to use canonical `numpad2`, `numpad4`, `numpad6`, `numpad8` (while preserving backward compatibility for arrow keys, WASD, and Vi keys `h/j/k/l`).
   - Suppress hotbar keys when typing inside any HTML `<input>`, `<textarea>`, or content-editable field, or when any modal is open (`isModalUIMode(state.uiMode)`).

---

### Step 2: RTwP Area Transition Scheduler Fix

#### Problem & Solution
- In `src/systems/map.system.ts:290`, `transitionArea()` calls `clearScheduler()`.
- `clearScheduler()` in `src/core/scheduler.ts` does:
  ```ts
  scheduler.clear();
  actors.clear();
  isEngineLocked = true; // <-- KILLS RUNNING LOOP
  if (typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(rtwpLoopId); // <-- CANCELS ANIMATION FRAME
  }
  ```
- In RTwP mode, this halts `rtwpLoop` indefinitely. When the player enters the new floor, the loop is dead and never ticks again.
- **Diff/Implementation in `src/core/scheduler.ts`**:
  ```ts
  /**
   * Resets scheduler queues and accumulated time for an area/floor change
   * without locking the engine or cancelling the active RTwP animation frame loop.
   */
  export function resetSchedulerActors(): void {
    scheduler.clear();
    actors.clear();
    accumulatedTime = 0;
    if (sliceYieldTimerId !== null) {
      clearTimeout(sliceYieldTimerId);
      sliceYieldTimerId = null;
    }
  }
  ```
- In `src/systems/map.system.ts:290`:
  Replace `clearScheduler();` with `resetSchedulerActors();`.

---

### Step 3: Eliminate Character Creation Feat Leak & Hardcoded Stances

#### A. Fix Feat Leak in `builder_hydrator_creation.ts`
- In `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`:
  ```ts
  // Currently:
  const withBaseAbilities: DnD35EntityData = { ...currentData, abilityScores: rawBaseScores, tracks: [] };
  
  // Replace with clean slate:
  const withBaseAbilities: DnD35EntityData = {
    ...currentData,
    abilityScores: rawBaseScores,
    tracks: [],
    feats: [] // Prevent DEFAULT_PLAYER_ARCHETYPE feats from leaking into new character
  };
  ```

#### B. Declarative Baseline Combat Abilities
- Universal combat maneuvers available to all actors:
  1. `fighting_defensively`: Standard tactical stance toggle (`-4` Attack, `+2` Dodge AC; `+3` with 5 ranks in Tumble).
  2. `total_defense`: Standard tactical stance toggle (`+4` Dodge AC, cannot attack; `+6` with 5 ranks in Tumble).
  3. `two_handed_grip`: 1H / 2H grip toggle (wielding 1H weapon in two hands for $1.5\times$ STR damage and $1:2$ Power Attack).
- Refactor `buildActorStanceModes` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) to:
  1. Read active dials dynamically using `extractActorTacticalDials(dndData.feats ?? [], sys?.feats, dndData.suppressedBundleIds)`.
     - When `extractActorTacticalDials` yields a dial (e.g. `power_attack`), push a numeric stepper mode.
     - When the actor lacks `power_attack`, no Power Attack dial is created!
  2. Add the baseline universal stances (`fighting_defensively`, `total_defense`, `two_handed_grip`) and any active `toggle` abilities from the actor's feats and effect bundles.
  3. Refactor `onToggleStance` and `onStepStance` in `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts` to update doctrine dynamically by dial ID / stance ID rather than hardcoded `if/else` ladders.

---

### Step 4: Turn-Based Multi-Step Round Action Economy & `[END TURN]`

#### A. Data Representation (`DnD35ActionBudget`)
- Add `actionBudget?: DnD35ActionBudget | undefined` to `DnD35EntityData` (`src/rulesets/dnd35e/types/dnd35e.types.ts`).
- At the start of an actor's turn in Turn-Based mode (or if `!dndData.actionBudget`):
  Initialize a fresh budget via `createRoundActionBudget(...)` from `src/rulesets/dnd35e/action_economy.ts`.

#### B. Step Consumption in `intent_cost_resolver.ts`
- When resolving `IntentType.Move`:
  - In Turn-Based mode with ruleset `dnd35e`:
    - Call `consumeMovementStepFt(currentBudget, actorSpeedFt, 5, isDifficultTerrain)`.
    - If `allowed === true`:
      - Update actor's `actionBudget` with the new budget.
      - If the actor still has `movementRemainingFt > 0` or actions remaining, return `energyCost = 0`!
      - This allows ROT.js to return control to the player immediately so they can take their next 5-ft step or standard action.
    - If `allowed === false`:
      - The actor has run out of movement and actions for this round; conclude turn with `energyCost = 100`.
- When resolving `IntentType.MeleeAttack` or `IntentType.Apply` (standard action):
  - Check if `actionBudget.standardRemaining > 0`.
  - Consume `standardRemaining: 0`.
  - If `movementRemainingFt <= 0` and `moveRemaining <= 0`, conclude turn with `energyCost = 100`.
- When resolving `IntentType.Wait` in Turn-Based mode (or clicking `[END TURN]`):
  - Instantly consume the rest of the round's budget and return `energyCost = 100`.

#### C. Live HUD Action Pips & `[END TURN]` Button
- In `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`:
  - Dynamically compute `actionPips` from `dndData.actionBudget`:
    - **STD**: `available: budget.standardRemaining > 0`
    - **MOV**: `available: budget.moveRemaining > 0 || budget.movementRemainingFt > 0`, label: `budget.movementRemainingFt > 0 ? `MOV ${budget.movementRemainingFt}ft` : 'MOV'`
    - **SWF**: `available: budget.swiftRemaining > 0`
    - **AoO**: `available: budget.aooRemaining > 0`, label: `AoO (${budget.aooRemaining})`
- In `src/rendering/ui/console_hotbar.ui.ts`:
  - In Turn-Based mode (`state.engineMode === EngineMode.TurnBased`), render an **`[END TURN]`** button adjacent to the action pips strip.
  - Clicking `[END TURN]` dispatches `createWaitAction(playerId)` (or hotkey `Space`), ending the turn immediately.

---

## 3. Cascading Effects Matrix (Rule 15)

| Subsystem / Area | Upstream (Callers & Inputs) | Downstream (Consumers & Outputs) | Lateral (Mirrors & Siblings) |
| :--- | :--- | :--- | :--- |
| **Hotbar Keyboard Inputs** | `session_controller.ts` (keydown event) -> `input_handler.ts` -> `shortcut_input.ts` | `hud_bottom_dock.ui.ts` -> `cartridgeUI.onExecuteHotbarSlot` | Numpad movement (`settings.ts`) preserved without conflict |
| **Scheduler Area Transition** | `map.system.ts` (`transitionArea`) | `src/core/scheduler.ts` (`resetSchedulerActors`) | RTwP animation frame stays active; Turn-Based remains unaffected |
| **Character Creation Feat Slate** | `builder_hydrator_creation.ts` (`applyCharacterCreationToPlayer`) | `dndData.feats`, `evaluateDnD35eEntityDAG` | New character sheets only display selected/racial feats; no phantom Power Attack |
| **Declarative Stances & Dials** | `dnd35e_ui_hotbar.ts`, `dnd35e_ui_adapter.ts` | `console_hotbar.ui.ts` (`#hud-bottom-dock` modes strip) | Other rulesets can project custom dials without Tier 1 hardcoded branches |
| **Turn-Based Round Action Budget** | `intent_cost_resolver.ts`, `dnd35e_combat_adapter.ts` | ROT.js action scheduler, `DND35E_ACTION_PIPS` | Melee full-attack vs single-attack accurately checks `distanceMovedThisRoundFt` |

---

## 4. Verification & Testing Pipeline

1. **TypeScript Compilation**: `bun x tsc --noEmit` (ensuring zero type errors, strict null checks, and `exactOptionalPropertyTypes` compliance).
2. **Formatting & Linting**: `bun run format` and `bun run lint`.
3. **Architectural Dependency & Dead Code**: `bun run lint:arch` and `bun run lint:deadcode`.
4. **Regression Test Suite**: `bun test` (all 174+ tests passing, including `action_economy.test.ts` and `dnd35e_cartridge.test.ts`).
5. **Campaign, Ruleset & SSOT Parity Validator**: `bun run scripts/run-validator.ts` (0 errors across all 4 campaigns, 752 modular ruleset files, and SSOT registries).
6. **Production Build**: `bun run build`.
7. **Manual Playtest Verification**:
   - In RTwP mode, walk between map zones (e.g., stairs up/down) and verify movement continues seamlessly without freeze.
   - Start a fresh character without Power Attack: confirm the Power Attack dial stepper is NOT present on the MODES bar.
   - In Turn-Based mode, press `1`–`3` on the top row to activate hotbar items/skills without mouse clicks.
   - Take 1 step in Turn-Based mode: observe `MOV 25ft` displayed, character does not pass turn; take 5 more steps; observe `MOV` spent. Click `[END TURN]` to pass remaining standard action.
