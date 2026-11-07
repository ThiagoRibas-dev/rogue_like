import { describe, expect, it } from 'bun:test';
import {
  computeClassLevelSlotSummaries,
  getSpontaneousConversionTargets,
  reconcilePreparedSlots
} from '../src/rulesets/dnd35e/magic/spellbook_slots.ts';
import type { DnD35ClassSpellbookState, DnD35EntityData } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';

describe('D&D 3.5e Spellbook Slot & Spontaneous Casting Engine', () => {
  const mockSystemContent: DnD35SystemContent = {
    classes: {
      cleric: {
        id: 'cleric',
        name: 'Cleric',
        hitDieSides: 8,
        babCurve: 'medium',
        fortCurve: 'good',
        refCurve: 'poor',
        willCurve: 'good',
        skillPointsPerLevel: 2,
        classSkillIds: ['concentration', 'heal'],
        weaponProficiencyIds: ['simple'],
        armorProficiencyIds: ['light', 'medium', 'heavy', 'shield'],
        spellcasting: {
          governingAbility: 'wis',
          castingMode: 'prepared',
          castingTradition: 'divine',
          spellAcquisitionMode: 'prayerbook_full_list'
        },
        progression: [
          {
            level: 1,
            bab: 0,
            fortSave: 2,
            refSave: 0,
            willSave: 2,
            features: ['turn_undead', 'spontaneous_casting'],
            spellsPerDay: { '0': 3, '1': 1 },
            domainSpellSlots: { '1': 1 }
          }
        ]
      },
      wizard: {
        id: 'wizard',
        name: 'Wizard',
        hitDieSides: 4,
        babCurve: 'poor',
        fortCurve: 'poor',
        refCurve: 'poor',
        willCurve: 'good',
        skillPointsPerLevel: 2,
        classSkillIds: ['concentration', 'spellcraft'],
        weaponProficiencyIds: ['simple'],
        armorProficiencyIds: [],
        spellcasting: {
          governingAbility: 'int',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          spellAcquisitionMode: 'spellbook_scribed'
        },
        progression: [
          {
            level: 1,
            bab: 0,
            fortSave: 0,
            refSave: 0,
            willSave: 2,
            features: ['summon_familiar', 'scribe_scroll'],
            spellsPerDay: { '0': 3, '1': 1 }
          }
        ]
      }
    },
    domains: {
      war: {
        id: 'war',
        name: 'War Domain',
        grantedFeatIds: [],
        grantedSpells: { '1': 'magic_weapon' }
      }
    },
    spells: {},
    skills: {},
    feats: {},
    races: {},
    templates: {},
    items: {}
  } as unknown as DnD35SystemContent;

  it('computes Level 0 and 1 slots for a 1st-level Cleric with 14 WIS (+2 mod) and War Domain', () => {
    const book: DnD35ClassSpellbookState = {
      classId: 'cleric',
      castingMode: 'prepared',
      castingTradition: 'divine',
      spellAcquisitionMode: 'prayerbook_full_list',
      governingAbility: 'wis',
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['cure_light_wounds', 'bless', 'guidance'],
      preparedSpellIds: [],
      spellsPerDay: { '0': 3, '1': 1 },
      domainSpellSlots: { '1': 1 }
    };

    const dndData: Partial<DnD35EntityData> = {
      tracks: [{ trackId: 'cleric', levels: 1, babCurve: 'medium', fortCurve: 'good', refCurve: 'poor', willCurve: 'good', skillPointsPerLevel: 2 }],
      domains: ['war']
    };

    const abilities = {
      wis: { base: 14 }
    } as any;

    const summaries = computeClassLevelSlotSummaries(book, dndData, abilities, mockSystemContent);
    const lv0 = summaries.find((s) => s.spellLevel === 0)!;
    const lv1 = summaries.find((s) => s.spellLevel === 1)!;

    // Lv 0: Base 3, 0 bonus slots = 3 slots
    expect(lv0.baseSlots).toBe(3);
    expect(lv0.bonusSlots).toBe(0);
    expect(lv0.generalSlots).toBe(3);
    expect(lv0.domainSlots).toBe(0);
    expect(lv0.totalSlots).toBe(3);

    // Lv 1: Base 1, +1 bonus from 14 WIS, +1 domain slot = 3 slots total
    expect(lv1.baseSlots).toBe(1);
    expect(lv1.bonusSlots).toBe(1);
    expect(lv1.generalSlots).toBe(2);
    expect(lv1.domainSlots).toBe(1);
    expect(lv1.totalSlots).toBe(3);

    const reconciled = reconcilePreparedSlots(book, summaries);
    expect(reconciled.filter((s) => s.spellLevel === 0).length).toBe(3);
    expect(reconciled.filter((s) => s.spellLevel === 1 && s.slotKind === 'general').length).toBe(2);
    expect(reconciled.filter((s) => s.spellLevel === 1 && s.slotKind === 'domain').length).toBe(1);
  });

  it('computes Wizard specialist slot for an Evoker with 16 INT', () => {
    const book: DnD35ClassSpellbookState = {
      classId: 'wizard',
      castingMode: 'prepared',
      castingTradition: 'arcane',
      spellAcquisitionMode: 'spellbook_scribed',
      governingAbility: 'int',
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['magic_missile'],
      preparedSpellIds: [],
      spellsPerDay: { '0': 3, '1': 1 }
    };

    const dndData: Partial<DnD35EntityData> = {
      tracks: [{ trackId: 'wizard', levels: 1, babCurve: 'poor', fortCurve: 'poor', refCurve: 'poor', willCurve: 'good', skillPointsPerLevel: 2 }],
      arcaneSchool: 'evocation'
    };

    const abilities = {
      int: { base: 16 }
    } as any;

    const summaries = computeClassLevelSlotSummaries(book, dndData, abilities, mockSystemContent);
    const lv1 = summaries.find((s) => s.spellLevel === 1)!;

    // Lv 1: Base 1, +1 bonus from 16 INT, +1 specialist slot = 3 slots
    expect(lv1.baseSlots).toBe(1);
    expect(lv1.bonusSlots).toBe(1);
    expect(lv1.generalSlots).toBe(2);
    expect(lv1.specialistSlots).toBe(1);
    expect(lv1.totalSlots).toBe(3);
  });

  it('returns spontaneous conversion options for Cleric (Cure Wounds)', () => {
    const dndData: Partial<DnD35EntityData> = {
      alignment: 'LG'
    };

    const targets = getSpontaneousConversionTargets('cleric', 1, dndData, mockSystemContent);
    expect(targets.length).toBe(1);
    expect(targets[0]!.spellId).toBe('cure_light_wounds');
  });
});
