import type { ValidationError } from '../../../types/ruleset.types.ts';
import type { PrerequisiteNode } from '../prerequisites.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/**
 * Recursively validates cross-references inside a `PrerequisiteNode` AST.
 *
 * @param node The prerequisite AST node to inspect.
 * @param basePath The diagnostic path prefix.
 * @param sys The validated D&D 3.5e system content.
 * @param errors Accumulator array for validation errors.
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

/**
 * Validates classes, domains, races, templates, and legacy archetypes in `DnD35SystemContent`.
 *
 * @param sys The parsed `DnD35SystemContent` object.
 * @param errors Accumulator array for validation errors.
 */
export function validateDnD35eClassesRacesTemplates(
  sys: Readonly<DnD35SystemContent>,
  errors: ValidationError[]
): void {
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
        const isDecreasing =
          row.bab < prev.bab ||
          row.fortSave < prev.fortSave ||
          row.refSave < prev.refSave ||
          row.willSave < prev.willSave;
        if (isDecreasing) {
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
      if (acf.prerequisites) {
        validatePrerequisiteNodeReferences(
          acf.prerequisites,
          `systemContent.classes.${classKey}.acfSwaps.${acf.acfId}.prerequisites`,
          sys,
          errors
        );
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
    if (Object.keys(sys.spells).length > 0) {
      for (const [lvlKey, spellId] of Object.entries(domDef.domainSpells)) {
        if (!sys.spells[spellId]) {
          errors.push({
            path: `systemContent.domains.${domKey}.domainSpells.${lvlKey}`,
            message: `Domain "${domKey}" level ${lvlKey} references unknown spell "${spellId}".`,
            severity: 'error'
          });
        }
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
    for (const eq of raceDef.defaultEquipment ?? []) {
      if (!sys.items[eq.itemId]) {
        errors.push({
          path: `systemContent.races.${raceKey}.defaultEquipment`,
          message: `Race "${raceKey}" references unknown item "${eq.itemId}" in defaultEquipment.`,
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

  // 4. Validate Templates: ID parity, targetCreatureTypes, convertTypeMap & prerequisites references
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
    if (tmplDef.prerequisites) {
      validatePrerequisiteNodeReferences(
        tmplDef.prerequisites,
        `systemContent.templates.${tmplKey}.prerequisites`,
        sys,
        errors
      );
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
    for (const eq of archDef.defaultEquipment ?? []) {
      if (!sys.items[eq.itemId]) {
        errors.push({
          path: `systemContent.archetypes.${archKey}.defaultEquipment`,
          message: `Archetype "${archKey}" references unknown item "${eq.itemId}" in defaultEquipment.`,
          severity: 'error'
        });
      }
    }
  }
}
