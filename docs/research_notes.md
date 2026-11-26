# Research Notes — Emergent Reputation / Faction Standing Loop & Declarative `site_raid_trauma`

**Target Tasks:**
1. **Unified Faction Standing / Reputation Feedback Loop** across combat, kills, trade, dialogue, hostility, and UI (`factionStandings`).
2. **Rule 21 Remediation for Hardcoded `'site_raid_trauma'`** (`src/systems/map/site_materializer.ts:285`) via declarative campaign/delta schemas.

**Governing Standards:** [`AGENTS.md`](../AGENTS.md) (§0 Golden Rules 11, 12, 15, 16, 17, 19, 21; §3 TypeScript Strictness; §4 ECS JSON Purity; §5 Data-Driven JSON Rules) and [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) (§2 Core Design Philosophy, §6.4, §7.1–7.4, §9.1–9.3).

---

## 1. Reiteration of Governing Architectural Constraints

- **TypeScript & ECS Strictness:** Zero `any` (Rule 11); `exactOptionalPropertyTypes: true` (never assign `undefined` explicitly to optional fields); exhaustive `switch` (`assertNever`); pure serializable ECS components (`Record`/`ReadonlyArray`, no `Map`/`Set` in `GameState` components).
- **Zero Magic Gameplay Literals (Rule 12):** All thresholds, penalties, radii, mood deltas, and durations affecting gameplay must live in `src/constants/*.ts` or campaign JSON schemas.
- **Three-Tier Console Placement (Rule 16):** Combat reputation feedback belongs in **Tier 1 Console** (`src/systems/` + `src/utils/`) configured by **Tier 3 Campaign JSON** (`rules.json`), never siloed inside one ruleset (`classic_combat.ts`) while ignored in `dnd35e`.
- **Zero Content-ID Branching — Rule 21 ("New Content Mod" Litmus Test):** Engine/cartridge TypeScript code must never branch on literal content IDs (`'town'`, `'bandits'`, `'site_raid_trauma'`) or assume fixed campaign faction names. Any campaign author adding a custom faction or custom trauma/event thought in JSON must get full support with zero `.ts` edits.

---

## 2. Research Findings: Task 1 — Missing & Split-Brain Faction Standing Feedback Loop

### 2.1 Current Inventory of Every Reader & Writer of `factionStandings`

Inspection across `src/` and `public/data/campaigns/` revealed **three compounding bugs / asymmetries** rather than simply one missing hook:

| File & Line | Role | Component Owner & Key | Verified Current Behavior |
| :--- | :--- | :--- | :--- |
| `src/rulesets/classic/classic_combat.ts:35,99–112` | **Writer (Classic Melee Only)** | `attackerMemory.factionStandings[defenderFaction.factionId]` | Hardcodes `ATTACK_FACTION_STANDING_PENALTY = 5`. Subtracts `5` on every Classic melee swing (`attackerMemory` vs `defenderFaction`), **even against already-hostile monsters**, **ignoring witnesses**, and **completely absent from `dnd35e`**, spells, projectiles, traps, and `InteractionChain` kills. |
| `src/systems/quest.system.ts:85–102` | **Writer (Quest Rewards)** | `recipientMemory.factionStandings[reward.factionId]` (`recipientId` = player) | Increments player's `factionStandings[factionId]`. |
| `src/rendering/ui/modals/FactionsModal.tsx:31–78` | **Reader (Player UI)** | `playerMemory.factionStandings[factionId]` | Displays standing for every faction in `state.campaign.factions`: `>= 50` Friendly, `> 0` Amicable, `< 0` Unfriendly, `<= -50` Hostile. |
| `src/systems/reaction.system.ts:250–256` | **Reader (`contextMatcher`)** | `sourceMemory.factionStandings[factionId]` (`sourceEntityId` = actor, usually player) | Gates reactions by source actor's `factionStandings`. |
| `src/utils/trade.ts:215–224` | **Reader (Shop Pricing)** | `shopMemory.factionStandings[buyerFaction.factionId]` | **Inverted owner!** Reads the *merchant NPC's* `MemoryComponent` keyed by `buyerFaction.factionId` (e.g., `'player'`), **ignoring** `playerMemory.factionStandings[shopFaction.factionId]`! (`-standing / FACTION_STANDING_PRICE_DIVISOR`). |
| `src/systems/social.system.ts:56–58` | **Reader (Classic Intimidate/Persuade)** | `npcMemory.factionStandings[playerFaction.factionId]` | **Inverted owner!** Reads NPC's `factionStandings['player']` instead of player's standing with the NPC's faction! |
| `src/systems/trigger/social.ts:27–44` (`faction_standing` condition) | **Reader (Dialogue / Trigger)** | `(_npcEntityId ?? entityId).memory.factionStandings[condition.target]` | In dialogues (`_npcEntityId` injected), reads NPC's `factionStandings[target]`; in global triggers (`entityId` fallback), reads `event.entityId`'s `factionStandings` if `condition.entityId` is unset. |
| `src/systems/trigger/social_consequences.ts:51–65` (`modify_standing`) | **Writer (Triggers / Dialogue / Thresholds)** | `(_npcEntityId ?? entityId).memory.factionStandings[factionId]` | Used in `shroudgarde/relationship_thresholds.json:27` (`_npcEntityId` gets `factionId: "player", amount: 5`) AND in `*/trigger_templates.json:30` (`faction_bounty_reward` on `QuestCompleted`, where neither `_npcEntityId` nor `entityId` exists on `QuestCompletedEvent` unless bound at bake time!). |
| `src/utils/faction.ts:65–106` (`getFactionRelation`) | **Hostility / AI / Combat** | Reads `grudges`, `AttitudeComponent`, `IdentityMaskComponent`, `campaign.factions` | **Never checks `factionStandings`!** Even if `playerMemory.factionStandings['town'] === -200`, town guards stay `'friendly'` (and `FactionsModal` displays `"Hostile (-200)"`). |
| `src/core/ecs/ecs_spawner.ts:137–182` | **Entity Spawner** | `template.memory` | Only attaches `MemoryComponent` if `template.memory` is present in `entities.json` (or created lazily by `thoughts.system.ts`). Note: `player` gets `MemoryComponent` in `bootstrap.ts` / `world_entities_bootstrap.ts`. |

### 2.2 Key Observations & Edge Cases Uncovered

1. **Classic vs. D&D 3.5e Ruleset Gap (`dnd35e_combat_adapter.ts` & `damage_vitality.ts` & `death.system.ts`):**
   - `dnd35e` resolves attacks through `executeCombatStrikeExchange` -> `DamageComponent` -> `resolveStateStabilization` -> `processDeathSystem`. Neither `dnd35e_combat_adapter.ts`, `spell_cast_effects.ts`, nor `death.system.ts` modifies `factionStandings` or adds witness grudges.
   - Moving combat/kill reputation feedback into a **Tier 1 Console subscriber** running inside `resolveStateStabilization` (after `processDeathSystem` emits `EntityDied` / `processDamageSystem` handles damage — or handling `EntityDamaged` & `EntityDied` in `GameState.events`) automatically covers **both `classic` and `dnd35e`**, plus **melee, ranged, spells, traps, and multi-hop `InteractionChain` kills** (`resolvedKillerId = deathComp.killerId ?? deathComp.interaction?.originatorEntityId`).
2. **Existing Test & Campaign Expectations:**
   - **Zero tests currently test `ATTACK_FACTION_STANDING_PENALTY` in `classic_combat.ts`.**
   - `tests/quest_lifecycle.test.ts:171` verifies `quest.system.ts` writes `playerMemory.factionStandings['druids'] === 15`.
   - `tests/currency_trade_and_campaign.test.ts` tests `getEffectivePrice` with `shop` + `Memory` (`trade.ts`). Let's verify exact expectations in `currency_trade_and_campaign.test.ts` before changing `trade.ts`!
   - `public/data/campaigns/*/entities.json` shopkeepers (`bertram`, `merchant`, etc.) already have `"memory": { "factionStandings": {}, ... }` blocks, whereas generic NPCs without `memory` in JSON won't crash if omitted.
3. **Who Should `factionStandings` Track & What Should Happen on Attack/Kill?**
   - **Player Reputation Model:** The player's `MemoryComponent.factionStandings[factionId]` is clearly intended as the canonical Reputation ledger (`FactionsModal.tsx`, `quest.system.ts`, `reaction.system.ts`, `classic_combat.ts`). Meanwhile `npcMemory.factionStandings[playerFaction]` was used locally by `trade.ts`, `social.system.ts`, and `shroudgarde/relationship_thresholds.json`.
   - **Bridging Without Breaking Existing Content:** When `trade.ts` or `social.system.ts` evaluates a buyer/speaker's standing with the NPC's faction, combining/checking **both** `npcMemory.factionStandings[buyerFaction]` (local NPC override/personal standing) and `buyerMemory.factionStandings[npcFaction]` (or keeping personal `relationshipAxes` separate while checking player's `factionStandings[npcFaction]` cleanly) reconciles quest rewards + combat reputation with merchant prices and persuasion/intimidation without breaking `relationship_thresholds.json`!
   - **Baseline Hostility vs. Friendly/Neutral Factions:** Attacking or killing an enemy whose baseline relation (`campaign.factions[killerFaction][victimFaction]`) is **already `'hostile'`** (like a goblin or bandit attacking on sight) should **either** leave standing untouched (or apply a configurable separate rule) so dungeon-crawling monsters doesn't endlessly drop `'monster'` standing unless desired by campaign config — whereas attacking or killing a **non-hostile (`'friendly'` / `'neutral'`)** faction member triggers configurable standing loss (and optionally standing shift for factions allied/hostile to the victim's faction via the `factions.json` matrix!).
   - **Witnesses, Disguises & Stealth Kills:**
     - Using `IdentityMaskComponent` (`suspicion < maxSuspicion`): if the killer wears an unblown disguise (`disguisedAsFactionId`), witnesses either attribute the crime to the disguised faction or blow the disguise (`suspicion = maxSuspicion`), rather than blaming the true faction invisibly.
     - Using witnesses (living non-victim entities in the active area who can see or hear the victim/killer, or area-wide fallback when configurable): stealthy unseen assassinations needn't alert the whole town if `requireWitness: true` is configured, while witnessed murders can trigger local witness grudges/alarm + standing loss!
   - **Closing the Loop (`getFactionRelation`):** In `src/utils/faction.ts`, `resolveActualBaselineRelation` currently checks `AttitudeComponent`, same-faction, and `campaign.factions[a][b]`. If `getFactionRelation` checks `target`'s `factionStandings[subjectFaction]` against a configurable hostility threshold (`DEFAULT_STANDING_HOSTILE_THRESHOLD = -50`, matching `FactionsModal.tsx`!), then killing allies until standing drops `<= -50` causes the surviving faction (guards, shopkeepers, townsfolk) to **turn hostile automatically**! Note: careful guard needed for `IdentityMaskComponent` precedence (if disguised, Step 4 still masks faction-level hostility unless personal grudge exists!).

---

## 3. Research Findings: Task 2 — Hardcoded `'site_raid_trauma'` & Declarative Thought Catalog

### 3.1 Exact Scope & Current Code (`src/systems/map/site_materializer.ts`)

1. At `src/systems/map/site_materializer.ts:284-290`:
   ```ts
   nextState = addTimedThought(nextState, survId, {
     thoughtId: 'site_raid_trauma',
     eventSummary: delta.summary,
     moodDelta: delta.kind === 'site_burned' ? SITE_BURN_TRAUMA_MOOD_DELTA : SITE_RAID_TRAUMA_MOOD_DELTA,
     durationTurns: SITE_RAID_TRAUMA_DURATION_TURNS,
     maxStacks: SITE_RAID_TRAUMA_MAX_STACKS
   });
   ```
2. Paired constants in `src/constants/macro_world.constants.ts:264-274`:
   - `SITE_BURN_TRAUMA_MOOD_DELTA = -22`
   - `SITE_RAID_TRAUMA_MOOD_DELTA = -14`
   - `SITE_RAID_TRAUMA_DURATION_TURNS = 120`
   - `SITE_RAID_TRAUMA_MAX_STACKS = 2`
3. Existing tests checking it: `tests/site_materializer.test.ts:141, 266` explicitly assert `mem?.thoughts?.some((t) => t.thoughtId === 'site_raid_trauma')`.
4. **Sibling Literal `thoughtId`s in Tier 1 Psychology:**
   - `needs.system.ts:209–247`: `'freezing_cold'`, `'sweltering_heat'`, `'exhausted'`, `'well_rested'`, `'uncomfortable'`
   - `workshop.system.ts:395`: `'crafted_item'`
   - Note: Why is `'site_raid_trauma'` especially problematic? Because macro-world deltas are campaign-authored/configured (`rules.macroWorld` + `MacroSiteDelta` + `rules.psychology`)! A campaign author cannot change the thought ID, severity (`moodDelta`), duration, maxStacks, or distinguish custom `site_burned` vs `site_raided` trauma templates without editing `site_materializer.ts`.

### 3.2 Declarative Schema Options (Rule 17 & Rule 21)

1. **`PsychologyRulesConfigSchema` (`src/types/campaign/meta.ts:169–175`)**:
   - Currently supports `needDecayMultipliers`, `moodBreakingThreshold`, `moodInspirationThreshold`.
   - Can add an optional **`thoughtDefinitions`** (or **`thoughts`**) record mapping logical keys/event hooks (`MacroSiteDeltaKind` or generic semantic keys like `'site_burned'`, `'site_raided'`, `'crafted_item'`, `'freezing_cold'`, etc.) to declarative `{ id: string, moodDelta: number, stressDelta?: number, durationTurns: number, maxStacks?: number, summaryTemplate?: string }`.
2. **`MacroWorldConfigSchema` (`src/types/campaign/meta.ts:178–189`) & `MacroSiteDelta` (`src/types/macro_world.types.ts:138–148`)**:
   - `MacroSiteDelta` can carry an optional `thought` override (`thoughtId`, `moodDelta`, `durationTurns`, `maxStacks`) generated by Ring 2 / campaign data when specialized deltas occur.
   - When materializing a delta (`spawnSiteDeltaEffects`), `site_materializer.ts` resolves the thought parameters declaratively in priority order:
     1. Explicit delta override (`delta.thoughtId` / `delta.moodDelta`, etc.)
     2. Campaign data lookup (`campaign.rules.psychology?.thoughtDefinitions?.[delta.kind]` or `campaign.rules.macroWorld?.survivorTraumaThoughts?.[delta.kind]`)
     3. Neutral engine schema fallback descriptor (defined in `macro_world.constants.ts` / Zod `.default(...)`, preserving `'site_raid_trauma'` behavior out-of-the-box for campaigns that omit overrides, OR explicitly configured in `default/rules.json` as showcase!).
   - Extending the same declarative `thoughtDefinitions` registry lookup cleanly to `needs.system.ts` and `workshop.system.ts` (or starting with `site_materializer.ts` and sharing one helper `resolveConfiguredThought`) removes hardcoded magic thought parameters uniformly.

---

## 4. Preliminary Cascading Effects Matrix (`Change | Upstream | Downstream | Lateral`)

| Change | Upstream (Callers, Producers, Schemas) | Downstream (Consumers, Renderers, Saves) | Lateral (Mirrors, Sibling Campaigns, Kits, Docs) |
| :--- | :--- | :--- | :--- |
| **Unified Faction Reputation Resolver (`reputation.system.ts` + `RulesConfig.reputation`)** | `RulesConfigSchema` (`src/types/campaign/meta.ts`); `classic_combat.ts` (remove siloed attack penalty or route through shared resolver); `resolveStateStabilization` (`src/core/state_stabilizer.ts`) consuming `EntityDamaged` & `EntityDied` (`resolvedKillerId` / `InteractionChain`). | `getFactionRelation` (`src/utils/faction.ts`); `trade.ts` (`getEffectivePrice`); `social.system.ts`; `FactionsModal.tsx`; `reaction.system.ts`; `trigger/social.ts` (`faction_standing`); `ai.system.ts` hostility detection; `GameState.events` / `World Ledger`; `tests/m155_acoustics_light_stealth.test.ts` & `currency_trade_and_campaign.test.ts`. | All 5 built-in campaigns (`default`, `dnd35e-crypt`, `megacampaign`, `realms-of-shroudgarde`, `shroudgarde` `rules.json` + `relationship_thresholds.json` + `trigger_templates.json`); `ai-prompt-kit/` (via `generate-ai-prompt-kit.ts`); `docs/ssot/ssot_console.json` + `docs/SSOT_CONSOLE.md`; `docs/guides/MODDING.md`. |
| **Declarative Trauma Thought Config (`PsychologyRulesConfigSchema` / `MacroSiteDelta` + `site_materializer.ts`)** | `PsychologyRulesConfigSchema` / `MacroWorldConfigSchema` (`src/types/campaign/meta.ts`); `MacroSiteDelta` (`src/types/macro_world.types.ts`); `legends_simulator.ts` / `macro_world.system.ts`. | `site_materializer.ts` (`spawnSiteDeltaEffects`); `thoughts.system.ts` (`addTimedThought`); `MemoryComponent.thoughts` + `moodTier`; `NemesisDossierModal` / UI mood tooltips; `tests/site_materializer.test.ts`. | Showcase config in `public/data/campaigns/default/rules.json`; `ai-prompt-kit/` schema contract & default-campaign mirror; `docs/guides/MODDING.md`; `docs/SSOT_CONSOLE.md`. |

---

## 5. Open Design Questions for User Confirmation (Before Implementation Plan)

Per `AGENTS.md` Rule 7 & Workflow Step 3, please confirm your preferences on these architectural choices before I draft `docs/implementation_plan.md`:

1. **Scope of Automatic Standing Changes (Kill vs. Attack, Witnessing & Hostile Factions):**
   - **(A) Recommend:** Trigger standing loss primarily on **killing or attacking non-hostile (`friendly`/`neutral`) faction members** (so fighting already-`hostile` dungeon monsters doesn't pollute faction standings unless a campaign opts in via `rules.reputation.penalizeHostileFactions: true`). Do you want combat standing penalties gated on non-hostile victims by default, and should **witnesses** (visible/audible allies or area-wide) be required when `requireWitness` is enabled?
2. **Reputation Storage Ownership & Hostility Threshold (`getFactionRelation`):**
   - **(A) Recommend:** Standardize **player's `MemoryComponent.factionStandings[factionId]`** as the SSOT for faction-wide reputation (matching `FactionsModal.tsx` and `quest.system.ts`), update `trade.ts` and `social.system.ts` to factor in the buyer/speaker's `factionStandings[npcFaction]` alongside any NPC-personal `npcMemory.factionStandings[buyerFaction]`, and update `getFactionRelation` so dropping a faction's standing below `hostileStandingThreshold` (default `-50`, matching `FactionsModal.tsx`) flips that faction's hostility relation to `'hostile'` (still overridden if the subject wears an unblown disguise `IdentityMaskComponent`). Agree?
3. **Should Classic Combat's Siloed `-5` Per Hit Be Replaced by the Shared Console System?**
   - **(A) Recommend:** Yes — remove the ad-hoc `ATTACK_FACTION_STANDING_PENALTY` block in `src/rulesets/classic/classic_combat.ts` so both `classic` and `dnd35e` (and spells/projectiles/`InteractionChain` kills) flow uniformly through the Tier 1 Console reputation resolver.
4. **Scope of Declarative Thought Definitions:**
   - **(A) Recommend:** Add declarative `thoughtDefinitions` inside `PsychologyRulesConfigSchema` (`rules.psychology`, keyed by logical event key such as `'site_burned'`, `'site_raided'`, and optionally reusable for `'crafted_item'`, `'freezing_cold'`, etc.) plus optional `thought` overrides on `MacroSiteDelta`, keeping schema defaults so campaigns without `rules.psychology.thoughtDefinitions` still work cleanly while showcasing custom definitions in `public/data/campaigns/default/rules.json`. Should we refactor only `site_materializer.ts` now, or resolve all 7 `thoughtId`s (`site_materializer`, `needs.system.ts`, `workshop.system.ts`) through the shared `resolveConfiguredThought` helper?
