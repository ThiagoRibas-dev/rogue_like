import { describe, expect, it } from 'bun:test';
import {
  getConsoleThemeMode,
  getConsoleThemeTokens,
  setConsoleThemeMode,
  subscribeConsoleThemeChange
} from '../src/rendering/ui/console_theme.ts';
import { createAbilityScoreState } from '../src/rulesets/dnd35e/abilities.ts';
import { DnD35UIAdapter } from '../src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { DefaultSciFiUIAdapter } from '../src/rulesets/default/ui/default_ui_adapter.ts';
import type { DnD35EntityData } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';

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

  it('evaluates D&D 3.5e Cartridge UI Adapter stats and paper doll models', () => {
    const adapter = new DnD35UIAdapter();
    expect(adapter.rulesetId).toBe('dnd35e');
    expect(adapter.defaultThemeMode).toBe('parchment');

    const dummyActor: DnD35EntityData = {
      entityId: 'hero_1',
      raceId: 'human',
      alignment: 'neutral_good',
      abilityScores: {
        str: createAbilityScoreState(14),
        dex: createAbilityScoreState(21),
        con: createAbilityScoreState(16),
        int: createAbilityScoreState(16),
        wis: createAbilityScoreState(10),
        cha: createAbilityScoreState(12)
      },
      tracks: [
        { trackId: 'swashbuckler', levels: 12 },
        { trackId: 'duelist', levels: 3 }
      ],
      skillRanks: { tumble: 15, balance: 10 },
      feats: ['power_attack', 'weapon_finesse'],
      goldCurrency: 21386
    };

    const sheet = adapter.getCharacterSheetData(dummyActor);
    expect(sheet.name).toBe('Adventurer');
    expect(sheet.levelSummary).toBe('swashbuckler 12 / duelist 3');
    expect(sheet.attributes.find((a) => a.id === 'dex')?.score).toBe(21);
    expect(sheet.attributes.find((a) => a.id === 'dex')?.modifier).toBe(5);
    expect(sheet.savingThrows.length).toBe(3);

    const inv = adapter.getInventoryData(dummyActor);
    expect(inv.equippedSlots.main_hand?.name).toBe("Luskan Battlemage's Rapier");
    expect(inv.goldCurrency).toBe(21386);

    const stances = adapter.getStanceActions(dummyActor);
    expect(stances.some((s) => s.id === 'power_attack')).toBe(true);
    expect(stances.some((s) => s.id === 'fighting_defensively')).toBe(true);
  });

  it('evaluates Default Sci-Fi Cartridge UI Adapter models', () => {
    const adapter = new DefaultSciFiUIAdapter();
    expect(adapter.rulesetId).toBe('default');
    expect(adapter.defaultThemeMode).toBe('retro-crt');

    const sheet = adapter.getCharacterSheetData({});
    expect(sheet.name).toBe('OPERATIVE #1337');
    expect(sheet.attributes.find((a) => a.id === 'dex')?.score).toBe(14);

    const inv = adapter.getInventoryData({});
    expect(inv.stashItems[0]?.name).toBe('Nanite Hypo-Stimpack v2');
    expect(inv.stashItems[0]?.priceGp).toBe(150);
  });

  it('safely handles empty or partial actor payloads in DnD35UIAdapter without throwing', () => {
    const adapter = new DnD35UIAdapter();

    const emptySheet = adapter.getCharacterSheetData({});
    expect(emptySheet.name).toBe('Adventurer');
    expect(emptySheet.attributes.find((a) => a.id === 'str')?.score).toBe(10);
    expect(emptySheet.attributes.find((a) => a.id === 'str')?.modifier).toBe(0);
    expect((emptySheet.attackGroups ?? []).length).toBeGreaterThanOrEqual(3);
    expect((emptySheet.skillRows ?? []).length).toBeGreaterThanOrEqual(8);
    expect((emptySheet.featureEntries ?? []).length).toBeGreaterThanOrEqual(4);
    expect((emptySheet.levelHistory ?? []).length).toBeGreaterThanOrEqual(3);

    const emptyInv = adapter.getInventoryData({});
    expect(emptyInv.maxWeightLbs).toBe(150);
    expect(emptyInv.goldCurrency).toBe(250);
    expect(emptyInv.equippedSlots.main_hand?.name).toBe("Luskan Battlemage's Rapier");
    expect((emptyInv.anatomicalSlots ?? []).length).toBe(12);
  });

  it('builds reactive anatomical slots for humanoid, 6-armed Marilith, and Wild Shape quadruped presets', () => {
    const adapter = new DnD35UIAdapter();

    const humanoidSlots = adapter.buildAnatomicalSlotsForPreset('humanoid');
    expect(humanoidSlots.length).toBe(12);
    expect(humanoidSlots.some((s) => s.isExtraLimb)).toBe(false);

    const marilithSlots = adapter.buildAnatomicalSlotsForPreset('marilith_6arm');
    const extraLimbs = marilithSlots.filter((s) => s.isExtraLimb);
    expect(extraLimbs.length).toBe(5);
    expect(extraLimbs.some((s) => s.slotId === 'arm_3_hand')).toBe(true);
    expect(extraLimbs.some((s) => s.slotId === 'tail_slap')).toBe(true);

    const wolfSlots = adapter.buildAnatomicalSlotsForPreset('quadruped_wolf');
    const suppressedSlots = wolfSlots.filter((s) => s.suppressed);
    expect(suppressedSlots.length).toBeGreaterThanOrEqual(4);
    expect(wolfSlots.some((s) => s.slotId === 'natural_bite' && s.isExtraLimb)).toBe(true);
  });
});

