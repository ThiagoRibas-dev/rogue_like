# Phase 13 Implementation Plan: Pluggable Ruleset Cartridge Architecture & `classic` Extraction (`Milestones 82–84`)

## 1. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Campaign JSONs / Scripts / Tests) |
| :--- | :--- | :--- | :--- |
| **`src/types/ruleset.types.ts` & `src/rulesets/registry.ts`** | `src/rulesets/classic/classic_ruleset.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`, `state.campaign.manifest.rulesetId` | `getEffectiveStats()`, `processMeleeAttackIntent()`, `processDamageSystem()`, `grantXp()`, `renderPlayerStats()`, `renderEditorUI()`, `validateCampaign()` | New unit test `tests/ruleset_registry.test.ts` |
| **`ComponentType.RulesetData` (`src/types/components.types.ts`)** | Ruleset cartridges (`classic`, `dnd35e`) | `src/core/ecs.ts`, `src/core/save.ts` | `Component` discriminated union |
| **`src/rulesets/classic/` Extraction** | `combat.system.ts`, `damage.system.ts`, `death.system.ts`, `utils/stats.ts`, `hud.ui.ts` | `game-loop.ts`, `state_stabilizer.ts`, `movement.system.ts`, `quest.system.ts`, `viewport_snapshot.ts`, `tactical_snapshot.ts` | `ai_arena.ts`, `narrative_fuzzer.ts`, `tests/*.test.ts` |
| **`rulesetId` in `CampaignManifestSchema` & `CampaignRegistryEntrySchema`** | `loadCampaign()`, `loadCampaignRegistry()`, `listInstalledCampaigns()`, `createBlankSlateCampaign()` | `populateRulesetList()`, `populateCampaignList()`, `editor_toolbar.ts` | `public/data/campaigns.json`, `default/manifest.json`, `shroudgarde/manifest.json`, `megacampaign/manifest.json`, `scripts/run-validator.ts` |
| **`UIMode.RulesetSelect` & `#ruleset-selection-overlay`** | `#btn-new-game`, `#btn-ruleset-next`, `#btn-ruleset-back`, `#btn-campaign-back` (`session_controller.ts`) | `renderMenus()` (`menus.ui.ts`), `handleKeyDown()` (`input_handler.ts`), focus trap (`session_controller.ts`) | `index.html` |

---

## 2. Step-by-Step Implementation Details & Code Snippets

### Step 1: Milestone 82 — `src/types/ruleset.types.ts`, `src/types/components.types.ts`, & `src/rulesets/registry.ts`

1. **Create `/src/types/ruleset.types.ts`**
2. **Update `/src/types/components.types.ts`**
3. **Create `/src/rulesets/registry.ts`**

### Step 2: Milestone 83 — `src/rulesets/classic/` Cartridge Extraction & Core Delegation

1. **Create `/src/rulesets/classic/classic_stats.ts`**
2. **Create `/src/rulesets/classic/classic_combat.ts`**
3. **Create `/src/rulesets/classic/classic_ruleset.ts`**
4. **Update `/src/utils/stats.ts`, `/src/systems/combat.system.ts`, `/src/systems/damage.system.ts`, `/src/systems/death.system.ts`, and `/src/rendering/ui/hud.ui.ts`**

### Step 3: Milestone 84 — `New Game -> Ruleset Selection -> Campaign Selection`, Editor Scoping & `dnd35e` Skeleton

1. **Create `/src/rulesets/dnd35e/dnd35e_ruleset.ts`**
2. **Update `/src/types/campaign/meta.ts`, `/public/data/campaigns.json`, `/public/data/campaigns/*/manifest.json`, `/src/core/campaign_store.ts`, `/src/editor/workspace_file_service.ts`, and `/scripts/run-validator.ts`**
3. **Update `/src/types/game-state.types.ts`, `/index.html`, `/src/rendering/ui/menus.ui.ts`, `/src/rendering/ui.ts`, `/src/core/session_controller.ts`, and `/src/core/input_handler.ts`**
4. **Update `/src/rendering/editor/editor_toolbar.ts`, `/src/rendering/editor_ui.ts`, and `/src/editor/campaign_validator.ts`**
5. **Add Regression Test `/tests/ruleset_registry.test.ts`**
