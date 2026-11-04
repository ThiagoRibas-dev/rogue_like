import type { TriggerDefinition } from '../types/trigger.types.ts';
import { CURRENT_SCHEMA_VERSION } from '../constants/campaign.constants.ts';
import { type CampaignData, CampaignDataSchema } from '../types/campaign.types.ts';
import { getInstalledCampaign } from './campaign_store.ts';
import type { RulesetId } from '../types/ruleset.types.ts';
import {
  loadCampaignRegistry,
  loadRulesetSystemContent,
  loadRulesetBaseContent
} from './loader/system_content_loader.ts';

export { loadCampaignRegistry, loadRulesetSystemContent, loadRulesetBaseContent };

/**
 * Builds O(1) trigger routing buckets from the trigger dictionary.
 */
function buildTriggerBuckets(triggers: Record<string, TriggerDefinition>): Record<string, TriggerDefinition[]> {
  const triggerBuckets: Record<string, TriggerDefinition[]> = {};
  for (const trigger of Object.values(triggers)) {
    if (!triggerBuckets[trigger.eventType]) {
      triggerBuckets[trigger.eventType] = [];
    }
    triggerBuckets[trigger.eventType]!.push(trigger);
  }
  return triggerBuckets;
}

/**
 * Parses an optional JSON response, returning the fallback value if not ok or invalid JSON.
 */
async function parseOptionalResponse<T>(res: Response, filename: string, fallback: T): Promise<T> {
  if (!res.ok) return fallback;
  try {
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Failed to parse ${filename}`, err);
    return fallback;
  }
}

/**
 * Loads and validates all JSON files for a given campaign ID.
 * @param campaignId The ID of the campaign to load (e.g., 'default')
 * @returns A promise that resolves to the fully populated and validated CampaignData
 */
export async function loadCampaign(campaignId: string): Promise<CampaignData> {
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

  const installedCampaign = await getInstalledCampaign(campaignId);
  if (installedCampaign) {
    if (installedCampaign.manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.warn(
        `Campaign "${installedCampaign.manifest.name}" was built with schema v${installedCampaign.manifest.schemaVersion}, ` +
          `but the engine expects v${CURRENT_SCHEMA_VERSION}. It loaded successfully, but some features may not work.`
      );
    }
    installedCampaign.triggerBuckets = buildTriggerBuckets(installedCampaign.triggers);
    return installedCampaign;
  }

  const basePath = `${import.meta.env.BASE_URL}data/campaigns/${campaignId}`;
  const requiredFilenames = [
    'manifest.json',
    'rules.json',
    'theme.json',
    'advancement.json',
    'items.json',
    'effects.json',
    'entities.json',
    'status.json',
    'tiles.json',
    'factions.json',
    'ai.json',
    'areas.json',
    'dialogues.json',
    'quests.json',
    'quest_templates.json',
    'villains.json',
    'schemes.json',
    'phase_blocks.json',
    'agreements.json',
    'triggers.json',
    'tag_registry.json',
    'reactions.json',
    'fields.json',
    'spawn_pools.json',
    'encounter_profiles.json',
    'trait_registry.json',
    'identity_generation.json'
  ] as const;

  const optionalFilenames = [
    'knowledge_propagation.json',
    'rumor_propagation.json',
    'nemesis_hierarchies.json',
    'relationship_thresholds.json',
    'trigger_templates.json'
  ] as const;

  try {
    const [requiredResponses, optionalResponses] = await Promise.all([
      Promise.all(requiredFilenames.map((file) => fetch(`${basePath}/${file}`))),
      Promise.all(optionalFilenames.map((file) => fetch(`${basePath}/${file}`)))
    ]);

    for (const res of requiredResponses) {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${res.url}: ${res.status} ${res.statusText}`);
      }
    }

    const [
      manifest,
      rules,
      theme,
      advancement,
      items,
      effects,
      entities,
      status,
      tiles,
      factions,
      ai,
      areas,
      dialogues,
      quests,
      questTemplates,
      villains,
      schemes,
      phaseBlocks,
      agreements,
      triggers,
      tagRegistry,
      reactions,
      fields,
      spawnPools,
      encounterProfiles,
      traitRegistry,
      identityGeneration
    ] = await Promise.all(requiredResponses.map((res) => res.json()));

    const [knowledgePropagation, rumorPropagation, nemesisHierarchies, relationshipThresholds, triggerTemplates] =
      await Promise.all([
        parseOptionalResponse(optionalResponses[0]!, 'knowledge_propagation.json', []),
        parseOptionalResponse(optionalResponses[1]!, 'rumor_propagation.json', []),
        parseOptionalResponse(optionalResponses[2]!, 'nemesis_hierarchies.json', {}),
        parseOptionalResponse(optionalResponses[3]!, 'relationship_thresholds.json', []),
        parseOptionalResponse(optionalResponses[4]!, 'trigger_templates.json', {})
      ]);

    const rulesetId =
      typeof (manifest as Record<string, unknown>)['rulesetId'] === 'string'
        ? ((manifest as Record<string, unknown>)['rulesetId'] as RulesetId)
        : 'classic';
    const [rulesetBase, parsedSystemContent] = await Promise.all([
      loadRulesetBaseContent(rulesetId),
      loadRulesetSystemContent(rulesetId)
    ]);

    const data = {
      manifest,
      rules,
      theme,
      advancement,
      areas,
      items: { ...rulesetBase.items, ...(items as Record<string, unknown>) },
      effects: { ...rulesetBase.effects, ...(effects as Record<string, unknown>) },
      entities: { ...rulesetBase.entities, ...(entities as Record<string, unknown>) },
      status: { ...rulesetBase.status, ...(status as Record<string, unknown>) },
      tiles,
      factions,
      ai,
      dialogues,
      quests,
      questTemplates,
      villains,
      schemeRecipes: schemes,
      phaseBlocks,
      agreements,
      triggers,
      tagRegistry,
      reactions,
      fields,
      spawnPools,
      encounterProfiles,
      traitRegistry,
      identityGeneration,
      knowledgePropagation,
      rumorPropagation,
      nemesisHierarchies,
      relationshipThresholds,
      triggerTemplates,
      triggerBuckets: {},
      systemContent: parsedSystemContent
    };

    const result = CampaignDataSchema.safeParse(data);
    if (!result.success) {
      console.error('Campaign Validation Failed:', result.error);
      throw new Error(`Failed to validate campaign ${campaignId}: ${result.error.message}`);
    }

    const campaignData = result.data;

    if (campaignData.manifest.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      console.warn(
        `Campaign "${campaignData.manifest.name}" was built with schema v${campaignData.manifest.schemaVersion}, ` +
          `but the engine expects v${CURRENT_SCHEMA_VERSION}. It loaded successfully, but some features may not work.`
      );
    }

    campaignData.triggerBuckets = buildTriggerBuckets(campaignData.triggers);
    return campaignData;
  } catch (error) {
    console.error(`Error loading campaign ${campaignId}:`, error);
    throw error;
  }
}
