# Research Notes — Milestone 168: Active Buffs, Debuffs & Spell Duration Lifecycle, Expiration, Dispel Sync & UI Observability

**Date:** 2026-11-23  
**Scope:** Active Buffs, Debuffs & Conditions — Spell Duration Lifecycle, Turn/Bulk-Time Expiration, Dispel & Restoration Cleanup, Correctness Alignment (`weapon:magic` / Enhancement Stacking / Multi-Unit Casts / DAG Caching), and Full UI Observability across HUD, Character Sheet & Inspect  
**Workflow Stage:** `AGENTS.md` Phase 1 Kickoff Flow — Step 3 (`./docs/research_notes.md` Compilation & Research Review Gate)

---

## 0. Core Architectural Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
   - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`, `src/utils/`, `src/rendering/`):** Owns ruleset-agnostic status effect containers (`ActiveStatusEffect` / `StatusEffectsComponent`), duration ticking & O(1) bulk-time advancement (`status-effect.system.ts`, `world_time_skip.ts`), generic auto-pause and alert polarity filtering (`auto_pause_signals.ts`, `hud_alerts.ui.ts`), and pure presentation widgets (`VitalsCard.tsx`, `TacticalScannerCard.tsx`, `inspect_tooltip.ts`, `tactical_snapshot.ts`, `DataDisplay.tsx`), communicating ruleset semantics exclusively through `RulesetContract` hooks and DTOs.
   - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`, `src/rendering/ui/cartridges/dnd35e/`):** Owns D&D 3.5e spell duration formula parsing (`round/level`, `min/level`, `10 min/level`, `hour/level`, Extend Spell doubling), polarity classification, `sourcePath` revocation on expiration or `Dispel Magic`, semantic tag projection (`grantedTags`), enhancement/luck stacking resolution in the DAG, and cartridge sheet/projection formatting.
   - **Tier 3 — System Content (`public/data/rulesets/dnd35e/*.json`):** Spells (`spells/*.json`), conditions (`conditions/*.json`), and feats (`feats/*.json`) declare effects and durations purely as Zod-validated JSON data.
2. **Baseline Rules + Declarative Effects & `sourcePath` Provenance (`AGENTS.md` Rules 17 & 19):**
   - Spell buffs, debuffs, and conditions must carry slash-delimited `sourcePath` provenance (`spell:<spellId>:<castId>/...`) so turn expiration, re-casting, restoration, and *Dispel Magic* can cleanly revoke all associated modifiers, tags, and spell-linked conditions in lockstep.
3. **Zero Content-ID Branching (`AGENTS.md` Rule 21 — The "New Content Mod" Litmus Test):**
   - `.ts` code must never switch on specific spell IDs (`if (spell.id === 'divine_favor')`, `if (spell.id === 'color_spray')`). Duration parsing, polarity inference, modifier summaries, and optional unit duration overrides must derive strictly from generic schema fields (`spell.duration`, `effectBundle.modifiers`, `grantedTags`, `unit.type`, or declarative schema properties).
4. **TypeScript Strictness & Pure ECS Serialization (`AGENTS.md` Sections 3 & 4, `docs/ARCHITECTURE.md` §4.1):**
   - Zero `any`, zero magic values, `exactOptionalPropertyTypes: true`, explicit return types on all functions, exhaustive switches, and strictly JSON-serializable component fields (no `Map`/`Set` in ECS components).
5. **Prioritize Observability & Protect Hot-Path DAG Caching (`docs/ARCHITECTURE.md` §2 & §4.8):**
   - Timed states must be visible to the player (effects, polarity, remaining duration, stat breakdowns), and per-turn duration decrements must not thrash `campaignEntityDagCache`.

---

## 1. Current State & Root-Cause Findings

### 1.1 Zero Duration Tracking & Expiration on Spell Buffs, Debuffs, and Conditions
- In [spell_cast_effects.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_effects.ts):
  - `appendTargetModifiers` (L161–178), `case 'stat_bundle'` (L260–310), `case 'condition'` (L312–337), `case 'ability_harm'` (L339–356), `case 'quicken_cast_grant'` (L382–399), `case 'retaliation_rider'` (L401–412), and top-level `effectBundle` handling in `applyResolvedSpellEffectsToTarget` (L506–532) append `StatModifier`s to `dndData.statModifiers` and condition IDs to `dndData.conditions`.
  - None of these paths register an `ActiveStatusEffect` in `StatusEffectsComponent`, evaluate `spell.duration` (or `metamagic.extend`), or expire when rounds elapse. Only `spatial_field` (`FieldComponent.duration`), `summon` (`ControllerLinkComponent.expirationTurn`), and `form_overlay` (`PropertyOverlayComponent.durationTurns`) currently track duration.
- **Audit of `public/data/rulesets/dnd35e/spells/*.json`:**
  - There are **101** `stat_bundle` / top-level `effectBundle` / `ability_harm` / `quicken_cast_grant` / `retaliation_rider` definitions and **42** `condition` effect units across the modular SRD spell registry.
  - These spells use **28** distinct `duration` string values:
    - `"instantaneous"` (83 — some of which apply lingering conditions such as *Color Spray*, *Chaos Hammer*)
    - `"1 min/level"` (44), `"1 round/level"` (42), `"10 min/level"` (34), `"1 hour/level"` (11), `"concentration"` (5), `"see text"` (3), `"2 hours/level"` (3), `"1 round"` (3), `"1 minute"` (3), `"24 hours"` (3), `"1 day/level"` (2), `"varies"` (2)
    - 15 singletons: `"1d6+2 rounds"`, `"1d4 rounds or 1 round"`, `"4d12 hours"`, `"permanent"`, `"permanent until discharged"`, `"concentration, up to 1 min/level"`, `"1 round + 1 round/3 levels"`, `"1_round_per_level"`, `"30 minutes"`, `"12 hours"`, `"7 rounds"`, `"7 days"`, `"1 minute or until discharged"`, `"1 use/level"`, `"instantaneous / 1 hour"`.
  - Standard D&D 3.5e timing conversion aligns directly with the Console clock (`6` seconds/round = `10` rounds/minute, `600` rounds/hour, `14400` rounds/day).

### 1.2 Multi-Unit Same-Cast Modifier Overwrite Bug (`spell_cast_effects.ts:161–178`)
- `appendTargetModifiers` clears all existing modifiers whose path starts with `spell:${spellId}` or `spell:${spellId}:` on every call:
  ```ts
  const cleaned = revokeModifiersByPathPrefix(existing, `spell:${spellId}`).filter(
    (m) => !(m.sourcePath ?? m.sourceId).startsWith(spellPrefix)
  );
  ```
- **Bug:** If a spell has a top-level `effectBundle` plus an `effectUnit` targeting the same actor, or two modifier-emitting units (e.g., two `stat_bundle` units or `stat_bundle` + `retaliation_rider`/`quicken_cast_grant`) applied to the same `targetId` within the same `castId`, the second `appendTargetModifiers` call wipes out the modifiers added by the first unit of the **same** cast.
- **Fix direction:** Revoke modifiers matching `spell:${spellId}` **except** those belonging to the current cast prefix (`spell:${spellId}:${castId}`), preserving intra-cast accumulation while still replacing older casts of the same spell cleanly.

### 1.3 Dropped `grantedTags` on Targeted/Self Spells & Missing `weapon:magic` DR Bypass
- `materializeTopLevelSpellModifiers` and `materializeSpellUnitModifiers` in [spell_effects.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_effects.ts#L170-L237) extract `modifiers`, whereas [spell_aura_resolver.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_aura_resolver.ts#L137-L139) explicitly collects `unit.effectBundle.grantedTags` for aura occupants.
- For targeted/self-cast spells like *Divine Favor* (`["divine_favor_active"]`), *Magic Weapon* (`["weapon:magic"]`), and *Enlarge Person* (`["enlarged"]`), `grantedTags` are currently discarded.
- Furthermore, [attack_routine.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/combat/attack_routine.ts#L246) copies `bypassTags: wpn.bypassTags` for manufactured weapons (and `[natLimb?.damageType]` for natural weapons on L287) without appending `'magic'` when the actor holds the `weapon:magic` tag (such as from *Magic Weapon* or *Magic Fang*). Meanwhile, [semantic_tags.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags.ts#L315-L322) already projects tags from `StatusEffectsComponent`, which makes persisting `grantedTags` on `ActiveStatusEffect` clean and consistent.

### 1.4 Weapon Damage Enhancement Stacking Asymmetry (`dnd35e_dag_adapter.ts:452, 588–589`)
- In [dnd35e_dag_adapter.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts#L452), `pushMod('attack', equipAttackBonus, 'enhancement', 'equipment_attack', 'item:weapon/enhancement', 'mundane')` feeds weapon enhancement bonuses into the DAG so *Magic Weapon*'s `+1 enhancement` attack bonus properly competes instead of double-stacking.
- However, `damage` does not push an `'enhancement'` modifier for the equipped weapon, and instead `attack_routine.ts:243` adds `wpn.damageBonus` directly on top of `params.flatDamageBonus` (which already contains `resolveTypedModifiers(modsByStat['damage'])`). As a result, wielding a `+1 Longsword` while buffed with *Magic Weapon* (`+1 enhancement` damage) stacks to `+2` damage instead of taking `max(1, 1) = +1`.

### 1.5 Dispel Magic CL Check & Status/Condition Desync (`spell_cast_units.ts:111–145`)
- In [spell_cast_units.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_units.ts#L124-L143):
  - `resolveDispelCheck` is called with `casterLevel` as the target spell's CL (`targetSpellCasterLevel`) instead of reading the target effect's stored `casterLevel`.
  - When a dispel check succeeds, it calls `revokeModifiersByPathPrefix(cleaned, rootPath)` on `statModifiers` only—leaving any matching `StatusEffectsComponent` badge/timer and spell-applied `dndData.conditions` orphaned on the target.

### 1.6 Critical Tier 1 Console Traps Across `StatusEffectsComponent` Consumers
Auditing every consumer of `StatusEffectsComponent` revealed five engine traps that would break or degrade performance if spell buffs/debuffs are simply pushed into `StatusEffectsComponent`:

1. **`hud_alerts.ui.ts` Warning Spam ([hud_alerts.ui.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud_alerts.ui.ts#L245-L256)):**
   - Currently iterates `statuses.activeEffects` and pushes `{ label, detail: '${active.duration}t remaining', severity: 'warning' }` for **every** entry. Registering friendly buffs (*Divine Favor*, *Mage Armor*, *Enlarge Person*) here would flood the alert stack with yellow warnings. Warnings in `AlertsStack` must be filtered to detrimental/debuff effects (`polarity === 'debuff'` or `def?.detrimental === true`).
2. **`auto_pause_signals.ts` Missed Dynamic Debuffs ([auto_pause_signals.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/auto_pause_signals.ts#L179-L199)):**
   - `detectDetrimentalStatus` checks `after.campaign.status[effectId]?.detrimental`. Enemy-cast spell debuffs (e.g., *Bane*, *Prayer*, *Ray of Enfeeblement*) will not exist in `campaign.status`; `detectDetrimentalStatus` must inspect `effect.polarity === 'debuff'` on `ActiveStatusEffect` (while never pausing on `'buff'` or `'mixed'` self-buffs like *Enlarge Person*).
3. **8-Hour Buff Bulk-Rest Performance Trap ([world_time_skip.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/world_time_skip.ts#L56-L63), [status-effect.system.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/status-effect.system.ts#L182-L195)):**
   - `hasActivePerTurnLocalHazard` currently returns `true` if **any** entity has `StatusEffectsComponent`, forcing `advanceWorldTimeBulk` to step `stepCap = 1` turn at a time instead of `BULK_CADENCE_STEP_SIZE`.
   - `advanceActorStatusEffectsByTurns` calls `tickActorStatusEffectsSingleTurn` in a `turnsElapsed` loop. An `8-hour` or `1 hour/level` buff (600–4,800 turns) during an 8-hour rest (`4800` turns) would force 4,800 single-turn cadence iterations!
   - **Fix direction:** Only flag `hasActivePerTurnLocalHazard` when a status effect actually has per-turn mechanics (`perTurnDamage`, `perTurnHeal`, or unresolved `secondaryTriggerAfterTurns`), and allow `advanceActorStatusEffectsByTurns` to subtract `turnsElapsed` in $O(1)$ for pure timed modifiers/conditions without per-turn hooks (skipping decrementing when `isPermanent === true`).
4. **Expiry Log Phrasing & Cleanup Hook ([status-effect.system.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/status-effect.system.ts#L103-L109)):**
   - Line 106 logs ``You are no longer ${def?.name ?? active.effectId}.``, which would print raw IDs (`"You are no longer spell:divine_favor."`) and never informs the ruleset cartridge to revoke matching `statModifiers` / spell-linked `dndData.conditions`. Using `displayName` + `RulesetContract.onStatusEffectExpired` resolves both.
5. **Per-Turn DAG Cache Thrashing ([dnd35e_dag_adapter.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts#L297)):**
   - `evaluateDnD35eEntityDAG` invalidates `campaignEntityDagCache` whenever `cached.statusRef !== statusRef`. Because every round tick produces a new `StatusEffectsComponent` reference with `duration - 1`, **every actor with an active buff would miss the DAG cache on every single turn** even when no modifier/tag changed!
   - A structural status equivalence check comparing `{ effectId, grantedTags, polarity, sourcePath, active > 0 }` (ignoring pure `duration` countdown when `duration > 0`) eliminates unnecessary DAG recomputations.

### 1.7 UI Observability Gaps Across All 5 Surfaces
1. **HUD Vitals Plate ([VitalsCard.tsx](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud/VitalsCard.tsx#L91-L102)):** Hardcodes `tone="warning"`, displays raw `eff.effectId (${eff.duration}t)`, has no hover tooltip (`title`), and misses `dndData.conditions`, `PropertyOverlay` forms (Wild Shape/Polymorph), and active emanation auras.
2. **Character Sheet Overview ([DnD35eSheetOverviewCol.tsx](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/cartridges/dnd35e/DnD35eSheetOverviewCol.tsx#L141-L180)):** Renders `conditions` (`danger`) and `activeEffects` (`info`, raw `${eff.effectId} (${eff.duration}t)`, no tooltip). Also, Defenses (`AC`, `Touch`, `Flat`, `Fort`, `Ref`, `Will`) and Ability Score cells do not yet expose tooltips from already-computed DAG breakdowns (`acResolution`, `saveBreakdowns`, `abilityBreakdowns`).
3. **Progression & Features Projection ([dnd35e_ui_projection.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts#L286-L299)):** `buildActorFeatureEntries` emits raw `eff.effectId (${eff.duration}t)` with no `description`.
4. **Inspect Card / Hover Tooltip ([inspect_tooltip.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/inspect_tooltip.ts#L43-L212) & [TacticalScannerCard.tsx](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/hud/TacticalScannerCard.tsx)):** Shows HP/AC/BAB/Saves/lore, but shows zero active buffs, debuffs, conditions, or remaining durations when hovering or pressing `[X]` on enemies, allies, or self.
5. **Map Token Status Pips ([tactical_snapshot.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/tactical_snapshot.ts#L153-L161)):** Falls back to `#f1c40f` whenever `state.campaign.status[effect.effectId]` is undefined instead of reading `effect.color` or polarity defaults.

---

## 2. Proposed Three-Tier Architecture (`AGENTS.md` Rules 16, 17, 19, 21)

### Tier 1 — Core Console Engine
- **`ActiveStatusEffect` Metadata ([actor_components.types.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/components/actor_components.types.ts)):** Extend with optional JSON-serializable fields:
  - `displayName?: string`
  - `summary?: string`
  - `polarity?: 'buff' | 'debuff' | 'mixed' | 'neutral'`
  - `color?: string`
  - `sourcePath?: string`
  - `casterLevel?: number`
  - `linkedConditionId?: string`
  - `grantedTags?: ReadonlyArray<string>`
  - `isPermanent?: boolean`
- **`RulesetContract` Hooks & DTO ([ruleset.types.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/ruleset.types.ts)):**
  - Add `ActiveEffectDisplayDTO` (`id`, `label`, `durationTurns?`, `isPermanent?`, `polarity`, `summary?`, `categoryLabel?`, `color?`).
  - Add optional `onStatusEffectExpired?(state: GameState, entityId: EntityId, expiredEffect: ActiveStatusEffect): GameState`.
  - Add optional `projectActiveEffects?(state: Readonly<GameState>, entityId: EntityId): ReadonlyArray<ActiveEffectDisplayDTO>` so cartridges can project unified views combining `StatusEffectsComponent`, ruleset conditions, active spatial emanations, and transformation overlays.
- **Status Tick, Bulk Time Skip, Auto-Pause & UI Filtering:**
  - `status-effect.system.ts`: Respect `isPermanent`, use `displayName` in expiration logs, notify `ruleset.onStatusEffectExpired`, and fast-forward pure countdown effects in $O(1)$ during `advanceActorStatusEffectsByTurns`.
  - `world_time_skip.ts`: Restrict `hasActivePerTurnLocalHazard` to effects that actually have per-turn ticks or unresolved secondary stages.
  - `auto_pause_signals.ts` & `hud_alerts.ui.ts`: Recognize `effect.polarity === 'debuff'` (or `def?.detrimental === true`); keep buffs out of auto-pause and warning alerts.
  - `DataDisplay.tsx`: Add optional `title?: string` to `BadgeProps`.
  - `tactical_snapshot.ts`, `inspect_tooltip.ts`, `VitalsCard.tsx`, and a shared `formatTurnDuration` helper in `src/utils/`: Surface consistent polarity-toned badges, compact durations, hover summaries, and inspected actor effects.

### Tier 2 — D&D 3.5e Cartridge
- **`spell_duration.ts` (New Pure Module under `src/rulesets/dnd35e/magic/`):**
  - `parseSpellDurationTurns(durationStr, casterLevel, options?)`: Deterministic parser handling all 28 SRD duration formats (`1 round/level`, `1 min/level`, `10 min/level`, `1 hour/level`, `2 hours/level`, `1 day/level`, dice/fixed durations like `1d6+2 rounds` or `4d12 hours`, `1 round + 1 round/3 levels`, `permanent`, `concentration`, `instantaneous`, etc.) plus `metamagic.extend` (`2x`) — zero content-ID branching.
  - `classifyEffectPolarity(...)` and `formatModifierSummary(...)`: Purely derived from emitted modifiers/conditions/tags (`+2 STR, -2 DEX` -> `'mixed'`, all positive buffs -> `'buff'`, negative/harmful/conditions -> `'debuff'`).
- **Cast Registration, Expiration & Dispel Sync:**
  - `spell_cast_effects.ts`: Register timed/permanent `ActiveStatusEffect` records when applying `stat_bundle`, top-level `effectBundle`, `condition`, `ability_harm`, `quicken_cast_grant`, or `retaliation_rider`; fix `appendTargetModifiers` to preserve same-`castId` units while revoking prior casts.
  - `dnd35e_ruleset.ts`: Implement `onStatusEffectExpired` (revoking `statModifiers` by `sourcePath` and clearing spell-linked `dndData.conditions` only if no other active effect grants the same condition, then syncing footprint) and `projectActiveEffects` (aggregating `StatusEffectsComponent`, remaining manual/racial conditions, `PropertyOverlay` forms, and `queryActiveFieldsAtPosition` aura buffs/debuffs).
  - `spell_cast_units.ts`: Fix `case 'dispel'` to read stored `casterLevel` (from matching `StatusEffectsComponent` entry or fallback), check `resolveDispelCheck`, and revoke modifiers, matching `StatusEffectsComponent` entries, and linked conditions together.
- **Stacking, DR Bypass & DAG Cache Coherence:**
  - `semantic_tags.ts` & `attack_routine.ts`: Project `eff.grantedTags` from `StatusEffectsComponent` onto `selfTags` and propagate `'magic'` to `bypassTags` when `'weapon:magic'` is active.
  - `dnd35e_dag_adapter.ts`: Emit equipped weapon damage bonus as `'enhancement'` so weapon enchantment and *Magic Weapon* compete properly; update DAG cache key check so pure countdown ticks on active `StatusEffectsComponent` entries remain cache hits.
- **UI & Sheet Enhancements:**
  - `DnD35eSheetOverviewCol.tsx` & `dnd35e_ui_projection.ts`: Render unified active effects with polarity badges + tooltips, and attach stat breakdown tooltips (`acResolution`, `saveBreakdowns`, `abilityBreakdowns`) onto existing Defenses & Ability Score cells.

### Tier 3 — System Content
- Zero spell-ID switches in TypeScript. To cleanly cover instantaneous spells that apply short-lived conditions without hardcoded spell-ID rules, add an optional declarative `duration` override property on the `condition` effect unit schema (`spell_system.types.ts`) if authored on those JSON units, with a named constant fallback when omitted.

---

## 3. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| Extend `ActiveStatusEffect` with optional metadata (`displayName`, `summary`, `polarity`, `color`, `sourcePath`, `casterLevel`, `linkedConditionId`, `grantedTags`, `isPermanent`) | `applyStatusEffect` (`status-effect.system.ts`), `spell_cast_effects.ts`, tests constructing mock `StatusEffectsComponent` | `VitalsCard.tsx`, `hud_alerts.ui.ts`, `auto_pause_signals.ts`, `tactical_snapshot.ts`, `DnD35eSheetOverviewCol.tsx`, `dnd35e_ui_projection.ts`, `save.ts` (all optional fields, backward compatible) | `classic_stats.ts`, `classic_ui_adapter.ts` |
| Add `RulesetContract.onStatusEffectExpired` & `projectActiveEffects` (`ActiveEffectDisplayDTO`) | `dnd35eRulesetContract` (`dnd35e_ruleset.ts`), `status-effect.system.ts` (`tickActorStatusEffectsSingleTurn`) | `VitalsCard.tsx`, `inspect_tooltip.ts` (`TacticalScannerCard`), `DnD35eSheetOverviewCol.tsx`, `dnd35e_ui_projection.ts` | `classic` cartridge (`classicRulesetContract` leaves optional hooks undefined; fallback renders `StatusEffectsComponent` directly) |
| $O(1)$ bulk-time advance & precise `hasActivePerTurnLocalHazard` (`status-effect.system.ts`, `world_time_skip.ts`) | `advanceWorldTimeBulk`, `advanceWorldTimeBulkAsync`, `executeEightHourRest` (`rest.system.ts`) | `rest_recovery.ts`, `m153_rest_pressure_logistics.test.ts`, `unified_round_clock.test.ts` (timers & expiry callbacks stay accurate while avoiding 4800-step loops) | `tickControllerLinksAndOverlays` (`PropertyOverlay` countdowns), `CoatingComponent` countdown |
| `hud_alerts.ui.ts` & `auto_pause_signals.ts` polarity gating (`polarity === 'debuff'` / `detrimental`) | Spell casts (`spell_cast_effects.ts`), hazard/combat `applyStatusEffect` | `AlertsStack.tsx`, RTwP auto-pause triggers | `tests/hud_rest_and_display_name.test.ts` (`campaign.status` mocks without `polarity` continue matching via `def.detrimental`) |
| Fix `appendTargetModifiers` same-cast overwrite + register `ActiveStatusEffect` in `spell_cast_effects.ts` | `executeDnD35eSpellCast`, `resolveDnD35eSpellItemEffect` (`spell_cast_resolver.ts`) | `dnd35e_dag_adapter.ts` (`statModifiers`, `selfTags`), `attack_routine.ts`, `semantic_tags.ts`, `dnd35e_ui_projection.ts` | Multi-unit spells in `public/data/rulesets/dnd35e/spells/*.json`, `tests/dnd35e_m116_spells.test.ts`, `tests/m167_dnd35e_mechanics_and_content_parity.test.ts` |
| `weapon:magic` `'magic'` bypass tag + equipped weapon damage `'enhancement'` stacking competition | `collectEquippedItemDAGContributions` / `dnd35e_dag_adapter.ts`, `resolveActorAttackRoutine` | `executeCombatStrikeExchange` / `mitigateIncomingDamage` vs `DR/magic`, Character Sheet `attackGroups` damage formulas | Natural weapons (*Magic Fang*), existing weapon enhancement tests |
| Sync `Dispel Magic` CL & cleanup (`spell_cast_units.ts`) + `onStatusEffectExpired` cleanup | `dispel_magic` / `greater_dispel_magic` spell units, `processStatusEffectsTick` | `StatusEffectsComponent`, `dndData.statModifiers`, `dndData.conditions`, `syncDnD35eActorSpatialFootprint` | `tests/dnd35e_m136_acf_mechanics.test.ts`, `tests/dnd35e_phase21_primitives.test.ts` |
| DAG cache status equivalence (`dnd35e_dag_adapter.ts`) | `processStatusEffectsTick` mutating `StatusEffectsComponent` durations each round | `evaluateDnD35eEntityDAG`, HUD/Inspect/Combat hot paths | `ActiveEffects` reference transitions when an effect expires or newly applies still invalidate cache |
| UI presentation updates (`BadgeProps.title`, `VitalsCard`, `inspect_tooltip`, `tactical_snapshot`, `DnD35eSheetOverviewCol`) | `formatTurnDuration`, `projectActiveEffects`, `dagResult` breakdowns | `TacticalScannerCard`, `DnD35eSheetModal`, HUD Zone 1 & Zone 3, Canvas status pips | `src/styles/` (ensure no new un-tokenized CSS variables; reuse existing badges/tokens), `console_ui_architecture.test.ts`, SSOT docs (`SSOT_CONSOLE.md`, `SSOT_DND35E.md`, `ARCHITECTURE.md`) |

---

## 4. Open Questions & Assumptions for User Confirmation

1. **Include the 3 related mechanical bugs uncovered during research?**
   - Fix `weapon:magic` not adding `'magic'` to weapon `bypassTags` (`DR/magic`), fix `+1` weapon damage stacking double with *Magic Weapon* (`enhancement` stacking competition in DAG), and fix `appendTargetModifiers` wiping earlier units of the same `castId` + *Dispel Magic* CL/status/condition sync?
   - **Recommendation:** Yes — otherwise buffs like *Magic Weapon* and *Dispel Magic* behave inconsistently when timed and surfaced in the UI.
2. **Unify active spatial emanation auras and transformation overlays (`PropertyOverlay`, e.g., Wild Shape / Polymorph) into the HUD & Inspect Active Effects projection?**
   - Through `RulesetContract.projectActiveEffects`, both `VitalsCard` and `Inspect` can show active emanation buffs/debuffs (with source spell name + remaining rounds from the field) and active form overlays (`durationTurns`) alongside personal/targeted spell timers.
   - **Recommendation:** Yes.
3. **Duration badge formatting convention?**
   - Show compact human-readable durations on HUD/Sheet pills (`5r`, `1m`, `10m`, `1h`, `8h`, `Perm`) with exact round counts and mechanical summaries in the hover tooltip (e.g., `"Divine Favor: +2 luck Attack, +2 luck Damage • 1m (10 rounds remaining)"`)?
   - *(Note: Existing tests like `hud_rest_and_display_name.test.ts` check `projectHudAlertsList` alert text or internal `activeEffects`; only raw `(10t)` badges in `VitalsCard` / `DnD35eSheetOverviewCol` change visually unless alert details should stay `(Xt remaining)` or use compact formatting too.)*
   - **Recommendation:** Compact human-readable on badges (`5r`, `1m`, `1h`, `Perm`) + exact rounds and modifier summary in tooltips.
4. **Instantaneous spells that inflict short-lived conditions (e.g. *Color Spray*, *Chaos Hammer*):**
   - Should we add an optional declarative `duration` field on the `condition` effect unit Zod schema (`spell_system.types.ts`) so spells whose top-level `duration` is `"instantaneous"` can specify the condition's round duration declaratively in JSON (with a named default constant fallback when a condition unit omits it on an instantaneous spell)?
   - **Recommendation:** Yes (keeps zero spell-ID hardcoding per Rule 21).
5. **Alert Stack & Auto-Pause Split:**
   - Keep friendly buffs (`polarity === 'buff'`) out of the top-right warning `AlertsStack` and RTwP detrimental-status auto-pause—showing them cleanly in `VitalsCard`, Character Sheet, and `Inspect`—while showing debuffs (`polarity === 'debuff'` / `detrimental: true`) in `AlertsStack` and triggering detrimental auto-pause?
   - **Recommendation:** Yes.
