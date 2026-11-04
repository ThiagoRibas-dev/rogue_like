import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';
import type { PrerequisiteNode } from './prerequisites.ts';
import { getDnD35Archetype } from './archetype_resolver.ts';
import { DnD35SystemContentSchema, type DnD35SystemContent } from './types/dnd35e_system.types.ts';

/**
 * Recursively validates cross-references inside a `PrerequisiteNode` AST.
 *
 * @param node The prerequisite AST node to inspect.
 * @param basePath The diagnostic path prefix.
 * @param sys The validated D&D 3.5e system content.
 * @param errors Accumulator array for validation errors.
 */
function validatePrerequisiteNodeReferences(
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
    case 'min_ability':
    case 'min_bab':
    case 'has_feat':
    case 'has_tag':
    case 'min_caster_level':
    case 'size_in':
    case 'alignment_in':
    case 'min_spell_level':
      return;
  }
}

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

  // 1. Validate Classes: ID parity, 1..maxLevel progression table continuity, monotonicity, ACFs, prerequisites
  for (const [classKey, classDef] of Object.entries(sys.classes)) {
    if (classDef.id !== classKey) {
      errors.push({
        path: `systemContent.classes.${classKey}.id`,
        message: `Class key "${classKey}" does not match inner id "${classDef.id}".`,
        severity: 'error'
      });
    }
    if (classDef.progression.length !== classDef.maxLevel) {
      errors.push({
        path: `systemContent.classes.${classKey}.progression`,
        message: `Class "${classKey}" progression length (${classDef.progression.length}) must equal maxLevel (${classDef.maxLevel}).`,
        severity: 'error'
      });
    }
    const grantedFeatures = new Set<string>();
    for (let i = 0; i < classDef.progression.length; i++) {
      const row = classDef.progression[i]!;
      const expectedLevel = i + 1;
      if (row.level !== expectedLevel) {
        errors.push({
          path: `systemContent.classes.${classKey}.progression[${i}].level`,
          message: `Class "${classKey}" progression row at index ${i} must have level ${expectedLevel} (got ${row.level}).`,
          severity: 'error'
        });
      }
      if (i > 0) {
        const prev = classDef.progression[i - 1]!;
        if (
          row.bab < prev.bab ||
          row.fortSave < prev.fortSave ||
          row.refSave < prev.refSave ||
          row.willSave < prev.willSave
        ) {
          errors.push({
            path: `systemContent.classes.${classKey}.progression[${i}]`,
            message: `Class "${classKey}" level ${row.level} has decreasing BAB or base save compared to level ${prev.level}.`,
            severity: 'error'
          });
        }
      }
      for (const feat of row.features) {
        grantedFeatures.add(feat);
      }
    }

    for (const acf of classDef.acfSwaps) {
      if (acf.level < 1 || acf.level > classDef.maxLevel) {
        errors.push({
          path: `systemContent.classes.${classKey}.acfSwaps.${acf.acfId}.level`,
          message: `ACF "${acf.acfId}" on class "${classKey}" has level ${acf.level} outside 1..${classDef.maxLevel}.`,
          severity: 'error'
        });
      }
      if (!grantedFeatures.has(acf.replacesFeature)) {
        errors.push({
          path: `systemContent.classes.${classKey}.acfSwaps.${acf.acfId}.replacesFeature`,
          message: `ACF "${acf.acfId}" on class "${classKey}" replaces feature "${acf.replacesFeature}" which is never granted in progression.`,
          severity: 'error'
        });
      }
    }

    if (classDef.prerequisites) {
      validatePrerequisiteNodeReferences(
        classDef.prerequisites,
        `systemContent.classes.${classKey}.prerequisites`,
        sys,
        errors
      );
    }

    for (const skillId of classDef.classSkills) {
      if (skillId !== 'all' && !sys.skills[skillId]) {
        errors.push({
          path: `systemContent.classes.${classKey}.classSkills`,
          message: `Class "${classKey}" references unknown classSkill "${skillId}".`,
          severity: 'error'
        });
      }
    }
  }

  // 2. Validate Domains: ID parity & classSkillsAdded
  for (const [domKey, domDef] of Object.entries(sys.domains)) {
    if (domDef.id !== domKey) {
      errors.push({
        path: `systemContent.domains.${domKey}.id`,
        message: `Domain key "${domKey}" does not match inner id "${domDef.id}".`,
        severity: 'error'
      });
    }
    for (const skillId of domDef.classSkillsAdded) {
      if (!sys.skills[skillId]) {
        errors.push({
          path: `systemContent.domains.${domKey}.classSkillsAdded`,
          message: `Domain "${domKey}" references unknown skill "${skillId}" in classSkillsAdded.`,
          severity: 'error'
        });
      }
    }
  }

  // 3. Validate Races: ID parity, favoredClass reference, creatureType reference, defaultClassLevels, rhdProgression tiers
  for (const [raceKey, raceDef] of Object.entries(sys.races)) {
    if (raceDef.id !== raceKey) {
      errors.push({
        path: `systemContent.races.${raceKey}.id`,
        message: `Race key "${raceKey}" does not match inner id "${raceDef.id}".`,
        severity: 'error'
      });
    }
    if (raceDef.favoredClass !== 'any' && !sys.classes[raceDef.favoredClass]) {
      errors.push({
        path: `systemContent.races.${raceKey}.favoredClass`,
        message: `Race "${raceKey}" references unknown favoredClass "${raceDef.favoredClass}".`,
        severity: 'error'
      });
    }
    if (!sys.creatureTypes[raceDef.creatureType]) {
      errors.push({
        path: `systemContent.races.${raceKey}.creatureType`,
        message: `Race "${raceKey}" references unknown creatureType "${raceDef.creatureType}".`,
        severity: 'error'
      });
    }
    for (const cl of raceDef.defaultClassLevels) {
      if (!sys.classes[cl.classId]) {
        errors.push({
          path: `systemContent.races.${raceKey}.defaultClassLevels`,
          message: `Race "${raceKey}" references unknown class "${cl.classId}" in defaultClassLevels.`,
          severity: 'error'
        });
      }
    }
    const tiers = raceDef.rhdProgression?.tiers ?? [];
    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i]!;
      if (tier.tierIndex !== i + 1) {
        errors.push({
          path: `systemContent.races.${raceKey}.rhdProgression.tiers[${i}].tierIndex`,
          message: `Race "${raceKey}" progression tier at index ${i} must have tierIndex ${i + 1} (got ${tier.tierIndex}).`,
          severity: 'error'
        });
      }
    }
  }

  // 4. Validate Templates: ID parity, targetCreatureTypes & convertTypeMap references
  for (const [tmplKey, tmplDef] of Object.entries(sys.templates)) {
    if (tmplDef.templateId !== tmplKey) {
      errors.push({
        path: `systemContent.templates.${tmplKey}.templateId`,
        message: `Template key "${tmplKey}" does not match inner templateId "${tmplDef.templateId}".`,
        severity: 'error'
      });
    }
    for (const ct of tmplDef.targetCreatureTypes ?? []) {
      if (!sys.creatureTypes[ct]) {
        errors.push({
          path: `systemContent.templates.${tmplKey}.targetCreatureTypes`,
          message: `Template "${tmplKey}" references unknown targetCreatureType "${ct}".`,
          severity: 'error'
        });
      }
    }
    for (const [fromType, toType] of Object.entries(tmplDef.convertTypeMap ?? {})) {
      if (!sys.creatureTypes[fromType] || !sys.creatureTypes[toType]) {
        errors.push({
          path: `systemContent.templates.${tmplKey}.convertTypeMap`,
          message: `Template "${tmplKey}" convertTypeMap references unknown creatureType (${fromType} -> ${toType}).`,
          severity: 'error'
        });
      }
    }
  }

  // 5. Validate Archetypes (legacy/optional): ID parity, creatureType reference
  for (const [archKey, archDef] of Object.entries(sys.archetypes)) {
    if (archDef.archetypeId !== archKey) {
      errors.push({
        path: `systemContent.archetypes.${archKey}.archetypeId`,
        message: `Archetype key "${archKey}" does not match inner archetypeId "${archDef.archetypeId}".`,
        severity: 'error'
      });
    }
    if (archDef.creatureType && !sys.creatureTypes[archDef.creatureType]) {
      errors.push({
        path: `systemContent.archetypes.${archKey}.creatureType`,
        message: `Archetype "${archKey}" references unknown creatureType "${archDef.creatureType}".`,
        severity: 'error'
      });
    }
  }

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
