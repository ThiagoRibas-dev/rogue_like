# Implementation Plan — Character Creation Final Summary, Identity, Sprite Picker, SRD Starting Kits & Custom Loadout

> **Status:** Phase 1, Steps 4–5 — Enhanced Implementation Plan (Awaiting User Approval before Code Execution)
> **Confirmed Decisions from Research Review:**
> 1. Move Character Name out of `topRow` into a dedicated final **`Review & Identity`** (`'summary'`) step featuring live DAG-derived character sheet preview, **Name + Randomize Name**, optional **Title / Epithet**, **ASCII Glyph Color Swatches**, optional **Character Traits / Mannerisms**, and **Sprite Picker** (Suggested Race/Class match, DCSS/32rogues Character sheets, plus Full Catalogue browser).
> 2. Wire the player's chosen sprite into the in-game **`[C]` Character Sheet portrait** (`.crpg-character-portrait` in `console_dossier.ui.ts`) via a Tier 1 Console atlas thumbnail helper while respecting `.dependency-cruiser.cjs` `headless-simulation-purity`.
> 3. Upgrade the Equipment step into a dedicated **Kit Inspector + Custom Buy Shop**: add all **11 PHB/SRD Class Starting Packages** (retaining the 4 legacy kits), SRD Goods & Services items modeled cleanly with **Root vs. Downstream (`baseItemId`) inheritance**, class starting gold (`average` / `roll` via `startingGoldDice`), free starter outfit selection (`0 lb` weight), and SRD encumbrance readouts via `computeEncumbranceState`.
> 4. Raise default inventory slot capacity to **`30`** and add **automated referential validation** in `checkDnD35eRuleset` + unit tests so missing starting-kit items or class default kit IDs fail loudly instead of being silently skipped.
> 5. Defer live runtime encumbrance penalties (`semantic_tags_context.ts` + DAG ACP/Max-Dex/Speed) to a dedicated follow-up milestone so combat/movement test baselines remain stable.

---

## 1. SSOT Ownership & Canonical Responsibilities Table

| Responsibility | Canonical Owner (After Change) | Tier | Notes |
|---|---|---|---|
| Playable character sprite sheet marker schema | `src/types/campaign/meta.ts` (`SpriteSheetSourceSchema`) | `tier1_types` | Optional `isCharacterSpriteSheet` boolean stamped in `pack.json`. |
| Declarative sprite catalog discovery & Race/Class token matcher | `src/utils/sprite_pack.ts` (`collectCatalogSpriteEntries`, `suggestCharacterSprites`) | `tier1_console` | Pure utilities; supports all loaded packs & legacy prefix fallback. |
| Active composited atlas snapshot & crisp pixel-art thumbnail slicing | `src/rendering/sprite_atlas.ts` (`setActiveSpriteAtlas`, `getActiveSpriteAtlas`, `renderSpriteToDataUrl`) | `tier1_console` | Populated/refreshed by `configureDisplayForCampaign` (`src/rendering/display.ts`). |
| Character Sheet portrait visual rendering | `src/rendering/ui/console_dossier.ui.ts` (consuming `UICharacterSheetModel.spriteId` / `glyph` / `glyphColor`) | `tier1_ui` | Zero `rendering/` imports inside `src/rulesets/`. |
| Default actor inventory slot capacity (`30`) | `src/core/ecs/ecs_spawner_equipment.ts` (`DEFAULT_ACTOR_INVENTORY_CAPACITY = 30`) & campaign `entities.json` | `tier1_console` | Prevents starting packs from spawning full. |
| SRD Goods & Services items & Class Starting Wealth schemas | `src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `system_content_item_ids.ts`, `public/data/rulesets/dnd35e/items/*.json`, `classes/*.json` | `tier2_types` / `tier3_content` | Composed via `baseItemId` root -> downstream inheritance. |
| Starting package definitions, wealth calculation & kit cost/weight math | `src/rulesets/dnd35e/builder/starting_packages.ts` | `tier2_cartridge` | Owns 11 SRD class packages + 4 legacy packages + pure buy/weight helpers. |
| Starting package & class default kit referential validator | `src/rulesets/dnd35e/dnd35e_validator.ts` (`checkDnD35eRuleset`) | `tier2_cartridge` | Hard errors if any package `itemId`, `freeOutfitId`, or class `defaultStartingPackageId` is missing. |
| Pure character creation hydration & preview state generation | `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts` (`applyCharacterCreationToPlayer`) | `tier2_cartridge` | Persists preset/custom gear, coin balance, `IdentityComponent`, and `RenderableComponent`. |
| Equipment step UI (Preset Kits Inspector & Custom Buy Shop) | `src/rendering/ui/dnd35e_char_builder_equipment.ui.ts` | `tier2_ui` | Re-exported by `dnd35e_char_builder_steps.ui.ts`. |
| Final Review & Identity step UI (Hero Preview, Name, Title, ASCII Color, Traits, Sprite Picker, Full Live Sheet) | `src/rendering/ui/dnd35e_char_builder_summary.ui.ts` | `tier2_ui` | Orchestrated as final step `'summary'` in `dnd35e_char_builder.ui.ts`. |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
|---|---|---|---|
| Discovering selectable character sprites | Hardcoding 156 `dcss_actor_*` / `actor_*` IDs in `.ts` | `isCharacterSpriteSheet: true` on `SpriteSheetSourceSchema` in `dcss/pack.json` (`actors`) and `32rogues/pack.json` (`rogues`) | Yes |
| Class starting wealth dice & default kit | `switch (classId) { case 'fighter': return '6d4*10'; }` in `.ts` | `startingGoldDice`, `averageStartingGoldGp`, and `defaultStartingPackageId` on `public/data/rulesets/dnd35e/classes/*.json` | Yes |
| Item pricing, categories, light radius & free outfits | Hardcoded item price/category map inside UI `.ts` | `baseValue`, `currencyUnit`, `weight`, `category`, and `tags` (`starter_outfit`, `light_source`, `skill_kit`, `alchemical`, `ammunition`) on `items/*.json` | Yes |
| Derived / Masterwork / Special Material variants | Copying full JSON stats per variant item | `baseItemId` composition evaluated recursively by `resolveEffectiveItemDefinition` | Yes |
| Summary step HP, AC, Saves, BAB, Attack & Skill math | Re-computing D&D formulas inside Summary UI DOM code | Pure `applyCharacterCreationToPlayer` -> `projectCharacterSheetData` DAG evaluation | Yes |

---

## 3. Root vs. Downstream Composed SRD Item Tree (`baseItemId`)

Every downstream item inherits base weight, category, tags, `equippable`, `consumable`, or stats from its root item in `public/data/rulesets/dnd35e/items/` (`validateDnD35eSystemContentIntegrity` already verifies every `baseItemId` reference):

| Group | Root Item IDs (`baseItemId` = omitted) | Downstream Composed IDs (`baseItemId` -> root) |
|---|---|---|
| **Adventuring Gear & Containers** | `backpack` (`2 gp`, `back` slot `carryBonus: 5`), `waterskin`, `trail_rations` (`consumable.effectId: "food_ration"`), `bedroll`, `winter_blanket`, `sack`, `belt_pouch`, `bandoleer`, `potion_belt`, `scroll_organizer`, `flint_and_steel`, `map_or_scroll_case`, `parchment_sheet`, `ink_vial`, `inkpen`, `chalk`, `hempen_rope`, `grappling_hook`, `crowbar`, `hammer`, `piton`, `iron_spike`, `pole_10ft`, `caltrops`, `marbles`, `flour_pouch`, `small_steel_mirror`, `manacles`, `portable_ram`, `tent`, `signal_whistle`, `whetstone` | `silk_rope` -> `hempen_rope`; `masterwork_bandoleer` -> `bandoleer`; `masterwork_potion_belt` -> `potion_belt`; `masterwork_manacles` -> `manacles` |
| **Light Sources & Oil** | `torch` (`1 cp`, `light_radius_ft:20`), `candle` (`1 cp`, `light_radius_ft:5`), `common_lamp` (`1 sp`, `light_radius_ft:15`), `hooded_lantern` (`7 gp`, `light_radius_ft:30`), `oil_flask` (`1 sp`), `sunrod` (`2 gp`, `light_radius_ft:30`), `tindertwig` (`1 gp`) | `everburning_torch` -> `torch` (`110 gp`, `magical`); `bullseye_lantern` -> `hooded_lantern` (`12 gp`, `light_radius_ft:60`) |
| **Ammunition** | `arrows_20` (`1 gp`, `3 lb`), `crossbow_bolts_10` (`1 gp`, `1 lb`), `sling_bullets_10` (`1 sp`, `5 lb`) | — |
| **Class Tools & Skill Kits** | `wooden_holy_symbol` (`1 gp`), `holly_and_mistletoe` (`0 gp`), `spell_component_pouch` (`5 gp`), `wizards_spellbook` (`15 gp`), `thieves_tools` (`30 gp`), `healers_kit` (`50 gp`), `climbers_kit` (`80 gp`), `disguise_kit` (`50 gp`), `lute_common` (`5 gp`), `artisan_tools` (`5 gp`), `magnifying_glass` (`100 gp`), `merchants_scale` (`2 gp`) | `silver_holy_symbol` -> `wooden_holy_symbol` (`25 gp`, `specialMaterial: "silver"`); `masterwork_thieves_tools` -> `thieves_tools` (`100 gp`); `lute_masterwork` -> `lute_common` (`100 gp`); `masterwork_artisan_tools` -> `artisan_tools` (`55 gp`) |
| **Special Alchemical & Substances** | `acid_flask` (`10 gp`), `alchemists_fire` (`20 gp`), `antitoxin` (`50 gp`), `holy_water` (`25 gp`), `smokestick` (`20 gp`), `tanglefoot_bag` (`50 gp`), `thunderstone` (`30 gp`) | — |
| **Clothing Outfits** | 7 SRD Free Starter Outfits (`tags: ["clothing_outfit", "starter_outfit"]`): `explorers_outfit`, `travelers_outfit`, `scholars_outfit`, `monks_outfit`, `clerics_vestments`, `entertainers_outfit`, `artisans_outfit`; Non-starter outfits (`tags: ["clothing_outfit"]`): `peasants_outfit`, `cold_weather_outfit`, `courtiers_outfit` | — |

*(Note: `public/data/campaigns/dnd35e-crypt/items.json`'s `backpack` definition will be updated to include `"baseValue": 2, "currencyUnit": "gp"` so campaign-level overrides match SRD pricing.)*

---

## 4. Detailed Step-by-Step Implementation Plan & Code Snippets

### Phase 1 — Tier 1 Console: Sprite Atlas Thumbnails, Declarative Catalog & Character Sheet Portrait

1. **Mark character sheets in `src/types/campaign/meta.ts` & `pack.json`:**
   ```ts
   // src/types/campaign/meta.ts (inside SpriteSheetSourceSchema)
   isCharacterSpriteSheet: z
     .boolean()
     .optional()
     .describe('Marks sheets whose sprites represent playable character avatars'),
   ```
   Set `"isCharacterSpriteSheet": true` on `dcss/pack.json` (`spriteSheets.actors`) and `32rogues/pack.json` (`spriteSheets.rogues`).

2. **Add catalog discovery & smart Race/Class suggestion in `src/utils/sprite_pack.ts`:**
   ```ts
   export interface SpriteCatalogEntry {
     readonly spriteId: string;
     readonly label: string;
     readonly sheetId: string;
     readonly packId: string;
     readonly isCharacterSprite: boolean;
   }

   export function collectCatalogSpriteEntries(
     theme: Pick<ThemeConfig, 'spritePacks' | 'loadedSpritePacks' | 'spriteSheets'> | undefined
   ): ReadonlyArray<SpriteCatalogEntry> { ... }

   export function suggestCharacterSprites(
     entries: ReadonlyArray<SpriteCatalogEntry>,
     hintTokens: ReadonlyArray<string>
   ): ReadonlyArray<SpriteCatalogEntry> { ... }
   ```
   - `collectCatalogSpriteEntries` iterates `theme.loadedSpritePacks` (ordered by `theme.spritePacks`) and `theme.spriteSheets`, skipping `__alt_*` / `__rare_*` sub-variants, deduplicating by `spriteId`, and setting `isCharacterSprite = sheet.isCharacterSpriteSheet === true || /^((dcss_)?actor_|hero_)/.test(spriteId)`.
   - `suggestCharacterSprites` scores character-sprite entries against expanded synonyms for the actor's race + class (e.g., `dwarf`, `elf`, `cleric` -> `cleric|priest|templar`, `wizard` -> `wizard|mage|sage`, `fighter` -> `fighter|knight|swordsman`) and returns matching heroes ranked highest.

3. **Cache active composited atlas & render pixel-art thumbnails in `src/rendering/sprite_atlas.ts` and `src/rendering/display.ts`:**
   ```ts
   export interface ActiveSpriteAtlasSnapshot {
     readonly atlas: HTMLCanvasElement;
     readonly tileMap: Readonly<Record<string, readonly [number, number]>>;
     readonly tileWidth: number;
     readonly tileHeight: number;
     readonly revision: number;
   }

   export function setActiveSpriteAtlas(snapshot: Omit<ActiveSpriteAtlasSnapshot, 'revision'> | null): void;
   export function getActiveSpriteAtlas(): ActiveSpriteAtlasSnapshot | null;
   export function renderSpriteToDataUrl(spriteId: string, sizePx = 64): string | undefined;
   ```
   - `renderSpriteToDataUrl` draws `[coords[0], coords[1], tileWidth, tileHeight]` onto an offscreen canvas with `ctx.imageSmoothingEnabled = false` and caches `(revision, spriteId, sizePx) -> dataUrl` cleanly for smooth modal scrolling across hundreds of sprites.
   - `configureDisplayForCampaign` (`src/rendering/display.ts`) updates `setActiveSpriteAtlas` on tile/procedural atlas creation and clears `setActiveSpriteAtlas(null)` when switching to ASCII `rect` mode.

4. **Wire Character Sheet Portrait cleanly across Tier 1 / Tier 2 (`ui_adapter.types.ts`, `dnd35e_ui_char_sheet.ts`, `console_dossier.ui.ts`, `console_prototype.css`):**
   - Extend `UICharacterSheetModel` (`src/types/ui_adapter.types.ts`):
     ```ts
     readonly spriteId?: string;
     readonly glyph?: string;
     readonly glyphColor?: string;
     ```
   - Populate `spriteId`, `glyph`, `glyphColor` inside `projectCharacterSheetData` (`src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`) from `RenderableComponent` and `IdentityComponent.colorOverride`.
   - Render inside `renderIdentityDefensesColumn` (`src/rendering/ui/console_dossier.ui.ts`):
     ```ts
     const resolvedPortraitUrl = sheet.portraitUrl ?? (sheet.spriteId ? renderSpriteToDataUrl(sheet.spriteId, 64) : undefined);
     portrait.textContent = resolvedPortraitUrl ? '' : (sheet.glyph ?? '👤');
     if (resolvedPortraitUrl) {
       portrait.style.backgroundImage = `url(${resolvedPortraitUrl})`;
     } else if (sheet.glyphColor) {
       portrait.style.color = sheet.glyphColor;
     }
     ```
   - Add `image-rendering: pixelated;` to `.crpg-character-portrait` in `src/styles/console_prototype.css`.

---

### Phase 2 — Tier 3 System Content & Default Capacity `30`

5. **Class Starting Wealth & Default Kit Schema (`src/rulesets/dnd35e/types/dnd35e_system.types.ts` + `public/data/rulesets/dnd35e/classes/*.json`):**
   - Extend `DnD35ClassDefinitionSchema`:
     ```ts
     startingGoldDice: z.string().optional(),
     averageStartingGoldGp: z.number().nonnegative().optional(),
     defaultStartingPackageId: z.string().optional(),
     ```
   - Populate all 11 PC base classes (per PHB p. 111) + 5 NPC classes:
     - `barbarian` (`"4d4*10"`, `100`, `"pkg_barbarian"`), `bard` (`"4d4*10"`, `100`, `"pkg_bard"`), `cleric` (`"5d4*10"`, `125`, `"pkg_cleric"`), `druid` (`"2d4*10"`, `50`, `"pkg_druid"`), `fighter` (`"6d4*10"`, `150`, `"pkg_fighter"`), `monk` (`"5d4"`, `13`, `"pkg_monk"`), `paladin` (`"6d4*10"`, `150`, `"pkg_paladin"`), `ranger` (`"6d4*10"`, `150`, `"pkg_ranger"`), `rogue` (`"5d4*10"`, `125`, `"pkg_rogue"`), `sorcerer` (`"3d4*10"`, `75`, `"pkg_sorcerer"`), `wizard` (`"3d4*10"`, `75`, `"pkg_wizard"`).

6. **Create SRD Goods & Services JSON files in `public/data/rulesets/dnd35e/items/` & register in `ITEM_IDS`:**
   - Author ~69 modular item JSONs covering every Root and Downstream item from Section 3 (assigning existing sprite IDs verified in `dcss` / `32rogues`, e.g., `item_torch` / `item_candle` / `dcss_item_misc_misc_lantern` / `item_bag` / `dcss_item_food_bread_ration_new` / `dcss_item_potion_*` / `dcss_item_book_*` / `dcss_item_weapon_ranged_*`).
   - Add every ID in sorted order to `ITEM_IDS` (`src/rulesets/dnd35e/system_content_item_ids.ts`).
   - Update `public/data/campaigns/dnd35e-crypt/items.json` (`backpack` -> `"baseValue": 2, "currencyUnit": "gp"`) and `public/data/campaigns/dnd35e-crypt/entities.json` (`player.inventoryConfig.baseCapacity: 30`), and set `DEFAULT_ACTOR_INVENTORY_CAPACITY = 30` in `src/core/ecs/ecs_spawner_equipment.ts`.

---

### Phase 3 — Tier 2 Builder: 11 SRD Packages, Custom Kit Shop Math, Validator Guards & Pure Hydration

7. **Expand `src/rulesets/dnd35e/builder/starting_packages.ts`:**
   ```ts
   export interface StartingPackageItemEntry {
     readonly itemId: string;
     readonly quantity?: number | undefined;
     readonly equipSlot?: 'main_hand' | 'off_hand' | 'torso' | 'body' | 'hand' | 'back' | undefined;
   }

   export interface StartingEquipmentPackage {
     readonly id: string;
     readonly name: string;
     readonly description: string;
     readonly recommendedClassIds?: ReadonlyArray<string> | undefined;
     readonly freeOutfitId?: string | undefined;
     readonly items: ReadonlyArray<StartingPackageItemEntry>;
     readonly weaponDice: string;
     readonly weaponDamageType: 'slashing' | 'piercing' | 'bludgeoning';
     readonly armorBonus: number;
     readonly shieldBonus: number;
     readonly startingGoldGp: number;
   }
   ```
   - Define `COMMON_ADVENTURER_GEAR_ITEMS` (`backpack` equipped to `'back'`, `waterskin`, `trail_rations`, `bedroll`, `sack`, `flint_and_steel`, `torch` ×3).
   - Add all **11 SRD Class Starting Packages** (`pkg_barbarian` .. `pkg_wizard`) matching the exact PHB/SRD gear & remaining gp, plus keep the 4 legacy kits (`martial_vanguard`, `skirmisher_scout`, `divine_templar`, `arcane_scholar`) — ensuring every item in those 4 legacy kits (`wooden_holy_symbol`, etc.) now exists!
   - Export pure wealth, cost, encumbrance-weight, and kit-conversion helpers:
     - `resolveClassStartingWealthCp(classDef, currencyCfg): number`
     - `rollClassStartingWealthCp(classDef, currencyCfg): number`
     - `computeCustomKitCostCp(entries, itemRegistry, currencyCfg): number`
     - `computeKitTotalWeightLbs(entries, itemRegistry, freeOutfitId): number` (excludes `freeOutfitId` weight per PHB rules)
     - `buildCustomItemsFromPackage(pkg): ReadonlyArray<StartingPackageItemEntry>`

8. **Extend `CharacterCreationDraft`, Validation & Hydration (`builder_core.ts`, `character_builder.ts`, `builder_validation.ts`, `builder_hydrator_creation.ts`):**
   - New optional fields on `CharacterCreationDraft` (`exactOptionalPropertyTypes: true` compliant):
     ```ts
     readonly characterTitle?: string | undefined;
     readonly spriteId?: string | undefined;
     readonly spriteManuallySelected?: boolean | undefined;
     readonly glyphColor?: string | undefined;
     readonly mannerisms?: ReadonlyArray<string> | undefined;
     readonly equipmentMode?: 'preset' | 'custom' | undefined;
     readonly customStartingBudgetCp?: number | undefined;
     readonly customStartingBudgetRolled?: boolean | undefined;
     readonly customEquipmentItems?: ReadonlyArray<StartingPackageItemEntry> | undefined;
     readonly customFreeOutfitId?: string | undefined;
     ```
   - `sanitizeDraftOnRaceOrClassChange`: if `!draft.customStartingBudgetRolled` updates budget to the new class's `resolveClassStartingWealthCp`, and if `equipmentMode !== 'custom'` updates `equipmentPackageId` to `classDef.defaultStartingPackageId` (only when `classId` actually changed or current package doesn't exist).
   - `validateCharacterCreationStep`:
     - Extend `stepId` union with `'summary'`.
     - For `'equipment'`: in `'custom'` mode, validate `spentCp <= budgetCp` (blocking overspend with a clear remaining-coin deficit message).
     - For `'summary'`: validate `characterName` length `<= 32` (`valid: true`).
   - `applyCharacterCreationToPlayer` (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`):
     - Spawns preset or custom `items` (repeating `entry.quantity ?? 1` times) plus the free starter outfit (`freeOutfitId`), auto-equips any entry specifying `equipSlot` into matching open anatomical slots (`main_hand`, `off_hand`, `torso`/`body`, `back`), credits `remainingCp`, and ensures `baseCapacity = Math.max(latestInventory.baseCapacity, DEFAULT_ACTOR_INVENTORY_CAPACITY, latestInventory.items.length + spawnedItemIds.length + 5)`.
     - Persists `IdentityComponent` (`name`, optional `title`, `mannerisms`, optional `colorOverride`) and updates `RenderableComponent` (`spriteId`, `fg`). Remains 100% pure/immutable with zero RNG calls.

9. **Add Automated Validation Guard & Fix UI Weight Ceiling (`dnd35e_validator.ts`, `dnd35e_ui_adapter.ts`):**
   - In `checkDnD35eRuleset` (`src/rulesets/dnd35e/dnd35e_validator.ts`):
     - Build `mergedItems = { ...sys.items, ...campaign.items }`.
     - Assert every item in every `STARTING_EQUIPMENT_PACKAGES` (`items[*].itemId` and `freeOutfitId`) exists in `mergedItems`.
     - Assert every class `defaultStartingPackageId` references a valid package in `STARTING_EQUIPMENT_PACKAGES`.
   - In `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`:
     - Replace `strScore * LIGHT_LOAD_MULTIPLIER_LBS` with `computeEncumbranceState(strScore, dndData.sizeCategory ?? 'medium', currentWeightLbs).heavyMaxLb`.

---

### Phase 4 — Character Creation Wizard UI Overhaul

10. **New `src/rendering/ui/dnd35e_char_builder_equipment.ui.ts` (re-exported from `dnd35e_char_builder_steps.ui.ts`):**
    - Top mode switch: **📦 Preset Starting Kits** vs. **🛒 Custom Gear Shop**.
    - **Preset Mode:** Left pane groups **Recommended Class Kit (`★`)**, remaining **10 Class Starting Kits**, and **4 Adventurer Kits**. Right pane renders a complete **Kit Inspector** showing Weapon/Armor/Shield stats, ACP/ASF, Free Outfit, itemized pack contents with quantities/weights, carry weight vs SRD Light/Medium/Heavy load bar (`computeEncumbranceState`), starting coin, and a **"✏ Customize This Kit →"** button (converts the kit via `buildCustomItemsFromPackage` into Custom mode!).
    - **Custom Mode:** Header bar shows Starting Wealth, **🎲 Roll Starting Gold** button (`rollClassStartingWealthCp`), Remaining Budget (`formatCurrency`), Free Starter Outfit `<select>` (0 gp, 0 lb carried), and live SRD Encumbrance meter (`Light` / `Medium` / `Heavy` / `Overloaded`). Left pane browses all non-artifact items filterable by Category tabs + Search + Affordable-only toggle + proficiency badge. Right pane manages the player's **Custom Loadout** (`+` / `-` / `Remove`, auto-equip slot selector, **"Add Adventurer Essentials (7 gp)"** shortcut).

11. **New `src/rendering/ui/dnd35e_char_builder_summary.ui.ts` & Updated `src/rendering/ui/dnd35e_char_builder.ui.ts` + `src/styles/modals.css`:**
    - Remove `#char-builder-name-input` from `topRow` in `dnd35e_char_builder.ui.ts`.
    - Add `'summary'` (`"Review & Identity"`) as the final step in `getActiveWizardSteps` (`Step 7` or `Step 8` depending on spell selection).
    - Auto-populate `draftState.spriteId` using `suggestCharacterSprites` whenever Race or Class changes and `draftState.spriteManuallySelected !== true` (falling back to template default if no atlas/pack matches).
    - **Left Pane (`dnd35e_char_builder_summary.ui.ts`):**
      - Hero Identity Banner (64×64 crisp sprite preview + fallback glyph, formatted Name + Title, Race / Class / Alignment).
      - **Name** text input + **🎲 Randomize Name** button.
      - **Title / Epithet** text input + quick-pick chips (`"the Bold"`, `"Shadowstep"`, `"Dawnbringer"`, etc.).
      - **ASCII Glyph Color** swatches + `<input type="color">`.
      - **Character Traits / Mannerisms** chips + custom tag input (up to 4 traits -> `IdentityComponent.mannerisms`).
      - **Sprite Picker** with filter tabs: `Suggested` | `Characters` | `DCSS Actors` | `32rogues Heroes` | `Full Catalogue (All Sprites)` + search box + grid of clickable sprite tiles with batched `"Show More"` pagination for smooth full-catalogue browsing.
    - **Right Pane (`dnd35e_char_builder_summary.ui.ts`):**
      - Evaluates `const previewState = applyCharacterCreationToPlayer(state, playerId, previewDraft)` and `const sheet = projectCharacterSheetData({ state: previewState, entityId: playerId })` + `inventory = uiAdapter.getInventoryData({ state: previewState, entityId: playerId })`.
      - Displays complete authoritative stats: HP, Full / Touch / Flat-Footed AC, Speed, Saves (Fort / Ref / Will), BAB / Initiative / Grapple, 6 Abilities, Attack Routine (`attackGroups`), Class Features / Domains / ACFs / Companion & Familiar, Feats, Invested Skills (with final total modifiers), Known Spells / Prayerbook summary, Equipped Gear & Backpack Loadout (`currentWeightLbs` / Light-Medium-Heavy load), and Starting Coin (`currencyFormatted`).

---

### Phase 5 — Tests, SSOT Sync & Verification

12. **Tests (`tests/dnd35e_classes_builder.test.ts`, `tests/hud_rest_and_display_name.test.ts`, `tests/sprite_pack_resolution.test.ts`):**
    - Test `collectCatalogSpriteEntries` and `suggestCharacterSprites` (curated vs full catalogue & synonym matching).
    - Test all 15 `STARTING_EQUIPMENT_PACKAGES` spawn every referenced item with zero missing items and validate cleanly via `checkDnD35eRuleset`.
    - Test Custom Kit budget validation (blocking overspend), class wealth rolling/averaging, free starter outfit 0-lb rule, and inventory slot headroom (`>= 30`).
    - Test `applyCharacterCreationToPlayer` immutability (safe for live preview) and persistence of `characterTitle`, `mannerisms`, `glyphColor`, `spriteId`, plus `projectCharacterSheetData` projecting `spriteId`/`glyph`/`glyphColor`.
13. **Documentation & SSOT Registry Parity:**
    - Update `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json` (adding `dnd35e_char_builder_equipment.ui.ts`, `dnd35e_char_builder_summary.ui.ts`, and new canonical exports), run `bun scripts/map-codebase.ts`, and verify all 8 stages of `./verify.sh` pass with 0 errors and 0 warnings.

---

## 5. Complete Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| `isCharacterSpriteSheet` on `SpriteSheetSourceSchema` (`meta.ts`) | Pack JSON authors (`dcss`, `32rogues`) | `collectCatalogSpriteEntries`, `suggestCharacterSprites`, sprite picker UI | Validated by Zod across all 5 campaigns & 2 packs |
| Active atlas cache + `renderSpriteToDataUrl` (`sprite_atlas.ts`, `display.ts`) | `configureDisplayForCampaign` (startup & Settings pack switch) | Character Creation sprite picker & preview, Character Sheet portrait (`console_dossier.ui.ts`) | Reusable across Console / future cartridges |
| `spriteId`, `glyph`, `glyphColor` on `UICharacterSheetModel` (`ui_adapter.types.ts`, `dnd35e_ui_char_sheet.ts`) | `projectCharacterSheetData` reading `RenderableComponent` + `IdentityComponent` | `console_dossier.ui.ts` portrait & Summary step hero card | Respects `.dependency-cruiser.cjs` `headless-simulation-purity` |
| Class starting wealth & default kit fields (`dnd35e_system.types.ts`, `classes/*.json`) | 11 PC + 5 NPC class JSONs | `resolveClassStartingWealthCp`, `rollClassStartingWealthCp`, `sanitizeDraftOnRaceOrClassChange`, `checkDnD35eRuleset` | Backward compatible (optional fields) |
| New SRD Root & Downstream items in `items/` + `ITEM_IDS` (`system_content_item_ids.ts`) | `dnd35e_ruleset.ts` loader, `tests/helpers.ts` loader | All 15 starting packages, Custom Buy Shop, loot/shops/inventory | `dnd35e-crypt/items.json` `backpack` price aligned; `run-validator.ts` disk parity & `baseItemId` checks |
| Starting package validator guard (`dnd35e_validator.ts`) | `STARTING_EQUIPMENT_PACKAGES` + `classes/*.json` | `[8/8] run-validator.ts` across all `dnd35e` campaigns | Blocks missing starting-kit items at build/test time |
| Default capacity `30` (`dnd35e-crypt/entities.json`, `ecs_spawner_equipment.ts`, `builder_hydrator_creation.ts`) | Actor templates & spawning | `InventoryComponent.baseCapacity` on created characters & save round-trip | Any test asserting hardcoded `baseCapacity === 10` / `20` updated if present |
| `CharacterCreationDraft` extensions + `applyCharacterCreationToPlayer` + `'summary'` step | `createDefaultDraft`, `createQuickStartHeroDraft`, tests, Wizard steps | `IdentityComponent`, `RenderableComponent`, `InventoryComponent`, `EquipmentComponent`, Summary preview, `save.ts` | Optional fields keep existing test fixtures compiling |
| `computeEncumbranceState` in `dnd35e_ui_adapter.ts` | `tactical_doctrine.ts` | `UIInventoryModel.maxWeightLbs` in Inventory UI & Equipment step | Live runtime encumbrance penalties deferred as explicit follow-up |
