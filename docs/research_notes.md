# Phase 31 (Milestone 131) Research Notes — Companion AI, Tactical Stance Packages & Command Directives

## 1. Rules & Architectural Constraints (`AGENTS.md` & `ARCHITECTURE.md`)
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** No `any`, explicit return types on all functions, and named constants for all gameplay/tactical distances (`DEFAULT_COMPANION_FOLLOW_DISTANCE = 2`, `DEFAULT_COMPANION_LEASH_RADIUS = 8`, `DEFAULT_COMPANION_DEFEND_RADIUS = 3`).
- **Rule 15 (Cascading Effects Matrix):** Every change to `ControllerLinkComponent`, `AIBehaviorEntrySchema`, `Verb`, `ConsequenceActionSchema`, `movement.system.ts`, `game-loop.ts`, and `companions.ts` must be mapped across **Upstream**, **Downstream**, and **Lateral** axes.
- **Rule 16 (Three-Tier Placement Heuristic):** Push generic RPG simulation primitives (companion stances, focus-target directives, `follow` behavior, leash/stance target filtering, corridor position-swapping, and command verbs/dialogues) into **Tier 1 — Core Console Engine** so any ruleset cartridge (`classic`, `dnd35e`, or custom) inherits full companion AI and control without cartridge duplication.
- **Rule 18 (Universal Actor Symmetry):** Companions, familiars, cohorts, and summons are standard Actors using the same `AIComponent`, `ControllerLinkComponent`, `FactionComponent`, `AttitudeComponent`, `EquipmentComponent`, and `InventoryComponent` as any other Actor.

---

## 2. Three-Tier Placement Analysis (Console vs. Cartridge vs. Content)

| Capability / Responsibility | Tier | Canonical Owner | Rationale |
| :--- | :--- | :--- | :--- |
| **`ControllerLinkComponent` Tactical Directives (`stance`, `commandTargetId`, `followDistance`, `leashRadius`)** | **Tier 1 (Console)** | `src/types/components/actor_components.types.ts` | Any ruleset can have pets, drones, hirelings, cohorts, animal companions, or summons. Storing stance and focus-target state on `ControllerLinkComponent` keeps it serializable (`JSON.stringify` safe) and ruleset-agnostic. |
| **`follow` AI Behavior & Obstacle-Sliding Step Resolver** | **Tier 1 (Console)** | `src/ai/follow.behavior.ts`, `src/systems/ai.system.ts`, `src/types/campaign/entity.ts` | Stepping toward `controllerEntityId` when distance $> \text{followDistance}$ (and holding position when `stance === 'hold'`) is a universal spatial AI primitive. |
| **Leash, Stance & Focus-Target Filtering (`resolveAITarget`)** | **Tier 1 (Console)** | `src/ai/companion_targeting.ts`, `src/ai/{hunt,ranged,spell}.behavior.ts` | Filtering candidate hostiles by `stance` (`'aggressive'`, `'defensive'`, `'passive'`, `'hold'`), prioritizing `commandTargetId`, and returning `null` when exceeding `leashRadius` (so `follow` takes over) applies to all AI behaviors across all rulesets. |
| **Corridor Friendly Bump-Swap** | **Tier 1 (Console)** | `src/systems/movement.system.ts` | Swapping positions when a controller bumps into a friendly `ControllerLink` actor prevents 1-tile corridor deadlocks in any dungeon campaign. |
| **Companion Command Verbs, Dynamic Command Dialogue, Targeting Integration & Dialogue Consequences** | **Tier 1 (Console)** | `src/constants/verbs.constants.ts`, `src/systems/companion_commands.system.ts`, `src/systems/apply.system.ts`, `src/systems/targeting.system.ts`, `src/types/trigger.types.ts`, `src/systems/trigger/social_consequences.ts` | Right-click context verbs (`command`, `order_attack`, `order_defend`, `order_follow`, `order_hold`, `order_target`), built-in companion command dialogue, and `set_companion_stance` / `order_companion_target` dialogue consequences work identically across all campaigns. |
| **Mid-Session Actor Scheduler Auto-Enrollment (`addActor`)** | **Tier 1 (Console)** | `src/core/game-loop.ts` | Currently, actors spawned after initial bootstrap (such as companions spawned during Character Creation or Level-Up) are not registered in `ROT.Scheduler.Action`. Auto-enrolling any new `Actor` in `updateState` fixes this globally while keeping Tier 2 spawners pure. |
| **D&D 3.5e Companion & Familiar Spawning (`AIComponent`, Adjacent Placement, Equipment Init)** | **Tier 2 (Cartridge)** | `src/rulesets/dnd35e/companions.ts` | `syncActorCompanionsAndFamiliars` / `upsertLinkedServantActor` computes D&D 3.5e Bonus HD, Natural Armor, and Familiar scaling, then attaches `AIComponent` (`profileId: 'companion_default'`), places new companions on an adjacent walkable tile, and preserves `stance`/`commandTargetId` across level-ups. |
| **`companion_default` AI Profile Definition** | **Tier 3 (Content)** | `public/data/campaigns/*/ai.json`, `src/editor/blank_slate_campaign.ts` | Data-driven AI profile combining `hunt` (`aggroRadius: 6`) + `follow` (`followDistance: 2`, `leashRadius: 8`). |

---

## 3. Existing Codebase Findings & Gaps Discovered

1. **Gap 1 — Missing `AIComponent` on Spawned Companions (`src/rulesets/dnd35e/companions.ts`)**:
   - `upsertLinkedServantActor` (lines 264–298) creates a new entity with `Actor`, `Position`, `Renderable`, `ControllerLink`, `Faction` (`'player'`), `Attitude` (`'helpful'`), `Identity`, `Fighter`, and `RulesetData`, **but never attaches `ComponentType.AI` (`AIComponent`)**.
   - In `processAITurn` (`src/systems/ai.system.ts`, line 34), `if (!ai || !pos) return { intent: null, state };`, causing companions to do nothing on their turns.
2. **Gap 2 — Missing Scheduler Registration (`addActor`) for Mid-Session Spawns (`src/core/game-loop.ts` & `src/rulesets/dnd35e/companions.ts`)**:
   - `bootstrap.ts` calls `addActor(id)` for initial entities *before* the player completes the D&D 3.5e Character Creation modal (`applyCharacterCreationToPlayer`) or Level-Up modal (`applyLevelUpToActor`).
   - When `syncActorCompanionsAndFamiliars` creates a companion entity inside `applyCharacterCreationToPlayer` or `applyLevelUpToActor`, `addActor(entId)` is never called, so `ROT.Scheduler.Action` never schedules the companion's turns until the player changes floors (`processChangeAreaIntent`)!
   - **Solution**: In `updateState` (`src/core/game-loop.ts`), whenever `prevState === null || prevState.entities !== newState.entities`, iterate `newState.entities` and call `addActor(id)` (which is already an $O(1)$ no-op if `actors.has(id)`) for every entity possessing `ComponentType.Actor`.
3. **Gap 3 — Stacked Spawn Position (`src/rulesets/dnd35e/companions.ts`)**:
   - Line 267 of `companions.ts` places newly created companions at `{ x: masterPos.x, y: masterPos.y }` (stacked directly on the player's tile) instead of an adjacent walkable, unoccupied tile.
4. **Gap 4 — Corridor Blocking (`src/systems/movement.system.ts`)**:
   - Lines 196–225 of `movement.system.ts`: when moving into a non-hostile actor (`blockedByEntityId`) that lacks `DialogueComponent` and `InteractableComponent`, `processMoveIntent` blocks movement with `"Something is in the way."`.
   - If `blockedByEntityId` has a `ControllerLinkComponent` with `controllerEntityId === entityId` (or vice versa when controlled by the player), and both actors can traverse each other's tiles (`canTraverseTile`), swapping their `PositionComponent`s and firing `runActorMovementStep` for both actors resolves corridor deadlocks cleanly.
5. **Gap 5 — Dynamic Companion Command Dialogue & Verb Menu Integration**:
   - `renderDialoguePanel` (`src/rendering/ui/dialogue.ui.ts`) and `processSelectDialogueOptionIntent` (`src/actions/dialogue.actions.ts`) look up `state.campaign.dialogues[treeId]`.
   - If we provide a helper `resolveDialogueTree(state, treeId, npcEntityId)` used by `startDialogue`, `dialogue.actions.ts`, and `dialogue.ui.ts` that synthesizes the built-in `__companion_orders__` `DialogueTree` when `treeId === '__companion_orders__'`, then:
     - We don't need to pollute every campaign's `dialogues.json` with hardcoded system nodes.
     - The dialogue dynamically displays the companion's name, current stance (`Aggressive`, `Defensive`, `Passive`, `Hold`), and current focus target!
     - Even better, because options in `__companion_orders__` use standard `ConsequenceAction`s (`set_companion_stance`, `order_companion_target`), custom campaign dialogues in `dialogues.json` can also use those exact same consequences!

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Save Schemas) | Lateral (Sibling Campaign JSONs / Kits / Docs) |
| :--- | :--- | :--- | :--- |
| **`ControllerLinkComponent` (`stance`, `commandTargetId`, `followDistance`, `leashRadius`)** | `syncActorCompanionsAndFamiliars` (`companions.ts`), `companion_commands.system.ts`, `social_consequences.ts`, `processAITurn` (stale target cleanup) | `followBehavior`, `resolveAITarget` (`hunt`, `ranged`, `spell`), `buildInspectTooltip` (`inspect_tooltip.ts`), `save_roundtrip.test.ts` (JSON serializable primitives only) | `src/types/components/actor_components.types.ts` |
| **`AIBehaviorEntrySchema` (`follow` variant)** | `ai.json` across all campaigns, `blank_slate_campaign.ts` | `processAITurn` (`BEHAVIOR_REGISTRY`), `campaign_validator.ts`, `scripts/generate-ai-prompt-kit.ts` | `public/data/campaigns/{default,dnd35e-crypt,megacampaign,shroudgarde}/ai.json` |
| **`Verb` & `VERBS` (`command`, `order_attack`, `order_defend`, `order_follow`, `order_hold`, `order_target`)** | `getValidVerbsForTarget` (`apply.system.ts`), `mouse_input.ts` (right-click verb menu), `verb_menu.ui.ts` | `processApplyIntent` (`apply.system.ts` $\to$ `processCompanionVerbIntent`), `targeting.system.ts` (`processFireAimedIntent`), `mouse_input.ts` (`handleCanvasLeftClick`) | `src/constants/verbs.constants.ts` |
| **`ConsequenceActionSchema` (`set_companion_stance`, `order_companion_target`)** | `__companion_orders__` dialogue tree, custom campaign `dialogues.json` / `triggers.json` | `trigger.system.ts` (`consequenceAppliers` exhaustive map), `social_consequences.ts`, `dialogue.validator.ts`, `trigger.validator.ts` | `src/types/trigger.types.ts`, `src/types/dialogue.types.ts` |
| **Corridor Friendly Bump-Swap (`processMoveIntent`)** | Player `MoveIntent` into tile occupied by a linked companion (`ControllerLinkComponent`) | `updateSpatialIndex`, `runActorMovementStep`, message log (`"You swap places with <Name>."`) | `src/systems/movement.system.ts` |
| **Mid-Session Scheduler Auto-Enrollment (`updateState` in `game-loop.ts`)** | `applyCharacterCreationToPlayer`, `applyLevelUpToActor`, `spawn_entity` triggers | `ROT.Scheduler.Action` (`addActor`), `processTurn` | `src/core/game-loop.ts`, `src/core/scheduler.ts` |
