import { type CampaignData, type GenericSystemContent } from '../types/campaign.types.ts';
import { loadCampaign, loadRulesetSystemContent } from '../core/loader.ts';
import { CURRENT_SCHEMA_VERSION } from '../constants/campaign.constants.ts';
import type { RulesetId } from '../types/ruleset.types.ts';

/**
 * Fetches the default campaign data to use as a starting template.
 * @returns A promise resolving to the default CampaignData.
 */
export async function fetchDefaultCampaignData(): Promise<CampaignData> {
  return loadCampaign('default');
}

/**
 * Instantiates a blank slate campaign with minimal bootstrappable content for the specified ruleset.
 * @param rulesetId The target ruleset ID (defaults to 'classic').
 * @param systemContent Optional pre-hydrated Tier 2 system content.
 * @returns A template CampaignData structure.
 */
export function createBlankSlateCampaign(
  rulesetId: RulesetId = 'classic',
  systemContent?: GenericSystemContent
): CampaignData {
  const isDnD = rulesetId === 'dnd35e';

  return {
    manifest: {
      id: isDnD ? 'custom-dnd35e-campaign' : 'custom-campaign',
      name: isDnD ? 'My D&D 3.5e Adventure' : 'My Custom Campaign',
      description: isDnD ? 'A custom D&D 3.5e dungeon crawl.' : 'A custom-built adventure.',
      version: '1.0.0',
      author: 'Unknown',
      tags: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      rulesetId
    },
    ...(systemContent ? { systemContent } : {}),
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
        waterScatterChance: 0,
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
        spawnWeights: isDnD ? { skeleton: 1 } : { goblin: 1 },
        lootTable: {
          health_potion: 1
        },
        lootDropChance: 0
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
        baseValue: 10,
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
        ...(isDnD ? { archetypeId: 'player' } : {}),
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
      ...(isDnD
        ? {
            skeleton: {
              id: 'skeleton',
              name: 'Crypt Skeleton',
              archetypeId: 'skeleton',
              glyph: 'z',
              fg: '#ecf0f1',
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
          }
        : {
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
          })
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
      },
      companion_default: {
        id: 'companion_default',
        behaviors: [
          { behaviorId: 'hunt', aggroRadius: 6 },
          { behaviorId: 'follow', followDistance: 2, leashRadius: 8 }
        ]
      }
    },
    dialogues: {},
    quests: {},
    questTemplates: {},
    triggers: {},
    triggerTemplates: {},
    villains: {},
    schemeRecipes: {},
    phaseBlocks: {},
    agreements: {},
    tagRegistry: {},
    reactions: [],
    fields: {},
    spawnPools: {},
    encounterProfiles: {},
    traitRegistry: {},
    identityGeneration: {},
    personalityGeneration: {},
    nemesisHierarchies: {},
    knowledgePropagation: [],
    rumorPropagation: [],
    relationshipThresholds: [],
    worldEvents: { areaEvents: [], factionEvents: [] }
  };
}

/**
 * Creates a new CampaignData instance, either from an existing template (e.g. 'default', 'dnd35e-crypt')
 * or as a fresh blank slate seeded with the target ruleset and hydrated system content.
 * @param rulesetId The target ruleset ID.
 * @param templateCampaignId Optional campaign ID to clone.
 * @returns A promise resolving to the fully instantiated and hydrated CampaignData.
 */
export async function createNewCampaign(rulesetId: RulesetId, templateCampaignId?: string): Promise<CampaignData> {
  if (templateCampaignId) {
    const loaded = await loadCampaign(templateCampaignId);
    const suffix = Math.floor(performance.now()).toString(36);
    return {
      ...loaded,
      manifest: {
        ...loaded.manifest,
        id: `clone-${loaded.manifest.id}-${suffix}`,
        name: `${loaded.manifest.name} (Copy)`
      }
    };
  }

  const sysContent = await loadRulesetSystemContent(rulesetId);
  return createBlankSlateCampaign(rulesetId, sysContent);
}
