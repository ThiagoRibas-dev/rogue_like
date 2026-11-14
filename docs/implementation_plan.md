# Implementation Plan — End-to-End D&D 3.5e Spell Casting, NWN2-Style Quickcast Menu, Targeting & Modularity Cleanup

## 1. Architectural Alignment & SSOT Ownership Table

Per `AGENTS.md` Rules 15–20 and `docs/SSOT_CONSOLE.md` / `docs/SSOT_DND35E.md`:

| Responsibility | Canonical Owner (SSOT) | Legacy / Stub Code Evicted |
| :--- | :--- | :--- |
| **Generic Aimed Action Hook** | `src/types/ruleset.types.ts` (`RulesetContract.resolveAimedAction`) & `src/systems/targeting.system.ts` (`processFireAimedIntent`) | Evicts the Milestone 3 `"You target the tile at X, Y."` stub in `targeting.system.ts` when an active ruleset provides `resolveAimedAction`. |
| **AoE Blast Preview on Viewport** | `src/rendering/viewport_snapshot.ts` & `src/rendering/tactical_snapshot.ts` | Evicts single-tile-only cursor highlighting when `targetingMode.radius > 0`. |
| **Runtime Spell Execution & Effect Application** | `src/rulesets/dnd35e/magic/spell_cast_resolver.ts` & `src/rulesets/dnd35e/magic/spell_cast_effects.ts` | Evicts text-only stub behaviour in `castPreparedSlot` / `castSpontaneousSpell` (`src/rendering/ui/dnd35e_spellbook_actions.ts`). |
| **NWN2-Style Quickcast View-Model** | `src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts` | Pure Tier 2 view-model computing on-the-fly metamagic slot shifts, Cleric/Druid spontaneous conversions, Warlock essences/invocations, and grouped prepared slot counts. |
| **NWN2-Style Quickcast HUD Overlay & Cast Initiation** | `src/rendering/ui/dnd35e_quickcast.ui.ts` & `src/rendering/ui/dnd35e_spell_cast_ui.ts` | Evicts the bug in `dnd35e_ui_registration.ts` where clicking a hotbar spell called `unprepareSpellSlot` instead of casting. |

---

## 2. Step-by-Step Implementation Plan & Code Snippets

### Phase 1: Tier 1 Console Targeting Context, Ruleset Hook & AoE Preview

#### Step 1.1: Extend `TargetingContext` (`src/types/game-state.types.ts` & `src/types/intents/combat.intents.ts`)
Add optional spell/ability targeting metadata to `GameState['targetingMode']` and `ToggleTargetingIntent['context']`:
```ts
// In src/types/game-state.types.ts (lines 118-125) & src/types/intents/combat.intents.ts (lines 20-26):
readonly context?: {
  readonly verb?: string;
  readonly itemId?: EntityId;
  readonly abilityId?: string;
  readonly companionId?: EntityId;
  readonly spellId?: string;
  readonly classId?: string;
  readonly slotId?: string;
  readonly spellLevel?: number;
  readonly convertedSpellId?: string;
  readonly metamagicFeatIds?: ReadonlyArray<string>;
  readonly aoeShape?: 'burst' | 'emanation' | 'spread' | 'cone' | 'line';
};
```

#### Step 1.2: Add `resolveAimedAction` to `RulesetContract` (`src/types/ruleset.types.ts`) & Delegate in `src/systems/targeting.system.ts`
```ts
// In src/types/ruleset.types.ts:
readonly resolveAimedAction?: (
  state: GameState,
  actorId: EntityId,
  targetPos: { readonly x: number; readonly y: number },
  context: NonNullable<NonNullable<GameState['targetingMode']>['context']>
) => { readonly state: GameState; readonly success: boolean };
```
```ts
// In src/systems/targeting.system.ts (inside processFireAimedIntent):
const context = state.targetingMode.context;
if (context && state.activeRuleset?.resolveAimedAction && context.verb === 'cast_spell') {
  const { targetingMode: _removed, ...restState } = state;
  const result = state.activeRuleset.resolveAimedAction(
    restState as GameState,
    intent.entityId,
    targetCursor,
    context
  );
  return { state: result.state, turnConsumed: result.success };
}
```

#### Step 1.3: Project AoE Blast Radius in `src/rendering/viewport_snapshot.ts` & `src/rendering/tactical_snapshot.ts`
When `state.targetingMode?.active` has `radius > 0`, highlight tiles within Euclidean radius `dx * dx + dy * dy <= radius * radius` around `targetingMode.cursor` so the player sees the exact AoE footprint before confirming.

---

### Phase 2: Tier 2 D&D 3.5e Runtime Spell Cast Execution (`spell_cast_resolver.ts` & `spell_cast_effects.ts`)

#### Step 2.1: Create `src/rulesets/dnd35e/magic/spell_cast_effects.ts` (<250 lines)
Handles applying evaluated `DnD35SpellEffectUnit`s and top-level `spell.effectBundle` to each affected target entity:
- **`damage`**: Uses `evaluateMetamagicDamage("${unit.diceCount}d${unit.diceSides}+${unit.flatBonus}", metamagic)` multiplied by `Math.max(1, unit.projectileCount)` (with `half` reduction on successful save), queues `DamageComponent` with `unit.damageType`, and runs `processDnD35eDamage`.
- **`healing`**: Rolls healing dice (or maximizes/empowers if metamagic applies), restores `FighterComponent.hp` (or damages undead if `unit.invertsForUndead` and target has `type:undead`).
- **`stat_bundle` & Top-Level `spell.effectBundle`**: Revokes any prior modifiers on the target matching `"spell:${spell.id}:"` via `revokeModifiersByPathPrefix`, then materializes and appends `StatModifier`s (`materializeSpellUnitModifiers` + `materializeTopLevelSpellModifiers`).
- **`condition`**: Removes any `unit.curesConditions` and adds `unit.conditionId` to `targetDnd.conditions`.
- **`ability_harm`**: Appends ability penalty/damage `StatModifier` to `targetDnd.statModifiers`.
- **`spatial_field`**: Spawns a field entity with `FieldComponent` at `targetPos` (or anchored to `casterId`).
- **`dispel`**: Runs `resolveDispelCheck` against active `"spell:"` sourcePaths on the target and revokes dispelled paths.
- **`summon`**: Spawns the summoned creature on the nearest open tile to `targetPos` with `ControllerLinkComponent` (`controllerId: casterId`, `aiProfileId: 'companion_default'`).
- **`spell_strike`**: Invokes `resolveIterativeSpellStrike`.

#### Step 2.2: Create `src/rulesets/dnd35e/magic/spell_cast_resolver.ts` (<260 lines)
Exports `executeDnD35eSpellCast(state, casterId, targetPos, castContext)` and `computeSpellRangeTiles(range, casterLevel, enlarged)`:
```ts
export interface DnD35SpellCastContext {
  readonly classId: string;
  readonly spellId: string;
  readonly slotId?: string | undefined;
  readonly spellLevel?: number | undefined;
  readonly convertedSpellId?: string | undefined;
  readonly metamagicFeatIds?: ReadonlyArray<string> | undefined;
}
```
1. Looks up `effectiveSpellId = castContext.convertedSpellId ?? castContext.spellId` in `systemContent.spells`.
2. Evaluates `MetamagicSpellModifiers` from `castContext.metamagicFeatIds` (`empower_spell`, `maximize_spell`, `extend_spell`, `widen_spell`, `silent_spell`, `still_spell`, `enlarge_spell`, `quicken_spell`).
3. Validates range (`computeSpellRangeTiles`) and action economy on `dndData.actionBudget` (`swift` if `quicken_spell` or `castingTime === 'swift'`, `full_round` if spontaneous metamagic or `castingTime === 'full_round'`, else `standard`).
4. Expends the prepared slot (`slotId`) or spontaneous slot (`spellLevel`) in `dndData.spellbooksByClass[classId]`.
5. Enumerates affected targets (`[casterId]` for `personal`, actor at `targetPos` for single-target/touch/ray, or all actors in `computeAoEAffectedSquares` / radius for AoE spells).
6. Runs `resolveCastPipeline` (including Arcane Spell Failure % from equipped armor/shield when `book.castingTradition === 'arcane'`, Silence, Deafened, Spell Resistance, and Saving Throws `fort` / `ref` / `will` via `evaluateDnD35eEntityDAG` + `rollD20('save', ...)`), and delegates effect application to `applyResolvedSpellEffectsToTarget`.
7. Wires `resolveAimedAction` on `dnd35eRuleset` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` to call `executeDnD35eSpellCast`.

---

### Phase 3: NWN2-Style Quickcast Menu & Unified Spell Cast UI (`dnd35e_quickcast_model.ts`, `dnd35e_quickcast.ui.ts`, `dnd35e_spell_cast_ui.ts`)

#### Step 3.1: Create Pure Quickcast View-Model (`src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts`, <260 lines)
Builds the NWN2-style Quickcast matrix for any entity:
```ts
export interface QuickcastModifierToggle {
  readonly id: string;
  readonly label: string;
  readonly shortBadge: string;
  readonly kind: 'metamagic' | 'spontaneous_cure' | 'spontaneous_inflict' | 'spontaneous_sna' | 'essence';
  readonly slotLevelBump: number;
  readonly isActive: boolean;
}

export interface QuickcastSpellTile {
  readonly spellId: string;
  readonly spellName: string;
  readonly school: string;
  readonly classId: string;
  readonly baseLevel: number;
  readonly effectiveSlotLevel: number;
  readonly remainingCount: number; // -1 for at-will / infinite
  readonly slotId?: string | undefined;
  readonly convertedSpellId?: string | undefined;
  readonly metamagicFeatIds: ReadonlyArray<string>;
  readonly rangeLabel: string;
  readonly saveDc: number;
  readonly isDisabled: boolean;
}

export interface QuickcastLevelRow {
  readonly spellLevel: number;
  readonly tiles: ReadonlyArray<QuickcastSpellTile>;
}

export interface QuickcastClassSection {
  readonly classId: string;
  readonly className: string;
  readonly castingMode: 'prepared' | 'spontaneous' | 'innate';
  readonly isCollapsed: boolean;
  readonly rows: ReadonlyArray<QuickcastLevelRow>;
}
```
- **Prepared Casters**: Stacks identical unexpended `preparedSlots` at each level into a single `QuickcastSpellTile` with `remainingCount = matchingUnexpendedSlots.length` and `slotId = matchingUnexpendedSlots[0].slotId`. When Cleric *Spontaneous Cure/Inflict* or Druid *Spontaneous SNA* is toggled active in the top modifier tray, each row `1–9` displays the converted spell (*Cure Light Wounds* .. *Mass Cure Critical Wounds* or *Summon Nature's Ally I–IX*) with `remainingCount` equal to total unexpended non-domain slots at that level!
- **Spontaneous Casters**: Sums `slotLevelBump` across active metamagic toggles, places each known spell into row `effectiveSlotLevel = baseLevel + totalMetamagicBump` (omitting spells exceeding `maxCastableSpellLevel` or `9`), and sets `remainingCount = Math.max(0, totalDailySlots - usedSlots)` (`-1` for Level 0 at-will or invocations).
- **Empty Row Omission**: Automatically omits any level row `0–9` that has `0` available tiles (matching NWN2's compact layout).

#### Step 3.2: Create Unified Cast Initiator (`src/rendering/ui/dnd35e_spell_cast_ui.ts`, <180 lines)
Exports `initiateSpellCastFromUI(state, playerId, request)`:
- Checks if the spell is self-only (`spell.range === 'personal'` or `spell.targeting.mode === 'personal'` or self-anchored emanation):
  - Closes any full-screen modal (`spellbook`), executes `executeDnD35eSpellCast` immediately at the player's position, and refreshes the UI.
- Otherwise (requires aiming at a target or AoE tile):
  - Closes any open modal (`closeCartridgeModal`), activates `processToggleTargetingIntent` with `verb: 'cast_spell'`, `range` in tiles, `radius` in tiles (doubled if `widen_spell` is active), and full `context` (`spellId`, `classId`, `slotId`, `spellLevel`, `convertedSpellId`, `metamagicFeatIds`, `aoeShape`).

#### Step 3.3: Create Floating NWN2 Quickcast HUD Panel (`src/rendering/ui/dnd35e_quickcast.ui.ts`, `index.html`, `src/styles/dnd35e_modals.css`)
- Adds `#dnd35e-quickcast-overlay` to `index.html` and registers `quickcast` in `dnd35eUIDefinition` (`defaultKey: 'q'`, dock button `⚡ Quickcast`).
- Renders the NWN2-authentic floating panel:
  - **Header**: `QUICKCAST` title + close button.
  - **Top Modifier Tray**: 2-row icon grid of the character's Metamagic Feats (`+1`, `+2`, `+3`, `+4` badges), Cleric Spontaneous `Cure` / `Inflict` toggles, Druid Spontaneous `SNA` toggle, and Warlock Essences.
  - **Class Accordion Bars**: Collapsible `- WIZARD`, `- CLERIC`, `- SORCERER` headers.
  - **`0–9` Level Spine & Square Spell Tiles**: Left column of `0..9` level badges paired with horizontal rows of school-colored spell tiles, each showing an icon glyph, compact name, hover tooltip, and bottom-right remaining count badge (`3`, `11`, `∞`).

#### Step 3.4: Wire Bottom Hotbar & Spellbook Modal Buttons (`dnd35e_ui_hotbar.ts`, `dnd35e_ui_registration.ts`, `dnd35e_spellbook_panes.ui.ts`, `dnd35e_spellbook_known.ui.ts`)
- Update `buildDnD35eHotbarSlots` (`src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts`) to read unexpended `preparedSlots` (grouped with `×N` badge) and spontaneous known spells (with remaining slot count), passing `slotId` / `spellLevel` in `actionPayload`.
- Fix `onExecuteHotbarSlot` (`src/rendering/ui/dnd35e_ui_registration.ts`) so clicking a hotbar spell calls `initiateSpellCastFromUI` instead of `unprepareSpellSlot`.
- Update `[Cast]` and `[Conv → ...]` buttons in `dnd35e_spellbook_panes.ui.ts` and `dnd35e_spellbook_known.ui.ts` to call `initiateSpellCastFromUI`.

---

### Phase 4: ESLint `max-lines` (<300 Lines) Modularity Cleanup
Split the 7 files exceeding 300 lines into focused sub-modules with barrel re-exports:
1. `src/rulesets/dnd35e/character/builder_prereq_context.ts` → extract helpers to `src/rulesets/dnd35e/character/builder_prereq_helpers.ts`.
2. `src/rulesets/dnd35e/progression/prerequisites.ts` → extract evaluators to `src/rulesets/dnd35e/progression/prerequisite_evaluators.ts`.
3. `src/rulesets/dnd35e/types/effect_system.types.ts` → extract spell effect schemas to `src/rulesets/dnd35e/types/spell_effect.types.ts`.
4. `src/rulesets/dnd35e/validation/class_race_validator.ts` → extract race/template validator to `src/rulesets/dnd35e/validation/race_template_validator.ts`.
5. `src/rulesets/dnd35e/character/builder_spells.ts` → extract helpers to `src/rulesets/dnd35e/character/builder_spells_helpers.ts`.
6. `src/rendering/ui/dnd35e_char_builder_feats.ui.ts` → extract feat row renderer to `src/rendering/ui/dnd35e_char_builder_feat_row.ui.ts`.
7. `src/rendering/ui/dnd35e_spellbook_actions.ts` → move casting initiation to `src/rendering/ui/dnd35e_spell_cast_ui.ts`.

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Modules / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| **1. `TargetingContext` & `RulesetContract.resolveAimedAction`** | `dnd35e_spell_cast_ui.ts`, `dnd35e_quickcast.ui.ts`, `dnd35e_ui_registration.ts`, `mouse_input.ts`, `input_handler.ts` | `processFireAimedIntent`, `dnd35eRuleset.resolveAimedAction`, `viewport_snapshot.ts`, `tactical_snapshot.ts` | `order_target` companion targeting in `targeting.system.ts` (preserved) |
| **2. `executeDnD35eSpellCast` (`spell_cast_resolver.ts` & `spell_cast_effects.ts`)** | `dnd35eRuleset.resolveAimedAction`, `initiateSpellCastFromUI` | `resolveCastPipeline`, `evaluateSpellEffectUnitsForTarget`, `evaluateMetamagicDamage`, `computeAoEAffectedSquares`, `processDnD35eDamage`, `FieldComponent`, `ControllerLinkComponent`, `dndData.statModifiers`, `dndData.actionBudget`, `dndData.spellbooksByClass` | `docs/ssot/ssot_dnd35e.json`, `docs/SSOT_DND35E.md`, unit tests in `tests/dnd35e_spell_casting.test.ts` |
| **3. NWN2 Quickcast HUD Overlay (`dnd35e_quickcast_model.ts`, `dnd35e_quickcast.ui.ts`, `index.html`)** | Dock command `⚡ Quickcast` (`[Q]`), metamagic/conversion toggles, spell icon clicks | Calls `initiateSpellCastFromUI`, updates `targetingMode` or executes personal spell | `dnd35e_spellbook.ui.ts`, `dnd35e_ui_hotbar.ts`, `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **4. Hotbar & Spellbook Cast Wiring (`dnd35e_ui_hotbar.ts`, `dnd35e_ui_registration.ts`, `dnd35e_spellbook_actions.ts`)** | Player clicks on Hotbar `[1]-[0]` or Spellbook `[Cast]` / `[Conv → ...]` buttons | Closes modal (`closeCartridgeModal`), enters `targetingMode` or casts immediately, updates HUD hotbar & spellbook slot pips | `console_hotbar.ui.ts` |
| **5. ESLint `max-lines` Modularity Split (7 files)** | All existing callers of the 7 split modules | Barrel re-exports preserve 100% of existing import paths; `bun run lint` achieves 0 warnings and 0 errors | `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |

---

## 4. Verification Plan (`verify.sh`)
1. Write unit tests in `tests/dnd35e_spell_casting.test.ts` covering:
   - Personal spell immediate execution (*Mage Armor* applying `+4 armor` modifier with `"spell:mage_armor:..."` `sourcePath`).
   - Targeted & AoE spell execution via `resolveAimedAction` (*Magic Missile* projectile damage, *Fireball* AoE Reflex save + SR check, *Cure Light Wounds* healing + undead inversion).
   - Quickcast View-Model (`buildDnD35eQuickcastModel`) grouping prepared slots (`×N`), shifting spontaneous spells by active metamagic (`Empower Spell +2`), and Cleric/Druid spontaneous conversion mode.
2. Update `docs/ssot/ssot_console.json` and `docs/ssot/ssot_dnd35e.json` and regenerate `docs/SSOT_CONSOLE.md` and `docs/SSOT_DND35E.md` via `bun scripts/map-codebase.ts`.
3. Run `./verify.sh` across all 8 stages (`tsc --noEmit`, `format`, `lint`, `lint:arch`, `lint:deadcode`, `bun test`, `bun run build`, `run-validator.ts`) and verify 0 errors and 0 lint warnings.
