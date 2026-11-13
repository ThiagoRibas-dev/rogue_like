# Implementation Plan — Milestone 131.1: Companion Turn-Based Pacing, Tactical Movement Speed & Declarative ResourcePool Hotbar Projection

## 1. Overview & Objectives
1. **Declarative Hotbar Resource Pools (No `scalingPools` Fallback):**
   - Remove the `else if (dndData.scalingPools)` branch from `buildActorStanceModes` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) so passive progression math scalers (`animal_companion_effective_level`, `familiar_master_effective_level`, `uncanny_dodge_effective_level`, `turn_undead_effective_level`) are never projected as `(N/day)` hotbar stance buttons.
   - Hydrate `ComponentType.ResourcePool` (`ResourcePoolComponent`) during character creation (`applyCharacterCreationToPlayer`) and level-up (`applyLevelUpToActor`) from active class features and domains that explicitly declare a `resourcePool` block in JSON.
2. **D&D 3.5e Turn-Based Movement Speed in Feet (`actorSpeedFt`):**
   - In `resolveDnD35eActionEnergyCost` (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`), compute `actorSpeedFt` from `dndData.movementModes?.land ?? BASELINE_LAND_SPEED_FT` plus any net DAG speed bonus (`stats.speed - baseActorSpeed`), so a `30 ft` character moves `6` squares per Move action (`12` squares per Double Move) instead of `100 ft` (`40` squares).
3. **Turn-Based Mid-Round Companion Follow Synchronization (`shareInitiative`):**
   - Add `syncShareInitiativeCompanionsOnMove(state, controllerId)` in `src/ai/follow.behavior.ts` and invoke it in `applyIntentWithCost` (`src/core/loop/intent_cost_resolver.ts`) when a player's `MoveIntent` succeeds with `energyCost === 0` in `TurnBased` mode. Any linked `shareInitiative: true` companion that is not holding position and has no adjacent hostile target will execute a `followBehavior` step so companions walk smoothly alongside the player step-by-step.

---

## 2. Cascading Effects Matrix (`Rule 15`)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **1. Remove `dndData.scalingPools` fallback in `buildActorStanceModes`** (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) | `DnD35UIAdapter.getHotbarData` | `renderBottomDock`, `renderConsoleHotbar` | `tests/console_ui_architecture.test.ts` |
| **2. Build & attach `ResourcePoolComponent` from declared `resourcePool` schemas** (`ledger_features_spells.ts`, `builder_hydrator_creation.ts`, `builder_hydrator_levelup.ts`) | `applyCharacterCreationToPlayer`, `applyLevelUpToActor` | `DnD35UIAdapter.getHotbarData`, `consumeResourcePool`, `refreshResourcePools` | `tests/console_ui_architecture.test.ts`, `tests/companion_ai_commands.test.ts` |
| **3. Compute `actorSpeedFt` in feet in `resolveDnD35eActionEnergyCost`** (`dnd35e_lifecycle_adapter.ts`) | `resolveActorActionEnergyCost` -> `applyIntentWithCost` | `consumeMovementStepFt`, HUD `MOV Xft` action pip | `tests/companion_ai_commands.test.ts` |
| **4. Step `shareInitiative` companions on mid-round player `MoveIntent`** (`follow.behavior.ts`, `intent_cost_resolver.ts`) | `applyIntentWithCost` | `processMoveIntent` (`movement.system.ts`) | `tests/companion_ai_commands.test.ts` |

---

## 3. Step-by-Step Implementation Details & Code Diffs

### Step 1: Remove `scalingPools` Fallback from `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`
In `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` (lines 92–104), remove the `else if (dndData.scalingPools)` branch so only `ResourcePoolComponent` entries are projected as `pool:<id>` modes:

```ts
  if (resourcePools) {
    for (const [id, entry] of Object.entries(resourcePools.pools)) {
      if (entry.max <= 0) continue;
      modes.push({
        id: `pool:${id}`,
        label: `${entry.label ?? id.replace(/_/g, ' ')} (${entry.current}/${entry.max})`,
        isActive: entry.current > 0
      });
    }
  }
```

### Step 2: Hydrate `ResourcePoolComponent` from Declared Class Feature & Domain `resourcePool` Blocks
1. In `src/rulesets/dnd35e/progression/ledger_resource_pools.ts` (re-exported from `level_ledger.ts`), add a pure helper `buildActorResourcePoolsComponent`:
```ts
/**
 * Builds a `ResourcePoolComponent` from active class features and domains that explicitly declare
 * a `resourcePool` schema, preserving existing `current` charges when `previousPoolComp` is provided.
 */
export function buildActorResourcePoolsComponent(
  dndData: DnD35EntityData,
  sysContent: DnD35SystemContent,
  previousPoolComp?: ResourcePoolComponent
): ResourcePoolComponent | undefined {
  const pools: Record<string, ResourcePoolEntry> = {};
  const suppressedIds = dndData.suppressedBundleIds ?? [];

  const getAbilityMod = (ab: AbilityId): number =>
    computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores[ab]));

  for (const track of dndData.tracks) {
    if (track.levels <= 0) continue;
    const classDef = sysContent.classes[track.trackId];
    if (!classDef) continue;
    const trackFeatures = collectClassFeaturesUpToLevel(classDef, track.levels, dndData.selectedAcfs ?? []);
    for (const featId of trackFeatures) {
      if (suppressedIds.includes(featId)) continue;
      const detail = classDef.featureDetails[featId];
      const rp = detail?.resourcePool;
      if (!rp) continue;

      const levelContrib = rp.perClassLevel !== undefined ? Math.floor(rp.perClassLevel * track.levels) : 0;
      const abilContrib = rp.abilityModStat !== undefined ? Math.max(0, getAbilityMod(rp.abilityModStat)) : 0;
      const max = Math.max(0, rp.maxBase + levelContrib + abilContrib);
      if (max <= 0) continue;

      const existing = pools[rp.poolId];
      const combinedMax = (existing?.max ?? 0) + max;
      const prevCurrent = previousPoolComp?.pools[rp.poolId]?.current;
      pools[rp.poolId] = {
        current: prevCurrent !== undefined ? Math.min(combinedMax, prevCurrent) : combinedMax,
        max: combinedMax,
        resetOnRest: rp.refreshCycle === 'rest_8h' || rp.refreshCycle === 'short_rest',
        label: detail.name,
        refreshCycle: rp.refreshCycle
      };
    }
  }

  for (const domId of dndData.domains ?? []) {
    const domDef = sysContent.domains[domId];
    const rp = domDef?.resourcePool ?? domDef?.grantedPowerBundle?.resourcePool;
    if (!rp) continue;
    const abilContrib = rp.abilityModStat !== undefined ? Math.max(0, getAbilityMod(rp.abilityModStat)) : 0;
    const max = Math.max(0, rp.maxBase + abilContrib);
    if (max <= 0) continue;

    const prevCurrent = previousPoolComp?.pools[rp.poolId]?.current;
    pools[rp.poolId] = {
      current: prevCurrent !== undefined ? Math.min(max, prevCurrent) : max,
      max,
      resetOnRest: rp.refreshCycle === 'rest_8h' || rp.refreshCycle === 'short_rest',
      label: domDef?.name,
      refreshCycle: rp.refreshCycle
    };
  }

  if (Object.keys(pools).length === 0) {
    return undefined;
  }

  return {
    type: ComponentType.ResourcePool,
    pools
  };
}
```
2. In `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts` and `src/rulesets/dnd35e/builder/builder_hydrator_levelup.ts`, call `buildActorResourcePoolsComponent` and attach (or remove if empty) `ComponentType.ResourcePool` on the actor.

### Step 3: Fix `actorSpeedFt` in `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`
In `resolveDnD35eActionEnergyCost` (`src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts:238-241`), compute tactical speed in feet from `dndData.movementModes?.land ?? BASELINE_LAND_SPEED_FT` plus any net speed modifiers from `stats.speed - baseActorSpeed`:

```ts
  const dndData = getDnD35EntityData(state, intent.entityId);
  const actor = getComponent(state, intent.entityId, ComponentType.Actor);
  const stats = getEffectiveStats(state, intent.entityId);
  const baseActorSpeed = actor?.speed ?? FULL_ROUND_ENERGY_COST;
  const speedBonusFt = stats.speed - baseActorSpeed;
  const baseLandSpeedFt = dndData.movementModes?.land ?? BASELINE_LAND_SPEED_FT;
  const actorSpeedFt = Math.max(FEET_PER_GRID_SQUARE, baseLandSpeedFt + speedBonusFt);
```

### Step 4: Synchronize `shareInitiative` Companion Follow on Mid-Round Player Moves
1. In `src/ai/follow.behavior.ts`, export `syncShareInitiativeCompanionsOnMove(state: GameState, controllerId: EntityId): GameState`:
   - Iterates over `state.entities` for living, non-hostile actors carrying `ControllerLinkComponent` where `link.controllerEntityId === controllerId`, `link.shareInitiative !== false`, and `link.stance !== 'hold'`.
   - Checks if the companion is currently adjacent (`distance <= 1`) to any living hostile target (if so, leaves combat resolution to its normal scheduled turn).
   - Otherwise evaluates `followBehavior(runningState, companionId, { followDistance: link.followDistance ?? DEFAULT_COMPANION_FOLLOW_DISTANCE })` and, if it returns a `MoveIntent`, executes `processMoveIntent(runningState, moveIntent)`.
2. In `src/core/loop/intent_cost_resolver.ts`, when `isPlayerAction && intent.type === IntentType.Move && result.success && energyCost === 0`, call `nextState = syncShareInitiativeCompanionsOnMove(nextState, intent.entityId);` prior to `resolveStateStabilization`.

### Step 5: Update & Add Regression Tests
- Update `tests/console_ui_architecture.test.ts` (`dummyActor` uses `resourcePools` for `turn_undead`, and add an assertion that a Level 1 Druid with `scalingPools: { animal_companion_effective_level: 1 }` does **not** emit `pool:animal_companion_effective_level` in `stanceModes`).
- Add a regression test in `tests/companion_ai_commands.test.ts` verifying:
  - A newly created Level 1 Druid's `MoveIntent` consumes `5 ft` from a `30 ft` Move action (`25 ft` remaining after 1 step, not `95 ft`).
  - Moving the Druid across the map in `TurnBased` mode steps the Wolf companion along with the player on each move beyond `followDistance`.
