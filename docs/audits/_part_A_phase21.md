# Audit Part A - Phase 21 (M102-M105)

> Scope note: partial, evidence-limited audit. Tool output limits and context pressure allowed only targeted greps/sed. Items marked (verify) need a follow-up read.

## Summary
- Clean: no `any`, `Math.random`, `Date.now`, TODO/FIXME/stub text, or `Map`/`Set` in `components.types.ts` across the scoped files.
- Main problems: file size limits, magic literals in baseline resolvers, and flag-style feat special-casing (Multiattack, Improved Maneuver) in baseline code.

## Gaps/Misses
| # | Sev | Location | Evidence | Recommendation |
|---|-----|----------|----------|----------------|
| 1 | High | src/rulesets/dnd35e/combat/attack_resolver.ts:~262-265 | `else if (options.hasMultiattackFeat === true) natPenalty = MULTIATTACK_SECONDARY_PENALTY` | Remove feat flag; feats must supply `overrides.secondaryNaturalPenalty` (AGENTS rule 17). |
| 2 | High | combat/maneuvers_conditions.ts:116 | `params.hasImprovedManeuverFeat === true ? 4 : 0` | Move to `overrides.opposedBonus`; delete flag and literal 4. |
| 3 | High | combat/attack_resolver.ts:~341-354 | TWF penalties inline: `-2 : -4`, `-4 : -6`, `-8 : -10` | Named constants/table; feats (TWF, Improved TWF, Ambidexterity) as modifiers. |
| 4 | Med | combat/maneuvers_conditions.ts:250-275 | Condition penalties inline (`acPenalty -= 2`, `Math.max(dexPenalty, 4)`, `6`, etc.) | Data-driven condition table in JSON/constants. |
| 5 | Med | combat/attack_resolver.ts:~363 | `Math.max(1, options.totalBab - offHandBabPenalty)` magic 1 and clamps BAB | Name constant; verify SRD (off-hand extra attacks need Improved/Greater TWF, not BAB-derived). |
| 6 | Med | combat/maneuvers_conditions.ts:6-7 | `SINGLE_LIMB_IMPROVED_GRAB_PENALTY = -20` hardcoded; grapple resolution uses `singleLimbImprovedGrab` flag | Verify SRD: -20 applies to grapple check when not holding with whole body; make it a modifier. |
| 7 | Low | maneuvers_conditions.ts:~111-115 | Opposed mods for trip exclude BAB, include for grapple/disarm/sunder | Matches SRD, but untested for size/stability edge cases (verify). |

## Rule-correctness issues
- Multiattack secondary natural -2 and default -5 match SRD, but implemented via feat flag (see Gap 1).
- Conditions: dazzled -1 attack, entangled -2 attack/-4 Dex, fatigued -2 Str/Dex, blinded -2 AC: consistent with SRD. Exhausted -6 matches. Verify: blinded also -50% speed, entangled caster concentration check (not found in scoped greps).
- Natural attacks: sources separate primary/secondary; verify single natural attack gets 1.5x Str only when sole attack and iterative BAB are not applied to naturals.
- DR, Dispel/Counterspell, Concentration DCs, size-scaled weapon dice, material stats: not verified in this pass; follow-up reading of spellcasting.ts and equipment_physics.ts required.

## AGENTS.md compliance violations
- Files over ~250 lines (wc -l): ecs.ts 824; inventory.system.ts 422; reaction.system.ts 321; components.types.ts 754; action_economy.ts 323; equipment_physics.ts 429; wild_shape.ts 272; modifiers.ts 1186; progression.ts 441; attack_resolver.ts 640; maneuvers_conditions.ts 306; spellcasting.ts 500; dnd35e_phase21_primitives.test.ts 667.
- Magic values: see Gaps 2-5.
- Static definitions (interfaces) co-located in logic files: attack_resolver.ts:24,44,192,204,214 and maneuvers_conditions.ts:23,43 (AGENTS section 8).
- Rule 17: baseline resolvers carry feat-specific flags (Gaps 1, 2).
- Compliant: no `any`, no Math.random/Date.now, no Map/Set in components.

## Test coverage gaps
- Single 667-line test file for four milestones; likely lacks per-feature isolation (verify).
- Negative paths (invalid overrides, zero natural limbs, size extremes) unverified.
- Condition stacking (`Math.max` for stat penalties) lacks tests (verify).

## Improvement suggestions
- Split oversized files by concern (resolvers, constants, types).
- Replace feat flags with a single `CombatRuleOverrides` channel; extend with `opposedBonus`, `secondaryNaturalPenalty`, TWF fields (partly present).
- Move condition penalty table to `src/constants` or JSON.
- Add property tests for iterative attack sequences (BAB 6/11/16 -> +5 steps).
- Complete the unverified portions (DR, dispel, concentration, size dice, materials, field/minion performance).
