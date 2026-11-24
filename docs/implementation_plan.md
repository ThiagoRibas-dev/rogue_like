# Implementation Plan — Milestone 168: Active Buffs, Debuffs & Spell Duration Lifecycle, Expiration, Dispel Sync & UI Observability

**Date:** 2026-11-23  
**Research Basis:** [docs/research_notes.md](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/research_notes.md)  
**Workflow Stage:** `AGENTS.md` Phase 1 Kickoff Flow — Steps 4 & 5 (Enhanced Implementation Plan — **Awaiting Explicit User Approval**)

---

## 0. Confirmed User Decisions & Scope Summary

All five design questions from research were confirmed by the user:
1. **Include Related Correctness Fixes:** Propagate `weapon:magic` -> `'magic'` DR bypass tag on strikes, enforce `'enhancement'` stacking competition between equipped weapon damage bonuses and *Magic Weapon*, preserve intra-cast modifiers in `appendTargetModifiers`, and synchronize *Dispel Magic* CL checks plus status/condition removal.
2. **Unified Aura & Overlay UI Projection:** Surface active spatial emanation auras (`FieldComponent`) and form overlays (`PropertyOverlayComponent`) alongside timed spells and conditions through `RulesetContract.projectActiveEffects`.
3. **Dynamic Monotonic Duration Badges + Tooltip Details:** Render compact human-readable durations that transition cleanly as turns tick down (`Xd` -> `Xh` -> `Xm` -> `Xr`, plus `Perm`), with exact round counts and modifier summaries on hover (`"Divine Favor: +2 luck Attack, +2 luck Damage • 1m (10 rounds)"`).
4. **Declarative Condition Duration Override:** Add optional `duration?: string` to the `condition` effect unit Zod schema (`DnD35SpellEffectUnitSchema`), with a named fallback constant when omitted on an `instantaneous` spell (zero spell-ID hardcoding per Rule 21).
5. **Polarity-Gated Alerts & Auto-Pause:** Keep friendly buffs (`'buff'`) out of top-right warning `AlertsStack` ribbons and detrimental RTwP auto-pause while keeping debuffs (`'debuff'`) in both.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Evicted / Fixed Split-Brain |
| :--- | :--- | :--- |
| Turn time unit constants (`ROUNDS_PER_MINUTE`, `ROUNDS_PER_HOUR`, `ROUNDS_PER_DAY`) | [world_clock.constants.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/constants/world_clock.constants.ts) | Eliminates ad-hoc `60 / 6`, `10`, `14400` literals across spell/UI code |
| Compact & verbose turn duration formatting (`formatTurnDurationCompact`, `formatTurnDurationVerbose`) | [duration.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/utils/duration.ts) *(New Tier 1 util)* | Replaces raw `(${eff.duration}t)` string interpolation in `VitalsCard`, `DnD35eSheetOverviewCol`, `dnd35e_ui_projection`, `hud_alerts.ui` |
| Timed status storage, metadata, expiration callbacks & $O(1)$ bulk advance | [actor_components.types.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/components/actor_components.types.ts) & [status-effect.system.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/status-effect.system.ts) | Replaces un-tracked `statModifiers` & slow 1-turn-per-step bulk ticking |
| Bulk-time local hazard predicate (`hasActivePerTurnLocalHazard`) | [world_time_skip.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/world_time_skip.ts) | Delegates to `hasPerTurnStatusActivity` instead of forcing 1-turn steps for passive buffs |
| Cartridge lifecycle & unified display contracts | [ruleset.types.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/types/ruleset.types.ts) (`ActiveEffectDisplayDTO`, `onStatusEffectExpired`, `projectActiveEffects`) | Eliminates direct `dndData` casting inside Tier 1 HUD/Inspect views |
| Spell duration parsing, polarity inference & modifier summary formatting | [spell_duration.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_duration.ts) *(New Tier 2 module)* | Purely data-driven over `spell.duration` & emitted `StatModifier[]` |
| Spell cast effect application & timed status registration | [spell_cast_effects.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_effects.ts) | Fixes `appendTargetModifiers` overwriting earlier units of the same `castId` |
| *Dispel Magic* CL resolution & synchronized revocation | [spell_cast_units.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_units.ts) | Fixes dispeller-CL self-check & cleans up `StatusEffectsComponent` + linked conditions alongside `statModifiers` |
| Active spell emanation aura projection | [spell_aura_resolver.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_aura_resolver.ts) (`activeAuras`) | Single pass reused by `projectDnD35eActiveEffects`; no duplicate field scanning |
| Weapon enhancement stacking, `weapon:magic` DR bypass & DAG status cache invariance | [srd_registry.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/srd_registry.ts), [dnd35e_dag_adapter.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts), [attack_routine.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/combat/attack_routine.ts), [semantic_tags_context.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags_context.ts), [semantic_tags.ts](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/semantic_tags.ts) | Fixes `+1` sword + *Magic Weapon* double damage & per-turn DAG cache misses |
| HUD, Inspect, Canvas Pips, Auto-Pause & Sheet rendering | `DataDisplay.tsx`, `VitalsCard.tsx`, `hud_alerts.ui.ts`, `auto_pause_signals.ts`, `tactical_snapshot.ts`, `inspect_tooltip.ts`, `DnD35eSheetOverviewCol.tsx`, `dnd35e_ui_projection.ts` | Replaces warning-only/un-tooltipped badges with polarity tones & breakdown tooltips |

---

## 2. Step-by-Step Implementation Plan

### Phase 1: Tier 1 Console Constants, Duration Utilities & Component/Contract Types

#### 1.1 Add `ROUNDS_PER_MINUTE` & `ROUNDS_PER_DAY` — `src/constants/world_clock.constants.ts`
Add canonical round conversion constants immediately alongside `ROUNDS_PER_HOUR`:

```ts
/** Number of 6-second global turns in 1 game minute (`60 / 6 = 10` rounds). */
export const ROUNDS_PER_MINUTE = SECONDS_PER_MINUTE / DEFAULT_SECONDS_PER_TURN;

/** Number of 6-second global turns in 1 full 24-hour game day (`600 * 24 = 14400` rounds). */
export const ROUNDS_PER_DAY = ROUNDS_PER_HOUR * DEFAULT_HOURS_PER_DAY;
```

#### 1.2 Create Shared Duration Formatter — `src/utils/duration.ts`
Pure, ruleset-agnostic formatter driving monotonic transitions (`Xd` -> `Xh` -> `Xm` -> `Xr` / `Perm`):

```ts
import {
  DEFAULT_SECONDS_PER_TURN,
  MINUTES_PER_HOUR,
  ROUNDS_PER_DAY,
  ROUNDS_PER_HOUR,
  ROUNDS_PER_MINUTE
} from '../constants/world_clock.constants.ts';

/**
 * Formats a turn/round count into a compact, monotonically transitioning UI pill string
 * (`Perm`, `Xd`, `Xh`, `Xm`, or `Xr`).
 */
export function formatTurnDurationCompact(turns: number, isPermanent?: boolean): string {
  if (isPermanent === true) return 'Perm';
  const clamped = Math.max(0, Math.floor(turns));
  if (clamped >= ROUNDS_PER_DAY) return `${Math.floor(clamped / ROUNDS_PER_DAY)}d`;
  if (clamped >= ROUNDS_PER_HOUR) return `${Math.floor(clamped / ROUNDS_PER_HOUR)}h`;
  if (clamped >= ROUNDS_PER_MINUTE) return `${Math.floor(clamped / ROUNDS_PER_MINUTE)}m`;
  return `${clamped}r`;
}

/**
 * Formats a turn/round count into a verbose tooltip string showing units and exact rounds
 * (e.g., `"1m (10 rounds)"`, `"1h 30m (900 rounds)"`, `"6 rounds"`, `"Permanent"`).
 */
export function formatTurnDurationVerbose(turns: number, isPermanent?: boolean): string {
  if (isPermanent === true) return 'Permanent';
  const clamped = Math.max(0, Math.floor(turns));
  const roundLabel = `${clamped} ${clamped === 1 ? 'round' : 'rounds'}`;
  if (clamped < ROUNDS_PER_MINUTE) return roundLabel;

  if (clamped >= ROUNDS_PER_DAY) {
    const days = Math.floor(clamped / ROUNDS_PER_DAY);
    const remHours = Math.floor((clamped % ROUNDS_PER_DAY) / ROUNDS_PER_HOUR);
    const prefix = remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    return `${prefix} (${roundLabel})`;
  }
  if (clamped >= ROUNDS_PER_HOUR) {
    const hours = Math.floor(clamped / ROUNDS_PER_HOUR);
    const remMins = Math.floor((clamped % ROUNDS_PER_HOUR) / ROUNDS_PER_MINUTE);
    const prefix = remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
    return `${prefix} (${roundLabel})`;
  }
  const mins = Math.floor(clamped / ROUNDS_PER_MINUTE);
  const remSecs = (clamped % ROUNDS_PER_MINUTE) * DEFAULT_SECONDS_PER_TURN;
  const totalMins = mins % MINUTES_PER_HOUR;
  const prefix = remSecs > 0 ? `${totalMins}m ${remSecs}s` : `${totalMins}m`;
  return `${prefix} (${roundLabel})`;
}
```

#### 1.3 Extend `ActiveStatusEffect` — `src/types/components/actor_components.types.ts` & `src/types/components.types.ts`
Add `StatusEffectPolarity` and optional JSON-serializable metadata fields to `ActiveStatusEffect` (backward-compatible with all existing saves and mocks):

```ts
/** Polarity classification for active status effects and ruleset buffs/debuffs. */
export type StatusEffectPolarity = 'buff' | 'debuff' | 'mixed' | 'neutral';

export interface ActiveStatusEffect {
  readonly effectId: string;
  readonly duration: number;
  readonly sourceEntityId?: EntityId;
  readonly elapsedTurns?: number | undefined;
  readonly secondaryResolved?: boolean | undefined;
  readonly interaction?: InteractionChain | undefined;
  readonly displayName?: string | undefined;
  readonly summary?: string | undefined;
  readonly polarity?: StatusEffectPolarity | undefined;
  readonly color?: string | undefined;
  readonly sourcePath?: string | undefined;
  readonly casterLevel?: number | undefined;
  readonly linkedConditionId?: string | undefined;
  readonly grantedTags?: ReadonlyArray<string> | undefined;
  readonly isPermanent?: boolean | undefined;
}
```
Re-export `StatusEffectPolarity` alongside `ActiveStatusEffect` in `src/types/components.types.ts`.

#### 1.4 Extend `RulesetContract` — `src/types/ruleset.types.ts`
Add `ActiveEffectDisplayDTO` and optional lifecycle/projection hooks:

```ts
/** Polarity-aware display DTO projected by a ruleset for HUD Vitals, Inspect, and Character Sheet badges. */
export interface ActiveEffectDisplayDTO {
  readonly id: string;
  readonly label: string;
  readonly polarity: StatusEffectPolarity;
  readonly durationTurns?: number | undefined;
  readonly isPermanent?: boolean | undefined;
  readonly isAura?: boolean | undefined;
  readonly summary?: string | undefined;
  readonly sourceLabel?: string | undefined;
  readonly color?: string | undefined;
}
```
On `RulesetContract`:
```ts
  /** Optional hook invoked immediately after an `ActiveStatusEffect` expires and is removed from `StatusEffectsComponent`. */
  onStatusEffectExpired?(state: GameState, entityId: EntityId, expiredEffect: ActiveStatusEffect): GameState;

  /** Optional hook projecting all active buffs, debuffs, conditions, overlays, and auras for HUD/Inspect rendering. */
  projectActiveEffects?(state: Readonly<GameState>, entityId: EntityId): ReadonlyArray<ActiveEffectDisplayDTO>;
```

---

### Phase 2: Tier 1 Console Status Tick, $O(1)$ Bulk Advance, Auto-Pause & Alerts

#### 2.1 `src/systems/status-effect.system.ts`
1. Add `ActiveStatusEffectMetadata` and optional 7th parameter `metadata?: ActiveStatusEffectMetadata` on `applyStatusEffect`:
```ts
export interface ActiveStatusEffectMetadata {
  readonly displayName?: string | undefined;
  readonly summary?: string | undefined;
  readonly polarity?: StatusEffectPolarity | undefined;
  readonly color?: string | undefined;
  readonly sourcePath?: string | undefined;
  readonly casterLevel?: number | undefined;
  readonly linkedConditionId?: string | undefined;
  readonly grantedTags?: ReadonlyArray<string> | undefined;
  readonly isPermanent?: boolean | undefined;
  readonly replaceExisting?: boolean | undefined;
}
```
2. Export `hasPerTurnStatusActivity(state: Readonly<GameState>, entityId: EntityId): boolean`:
```ts
export function hasPerTurnStatusActivity(state: Readonly<GameState>, entityId: EntityId): boolean {
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (!statuses || statuses.activeEffects.length === 0) return false;
  return statuses.activeEffects.some((eff) => {
    const def = state.campaign.status[eff.effectId];
    if (!def) return false;
    const hasDot = (def.perTurnDamage ?? 0) > 0 || (def.perTurnHeal ?? 0) > 0;
    const hasPendingSecondary = def.secondaryTriggerAfterTurns !== undefined && eff.secondaryResolved !== true;
    return hasDot || hasPendingSecondary;
  });
}
```
3. In `tickActorStatusEffectsSingleTurn`:
   - Collect `const expiredEffects: ActiveStatusEffect[] = [];`.
   - If `active.isPermanent === true`, keep unchanged in `nextActiveEffects`.
   - Otherwise, if `active.duration > 1`, decrement `duration - 1`; else push to `expiredEffects` and log for player:
     ```ts
     const expiryMsg = active.displayName
       ? `${active.displayName} has worn off.`
       : `You are no longer ${def?.name ?? active.effectId}.`;
     ```
   - Commit updated/removed `StatusEffectsComponent`, then if `expiredEffects.length > 0` and `getComponent(nextState, entityId, ComponentType.Fighter) !== undefined`:
     ```ts
     const ruleset = getRuleset(nextState.campaign?.manifest?.rulesetId);
     if (ruleset.onStatusEffectExpired) {
       for (const expired of expiredEffects) {
         nextState = ruleset.onStatusEffectExpired(nextState, entityId, expired);
       }
     }
     ```
4. In `advanceActorStatusEffectsByTurns`:
   - When `turnsElapsed <= 0`, return `state`.
   - When `hasPerTurnStatusActivity(nextState, entityId)` is **true**, step turn-by-turn up to `remainingTurns`, breaking early to the $O(1)$ fast path as soon as `!hasPerTurnStatusActivity(nextState, entityId)`.
   - When `!hasPerTurnStatusActivity(nextState, entityId)`, compute remaining durations in a single $O(k)$ pass (`active.isPermanent === true ? active : { ...active, duration: active.duration - remainingTurns }`), expire anything `<= 0`, log player expirations, update/remove `StatusEffectsComponent`, and invoke `ruleset.onStatusEffectExpired` per expired entry.

#### 2.2 `src/systems/world_time_skip.ts`
Update `hasActivePerTurnLocalHazard(state)` line 58:
```ts
if (hasPerTurnStatusActivity(state, entityId)) return true;
```

#### 2.3 `src/core/auto_pause_signals.ts`
Update `detectDetrimentalStatus` to inspect `StatusEffectsComponent.activeEffects` directly so dynamic enemy spell debuffs trigger pause while buffs and mixed self-buffs do not:
```ts
const afterStatuses = getComponent(after, playerEntityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
for (const eff of afterStatuses?.activeEffects ?? []) {
  if (previousEffectIds.has(eff.effectId)) continue;
  if (eff.polarity === 'debuff') return 'detrimental_status';
  if (eff.polarity === undefined && after.campaign.status[eff.effectId]?.detrimental === true) {
    return 'detrimental_status';
  }
}
```

#### 2.4 `src/rendering/ui/hud_alerts.ui.ts`
Filter `statuses.activeEffects` in `projectHudAlertsList` so friendly buffs do not produce warning alert ribbons:
```ts
  if (statuses) {
    for (const active of statuses.activeEffects) {
      const def = state.campaign.status[active.effectId];
      const isFriendlyOrNeutral =
        active.polarity === 'buff' ||
        active.polarity === 'neutral' ||
        (active.polarity === undefined && def !== undefined && !def.detrimental);
      if (isFriendlyOrNeutral) continue;
      alerts.push({
        label: active.displayName ?? def?.name ?? active.effectId,
        detail: `${formatTurnDurationCompact(active.duration, active.isPermanent)} remaining`,
        severity: 'warning'
      });
    }
  }
```
*(Wait: check `tests/hud_rest_and_display_name.test.ts` — confirmed it only asserts `isActorPerceivedByPlayer`, `buildTurnStatusRibbon`, and `evaluateActorRestSafety`, not alert detail string formatting.)*

---

### Phase 3: Tier 2 D&D 3.5e Duration Parser, Cast Registration, Expiration, Dispel Sync & Stacking Fixes

#### 3.1 Declarative Condition Duration Field — `src/rulesets/dnd35e/types/system/spell_system.types.ts`
Extend the `'condition'` unit schema with optional `duration: z.string().optional()`:
```ts
  SpellEffectUnitBaseSchema.extend({
    type: z.literal('condition'),
    conditionId: z.string(),
    duration: z.string().optional(),
    durationRoundsScaling: DnD35SpellScalingRuleSchema.optional(),
    ...
```

#### 3.2 Pure Spell Duration Parser, Polarity & Summary Helpers — `src/rulesets/dnd35e/magic/spell_duration.ts`
Create `src/rulesets/dnd35e/magic/spell_duration.ts` (zero content-ID checks):
- Export named constants:
  - `DEFAULT_CONCENTRATION_FALLBACK_ROUNDS = ROUNDS_PER_MINUTE` (`10`)
  - `DEFAULT_INSTANTANEOUS_CONDITION_DURATION_ROUNDS = 2`
  - `EXTEND_METAMAGIC_DURATION_MULTIPLIER = 2`
  - `MIN_ACTIVE_SPELL_DURATION_ROUNDS = 1`
  - `POLARITY_COLORS`: `{ buff: '#2ed573', debuff: '#ff4757', mixed: '#a855f7', neutral: '#f1c40f' }`
- Implement `parseSpellDurationTurns(rawDuration, casterLevel, options)`:
  - Normalize whitespace/underscores (`1_round_per_level` -> `1 round/level`, strip `or until discharged`, extract `"concentration, up to ..."` cap, handle `instantaneous / 1 hour` by taking the post-`/` ongoing component when modifiers/conditions exist).
  - Recognize `"permanent"` -> `{ durationTurns: 0, isPermanent: true, isConcentration: false }`.
  - Recognize `"instantaneous"` -> returns `DEFAULT_INSTANTANEOUS_CONDITION_DURATION_ROUNDS` only if `options?.fallbackRoundsForCondition === true`, otherwise `{ durationTurns: 0, isPermanent: false, isConcentration: false }`.
  - Recognize `"concentration"` -> `{ durationTurns: DEFAULT_CONCENTRATION_FALLBACK_ROUNDS, isPermanent: false, isConcentration: true }`.
  - Evaluate compound/scaled durations (`"1 round + 1 round/3 levels"` -> `1 + Math.floor(cl / 3)`, `"N round/level"`, `"N min/level"`, `"N hour/level"`, `"N day/level"`, fixed `"30 minutes"`, `"24 hours"`, `"7 rounds"`, and dice durations `"1d6+2 rounds"`, `"4d12 hours"`, `"1d4 rounds or 1 round"` via `evaluateDiceExpression`).
  - Double non-permanent `durationTurns` when `options?.extend === true`.
- Implement `classifyEffectPolarity(modifiers, options)` strictly from numeric signs, target roles, and condition/ability-harm presence (`'buff' | 'debuff' | 'mixed' | 'neutral'`).
- Implement `formatSpellModifiersSummary(modifiers, options)` turning modifiers (`+2 luck Attack, -2 size DEX, +1 size step`, `Quicken <= Lvl 3`, `Retaliation 1d8 force`), `grantedTags` (filtering out internal `*_active` flags or formatting clean labels like `Magic Weapon`, `Enlarged`), and condition names into concise single-line tooltip strings.

#### 3.3 Cast Registration & Multi-Unit Safe `appendTargetModifiers` — `src/rulesets/dnd35e/magic/spell_cast_effects.ts`
1. Update `appendTargetModifiers(state, targetId, spellId, castId, newModifiers)` so revoking older casts of the same spell never strips earlier units of the **current** `castId`:
```ts
function appendTargetModifiers(
  state: GameState,
  targetId: EntityId,
  spellId: string,
  castId: string,
  newModifiers: ReadonlyArray<StatModifier>
): GameState {
  if (newModifiers.length === 0) return state;
  const targetDnd = getDnD35EntityData(state, targetId);
  const existing = targetDnd.statModifiers ?? [];
  const bareSpellRoot = `spell:${spellId}`;
  const currentCastPrefix = `spell:${spellId}:${castId}`;
  const cleaned = existing.filter((m) => {
    const path = m.sourcePath ?? m.sourceId;
    const isThisSpell =
      path === bareSpellRoot || path.startsWith(`${bareSpellRoot}:`) || path.startsWith(`${bareSpellRoot}/`);
    if (!isThisSpell) return true;
    return path === currentCastPrefix || path.startsWith(`${currentCastPrefix}/`);
  });
  return setDnD35EntityData(state, targetId, {
    ...targetDnd,
    statModifiers: [...cleaned, ...newModifiers]
  });
}
```
2. During `applyResolvedSpellEffectsToTarget(ctx)`:
   - Track applied modifiers, `grantedTags`, `hasAbilityHarm`, and active condition registrations on the target.
   - Compute `parsedDuration` for main modifier/bundle effects (`spell.duration`) and per-unit duration for `condition` units (`unit.duration ?? (unit.durationRoundsScaling ? evaluateSpellScalingRule(...) : spell.duration)`, with `fallbackRoundsForCondition: true`).
   - Also pass `grantedTags` from `ctx.spell.effectBundle?.grantedTags` and `stat_bundle.effectBundle.grantedTags`.
   - Call `applyStatusEffect` with `replaceExisting: true`, `sourcePath: spell:${spell.id}:${castId}`, `casterLevel`, `displayName`, `summary`, `polarity`, `color: POLARITY_COLORS[polarity]`, `grantedTags`, `linkedConditionId` (for conditions), and `isPermanent`.
   - In `case 'stat_bundle'` when `clearsDrain === true` (*Restoration*), also prune any active `StatusEffectsComponent` entry whose `polarity === 'debuff'` and `effectId.startsWith('spell:')` and `summary` indicates ability harm / negative modifiers, or remove corresponding modifiers & stale status entries when `statModifiers` no longer exist for that `sourcePath`.

#### 3.4 *Dispel Magic* Synchronization — `src/rulesets/dnd35e/magic/spell_cast_units.ts`
Update `case 'dispel'` (L111–145):
- Gather candidate root paths (`spell:<spellId>:<castId>`) from both `targetDnd.statModifiers` and `StatusEffectsComponent.activeEffects` matching `unit.revokesPathPrefix`.
- Look up each root path's stored `casterLevel` from matching `ActiveStatusEffect` entries (falling back to `DEFAULT_DISPEL_FALLBACK_CL = 1`, never blindly reusing the dispeller's `casterLevel` when target CL exists).
- When `resolveDispelCheck(casterLevel, targetSpellCl, unit.maxCasterLevelBonus > 10).dispelled` is `true`:
  - Revoke modifiers (`revokeModifiersByPathPrefix(cleanedMods, rootPath)`), collect dispelled `linkedConditionId`s, and filter out status entries whose `sourcePath` starts with `rootPath`.
- After the loop, if `dispelledCount > 0`, commit updated `StatusEffectsComponent` (removing component if empty via `removeComponent`), clear any dispelled `linkedConditionId` not still kept alive by remaining `StatusEffectsComponent` entries, update `statModifiers`, call `syncDnD35eActorSpatialFootprint`, and log the dispel count.

#### 3.5 Active Aura Summaries — `src/rulesets/dnd35e/magic/spell_aura_resolver.ts`
Expose `ActiveSpellAuraSummary` inside `ActiveSpellAuraContributions` (`activeAuras: ReadonlyArray<ActiveSpellAuraSummary>`) using the `FieldComponent`'s `duration` and `classifyEffectPolarity` / `formatSpellModifiersSummary` on each matching aura unit (single loop, zero extra spatial scans).

#### 3.6 Weapon Damage Enhancement Competition, `weapon:magic` DR Bypass & DAG Cache Coherence
1. **`src/rulesets/dnd35e/srd_registry.ts` (`getEquippedItemBonuses`):**
   Compute `equipDamageBonus` alongside `equipAttackBonus` from `itemDef.magicalProperties?.enhancementBonus ?? 0` on the primary/active weapon (masterwork grants +1 attack only, +0 damage) and return `{ equipAttackBonus, equipArmorBonus, equipDamageBonus }`.
2. **`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`:**
   - Destructure `equipDamageBonus` from `getEquippedItemBonuses` and emit:
     `pushMod('damage', equipDamageBonus, 'enhancement', 'equipment_damage', 'item:weapon/damage_enhancement', 'mundane');`
   - Update line 589:
     `const nonStrNonDoctrineFlatDamage = dagResult.damageBonus - strMod - equipDamageBonus - doctrineMod.damageBonus;`
     *(Preserves exact same net weapon damage formula while making `+1` weapon damage and `+1 enhancement` *Magic Weapon* properly compete in `resolveTypedModifiers`!)*
   - Add `areStatusEffectsStructurallyEqual(a?: StatusEffectsComponent, b?: StatusEffectsComponent): boolean` in `evaluateDnD35eEntityDAG` (L297) comparing length, `effectId`, `sourcePath`, `polarity`, `isPermanent`, `duration > 0`, and `grantedTags`—so routine countdown decrements (`10 -> 9`) remain DAG cache hits!
3. **`src/rulesets/dnd35e/semantic_tags_context.ts` & `src/rulesets/dnd35e/semantic_tags.ts`:**
   Collect `grantedTags` from active `StatusEffectsComponent` entries (`e.duration > 0 || e.isPermanent`) into `SituationalTagContext.activeStatusGrantedTags` and merge them into `selfTags` in `projectDnD35ActorSemanticTags`.
4. **`src/rulesets/dnd35e/combat/attack_routine.ts`:**
   When `params.selfTags?.includes('weapon:magic')` is true for manufactured weapons (or `'natural_weapon:magic'` / `'weapon:magic'` for natural attacks), append `'magic'` to `strike.bypassTags` (deduplicated) so *Magic Weapon* penetrates `DR/magic`.

#### 3.7 Ruleset Expiration & Unified Active Effect Projection — `src/rulesets/dnd35e/dnd35e_ruleset.ts`
Implement two cleanly typed functions and wire them onto `dnd35eRulesetContract`:
- `onDnD35eStatusEffectExpired(state, entityId, expiredEffect)`:
  - Revokes `statModifiers` matching `expiredEffect.sourcePath` (if present).
  - If `expiredEffect.linkedConditionId` is set, checks remaining `StatusEffectsComponent.activeEffects` on `entityId` for any other active effect with the same `linkedConditionId`; if none remains, removes `linkedConditionId` from `dndData.conditions`.
  - Runs `syncDnD35eActorSpatialFootprint(nextState, entityId)`.
- `projectDnD35eActiveEffects(state, entityId): ReadonlyArray<ActiveEffectDisplayDTO>`:
  - Emits entries from `StatusEffectsComponent.activeEffects`, remaining unlinked `dndData.conditions`, active `PropertyOverlayComponent` form, and `evaluateActiveSpellAuraContributions(...).activeAuras` (`isAura: true`), deduplicated cleanly.

---

### Phase 4: UI Observability Across All 5 Presentation Surfaces

1. **`BadgeProps.title` (`src/rendering/ui/primitives/DataDisplay.tsx`):**
   Add `readonly title?: string | undefined;` to `BadgeProps` and forward `title={title}` to the `<span className={classes} title={title}>` element.
2. **HUD Vitals (`src/rendering/ui/hud/VitalsCard.tsx`):**
   - Query `getActiveRuleset(state).projectActiveEffects?.(state, playerId)` (falling back to `StatusEffectsComponent` for cartridges without the hook).
   - Map `polarity` -> `BadgeTone` (`buff -> 'success'`, `debuff -> 'danger'`, `mixed -> 'info'`, `neutral -> 'warning'`).
   - Display `${eff.label} (${formatTurnDurationCompact(eff.durationTurns, eff.isPermanent)})` (when timed/permanent) with verbose tooltip `title` combining `eff.label`, `formatTurnDurationVerbose`, and `eff.summary`.
3. **Inspect / TacticalScanner (`src/rendering/inspect_tooltip.ts`):**
   - For `Fighter` or `Actor` entities, query `activeRuleset.projectActiveEffects?.(state, entityId)` (or `StatusEffectsComponent` fallback).
   - Append concise `type: 'desc'` lines colored by polarity (`#2ed573` buff, `#ff4757` debuff, `#a855f7` mixed, `#f1c40f` neutral) showing `Label (duration): summary` or `Label (duration)` so hovering or pressing `[X]` on enemies, allies, or self displays all active buffs/debuffs and durations.
4. **Canvas Status Pips (`src/rendering/tactical_snapshot.ts`):**
   Update L158–159 to `effect.color ?? def?.color ?? polarityDefaultColor(effect.polarity)`.
5. **Character Sheet & Feature Projection (`src/rendering/ui/cartridges/dnd35e/DnD35eSheetOverviewCol.tsx`, `src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts`):**
   - Update `"Active Conditions"` banner to `"Active Effects & Conditions"` and render `projectDnD35eActiveEffects(state, playerId)` with polarity tones, compact ticking durations, and verbose tooltips.
   - Add pure `formatResolutionBreakdownTooltip` helpers on Defenses (`AC`, `Touch`, `Flat`, `Fort`, `Ref`, `Will`) and Ability Score cells reading `evalResult?.dagResult.acResolution`, `saveBreakdowns`, and `abilityBreakdowns` (including active and shadowed modifiers).
   - Update `buildActorFeatureEntries` in `dnd35e_ui_projection.ts` to format status names with `eff.displayName ?? def?.name ?? eff.effectId` + `formatTurnDurationCompact` + `description: eff.summary ?? def?.description`.

---

### Phase 5: Tests, SSOT Registry Sync & Full 8-Stage Verification

1. Create `tests/m168_active_buffs_debuffs_duration_ui.test.ts` testing:
   - `parseSpellDurationTurns` across SRD formats + Extend Spell `2x` doubling + monotonic `formatTurnDurationCompact`/`Verbose` transitions (`2d -> 1d -> 23h -> 1h -> 59m -> 1m -> 9r -> 1r`, `Perm`).
   - *Divine Favor* (scaling luck, personal) vs *Magic Weapon* (enhancement + `weapon:magic` `'magic'` DR bypass + `+1` weapon damage competition + stacking with *Divine Favor*).
   - Mixed self-buff/penalty (*Enlarge Person* footprint + STR/DEX) and dual-role AoE (*Prayer* ally `'buff'` / enemy `'debuff'`).
   - Turn expiration (`processStatusEffectsTick`) and 8-hour bulk rest (`advanceWorldTimeBulk` O(1) fast path without 4800-step stall), cleanly revoking `statModifiers`, `grantedTags`, and non-overlapping `dndData.conditions`.
   - Multi-unit same-cast safety in `appendTargetModifiers` & *Dispel Magic* CL + synchronized status/condition removal.
   - Console invariants: friendly buffs skipped by `detectDetrimentalStatus` & `projectHudAlertsList`, enemy debuffs included in both, and DAG cache hits preserved across duration decrements.
   - UI projections (`projectDnD35eActiveEffects` including auras & `PropertyOverlay`, `buildInspectTooltip`, `buildActorFeatureEntries`).
2. Add `src/utils/duration.ts` to `docs/ssot/ssot_console.json` and `src/rulesets/dnd35e/magic/spell_duration.ts` to `docs/ssot/ssot_dnd35e.json`, run `bun scripts/map-codebase.ts`, update `docs/ARCHITECTURE.md` & `docs/MILESTONES.md`, and run `./verify.sh`.

---

## 3. Cascading Effects Matrix

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| Add `ROUNDS_PER_MINUTE`, `ROUNDS_PER_DAY` & `src/utils/duration.ts` | `world_clock.constants.ts` | `spell_duration.ts`, `VitalsCard.tsx`, `hud_alerts.ui.ts`, `inspect_tooltip.ts`, `DnD35eSheetOverviewCol.tsx`, `dnd35e_ui_projection.ts` | `docs/ssot/ssot_console.json`, `docs/SSOT_CONSOLE.md` |
| Extend `ActiveStatusEffect` & `RulesetContract` (`ActiveEffectDisplayDTO`, `onStatusEffectExpired`, `projectActiveEffects`) | `dnd35e_ruleset.ts`, `applyStatusEffect`, `spell_cast_effects.ts` | `status-effect.system.ts`, `VitalsCard.tsx`, `hud_alerts.ui.ts`, `auto_pause_signals.ts`, `inspect_tooltip.ts`, `tactical_snapshot.ts`, `save.ts` | `classic` cartridge (`classic_stats.ts`, `classic_ui_adapter.ts` keep fallback path intact) |
| $O(1)$ bulk advance & `hasPerTurnStatusActivity` (`status-effect.system.ts`, `world_time_skip.ts`) | `advanceWorldTimeBulk`, `advanceWorldTimeBulkAsync`, `executeEightHourRest` | `rest_recovery.ts`, `onStatusEffectExpired` triggers | `m153_rest_pressure_logistics.test.ts`, `unified_round_clock.test.ts` |
| Polarity filtering (`hud_alerts.ui.ts`, `auto_pause_signals.ts`) | `applyStatusEffect`, `spell_cast_effects.ts` | `AlertsStack.tsx`, RTwP auto-pause checks | `tests/hud_rest_and_display_name.test.ts` |
| Add optional `condition.duration` schema field + `spell_duration.ts` + cast registration & `appendTargetModifiers` fix | `spell_system.types.ts`, `executeDnD35eSpellCast`, `resolveDnD35eSpellItemEffect` | `StatusEffectsComponent`, `dndData.statModifiers`, `dndData.conditions`, `dnd35e_dag_adapter.ts` | `spell_duration.ts` registered in `docs/ssot/ssot_dnd35e.json` |
| `getEquippedItemBonuses` (`equipDamageBonus`) + `weapon:magic` `'magic'` bypass + DAG status equivalence | `collectEquippedItemDAGContributions`, `dnd35e_dag_adapter.ts`, `semantic_tags_context.ts`, `semantic_tags.ts` | `resolveActorAttackRoutine`, `executeCombatStrikeExchange`, `DnD35eSheetOverviewCol` damage displays | Existing weapon/DR tests |
| *Dispel Magic* CL check & synchronized cleanup (`spell_cast_units.ts`) | `dispel_magic` / `greater_dispel_magic` casts | `StatusEffectsComponent`, `dndData.statModifiers`, `dndData.conditions`, `syncDnD35eActorSpatialFootprint` | `dnd35e_m136_acf_mechanics.test.ts`, `dnd35e_phase21_primitives.test.ts` |
| `activeAuras` on `ActiveSpellAuraContributions` + UI rendering (`BadgeProps.title`, `VitalsCard`, `inspect_tooltip`, `DnD35eSheetOverviewCol`, `dnd35e_ui_projection`) | `evaluateActiveSpellAuraContributions`, `projectDnD35eActiveEffects`, `dagResult` breakdowns | `TacticalScannerCard`, `DnD35eSheetModal`, HUD Zone 1 & Zone 3, Canvas pips | `console_ui_architecture.test.ts`, `docs/ARCHITECTURE.md`, `docs/MILESTONES.md` |

---

## 4. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Spell duration parsing | `if (spell.id === 'divine_favor') return 10` | Generic formula parser (`parseSpellDurationTurns`) over `spell.duration` string + `metamagic.extend` | **Yes** — any new modded spell uses standard SRD duration notation |
| Buff / debuff / mixed polarity | Hardcoded `BUFF_SPELL_IDS` / `DEBUFF_SPELL_IDS` `Set`s | Derived strictly from `StatModifier.value` signs, `condition` / `ability_harm` units, and `targetRole` | **Yes** — modded bundles auto-classify without `.ts` changes |
| Instantaneous spell lingering conditions | `if (spell.id === 'color_spray') duration = 2` | Optional `duration` property on `'condition'` unit in `DnD35SpellEffectUnitSchema` + named fallback constant | **Yes** — modders set `condition` unit `duration` directly in JSON |
| Weapon `DR/magic` bypass from buffs | `if (hasSpell('magic_weapon')) addBypass('magic')` | Generic `grantedTags` projection (`'weapon:magic'`) from `ActiveStatusEffect` onto `selfTags` -> `bypassTags` | **Yes** — any spell/aura/feat emitting `'weapon:magic'` grants `'magic'` bypass |
| Overlapping spell condition removal | Unconditionally deleting condition ID on expiry | Reference-counting check across remaining `StatusEffectsComponent` entries sharing `linkedConditionId` | **Yes** — works identically for any custom spell pairing |
| HUD alert & auto-pause gating | Checking hardcoded spell/status names | Generic `polarity === 'debuff'` / `campaign.status[id]?.detrimental` predicate | **Yes** — works for all modded statuses and dynamic spells |
| Spatial aura & overlay UI projection | Separate UI loops per spell or form type | Aggregated in `evaluateActiveSpellAuraContributions().activeAuras` & `PropertyOverlayComponent` -> `ActiveEffectDisplayDTO` | **Yes** — any new aura spell or form overlay displays automatically |

---

**STOPPING HERE PER `AGENTS.md` RULE 5:** Please review [docs/implementation_plan.md](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/docs/implementation_plan.md) and confirm if you approve proceeding to implementation.
