import {
  type CampaignData,
  CampaignDataSchema,
  type CampaignRegistry,
  CampaignRegistrySchema
} from '../types/campaign.types.ts';

/**
 * Loads and validates all JSON files for a given campaign ID.
 * @param campaignId The ID of the campaign to load (e.g., 'default')
 * @returns A promise that resolves to the fully populated and validated CampaignData
 */
export async function loadCampaign(campaignId: string): Promise<CampaignData> {
  const basePath = `/data/campaigns/${campaignId}`;

  try {
    const [
      manifestRes,
      rulesRes,
      themeRes,
      advancementRes,
      itemsRes,
      effectsRes,
      entitiesRes,
      statusRes,
      tilesRes,
      factionsRes,
      aiRes,
      areasRes
    ] = await Promise.all([
      fetch(`${basePath}/manifest.json`),
      fetch(`${basePath}/rules.json`),
      fetch(`${basePath}/theme.json`),
      fetch(`${basePath}/advancement.json`),
      fetch(`${basePath}/items.json`),
      fetch(`${basePath}/effects.json`),
      fetch(`${basePath}/entities.json`),
      fetch(`${basePath}/status.json`),
      fetch(`${basePath}/tiles.json`),
      fetch(`${basePath}/factions.json`),
      fetch(`${basePath}/ai.json`),
      fetch(`${basePath}/areas.json`)
    ]);

    // Check if any requests failed (e.g., 404)
    const responses = [
      manifestRes,
      rulesRes,
      themeRes,
      advancementRes,
      itemsRes,
      effectsRes,
      entitiesRes,
      statusRes,
      tilesRes,
      factionsRes,
      aiRes,
      areasRes
    ];

    for (const res of responses) {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${res.url}: ${res.status} ${res.statusText}`);
      }
    }

    const [manifest, rules, theme, advancement, areas, items, effects, entities, status, tiles, factions, ai] =
      await Promise.all([
        manifestRes.json(),
        rulesRes.json(),
        themeRes.json(),
        advancementRes.json(),
        areasRes.json(),
        itemsRes.json(),
        effectsRes.json(),
        entitiesRes.json(),
        statusRes.json(),
        tilesRes.json(),
        factionsRes.json(),
        aiRes.json()
      ]);

    const data = {
      manifest,
      rules,
      theme,
      advancement,
      areas,
      items,
      effects,
      entities,
      status,
      tiles,
      factions,
      ai
    };

    const result = CampaignDataSchema.safeParse(data);
    if (!result.success) {
      console.error('Campaign Validation Failed:', result.error);
      throw new Error(`Failed to validate campaign ${campaignId}: ${result.error.message}`);
    }

    return result.data;
  } catch (error) {
    console.error(`Error loading campaign ${campaignId}:`, error);
    throw error;
  }
}

/**
 * Loads the campaign registry containing all available campaigns.
 * @returns A promise resolving to the CampaignRegistry
 */
export async function loadCampaignRegistry(): Promise<CampaignRegistry> {
  try {
    const res = await fetch('/data/campaigns.json');
    if (!res.ok) {
      throw new Error(`Failed to fetch campaigns.json: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const result = CampaignRegistrySchema.safeParse(data);
    if (!result.success) {
      console.error('Campaign Registry Validation Failed:', result.error);
      throw new Error(`Failed to validate campaign registry: ${result.error.message}`);
    }
    return result.data;
  } catch (error) {
    console.error('Error loading campaign registry:', error);
    throw error;
  }
}
