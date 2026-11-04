import type { CampaignData } from '../types/campaign.types.ts';
import type { ValidationError } from './validator/validator.types.ts';

/**
 * Resolves a value inside a document structure using a JSON pointer path.
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  if (!path || path === '/') return obj;
  const segments = path.split('/');
  if (segments[0] === '') segments.shift();

  let curr: unknown = obj;
  for (const seg of segments) {
    if (curr === null || typeof curr !== 'object') return undefined;
    curr = (curr as Record<string, unknown>)[seg];
  }
  return curr;
}

/**
 * Checks all foreign key relationships and area graph reachability in the CampaignData.
 */
export function auditCampaignLinks(data: CampaignData, errors: ValidationError[]): void {
  const factions = Object.keys(data.factions);
  const effects = Object.keys(data.effects);
  const dialogues = Object.keys(data.dialogues);
  const aiProfiles = Object.keys(data.ai);
  const items = Object.keys(data.items);
  const statusEffects = Object.keys(data.status);
  const areas = Object.keys(data.areas);

  for (const [id, entity] of Object.entries(data.entities)) {
    if (entity.faction && !factions.includes(entity.faction)) {
      errors.push({
        path: `/entities/${id}/faction`,
        message: `Entity '${entity.name}' references non-existent faction '${entity.faction}'.`,
        severity: 'error'
      });
    }
    if (entity.dialogueId && !dialogues.includes(entity.dialogueId)) {
      errors.push({
        path: `/entities/${id}/dialogueId`,
        message: `Entity '${entity.name}' references non-existent dialogue '${entity.dialogueId}'.`,
        severity: 'error'
      });
    }
    if (entity.ai?.profileId && !aiProfiles.includes(entity.ai.profileId)) {
      errors.push({
        path: `/entities/${id}/ai/profileId`,
        message: `Entity '${entity.name}' references non-existent AI profile '${entity.ai.profileId}'.`,
        severity: 'error'
      });
    }
  }

  for (const [id, item] of Object.entries(data.items)) {
    if (item.consumable?.effectId && !effects.includes(item.consumable.effectId)) {
      errors.push({
        path: `/items/${id}/consumable/effectId`,
        message: `Item '${item.name}' consumable references non-existent effect '${item.consumable.effectId}'.`,
        severity: 'error'
      });
    }
    if (item.equippable?.onHit?.statusId && !statusEffects.includes(item.equippable.onHit.statusId)) {
      errors.push({
        path: `/items/${id}/equippable/onHit/statusId`,
        message: `Item '${item.name}' equippable on-hit references non-existent status effect '${item.equippable.onHit.statusId}'.`,
        severity: 'error'
      });
    }
  }

  for (const [id, effect] of Object.entries(data.effects)) {
    if (effect.statusId && !statusEffects.includes(effect.statusId)) {
      errors.push({
        path: `/effects/${id}/statusId`,
        message: `Effect '${id}' references non-existent status effect '${effect.statusId}'.`,
        severity: 'error'
      });
    }
  }

  for (const [areaId, area] of Object.entries(data.areas)) {
    if (area.connections) {
      area.connections.forEach((conn, index) => {
        if (!areas.includes(conn.targetAreaId)) {
          errors.push({
            path: `/areas/${areaId}/connections/${index}/targetAreaId`,
            message: `Area '${area.name}' portal references non-existent target area '${conn.targetAreaId}'.`,
            severity: 'error'
          });
        }
      });
    }
  }

  if (!areas.includes(data.rules.map.startingAreaId)) {
    errors.push({
      path: '/rules/map/startingAreaId',
      message: `Rules configuration references invalid starting area ID: '${data.rules.map.startingAreaId}'.`,
      severity: 'error'
    });
  }

  const startingArea = data.rules.map.startingAreaId;
  if (areas.includes(startingArea)) {
    const visited = new Set<string>([startingArea]);
    const queue = [startingArea];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const connections = data.areas[curr]?.connections || [];
      for (const conn of connections) {
        if (!visited.has(conn.targetAreaId) && areas.includes(conn.targetAreaId)) {
          visited.add(conn.targetAreaId);
          queue.push(conn.targetAreaId);
        }
      }
    }
    for (const areaId of areas) {
      if (!visited.has(areaId)) {
        errors.push({
          path: `/areas/${areaId}`,
          message: `Area '${data.areas[areaId]?.name}' is unreachable from the starting area.`,
          severity: 'warning'
        });
      }
    }
  }

  for (const entId of Object.keys(data.rules.spawning.spawnWeights)) {
    if (!Object.keys(data.entities).includes(entId)) {
      errors.push({
        path: `/rules/spawning/spawnWeights/${entId}`,
        message: `Spawn weight table references invalid entity template ID: '${entId}'.`,
        severity: 'error'
      });
    }
  }
  for (const itemId of Object.keys(data.rules.spawning.lootTable)) {
    if (!items.includes(itemId)) {
      errors.push({
        path: `/rules/spawning/lootTable/${itemId}`,
        message: `Loot spawn table references invalid item definition ID: '${itemId}'.`,
        severity: 'error'
      });
    }
  }
}
