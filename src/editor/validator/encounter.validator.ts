import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates Encounter Director entities:
 * 1. SpawnPools contain valid entities with defined crCosts
 * 2. EncounterProfile budgets sum to exactly 1.0
 * 3. Area encounter budgets reference valid EncounterProfiles
 */
export function validateEncounters(data: CampaignData): ReadonlyArray<ValidationError> {
  const errors: ValidationError[] = [];

  // Validate SpawnPools
  if (data.spawnPools) {
    for (const poolId of Object.keys(data.spawnPools)) {
      const pool = data.spawnPools[poolId];
      if (!pool) continue;

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
    }
  }

  return errors;
}
