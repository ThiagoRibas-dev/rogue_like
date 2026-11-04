import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';
import { getDnD35Archetype } from './archetype_resolver.ts';
import { type DnD35SystemContent, DnD35SystemContentSchema } from './types/dnd35e_system.types.ts';
import {
  validateDnD35eClassesRacesTemplates,
  validatePrerequisiteNodeReferences
} from './validation/class_race_validator.ts';

export * from './validation/class_race_validator.ts';

/**
 * Validates inner ID parity and structural/referential integrity across parsed `DnD35SystemContent`.
 *
 * @param sys The parsed `DnD35SystemContent` object.
 * @returns Array of validation errors.
 */
export function validateDnD35eSystemContentIntegrity(
  sys: Readonly<DnD35SystemContent>
): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  validateDnD35eClassesRacesTemplates(sys, errors);

  // 6. Validate Feats, Spells, Skills, CreatureTypes & Subtypes: ID parity & Prerequisite AST
  for (const [featKey, featDef] of Object.entries(sys.feats)) {
    if (featDef.id !== featKey) {
      errors.push({
        path: `systemContent.feats.${featKey}.id`,
        message: `Feat key "${featKey}" does not match inner id "${featDef.id}".`,
        severity: 'error'
      });
    }
    if (featDef.prerequisites) {
      validatePrerequisiteNodeReferences(
        featDef.prerequisites,
        `systemContent.feats.${featKey}.prerequisites`,
        sys,
        errors
      );
    }
  }

  for (const [spellKey, spellDef] of Object.entries(sys.spells)) {
    if (spellDef.id !== spellKey) {
      errors.push({
        path: `systemContent.spells.${spellKey}.id`,
        message: `Spell key "${spellKey}" does not match inner id "${spellDef.id}".`,
        severity: 'error'
      });
    }
    for (const classId of Object.keys(spellDef.levelByClass)) {
      if (!sys.classes[classId]) {
        errors.push({
          path: `systemContent.spells.${spellKey}.levelByClass.${classId}`,
          message: `Spell "${spellKey}" references unknown class "${classId}" in levelByClass.`,
          severity: 'error'
        });
      }
    }
    for (const domId of Object.keys(spellDef.levelByDomain)) {
      if (!sys.domains[domId]) {
        errors.push({
          path: `systemContent.spells.${spellKey}.levelByDomain.${domId}`,
          message: `Spell "${spellKey}" references unknown domain "${domId}" in levelByDomain.`,
          severity: 'error'
        });
      }
    }
  }

  for (const [skillKey, skillDef] of Object.entries(sys.skills)) {
    if (skillDef.id !== skillKey) {
      errors.push({
        path: `systemContent.skills.${skillKey}.id`,
        message: `Skill key "${skillKey}" does not match inner id "${skillDef.id}".`,
        severity: 'error'
      });
    }
    for (const synSkillId of skillDef.synergyFromSkills) {
      if (!sys.skills[synSkillId]) {
        errors.push({
          path: `systemContent.skills.${skillKey}.synergyFromSkills`,
          message: `Skill "${skillKey}" references unknown synergy source skill "${synSkillId}".`,
          severity: 'error'
        });
      }
    }
    for (const action of skillDef.actions) {
      if (action.opposedBySkill && !sys.skills[action.opposedBySkill]) {
        errors.push({
          path: `systemContent.skills.${skillKey}.actions.${action.actionId}.opposedBySkill`,
          message: `Skill "${skillKey}" action "${action.actionId}" references unknown opposedBySkill "${action.opposedBySkill}".`,
          severity: 'error'
        });
      }
    }
  }

  for (const [ctKey, ctDef] of Object.entries(sys.creatureTypes)) {
    if (ctDef.typeId !== ctKey) {
      errors.push({
        path: `systemContent.creatureTypes.${ctKey}.typeId`,
        message: `CreatureType key "${ctKey}" does not match inner typeId "${ctDef.typeId}".`,
        severity: 'error'
      });
    }
  }

  for (const [subKey, subDef] of Object.entries(sys.subtypes)) {
    if (subDef.subtypeId !== subKey) {
      errors.push({
        path: `systemContent.subtypes.${subKey}.subtypeId`,
        message: `Subtype key "${subKey}" does not match inner subtypeId "${subDef.subtypeId}".`,
        severity: 'error'
      });
    }
  }

  return errors;
}

/**
 * Validates a D&D 3.5e campaign and its hydrated System Content registries.
 *
 * @param campaign The campaign document being validated.
 * @returns Array of ruleset-specific validation errors or warnings.
 */
export function checkDnD35eRuleset(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];
  if (!campaign.systemContent) {
    errors.push({
      path: 'campaign.systemContent',
      message: 'D&D 3.5e campaign requires systemContent (loaded from public/data/rulesets/dnd35e/)',
      severity: 'error'
    });
    return errors;
  }

  const parseRes = DnD35SystemContentSchema.safeParse(campaign.systemContent);
  if (!parseRes.success) {
    for (const issue of parseRes.error.issues) {
      errors.push({
        path: `systemContent.${issue.path.join('.')}`,
        message: issue.message,
        severity: 'error'
      });
    }
    return errors;
  }

  const sys = parseRes.data;
  errors.push(...validateDnD35eSystemContentIntegrity(sys));

  for (const [entityId, entity] of Object.entries(campaign.entities)) {
    if (entity.archetypeId && !getDnD35Archetype(sys, entity.archetypeId)) {
      errors.push({
        path: `entities.${entityId}.archetypeId`,
        message: `Entity template "${entityId}" references unknown system archetype "${entity.archetypeId}"`,
        severity: 'error'
      });
    }
  }

  return errors;
}
