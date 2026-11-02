import { describe, expect, test } from 'bun:test';
import { loadCampaignFromDisk } from './helpers.ts';
import {
  checkClassicRuleset,
  checkDnD35eRuleset,
  validateDnD35eSystemContentIntegrity,
  getDnD35SystemContent
} from '../src/rulesets/registry.ts';
import type { DnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';

describe('Ruleset-Specific Content & Cartridge Validators', () => {
  describe('Classic Cartridge Validator (checkClassicRuleset)', () => {
    test('passes cleanly with 0 errors on default classic campaign', () => {
      const campaign = loadCampaignFromDisk('default');
      const errors = checkClassicRuleset(campaign);
      expect(errors).toEqual([]);
    });

    test('detects foreign systemContent leaked into a Classic campaign', () => {
      const campaign = loadCampaignFromDisk('default');
      const mutated = {
        ...campaign,
        systemContent: { foreignClasses: { rogue: {} } }
      };
      const errors = checkClassicRuleset(mutated);
      expect(errors.some((e) => e.path === 'campaign.systemContent')).toBe(true);
    });

    test('detects non-monotonic requiredXp in classic advancement table', () => {
      const campaign = loadCampaignFromDisk('default');
      const mutatedAdvancement = [
        ...campaign.advancement.slice(0, 2),
        { ...campaign.advancement[2]!, requiredXp: 50 }, // lower than level 2 (100)
        ...campaign.advancement.slice(3)
      ];
      const mutated = { ...campaign, advancement: mutatedAdvancement };
      const errors = checkClassicRuleset(mutated);
      expect(errors.some((e) => e.path.includes('advancement[2].requiredXp'))).toBe(true);
    });

    test('detects non-positive fighter HP on classic entities', () => {
      const campaign = loadCampaignFromDisk('default');
      const playerEntity = campaign.entities['player'];
      if (playerEntity?.fighter) {
        const mutated = {
          ...campaign,
          entities: {
            ...campaign.entities,
            player: {
              ...playerEntity,
              fighter: { ...playerEntity.fighter, maxHp: 0 }
            }
          }
        };
        const errors = checkClassicRuleset(mutated);
        expect(errors.some((e) => e.path.includes('fighter.maxHp'))).toBe(true);
      }
    });
  });

  describe('D&D 3.5e Cartridge Validator (checkDnD35eRuleset & validateDnD35eSystemContentIntegrity)', () => {
    test('passes cleanly with 0 errors on dnd35e-crypt campaign', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const errors = checkDnD35eRuleset(campaign);
      expect(errors).toEqual([]);
    });

    test('validates loaded D&D 3.5e system content with 0 integrity errors', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      expect(sys).not.toBeNull();
      const errors = validateDnD35eSystemContentIntegrity(sys);
      expect(errors).toEqual([]);
    });

    test('detects inner ID mismatch against dictionary key', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        races: {
          ...sys.races,
          human: {
            ...sys.races['human']!,
            id: 'mismatched_human'
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.races.human.id'))).toBe(true);
    });

    test('detects class progression table length mismatch and non-contiguous row level', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const fighter = sys.classes['fighter']!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        classes: {
          ...sys.classes,
          fighter: {
            ...fighter,
            progression: fighter.progression.slice(0, 19) // 19 rows instead of 20
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.classes.fighter.progression'))).toBe(true);
    });

    test('detects decreasing BAB or saving throw progression', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const rogue = sys.classes['rogue']!;
      const mutatedProgression = [...rogue.progression];
      mutatedProgression[2] = { ...mutatedProgression[2]!, bab: 0 }; // level 3 BAB 0 < level 2 BAB 1
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        classes: {
          ...sys.classes,
          rogue: { ...rogue, progression: mutatedProgression }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.classes.rogue.progression[2]'))).toBe(true);
    });

    test('detects ACF replacing a feature not granted in class progression', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const barbarian = sys.classes['barbarian']!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        classes: {
          ...sys.classes,
          barbarian: {
            ...barbarian,
            acfSwaps: [
              ...barbarian.acfSwaps,
              {
                acfId: 'bogus_swap',
                name: 'Bogus Swap',
                replacesFeature: 'nonexistent_super_rage',
                grantedFeature: 'super_speed',
                level: 3,
                modifiers: []
              }
            ]
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('replacesFeature'))).toBe(true);
    });

    test('detects unknown favoredClass in race definition', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        races: {
          ...sys.races,
          dwarf: {
            ...sys.races['dwarf']!,
            favoredClass: 'space_marine'
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.races.dwarf.favoredClass'))).toBe(true);
    });

    test('detects unknown creatureType in race or template', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        races: {
          ...sys.races,
          human: {
            ...sys.races['human']!,
            creatureType: 'cybernetic_organism'
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.races.human.creatureType'))).toBe(true);
    });

    test('detects unknown race in prerequisite AST race_in predicate', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const arcaneArcher = sys.classes['arcane_archer']!;
      const mutatedSys: DnD35SystemContent = {
        ...sys,
        classes: {
          ...sys.classes,
          arcane_archer: {
            ...arcaneArcher,
            prerequisites: {
              type: 'race_in',
              allowedRaces: ['klingon']
            }
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('prerequisites') && e.message.includes('klingon'))).toBe(true);
    });

    test('detects campaign entity referencing unknown system archetype', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const mutatedCampaign = {
        ...campaign,
        entities: {
          ...campaign.entities,
          phantom_ghost: {
            ...campaign.entities['player']!,
            archetypeId: 'nonexistent_eldritch_horror'
          }
        }
      };
      const errors = checkDnD35eRuleset(mutatedCampaign);
      expect(errors.some((e) => e.path === 'entities.phantom_ghost.archetypeId')).toBe(true);
    });

    test('detects subtype inner ID mismatch and non-sequential race rhdProgression tierIndex', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sys = getDnD35SystemContent(campaign)!;
      const redDragon = sys.races['dragon_red']!;
      const mutatedTiers = [...(redDragon.rhdProgression?.tiers ?? [])];
      mutatedTiers[1] = { ...mutatedTiers[1]!, tierIndex: 99 };

      const mutatedSys: DnD35SystemContent = {
        ...sys,
        subtypes: {
          ...sys.subtypes,
          fire: {
            ...sys.subtypes['fire']!,
            subtypeId: 'wrong_subtype_id'
          }
        },
        races: {
          ...sys.races,
          dragon_red: {
            ...redDragon,
            rhdProgression: {
              ...redDragon.rhdProgression!,
              tiers: mutatedTiers
            }
          }
        }
      };
      const errors = validateDnD35eSystemContentIntegrity(mutatedSys);
      expect(errors.some((e) => e.path.includes('systemContent.subtypes.fire.subtypeId'))).toBe(true);
      expect(errors.some((e) => e.path.includes('systemContent.races.dragon_red.rhdProgression.tiers[1].tierIndex'))).toBe(true);
    });
  });
});
