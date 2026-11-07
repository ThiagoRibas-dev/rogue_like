import { describe, expect, it } from 'bun:test';
import {
  getConsoleThemeMode,
  getConsoleThemeTokens,
  setConsoleThemeMode,
  subscribeConsoleThemeChange
} from '../src/rendering/ui/console_theme.ts';
import { DefaultSciFiUIAdapter } from '../src/rulesets/default/ui/default_ui_adapter.ts';
import { createAbilityScoreState } from '../src/rulesets/dnd35e/abilities.ts';
import { type DnD35ExtendedActorData, DnD35UIAdapter } from '../src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';

describe('Console UI Architecture & Cartridge Adapter Suite', () => {
  it('toggles ConsoleThemeMode and updates skin tokens dynamically', () => {
    setConsoleThemeMode('parchment');
    expect(getConsoleThemeMode()).toBe('parchment');
    let tokens = getConsoleThemeTokens();
    expect(tokens.mode).toBe('parchment');
    expect(tokens.bgCanvas).toBe('#1a1410');

    let notifiedMode = '';
    const unsubscribe = subscribeConsoleThemeChange((mode) => {
      notifiedMode = mode;
    });

    setConsoleThemeMode('retro-crt');
    expect(getConsoleThemeMode()).toBe('retro-crt');
    expect(notifiedMode).toBe('retro-crt');
    tokens = getConsoleThemeTokens();
    expect(tokens.mode).toBe('retro-crt');
    expect(tokens.bgCanvas).toBe('#0a0f12');

    unsubscribe();
  });

  it('evaluates D&D 3.5e Cartridge UI Adapter stats and build-driven stances', () => {
    const adapter = new DnD35UIAdapter();
    expect(adapter.rulesetId).toBe('dnd35e');
    expect(adapter.defaultThemeMode).toBe('parchment');

    const dummyActor: DnD35ExtendedActorData = {
      name: 'Valen',
      raceId: 'human',
      alignment: 'NG',
      abilityScores: {
        str: createAbilityScoreState(14),
        dex: createAbilityScoreState(21),
        con: createAbilityScoreState(16),
        int: createAbilityScoreState(16),
        wis: createAbilityScoreState(10),
        cha: createAbilityScoreState(12)
      },
      tracks: [
        {
          trackId: 'swashbuckler',
          levels: 12,
          hitDieSides: 10,
          babCurve: 'full',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'poor',
          skillPointsPerLevel: 4
        },
        {
          trackId: 'duelist',
          levels: 3,
          hitDieSides: 10,
          babCurve: 'full',
          fortCurve: 'poor',
          refCurve: 'good',
          willCurve: 'poor',
          skillPointsPerLevel: 4
        }
      ],
      skillRanks: { tumble: 15, search: 10 },
      feats: ['power_attack', 'weapon_finesse'],
      scalingPools: { turn_undead: 4 },
      goldCurrency: 21386
    };

    const sheet = adapter.getCharacterSheetData(dummyActor);
    expect(sheet.name).toBe('Valen');
    expect(sheet.levelSummary).toBe('swashbuckler 12 / duelist 3');
    expect(sheet.attributes.find((a) => a.id === 'dex')?.score).toBe(21);
    expect(sheet.attributes.find((a) => a.id === 'dex')?.modifier).toBe(5);
    expect(sheet.savingThrows.length).toBe(3);

    const inv = adapter.getInventoryData(dummyActor);
    expect(inv.stashItems.length).toBe(0);
    expect(inv.currentWeightLbs).toBe(0);
    expect(inv.goldCurrency).toBe(21386);

    // Actor has power_attack and turn_undead pool, but NOT combat_expertise
    const hotbar = adapter.getHotbarData(dummyActor);
    expect(hotbar.stanceModes.some((s) => s.id === 'power_attack' && s.maxNumericValue === 15)).toBe(true);
    expect(hotbar.stanceModes.some((s) => s.id === 'combat_expertise')).toBe(false);
    expect(hotbar.stanceModes.some((s) => s.id === 'fighting_defensively')).toBe(true);
    expect(hotbar.stanceModes.some((s) => s.id === 'pool:turn_undead')).toBe(true);
    expect(hotbar.slots.some((sl) => sl.actionPayload?.kind === 'skill' && sl.actionPayload.id === 'search')).toBe(
      true
    );
  });

  it('evaluates Default / Classic Cartridge UI Adapter models without fake items', () => {
    const adapter = new DefaultSciFiUIAdapter();
    expect(adapter.rulesetId).toBe('default');
    expect(adapter.defaultThemeMode).toBe('retro-crt');

    const sheet = adapter.getCharacterSheetData({ name: 'Ranger', level: 5, attack: 14, defense: 12 });
    expect(sheet.name).toBe('Ranger');
    expect(sheet.levelSummary).toBe('Level 5');
    expect(sheet.babTotal).toBe(14);

    const inv = adapter.getInventoryData({});
    expect(inv.stashItems.length).toBe(0);
    expect(inv.currentWeightLbs).toBe(0);
  });

  it('safely handles empty or partial actor payloads in DnD35UIAdapter without injecting fake gear', () => {
    const adapter = new DnD35UIAdapter();

    const emptySheet = adapter.getCharacterSheetData({});
    expect(emptySheet.name).toBe('Adventurer');
    expect(emptySheet.attributes.find((a) => a.id === 'str')?.score).toBe(10);
    expect(emptySheet.attributes.find((a) => a.id === 'str')?.modifier).toBe(0);
    expect((emptySheet.attackGroups ?? []).length).toBe(1);
    expect(emptySheet.attackGroups?.[0]?.label).toBe('Unarmed Strike');
    expect((emptySheet.skillRows ?? []).length).toBe(0);
    expect((emptySheet.featureEntries ?? []).length).toBe(0);

    const emptyInv = adapter.getInventoryData({});
    expect(emptyInv.maxWeightLbs).toBe(150);
    expect(emptyInv.goldCurrency).toBe(0);
    expect(emptyInv.stashItems.length).toBe(0);
    expect(emptyInv.equippedSlots.main_hand).toBeNull();
    expect((emptyInv.anatomicalSlots ?? []).length).toBe(12);
  });

  it('projects dynamic anatomical slots for extra limbs and suppressed Wild Shape slots from actor equipmentSlots', () => {
    const adapter = new DnD35UIAdapter();

    const marilithInv = adapter.getInventoryData({
      anatomyBodyPlan: 'marilith_6arm',
      equipmentSlots: [
        { id: 'main_hand', slotType: 'main_hand', equippedItem: null },
        { id: 'off_hand', slotType: 'off_hand', equippedItem: null },
        { id: 'arm_3_hand', slotType: 'off_hand', equippedItem: null },
        { id: 'arm_4_hand', slotType: 'off_hand', equippedItem: null },
        { id: 'tail_slap', slotType: 'held', equippedItem: null }
      ]
    });
    const slots = marilithInv.anatomicalSlots ?? [];
    expect(slots.length).toBe(5);
    expect(slots.filter((s) => s.isExtraLimb).length).toBe(3);

    const wolfInv = adapter.getInventoryData({
      anatomyBodyPlan: 'quadruped',
      equipmentSlots: [
        { id: 'main_hand', slotType: 'main_hand', equippedItem: null, suppressed: true },
        { id: 'torso', slotType: 'torso', equippedItem: null, suppressed: true },
        { id: 'neck', slotType: 'neck', equippedItem: null, suppressed: false }
      ]
    });
    const wolfSlots = wolfInv.anatomicalSlots ?? [];
    expect(wolfSlots.filter((s) => s.suppressed).length).toBe(2);
  });

  it('provides persistent hotbar model with conditional feat steppers and spellbook slots via Cartridge UI Adapters', () => {
    const dndAdapter = new DnD35UIAdapter();
    const casterActor: DnD35ExtendedActorData = {
      feats: ['combat_expertise'],
      tracks: [
        {
          trackId: 'wizard',
          levels: 5,
          hitDieSides: 4,
          babCurve: 'half',
          fortCurve: 'poor',
          refCurve: 'poor',
          willCurve: 'good',
          skillPointsPerLevel: 2
        }
      ],
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          spellAcquisitionMode: 'spellbook_scribed',
          governingAbility: 'int',
          effectiveCasterLevel: 5,
          maxCastableSpellLevel: 3,
          knownSpellIds: ['fireball', 'magic_missile'],
          preparedSpellIds: ['fireball', 'magic_missile'],
          spellsPerDay: { '1': 3, '3': 1 }
        }
      }
    };

    const dndHotbar = dndAdapter.getHotbarData(casterActor);
    expect(dndHotbar.slots.length).toBe(12);
    expect(dndHotbar.stanceModes.some((s) => s.id === 'combat_expertise' && s.maxNumericValue === 2)).toBe(true);
    expect(dndHotbar.stanceModes.some((s) => s.id === 'power_attack')).toBe(false);
    expect(dndHotbar.slots[0]?.actionPayload?.kind).toBe('spell');
    expect(dndHotbar.slots[0]?.actionPayload?.id).toBe('fireball');
    expect((dndHotbar.actionPips ?? []).length).toBe(4);
  });
});
