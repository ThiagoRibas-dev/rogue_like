# Compliance Audit — Phase 10 & Phase 11 Sections of `docs/MILESTONES.md`

**Audit date:** October 30, 2026
**Auditor:** AI coding agent (per user directive: "Let's do an audit of Phase 10 and 11. Write a compliance document please.")
**Target under audit:** `docs/MILESTONES.md` — Phase 10 (Milestones 69–71, lines 775–799) and Phase 11 (Milestones 72–76, lines 801–836)
**Overall verdict:** **SUBSTANTIALLY COMPLIANT** — all 31 checklist items are materially implemented and verified in code, with 2 moderate and 2 minor documentation findings requiring correction (see [§7](#7-findings-register)).

---

## 1. Scope & Method

### 1.1 What was audited

The two phase sections of the milestone document were audited for **accuracy, completeness, and process compliance** against:

| Axis | Governing rule | What was checked |
|---|---|---|
| Accuracy | AGENTS.md §10 (reference docs), Golden Rule 3 | Every checklist item's file names, symbols, LOC figures, and behaviors verified against the actual source tree |
| Completeness | AGENTS.md workflow map | Milestone set completeness (M69–M71 for Phase 10, M72–M76 for Phase 11), heading/status conventions, checklist completion states |
| Process compliance | Workflow Phase 3, steps 8–11 | Cascading-effects re-verification (step 8), architecture audit records (step 9), manual play-test scenarios (step 10), documentation updates incl. `ARCHITECTURE.md`/`DECISIONS.md`/`MILESTONES.md` (step 11) |
| Historical truth | `git` history (read-only) | Five M69 claims diff-verified against the pre-Phase-10 commit (`09f0c7be7^`) and the Phase 10/11 commit (`09f0c7be7`) |

### 1.2 Evidence sources

- `docs/scratchpad.md` — execution records (§4 M72, §5 M73, §6 M71/M74, §7 M75, §7.6 M76)
- `docs/implementation_plan.md` — current M76 plan (§2 Cascading Effects Matrix, §5 budget, §6 test scenarios, §7 post-implementation checklist)
- `docs/plans/implementation_plan_m74.md`, `docs/plans/implementation_plan_m75.md` — archived plans
- `docs/research_notes.md` §9–§10, `docs/DECISIONS.md` (lines 125–132), `docs/ARCHITECTURE.md`, `docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md`
- Source tree: file existence, LOC counts, grep audits (`.innerHTML`, `Math.random`, `Date.now`, imports, symbols)
- Git history: commit `09f0c7be7` ("feat: Phase 10 & Phase 11 (Milestones 69-72)") and its parent

### 1.3 Verification re-executed during this audit

| Check | Documented claim | Re-executed result |
|---|---|---|
| `bun x tsc --noEmit` | 0 errors | ✅ **0 errors** (re-run Oct 30) |
| `bun run validate:campaigns` | 3/3 campaigns, 0 errors/warnings | ✅ **3/3 PASS** (`default`, `megacampaign`, `shroudgarde`) |
| `bun run lint` | 0 errors, 69 warnings | Recorded in scratchpad §7.6; not re-executed in this audit |
| `bun x vite build` | clean (14.24s) | Recorded in scratchpad §7.6; not re-executed in this audit |

---

## 2. Executive Summary

| Milestone | Section | Items | Implementation verified | Doc accuracy | Status heading |
|---|---|---|---|---|---|
| 69 | Phase 10 | 5 | ✅ all 5 (git-verified) | ⚠️ 2 findings (F-1, F-2) | 🟢 Completed |
| 70 | Phase 10 | 4 | ✅ all 4 | ✅ (path precision note F-7) | 🟢 Completed |
| 71 | Phase 10 | 3 | ✅ all 3 | ✅ | 🟢 Completed |
| 72 | Phase 11 | 4 | ✅ all 4 | ✅ | 🟢 Completed |
| 73 | Phase 11 | 3 | ✅ all 3 | ✅ | 🟢 Completed |
| 74 | Phase 11 | 4 | ✅ all 4 | ✅ (path precision note F-7) | 🟢 Completed |
| 75 | Phase 11 | 4 | ✅ all 4 | ✅ | 🟢 Completed |
| 76 | Phase 11 | 4 | ✅ all 4 | ⚠️ heading not marked completed (F-3); ARCHITECTURE.md gap (F-4) | ⚪ **stale** |

**Totals:** 31 checklist items — **all 31 materially implemented**; 4 corrective findings (2 moderate, 2 minor); 6 informational observations.

---

## 3. Phase 10 — Item-by-Item Audit (M69–M71)

### 3.1 Milestone 69: Rule Compliance & Determinism Hardening

| # | Claim in MILESTONES.md | Evidence | Verdict |
|---|---|---|---|
| 1 | Eliminate `any` casts in `ui_utils.ts` via generic `<T extends HTMLElement>` | Parent commit had 2 `any` casts; today `grep ": any\|as any" src/rendering/ui/ui_utils.ts` → **zero**. Generics present. | ✅ |
| 2 | Replace `Math.random()` with `rng` in `narrative_fuzzer.ts`, `director_sandbox.ui.ts`, `knowledge_simulator.ui.ts`, `world_graph.ts` | Parent commit: 5 `Math.random()` hits across those files. Today: **zero `Math.random()` anywhere in `src/`**. | ✅ |
| 3 | "Migrate 100+ DOM clearing operations from `innerHTML = ''` to `replaceChildren()`" | Parent commit had **35** `innerHTML = ''` sites (109 total `.innerHTML` uses). Today: **0** remaining `innerHTML = ''`; **41** `replaceChildren()` call sites. Migration is complete and correct; the **"100+" figure is not supported** — see F-2. | ⚠️ F-2 |
| 4 | "Extract `EncounterRole` from `encounter_director.ts` to `src/types/encounter.types.ts`" | `EncounterRole` **does not exist in any commit or in the current tree** (git grep confirms). The actual extracted type was **`RoomBounds`**: the parent commit's `game-state.types.ts:9` imported `RoomBounds` from `../map/encounter_director.ts` (an inverted import); today `RoomBounds` lives in `src/types/encounter.types.ts` (line 63) and `game-state.types.ts:9` imports it from `./encounter.types.ts`. The **effect is achieved, the symbol name is wrong** — see F-1. | ⚠️ F-1 |
| 5 | Remove upward action imports in `ai.system.ts` and `trigger/social.ts` | Parent commit: `ai.system.ts` imported `dispatchAction` from `../actions/action.registry.ts`; `social.ts` imported `processSayIntent`, `transferKnowledge` from `../../actions/…`. Today: **zero action imports** in either file. | ✅ |

### 3.2 Milestone 70: Architectural Monolith Decomposition

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | `main.ts` 745→98 LOC; `session_controller.ts` (630); fog helpers in `display.ts` | `main.ts` = **98 LOC** ✓; `session_controller.ts` exists (592 LOC today — grew with M72–M76 work, point-in-time figure was accurate); `rendering/display.ts` = 331 LOC ✓ | ✅ |
| 2 | `nemesis.system.ts` 833→11 LOC facade; 4 split modules | `nemesis.system.ts` = **11 LOC** ✓; `nemesis_tracker.ts`, `nemesis_hierarchy.ts`, `nemesis_adaptation.ts`, `nemesis_presentation.ts` all exist under `src/systems/nemesis/` (subfolder omitted in doc — F-7) | ✅ |
| 3 | `director_sandbox.ui.ts` 828→214 facade; `director_telemetry_view.ts` (347), `director_controls.ts` (279) | Facade = **209 LOC** ✓ (shrunk further since); both split modules exist under `src/rendering/ui/director/` (subfolder omitted — F-7) | ✅ |
| 4 | `narrative_fuzzer.ts` 664→215; `fuzzer_invariants.ts` (166), `fuzzer_mock_state.ts` (284), `fuzzer_telemetry.ts` (112) | Runner = **203 LOC** ✓; all three split modules exist with matching LOC | ✅ |

### 3.3 Milestone 71: Core Engine, Turn Loop & Persistence Stabilization

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | Bounded `resolveStateStabilization` with `MAX_STABILIZATION_ITERATIONS = 16` | `src/core/state_stabilizer.ts` (38 LOC) exports `resolveStateStabilization(state: GameState): GameState`; constant imported from `src/constants/pacing.constants.ts` ✓ | ✅ |
| 2 | `collectOwnedEntityIds` + `pruneOrphanEntities` for sleep/wake packaging | `collectOwnedEntityIds` at `ecs.ts:566` (used in `moveToLimbo` at 611); `pruneOrphanEntities` at `save.ts:67` (called in save path at 109) ✓ | ✅ |
| 3 | Sandbox/demo isolation: `bootstrap_sandbox.ts`, `initializeCampaignWorldEntities` | `bootstrap_sandbox.ts` = 156 LOC ✓; `initializeCampaignWorldEntities` at `bootstrap.ts:80`, called at 230 ✓ | ✅ |

---

## 4. Phase 11 — Item-by-Item Audit (M72–M76)

### 4.1 Milestone 72: Decoupled Frame Loop, Message-Queue Glue & Debounced Persistence

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | `InputCommandQueue` + `PresentationEventQueue`/dirty flags in `session_controller.ts`, `game-loop.ts` | `input_queue.ts` (124 LOC), `presentation_queue.ts` (215 LOC, `markDirtyFromStateDiff` at 197) ✓ | ✅ |
| 2 | 60Hz frame-synced presenter pass | `rendering/presenter.ts` (131 LOC), presenter loop in `session_controller.ts` ✓ | ✅ |
| 3 | Debounced/checkpointed persistence | `persistence_service.ts` (145 LOC) ✓ | ✅ |
| 4 | Selective UI dirty-domain tracking | `PresentationDomain` domains incl. `hud`, `log`, `inventory`, `modal`, `camera` in `presentation_queue.ts` ✓ | ✅ |

### 4.2 Milestone 73: Pure Dumb Canvas Renderer & `ViewportSnapshot`

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | `buildViewportSnapshot(state, w, h)` projector | `viewport_snapshot.ts:37` exports the exact signature ✓ | ✅ |
| 2 | `renderer.ts` zero imports from `ecs.ts`/`ComponentType`/`GameState` | Grep: **zero ECS/GameState/ComponentType references** in `renderer.ts` ✓ | ✅ |
| 3 | Dirty-cell canvas diffing vs previous snapshot | `prevSnapshot` diffing implemented in `renderer.ts` (verified in scratchpad §5 and code) ✓ | ✅ |

### 4.3 Milestone 74: Frame-Budgeted Scheduler, Tiered Simulation & Worker Offload

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | `FRAME_BUDGET_MS = 4` cooperative scheduler | `scheduler.constants.ts:6` defines the constant; `scheduler.ts:137/192` enforce it with `performance.now()` ✓ | ✅ |
| 2 | Tiered cadence + delta catch-up (`simulation_cadence.ts`, `map.system.ts`) | `simulation_cadence.ts` (99 LOC) exists; wake catch-up verified per scratchpad §6.1 ✓ | ✅ |
| 3 | Stage-sliced generators with `ROT.RNG.getState()`/`setState()` snapshotting | `generator_stages.ts`, `generator_async.ts` (166), `narrative_fuzzer_async.ts` (163) all exist ✓ | ✅ |
| 4 | Loading overlay + worker bridge (`worker_bridge.ts`, `fuzzer.worker.ts`, `map.worker.ts`, `worker.types.ts`) | All four worker files exist (217/49/57/78 LOC); `loading_overlay.ui.ts` (87) ✓ | ✅ |

### 4.4 Milestone 75: Gameplay HUD & RTwP Controls Refinements

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | Auto-pause triggers + `EntitySpotted` + `getVisibleHostileEntityIds()` | `auto_pause.ts` (49), `auto_pause_signals.ts` (247), `GameEventType.EntitySpotted` in `events.types.ts:19/149`, `getVisibleHostileEntityIds` in `map.system.ts:80` ✓ | ✅ |
| 2 | Centralized LIFO modal stack (`modal_manager.ts`) | `modal_manager.ts` (125 LOC) ✓ | ✅ |
| 3 | Contextual verb illumination (`getVerbOptionsForTarget`) | `apply.system.ts:124` exports it; wired per `DECISIONS.md` lines 123 ✓ | ✅ |
| 4 | Investigation filter chips (`investigation_filter.constants.ts`) | `investigation_filter.constants.ts` (104 LOC) ✓ | ✅ |

### 4.5 Milestone 76: Campaign Creator & Developer Tooling UX

| # | Claim | Evidence | Verdict |
|---|---|---|---|
| 1 | Validation diagnostics: `validation_path.ts`, `validation_navigator.ts`, `validation_panel.ui.ts`, toolbar cleanup | All exist (96/90/92 LOC); `editor_toolbar.ts` has **zero `.innerHTML`**; `toFormPath`/`expandedPaths`/`revealField` verified in code ✓ | ✅ |
| 2 | `<details>/<summary>` accordions, `expandedPaths`, `data-field-path`, descendant badges | `zod_form_renderer.ts` — `dataset.fieldPath` at 103/328/431/464; module-level `expandedPaths: Set<string>` in `validation_navigator.ts:14`; **zero `.innerHTML`** ✓ | ✅ |
| 3 | Where-Used inspector: `reference_index.ts` WeakMap cache, `where_used.ui.ts` drawer, dialogue node references | `reference_index.ts` (156 LOC, `WeakMap` cache at 28); `where_used.ui.ts` (99 LOC, zero `.innerHTML`); `dialogue_editor.ts` tags `nodeEl.dataset.fieldPath` at 48 ✓ | ✅ |
| 4 | Playtest-from-Here static spawn: `area_playtest_menu.ui.ts`, `contextmenu`, `spawnOverride` | `area_playtest_menu.ui.ts` (79 LOC); `area_editor.ts:486` writes `editor_playtest_spawn`; `bootstrap.ts` exports `SpawnOverride` (187) and applies it at 232/295–296; `session_controller.ts:306/317` reads + clears the key ✓ | ✅ |

**M76 heading:** the section heading at `MILESTONES.md:831` still reads `## ⚪ Milestone 76: …` with no `(Completed)` suffix, unlike every other completed milestone in the document — **F-3**.

---

## 5. Cross-Cutting Compliance Assessment

### 5.1 Golden Rule 15 — Cascading Effects Matrix

| Milestone | Matrix evidence | Verdict |
|---|---|---|
| M76 | `implementation_plan.md` §2 — 6-row `Change | Upstream | Downstream | Lateral` matrix covering all four checklist items | ✅ |
| M75, M74 | Matrices in archived plans (`docs/plans/implementation_plan_m75.md`, `implementation_plan_m74.md`) | ✅ |
| M69–M71 | Phase 10 predates Rule 15's introduction (added during M75); no matrix requirement applies retroactively | N/A |

### 5.2 Workflow step 10 — Manual play-test scenarios

| Milestone | Evidence | Verdict |
|---|---|---|
| M76 | `implementation_plan.md` §6 — 7 scenarios (path normalization, accordion persistence, reverse reference, dock jump-to-error, spawn walkable/blocked, `.innerHTML` grep) | ✅ |
| M75 | `implementation_plan_m75.md` "Manual play-test scenarios" (8 scenarios, referenced from scratchpad §7.5) | ✅ |
| M74 | `implementation_plan_m74.md` §5 "Manual Play-Test Scenarios" | ✅ |
| M69–M73 | No archived plan artifacts in `docs/plans/`; not verifiable from the surviving doc tree (informational) | ℹ️ |

### 5.3 Workflow step 11 — Documentation updates

| Artifact | Required? | State | Verdict |
|---|---|---|---|
| `docs/MILESTONES.md` | Yes (summarize completed milestone) | All 8 milestones present with checklists; M76 heading stale (F-3) | ⚠️ |
| `docs/DECISIONS.md` | Yes (architectural rationale) | M76 rationale at lines 125–132; M72–M75 ADRs present | ✅ |
| `docs/ARCHITECTURE.md` | **Yes** (systems added/modified) | **M72–M75 subsystems documented** (scheduler §4.x, presenter/renderer, §8.1 auto-pause, §8.2 modal stack, §8.4 investigation); **M76 subsystems entirely absent** — no `reference_index`, validation dock, `expandedPaths`, `spawnOverride`, or `toFormPath` content. The doc ends at M75 (§8.4). Scratchpad §7.6's justification ("M76 design notes already present (§10.8 of research notes)") conflates `research_notes.md` with `ARCHITECTURE.md` and does not satisfy the step-11 requirement. | ❌ **F-4** |
| `docs/scratchpad.md` | Supporting record | §7.6 delivery record present; hygiene issues (F-6) | ⚠️ |
| `docs/research_notes.md` | Research artifact | §10.8 locked decisions D1–D6 present and consistent with implementation | ✅ |

### 5.4 Decision D6 — strict `.innerHTML` touch scope (audited at code level)

| File | Status | Verdict |
|---|---|---|
| `validation_panel.ui.ts`, `where_used.ui.ts`, `area_playtest_menu.ui.ts` | Zero `.innerHTML` (only JSDoc mentions) | ✅ |
| `zod_form_renderer.ts`, `editor_toolbar.ts` | Zero `.innerHTML` (toolbar fully converted) | ✅ |
| `editor_workspace.ts` (modified in M76) | 8 **pre-existing** `.innerHTML` uses retained | ✅ consistent — `DECISIONS.md:132` enumerates the converted components (dock, accordion headers, drawer, tile context menu) and `editor_workspace.ts` is not among them; plan Task 13's audit list likewise excludes it |
| `dialogue_editor.ts`, `area_editor.ts` | 4 pre-existing uses each, untouched blocks left intact | ✅ per D6 |

### 5.5 Determinism scope (M69-adjacent observation)

Zero `Math.random()` anywhere in `src/` today. `Date.now()` remains only in non-simulation contexts: download filenames (`session_controller.ts:159/430`, `main.ts:68`), undo-coalescing timestamps (`campaign_editor.ts:228`), bake-ID suffixes (`trigger_composer.ui.ts:71/298`), and the `initRNG` fallback seed (`rng.ts:18`, used only when called without a seed). M69's scoped claims are accurate; scratchpad §4's blanket "zero `Date.now()`" is aspirational and not literally met — informational.

### 5.6 Module-size guideline (~250 LOC, AGENTS.md §8)

New M76 modules are all ≤ 156 LOC ✅. Existing Phase 11 modules exceed the guideline without the docs misstating anything: `generator_stages.ts` (402), `viewport_snapshot.ts` (425), `session_controller.ts` (592). Recommend queuing for a future decomposition milestone — informational.

---

## 6. Findings Register

| ID | Severity | Location | Finding | Remediation |
|---|---|---|---|---|
| **F-1** | **Moderate** | `MILESTONES.md:783`; mirrored in `HANDOFF_SOCIAL_AND_V2_ENGINE.md:55` | M69 item 4 names `EncounterRole`, a symbol that has never existed in any commit. The actual extracted type was `RoomBounds` (git-verified: parent commit's inverted import `game-state.types.ts → ../map/encounter_director.ts` for `RoomBounds`; today lives in `types/encounter.types.ts`). The claimed effect (inverted import eliminated) is real; the artifact description is factually wrong. | R1 |
| **F-2** | Minor | `MILESTONES.md:782` | M69 item 3 claims "100+ DOM clearing operations" migrated. Pre-Phase-10 tree contained 35 `innerHTML = ''` sites (109 total `.innerHTML` uses). Migration is complete (0 clears remain, 41 `replaceChildren()` sites), but the figure is unsupported and likely conflates total `.innerHTML` uses with clearing operations. | R2 |
| **F-3** | Minor | `MILESTONES.md:831` | M76 heading uses `⚪` and lacks the `(Completed)` suffix while all 4 checklist items are checked and the verification suite is clean. Inconsistent with the document's own convention (all other completed milestones use `🟢 … (Completed)`). | R3 |
| **F-4** | **Moderate** | `docs/ARCHITECTURE.md` (ends at §8.4, M75) | Workflow step 11 non-compliance: M76 added five new subsystems (path normalizer, validation navigator/`expandedPaths`, reverse-reference index, validation dock, static spawn override) but `ARCHITECTURE.md` contains no M76 content. Scratchpad §7.6's justification cites `research_notes.md` §10.8, which is not the architecture document. | R4 |
| **F-5** | Minor | `implementation_plan.md:8`, §7 | Plan header still says "Gate 2 (Plan) PENDING user approval" and the §7 post-implementation checklist boxes are all unchecked, although the milestone shipped and verified. (Keeping the plan un-archived matches the M74/M75 convention; the stale status text does not.) | R5 |
| **F-6** | Minor | `scratchpad.md:3`, `:27`, `:535/558` | Hygiene: header still lists "Milestone 76 … (NEXT)" although §7.6 records it IMPLEMENTED & VERIFIED; the section `### 7.6` heading is duplicated (kickoff + implementation record); section numbers §4/§5/§6/§7 each appear twice; the verification-suite description names campaigns `scifi`/`postapoc` instead of the actual `megacampaign`/`shroudgarde`. | R5 |
| **F-7** | Info | `MILESTONES.md:790–791, 820–822` | M70/M74 checklist items cite module paths without their subfolders (`src/systems/nemesis/…`, `src/rendering/ui/director/…`). Files exist; paths are imprecise. | R5 (optional) |
| **F-8** | Info | Phase 11 deliverables | `generator_stages.ts` (402 LOC), `viewport_snapshot.ts` (425 LOC), `session_controller.ts` (592 LOC) exceed the ~250 LOC guideline. Not misstated in the milestone doc; relevant to future decomposition work. | Future milestone |
| **F-9** | Info | M76 touched files | `editor_workspace.ts` retains 8 pre-existing `.innerHTML` uses. Verified consistent with D6 as recorded in `DECISIONS.md:132` (which enumerates the converted components) and plan Task 13. | None (documented) |
| **F-10** | Info | `rng.ts:18` | `initRNG(seed?)` falls back to `Date.now()` when called without a seed — the only remaining unseeded-RNG pathway in `src/`. M69's scoped claims remain accurate; flagged for awareness. | Optional review |

---

## 7. Remediation Plan (pending user authorization per Golden Rule 5)

| # | Action | Files touched |
|---|---|---|
| **R1** | Rewrite M69 item 4 to name the actual extracted type `RoomBounds` (and note the inverted import it eliminated) | `docs/MILESTONES.md`, `docs/HANDOFF_SOCIAL_AND_V2_ENGINE.md` |
| **R2** | Correct M69 item 3's figure: 35 `innerHTML = ''` clearing sites migrated (of 109 total `.innerHTML` uses); 0 remain today | `docs/MILESTONES.md` |
| **R3** | Mark M76 heading `🟢 … (Completed)`; refresh scratchpad header status line | `docs/MILESTONES.md`, `docs/scratchpad.md` |
| **R4** | Add an ARCHITECTURE.md section (e.g. §8.5 Campaign Editor Developer Tooling) covering `toFormPath()` normalization, `validation_navigator.ts`/`expandedPaths` accordion persistence, `reference_index.ts` `WeakMap` index + `where_used.ui.ts`, `validation_panel.ui.ts` bottom dock, and the `editor_playtest_spawn` → `SpawnOverride` static spawn pipeline | `docs/ARCHITECTURE.md` |
| **R5** | Refresh stale status text and dedupe headings: `implementation_plan.md` header + §7 checkboxes; scratchpad duplicate `### 7.6` headings, duplicate §4–§7 numbering, campaign names | `docs/implementation_plan.md`, `docs/scratchpad.md` |
| **R6** | (Optional) Archive the M76 plan to `docs/plans/implementation_plan_m76.md` per its own §7 last item | `docs/plans/` |

---

## 8. Sign-off Status

- **Phase 10 (M69–M71):** Compliant in substance; 2 doc-accuracy corrections outstanding (F-1, F-2).
- **Phase 11 (M72–M76):** Compliant in substance; M76 heading status (F-3) and `ARCHITECTURE.md` step-11 gap (F-4) outstanding.
- **Audit re-verification:** `tsc` 0 errors, `validate:campaigns` 3/3 PASS — documented results reproduce.

*This document is an audit record only. No source or documentation files were modified during the audit; remediation items R1–R6 await user authorization.*
