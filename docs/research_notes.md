# Research Notes — End-to-End D&D 3.5e Spell Casting UI, NWN2-Style Quickcast Menu, Targeting & Execution Pipeline (+ Modularity Cleanup)

## 1. Core Architectural Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16)**:
   - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`, `src/actions/`)**: Generic spatial targeting state (`GameState['targetingMode']`), intent routing (`ToggleTargetingIntent`, `FireAimedIntent`), AoE preview tile highlighting (`viewport_snapshot.ts` / `tactical_snapshot.ts`), and the generic `RulesetContract.resolveAimedAction` hook.
   - **Tier 2 — D&D 3.5e Ruleset Cartridge (`src/rulesets/dnd35e/`)**: Pure mathematical and gameplay resolution of D&D 3.5e spells (`resolveCastPipeline`, `evaluateSpellEffectUnitsForTarget`, `evaluateMetamagicDamage`, `getSpontaneousMetamagicActionType`, `computeAoEAffectedSquares`, saving throws, Spell Resistance, Arcane Spell Failure, `DnD35ActionBudget` consumption, slot expenditure, and effect application), plus the pure Quickcast View-Model builder (`src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts`).
   - **Tier 3 — System Content (`public/data/rulesets/dnd35e/spells/*.json`, `feats/*.json`)**: Declarative spell definitions (`DnD35SpellDefinition`) and metamagic feat descriptors (`metamagicDescriptor`: `slotLevelAdjustment`, `empowerDamageMultiplier`, `maximizeDamage`, `extendDurationMultiplier`, `widenAreaMultiplier`, `removeVerbalComponent`, `removeSomaticComponent`, `quickenCast`).
2. **4-Layer Decision Matrix & Hierarchical Provenance (`AGENTS.md` Rule 19)**:
   - Every spell buff/debuff (`stat_bundle` or top-level `spell.effectBundle`) must emit `StatModifier`s and `RuleOverride`s stamped with a slash-delimited `sourcePath` (`"spell:<spellId>:<castInstance>/..."`) so `revokeModifiersByPathPrefix` and `resolveDispelCheck` can cleanly inspect or dispel active spells and prevent same-spell self-stacking.
3. **ECS Purity & Determinism (`AGENTS.md` §4 & §6)**:
   - Pure plain-object components (`Record<string, T>` and `ReadonlyArray<T>`, zero `Map`/`Set` in `GameState`).
   - All random rolls (damage dice, healing dice, d20 saving throws, caster level checks, SR checks, ASF checks) must use the shared deterministic `rng` (`rollD20` / `rng.getUniformInt`).
4. **Strict TypeScript (`AGENTS.md` §3)**:
   - Zero `any`, zero magic numbers, `exactOptionalPropertyTypes: true`, explicit return types on all functions, and exhaustive `switch` statements (`assertNever`).

---

## 2. Current Codebase Diagnosis: Why Spells Cannot Be Cast in Gameplay

### 2.1. Bottom Hotbar Bug (`src/rendering/ui/dnd35e_ui_registration.ts` & `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`)
- In `src/rendering/ui/dnd35e_ui_registration.ts` (lines 245–247), clicking a spell slot on the bottom hotbar executes:
  ```ts
  } else if (payload.kind === 'spell' && payload.classId && payload.slotIdx !== undefined) {
    setGameState(unprepareSpellSlot(state, playerId, payload.classId, payload.slotIdx));
  }
  ```
  Instead of casting the spell, clicking a hotbar spell **unprepares** it from the player's spellbook!
- Furthermore, `buildDnD35eHotbarSlots` in `src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts` only iterates over `book.preparedSpellIds` (ignoring `book.preparedSlots` expenditure state and spontaneous casters' `book.knownSpellIds` + `book.spontaneousSlotsUsedByLevel`).

### 2.2. Spellbook Modal `[Cast]` / `[Conv → ...]` Stub (`src/rendering/ui/dnd35e_spellbook_actions.ts`)
- In `src/rendering/ui/dnd35e_spellbook_actions.ts` (lines 152–217):
  - `castPreparedSlot(state, entityId, classId, slotId, convertedSpellId?)` marks `slot.expended = true` in `spellbooksByClass` and logs `"Cast spell: <SpellName>"` via `addMessage`.
  - `castSpontaneousSpell(state, entityId, classId, spellId, spellLevel)` increments `book.spontaneousSlotsUsedByLevel[levelKey]` and logs `"Spontaneously cast: <SpellName>"`.
  - **Missing**: Neither function closes the modal, checks or consumes `DnD35ActionBudget` (`standard` / `swift` / `full_round`), enters map targeting mode for aimed/area spells, or executes any mechanical spell effects!

### 2.3. Missing NWN2-Style Quickcast HUD Overlay
- Currently, the only spell UI is the full-screen Vancian Spellbook modal (`#dnd35e-spellbook-overlay`), which is designed for resting and memorizing slots rather than fast tactical combat casting.
- There is no floating **Quickcast** overlay (`[Q]` / HUD Dock button) where players can:
  - Toggle **on-the-fly Metamagic feats** (*Empower Spell* `+2`, *Maximize Spell* `+3`, *Extend Spell* `+1`, *Still Spell* `+1`, *Silent Spell* `+1`, *Widen Spell* `+3`, *Enlarge Spell* `+1`, *Quicken Spell* `+4`) or **Metamagic Rods** in inventory, dynamically shifting known/prepared spells into their adjusted slot level rows (`0–9`).
  - Toggle **Spontaneous Conversion mode** for Clerics (*Cure / Inflict Wounds*) and Druids (*Summon Nature's Ally I–IX*) so every row `1–9` converts unexpended prepared slots of that level on a single click.
  - Toggle **Eldritch Essences / Blast Shapes** for Warlock / Invocation casters on the fly while displaying at-will (`∞` / `-1`) invocations.
  - View collapsible class headers (`- WIZARD`, `- CLERIC`, `- SORCERER`) with a compact `0–9` level spine where identical prepared spells are stacked with a bottom-right remaining count badge (`×3`), and spontaneous spells show the shared remaining daily casts for that level (`11`, `12`, `-1` for at-will).

### 2.4. Targeting System Stub (`src/systems/targeting.system.ts`)
- `processFireAimedIntent` (lines 84–129) only handles `context?.verb === 'order_target'`. For all other verbs, it falls through to a Milestone 3 stub (`addMessage(state, 'You target the tile at X, Y.', 'normal')`) and never delegates to `state.activeRuleset`.
- `viewport_snapshot.ts` and `tactical_snapshot.ts` only highlight the single cursor tile and Bresenham line rather than projecting AoE blast footprints (`targetingMode.radius`).

---

## 3. Proposed Architecture & Task Mapping

### Task 1: Tier 1 Console Targeting Hook & AoE Preview Projection
- **`src/types/game-state.types.ts` & `src/types/intents/combat.intents.ts`**:
  - Extend `TargetingContext` with optional generic ruleset targeting payload fields:
    - `spellId?: string`
    - `classId?: string`
    - `slotId?: string`
    - `spellLevel?: number`
    - `convertedSpellId?: string`
    - `metamagicFeatIds?: ReadonlyArray<string>`
    - `aoeShape?: 'burst' | 'emanation' | 'spread' | 'cone' | 'line'`
- **`src/types/ruleset.types.ts` & `src/systems/targeting.system.ts`**:
  - Add optional `resolveAimedAction` hook to `RulesetContract` and invoke it from `processFireAimedIntent` when `state.activeRuleset?.resolveAimedAction` and `state.targetingMode.context` are present.
- **`src/rendering/viewport_snapshot.ts` & `src/rendering/tactical_snapshot.ts`**:
  - When `state.targetingMode?.active` has `radius > 0`, mark all tiles within `dx * dx + dy * dy <= radius * radius` around `targetingMode.cursor` as `isTargeted = true` so the AoE blast footprint is visible on the map.

### Task 2: Tier 2 D&D 3.5e Spell Cast Execution Resolver (`src/rulesets/dnd35e/magic/spell_cast_resolver.ts` & `spell_cast_effects.ts`)
- Create `src/rulesets/dnd35e/magic/spell_cast_resolver.ts` and `src/rulesets/dnd35e/magic/spell_cast_effects.ts`:
  1. **Range, Metamagic & Action Economy Gate**:
     - Computes active `MetamagicSpellModifiers` (`empower`, `maximize`, `extend`, `widen`, `silent`, `still`, `enlarge`, `quicken`) from `castContext.metamagicFeatIds`.
     - Computes spell range in tiles (`personal` = 0, `touch` = 1, `close` = `5 + floor(CL/2)`, `medium` = `20 + 2*CL`, `long` = `80 + 8*CL`), doubled if `enlarge_spell` is active.
     - Determines action cost:
       - If `quicken_spell` is active: consumes `swift` action (`swiftRemaining`).
       - If spontaneous caster (`book.castingMode === 'spontaneous'`) with non-quicken metamagic active: consumes `full_round` action (`getSpontaneousMetamagicActionType(true, true)` -> requires both `standardRemaining > 0` and `moveRemaining > 0`).
       - Otherwise maps `spell.castingTime` (`standard`, `swift`, `full_round`).
  2. **Slot Expenditure**:
     - Prepared slot (`slotId` or first unexpended matching slot): marks `slot.expended = true`.
     - Spontaneous slot (`spellLevel` = `baseLevel + totalMetamagicSlotBump`): increments `book.spontaneousSlotsUsedByLevel[String(effectiveSlotLevel)]` (unless at-will / invocation).
  3. **Target Enumeration & Cast Pipeline (`resolveCastPipeline`)**:
     - Evaluates ASF %, Silence (`!metamagic.silent`), Deafened, Concentration, Spell Resistance, and Saving Throws (`fort`/`ref`/`will`).
     - Applies all 13 `DnD35SpellEffectUnit` types (`damage` via `evaluateMetamagicDamage`, `healing`, `stat_bundle` with `extend` duration doubling, `condition`, `ability_harm`, `spatial_field`, `dispel`, `summon`, `spell_strike`, etc.) and top-level `spell.effectBundle`.

### Task 3: NWN2-Style Quickcast HUD Overlay (`src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts` & `src/rendering/ui/dnd35e_quickcast.ui.ts`)
- **Pure View-Model (`src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts`)**:
  - Builds `QuickcastPanelViewModel` for the active player entity:
    1. **Top Modifier Tray (`QuickcastModifierToggle[]`)**:
       - Lists all metamagic feats owned by the actor (`featDef.metamagicDescriptor !== undefined`, e.g., *Empower Spell (+2)*, *Maximize Spell (+3)*, *Extend Spell (+1)*, *Still Spell (+1)*, *Silent Spell (+1)*, *Enlarge Spell (+1)*, *Widen Spell (+3)*, *Quicken Spell (+4)*) plus any equipped/carried Metamagic Rods.
       - Lists class-specific spontaneous conversion toggles:
         - Cleric: **Spontaneous Cure / Inflict Wounds** mode toggle (plus Positive/Negative energy choice for Neutral Clerics).
         - Druid: **Spontaneous Summon Nature's Ally** mode toggle.
       - Lists any Warlock / Invocation essence or blast shape toggles if present.
    2. **Collapsible Class Accordions (`QuickcastClassSection[]`)**:
       - One section per class in `dndData.spellbooksByClass` (plus an `Innate / Invocations` section if the actor has at-will invocations or spell-like abilities).
       - **Level Rows (`0` through `9`)**:
         - Automatically omits empty spell levels (matching NWN2 Image 2 where Level 8 is hidden when empty).
         - **Prepared Mode**: Groups identical unexpended prepared slots at each level into a single tile with a bottom-right count badge (`1`, `2`, `3`, `4`...). If **Spontaneous Conversion** mode is toggled on for Cleric/Druid, replaces each row `1–9` with the corresponding *Cure/Inflict* or *Summon Nature's Ally* spell icon and displays the total unexpended prepared slots at that level as the badge count!
         - **Spontaneous Mode**: Computes `totalMetamagicBump` from active metamagic toggles, shifts each known spell from `baseLevel` into row `effectiveSlotLevel = baseLevel + totalMetamagicBump` (filtering out spells where `effectiveSlotLevel > maxCastableSpellLevel` or `> 9`), and stamps every tile in row `L` with the shared remaining daily casts for Level `L` (`totalSlots - usedSlots`, or `-1` / `∞` for at-will).
- **Floating HUD Overlay (`src/rendering/ui/dnd35e_quickcast.ui.ts` & `index.html`)**:
  - Registered in `dnd35eUIDefinition` (`modalId: 'quickcast'`, `defaultKey: 'q'`, dock button `⚡ Quickcast`).
  - Styled as a compact, NWN2-authentic floating panel anchored on the left/top-left of the viewport (with semi-transparent dark obsidian/parchment styling, top modifier icon grid, collapsible `- CLASS` bars, vertical `0–9` level spine, and square spell tiles with bottom-right count badges and hover tooltips).
  - Clicking any spell tile in Quickcast (or in the Spellbook modal or Bottom Hotbar) calls `initiateSpellCastFromUI`:
    - Personal spells cast immediately and keep Quickcast updated in place; targeted/AoE spells close the overlay and enter Map Targeting Mode (`targetingMode`) with the AoE/range cursor!

### Task 4: ESLint `max-lines` (<300 Lines) Modularity Cleanup
- Split all files exceeding 300 lines into focused helper modules with barrel re-exports so `bun run lint` passes with **0 warnings and 0 errors**:
  1. `src/rulesets/dnd35e/character/builder_prereq_context.ts`
  2. `src/rulesets/dnd35e/progression/prerequisites.ts`
  3. `src/rulesets/dnd35e/types/effect_system.types.ts`
  4. `src/rulesets/dnd35e/validation/class_race_validator.ts`
  5. `src/rulesets/dnd35e/character/builder_spells.ts`
  6. `src/rendering/ui/dnd35e_char_builder_feats.ui.ts`
  7. `src/rendering/ui/dnd35e_spellbook_actions.ts`

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Modules / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. `TargetingContext` & `RulesetContract.resolveAimedAction` (`game-state.types.ts`, `combat.intents.ts`, `ruleset.types.ts`, `targeting.system.ts`)** | `dnd35e_spell_cast_ui.ts`, `dnd35e_quickcast.ui.ts`, `dnd35e_ui_registration.ts`, `mouse_input.ts`, `input_handler.ts` | `processFireAimedIntent`, `dnd35eRuleset.resolveAimedAction`, `viewport_snapshot.ts`, `tactical_snapshot.ts` | `order_target` companion targeting in `targeting.system.ts` (preserved untouched) |
| **2. `executeDnD35eSpellCast` (`spell_cast_resolver.ts` & `spell_cast_effects.ts`)** | `dnd35eRuleset.resolveAimedAction`, `initiateSpellCastFromUI` (for `personal` spells) | `resolveCastPipeline`, `evaluateSpellEffectUnitsForTarget`, `evaluateMetamagicDamage`, `computeAoEAffectedSquares`, `processDnD35eDamage`, `FieldComponent`, `ControllerLinkComponent`, `dndData.statModifiers`, `dndData.actionBudget`, `dndData.spellbooksByClass` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md`, unit tests in `tests/dnd35e_spell_casting.test.ts` |
| **3. NWN2 Quickcast HUD Overlay (`dnd35e_quickcast_model.ts`, `dnd35e_quickcast.ui.ts`, `index.html`)** | Dock command `⚡ Quickcast` (`[Q]`), metamagic/conversion toggles, spell icon clicks | Calls `initiateSpellCastFromUI`, updates `targetingMode` or executes personal spell | `dnd35e_spellbook.ui.ts`, `dnd35e_ui_hotbar.ts`, `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **4. Hotbar & Spellbook Cast Wiring (`dnd35e_ui_hotbar.ts`, `dnd35e_ui_registration.ts`, `dnd35e_spellbook_actions.ts`)** | Player clicks on Hotbar `[1]-[0]` or Spellbook `[Cast]` / `[Conv → ...]` buttons | Closes modal (`closeCartridgeModal`), enters `targetingMode` or casts immediately, updates HUD hotbar & spellbook slot pips | `console_hotbar.ui.ts` (renders updated slot counts & disabled states) |
| **5. ESLint `max-lines` Modularity Split (7 files)** | All existing callers of the 7 split modules | Barrel re-exports preserve 100% of existing import paths; `bun run lint` drops to 0 warnings | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` updated for new helper files |
