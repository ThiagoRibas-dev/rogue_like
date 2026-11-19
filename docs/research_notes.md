# Research Notes — Character Creation Final Summary, Identity, Sprite Picker, SRD Starting Kits & Custom Loadout

## 1. Core Architectural Rules & Standards Governing This Task

- **Tier 1 Console vs. Tier 2 Cartridge vs. Tier 3 Content (`AGENTS.md` Rule 16):**
  - **Tier 1 Console (`src/types/campaign/meta.ts`, `src/types/ui_adapter.types.ts`, `src/utils/sprite_pack.ts`, `src/rendering/sprite_atlas.ts`, `src/rendering/display.ts`, `src/rendering/ui/console_dossier.ui.ts`, `src/core/ecs/ecs_spawner_equipment.ts`):** Active atlas caching and crisp pixel-art thumbnail slicing, declarative character-avatar sprite discovery from shared packs, Character Sheet portrait rendering, and default actor inventory capacity (`30`).
  - **Tier 2 Cartridge (`src/rulesets/dnd35e/types/dnd35e_system.types.ts`, `src/rulesets/dnd35e/system_content_item_ids.ts`, `src/rulesets/dnd35e/dnd35e_validator.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`, `src/rulesets/dnd35e/builder/*.ts`, `src/rendering/ui/dnd35e_char_builder*.ui.ts`):** Extended `CharacterCreationDraft`, 11 SRD Class starting kits + custom buy-gear math, class starting wealth resolution, automated starting-package validator guards, pure Character Creation preview/hydration, and the dedicated Equipment Shop and Final Summary / Identity wizard UIs.
  - **Tier 3 System Content (`public/data/sprite_packs/*/pack.json`, `public/data/rulesets/dnd35e/classes/*.json`, `public/data/rulesets/dnd35e/items/*.json`, `public/data/campaigns/dnd35e-crypt/*.json`):** Declarative sprite sheet roles, class starting wealth/kit defaults, root + composed `baseItemId` SRD adventuring gear, light sources, ammunition, class tools/skill kits, alchemical substances, and starter clothing outfits.
- **Architectural Dependency Guardrails (`.dependency-cruiser.cjs` `headless-simulation-purity`):**
  - `src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts` is under `src/rulesets/` and **cannot** import from `src/rendering/`. Therefore `UICharacterSheetModel` (`src/types/ui_adapter.types.ts`) exposes pure data fields (`spriteId`, `glyph`, `glyphColor`), and `src/rendering/ui/console_dossier.ui.ts` renders the sprite portrait thumbnail via `renderSpriteToDataUrl` in `src/rendering/sprite_atlas.ts`.
- **Zero Duplicated Stat Math & Pure Preview Evaluation (`AGENTS.md` Rules 14, 17, 19):**
  - `applyCharacterCreationToPlayer(state, entityId, draft)` (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`) performs zero `rng.` calls across creation, race hydration (`races.ts`), level-history rebuild (`level_ledger.ts`), and companion sync (`companions.ts`). Thus evaluating `const previewState = applyCharacterCreationToPlayer(state, playerId, draft)` followed by `projectCharacterSheetData({ state: previewState, entityId: playerId })` produces exact, live parity with the in-game `[C]` Character Sheet.
- **Root vs. Downstream Composed Items (`baseItemId` Inheritance) & Referential Validation (`AGENTS.md` Rules 18, 21):**
  - `resolveEffectiveItemDefinition` (`src/rulesets/dnd35e/equipment/item_inheritance.ts:37-101`) recursively merges `baseItemId` properties, `tags`, `equippable`, `weaponStats`, `armorStats`, and `consumable` fields, and `validateDnD35eSystemContentIntegrity` (`src/rulesets/dnd35e/dnd35e_validator.ts:75-83`) validates every `baseItemId`. Derived items (e.g., `everburning_torch` -> `torch`, `silver_holy_symbol` -> `wooden_holy_symbol`, `silk_rope` -> `hempen_rope`, `masterwork_thieves_tools` -> `thieves_tools`) must inherit cleanly rather than duplicating stats.
- **Zero Hardcoded Content Lists (`AGENTS.md` Rule 21):**
  - Selectable character sprite sheets, class starting gold/default packages, item categories, free outfits, and prices must all be driven declaratively by JSON schemas rather than hardcoded `.ts` lookup tables.

---

## 2. Detailed Codebase Findings

### 2.1 Character Creation Wizard Flow (`src/rendering/ui/dnd35e_char_builder*.ui.ts`)
- **`src/rendering/ui/dnd35e_char_builder.ui.ts`:**
  - `WizardStepDescriptor['id']` currently handles `'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment'`.
  - Lines 194–224 place `<input id="char-builder-name-input">` inside `topRow` beside the step tabs.
  - Line 301 renders `renderCharBuilderEquipmentStep` as the final step with `✔ Embark into the Dungeon`.
  - `createQuickStartHeroDraft()` (lines 96–102) bypasses the wizard directly into `applyCharacterCreationToPlayer`.
- **`src/rendering/ui/dnd35e_char_builder_steps.ui.ts`:**
  - `renderCharBuilderEquipmentStep` (lines 20–95) only offers the 4 legacy kits and a 5-line text summary in the right pane.

### 2.2 Builder Data Model, Validation & Hydration
- **`src/rulesets/dnd35e/builder/builder_core.ts`:**
  - `CharacterCreationDraft` (lines 52–73) includes `characterName`, `raceId`, `classId`, `alignment`, `abilityMethod`, `pointBuyBudget`, `baseAbilityScores`, `selectedAcfs`, `domains`, `arcaneSchool`, `prohibitedSchools`, `favoredEnemyType`, `combatStyle`, `skillRanks`, `selectedFeats`, `knownSpells`, `equipmentPackageId`, `deityFavoredWeaponId`, `familiarId`, `animalCompanionId`. It has no appearance/identity customization fields (`characterTitle`, `spriteId`, `spriteManuallySelected`, `glyphColor`, `mannerisms`) or custom equipment loadout fields.
- **`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`:**
  - Lines 190–197 construct `IdentityComponent` with `name: resolvedCharName` and `mannerisms: existingIdentity?.mannerisms ?? []`, never setting `title` or `colorOverride`.
  - Never updates `RenderableComponent` (`spriteId`, `fg`), so all created characters retain the campaign template's default `spriteId: "actor_rogue"` and `fg: "#00ffff"` (`public/data/campaigns/dnd35e-crypt/entities.json:2-8`).
  - Spawns `equipPkg.items` and skips any item missing from `runningState.campaign.items` (`if (!runningState.campaign.items[itemEntry.itemId]) continue;` at line 211).

### 2.3 ECS Identity, Renderable & Character Sheet Portrait Integration
- **`IdentityComponent` (`src/types/components/actor_components.types.ts:119-125`):** Supports `name`, `title?`, `mannerisms`, `colorOverride?`.
  - `resolveEntityDisplayName` (`src/core/ecs/ecs_core.ts:184`) already formats `${identity.name} ${identity.title ?? ''}`.
  - `viewport_snapshot.ts:134` and `tactical_snapshot.ts:176` already honor `identity?.colorOverride ?? renderable.fg`.
- **`RenderableComponent` (`src/types/components/world_components.types.ts:27-33`):** Stores `glyph`, `fg`, `bg`, `spriteId?`. Serializes cleanly in `save.ts`.
- **`console_dossier.ui.ts` (`lines 40-45`) & `dnd35e_ui_char_sheet.ts` (`lines 214-263`):**
  - `UICharacterSheetModel` (`src/types/ui_adapter.types.ts:105-137`) has `portraitUrl?: string`, consumed by `console_dossier.ui.ts`, while `projectCharacterSheetData` currently leaves it unset (`👤` fallback).

### 2.4 Sprite Packs & Active Atlas Compositing
- **`public/data/sprite_packs/dcss/pack.json`:** `actors` sheet contains **116** character sprites (`dcss_actor_*`). Full DCSS pack contains 6,185 sprites across `dungeon`, `monsters`, `items`, `actors`, `effects`, `spells`, `misc`, `gui`, `player_layers`.
- **`public/data/sprite_packs/32rogues/pack.json`:** `rogues` sheet contains **40** character sprites (`actor_*`).
- **`public/data/campaigns/dnd35e-crypt/theme.json`:** Loads `dcss` (including `"actors"`) and `"32rogues"`, so all **156** character sprites + ~6,000 catalogue sprites are already composited into `mergedTileMap` inside `configureDisplayForCampaign` (`src/rendering/display.ts:101-111`).
- **`src/rendering/sprite_atlas.ts`:** Builds `{ atlas, mergedTileMap, tileWidth, tileHeight }`, but currently discards direct access after configuring `ROT.Display`. Caching the active atlas snapshot lets any UI modal extract crisp data URLs cleanly (`imageSmoothingEnabled = false`) and auto-refreshes when Settings changes tileset pack.

### 2.5 Starting Packages, Item Catalog Gaps, Capacity & Weight-Based Encumbrance
- **Silent Missing Item Bug in Current Starter Kit:**
  - `src/rulesets/dnd35e/builder/starting_packages.ts:65` references `wooden_holy_symbol` in `divine_templar`, which does **not** exist in `public/data/rulesets/dnd35e/items/` or `public/data/campaigns/dnd35e-crypt/items.json`, so `applyCharacterCreationToPlayer` silently skipped spawning it (`builder_hydrator_creation.ts:211`). Adding referential validation in `checkDnD35eRuleset` (`src/rulesets/dnd35e/dnd35e_validator.ts:232-269`) and unit-test coverage in `tests/dnd35e_classes_builder.test.ts` catches this class of bug at validation time.
- **Current Ruleset Item Inventory (`public/data/rulesets/dnd35e/items/`):**
  - **160** files registered in `ITEM_IDS` (`src/rulesets/dnd35e/system_content_item_ids.ts`): `72` weapons, `68` armor/shields/magic accessories, `17` tools (coins/gems/wands/rods/staffs), `3` consumables.
  - All weapons/armor/shields required by the 11 PHB/SRD starting packages (`greataxe`, `shortbow`, `longsword`, `light_crossbow`, `heavy_mace`, `scimitar`, `club`, `sling`, `greatsword`, `quarterstaff`, `short_sword`, `dagger`, `shortspear`, `studded_leather_armor`, `scale_mail`, `hide_armor`, `leather_armor`, `heavy_wooden_shield`) already exist in `public/data/rulesets/dnd35e/items/`.
  - Missing SRD Goods & Services items: Backpack (ruleset baseline), waterskin, trail rations, bedroll, sack, flint & steel, torches & light sources, arrows/bolts/bullets, class tools/skill kits, alchemical substances, and starter clothing outfits.
  - Multi-denomination pricing (`baseValue` + `currencyUnit: 'cp' | 'sp' | 'gp'`) is already supported by `ItemDefinitionSchema` (`src/types/campaign/item.ts:48-49`) and `resolveItemBaseValueInBaseUnits` (`src/systems/currency.system.ts:93-101`).
- **Inventory Slot Capacity:**
  - `public/data/campaigns/dnd35e-crypt/entities.json:18` configures `player.inventoryConfig.baseCapacity: 10`, and `src/core/ecs/ecs_spawner_equipment.ts:44` falls back to `20`. Raising default actor capacity to `30` (plus equipping `backpack` in `back` for `+5` carryBonus) ensures starting packages with 12–18 items never fill the pack at Level 1.
- **Weight-Based Encumbrance Status:**
  - **Math implemented:** `computeEncumbranceState` (`src/rulesets/dnd35e/combat/tactical_doctrine.ts:276-340`) already implements full SRD STR 1–20 + bipedal size Light/Medium/Heavy/Overloaded load thresholds, Max Dex Bonus, ACP, and speed scaling.
  - **Turn-budget check exists:** `dnd35e_turn_budget.ts:143-144` checks `selfTags.includes('load:medium') || selfTags.includes('load:heavy')`.
  - **Remaining runtime wiring gaps:** `resolveEntitySituationalTagContext` (`src/rulesets/dnd35e/semantic_tags_context.ts:168`) still hardcodes `loadCategory: 'light'`, and `dnd35e_ui_adapter.ts:39,116` uses `strScore * 15` instead of `computeEncumbranceState`. Equipment/Summary UI and `dnd35e_ui_adapter.ts` will use `computeEncumbranceState` directly; full live runtime encumbrance penalty activation (`semantic_tags_context.ts` + DAG ACP/Max-Dex/Speed) is documented as a dedicated follow-up so existing combat/movement test expectations are not altered unexpectedly.

---

## 3. Confirmed Design Decisions from User Review

1. **Final Summary & Identity Step:** Include **Character Name** (with **Randomize Name** button, removing top-bar `Name:` input), optional **Title / Epithet** (`IdentityComponent.title`), **ASCII Glyph Color Swatches + custom picker** (`RenderableComponent.fg` / `IdentityComponent.colorOverride`), optional **Character Traits / Mannerisms** (`IdentityComponent.mannerisms`), and full live DAG summary + equipment/wealth summary.
2. **Sprite Picker:** Keep existing defaults working seamlessly, auto-suggest race/class-relevant sprites (`Suggested` tab + smart default selection until manually overridden), allow browsing all curated character sprites (`DCSS actors` + `32rogues rogues`), and allow toggling **"Full Catalogue"** to pick from all loaded sprite sheets (`~6,000+` sprites) with search + batched pagination.
3. **Character Sheet Portrait (`[C]`):** Render the player's chosen sprite inside `.crpg-character-portrait` in `console_dossier.ui.ts` (replacing `👤`).
4. **Equipment Step, Kits & SRD Gear:**
   - Replace the minimal text summary in the Equipment step with a full **Kit Inspector**.
   - Add **11 PHB/SRD Class Starting Packages** (with backpack, waterskin, trail rations, bedroll, sack, flint & steel, 3 torches, plus class-specific armor/weapons/ammo/tools/gp) alongside the 4 legacy kits, plus **"Customize Kit"** mode with class starting wealth (average or rolled via class `startingGoldDice`), free starter outfit selection (`0 lb` carried weight), categorized SRD Goods & Services browser, and live encumbrance readout via `computeEncumbranceState`.
   - Model derived items via **`baseItemId` inheritance** (Root vs. Downstream items) cleanly.
   - Add **automated validation** in `checkDnD35eRuleset` + unit tests so missing item IDs or class default package IDs can never be silently skipped again.
   - Raise default inventory slot capacity to **`30`**.

---

## 4. Full Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
|---|---|---|---|
| `isCharacterSpriteSheet` on `SpriteSheetSourceSchema` (`src/types/campaign/meta.ts`) | Shared sprite pack authors (`dcss`, `32rogues`) | `collectCatalogSpriteEntries`, `suggestCharacterSprites`, Character Creation sprite picker | Validated by Zod across all 5 campaigns & 2 sprite packs in `run-validator.ts` |
| Active atlas cache + `renderSpriteToDataUrl` (`src/rendering/sprite_atlas.ts`, `display.ts`) | `configureDisplayForCampaign` (initial boot & Settings pack switch via `applyDisplaySettingsUpdate`) | Character Creation sprite picker & hero preview, Character Sheet portrait (`console_dossier.ui.ts`) | Reusable by Classic cartridge or future rulesets |
| `spriteId` / `glyph` / `glyphColor` on `UICharacterSheetModel` (`ui_adapter.types.ts`, `dnd35e_ui_char_sheet.ts`) | `projectCharacterSheetData` reading `RenderableComponent` + `IdentityComponent` | `console_dossier.ui.ts` portrait & Summary step header preview | Respects `headless-simulation-purity` (`rulesets/` never imports `rendering/`) |
| `startingGoldDice`, `averageStartingGoldGp`, `defaultStartingPackageId` on `DnD35ClassDefinitionSchema` & `classes/*.json` | 11 PC + 5 NPC class JSONs | `resolveClassStartingWealthCp`, `rollClassStartingWealthCp`, `sanitizeDraftOnRaceOrClassChange`, `checkDnD35eRuleset` | Backward compatible (optional fields on Zod schema) |
| New SRD Root & Downstream items in `public/data/rulesets/dnd35e/items/` + `ITEM_IDS` (`system_content_item_ids.ts`) | `dnd35e_ruleset.ts` loader, `tests/helpers.ts` loader | All 15 starting packages, Custom Equipment Shop, in-game shops/loot/inventory | `dnd35e-crypt/items.json` `backpack` price aligned; `run-validator.ts` enforces zero orphan files & valid `baseItemId` links |
| Starting package & class default kit referential validator (`dnd35e_validator.ts`) | `STARTING_EQUIPMENT_PACKAGES` + `classes/*.json` | `[8/8] run-validator.ts` across all `dnd35e` campaigns | Prevents future silent skips like `wooden_holy_symbol` |
| Raise default slot capacity to `30` (`dnd35e-crypt/entities.json`, `ecs_spawner_equipment.ts`, `builder_hydrator_creation.ts`) | Entity templates & actor spawning | `InventoryComponent.baseCapacity` on newly spawned PCs/actors & save round-trip | Check `tests/` for any exact assertion on player `baseCapacity === 10` or `20` |
| Extend `CharacterCreationDraft` + `sanitizeDraftOnRaceOrClassChange` + `validateCharacterCreationStep` + `applyCharacterCreationToPlayer` | `createDefaultDraft`, `createQuickStartHeroDraft`, all test drafts, Wizard UI steps | `IdentityComponent`, `RenderableComponent`, `InventoryComponent`, `EquipmentComponent`, live Summary preview (`projectCharacterSheetData`), `save.ts` | All new draft fields optional (`exactOptionalPropertyTypes`), preserving all existing test fixtures |
| Add `'summary'` final step & remove `#char-builder-name-input` from `topRow` (`dnd35e_char_builder.ui.ts`, `dnd35e_char_builder_equipment.ui.ts`, `dnd35e_char_builder_summary.ui.ts`) | Wizard tab bar & step gating | Footer button switching (`Next Step →` vs `✔ Embark into the Dungeon`), SSOT `ssot_dnd35e.json` | Update SSOT registry & run `bun scripts/map-codebase.ts` |
| Replace `strScore * 15` with `computeEncumbranceState(...).heavyMaxLb` (`dnd35e_ui_adapter.ts`) | `computeEncumbranceState` (`tactical_doctrine.ts`) | `UIInventoryModel.maxWeightLbs` shown in Inventory UI & Equipment step | Keeps UI display consistent with SRD STR load table |
