# Implementation Plan — Unified Entity Stat & Skill Breakdown Registry + Audit Fixes

## 1. Overview & Architectural Alignment
This plan implements the **Unified Entity Stat & Skill Breakdown Registry** across `DnD35ResolvedActorStats` and `DnD35EntityDAGResult`, eliminating 6 duplicate calculation sites where skills and sub-stats were manually recalculated, and resolves Audit Findings 1, 3, 4, and 5 (`AGENTS.md` Rules 15–21).

### SSOT Ownership & Old-Brain Eviction Table
| Responsibility | Evicted Duplicate / Old-Brain Site | Canonical Owner |
| :--- | :--- | :--- |
| Resolving per-skill breakdown (`rawRanks`, `effectiveRanks`, `keyAbilityModifier`, `synergyBonus`, `acpApplied`, `modifierBreakdown`, `totalModifier`) | `computePassiveSkillModifier` (`dnd35e_ui_char_sheet.ts`), manual sums in `spell_cast_resolver.ts` & `counterspell_interrupt.ts`, raw DAG call in `skill_verb_helpers.ts`, raw `.base` ability math in `buildKnowledgeDevotionModifiers` | `resolveActorSkillsSnapshot` (`src/rulesets/dnd35e/skills/skill_synergies.ts`), exposed on `DnD35EntityDAGResult.resolvedSkills` |
| Resolving Stage 2 Ability & Stage 4 Save breakdowns (`abilityBreakdowns`, `saveBreakdowns`) | Overwritten `.base` in `dag_resolver.ts` | `evaluateDnD35ActorStatDAG` (`src/rulesets/dnd35e/modifiers/dag_resolver.ts`) |
| Computing equipped Armor/Shield Check Penalty (`armorCheckPenalty`) | Hardcoded `armorCheckPenalty: 0` in `skill_verb_helpers.ts` & `counterspell_interrupt.ts` | `collectEquippedItemDAGContributions` (`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`) |
| *Knowledge Devotion* check-to-combat scaling | Manual `computeAbilityModifier(rawScore)` in `skill_synergies.ts` | `buildKnowledgeDevotionModifiers` reading `resolvedSkills[skillDef.id].totalModifier` directly |
| Universal counterspell & *Improved Counterspell* detection | String checks `includes('dispel')` & `includes('improved_counterspell')` | `candSpell?.effectUnits.some((u) => u.type === 'dispel')` + `improved_counterspell.json` (`trait:improved_counterspell`) |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (`AGENTS.md` Rule 21)
| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| Universal counterspell eligibility (*Dispel Magic*, *Greater Dispel Magic*, custom dispel spells) | `if (spellId === 'dispel_magic' \|\| spellId.includes('dispel'))` | `options?.isUniversalCounterspell === true` derived from `spell.effectUnits.some((u) => u.type === 'dispel')` | **Yes** — any spell authored with a `'dispel'` effect unit automatically functions as a universal counterspell. |
| *Improved Counterspell* same-school higher-level counterspelling | `if (feats.includes('improved_counterspell'))` | `public/data/rulesets/dnd35e/feats/improved_counterspell.json` granting `effectBundle.grantedTags: ["trait:improved_counterspell"]` | **Yes** — any feat, domain, or class feature granting `trait:improved_counterspell` enables same-school counterspelling. |
| *Knowledge Devotion* tier calculation | Recalculating `10 + ranks + abilityMod` from raw `.base` | Reading `resolvedSkills[skillId].totalModifier` from the unified DAG | **Yes** — all typed bonuses, synergies, Bardic Knack, and temporary buffs/debuffs apply automatically. |

---

## 3. Cascading Effects Matrix (`AGENTS.md` Rule 15)
| Change | Upstream (Callers / Producers) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Docs / SSOT) |
| :--- | :--- | :--- | :--- |
| Add `DnD35AbilityResolution`, `DnD35SaveResolution`, `DnD35SkillResolution` to `dnd35e.types.ts` & `dag_resolver.ts` | `evaluateDnD35ActorStatDAG`, `evaluateDnD35eEntityDAG`, `collectEquippedItemDAGContributions` (`armorCheckPenalty`) | `dnd35e_ui_char_sheet.ts`, `skill_verb_helpers.ts`, `spell_cast_resolver.ts`, `counterspell_interrupt.ts`, `buildKnowledgeDevotionModifiers` | Update `docs/ssot/ssot_dnd35e.json` (`skill_synergies.ts`) |
| Pass `meta.flags.projectTouch` in `dnd35e_spell_cast_ui.ts` | `initiateSpellCastFromUI` | Targeting overlay crosshair range for *Reach Spell* + touch spells | Matches `spell_cast_resolver.ts` |
| Add `improved_counterspell.json` & declarative `isUniversalCounterspell` | `system_content_feat_ids.ts`, `metamagic_dispel.ts`, `counterspell_interrupt.ts` | Reactive counterspelling & `dnd35e_validator.ts` | 749 modular ruleset files validated in `run-validator.ts` |
| Validate `skillCheckCombatBonus` in `dnd35e_validator.ts` | `validateDnD35eSystemContentIntegrity` | Catches invalid `skillPrefix` on custom devotion feats | `ruleset_validators.test.ts` |
| Compact `dnd35e_ui_hotbar.ts` & `wild_shape.ts` <= 300 lines | `eslint` stage `[3/8]` | `0` errors and `0` warnings in `verify.sh` | No API or export changes |

---

## 4. Step-by-Step Implementation Plan with Code Snippets

### Step 1: Unified Breakdown Types & Stage 2/Stage 4 DAG Breakdowns (`dnd35e.types.ts`, `dag_resolver.ts`, `dnd35e_equipped_item_dag.ts`)
1. **[`src/rulesets/dnd35e/types/dnd35e.types.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/types/dnd35e.types.ts)**:
   ```ts
   export interface DnD35AbilityResolution {
     readonly abilityId: AbilityId;
     readonly rawState: AbilityScoreState;
     readonly modifierBreakdown: StatResolutionBreakdown;
     readonly effectiveScore: number | null;
     readonly effectiveModifier: number;
   }

   export interface DnD35SaveResolution {
     readonly saveType: SaveType;
     readonly baseSave: number;
     readonly abilityId: AbilityId;
     readonly abilityModifier: number;
     readonly modifierBreakdown: StatResolutionBreakdown;
     readonly total: number;
   }

   export interface DnD35SkillResolution {
     readonly skillId: string;
     readonly rawRanks: number;
     readonly effectiveRanks: number;
     readonly trained: boolean;
     readonly keyAbility: AbilityId;
     readonly keyAbilityModifier: number;
     readonly synergyBonus: number;
     readonly acpApplied: number;
     readonly modifierBreakdown: StatResolutionBreakdown;
     readonly miscModifier: number;
     readonly totalModifier: number;
   }
   ```
   Add `readonly abilityBreakdowns?: Readonly<Record<AbilityId, DnD35AbilityResolution>> | undefined;` and `readonly saveBreakdowns?: Readonly<Record<SaveType, DnD35SaveResolution>> | undefined;` to `DnD35ResolvedActorStats`.
2. **[`src/rulesets/dnd35e/modifiers/dag_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/modifiers/dag_resolver.ts)**:
   - Populate `abilityBreakdowns` in Stage 2 using `resolveTypedModifiersWithBreakdown(abilityMods, stageContext)` and preserve `rawState` (`inherentBonus`, `damage`, `drain`, `tempPenalty`) on `effectiveAbilities[abId]` while setting `base: effScore`.
   - Populate `saveBreakdowns` in Stage 4 using `resolveTypedModifiersWithBreakdown`.
3. **[`src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts)**:
   - Add `readonly armorCheckPenalty: number;` to `EquippedItemDAGContributions`, summing `itemDef.armorStats.armorCheckPenalty` (with Mithral / Masterwork ACP reduction via `computeMaterialEquipmentStats`, capped at `<= 0`).

### Step 2: Canonical `resolveActorSkillsSnapshot` & Single-Pass DAG Wiring (`skill_synergies.ts`, `dnd35e_dag_adapter.ts`, `level_ledger.ts`)
1. **[`src/rulesets/dnd35e/skills/skill_synergies.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_synergies.ts)**:
   - Implement `resolveActorSkillsSnapshot(params)` computing `Record<string, DnD35SkillResolution>` for all skills in `skillRegistry` (plus any custom keys in `skillRanks`), handling:
     - Bardic Knack floor (`minSkillRanksFloor`),
     - Undead `CON: null -> CHA` substitution for `concentration`,
     - `computeSkillSynergyBonus`,
     - `acpApplied = -Math.abs(armorCheckPenalty) * skillDef.acpMultiplier`,
     - `resolveTypedModifiersWithBreakdown` over `skill:<id>` + `skills` + Fear condition penalty (`shaken`/`frightened`/`panicked` $\rightarrow -2$),
     - `totalModifier = effectiveRanks + keyAbilityModifier + miscModifier`.
   - Update `buildKnowledgeDevotionModifiers` to accept `resolvedSkills?: Readonly<Record<string, DnD35SkillResolution>>` so when called from the DAG it reads `TAKE_10_VALUE + resolvedSkills[skillDef.id].totalModifier` directly!
2. **[`src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts)**:
   - Add `readonly resolvedSkills: Readonly<Record<string, DnD35SkillResolution>>;` and `readonly armorCheckPenalty: number;` to `DnD35EntityDAGResult`.
   - Resolve Stage 2 ability modifiers & `resolvedSkills` first, then evaluate `buildKnowledgeDevotionModifiers` using `resolvedSkills` (replacing any stale `feat:knowledge_devotion/skill:` modifiers in `extraModifiers`), and run `evaluateDnD35ActorStatDAG`.

### Step 3: Evict All Duplicate Skill Calculation Sites (`dnd35e_ui_char_sheet.ts`, `skill_verb_helpers.ts`, `spell_cast_resolver.ts`, `counterspell_interrupt.ts`)
1. **[`src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts)**:
   - Delete `computePassiveSkillModifier`; read `evalResult?.resolvedSkills[skill.id]` (or `resolveActorSkillsSnapshot` when `evalResult` is absent).
2. **[`src/rulesets/dnd35e/skills/skill_verb_helpers.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_verb_helpers.ts)**:
   - In `evaluateActorSkillCheck`, evaluate `evaluateDnD35eEntityDAG(state, actorId)` and pass `dagEval.resolvedSkills[skillId]` / `dagEval.armorCheckPenalty` and `dagEval.statModifiers` into `resolveSkillCheck`.
3. **[`src/rulesets/dnd35e/magic/spell_cast_resolver.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_resolver.ts)**:
   - Replace manual `concRanks + conMod + concSkillMods` with `(casterDag.resolvedSkills['concentration']?.totalModifier ?? 0) + combatCastingBonus`.
4. **[`src/rulesets/dnd35e/magic/counterspell_interrupt.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/counterspell_interrupt.ts)**:
   - Use `candDag.resolvedSkills['spellcraft']` and `candDag.statModifiers` in `evaluateReactiveCounterspellInterrupt`.

### Step 4: Audit Findings 1, 3, 4, & 5 (`dnd35e_spell_cast_ui.ts`, `metamagic_dispel.ts`, `improved_counterspell.json`, `dnd35e_validator.ts`, `dnd35e_ui_hotbar.ts`, `wild_shape.ts`)
1. **Finding 1 ([`src/rendering/ui/dnd35e_spell_cast_ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spell_cast_ui.ts)):**
   - Pass `meta.flags.projectTouch` as the 4th argument to `computeSpellRangeTiles`.
2. **Finding 3 (`metamagic_dispel.ts`, `counterspell_interrupt.ts`, `improved_counterspell.json`):**
   - Add `readonly isUniversalCounterspell?: boolean | undefined;` to `resolveCounterspellAttempt` options (`candSpell?.effectUnits.some((u) => u.type === 'dispel')`).
   - Create `public/data/rulesets/dnd35e/feats/improved_counterspell.json`, add `'improved_counterspell'` to `system_content_feat_ids.ts`, and check `candDag.selfTags.includes('trait:improved_counterspell')` in `counterspell_interrupt.ts`.
3. **Finding 4 ([`src/rulesets/dnd35e/dnd35e_validator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/dnd35e_validator.ts)):**
   - Validate that any feat with `skillCheckCombatBonus` has at least one skill in `sys.skills` matching `skillPrefix` with non-empty `studiedCreatureTags`.
4. **Finding 5 (`dnd35e_ui_hotbar.ts` & `wild_shape.ts`):**
   - Trim both files below 300 non-blank lines so `bun run lint` completes with **0 errors and 0 warnings**.
