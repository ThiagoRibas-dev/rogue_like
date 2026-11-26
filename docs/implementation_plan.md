# Implementation Plan — Unified Faction Reputation Loop & Declarative Thought Catalog

**Status:** Draft (Steps 4–5 of `AGENTS.md` §1) — Awaiting User Approval  
**Research Basis:** [`docs/research_notes.md`](./research_notes.md) & [`docs/EMERGENT_SYSTEMS_INTERACTION.md`](./EMERGENT_SYSTEMS_INTERACTION.md)  
**Confirmed Design Decisions:**
1. Combat/kill standing penalties apply by default **only to non-hostile (`friendly`/`neutral`) faction victims** (opt-in `penalizeHostileFactions: true`), with **`requireWitness: true`** by default (3D LoS & range within active area, plus disguise suspicion handling).
2. **Actor `MemoryComponent.factionStandings[factionId]`** is the canonical Layer 2 reputation map (symmetrical for Player, Companions, NPCs, Legends — never player-only); `trade.ts` and `social.system.ts` combine Layer 2 standing with legacy NPC personal `factionStandings`; `getFactionRelation` (`src/utils/faction.ts`) dynamically transitions to `'hostile'` at `<= hostileStandingThreshold` (`-50` default) and `'friendly'` at `>= friendlyStandingThreshold` (`+50` default), still respecting unblown `IdentityMaskComponent` disguises while personal `grudges` pierce disguises.
3. Retire `classic_combat.ts`'s inline `ATTACK_FACTION_STANDING_PENALTY` (`src/rulesets/classic/classic_combat.ts:35,99-112`) so `classic`, `dnd35e`, spells, projectiles, traps, and `InteractionChain` kills route uniformly through Tier 1 `src/systems/reputation.system.ts`.
4. **Option A (Unified):** Route all 7 Tier 1 thought emitters (`site_materializer.ts`, `needs.system.ts`, `workshop.system.ts`) through a single `resolveConfiguredThought` helper in `src/systems/psychology/thoughts.system.ts` backed by `rules.psychology.thoughtDefinitions` (and optional `MacroSiteDelta.thoughtOverride`), preserving 100% backward-compatible defaults.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Evicted / Superseded Old-Brain |
| :--- | :--- | :--- |
| Reputation defaults & thresholds (`DEFAULT_KILL_STANDING_PENALTY`, `DEFAULT_STANDING_HOSTILE_THRESHOLD`, etc.) | `src/constants/reputation.constants.ts` *(NEW)* | Inline `FRIENDLY_THRESHOLD` / `HOSTILE_THRESHOLD` in `FactionsModal.tsx` and `ATTACK_FACTION_STANDING_PENALTY` in `classic_combat.ts` |
| Effective standing lookup & standing-aware hostility precedence | `src/utils/faction.ts` (`getEffectiveStandingBetween`, `getFactionRelation`) | Inverted-only `shopMemory.factionStandings[buyerFaction]` reads in `trade.ts` & `social.system.ts`; standing-blind `getFactionRelation` |
| Witnessed combat/kill reputation, disguise suspicion, witness grudges & allied ripple | `src/systems/reputation.system.ts` *(NEW)* (`resolveReputationConfig`, `findCrimeWitnesses`, `applyReputationCrime`, `processReputationOnDamageEvents`, `processReputationOnKill`) | Siloed melee-only penalty block in `src/rulesets/classic/classic_combat.ts:99-112` |
| Declarative thought slot catalog & resolution | `src/constants/personality.constants.ts` (`THOUGHT_SLOT_*`, `DEFAULT_THOUGHT_DEFINITIONS`) + `src/systems/psychology/thoughts.system.ts` (`resolveConfiguredThought`) | Hardcoded `'site_raid_trauma'` in `site_materializer.ts:285`, hardcoded `'crafted_item'` in `workshop.system.ts:395`, hardcoded need thought literals in `needs.system.ts:209-243`, and duplicate `SITE_*_TRAUMA_*` constants in `macro_world.constants.ts` |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Faction standing penalties on attack/kill | Hardcoding `if (victimFaction === 'town') standing -= 25` or ruleset-only penalty in `classic_combat.ts` | `ReputationConfigSchema` in `rules.json` (`attackStandingPenalty`, `killStandingPenalty`, `hostileStandingThreshold`, `friendlyStandingThreshold`, `requireWitness`, `witnessRadiusTiles`, `penalizeHostileFactions`, `applyWitnessGrudge`, `alliedFactionRippleRatio`, `disguiseAttackSuspicionGain`, `disguiseKillSuspicionGain`) evaluated against `campaign.factions` matrix | **Yes** — custom factions in `factions.json` work automatically with zero `.ts` edits |
| Standing-based faction hostility | Hardcoding town guard faction IDs to turn hostile | `getFactionRelation` evaluates `getEffectiveStandingBetween` against `rules.reputation?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD` (`-50`) and `friendlyStandingThreshold` (`+50`) for any faction | **Yes** — works for any authored faction and any actor (PC or NPC) |
| Survivor raid/burn trauma thought & mood impact | Hardcoding `thoughtId: 'site_raid_trauma'` and fixed `-22`/`-14` constants in `site_materializer.ts` | `PsychologyRulesConfigSchema.thoughtDefinitions` (`rules.json`) keyed by logical event slot (`site_burned`, `site_raided`, etc.) + optional per-delta `MacroSiteDelta.thoughtOverride`, resolved via `resolveConfiguredThought` | **Yes** — custom campaigns can rename/rebalance trauma thoughts or add per-delta overrides purely in JSON |
| Needs & workshop thoughts (`freezing_cold`, `crafted_item`, etc.) | Hardcoding literal `thoughtId`, `moodDelta`, and `durationTurns` inside `needs.system.ts` & `workshop.system.ts` | Shared `resolveConfiguredThought(state.campaign, THOUGHT_SLOT_*, fallbackSummary)` reading `rules.psychology.thoughtDefinitions` with schema defaults | **Yes** — survival/colony mods can tune every thought in `rules.json` |

---

## 3. Cascading Effects Matrix (`Change | Upstream | Downstream | Lateral`)

| Change | Upstream (Callers, Producers, Schemas) | Downstream (Consumers, Renderers, Saves) | Lateral (Mirrors, Sibling Campaigns, Kits, Docs) |
| :--- | :--- | :--- | :--- |
| **1. `ReputationConfigSchema` & `reputation.constants.ts`** | `RulesConfigSchema` (`src/types/campaign/meta.ts`), `default/rules.json`. | `reputation.system.ts`, `utils/faction.ts`, `FactionsModal.tsx`. All optional with defaults so existing save files & all 5 campaigns remain 100% valid. | `ai-prompt-kit/` regenerated via `generate-ai-prompt-kit.ts`; `docs/guides/MODDING.md`; `docs/ssot/ssot_console.json` & `docs/SSOT_CONSOLE.md`. |
| **2. `getEffectiveStandingBetween` & `getFactionRelation` (`utils/faction.ts`)** | `trade.ts`, `social.system.ts`, `ai.system.ts`, `companion_targeting.ts`, `combat`, `gameplay_input.ts`, `hud_alerts.ui.ts`. | Standing `<= -50` dynamically flips hostility (subject to unblown `IdentityMaskComponent`); standing `>= +50` promotes to `'friendly'` (unless personal `grudges` exist); shop prices & social contests reflect player's Layer 2 standing + NPC personal standing. Existing tests with `standing = 0` unaffected. | `tests/m155_acoustics_light_stealth.test.ts`, `tests/currency_trade_and_campaign.test.ts`, `tests/reputation_standing.test.ts` *(NEW)*. |
| **3. `reputation.system.ts` wired into `state_stabilizer.ts` & `death.system.ts` + eviction from `classic_combat.ts`** | `resolveStateStabilization` (`EntityDamaged` before `processDeathSystem`), `death.system.ts` (before `removeEntity`, after `evaluateCheatDeath`), `classic_combat.ts` (`ATTACK_FACTION_STANDING_PENALTY` removed). | Mutates `attacker`'s `MemoryComponent.factionStandings[victimFaction]` (and optional allied ripple), witness `MemoryComponent.grudges`, and disguised attacker `IdentityMaskComponent.suspicion`; logs player-facing standing change messages. Covers both `classic` & `dnd35e`, spells, traps, projectiles, and `InteractionChain` kills. | `docs/ssot/ssot_console.json` & `docs/SSOT_CONSOLE.md`; `docs/EMERGENT_SYSTEMS_INTERACTION.md`; `docs/DECISIONS.md`. |
| **4. `ThoughtRuleDefinitionSchema` + `resolveConfiguredThought` across `site_materializer.ts`, `needs.system.ts`, `workshop.system.ts`** | `PsychologyRulesConfigSchema` (`meta.ts`), `MacroSiteDelta.thoughtOverride` (`macro_world.types.ts`), `personality.constants.ts`. | `site_materializer.ts`, `needs.system.ts`, `workshop.system.ts`, `thoughts.system.ts`; `MemoryComponent.thoughts` & mood calculations. Default thought IDs & deltas preserved identically when unconfigured. | `public/data/campaigns/default/rules.json` showcase (`psychology.thoughtDefinitions` & `reputation`); `ai-prompt-kit/`; `tests/site_materializer.test.ts`; `docs/guides/MODDING.md`. |

---

## 4. Step-by-Step Implementation Plan & Precise Code Snippets

### Step 1: Reputation & Thought Constants + Zod Schemas

#### 1A. Create `src/constants/reputation.constants.ts` *(NEW)*
```ts
/** Default standing penalty applied when an actor commits a witnessed non-lethal attack on a non-hostile faction member. */
export const DEFAULT_ATTACK_STANDING_PENALTY = 5;

/** Default standing penalty applied when an actor commits a witnessed kill of a non-hostile faction member. */
export const DEFAULT_KILL_STANDING_PENALTY = 25;

/** Default standing threshold at or below which a faction treats an actor as hostile. */
export const DEFAULT_STANDING_HOSTILE_THRESHOLD = -50;

/** Default standing threshold at or above which a faction treats an actor as friendly. */
export const DEFAULT_STANDING_FRIENDLY_THRESHOLD = 50;

/** Default Chebyshev radius (tiles) within which awake non-hostile actors can witness a crime. */
export const DEFAULT_WITNESS_RADIUS_TILES = 10;

/** Default suspicion added to an active `IdentityMaskComponent` when a disguised actor commits a witnessed attack. */
export const DEFAULT_DISGUISE_ATTACK_SUSPICION_GAIN = 50;

/** Default suspicion added to an active `IdentityMaskComponent` when a disguised actor commits a witnessed kill. */
export const DEFAULT_DISGUISE_KILL_SUSPICION_GAIN = 100;

/** Default allied-faction standing ripple multiplier (`0` = disabled unless opted in via `rules.reputation`). */
export const DEFAULT_ALLIED_FACTION_RIPPLE_RATIO = 0;

/** Lower bound clamping per-faction standing values. */
export const MIN_FACTION_STANDING = -1000;

/** Upper bound clamping per-faction standing values. */
export const MAX_FACTION_STANDING = 1000;
```

#### 1B. Extend `src/constants/personality.constants.ts`
Add canonical thought slot keys and default descriptors, while removing the superseded duplicate `SITE_*_TRAUMA_*` constants from `src/constants/macro_world.constants.ts`:
```ts
/** Canonical declarative thought slot keys resolved via `rules.psychology.thoughtDefinitions`. */
export const THOUGHT_SLOT_FREEZING_COLD = 'freezing_cold';
export const THOUGHT_SLOT_SWELTERING_HEAT = 'sweltering_heat';
export const THOUGHT_SLOT_EXHAUSTED = 'exhausted';
export const THOUGHT_SLOT_WELL_RESTED = 'well_rested';
export const THOUGHT_SLOT_UNCOMFORTABLE = 'uncomfortable';
export const THOUGHT_SLOT_CRAFTED_ITEM = 'crafted_item';
export const THOUGHT_SLOT_SITE_RAIDED = 'site_raided';
export const THOUGHT_SLOT_SITE_BURNED = 'site_burned';

/** Default duration (turns) for medium-lived need-driven thoughts. */
export const THOUGHT_DURATION_MEDIUM = 60;

/** Default mood delta, duration, and stack cap for workshop crafting thoughts. */
export const THOUGHT_MOOD_CRAFTED_ITEM = 6;
export const THOUGHT_DURATION_CRAFTED_ITEM = 40;
export const THOUGHT_MAX_STACKS_CRAFTED_ITEM = 2;

/** Default mood deltas, duration, and stack cap for macro-world site raid/burn trauma thoughts. */
export const THOUGHT_MOOD_SITE_BURNED = -22;
export const THOUGHT_MOOD_SITE_RAIDED = -14;
export const THOUGHT_DURATION_SITE_TRAUMA = 120;
export const THOUGHT_MAX_STACKS_SITE_TRAUMA = 2;

/** Default thought descriptor shape mirrored by `ThoughtRuleDefinitionSchema`. */
export interface DefaultThoughtDescriptor {
  readonly thoughtId: string;
  readonly moodDelta: number;
  readonly durationTurns: number;
  readonly maxStacks?: number | undefined;
}

/** Fallback declarative thought definitions used when a campaign does not override a slot in `rules.psychology.thoughtDefinitions`. */
export const DEFAULT_THOUGHT_DEFINITIONS: Readonly<Record<string, DefaultThoughtDescriptor>> = {
  [THOUGHT_SLOT_FREEZING_COLD]: {
    thoughtId: 'freezing_cold',
    moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_SWELTERING_HEAT]: {
    thoughtId: 'sweltering_heat',
    moodDelta: THOUGHT_MOOD_EXTREME_TEMP,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_EXHAUSTED]: {
    thoughtId: 'exhausted',
    moodDelta: THOUGHT_MOOD_EXHAUSTED,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_WELL_RESTED]: {
    thoughtId: 'well_rested',
    moodDelta: THOUGHT_MOOD_WELL_RESTED,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_UNCOMFORTABLE]: {
    thoughtId: 'uncomfortable',
    moodDelta: THOUGHT_MOOD_UNCOMFORTABLE,
    durationTurns: THOUGHT_DURATION_MEDIUM
  },
  [THOUGHT_SLOT_CRAFTED_ITEM]: {
    thoughtId: 'crafted_item',
    moodDelta: THOUGHT_MOOD_CRAFTED_ITEM,
    durationTurns: THOUGHT_DURATION_CRAFTED_ITEM,
    maxStacks: THOUGHT_MAX_STACKS_CRAFTED_ITEM
  },
  [THOUGHT_SLOT_SITE_RAIDED]: {
    thoughtId: 'site_raid_trauma',
    moodDelta: THOUGHT_MOOD_SITE_RAIDED,
    durationTurns: THOUGHT_DURATION_SITE_TRAUMA,
    maxStacks: THOUGHT_MAX_STACKS_SITE_TRAUMA
  },
  [THOUGHT_SLOT_SITE_BURNED]: {
    thoughtId: 'site_raid_trauma',
    moodDelta: THOUGHT_MOOD_SITE_BURNED,
    durationTurns: THOUGHT_DURATION_SITE_TRAUMA,
    maxStacks: THOUGHT_MAX_STACKS_SITE_TRAUMA
  }
};
```

#### 1C. Extend `src/types/campaign/meta.ts`
Add `ThoughtRuleDefinitionSchema`, extend `PsychologyRulesConfigSchema`, add `ReputationConfigSchema`, and attach `reputation: ReputationConfigSchema.optional()` onto `RulesConfigSchema`:
```ts
/** Zod schema for a single declarative situational thought definition in `rules.psychology.thoughtDefinitions`. */
export const ThoughtRuleDefinitionSchema = z.object({
  thoughtId: z.string().min(1),
  moodDelta: z.number().int(),
  stressDelta: z.number().int().optional(),
  durationTurns: z.number().int().positive(),
  maxStacks: z.number().int().positive().optional(),
  summaryTemplate: z.string().min(1).optional()
});
/** Inferred type for a declarative situational thought definition. */
export type ThoughtRuleDefinition = z.infer<typeof ThoughtRuleDefinitionSchema>;

/** Zod schema for optional campaign-level psychology tuning parameters. */
export const PsychologyRulesConfigSchema = z.object({
  needDecayMultipliers: z.record(z.string(), z.number().nonnegative()).optional(),
  moodBreakingThreshold: z.number().int().min(0).max(100).optional(),
  moodInspirationThreshold: z.number().int().min(0).max(100).optional(),
  thoughtDefinitions: z.record(z.string(), ThoughtRuleDefinitionSchema).optional()
});
/** Inferred type for psychology configuration. */
export type PsychologyRulesConfig = z.infer<typeof PsychologyRulesConfigSchema>;

/** Zod schema configuring automatic combat/kill faction reputation feedback and hostility thresholds. */
export const ReputationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  attackStandingPenalty: z.number().int().nonnegative().default(5),
  killStandingPenalty: z.number().int().nonnegative().default(25),
  hostileStandingThreshold: z.number().int().max(-1).default(-50),
  friendlyStandingThreshold: z.number().int().min(1).default(50),
  requireWitness: z.boolean().default(true),
  witnessRadiusTiles: z.number().int().positive().default(10),
  penalizeHostileFactions: z.boolean().default(false),
  applyWitnessGrudge: z.boolean().default(true),
  alliedFactionRippleRatio: z.number().min(0).max(1).default(0),
  disguiseAttackSuspicionGain: z.number().int().nonnegative().default(50),
  disguiseKillSuspicionGain: z.number().int().nonnegative().default(100)
});
/** Inferred type for campaign reputation configuration. */
export type ReputationConfig = z.infer<typeof ReputationConfigSchema>;
```

#### 1D. Extend `src/types/macro_world.types.ts`
Add optional `MacroSiteDeltaThoughtOverride` and attach `thoughtOverride` onto `MacroSiteDelta`:
```ts
/** Optional declarative thought override carried by a `MacroSiteDelta`. */
export interface MacroSiteDeltaThoughtOverride {
  readonly thoughtId?: string | undefined;
  readonly moodDelta?: number | undefined;
  readonly stressDelta?: number | undefined;
  readonly durationTurns?: number | undefined;
  readonly maxStacks?: number | undefined;
  readonly summaryTemplate?: string | undefined;
}
```
And inside `MacroSiteDelta`:
```ts
  readonly thoughtOverride?: MacroSiteDeltaThoughtOverride | undefined;
```

---

### Step 2: Unified Standing Resolution, Hostility Closure & Consumer Reconciliation

#### 2A. Update `src/utils/faction.ts`
Export `getEffectiveStandingBetween(state, observerId, actorId): number` and update `getFactionRelation`:
```ts
/**
 * Computes the effective bilateral standing between an observer entity (e.g., merchant or guard)
 * and a target actor, combining Layer 2 actor-to-faction reputation (`actorMemory.factionStandings[observerFaction]`)
 * with any Layer 3 personal standing override (`observerMemory.factionStandings[actorFaction]`).
 */
export function getEffectiveStandingBetween(
  state: Readonly<GameState>,
  observerId: EntityId,
  actorId: EntityId
): number {
  const observerFaction = (getComponent(state, observerId, ComponentType.Faction) as FactionComponent | undefined)
    ?.factionId;
  const actorFaction = (getComponent(state, actorId, ComponentType.Faction) as FactionComponent | undefined)?.factionId;

  const actorMemory = getComponent(state, actorId, ComponentType.Memory) as MemoryComponent | undefined;
  const observerMemory = getComponent(state, observerId, ComponentType.Memory) as MemoryComponent | undefined;

  const actorReputationWithObserverFaction = observerFaction ? (actorMemory?.factionStandings[observerFaction] ?? 0) : 0;
  const observerPersonalStanding = actorFaction ? (observerMemory?.factionStandings[actorFaction] ?? 0) : 0;

  return actorReputationWithObserverFaction + observerPersonalStanding;
}
```
And inside `getFactionRelation`:
1. Resolve `hostileThreshold = state.campaign.rules.reputation?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD` (`-50`) and `friendlyThreshold = state.campaign.rules.reputation?.friendlyStandingThreshold ?? DEFAULT_STANDING_FRIENDLY_THRESHOLD` (`+50`).
2. Step 1: Subject's intrinsic faction/attitude remains its own state.
3. Step 2: Personal `subjectMemory.grudges` toward `target` (EntityId, `actualTargetFaction`, or `templateId`) returns `'hostile'` immediately (piercing disguises).
4. Compute `baseline = resolveActualBaselineRelation(state, subject, target, subjectFaction, actualTargetFaction)`.
5. Check symmetric Layer 2 standing escalation/promotion:
   - `targetStanding = subjectFaction !== 'neutral' ? (targetMemory?.factionStandings[subjectFaction] ?? 0) : 0`
   - `subjectStanding = actualTargetFaction !== 'neutral' ? (subjectMemory?.factionStandings[actualTargetFaction] ?? 0) : 0`
   - Also factor personal observer standings when one side is `'player'` vs NPC cleanly via `effectiveRelation`:
     - If `targetStanding <= hostileThreshold` or `subjectStanding <= hostileThreshold`: `effectiveRelation = 'hostile'`.
     - Else if `(targetStanding >= friendlyThreshold || subjectStanding >= friendlyThreshold)` and `baseline !== 'hostile'`: `effectiveRelation = 'friendly'`.
     - Else: `effectiveRelation = baseline`.
6. Step 3: If `effectiveRelation === 'friendly'`, return `'friendly'`.
7. Step 4: If `target` has an unblown `IdentityMaskComponent` (`suspicion < maxSuspicion`), evaluate `disguisedFaction` against `campaign.factions[subjectFaction]` — masking both baseline hostility and faction-wide standing hostility (while personal `grudges` in Step 2 still catch them!).
8. Step 5: Return `effectiveRelation`.

#### 2B. Update `src/utils/trade.ts`
Move standing check outside `if (memory)` and replace `memory.factionStandings[buyerFaction.factionId]` with `getEffectiveStandingBetween(state, shopEntityId, buyerEntityId)`:
```ts
  const effectiveStanding = getEffectiveStandingBetween(state, shopEntityId, buyerEntityId);
  if (effectiveStanding !== 0) {
    const standingModifier = -(effectiveStanding / FACTION_STANDING_PRICE_DIVISOR);
    if (standingModifier !== 0) {
      multiplier += standingModifier;
      const pct = Math.round(standingModifier * 100);
      annotations.push(`Standing (${pct >= 0 ? `+${pct}%` : `${pct}%`})`);
    }
  }
```

#### 2C. Update `src/systems/social.system.ts`
Replace lines 56–58 (`playerPower += npcMemory.factionStandings[playerFaction.factionId] ?? 0;`) with:
```ts
  playerPower += getEffectiveStandingBetween(state, npcId, playerId);
```

#### 2D. Update `src/rendering/ui/modals/FactionsModal.tsx`
Replace hardcoded `FRIENDLY_THRESHOLD` / `HOSTILE_THRESHOLD` with `state.campaign.rules.reputation?.friendlyStandingThreshold ?? DEFAULT_STANDING_FRIENDLY_THRESHOLD` and `state.campaign.rules.reputation?.hostileStandingThreshold ?? DEFAULT_STANDING_HOSTILE_THRESHOLD` from `reputation.constants.ts`.

---

### Step 3: Tier 1 Reputation Resolver & Integration

#### 3A. Create `src/systems/reputation.system.ts` *(NEW)*
Pure Tier 1 system with zero hardcoded faction IDs:
- **`resolveReputationConfig(state: Readonly<GameState>)`**: merges `state.campaign.rules.reputation` with constants in `reputation.constants.ts`.
- **`findCrimeWitnesses(state, attackerId, victimId, victimFactionId, isKill, radiusTiles)`**:
  - Resolves `victimPos` (or falls back to `attackerPos` if missing).
  - Scans `state.entities` for living, conscious actors (`Actor` + `Position`, no `Death`, `!shouldSkipTurn(state, candidateId)`):
    - If `!isKill && candidateId === victimId`: qualifies if within `radiusTiles` and has `has3DLineOfSight` (or Chebyshev distance `<= 1`) to `attackerPos`.
    - Otherwise (`candidateId !== attackerId && candidateId !== victimId`): actor faction `wFaction` must align with victim (`wFaction === victimFactionId` or `campaign.factions[wFaction]?.[victimFactionId] === 'friendly'`), be within 3D Chebyshev distance `<= radiusTiles`, and pass `has3DLineOfSight` to either `victimPos` or `attackerPos`.
- **`applyReputationCrime(state: GameState, attackerId: EntityId, victimId: EntityId, isKill: boolean): GameState`**:
  1. Guards: `cfg.enabled`, `attackerId !== victimId`, valid `victimFaction` (`FactionComponent`), valid attacker (`Actor` with `Faction` or `Player`).
  2. Non-hostile baseline gate (`!cfg.penalizeHostileFactions`): skip if `campaign.factions[victimFaction]?.[attackerFaction] === 'hostile'` or `victimAttitude === 'hostile'`.
  3. Witness gate: compute `witnesses = findCrimeWitnesses(...)`; if `cfg.requireWitness && witnesses.length === 0`, return `state`.
  4. Disguise gate (`IdentityMaskComponent` with `suspicion < maxSuspicion`): add `disguiseKillSuspicionGain` or `disguiseAttackSuspicionGain`; if remaining `< maxSuspicion`, update suspicion + log player warning and return without leaking true identity standing/grudges; if blown (`>= maxSuspicion`), log blown-disguise alert and fall through to apply full standing penalty & witness grudges.
  5. Standing update on `attacker`'s `MemoryComponent.factionStandings[victimFaction]` (initializing an empty `MemoryComponent` if attacker lacked one), clamped to `[MIN_FACTION_STANDING, MAX_FACTION_STANDING]`.
  6. Allied faction ripple (`cfg.alliedFactionRippleRatio > 0`): propagate `Math.round(penalty * ratio)` to other non-attacker factions `'friendly'` toward `victimFaction` in `campaign.factions`.
  7. Witness grudges (`cfg.applyWitnessGrudge`): append `String(attackerId)` to each non-dead witness's `MemoryComponent.grudges` (deduplicated).
  8. Player log feedback when attacker is player (showing delta, new standing, and hostility crossing alert).
- **`processReputationOnDamageEvents(state: GameState, startIndex: number): GameState`**:
  - Iterates `state.events.slice(startIndex)` for `GameEventType.EntityDamaged` with `amount > 0`.
  - Resolves `attackerId = event.sourceEntityId ?? event.interaction?.originatorEntityId`.
  - Skips victims already flagged with `ComponentType.Death` (so lethal hits resolve cleanly via `processReputationOnKill` without double-dipping `-5 - 25 = -30`).
  - Deduplicates per `(attackerId, victimId)` within the stabilization pass (e.g. multi-strike Cleave/Full Attack applies one attack infraction per step unless lethal).
- **`processReputationOnKill(state: GameState, victimId: EntityId, killerId: EntityId | undefined): GameState`**:
  - Validates `killerId !== undefined` and delegates to `applyReputationCrime(state, killerId, victimId, true)`.

#### 3B. Wire into `src/core/state_stabilizer.ts`, `src/systems/death.system.ts` & Evict from `src/rulesets/classic/classic_combat.ts`
- **`src/core/state_stabilizer.ts`**:
  ```ts
  const damageEventStart = nextState.events.length;
  nextState = processDamageSystem(nextState);
  nextState = processReputationOnDamageEvents(nextState, damageEventStart);
  nextState = processDeathSystem(nextState);
  ```
- **`src/systems/death.system.ts`** (after `evaluateCheatDeath` and before `removeEntity`, while victim components still exist):
  ```ts
  if (resolvedKillerId !== undefined) {
    nextState = processReputationOnKill(nextState, entityId, resolvedKillerId);
  }
  ```
- **`src/rulesets/classic/classic_combat.ts`**:
  Remove `ATTACK_FACTION_STANDING_PENALTY` (line 35) and lines 99–112 (plus unused `FactionComponent` / `MemoryComponent` imports if unreferenced).

---

### Step 4: Unified Declarative Thought Resolver (Option A)

#### 4A. Add `resolveConfiguredThought` in `src/systems/psychology/thoughts.system.ts`
```ts
/** Optional per-call overrides merged atop campaign and default thought definitions. */
export interface ThoughtResolutionOverrides {
  readonly thoughtId?: string | undefined;
  readonly moodDelta?: number | undefined;
  readonly stressDelta?: number | undefined;
  readonly durationTurns?: number | undefined;
  readonly maxStacks?: number | undefined;
  readonly summaryTemplate?: string | undefined;
  readonly relatedEntityId?: EntityId | undefined;
}

/**
 * Resolves a declarative situational thought from `campaign.rules.psychology.thoughtDefinitions[slotKey]`,
 * falling back to `DEFAULT_THOUGHT_DEFINITIONS[slotKey]` and merging any per-event overrides.
 */
export function resolveConfiguredThought(
  campaign: Readonly<CampaignData>,
  slotKey: string,
  fallbackSummary: string,
  overrides?: ThoughtResolutionOverrides
): AddThoughtInput {
  const configured = campaign.rules.psychology?.thoughtDefinitions?.[slotKey];
  const base = configured ?? DEFAULT_THOUGHT_DEFINITIONS[slotKey];
  const template = overrides?.summaryTemplate ?? configured?.summaryTemplate;
  const eventSummary = template ? template.replace(/\{summary\}/g, fallbackSummary) : fallbackSummary;

  const thoughtId = overrides?.thoughtId ?? base?.thoughtId ?? slotKey;
  const moodDelta = overrides?.moodDelta ?? base?.moodDelta ?? 0;
  const stressDelta = overrides?.stressDelta ?? configured?.stressDelta;
  const durationTurns = overrides?.durationTurns ?? base?.durationTurns ?? THOUGHT_DURATION_MEDIUM;
  const maxStacks = overrides?.maxStacks ?? base?.maxStacks;

  return {
    thoughtId,
    eventSummary,
    moodDelta,
    durationTurns,
    ...(stressDelta !== undefined ? { stressDelta } : {}),
    ...(maxStacks !== undefined ? { maxStacks } : {}),
    ...(overrides?.relatedEntityId !== undefined ? { relatedEntityId: overrides.relatedEntityId } : {})
  };
}
```

#### 4B. Refactor All 3 Tier 1 Emitters (`site_materializer.ts`, `needs.system.ts`, `workshop.system.ts`)
- **`src/systems/map/site_materializer.ts`**:
  ```ts
  const traumaSlotKey = delta.kind === 'site_burned' ? THOUGHT_SLOT_SITE_BURNED : THOUGHT_SLOT_SITE_RAIDED;
  nextState = addTimedThought(
    nextState,
    survId,
    resolveConfiguredThought(nextState.campaign, traumaSlotKey, delta.summary, delta.thoughtOverride)
  );
  ```
- **`src/systems/psychology/needs.system.ts`**: replace all 5 hardcoded `addTimedThought` payloads (`freezing_cold`, `sweltering_heat`, `exhausted`, `well_rested`, `uncomfortable`) with `resolveConfiguredThought(nextState.campaign, THOUGHT_SLOT_*, '...')`.
- **`src/systems/labor/workshop.system.ts`**: replace hardcoded `'crafted_item'` call with `resolveConfiguredThought(nextState.campaign, THOUGHT_SLOT_CRAFTED_ITEM, \`Crafted ${recipe.name}\`)` and remove the 3 duplicate `CRAFTED_ITEM_THOUGHT_*` local constants.

---

### Step 5: Default Campaign Showcase, AI Prompt Kit, SSOT & Docs Sync
1. Update **`public/data/campaigns/default/rules.json`** to showcase both `"reputation"` and `"psychology.thoughtDefinitions"` (`site_burned`, `site_raided`).
2. Regenerate **`ai-prompt-kit/`** via `bun scripts/generate-ai-prompt-kit.ts`.
3. Register `src/constants/reputation.constants.ts` and `src/systems/reputation.system.ts` plus updated canonical exports in **`docs/ssot/ssot_console.json`** and run `bun scripts/map-codebase.ts` to regenerate `docs/SSOT_CONSOLE.md`.
4. Update **`docs/guides/MODDING.md`**, **`docs/EMERGENT_SYSTEMS_INTERACTION.md`**, and **`docs/DECISIONS.md`**.

---

### Step 6: Verification Plan & New Regression Tests

1. **Create `tests/reputation_standing.test.ts` *(NEW)*:**
   - Unwitnessed stealth kill of a non-hostile town NPC (`requireWitness: true`): standing remains `0`, no witness grudges added.
   - Witnessed non-lethal attack on non-hostile town NPC across both **Classic** and **D&D 3.5e**: deducts `attackStandingPenalty` (`-5`), witness adds attacker to `grudges`.
   - Witnessed lethal kill (and multi-hop `InteractionChain` originator kill) on non-hostile town NPC: deducts `killStandingPenalty` (`-25`, not `-30`), adds witness grudges, and crossing `<= -50` causes unwitnessed town guards to become `'hostile'` via `isHostile`.
   - Attacking/killing baseline `'hostile'` monsters leaves standing at `0` when `penalizeHostileFactions: false`, and deducts standing when `penalizeHostileFactions: true`.
   - Disguise (`IdentityMaskComponent`): witnessed attack raises `suspicion` without leaking true identity standing/grudges while `< maxSuspicion`; witnessed kill (`+100`) blows disguise and applies standing loss + grudge; fresh disguise still masks standing-level hostility to guards without personal grudges.
   - Trade & Social reconciliation: `+20` standing with `'town'` reduces merchant buy multiplier and boosts persuasion/intimidation contest score; `-30` standing raises merchant prices.
   - Allied ripple (`alliedFactionRippleRatio: 0.5`) propagates fractional penalty to factions `'friendly'` with the victim's faction.
   - Rule 18 actor symmetry: non-player actor committing witnessed kill loses standing on its own `MemoryComponent.factionStandings`.
2. **Extend `tests/site_materializer.test.ts`:**
   - Custom `rules.psychology.thoughtDefinitions.site_burned` overrides `thoughtId`, `moodDelta`, `durationTurns`, and `summaryTemplate` with zero `.ts` edits.
   - `MacroSiteDelta.thoughtOverride` overrides campaign defaults; custom `needs`/`workshop` slot overrides flow through `needs.system.ts` & `workshop.system.ts`.
3. **Full 8-Stage Verification Pipeline:** Execute `./verify.sh` and confirm 0 errors across all 8 stages.

---

*Awaiting explicit user approval before modifying any codebase files (`AGENTS.md` Rule 5).*
