# Research Notes: Hotbar Keybindings, RTwP Transition Lock, Declarative Stances, & Turn-Based Action Economy

## 1. Problem Statements & Root Causes

### A. Hotbar Key Response (Numbers 1–9, 0, -, =)
- **Current State**:
  - In `src/core/input/shortcut_input.ts:73`, there is hardcoded legacy code:
    ```ts
    if (event.key === '1' || event.key === '3' || event.key === '5') {
      if (triggerQuickBeltSlot(getGameState(), playerEntityId, Number(event.key) - 1)) {
        event.preventDefault();
        return true;
      }
    }
    ```
  - It only checked `'1'`, `'3'`, `'5'` because `'2'`, `'4'`, `'6'`, `'8'` are default numpad movement bindings (`move_south`, `move_west`, etc.) in `src/core/settings.ts`!
  - But top-row number keys (`Digit1`..`Digit0`, `Minus`, `Equal`) are distinct from numpad keys (`Numpad1`..`Numpad9`) via `event.code` vs `event.key`.
  - In `src/core/settings.ts`, the default binds for `move_*` include `'2', '4', '6', '8'`. When a player presses top-row `'2'` on their keyboard, `event.key === '2'`, which triggered `move_south` instead of hotbar slot 2!
  - Furthermore, clicking a hotbar slot calls `callbacks.onExecuteSlot(slotIndex)` in `hud_bottom_dock.ui.ts`, which delegates to `cartridgeUI.onExecuteHotbarSlot(...)` (or fallback `triggerQuickBeltSlot`).
- **Conflict Analysis & Safeguards**:
  - If we bind hotbar slots to top-row number keys `1`–`9`, `0`, `-`, `=`, we must ensure:
    1. **Numpad vs Top-Row Differentiation**: Check `event.code` (`Digit1`..`Digit0`, `Minus`, `Equal`) or distinguish when numpad keys (`Numpad2`, etc.) are used for roguelike 8-way/4-way movement so numpad movement is not broken.
    2. **Modal / Text Input Protection**: When a modal is open, or when typing in an `<input>` / `<textarea>` (like in the editor or search bars), hotbar keys must be suppressed.
    3. **No Double Invocations**: Do not execute both `triggerQuickBeltSlot` and `onExecuteHotbarSlot`. We unify hotbar key dispatching through a single canonical function `executeHotbarSlotByKey(state, playerEntityId, slotIndex)` that routes through `cartridgeUI.onExecuteHotbarSlot` if present, else fallback `triggerQuickBeltSlot`.

### B. RTwP Area Transition Freeze
- **Current State**:
  - `src/systems/map.system.ts:290` calls `clearScheduler()` on area transition.
  - `clearScheduler()` in `src/core/scheduler.ts` sets `isEngineLocked = true` and `cancelAnimationFrame(rtwpLoopId)`.
  - In Turn-Based mode, pressing an arrow key calls `unlockEngine()` which restarts the turn-based loop. In RTwP mode, input does not call `unlockEngine()`, it just enqueues an intent into the input queue waiting for `rtwpLoop`—which is now dead and locked!
- **Solution**:
  - Add `resetSchedulerActors()` in `src/core/scheduler.ts` that clears `scheduler` and `actors` without locking the engine or cancelling the animation frame loop.
  - Use `resetSchedulerActors()` in `src/systems/map.system.ts` during area transitions.

### C. Hardcoded Stance Modes & Feat Leak in Character Creation
- **Current State**:
  - `DEFAULT_PLAYER_ARCHETYPE` in `src/rulesets/dnd35e/archetype_resolver.ts` has `feats: ['power_attack', 'cleave', 'combat_reflexes']`.
  - In `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts:66`, `applyCharacterCreationToPlayer` spread `...currentData` without resetting `feats: []`. The newly created player character retained `power_attack` even if never chosen.
  - `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:42` had hardcoded `if (feats.has('power_attack'))` and `if (feats.has('combat_expertise'))`, and hardcoded `fighting_defensively`, `total_defense`, and `two_handed_grip`.
- **Solution**:
  - Clear `feats: []` on `withBaseAbilities` in `applyCharacterCreationToPlayer`.
  - Register baseline universal tactical combat abilities (`fighting_defensively`, `total_defense`, `two_handed_grip`) in `public/data/rulesets/dnd35e/` as standard abilities with declarative `effectBundle` descriptors.
  - In `buildActorStanceModes`, dynamically iterate over actor abilities and dials (`extractActorTacticalDials`), with zero hardcoded IDs.

### D. Multi-Step Turn-Based Rounds & Action Economy
- **Current State**:
  - `src/rulesets/dnd35e/action_economy.ts` has `createRoundActionBudget`, `consumeMovementStepFt`, `downgradeStandardToMove`, etc.
  - `intent_cost_resolver.ts` always returned `energyCost = 100` on any move or action, terminating the turn immediately.
  - `DND35E_ACTION_PIPS` was a static array with `available: true`.
- **Solution**:
  - Maintain `actionBudget?: DnD35ActionBudget` on actor state (`DnD35EntityData` / `actor.actionBudget`).
  - At the start of a turn in turn-based mode, ensure a fresh round action budget is active.
  - When moving, consume movement via `consumeMovementStepFt`. If movement budget remains, return `energyCost = 0` (turn continues).
  - When standard action (attack/cast) is taken, consume standard action. If both standard and move (and movement remaining) are exhausted, return `energyCost = 100` (turn ends).
  - Add an explicit `[END TURN]` button on the HUD bottom dock and `Space` / `.` keybind to end turn immediately (`energyCost = 100`).
  - Project `actionPips` dynamically from `actionBudget`.

---

## 2. Upstream, Downstream, and Lateral Cascading Matrix (Rule 15)

| Change | Upstream Impact | Downstream Impact | Lateral Impact |
| :--- | :--- | :--- | :--- |
| **Hotbar Number Keys** (`Digit1`..`Digit0`, `-`, `=`) | `src/core/input_handler.ts`, `src/core/input/shortcut_input.ts` | `src/rendering/ui/hud_bottom_dock.ui.ts`, `cartridgeUI.onExecuteHotbarSlot` | Top-row vs Numpad movement keybindings (`settings.ts`) |
| **Scheduler Actor Reset** (`resetSchedulerActors`) | `src/systems/map.system.ts` (`transitionArea`) | `src/core/scheduler.ts` (RTwP loop remains alive) | No disruption to `clearScheduler()` callers during full shutdown |
| **Player Hydrator Feat Reset** | `applyCharacterCreationToPlayer` | `dndData.feats` on newly created characters | Test fixtures in `tests/` that create characters |
| **Declarative Stance & Dial Modes** | `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`, `dnd35e_ui_adapter.ts` | `#hud-bottom-dock` modes strip rendering | Ability descriptions in SRD system content |
| **Turn-Based Round Budget & End Turn** | `src/core/loop/intent_cost_resolver.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts` | Scheduler turn duration, `DND35E_ACTION_PIPS` in hotbar dock | Test suites verifying turn-based action sequences |
