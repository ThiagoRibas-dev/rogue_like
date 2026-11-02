import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from '../../types/ruleset.types.ts';
import type { PrerequisiteNode } from './prerequisites.ts';
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
    case 'min_ability':
    case 'min_bab':
    case 'min_skill_ranks':
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
  }

  // 2. Validate Domains: ID parity
  for (const [domKey, domDef] of Object.entries(sys.domains)) {
    if (domDef.id !== domKey) {
      errors.push({
        path: `systemContent.domains.${domKey}.id`,
        message: `Domain key "${domKey}" does not match inner id "${domDef.id}".`,
        severity: 'error'
      });
    }
  }

  // 3. Validate Races: ID parity, favoredClass reference, creatureType reference
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

  // 5. Validate Archetypes: ID parity, creatureType reference
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

  // 6. Validate Feats, Spells, Skills & CreatureTypes: ID parity & Prerequisite AST
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
  }

  for (const [skillKey, skillDef] of Object.entries(sys.skills)) {
    if (skillDef.id !== skillKey) {
      errors.push({
        path: `systemContent.skills.${skillKey}.id`,
        message: `Skill key "${skillKey}" does not match inner id "${skillDef.id}".`,
        severity: 'error'
      });
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
    if (entity.archetypeId && !sys.archetypes[entity.archetypeId]) {
      errors.push({
        path: `entities.${entityId}.archetypeId`,
        message: `Entity template "${entityId}" references unknown system archetype "${entity.archetypeId}"`,
        severity: 'error'
      });
    }
  }

  return errors;
}
