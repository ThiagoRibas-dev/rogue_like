import { z } from 'zod';
import { AUTHORING_LEVELS } from '../../constants/campaign.constants.ts';
import { type CampaignData, CampaignDataSchema, unwrapZodSchema } from '../../types/campaign.types.ts';
import type { TabDefinition, ViewGroup, ViewPanelType } from '../../types/ruleset.types.ts';

export type { ViewPanelType, TabDefinition, ViewGroup };

/** Canonical Activity Bar group identifiers for the Campaign Editor. */
export type EditorGroupId = 'core' | 'actors' | 'narrative' | 'world' | 'adversary' | 'tools';

/** Compile-time exhaustive metadata descriptor for each top-level `CampaignData` key. */
export interface CampaignCategoryMeta {
  readonly groupId: EditorGroupId;
  readonly label: string;
  readonly customPanel?: boolean | undefined;
}

/** Static Activity Bar group definitions. */
const EDITOR_GROUP_DEFS: ReadonlyArray<{
  readonly id: EditorGroupId;
  readonly icon: string;
  readonly label: string;
  readonly description: string;
}> = [
  {
    id: 'core',
    icon: '⚙️',
    label: 'Core Config',
    description: "Start here. Define your campaign's identity, game rules, XP progression, and visual theme."
  },
  {
    id: 'actors',
    icon: '🎭',
    label: 'Actors & Inventory',
    description: 'Define status effects, items, entities, AI profiles, and the faction relationship matrix.'
  },
  {
    id: 'narrative',
    icon: '📖',
    label: 'Narrative Engine',
    description: 'Create interactive dialogues, quests, templates, and event-driven trigger scripts.'
  },
  {
    id: 'world',
    icon: '🗺️',
    label: 'World & Encounters',
    description: 'Design tiles, environmental fields, spawn pools, encounter profiles, and procedural map areas.'
  },
  {
    id: 'adversary',
    icon: '♟️',
    label: 'Adversary Director',
    description: 'Setup villains, scheme recipes, agreements, and nemesis hierarchies.'
  },
  {
    id: 'tools',
    icon: '🧪',
    label: 'Tools & Lab',
    description: 'Test, balance, and debug your campaign with simulation sandboxes.'
  }
];

/**
 * Compile-time exhaustive category metadata mapping every `keyof CampaignData`
 * to its Activity Bar group, human label, and optional custom-panel override.
 * Adding a new key to `CampaignDataSchema` enforces adding its entry here via TypeScript.
 */
export const CAMPAIGN_CATEGORY_META: Readonly<Record<keyof CampaignData, CampaignCategoryMeta>> = {
  manifest: { groupId: 'core', label: 'Manifest' },
  rules: { groupId: 'core', label: 'Rules & Simulation' },
  theme: { groupId: 'core', label: 'Theme & Sprites' },
  advancement: { groupId: 'core', label: 'Advancement' },
  tagRegistry: { groupId: 'core', label: 'Tag Registry' },
  worldEvents: { groupId: 'core', label: 'World Events' },
  systemContent: { groupId: 'core', label: 'System Overrides' },

  status: { groupId: 'actors', label: 'Status Effects' },
  effects: { groupId: 'actors', label: 'Item Effects' },
  items: { groupId: 'actors', label: 'Items & Equip' },
  traitRegistry: { groupId: 'actors', label: 'Traits' },
  entities: { groupId: 'actors', label: 'Entities' },
  ai: { groupId: 'actors', label: 'AI Profiles' },
  identityGeneration: { groupId: 'actors', label: 'Identity Tables' },
  personalityGeneration: { groupId: 'actors', label: 'Personality Tables' },
  relationshipThresholds: { groupId: 'actors', label: 'Relation Thresholds' },
  factions: { groupId: 'actors', label: 'Faction Matrix', customPanel: true },

  dialogues: { groupId: 'narrative', label: 'Dialogues' },
  quests: { groupId: 'narrative', label: 'Quests' },
  questTemplates: { groupId: 'narrative', label: 'Quest Templates' },
  knowledgePropagation: { groupId: 'narrative', label: 'Knowledge Rules' },
  rumorPropagation: { groupId: 'narrative', label: 'Rumor Rules' },
  triggers: { groupId: 'narrative', label: 'Triggers' },
  triggerTemplates: { groupId: 'narrative', label: 'Trigger Templates' },
  triggerBuckets: { groupId: 'narrative', label: 'Trigger Buckets' },

  tiles: { groupId: 'world', label: 'Tiles' },
  fields: { groupId: 'world', label: 'Fields' },
  reactions: { groupId: 'world', label: 'Field Reactions' },
  spawnPools: { groupId: 'world', label: 'Spawn Pools' },
  encounterProfiles: { groupId: 'world', label: 'Encounter Profiles' },
  areas: { groupId: 'world', label: 'Areas (Maps)' },

  villains: { groupId: 'adversary', label: 'Villains' },
  schemeRecipes: { groupId: 'adversary', label: 'Schemes' },
  phaseBlocks: { groupId: 'adversary', label: 'Phase Blocks' },
  agreements: { groupId: 'adversary', label: 'Agreements' },
  nemesisHierarchies: { groupId: 'adversary', label: 'Nemesis Hierarchies' }
};

/**
 * Resolves the editor panel mode for a top-level `CampaignData` category directly
 * from `CampaignDataSchema.shape` (`z.ZodRecord` -> `'dictionary'`, otherwise `'singleton'`,
 * or `'custom'` when flagged in `CAMPAIGN_CATEGORY_META`).
 *
 * @param key Top-level `CampaignData` key.
 * @returns Resolved `ViewPanelType`.
 */
export function resolveCategoryPanelType(key: keyof CampaignData): ViewPanelType {
  const meta = CAMPAIGN_CATEGORY_META[key];
  if (meta.customPanel) {
    return 'custom';
  }
  const raw = unwrapZodSchema(CampaignDataSchema.shape[key]);
  return raw instanceof z.ZodRecord ? 'dictionary' : 'singleton';
}

/**
 * Returns the authoring level (`Static`, `Blueprint`, or `Dynamic`) for a campaign category.
 *
 * @param key Top-level `CampaignData` key.
 * @returns Authoring level badge string.
 */
export function getCategoryAuthoringLevel(key: keyof CampaignData): 'Static' | 'Blueprint' | 'Dynamic' {
  return AUTHORING_LEVELS[key] ?? 'Static';
}

/**
 * Builds the Campaign Editor Activity Bar groups automatically from `CampaignDataSchema.shape`
 * and `CAMPAIGN_CATEGORY_META`, plus custom tool tabs (`triggerComposer`, `simulation`).
 */
function buildEditorViewGroups(): ViewGroup[] {
  const tabsByGroup = new Map<EditorGroupId, TabDefinition[]>();
  for (const def of EDITOR_GROUP_DEFS) {
    tabsByGroup.set(def.id, []);
  }

  for (const key of Object.keys(CampaignDataSchema.shape) as Array<keyof CampaignData>) {
    const meta = CAMPAIGN_CATEGORY_META[key];
    const targetList = tabsByGroup.get(meta.groupId) ?? tabsByGroup.get('core');
    targetList?.push({
      id: key,
      label: meta.label,
      panelType: resolveCategoryPanelType(key)
    });
  }

  // Append custom tool workspaces cleanly in their canonical groups
  tabsByGroup.get('narrative')?.push({
    id: 'triggerComposer',
    label: '⚡ Trigger Composer',
    panelType: 'custom'
  });
  tabsByGroup.get('tools')?.push({
    id: 'simulation',
    label: 'Simulation Lab',
    panelType: 'custom'
  });

  return EDITOR_GROUP_DEFS.map((def) => ({
    id: def.id,
    icon: def.icon,
    label: def.label,
    description: def.description,
    tabs: tabsByGroup.get(def.id) ?? []
  }));
}

/** Auto-discovered Campaign Editor Activity Bar view groups covering 100% of `CampaignDataSchema`. */
export const VIEW_GROUPS: ViewGroup[] = buildEditorViewGroups();
