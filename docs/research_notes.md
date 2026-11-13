# Research Notes — Milestone 131.1: Companion Turn-Based Pacing, Tactical Movement Speed & Declarative ResourcePool Hotbar Projection

## 1. Governing Architectural Rules (`AGENTS.md` & `docs/ARCHITECTURE.md`)
- **Rule 11 & 12 (TypeScript Strictness & No Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true`, explicit return types on all functions, and named constants for all gameplay numbers.
- **Rule 15 (Cascading Effects Matrix):** Enumerate Upstream, Downstream, and Lateral impacts across all changed modules.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/ai/`):** Synchronized companion follow stepping (`shareInitiative`) during Turn-Based movement and `ResourcePoolComponent` storage.
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** Tactical movement speed in feet (`actorSpeedFt` in `resolveDnD35eActionEnergyCost`), declarative `ResourcePoolComponent` hydration from `featureDetail.resourcePool` / `domain.resourcePool`, and `buildActorStanceModes` projection.
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/classes/*.json`):** Declarative `scalingPoolContribution` (passive progression math) vs `resourcePool` (daily/encounter consumable charges).
- **Rule 19 (Unified Effect Providers — Layer C Scaling Pools vs Consumable Resource Pools):**
  - `dndData.scalingPools` (`scalingPoolContribution`) stores passive cross-class progression scalers (`animal_companion_effective_level`, `familiar_master_effective_level`, `uncanny_dodge_effective_level`, `turn_undead_effective_level`).
  - `ResourcePoolComponent` (`ComponentType.ResourcePool`) stores consumable daily/encounter charges declared via `resourcePool` (`rage`, `turn_undead`, `wild_shape`, `smite_evil`, `lay_on_hands`, `bardic_music`, `wholeness_of_body`, `defensive_stance`, `shadow_jump_ft`, `smite_good`).

---

## 2. Root-Cause Findings

### Finding A: Hotbar Renders `"animal companion effective level (1/day)"` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:92-104`)
1. In `src/rulesets/dnd35e/progression/ledger_features_spells.ts:81-85`, `collectActiveClassFeaturesAndPools` populates `dndData.scalingPools` strictly from `detail.scalingPoolContribution`.
2. In `public/data/rulesets/dnd35e/classes/druid.json:55-66`, `animal_companion` has `usageMode: "passive"` (default) and `scalingPoolContribution: { poolId: "animal_companion_effective_level", multiplier: 1, minClassLevel: 1 }`. It does **not** declare a `resourcePool` or `activatedAbilities`.
3. However, `buildActorStanceModes` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts:100-104`) contains an `else if (dndData.scalingPools)` fallback:
   ```ts
   if (resourcePools) {
     for (const [id, entry] of Object.entries(resourcePools.pools)) {
       modes.push({
         id: `pool:${id}`,
         label: `${entry.label ?? id.replace(/_/g, ' ')} (${entry.current}/${entry.max})`,
         isActive: entry.current > 0
       });
     }
   } else if (dndData.scalingPools) {
     for (const [id, max] of Object.entries(dndData.scalingPools)) {
       if (max > 0) modes.push({ id: `pool:${id}`, label: `${id.replace(/_/g, ' ')} (${max}/day)`, isActive: false });
     }
   }
   ```
4. Furthermore, neither `applyCharacterCreationToPlayer` (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`) nor `applyLevelUpToActor` (`src/rulesets/dnd35e/builder/builder_hydrator_levelup.ts`) currently hydrates `ComponentType.ResourcePool` from active class features or domains that declare `resourcePool`.
5. Consequently:
   - A Level 1 Druid has `resourcePools === undefined` and `dndData.scalingPools = { animal_companion_effective_level: 1 }`, causing `buildActorStanceModes` to project a bogus `animal companion effective level (1/day)` stance mode button.
   - Removing the `else if (dndData.scalingPools)` fallback and hydrating `ComponentType.ResourcePool` directly from declared `resourcePool` definitions on active class features and domains ensures only features that actually declare a `resourcePool` appear on the hotbar.

### Finding B: D&D 3.5e Turn-Based Movement Budget Uses Console Speed (`100`) Instead of Feet (`30`) (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts:238-240`)
1. `evaluateDnD35eEntityDAG` (`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts:174`) passes `baseSpeed: actor?.speed ?? DND35E_DEFAULT_SPEED` (`100`) into `evaluateDnD35ActorStatDAG`. Several existing test suites (`tests/dnd35e_equipment_m115.test.ts:164,181` and `tests/dnd35e_multiclass_and_builder.test.ts:340,349,355`) assert that `dagResult.speed` is `100` (or `110` with Barbarian Fast Movement `+10`).
2. However, in `resolveDnD35eActionEnergyCost` (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts:239-240`):
   ```ts
   const stats = getEffectiveStats(state, intent.entityId);
   const actorSpeedFt = stats.speed > 0 ? stats.speed : BASELINE_LAND_SPEED_FT;
   ```
   Because `stats.speed` is `100` (Console energy scale) rather than `30` (land speed in feet from `dndData.movementModes?.land`), `consumeMovementStepFt` grants `100 ft` per Move action (`20` five-foot squares) and `200 ft` for a Double Move (`40` five-foot squares).
3. During those 39 consecutive `energyCost: 0` player steps, the Turn-Based round never advances, so non-player actors in the scheduler queue never receive a turn.
4. Calculating tactical land speed in feet from `dndData.movementModes?.land ?? BASELINE_LAND_SPEED_FT` plus any net DAG speed modifiers (`stats.speed - baseActorSpeed`) restores accurate `30 ft` (`6` squares per Move action, `12` squares per Double Move) Turn-Based movement budgets without breaking `dagResult.speed` expectations.

### Finding C: Turn-Based Mid-Round Companion Follow Lag (`src/core/game-loop.ts` & `src/ai/follow.behavior.ts`)
1. In `TurnBased` mode, while the player still has movement/actions remaining in their 6-second round, `resolveDnD35eActionEnergyCost` returns `energyCost: 0`, and `game-loop.ts:174` calls `setTurnDuration(0)` so the player immediately acts again for their next step.
2. When the player walks across a room in `TurnBased` mode, waiting up to 12 tiles (a full Double Move) before the companion takes its first step makes the companion appear stuck in place until the round rolls over.
3. Companions spawned via `upsertLinkedServantActor` (`src/rulesets/dnd35e/companions.ts:313`) carry `ControllerLinkComponent` with `shareInitiative: true`.
4. Adding a Tier 1 Console helper `syncShareInitiativeCompanionFollow(state, controllerId)` (invoked in `applyIntentWithCost` when a player `MoveIntent` succeeds with `energyCost === 0` in `TurnBased` mode) allows `shareInitiative: true` companions (not in `'hold'` stance and not adjacent to a hostile target) to execute a single `followBehavior` step alongside the player.

---

## 3. Cascading Effects Matrix (`Rule 15`)

| Change | Upstream (Callers / Producers) | Downstream (Consumers / Validators) | Lateral (Sibling Files / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Remove `dndData.scalingPools` fallback from `buildActorStanceModes`** (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) | `DnD35UIAdapter.getHotbarData` (`dnd35e_ui_adapter.ts`) | `renderBottomDock` (`hud_bottom_dock.ui.ts`), `renderConsoleHotbar` (`console_hotbar.ui.ts`) | `tests/console_ui_architecture.test.ts` (`dummyActor` fixture updated to use `resourcePools` for `turn_undead`) |
| **2. Hydrate `ResourcePoolComponent` from declared `resourcePool` definitions** (`src/rulesets/dnd35e/progression/ledger_features_spells.ts`, `builder_hydrator_creation.ts`, `builder_hydrator_levelup.ts`) | `applyCharacterCreationToPlayer`, `applyLevelUpToActor` | `DnD35UIAdapter.getHotbarData`, `consumeResourcePool` / `refreshResourcePools` (`ecs_lifecycle.ts`) | `public/data/rulesets/dnd35e/classes/*.json`, `public/data/rulesets/dnd35e/domains/*.json`, `tests/console_ui_architecture.test.ts` |
| **3. Resolve `actorSpeedFt` from `movementModes.land` + speed modifiers** (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`) | `resolveDnD35eActionEnergyCost` (called by `resolveActorActionEnergyCost` -> `applyIntentWithCost`) | `consumeMovementStepFt` (`action_economy.ts`), `buildActorActionPips` (`MOV Xft` HUD pip) | `tests/companion_ai_commands.test.ts`, `tests/dnd35e_equipment_m115.test.ts` |
| **4. Sync `shareInitiative` companion follow on Turn-Based mid-round player `MoveIntent`** (`src/ai/follow.behavior.ts`, `src/core/loop/intent_cost_resolver.ts`) | `applyIntentWithCost` (`intent_cost_resolver.ts`) when `isPlayer && intent.type === IntentType.Move && result.success && energyCost === 0` | `processMoveIntent` (`movement.system.ts`), `updateExploredTiles` (`map.system.ts`) | `tests/companion_ai_commands.test.ts` |
