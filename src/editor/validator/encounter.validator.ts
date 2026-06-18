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
 * 7. Overspent budgets: area budget but no affordable candidate
 * 8. Dead spawn pools: pool conditions match no area
 * 9. Profile-less areas with budget (warning)
 * 10. Static map exit validity
 * 11. Budget scaling sanity
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

  // Collect all area tags sets for dead-pool checking
  const areaTagSets: Array<{ id: string; tags: ReadonlyArray<string> }> = [];
  const areaWithDirector: Array<{ id: string; budget: number; areaTags: ReadonlyArray<string>; name: string }> = [];

  // Validate Area Director config
  if (data.areas) {
    for (const areaId of Object.keys(data.areas)) {
      const area = data.areas[areaId];
      if (!area) continue;

      const areaTags = area.tags ?? [];
      areaTagSets.push({ id: areaId, tags: areaTags });

      if (area.encounterProfileId) {
        if (!data.encounterProfiles || !data.encounterProfiles[area.encounterProfileId]) {
          errors.push({
            path: `areas.${areaId}.encounterProfileId`,
            message: `Area '${areaId}' references encounter profile '${area.encounterProfileId}' which does not exist.`,
            severity: 'error'
          });
        }

        // Track for budget/pool availability checks
        const budget = area.crBudget ?? 0;
        areaWithDirector.push({ id: areaId, budget, areaTags, name: area.name });
      } else {
        // Check 9: Profile-less area with budget
        if (area.crBudget && area.crBudget > 0) {
          errors.push({
            path: `areas.${areaId}.crBudget`,
            message: `Area '${area.name}' has crBudget=${area.crBudget} but no encounterProfileId. Budget will be wasted.`,
            severity: 'warning'
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

      // Check 11: Budget scaling sanity
      if (area.budgetScaling) {
        if (area.budgetScaling.scalingFactor <= 0) {
          errors.push({
            path: `areas.${areaId}.budgetScaling.scalingFactor`,
            message: `Area '${area.name}' has budgetScaling.scalingFactor=${area.budgetScaling.scalingFactor}, which should be positive.`,
            severity: 'warning'
          });
        }
        if (area.budgetScaling.baseBudget < 0) {
          errors.push({
            path: `areas.${areaId}.budgetScaling.baseBudget`,
            message: `Area '${area.name}' has budgetScaling.baseBudget=${area.budgetScaling.baseBudget}, which cannot be negative.`,
            severity: 'error'
          });
        }
      }

      // Check 10: Static map exit validity
      if (area.generatorType === 'static' && area.staticMap && area.connections) {
        const layout = area.staticMap.layout;
        const legend = area.staticMap.legend;
        area.connections.forEach((conn, ci) => {
          if (!conn) return;
          if (conn.placementX !== undefined && conn.placementY !== undefined) {
            const px = conn.placementX;
            const py = conn.placementY;
            // Check if placement falls within layout bounds
            if (py < layout.length && px < layout[py]!.length) {
              const tileChar = layout[py]![px]!;
              const tileId = legend[tileChar];
              // If the tile at the placement resolves to a wall-like tile, flag it
              if (tileId && (tileId.includes('wall') || tileId === 'empty_space')) {
                errors.push({
                  path: `areas.${areaId}.connections.${ci}.placementX`,
                  message: `Area '${area.name}' connection ${ci} places portal at (${px},${py}) which maps to '${tileId}', making the exit inaccessible.`,
                  severity: 'error'
                });
              }
            } else {
              errors.push({
                path: `areas.${areaId}.connections.${ci}`,
                message: `Area '${area.name}' connection ${ci} placement (${px},${py}) is outside the static layout bounds.`,
                severity: 'error'
              });
            }
          }
        });
      }
    }
  }

  // Check 7 & 8: Overspent budgets & dead spawn pools
  if (data.spawnPools && areaWithDirector.length > 0) {
    // First, check each spawn pool — does it match at least one area?
    for (const poolId of Object.keys(data.spawnPools)) {
      const pool = data.spawnPools[poolId];
      if (!pool) continue;
      const poolAreaTags = pool.conditions?.areaTags;

      if (poolAreaTags && poolAreaTags.length > 0) {
        const matchesAnyArea = areaTagSets.some((a) => poolAreaTags!.some((t) => a.tags.includes(t)));
        if (!matchesAnyArea) {
          errors.push({
            path: `spawnPools.${poolId}`,
            message: `Spawn pool '${poolId}' has areaTags [${poolAreaTags.join(', ')}] but no area in the campaign matches these tags. Pool is dead code.`,
            severity: 'warning'
          });
        }
      }
    }

    // Check each director-enabled area for affordable candidates
    for (const area of areaWithDirector) {
      if (area.budget <= 0) continue;

      let hasAffordableCandidate = false;
      let minEntityCost = Number.MAX_SAFE_INTEGER;

      for (const pool of Object.values(data.spawnPools)) {
        if (!pool) continue;

        // Check if pool conditions match area tags
        if (pool.conditions?.areaTags && !pool.conditions.areaTags.some((t) => area.areaTags.includes(t))) {
          continue;
        }

        for (const [templateId] of Object.entries(pool.entities)) {
          const template = data.entities[templateId];
          if (template?.crCost !== undefined && template.crCost > 0) {
            minEntityCost = Math.min(minEntityCost, template.crCost);
            if (template.crCost <= area.budget) {
              hasAffordableCandidate = true;
            }
          }
        }
      }

      if (!hasAffordableCandidate) {
        const msg =
          minEntityCost < Number.MAX_SAFE_INTEGER
            ? `Area '${area.name}' has crBudget=${area.budget} but the cheapest spawn pool entity costs ${minEntityCost} CR. No entity can be spawned.`
            : `Area '${area.name}' has crBudget=${area.budget} but no spawn pool matches its tags. No entities will be generated.`;
        errors.push({
          path: `areas.${area.id}`,
          message: msg,
          severity: 'error'
        });
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
