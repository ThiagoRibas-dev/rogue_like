# Implementation Plan: Hotbar Keys, RTwP Transition, Declarative Stances, & Multi-Action Round Economy

## Overview of Changes

1. **Hotbar Keyboard Controls (`1`–`9`, `0`, `-`, `=`)**:
   - Differentiate top-row number keys (`Digit1` through `Digit0`, `Minus`, `Equal`) from numpad keys (`Numpad2`, `Numpad4`, `Numpad6`, `Numpad8` used for movement).
   - In `src/core/input/shortcut_input.ts`, replace the old `1/3/5` check with top-row hotbar slot execution (slots 0–11).
   - Route through `executeHotbarSlot(state, playerId, slotIndex)`, which properly triggers `cartridgeUI.onExecuteHotbarSlot` (or quick-belt fallback) without double keystrokes or suppressed movement.

2. **RTwP Area Transition Freeze**:
   - In `src/core/scheduler.ts`, export `resetSchedulerActors()`: clears `scheduler` and `actors` without setting `isEngineLocked = true` and without cancelling `rtwpLoopId`.
   - In `src/systems/map.system.ts:290`, call `resetSchedulerActors()` instead of `clearScheduler()`.

3. **Eliminate Feat Leak & Hardcoded Stances**:
   - In `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`, ensure `withBaseAbilities` resets `feats: []` instead of inheriting `['power_attack', 'cleave', 'combat_reflexes']` from `DEFAULT_PLAYER_ARCHETYPE`.
   - Define baseline universal combat abilities (`fighting_defensively`, `total_defense`, `two_handed_grip`) in `public/data/rulesets/dnd35e/abilities/` or runtime registries.
   - Refactor `buildActorStanceModes` and `dnd35e_ui_adapter.ts` to iterate declaratively over actor dials and toggle abilities via `extractActorTacticalDials` and effect bundles—removing all hardcoded IDs.

4. **Turn-Based Multi-Action Round & `[END TURN]` Button**:
   - In `DnD35EntityData`, include `actionBudget?: DnD35ActionBudget`.
   - When taking a step in Turn-Based mode, call `consumeMovementStepFt`. If the actor has movement feet remaining in their budget, set `energyCost = 0` so ROT.js lets the actor continue acting.
   - When standard action (attack or spell) is taken, consume standard action from budget.
   - When all movement and standard actions are spent, return `energyCost = 100` to advance the round.
   - Add an explicit **`[END TURN]`** button on the dock modes bar and allow `Space` or `.` in Turn-Based mode to yield the rest of the round immediately.
   - Project `actionPips` dynamically from `actionBudget` (showing remaining feet, e.g. `MOV 20ft`).

---

## Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers) | Lateral (Mirrors / Other Modes) |
| :--- | :--- | :--- | :--- |
| **Top-row hotbar keys** | `shortcut_input.ts`, `input_handler.ts` | `hud_bottom_dock.ui.ts`, `cartridgeUI.onExecuteHotbarSlot` | Numpad movement (`settings.ts`) preserved without conflict |
| **`resetSchedulerActors`** | `src/systems/map.system.ts` | `src/core/scheduler.ts`, `rtwpLoop` | Turn-based mode remains unaffected; RTwP loop stays running across floors |
| **Feat leak fix** | `applyCharacterCreationToPlayer` | `dndData.feats`, `evaluateDnD35eEntityDAG` | New character sheets now only show actually chosen feats |
| **Declarative stance projection** | `dnd35e_ui_hotbar.ts`, `dnd35e_ui_adapter.ts` | `console_hotbar.ui.ts` modes bar | Other ruleset cartridges can project dials/stances without core changes |
| **Round action budget & End Turn** | `intent_cost_resolver.ts`, `dnd35e_combat_adapter.ts` | ROT.js scheduler queue, `crpg-action-pips-strip` | Full-attack detection now correctly checks `distanceMovedThisRoundFt` |

---

## Verification Plan

1. Strict TypeScript check (`bun x tsc --noEmit`).
2. Lint check (`bun run lint`).
3. Regression tests (`bun test`).
4. Production build (`bun run build`).
5. Campaign & SSOT validator (`bun run scripts/run-validator.ts`).
6. Manual playtest scenario:
   - Start in RTwP mode, walk through stairs/portals to another area, and verify movement continues seamlessly without freeze.
   - Create a character without Power Attack: verify Power Attack dial is absent from the MODES bar.
   - In Turn-Based mode, press a number key `1`–`3` to use a hotbar item/ability via keyboard.
   - Take several steps: verify movement consumes feet from `MOV` pip without ending turn until movement is exhausted or `[END TURN]` is clicked.
