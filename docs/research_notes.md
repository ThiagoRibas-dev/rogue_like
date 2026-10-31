# Phase 13 Research Notes: Pluggable Ruleset Cartridge Architecture & `classic` Extraction (`Milestones 82–84`)

*Compiled per `AGENTS.md` Steps 1–3 & Rule 15 (Upstream / Downstream / Lateral Cascading Effects).*

---

## 1. Rules & Architectural Constraints Reiteration (`AGENTS.md` & `ARCHITECTURE.md`)

1. **Downward Dependency Graph (`AGENTS.md` §8)**:
   - `main → core → systems → map/rendering → types/constants/utils`.
   - Static definitions (`RulesetId`, `RulesetIdSchema`, `RulesetMetadata`, `HudVitalsDTO`, `RulesetContract`) must reside in `src/types/ruleset.types.ts` so `types/`, `utils/`, `systems/`, `rendering/`, and `rulesets/` never create circular imports.
   - **No Barrel Files (`index.ts`)**: Every file under `src/rulesets/` is imported by its explicit module filename (`src/rulesets/registry.ts`, `src/rulesets/classic/classic_ruleset.ts`, `src/rulesets/dnd35e/dnd35e_ruleset.ts`).
2. **Strict TypeScript & Zero Magic Values (`AGENTS.md` §3 & §4)**:
   - `exactOptionalPropertyTypes: true`, explicit return types on all functions, `readonly` properties and `ReadonlyArray<T>`, JSDoc on all exported symbols, and zero `any`.
   - ECS components must remain plain JSON-serializable data interfaces (`ComponentType.RulesetData` uses a discriminated union keyed by `rulesetId`).
3. **DOM Security (`AGENTS.md` §7)**:
   - Construct DOM nodes exclusively with `document.createElement()` and `textContent` (no `.innerHTML` in `menus.ui.ts` or `editor_toolbar.ts`).
4. **One Concern Per File (`< 250` LOC)**:
   - Decompose `src/rulesets/classic/` into `classic_stats.ts`, `classic_combat.ts`, and `classic_ruleset.ts`.

---

## 2. Codebase Cross-Reference & Task Mapping

### Milestone 82: Domain-Driven `RulesetContract`, Component Namespacing & DI Registry
- **`src/types/ruleset.types.ts`**:
  - Defines `RulesetIdSchema = z.enum(['classic', 'dnd35e'])` and `export type RulesetId = z.infer<typeof RulesetIdSchema>;`.
  - Defines `HudStatSocketDTO` and `HudVitalsDTO` so each ruleset projects its own HUD stat pills (e.g., `ATK / DEF / SAT` in `classic` vs. `BAB / AC / SAT` in `dnd35e`).
  - Defines `RulesetMetadata` (`id`, `name`, `shortLabel`, `badgeIcon`, `description`, `features: ReadonlyArray<string>`).
  - Defines `RulesetContract` with domain ports:
    - `getEffectiveActorStats(state: GameState, entityId: EntityId): EffectiveStats`
    - `resolveMeleeAttack(state: GameState, intent: MeleeAttackIntent): { state: GameState; success: boolean }`
    - `processDamage(state: GameState): GameState`
    - `grantActorXp(state: GameState, entityId: EntityId, amount: number): GameState`
    - `projectHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null`
    - `getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup>`
    - `validateCampaignRuleset?(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError>`
- **`src/types/components.types.ts`**:
  - Adds `ComponentType.RulesetData = 'RulesetData'` and `RulesetDataComponent` (`{ readonly type: ComponentType.RulesetData; readonly rulesetId: RulesetId; readonly data: Readonly<Record<string, unknown>> }`) to `Component` union so ruleset cartridges can attach isolated serializable state without bloating `FighterComponent`.
- **`src/rulesets/registry.ts`**:
  - Registers `classicRulesetContract` and `dnd35eRulesetContract` at module initialization and exposes `getRuleset(id)`, `getAllRulesets()`, and `getActiveRuleset(state)` (resolving `state.campaign.manifest.rulesetId`).

### Milestone 83: `classic` Ruleset Cartridge Extraction (`src/rulesets/classic/`)
- **`src/rulesets/classic/classic_stats.ts`**:
  - Houses `computeClassicEffectiveStats(state, entityId)` (extracted from `src/utils/stats.ts`) and `projectClassicHudVitals(state, playerEntityId)` (extracted from `src/rendering/ui/hud.ui.ts`).
- **`src/rulesets/classic/classic_combat.ts`**:
  - Houses `resolveClassicMeleeAttack(state, intent)` (extracted from `src/systems/combat.system.ts`), `processClassicDamage(state)` (extracted from `src/systems/damage.system.ts`), and `grantClassicXp(state, entityId, amount)` (extracted from `src/systems/death.system.ts`).
- **`src/rulesets/classic/classic_ruleset.ts`**:
  - Exports `classicRulesetContract: RulesetContract`.
- **Core Delegations**:
  - `src/utils/stats.ts` (`getEffectiveStats`) $\rightarrow$ `getActiveRuleset(state).getEffectiveActorStats(state, entityId)`
  - `src/systems/combat.system.ts` (`processMeleeAttackIntent`) $\rightarrow$ `getActiveRuleset(state).resolveMeleeAttack(state, intent)`
  - `src/systems/damage.system.ts` (`processDamageSystem`) $\rightarrow$ `getActiveRuleset(state).processDamage(state)`
  - `src/systems/death.system.ts` (`grantXp`) $\rightarrow$ `getActiveRuleset(state).grantActorXp(state, entityId, amount)`
  - `src/rendering/ui/hud.ui.ts` (`renderPlayerStats`) $\rightarrow$ `getActiveRuleset(state).projectHudVitals(state, playerEntityId)`

### Milestone 84: `New Game -> Ruleset Selection -> Campaign Selection`, Editor Scoping & `dnd35e` Skeleton
- **Schema & Campaign Data Updates**:
  - `src/types/campaign/meta.ts`: Add `rulesetId: RulesetIdSchema.default('classic')` to `CampaignManifestSchema` and `CampaignRegistryEntrySchema`.
  - `public/data/campaigns.json`, `public/data/campaigns/default/manifest.json`, `public/data/campaigns/shroudgarde/manifest.json`, `public/data/campaigns/megacampaign/manifest.json`: Add `"rulesetId": "classic"`.
  - `src/editor/workspace_file_service.ts` (`createBlankSlateCampaign`), `src/core/campaign_store.ts` (`listInstalledCampaigns`), and `scripts/run-validator.ts` (`getFallbackForFile`): Include `rulesetId: 'classic'`.
- **Two-Stage Title Screen Flow (`UIMode.RulesetSelect`)**:
  - `src/types/game-state.types.ts`: Add `UIMode.RulesetSelect = 'ruleset_select'`.
  - `index.html`: Add `#ruleset-selection-overlay` modal (`Select Ruleset` with `#ruleset-list`, `#ruleset-details`, `#btn-ruleset-back`, and `#btn-ruleset-next`) and add `#campaign-ruleset-badge` in `#campaign-selection-overlay`.
  - `src/rendering/ui/menus.ui.ts`, `src/rendering/ui.ts`, `src/core/session_controller.ts`, `src/core/input_handler.ts`:
    - Clicking `#btn-new-game` opens `UIMode.RulesetSelect`.
    - Choosing a ruleset and clicking `#btn-ruleset-next` opens `UIMode.CampaignSelect` filtered to campaigns matching `selectedRulesetId`.
    - Clicking `#btn-campaign-back` returns to `UIMode.RulesetSelect`.
- **Editor Scoping & `dnd35e` Cartridge Skeleton**:
  - `src/rulesets/dnd35e/dnd35e_ruleset.ts`: Implements `dnd35eRulesetContract` stub ready for Phases 14–20.
  - `src/rendering/editor/editor_toolbar.ts`, `src/rendering/editor_ui.ts`, and `src/editor/campaign_validator.ts`: Display active ruleset badge in the editor toolbar, resolve view groups via `getRuleset(doc.manifest.rulesetId).getEditorViewGroups(VIEW_GROUPS)`, and invoke ruleset validation hook in `validateCampaign()`.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Campaign JSONs / Scripts / Tests) |
| :--- | :--- | :--- | :--- |
| **`CampaignManifestSchema` & `CampaignRegistryEntrySchema` (`rulesetId`)** | `loadCampaign()`, `loadCampaignRegistry()`, `listInstalledCampaigns()`, `createBlankSlateCampaign()` | `getActiveRuleset(state)`, `populateCampaignList()`, `validateCampaign()` | `public/data/campaigns.json`, `default/manifest.json`, `shroudgarde/manifest.json`, `megacampaign/manifest.json`, `scripts/run-validator.ts` |
| **`RulesetContract` Delegation (`stats`, `combat`, `damage`, `death`, `hud`)** | `game-loop.ts`, `movement.system.ts`, `action.registry.ts`, `state_stabilizer.ts`, `quest.system.ts`, `status-effect.system.ts`, `effects.system.ts` | `hud.ui.ts`, `hud_alerts.ui.ts`, `tooltips.ui.ts`, `viewport_snapshot.ts`, `tactical_snapshot.ts` | `ai_arena.ts`, `narrative_fuzzer.ts`, `tests/*.test.ts` |
| **`UIMode.RulesetSelect` (`New Game -> Ruleset -> Campaign`)** | `#btn-new-game` (`session_controller.ts`), `#btn-campaign-back` | `renderMenus()` (`menus.ui.ts`), `handleKeyDown()` (`input_handler.ts`), focus trap (`session_controller.ts`), `markDirtyFromStateDiff()` | `index.html` (`#ruleset-selection-overlay`) |
| **`ComponentType.RulesetData`** | Ruleset actor hydration (`classic` / `dnd35e`) | `ecs.ts`, `save.ts` (JSON serialization) | `components.types.ts` (`Component` union) |
