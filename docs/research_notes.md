# Research Notes — Unified Entity Stat & Skill Breakdown Registry + Audit Fixes

## 1. Architectural Problem Statement (`AGENTS.md` Rules 15, 17, 19, 20, 21)
During our post-implementation audit, we discovered that while **AC**, **Saves**, and **Attack/Damage** resolve through [`evaluateDnD35ActorStatDAG`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/modifiers/dag_resolver.ts#L36), **Skills** and **sub-stat breakdowns** were still being manually recalculated across **6 separate call sites**—each omitting part of the canonical D&D 3.5e formula:

| Call Site | What It Manually Recalculated | What It Missed / Got Wrong |
| :--- | :--- | :--- |
| 1. [`dnd35e_ui_char_sheet.ts` (`computePassiveSkillModifier`)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts#L91-L129) | Loops over `statModifiers` with `+= mod.value`, manually checks `shaken`/`frightened`/`panicked`, and manually computes 5-rank synergies (missing epic 25-rank synergies). | Bypasses 18-type bonus stacking (`resolveTypedModifiersWithBreakdown`), ignores `armorCheckPenalty` (`acpMultiplier`), and reads `dndData.statModifiers` instead of DAG `extraModifiers` (missing equipped item and aura skill bonuses). |
| 2. [`spell_cast_resolver.ts` (Concentration check)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/spell_cast_resolver.ts#L148-L160) | Manually sums `concRanks + conMod + concSkillMods.reduce((sum, m) => sum + m.value, 0)`. | Bypasses 18-type bonus stacking, ignores Bardic Knack floor, ignores Fear (`-2`) penalty, ignores equipped item/aura `skill:concentration` bonuses, and ignores Undead `CON: null -> CHA` concentration substitution. |
| 3. [`counterspell_interrupt.ts` (Spellcraft check)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/counterspell_interrupt.ts#L171-L198) | Manually extracts `rawRanks`, `intMod`, and `dndData.statModifiers`. | Ignores equipped item/aura `skill:spellcraft` bonuses, Bardic Knack floor, and Fear (`-2`) penalty. |
| 4. [`skill_verb_helpers.ts` (`evaluateActorSkillCheck`)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_verb_helpers.ts#L154-L253) | Calls `evaluateDnD35ActorStatDAG` directly instead of `evaluateDnD35eEntityDAG` and hardcodes `armorCheckPenalty: 0`. | Misses equipped item modifiers (e.g. *Cloak of Elvenkind*, *Thieves' Tools*, *Headband of Intellect*), active spell auras, and equipped Armor/Shield Check Penalty. |
| 5. [`skill_synergies.ts` (`buildKnowledgeDevotionModifiers`)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/skills/skill_synergies.ts#L169-L217) | Manually computes `computeAbilityModifier(abilityScores[key].base) + synergy`. | Ignores `inherentBonus`, ability `damage`/`drain`/`tempPenalty`, enhancement bonuses (*Fox's Cunning*), Bardic Knack floor, `skill:knowledge_*` bonuses (*Skill Focus*), and Fear penalties. |
| 6. [`dag_resolver.ts` (`effectiveAbilities`)](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/modifiers/dag_resolver.ts#L85-L91) | Overwrites `.base` with `effScore` and zeroes out `inherentBonus`, `damage`, `drain`, `tempPenalty`. | Loses the structured breakdown between base score, individual typed modifiers (`StatResolutionBreakdown`), damage/drain/penalties, and final score. |

---

## 2. Canonical Solution: Unified Entity Stat & Skill Breakdown Registry

### 2.1 Structured Breakdowns on `DnD35ResolvedActorStats` & `DnD35EntityDAGResult`
1. **`DnD35AbilityResolution` (`abilityBreakdowns: Readonly<Record<AbilityId, DnD35AbilityResolution>>` on `DnD35ResolvedActorStats`):**
   - `abilityId: AbilityId`
   - `rawState: AbilityScoreState` (`base`, `inherentBonus`, `damage`, `drain`, `tempPenalty`)
   - `modifierBreakdown: StatResolutionBreakdown` (resolved via `resolveTypedModifiersWithBreakdown` on Stage 2 ability modifiers)
   - `effectiveScore: number | null`
   - `effectiveModifier: number`
2. **`DnD35SaveResolution` (`saveBreakdowns: Readonly<Record<SaveType, DnD35SaveResolution>>` on `DnD35ResolvedActorStats`):**
   - `saveType: SaveType`
   - `baseSave: number`
   - `abilityId: AbilityId` (`'con'` / `'dex'` / `'wis'`, or `'cha'` when `con.base === null` and `affectsObjects`)
   - `abilityModifier: number`
   - `modifierBreakdown: StatResolutionBreakdown`
   - `total: number`
3. **`DnD35SkillResolution` (`resolvedSkills: Readonly<Record<string, DnD35SkillResolution>>` on `DnD35EntityDAGResult`):**
   - `skillId: string`
   - `rawRanks: number`
   - `effectiveRanks: number` ($\lfloor \max(\text{rawRanks}, \text{bardicKnackFloor}) \rfloor$)
   - `trained: boolean` ($\text{effectiveRanks} \ge 1$)
   - `keyAbility: AbilityId` (substituting `'cha'` for `'concentration'` when `con.base === null`)
   - `keyAbilityModifier: number` (from Stage 2 `effectiveAbilityModifiers`)
   - `synergyBonus: number` (from `computeSkillSynergyBonus`)
   - `acpApplied: number` ($-\lvert \text{armorCheckPenalty} \rvert \times \text{acpMultiplier}$)
   - `modifierBreakdown: StatResolutionBreakdown` (from `resolveTypedModifiersWithBreakdown` over `skill:<id>` + `skills` + Fear penalty)
   - `miscModifier: number` (`synergyBonus + modifierBreakdown.total + acpApplied`)
   - `totalModifier: number` (`effectiveRanks + keyAbilityModifier + miscModifier`)

### 2.2 Single-Pass Topological Evaluation Order in `evaluateDnD35eEntityDAG`
1. Collect equipped item contributions (`collectEquippedItemDAGContributions`, now also computing total `armorCheckPenalty` across worn armor/shields with Mithral/Masterwork reductions), active spell auras, tactical doctrine modifiers, condition penalties (`condSummary.skillPenalty` for `shaken`/`frightened`/`panicked`), feat modifiers, and skill rank threshold modifiers.
2. Run **Stage 1 (Size)** & **Stage 2 (Abilities)** to obtain `effectiveAbilityModifiers` and `abilityBreakdowns`.
3. Run **Stage 2.5 (`resolveActorSkillsSnapshot`)** to compute `resolvedSkills` for all skills in `sysContent.skills` (plus any custom rank keys on `dndData.skillRanks`) in a single canonical pass.
4. Run **Stage 2.6 (`buildKnowledgeDevotionModifiers`)** reading `resolvedSkills[skillDef.id]` (`TAKE_10_VALUE + skillRes.totalModifier`) directly—zero duplicate ability, synergy, or skill math!
5. Run **Stage 3 & 4** (`evaluateDnD35ActorStatDAG` + `resolveActorAttackRoutine`) with the emitted *Knowledge Devotion* modifiers included in `extraModifiers`.

---

## 3. Additional Audit Findings (Findings 1, 3, 4, 5)
- **Finding 1 (UI Targeting Range with *Reach Spell*):** [`dnd35e_spell_cast_ui.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rendering/ui/dnd35e_spell_cast_ui.ts#L97) must pass `meta.flags.projectTouch` to `computeSpellRangeTiles`.
- **Finding 3 (Declarative Counterspelling & `improved_counterspell.json`):**
  - Replace hardcoded `slot.preparedSpellId.includes('dispel')` and `reactorSpell === 'dispel_magic' || reactorSpell === 'greater_dispel_magic'` with a declarative `isUniversalCounterspell` check (`candSpell?.effectUnits.some((u) => u.type === 'dispel')`).
  - Create `public/data/rulesets/dnd35e/feats/improved_counterspell.json` granting `effectBundle.grantedTags: ["trait:improved_counterspell"]` and `ruleOverrides: [{ id: "improved_counterspell_school", ruleKey: "counterspell_same_school_higher_level", value: true }]`, and check `candDag.selfTags.includes('trait:improved_counterspell')` in [`counterspell_interrupt.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/magic/counterspell_interrupt.ts).
- **Finding 4 (Validator Coverage):** Update [`dnd35e_validator.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/dnd35e_validator.ts) to validate `featDef.skillCheckCombatBonus` (`skillPrefix` matches at least one skill with `studiedCreatureTags`).
- **Finding 5 (File Length Cleanup):** Compact [`dnd35e_ui_hotbar.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts) and [`wild_shape.ts`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/src/rulesets/dnd35e/wild_shape.ts) under 300 non-blank lines so `bun run lint` has 0 warnings.
