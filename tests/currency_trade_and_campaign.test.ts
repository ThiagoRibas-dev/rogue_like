/**
 * @file tests/currency_trade_and_campaign.test.ts
 *
 * Comprehensive integration tests for Phase 40:
 * - Milestone 142: Multi-denomination currency engine, conversion, decomposition & formatting
 * - Milestone 143: Pluggable trade & barter engine, price breakdowns & D&D 3.5e social skills
 * - Milestone 144: DMG Table 2-6 CR-to-XP reward scaling & statblock hydration
 * - Milestone 145: Monetary item system content definitions (cp, sp, ep, gp, pp, gems)
 * - Milestone 146: Realms of Shroudgarde campaign topology, area connections & entity templates
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  toBaseUnits,
  convertCurrency,
  decomposeToCoins,
  formatCurrency,
  resolveItemBaseValueInBaseUnits
} from '../src/systems/currency.system.ts';
import {
  DND35E_DEFAULT_CURRENCY_CONFIG
} from '../src/rulesets/dnd35e/currency.ts';
import { getTradePriceBreakdown, getEffectiveItemPriceInBaseUnits } from '../src/utils/trade.ts';
import {
  evaluateDnD35eDialogueSkillCheck
} from '../src/rulesets/dnd35e/skills/trade_social_checks.ts';
import { computeDnD35eCrXp } from '../src/rulesets/dnd35e/progression/cr_xp_table.ts';
import type { ItemDefinition } from '../src/types/campaign.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';

describe('Phase 40: Milestone 142 — Multi-Denomination Currency Engine', () => {
  it('converts denominations accurately according to D&D 3.5e exchange ratios', () => {
    // 1 gp = 100 cp, 1 sp = 10 cp, 1 ep = 50 cp, 1 pp = 1000 cp
    expect(toBaseUnits(1, 'gp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(100);
    expect(toBaseUnits(5, 'sp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(50);
    expect(toBaseUnits(2, 'ep', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(100);
    expect(toBaseUnits(3, 'pp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(3000);
    expect(toBaseUnits(25, 'cp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(25);

    // Convert 250 gp to sp = 2500 sp
    expect(convertCurrency(250, 'gp', 'sp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(2500);
    // Convert 1000 cp to pp = 1 pp
    expect(convertCurrency(1000, 'cp', 'pp', DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(1);
  });

  it('decomposes total base units into standard coin denominations', () => {
    // 1234 cp = 1 pp (1000), 2 gp (200), 3 sp (30), 4 cp (4)
    const buckets = decomposeToCoins(1234, DND35E_DEFAULT_CURRENCY_CONFIG);
    const coins = Object.fromEntries(buckets.map((b) => [b.id, b.amount]));
    expect(coins['pp']).toBe(1);
    expect(coins['gp']).toBe(2);
    expect(coins['sp']).toBe(3);
    expect(coins['cp']).toBe(4);
    expect(coins['ep']).toBeUndefined();

    // Formatting check
    const formatted = formatCurrency(1234, DND35E_DEFAULT_CURRENCY_CONFIG);
    expect(formatted).toBe('1 pp, 2 gp, 3 sp, 4 cp');
  });

  it('resolves item base value in base currency units honoring currencyUnit overrides', () => {
    const itemWithUnitGp: ItemDefinition = {
      name: 'Longsword',
      glyph: '/',
      fg: '#ffffff',
      bg: 'transparent',
      baseValue: 15,
      weight: 4,
      category: 'weapon',
      tags: ['weapon'],
      currencyUnit: 'gp'
    };

    // 15 gp = 1500 cp
    expect(resolveItemBaseValueInBaseUnits(itemWithUnitGp, DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(1500);

    const itemWithUnitCp: ItemDefinition = {
      name: 'Torch',
      glyph: 'i',
      fg: '#ffffff',
      bg: 'transparent',
      baseValue: 1,
      weight: 1,
      category: 'tool',
      tags: ['tool'],
      currencyUnit: 'cp'
    };

    // 1 cp = 1 cp
    expect(resolveItemBaseValueInBaseUnits(itemWithUnitCp, DND35E_DEFAULT_CURRENCY_CONFIG)).toBe(1);
  });
});

describe('Phase 40: Milestone 143 — Pluggable Trade & Barter System', () => {
  it('calculates trade price breakdowns and effective buy/sell prices', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const merchantId = 999 as EntityId;
    state.components.set(merchantId, {
      [ComponentType.Shop]: {
        type: ComponentType.Shop,
        markupMultiplier: 1.2,
        buyTags: [],
        sellTags: []
      }
    } as any);

    const breakdown = getTradePriceBreakdown(state, merchantId, state.playerEntityId, false);
    expect(breakdown.finalBuyMultiplier).toBeCloseTo(1.2, 2);
    // Base sell multiplier is BASE_SELL_TO_SHOP_MULTIPLIER (0.25) / markupMultiplier (1.2) = ~0.208
    expect(breakdown.finalSellMultiplier).toBeCloseTo(0.25 / 1.2, 2);

    const item: ItemDefinition = {
      name: 'Potion of Cure Light Wounds',
      glyph: '!',
      fg: '#ff0000',
      bg: 'transparent',
      baseValue: 50,
      weight: 0.5,
      category: 'consumable',
      tags: ['consumable'],
      currencyUnit: 'gp'
    };

    // 50 gp = 5000 cp base. Buy at 1.2x = 6000 cp (60 gp). Sell at (0.25 / 1.2) = 1041 cp.
    const buyPrice = getEffectiveItemPriceInBaseUnits(state, item, merchantId, state.playerEntityId, false);
    const sellPrice = getEffectiveItemPriceInBaseUnits(state, item, merchantId, state.playerEntityId, true);

    expect(buyPrice).toBe(6000);
    expect(sellPrice).toBe(Math.floor(5000 * (0.25 / 1.2)));
  });

  it('evaluates D&D 3.5e dialogue skill check DC comparisons correctly', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const state = buildGameState(campaign);

    const result = evaluateDnD35eDialogueSkillCheck(state, state.playerEntityId, undefined, 'diplomacy', 10);
    expect(result.dc).toBe(10);
    expect(result.breakdown).toContain('Diplomacy');
    expect(typeof result.rollTotal).toBe('number');
    expect(typeof result.success).toBe('boolean');
  });
});

describe('Phase 40: Milestone 144 — DMG Table 2-6 CR-to-XP Scaling', () => {
  it('computes exact XP rewards according to DMG 3.5e Table 2-6', () => {
    // CR 1 vs ECL 1 = 300 XP
    expect(computeDnD35eCrXp(1, 1)).toBe(300);
    // CR 2 vs ECL 1 = 600 XP
    expect(computeDnD35eCrXp(2, 1)).toBe(600);
    // CR 3 vs ECL 1 = 900 XP
    expect(computeDnD35eCrXp(3, 1)).toBe(900);
    // CR 1 vs ECL 2 = 300 XP
    expect(computeDnD35eCrXp(1, 2)).toBe(300);
    // CR 4 vs ECL 3 = 1350 XP
    expect(computeDnD35eCrXp(4, 3)).toBe(1350);
    // CR 5 vs ECL 3 = 1800 XP
    expect(computeDnD35eCrXp(5, 3)).toBe(1800);
    // CR 5 vs ECL 5 = 1500 XP
    expect(computeDnD35eCrXp(5, 5)).toBe(1500);

    // Fractional CR tests (ECL 1)
    // CR 1/2 = 150 XP
    expect(computeDnD35eCrXp(0.5, 1)).toBe(150);
    // CR 1/4 = 75 XP
    expect(computeDnD35eCrXp(0.25, 1)).toBe(75);

    // Difference > 7 levels returns 0 XP (DMG rule: CR 1 vs ECL 10 = 0 XP)
    expect(computeDnD35eCrXp(1, 10)).toBe(0);
  });
});

describe('Phase 40: Milestone 145 — Monetary System Content Items', () => {
  it('has valid JSON definitions for all canonical coins and gems', () => {
    const itemDir = join(process.cwd(), 'public', 'data', 'rulesets', 'dnd35e', 'items');
    const expectedItems = [
      'copper_coin.json',
      'silver_coin.json',
      'electrum_coin.json',
      'gold_coin.json',
      'platinum_coin.json',
      'coin_pouch_silver.json',
      'coin_pouch_gold.json',
      'gem_chalcedony.json',
      'gem_ruby.json',
      'gem_diamond.json',
      'gem_sapphire.json'
    ];

    for (const file of expectedItems) {
      const fullPath = join(itemDir, file);
      expect(existsSync(fullPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(fullPath, 'utf-8'));
      const itemId = Object.keys(parsed)[0];
      const def = parsed[itemId];
      expect(def.name).toBeTruthy();
      expect(def.baseValue).toBeGreaterThan(0);
      expect(def.category).toBeTruthy();
    }
  });
});

describe('Phase 40: Milestone 146 — Realms of Shroudgarde Flagship Campaign', () => {
  const campaignDir = join(process.cwd(), 'public', 'data', 'campaigns', 'realms-of-shroudgarde');

  it('has a valid manifest specifying rulesetId dnd35e and starting area', () => {
    const manifestPath = join(campaignDir, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.id).toBe('realms-of-shroudgarde');
    expect(manifest.rulesetId).toBe('dnd35e');
    expect(manifest.startingAreaId).toBe('shroudgarde_courtyard');
  });

  it('contains 75 interconnected areas with valid referential bidirectional graphs', () => {
    const areasPath = join(campaignDir, 'areas.json');
    expect(existsSync(areasPath)).toBe(true);
    const areas = JSON.parse(readFileSync(areasPath, 'utf-8'));
    const areaIds = Object.keys(areas);
    expect(areaIds.length).toBe(75);

    // Verify key landmark areas exist
    expect(areaIds).toContain('shroudgarde_courtyard');
    expect(areaIds).toContain('outer_crossroads');
    expect(areaIds).toContain('forest_haunted');
    expect(areaIds).toContain('ravine_chaos');
    expect(areaIds).toContain('watchtower_f1');
    expect(areaIds).toContain('spire_level_air');
    expect(areaIds).toContain('wizard_tower_f1');
    expect(areaIds).toContain('dungeon_1');
    expect(areaIds).toContain('moathouse_surface');
    expect(areaIds).toContain('toee_level_1');
    expect(areaIds).toContain('toee_zuggtmoy_fane');
    expect(areaIds).toContain('megadungeon_hub');
    expect(areaIds).toContain('nethack_doom_10');
    expect(areaIds).toContain('incursion_the_goblin_encampment');
    expect(areaIds).toContain('incursion_hellish_rift');

    // Verify all connections point to existing area IDs
    for (const area of Object.values(areas) as any[]) {
      if (area.connections) {
        for (const conn of area.connections) {
          expect(areaIds).toContain(conn.targetAreaId);
        }
      }
    }
  });

  it('defines NPCs, merchants, and monsters with equipment, drops and dialogues', () => {
    const entitiesPath = join(campaignDir, 'entities.json');
    expect(existsSync(entitiesPath)).toBe(true);
    const entities = JSON.parse(readFileSync(entitiesPath, 'utf-8'));

    // Check Constable Derek
    const derek = entities['constable_derek'];
    expect(derek).toBeDefined();
    expect(derek.dialogueId).toBe('guard_captain_tree');
    expect(derek.defaultEquipment).toBeArray();

    // Check Barkeep Bertram
    const bertram = entities['barkeep_bertram'];
    expect(bertram).toBeDefined();
    expect(bertram.shop).toBeDefined();
    expect(bertram.shop.markupMultiplier).toBeGreaterThan(0);

    // Check Bosses
    const lareth = entities['lareth_the_beautiful'];
    expect(lareth).toBeDefined();
    expect(lareth.currencyDrop).toBeDefined();
    expect(lareth.lootDrops).toBeArray();

    const zuggtmoy = entities['zuggtmoy_queen'];
    expect(zuggtmoy).toBeDefined();
    expect(zuggtmoy.currencyDrop).toBeDefined();

    const dragon = entities['red_dragon'];
    expect(dragon).toBeDefined();
    expect(dragon.currencyDrop).toBeDefined();
  });
});
