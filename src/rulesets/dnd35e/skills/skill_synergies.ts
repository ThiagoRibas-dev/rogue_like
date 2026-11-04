import { dndFloor } from '../math/multipliers.ts';
import { appendSourcePath } from '../modifiers.ts';
import { evaluateEffectBundle } from '../srd_registry.ts';
import type { StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SkillDefinition } from '../types/dnd35e_system.types.ts';
import {
  CLASS_SKILL_RANK_CAP_OFFSET,
  EPIC_SYNERGY_INITIAL_RANKS,
  EPIC_SYNERGY_INTERVAL_RANKS,
  SYNERGY_BONUS_AMOUNT,
  SYNERGY_REQUIRED_RANKS
} from './skill_constants.ts';

/**
 * Computes maximum allowed skill ranks for a class skill (`HD + 3`) vs. cross-class skill (`(HD + 3) / 2`).
 *
 * @param totalHD Entity's total Hit Dice ($\ge 1$).
 * @param isClassSkill True if the skill is a class skill for any of the entity's classes.
 * @returns Maximum rank cap (`number`, allowing `.5` for cross-class).
 */
export function computeMaxSkillRankCap(totalHD: number, isClassSkill: boolean): number {
  const maxClassRanks = Math.max(1, dndFloor(totalHD)) + CLASS_SKILL_RANK_CAP_OFFSET;
  return isClassSkill ? maxClassRanks : maxClassRanks / 2;
}

/**
 * Computes the total untyped Synergy bonus (`+2` per qualifying source skill with $\lfloor \text{ranks} \rfloor \ge 5$).
 *
 * @param synergyFromSkills List of source skill IDs that grant synergy to this check.
 * @param allSkillRanks Entity's skill rank map.
 * @returns Total synergy bonus ($\ge 0$).
 */
export function computeSkillSynergyBonus(
  synergyFromSkills: ReadonlyArray<string>,
  allSkillRanks: Readonly<Record<string, number>>
): number {
  let bonus = 0;
  for (const sourceSkillId of synergyFromSkills) {
    const raw = allSkillRanks[sourceSkillId] ?? 0;
    const whole = dndFloor(raw);
    if (whole >= SYNERGY_REQUIRED_RANKS) {
      bonus += SYNERGY_BONUS_AMOUNT;
      if (whole >= EPIC_SYNERGY_INITIAL_RANKS) {
        bonus += Math.floor((whole - SYNERGY_REQUIRED_RANKS) / EPIC_SYNERGY_INTERVAL_RANKS) * SYNERGY_BONUS_AMOUNT;
      }
    }
  }
  return bonus;
}

/**
 * Finds all skills in a skill registry that receive a synergy bonus from the specified source skill.
 * @param sourceSkillId The source skill providing synergy.
 * @param skillRegistry Loaded skill definitions map.
 * @returns List of target skill IDs that list sourceSkillId in their synergyFromSkills.
 */
export function getSkillsGrantedSynergyBy(
  sourceSkillId: string,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<string> {
  const results: string[] = [];
  for (const [targetId, def] of Object.entries(skillRegistry)) {
    if (def.synergyFromSkills.includes(sourceSkillId)) {
      results.push(targetId);
    }
  }
  return results;
}

/**
 * Builds passive/conditional StatModifiers unlocked by skill rank thresholds (e.g. 5+ ranks in Tumble
 * granting +1 dodge AC when fighting defensively or using total defense).
 *
 * @param allSkillRanks Entity's skill rank map.
 * @param skillRegistry Loaded D&D 3.5e skill definitions.
 * @returns Array of unlocked `StatModifier` entries with `sourcePath: "skill:<id>/threshold:<minRanks>/<modId>"`.
 */
export function buildSkillRankThresholdModifiers(
  allSkillRanks: Readonly<Record<string, number>>,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];
  for (const [skillId, rawRanks] of Object.entries(allSkillRanks)) {
    const wholeRanks = dndFloor(Math.max(0, rawRanks));
    if (wholeRanks < 1) continue;
    const skillDef = skillRegistry[skillId];
    if (!skillDef || skillDef.rankThresholdModifiers.length === 0) continue;
    for (const entry of skillDef.rankThresholdModifiers) {
      if (wholeRanks < entry.minRanks) continue;
      const rootPath = appendSourcePath(`skill:${skillDef.id}`, `threshold:${entry.minRanks}`);
      for (const mod of entry.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `skill:${skillDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(rootPath, mod.id),
          origin: 'ex',
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
      if (entry.effectBundle) {
        const evalResult = evaluateEffectBundle(entry.effectBundle, rootPath);
        modifiers.push(...evalResult.statModifiers);
      }
    }
  }
  return modifiers;
}

/**
 * Result of evaluating unlocked skill rank threshold effects across all skills.
 */
export interface SkillRankThresholdEffectsResult {
  readonly statModifiers: ReadonlyArray<StatModifier>;
  readonly grantedTags: ReadonlyArray<string>;
}

/**
 * Evaluates all unlocked passive stat modifiers and semantic tags granted by skill rank thresholds
 * (e.g., 5 ranks in Balance granting "trait:balance_uncanny_flat_footed", 5 ranks in Tumble granting "trait:tumble_acrobatic_defense").
 *
 * @param allSkillRanks Entity's skill rank map.
 * @param skillRegistry Loaded D&D 3.5e skill definitions.
 * @returns Combined modifiers and grantedTags.
 */
export function evaluateSkillRankThresholdEffects(
  allSkillRanks: Readonly<Record<string, number>>,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): SkillRankThresholdEffectsResult {
  const statModifiers = buildSkillRankThresholdModifiers(allSkillRanks, skillRegistry);
  const grantedTags = new Set<string>();

  for (const [skillId, rawRanks] of Object.entries(allSkillRanks)) {
    const wholeRanks = dndFloor(Math.max(0, rawRanks));
    if (wholeRanks < 1) continue;
    const skillDef = skillRegistry[skillId];
    if (!skillDef) continue;

    for (const entry of skillDef.rankThresholdModifiers) {
      if (wholeRanks < entry.minRanks) continue;
      for (const tag of entry.grantedTags ?? []) {
        grantedTags.add(tag);
      }
      if (entry.effectBundle) {
        const rootPath = appendSourcePath(`skill:${skillDef.id}`, `threshold:${entry.minRanks}`);
        const evalResult = evaluateEffectBundle(entry.effectBundle, rootPath);
        for (const tag of evalResult.grantedTags) {
          grantedTags.add(tag);
        }
      }
    }
  }

  return {
    statModifiers,
    grantedTags: Array.from(grantedTags)
  };
}
