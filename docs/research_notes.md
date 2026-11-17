# Research Notes — Console Day/Night Cycle, Area Environment Classification, Resting & D&D 3.5e Light Sensitivity / Blindness

## 1. Architectural Rules & Standards Reiteration

Before designing or writing code, we reiterate our core architectural rules from [`AGENTS.md`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/AGENTS.md):
- **Rule 10, 11, 12 (Strict TypeScript, Zero `any`, Zero Magic Values):** Every duration, hour boundary, turn ratio, illumination level, and condition penalty must be a named constant or Zod-validated schema member with explicit return types and `exactOptionalPropertyTypes: true` compliance.
- **Rule 15 (Cascading Effects Matrix):** All changes to `AreaDefinitionSchema`, tile illumination resolution, semantic tag projection, skill synergies, and rest/time advancement are mapped across **Upstream**, **Downstream**, and **Lateral** axes.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 — Core Console Engine (`src/systems/world_clock.system.ts`, `src/types/campaign/world.ts`):** Pure diurnal World Clock derived from `globalTurn`, area environment classification (`'outdoors' | 'indoors' | 'underground'`), sky illumination across `'dawn' | 'day' | 'dusk' | 'night'`, hostile-visibility rest gating, and bulk time-skip advancement (`advanceWorldTimeBulk`).
  - **Tier 2 — D&D 3.5e Ruleset Cartridge (`src/rulesets/dnd35e/`):** Horizon 3 situational tag projection (`env:*`, `time:*`, `light:*`), tile illumination + sunlight resolution, SRD `dazzled` (`-1` Attack/Spot/Search) and `light_blindness` 1-round Blindness transition on abrupt bright-light exposure, and 8-Hour Rest / Wait until Dawn or Nightfall execution.
  - **Tier 3 — System Content (`public/data/rulesets/dnd35e/*.json`, `public/data/campaigns/*/areas.json`):** Declarative `light_blindness` (`drow.json`) and `light_sensitivity` (`kobold.json`, `orc.json`) trait bundles, `illuminationOverride` on `daylight.json`, `light.json`, and `darkness.json`, environment-conditional 5-rank Survival synergies on `knowledge_dungeoneering.json` (`env:underground`) and `knowledge_nature.json` (`env:outdoors`), and area environment declarations across campaigns.
- **Rule 17 & Rule 19 (4-Layer Decision Matrix & Unified Effect Providers):**
  - **Layer A (Semantic Tags):** `env:outdoors`, `env:indoors`, `env:underground`, `env:aboveground`, `time:dawn`, `time:day`, `time:dusk`, `time:night`, `light:bright`, `light:shadowy`, `light:darkness`, `light:sunlight`, `trait:light_sensitivity`, `trait:light_blindness`, `condition:dazzled`.
  - **Layer B (Effect Bundles):** Racial `traitBundles` on Drow, Kobold, and Orc, and `rankThresholdModifiers` on Knowledge (dungeoneering) and Knowledge (nature) emitting `StatModifier`s with hierarchical `sourcePath` provenance.
  - **Layer D (Domain Resolvers):** `cover_senses.ts`, `maneuvers_conditions.ts`, `skill_synergies.ts`, and `dnd35e_lifecycle_adapter.ts` consuming Layers A–B without hardcoding race or skill IDs.
- **Rule 20 (Three-Horizon Computation Boundaries):** Environmental, diurnal, and illumination states live strictly in **Horizon 3 (Live Equipment & Tag Projection)** so moving between indoor/outdoor/underground areas, casting *Daylight*/*Darkness*, or advancing the clock updates actor stats dynamically without mutating `levelHistory`.
- **Rule 21 (Zero Content-ID Branching / "New Content Mod" Litmus Test):** Engine and Cartridge resolvers never branch on `raceId === 'drow'` or `raceId === 'kobold'`; instead, any race, template, or item granting `'trait:light_blindness'` or `'trait:light_sensitivity'` automatically participates in the lighting mechanics.

---

## 2. Codebase Findings & Interaction Analysis

### 2.1 Console World Clock & Area Environment Classification (Tier 1)
- **Current State:**
  - [`GameState.globalTurn`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/game-state.types.ts#L213) increments by `1` per round/turn via [`advanceGlobalTurnCounter`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/simulation_cadence.ts#L29-L40).
  - [`AreaDefinitionSchema`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/campaign/world.ts#L68-L112) currently defines `tags?: string[]` (such as `"dungeon"`, `"cave"`, `"camp"`, `"hub"`), `dangerRating`, and generator settings, but lacks explicit `environmentType` or `ambientIllumination` fields.
- **Required Integration:**
  - Extend [`AreaDefinitionSchema`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/campaign/world.ts#L68-L112) with optional:
    - `environmentType: z.enum(['outdoors', 'indoors', 'underground']).optional()`
    - `ambientIllumination: z.enum(['bright', 'shadowy', 'darkness']).optional()`
  - Create [`src/systems/world_clock.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/world_clock.system.ts) as the canonical Tier 1 Console owner for:
    - **Diurnal Cycle Math:** 1 turn = `6` seconds (`10` turns/min, `600` turns/hour, `14,400` turns/day), starting at `08:00` AM on Day 1 (`DEFAULT_CAMPAIGN_START_HOUR = 8`):
      - `'dawn'` (`05:00–06:59`): `'shadowy'` sky illumination, `isNaturalSunlight: false`
      - `'day'` (`07:00–17:59`): `'bright'` sky illumination, `isNaturalSunlight: true`
      - `'dusk'` (`18:00–19:59`): `'shadowy'` sky illumination, `isNaturalSunlight: false`
      - `'night'` (`20:00–04:59`): `'shadowy'` sky illumination (moonlight/starlight per user confirmation A1), `isNaturalSunlight: false`
    - **Area Environment Resolution (`resolveAreaEnvironmentProfile`):**
      - Resolves `environmentType` from `area.environmentType`, falling back to `area.tags` inference (`'camp' | 'outdoors'` $\to$ `'outdoors'`; `'hub' | 'indoors'` $\to$ `'indoors'`; `'dungeon' | 'cave' | 'underground'` $\to$ `'underground'`).
      - Resolves `ambientIllumination`:
        - For `'outdoors'`: dynamically tracks the World Clock (`'bright'` during `'day'`, `'shadowy'` during `'dawn' | 'dusk' | 'night'`), unless explicitly overridden.
        - For `'indoors'`: defaults to `area.ambientIllumination ?? 'bright'`.
        - For `'underground'`: defaults to `area.ambientIllumination ?? 'darkness'` (pitch-black subterranean dungeon/cavern requiring Darkvision or light sources, per user confirmation A1).
      - Resolves `isNaturalSunlight: environmentType === 'outdoors' && clock.isNaturalSunlight`.
    - **Hostile Threat Check (`isActorThreatenedByVisibleHostiles`):**
      - Inspects living hostile entities in the active area and returns `true` if any hostile is within the actor's FOV (`state.cachedFov`) or close threat range, preventing resting or time-skipping in combat (per user confirmation A2).
    - **Bulk Time Advancement (`advanceWorldTimeBulk`):**
      - Advances `state.globalTurn` by `turnsToAdvance` (e.g., `4,800` turns for 8 hours, or `computeTurnsUntilPhase(globalTurn, targetPhase)` for waiting until Dawn/Nightfall).
      - Fast-forwards duration decay on active `StatusEffectsComponent`, `FieldComponent`, `PropertyOverlayComponent`, and temporary summon `ControllerLinkComponent`s without running thousands of redundant per-turn loops.

### 2.2 Tile Illumination, Sunlight & Spell Fields (Tier 2 & Tier 3)
- **Current State:**
  - [`resolveEffectiveTileIllumination`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/spatial/cover_senses.ts#L303-L354) defaults `ambientIllumination` to `'bright'` when not passed, and [`combat_exchange_phases.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/combat/combat_exchange_phases.ts#L96) calls `resolveEffectiveTileIllumination(state, defenderPos.x, defenderPos.y)` without passing the area's ambient illumination.
  - [`daylight.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/daylight.json), [`light.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/light.json), and [`darkness.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/darkness.json) spawn spatial fields (`field_daylight`, `field_light`, `field_darkness`), but do not yet include `illuminationOverride` blocks on their `spatial_field` effect units.
- **Required Integration:**
  - Update [`resolveEffectiveTileIllumination`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/spatial/cover_senses.ts#L303-L354) so that when `ambientIllumination` is omitted, it derives the baseline from `resolveAreaEnvironmentProfile(state).ambientIllumination`.
  - Add `resolveTileIlluminationAndSunlight(state, x, y)` in [`cover_senses.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/spatial/cover_senses.ts) returning `{ level, isBrightLight, isSunlightOrDaylight }` where `isSunlightOrDaylight` is `true` when `level === 'bright'` and either the area has `isNaturalSunlight: true` OR an active non-yielding field at `(x, y)` carries descriptor `'daylight'` or `'sunlight'`.
  - Populate `illuminationOverride` in [`daylight.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/daylight.json) (`level: "bright", spellLevel: 3, descriptors: ["light", "daylight"]`), [`light.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/light.json) (`level: "bright", spellLevel: 0, descriptors: ["light"]`), and [`darkness.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/spells/darkness.json) (`level: "shadowy", spellLevel: 2, descriptors: ["darkness"]`).

### 2.3 Horizon 3 Semantic Tag Projection, Light Sensitivity & Light Blindness (Tier 2 & Tier 3)
- **Current State:**
  - [`resolveEntitySituationalTagContext`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags_context.ts#L41-L157) inspects equipment, doctrine, and squeezing, but does not inspect the area's environment, world clock phase, or the actor's tile illumination.
  - [`summarizeConditionEffects`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/combat/maneuvers_conditions.ts#L284-L286) applies `-1` to `meleeAttackPenalty` for `'dazzled'`, while [`resolveActorSkillsSnapshot`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_synergies.ts#L207-L238) applies Fear (`-2`), but does not yet apply the SRD `'dazzled'` `-1` penalty to `spot` and `search` checks when `'dazzled'` is in `conditions`.
  - [`drow.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/drow.json), [`kobold.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/kobold.json), and [`orc.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/orc.json) have empty `traitBundles: []`.
- **Required Integration:**
  - Extend `SituationalTagContext` in [`semantic_tags_context.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags_context.ts) and [`projectDnD35ActorSemanticTags`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags.ts) to project:
    - `env:outdoors`, `env:indoors`, `env:underground`, and `env:aboveground` (when `'outdoors'` or `'indoors'`)
    - `time:dawn`, `time:day`, `time:dusk`, `time:night`
    - `light:bright`, `light:shadowy`, `light:darkness`, and `light:sunlight` (when `isSunlightOrDaylight === true`)
  - **Light Sensitivity (Orc, Kobold):**
    - Author `light_sensitivity` in `traitBundles` of [`kobold.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/kobold.json) and [`orc.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/orc.json) with `grantedTags: ["trait:light_sensitivity"]` and conditional modifiers (`-1` `attack`, `-1` `skill:spot`, `-1` `skill:search` when `selfTagsAny: ["light:sunlight", "light:bright"]`).
    - Also project `condition:dazzled` in `projectDnD35ActorSemanticTags` whenever an actor has `'trait:light_sensitivity'` or `'trait:light_blindness'` and is in `light:bright` / `light:sunlight`, and ensure explicit `'dazzled'` in `dndData.conditions` also applies `-1` to `skill:spot` and `skill:search` in [`skill_synergies.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_synergies.ts).
  - **Light Blindness (Drow) — Full SRD 1-Round Blindness + Subsequent Dazzled:**
    - Author `light_blindness` in `traitBundles` of [`drow.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/races/drow.json) with `grantedTags: ["trait:light_blindness"]` and conditional modifiers (`-1` `attack`, `-1` `skill:spot`, `-1` `skill:search` when `selfTagsAny: ["light:bright", "light:sunlight"]`).
    - Add `acclimatedToBrightLight?: boolean | undefined` to [`DnD35EntityData`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/dnd35e.types.ts).
    - Add a pure lifecycle helper `evaluateActorLightBlindnessExposure(state: GameState, entityId: EntityId): GameState` called in [`onDnD35eActorTurnStart`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts#L143) and [`onDnD35eActorMovementStep`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts#L174) (and when a spatial light field is spawned):
      - If an actor has `'trait:light_blindness'`:
        - When in `'bright'` illumination (`light:bright` / `light:sunlight`):
          - If `!dndData.acclimatedToBrightLight`, sets `acclimatedToBrightLight: true`, applies `'blinded'` condition for `1` round (removing `'blinded'` on their next turn start while keeping `acclimatedToBrightLight: true`), and logs `"<Name> is blinded for 1 round by abrupt exposure to bright light!"`.
          - If `dndData.acclimatedToBrightLight === true` on a subsequent turn start, clears the transient light-induced `'blinded'` condition while keeping the ongoing Dazzled (`-1` Attack/Spot/Search) active.
        - When in `'shadowy'` or `'darkness'` illumination:
          - Clears `acclimatedToBrightLight` (`false`) and any light-induced `'blinded'` state so future abrupt re-entry into bright light triggers the 1-round blindness again.

### 2.4 Environment-Conditional Knowledge Synergies on Survival (Tier 3)
- **Current State:**
  - [`knowledge_dungeoneering.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/skills/knowledge_dungeoneering.json) and [`knowledge_nature.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/skills/knowledge_nature.json) document in `synergyNotes` that 5+ ranks grant `+2` on Survival checks in underground and aboveground/outdoors environments respectively, while [`survival.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/skills/survival.json) currently lists them unconditionally in `synergyFromSkills`.
- **Required Integration:**
  - Move `knowledge_dungeoneering` and `knowledge_nature` out of unconditional `survival.json` `synergyFromSkills` and into `rankThresholdModifiers` (`minRanks: 5`) on:
    - [`knowledge_dungeoneering.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/skills/knowledge_dungeoneering.json): `+2` untyped modifier to `skill:survival` with `condition: { selfTagsAll: ["env:underground"] }`.
    - [`knowledge_nature.json`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/public/data/rulesets/dnd35e/skills/knowledge_nature.json): `+2` untyped modifier to `skill:survival` with `condition: { selfTagsAny: ["env:outdoors", "env:aboveground"] }`.

### 2.5 Rest, Wait Until Dawn/Nightfall & HUD Telemetry (Tier 1 & Tier 2 UI)
- **Current State:**
  - [`executeEightHourRest`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spellbook_actions.ts#L183-L230) refreshes spell slots and heals HP, but does not check for visible hostiles or advance `state.globalTurn` by 8 hours (`4,800` rounds).
  - [`updateHUD`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud.ui.ts#L200-L239) updates `#dungeon-depth`, `#area-depth-tag`, and `#player-coords-text`, without displaying the World Clock or environmental lighting state.
- **Required Integration:**
  - Update [`executeEightHourRest`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spellbook_actions.ts#L183-L230) to:
    1. Reject resting if `isActorThreatenedByVisibleHostiles(state, playerId)` is `true`.
    2. Advance world time by `EIGHT_HOURS_IN_ROUNDS` (`4,800` turns) via `advanceWorldTimeBulk`.
    3. Heal `1 HP/level` and `1` point of ability damage per ability score, refresh spell slots and `'rest_8h'` pools, and log the new Day/Time/Phase.
  - Add `executeWaitUntilPhase(state, playerId, targetPhase)` in [`dnd35e_spellbook_actions.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spellbook_actions.ts) and expose **`🌅 Wait until Dawn`** and **`🌙 Wait until Nightfall`** buttons alongside **`💤 8-Hour Rest`** in [`dnd35e_spellbook.ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spellbook.ui.ts).
  - Add `#world-clock-chip` to [`index.html`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/index.html) and update [`updateHUD`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud.ui.ts) to display the live Day/Time, Phase icon (`🌅`/`☀️`/`🌇`/`🌙`), and Environment (`Outdoors` / `Indoors` / `Underground`).

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Producers / Authors) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **`AreaDefinitionSchema` (`environmentType`, `ambientIllumination`)** | Campaign `areas.json` authors, Editor area form | `resolveAreaEnvironmentProfile`, `resolveEffectiveTileIllumination`, `updateHUD`, `resolveEntitySituationalTagContext` | `default`, `dnd35e-crypt`, `megacampaign`, `shroudgarde` `areas.json` |
| **Console World Clock (`world_clock.system.ts`)** | `state.globalTurn`, `advanceGlobalTurnCounter`, `advanceWorldTimeBulk` | `resolveAreaEnvironmentProfile`, `resolveEntitySituationalTagContext`, `executeEightHourRest`, `executeWaitUntilPhase`, `updateHUD` | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| **Tile Illumination & Sunlight (`cover_senses.ts`)** | `resolveAreaEnvironmentProfile`, `FieldComponent.illuminationOverride` (`daylight.json`, `light.json`, `darkness.json`) | `resolveStrikePreAttackContext` (`combat_exchange_phases.ts`), `resolveEntitySituationalTagContext`, `evaluateActorLightBlindnessExposure` | `blade_tempest_invocation.json`, `daylight.json`, `light.json`, `darkness.json` |
| **Horizon 3 Environmental & Light Tags (`semantic_tags_context.ts`, `semantic_tags.ts`)** | `evaluateDnD35eEntityDAG`, `onDnD35eActorTurnStart`, `onDnD35eActorMovementStep` | `drow.json`, `kobold.json`, `orc.json` traitBundles; `knowledge_dungeoneering.json`, `knowledge_nature.json` threshold modifiers | `tests/dnd35e_skills_matrix.test.ts`, new `tests/dnd35e_day_night_environment.test.ts` |
| **SRD Light Blindness & Light Sensitivity (`dnd35e_lifecycle_adapter.ts`, `maneuvers_conditions.ts`, `skill_synergies.ts`)** | `drow.json` (`trait:light_blindness`), `kobold.json` & `orc.json` (`trait:light_sensitivity`) | `evaluateDnD35eEntityDAG` (`-1` Atk/Spot/Search when Dazzled; 1-round Blinded on abrupt bright-light entry for Drow) | `race_hydrator.ts` (already hydrates `traitBundles` into `statModifiers` and `grantedTags`) |
| **Rest & Wait Time-Skip (`dnd35e_spellbook_actions.ts`, `dnd35e_spellbook.ui.ts`)** | Spellbook UI rest/wait buttons, `executeEightHourRest`, `executeWaitUntilPhase` | `advanceWorldTimeBulk`, `isActorThreatenedByVisibleHostiles`, HUD clock & message log | `tests/dnd35e_day_night_environment.test.ts` |
