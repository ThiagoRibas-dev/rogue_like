# Research Notes — Campaign Editor & Ruleset Architecture Audit

## 1. Audit Question
> "We changed the New Game flow to account for the new system -> campaign, but did we remember to update the campaign editor?"

---

## 2. Current State Audit

### What Was Already Updated for Rulesets
1. **Ruleset Badge in Toolbar (`src/rendering/editor/editor_toolbar.ts`)**:
   - The toolbar renders an `#editor-ruleset-badge` showing `${activeRuleset.metadata.badgeIcon} ${activeRuleset.metadata.shortLabel}` (e.g., `🐉 D&D 3.5e` or `⚔️ Classic`), updated dynamically whenever the document changes.
2. **Ruleset-Specific Campaign Validation (`src/editor/campaign_validator.ts`)**:
   - Deep validation invokes `getRuleset(campaign.manifest?.rulesetId).validateCampaignRuleset?.(campaign)`, catching missing system content or invalid `archetypeId` foreign keys during editor validation dock updates and export checks.
3. **Activity Bar Ruleset Scoping (`src/rendering/editor_ui.ts`)**:
   - `renderActivityBar()` queries `getRuleset(doc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)`.

---

## 3. Identified Gaps in the Campaign Editor

### Gap A: New Campaign Flow in Editor Toolbar (`#btn-editor-new`)
- **Location**: `src/rendering/editor/editor_toolbar.ts` (lines 140–154)
- **Problem**: Clicking "✨ New" pops up a hardcoded binary confirmation:
  `"Press OK to start with a Clone of Default, or Cancel to start from a Blank Slate."`
  - "Clone of Default" hardcodes `loadCampaign('default')` (`classic`).
  - "Blank Slate" calls `createBlankSlateCampaign()`, which hardcodes `rulesetId: 'classic'`.
- **Impact**: Authors cannot create a new D&D 3.5e campaign from the editor toolbar or clone `dnd35e-crypt`.

### Gap B: Workspace Splash Screen / Campaign Browser (`src/rendering/editor/editor_workspace.ts`)
- **Location**: `src/rendering/editor/editor_workspace.ts` (lines 33–72)
- **Problem**: When no tab is open (Splash Welcome Screen) or clicking "📂 Resume Workspace", the editor only queries IndexedDB (`listEditorWorkspaces()`).
- **Impact**: There is no UI to browse and load bundled disk campaigns into the editor. While the Title Screen has a 2-step `Ruleset Selection -> Campaign Selection` modal, the editor lacks a way to open bundled campaigns by ruleset (e.g., opening `dnd35e-crypt` to edit it).

### Gap C: Inconsistent ViewGroup Lookup in Sidebar and Workspace
- **Location**: `src/rendering/editor/editor_sidebar.ts` (line 14) and `src/rendering/editor/editor_workspace.ts` (line 74)
- **Problem**: While `renderActivityBar()` calls `ruleset.getEditorViewGroups(VIEW_GROUPS)`, both `editor_sidebar.ts` and `editor_workspace.ts` lookup active groups from the raw, static `VIEW_GROUPS` array:
  `const group = VIEW_GROUPS.find((g): boolean => g.id === editorState.activeGroupId);`
- **Impact**: If a ruleset cartridge injects or modifies custom ViewGroups or tabs via `getEditorViewGroups()`, the sidebar and workspace fail to resolve them.

### Gap D: Entity Template Reference Dropdown for System Archetypes
- **Location**: `src/rendering/ui/ui_utils.ts` (`getReferenceOptions`)
- **Problem**: `getReferenceOptions()` resolves foreign-key dropdown choices for `faction`, `startingAreaId`, `effectId`, `profileId`, `statusId`, `dialogueId`, `templateId`, `tag`, etc., but **does not handle `archetypeId`**.
- **Impact**: In `EntityTemplate` forms, `archetypeId` is rendered as a raw string input instead of a dropdown populated from the ruleset's `systemContent.archetypes` (`player`, `skeleton`, `wolf`, `ogre`, `troll`, etc.).

### Gap E: System Content Hydration on Ruleset Mutation
- **Location**: `src/rendering/ui/zod_form_renderer.ts` & `src/editor/workspace_file_service.ts`
- **Problem**: When a new campaign is created or `manifest.rulesetId` is switched in the Manifest form, Tier 2 `systemContent` is not automatically hydrated from `public/data/rulesets/<rulesetId>/`.
- **Impact**: The editor document's `systemContent` remains empty or stale, causing `validateCampaignRuleset()` to fail validation until a full reload occurs.

---

## 4. Cascading Effects Matrix (Rule 15)

| Proposed Change | Upstream (Callers / Emitters) | Downstream (Consumers / Validators / Renderers) | Lateral (Sibling Campaigns / Store / Tests) |
| :--- | :--- | :--- | :--- |
| **Ruleset-Aware "New Campaign" Modal in Editor** | `editor_toolbar.ts` (`#btn-editor-new`) | `createBlankSlateCampaign(rulesetId)`, `loadCampaign(templateId)` | `workspace_file_service.ts`, `editor_state.ts` |
| **Bundled Campaign Browser in Splash Screen** | `editor_workspace.ts` (Splash Screen) | `loadCampaignRegistry()`, `getAllRulesets()` | `core/campaign_store.ts`, `core/loader.ts` |
| **Dynamic ViewGroup Resolution in Sidebar & Workspace** | `editor_sidebar.ts`, `editor_workspace.ts` | `getRuleset(doc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)` | `editor_config.ts`, `editor_ui.ts` |
| **`archetypeId` Dropdown in `ui_utils.ts`** | `ui_utils.ts` (`getReferenceOptions`) | `zod_form_renderer.ts` entity editing forms | `src/editor/reference_index.ts` |
| **System Content Re-hydration on Ruleset Change** | `editor_toolbar.ts`, `zod_form_renderer.ts` | `ruleset.getSystemContentFiles()`, `ruleset.parseSystemContent()` | `src/editor/campaign_validator.ts` |
