# Implementation Plan: Unified Effect Provider, 4-Stage Sub-Stat DAG & Provenance Breakdown

## 1. Architectural Overview & Goals

Following the confirmed research in `research_notes.md`, this plan upgrades the D&D 3.5e ruleset cartridge (`src/rulesets/dnd35e/`) so that every mechanical effect and compound stat resolution obeys a **single declarative 4-Stage Topological Sub-Stat DAG** with orthogonal **`OriginLayer` classification** and **winner/shadowed/suppressed provenance breakdown**:

```
Stage 1: Size Sub-Stat & Effect Provider ('size')
  ├── Resolves Effective Size from base + form_override + non-stacking size_step
  ├── Projects 'size:<category>' into selfTags
  └── Emits Size Effect Provider StatModifiers ('size' bonusType) to 'ac', 'attack', 'grapple', 'hide'
        │
        ▼
Stage 2: Ability Score Sub-Stats ('str', 'dex', 'con', 'int', 'wis', 'cha')
  ├── Evaluates resolveTypedModifiers(abilityModifiers, context) per ability
  └── Feeds typedBonusNet into computeEffectiveAbilityScore(state, typedBonusNet) -> strMod..chaMod
        │
        ▼
Stage 3: Compound Defense Sub-Stats ('natural_armor', 'worn_armor_bonus', 'worn_shield_bonus')
  ├── 'natural_armor'     = base + sum(untyped deltas) + max(enhancement) -> emits 'natural_armor' on 'ac'
  ├── 'worn_armor_bonus'  = base + max(enhancement)                       -> emits 'armor' on 'ac'
  └── 'worn_shield_bonus' = base + max(enhancement)                       -> emits 'shield' on 'ac'
        │
        ▼
Stage 4: Terminal Combat Stats ('ac', 'touch_ac', 'flat_footed_ac', 'attack', 'damage', 'grapple', 'fort', 'ref', 'will', 'max_hp')
  ├── 'worn_armor_bonus' ('armor') competes via Math.max against standalone 'armor' spells (Mage Armor / Bracers)
  ├── Touch AC excludes 'armor', 'shield', and 'natural_armor' as complete units (preserving [Force] vs incorporeal touch)
  └── resolveTypedModifiersWithBreakdown records active, shadowed (with winner sourcePath), suppressed, and byOriginLayer totals
```

### Core Standards Enforced (`AGENTS.md` Rules 11–19)
- **Zero `any` & `exactOptionalPropertyTypes: true`:** All new interfaces and return types are strictly typed; optional properties omit `undefined` assignments.
- **No Magic Values:** Size rank bounds (`-4` to `+4`) derive from `SIZE_METRICS` in `src/rulesets/dnd35e/spatial/grid_geometry.ts`.
- **100% Backward Compatibility:** Direct callers of `resolveTypedModifiers(modifiers, context)` and `computeEffectiveAC(...)` remain fully supported. Even in direct single-pass `resolveTypedModifiers` calls that use legacy `'armor_enhancement'` / `'shield_enhancement'` / `'natural_armor_enhancement'`, enhancement bonuses now fold strictly onto the physical/mundane base bonus *before* comparing via `Math.max` against standalone spell `'armor'` bonuses (fixing the Padded Armor `+1` + `+2` vs. *Mage Armor* `+4` bug while keeping Chain Shirt `+4` + `+2` = `+6` vs. *Mage Armor* `+4` passing).

---

## 2. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling Schemas / Tests / Docs) |
| :--- | :--- | :--- | :--- |
| **1. Extend `BonusType` with `'base' \| 'form_override' \| 'size_step'`** (`src/rulesets/dnd35e/types/dnd35e.types.ts`, `dnd35e_system.types.ts`) | `StatModifier` builders in `modifiers.ts`, `race_progression.ts`, `creature_type_engine.ts`, and `dnd35e_ruleset.ts`. | `resolveTypedModifiers`, `resolveTypedModifiersWithBreakdown`, `resolveEffectiveSizeCategory`. | `DnD35RacialConditionalModifierSchema` in `dnd35e_system.types.ts` (mirrored Zod enum). |
| **2. Add `OriginLayer`, `effectTags` on `StatModifier`, and `StatResolutionBreakdown`** (`src/rulesets/dnd35e/types/dnd35e.types.ts`) | `classifyModifierOriginLayer(mod)` derives layer from `mod.sourcePath` root prefix (`race:`, `class:`, `feat:`, `template:`, `form:`, `item:`, `spell:`, `condition:`, `stance:`, `field:`). | `resolveTypedModifiersWithBreakdown` returns `total`, `activeModifiers`, `shadowedModifiers`, `suppressedModifiers`, `byOriginLayer`. | `StatQueryContext` gains `againstIncorporealTouch?: boolean` and `suppressedOriginLayers?: ReadonlyArray<OriginLayer>`. |
| **3. Fix Compound Armor/Shield/Natural Armor Folding & `[Force]` Touch Exemption** (`src/rulesets/dnd35e/modifiers.ts`) | Stage 3 sub-stats (`'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'`) and legacy `armor_enhancement` callers. | `computeEffectiveAC` (`fullAC`, `touchAC`, `flatFootedAC`) and `resolveTypedModifiers`. | Existing tests in `tests/dnd35e_cartridge.test.ts` and `tests/dnd35e_phase22_bestiary.test.ts`. |
| **4. Stage 1 Size Sub-Stat & Size Effect Provider** (`src/rulesets/dnd35e/modifiers.ts`) | `resolveEffectiveSizeCategory(baseSize, sizeModifiers, context)` and `buildSizeEffectProviderModifiers(sizeCategory, parentSourcePath)`. | Projects `size:<category>` into `selfTags` and emits `'size'` modifiers to `'ac'`, `'attack'`, `'grapple'`, `'hide'` with `sourcePath: "<parent>/size:<category>/<stat>_size_mod"`. | `SIZE_METRICS` in `src/rulesets/dnd35e/spatial/grid_geometry.ts` provides rank indices (`-4..+4`), `attackAndAcModifier`, `specialSizeModifier`, and `hideModifier`. |
| **5. 4-Stage `evaluateDnD35ActorStatDAG` Pipeline** (`src/rulesets/dnd35e/modifiers.ts`, `dnd35e_ruleset.ts`) | `computeDnD35eEffectiveStats` and `resolveDnD35eMeleeAttack` in `src/rulesets/dnd35e/dnd35e_ruleset.ts`. | `EffectiveStats` (`maxHp`, `armorClass`, `attackBonus`, `damageBonus`, `speed`) and `MeleeAttackResolution` (`attackBonus`, `damage`, `ledgerPayload`). | `docs/ARCHITECTURE.md` and `docs/DECISIONS.md` (Decision #14 documenting the 4-stage Sub-Stat DAG and orthogonal `OriginLayer` resolution). |

---

## 3. Step-by-Step Implementation & Code Changes

### Step 1: Update `src/rulesets/dnd35e/types/dnd35e.types.ts`

Extend `BonusType`, `StatModifier`, `StatQueryContext`, and add `OriginLayer`, `ShadowedModifierEntry`, `SuppressedModifierEntry`, `StatResolutionBreakdown`, and `DnD35ResolvedActorStats`.

```typescript
// In src/rulesets/dnd35e/types/dnd35e.types.ts (replacing lines 1-42 and extending after line 142):

/**
 * All 18+ canonical D&D 3.5e bonus types plus sub-stat foundational/step types.
 *
 * Stacking law:
 * - Same-type bonuses do NOT stack (highest positive wins, lowest negative penalty applies),
 *   EXCEPT: `dodge`, `circumstance` (from distinct sources), `racial`, and `untyped`.
 * - `base`: Foundational sub-stat value (e.g., racial Natural Armor base, physical Armor base); highest wins.
 * - `form_override`: Polymorph / Wild Shape base size or form replacement; overrides `base`.
 * - `size_step`: Relative size category shift (e.g., Enlarge Person +1, Righteous Might +1);
 *   Per D&D 3.5e rules, multiple magical size-increasing effects do not stack (highest positive and lowest negative apply).
 */
export type BonusType =
  | 'alchemical'
  | 'armor'
  | 'armor_enhancement'
  | 'base'
  | 'circumstance'
  | 'competence'
  | 'deflection'
  | 'dodge'
  | 'enhancement'
  | 'form_override'
  | 'inherent'
  | 'insight'
  | 'luck'
  | 'morale'
  | 'natural_armor'
  | 'natural_armor_enhancement'
  | 'profane'
  | 'racial'
  | 'resistance'
  | 'sacred'
  | 'shield'
  | 'shield_enhancement'
  | 'size'
  | 'size_step'
  | 'untyped';

/**
 * Orthogonal lifecycle/UI classification derived from the root segment of `sourcePath`.
 * Does NOT alter D&D 3.5e `BonusType` stacking rules; used for UI breakdown columns
 * and bulk layer suppression (e.g., suppressing `'equipment'` when gear melds into a Wild Shape form).
 */
export type OriginLayer =
  | 'base'
  | 'racial'
  | 'progression'
  | 'form'
  | 'equipment'
  | 'temporary'
  | 'environment';
```

Add `effectTags?: ReadonlyArray<string>` to `StatModifier` and extend `StatQueryContext`:

```typescript
// In StatModifier interface (around line 94):
export interface StatModifier {
  readonly id: string;
  readonly targetStat: string;
  readonly value: number;
  readonly bonusType: BonusType;
  readonly origin: ModifierSourceOrigin;
  /** Distinct source identifier (used for circumstance bonus source-uniqueness and physical armor pairing). */
  readonly sourceId: string;
  /**
   * Hierarchical slash-delimited provenance path tracking the causal chain of Effect Providers
   * that emitted this modifier (e.g. `"race:dwarf/size:medium/ac_size_mod"`).
   */
  readonly sourcePath?: string;
  /** Optional descriptor tags on the effect itself (e.g. `['force']` on Mage Armor / Shield spells). */
  readonly effectTags?: ReadonlyArray<string>;
  /** Optional semantic tag conditions on the actor, target, or incoming effect. */
  readonly condition?: ModifierTagCondition;
}

// In StatQueryContext interface (around line 131):
export interface StatQueryContext {
  readonly inAntimagicField?: boolean;
  readonly isFlatFooted?: boolean;
  readonly ignoreArmorAndNatural?: boolean;
  /**
   * When true alongside `ignoreArmorAndNatural: true`, armor/shield modifiers carrying
   * `effectTags: ['force']` (such as Mage Armor or Shield) remain active against incorporeal touch attacks.
   */
  readonly againstIncorporealTouch?: boolean;
  readonly selfTags?: ReadonlyArray<string>;
  readonly targetTags?: ReadonlyArray<string>;
  readonly effectTags?: ReadonlyArray<string>;
  /** Optional set of `OriginLayer`s to suppress during evaluation (e.g. melded equipment). */
  readonly suppressedOriginLayers?: ReadonlyArray<OriginLayer>;
}

/** Reason why a modifier was completely excluded prior to bonus-type competition. */
export type ModifierSuppressionReason =
  | 'antimagic'
  | 'tag_condition'
  | 'touch_attack'
  | 'flat_footed'
  | 'origin_suppressed';

/** Record of a modifier that passed filtering but lost same-type bonus competition. */
export interface ShadowedModifierEntry {
  readonly modifier: StatModifier;
  readonly shadowedBySourcePath: string;
}

/** Record of a modifier that was suppressed by context rules before bonus competition. */
export interface SuppressedModifierEntry {
  readonly modifier: StatModifier;
  readonly reason: ModifierSuppressionReason;
}

/** Full diagnostic and UI breakdown of a resolved stat or sub-stat node. */
export interface StatResolutionBreakdown {
  readonly total: number;
  readonly activeModifiers: ReadonlyArray<StatModifier>;
  readonly shadowedModifiers: ReadonlyArray<ShadowedModifierEntry>;
  readonly suppressedModifiers: ReadonlyArray<SuppressedModifierEntry>;
  readonly byOriginLayer: Readonly<Record<OriginLayer, number>>;
}
```

---

### Step 2: Update `src/rulesets/dnd35e/types/dnd35e_system.types.ts`

Mirror `'base'`, `'form_override'`, and `'size_step'` in `DnD35RacialConditionalModifierSchema` (lines 280–300) so JSON-authored conditional modifiers can target sub-stats (`'size'`, `'natural_armor'`, etc.).

```typescript
// In src/rulesets/dnd35e/types/dnd35e_system.types.ts (lines 280-303):
  type: z.enum([
    'alchemical',
    'armor',
    'base',
    'circumstance',
    'competence',
    'deflection',
    'dodge',
    'enhancement',
    'form_override',
    'inherent',
    'insight',
    'luck',
    'morale',
    'natural_armor',
    'profane',
    'racial',
    'resistance',
    'sacred',
    'shield',
    'size',
    'size_step',
    'untyped'
  ]),
```

---

### Step 3: Enhance `src/rulesets/dnd35e/modifiers.ts`

1. **Add `classifyModifierOriginLayer(mod: StatModifier): OriginLayer`**:
   Inspects the root segment of `getModifierSourcePath(mod)` (`race:*` -> `'racial'`, `class:*` / `feat:*` / `template:*` / `type:*` / `subtype:*` -> `'progression'`, `form:*` / `wild_shape:*` -> `'form'`, `item:*` / `equip:*` / `armor:*` / `shield:*` / `weapon:*` -> `'equipment'`, `spell:*` / `condition:*` / `stance:*` / `effect:*` -> `'temporary'`, `field:*` / `aura:*` / `zone:*` -> `'environment'`, fallback `'base'`).

2. **Add `resolveTypedModifiersWithBreakdown(modifiers, context): StatResolutionBreakdown` and delegate `resolveTypedModifiers(modifiers, context): number` to `.total`**:
   - Records every suppressed modifier with its exact `ModifierSuppressionReason`:
     - `'origin_suppressed'` if `context.suppressedOriginLayers` includes `classifyModifierOriginLayer(mod)`
     - `'antimagic'` if `context.inAntimagicField && (mod.origin === 'spell' || mod.origin === 'supernatural')`
     - `'flat_footed'` if `context.isFlatFooted && mod.bonusType === 'dodge' && mod.value > 0`
     - `'touch_attack'` if `context.ignoreArmorAndNatural` and `mod.bonusType` is `'armor' | 'armor_enhancement' | 'shield' | 'shield_enhancement' | 'natural_armor' | 'natural_armor_enhancement'`, **unless** `context.againstIncorporealTouch === true` and `(mod.bonusType === 'armor' || mod.bonusType === 'shield')` and `mod.effectTags?.includes('force') === true`
     - `'tag_condition'` if `!matchesTagCondition(mod.condition, context)`
   - Resolves non-stacking bonus types by tracking both the winning `StatModifier` and all losing `ShadowedModifierEntry` items (recording `shadowedBySourcePath: getModifierSourcePath(winner)`).
   - For `'form_override'` vs `'base'`: if a positive/active `'form_override'` modifier is present, any `'base'` modifier on that sub-stat is marked shadowed by the winning `'form_override'` modifier!
   - For legacy `'armor_enhancement'` / `'shield_enhancement'` / `'natural_armor_enhancement'` passed directly to `resolveTypedModifiers`:
     - Separates physical/mundane `'armor'` modifiers (`mod.origin === 'mundane'`) from standalone spell/magical `'armor'` modifiers (`mod.origin !== 'mundane'`).
     - Folds `bestArmorEnhancement` onto `bestMundaneArmor` (`mundaneCompound = bestMundaneArmor + bestArmorEnhancement`) *before* comparing against `bestStandaloneArmor` (`Math.max(mundaneCompound, bestStandaloneArmor)`), shadowing the losing branch cleanly!

3. **Add Stage 1 Size Sub-Stat & Effect Provider Functions**:
   - `SIZE_CATEGORIES_BY_RANK`: Maps rank `-4..+4` <-> `SizeCategory` via `SIZE_METRICS`.
   - `resolveEffectiveSizeCategory(baseSize: SizeCategory, sizeModifiers: ReadonlyArray<StatModifier>, context?: StatQueryContext): { readonly sizeCategory: SizeCategory; readonly rankIndex: number; readonly winningSourcePath: string }`:
     - Starts from `base` rank (`SIZE_METRICS[baseSize].rankIndex`) or `form_override` rank if present, then adds non-stacking `size_step` (max positive step + min negative step), clamped to `[-4, 4]`.
   - `buildSizeEffectProviderModifiers(sizeCategory: SizeCategory, parentSourcePath?: string): ReadonlyArray<StatModifier>`:
     - Reads `SIZE_METRICS[sizeCategory]` and emits declarative `StatModifier`s (`bonusType: 'size'`) for:
       - `'ac'` (`attackAndAcModifier`)
       - `'attack'` (`attackAndAcModifier`)
       - `'grapple'` (`specialSizeModifier`)
       - `'hide'` (`hideModifier`)
     - Each modifier carries `sourcePath: appendSourcePath(sizeRootPath, `${targetStat}_size_mod`)` where `sizeRootPath = appendSourcePath(parentSourcePath, `size:${sizeCategory}`)`.

4. **Update `computeEffectiveAC` to avoid double-counting Size when Size Effect Provider is present**:
   - If `acModifiers` already contains an active `bonusType: 'size'` modifier targeting `'ac'`, `computeEffectiveAC` uses that modifier's contribution as `sizeContribution` rather than adding `SIZE_AC_AND_ATTACK_MODIFIERS[sizeCategory]` a second time. If no `bonusType: 'size'` modifier is in `acModifiers` (legacy caller), it falls back to `SIZE_AC_AND_ATTACK_MODIFIERS[sizeCategory]`.

5. **Add `evaluateDnD35ActorStatDAG(input: DnD35ActorStatDAGInput): DnD35ResolvedActorStats`**:
   Evaluates all 4 stages in topological order:
   - **Stage 1 (`'size'`)**: Resolves `effectiveSize` from `baseSize` + any modifiers targeting `'size'`, injects `size:${effectiveSize}` into `selfTags` (filtering out stale `size:*` tags), and emits `buildSizeEffectProviderModifiers(effectiveSize, winningSizeSourcePath)`.
   - **Stage 2 (`'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'`)**: For each ability score, filters modifiers with `targetStat === abilityId`, resolves `typedBonusNet = resolveTypedModifiers(abilityMods, stage2Context)`, and calls `computeEffectiveAbilityScore(rawAbilityState, typedBonusNet)`.
   - **Stage 3 (`'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'`)**:
     - Builds `'natural_armor'` sub-stat modifiers from `baseNaturalArmor` (`bonusType: 'base'`), template/class `naturalArmorDelta` (`bonusType: 'untyped'`), and any modifiers targeting `'natural_armor'` (or legacy `'natural_armor_enhancement'` / `'natural_armor'` on `'ac'`), resolves via `resolveTypedModifiersWithBreakdown`, and if `total !== 0` (and not stripped by `stripNaturalArmor`), emits a single `{ targetStat: 'ac', bonusType: 'natural_armor', value: total }` modifier into Stage 4.
     - Resolves `'worn_armor_bonus'` (from physical armor base + enhancement modifiers targeting `'worn_armor_bonus'`) and emits `{ targetStat: 'ac', bonusType: 'armor', value: total }` into Stage 4.
     - Resolves `'worn_shield_bonus'` (from physical shield base + enhancement modifiers targeting `'worn_shield_bonus'`) and emits `{ targetStat: 'ac', bonusType: 'shield', value: total }` into Stage 4.
   - **Stage 4 (Combat Stats)**:
     - Injects dynamic `subtype:incorporeal` CHA deflection modifier (`Math.max(1, chaMod)`) if applicable.
     - Computes `acBreakdown = computeEffectiveAC(...)` plus `acResolution = resolveTypedModifiersWithBreakdown(...)`, `attackBonus`, `damageBonus`, `grappleBonus`, `saves`, and `maxHp`.

---

### Step 4: Wire `evaluateDnD35ActorStatDAG` into `src/rulesets/dnd35e/dnd35e_ruleset.ts`

Update `computeDnD35eEffectiveStats` and `resolveDnD35eMeleeAttack` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` so they evaluate the actor through `evaluateDnD35ActorStatDAG`:
- `computeDnD35eEffectiveStats` now automatically applies Stage 1 (`'size'` modifiers & Size Effect Provider), Stage 2 (`'str'`, `'dex'`, `'con'`, `'int'`, `'wis'`, `'cha'` modifiers cascading into CON HP, DEX AC, CHA Incorporeal Deflection, STR Attack/Damage), Stage 3 (`'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'`), and Stage 4 (`'ac'`, `'attack'`, `'damage'`).
- `resolveDnD35eMeleeAttack` uses the DAG-resolved `effectiveSize`, `abilities`, and `acBreakdown` for both attacker and defender, ensuring size shifts (*Enlarge Person*), ability buffs (*Belt of Giant Strength*), and compound natural/worn armor stack and log accurately.

---

### Step 5: Unit Tests in `tests/dnd35e_phase22_bestiary.test.ts`

Add a new `describe('Phase 22+: 4-Stage Sub-Stat DAG, Size Effect Provider & Provenance Breakdown', ...)` suite verifying:
1. **Natural Armor Sub-Stat (`'natural_armor'`)**: Lizardfolk (`+5 base`) + Dragon Disciple (`+1 untyped`) + *Amulet of Natural Armor +2* (`+2 enhancement`) + *Barkskin* (`+3 enhancement`) -> resolves to `+9` Natural Armor (`5 + 1 + max(2, 3)`), applies to Full AC and Flat-Footed AC, and is completely excluded (`0`) on Touch AC.
2. **Worn Armor Compound vs. Standalone Spell Armor**: Padded Armor (`+1 base`, `+2 enhancement` = `+3`) + *Mage Armor* (`+4 armor` spell) -> resolves to `+4` (NOT `+6`), with Padded Armor recorded in `shadowedModifiers` (`shadowedBySourcePath: 'spell:mage_armor'`).
3. **Incorporeal Touch vs. `[Force]` Armor**: *Mage Armor* (`bonusType: 'armor'`, `effectTags: ['force']`) is excluded against standard Touch AC (`ignoreArmorAndNatural: true`) but **retained** against Incorporeal Touch (`ignoreArmorAndNatural: true, againstIncorporealTouch: true`).
4. **Stage 1 Size Sub-Stat & Effect Provider**: Base Medium actor with *Enlarge Person* (`+1 size_step`) + *Righteous Might* (`+1 size_step`) -> resolves to `'large'` (non-stacking `size_step`), projects `'size:large'` into `selfTags`, and emits `sourcePath: ".../size:large/ac_size_mod"` (`-1`), `attack_size_mod` (`-1`), `grapple_size_mod` (`+4`), `hide_size_mod` (`-4`).
5. **Stage 2 Ability Score Cascade**: Actor with *Belt of Giant Strength +4* (`+4 enhancement` to `'str'`) and *Bull's Strength* (`+4 enhancement` to `'str'`) -> non-stacking `+4` STR (`+2` `strMod` increase) cascades into melee attack and damage bonuses in `computeDnD35eEffectiveStats`.
6. **Orthogonal `OriginLayer` & Provenance Breakdown**: `resolveTypedModifiersWithBreakdown` returns accurate `byOriginLayer` sums (`racial`, `progression`, `equipment`, `temporary`) and suppresses `'equipment'` layer modifiers when `suppressedOriginLayers: ['equipment']` is passed.

---

### Step 6: Documentation Updates (`docs/ARCHITECTURE.md` & `docs/DECISIONS.md`)

- Update `docs/DECISIONS.md` with **Decision #14: 4-Stage Topological Sub-Stat DAG & Orthogonal `OriginLayer` Provenance Breakdown**.
- Update `docs/ARCHITECTURE.md` under the D&D 3.5e Cartridge section to document the 4-stage DAG (`size -> ability_scores -> compound_defenses -> combat_stats`).
