import JSZip from 'jszip';
import { type CampaignData, CampaignDataSchema } from '../types/campaign.types.ts';
import { loadRulesetSystemContent } from '../core/loader.ts';
import type { RulesetId } from '../types/ruleset.types.ts';

export * from './blank_slate_campaign.ts';

// List of the JSON files making up the campaign data package
const CAMPAIGN_FILES: ReadonlyArray<{
  readonly key: keyof CampaignData;
  readonly filename: string;
  readonly optional?: boolean;
}> = [
  { key: 'manifest', filename: 'manifest.json' },
  { key: 'rules', filename: 'rules.json' },
  { key: 'theme', filename: 'theme.json' },
  { key: 'advancement', filename: 'advancement.json' },
  { key: 'areas', filename: 'areas.json' },
  { key: 'items', filename: 'items.json' },
  { key: 'effects', filename: 'effects.json' },
  { key: 'entities', filename: 'entities.json' },
  { key: 'status', filename: 'status.json' },
  { key: 'tiles', filename: 'tiles.json' },
  { key: 'factions', filename: 'factions.json' },
  { key: 'ai', filename: 'ai.json' },
  { key: 'dialogues', filename: 'dialogues.json' },
  { key: 'quests', filename: 'quests.json' },
  { key: 'questTemplates', filename: 'quest_templates.json' },
  { key: 'triggers', filename: 'triggers.json' },
  { key: 'triggerTemplates', filename: 'trigger_templates.json' },
  { key: 'villains', filename: 'villains.json' },
  { key: 'schemeRecipes', filename: 'schemes.json' },
  { key: 'phaseBlocks', filename: 'phase_blocks.json' },
  { key: 'agreements', filename: 'agreements.json' },
  { key: 'tagRegistry', filename: 'tag_registry.json' },
  { key: 'reactions', filename: 'reactions.json' },
  { key: 'fields', filename: 'fields.json', optional: true },
  { key: 'spawnPools', filename: 'spawn_pools.json', optional: true },
  { key: 'encounterProfiles', filename: 'encounter_profiles.json', optional: true },
  { key: 'traitRegistry', filename: 'trait_registry.json', optional: true },
  { key: 'identityGeneration', filename: 'identity_generation.json', optional: true },
  { key: 'personalityGeneration', filename: 'personality_generation.json', optional: true },
  { key: 'knowledgePropagation', filename: 'knowledge_propagation.json', optional: true },
  { key: 'rumorPropagation', filename: 'rumor_propagation.json', optional: true },
  { key: 'nemesisHierarchies', filename: 'nemesis_hierarchies.json', optional: true },
  { key: 'relationshipThresholds', filename: 'relationship_thresholds.json', optional: true },
  { key: 'worldEvents', filename: 'world_events.json', optional: true }
];

/**
 * Parses and extracts a campaign from a flat ZIP container.
 * @param file The ZIP file or Blob.
 * @returns A promise resolving to the parsed CampaignData.
 */
export async function readCampaignFromZip(file: File | Blob): Promise<CampaignData> {
  const zip = new JSZip();
  let loadedZip: JSZip;
  try {
    loadedZip = await zip.loadAsync(file);
  } catch {
    throw new Error('Failed to parse ZIP archive.');
  }

  const data: Partial<CampaignData> = {};

  for (const fileItem of CAMPAIGN_FILES) {
    const zipEntry = loadedZip.file(fileItem.filename);
    if (!zipEntry) {
      if (fileItem.optional) {
        if (
          fileItem.key === 'knowledgePropagation' ||
          fileItem.key === 'rumorPropagation' ||
          fileItem.key === 'reactions'
        ) {
          data[fileItem.key] = [] as never;
        } else if (fileItem.key === 'worldEvents') {
          data[fileItem.key] = { areaEvents: [], factionEvents: [] } as never;
        } else {
          data[fileItem.key] = {} as never;
        }
        continue;
      }
      throw new Error(`Missing required file ${fileItem.filename} in ZIP package.`);
    }
    const text = await zipEntry.async('string');
    try {
      data[fileItem.key] = JSON.parse(text) as never;
    } catch {
      throw new Error(`Malformed JSON in file ${fileItem.filename} within the ZIP.`);
    }
  }

  const result = CampaignDataSchema.safeParse(data);
  if (!result.success) {
    console.error('ZIP validation failed:', result.error);
    throw new Error(`ZIP campaign validation failed: ${result.error.message}`);
  }

  const campaign = result.data;
  const rulesetId = (campaign.manifest.rulesetId as RulesetId | undefined) ?? 'classic';
  if (!campaign.systemContent) {
    try {
      const sysContent = await loadRulesetSystemContent(rulesetId);
      if (Object.keys(sysContent).length > 0) {
        campaign.systemContent = sysContent;
      }
    } catch (err) {
      console.warn(`Could not hydrate system content for ruleset "${rulesetId}":`, err);
    }
  }

  return campaign;
}

/**
 * Packages CampaignData into a flat ZIP archive blob.
 * @param data The CampaignData to compress.
 * @returns A promise resolving to the compressed ZIP Blob.
 */
export async function writeCampaignToZip(data: CampaignData): Promise<Blob> {
  const zip = new JSZip();

  for (const fileItem of CAMPAIGN_FILES) {
    const fileContent = data[fileItem.key];
    zip.file(fileItem.filename, JSON.stringify(fileContent, null, 2));
  }

  try {
    const blob = await zip.generateAsync({ type: 'blob' });
    return blob;
  } catch (err) {
    console.error('Failed to generate ZIP archive:', err);
    throw new Error('Failed to package campaign into ZIP.');
  }
}
