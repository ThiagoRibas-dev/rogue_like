# Campaign Creator Guide & Checklist

This guide provides a step-by-step checklist for building, testing, validating, and sharing custom campaigns for the Roguelike Engine.

---

## 1. Authoring Checklist

Follow this workflow in order to prevent validation errors:

- [ ] **Step 1: Manifest & Configuration**
  - Create the folder structure under `public/data/campaigns/<campaign_id>/`.
  - Author `manifest.json` with the campaign ID, name, version, and tags.
  - Set up starting rules (`rules.json`), color theme (`theme.json`), and XP progression (`advancement.json`).

- [ ] **Step 2: Base System Definitions**
  - Set up tag classifications in `tag_registry.json`. Any tag used in other files must be registered here.
  - Define custom traits in `trait_registry.json` and status effects in `status.json`.
  - Fill out the faction matrix in `factions.json`. Remember: it must be a complete 2D matrix (all keys must appear as row and column).

- [ ] **Step 3: Component Blueprints**
  - Create item effects in `effects.json`.
  - Define equippable items, weapons, and tools in `items.json`.
  - Establish creature profiles and stats in `entities.json`.
  - Set up monster behaviors and AI rules in `ai.json`.

- [ ] **Step 4: Map & Encounter Setup**
  - Define visual terrain types in `tiles.json`.
  - Create environmental fields (like fire, water, or smoke) in `fields.json`.
  - Configure procedural room allocation ratios in `encounter_profiles.json`.
  - Fill candidate criteria in `spawn_pools.json`.
  - Outline layout generators and stair connections in `areas.json`.

- [ ] **Step 5: Interaction & Scripting**
  - Author verb interactions in `reactions.json`.
  - Set up dialogue trees in `dialogues.json`.
  - Write quest branches, goals, and stages in `quests.json`.
  - Set up event triggers in `triggers.json` (and templates in `trigger_templates.json`).

---

## 2. In-Editor Validation & Help

The Campaign Editor is equipped with real-time Zod schema and cross-reference validation.

*   **Validation Status Bar**: Located in the top right of the toolbar (`editor_toolbar.ts`).
    *   **Green (✅ OK)**: The campaign is valid and ready to play or export.
    *   **Red (❌ X Err, Y Warn)**: Hover over the status text to view a popup list of errors.
*   **Fix-It Suggestions**: Many common errors include a green `💡 Fix:` line explaining how to resolve them (e.g. adding a missing key in a registry file or correcting a weight sum).
*   **Field Tooltips**: Form inputs derived from Zod schemas feature field descriptions. Hover over input fields to see what the parameters do.

---

## 3. Playtesting & CLI Validation

### Real-Time Playtesting
1. In the editor, click the **▶️ Play Test** button in the toolbar.
2. The editor will validate the campaign. If clean, it saves the state to `sessionStorage` and immediately reloads the game using your custom campaign.
3. Upon dying or exiting the playtest, you are returned to the editor workspace.

### Running CLI Validation
Before distributing, you can run the headless validator runner using Bun:
```bash
# Validate all campaigns under public/data/campaigns
bun scripts/run-validator.ts

# Validate only your specific campaign folder
bun scripts/run-validator.ts --campaign-dir ./public/data/campaigns/my-campaign
```
Ensure that the console reports **✅ PASS** before packaging.

---

## 4. AI-Assisted Campaign Authoring

If you are using LLMs to help co-author campaign content, you can leverage the AI Prompt Kit:

1. **Generate the Kit**: Run `bun scripts/generate-ai-prompt-kit.ts`. This compiles schemas, constants, and the default campaign into the `ai-prompt-kit/` directory.
2. **Context Injection**: Feed the generated markdown files (`schema-contract.md`, `cross-reference-map.md`, `generation-rules.md`) to your LLM.
3. **Prompting**: Ask the LLM to generate the JSON files matching your campaign concept. Explain that it must follow the dependency order in `generation-rules.md`.
4. **Validation Loop**: Paste the AI-generated JSONs into your campaign folder, run `bun scripts/run-validator.ts`, and feed any validator errors back to the LLM to fix.

---

## 5. Packaging & Sharing

1. **Export**: In the Campaign Editor toolbar, click **📦 Export ZIP**. This will run deep validation. If successful, it downloads a packaged `<campaign_id>.zip` archive.
2. **Installation**: To install and play, drag-and-drop the ZIP file directly onto the Main Menu screen of the game. The engine extracts the ZIP and stores it in IndexedDB.
3. **Sharing**: Share your campaign ZIP on itch.io or upload the source files to a GitHub repository.
