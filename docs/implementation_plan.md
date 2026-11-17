# Implementation Plan — Phase 40 (Milestones 142–146): Multi-Denomination Currency Engine, Pluggable Trade/Barter & Skill-Keyed Social System, Post-Spawn Statblock/CR/Loot Overhaul, and `realms-of-shroudgarde` Campaign

## 1. Architectural Rules & Standards Reiteration

- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** Zero `any`, `exactOptionalPropertyTypes: true` compliance, explicit return types on all functions, exhaustive `switch` statements with `assertNever`, and named constants or schema fields for all monetary, XP, and drop parameters.
- **Rule 15 (Cascading Effects Matrix):** All schema, ECS component, `RulesetContract`, UI, and campaign data changes are mapped across Upstream, Downstream, and Lateral axes below.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`, `src/utils/`, `src/rendering/`):** System-agnostic base-coin + multi-denomination currency math (`src/systems/currency.system.ts`), `InventoryComponent.currencyBalance` (in base units), currency item auto-absorption on pickup, Buy/Sell/Barter transaction execution (`src/systems/shop.system.ts`, `src/utils/trade.ts`), interactive `trade.ui.ts`, template `defaultEquipment` / `lootDrops` / `currencyDrop`, and `RulesetContract` hooks (`getCurrencyConfig`, `evaluateTradePriceModifier`, `resolveSocialTradeAction`, `onEntitySpawned`, `resolveKillXpReward`).
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** Canonical D&D 3.5e 5-coin monetary table (`cp=1, sp=10, ep=50, gp=100, pp=1000`), `Appraise` / `Diplomacy` / `Bluff` / `Intimidate` / `Sense Motive` trade & dialogue skill checks (`src/rulesets/dnd35e/skills/trade_social_checks.ts`), post-spawn actor statblock hydration (`src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`), and DMG Table 2-6 CR-vs-ECL XP calculation (`src/rulesets/dnd35e/progression/cr_xp_table.ts`).
  - **Tier 3 — System Content & Campaign Data (`public/data/rulesets/dnd35e/`, `public/data/campaigns/realms-of-shroudgarde/`):** Curated D&D 3.5e bestiary, named NPCs, monetary/treasure items, ~75-area multi-layered world, quests, and skill-keyed dialogues.
- **Rule 21 (Zero Content-ID Branching):** No `.ts` file branches on specific item IDs, monster IDs, or NPC IDs. Coin items declare `currencyDenominationId` and `currencyAmount` on `ItemDefinitionSchema`; monsters declare `archetypeId`, `rulesetData`, `defaultEquipment`, `lootDrops`, and `currencyDrop` on `EntityTemplateSchema`.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical SSOT Owner | Legacy / Broken Code Evicted or Replaced |
| :--- | :--- | :--- |
| **Multi-Denomination Currency Math, Conversion & Formatting** | `src/systems/currency.system.ts` (Tier 1 Console) + `src/types/campaign/meta.ts` (`CurrencyConfigSchema`) | Unconnected `dndData.goldCurrency ?? 0` stub in `dnd35e_ui_adapter.ts:106` and `classic_ui_adapter.ts:209` |
| **D&D 3.5e Monetary Config (`cp/sp/ep/gp/pp`) & Starting Purse** | `src/rulesets/dnd35e/currency.ts` (or `dnd35e_ruleset.ts` `getCurrencyConfig`) + `starting_packages.ts` (`startingGoldGp`) | Hardcoded `0 gp` in Character Creation (`builder_hydrator_creation.ts`) |
| **Merchant Stock vs. Personal Inventory & Trade Transactions** | `src/systems/shop.system.ts` (`executeBuyItem`, `executeSellItem`, `executeTradeHaggle`) + `src/utils/trade.ts` + `src/rendering/ui/trade.ui.ts` | Broken `npcInventory.items` iteration and empty `buyBtn.onclick = () => {}` stub in `src/rendering/ui/trade.ui.ts:68-97` |
| **Cartridge Trade Pricing & Skill-Keyed Social/Dialogue Checks** | `RulesetContract` (`evaluateTradePriceModifier`, `resolveSocialSkillCheck`) + `src/rulesets/dnd35e/skills/social_combat_skill_verbs.ts` + `src/systems/trigger/social*.ts` | Disconnected `barter` verb with no handler in `apply.system.ts` |
| **Post-Spawn Actor Statblock Hydration (`maxHp`, `hp`, `level`, `RulesetData`)** | `RulesetContract.onEntitySpawned` + `src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts` | Raw `template.fighter.maxHp` overriding `chassis.maxHp` for `archetypeId` actors at spawn (`ecs_spawner.ts:81-93`, `dnd35e_dag_adapter.ts:462`) |
| **DMG Table 2-6 CR-vs-ECL XP Calculation** | `RulesetContract.resolveKillXpReward` + `src/rulesets/dnd35e/progression/cr_xp_table.ts` | Static classic `fighter.xpGiven` (`10`, `50`, `150`) passed directly in `death.system.ts:132` |
| **Template `defaultEquipment`, `lootDrops` & Death Equipment/Coin Drops** | `src/types/campaign/entity.ts` + `src/core/ecs/ecs_spawner_equipment.ts` + `src/systems/death.system.ts` | Race-only `defaultEquipment` lookup (`ecs_spawner_equipment.ts:106`) and global-only `lootTable` roll that destroyed carried gear (`death.system.ts:148-161`) |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Recognizing coin / currency items on pickup** | `if (itemId === 'gold_coin' \|\| itemId.startsWith('coin_'))` | `ItemDefinitionSchema.currencyGrant?: { denominationId: string; amount: number }` | **Yes** — any modder can author a new currency token or pouch in `items.json` with zero `.ts` edits |
| **Defining coin denominations & exchange rates** | Hardcoding `cp = 1, sp = 10, gp = 100` inside `trade.ui.ts` | `RulesConfigSchema.currency?: CurrencyConfigSchema` + `RulesetContract.getDefaultCurrencyConfig()` | **Yes** — any campaign or ruleset can define custom denominations (`credits`, `shells`, `cp/sp/ep/gp/pp`) |
| **Equippable loadouts for monster/NPC variants** | `if (templateId === 'goblin_archer') equip('shortbow')` | `EntityTemplateSchema.defaultEquipment?: Array<{ itemId: string; equipSlot?: EquipmentSlot; dropOnDeath?: boolean }>` | **Yes** — any variant entity template declares its own loadout in `entities.json` |
| **Per-creature loot & coin purse drops on death** | `if (templateId === 'bandit_king') spawn('gold_chest')` | `EntityTemplateSchema.lootDrops?: Array<{ itemId: string; chance: number; minCount?: number; maxCount?: number }>` + `currencyDrop?: { minBaseUnits: number; maxBaseUnits: number; chance: number; coinItemId?: string }` | **Yes** — purely data-driven in `entities.json` |
| **Dialogue skill checks & price/attitude consequences** | Hardcoding NPC dialogue IDs in `dialogue.actions.ts` | Declarative `ConditionPredicateSchema` (`skill_rank`, `has_currency`, `attitude_tier`) & `ConsequenceActionSchema` (`skill_check`, `modify_currency`, `set_attitude`, `modify_session_markup`) | **Yes** — any dialogue node/option in `dialogues.json` can gate or branch on any skill or coin amount |

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Authors / Data) | Downstream (Consumers / UI / Validators) | Lateral (Mirrors / Sibling Registries) |
| :--- | :--- | :--- | :--- |
| **1. `CurrencyConfigSchema` & `InventoryComponent.currencyBalance`** | `rules.json`, `RulesetContract.getDefaultCurrencyConfig`, `ecs_spawner.ts`, `builder_hydrator_creation.ts`, `inventory.system.ts` (coin pickup) | `currency.system.ts`, `trade.ts`, `trade.ui.ts`, `dnd35e_ui_adapter.ts`, `classic_ui_adapter.ts`, `console_inventory.ui.ts`, `save.ts` (JSON serializable `number`) | `UIInventoryModel.goldCurrency` + new `currencyFormatted?: string` / `currencyBreakdown?: ReadonlyArray<{ label: string; amount: number }>` |
| **2. Trade / Barter Actions & `RulesetContract` Social/Price Hooks** | `trade.ui.ts`, `dialogue.actions.ts`, `apply.system.ts` (`verb: 'barter' \| 'buy' \| 'sell' \| 'haggle'`), `social.system.ts` | `shop.system.ts` (`ShopComponent.inventory`, `InventoryComponent`), `MemoryComponent.sessionMarkupModifier`, `AttitudeComponent`, `MessageLog` | `ConditionPredicateSchema` & `ConsequenceActionSchema` in `trigger.types.ts`, `condition_evaluators.ts`, `consequence_appliers.ts` |
| **3. `RulesetContract.onEntitySpawned` & `resolveKillXpReward`** | `ecs_spawner.ts` (`spawnEntity`), `death.system.ts` (`processDeathSystem`) | `FighterComponent` (`maxHp`, `hp`, `level`), `RulesetDataComponent`, `dnd35e_dag_adapter.ts`, `grantDnD35eXp` | `classic_ruleset.ts` leaves hooks `undefined` so `default`, `shroudgarde`, and `megacampaign` behave identically to before |
| **4. `EntityTemplateSchema` (`defaultEquipment`, `lootDrops`, `currencyDrop`)** | `entities.json`, `ecs_spawner_equipment.ts`, `death.system.ts` | `entity.validator.ts` (verifies every `defaultEquipment[].itemId`, `lootDrops[].itemId`, and `currencyDrop.coinItemId` exists in `campaign.items`) | `DnD35RaceDefinition.defaultEquipment` remains fallback when `template.defaultEquipment` is omitted |
| **5. New Campaign `realms-of-shroudgarde`** | `public/data/campaigns.json`, `public/data/campaigns/realms-of-shroudgarde/*.json` | `scripts/run-validator.ts`, `validateReachability`, `checkDnD35eRuleset`, `narrative_fuzzer`, `scripts/visualize-campaign.ts`, `docs/CAMPAIGN_TOPOLOGIES.md` | Existing 4 campaigns (`default`, `dnd35e-crypt`, `shroudgarde`, `megacampaign`) and `ai-prompt-kit/default-campaign` remain untouched |

---

## 5. Phased Implementation Plan & Code Specifications

### Phase 1 (Milestone 142): Tier 1 Console Multi-Denomination Currency Engine & Tier 2 D&D 3.5e Monetary Standard

#### 1.1 Schema & Component Additions (`src/types/campaign/meta.ts`, `src/types/campaign/item.ts`, `src/types/components/item_components.types.ts`)
- In `src/types/campaign/meta.ts`, define `CurrencyDenominationSchema` and `CurrencyConfigSchema` and attach optional `currency?: CurrencyConfigSchema` to `RulesConfigSchema`:
```ts
/** Zod schema for a single monetary denomination relative to the campaign's base coin (`valueInBaseUnits = 1`). */
export const CurrencyDenominationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shortLabel: z.string().min(1),
  valueInBaseUnits: z.number().int().positive(),
  weightLbsPerCoin: z.number().nonnegative().default(0.02)
});
export type CurrencyDenomination = z.infer<typeof CurrencyDenominationSchema>;

/** Zod schema for system-agnostic multi-denomination currency configuration. */
export const CurrencyConfigSchema = z.object({
  baseDenominationId: z.string().min(1),
  standardPriceDenominationId: z.string().min(1),
  denominations: z.array(CurrencyDenominationSchema).min(1)
});
export type CurrencyConfig = z.infer<typeof CurrencyConfigSchema>;
```
- In `src/types/campaign/item.ts`, add optional `currencyUnit?: string` (defaults to `currency.standardPriceDenominationId`, e.g., `'gp'` in D&D 3.5e) and optional `currencyGrant?: { denominationId: string; amount: number }` (so coin pouches/piles auto-convert into the actor's wallet on pickup).
- In `src/types/components/item_components.types.ts`, extend `InventoryComponent`:
```ts
export interface InventoryComponent {
  readonly type: ComponentType.Inventory;
  readonly items: ReadonlyArray<EntityId>;
  readonly baseCapacity: number;
  /** Total actor wealth stored in canonical base currency units (e.g. copper pieces `cp` in D&D 3.5e). */
  readonly currencyBalance?: number | undefined;
}
```

#### 1.2 Tier 1 Console Currency Engine (`src/systems/currency.system.ts`)
- Create `src/systems/currency.system.ts` providing pure, deterministic functions:
  - `resolveCurrencyConfig(state: Readonly<GameState>): CurrencyConfig` (reads `state.campaign.rules.currency ?? getActiveRuleset(state).getDefaultCurrencyConfig?.() ?? DEFAULT_CONSOLE_CURRENCY_CONFIG`).
  - `toBaseCurrencyUnits(amount: number, denominationId: string, config: CurrencyConfig): number`
  - `convertBetweenDenominations(amount: number, fromId: string, toId: string, config: CurrencyConfig): number`
  - `resolveItemValueInBaseUnits(itemDef: ItemDefinition, config: CurrencyConfig): number` (converts `itemDef.baseValue` from `itemDef.currencyUnit ?? config.standardPriceDenominationId` into integer base units).
  - `decomposeBaseUnitsToCoins(totalBaseUnits: number, config: CurrencyConfig, includeElectrum?: boolean): ReadonlyArray<{ readonly denomination: CurrencyDenomination; readonly count: number }>`
  - `formatCurrencyCompact(totalBaseUnits: number, config: CurrencyConfig): string` (e.g. `"15 gp, 4 sp, 2 cp"` or `"0 gp"`).
  - `getActorCurrencyBalance(state: Readonly<GameState>, entityId: EntityId): number`
  - `addActorCurrency(state: GameState, entityId: EntityId, deltaBaseUnits: number): GameState`
  - `trySpendActorCurrency(state: GameState, entityId: EntityId, costBaseUnits: number): { readonly state: GameState; readonly success: boolean }`

#### 1.3 Tier 2 D&D 3.5e Monetary Standard (`src/rulesets/dnd35e/currency.ts`, `builder/starting_packages.ts`, `ui/dnd35e_ui_adapter.ts`)
- Define `DND35E_DEFAULT_CURRENCY_CONFIG`:
  - `baseDenominationId: 'cp'`, `standardPriceDenominationId: 'gp'`
  - Denominations:
    - `pp` (Platinum Piece, `valueInBaseUnits: 1000`, `0.02 lbs`)
    - `gp` (Gold Piece, `valueInBaseUnits: 100`, `0.02 lbs`)
    - `ep` (Electrum Piece, `valueInBaseUnits: 50`, `0.02 lbs`)
    - `sp` (Silver Piece, `valueInBaseUnits: 10`, `0.02 lbs`)
    - `cp` (Copper Piece, `valueInBaseUnits: 1`, `0.02 lbs`)
- Add `startingGoldGp: number` (e.g., `25 gp`–`40 gp` pocket coin after kit purchase) to `StartingEquipmentPackage` in `src/rulesets/dnd35e/builder/starting_packages.ts` and credit `startingGoldGp * 100` base units (`cp`) onto `InventoryComponent.currencyBalance` (and `dndData.goldCurrency`) in `applyCharacterCreationToPlayer` (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`) and default spawn.
- Update `src/systems/inventory.system.ts` (`processPickupIntent`): when picking up an item whose `ItemDefinition.currencyGrant` is defined, credit `toBaseCurrencyUnits(grant.amount, grant.denominationId, config)` to `InventoryComponent.currencyBalance`, log `"You pick up <name> (<formatted value>)."`, and remove the picked-up coin entity cleanly instead of cluttering a backpack slot.
- Project `currencyFormatted` (e.g., `"25 gp, 4 sp"`) and `goldCurrency` in `UIInventoryModel` (`src/types/ui_adapter.types.ts`, `dnd35e_ui_adapter.ts`, `console_inventory.ui.ts`).

---

### Phase 2 (Milestone 143): Pluggable Trade/Barter System, Interactive Trade UI & Skill-Keyed Social/Dialogue Checks

#### 2.1 `RulesetContract` Trade & Social Skill Hooks (`src/types/ruleset.types.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`)
- Extend `RulesetContract` in `src/types/ruleset.types.ts`:
```ts
export interface RulesetTradePriceEvaluation {
  /** Additive modifier to the merchant's markup multiplier (negative = better prices for buyer). */
  readonly markupDelta: number;
  /** Human-readable breakdown badges shown in the Trade UI (e.g. "Attitude (Friendly): -10%", "Appraise (+6): -5%"). */
  readonly breakdownLabels: ReadonlyArray<string>;
}

export interface RulesetSocialTradeActionResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly message: string;
}
```
- Add optional methods to `RulesetContract`:
  - `getDefaultCurrencyConfig?(): CurrencyConfig;`
  - `evaluateTradePriceModifier?(state: Readonly<GameState>, shopEntityId: EntityId, buyerEntityId: EntityId, isSellingToShop: boolean): RulesetTradePriceEvaluation;`
  - `resolveTradeSocialSkill?(state: GameState, buyerEntityId: EntityId, shopEntityId: EntityId, actionId: 'appraise' | 'persuade' | 'bluff' | 'intimidate'): RulesetSocialTradeActionResult;`
  - `evaluateDialogueSkillCheck?(state: GameState, playerEntityId: EntityId, npcEntityId: EntityId, skillId: string, dc: number, mode?: 'roll' | 'take10'): { readonly state: GameState; readonly success: boolean; readonly totalRoll: number; readonly dc: number };`

#### 2.2 D&D 3.5e Trade Pricing & Haggle Implementation (`src/rulesets/dnd35e/skills/trade_social_checks.ts`)
- Implement `evaluateDnD35eTradePriceModifier`:
  - Evaluates NPC `AttitudeTier` (`helpful: -0.20`, `friendly: -0.10`, `indifferent: 0`, `unfriendly: +0.25`, `hostile: +1.00`).
  - Evaluates passive `Appraise` synergy (`Take 10 + Appraise modifier` vs DC 15: `>= 15` grants `-0.05` markup modifier and reveals true base value; `< 10` untrained adds `+0.05` markup).
- Implement `resolveDnD35eTradeSocialSkill` (usable once per merchant per day, tracked in `MemoryComponent.facts` with day stamp or `sessionMarkupModifier`):
  - **`appraise` (Appraise vs Merchant Appraise/DC 15):** Identifies true item value and shaves `10%` off markup spread.
  - **`persuade` (Diplomacy check per SRD `resolveDiplomacyCheck`):** Shifts merchant `AttitudeComponent` (`indifferent -> friendly -> helpful`), improves `sessionMarkupModifier` by `-0.15`, and boosts `relationshipAxes.respect` (`+15`). Failing by 5+ worsens markup by `+0.15`.
  - **`bluff` (Bluff vs Merchant Sense Motive `Take 10 + mod`):** Fast-talks merchant into `-0.20` discount on next trade; failure annoys merchant (`annoyedDuration: 10`, `+0.20` markup).
  - **`intimidate` (Intimidate vs `10 + HD + WIS mod`):** Demoralizes merchant into `-0.15` discount (`fear +20`, `resentment +15`).

#### 2.3 Fix `trade.ui.ts`, `utils/trade.ts` & `shop.system.ts` Buy / Sell / Barter Loop
- Update `getEffectivePriceInBaseUnits(state, itemDef, shopEntityId, buyerEntityId, isSellingToShop)` in `src/utils/trade.ts` to combine Console social/faction/hierarchy modifiers with `getActiveRuleset(state).evaluateTradePriceModifier?.(...)` and return prices in canonical **base currency units** (formatted via `formatCurrencyCompact`).
- Fix `src/rendering/ui/trade.ui.ts`:
  - Read merchant wares directly from `shop.inventory` (fallback to `npcInventory.items` if `shop.inventory` is empty).
  - Display Player Purse (`pp / gp / sp / cp` breakdown), Merchant Disposition badge (`Attitude`, `Markup %`, active Ruleset price breakdown tags), and interactive Cartridge Social Action buttons (`[Diplomacy: Haggle]`, `[Appraise Wares]`, `[Bluff]`, `[Intimidate]`).
  - Wire `[Buy]` button -> dispatches `ApplyIntent` (`verb: 'buy'`, `toolEntityId: itemEntityId`, `target: { type: 'entity', entityId: npcId }`, `isImmediate: true`).
  - Wire `[Sell]` button -> dispatches `ApplyIntent` (`verb: 'sell'` or `'barter'`, `toolEntityId: itemEntityId`, `target: { type: 'entity', entityId: npcId }`, `isImmediate: true`).
- Handle `'buy'`, `'sell'`, `'barter'`, and `'haggle'` inside `src/systems/shop.system.ts` (invoked from `src/systems/apply.system.ts` and `VERBS` in `src/constants/verbs.constants.ts`):
  - **`buy`**: Checks `trySpendActorCurrency(state, buyerId, priceBaseUnits)`, removes `itemEntityId` from `shop.inventory`, appends `itemEntityId` to `playerInventory.items`, increments `memory.timesTraded`, and logs purchase.
  - **`sell` / `barter`**: Verifies `shop.buyTags` (or universal buy if `buyTags` includes `'all'` or item category/tags match), removes `itemEntityId` from `playerInventory.items` (and unequips if equipped), adds `itemEntityId` to `shop.inventory`, credits `sellPriceBaseUnits` to `playerInventory.currencyBalance`, and logs sale.

#### 2.4 Skill-Keyed Dialogue Conditions & Consequences (`src/types/trigger.types.ts`, `src/systems/trigger/social.ts`, `src/systems/trigger/social_consequences.ts`)
- Extend `ConditionPredicateSchema` (`src/types/trigger.types.ts`):
  - `has_currency`: `{ type: 'has_currency', amount: number, denominationId?: string }`
  - `attitude_tier`: `{ type: 'attitude_tier', operator: '>=' | '<=' | '==', tier: 'hostile' | 'unfriendly' | 'indifferent' | 'neutral' | 'friendly' | 'helpful' }`
  - `skill_modifier`: `{ type: 'skill_modifier', skillId: string, operator: '>=' | '<=' | '==', value: number }`
- Extend `ConsequenceActionSchema` (`src/types/trigger.types.ts`):
  - `modify_currency`: `{ type: 'modify_currency', amount: number, denominationId?: string }` (positive grants coins, negative spends coins)
  - `set_attitude`: `{ type: 'set_attitude', attitude: 'hostile' | 'unfriendly' | 'indifferent' | 'neutral' | 'friendly' | 'helpful', targetId?: string }`
  - `modify_session_markup`: `{ type: 'modify_session_markup', delta: number }`
  - `skill_check`: `{ type: 'skill_check', skillId: string, dc: number, mode?: 'roll' | 'take10', onSuccess: Array<Record<string, unknown>>, onFailure?: Array<Record<string, unknown>> }` — evaluates `getActiveRuleset(state).evaluateDialogueSkillCheck`, logs the roll vs DC to the message log, and executes `onSuccess` or `onFailure` consequence arrays!

---

### Phase 3 (Milestone 144): Post-Spawn Statblock Hydration, DMG Table 2-6 CR-to-XP & Declarative Equipment/Loot/Currency Death Drops

#### 3.1 `EntityTemplateSchema` Equipment, Loot & Currency Drop Extensions (`src/types/campaign/entity.ts`, `src/editor/validator/entity.validator.ts`)
- Extend `EntityTemplateSchema` in `src/types/campaign/entity.ts`:
```ts
  defaultEquipment: z
    .array(
      z.object({
        itemId: z.string(),
        equipSlot: EquipmentSlotEnum.optional(),
        dropOnDeath: z.boolean().default(true)
      })
    )
    .optional(),
  lootDrops: z
    .array(
      z.object({
        itemId: z.string(),
        chance: z.number().min(0).max(1).default(1),
        minCount: z.number().int().positive().default(1),
        maxCount: z.number().int().positive().default(1)
      })
    )
    .optional(),
  currencyDrop: z
    .object({
      minBaseUnits: z.number().int().nonnegative(),
      maxBaseUnits: z.number().int().nonnegative(),
      chance: z.number().min(0).max(1).default(1),
      coinItemId: z.string().optional()
    })
    .optional(),
```
- Update `src/core/ecs/ecs_spawner_equipment.ts` (`equipActorDefaultArmaments`):
  - Check `template?.defaultEquipment` first, falling back to `sysRaces?.[archetypeKey]?.defaultEquipment ?? sysArchetypes?.[archetypeKey]?.defaultEquipment ?? []`.
- Update `src/editor/validator/entity.validator.ts`:
  - Validate that every `itemId` in `entity.defaultEquipment` and `entity.lootDrops` (and `entity.currencyDrop.coinItemId` if specified) exists in `campaign.items`.

#### 3.2 Death System Equipment, Loot & Coin Pouch Drops (`src/systems/death.system.ts`)
- In `processDeathSystem` (`src/systems/death.system.ts`), before `removeEntity(nextState, entityId)`:
  1. **Equipped & Carried Item Drops:** Inspect victim's `InventoryComponent.items` (note: merchant `ShopComponent.inventory` is separate and never dropped). For each item entity in `inventory.items`, check if `template?.defaultEquipment` explicitly set `dropOnDeath: false` for that `itemId`; otherwise, attach `PositionComponent({ x: pos.x, y: pos.y })` to the existing item entity (and remove it from `inventory.items` / `equipment.slots`) so the exact item instance (including any coatings/enhancements/charges) drops onto the ground tile instead of being destroyed by `removeEntity`!
  2. **Template `lootDrops`:** Roll each entry in `template.lootDrops` using `rng.getUniform() < entry.chance` and spawn `rng.getUniformInt(entry.minCount, entry.maxCount)` instances at `(pos.x, pos.y)`.
  3. **Template `currencyDrop` (or Victim `currencyBalance`):** If `template.currencyDrop` rolls `< chance` (or victim had `inventory.currencyBalance > 0`), compute dropped `baseUnits`, spawn a coin pouch item (`coinItemId ?? 'gold_pouch'`) at `(pos.x, pos.y)` or credit/encode the dynamic coin amount on `ItemComponent.charges` (with `processPickupIntent` multiplying `currencyGrant.amount * (itemComp.charges ?? 1)`!).
  4. **Global `lootTable` Fallback:** Only roll global `campaign.rules.spawning.lootTable` if the entity had no template `lootDrops` and dropped 0 equipped items.

#### 3.3 Post-Spawn Statblock Hydration & DMG Table 2-6 CR-to-XP (`src/types/ruleset.types.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`, `src/rulesets/dnd35e/progression/cr_xp_table.ts`)
- Add `onEntitySpawned?(state: GameState, entityId: EntityId): GameState` and `resolveKillXpReward?(state: Readonly<GameState>, killerId: EntityId, victimId: EntityId): number` to `RulesetContract`.
- Invoke `getActiveRuleset(nextState).onEntitySpawned?.(nextState, entityId)` at the end of `spawnEntity` (`src/core/ecs/ecs_spawner.ts:324`).
- In `src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts`:
  - For non-player actors with `FighterComponent` and a resolvable D&D 3.5e archetype/race or `rulesetData`:
    - Resolve `dndData = getDnD35EntityData(state, entityId)` (incorporating `template.rulesetData` overrides like `tracks`, `templates`, `abilityScores`, `feats`, `cr`).
    - Compute `conMod` (0 if `con.base === null`) and `chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0)`.
    - Persist `setDnD35EntityData(state, entityId, dndData)` and sync `syncActorResourcePoolsComponent`.
    - Update `FighterComponent` with `maxHp: Math.max(1, chassis.maxHp)`, `hp: Math.max(1, chassis.maxHp)`, `level: Math.max(1, chassis.ecl)`, `attack: chassis.totalBab` (unless `template.rulesetData?.['lockFighterMaxHp'] === true`).
- In `src/rulesets/dnd35e/progression/cr_xp_table.ts`:
  - Implement D&D 3.5e **DMG Table 2-6** (`computeDnD35eKillXp(killerEcl: number, victimCr: number): number`):
    - Base XP for an even-match encounter (`CR === ECL`, with `effectiveEcl = Math.max(3, killerEcl)` per DMG Table 2-6 footnote for ECL 1–3): `300 * effectiveEcl` XP.
    - Fractional CRs (`CR < 1`, e.g., `0.5`, `0.33`, `0.25`, `0.125`): scales `computeDnD35eKillXp(effectiveEcl, 1) * victimCr` (`CR 1/2 = 150 XP`, `CR 1/3 = 100 XP`, `CR 1/4 = 75 XP` at ECL 1–3).
    - Relative CR difference (`delta = Math.round(victimCr) - effectiveEcl`): doubles every `+2 CR` (`* 2^(delta/2)`), halves every `-2 CR`, and returns `0 XP` if `delta <= -8` (trivial threat).
  - Wire `resolveKillXpReward` in `dnd35e_ruleset.ts` and call `const xpReward = getActiveRuleset(nextState).resolveKillXpReward?.(nextState, deathComp.killerId, entityId) ?? fighter.xpGiven;` in `src/systems/death.system.ts:132`.

---

### Phase 4 (Milestone 145): Curated D&D 3.5e Creature & NPC Catalogue, Monetary Items & 385-Sprite Atlas Binding

- Author currency & treasure items in `public/data/rulesets/dnd35e/items/` (or campaign `items.json`):
  - `copper_coins` (`currencyGrant: { denominationId: 'cp', amount: 1 }`), `silver_coins` (`sp: 1`), `electrum_coins` (`ep: 1`), `gold_coins` (`gp: 1`), `platinum_coins` (`pp: 1`), `silver_pouch` (`sp: 25`), `gold_pouch` (`gp: 25`), `royal_platinum_chest` (`pp: 10`), plus tradeable gemstones (`onyx_gem` 50 gp, `sapphire_gem` 250 gp, `ruby_gem` 500 gp, `diamond_gem` 1000 gp) and campaign quest relics (`trance_antidote`, `blessed_chalice`, `tribal_banner`, `soul_gem_inert`, `water_temple_key`, `serpent_signet`, `lareth_diary`, `orb_of_golden_death`).
- Curate **~140+ D&D 3.5e Entities** in `public/data/campaigns/realms-of-shroudgarde/entities.json`:
  - **Every single entity** has:
    - Valid `spriteId` mapped from the 385-sprite atlas (`monsters.png`, `rogues.png`, `tiles.png`, `items.png`) — **0 missing-sprite warnings**!
    - Valid `archetypeId` (`goblin`, `kobold`, `orc`, `hobgoblin`, `bugbear`, `gnoll`, `lizardfolk`, `troglodyte`, `ogre`, `troll`, `hill_giant`, `fire_giant`, `stone_giant`, `frost_giant`, `ettin`, `minotaur`, `medusa`, `gargoyle`, `harpy`, `manticore`, `chimera`, `hydra`, `basilisk`, `cockatrice`, `bulette`, `owlbear`, `displacer_beast`, `phase_spider`, `giant_spider`, `wolf`, `dire_wolf`, `worg`, `winter_wolf`, `dire_rat`, `giant_ant`, `giant_bee`, `giant_beetle`, `carrion_crawler`, `rust_monster`, `umber_hulk`, `mind_flayer`, `aboleth`, `beholder`, `mimic`, `gelatinous_cube`, `ochre_jelly`, `black_pudding`, `skeleton`, `zombie`, `ghoul`, `ghast`, `wight`, `wraith`, `shadow`, `spectre`, `mummy`, `vampire_spawn`, `clay_golem`, `flesh_golem`, `stone_golem`, `iron_golem`, `salamander`, `imp`, `quasit`, `dretch`, `vrock`, `glabrezu`, `marilith`, `balor`, `succubus`, `lemure`, `bearded_devil`, `bone_devil`, `horned_devil`, `ice_devil`, `pit_fiend`, `hound_archon`, `astral_deva`, `dragon_red_young`, `dragon_black_adult`, `dragon_white_juvenile`, `dragon_green_young_adult`, `dragon_blue_old`, `elemental_air_large`, `elemental_earth_large`, `elemental_fire_large`, `elemental_water_large`, `human`, `dwarf`, `elf`, `halfling`, `gnome`, `half_orc`).
    - Explicit `rulesetData` (`cr`, `tracks` for NPC/PC classes like `warrior`, `expert`, `adept`, `aristocrat`, `commoner`, `fighter`, `cleric`, `wizard`, `rogue`, `druid`, `barbarian`, `ranger`, `paladin`, `monk`, plus `templates` like `skeleton`, `zombie`, `fiendish`, `celestial`, `vampire`, `lich`, `ghost`, `half_dragon`).
    - Authentic `defaultEquipment` (weapons, shields, armor, potions, scrolls, wands), `lootDrops`, and `currencyDrop`.
  - **Memorable Named NPCs & Bosses:**
    - *Sanctuary Outpost:* `barkeeper` (Expert 3), `merchant` (Expert 4, General Outfitter Shop), `armorer_garrick` (Dwarf Expert 5, Weapons & Armor Shop), `scholar` (Wizard 5 / Lorekeeper), `scout` (Ranger 4).
    - *Shroudgarde Keep & Orlane:* `gold_dwarf_laurent` (Aristocrat 4 / Fighter 2, Mayor), `aasimar_isabelle` (Cleric 6 of Pelor, Temple Healer & Divine Shop), `constable_derek` (Fighter 5, Watch Captain), `wood_elf_luc` (Druid 5, Herbalist Shop), `barkeep_bertram` (Expert 3, Golden Grain Innkeeper & Tavern Shop), `elan_villager`, `villager_scared`, `villager_subverted`.
    - *Nulb Smuggler Town:* `nulb_innkeeper_wat` (Rogue 4 / Expert 2, Black-Market Fence Shop), `pirate_tolub` (Barbarian 5), `mother_screaming` (Adept 6, Witch-Trader Shop).
    - *Named Bosses & Masterminds:* `bandit_king` (Human Fighter 4 / Rogue 2, CR 6), `lareth_beautiful` (Human Cleric 5 of Lolth, CR 5, Masterwork Plate + Staff of Striking), `duthkagith_priest` (Half-Dragon Hobgoblin Cleric 7, CR 8), `sentinel_imues` (Water Elemental Gargantuan / Guardian CR 9), `vodyanoi_boss` (Aquatic Umber Hulk / Vodyanoi King CR 8), `arch_lich_inverness` (Human Lich Wizard 11, CR 13, Ghost Tower Pinnacle), `goblin_high_king_rug` (Goblin Barbarian 6 / Fighter 2, CR 7), `zuggtmoy_boss` (Demon Queen of Fungi, Outsider 16 HD, CR 15).

---

### Phase 5 (Milestone 146): `realms-of-shroudgarde` Multi-Layered World Topology (~75 Areas), Quests, Dialogues & Verification

#### 5.1 Multi-Layered World Graph (`public/data/campaigns/realms-of-shroudgarde/areas.json` — ~75 Interconnected Areas)
1. **Surface Layer — Cities, Towns & Roadside Inns (9 Areas):**
   - `outer_crossroads` (Outdoors Digger) ↔ `safe_hub` (Sanctuary Outpost, Indoors Static, Starting Area) ↔ `shrine_vault_hub` (Underground Static).
   - `borderland_highroad` (Outdoors Cellular road) linking `outer_crossroads` ↔ `shroudgarde_gate` (Outdoors Static).
   - `shroudgarde_gate` ↔ `shroudgarde_courtyard` (Outdoors Static) ↔ `shroudgarde_inner_keep` (Indoors Static) & `orlane_east` (Outdoors Digger).
   - `golden_grain_inn` (Indoors Static) off `marsh_mirrored`.
   - `nulb_village` (Outdoors Static smuggler river-town) + `nulb_waterside_hostel` (Indoors Static tavern/fence) along `road_to_nulb`.
2. **Surface Layer — Interconnected Outdoor Wilderness Regions (7 Areas):**
   - `outer_crossroads`, `borderland_highroad`, `forest_haunted` (La Forêt Hantée), `corrupted_thicket` (Corrupted Treant & Spider Broodmother woods linking `forest_haunted` ↔ `outer_crossroads`), `ravine_chaos` (Ravine of Chaos surface hub), `marsh_mirrored` (Mirrored Marsh), `road_to_nulb` (River Road), and `northern_crags` (Mountain pass linking `ravine_chaos` ↔ `megadungeon_hub` & `ghost_tower_courtyard`).
3. **Multi-Floor Vertical Towers (3 Towers, 14 Areas):**
   - **Tower 1 — The Elemental Spire (`5` floors):** `spire_level_air` ↔ `spire_level_earth` (also links underground to `cave_scro`) ↔ `spire_level_fire` ↔ `spire_level_water` ↔ `spire_gem_chamber`.
   - **Tower 2 — The Ghost Tower of Inverness (`5` floors):** `ghost_tower_courtyard` (off `northern_crags` / `marsh_mirrored`) → `ghost_tower_1_gallery` → `ghost_tower_2_clockwork` → `ghost_tower_3_astral` → `ghost_tower_4_pinnacle` (Arch-Lich of Inverness & Soul Gem Vault), plus basement stair down to `nethack_doom_4`.
   - **Tower 3 — The Sunless Watchtower (`4` floors):** `watchtower_ground` (off `outer_crossroads`) → `watchtower_barracks` → `watchtower_armory` → `watchtower_observatory`.
4. **Underground Layer 1 — Crypts, Caverns, Sewers & Temples (24 Areas):**
   - **Sunless Reliquary:** `dungeon_1` → `dungeon_2` → `bandit_stronghold` (with smuggling tunnel to `shroudgarde_inn_cellar`).
   - **Caves of Chaos:** `cave_kobolds` ↔ `cave_norkers` (with lateral warren), `cave_bugbears` (links down to `incursion_goblin_1`), `cave_scro` (links to `spire_level_earth`), `cave_ogre`.
   - **Inn Cellar & Flooded Cult Caverns:** `shroudgarde_inn_cellar` → `wet_caverns` → `reptile_temple` → flooded passage to `water_temple_lower`.
   - **Water Temple Complex:** `water_temple_upper` ↔ `water_temple_lower` ↔ `water_temple_core` ↔ `water_temple_valve_room`.
   - **Moathouse & Temple of Elemental Evil:** `moathouse_surface` → `moathouse_dungeons` (with smuggler sewer to `nulb_village`) → `toee_level_1` → `toee_level_2` → `toee_level_3` (cross-tunnel to `nethack_doom_7`) → `toee_level_4` → `toee_zuggtmoy_fane`.
5. **Underground Layer 2 & 3 — Deep Megadungeon Strata & Woven Incursion Vaults (32 Areas):**
   - **Incursion Goblin Caves (`incursion_goblin_1..10` + 4 Vaults):**
     - Entered from `cave_bugbears` / `ravine_chaos`.
     - `incursion_place_of_sanctuary` off Goblin 2; `incursion_the_goblin_encampment` off Goblin 4; `incursion_lesser_vault_1` off Goblin 6; `incursion_arena_chamber` off Goblin 8; Goblin 10 connects laterally to `nethack_doom_6`.
   - **Dungeons of Doom (`megadungeon_hub` + `nethack_doom_1..10` + 7 Vaults):**
     - Entered from `northern_crags` → `megadungeon_hub` (with non-overlapping, walkable portals!).
     - `incursion_entry_chamber` off `megadungeon_hub` / Doom 1; `incursion_parthenion` off Doom 3; `incursion_lesser_vault_2` off Doom 4; `incursion_floating_rock_1` off Doom 5; `incursion_unholy_sepulchre` off Doom 6; `incursion_entry_chamber_hells` off Doom 8; `incursion_hellish_rift` off Doom 10.

#### 5.2 Merged Quests, Skill-Keyed Dialogues, Schemes & Documentation
- Combine & upgrade all quests from `dnd35e-crypt` (`4` quests) and `shroudgarde` (`9` quests) plus `3` new overarching regional quests (*The Ghost Tower of Inverness*, *The Goblin Under-Empire*, *The Infernal Rift of Doom*) = **16 Quests** in `quests.json`.
- Merge all dialogue trees (`15+` dialogues) and enrich merchant/leader dialogues (`merchant_tree`, `mayor_dialogue`, `constable_dialogue`, `lareth_dialogue`, `barkeep_dialogue`, `hermit_dialogue`, `priest_dialogue`) with **D&D 3.5e skill-check options** (`Diplomacy`, `Bluff`, `Intimidate`, `Knowledge (Arcana/Religion/Local)`, `Sense Motive`) and coin bribes (`has_currency` / `modify_currency`)!
- Register `realms-of-shroudgarde` in `public/data/campaigns.json`, copy the 4 spritesheet PNGs (`tiles.png`, `rogues.png`, `monsters.png`, `items.png`), regenerate `docs/CAMPAIGN_TOPOLOGIES.md` (`bun run map:campaign --write`), update `docs/MILESTONES.md`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, `docs/DECISIONS.md`, write comprehensive unit/integration tests (`tests/currency_trade_and_campaign.test.ts`), and pass all 8 stages of `./verify.sh`.

---
**STOPPING HERE per `AGENTS.md` §1 Step 5:** Please review this phased Implementation Plan and confirm if I have your approval to begin executing Phase 1 through Phase 5.
