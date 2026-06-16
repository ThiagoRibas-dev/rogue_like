import type { TriggerDefinition } from '../types/trigger.types.ts';
import { CURRENT_SCHEMA_VERSION } from '../constants/campaign.constants.ts';
import {
  type CampaignData,
  CampaignDataSchema,
  type CampaignRegistry,
  CampaignRegistrySchema
} from '../types/campaign.types.ts';
import { getInstalledCampaign, listInstalledCampaigns } from './campaign_store.ts';

/**
 * Loads and validates all JSON files for a given campaign ID.
 * @param campaignId The ID of the campaign to load (e.g., 'default')
 * @returns A promise that resolves to the fully populated and validated CampaignData
 */
export async function loadCampaign(campaignId: string): Promise<CampaignData> {
  // Playtest interceptor
  const editorDoc = sessionStorage.getItem('editor_active_document');
  if (editorDoc) {
    try {
      const parsed = JSON.parse(editorDoc);
      const result = CampaignDataSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      console.warn('Invalid editor document in sessionStorage, falling back to disk fetch', result.error);
    } catch (e) {
      console.warn('Failed to parse editor document from sessionStorage', e);
    }
  }

  // Check if it's an installed campaign in IDB first
  const installedCampaign = await getInstalledCampaign(campaignId);
  if (installedCampaign) {
    if (installedCampaign.manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.warn(
        `Campaign "${installedCampaign.manifest.name}" was built with schema v${installedCampaign.manifest.schemaVersion}, ` +
          `but the engine expects v${CURRENT_SCHEMA_VERSION}. It loaded successfully, but some features may not work.`
      );
    }

    // Build the O(1) trigger routing buckets
    const triggerBuckets: Record<string, TriggerDefinition[]> = {};
    for (const trigger of Object.values(installedCampaign.triggers)) {
      if (!triggerBuckets[trigger.eventType]) {
        triggerBuckets[trigger.eventType] = [];
      }
      triggerBuckets[trigger.eventType]!.push(trigger);
    }
    installedCampaign.triggerBuckets = triggerBuckets;

    return installedCampaign;
  }

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
      areasRes,
      dialoguesRes,
      questsRes,
      questTemplatesRes,
      villainsRes,
      schemesRes,
      agreementsRes,
      triggersRes,
      tagRegistryRes,
      reactionsRes,
      fieldsRes
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
      fetch(`${basePath}/areas.json`),
      fetch(`${basePath}/dialogues.json`),
      fetch(`${basePath}/quests.json`),
      fetch(`${basePath}/quest_templates.json`),
      fetch(`${basePath}/villains.json`),
      fetch(`${basePath}/schemes.json`),
      fetch(`${basePath}/agreements.json`),
      fetch(`${basePath}/triggers.json`),
      fetch(`${basePath}/tag_registry.json`),
      fetch(`${basePath}/reactions.json`),
      fetch(`${basePath}/fields.json`)
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
      areasRes,
      dialoguesRes,
      questsRes,
      questTemplatesRes,
      villainsRes,
      schemesRes,
      agreementsRes,
      triggersRes,
      tagRegistryRes,
      reactionsRes,
      fieldsRes
    ];

    for (const res of responses) {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${res.url}: ${res.status} ${res.statusText}`);
      }
    }

    const [
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
      ai,
      dialogues,
      quests,
      questTemplates,
      villains,
      schemes,
      agreements,
      triggers,
      tagRegistry,
      reactions,
      fields
    ] = await Promise.all([
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
      aiRes.json(),
      dialoguesRes.json(),
      questsRes.json(),
      questTemplatesRes.json(),
      villainsRes.json(),
      schemesRes.json(),
      agreementsRes.json(),
      triggersRes.json(),
      tagRegistryRes.json(),
      reactionsRes.json(),
      fieldsRes.json()
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
      ai,
      dialogues,
      quests,
      questTemplates,
      villains,
      schemes,
      agreements,
      triggers,
      tagRegistry,
      reactions,
      fields,
      triggerBuckets: {}
    };

    const result = CampaignDataSchema.safeParse(data);
    if (!result.success) {
      console.error('Campaign Validation Failed:', result.error);
      throw new Error(`Failed to validate campaign ${campaignId}: ${result.error.message}`);
    }

    const campaignData = result.data;

    // Check schema version compatibility (non-blocking)
    if (campaignData.manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.warn(
        `Campaign "${campaignData.manifest.name}" was built with schema v${campaignData.manifest.schemaVersion}, ` +
          `but the engine expects v${CURRENT_SCHEMA_VERSION}. It loaded successfully, but some features may not work.`
      );
    }

    // Build the O(1) trigger routing buckets
    const triggerBuckets: Record<string, TriggerDefinition[]> = {};
    for (const trigger of Object.values(campaignData.triggers)) {
      if (!triggerBuckets[trigger.eventType]) {
        triggerBuckets[trigger.eventType] = [];
      }
      triggerBuckets[trigger.eventType]!.push(trigger);
    }
    campaignData.triggerBuckets = triggerBuckets;

    return campaignData;
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

    const registry = result.data;

    // Merge installed campaigns from IndexedDB
    const installed = await listInstalledCampaigns();
    for (const campaign of installed) {
      // Remove any existing entry with the same ID so IDB overrides builtin
      registry.campaigns = registry.campaigns.filter((c) => c.id !== campaign.id);
      registry.campaigns.push(campaign);
    }

    return registry;
  } catch (error) {
    console.error('Error loading campaign registry:', error);
    throw error;
  }
}
