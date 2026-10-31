# Implementation Plan — Campaign Editor Ruleset Integration (Milestone 100 Refinement)

## 1. Goal
Upgrade the Campaign Editor (`src/editor/` and `src/rendering/editor/`) to achieve full parity with the 2-tier (`Ruleset -> Campaign`) and 3-tier (`Engine -> System Content -> Campaign Content`) architecture:
1. Provide a ruleset-aware **"New Campaign" Modal** supporting both `🐉 D&D 3.5e` and `⚔️ Classic` with template options (Blank Slate vs Clone).
2. Add a **Bundled Campaign Browser** to the Workspace Welcome / Splash screen, allowing authors to browse and open disk campaigns (`dnd35e-crypt`, `default`, `shroudgarde`, `megacampaign`) grouped by ruleset.
3. Dynamically resolve **ViewGroups** in `editor_sidebar.ts` and `editor_workspace.ts` using `ruleset.getEditorViewGroups(VIEW_GROUPS)` instead of static arrays.
4. Add **`archetypeId` reference resolution** in `src/rendering/ui/ui_utils.ts` so entity forms provide an auto-complete dropdown from the active ruleset's `systemContent.archetypes`.
5. Automatically hydrate **Tier 2 System Content** whenever creating a blank slate campaign, opening a campaign from ZIP, or switching rulesets.

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters) | Downstream (Consumers / Validators / Renderers) | Lateral (Sibling Campaigns / Store / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Export `loadRulesetSystemContent` & `loadRulesetBaseContent` in `src/core/loader.ts`** | `src/core/loader.ts` (`loadCampaign`), `workspace_file_service.ts` | `editor_toolbar.ts`, `editor_workspace.ts`, `CampaignEditor` | Unit tests (`tests/dnd35e_cartridge.test.ts`), validator scripts |
| **2. Ruleset-Aware `createBlankSlateCampaign` & `createNewCampaign` in `workspace_file_service.ts`** | `editor_toolbar.ts` (`#btn-editor-new`) | `controller.resetDocument()`, `readCampaignFromZip()` | Initial entity templates (player & monster seeded with appropriate `archetypeId` for D&D 3.5e) |
| **3. Ruleset-Aware "New Campaign" Modal in `editor_toolbar.ts`** | User click on `#btn-editor-new` | `showNewCampaignModal()`, `controller.resetDocument()` | Replaces hardcoded binary `confirm()` popup with themed modal |
| **4. Bundled Campaign Browser in Splash Screen (`editor_workspace.ts`)** | Initial load / `#btn-editor-open` click | `loadCampaignRegistry()`, `getAllRulesets()`, `loadCampaign()` | IndexedDB workspaces displayed alongside bundled disk campaigns |
| **5. Dynamic ViewGroup Resolution in Sidebar & Workspace** | `renderSidebar()`, `renderWorkspace()` | `getRuleset(doc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)` | Fixes missing/misaligned custom ruleset tabs in editor |
| **6. `archetypeId` Dropdown in `ui_utils.ts`** | `getReferenceOptions('archetypeId', doc)` | `zod_form_renderer.ts` (Entity form editing) | Pulls from `doc.systemContent.archetypes` with `[ARCHETYPE]` badge |

---

## 3. Step-by-Step Implementation Details

### Step 1: Export Reusable System Content Loader Utilities in `src/core/loader.ts`
Extract and export:
- `loadRulesetSystemContent(rulesetId: RulesetId): Promise<Record<string, unknown>>`
- `loadRulesetBaseContent(rulesetId: RulesetId): Promise<{ items: Record<string, unknown>; effects: Record<string, unknown>; entities: Record<string, unknown>; status: Record<string, unknown> }>`

Use them inside `loadCampaign()` to eliminate code duplication and make them available to the Editor.

```typescript
export async function loadRulesetSystemContent(rulesetId: RulesetId): Promise<Record<string, unknown>> {
  const ruleset = getRuleset(rulesetId);
  const rulesetBasePath = `${import.meta.env.BASE_URL}data/rulesets/${ruleset.id}`;
  const systemDescriptors = ruleset.getSystemContentFiles?.() ?? [];
  const systemContentEntries = await Promise.all(
    systemDescriptors.map(async (desc) => {
      const content = await fetchOptionalJson(`${rulesetBasePath}/${desc.filename}`);
      return [desc.key, content] as const;
    })
  );
  const rawSystemContent: Record<string, unknown> = Object.fromEntries(systemContentEntries);
  return ruleset.parseSystemContent ? ruleset.parseSystemContent(rawSystemContent) : rawSystemContent;
}
```

### Step 2: Update `src/editor/workspace_file_service.ts`
1. Support `rulesetId: RulesetId = 'classic'` in `createBlankSlateCampaign(rulesetId, systemContent)`.
   - When `rulesetId === 'dnd35e'`:
     - Sets `manifest.rulesetId = 'dnd35e'`.
     - Player entity gets `archetypeId: 'player'`.
     - Goblin entity replaced with `skeleton` entity having `archetypeId: 'skeleton'`.
     - Sets `systemContent` if provided.
2. Add `createNewCampaign(rulesetId: RulesetId, templateCampaignId?: string): Promise<CampaignData>`:
   - If `templateCampaignId`: calls `loadCampaign(templateCampaignId)`.
   - If blank: calls `createBlankSlateCampaign(rulesetId, await loadRulesetSystemContent(rulesetId))`.
3. In `readCampaignFromZip()`: After parsing zip files, hydrate `data.systemContent = await loadRulesetSystemContent(data.manifest.rulesetId)`.

### Step 3: Implement "New Campaign" Modal in `src/rendering/editor/editor_toolbar.ts`
Replace the legacy binary confirmation with a modal `showNewCampaignModal(controller)`:
- Step 1: Choose Ruleset (`🐉 D&D 3.5e` or `⚔️ Classic`).
- Step 2: Choose Template:
  - For D&D 3.5e: "✨ Blank Slate (D&D 3.5e)" or "📦 Clone: Crypt of the Undead (`dnd35e-crypt`)".
  - For Classic: "✨ Blank Slate (Classic)" or "📦 Clone: Default Dungeon (`default`)" or "📦 Clone: Shroudgarde (`shroudgarde`)".
- Calls `createNewCampaign()` and `controller.resetDocument(doc)`.

### Step 4: Add Bundled Campaign Browser to Editor Splash Screen (`src/rendering/editor/editor_workspace.ts`)
In `renderWorkspace()` when `!editorState.activeGroupId`:
- Alongside the IndexedDB workspace list, render a "Registered Disk Campaigns" section.
- Fetches `loadCampaignRegistry()`.
- Groups campaigns by `rulesetId` (`🐉 D&D 3.5e` vs `⚔️ Classic`).
- Clicking a campaign loads it via `loadCampaign(id)` and calls `controller.resetDocument(doc)`, automatically navigating to the first group in the editor.

### Step 5: Fix ViewGroup Resolution in `editor_sidebar.ts` & `editor_workspace.ts`
Replace:
```typescript
const group = VIEW_GROUPS.find((g): boolean => g.id === editorState.activeGroupId);
```
With:
```typescript
const doc = controller.getDocument();
const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
const group = activeGroups.find((g): boolean => g.id === editorState.activeGroupId);
```
in both files.

### Step 6: Add `archetypeId` Resolution in `src/rendering/ui/ui_utils.ts`
In `getReferenceOptions(key: string, doc: CampaignData)`:
```typescript
if (key === 'archetypeId') {
  const archetypes = (doc.systemContent as Record<string, unknown> | undefined)?.archetypes;
  if (archetypes && typeof archetypes === 'object') {
    return Object.keys(archetypes).map((k) => ({
      value: k,
      label: `${k} [ARCHETYPE]`
    }));
  }
  return null;
}
```

### Step 7: Verification & Testing
1. Mental check: Zero `any`, zero magic strings, explicit return types.
2. Run full verification suite `./verify.sh` (TypeScript, Prettier, ESLint, dep-cruiser, Knip, Vitest, build, campaign-validator).
3. Verify compilation via `compile_applet`.
4. Run manual play-test simulation scenario in the editor.

---

## 4. Execution & Verification Results (Completed)

- **TypeScript (`tsc --noEmit`)**: 0 errors. Strict typing enforced (`exactOptionalPropertyTypes: true`, zero `any`, zero untyped returns).
- **Prettier**: 100% formatted.
- **ESLint**: 0 errors, 0 warnings.
- **Dependency-Cruiser DAG**: Strict downward flow preserved (`main → rendering/editor → core → systems → map → types/constants`).
- **Knip**: 0 unused files, 0 unused exports, 0 unused dependencies.
- **Regression Tests (`bun test`)**: 30 passing tests (380 expect assertions) across 12 test files in 582ms.
- **Vite Production Build**: Compiled successfully (`dist/index.html`, chunks generated).
- **Campaign Validator (`run-validator.ts`)**: 4/4 campaigns validated (`default`, `dnd35e-crypt`, `megacampaign`, `shroudgarde`), 0 errors, 0 warnings.
- **Applet Compilation (`compile_applet`)**: Build succeeded.

---

## 5. Architecture Compliance Audit
- **ECS Purity**: No DOM or renderer logic leaked into components or systems.
- **Deterministic Runtimes**: Zero calls to `Math.random()` or unseeded generators.
- **Zero Pill / Anti-AI Slop**: Used native DOM elements with semantic badges (`[ARCHETYPE]`, `[ST]`, `[BP]`, `[DYN]`).
- **Rule 15 Cascading Matrix**: Upstream callers, downstream consumers, and lateral campaign mirrors re-verified and aligned.

