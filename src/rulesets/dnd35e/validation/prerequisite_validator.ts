import type { ValidationError } from '../../../types/ruleset.types.ts';
import type { PrerequisiteNode } from '../prerequisites.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/**
 * Recursively validates cross-references inside a `PrerequisiteNode` AST.
 */
export function validatePrerequisiteNodeReferences(
  node: PrerequisiteNode,
  basePath: string,
  sys: DnD35SystemContent,
  errors: ValidationError[]
): void {
  switch (node.type) {
    case 'and':
    case 'or':
      node.children.forEach((child: PrerequisiteNode, idx: number) => {
        validatePrerequisiteNodeReferences(child, `${basePath}.children[${idx}]`, sys, errors);
      });
      return;
    case 'not':
      validatePrerequisiteNodeReferences(node.child, `${basePath}.child`, sys, errors);
      return;
    case 'race_in':
      for (const raceId of node.allowedRaces) {
        if (!sys.races[raceId]) {
          errors.push({
            path: `${basePath}.allowedRaces`,
            message: `Prerequisite references unknown race "${raceId}".`,
            severity: 'error'
          });
        }
      }
      return;
    case 'min_skill_ranks':
      if (!sys.skills[node.skillId]) {
        errors.push({
          path: `${basePath}.skillId`,
          message: `Prerequisite references unknown skill "${node.skillId}".`,
          severity: 'error'
        });
      }
      return;
    case 'min_skill_count_at_ranks': {
      const hasMatchingSkill = Object.keys(sys.skills).some((skId) => skId.startsWith(node.skillPrefix));
      if (Object.keys(sys.skills).length > 0 && !hasMatchingSkill) {
        errors.push({
          path: `${basePath}.skillPrefix`,
          message: `Prerequisite references skillPrefix "${node.skillPrefix}" matching no known skills.`,
          severity: 'error'
        });
      }
      return;
    }
    case 'has_feat': {
      const baseFeatId = node.featId.includes(':') ? node.featId.split(':')[0]! : node.featId;
      if (Object.keys(sys.feats).length > 0 && !sys.feats[node.featId] && !sys.feats[baseFeatId]) {
        errors.push({
          path: `${basePath}.featId`,
          message: `Prerequisite references unknown feat "${node.featId}".`,
          severity: 'error'
        });
      }
      if (node.targetIdsAny && Object.keys(sys.items).length > 0) {
        for (const targetId of node.targetIdsAny) {
          if (!sys.items[targetId] && !sys.skills[targetId]) {
            errors.push({
              path: `${basePath}.targetIdsAny`,
              message: `Prerequisite references unknown target "${targetId}" in targetIdsAny.`,
              severity: 'error'
            });
          }
        }
      }
      return;
    }
    case 'min_class_level':
      if (Object.keys(sys.classes).length > 0 && !sys.classes[node.classId]) {
        errors.push({
          path: `${basePath}.classId`,
          message: `Prerequisite references unknown class "${node.classId}".`,
          severity: 'error'
        });
      }
      return;
    case 'has_proficiency':
      if (node.weaponId !== undefined && Object.keys(sys.items).length > 0 && !sys.items[node.weaponId]) {
        errors.push({
          path: `${basePath}.weaponId`,
          message: `Prerequisite references unknown weapon item "${node.weaponId}".`,
          severity: 'error'
        });
      }
      return;
    case 'min_ability':
    case 'min_bab':
    case 'min_feat_count':
    case 'has_tag':
    case 'min_caster_level':
    case 'min_character_level':
    case 'min_natural_attacks':
    case 'min_hands':
    case 'min_natural_armor':
    case 'min_fly_speed':
    case 'min_sla_caster_level':
    case 'size_in':
    case 'alignment_in':
    case 'min_spell_level':
      return;
  }
}
