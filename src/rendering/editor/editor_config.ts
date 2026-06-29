import type { CampaignData } from '../../types/campaign.types.ts';

export type ViewPanelType = 'singleton' | 'dictionary' | 'custom';

export interface TabDefinition {
  id: keyof CampaignData | 'simulation' | 'triggerComposer';
  label: string;
  panelType: ViewPanelType;
}

export interface ViewGroup {
  id: string;
  icon: string;
  label: string;
  description?: string;
  tabs: TabDefinition[];
}

export const VIEW_GROUPS: ViewGroup[] = [
  {
    id: 'core',
    icon: '⚙️',
    label: 'Core Config',
    description: "Start here. Define your campaign's identity, game rules, XP progression, and visual theme.",
    tabs: [
      { id: 'manifest', label: 'Manifest', panelType: 'singleton' },
      { id: 'rules', label: 'Rules', panelType: 'singleton' },
      { id: 'theme', label: 'Theme', panelType: 'singleton' },
      { id: 'advancement', label: 'Advancement', panelType: 'singleton' }
    ]
  },
  {
    id: 'actors',
    icon: '🎭',
    label: 'Actors & Inventory',
    description: 'Define status effects, items, entities, AI profiles, and the faction relationship matrix.',
    tabs: [
      { id: 'status', label: 'Status Effects', panelType: 'dictionary' },
      { id: 'effects', label: 'Item Effects', panelType: 'dictionary' },
      { id: 'items', label: 'Items & Equip', panelType: 'dictionary' },
      { id: 'traitRegistry', label: 'Traits', panelType: 'dictionary' },
      { id: 'entities', label: 'Entities', panelType: 'dictionary' },
      { id: 'ai', label: 'AI Profiles', panelType: 'dictionary' },
      { id: 'factions', label: 'Faction Matrix', panelType: 'custom' }
    ]
  },
  {
    id: 'narrative',
    icon: '📖',
    label: 'Narrative Engine',
    description: 'Create interactive dialogues, quests, templates, and event-driven trigger scripts.',
    tabs: [
      { id: 'dialogues', label: 'Dialogues', panelType: 'dictionary' },
      { id: 'quests', label: 'Quests', panelType: 'dictionary' },
      { id: 'questTemplates', label: 'Quest Templates', panelType: 'dictionary' },
      { id: 'triggers', label: 'Triggers', panelType: 'dictionary' },
      { id: 'triggerComposer', label: '⚡ Trigger Composer', panelType: 'custom' }
    ]
  },
  {
    id: 'world',
    icon: '🗺️',
    label: 'World & Encounters',
    description: 'Design tiles, environmental fields, spawn pools, encounter profiles, and procedural map areas.',
    tabs: [
      { id: 'tiles', label: 'Tiles', panelType: 'dictionary' },
      { id: 'fields', label: 'Fields', panelType: 'dictionary' },
      { id: 'spawnPools', label: 'Spawn Pools', panelType: 'dictionary' },
      { id: 'encounterProfiles', label: 'Profiles', panelType: 'dictionary' },
      { id: 'areas', label: 'Areas (Maps)', panelType: 'dictionary' }
    ]
  },
  {
    id: 'adversary',
    icon: '♟️',
    label: 'Adversary Director',
    description: 'Setup villains, scheme recipes, agreements, and nemesis hierarchies.',
    tabs: [
      { id: 'villains', label: 'Villains', panelType: 'dictionary' },
      { id: 'schemeRecipes', label: 'Schemes', panelType: 'dictionary' },
      { id: 'agreements', label: 'Agreements', panelType: 'dictionary' },
      { id: 'nemesisHierarchies', label: 'Nemesis Hierarchies', panelType: 'dictionary' }
    ]
  },
  {
    id: 'tools',
    icon: '🧪',
    label: 'Tools & Lab',
    description: 'Test, balance, and debug your campaign with simulation sandboxes.',
    tabs: [{ id: 'simulation', label: 'Simulation Lab', panelType: 'custom' }]
  }
];
