# Milestone 126 Research Notes — Unified Console Turn/Step Lifecycle Windows & Composable Cartridge Combat Exchange Pipeline

## 1. Core Architectural Standards & Golden Rules Reiteration
1. **Three-Tier Placement Heuristic (Rule 16)**:
   - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`)**: Owns ruleset-agnostic turn scheduling, actor turn-start/turn-end lifecycle windows (`runActorTurnStart`, `runActorMovementStep`, `runActorTurnEnd`), per-round reaction counter resets (`resetTriggeredReactionsForNewRound`), and mobile field anchor synchronization (`syncAnchoredFieldsForEntity`). Tier 1 Console modules must **never** hardcode `if (rulesetId === 'dnd35e')` branches or import D&D 3.5e action-budget math directly.
   - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`)**: Owns the 5-tier 6-second action economy (`DnD35ActionBudget`), automatic spell aura first-entry saving throw / Spell Resistance resolution (`evaluateActorAuraEntrySaves`), and the composable 5-phase **Combat Exchange Pipeline** (`combat_exchange_pipeline.ts`).
   - **Tier 3 — System Content (`public/data/rulesets/dnd35e/*.json`)**: Declarative JSON definitions for spells, feats, items, and enhancements consumed by Tier 2 phases without hardcoded branches.
2. **Universal Actor Symmetry (Rule 18)**:
   - Player characters and AI monsters must pass through the exact same `TurnStart`, `MovementStep`, and `CombatExchangePipeline` windows. AI actors must receive round action budgets, reaction quota resets, aura entry saves, and flanking/illumination modifiers identically to the player.
3. **ECS Serialization Purity & TypeScript Strictness (Rules 11, 12, Section 4)**:
   - Zero `any`, zero magic values, explicit return types, `exactOptionalPropertyTypes: true` compliance, and pure JSON-serializable ECS components.
   - All files must adhere to the 300-line ESLint `max-lines` budget.

---

## 2. Empirical Codebase Audit & Root-Cause Findings

### Finding 1: Cartridge Leakage & Player/AI Asymmetry in `src/core/loop/intent_cost_resolver.ts`
- **Current State (`intent_cost_resolver.ts:11–16, 43–125`)**:
  - `intent_cost_resolver.ts` (a Tier 1 Console module) directly imports `getDnD35EntityData`, `setDnD35EntityData`, `createRoundActionBudget`, and `consumeMovementStepFt` from `../../rulesets/registry.ts`.
  - Lines `43–115` check `if (state.campaign?.manifest?.rulesetId === 'dnd35e' && state.engineMode === EngineMode.TurnBased)` and then gate the entire 5-tier action budget logic behind `if (isPlayer)`.
  - Meanwhile, `processTurn(entityId)` in `src/core/game-loop.ts:108–250` runs `processStatusEffectsTick(state, entityId)`, ticks AI cooldowns inline (`lines 203–218`), and never invokes `resetTriggeredReactionsForNewRound` or any cartridge `onActorTurnStart` hook.
- **Architectural Impact**:
  - `TacticalDoctrineComponent.triggeredUsesThisRound` (used by `retaliation_rider`s like *Blade Tempest Invocation*) is never cleared at the start of an actor's new round.
  - AI actors in D&D 3.5e never initialize or refresh `DnD35ActionBudget`.
  - Tier 1 Console is coupled to Tier 2 D&D 3.5e action-economy internals.

### Finding 2: Delayed Mobile Emanation Sync & Missing Automatic Aura Entry Hook
- **Current State (`src/systems/field.system.ts:79–90`, `src/systems/movement.system.ts:229–251`)**:
  - `processMoveIntent` updates `PositionComponent` on the moving entity (`movement.system.ts:235`), but mobile fields with `anchorEntityId === entityId` only update their position inside `processFieldsTick` (`field.system.ts:80–90`) *after* the action and state stabilization complete.
  - Furthermore, when an actor moves onto a tile covered by an active spell emanation field (or when a caster with an anchored emanation moves so the field now covers a new enemy), `resolveAuraFirstEntrySaveAndSr` (`src/rulesets/dnd35e/magic/spell_aura_resolver.ts:204`) is never called automatically.
- **Architectural Impact**:
  - During a multi-step move turn (`energyCost === 0` while `movementRemainingFt > 0`), `processFieldsTick` runs on each intent, which erroneously ticks down `field.duration` on every 5-ft step of a 30-ft move instead of only when the actor's turn actually advances!
  - Hostile enemies entering *Blade Tempest Invocation*'s 30-ft emanation do not automatically roll their initial Will save / Spell Resistance check unless `resolveAuraFirstEntrySaveAndSr` is invoked on step/turn-start.

### Finding 3: Monolithic Procedural Combat Script in `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`
- **Current State (`dnd35e_combat_adapter.ts:39–326`)**:
  - `resolveDnD35eMeleeAttack` is a 288-line function inside a 398-line file (exceeding the 300-line ESLint threshold).
  - It interleaves pre-attack checks, strike iteration, weapon damage rider rolling (`lines 199–250`), defender retaliation rider resolution (`lines 251–305`), and Cleave eligibility checks (`lines 307–319`).
  - Crucially:
    1. It does **not** call `resolveEffectiveTileIllumination` + `evaluateConcealmentAndSenses` to apply ambient/field shadowy illumination miss chance (`20%`) or darkness total concealment (`50%`) when the defender lacks explicit `concealmentMissChancePercent` modifiers.
    2. It does **not** call `isFlankingTarget` or add `attackerEval.dagResult.flankingBonus` (`+2` base + `flanking_attack_bonus` modifiers) when an allied combatant threatens the opposite side of the defender.
    3. When `resolveCleaveFollowupEligibility` returns `true` (`line 310`), it only logs `[Cleave] Dropped foe grants a free follow-up melee strike!` without actually executing the follow-up strike against an adjacent hostile target!

### Finding 4: HUD Stance Dock Missing Aura-Granted Stance Groups
- **Current State (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:35–123`, `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts:115–135`)**:
  - `buildActorStanceModes` inspects `dndData.feats` for `activatedAbilities` with `toggleGroup`, but does not accept `auraStanceOptions: ReadonlyArray<ConsoleStanceGroupOption>` from `evaluateActiveSpellAuraContributions`.
  - Consequently, while *Blade Tempest Invocation* is active on the caster, `battle_cadence` stance options (`spectral_assault`, `flurry_of_steel`, `divine_celerity`) are returned by `evaluateActiveSpellAuraContributions(state, entityId).stanceGroupOptions`, but not displayed in the HUD Stance Dock unless passed into `buildActorStanceModes`.

---

## 3. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Old Location (Evicted / Refactored) | Canonical New Owner (SSOT) | Tier |
| :--- | :--- | :--- | :---: |
| **Actor Turn-Start / Turn-End / Step Orchestration & Reaction Quota Reset** | Inline in `src/core/game-loop.ts` & `src/core/loop/intent_cost_resolver.ts` | `src/systems/lifecycle.system.ts` (`runActorTurnStart`, `runActorMovementStep`, `runActorTurnEnd`) | Tier 1 Console |
| **Immediate Mobile Field Anchor Position Sync** | Delayed inside `processFieldsTick` (`src/systems/field.system.ts`) | `src/systems/field.system.ts` (`syncAnchoredFieldsForEntity`, called immediately on movement step) | Tier 1 Console |
| **D&D 3.5e Round Action Budget Lifecycle & Aura Entry Save/SR Triggering** | Hardcoded player-only block in `src/core/loop/intent_cost_resolver.ts:43–115` | `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (`onDnD35eActorTurnStart`, `onDnD35eActorMovementStep`, `onDnD35eActorActionCost`, `evaluateActorAuraEntrySaves`) | Tier 2 Cartridge |
| **5-Phase Combat Strike Exchange (Pre-Attack Geometry/Senses, Roll, On-Hit Riders, Retaliation, Cleave Follow-up)** | Inline monolith in `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts:137–320` | `src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts` (`executeCombatStrikeExchange`, `resolveStrikePreAttackContext`, `applyOnHitDamageRiders`, `applyPostStrikeRetaliation`, `resolveOnDropCleaveFollowup`) | Tier 2 Cartridge |
| **HUD Stance Dock Projection (Feats + Active Spell Auras)** | Feat-only loop in `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:105–120` | `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` (`buildActorStanceModes` accepting `auraStanceOptions`) | Tier 2 Cartridge |

---

## 4. Cascading Effects Matrix

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Renderers) | Lateral (Mirrors / Registries) |
| :--- | :--- | :--- | :--- |
| **`RulesetContract` optional lifecycle hooks (`onActorTurnStart`, `onActorMovementStep`, `resolveActionEnergyCost`)** | `src/core/game-loop.ts`, `src/core/loop/intent_cost_resolver.ts`, `src/systems/lifecycle.system.ts` | `dnd35eRulesetContract` (`dnd35e_ruleset.ts`), `dnd35e_lifecycle_adapter.ts` | `classicRulesetContract` (uses default Console behavior with zero changes) |
| **`syncAnchoredFieldsForEntity` & step-gated `processFieldsTick`** | `src/systems/movement.system.ts`, `src/systems/lifecycle.system.ts` | `evaluateActiveSpellAuraContributions`, `resolveEffectiveTileIllumination`, `evaluateActorAuraEntrySaves` | All spatial fields (`fields.json`, `spatial_field` spell units) |
| **5-Phase `CombatExchangePipeline` (`combat_exchange_pipeline.ts`)** | `resolveDnD35eMeleeAttack` (`dnd35e_combat_adapter.ts`) | `resolveAttackRoll`, `resolveEffectiveTileIllumination`, `isFlankingTarget`, `resolveRetaliationRiders`, `DamageComponent` | Cleave/Great Cleave feats, *Blade Tempest Invocation*, *Bane*/*Flaming* weapons |
| **Aura-Granted Stances in `buildActorStanceModes`** | `DnD35UIAdapter.getHotbarData` (`dnd35e_ui_adapter.ts`) | `console_hotbar.ui.ts`, `onToggleStance` (`src/rendering/ui/dnd35e_ui_adapter.ts`) | Feat-granted stances, `battle_cadence` spell stances |
