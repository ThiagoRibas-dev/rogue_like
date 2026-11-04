import { type CampaignRegistry, CampaignRegistrySchema } from '../../types/campaign.types.ts';
import { listInstalledCampaigns } from '../campaign_store.ts';
import { getRuleset } from '../../rulesets/registry.ts';
import type { RulesetId } from '../../types/ruleset.types.ts';

/**
 * Loads the campaign registry containing all available campaigns.
 * @returns A promise resolving to the CampaignRegistry
 */
export async function loadCampaignRegistry(): Promise<CampaignRegistry> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/campaigns.json`);
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

    const installed = await listInstalledCampaigns();
    for (const campaign of installed) {
      registry.campaigns = registry.campaigns.filter((c) => c.id !== campaign.id);
      registry.campaigns.push(campaign);
    }

    return registry;
  } catch (error) {
    console.error('Error loading campaign registry:', error);
    throw error;
  }
}

/**
 * Fetches optional JSON resource from a given URL without throwing.
 * @param url The resource URL.
 * @returns Parsed JSON object, or empty object if fetch fails.
 */
export async function fetchOptionalJson(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Merges a loaded system content payload into the target dictionary key.
 * If both the existing entry and the incoming payload are plain objects, shallow-merges them.
 *
 * @param target The target raw system content dictionary.
 * @param key The system content category key (e.g. 'classes').
 * @param incoming The parsed JSON object from disk/fetch.
 */
function mergeSystemContentEntry(
  target: Record<string, Record<string, unknown>>,
  key: string,
  incoming: Record<string, unknown>
): void {
  const normalizedIncoming =
    typeof incoming['id'] === 'string' && typeof incoming['name'] === 'string'
      ? { [incoming['id']]: incoming }
      : incoming;
  const existing = target[key];
  if (existing !== undefined) {
    target[key] = { ...existing, ...normalizedIncoming };
    return;
  }
  target[key] = normalizedIncoming;
}

/**
 * Loads and parses Tier 2 System Content for a given ruleset.
 * @param rulesetId The ID of the ruleset.
 * @returns A promise resolving to the parsed system content map.
 */
export async function loadRulesetSystemContent(rulesetId: RulesetId): Promise<Record<string, Record<string, unknown>>> {
  const ruleset = getRuleset(rulesetId);
  const rulesetBasePath = `${import.meta.env.BASE_URL}data/rulesets/${ruleset.id}`;
  const systemDescriptors = ruleset.getSystemContentFiles?.() ?? [];
  const systemContentEntries = await Promise.all(
    systemDescriptors.map(async (desc) => {
      const content = await fetchOptionalJson(`${rulesetBasePath}/${desc.filename}`);
      return [desc.key, content] as const;
    })
  );
  const rawSystemContent: Record<string, Record<string, unknown>> = {};
  for (const [key, content] of systemContentEntries) {
    mergeSystemContentEntry(rawSystemContent, key, content);
  }
  return ruleset.parseSystemContent
    ? (ruleset.parseSystemContent(rawSystemContent) as unknown as Record<string, Record<string, unknown>>)
    : rawSystemContent;
}

/**
 * Loads base items, entities, status effects, and effects provided by the ruleset cartridge.
 * @param rulesetId The ID of the ruleset.
 * @returns A promise resolving to the base ruleset items, entities, status, and effects.
 */
export async function loadRulesetBaseContent(rulesetId: RulesetId): Promise<{
  readonly items: Record<string, unknown>;
  readonly entities: Record<string, unknown>;
  readonly status: Record<string, unknown>;
  readonly effects: Record<string, unknown>;
}> {
  const ruleset = getRuleset(rulesetId);
  const rulesetBasePath = `${import.meta.env.BASE_URL}data/rulesets/${ruleset.id}`;
  const [items, entities, status, effects] = await Promise.all([
    fetchOptionalJson(`${rulesetBasePath}/items.json`),
    fetchOptionalJson(`${rulesetBasePath}/entities.json`),
    fetchOptionalJson(`${rulesetBasePath}/status.json`),
    fetchOptionalJson(`${rulesetBasePath}/effects.json`)
  ]);
  return { items, entities, status, effects };
}
