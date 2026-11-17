# Research Notes — Phase 40: Multi-Denomination Currency, Pluggable Trade/Barter & Social Skill System, Statblock/CR/Loot Overhaul, and `realms-of-shroudgarde` Campaign

## 1. Confirmed User Decisions (Step 3 Sign-Off)

1. **Decision 1 — Bestiary & NPC Curation:**
   - Approved. Do **not** blindly dump the 689 NetHack/Incursion stubs. Curate a memorable, authentic D&D 3.5e Creature & NPC Catalogue (~140+ templates) built from SRD races, templates (`skeleton`, `zombie`, `fiendish`, `celestial`, `half_dragon`, `vampire`, `lich`, `ghost`), and PC/NPC classes (`warrior`, `expert`, `adept`, `aristocrat`, `commoner`, `cleric`, `fighter`, `wizard`, `rogue`, `druid`), with 385-atlas sprite bindings.
2. **Decision 2 — New Flagship Campaign `realms-of-shroudgarde`:**
   - Approved. Create `public/data/campaigns/realms-of-shroudgarde/` (`rulesetId: 'dnd35e'`) and add it to `public/data/campaigns.json`. Keep `default`, `dnd35e-crypt`, `shroudgarde`, and `megacampaign` untouched so classic cartridge campaigns and `ai-prompt-kit` parity remain 100% intact.
3. **Decision 3 — Post-Spawn Statblock Hydration & DMG Table 2-6 CR-to-XP:**
   - Approved. Add `onEntitySpawned` and `resolveKillXpReward` hooks to `RulesetContract` (`src/types/ruleset.types.ts`) so `dnd35e` automatically hydrates true HD/class/template HP & components at spawn and computes DMG Table 2-6 CR-vs-ECL XP on kill.
4. **Decision 4 — Generic Console `defaultEquipment`, `lootDrops` & Death Drops:**
   - Approved. Add template-level `defaultEquipment` (with optional `dropOnDeath`), `lootDrops`, and `currencyDrop` to `EntityTemplateSchema` (`src/types/campaign/entity.ts`) as a generic Tier 1 Console capability reusable by any Cartridge.
5. **Decision 5 — Console Multi-Denomination Currency Engine + D&D 3.5e Monetary Standard + Cartridge-Pluggable Trade/Barter & Skill-Keyed Social Checks:**
   - Approved and expanded into a full architectural pillar:
     - **Tier 1 Console Currency Engine (`src/systems/currency.system.ts`):** System-agnostic monetary engine defining a `baseCoinId` (value `1`) and arbitrary coin denominations (`valueInBaseUnits`, `shortLabel`, `weightLbs`) convertible into base units and each other, stored on `InventoryComponent.currencyBalance` (in base units) with coin breakdown utilities (`decomposeBaseUnitsToCoins`, `convertBetweenDenominations`, `formatCurrencyString`).
     - **Tier 2 D&D 3.5e Canonical Monetary System:** Copper (`cp = 1`), Silver (`sp = 10`), Electrum (`ep = 50`), Gold (`gp = 100`), Platinum (`pp = 1000`), where standard SRD `baseValue` (in gp) maps to `100` base cp units (with optional item `currencyUnit` for cp/sp items), integrated into `STARTING_EQUIPMENT_PACKAGES`, Character Sheet, Inventory Panel, and Trade Modal.
     - **Fixed & Pluggable Trade / Barter / Social System (`src/systems/shop.system.ts`, `src/rendering/ui/trade.ui.ts`, `src/utils/trade.ts`, `RulesetContract`):**
       - Fix `trade.ui.ts` reading `npcInventory.items` instead of `shop.inventory` (and wire live Buy / Sell / Barter intents).
       - Add Cartridge hooks (`getCurrencyConfig`, `evaluateTradePriceModifier`, `resolveSocialTradeAction`) so D&D 3.5e evaluates `Appraise`, `Diplomacy`, `Bluff`, `Intimidate`, and `Sense Motive` to shift NPC `AttitudeTier`, `relationshipAxes`, and `sessionMarkupModifier` both inside the Trade UI and inside branching Dialogue Trees (`skill_check` conditions/consequences).

---

## 2. Codebase Root-Cause Summary

1. **Trade UI & Shop Inventory Mismatch (`src/core/ecs/ecs_spawner.ts:250-269` vs `src/rendering/ui/trade.ui.ts:68-103`):**
   - `spawnEntity` spawns merchant wares into `ShopComponent.inventory` (not `InventoryComponent.items`), while `trade.ui.ts:68` iterates `npcInventory.items` and checks `shop.inventory.includes(itemEntityId)`. Consequently, merchant shops render `"Out of stock!"` and the `Buy` button (`trade.ui.ts:94`) is an empty stub (`buyBtn.onclick = () => {}`).
   - Meanwhile, the `barter` verb dispatched by `sellBtn` (`trade.ui.ts:152`) has no handler in `apply.system.ts` or `reaction.system.ts`!
2. **Missing Multi-Coin Currency Engine (`src/types/components/item_components.types.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts:106`):**
   - `InventoryComponent` has only `items: ReadonlyArray<EntityId>` and `baseCapacity: number`. `dnd35e_ui_adapter.ts:106` reads `dndData.goldCurrency ?? 0`, which is never populated during character creation (`builder_hydrator_creation.ts`) or item pickup (`inventory.system.ts`).
3. **Statblock Override at Spawn (`src/core/ecs/ecs_spawner.ts:81-93`, `src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts:462`):**
   - `spawnEntity` sets `FighterComponent.maxHp` from `template.fighter.maxHp`, which overrides `chassis.maxHp` in `dag_resolver.ts:361` unless hydrated post-spawn via a `RulesetContract` hook.
4. **Static `xpGiven` vs D&D 3.5e CR (`src/systems/death.system.ts:132`, `src/rulesets/dnd35e/dnd35e_ruleset.ts:54`):**
   - `processDeathSystem` passes raw `fighter.xpGiven` instead of consulting a ruleset `resolveKillXpReward(state, killerId, victimId)` hook implementing DMG Table 2-6 CR-vs-ECL rewards.
5. **Missing Template-Level `defaultEquipment`, `lootDrops` & Death Equipment Drops (`src/core/ecs/ecs_spawner_equipment.ts:106`, `src/systems/death.system.ts:148`):**
   - `equipActorDefaultArmaments` only checks `sysRaces[archetypeKey].defaultEquipment`, and `processDeathSystem` destroys equipped/carried items when calling `removeEntity`.

---

## 3. Phased Milestone Organization (`docs/MILESTONES.md` — Phase 40: Milestones 142–146)

- **Milestone 142 (Phase 1):** Tier 1 Console Multi-Denomination Currency Engine & Tier 2 D&D 3.5e Monetary Standard (`cp/sp/ep/gp/pp`).
- **Milestone 143 (Phase 2):** Pluggable Trade/Barter System, Interactive Trade UI Overhaul & Skill-Keyed Dialogue/Haggle Checks (`Appraise`, `Diplomacy`, `Bluff`, `Intimidate`, `Sense Motive`).
- **Milestone 144 (Phase 3):** Post-Spawn Statblock Hydration (`onEntitySpawned`), DMG Table 2-6 CR-to-XP (`resolveKillXpReward`), and Declarative Template `defaultEquipment` / `lootDrops` / `currencyDrop` on Death.
- **Milestone 145 (Phase 4):** Curated D&D 3.5e Creature & NPC Catalogue, Monetary/Treasure Items, and 385-Sprite Atlas Binding for `realms-of-shroudgarde`.
- **Milestone 146 (Phase 5):** `realms-of-shroudgarde` Multi-Layered World Topology (~75 Areas: Cities, Wildernesses, Multi-Floor Towers, Underground Strata & Integrated Vaults), Merged Quests/Dialogues/Schemes, and 8-Stage Verification.
