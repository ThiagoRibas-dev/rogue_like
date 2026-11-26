# Implementation Plan — Phase 44 (Milestones 169–172): Campaign Editor Rewrite on Shared Preact Primitives, Schema Auto-Discovery, Scoped Input & Unified Themes

## 1. Architectural Governance & Audit Tables

### 1.1 Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / Introspection Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Campaign Category Tab & Panel Type Discovery** | Maintaining 4 manual lists (`CampaignDataSchema`, `CampaignCategorySchemas`, `AUTHORING_LEVELS`, `VIEW_GROUPS`) where new categories are forgotten | Auto-derive `CampaignCategorySchemas` and `panelType` (`'dictionary'` for `ZodRecord`, `'singleton'` for `ZodObject`/`ZodArray`) by unwrapping `CampaignDataSchema.shape`, backed by compile-time exhaustive `Record<keyof CampaignData, CampaignCategoryMeta>` + auto-fallback bucketing | **Yes** — Adding any key to `CampaignDataSchema` enforces metadata at compile time and auto-renders its dictionary or singleton editor |
| **Nested `z.record(Key, Value)` Authoring (`rules.materials`, `rules.blueprints`, `rules.craftingRecipes`, `rules.psychology.thoughtDefinitions`, `area.subBiomes`)** | Hardcoding custom form panels per `rules.*` section or dumping raw JSON into `<textarea>` (`renderRawJsonField`) | First-class `<ZodRecordEditor />` in `ZodFormRenderer` that inspects `schema.valueSchema` and renders either compact key-value primitive rows or collapsible keyed child object forms with Add / Rename / Delete | **Yes** — Any new `z.record(...)` anywhere in `CampaignDataSchema` gets a full structured dictionary UI automatically |
| **Discriminated Unions & Union Variants (`DialogueCondition`, `TriggerConsequence`, `QuestObjective`, `SpritePackRef`)** | Falling back to raw JSON `<textarea>` when encountering `ZodDiscriminatedUnion` or `ZodUnion` | First-class `<ZodUnionEditor />` that inspects `discriminator` + `optionsMap` (or union branch types) to render a variant selector `<Select />` and recursively renders the active branch's `ZodObject` shape | **Yes** — Any new discriminated union variant added to Zod schemas appears in the variant dropdown automatically |
| **Foreign-Key Reference Dropdowns & `"Where Used"` (`ReferenceIndex`)** | Separate hardcoded `if (key === ...)` chains in `ui_utils.ts` and manual 5-category loops in `reference_index.ts` | Single `resolveFieldReferenceKind(fieldKey, jsonPath, schemaDescription)` + generic schema-guided document walker (`walkCampaignReferences`) shared by both `getReferenceOptions` and `buildReferenceIndex` | **Yes** — Any `*TileId`, `*ItemId`, `*AreaId`, `materialId`, `*StatusId`, `*FieldId`, `*Tag*`, etc. anywhere in the schema gets both a dropdown picker and `"Where Used"` tracking automatically |

---

### 1.2 SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Canonical New Owner (`src/rendering/ui/editor/*` / `src/editor/*`) | Evicted Legacy Module(s) |
| :--- | :--- | :--- |
| **Editor Controller Interface & Reactive Editor Store** | `src/editor/campaign_editor.ts` (`EditorController` export) + `src/rendering/ui/editor/editor_store.ts` | `src/rendering/editor_ui.ts`, `src/rendering/editor/editor_state.ts` |
| **Schema-Driven Category & View Group Registry** | `src/rendering/editor/editor_config.ts` (introspecting `CampaignDataSchema.shape`) | Manual `VIEW_GROUPS` list missing 12 categories |
| **Editor Shell, Toolbar, Activity Bar, Sidebar, Splash, New Campaign Modal, Validation Dock** | `src/rendering/ui/editor/{EditorShell,EditorToolbar,EditorActivityBar,EditorSidebar,EditorSplash,NewCampaignModal,ValidationDock}.tsx` | `src/rendering/editor/{editor_toolbar,editor_sidebar,editor_workspace,editor_splash,new_campaign_modal}.ts`, `src/rendering/ui/validation_panel.ui.ts` |
| **Recursive Preact Zod Form Engine (`ZodObject`, `ZodArray`, `ZodRecord`, `ZodUnion`)** | `src/rendering/ui/editor/forms/{ZodFormRenderer,ZodFormContainers,ZodFormPrimitives,ZodRecordEditor,ZodUnionEditor}.tsx` | `src/rendering/ui/{zod_form_renderer,zod_form_containers,zod_form_primitives,editor_forms,editor_object_renderer}.ts` |
| **Unified Foreign-Key Reference Picker & Where-Used Inspector** | `src/editor/reference_index.ts` + `src/rendering/ui/ui_utils.ts` + `src/rendering/ui/editor/WhereUsedDrawer.tsx` | `src/rendering/ui/where_used.ui.ts` (and remove `knip.json` ignores) |
| **Multi-Z Area Editor, Static Painter, Playtest Menu & World Graph** | `src/rendering/ui/editor/views/{AreaEditor,AreaStaticPainter,WorldGraph}.tsx` (consuming pure `world_graph_canvas.ts`) | `src/rendering/ui/{area_editor,area_static_painter,area_playtest_menu.ui,world_graph}.ts` |
| **Dialogue Tree Editor, Simulator, Faction Matrix & Trigger Composer** | `src/rendering/ui/editor/views/{DialogueEditor,DialogueSimulatorPanel,FactionMatrixEditor,TriggerComposer}.tsx` | `src/rendering/ui/{dialogue_editor,dialogue_simulator_panel,faction_matrix_editor,trigger_composer.ui}.ts` |
| **Simulation Labs (AI Arena, Encounter Director, Knowledge Sim, Fuzzer, Balance Lab)** | `src/rendering/ui/editor/labs/{SimulationLab,AiArena,DirectorSandbox,KnowledgeSimulator,NarrativeFuzzer,BalanceLab}.tsx` + pure `src/rendering/ui/director/director_telemetry_view.ts` | `src/rendering/ui/{ai_arena.ui,director_sandbox.ui,knowledge_simulator.ui,narrative_fuzzer.ui,balance_lab.ui}.ts`, `src/rendering/ui/director/director_controls.ts` |
| **In-App Prompt / Confirm / Alert Dialogs & Editor Styling** | `src/rendering/ui/primitives/dialog_service.ts` + `src/styles/views/editor.css` (`--ui-*` tokens) | `src/rendering/ui/modal.ui.ts`, `src/styles/editor.css` |

---

### 1.3 Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **M169: Schema-Driven `VIEW_GROUPS` & `CampaignCategorySchemas`** | `CampaignDataSchema` (`src/types/campaign.types.ts`), `RulesetContract.getEditorViewGroups` | `EditorActivityBar`, `EditorSidebar`, `EditorWorkspace` (uses raw `CampaignDataSchema.shape[key]` for optional singletons), `ZodFormRenderer` | `tests/ruleset_invariants.test.ts`, `tests/phase44_preact_editor.test.tsx`, `src/constants/campaign.constants.ts` (`AUTHORING_LEVELS`) |
| **M169: `<EditorShell />` in `<AppUiRoot />` & `EditorController`** | `initSession` (`src/core/session_controller.ts`), `renderPresenterFrame` (`src/rendering/presenter.ts`) | `<AppUiRoot />`, `<EditorShell />`, `editorStore.bindController`, `inputScopeManager.setEditorHook` | `<DialogHost />`, `<ToastHost />`, `<TooltipHost />`, `<HelpModal />` (`UIMode.Editor`), `index.html` (`#editor-layout` removed) |
| **M170: Unified `reference_index.ts` & `<ZodFormRenderer />`** | `CampaignDataSchema` (`.default(...)` honored in `buildDefaultValueForZodSchema`), `EditorController.getDocument()` | `ZodFormPrimitives` reference `<Select />`, `<ZodRecordEditor />`, `<ZodUnionEditor />`, `<WhereUsedDrawer />`, `validation_navigator.ts` | `knip.json` (emptied `ignore` array; removed `reference_index.ts`, `editor_object_renderer.ts`, `where_used.ui.ts`) |
| **M171: Multi-Z `<AreaStaticPainter />` & 3D Playtest Spawn** | `AreaDefinition.staticMap` (`layout` + `zLevels`), `placedEntities[].z` | `createDisplay` / `drawCell` (`src/rendering/display.ts`), `sessionStorage.setItem('editor_playtest_spawn', ...)` | `src/core/bootstrap.ts` & `src/core/session/session_dom.ts` (`SpawnOverride.z` preserved across reloads) |
| **M172: Simulation Labs & Legacy File Eviction** | `<EditorWorkspace />` (`tab.id === 'simulation'`) | `runAIArena`, `runEncounterDirector`, `runFuzzerOffload`, `runBalanceSimulations`, pure `director_telemetry_view.ts` | `docs/ssot/ssot_console.json` (removed `renderMiniMap` + 29 legacy entries, added 30 Preact entries), `docs/SSOT_CONSOLE.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, `docs/MILESTONES.md` |

---

## 2. Detailed Milestone Implementation Design & Code Snippets

### Milestone 169: Schema-Driven Category Auto-Discovery, `<AppUiRoot />` Editor Shell, `EditorScope` Input & `DialogService` Migration

#### 2.1 Auto-Deriving `CampaignCategorySchemas` in `src/types/campaign.types.ts`
Instead of manually listing all 33 keys in `CampaignCategorySchemas`, we unwrap `CampaignDataSchema.shape` dynamically:

```typescript
/**
 * Unwraps optional/default/nullable wrappers around a Zod schema.
 */
export function unwrapZodSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let curr = schema;
  while (
    curr instanceof z.ZodOptional ||
    curr instanceof z.ZodNullable ||
    curr instanceof z.ZodDefault
  ) {
    if (curr instanceof z.ZodDefault) {
      curr = curr.removeDefault();
    } else {
      curr = (curr as z.ZodOptional<z.ZodTypeAny>).unwrap();
    }
  }
  return curr;
}

/**
 * Auto-derives the item/form Zod schema for each top-level CampaignData category:
 * - For dictionary categories (`z.record(z.string(), ItemSchema)`), returns `ItemSchema`
 *   (except `factions`, which is a 2D `FactionMatrixSchema` singleton/custom grid).
 * - For singleton categories (`z.object(...)` or `z.array(...)`), returns the unwrapped schema.
 */
function buildCampaignCategorySchemas(): Record<keyof CampaignData, z.ZodTypeAny> {
  const result = {} as Record<keyof CampaignData, z.ZodTypeAny>;
  const shape = CampaignDataSchema.shape;
  for (const key of Object.keys(shape) as Array<keyof CampaignData>) {
    const raw = unwrapZodSchema(shape[key]);
    if (key !== 'factions' && raw instanceof z.ZodRecord) {
      result[key] = raw.valueSchema;
    } else {
      result[key] = raw;
    }
  }
  return result;
}

export const CampaignCategorySchemas: Record<keyof CampaignData, z.ZodTypeAny> =
  buildCampaignCategorySchemas();
```

#### 2.2 Compile-Time Exhaustive Category Metadata & Auto-Discovery (`src/rendering/editor/editor_config.ts`)
We keep `src/rendering/editor/editor_config.ts` at its canonical path (so `tests/ruleset_invariants.test.ts` and `RulesetContract.getEditorViewGroups` require zero breaking path changes), and derive `VIEW_GROUPS` and `AUTHORING_LEVELS` from a single compile-time exhaustive `CAMPAIGN_CATEGORY_META: Record<keyof CampaignData, CampaignCategoryMeta>` plus `CampaignDataSchema.shape` introspection:

```typescript
export type EditorGroupId = 'core' | 'actors' | 'narrative' | 'world' | 'adversary' | 'tools';

export interface CampaignCategoryMeta {
  readonly groupId: EditorGroupId;
  readonly label: string;
  readonly authoringLevel: 'Static' | 'Blueprint' | 'Dynamic';
  readonly customPanel?: boolean;
}

export const CAMPAIGN_CATEGORY_META: Readonly<Record<keyof CampaignData, CampaignCategoryMeta>> = {
  manifest: { groupId: 'core', label: 'Manifest', authoringLevel: 'Static' },
  rules: { groupId: 'core', label: 'Rules & Simulation', authoringLevel: 'Static' },
  theme: { groupId: 'core', label: 'Theme & Sprites', authoringLevel: 'Static' },
  advancement: { groupId: 'core', label: 'Advancement', authoringLevel: 'Static' },
  tagRegistry: { groupId: 'core', label: 'Tag Registry', authoringLevel: 'Dynamic' },
  worldEvents: { groupId: 'core', label: 'World Events', authoringLevel: 'Blueprint' },
  systemContent: { groupId: 'core', label: 'System Overrides', authoringLevel: 'Static' },

  status: { groupId: 'actors', label: 'Status Effects', authoringLevel: 'Static' },
  effects: { groupId: 'actors', label: 'Item Effects', authoringLevel: 'Static' },
  items: { groupId: 'actors', label: 'Items & Equip', authoringLevel: 'Static' },
  traitRegistry: { groupId: 'actors', label: 'Traits', authoringLevel: 'Dynamic' },
  entities: { groupId: 'actors', label: 'Entities', authoringLevel: 'Static' },
  ai: { groupId: 'actors', label: 'AI Profiles', authoringLevel: 'Blueprint' },
  identityGeneration: { groupId: 'actors', label: 'Identity Tables', authoringLevel: 'Blueprint' },
  personalityGeneration: { groupId: 'actors', label: 'Personality Tables', authoringLevel: 'Blueprint' },
  relationshipThresholds: { groupId: 'actors', label: 'Relation Thresholds', authoringLevel: 'Dynamic' },
  factions: { groupId: 'actors', label: 'Faction Matrix', authoringLevel: 'Static', customPanel: true },

  dialogues: { groupId: 'narrative', label: 'Dialogues', authoringLevel: 'Static' },
  quests: { groupId: 'narrative', label: 'Quests', authoringLevel: 'Static' },
  questTemplates: { groupId: 'narrative', label: 'Quest Templates', authoringLevel: 'Blueprint' },
  knowledgePropagation: { groupId: 'narrative', label: 'Knowledge Rules', authoringLevel: 'Blueprint' },
  rumorPropagation: { groupId: 'narrative', label: 'Rumor Rules', authoringLevel: 'Blueprint' },
  triggers: { groupId: 'narrative', label: 'Triggers', authoringLevel: 'Static' },
  triggerTemplates: { groupId: 'narrative', label: 'Trigger Templates', authoringLevel: 'Blueprint' },
  triggerBuckets: { groupId: 'narrative', label: 'Trigger Buckets', authoringLevel: 'Dynamic' },

  tiles: { groupId: 'world', label: 'Tiles', authoringLevel: 'Static' },
  fields: { groupId: 'world', label: 'Fields', authoringLevel: 'Static' },
  reactions: { groupId: 'world', label: 'Field Reactions', authoringLevel: 'Dynamic' },
  spawnPools: { groupId: 'world', label: 'Spawn Pools', authoringLevel: 'Blueprint' },
  encounterProfiles: { groupId: 'world', label: 'Encounter Profiles', authoringLevel: 'Blueprint' },
  areas: { groupId: 'world', label: 'Areas (Maps)', authoringLevel: 'Static' },

  villains: { groupId: 'adversary', label: 'Villains', authoringLevel: 'Static' },
  schemeRecipes: { groupId: 'adversary', label: 'Schemes', authoringLevel: 'Blueprint' },
  phaseBlocks: { groupId: 'adversary', label: 'Phase Blocks', authoringLevel: 'Dynamic' },
  agreements: { groupId: 'adversary', label: 'Agreements', authoringLevel: 'Static' },
  nemesisHierarchies: { groupId: 'adversary', label: 'Nemesis Hierarchies', authoringLevel: 'Blueprint' }
};
```
And `resolveCategoryPanelType(key)` inspects `unwrapZodSchema(CampaignDataSchema.shape[key])`:
- If `meta.customPanel === true`, returns `'custom'`.
- Else if `raw instanceof z.ZodRecord`, returns `'dictionary'`.
- Else returns `'singleton'`.

#### 2.3 Reactive Editor Store & `<EditorShell />` in `<AppUiRoot />`
- Create `src/rendering/ui/editor/editor_store.ts` holding:
  - `controller: EditorController | null`
  - `activeGroupId: string | null`
  - `activeTabId: string | null`
  - `activeItemId: string | null`
  - `searchFilter: string`
  - `sidebarWidth: number`
  - `sidebarCollapsed: boolean`
  - `validationDockOpen: boolean`
  - `whereUsedTarget: { readonly kind: string; readonly id: string } | null`
  - `newCampaignModalOpen: boolean`
  - `documentVersion: number` (incremented via `controller.onChange`)
  - `errors: ReadonlyArray<ValidationError>`
- In `src/rendering/presenter.ts`:
  - Bind `editorStore.bindController(globalCampaignEditor)` and toggle `#game-layout` hidden when `state.uiMode === UIMode.Editor`.
- In `src/rendering/ui/core/AppUiRoot.tsx`:
  - Render `<EditorShell />` above `<DialogHost />`, `<ToastHost />`, and `<TooltipHost />`. When `gameState?.uiMode === UIMode.Editor`, `<EditorShell />` mounts a full-viewport `.ui-editor-shell` container with `data-ui-density="compact"`.
- In `src/editor/campaign_editor.ts`:
  - Export `EditorController` interface directly from `src/editor/campaign_editor.ts` and replace its 5 native `alert()`/`confirm()` calls with `dialogService.alert` / `dialogService.confirm` and `uiStore.pushToast`.

---

### Milestone 170: Declarative Preact Zod Form Engine (`ZodRecord` & `ZodDiscriminatedUnion`), Unified Schema Reference Resolver & Where-Used Inspector

#### 2.4 Unified Foreign-Key Reference Resolver (`src/editor/reference_index.ts` & `src/rendering/ui/ui_utils.ts`)
We unify foreign-key detection into `resolveFieldReferenceKind(key: string, path: string)` in `src/editor/reference_index.ts`:
- Recognizes all canonical foreign-key targets across Phases 1–48:
  - `'tile'`: `key === 'tileId'`, `key.endsWith('TileId')` (`targetTileId`, `minedTileId`, `burnedTileId`, `obsidianTileId`), `path` inside `/proceduralPalette/(floor|wall|water)` or `/streamingConfig/biomePalette/*` or `/staticMap/legend/*`
  - `'entity'`: `key === 'entityId'`, `key === 'entityTemplateId'`, `key === 'portalTemplateId'`, `key === 'promotionSource'`, `key === 'promotionSources'`, `path` inside `/proceduralPalette/door` or `/staticMap/entityLegend/*`
  - `'item'`: `key === 'itemId'`, `key.endsWith('ItemId')` (`boulderItemId`, `mineYieldItemId`, `collapseDropItemId`), `key === 'inventory'`
  - `'entity_or_item'`: `key === 'templateId'`
  - `'area'`: `key === 'startingAreaId'`, `key === 'targetArea'`, `key === 'targetAreaId'`, `key === 'areaId'`
  - `'status'`: `key === 'statusId'`, `key === 'statusEffectId'`
  - `'effect'`: `key === 'effectId'`
  - `'field'`: `key === 'spawnFieldType'`, `key === 'fieldId'`
  - `'material'`: `key === 'materialId'` (resolves against `doc.rules.materials`)
  - `'thought'`: `key === 'thoughtOverride'` (resolves against `doc.rules.psychology?.thoughtDefinitions`)
  - `'currency'`: `key === 'baseUnitId'`, `key === 'defaultValueDenominationId'` (resolves against `doc.rules.currency?.denominations`)
  - `'faction'`: `key === 'faction'`, `key.toLowerCase().includes('factionid')`, `key === 'eligibleFactions'`
  - `'ai'`: `key === 'profileId'`
  - `'dialogue'`: `key === 'dialogueId'`
  - `'quest'`: `key === 'questId'`, `key === 'nextQuestId'`
  - `'questTemplate'`: `key === 'questTemplateId'`
  - `'encounterProfile'`: `key === 'encounterProfileId'`
  - `'rumor'`: `key === 'injectRumorId'`
  - `'tag'`: `key.toLowerCase().includes('tag')` (`tags`, `directorTags`, `roleTags`, `incomingTags`, `targetTags`, `eligibleTags`, `raiderFactionTags`, `requiredToolTag`, `workshopTag`)
  - `'sprite'`: `key === 'spriteId'`
  - `'archetype'`: `key === 'archetypeId'`
  - `'eventType'`: `key === 'eventType'`
- **`buildReferenceIndex(data: CampaignData)`** walks `data` generically using `resolveFieldReferenceKind` (plus special multi-kind cases like `quest.objectives[i].targetId` and intra-dialogue `nextNodeId`/`onKnownNodeId`/`onUnknownNodeId`/`startNodeId`), caching via `WeakMap<object, ReferenceIndex>`.
- **`getReferenceOptions(key: string, doc: CampaignData, path?: string)`** queries the exact same `resolveFieldReferenceKind(key, path ?? '')` to populate `<Select />` options in `<ZodFormRenderer />`!
- **`<WhereUsedDrawer />`** renders in the Editor right rail / drawer whenever the author clicks `"🔍 Where Used (N)"` on any dictionary item or sidebar row, and clicking any usage calls `editorStore.navigateToPath(usage.sourcePath)` + `revealField(usage.sourcePath)`.

#### 2.5 Preact `<ZodFormRenderer />`, `<ZodRecordEditor />` & `<ZodUnionEditor />`
- **`<ZodFormRenderer />` (`src/rendering/ui/editor/forms/ZodFormRenderer.tsx`)**:
  - Unwraps `ZodOptional`, `ZodNullable`, `ZodDefault`, `ZodEffects`.
  - Dispatches to:
    - `<ZodObjectField />` (using collapsible `<Accordion />` with error-count badge, glyph preview swatch when `glyph`/`fg`/`bg` exist, and persistent expansion via `isPathExpanded`/`togglePath`).
    - `<ZodArrayField />` (drag-and-drop reorderable list or `<MultiSelectTagsField />` for string tag arrays).
    - `<ZodRecordEditor />` for `z.ZodRecord`:
      - Allows adding a new key via inline input or `dialogService.prompt`, deleting keys, and rendering each entry's value recursively with `<ZodFormRenderer />` (compact inline row for `ZodNumber`/`ZodString`/`ZodBoolean`/`ZodEnum`, or nested `<Accordion />` for `ZodObject`).
    - `<ZodUnionEditor />` for `z.ZodDiscriminatedUnion` and `z.ZodUnion`:
      - For `ZodDiscriminatedUnion` (e.g., `type` discriminator on conditions, consequences, effects, objectives, rewards), renders a `<Select />` for the discriminator key and renders the matching variant `ZodObject` fields below it.
      - For `ZodUnion` (e.g., `SpritePackRefSchema` which is `string | { packId, includeSheets }` or tileMap `[x, y] | { default, commonAlts, rareAlts }`), switches cleanly between the union branches.
    - `<ZodPrimitiveField />` for `ZodString` (with color picker, reference `<Select />`, or `<TextInput />`), `ZodNumber` (`<NumberInput />`), `ZodBoolean` (`<Checkbox />`), and `ZodEnum` (`<Select />`).

---

### Milestone 171: Multi-Z Visual & Graph Editor Workspaces

#### 2.6 Multi-Z `<AreaEditor />` & `<AreaStaticPainter />` (`src/rendering/ui/editor/views/AreaStaticPainter.tsx`)
- Adds a **Z-Level Toolbar**:
  - Lists all active Z-slices for the area: `Z = 0` (`staticMap.layout`) plus any integer keys in `staticMap.zLevels` sorted ascending (e.g. `Z-1`, `Z0`, `Z+1`, `Z+2`).
  - `+ Z Above` / `+ Z Below` buttons initialize a new Z-slice in `staticMap.zLevels[String(newZ)]` (defaulting to `' '.repeat(width)` mapped to `'open_air'` for `Z > 0` or `'stone_wall'`/`'floor'` for `Z < 0`), and `🗑 Remove Z` removes non-zero Z-slices via `dialogService.confirm`.
  - Painting tiles at `activeZ === 0` patches `${basePath}/staticMap/layout/${y}`; painting tiles at `activeZ !== 0` patches `${basePath}/staticMap/zLevels/${activeZ}/${y}`.
  - Painting entities/items stamps `{ templateId: activePaintId, x, y, ...(activeZ !== 0 ? { z: activeZ } : {}) }` into `placedEntities`, and only draws `placedEntities` whose `(ent.z ?? 0) === activeZ`.
  - Right-clicking any tile opens `<AreaPlaytestMenu />` with `"Playtest from (${x}, ${y}, Z=${activeZ})"`, storing `{ areaId, x, y, z: activeZ }` in `sessionStorage.getItem('editor_playtest_spawn')` (and `src/core/bootstrap.ts` forwards `spawn.z` to player spawn position).
- In `<AreaEditor />`'s **Live Generator Sandbox** (for `digger`, `cellular`, `dla`, and `streaming_overworld`), adds a Z-slice preview stepper (`Z-1`, `Z0`, `Z+1`) using `getTileAt(generated.map, wx, wy, previewZ)` so multi-Z procedural and streaming overworld maps can be inspected across vertical strata.

#### 2.7 `<WorldGraph />`, `<DialogueEditor />`, `<FactionMatrixEditor />` & `<TriggerComposer />`
- **`<WorldGraph />`**: Preact component wrapping `world_graph_canvas.ts` (`stepWorldGraphSimulation`, `drawWorldGraph`) with `useEffect` cleanup for `requestAnimationFrame` and `ResizeObserver` (no `MutationObserver` on `document.body` needed!).
- **`<DialogueEditor />` & `<DialogueSimulatorPanel />`**: Preact split workspace with node list/tree navigation, inline option editor modal using `<ModalShell />` + `<ZodFormRenderer schema={DialogueOptionSchema} />`, `dialogService.prompt` for new nodes/options, and live emergent simulator panel.
- **`<FactionMatrixEditor />`**: Preact 2D table using `--ui-*` semantic tokens and `dialogService.prompt` / `dialogService.confirm` for adding/removing factions.
- **`<TriggerComposer />`**: Preact split workspace compiling `TriggerTemplate` placeholders via `compileTrigger`, live JSON preview, and baking to `/triggers/${id}` with `dialogService.confirm` on overwrite and `uiStore.pushToast` on success.

---

### Milestone 172: Simulation Tooling Rewrite & Legacy Imperative UI Eviction

#### 2.8 Preact Simulation Labs (`src/rendering/ui/editor/labs/*`)
- **`<SimulationLab />`**: Hosts a `<Tabs />` bar switching between:
  1. **`<AiArena />`**: Combatant A vs. Combatant B selector, max turns input, and combat log viewer calling `runAIArena`.
  2. **`<DirectorSandbox />`**: Area/Seed/Budget/Profile/Level controls, live mini-map grid, tabbed Director Receipt & Baked JSON preview, `"Bake Static Area"` via `dialogService.prompt`, `"Auto-Simulate"` via `runEncounterArena`, and `"Play Encounter"` event dispatch.
  3. **`<KnowledgeSimulator />`**: Force-directed rumor propagation canvas (using pure `knowledge_sim_canvas.ts` with `useEffect` lifecycle cleanup) + rule/NPC controls and step log.
  4. **`<NarrativeFuzzer />`**: Worker-offloaded batch fuzzer controls (`runFuzzerOffload`), 5 aggregate metric cards, expandable run timelines, and `"Replay Visually"` via `dialogService.confirm`.
  5. **`<BalanceLab />`**: Automated combat/hunger/scheme pacing simulator (`runBalanceSimulations`) with semantic status badges.

#### 2.9 Legacy Eviction, `knip.json` Cleanup, Tests & SSOT Sync
1. Delete the 28 obsolete imperative `.ts` and `.css` files listed in §1.2.
2. Remove `"src/editor/reference_index.ts"`, `"src/rendering/ui/editor_object_renderer.ts"`, and `"src/rendering/ui/where_used.ui.ts"` from `knip.json` (`"ignore": []`).
3. Replace `@import './styles/editor.css';` in `src/index.css` with `@import './styles/views/editor.css';` authored purely with `--ui-*` semantic tokens.
4. Add comprehensive regression test suite `tests/phase44_preact_editor.test.tsx` verifying:
   - 100% category auto-discovery parity across `Object.keys(CampaignDataSchema.shape)` and `VIEW_GROUPS`.
   - Unified foreign-key `getReferenceOptions` and generic `buildReferenceIndex` coverage across Phase 40–48 fields (`minedTileId`, `boulderItemId`, `materialId`, `spawnFieldType`, `thoughtOverride`, `streamingConfig.biomePalette`, etc.).
   - Preact `<EditorShell />`, `<ZodFormRenderer />` (`ZodObject`, `ZodArray`, `ZodRecord`, `ZodDiscriminatedUnion`), `<WhereUsedDrawer />`, `<AreaStaticPainter />` multi-Z `zLevels` painting, `<DialogueEditor />`, `<FactionMatrixEditor />`, `<TriggerComposer />`, and `<SimulationLab />`.
5. Update `docs/ssot/ssot_console.json`, regenerate `docs/SSOT_CONSOLE.md` via `bun scripts/map-codebase.ts`, update `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, and `docs/MILESTONES.md`, and run `./verify.sh` across all 8 stages.
