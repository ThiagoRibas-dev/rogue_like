# Research Notes — Phase 40 Audit Remediation (Post-`4357b54`: Economy, Haggling, Dialogue Routing, Hydration, Boss Drops & Flagship Campaign)

## 1. Architectural Standards & Constraints Baseline

Reviewed against `AGENTS.md` and `docs/ARCHITECTURE.md`:

- **TypeScript Strictness (Rules 11–14):** Zero `any` / `as never` type-safety bypasses, `exactOptionalPropertyTypes: true` compliance (omit unset optional properties), explicit return types on all functions, flat control flow with early returns, exhaustive `switch` statements (`assertNever`), and named constants/enums for every gameplay-affecting literal (no magic values).
- **ECS & Data Purity (Section 4 & Rule 21):** Plain serializable objects/arrays in ECS components (no `Map`/`Set` in `GameState` components), Zod schemas mirroring runtime switches (`z.discriminatedUnion`), and zero Tier 3 content-ID branching in `.ts` engine/cartridge files ("New Content Mod" Litmus Test).
- **Three-Tier Placement (Rule 16) & 4-Layer Decision Matrix (Rule 19):**
  - **Tier 1 (Console):** Agnostic currency arithmetic (`src/systems/currency.system.ts`), trade pricing caps/mechanics (`src/utils/trade.ts`, `src/systems/shop.system.ts`), dialogue/trigger evaluation (`src/systems/trigger/`, `src/actions/dialogue.actions.ts`), and entity spawn/death drop mechanics (`src/core/ecs/`, `src/systems/death.system.ts`).
  - **Tier 2 (D&D 3.5e Cartridge):** D&D 3.5e skill haggle/dialogue evaluation (`src/rulesets/dnd35e/skills/trade_social_checks.ts`), spawn statblock/CR hydration (`src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`), template CR adjustment (`src/rulesets/dnd35e/templates.ts`), DMG Table 2-6 XP math (`src/rulesets/dnd35e/progression/cr_xp_table.ts`), and starting package purse hydration (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`).
  - **Tier 3 (Data & Generators):** Campaign JSON & generator (`scripts/build-realms-of-shroudgarde.ts`, `public/data/campaigns/realms-of-shroudgarde/`) and parity mirrors (`ai-prompt-kit/`).

---

## 2. Directly Verified Audit Findings (Root Causes & Code Interactions)

### B1. Infinite Gold Arbitrage Loop in Shop Pricing (`src/utils/trade.ts`, `src/systems/shop.system.ts`)
- **Evidence:**
  - `src/utils/trade.ts:181-185`:
    - `finalBuyMultiplier = Math.max(MIN_TRADE_MULTIPLIER, multiplier)` where `MIN_TRADE_MULTIPLIER = 0.1`.
    - `finalSellMultiplier = Math.max(MIN_SELL_TO_SHOP_MULTIPLIER, (BASE_SELL_TO_SHOP_MULTIPLIER + sellMultiplierBonus) * (1 / finalBuyMultiplier))` with `BASE_SELL_TO_SHOP_MULTIPLIER = 0.25` and `MIN_SELL_TO_SHOP_MULTIPLIER = 0.05`.
    - `finalSellMultiplier` has **no upper cap** and **no coupling constraint** keeping resale below purchase price.
  - When stacked discounts (`helpful` `-0.15`, Diplomacy `-0.1`, `sessionMarkupModifier` `-0.4`, `grateful` `-0.25`, standing/loyalty) push `finalBuyMultiplier` to `0.1`, `finalSellMultiplier` spikes to `0.25 / 0.1 = 2.5x` (or `(0.25 + 0.15) / 0.1 = 4.0x` with Appraise's `sellMultiplierBonus = 0.15` at `src/rulesets/dnd35e/skills/trade_social_checks.ts:74-78`). Players can buy any item at `10%` value and immediately sell it back to the same merchant for `250%–400%`.
  - Meanwhile `executeSellItem` (`src/systems/shop.system.ts:164-185`) omits the `!itemDef.currencyGrant` guard enforced in `src/rendering/ui/trade.ui.ts:187`, and adds currency out of thin air (`executeBuyItem` at `shop.system.ts:77-80` credits `shopInv`, whereas merchants in existing campaigns spawn with `0` `currencyBalance`, so requiring `shopInv >= sellPrice` would break selling unless merchants are seeded with gold—meaning the pricing invariant `finalSellMultiplier <= finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO` is the canonical fix).

### B2 & B6. Silent `MemoryComponent` Drops on `realms-of-shroudgarde` Merchants + Infinite Risk-Free Haggling
- **Evidence (B6 — Missing `MemoryComponent`):**
  - Searching `public/data/campaigns/realms-of-shroudgarde/entities.json` reveals **zero** `"memory"` declarations (whereas `public/data/campaigns/default/entities.json` declares `"memory"` on NPCs/merchants).
  - `src/core/ecs/ecs_spawner.ts:135` only attaches `MemoryComponent` `if (template.memory)`, and line `281` only creates a fallback `MemoryComponent` for `templateId === 'player'`.
  - Consequently, all 6 merchants in `realms-of-shroudgarde` (`barkeep_bertram`, `dwarf_laurent`, `isabelle_cleric`, `luc_ranger`, `silas_merchant`, `archmage_alden`) spawn **without** `MemoryComponent`.
  - `src/rulesets/dnd35e/skills/trade_social_checks.ts:109-212` gates `sessionMarkupModifier` and `annoyedDuration` updates on `if (npcMemory)`, `src/systems/shop.system.ts:245` rejects Console haggle (`'They refuse to haggle.'`), `src/systems/shop.system.ts:95,197` skips `timesTraded`, and `src/systems/trigger/social_consequences.ts:313-314` (`modify_session_markup`) returns `state` unchanged when `!memory`. Thus every trade haggle and dialogue discount (`bertram_trade_tree`, `laurent_smith_tree`, `isabelle_healer_tree`, `silas_gem_merchant_tree`, `alden_mage_tree`) logs success text while **silently doing nothing** to prices.
- **Evidence (B2 — Infinite Risk-Free Haggling & Uncapped Dialogue Retries):**
  - `src/rulesets/dnd35e/skills/trade_social_checks.ts:113-127` (`case 'appraise'`): Success subtracts `0.1` (`APPRAISE_MARKUP_DISCOUNT`), failure leaves `nextState = state` with zero penalty or attempt lock, and neither `appraise`, `diplomacy`, `bluff`, nor `intimidate` records a per-NPC attempt guard. Players can click `Appraise` or `Diplomacy` repeatedly to reach `-0.4` session markup risk-free (and Console fallback in `shop.system.ts:227-270` also has no retry lock).
  - `public/data/campaigns/realms-of-shroudgarde/dialogues.json` (and `scripts/build-realms-of-shroudgarde.ts:1058-1278`):
    - `guard_captain_tree`: `node_diplo_pass` tells the player *"Take this Guard Signet"* even though `shroudgarde_signet` exists in `items.json` (`build-realms-of-shroudgarde.ts:279`), yet `opt_accept_signet` only runs `set_attitude: 'friendly'`. Both `node_diplo_fail` and `node_intim_fail` link `"nextNodeId": "root"` with no `not_has_fact`/`set_fact` guard, allowing infinite immediate retries.
    - `bertram_trade_tree`: `node_appraise_win` (`modify_session_markup: -0.15`) and `node_bluff_win` (`modify_currency: 50`, despite text promising *"a fresh loaf of crusty bread on the house!"* while `ration_fresh_bread` exists at line `281`) have no `not_has_fact`/`set_fact` guard, allowing infinite repeats across dialogue re-entry. Same repeat issue applies to `laurent_smith_tree`, `isabelle_healer_tree`, `silas_gem_merchant_tree`, and `alden_mage_tree`.
  - Checking `src/types/trigger.types.ts:118-353` confirms `ConsequenceActionSchema` does not yet include a `give_item` consequence (`spawn_entity` drops at world position via `systemic_entity.ts:161`, not into actor inventory), so adding a declarative `give_item` consequence cleanly enables `guard_captain_tree` (`shroudgarde_signet`) and `bertram_trade_tree` (`ration_fresh_bread`).

### B3. Orphaned / Unobtainable Quests in `realms-of-shroudgarde`
- **Evidence:**
  - `public/data/campaigns/realms-of-shroudgarde/quests.json` defines 6+ quests (`quest_cleanse_crypts`, `quest_investigate_trance`, `quest_caves_of_chaos`, `quest_watchtower_defense`, `quest_gem_appraisal`, `quest_slay_dragon_pyroclast`), all referencing real area IDs and entity IDs (`dungeon_1`, `skeleton`, `elena_scholar`, `marsh_mirrored`, `ravine_chaos`, `ogre_chieftain`, `silas_merchant`, `crypt_arch_curate`, `red_dragon`).
  - Grepping `public/data/campaigns/realms-of-shroudgarde/` confirms **zero** `grant_quest` consequences exist in `dialogues.json`, and `triggers.json` is `{}` (`3` bytes). None of these quests are ever granted to the player.

### B4. Dialogue `skill_check` Drops Cartridge `state` & Misses Self-Loop Transitions
- **Evidence:**
  - `src/types/ruleset.types.ts:445-452`: `DialogueSkillCheckResult` explicitly declares `readonly state: GameState`.
  - `src/rulesets/dnd35e/skills/trade_social_checks.ts:243-255`: `evaluateDnD35eDialogueSkillCheck` calls `addMessage(state, `${breakdown} — ${check.success ? 'Success!' : 'Failed.'}`, ...)` and returns it in `result.state`.
  - `src/systems/trigger/social_consequences.ts:335-359`: `let nextState = addMessage(state, checkResult.breakdown, MessageLogCategory.System);` passes `state` instead of `checkResult.state` (or if `rulesetResult` is present, logs `checkResult.breakdown` on top of unmodified `state`, dropping the `Success!` / `Failed.` suffix).
  - `src/actions/dialogue.actions.ts:87-92`: `consequenceRoutedNodeId` detects whether a consequence routed dialogue by checking `activeDialogue.currentNodeId !== preConseqNodeId`. If `skill_check` routes `onFailureNodeId` back to `preConseqNodeId`, `consequenceRoutedNodeId` evaluates to `undefined`, falling back to `option.nextNodeId` (closing dialogue if unset).

### B5. Stale `ai-prompt-kit` Parity Mirror
- **Evidence:** Running `bun run scripts/run-validator.ts --campaign realms-of-shroudgarde` passes all 5 campaigns, 779 ruleset files, and 477 SSOT files, but exits with code `1` because `ai-prompt-kit/default-campaign/entities.json` differs from `public/data/campaigns/default/entities.json`. Needs regeneration via `bun scripts/generate-ai-prompt-kit.ts`.

### M1. Polluted `npcWisMod` & Inconsistent Dialogue Intimidate DC (`src/rulesets/dnd35e/skills/trade_social_checks.ts`)
- **Evidence:**
  - Line `199`: `const npcWisMod = npcSenseCheck.totalModifier - npcSenseCheck.wholeRanks - npcSenseCheck.synergyBonus;` fails to subtract misc/feat/racial/status modifiers (e.g., *Alertness*, *Skill Focus: Sense Motive*, shaken), corrupting `resolveDemoralizeCheck` DC (`10 + HD + Wis`). Should read `(evaluateDnD35eEntityDAG(state, npcId)?.dagResult.effectiveAbilityModifiers.wis ?? computeAbilityModifier(...))` directly.
  - Line `236-239`: In `evaluateDnD35eDialogueSkillCheck`, when `dc <= 0 && npcId !== undefined && (skillId === 'bluff' || skillId === 'intimidate')`, both use `10 + npcSenseCheck.totalModifier`. While Sense Motive opposes Bluff (`10 + Sense Motive` or opposed roll), D&D 3.5e Intimidate-to-demoralize/coerce uses `10 + target HD + target Wis modifier` (`resolveDemoralizeCheck`), matching `resolveDnD35eTradeSocialSkill`.

### M2. Unequipped Boss Gear, `cp`-Scale Boss Drops & Balor-Proxy Zuggtmoy (`scripts/build-realms-of-shroudgarde.ts`)
- **Evidence:**
  - `src/core/ecs/ecs_spawner_equipment.ts:151`: `if (entry.equipSlot && updatedSlots.length > 0)` skips auto-equipping whenever `equipSlot` is omitted.
  - `scripts/build-realms-of-shroudgarde.ts` omits `equipSlot` on `defaultEquipment` for `constable_derek` (`L716`), `dwarf_laurent` (`L753`), `isabelle_cleric` (`L772`), `luc_ranger` (`L791`), `archmage_alden` (`L828`), `town_guard` (`L864`), `lareth_the_beautiful` (`L904`), `crypt_arch_curate` (`L945`), and `ogre_chieftain` (`L966`).
  - `lareth_the_beautiful` (`L905`), `zuggtmoy_queen` (`L925`), `red_dragon` (`L988`), and high-CR bestiary entries (`L1046`) declare `currencyDrop.denominationId: 'cp'` with amounts up to `300,000 cp`, dropping absurd single stacks of `copper_coin` instead of `gp`/`pp` (and beasts like `giant_rat`, `giant_spider`, `dire_wolf`, `owlbear` and mindless `skeleton`/`zombie` drop coin purses at `chance: 1`).
  - `zuggtmoy_queen` (`L919`) specifies `archetypeId: 'balor'`, giving the Demon Queen of Fungi Balor combat traits and CR 20 override over her `fighter.xpGiven: 5000` (check if a better fungus/demon archetype or explicit `rulesetData` makes more sense without creating bespoke content outside rules, e.g., adjusting `rulesetData.cr` or choosing an accurate SRD base + explicit `cr` if intended—note `resolveDnD35eEntityCr` respects `template.rulesetData.cr` first!).

### M3. Template CR Ignored by Spawn Hydration Order (`src/rulesets/dnd35e/templates.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`)
- **Evidence:**
  - `src/rulesets/dnd35e/types/system/creature_system.types.ts:81` (`DnD35TemplateHdTierSchema.crAdjustment`) exists, and `DnD35TemplateSchema` does not carry top-level `crAdjustment` or compute `cr` inside `applyCreatureTemplate` (`src/rulesets/dnd35e/templates.ts:308-325`).
  - `dnd35e_spawn_hydrator.ts:124-127` sets `explicitCr = rawRulesetData?.['cr'] ?? resolvedCr` *after* `applyCreatureTemplate`, overwriting any template CR adjustment with the base archetype's `resolvedCr`.
  - Supporting optional declarative `crAdjustment` (plus HD-tier `crAdjustment` matching the applied HD tier in `applyCreatureTemplate`) allows `dnd35e_spawn_hydrator.ts` to compute `effectiveCr = rawRulesetData?.cr ?? dndData.cr ?? resolvedCr`, reserving `rawRulesetData.cr` as an explicit campaign override while letting templates adjust base `resolvedCr`.

### M4. Coarse Coin-Item Drop Rounding & Orphaned Entities (`src/systems/death.system.ts`)
- **Evidence:**
  - `src/systems/death.system.ts:250-252`: `const charges = Math.max(1, Math.round(amount / denomUnitAmount));` rounds up to `1` even if `amount < denomUnitAmount / 2`, inflating a small drop (e.g. `10 gp` if only a `50 gp` pouch exists for `'gp'`) to `50 gp` on pickup (`inventory.system.ts:95`). Splitting via `decomposeToCoins` when `denomUnitAmount > amount` or converting to smaller denominations prevents inflation, and clamping/handling `charges` cleanly ensures accurate drop amounts.
  - `src/systems/death.system.ts:185-203, 333`: Dead actors' `no_drop` items and `ShopComponent.inventory` items are left in `state.entities`/`state.components` without an owner or `PositionComponent` when `removeEntity(nextState, entityId)` deletes the actor. Calling `removeEntity` cleanly on `no_drop` items and unpositioned `ShopComponent.inventory` items keeps `GameState` leak-free immediately (without waiting for save-time orphan pruning).

### A1–A3. Strict TS, Magic Values & Campaign Completeness Hygiene
- **Rule 11:** Remove `as never` in `dnd35e_spawn_hydrator.ts:119` (fix/type `applyCreatureTemplate` options parameter cleanly to match `DnD35SystemContent | Record<string, unknown> | undefined`) and remove `as any` in `tests/currency_trade_and_campaign.test.ts:109, 243`.
- **Rule 12:** Replace inline numeric literals in:
  - `src/rulesets/dnd35e/skills/trade_social_checks.ts`: `APPRAISE_RESALE_BONUS_HIGH = 0.15`, `APPRAISE_RESALE_BONUS_LOW = 0.08`, `DIPLOMACY_HAGGLE_DC_HIGH = 20`, `DIPLOMACY_HAGGLE_DC_STANDARD = 15`, `SENSE_MOTIVE_PASSIVE_BASE = 10`, `MAX_TRADE_ATTEMPT_FACT_PREFIX`
  - `src/systems/shop.system.ts`: Console fallback thresholds (`CONSOLE_APPRAISE_DC_PERCENT = 45`, `CONSOLE_HAGGLE_DC_PERCENT = 50`, `CONSOLE_HAGGLE_DISCOUNT_DELTA = -0.15`, `CONSOLE_HAGGLE_PENALTY_DELTA = 0.15`, `CONSOLE_MIN_SESSION_MARKUP = -0.35`, `CONSOLE_MAX_SESSION_MARKUP = 0.5`)
  - `src/rulesets/dnd35e/progression/cr_xp_table.ts`: `DMG_MIN_FRACTIONAL_CR_XP_ECL_1_TO_3 = 10`, `DMG_ODD_UP_MULTIPLIER = 1.5`, `DMG_ODD_DOWN_MULTIPLIER = 2 / 3`
  - `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts:231, 243`: Use `toBaseUnits(equipPkg.startingGoldGp, 'gp', resolveCurrencyConfig(runningState))` instead of hardcoded `* 100`.
- **Rule 5 / Missing Campaign Showcase Elements (`realms-of-shroudgarde`):** Wire `quests.json` grants into `dialogues.json`, seed merchant `memory` objects, fix `equipSlot` & `currencyDrop` denominations, add `rumor_propagation.json` / `triggers.json` showcase hooks if straightforward, and investigate the `(1 missing file(s) used fallbacks)` report in `run-validator.ts` (note `default` also reports `1 missing file(s)`—verify whether that is an optional file in `loader.ts` like `keybinds` or similar, not an error).

### S1–S5. Second-Pass SSOT, Duplication & Hardcoding Audit Findings
- **S1 — Tier 1 `trade.ui.ts:39,265-270` Hardcodes `rulesetId === 'dnd35e'` (Rule 16 / Rule 21 Violation):**
  `const isDnd = getActiveRuleset(state).id === 'dnd35e'` decides whether `Appraise`, `Bluff (Haggle)`, and `Diplomacy` buttons render. Any other ruleset implementing `resolveTradeSocialSkill` is silently hidden in UI. Must be declared via `RulesetContract.getTradeSocialActions?()`.
- **S2 — Duplicated `npcWisMod` Bug & Split-Brain `sessionMarkupModifier` (`social_combat_skill_verbs.ts:71,110,129`, `social.system.ts:95,103`):**
  `social_combat_skill_verbs.ts:110` duplicates the exact `targetSenseCheck.totalModifier - wholeRanks - synergyBonus` subtraction bug (ignoring feat/racial/fear modifiers), and both `social_combat_skill_verbs.ts` and `social.system.ts` flatly overwrite `sessionMarkupModifier` (`-0.2`/`+0.2`) instead of sharing clamped adjustment + DAG Wis helpers.
- **S3 — Quest Item Rewards Bypass Currency Absorption & Duplicate Inventory Logic (`src/systems/quest.system.ts:70-104`):**
  `QUEST_REWARD_APPLIERS.item` loops `spawnItem` `count` times without checking `itemDef.currencyGrant`. Completing `quest_cleanse_crypts` (`50x silver_coin`) or `quest_slay_dragon_pyroclast` (`50x platinum_coin`) fills all 14 inventory slots with unabsorbed coin entities and dumps 36+ coins on the floor. Extracting `absorbCurrencyItemGrant` (`currency.system.ts`) + `grantItemToActorInventory` (`inventory.system.ts`) gives `pickup`, `quest.system.ts`, and `give_item` a single point of entry.
- **S4 — `death.system.ts:240-244` Ignores `CurrencyDenomination.itemId`:**
  `dropCurrencyBucket` linearly scans `campaign.items` instead of resolving `findCurrencyDenomination(currencyCfg, denominationId)?.itemId` first via `resolveCurrencyItemDefinition` in `currency.system.ts`.
- **S5 — Tier 1/UI Currency Unit Hardcoding (`dnd35e_ui_adapter.ts:112`, `console_inventory.ui.ts:286`):**
  `dnd35e_ui_adapter.ts:112` divides by hardcoded `DND35E_CP_PER_GP` instead of calling `convertCurrency`; `console_inventory.ui.ts:286` appends hardcoded `' gp'` in its fallback label.

### T1–T2. Third-Pass World Spawning & Class-Level CR Audit Findings
- **T1 (CRITICAL CAMPAIGN BLOCKER) — Zero `placedEntities` in `realms-of-shroudgarde/areas.json` (`build-realms-of-shroudgarde.ts`, `map_generation_spawner.ts:122-154`):**
  Unlike `dnd35e-crypt` and `shroudgarde`, `build-realms-of-shroudgarde.ts` never attaches `placedEntities` to any of its 75 areas—so all 8 named NPCs/merchants (`constable_derek`, `barkeep_bertram`, `dwarf_laurent`, `isabelle_cleric`, `luc_ranger`, `silas_merchant`, `archmage_alden`, `elena_scholar`) and 4 of 5 named bosses (`lareth_the_beautiful`, `zuggtmoy_queen`, `crypt_arch_curate`, `ogre_chieftain`) never spawn in the world. Additionally, `map_generation_spawner.ts:122-154` places `placedEntities` at literal `(ent.x, ent.y)` without checking tile walkability on procedural (`digger`/`cellular`/`dla`) maps.
- **T2 (CRITICAL TIER-2 BUG) — `hydrateRaceAsArchetype` Ignores PC Class Levels & Stacked Class CR (`src/rulesets/dnd35e/archetype/race_hydrator.ts:156-158`):**
  Ignores `'pc'`/`'prestige'` tracks (`human + cleric 7` becomes CR `1`) and short-circuits on `raceDef.cr` (`ghoul + cleric 9` becomes CR `1`, `orc + fighter 5` becomes `0.5`). Must add PC + NPC class CR contributions whenever `options?.classLevels` are hydrated.

### F1–F4. Fourth-Pass Runtime Accessibility, Town Safety & Guardrail Audit Findings
- **F1 (CRITICAL GAME-BREAKING BUG) — `open_barter` Ignores `_npcEntityId` (`src/systems/trigger/systemic.ts:173-195`):**
  `dialogue.actions.ts:67-75` constructs `DialogueSelectedEvent` (`{ type, dialogueId, optionId }`, no `targetId`) and injects `_npcEntityId` onto each consequence. `systemicConsequences.open_barter` only checks `consequence.targetId` or `'targetId' in event`, so `npcId` resolves to `undefined` on every dialogue `open_barter` option (`bertram_trade_tree`, `laurent_smith_tree`, `isabelle_healer_tree`, `luc_scout_tree`, `silas_gem_merchant_tree`, `alden_mage_tree`)—meaning **none of the 6 shops in `realms-of-shroudgarde` can ever open**. It also fails to clear `activeDialogue: undefined` or verify `ComponentType.Shop`.
- **F2 (CRITICAL STARTING AREA HAZARD) — Town Tag Collision with `frontier_beasts` (`realms-of-shroudgarde/areas.json`, `director_zone.ts:143`):**
  `director_zone.ts:143` matches `spawnPools` via `.some((t) => effectiveAreaTags.includes(t))`. Because `shroudgarde_courtyard` (player start), `shroudgarde_gate`, and `orlane_east` carry `"outdoor"`/`"frontier"` tags alongside `"town"`, `frontier_beasts` (`bandit`, `dire_wolf`, `owlbear`, `giant_rat`) spawns inside safe starting towns on Turn 1. Outdoor lighting belongs on `AreaDefinition.environmentType: "outdoors"`, not `"outdoor"` tag.
- **F3 — Encounter Director Requires `crCost` & `roleTags` on All Spawn Pool Monsters (`director_zone.ts:149`):**
  `if (!template || template.crCost === undefined) continue;` silently skips any pool entry lacking `crCost`. All new Option 1 CR `6–17` monsters must declare `crCost` + `roleTags` compatible with deep area `crBudget` values.
- **F4 — `NaN` Wallet Guard (`currency.system.ts:199-225`) & Missing Observability Annotations (`trade.ts:146-164`):**
  `addEntityCurrency` / `setEntityCurrencyBalance` lack `!Number.isFinite(...)` guards (`NaN < 0` is `false`, risking `currencyBalance: NaN` corruption), and `trade.ts:146-164` modifies `multiplier` via `facets` and `relationshipAxes` without pushing explanatory strings to `annotations`.

### V1–V2. Fifth-Pass Lighting, Environment & Identification Spoiler Audit Findings
- **V1 — Missing `environmentType` on All 75 Areas in `realms-of-shroudgarde/areas.json` (`build-realms-of-shroudgarde.ts`, `map_wake_respawn.ts:76`):**
  All 75 generated areas omit `AreaDefinition.environmentType` (`outdoors` / `indoors` / `underground`), preventing the world clock day/night sunlight phases and underground darkness profiles from taking effect properly.
- **V2 — Trade UI / Sell Spoilers & Duplicated Identification Lookup (`trade.ui.ts:130,200`, `shop.system.ts:205`, `inventory.system.ts:89-91`):**
  `ecs_core.ts:187-200` (`resolveEntityDisplayName`) is the canonical SSOT that masks `unidentifiedName` via `state.identifiedItems` / `state.itemUnidentifiedNames`. However, `inventory.system.ts:89-91` re-implements the check inline, while `trade.ui.ts:200` and `shop.system.ts:205` print `def.name` directly for player-carried unidentified items in the Trade/Sell pane, spoiling unidentified potions/scrolls/rings.

### X1–X3. Sixth-Pass Live Modal Mounting, Reactivity & RTwP Dispatch Audit Findings
- **X1 (CRITICAL SHOWSTOPPER) — `renderTradeUI` Never Mounted in `src/rendering/presenter.ts`:**
  `renderTradeUI` (`src/rendering/ui/trade.ui.ts:22`) is never imported or called anywhere (`src/rendering/presenter.ts:203-215` omits it completely, and no `#trade-overlay` container is managed in the DOM). Opening `UIMode.Trade` hides Dialogue and renders nothing.
- **X2 (CRITICAL UI REACTIVITY BUG) — `PresentationQueue` Never Dirties `Modals` on Trade Updates (`src/core/presentation_queue.ts:248-253`):**
  `markDirtyFromStateDiff` only dirties `Modals` on component changes for `UIMode.CartridgeModal` and `UIMode.Inventory`, omitting `UIMode.Trade`. Buying, selling, or haggling leaves `activeTrade` reference unchanged, so the modal does not re-render purse, stock, or prices.
- **X3 (CRITICAL RTwP / TURN BUG) — Trade Actions Omit `isImmediate: true` (`trade.ui.ts`, `dnd35e_turn_budget.ts:285-287`):**
  Buy, Sell, and Trade Social buttons omit `isImmediate: true` (unlike `dialogue.ui.ts:179` and `CloseTrade`), stalling in the input queue whenever RTwP is paused (`game-loop.ts:113-119`). Furthermore, `dnd35e_turn_budget.ts:285-287` calls `clearBudgetAndEndRound` when round actions are already exhausted instead of always returning `{ state, energyCost: 0 }` during `UIMode.Trade`.

### P7. Seventh-Pass Trade Modal CSS & Persistence Check
- **P7-1 (CRITICAL UI VISIBILITY BUG) — Non-Existent CSS Variables `--panel-bg` / `--panel-fg` in `src/rendering/ui/trade.ui.ts:48-49, 135`:**
  `src/styles/core.css` defines `--bg-card` (`#16181f`), `--bg-console` (`#121419`), `--text-main` (`#e2d9c8`), and `--border-color` (`#3d4350`). Neither `--panel-bg` nor `--panel-fg` exists anywhere in `src/` or `index.html`, causing the Trade overlay to render with a transparent background and broken foreground styling once mounted.
- *(Verified clean in Pass 7: `save.ts` `pruneOrphanEntities` and `map.system.ts` `processChangeAreaIntent` both traverse `ShopComponent.inventory` cleanly via `collectOwnedEntityIds`.)*

### P8. Eighth-Pass Tileset & Sprite Audit (`realms-of-shroudgarde`)
- **Sprite Mapping Integrity (`0` errors):** `collectMissingSpriteMappings` confirms all existing entities, tiles, items, and fields in `realms-of-shroudgarde` resolve cleanly against the 385-sprite `theme.json` atlas (though `tests/sprite_mapping.test.ts:7` only tests `['default', 'dnd35e-crypt']`, omitting `'realms-of-shroudgarde'`).
- **P8-1 — Unused Biome Tiles & Missing `proceduralPalette` on All 75 Areas (`build-realms-of-shroudgarde.ts:168-181`, `generator_stages.ts:45-54`):**
  `tiles.json` defines `grass_floor`, `dense_trees`, `swamp_floor` (which duplicates `tile_dirt_1` instead of `tile_dirt_1_green_bg`), `dirt_floor`, and `wood_floor`, yet **0 of 75 areas** set `proceduralPalette`. Consequently `resolvePalette` falls back to `{ wall: 'stone_wall', floor: 'stone_floor', door: 'wooden_door', water: 'shallow_water' }` everywhere—turning forests, marshes, wilderness roads, taverns, and caverns into identical grey stone dungeons.

---

## 3. Rule 15 Cascading Effects Analysis Summary

- **Upstream:**
  - `applyCreatureTemplate` CR propagation affects `onDnD35eEntitySpawned` (`dnd35e_spawn_hydrator.ts`) and any callers in tests (`tests/dnd35e_phase22_bestiary.test.ts`).
  - `ConsequenceActionSchema` adding `'give_item'` affects `src/systems/trigger.system.ts` (`consequenceAppliers` exhaustiveness) and any validator checks over trigger consequences.
  - `ecs_spawner.ts` attaching default `MemoryComponent` for `shop`/`dialogueId` actors affects all spawned merchants/dialogue NPCs across all 5 campaigns (making `sessionMarkupModifier`, `timesTraded`, `annoyedDuration` consistently functional).
- **Downstream:**
  - `getTradePriceBreakdown` capping `finalSellMultiplier <= finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO` affects `getEffectivePrice`, `getEffectiveItemPriceInBaseUnits`, `trade.ui.ts`, and `shop.system.ts` (`executeBuyItem` / `executeSellItem`).
  - `evaluateDnD35eDialogueSkillCheck` + `socialConsequences.skill_check` + `dialogue.actions.ts` self-loop fix affects all dialogue trees using `skill_check` across `default`, `dnd35e-crypt`, `shroudgarde`, and `realms-of-shroudgarde`.
  - `death.system.ts` cleanup of orphaned `no_drop`/`ShopComponent.inventory` entities ensures `GameState` entity arrays and `state.components` stay clean immediately upon NPC/shopkeeper death.
- **Lateral:**
  - `scripts/build-realms-of-shroudgarde.ts` is the authoritative generator for `public/data/campaigns/realms-of-shroudgarde/*.json`; all campaign data fixes must be authored in the script and regenerated cleanly to avoid hand-edit drift.
  - `scripts/generate-ai-prompt-kit.ts` must be re-run so `ai-prompt-kit/` matches `public/data/campaigns/default/`.
  - Check existing tests (`tests/currency_trade_and_campaign.test.ts`, `tests/dnd35e_phase22_bestiary.test.ts`, trade/dialogue tests) for any assumptions about unlimited Appraise retries or `cr`.
