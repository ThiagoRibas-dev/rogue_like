import { dndFloor } from './math/multipliers.ts';
import { evaluateProficiencyPrerequisite, hasTargetedFeatInList } from './prerequisite_proficiency.ts';
import type { PrerequisiteEvalContext, PrerequisiteNode, ProficiencyPrerequisiteScope } from './prerequisite_types.ts';

export type { PrerequisiteEvalContext, PrerequisiteNode, ProficiencyPrerequisiteScope };

const FALLBACK_METAMAGIC_CRAFT_FEATS: ReadonlySet<string> = new Set([
  'empower_spell',
  'enlarge_spell',
  'extend_spell',
  'heighten_spell',
  'maximize_spell',
  'quicken_spell',
  'silent_spell',
  'still_spell',
  'widen_spell',
  'brew_potion',
  'craft_magic_arms_and_armor',
  'craft_rod',
  'craft_staff',
  'craft_wand',
  'craft_wondrous_item',
  'forge_ring',
  'scribe_scroll'
]);

/**
 * Evaluates a recursive `PrerequisiteNode` AST against an entity's `PrerequisiteEvalContext`.
 * Note: Nonability scores (`null`) never satisfy a positive `min_ability` requirement.
 */
export function evaluatePrerequisiteAST(node: PrerequisiteNode, context: PrerequisiteEvalContext): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => evaluatePrerequisiteAST(child, context));
    case 'or':
      return node.children.some((child) => evaluatePrerequisiteAST(child, context));
    case 'not':
      return !evaluatePrerequisiteAST(node.child, context);
    case 'min_ability': {
      const score = context.abilityScores[node.ability];
      return score !== null && score >= node.minScore;
    }
    case 'min_bab':
      return context.totalBab >= node.minBab;
    case 'min_skill_ranks': {
      const wholeRanks = dndFloor(context.skillRanks[node.skillId] ?? 0);
      return wholeRanks >= node.minRanks;
    }
    case 'min_skill_count_at_ranks': {
      let matchingCount = 0;
      for (const [skillId, rawRanks] of Object.entries(context.skillRanks)) {
        if (skillId.startsWith(node.skillPrefix) && dndFloor(rawRanks) >= node.minRanks) {
          matchingCount++;
        }
      }
      return matchingCount >= node.minCount;
    }
    case 'has_feat': {
      if (node.featId.includes(':') || node.targetId !== undefined) {
        const parts = node.featId.split(':');
        const reqTarget = node.targetId ?? parts[1];
        if (reqTarget !== undefined) return hasTargetedFeatInList(context.feats, parts[0]!, reqTarget);
      }
      if (node.targetIdsAny !== undefined && node.targetIdsAny.length > 0) {
        return node.targetIdsAny.some((t) => hasTargetedFeatInList(context.feats, node.featId, t));
      }
      if (node.targetPrefix !== undefined) {
        const colonPrefix = `${node.featId}:${node.targetPrefix}`;
        const underscorePrefix = `${node.featId}_${node.targetPrefix}`;
        return context.feats.some((f) => f.startsWith(colonPrefix) || f.startsWith(underscorePrefix));
      }
      if (context.targetId !== undefined) {
        return (
          hasTargetedFeatInList(context.feats, node.featId, context.targetId) || context.feats.includes(node.featId)
        );
      }
      if (context.feats.includes(node.featId)) return true;
      return context.feats.some((f) => f.startsWith(`${node.featId}:`) || f.startsWith(`${node.featId}_`));
    }
    case 'min_feat_count': {
      if (context.metamagicOrItemCreationFeatCount !== undefined) {
        return context.metamagicOrItemCreationFeatCount >= node.minCount;
      }
      const count = context.feats.filter((f) => FALLBACK_METAMAGIC_CRAFT_FEATS.has(f.split(':')[0]!)).length;
      return count >= node.minCount;
    }
    case 'has_tag':
      return context.tags.includes(node.tag);
    case 'min_caster_level':
      return context.casterLevel >= node.minCasterLevel;
    case 'min_class_level':
      return (context.classLevels?.[node.classId] ?? 0) >= node.minLevel;
    case 'min_character_level':
      return (context.characterLevel ?? 1) >= node.minLevel;
    case 'has_proficiency':
      return evaluateProficiencyPrerequisite(node, context);
    case 'min_natural_attacks':
      return (context.naturalAttackCount ?? 0) >= node.minCount;
    case 'min_hands':
      return (context.handCount ?? 2) >= node.minHands;
    case 'min_natural_armor':
      return (context.naturalArmorBonus ?? 0) >= node.minBonus;
    case 'min_fly_speed':
      return (context.flySpeedFt ?? 0) >= node.minSpeedFt || context.tags.includes('movement:fly');
    case 'min_sla_caster_level':
      return (context.maxSlaCasterLevel ?? 0) >= node.minCasterLevel;
    case 'size_in':
      return node.allowedSizes.includes(context.sizeCategory);
    case 'alignment_in':
      return context.alignment !== undefined && node.allowedAlignments.includes(context.alignment);
    case 'min_spell_level': {
      if (node.school !== undefined) {
        const schoolMaxLevel = context.maxSpellLevelBySchool?.[node.school] ?? -1;
        if (schoolMaxLevel < node.minSpellLevel) return false;
        if (
          node.minSchoolSpellCount !== undefined &&
          (context.spellCountBySchool?.[node.school] ?? 0) < node.minSchoolSpellCount
        ) {
          return false;
        }
      }
      const mode = node.castingMode ?? 'any';
      if (mode === 'spontaneous') {
        const spA = context.maxSpontaneousArcaneSpellLevel ?? -1;
        const spD = context.maxSpontaneousDivineSpellLevel ?? -1;
        return (
          (node.tradition === 'arcane' ? spA : node.tradition === 'divine' ? spD : Math.max(spA, spD)) >=
          node.minSpellLevel
        );
      }
      if (mode === 'prepared') {
        const prA = context.maxPreparedArcaneSpellLevel ?? -1;
        const prD = context.maxPreparedDivineSpellLevel ?? -1;
        return (
          (node.tradition === 'arcane' ? prA : node.tradition === 'divine' ? prD : Math.max(prA, prD)) >=
          node.minSpellLevel
        );
      }
      const aMax = context.maxArcaneSpellLevel ?? -1;
      const dMax = context.maxDivineSpellLevel ?? -1;
      return (
        (node.tradition === 'arcane' ? aMax : node.tradition === 'divine' ? dMax : Math.max(aMax, dMax)) >=
        node.minSpellLevel
      );
    }
    case 'race_in':
      return context.raceId !== undefined && node.allowedRaces.includes(context.raceId);
  }
}
