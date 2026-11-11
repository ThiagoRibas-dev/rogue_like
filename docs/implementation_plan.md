# Milestone 126 Implementation Plan — Unified Console Turn/Step Lifecycle Windows & Composable Cartridge Combat Exchange Pipeline

Re-engineering actor turn/step lifecycles and combat resolution around canonical interrupt/resolution windows (`TurnStart`, `MovementStep`, `TurnEnd`, and the 5-phase `CombatExchangePipeline`), eliminating procedural cartridge leakage in `intent_cost_resolver.ts`, synchronizing mobile emanation fields per movement step, automatically resolving aura first-entry saving throws/SR, and unifying melee, follow-up (`Cleave`), flanking, and illumination combat mechanics.

---

## User Review & Architectural Decisions

> [!IMPORTANT]
> - **Decision 1 (Tier 1 Console Lifecycle Windows vs. Inline Cartridge Branches)**: All `if (rulesetId === 'dnd35e')` action-budget and step-consumption logic in `src/core/loop/intent_cost_resolver.ts` is evicted into a dedicated Tier 2 Cartridge lifecycle adapter (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`) invoked by the Tier 1 Console lifecycle orchestrator (`src/systems/lifecycle.system.ts`). Both Player and AI actors pass through the exact same `TurnStart`, `MovementStep`, and `TurnEnd` windows.
> - **Decision 2 (Step-Synchronized Mobile Emanations & Aura Save Memory)**: Moving 5 ft immediately shifts any `FieldComponent` anchored to the mover (`syncAnchoredFieldsForEntity`), and stepping into or starting a turn inside an active spell emanation field automatically runs `evaluateActorAuraEntrySaves` (`resolveAuraFirstEntrySaveAndSr`) for any unit with a saving throw or Spell Resistance not yet recorded in `field.auraSaveMemory`.
> - **Decision 3 (5-Phase Composable Combat Exchange Pipeline)**: `resolveDnD35eMeleeAttack` is decomposed into a modular 5-phase pipeline (`src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts`):
>   1. `PreAttackPhase` (Flanking geometry + `dagResult.flankingBonus`, Cover, `resolveEffectiveTileIllumination` + `evaluateConcealmentAndSenses`)
>   2. `StrikeRollPhase` (`resolveAttackRoll`)
>   3. `OnHitRidersPhase` (conditional weapon/enhancement `damageRiders`)
>   4. `PostStrikeReactionPhase` (`resolveRetaliationRiders`)
>   5. `OnDropFollowupPhase` (`Cleave` / `Great Cleave` bonus strike execution against an adjacent hostile foe)

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Evicted From | Canonical New Owner (SSOT) | Tier |
| :--- | :--- | :--- | :---: |
| **Actor TurnStart / MovementStep / TurnEnd Orchestration** | Inline in `src/core/game-loop.ts` & `src/core/loop/intent_cost_resolver.ts` | `src/systems/lifecycle.system.ts` (`runActorTurnStart`, `runActorMovementStep`, `runActorTurnEnd`) | Tier 1 Console |
| **Immediate Mobile Field Anchor Position Sync** | Delayed inside `processFieldsTick` (`src/systems/field.system.ts`) | `src/systems/field.system.ts` (`syncAnchoredFieldsForEntity`) | Tier 1 Console |
| **D&D 3.5e Action Budget Refresh, Step Cost & Automatic Aura Entry Saves** | Hardcoded player-only block in `src/core/loop/intent_cost_resolver.ts:43–115` | `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (`onDnD35eActorTurnStart`, `onDnD35eActorMovementStep`, `resolveDnD35eActionEnergyCost`, `evaluateActorAuraEntrySaves`) | Tier 2 Cartridge |
| **5-Phase Combat Strike Exchange Pipeline** | Inline monolith in `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts:137–320` | `src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts` (`executeCombatStrikeExchange`) | Tier 2 Cartridge |
| **HUD Stance Dock Projection (Feats + Active Spell Auras)** | Feat-only loop in `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:105–120` | `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` (`buildActorStanceModes` with `auraStanceOptions`) | Tier 2 Cartridge |

---

## 2. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Tier 1 Console Lifecycle System & `RulesetContract` Hooks
- **Files**:
  - `src/types/ruleset.types.ts`
  - `src/systems/field.system.ts`
  - `src/systems/lifecycle.system.ts` (New Tier 1 Console System — register in `docs/ssot/ssot_console.json`)
  - `src/core/game-loop.ts`
  - `src/core/loop/intent_cost_resolver.ts`
  - `src/systems/movement.system.ts`
- **Implementation**:
  1. Extend `RulesetContract` in `src/types/ruleset.types.ts` with three optional lifecycle hooks:
     ```typescript
     /**
      * Optional hook invoked at the start of an actor's turn (after status ticks and Console reaction resets).
      */
     onActorTurnStart?(state: GameState, entityId: EntityId): GameState;

     /**
      * Optional hook invoked immediately after an actor completes a single movement step to `(toX, toY)`.
      */
     onActorMovementStep?(
       state: GameState,
       entityId: EntityId,
       fromPos: { readonly x: number; readonly y: number },
       toPos: { readonly x: number; readonly y: number }
     ): GameState;

     /**
      * Optional hook resolving ruleset-specific action budget consumption and turn energy cost (`0` if turn continues, `> 0` if turn ends).
      */
     resolveActionEnergyCost?(
       state: GameState,
       intent: Intent,
       baseEnergyCost: number
     ): { readonly state: GameState; readonly energyCost: number };
     ```
  2. Export `syncAnchoredFieldsForEntity(state: GameState, anchorEntityId: EntityId, newX: number, newY: number): GameState` from `src/systems/field.system.ts` so anchored mobile emanations update coordinates immediately when their anchor moves.
  3. Create `src/systems/lifecycle.system.ts`:
     ```typescript
     export function runActorTurnStart(state: GameState, entityId: EntityId): GameState {
       let nextState = processStatusEffectsTick(state, entityId);
       nextState = resolveStateStabilization(nextState);

       // Reset Tier 1 per-round triggered reaction quotas (e.g. retaliation riders)
       const doctrine = getComponent(nextState, entityId, ComponentType.TacticalDoctrine) as
         | TacticalDoctrineComponent
         | undefined;
       if (doctrine?.triggeredUsesThisRound && Object.keys(doctrine.triggeredUsesThisRound).length > 0) {
         nextState = addComponent(nextState, entityId, resetTriggeredReactionsForNewRound(doctrine));
       }

       // Tick AI cooldowns if present
       const aiComp = getComponent(nextState, entityId, ComponentType.AI);
       if (aiComp?.cooldowns) {
         // decrement positive cooldowns
       }

       const ruleset = getActiveRuleset(nextState);
       if (ruleset.onActorTurnStart) {
         nextState = ruleset.onActorTurnStart(nextState, entityId);
       }
       return nextState;
     }

     export function runActorMovementStep(
       state: GameState,
       entityId: EntityId,
       fromPos: { readonly x: number; readonly y: number },
       toPos: { readonly x: number; readonly y: number }
     ): GameState {
       let nextState = syncAnchoredFieldsForEntity(state, entityId, toPos.x, toPos.y);
       nextState = processTraps(nextState, entityId);
       const ruleset = getActiveRuleset(nextState);
       if (ruleset.onActorMovementStep) {
         nextState = ruleset.onActorMovementStep(nextState, entityId, fromPos, toPos);
       }
       return nextState;
     }
     ```
  4. Wire `runActorTurnStart` into `processTurn` (`src/core/game-loop.ts`), wire `runActorMovementStep` into `processMoveIntent` (`src/systems/movement.system.ts`), and replace the hardcoded `if (rulesetId === 'dnd35e')` block in `src/core/loop/intent_cost_resolver.ts` with `ruleset.resolveActionEnergyCost`. Also gate `processFieldsTick(nextState)` in `intent_cost_resolver.ts` on `energyCost > 0` so field durations only tick once per completed actor turn rather than on every 0-cost sub-step of a multi-tile move.

---

### Step 2: Tier 2 D&D 3.5e Lifecycle Adapter (`dnd35e_lifecycle_adapter.ts`)
- **Files**:
  - `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (New Tier 2 module — register in `docs/ssot/ssot_dnd35e.json`)
  - `src/rulesets/dnd35e/dnd35e_ruleset.ts`
- **Implementation**:
  1. Implement `evaluateActorAuraEntrySaves(state: GameState, occupantId: EntityId): GameState`:
     - Queries `queryActiveFieldsAtPosition(state, pos.x, pos.y)` for fields with `field.spellId` and `field.castId`.
     - For any hostile/save-requiring `effectUnit` on that spell where `field.auraSaveMemory?.[String(occupantId)] === undefined`, computes the occupant's effective saving throw modifier and SR from `evaluateDnD35eEntityDAG`, calls `resolveAuraFirstEntrySaveAndSr`, and logs the save/SR result.
     - Also checks if `occupantId` is the anchor of a mobile emanation field that just moved onto new occupants, evaluating `evaluateActorAuraEntrySaves` for any occupant now inside the shifted radius!
  2. Implement `onDnD35eActorTurnStart(state: GameState, entityId: EntityId): GameState`:
     - Initializes a fresh `DnD35ActionBudget` (`createRoundActionBudget`) if `!dndData.actionBudget` for both Player and AI actors.
     - Calls `evaluateActorAuraEntrySaves(state, entityId)`.
  3. Implement `onDnD35eActorMovementStep` and `resolveDnD35eActionEnergyCost`:
     - Handles 5-ft step terrain cost (`consumeMovementStepFt`), updates `actionBudget`, triggers `evaluateActorAuraEntrySaves` at the destination square, and returns `energyCost: 0` while the Player still has remaining movement/actions in `TurnBased` mode (or `100` when the budget completes or for single-intent AI turns).

---

### Step 3: Tier 2 Composable 5-Phase Combat Exchange Pipeline (`combat_exchange_pipeline.ts`)
- **Files**:
  - `src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts` (New Tier 2 module — register in `docs/ssot/ssot_dnd35e.json`)
  - `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`
- **Implementation**:
  1. Create `src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts` implementing the 5 modular strike phases:
     - **Phase 1 (`resolveStrikePreAttackContext`)**:
       - Evaluates tile illumination at the defender's position via `resolveEffectiveTileIllumination(state, defPos.x, defPos.y)` and observer sensory concealment via `evaluateConcealmentAndSenses` (combining with `defenderEval.dagResult.concealmentMissChancePercent` via `Math.max`).
       - Evaluates `isFlankingTarget(attackerPos, threateningAllyPositions, defenderPos, defenderImmuneToFlanking)` and adds `attackerEval.dagResult.flankingBonus ?? 2` to the strike's attack bonus when flanking.
     - **Phase 2 (`executeStrikeRollPhase`)**:
       - Calls `resolveAttackRoll` with the synthesized attack bonus, target AC, concealment miss chance, fortification, and critical immunity.
     - **Phase 3 (`applyOnHitDamageRiders`)**:
       - Evaluates `strike.damageRiders` against `matchesEntityTagCondition` and queues primary + rider damage instances onto the defender's `DamageComponent`.
     - **Phase 4 (`applyPostStrikeRetaliation`)**:
       - Evaluates defender's active `retaliation_rider`s via `resolveRetaliationRiders`, updates the defender's `TacticalDoctrineComponent`, and queues retaliation damage onto the attacker's `DamageComponent`.
     - **Phase 5 (`resolveOnDropCleaveFollowup`)**:
       - When a strike reduces `defenderHpRemaining <= 0` and `resolveCleaveFollowupEligibility(true, cleaveCountThisTurn, attackerEval.hasGreatCleave)` is true, searches adjacent squares around the attacker for another living hostile `Fighter` entity and executes a bonus melee strike at the same AB against that secondary foe!
  2. Refactor `resolveDnD35eMeleeAttack` in `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts` to delegate strike execution to `executeCombatStrikeExchange`, bringing `dnd35e_combat_adapter.ts` well below 200 lines (eliminating the ESLint `max-lines` warning).

---

### Step 4: HUD Stance Dock Aura Projection & Max-Lines Cleanup
- **Files**:
  - `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`
  - `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`
  - `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`
  - `src/rulesets/dnd35e/progression/ledger_modifiers.ts`
- **Implementation**:
  1. Update `buildActorStanceModes` in `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` to accept `auraStanceOptions?: ReadonlyArray<ConsoleStanceGroupOption>` and append each option (resolving `isActive` via `resolveActiveStanceInGroup(doctrine, opt.groupId, auraStanceOptions)`).
  2. In `DnD35UIAdapter.getHotbarData` (`src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`), pass `evaluateActiveSpellAuraContributions(state, entityId).stanceGroupOptions` into `buildActorStanceModes`.
  3. Trim redundant blank/comment lines in `weapon_profile_parser.ts` (309 -> <295 lines) and `ledger_modifiers.ts` (309 -> <295 lines) so `lint_applet` reports **0 errors and 0 warnings**.

---

### Step 5: End-to-End Regression Test Suite (`tests/dnd35e_m126_lifecycle_pipeline.test.ts`)
- **Files**:
  - `tests/dnd35e_m126_lifecycle_pipeline.test.ts` (New test suite)
  - `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, `docs/MILESTONES.md`
- **Tests to Verify**:
  1. **TurnStart Reaction Quota Reset**: Defender triggers `1/round` retaliation rider in Round 1 -> blocked on second hit in Round 1 -> `runActorTurnStart` runs at start of defender's Round 2 turn -> retaliation rider fires again in Round 2.
  2. **Per-Step Mobile Emanation Sync & Automatic Aura Entry Save**: Caster with active *Blade Tempest Invocation* moves 5 ft toward an Evil enemy -> field position syncs immediately on the step -> Evil enemy automatically rolls Will save / SR and records `'failed'` or `'saved'` in `field.auraSaveMemory`.
  3. **5-Phase Combat Exchange — Live Flanking (`+4`) & Shadowy Illumination (`20%` Miss Chance)**: Attacker with *Coordinated Host* (`+2` flanking modifier) flanks an enemy with an ally -> receives `+4` flanking bonus on `resolveDnD35eMeleeAttack`; attacking into *Night's Battlefield* shadowy illumination without darkvision/low-light vision applies `20%` concealment miss chance.
  4. **5-Phase Combat Exchange — Live Cleave Follow-up Execution**: Attacker with `cleave` drops Goblin A (`<= 0` HP) and automatically executes a free Cleave strike against adjacent Goblin B in the same attack action.
  5. **HUD Stance Dock Aura Projection**: `DnD35UIAdapter.getHotbarData` projects *Blade Tempest Invocation*'s 3 `battle_cadence` stances (`spectral_assault`, `flurry_of_steel`, `divine_celerity`) into `hotbar.stanceModes` with default selection active.

---

## 3. Cascading Effects Matrix

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers) | Lateral (Mirrors / Registries) |
| :--- | :--- | :--- | :--- |
| **`src/systems/lifecycle.system.ts` (`runActorTurnStart`, `runActorMovementStep`)** | `processTurn` (`game-loop.ts`), `processMoveIntent` (`movement.system.ts`) | `resetTriggeredReactionsForNewRound`, `syncAnchoredFieldsForEntity`, `RulesetContract.onActorTurnStart` / `onActorMovementStep` | Shared by `classic` and `dnd35e` cartridges |
| **`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`** | `dnd35eRulesetContract` (`dnd35e_ruleset.ts`), `applyIntentWithCost` (`intent_cost_resolver.ts`) | `createRoundActionBudget`, `consumeMovementStepFt`, `evaluateActorAuraEntrySaves` | Eliminates all D&D 3.5e imports from `intent_cost_resolver.ts` |
| **`src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts`** | `resolveDnD35eMeleeAttack` (`dnd35e_combat_adapter.ts`) | `isFlankingTarget`, `resolveEffectiveTileIllumination`, `evaluateConcealmentAndSenses`, `resolveRetaliationRiders`, `resolveCleaveFollowupEligibility` | Shrinks `dnd35e_combat_adapter.ts` from 398 lines to ~160 lines |
| **Aura Stance Projection in `buildActorStanceModes`** | `DnD35UIAdapter.getHotbarData` (`dnd35e_ui_adapter.ts`) | `console_hotbar.ui.ts`, `onToggleStance` | Unifies feat-granted and spell-aura-granted stance toggles |
