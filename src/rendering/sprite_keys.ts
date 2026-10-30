/**
 * @file Shared sprite-key resolution for campaign art.
 *
 * Single source of truth for "which sprite keys does this campaign provide?" and
 * "which templates would fall back to the placeholder sprite?". Used by the
 * renderer diagnostics and by `scripts/run-validator.ts`, so runtime and the
 * campaign validator can never disagree.
 */

import type { CampaignData } from '../types/campaign.types.ts';

const availableKeysCache = new WeakMap<CampaignData, ReadonlySet<string>>();

/**
 * Returns the set of sprite keys provided by a campaign's sprite sheets
 * (every sheet's `tileMap` keys, merged — matching how the renderer builds its
 * composite atlas).
 *
 * @param campaign The campaign definition.
 * @returns Readonly set of drawable sprite keys (empty when the campaign is ASCII).
 */
export function getAvailableSpriteKeys(campaign: CampaignData): ReadonlySet<string> {
  const cached = availableKeysCache.get(campaign);
  if (cached) return cached;

  const keys = new Set<string>();
  for (const sheet of Object.values(campaign.theme.spriteSheets ?? {})) {
    for (const key of Object.keys(sheet.tileMap ?? {})) keys.add(key);
  }

  availableKeysCache.set(campaign, keys);
  return keys;
}

/**
 * Reports whether a campaign renders art from sprite sheets at all.
 *
 * @param campaign The campaign definition.
 * @returns True when at least one sprite key is available.
 */
export function campaignUsesSprites(campaign: CampaignData): boolean {
  return getAvailableSpriteKeys(campaign).size > 0;
}

/** Why a template cannot resolve a sprite. */
export type SpriteProblemReason = 'no-spriteId' | 'unresolved-spriteId';

/** A campaign template whose art cannot be resolved. */
export interface MissingSpriteMapping {
  readonly kind: 'tile' | 'entity' | 'item' | 'field';
  readonly id: string;
  readonly reason: SpriteProblemReason;
  readonly spriteId?: string;
}

/**
 * Checks a single template's `spriteId` against the available sprite keys.
 *
 * @param kind Template category.
 * @param id Template identifier.
 * @param spriteId The template's declared sprite key, if any.
 * @param available Set of drawable sprite keys.
 * @returns A problem descriptor, or null when the sprite resolves.
 */
export function findSpriteProblem(
  kind: MissingSpriteMapping['kind'],
  id: string,
  spriteId: string | undefined,
  available: ReadonlySet<string>
): MissingSpriteMapping | null {
  if (spriteId === undefined || spriteId === '') {
    return { kind, id, reason: 'no-spriteId' };
  }
  if (!available.has(spriteId)) {
    return { kind, id, reason: 'unresolved-spriteId', spriteId };
  }
  return null;
}

/**
 * Collects every tile/entity/item template that would render as the fallback sprite.
 *
 * Returns an empty array for ASCII campaigns (no sprite sheets), where sprites are
 * not used and a missing `spriteId` is not a defect.
 *
 * @param campaign The campaign definition.
 * @returns All unresolved sprite mappings.
 */
export function collectMissingSpriteMappings(campaign: CampaignData): ReadonlyArray<MissingSpriteMapping> {
  const available = getAvailableSpriteKeys(campaign);
  if (available.size === 0) return [];

  const issues: MissingSpriteMapping[] = [];

  for (const [id, def] of Object.entries(campaign.tiles)) {
    const problem = findSpriteProblem('tile', id, def.spriteId, available);
    if (problem) issues.push(problem);
  }
  for (const [id, def] of Object.entries(campaign.entities)) {
    const problem = findSpriteProblem('entity', id, def.spriteId, available);
    if (problem) issues.push(problem);
  }
  for (const [id, def] of Object.entries(campaign.items)) {
    const problem = findSpriteProblem('item', id, def.spriteId, available);
    if (problem) issues.push(problem);
  }
  for (const [id, def] of Object.entries(campaign.fields)) {
    const problem = findSpriteProblem('field', id, def.spriteId, available);
    if (problem) issues.push(problem);
  }

  return issues;
}
