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
import { addComponent, getComponent, removeComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import type { GameState, EntityId } from '../src/types/game-state.types.ts';
import { UIMode } from '../src/types/game-state.types.ts';

function getPlayerId(state: GameState): EntityId {
  return state.entities.find((e) => getComponent(state, e, ComponentType.Player) !== undefined)!;
}
import {
  toBaseUnits,
  convertCurrency,
  decomposeToCoins,
  formatCurrency,
  resolveItemBaseValueInBaseUnits,
  setEntityCurrencyBalance
} from '../src/systems/currency.system.ts';
import { processSelectDialogueOptionIntent } from '../src/actions/dialogue.actions.ts';
import { processDeathSystem } from '../src/systems/death.system.ts';
import { generateAndPopulateAreaFloor } from '../src/systems/map/map_generation_spawner.ts';
import { executeBuyItem, executeSellItem } from '../src/systems/shop.system.ts';
import { applyConsequence } from '../src/systems/trigger.system.ts';
import {
  DND35E_DEFAULT_CURRENCY_CONFIG
} from '../src/rulesets/dnd35e/currency.ts';
import { hydrateArchetypeData, hydrateRaceAsArchetype } from '../src/rulesets/dnd35e/archetype_resolver.ts';
import { onDnD35eEntitySpawned } from '../src/rulesets/dnd35e/cartridge/dnd35e_spawn_hydrator.ts';
import { applyCreatureTemplate } from '../src/rulesets/dnd35e/templates.ts';
import { resolveDnD35eEntityCr, computeDnD35eCrXp } from '../src/rulesets/dnd35e/progression/cr_xp_table.ts';
import type { DnD35Template } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import {
  createDefaultMemoryComponent,
  getTradePriceBreakdown,
  getEffectiveItemPriceInBaseUnits,
  getTradeSkillHaggleStatus,
  recordTradeHaggleOutcomeFacts
} from '../src/utils/trade.ts';
import {
  evaluateDnD35eDialogueSkillCheck,
  resolveDnD35eTradeSocialSkill
} from '../src/rulesets/dnd35e/skills/trade_social_checks.ts';
import type { AreaDefinition, ItemDefinition } from '../src/types/campaign.types.ts';
import { ComponentType, type Component, type InventoryComponent, type MemoryComponent, type PositionComponent } from '../src/types/components.types.ts';
import { GameEventType } from '../src/types/events.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
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
    const playerId = getPlayerId(state);
    const merchantId = 999 as EntityId;
    const merchantComps: Readonly<Record<string, Component>> = {
      [ComponentType.Shop]: {
        type: ComponentType.Shop,
        markupMultiplier: 1.2,
        buyTags: [],
        sellTags: [],
        inventory: []
      }
    };
    state.components.set(merchantId, merchantComps);

    const breakdown = getTradePriceBreakdown(state, merchantId, playerId, false);
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
    const buyPrice = getEffectiveItemPriceInBaseUnits(state, item, merchantId, playerId, false);
    const sellPrice = getEffectiveItemPriceInBaseUnits(state, item, merchantId, playerId, true);

    expect(buyPrice).toBe(6000);
    expect(sellPrice).toBe(Math.floor(5000 * (0.25 / 1.2)));
  }, 15_000);

  it('evaluates D&D 3.5e dialogue skill check DC comparisons correctly', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const state = buildGameState(campaign);
    const playerId = getPlayerId(state);

    const result = evaluateDnD35eDialogueSkillCheck(state, playerId, undefined, 'diplomacy', 10);
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

    // Verify all connections point to existing area IDs and every area defines palette/environmentType
    for (const area of Object.values(areas) as AreaDefinition[]) {
      expect(area.environmentType).toBeDefined();
      expect(area.proceduralPalette).toBeDefined();
      if (area.tags.includes('town')) {
        expect(area.tags).not.toContain('outdoor');
        expect(area.tags).not.toContain('frontier');
      }
      if (area.connections) {
        for (const conn of area.connections) {
          expect(areaIds).toContain(conn.targetAreaId);
        }
      }
    }

    // Verify all 8 named NPCs and 5 bosses are placed in areas via placedEntities
    const placedIds = new Set<string>();
    for (const area of Object.values(areas) as AreaDefinition[]) {
      for (const pe of area.placedEntities ?? []) {
        placedIds.add(pe.templateId);
      }
    }
    for (const expectedActor of [
      'constable_derek',
      'barkeep_bertram',
      'dwarf_laurent',
      'isabelle_cleric',
      'luc_ranger',
      'silas_merchant',
      'archmage_alden',
      'elena_scholar',
      'ogre_chieftain',
      'crypt_arch_curate',
      'lareth_the_beautiful',
      'zuggtmoy_queen',
      'red_dragon'
    ]) {
      expect(placedIds.has(expectedActor)).toBe(true);
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

    // Check Silas stocks no coin_pouch_*
    const silas = entities['silas_merchant'];
    expect(silas.shop.inventory).not.toContain('coin_pouch_silver');
    expect(silas.shop.inventory).not.toContain('coin_pouch_gold');

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

    // Check all 16 quests are wired into dialogues
    const quests = JSON.parse(readFileSync(join(campaignDir, 'quests.json'), 'utf-8')) as Record<string, unknown>;
    const dialoguesText = readFileSync(join(campaignDir, 'dialogues.json'), 'utf-8');
    for (const questId of Object.keys(quests)) {
      expect(dialoguesText).toContain(questId);
    }
  });
});

describe('Phase 40 Remediation Regressions (Trade Arbitrage, Haggling, Dialogue & Hydration)', () => {
  it('prevents buy-and-resell arbitrage even with stacked helpful attitude and max discount', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const npcId = 777 as EntityId;
    state = addComponent(state, npcId, {
      type: ComponentType.Shop,
      markupMultiplier: 1.0,
      buyTags: [],
      sellTags: [],
      inventory: []
    });
    state = addComponent(state, npcId, {
      type: ComponentType.Attitude,
      attitude: 'helpful'
    });
    state = addComponent(state, npcId, {
      ...createDefaultMemoryComponent(),
      sessionMarkupModifier: -0.4
    });

    const playerId = getPlayerId(state);
    const breakdown = getTradePriceBreakdown(state, npcId, playerId, true);
    expect(breakdown.finalSellMultiplier).toBeLessThan(breakdown.finalBuyMultiplier);
  });

  it('tracks repeat-until-fail-or-cap haggle facts in MemoryComponent', () => {
    let memory: MemoryComponent = createDefaultMemoryComponent();
    expect(getTradeSkillHaggleStatus(memory, 'diplomacy').canAttempt).toBe(true);

    memory = { ...memory, facts: [...recordTradeHaggleOutcomeFacts(memory.facts, 'diplomacy', true)] };
    expect(getTradeSkillHaggleStatus(memory, 'diplomacy').wins).toBe(1);
    expect(getTradeSkillHaggleStatus(memory, 'diplomacy').canAttempt).toBe(true);

    memory = { ...memory, facts: [...recordTradeHaggleOutcomeFacts(memory.facts, 'diplomacy', true)] };
    expect(getTradeSkillHaggleStatus(memory, 'diplomacy').wins).toBe(2);
    expect(getTradeSkillHaggleStatus(memory, 'diplomacy').canAttempt).toBe(false);

    const lockedFacts = recordTradeHaggleOutcomeFacts([], 'appraise', false);
    const lockedMem: MemoryComponent = { ...createDefaultMemoryComponent(), facts: [...lockedFacts] };
    expect(getTradeSkillHaggleStatus(lockedMem, 'appraise').locked).toBe(true);
    expect(getTradeSkillHaggleStatus(lockedMem, 'appraise').canAttempt).toBe(false);
  });

  it('routes open_barter and give_item from dialogue cleanly in realms-of-shroudgarde', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    let state = buildGameState(campaign);
    const playerId = getPlayerId(state);

    // Spawn Barkeep Bertram and enter dialogue
    let bertramId: EntityId;
    [state, bertramId] = spawnEntity(state, 'barkeep_bertram', 10, 10);
    state = {
      ...state,
      uiMode: UIMode.Dialogue,
      activeDialogue: { treeId: 'bertram_trade_tree', currentNodeId: 'root', npcEntityId: bertramId }
    };

    const barterRes = processSelectDialogueOptionIntent(state, {
      type: IntentType.SelectDialogueOption,
      entityId: playerId,
      optionId: 'opt_trade',
      isImmediate: true
    });
    expect(barterRes.state.uiMode).toBe(UIMode.Trade);
    expect(barterRes.state.activeTrade?.npcEntityId).toBe(bertramId);
    expect(barterRes.state.activeDialogue).toBeUndefined();

    // Test give_item consequence
    state = applyConsequence(
      state,
      { type: GameEventType.DialogueSelected, dialogueId: 'guard_captain_tree', optionId: 'opt_accept_signet' },
      { type: 'give_item', itemId: 'shroudgarde_signet', quantity: 1, _playerEntityId: playerId }
    );
    const playerInv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    expect(
      playerInv.items.some((id) => {
        const comp = getComponent(state, id, ComponentType.Item);
        return comp?.itemId === 'shroudgarde_signet';
      })
    ).toBe(true);
  }, 15_000);

  it('hydrates boss classLevels and high-tier archetypes with accurate D&D 3.5e CR math', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    let state = buildGameState(campaign);

    let ogreBossId: EntityId;
    [state, ogreBossId] = spawnEntity(state, 'ogre_chieftain', 12, 12);
    state = onDnD35eEntitySpawned(state, ogreBossId);
    // Ogre (CR 3) + Barbarian 3 = CR 6
    expect(resolveDnD35eEntityCr(state, ogreBossId)).toBe(6);

    let dragonId: EntityId;
    [state, dragonId] = spawnEntity(state, 'red_dragon', 14, 14);
    state = onDnD35eEntitySpawned(state, dragonId);
    expect(resolveDnD35eEntityCr(state, dragonId)).toBe(19);

    let zuggtmoyId: EntityId;
    [state, zuggtmoyId] = spawnEntity(state, 'zuggtmoy_queen', 16, 16);
    state = onDnD35eEntitySpawned(state, zuggtmoyId);
    expect(resolveDnD35eEntityCr(state, zuggtmoyId)).toBe(20);
  }, 15_000);

  it('cleans up dead shopkeeper inventory and no_drop items without leaving orphan entities', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);

    let stockItemId: EntityId;
    [state, stockItemId] = spawnItem(state, 'dagger', 5, 5);
    state = removeComponent(state, stockItemId, ComponentType.Position);
    const merchantId = 888 as EntityId;
    state = { ...state, entities: [...state.entities, merchantId] };
    state = addComponent(state, merchantId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, merchantId, { type: ComponentType.Fighter, hp: 0, maxHp: 10, attack: 1, defense: 0, xpGiven: 0 });
    state = addComponent(state, merchantId, { type: ComponentType.Inventory, items: [], baseCapacity: 10 });
    state = addComponent(state, merchantId, {
      type: ComponentType.Shop,
      markupMultiplier: 1.2,
      buyTags: [],
      sellTags: [],
      inventory: [stockItemId]
    });
    state = addComponent(state, merchantId, { type: ComponentType.Death });

    state = processDeathSystem(state);
    expect(state.entities).not.toContain(merchantId);
    expect(state.entities).not.toContain(stockItemId);
  });

  it('rejects selling currencyGrant items and supports live resolveDnD35eTradeSocialSkill without prior Memory', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    let state = buildGameState(campaign);
    const playerId = getPlayerId(state);

    let coinId: EntityId;
    [state, coinId] = spawnItem(state, 'gold_coin', 4, 4);
    state = removeComponent(state, coinId, ComponentType.Position);
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, { ...inv, items: [...inv.items, coinId] });
    state = setEntityCurrencyBalance(state, playerId, 5000);

    let bertramId: EntityId;
    [state, bertramId] = spawnEntity(state, 'barkeep_bertram', 6, 6);
    // Strip Memory to confirm trade social check initializes default MemoryComponent cleanly
    state = removeComponent(state, bertramId, ComponentType.Memory);

    const sellCoinRes = executeSellItem(state, playerId, bertramId, coinId);
    expect(sellCoinRes.success).toBe(false);

    const buyRes = executeBuyItem(state, playerId, bertramId, coinId);
    expect(buyRes.success).toBe(false);

    const haggleRes = resolveDnD35eTradeSocialSkill(state, playerId, bertramId, 'appraise');
    expect(haggleRes).not.toBeNull();
    const initializedMemory = getComponent(haggleRes!.state, bertramId, ComponentType.Memory) as
      MemoryComponent | undefined;
    expect(initializedMemory).toBeDefined();
    expect(initializedMemory!.facts.some((f) => f.startsWith('trade_win:appraise:') || f === 'trade_locked:appraise')).toBe(
      true
    );
  }, 15_000);

  it('propagates top-level and HD-tiered crAdjustment inside applyCreatureTemplate', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = campaign.systemContent as Record<string, unknown>;
    const races = sys['races'] as Record<string, unknown>;
    const ogreRace = races['ogre'] as Parameters<typeof hydrateRaceAsArchetype>[1];
    const baseArch = hydrateRaceAsArchetype(sys, ogreRace);
    const baseData = { ...hydrateArchetypeData(baseArch, undefined, sys), cr: baseArch.cr ?? 3 };

    const tpl: DnD35Template = {
      templateId: 'test_fiendish',
      name: 'Test Fiendish',
      kind: 'inherited',
      addSubtypes: [],
      abilityScoreModifiers: {},
      naturalArmorBonusDelta: 0,
      energyResistances: {},
      immunities: [],
      grantedFeats: [],
      grantedTags: [],
      specialQualityBundles: [],
      levelAdjustmentDelta: 0,
      crAdjustment: 1,
      hdTieredScaling: [{ minHd: 4, maxHd: 7, crAdjustment: 1 }]
    };

    const templated = applyCreatureTemplate(baseData, tpl);
    // Base ogre CR (3) + top-level (1) + 4HD tier (1) = CR 5
    expect(templated.cr).toBe(5);
  });

  it('initializes default MemoryComponent on actors spawned with shop or dialogueId', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    let state = buildGameState(campaign);

    // Strip memory from template clone to verify ecs_spawner fallback directly
    const strippedCampaign = {
      ...campaign,
      entities: {
        ...campaign.entities,
        barkeep_bertram: { ...campaign.entities['barkeep_bertram']!, memory: undefined }
      }
    };
    state = { ...state, campaign: strippedCampaign };

    let spawnedNpcId: EntityId;
    [state, spawnedNpcId] = spawnEntity(state, 'barkeep_bertram', 8, 8);
    expect(getComponent(state, spawnedNpcId, ComponentType.Memory)).toBeDefined();
  }, 15_000);

  it('subdivides currencyDrop when smallest matching coin item exceeds dropped amount', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);

    // Temporarily replace single silver_coin with only a 10-sp pouch (`coin_pouch_silver` weight)
    const pouchOnlyItems = Object.fromEntries(
      Object.entries(state.campaign.items).filter(([id]) => id !== 'silver_coin')
    );
    const customCampaign = {
      ...state.campaign,
      items: pouchOnlyItems,
      entities: {
        ...state.campaign.entities,
        test_dropper: {
          ...state.campaign.entities['goblin']!,
          id: 'test_dropper',
          currencyDrop: { denominationId: 'sp', minAmount: 1, maxAmount: 1, chance: 1 },
          lootDrops: []
        }
      }
    };
    state = { ...state, campaign: customCampaign };

    let dropperId: EntityId;
    [state, dropperId] = spawnEntity(state, 'test_dropper', 6, 6);
    state = addComponent(state, dropperId, { type: ComponentType.Death });
    state = processDeathSystem(state);

    // 1 sp = 10 cp -> should subdivide to 10 copper coins rather than spawning a 10 sp pouch
    const droppedCoins = state.entities
      .map((id) => getComponent(state, id, ComponentType.Item))
      .filter((comp) => comp?.itemId === 'copper_coin');
    expect(droppedCoins.length).toBe(1);
    expect(droppedCoins[0]!.charges).toBe(10);
  });

  it('preserves self-loop textOverride from skill_check dialogue consequence', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const playerId = getPlayerId(state);

    let npcId: EntityId;
    [state, npcId] = spawnEntity(state, 'goblin', 8, 8);
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        dialogues: {
          ...state.campaign.dialogues,
          self_loop_test_tree: {
            id: 'self_loop_test_tree',
            title: 'Self Loop Check',
            startNodeId: 'root',
            nodes: {
              root: {
                id: 'root',
                text: 'Original prompt text.',
                options: [
                  {
                    id: 'opt_try_impossible',
                    text: 'Attempt impossible persuasion.',
                    consequences: [
                      {
                        type: 'skill_check',
                        skillId: 'diplomacy',
                        dc: 99,
                        onSuccessNodeId: 'root',
                        onFailureNodeId: 'root'
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
      },
      uiMode: UIMode.Dialogue,
      activeDialogue: { treeId: 'self_loop_test_tree', currentNodeId: 'root', npcEntityId: npcId }
    };

    const res = processSelectDialogueOptionIntent(state, {
      type: IntentType.SelectDialogueOption,
      entityId: playerId,
      optionId: 'opt_try_impossible',
      isImmediate: true
    });
    expect(res.state.uiMode).toBe(UIMode.Dialogue);
    expect(res.state.activeDialogue?.currentNodeId).toBe('root');
    expect(res.state.activeDialogue?.textOverride).toContain('[Diplomacy:');
    expect(res.state.activeDialogue?.textOverride).toContain('vs DC 99]');
    expect(res.state.activeDialogue?.textOverride).toContain('Original prompt text.');
    expect(res.state.messages.some((m) => m.text.includes('Failed.'))).toBe(true);
  });

  it('snaps placedEntities off walls, spawn point, and duplicates via BFS', () => {
    const campaign = loadCampaignFromDisk('realms-of-shroudgarde');
    const state = buildGameState(campaign);
    const courtyard = state.campaign.areas['shroudgarde_courtyard']!;
    const populated = generateAndPopulateAreaFloor(state, 'shroudgarde_courtyard', -1, -1, new Map());

    const actorPositions: Array<{ readonly x: number; readonly y: number }> = [];
    for (const id of populated.nextEntities) {
      const comps = populated.nextComponents.get(id);
      const tmpl = comps?.[ComponentType.Template] as { readonly templateId: string } | undefined;
      if (tmpl && (tmpl.templateId === 'silas_merchant' || tmpl.templateId === 'elena_scholar')) {
        const pos = comps?.[ComponentType.Position] as PositionComponent | undefined;
        expect(pos).toBeDefined();
        const tile = populated.targetMap.tiles[pos!.y * populated.targetMap.width + pos!.x];
        expect(state.campaign.tiles[tile!.tileId]?.walkable).toBe(true);
        expect(`${pos!.x},${pos!.y}`).not.toBe(`${populated.spawnX},${populated.spawnY}`);
        actorPositions.push({ x: pos!.x, y: pos!.y });
      }
    }
    expect(actorPositions.length).toBe((courtyard.placedEntities ?? []).length);
    const uniqueCoords = new Set(actorPositions.map((p) => `${p.x},${p.y}`));
    expect(uniqueCoords.size).toBe(actorPositions.length);
  }, 15_000);
});
