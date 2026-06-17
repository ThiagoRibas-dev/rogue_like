import JSZip from 'jszip';
import { type CampaignData, CampaignDataSchema } from '../types/campaign.types.ts';
import { loadCampaign } from '../core/loader.ts';
import { CURRENT_SCHEMA_VERSION } from '../constants/campaign.constants.ts';

// List of the 18 JSON files making up the campaign data package
const CAMPAIGN_FILES: ReadonlyArray<{ readonly key: keyof CampaignData; readonly filename: string }> = [
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
  { key: 'villains', filename: 'villains.json' },
  { key: 'schemes', filename: 'schemes.json' },
  { key: 'agreements', filename: 'agreements.json' },
  { key: 'tagRegistry', filename: 'tag_registry.json' },
  { key: 'reactions', filename: 'reactions.json' }
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

  return result.data;
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

/**
 * Fetches the default campaign data to use as a starting template.
 * @returns A promise resolving to the default CampaignData.
 */
export async function fetchDefaultCampaignData(): Promise<CampaignData> {
  return loadCampaign('default');
}

/**
 * Instantiates a blank slate campaign with minimal bootstrappable content.
 * @returns A template CampaignData structure.
 */
export function createBlankSlateCampaign(): CampaignData {
  return {
    manifest: {
      id: 'custom-campaign',
      name: 'My Custom Campaign',
      description: 'A custom-built adventure.',
      version: '1.0.0',
      author: 'Unknown',
      tags: [],
      schemaVersion: CURRENT_SCHEMA_VERSION
    },
    rules: {
      map: {
        width: 80,
        height: 40,
        minRoomWidth: 6,
        maxRoomWidth: 12,
        minRoomHeight: 6,
        maxRoomHeight: 12,
        minCorridorLength: 2,
        maxCorridorLength: 6,
        dugPercentage: 0.2,
        startingAreaId: 'starting_area',
        fovRadius: 8
      },
      hunger: {
        maxSatiation: 1000,
        thresholds: {
          satiated: 800,
          normal: 300,
          hungry: 100,
          starving: 0
        }
      },
      spawning: {
        maxMonstersPerRoom: 2,
        maxItemsPerRoom: 1,
        spawnWeights: {
          goblin: 1
        },
        lootTable: {
          health_potion: 1
        }
      }
    },
    theme: {
      colors: {
        background: '#000000',
        playerFg: '#ffffff',
        stairsFg: '#f1c40f',
        transparent: 'transparent',
        floorDimFg: '#333333',
        wallDimFg: '#444444'
      },
      glyphs: {
        stairsUp: '<',
        stairsDown: '>'
      },
      ui: {
        displayWidth: 80,
        displayHeight: 40,
        fontSize: 14,
        fontFamily: 'Outfit, sans-serif'
      }
    },
    advancement: [
      {
        level: 1,
        requiredXp: 0,
        hpGain: 10,
        attackGain: 1,
        defenseGain: 1
      },
      {
        level: 2,
        requiredXp: 100,
        hpGain: 10,
        attackGain: 1,
        defenseGain: 1
      }
    ],
    areas: {
      starting_area: {
        id: 'starting_area',
        name: 'The Starting Area',
        generatorType: 'digger',
        dangerRating: 1,
        connections: []
      }
    },
    items: {
      health_potion: {
        id: 'health_potion',
        name: 'Healing Potion',
        unidentifiedName: 'Red Potion',
        description: 'Heals 10 HP.',
        glyph: '!',
        fg: '#e74c3c',
        bg: 'transparent',
        category: 'consumable',
        tags: ['potion', 'healing'],
        weight: 1,
        consumable: {
          effectId: 'heal_light',
          charges: 1
        }
      }
    },
    effects: {
      heal_light: {
        id: 'heal_light',
        type: 'heal',
        value: 10,
        message: 'You feel much better.'
      }
    },
    entities: {
      player: {
        id: 'player',
        name: 'Adventurer',
        glyph: '@',
        fg: '#ffffff',
        bg: 'transparent',
        isActor: true,
        speed: 100,
        fighter: {
          maxHp: 30,
          attack: 5,
          defense: 2
        },
        inventoryConfig: {
          baseCapacity: 10
        },
        equipmentSlots: ['head', 'torso', 'hand']
      },
      goblin: {
        id: 'goblin',
        name: 'Goblin',
        glyph: 'g',
        fg: '#2ecc71',
        bg: 'transparent',
        isActor: true,
        speed: 90,
        fighter: {
          maxHp: 12,
          attack: 3,
          defense: 1,
          xpGiven: 25
        },
        ai: {
          profileId: 'melee_aggro',
          aggroRadius: 6,
          wanders: true
        },
        faction: 'monsters'
      }
    },
    status: {},
    tiles: {
      stone_wall: {
        walkable: false,
        transparent: false,
        glyph: '#',
        fg: '#7f8c8d',
        bg: '#2c3e50'
      },
      stone_floor: {
        walkable: true,
        transparent: true,
        glyph: '.',
        fg: '#7f8c8d',
        bg: 'transparent'
      }
    },
    factions: {
      player: {
        player: 'friendly',
        monsters: 'hostile'
      },
      monsters: {
        player: 'hostile',
        monsters: 'friendly'
      }
    },
    ai: {
      melee_aggro: {
        id: 'melee_aggro',
        behaviors: [{ behaviorId: 'hunt' }, { behaviorId: 'wander' }]
      }
    },
    dialogues: {},
    quests: {},
    questTemplates: {},
    triggers: {},
    villains: {},
    schemes: {},
    agreements: {},
    tagRegistry: {},
    reactions: [],
    fields: {},
    spawnPools: {},
    encounterProfiles: {},
    traitRegistry: {}
  };
}
