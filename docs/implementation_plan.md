# Implementation Plan — Phase 40 Audit Remediation (Economy, Haggling, Dialogue Routing, Hydration, Boss Drops & Flagship Campaign)

## 1. Architectural Rules & Standards Reiteration

- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any` and zero `as never` type escapes; obey `exactOptionalPropertyTypes: true`; explicit return types on all functions; name every numeric gameplay threshold or ratio as a typed constant or schema field.
- **Rule 15 (Cascading Effects Matrix):** All schema, ECS, trigger, pricing, hydration, and campaign-generator changes are mapped across Upstream, Downstream, and Lateral axes in Section 4.
- **Rule 16 & 19 (Three-Tier Placement & 4-Layer Decision Matrix):**
  - **Tier 1 Console (`src/core/`, `src/systems/`, `src/utils/`, `src/types/`, `src/actions/`):** Arbitrage price cap (`src/utils/trade.ts`), `!currencyGrant` enforcement and haggle lock in `src/systems/shop.system.ts`, default `MemoryComponent` initialization on `shop`/`dialogueId` actors (`src/core/ecs/ecs_spawner.ts`), `give_item` consequence + `skill_check` state preservation (`src/types/trigger.types.ts`, `src/systems/trigger/`), self-loop routing flag (`src/actions/dialogue.actions.ts`), and `no_drop`/shop entity cleanup & coin drop rounding (`src/systems/death.system.ts`).
  - **Tier 2 Cartridge (`src/rulesets/dnd35e/`):** Per-merchant haggle lock and DAG `effectiveAbilityModifiers.wis` lookup (`src/rulesets/dnd35e/skills/trade_social_checks.ts`), template `crAdjustment` calculation (`src/rulesets/dnd35e/templates.ts`, `creature_system.types.ts`), hydration CR ordering + removing `as never` (`src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`), named DMG XP constants (`src/rulesets/dnd35e/progression/cr_xp_table.ts`), and config-driven `toBaseUnits` starting gold (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`).
  - **Tier 3 Data & Generators (`scripts/build-realms-of-shroudgarde.ts`, `public/data/campaigns/realms-of-shroudgarde/`, `ai-prompt-kit/`):** Wire `grant_quest` & `give_item` consequences + `not_has_fact`/`set_fact` guards in dialogues, add `memory` + explicit `equipSlot` + balanced `gp`/`sp` `currencyDrop` definitions, regenerate campaign JSONs, and sync `ai-prompt-kit`.
- **Rule 21 (Zero Content-ID Branching):** All fixes use generic schema fields (`give_item`, `crAdjustment`, `currencyGrant`, `equipSlot`, `MemoryComponent.facts`)—zero item, NPC, or quest IDs hardcoded in `.ts`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Defect / Split-Brain Being Evicted |
| :--- | :--- | :--- |
| **Buy/Sell Multiplier Arbitrage Invariant** | [`src/utils/trade.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/utils/trade.ts) (`getTradePriceBreakdown`) | Uncapped reciprocal `(BASE_SELL + bonus) / finalBuyMultiplier` allowing `finalSellMultiplier > finalBuyMultiplier` (`250%–400%` resale vs `10%` purchase) |
| **Shop Sale Validation & Fallback Haggle** | [`src/systems/shop.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/shop.system.ts) (`executeSellItem`, `executeTradeSocialAction`) | Missing `!itemDef.currencyGrant` engine check; uncapped repeat haggle in Console fallback |
| **Merchant/Dialogue `MemoryComponent` Guarantee** | [`src/core/ecs/ecs_spawner.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/core/ecs/ecs_spawner.ts) + shared `createDefaultMemoryComponent` | Merchants/NPCs without `"memory"` in JSON silently dropping `sessionMarkupModifier`, `annoyedDuration`, and `timesTraded` |
| **D&D 3.5e Trade Haggle & Dialogue Checks** | [`src/rulesets/dnd35e/skills/trade_social_checks.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/trade_social_checks.ts) | Risk-free infinite `Appraise` / `Diplomacy` spam; polluted `npcWisMod` subtraction; `dc <= 0` Intimidate using Sense Motive instead of Demoralize (`10 + HD + Wis`) |
| **Dialogue Consequence Execution & Routing** | [`src/systems/trigger/social_consequences.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/trigger/social_consequences.ts) + [`src/actions/dialogue.actions.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/actions/dialogue.actions.ts) + [`src/systems/trigger/player.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/trigger/player.ts) | `skill_check` discarding `checkResult.state`; `dialogue.actions.ts` missing same-node transitions; missing declarative `give_item` consequence |
| **Template CR & Post-Spawn Hydration** | [`src/rulesets/dnd35e/templates.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/templates.ts) + [`src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts) | Template CR ignored; `rawRulesetData.cr ?? resolvedCr` overwriting template results post-application; `sysContent as never` cast |
| **Death Loot Rounding & Entity Cleanup** | [`src/systems/death.system.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/systems/death.system.ts) | Coarse `currencyGrant` rounding inflating small drops (`10 gp -> 50 gp`); orphaned `no_drop` and `ShopComponent.inventory` entities |
| **Flagship Campaign Generator & Kit Parity** | [`scripts/build-realms-of-shroudgarde.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/scripts/build-realms-of-shroudgarde.ts) + `scripts/generate-ai-prompt-kit.ts` | Ungranted quests, missing `equipSlot`, `cp` boss hoards, unguarded repeat dialogues, missing `memory`, stale `ai-prompt-kit/default-campaign/entities.json` |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Preventing sell-back gold arbitrage** | `if (itemId === 'gem_ruby') capPrice()` | Generic ratio invariant `finalSellMultiplier <= finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO` in `trade.ts` | **Yes** — protects all existing and future items automatically |
| **Preventing repeat haggling per merchant** | `if (npcId === 'barkeep_bertram') lock()` | Store `'trade_tried:<skillId>'` facts in `MemoryComponent.facts` (and `not_has_fact`/`set_fact` in dialogue JSON) | **Yes** — works uniformly for any merchant or NPC |
| **Granting items in dialogue (`Guard Signet`, `Bread`)** | Hardcoding `if (dialogueId === 'guard_captain_tree')` | Declarative `give_item` member in `ConsequenceActionSchema` (`{ type: 'give_item', itemId, amount }`) | **Yes** — any dialogue or trigger can award any item |
| **Template Challenge Rating adjustments** | `if (templateId === 'half_dragon') cr += 2` | Optional `crAdjustment` on `DnD35TemplateSchema` + `DnD35TemplateHdTierSchema` resolved inside `applyCreatureTemplate` | **Yes** — modders author CR shifts directly in template JSON |
| **Starting package currency scaling** | `startingGoldGp * 100` hardcoded | `toBaseUnits(equipPkg.startingGoldGp, 'gp', resolveCurrencyConfig(state))` | **Yes** — respects any custom `CurrencyConfig` |

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **1. `trade.ts` `MAX_SELL_TO_BUY_RATIO` cap & `shop.system.ts` `!currencyGrant` check** | None (signature unchanged) | `getEffectivePrice`, `getEffectiveItemPriceInBaseUnits`, `trade.ui.ts`, `shop.system.ts` | `tests/currency_trade_and_campaign.test.ts` (add arbitrage invariant test) |
| **2. `ecs_spawner.ts` default `MemoryComponent` for `shop` / `dialogueId`** | Any entity spawned with `shop` or `dialogueId` | `trade_social_checks.ts`, `shop.system.ts`, `social_consequences.ts`, `inspect_tooltip.ts` | All 5 campaigns (merchants gain working `sessionMarkupModifier`/`timesTraded` without JSON breakage) |
| **3. Per-merchant haggle fact lock + DAG `effectiveAbilityModifiers.wis` + Demoralize DC alignment** | `apply.system.ts`, `trade.ui.ts`, `dialogue.actions.ts` | `trade_social_checks.ts`, `shop.system.ts`, `MemoryComponent.facts`, `tests/currency_trade_and_campaign.test.ts` | `social_combat_skill_verbs.ts` (combat social verbs remain separate; trade UI haggles follow consistent rule) |
| **4. `give_item` consequence + `skill_check` state fix + self-loop transition tracking** | `ConsequenceActionSchema` (`trigger.types.ts`) | `trigger.system.ts` (`ConsequenceApplierMap`), `player.ts`, `social_consequences.ts`, `dialogue.actions.ts` | Campaign dialogues using `skill_check` (`default`, `dnd35e-crypt`, `realms-of-shroudgarde`) |
| **5. `DnD35Template.crAdjustment`, `applyCreatureTemplate` CR propagation, `dnd35e_spawn_hydrator.ts` CR order & type fix** | `templates/*.json`, `DnD35TemplateSchema` | `onDnD35eEntitySpawned`, `resolveDnD35eKillXpReward`, `FighterComponent.xpGiven` | `tests/dnd35e_phase22_bestiary.test.ts`, `scripts/run-validator.ts` (`DnD35SystemContentSchema`) |
| **6. `death.system.ts` coarse coin drop splitting & orphaned entity cleanup** | `EntityTemplate.currencyDrop`, `defaultEquipment.dropOnDeath` | `state.entities`, `state.components`, `inventory.system.ts` (`pickup`) | `tests/save_roundtrip.test.ts` (fewer orphans left before save) |
| **7. `build-realms-of-shroudgarde.ts` fixes & `generate-ai-prompt-kit.ts`** | Campaign source generator | `public/data/campaigns/realms-of-shroudgarde/*.json`, `ai-prompt-kit/` | `scripts/run-validator.ts` (`[8/8]` parity pass) |

---

## 5. Step-by-Step Implementation Plan & Code Snippets

### Phase 1: Trade Economy & Haggling Safeguards (`B1`, `B2`, `B6`, `M1`)

#### Step 1.1 — Cap `finalSellMultiplier` strictly below `finalBuyMultiplier` in `src/utils/trade.ts`
Add named upper constants and clamp `finalSellMultiplier`:
```ts
/** Maximum sell-to-shop price multiplier allowed as an absolute ceiling (DMG/PHB 50% fair resale + expert appraisal headroom). */
export const MAX_SELL_TO_SHOP_MULTIPLIER = 0.75;

/** Maximum allowed ratio between merchant sell-back price and purchase price to prevent buy/sell arbitrage loops. */
export const MAX_SELL_TO_BUY_RATIO = 0.85;
```
Inside `getTradePriceBreakdown`:
```ts
  const finalBuyMultiplier = Math.max(MIN_TRADE_MULTIPLIER, multiplier);
  const uncappedSellMultiplier = (BASE_SELL_TO_SHOP_MULTIPLIER + sellMultiplierBonus) * (1 / finalBuyMultiplier);
  const maxSellAllowed = Math.min(MAX_SELL_TO_SHOP_MULTIPLIER, finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO);
  const finalSellMultiplier = Math.max(
    MIN_SELL_TO_SHOP_MULTIPLIER,
    Math.min(maxSellAllowed, uncappedSellMultiplier)
  );
```
Wait: note that when `finalBuyMultiplier = 0.1` (`MIN_TRADE_MULTIPLIER`), `finalBuyMultiplier * MAX_SELL_TO_BUY_RATIO = 0.085 > MIN_SELL_TO_SHOP_MULTIPLIER (0.05)`, so `finalSellMultiplier <= 0.085 < 0.1` always holds! And for small items where integer flooring could still yield `sellPrice === buyPrice === 1`, `getEffectivePrice` in `trade.ts` (when `isSellingToShop`) stays at `1` cp (0 profit, no infinite loop).

#### Step 1.2 — Guard `currencyGrant`, extract Console haggle constants, and enforce attempt limits in `src/systems/shop.system.ts`
1. In `executeSellItem` (`shop.system.ts:164-171`), guard currency items just like `trade.ui.ts:187`:
   ```ts
   const isBuyable =
     !itemDef.currencyGrant &&
     (shop.buyTags.length === 0 || (itemDef.tags !== undefined && itemDef.tags.some((t) => shop.buyTags.includes(t))));
   ```
2. Extract named constants for the Console haggle fallback (`CONSOLE_APPRAISE_DC_PERCENT = 45`, `CONSOLE_HAGGLE_DC_PERCENT = 50`, `CONSOLE_HAGGLE_DISCOUNT_DELTA = -0.15`, `CONSOLE_HAGGLE_PENALTY_DELTA = 0.15`, `CONSOLE_MIN_SESSION_MARKUP = -0.35`, `CONSOLE_MAX_SESSION_MARKUP = 0.5`) and add a shared `MemoryComponent.facts` attempt guard (`trade_haggled:${skillId}`) if `!getActiveRuleset(state).resolveTradeSocialSkill`.

#### Step 1.3 — Default `MemoryComponent`, Shared UI/Currency SSOT Helpers & Removing `id === 'dnd35e'` Hardcoding (`B6`, `S1`, `S3`, `S4`, `S5`)
1. **Default `MemoryComponent` (`src/core/ecs/ecs_spawner.ts`):** Ensure any spawned actor with `template.shop` or `template.dialogueId` receives a default `MemoryComponent` when `!template.memory`:
   ```ts
   if (!getComponent(nextState, entityId, ComponentType.Memory) && (templateId === 'player' || template.shop || template.dialogueId)) {
     nextState = addComponent(nextState, entityId, {
       type: ComponentType.Memory,
       factionStandings: {},
       grudges: [],
       facts: [],
       knowledge: {}
     });
   }
   ```
2. **Eliminate `rulesetId === 'dnd35e'`, Mount Trade Overlay, Fix Reactivity & Immediate Actions (`S1`, `X1`–`X3`):**
   - Add optional `getTradeSocialActions?(): ReadonlyArray<TradeSocialActionDescriptor>` to `RulesetContract` (`src/types/ruleset.types.ts`) with Console default `[Persuade, Intimidate]` in `trade.ui.ts` and D&D 3.5e returning `[Diplomacy, Appraise, Bluff (Haggle), Intimidate]` in `dnd35e_ruleset.ts` (`S1`).
   - Add `renderTradeOverlay(state)` (reusing `#trade-overlay` in `document.body` via `renderTradeUI(state, queuePlayerIntent)`, preserving list `scrollTop` across Buy/Sell/Haggle refreshes and hiding when `null` (`G3`)), replace non-existent `--panel-bg` / `--panel-fg` CSS variables with `var(--bg-card, #16181f)` / `var(--text-main, #e2d9c8)` (`P7-1`), visually disable exhausted/locked haggle buttons (`trade_locked:*` / `trade_win:*` cap (`G5`)), and invoke `renderTradeOverlay(state)` inside `src/rendering/presenter.ts:203-215` (`X1`).
   - Include `next.uiMode === UIMode.Trade` in `src/core/presentation_queue.ts:250` so `components`/`entities` updates refresh purse, stock, and prices immediately (`X2`).
   - Pass `isImmediate: true` on Buy, Sell, and Trade Social intents in `trade.ui.ts` (matching `dialogue.ui.ts:179` & `CloseTrade`), and keep `dnd35e_turn_budget.ts:285-287` returning `{ state, energyCost: 0 }` cleanly during `UIMode.Trade` (`X3`).
3. **Single Point of Entry for Currency Grants & Denomination Items (`S3`, `S4`, `S5`):**
   - In `src/systems/currency.system.ts`, add `!Number.isFinite(...)` guards in `setEntityCurrencyBalance` and `addEntityCurrency` (`F4`), and extract `resolveCurrencyItemDefinition(state, denominationId, config)` (resolving `findCurrencyDenomination(config, denominationId)?.itemId` first, then falling back to `currencyGrant.denominationId` scan) and `absorbCurrencyItemGrant(state, entityId, itemDef, stackCount)`.
   - In `src/utils/trade.ts`, emit concise `Personality` / `Relationship` factor annotations (`facets`, `relationshipAxes`) so Trade UI percentages remain fully observable (`F4`).
   - Route player-owned item naming in `trade.ui.ts:200`, `shop.system.ts:205`, and `inventory.system.ts:89-91` through `resolveEntityDisplayName` (`ecs_core.ts`) so unidentified items are never spoiled (`V2`).
   - In `src/systems/inventory.system.ts`, extract `grantItemToActorInventory(state, recipientId, itemId, count)` calling `absorbCurrencyItemGrant` for `currencyGrant` items (or adding to `InventoryComponent.items` within capacity / dropping on ground), and reuse it across **pickup**, **`quest.system.ts` item rewards**, and **`playerConsequences.give_item`** — fixing the `50x silver_coin` quest bag overflow!
   - In `dnd35e_ui_adapter.ts:112`, replace `Math.floor(balanceBaseUnits / DND35E_CP_PER_GP)` with `convertCurrency(balanceBaseUnits, currencyCfg.baseUnitId, currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId, currencyCfg)` and remove the hardcoded `' gp'` suffix fallback in `console_inventory.ui.ts:286`.

#### Step 1.4 — Fix `trade_social_checks.ts` & Deduplicate `npcWisMod` / Session Markup Helpers (`B2`, `M1`, `S2`, `Rule 12`)
1. Extract shared `resolveActorWisModFromDAG(state, entityId)` in `src/rulesets/dnd35e/skills/skill_verb_helpers.ts` (replacing BOTH duplicate subtractions in `trade_social_checks.ts:199` and `social_combat_skill_verbs.ts:110`) and share a clamped session markup helper so `social_combat_skill_verbs.ts` / `social.system.ts` don't clobber deeper trade discounts.
2. Add named constants replacing inline literals and governing repeat-until-fail-or-cap haggling:
   ```ts
   const APPRAISE_RESALE_BONUS_HIGH = 0.15;
   const APPRAISE_RESALE_BONUS_LOW = 0.08;
   const APPRAISE_TRADE_PENALTY = 0.08;
   const APPRAISE_FAIL_PENALTY_CHANCE = 0.5;
   const DIPLOMACY_HAGGLE_DC_HIGH = 20;
   const DIPLOMACY_HAGGLE_DC_STANDARD = 15;
   const DIPLOMACY_FAIL_ANNOYED_CHANCE = 0.5;
   const SENSE_MOTIVE_PASSIVE_BASE = 10;
   const MAX_HAGGLE_WINS_PER_SKILL = 2;
   const TRADE_LOCKED_FACT_PREFIX = 'trade_locked:';
   const TRADE_WIN_FACT_PREFIX = 'trade_win:';
   ```
2. In `resolveDnD35eTradeSocialSkill` (and mirrored cleanly in Console fallback `shop.system.ts`):
   - **Repeat until fail or cap:** Each skill (`appraise`, `diplomacy`, `bluff`, `intimidate`) may be repeated against a merchant while:
     1. `!facts.includes('trade_locked:<skillId>')` (no prior failure on that tactic),
     2. win count for that skill (`trade_win:<skillId>:1..N`) is `< MAX_HAGGLE_WINS_PER_SKILL` (`2`), and
     3. `currentSessionMod > MIN_SESSION_MARKUP_MOD` (`-0.4`, not yet at cap).
   - **On success:** Applies the discount (`clampSessionMarkup(...)`) and appends `trade_win:<skillId>:<nextCount>` to `MemoryComponent.facts`.
   - **On failure (chance of negative results + lockout):** Locks `'trade_locked:<skillId>'` in `MemoryComponent.facts` so that tactic cannot be retried on that merchant, AND applies negative consequences:
     - `appraise`: rolls `rng.getUniform() < APPRAISE_FAIL_PENALTY_CHANCE` (`50%`) to offend the merchant (`+APPRAISE_TRADE_PENALTY` markup).
     - `diplomacy`: applies `+DIPLOMACY_HAGGLE_PENALTY` (`+10%`) markup and rolls `rng.getUniform() < DIPLOMACY_FAIL_ANNOYED_CHANCE` (`50%`) to trigger `annoyedDuration: HAGGLE_ANNOYED_DURATION`.
     - `bluff` / `intimidate`: applies markup penalty (`+15%` / `+25%`) and sets `annoyedDuration: HAGGLE_ANNOYED_DURATION`.
3. Fix `npcWisMod` in `case 'intimidate'` (`trade_social_checks.ts:191-201`) using DAG directly:
   ```ts
   const npcEval = evaluateDnD35eEntityDAG(state, npcId);
   const npcDnd = npcEval?.dndData ?? getDnD35EntityData(state, npcId);
   const npcChassis = aggregateProgressionChassis(npcDnd.tracks, 0);
   const npcWisMod = npcEval?.dagResult.effectiveAbilityModifiers.wis ?? 0;
   const opposeDc = DEMORALIZE_BASE_DC + Math.max(1, npcChassis.totalHD) + npcWisMod;
   const success = resolveDemoralizeCheck(intimidateCheck.totalRoll, Math.max(1, npcChassis.totalHD), npcWisMod);
   ```
4. Align `evaluateDnD35eDialogueSkillCheck` (`trade_social_checks.ts:236-240`) so `dc <= 0` for `'intimidate'` uses `DEMORALIZE_BASE_DC + Math.max(1, npcChassis.totalHD) + npcWisMod` while `'bluff'` uses `SENSE_MOTIVE_PASSIVE_BASE + npcSenseCheck.totalModifier`.

---

### Phase 2: Dialogue Consequences & Routing (`B2`, `B4`)

#### Step 2.1 — Add declarative `give_item` consequence (`src/types/trigger.types.ts`, `src/systems/trigger/player.ts`)
1. In `ConsequenceActionSchema` (`src/types/trigger.types.ts`):
   ```ts
   z.object({
     type: z.literal('give_item'),
     itemId: z.string().min(1),
     amount: z.number().int().positive().default(1),
     targetId: z.string().optional()
   }),
   ```
2. In `playerConsequences` (`src/systems/trigger/player.ts`):
   - Resolve recipient (`consequence._playerEntityId ?? consequence.entityId ?? player`).
   - Loop `count` times spawning via `spawnItem(nextState, consequence.itemId, pos.x, pos.y)`: if recipient has `InventoryComponent` below `getEffectiveCapacity(nextState, recipientId)`, remove `PositionComponent` and append to `InventoryComponent.items`; otherwise drop on ground at recipient coordinates; call `processQuestEvent(nextState, 'gather', consequence.itemId, 1)` if player; log receipt message.

#### Step 2.2 — Fix `socialConsequences.skill_check`, `open_barter` `_npcEntityId`, & self-loop transitions (`B4`, `F1`)
1. In `src/systems/trigger/social_consequences.ts:358`:
   ```ts
   let nextState = rulesetResult
     ? checkResult.state
     : addMessage(state, checkResult.breakdown, MessageLogCategory.System);
   ```
2. In `src/actions/dialogue.actions.ts:65-93`, check whether `skill_check` (or another consequence) explicitly set `activeDialogue.textOverride` OR changed `currentNodeId` (`const didConsequenceRoute = activeDialogue !== undefined && (activeDialogue.currentNodeId !== preConseqNodeId || activeDialogue.textOverride !== undefined);`) so same-node failure transitions preserve `currentNodeId` and `textOverride` instead of closing the conversation.
3. In `src/systems/trigger/systemic.ts:173-195` (`open_barter`), resolve `npcId` from `consequence._npcEntityId` as well (`consequence._npcEntityId ?? ...`), verify `getComponent(state, npcId, ComponentType.Shop)` exists, and clear `activeDialogue: undefined` cleanly when switching to `UIMode.Trade`.

---

### Phase 3: Template CR Propagation, Spawn Hydration, XP Constants & Death Drops (`M2`, `M3`, `M4`, `A1`, `A2`)

#### Step 3.1 — Add declarative `crAdjustment` to `DnD35TemplateSchema` & `applyCreatureTemplate`
1. In `src/rulesets/dnd35e/types/system/creature_system.types.ts`:
   Add `crAdjustment: z.number().optional()` to `DnD35TemplateSchema` (alongside existing `DnD35TemplateHdTierSchema.crAdjustment`).
2. In `src/rulesets/dnd35e/templates.ts`:
   Compute CR inside `applyCreatureTemplate` when `base.cr !== undefined` (adding top-level `template.crAdjustment ?? 0` and any matching `hdTier?.crAdjustment ?? 0` after `hdMultiplier`/`bonusHitDice`), preserving `cr` on the returned `DnD35EntityData` with `exactOptionalPropertyTypes` safety.

#### Step 3.2 — Fix `dnd35e_spawn_hydrator.ts` CR order, `race_hydrator.ts` class-level CR, & eliminate `as never` (`T2`, `G4`)
1. In `src/rulesets/dnd35e/archetype/race_hydrator.ts:156-158`, compute `computedCr` properly when `options?.classLevels` are applied—without disturbing races that rely on `raceDef.cr` (`goblin`, `hobgoblin`, `kobold`, `orc`) when no `options.classLevels` override is passed:
   ```ts
   const totalPcAndPrestigeLevels = tracks
     .filter((t) => t.trackCategory === 'pc' || t.trackCategory === 'prestige')
     .reduce((s, t) => s + t.levels, 0);
   const totalNpcLevels = tracks.filter((t) => t.trackCategory === 'npc').reduce((s, t) => s + t.levels, 0);
   const hasExplicitClassLevels = (options?.classLevels?.length ?? 0) > 0;
   const classCrContribution =
     totalPcAndPrestigeLevels + computeNpcClassCrContribution(totalNpcLevels, baseHdCount > 0);
   const computedCr = hasExplicitClassLevels
     ? baseHdCount === 0
       ? classCrContribution
       : (raceDef.cr ?? 1) + classCrContribution
     : (raceDef.cr ?? (baseHdCount === 0 && totalNpcLevels > 0 ? computeNpcClassCrContribution(totalNpcLevels, false) : 1));
   ```
2. In `dnd35e_spawn_hydrator.ts`, use `getDnD35SystemContent(state.campaign) ?? undefined` instead of `sysContent as never`, and allow `template.fighter.xpGiven` to defer to `computeDnD35eCrXp` when campaign bosses align with DMG CR XP (`G4`).
3. Resolve `explicitCr = typeof rawRulesetData?.['cr'] === 'number' ? rawRulesetData['cr'] : (dndData.cr ?? resolvedCr);` so template and `classLevels` CR updates are preserved unless explicitly overridden in campaign JSON.
4. Replace `equipPkg.startingGoldGp * 100` in `builder_hydrator_creation.ts:231, 243` with `toBaseUnits(equipPkg.startingGoldGp, 'gp', resolveCurrencyConfig(runningState))`.
5. Extract named DMG XP constants in `cr_xp_table.ts`.

#### Step 3.3 — Fix `death.system.ts` coin rounding & orphan cleanup (`M4`)
1. In `dropCurrencyBucket` (`src/systems/death.system.ts:238-259`):
   If the matched coin definition's `currencyGrant.amount > amount`, fall back to `currencyCfg.denominations` decomposition via `toBaseUnits(amount, denominationId, currencyCfg)` + `decomposeToCoins` so a `10 gp` drop never rounds up into a `50 gp` coin pouch (`charges = 1`).
2. Clean up orphaned item entities on actor death (`death.system.ts:185-203` & `333`):
   - Call `removeEntity(nextState, itemEntityId)` for `'no_drop'` items instead of leaving them unreferenced in `GameState`.
   - When `isShopkeeper` dies, also `removeEntity(nextState, shopItemId)` for unpositioned `isShopkeeper.inventory` entities.

---

### Phase 4: Flagship Campaign (`scripts/build-realms-of-shroudgarde.ts`), `ai-prompt-kit` Parity & Tests (`B2`, `B3`, `B5`, `B6`, `M2`)

#### Step 4.1 — Fix `map_generation_spawner.ts` walkability & update `scripts/build-realms-of-shroudgarde.ts` (`B2`, `B3`, `B6`, `M2`, `T1`)
0. **Walkable-tile snap + collision avoidance for procedural `placedEntities` (`src/systems/map/map_generation_spawner.ts:122-154`, `G2`):** Track occupied coordinates (`spawnX, spawnY`, portals, and already-placed entities) and if a `placedEntities` entry resolves to an out-of-bounds, non-walkable, or already-occupied tile, BFS/spiral-snap it to the nearest unoccupied walkable floor tile so town NPCs and bosses never stack on each other, on `(spawnX, spawnY)`, or inside solid walls.
1. **Fix town pool collisions (`F2`), replace currency tokens in shop stock (`G1`), set `environmentType` + `proceduralPalette` across all 75 areas (`V1`, `P8-1`), & place all 8 named NPCs + 5 bosses via `placedEntities` (`T1`):**
   - Replace `coin_pouch_silver` / `coin_pouch_gold` in `silas_merchant.shop.inventory` with non-`currencyGrant` jeweler items (`gem_chalcedony`, `gem_ruby`, `gem_sapphire`, `gem_diamond`, `ring_of_protection_plus1`), and ensure `restockShop` excludes `item.currencyGrant` definitions (`G1`).
   - Set `environmentType: 'outdoors' | 'indoors' | 'underground'` and biome-appropriate `proceduralPalette` (`grass_floor`/`dense_trees` forests, `swamp_floor`/`tile_dirt_1_green_bg` marshes, `dirt_floor`/`grass_floor` wilderness roads, `wood_floor` inns/keeps, skull-wall catacombs, cave dirt/rock, etc.) across areas in `scripts/build-realms-of-shroudgarde.ts`, and remove `"outdoor"` / `"frontier"` tag collisions from `shroudgarde_courtyard`, `shroudgarde_gate`, and `orlane_east` so `frontier_beasts` never spawns hostile bandits/owlbears inside safe towns on Turn 1.
   - Author explicit `placedEntities` in `scripts/build-realms-of-shroudgarde.ts` placing `constable_derek` (`shroudgarde_courtyard` / `shroudgarde_gate`), `barkeep_bertram` (`golden_grain_inn`), `dwarf_laurent` & `isabelle_cleric` & `luc_ranger` & `silas_merchant` & `elena_scholar` across Shroudgarde town/keep/hub areas, `archmage_alden` (`wizard_tower_f1`), `ogre_chieftain` (`ravine_chaos`), `crypt_arch_curate` (`dungeon_5` / `dungeon_3`), `lareth_the_beautiful` (`moathouse_dungeon`), `zuggtmoy_queen` (`toee_zuggtmoy_fane`), and `red_dragon` (`incursion_lesser_vault_2`). Also add `"memory"` objects (`factionStandings`, `grudges`, `facts`, `knowledge`) on all named NPCs & merchants.
2. **Wire all quests in `quests.json` to `dialogues.json` (`B3`):**
   - `guard_captain_tree` (`constable_derek`): grant `quest_cleanse_crypts` and `quest_caves_of_chaos` via `{ type: 'grant_quest', questId: ... }` on acceptance, and award `{ type: 'give_item', itemId: 'shroudgarde_signet', amount: 1 }` on `opt_accept_signet` (with `not_has_fact` / `set_fact` guards against repeat signet farming & failure retry locks).
   - `elena_scholar_tree`: grant `quest_investigate_trance` and `quest_watchtower_defense` (or `alden_mage_tree` / `constable_derek`) so every quest in `quests.json` has an in-game `grant_quest` source (`quest_gem_appraisal` via `silas_gem_merchant_tree`, `quest_slay_dragon_pyroclast` via `alden_mage_tree` / `elena_scholar_tree`, etc.).
3. **Fix dialogue exploits & flavor mismatch (`B2`):**
   - `bertram_trade_tree`: `node_bluff_win` grants `{ type: 'give_item', itemId: 'ration_fresh_bread', amount: 1 }` + `{ type: 'set_fact', target: 'bertram_bread_claimed' }`; `opt_appraise` & `opt_bluff` gated by `not_has_fact` + `set_fact`.
   - Gate repeat skill-check discount options in `laurent_smith_tree`, `isabelle_healer_tree`, `silas_gem_merchant_tree`, `alden_mage_tree` with `not_has_fact` / `set_fact` (and fix backtick typos `Derek\`s` -> `Derek's`, `Jeweler\`s` -> `Jeweler's`).
4. **Add explicit `equipSlot` on `defaultEquipment`, flesh out a true CR 1–20 encounter & boss curve (`Option 1`), and fix `currencyDrop` denominations (`M2`):**
   - Add `equipSlot: 'main_hand' | 'off_hand' | 'torso' | 'neck'` matching each item on `constable_derek`, `dwarf_laurent`, `isabelle_cleric`, `luc_ranger`, `archmage_alden`, `town_guard`, `lareth_the_beautiful`, `crypt_arch_curate`, and `ogre_chieftain`.
   - Keep `zuggtmoy_queen` at true CR `20` (`archetypeId: 'balor'`), upgrade `red_dragon` ("Pyroclast the Red Wyrm") to `dragon_red_old` (CR `18`) or `dragon_red_very_old` (CR `19`), give `classLevels` to named/tiered humanoid bosses (`lareth_the_beautiful`: Cleric `7`, `crypt_arch_curate`: Cleric `9` on `ghoul`, `orc_warchief`: Fighter `5` on `orc`, `orc_blademaster`: Fighter `3` on `orc`, `bandit`: Rogue `2`, `cultist`: Adept `3`), and add CR `6–17` SRD monsters already present in `public/data/rulesets/dnd35e/races/` (`ettin` CR 6, `chimera` / `hill_giant` / `medusa` / `flesh_golem` / `elemental_*_huge` CR 7, `mind_flayer` / `stone_giant` / `dragon_red_juvenile` CR 8, `frost_giant` / `elemental_*_greater` CR 9, `fire_giant` CR 10, `stone_golem` / `elemental_*_elder` / `dragon_red_young_adult` CR 11, `beholder` / `iron_golem` CR 13, `dragon_red_adult` CR 14, `dragon_red_mature_adult` CR 16, `marilith` CR 17) across mid-tier and deep megadungeon `spawnPools` (`tower_sentinels`, `temple_cult`, `deep_monsters`, and a new `deep_vault_horrors` pool for `deep_vault` areas) so a player can genuinely progress to Level `20` to fight Zuggtmoy.
   - Convert large/boss `currencyDrop` entries (`>= 100 cp`) from `'cp'` stacks into appropriate `'sp'`, `'gp'`, or `'pp'` denominations, and remove/disable coin drops on mindless beasts and mindless undead (`giant_rat`, `giant_spider`, `dire_wolf`, `owlbear`, `skeleton`, `zombie`).
   - Run `bun scripts/build-realms-of-shroudgarde.ts`.

#### Step 4.2 — Regenerate `ai-prompt-kit` & expand `tests/currency_trade_and_campaign.test.ts`
1. Run `bun scripts/generate-ai-prompt-kit.ts` to resolve the stale `ai-prompt-kit/default-campaign/entities.json` parity error (`B5`).
2. Clean up `as any` casts in `tests/currency_trade_and_campaign.test.ts` (`L109`, `L243`), add `'realms-of-shroudgarde'` to [`tests/sprite_mapping.test.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/tests/sprite_mapping.test.ts#L7), and add runtime integration tests covering:
   - Arbitrage invariant (`finalSellMultiplier < finalBuyMultiplier` even at max stacked discounts; `sellPrice < buyPrice` on standard items).
   - `executeBuyItem`, `executeSellItem` (including rejecting `currencyGrant` items), and repeat-until-fail-or-cap haggle behavior (`trade_win:*` up to cap, `trade_locked:*` + negative penalty/annoyance chance on failure).
   - `ecs_spawner.ts` default `MemoryComponent` creation for `shop`/`dialogueId` actors and `onDnD35eEntitySpawned` hydration of stats/equipment/classLevels/template CR (`zuggtmoy_queen` CR `20`, boss `classLevels`, CR 6–17 monsters).
   - `death.system.ts` coin decomposition/drop + `inventory.system.ts` pickup absorption + `isShopkeeper` exclusion.
   - `socialConsequences.skill_check` preserving `checkResult.state` & self-loop routing, plus `realms-of-shroudgarde` static check verifying every quest in `quests.json` is granted by at least one dialogue or trigger and CR tiers span `<= 1` through `20`.
3. Run `./verify.sh` end-to-end and verify **all 8 stages pass with 0 errors**.

---

## 6. Confirmed Design Decisions

1. **Trade Arbitrage Ceiling (Confirmed):** `finalSellMultiplier` is capped strictly below `finalBuyMultiplier` (`MAX_SELL_TO_SHOP_MULTIPLIER = 0.75`, `MAX_SELL_TO_BUY_RATIO = 0.85`).
2. **Haggle Repeat Policy (Confirmed):** Players may repeat negotiation tactics (`appraise`, `diplomacy`, `bluff`, `intimidate`) up to `MAX_HAGGLE_WINS_PER_SKILL = 2` (or `MIN_SESSION_MARKUP_MOD = -0.4`), locking that tactic for the merchant upon failure and applying a chance of negative fallout (markup increase / annoyance) on failure.
3. **True 1–20 Progression & Boss/Beast Tuning (Confirmed Option 1):** Keep `zuggtmoy_queen` as CR `20` (`balor`), scale Pyroclast (`red_dragon`) to Wyrm/Old tier (`CR 18–19`), hydrate humanoid/boss `classLevels`, populate CR `6–17` enemies from existing `races/` & tiered elementals/dragons across mid/deep spawn pools, and remove coin drops from mindless beasts/undead (`giant_rat`, `giant_spider`, `dire_wolf`, `owlbear`, `skeleton`, `zombie`).

---

## 7. Implementation Status & Post-Audit Adjustments (Completed)

- [x] **Phase 1 (Trade, Currency, UI & Turn Budget):** Completed with declarative `RulesetContract.getTradeSocialActions()`, `renderTradeOverlay()` mounted in `presenter.ts`, `UIMode.Trade` dirty checks in `presentation_queue.ts`, `createDefaultMemoryComponent()` canonicalized in `src/core/ecs/ecs_core.ts`, `resolveActorWisModFromDAG()` reusing `computeAbilityModifier`/`computeEffectiveAbilityScore`, and `TRADE_MODE_FREE_VERBS` deduplicated in `dnd35e_turn_budget.ts`.
- [x] **Phase 2 (Dialogue Consequences & Routing):** Completed with `give_item` schema (`ConsequenceActionSchema`) & `grantItemToActorInventory` integration (supporting `'event.entityId'` and `player`), `skill_check` state preservation + lookup-table opposed DC resolvers, same-node `textOverride` routing, and `open_barter` `_npcEntityId` + shop validation.
- [x] **Phase 3 (CR Math, Templates, Hydration & Death Drops):** Completed with `DnD35TemplateSchema.crAdjustment`, `race_hydrator.ts` PC/Prestige & monster `classLevels` CR math, `dnd35e_spawn_hydrator.ts` template CR order (`getDnD35SystemContent`), `builder_hydrator_creation.ts` `toBaseUnits`, and `death.system.ts` sub-coin subdivision + `cleanupDeadEntityOrphans`.
- [x] **Phase 4 (Map Spawning, `realms-of-shroudgarde`, Kit Parity & Tests):** Completed with BFS `resolveSafePlacedCoords` in `map_generation_spawner.ts`, all 75 areas outfitted with `environmentType` + biome `proceduralPalette`, all 8 NPCs & 5 bosses placed via `placedEntities`, `red_dragon` scaled to `dragon_red_very_old` (CR 19) and `crypt_arch_curate` to `mummy` + `cleric 4` (CR 9), all 16 quests wired, dialogue discount skill checks locked via `not_has_fact` + `set_fact`, `ai-prompt-kit` synced, and expanded integration tests in `tests/currency_trade_and_campaign.test.ts` + `tests/sprite_mapping.test.ts`.
