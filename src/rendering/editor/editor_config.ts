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
  tabs: TabDefinition[];
}

export const VIEW_GROUPS: ViewGroup[] = [
  {
    id: 'core',
    icon: '⚙️',
    label: 'Core Config',
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
    tabs: [{ id: 'simulation', label: 'Simulation Lab', panelType: 'custom' }]
  }
];
