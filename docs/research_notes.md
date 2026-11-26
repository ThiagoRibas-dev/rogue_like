# Research Notes — Phase 44 (Milestones 169–172): Campaign Editor Rewrite on Shared Preact Primitives, Schema Auto-Discovery, Scoped Input & Unified Themes

## 1. Rules & Architectural Standards Acknowledgement (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16)**:
   - **Tier 1 — Core Console Engine (`src/core/`, `src/editor/`, `src/rendering/ui/`, `src/types/`)**: The Campaign Editor (`src/editor/` pure controller + `src/rendering/ui/editor/` Preact presentation layer) is a Tier 1 Console facility that authors and validates any campaign regardless of ruleset (`classic` or `dnd35e`), querying `RulesetContract.getEditorViewGroups` / `getSystemContentFiles` / `validateCampaignRuleset` for cartridge extensions.
2. **Zero Content-ID or Bespoke-Property Branching (`AGENTS.md` Rule 21 — The "New Content Mod" Litmus Test)**:
   - Never hardcode parallel lists of campaign categories, foreign-key dropdowns, or per-category `"Where Used"` loops that require editing multiple `.ts` files whenever a schema property is added.
   - Instead, derive `CampaignCategorySchemas`, `panelType` (`'dictionary'` vs `'singleton'`), foreign-key reference options, and `ReferenceIndex` (`"Where Used"`) directly from `CampaignDataSchema` (`src/types/campaign.types.ts`) and a single compile-time exhaustive `Record<keyof CampaignData, CampaignCategoryMeta>` registry.
3. **Strict TypeScript & Zero `any` (`AGENTS.md` Rules 11, 12, 14 & §3)**:
   - `exactOptionalPropertyTypes: true`, explicit return types on all functions, `readonly` properties, no magic numbers, flat control flow, and JSDoc on all exported symbols.
4. **Unified Preact Primitive Kit, `--ui-*` Semantic Tokens, Scoped Input & `DialogService` (`docs/ARCHITECTURE.md` §4 & §9.30)**:
   - All Campaign Editor views must render inside `<AppUiRoot />` (`#ui-root`) under `[data-ui-density="compact"]` using Phase 43 shared primitives (`src/rendering/ui/primitives/*`) and `--ui-*` semantic CSS tokens (`Obsidian & Brass`, `Parchment`, `Retro CRT`).
   - Zero `.innerHTML`, zero leaked `document`/`window` listeners, and zero native `alert()`/`confirm()`/`prompt()` or legacy `showPromptModal()` calls.

---

## 2. Codebase Audit & Discovery Across Milestones 169–172

### 2.1 Why the Legacy Campaign Editor Drifted Out of Sync
An audit of `src/types/campaign.types.ts`, `src/constants/campaign.constants.ts`, `src/rendering/editor/editor_config.ts`, `src/rendering/ui/ui_utils.ts`, and `src/editor/reference_index.ts` revealed five manual synchronization bottlenecks:

1. **11 Missing `CampaignData` Categories in `VIEW_GROUPS` (`src/rendering/editor/editor_config.ts`)**:
   - `CampaignDataSchema` defines **33** top-level keys (`manifest`, `rules`, `theme`, `advancement`, `areas`, `items`, `effects`, `entities`, `status`, `tiles`, `factions`, `ai`, `dialogues`, `quests`, `questTemplates`, `triggers`, `triggerTemplates`, `triggerBuckets`, `villains`, `schemeRecipes`, `phaseBlocks`, `agreements`, `tagRegistry`, `reactions`, `fields`, `spawnPools`, `encounterProfiles`, `traitRegistry`, `identityGeneration`, `personalityGeneration`, `nemesisHierarchies`, `knowledgePropagation`, `rumorPropagation`, `relationshipThresholds`, `worldEvents`, `systemContent`).
   - `VIEW_GROUPS` in `src/rendering/editor/editor_config.ts` only listed **21** tabs, leaving `tagRegistry`, `reactions`, `triggerTemplates`, `triggerBuckets`, `phaseBlocks`, `identityGeneration`, `personalityGeneration`, `knowledgePropagation`, `rumorPropagation`, `relationshipThresholds`, `worldEvents`, and `systemContent` unreachable in the Editor UI.
2. **Duplicate Hand-Rolled `CampaignCategorySchemas` (`src/types/campaign.types.ts:105-142`)**:
   - Manually unwraps `z.record(z.string(), ItemSchema)` to `ItemSchema` for dictionary categories while keeping `z.object(...)` / `z.array(...)` for singletons. This can be derived automatically by inspecting `CampaignDataSchema.shape[key]` (unwrapping `ZodOptional` and `ZodDefault`).
3. **`ZodRecord` & `ZodDiscriminatedUnion` Fallback to Raw `<textarea>` (`src/rendering/ui/zod_form_renderer.ts:128-132`)**:
   - `renderFormForZodSchema` currently falls back to `renderRawJsonField` for every `z.ZodRecord`, `z.ZodUnion`, and `z.ZodDiscriminatedUnion`.
   - Phases 40–48 added structured `ZodRecord` and union properties inside `rules.json`, `areas.json`, `dialogues.json`, `quests.json`, `triggers.json`, and `theme.json`:
     - `rules.materials` (`z.record(z.string(), MaterialDefinitionSchema)`)
     - `rules.blueprints` (`z.record(z.string(), ConstructionBlueprintSchema)`)
     - `rules.craftingRecipes` (`z.record(z.string(), CraftingRecipeSchema)`)
     - `rules.psychology.thoughtDefinitions` (`z.record(z.string(), ThoughtRuleDefinitionSchema)`)
     - `rules.psychology.needDecayMultipliers` (`z.record(z.string(), z.number())`)
     - `rules.macroWorld.areaSiteBindings` (`z.record(z.string(), z.string())`)
     - `rules.spawning.spawnWeights` & `lootTable` (`z.record(z.string(), z.number())`)
     - `area.subBiomes` (`z.record(z.string(), z.number())`)
     - `DialogueConditionSchema`, `DialogueEffectSchema`, `TriggerConditionSchema`, `TriggerConsequenceSchema`, `QuestObjectiveSchema`, `QuestRewardSchema`, `SpritePackRefSchema`.
4. **Disconnected Foreign-Key Dropdowns (`src/rendering/ui/ui_utils.ts`) & `"Where Used"` Indexer (`src/editor/reference_index.ts`)**:
   - `getReferenceOptions(key, doc)` in `ui_utils.ts` only checks 16 hardcoded property names and misses Phase 40–48 foreign keys (`floor`, `wall`, `door`, `water`, `shore`, `plains`, `forest`, `ridge`, `road`, `openAir`, `underground`, `ramp`, `targetTileId`, `minedTileId`, `burnedTileId`, `obsidianTileId`, `materialId`, `boulderItemId`, `mineYieldItemId`, `collapseDropItemId`, `spawnFieldType`, `statusEffectId`, `portalTemplateId`, `thoughtOverride`, `baseUnitId`, `defaultValueDenominationId`).
   - `buildReferenceIndex(data)` in `src/editor/reference_index.ts` manually iterates over only 5 categories (`areas`, `entities`, `items`, `dialogues`, `quests`) and is currently ignored in `knip.json` because `<WhereUsedDrawer />` was never mounted into the Editor workspace.
5. **Single-Z Static Area Painter (`src/rendering/ui/area_static_painter.ts`)**:
   - Phase 46 added `staticMap.zLevels: Record<string, string[]>` (vertical slices such as `"-1"`, `"1"`, `"2"`) and `placedEntities[].z?: number`, and Phase 45 added `generatorType: 'streaming_overworld'`.
   - `area_static_painter.ts` only reads/writes `staticMap.layout` (`Z = 0`) and ignores `zLevels` and `placedEntities[].z`.

### 2.2 Inventory of Legacy Imperative Editor Files & Call Sites
- **Entry & Presenter Hook**:
  - `src/rendering/presenter.ts:10,63-76`: Currently toggles `#game-layout` / `#editor-layout` and calls `renderEditorUI(state, globalCampaignEditor)`.
  - `src/rendering/ui/core/AppUiRoot.tsx`: Mounts all gameplay HUD, menus, modals, `<DialogHost />`, `<ToastHost />`, `<TooltipHost />`, `<HelpModal />`, and `<LoadingOverlay />` into `#ui-root`.
  - Storing a reference to `globalCampaignEditor` (`EditorController`) in `uiStore` (or passing it via `uiStore.setEditorController(globalCampaignEditor)` in `initSession`) allows `<EditorShell />` to render directly inside `<AppUiRoot />` when `gameState?.uiMode === UIMode.Editor`, sharing `<DialogHost />`, `<ToastHost />`, `<TooltipHost />`, and `<HelpModal />` with zero duplicate overlays.
- **26 Legacy Imperative Editor Modules to Replace & Evict**:
  - Shell & Orchestration (7 files):
    1. `src/rendering/editor_ui.ts`
    2. `src/rendering/editor/editor_state.ts` (replaced by reactive `editorStore` / `uiStore` slice)
    3. `src/rendering/editor/editor_toolbar.ts`
    4. `src/rendering/editor/editor_sidebar.ts`
    5. `src/rendering/editor/editor_workspace.ts`
    6. `src/rendering/editor/editor_splash.ts`
    7. `src/rendering/editor/new_campaign_modal.ts`
  - Forms & Inspectors (7 files):
    8. `src/rendering/ui/zod_form_renderer.ts`
    9. `src/rendering/ui/zod_form_containers.ts`
    10. `src/rendering/ui/zod_form_primitives.ts`
    11. `src/rendering/ui/editor_forms.ts`
    12. `src/rendering/ui/editor_object_renderer.ts`
    13. `src/rendering/ui/where_used.ui.ts`
    14. `src/rendering/ui/validation_panel.ui.ts`
  - Visual & Domain Editors (7 files):
    15. `src/rendering/ui/area_editor.ts`
    16. `src/rendering/ui/area_static_painter.ts`
    17. `src/rendering/ui/area_playtest_menu.ui.ts`
    18. `src/rendering/ui/world_graph.ts` (while keeping pure `src/rendering/ui/world_graph_canvas.ts` physics/canvas draw helpers)
    19. `src/rendering/ui/dialogue_editor.ts`
    20. `src/rendering/ui/dialogue_simulator_panel.ts`
    21. `src/rendering/ui/faction_matrix_editor.ts`
    22. `src/rendering/ui/trigger_composer.ui.ts`
  - Simulation Labs (5 files + 1 DOM helper):
    23. `src/rendering/ui/ai_arena.ui.ts`
    24. `src/rendering/ui/director_sandbox.ui.ts` (plus refactoring `src/rendering/ui/director/director_controls.ts` & `director_telemetry_view.ts` into pure data helpers + Preact view)
    25. `src/rendering/ui/knowledge_simulator.ui.ts` (while keeping pure `src/rendering/ui/knowledge_sim_canvas.ts` physics/canvas draw helpers)
    26. `src/rendering/ui/narrative_fuzzer.ui.ts`
    27. `src/rendering/ui/balance_lab.ui.ts`
  - Legacy Prompt Modal & Stylesheet (2 files):
    28. `src/rendering/ui/modal.ui.ts` (only imported by `editor_sidebar.ts`, `dialogue_editor.ts`, `faction_matrix_editor.ts`)
    29. `src/styles/editor.css` (replaced by compact semantic token rules in `src/styles/views/editor.css` using `--ui-*` tokens).

### 2.3 DialogService & Toast Migration Audit in `src/editor/campaign_editor.ts`
- `src/editor/campaign_editor.ts` currently calls native `alert()` and `confirm()` in 5 methods:
  - `loadFromIDB` (line 142: `alert(...)`)
  - `saveWorkspace` (line 157: `alert('Workspace saved successfully!')`, line 160: `alert(...)`)
  - `importZipWorkspace` (line 179: `alert(...)`)
  - `exportZipWorkspace` (line 192: `confirm('Campaign has validation errors. Export anyway?')`, line 207: `alert(...)`)
- Updating `CampaignEditor` to use `dialogService.alert` / `dialogService.confirm` and `uiStore.pushToast` eliminates blocking browser dialogs from the controller as well.

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Producers / Events) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Configs / Tests / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. Schema-Driven Category & Reference Unification (`editor_config.ts`, `campaign.types.ts`, `reference_index.ts`, `ui_utils.ts`)** | `CampaignDataSchema` (`src/types/campaign.types.ts`), `RulesetContract.getEditorViewGroups` & `getSystemContentFiles` | `EditorActivityBar`, `EditorSidebar`, `EditorWorkspace`, `ZodFormRenderer`, `WhereUsedDrawer`, `buildReferenceIndex` | `tests/ruleset_invariants.test.ts` (imports `VIEW_GROUPS`), `src/constants/campaign.constants.ts` (`AUTHORING_LEVELS`), `knip.json` (un-ignore `reference_index.ts`) |
| **2. Preact `<EditorShell />` Mounted in `<AppUiRoot />` (`AppUiRoot.tsx`, `presenter.ts`, `ui_store.ts`, `input_scope_manager.ts`)** | `initSession` (`session_controller.ts`), `renderPresenterFrame` (`presenter.ts`), `inputScopeManager.setEditorHook` | `<EditorToolbar />`, `<EditorActivityBar />`, `<EditorSidebar />`, `<EditorSplash />`, `<NewCampaignModal />`, `<ValidationDock />`, `<DialogHost />`, `<ToastHost />` | `index.html` (`#editor-layout` / `#ui-root`), `src/styles/views/editor.css` (`--ui-*` tokens across `Obsidian & Brass`, `Parchment`, `Retro CRT`) |
| **3. Preact Recursive `ZodFormRenderer` (`ZodRecordEditor`, `ZodUnionEditor`, `WhereUsedDrawer`)** | `EditorWorkspace`, `AreaEditor`, `DialogueEditor` (`DialogueOptionSchema`), `CampaignCategorySchemas` | `EditorController.applyOperations`, `validation_navigator.ts` (`isPathExpanded`, `togglePath`, `revealField`), `WhereUsedDrawer` | All 33 `CampaignData` categories + nested `rules.{materials,blueprints,craftingRecipes,psychology,reputation,macroWorld}` |
| **4. Multi-Z Visual & Domain Editors (`AreaEditor`, `AreaStaticPainter`, `WorldGraph`, `DialogueEditor`, `FactionMatrixEditor`, `TriggerComposer`)** | `EditorWorkspace` routing for `areas`, `dialogues`, `factions`, `triggerComposer` | `createDisplay` / `drawCell` (`display.ts`), `getTileAt` (`map_accessor.ts`), `compileTrigger` (`trigger-composer.system.ts`), `evaluateCondition` (`trigger.system.ts`), `world_graph_canvas.ts` | `sessionStorage` (`editor_playtest_spawn` with optional `z`, `editor_active_document`, `editor_playtest`), `bootstrap.ts` playtest spawn reader |
| **5. Preact Simulation Labs & Legacy Eviction (`AiArena`, `DirectorSandbox`, `KnowledgeSimulator`, `NarrativeFuzzer`, `BalanceLab`)** | `EditorWorkspace` routing for `simulation` tab | `runAIArena`, `runEncounterArena`, `runEncounterDirector`, `runFuzzerOffload` (`worker_bridge.ts`), `runBalanceSimulations`, `knowledge_sim_canvas.ts` | Delete 28 legacy imperative files, remove 3 `knip.json` ignores, update `docs/ssot/ssot_console.json` & `docs/SSOT_CONSOLE.md` |

---

## 4. Mapping Tasks to Architecture & Design Rules

- **Milestone 169** maps to `docs/ARCHITECTURE.md` §4 (Preact UI Architecture & Scoped Input) and `AGENTS.md` Rule 21 (Schema-Driven Category Auto-Discovery).
- **Milestone 170** maps to `AGENTS.md` §5 (Data-Driven & JSON Rules: `z.discriminatedUnion` & `z.record` schema mirroring) and Milestone 76 Decision D1/D2 (`ReferenceIndex` WeakMap cache + persistent `ValidationDock`).
- **Milestone 171** maps to `docs/ARCHITECTURE.md` §9.32–9.33 (Phase 45 `MapAccessor` / `streaming_overworld` and Phase 46 Multi-Z `staticMap.zLevels` & 3D `placedEntities[].z`).
- **Milestone 172** maps to `docs/ARCHITECTURE.md` §4 (Eviction of legacy imperative DOM views, zero `knip.json` ignores, and 100% SSOT registry parity).
