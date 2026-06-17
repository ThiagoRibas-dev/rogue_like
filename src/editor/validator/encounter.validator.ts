import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates Encounter Director entities:
 * 1. SpawnPools contain valid entities with defined crCosts
 * 2. EncounterProfile budgets sum to exactly 1.0
 * 3. Area encounter budgets reference valid EncounterProfiles
 * 4. Sub-biome tags on areas reference valid tag_registry entries
 * 5. Spawn pool condition tags (areaTags, biomeTags) reference valid tags
 * 6. Trait registry entries referenced in spawn pools or entities are valid
 */
export function validateEncounters(data: CampaignData): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  // Collect known tags from tag_registry for cross-reference validation
  const knownTags = new Set(Object.keys(data.tagRegistry ?? {}));

  // Validate SpawnPools
  if (data.spawnPools) {
    for (const poolId of Object.keys(data.spawnPools)) {
      const pool = data.spawnPools[poolId];
      if (!pool) continue;

      // Validate condition tags reference known tags
      if (pool.conditions) {
        const allConditionTags = [...(pool.conditions.areaTags ?? []), ...(pool.conditions.biomeTags ?? [])];
        for (const tag of allConditionTags) {
          if (!knownTags.has(tag)) {
            errors.push({
              path: `spawnPools.${poolId}.conditions`,
              message: `Spawn pool '${poolId}' references unknown tag '${tag}' in conditions.`,
              severity: 'warning'
            });
          }
        }
      }

      for (const entityId of Object.keys(pool.entities)) {
        const entityTemplate = data.entities[entityId];
        if (!entityTemplate) {
          errors.push({
            path: `spawnPools.${poolId}.entities.${entityId}`,
            message: `Entity template '${entityId}' referenced in spawn pool '${poolId}' does not exist.`,
            severity: 'error'
          });
          continue;
        }

        if (entityTemplate.crCost === undefined) {
          errors.push({
            path: `spawnPools.${poolId}.entities.${entityId}`,
            message: `Entity template '${entityId}' in spawn pool '${poolId}' is missing a 'crCost'.`,
            severity: 'error'
          });
        }
      }
    }
  }

  // Validate EncounterProfiles
  if (data.encounterProfiles) {
    for (const profileId of Object.keys(data.encounterProfiles)) {
      const profile = data.encounterProfiles[profileId];
      if (!profile) continue;

      const { protein, appetizer, side, dessert } = profile.budgetAllocation;
      const sum = protein + appetizer + side + dessert;

      // Use a small epsilon to handle potential floating point issues
      if (Math.abs(sum - 1.0) > 0.001) {
        errors.push({
          path: `encounterProfiles.${profileId}.budgetAllocation`,
          message: `Encounter profile '${profileId}' budget allocation sum is ${sum.toFixed(3)}, but must be exactly 1.0.`,
          severity: 'error'
        });
      }
    }
  }

  // Validate Area Director config
  if (data.areas) {
    for (const areaId of Object.keys(data.areas)) {
      const area = data.areas[areaId];
      if (!area) continue;

      if (area.encounterProfileId) {
        if (!data.encounterProfiles || !data.encounterProfiles[area.encounterProfileId]) {
          errors.push({
            path: `areas.${areaId}.encounterProfileId`,
            message: `Area '${areaId}' references encounter profile '${area.encounterProfileId}' which does not exist.`,
            severity: 'error'
          });
        }
      }

      // Validate subBiome tags reference known tags
      if (area.subBiomes) {
        for (const tag of Object.keys(area.subBiomes)) {
          if (!knownTags.has(tag)) {
            errors.push({
              path: `areas.${areaId}.subBiomes`,
              message: `Area '${areaId}' subBiome tag '${tag}' is not defined in tag_registry.`,
              severity: 'warning'
            });
          }
          const probability = area.subBiomes[tag];
          if (probability !== undefined && (probability <= 0 || probability > 1)) {
            errors.push({
              path: `areas.${areaId}.subBiomes.${tag}`,
              message: `Area '${areaId}' subBiome probability for '${tag}' must be >0 and <=1, got ${probability}.`,
              severity: 'error'
            });
          }
        }
      }
    }
  }

  // Validate trait references in entity templates
  if (data.entities && data.traitRegistry) {
    const knownTraits = new Set(Object.keys(data.traitRegistry));
    for (const entityId of Object.keys(data.entities)) {
      const entity = data.entities[entityId];
      if (!entity?.traits) continue;
      for (const traitId of entity.traits) {
        if (!knownTraits.has(traitId)) {
          errors.push({
            path: `entities.${entityId}.traits`,
            message: `Entity '${entityId}' references unknown trait '${traitId}' not found in trait_registry.`,
            severity: 'error'
          });
        }
      }
    }
  }

  return errors;
}
