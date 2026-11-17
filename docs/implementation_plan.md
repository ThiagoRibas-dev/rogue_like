# Implementation Plan — World Clock, Area Environment, Condition Effects, Hunger Scaling, Rest/Wait & D&D 3.5e Light Mechanics

Status: **READY FOR REVIEW — awaiting explicit user approval before writing any code.**  
Based on [`docs/research_notes.md`](research_notes.md) and your confirmed answers to Q1–Q6 and Q2.1–Q2.4.

---

## 0. Confirmed Decisions & Scope Summary

| Topic | Confirmed Architecture |
|---|---|
| **Q1 (Legacy Default)** | Areas omitting `environmentType` default to `'indoors'` + `'bright'` (zero unannounced breakage in legacy areas/tests). All areas across `default`, `dnd35e-crypt`, `megacampaign`, and `shroudgarde` will declare explicit `environmentType`, and `default` will showcase an outdoor courtyard/road as well as `worldClock`. |
| **Q2 (Bulk Rest & World Sims)** | Resting / waiting replays macro-simulation cadence in GCD-aligned chunks (`CADENCE_STEP_SIZE = 5` for knowledge/rumors every 10 turns, nemesis & rivalry every 25, world events every 100), reuses `loading_overlay.ui.ts` with progress + cycling ellipses (`"The world stirs..."`), and logs a `"While you rested / waited:"` summary of world events, promotions, and rivalries. |
| **Q2.1 (SRD Hunger Rate & Food)** | Uses normal hunger tick rate during rest, driven by a new configurable `rules.hunger.satiationLossPerStandardTurn` (default `0.035` so 24h / `14,400` turns = `504` satiation ≈ 1 SRD daily ration). `food_ration` restores `500` satiation (1 full meal/day) and `apple` restores `125` satiation (`1/4` ration). |
| **Q2.2 (Quest Timers)** | Noted in `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` as a **Future Milestone** integrating quest deadlines/expiration with `advanceWorldTimeBulk`. |
| **Q2.3 (Lazy Respawn Escalation)** | `map_wake_respawn.ts` (and a post-rest active-area check) escalates `directorContext.areaMutation.budgetModifier` across elapsed `respawnTimerTurns` cycles (configurable `respawnEscalationPerCycle` & `maxRespawnEscalation` on `AreaDefinitionSchema`) and injects `time:<phase>` + `env:<type>` into `directorContext.areaMutation.addedTags`. |
| **Q3 (`waitTargets`)** | `rules.worldClock.waitTargets` drives which "Wait until …" buttons appear in UI cleanly without hardcoding dawn/nightfall in components. |
| **Q4 / Phase 0 (`conditionEffects`)** | Extract all 19 conditions out of `summarizeConditionEffects`'s hardcoded `switch` into `public/data/rulesets/dnd35e/conditions/<id>.json` (`DnD35ConditionDefinitionSchema`), including `dazzled` `-1` attack, `-1` `skill:spot`, `-1` `skill:search`. Verified with a strict 19-condition equivalence test. |
| **Q5 (1 World Turn = 1 Player Turn Start)** | Ticking `globalTurn`, controller links/overlays, Tier 2/3 cadence, and ledger advances **once at Player Turn Start** inside `runActorTurnStart` (triggered once per turn in Turn-Based via `turnStartProcessedForActor !== entityId`, and once per idle/action tick in RTwP), instead of locking to energy expenditure in `intent_cost_resolver.ts`. |
| **Q6 (Tile-Level Light)** | Light Sensitivity / Light Blindness inspect the actor's **own occupied tile** (`resolveTileLightReading`), so a `light` spell underground does not trigger Kobold/Orc Sunlight Sensitivity, whereas `daylight` or daytime `outdoors` does. |

---

## 1. Phase 0 — Declarative `conditionEffects` Registry Refactor (Tier 2 & Tier 3)

### 0.1 Zod Schema & System Content Registration
1. **`src/rulesets/dnd35e/types/system/effect_system.types.ts`** — Add `DnD35ConditionDefinitionSchema`:
```ts
/** Declarative ability score penalty emitted by a condition (`str` / `dex`). */
export const DnD35ConditionAbilityPenaltiesSchema = z.object({
  str: z.number().int().nonnegative().default(0),
  dex: z.number().int().nonnegative().default(0)
});

/** Zod schema for a declarative D&D 3.5e condition definition (`conditions/<id>.json`). */
export const DnD35ConditionDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  escalationGroup: z.string().optional(),
  escalationOrder: z.number().int().nonnegative().optional(),
  abilityPenaltyGroup: z.string().optional(),
  grantedTags: z.array(z.string()).default([]),
  modifiers: z.array(DnD35DeclarativeModifierSchema).default([]),
  ruleOverrides: z.array(DnD35RuleOverrideEntrySchema).default([]),
  abilityPenalties: DnD35ConditionAbilityPenaltiesSchema.optional()
});
export type DnD35ConditionDefinition = z.infer<typeof DnD35ConditionDefinitionSchema>;
```
2. **`src/rulesets/dnd35e/types/dnd35e_system.types.ts`** — Add `conditionEffects: z.record(z.string(), DnD35ConditionDefinitionSchema).default({})` to `DnD35SystemContentSchema` and export a clean lookup helper `getConditionDefinitions(sys)`.
3. **`src/rulesets/dnd35e/system_content_files.ts`** — Register `CONDITION_IDS` (the 19 canonical IDs: `blinded`, `dazzled`, `deafened`, `entangled`, `exhausted`, `fatigued`, `flat_footed`, `frightened`, `grappled`, `helpless`, `nauseated`, `panicked`, `paralyzed`, `prone`, `shaken`, `sickened`, `staggered`, `stunned`, `unconscious`) under `{ key: 'conditionEffects', filename: 'conditions/${id}.json' }`.

### 0.2 Tier 3 JSON Files (`public/data/rulesets/dnd35e/conditions/*.json`)
Each condition is authored cleanly as data. Notable examples:
- **`conditions/dazzled.json`**:
```json
{
  "dazzled": {
    "id": "dazzled",
    "name": "Dazzled",
    "description": "The creature is unable to see well because of overstimulation of the eyes. Takes a -1 penalty on attack rolls, Search checks, and Spot checks.",
    "grantedTags": ["condition:dazzled"],
    "modifiers": [
      { "id": "dazzled_attack", "target": "attack", "value": -1, "type": "untyped" },
      { "id": "dazzled_spot", "target": "skill:spot", "value": -1, "type": "untyped" },
      { "id": "dazzled_search", "target": "skill:search", "value": -1, "type": "untyped" }
    ],
    "ruleOverrides": []
  }
}
```
- **`conditions/shaken.json` / `frightened.json` / `panicked.json`**:
  `modifiers: [{ id: "<id>_atk", target: "attack", value: -2, type: "untyped" }, { id: "<id>_skills", target: "skills", value: -2, type: "untyped" }]`, `escalationGroup: "fear"`, `escalationOrder: 1 | 2 | 3`.
- **`conditions/blinded.json` / `stunned.json` / `helpless.json` / `paralyzed.json` / `unconscious.json` / `flat_footed.json`**:
  `ruleOverrides: [{ id: "<id>_loses_dex", ruleKey: "loses_dex_to_ac", value: true }]`, plus `can_take_actions: false` where incapacitated, and `ac: -2` or `ac: -4`.
- **`conditions/fatigued.json` / `exhausted.json`**:
  `escalationGroup: "fatigue"`, `escalationOrder: 1 | 2`, `abilityPenaltyGroup: "fatigue"`, `abilityPenalties: { str: 2, dex: 2 }` / `{ str: 6, dex: 6 }` (matching `Math.max` per group so `fatigued` + `exhausted` never double-stacks!).

### 0.3 Data-Driven `summarizeConditionEffects` & Skill Modifiers
1. **`src/rulesets/dnd35e/combat/maneuvers_conditions.ts`**:
   - Add an optional `conditionRegistry?: Readonly<Record<string, DnD35ConditionDefinition>>` parameter to `summarizeConditionEffects(conditions, conditionRegistry)` (defaulting to `getLastLoadedDnD35SystemContent()?.conditionEffects` when loaded, with a clean safe zero fallback).
   - Iterates `conditions`, sums `attack` (`meleeAttackPenalty`) and `ac` (`acPenalty`) modifiers, reads `ruleOverrides` (`loses_dex_to_ac`, `can_take_actions`), and computes `Math.max` per `abilityPenaltyGroup` for `strPenalty` and `dexPenalty`.
   - Also export **`buildConditionStatModifiers(conditions, conditionRegistry)`** emitting `StatModifier`s with `sourcePath: 'condition:<id>/<modId>'` for `skill:*` and shared `skills` modifiers (and non-attack/non-AC targets cleanly).
2. **`src/rulesets/dnd35e/skills/skill_synergies.ts`**:
   - Replace the hardcoded `shaken`/`frightened`/`panicked` check with `buildConditionStatModifiers(conditions, conditionRegistry)` filtered to `targetStat.startsWith('skill:') || targetStat === 'skills'`, skipping any whose `sourceId` is already present in `statModifiers` (ensuring zero double-counting whether called via `evaluateDnD35eEntityDAG` or standalone!).
3. **`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`** & **`src/rulesets/dnd35e/semantic_tags.ts`**:
   - `projectDnD35ActorSemanticTags` projects `condition:<id>` for all `dndData.conditions`, plus any `grantedTags` from loaded `conditionRegistry[cond]`.
   - `dnd35e_dag_adapter.ts` injects condition `skill:*` / `skills` modifiers from `buildConditionStatModifiers(dndData.conditions, sysContent?.conditionEffects)` into `extraModifiers`, and **also** evaluates active `condition:<tag>` tags triggered by situational bundles (such as Kobold/Orc/Drow `'condition:dazzled'` in bright light/sunlight!) so `dazzled` effects apply symmetrically whether added by spell (`conditions[]`) or by sunlight exposure (`selfTags`)!
   - **No double-penalty guard**: If an actor already has explicit `'dazzled'` in `dndData.conditions`, the racial sunlight bundle checks `selfTagsNone: ['condition:dazzled']`? Even cleaner: **the racial `light_sensitivity` / `light_blindness` bundle sets `grantedTags: ["trait:light_sensitivity"]` and conditional `StatModifier`s on `attack`, `skill:spot`, `skill:search` ONLY if not duplicated, OR the bundle emits `condition:dazzled` tag and a shared `condition:dazzled` provider rule prevents double-application!** Wait — let's make that completely rock solid:
     - In `drow.json`, `kobold.json`, `orc.json`, `duergar.json`:
       `traitBundles` grants `trait:light_blindness` / `trait:light_sensitivity` AND carries `{ target: "attack", value: -1, bonusType: "circumstance"? No, SRD dazzled is an untyped condition penalty and cannot stack with itself! }` — Wait! In D&D 3.5e, being dazzled twice does NOT give `-2`! So the simplest, 100% SRD-accurate zero-double-count design is:
       - Racial `traitBundles` define `trait:light_sensitivity` / `trait:light_blindness` + modifiers gated by `condition: { selfTagsAny: ["light:sunlight"], selfTagsNone: ["status:dazzled_condition"] }` (or light-exposure lifecycle only marks tag `condition:dazzled` without pushing `'dazzled'` onto `dndData.conditions` when it's purely racial sunlight, while `'dazzled'` in `dndData.conditions` projects `'status:dazzled_condition'`!). Let's verify: that guarantees **either** condition `'dazzled'` from a spell **or** racial sunlight triggers `-1` Atk / `-1` Spot / `-1` Search — NEVER `-2`!

---

## 2. Step-by-Step Implementation Plan (Phases 1–9)

### Step 1 — Schemas & Constants (Tier 1)
1. **`src/constants/world_clock.constants.ts`** *(NEW)*:
```ts
/** Default game start hour (08:00 AM). */
export const DEFAULT_CLOCK_START_HOUR = 8;
/** Default seconds per global world turn (`1` D&D round = `6` seconds). */
export const DEFAULT_SECONDS_PER_TURN = 6;
/** Default hours per diurnal day. */
export const DEFAULT_HOURS_PER_DAY = 24;
/** Minutes per hour (`60`) and seconds per minute (`60`). */
export const MINUTES_PER_HOUR = 60;
export const SECONDS_PER_MINUTE = 60;
/** GCD cadence step size matching LOCAL_NARRATIVE (10), NEMESIS (25), RIVALRY (25), WORLD_EVENT (100). */
export const BULK_CADENCE_STEP_SIZE = 5;
/** Async UI chunk size (turns per animation yield) during rest/wait overlay progress. */
export const BULK_REST_CHUNK_TURNS = 240;
/** Default SRD-aligned satiation loss per standard 1-turn action (`~504` satiation per 24h day = 1 daily ration). */
export const DEFAULT_SATIATION_LOSS_PER_STANDARD_TURN = 0.035;
```
2. **`src/types/campaign/world.ts`** — Extend `AreaDefinitionSchema`:
```ts
export const AreaEnvironmentTypeEnum = z.enum(['outdoors', 'indoors', 'underground']);
export type AreaEnvironmentType = z.infer<typeof AreaEnvironmentTypeEnum>;
export const AreaIlluminationEnum = z.enum(['bright', 'shadowy', 'darkness']);
export type AreaIllumination = z.infer<typeof AreaIlluminationEnum>;

// Inside AreaDefinitionSchema:
environmentType: AreaEnvironmentTypeEnum.optional(),
ambientIllumination: AreaIlluminationEnum.optional(),
respawnEscalationPerCycle: z.number().nonnegative().optional(),
maxRespawnEscalation: z.number().nonnegative().optional(),
```
3. **`src/types/campaign/meta.ts`** — Add `DayPhaseSchema`, `WorldClockConfigSchema` (and `worldClock: WorldClockConfigSchema.optional()` on `RulesConfigSchema`), plus `satiationLossPerStandardTurn: z.number().nonnegative().optional()` on `RulesConfigSchema.shape.hunger`:
```ts
export const DayPhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  startHour: z.number().int().min(0).max(23),
  skyIllumination: AreaIlluminationEnum,
  isNaturalSunlight: z.boolean()
});
export type DayPhaseConfig = z.infer<typeof DayPhaseSchema>;

export const WorldClockConfigSchema = z.object({
  secondsPerGlobalTurn: z.number().int().positive().default(6),
  startHour: z.number().int().min(0).max(23).default(8),
  hoursPerDay: z.number().int().positive().default(24),
  waitTargets: z.array(z.string()).default(['dawn', 'night']),
  phases: z.array(DayPhaseSchema).min(1)
});
export type WorldClockConfig = z.infer<typeof WorldClockConfigSchema>;
```
Using `.optional()` on `RulesConfigSchema` preserves backwards-compatibility for test fixtures and legacy JSONs while validating custom configs cleanly!

---

### Step 2 — Console World Clock, Hunger Alignment, Lazy Respawn & Bulk Simulation (`src/systems/`)
1. **`src/systems/world_clock.system.ts`** *(NEW — Tier 1)*:
   - Exports `DEFAULT_WORLD_CLOCK_CONFIG` (dawn 5 shadowy/false, day 7 bright/true, dusk 18 shadowy/false, night 20 shadowy/false; waitTargets `['dawn', 'night']`).
   - `readWorldClock(state)`: computes `{ day, hour, minute, phaseId, phaseLabel, skyIllumination, isNaturalSunlight }` from `state.globalTurn` and `state.campaign.rules.worldClock ?? DEFAULT_WORLD_CLOCK_CONFIG`.
   - `resolveAreaEnvironmentProfile(state)`:
     - Reads `state.campaign.areas[state.currentAreaId]`.
     - If `environmentType === 'outdoors'`: returns `{ environmentType: 'outdoors', illumination: clock.skyIllumination, isNaturalSunlight: clock.isNaturalSunlight, clock }`.
     - If `environmentType === 'underground'`: returns `{ environmentType: 'underground', illumination: area.ambientIllumination ?? 'darkness', isNaturalSunlight: false, clock }`.
     - Otherwise (`'indoors'` or unspecified legacy fallback): returns `{ environmentType: 'indoors', illumination: area.ambientIllumination ?? 'bright', isNaturalSunlight: false, clock }`.
   - `computeTurnsUntilPhase(state, targetPhaseId)`: walks clock hours forward (up to 1 full day) to return exact positive turn count until the next occurrence of `targetPhaseId`, or `undefined` if unknown.
   - `isActorThreatenedByVisibleHostiles(state, actorId)`: checks living non-actor-self entities where `isHostile(state, actorId, id)` is `true` and the hostile's tile is in `state.cachedFov` (or within fallback proximity if `cachedFov` is empty in headless tests).
   - `fastForwardEntityDurations(state, elapsedTurns)`: O(entities) helper advancing `StatusEffectsComponent.activeEffects`, `FieldComponent.duration`, `PropertyOverlayComponent.durationTurns` (restoring melded slots if expired via a shared `restoreSuppressedEquipmentSlots` helper extracted from `ecs_lifecycle.ts`—no duplicated logic!), and despawning expired summon `ControllerLinkComponent`s once `globalTurn + elapsedTurns >= expirationTurn`.
   - `advanceWorldTimeBulk(state, turns, options?)`:
     1. Captures initial status summary & fast-forwards durations (`fastForwardEntityDurations`).
     2. Replays macro cadence (`advanceGlobalTurnCounter` by step `BULK_CADENCE_STEP_SIZE`, calling `processNemesisSystem`, `processRivalries`, `processWorldEvents`, `tickPendingKnowledge`, `tickPendingRumors`, `cullStaleAndConfirmedRumors`, `processPersonalitySystem` on their exact modulo intervals) while preserving every `GameEvent` generated during the skip into `worldDigestSummaries: string[]`.
     3. Applies `processHungerTick(nextState, playerId, turns * STANDARD_TURN_ENERGY)` using the campaign's `satiationLossPerStandardTurn`.
     4. Checks active area respawn (`checkActiveAreaRespawn`) if `respawnTimerTurns` elapsed.
     5. Returns `{ state, summaryEvents }`!
   - Also exports `advanceWorldTimeBulkAsync(state, turns, onProgress)` yielding per `BULK_REST_CHUNK_TURNS` chunk for smooth UI animation.

2. **`src/systems/hunger.system.ts`** — Replace hardcoded `const satiationLoss = energyCost / 100;` with:
```ts
const ratePerStandardTurn =
  state.campaign.rules.hunger.satiationLossPerStandardTurn ?? DEFAULT_SATIATION_LOSS_PER_STANDARD_TURN;
const satiationLoss = (energyCost / STANDARD_ENERGY_PER_TURN) * ratePerStandardTurn;
```
Also scale starvation damage gracefully when skipping bulk turns (`Math.floor(satiationDeficit)` or per missed day / chunk, without overflowing `0`).

3. **`src/systems/map/map_wake_respawn.ts`** — Update `buildAreaDirectorContext` & `wakeSavedAreaFloor` (plus exported `triggerActiveAreaRespawnIfDue(state)`):
   - Inject `time:${clock.phaseId}` and `env:${envProfile.environmentType}` into `directorContext.areaMutation.addedTags`.
   - When `areaDef.respawnTimerTurns` has elapsed:
     ```ts
     const elapsedCycles = Math.floor((nextState.globalTurn - targetLastSpawnTurn) / areaDef.respawnTimerTurns);
     const extraCycles = Math.max(0, elapsedCycles - 1);
     const escPerCycle = areaDef.respawnEscalationPerCycle ?? 0;
     const rawEscalation = extraCycles * escPerCycle;
     const cappedEscalation =
       areaDef.maxRespawnEscalation !== undefined ? Math.min(areaDef.maxRespawnEscalation, rawEscalation) : rawEscalation;
     ```
     Adds `cappedEscalation` to `directorContext.areaMutation.budgetModifier`, producing more/stronger enemies when days pass!

---

### Step 3 — Player Turn Start World-Turn Hook (Q5)
1. **`src/systems/lifecycle.system.ts`** (`runActorTurnStart`):
   - At the start of a **Player** turn (`getComponent(nextState, entityId, ComponentType.Player) !== undefined`), run `advancePlayerWorldTurn(nextState)`:
     - `tickControllerLinksAndOverlays(state)`
     - `processTier2LocalCadence(nextState, true)`
     - `processTier3GlobalCadence(nextState, true)` (increments `globalTurn` by `1`)
     - `processLedgerSystem(nextState, true)`
2. **`src/core/loop/intent_cost_resolver.ts`**:
   - Change `didGlobalTurnAdvance` passed to `processTier2LocalCadence(nextState, false)` to `false` (retaining immediate knowledge/rumor event digestion on action without incrementing `globalTurn` inside `applyIntentWithCost`), and remove the duplicate `processTier3GlobalCadence` / `tickControllerLinksAndOverlays` / `processLedgerSystem(..., true)` calls from `intent_cost_resolver.ts`.
   - This makes **1 Player Turn Start = 1 World Turn = 6 seconds** across both **Turn-Based** and **RTwP**, regardless of action speed/Haste or multi-action turns!

---

### Step 4 — Tile Illumination & Sunlight Resolution (Tier 2: `cover_senses.ts`)
1. **`src/rulesets/dnd35e/spatial/cover_senses.ts`**:
   - Extract `resolveWinningIlluminationOverride(state, x, y)` so there is one canonical lookup.
   - Export `TileLightReading`:
```ts
export interface TileLightReading {
  readonly level: IlluminationLevel;
  readonly isBright: boolean;
  readonly isSunlight: boolean;
}
```
   - `resolveEffectiveTileIllumination(state, x, y, ambientOverride?)`: uses `ambientOverride ?? resolveAreaEnvironmentProfile(state).illumination`.
   - `resolveTileLightReading(state, x, y)`: resolves `level`, `isBright = level === 'bright'`, and `isSunlight = isBright && (envProfile.isNaturalSunlight || (winner !== undefined && hasSunlightOrDaylightDescriptor(winner)))`.

---

### Step 5 — Horizon 3 Tag Projection & Light Blindness State Machine (Tier 2)
1. **`src/rulesets/dnd35e/semantic_tags_context.ts`** & **`src/rulesets/dnd35e/semantic_tags.ts`**:
   - Extend `SituationalTagContext` with `environmentType`, `phaseId`, and `lightReading`.
   - When resolving for an actor, read `resolveAreaEnvironmentProfile(state)` and (if actor has `PositionComponent`) `resolveTileLightReading(state, pos.x, pos.y)`.
   - `projectDnD35ActorSemanticTags` projects:
     - `env:${environmentType}` and (if `'outdoors' | 'indoors'`) `'env:aboveground'`
     - `time:${phaseId}`
     - `light:${lightReading.level}` and (if `lightReading.isSunlight`) `'light:sunlight'`
     - `condition:${c}` and `status:cond_${c}` for active `dndData.conditions`, plus `'condition:dazzled'` if actor carries `'trait:light_blindness'` (with `light:bright`) or `'trait:light_sensitivity'` (with `light:sunlight`).
2. **`src/rulesets/dnd35e/spatial/light_exposure.ts`** *(NEW — Tier 2)*:
   - Add `lightExposure?: 'blinded' | 'acclimated' | undefined` to `DnD35EntityData` (`dnd35e.types.ts`).
   - Pure `evaluateActorLightExposure(state, entityId, phase: 'turn_start' | 'move_or_field')`:
     - Uses `selfTags` (`trait:light_blindness`) — **never hardcodes race IDs** (Rule 21)!
     - In `light:bright`:
       - No `lightExposure` → adds `'blinded'` to `dndData.conditions`, sets `lightExposure: 'blinded'`, logs blindness message.
       - `lightExposure === 'blinded'` on `'turn_start'` → removes `'blinded'`, sets `lightExposure: 'acclimated'` (1-round duration expired; remains Dazzled via Horizon 3 tags).
       - `lightExposure === 'acclimated'` → no-op.
     - Not `light:bright`:
       - If `lightExposure !== undefined` → removes light-induced `'blinded'` (if `'blinded'` and `lightExposure === 'blinded'`), clears `lightExposure` (`undefined`).
   - Called in `onDnD35eActorTurnStart`, `onDnD35eActorMovementStep`, and after `spawnSpellSpatialField` (`spell_cast_units.ts`).

---

### Step 6 — Tier 3 System Content & Campaign Data
1. **`public/data/rulesets/dnd35e/races/`**:
   - `drow.json`: Add `light_blindness` bundle (`grantedTags: ['trait:light_blindness']`, `-1` `attack`, `-1` `skill:spot`, `-1` `skill:search` with `condition: { selfTagsAny: ['light:bright'], selfTagsNone: ['status:cond_dazzled'] }`).
   - `kobold.json`, `orc.json`, `duergar.json`: Add `light_sensitivity` bundle (`grantedTags: ['trait:light_sensitivity']`, `-1` `attack`, `-1` `skill:spot`, `-1` `skill:search` with `condition: { selfTagsAny: ['light:sunlight'], selfTagsNone: ['status:cond_dazzled'] }`).
2. **`public/data/rulesets/dnd35e/spells/`**:
   - `daylight.json`: `illuminationOverride: { level: 'bright', spellLevel: 3, descriptors: ['light', 'daylight'], yieldsToDescriptors: [] }`
   - `light.json`: `illuminationOverride: { level: 'bright', spellLevel: 0, descriptors: ['light'], yieldsToDescriptors: ['darkness'] }`
   - `darkness.json`: `illuminationOverride: { level: 'shadowy', spellLevel: 2, descriptors: ['darkness'], yieldsToDescriptors: ['daylight'] }`
3. **`public/data/rulesets/dnd35e/skills/`**:
   - `knowledge_dungeoneering.json`: `rankThresholdModifiers` at `minRanks: 5` granting `+2` untyped `skill:survival` with `condition: { selfTagsAll: ['env:underground'] }`.
   - `knowledge_nature.json`: `rankThresholdModifiers` at `minRanks: 5` granting `+2` untyped `skill:survival` with `condition: { selfTagsAny: ['env:aboveground', 'env:outdoors'] }`.
   - `survival.json`: Remove `knowledge_dungeoneering` and `knowledge_nature` from unconditional `synergyFromSkills` (leaving `search`, `knowledge_planes`, `knowledge_geography` intact) and keep `synergyNotes` accurate.
4. **Campaigns (`default`, `dnd35e-crypt`, `megacampaign`, `shroudgarde`)**:
   - `areas.json`: Declare explicit `environmentType` across every area (`'outdoors'`, `'indoors'`, `'underground'`), plus add an outdoor encounter zone (e.g. `"outer_crossroads"` connected from `safe_hub` Camp) and `respawnEscalationPerCycle` showcase in `default/areas.json`.
   - `rules.json` & `effects.json` (`default`, `dnd35e-crypt`, `megacampaign`, `shroudgarde`): Set `satiationLossPerStandardTurn: 0.035`, `food_ration: 500`, `apple: 125`, and explicit `worldClock` config in `default/rules.json`.

---

### Step 7 — Rest, Wait, Progress Overlay & HUD Telemetry (Tier 2 & HUD)
1. **`src/rendering/ui/dnd35e_spellbook_actions.ts`**:
   - Synchronous core helpers (testable headless):
     - `executeEightHourRest(state, playerId)` & `executeWaitUntilPhase(state, playerId, targetPhaseId)`:
       - Reject cleanly if `isActorThreatenedByVisibleHostiles(state, playerId)` is `true`.
       - Advance world time + bulk simulations via `advanceWorldTimeBulk`.
       - Apply 8-hour rest recovery (1 HP/level, 1 ability damage/stat, spell slot & `rest_8h` pool refresh).
       - Log new clock readout and any `"While you rested/waited: ..."` summary events.
   - Async UI wrappers `applyRestActionAsync(state, playerId)` and `applyWaitUntilPhaseAsync(state, playerId, phaseId)`:
     - Displays `showLoadingOverlay('Resting for 8 Hours...')` / `'Waiting until Dawn...'`
     - Steps `advanceWorldTimeBulkAsync` with cycling ellipses (`"The world stirs."` / `".."` / `"..."`) and smooth progress bar fill, applies final state, hides overlay, and refreshes HUD/UI!
2. **`src/rendering/ui/dnd35e_spellbook.ui.ts`**:
   - Reads `rules.worldClock.waitTargets` from campaign rules (fallback `['dawn', 'night']`) and renders one button per wait target next to **`💤 8-Hour Rest`** (disabling / guarding cleanly during hostiles).
3. **`index.html`** & **`src/rendering/ui/hud.ui.ts`**:
   - Add `#world-clock-chip` in the telemetry strip showing `<phase icon> Day <N> <HH:MM> · <PhaseLabel> · <Environment>` (updated on `updateHUD`).

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| **Phase 0: `DnD35ConditionDefinitionSchema` & `conditions/*.json`** | `system_content_files.ts`, `loader.ts`, `dnd35e_validator.ts` | `summarizeConditionEffects`, `buildConditionStatModifiers`, `resolveActorSkillsSnapshot`, `evaluateDnD35eEntityDAG`, `dnd35e_sheet_overview_tab.ui.ts` | 19 condition JSONs, `tests/dnd35e_cartridge.test.ts`, new 19-condition equivalence test |
| **`AreaDefinitionSchema` (`environmentType`, `ambientIllumination`, `respawnEscalationPerCycle`)** | `areas.json` across 4 campaigns, Zod editor forms | `resolveAreaEnvironmentProfile`, `resolveEffectiveTileIllumination`, `map_wake_respawn.ts`, `hud.ui.ts` | `tests/dnd35e_day_night_environment.test.ts` |
| **`RulesConfigSchema` (`worldClock`, `satiationLossPerStandardTurn`)** | `rules.json`, `blank_slate_campaign.ts` | `readWorldClock`, `processHungerTick`, `dnd35e_spellbook.ui.ts` (`waitTargets`) | `effects.json` (`food_ration: 500`, `apple: 125`), `tests/helpers.ts` |
| **Q5: `globalTurn` moved from `intent_cost_resolver.ts` to Player Turn Start (`lifecycle.system.ts`)** | `processTurn` -> `runActorTurnStart` (Turn-Based & RTwP) | `simulation_cadence.ts`, `tickControllerLinksAndOverlays`, `ledger.system.ts` | `tests/determinism_replay.test.ts`, `docs/ARCHITECTURE.md` |
| **Ambient Illumination default → area profile (`cover_senses.ts`)** | `resolveStrikePreAttackContext`, `resolveEntitySituationalTagContext` | Concealment misses underground (`darkness` 50% without darkvision) and night outdoors (`shadowy` 20% without low-light/darkvision) | Any combat test spawning actors underground without darkvision/light |
| **Light Blindness exposure state (`light_exposure.ts`)** | `onDnD35eActorTurnStart`, `onDnD35eActorMovementStep`, `spawnSpellSpatialField` | `dndData.conditions`, `dndData.lightExposure`, combat blinding AC/DEX loss | Old saves remain compatible (`lightExposure` optional) |
| **Conditional Survival synergies** | `knowledge_dungeoneering.json`, `knowledge_nature.json` | `resolveActorSkillsSnapshot` Survival modifier in underground vs outdoors | `survival.json`, `tests/dnd35e_skills_matrix.test.ts` |
| **Bulk rest/wait async + respawn escalation** | Spellbook UI rest/wait buttons | `loading_overlay.ui.ts`, `map_wake_respawn.ts`, `nemesis`/`rivalry`/`world_events`, message log digest | `docs/ARCHITECTURE.md` / `docs/DECISIONS.md` (future quest timer integration) |

---

## 4. Declarative Purity & Anti-Hardcoding Audit (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative JSON / Schema Mechanism | Passes Litmus? |
|---|---|---|---|
| Drow blinded 1 round + dazzled | `if (raceId === 'drow')` | `drow.json` emits `'trait:light_blindness'`; `light_exposure.ts` queries the semantic tag | ✅ Any modded race can use `'trait:light_blindness'` |
| Kobold/Orc/Duergar sunlight sensitivity | `if (['kobold','orc','duergar'].includes(raceId))` | `traitBundles` with `condition: { selfTagsAny: ['light:sunlight'] }` | ✅ |
| `dazzled` `-1` Atk / Spot / Search | Switch / hardcoded skill `Set` in TS | `conditions/dazzled.json` in `conditionEffects` registry + `buildConditionStatModifiers` | ✅ |
| All 19 conditions' penalties & flags | Hardcoded `switch (cond)` in `maneuvers_conditions.ts` | `conditions/<id>.json` (`DnD35ConditionDefinitionSchema`) | ✅ Modders can alter/add condition effects in JSON |
| Area indoors / outdoors / underground | Tag-guessing (`area.tags.includes('camp')`) | Explicit `environmentType` on `AreaDefinitionSchema` | ✅ |
| Day schedule & wait button list | Hardcoded hours / "Dawn" / "Night" buttons | `rules.worldClock.phases` + `rules.worldClock.waitTargets` | ✅ |
| SRD Hunger drain & meal rations | Hardcoded `energyCost / 100` | `rules.hunger.satiationLossPerStandardTurn` + `effects.json` `'satiate'` values (`500` vs `125`) | ✅ |
| Daylight / Light / Darkness spell fields | `if (spellId === 'daylight')` | `illuminationOverride` descriptors on `spatial_field` effect units | ✅ |
| Survival +2 underground / outdoors | `if (area.tags.includes('dungeon'))` | `rankThresholdModifiers` on `knowledge_dungeoneering.json` & `knowledge_nature.json` | ✅ |

---

## 5. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical Owner (New / Updated) | Old Owner (Evicted / Replaced) |
|---|---|---|
| Condition combat/skill/flag effects | `conditions/*.json` + `summarizeConditionEffects` / `buildConditionStatModifiers` | Hardcoded 19-case `switch` & Fear `if` branch in `skill_synergies.ts` (**evicted**) |
| Diurnal clock, phase, area env, hostile wait gate, bulk skip | `src/systems/world_clock.system.ts` | Bare `globalTurn` counter + no ambient clock (**evicted**) |
| Baseline ambient illumination | `resolveAreaEnvironmentProfile` consumed by `cover_senses.ts` | Hardcoded `'bright'` fallback in `resolveEffectiveTileIllumination` (**evicted**) |
| World turn increment trigger | `runActorTurnStart` for `Player` (`lifecycle.system.ts`) | `applyIntentWithCost` `didGlobalTurnAdvance` check (`intent_cost_resolver.ts`) (**evicted**) |
| Per-turn hunger drain rate | `rules.hunger.satiationLossPerStandardTurn` | Hardcoded `1.0` per turn in `hunger.system.ts` (**evicted**) |
| Suppression/restoration of melded slots | Shared helper in `ecs_lifecycle.ts` (reused by bulk skip) | Inline restoration only in single-turn `tickControllerLinksAndOverlays` |

---

## 6. Verification & Documentation Plan
- Add [`tests/dnd35e_day_night_environment.test.ts`](../tests/dnd35e_day_night_environment.test.ts) covering:
  1. **Phase 0 19-condition equivalence test** + `dazzled` `-1` Spot/Search/Attack verification.
  2. World Clock phase math (`dawn`, `day`, `dusk`, `night`, midnight wrap), `computeTurnsUntilPhase`, and `waitTargets`.
  3. Player Turn Start ticking (`TurnBased` free actions + standard action = 1 `globalTurn`; `RTwP` tick = 1 `globalTurn`).
  4. Area environment profiles (`outdoors` dynamic day/night, `indoors`, `underground` darkness, omitted legacy fallback).
  5. Drow Light Blindness (abrupt bright light -> 1 round `blinded`, next turn -> acclimated + ongoing `dazzled`, leaving & re-entering -> re-blinded).
  6. Kobold/Orc/Duergar Light Sensitivity (sunlight/`daylight` triggers penalty; torch `light` underground does not; no double `-2` penalty if explicitly `dazzled`).
  7. **"New Content Mod" Litmus Test**: synthesize a brand-new modded race `'cave_stalker'` with `trait:light_sensitivity` / `trait:light_blindness` in JSON without touching `.ts` files, asserting full behavior.
  8. Conditional `+2` Survival synergies (`env:underground` vs `env:aboveground`), SRD hunger rate + `food_ration` (`500`) vs `apple` (`125`), hostile rest/wait blocking, bulk cadences & `"While you rested:"` event summary, and lazy respawn CR escalation across elapsed cycles.
- Update [`tests/dnd35e_skills_matrix.test.ts`](../tests/dnd35e_skills_matrix.test.ts) if any test asserts old unconditional Survival synergy from `knowledge_dungeoneering`/`knowledge_nature`.
- Update `docs/ssot/ssot_console.json` & `docs/ssot/ssot_dnd35e.json`, regenerate `docs/SSOT_CONSOLE.md` & `docs/SSOT_DND35E.md` via `bun scripts/map-codebase.ts`, update `docs/ARCHITECTURE.md` & `docs/DECISIONS.md` (including future Quest Timers note), and run `./verify.sh` across all 8 stages.

**STOP — awaiting your explicit approval of this updated implementation plan before writing any code.**
