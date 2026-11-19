import { resolveItemBaseValueInBaseUnits, toBaseUnits } from '../../../systems/currency.system.ts';
import type { CurrencyConfig, ItemDefinition } from '../../../types/campaign.types.ts';
import { DND35E_DEFAULT_CURRENCY_CONFIG } from '../currency.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import type { DnD35ClassDefinition } from '../types/dnd35e_system.types.ts';

/** Supported auto-equip slot targets for starting package or custom loadout items. */
export type StartingEquipSlot = 'main_hand' | 'off_hand' | 'torso' | 'body' | 'hand' | 'back';

/** Single item stack entry in a preset starting equipment package or custom loadout. */
export interface StartingPackageItemEntry {
  readonly itemId: string;
  readonly quantity?: number | undefined;
  readonly equipSlot?: StartingEquipSlot | undefined;
}

/** Curated starting equipment packages for character creation. */
export interface StartingEquipmentPackage {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly recommendedClassIds?: ReadonlyArray<string> | undefined;
  readonly freeOutfitId?: string | undefined;
  readonly items: ReadonlyArray<StartingPackageItemEntry>;
  readonly weaponDice: string;
  readonly weaponDamageType: 'slashing' | 'piercing' | 'bludgeoning';
  readonly armorBonus: number;
  readonly shieldBonus: number;
  readonly startingGoldGp: number;
}

/** Default fallback starting gold (in gp) when a class definition omits `averageStartingGoldGp`. */
const DEFAULT_FALLBACK_STARTING_GOLD_GP = 100;

/** The 7 PHB p. 111 free starting clothing outfits (plus peasant's outfit) eligible at 1st level. */
export const FREE_STARTER_OUTFIT_IDS: ReadonlyArray<string> = [
  'explorers_outfit',
  'travelers_outfit',
  'scholars_outfit',
  'monks_outfit',
  'clerics_vestments',
  'entertainers_outfit',
  'artisans_outfit',
  'peasants_outfit'
];

/** Common baseline adventuring gear included in every PHB/SRD class starting package. */
export const COMMON_ADVENTURER_GEAR_ITEMS: ReadonlyArray<StartingPackageItemEntry> = [
  { itemId: 'backpack', equipSlot: 'back' },
  { itemId: 'waterskin' },
  { itemId: 'trail_rations' },
  { itemId: 'bedroll' },
  { itemId: 'sack' },
  { itemId: 'flint_and_steel' },
  { itemId: 'torch', quantity: 3 }
];

/** Canonical starting equipment packages (11 PHB/SRD Class Starting Packages + 4 Classic Adventurer Kits). */
export const STARTING_EQUIPMENT_PACKAGES: ReadonlyArray<StartingEquipmentPackage> = [
  {
    id: 'pkg_barbarian',
    name: 'Barbarian Starting Package',
    description:
      'Greataxe (1d12 slashing), Shortbow + 20 Arrows, Studded Leather (+3 AC), Adventurer Essentials, 8 gp.',
    recommendedClassIds: ['barbarian'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'greataxe', equipSlot: 'main_hand' },
      { itemId: 'studded_leather_armor', equipSlot: 'torso' },
      { itemId: 'shortbow' },
      { itemId: 'arrows_20' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d12',
    weaponDamageType: 'slashing',
    armorBonus: 3,
    shieldBonus: 0,
    startingGoldGp: 8
  },
  {
    id: 'pkg_bard',
    name: 'Bard Starting Package',
    description:
      'Longsword (1d8), Light Crossbow + 10 Bolts, Studded Leather (+3 AC), Common Lute, Component Pouch, Essentials, 8 gp.',
    recommendedClassIds: ['bard'],
    freeOutfitId: 'entertainers_outfit',
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'studded_leather_armor', equipSlot: 'torso' },
      { itemId: 'light_crossbow' },
      { itemId: 'crossbow_bolts_10' },
      { itemId: 'lute_common' },
      { itemId: 'spell_component_pouch' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 3,
    shieldBonus: 0,
    startingGoldGp: 8
  },
  {
    id: 'pkg_cleric',
    name: 'Cleric Starting Package',
    description:
      'Heavy Mace (1d8), Light Crossbow + 10 Bolts, Scale Mail (+4 AC), Heavy Wooden Shield (+2 AC), Wooden Holy Symbol, Essentials, 4 gp.',
    recommendedClassIds: ['cleric', 'adept'],
    freeOutfitId: 'travelers_outfit',
    items: [
      { itemId: 'heavy_mace', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'light_crossbow' },
      { itemId: 'crossbow_bolts_10' },
      { itemId: 'wooden_holy_symbol' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d8',
    weaponDamageType: 'bludgeoning',
    armorBonus: 4,
    shieldBonus: 2,
    startingGoldGp: 4
  },
  {
    id: 'pkg_druid',
    name: 'Druid Starting Package',
    description:
      'Scimitar (1d6), Club, Sling + 10 Bullets, Hide Armor (+3 AC), Heavy Wooden Shield (+2 AC), Holly & Mistletoe, Essentials, 6 gp.',
    recommendedClassIds: ['druid'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'scimitar', equipSlot: 'main_hand' },
      { itemId: 'hide_armor', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'club' },
      { itemId: 'sling' },
      { itemId: 'sling_bullets_10' },
      { itemId: 'holly_and_mistletoe' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d6',
    weaponDamageType: 'slashing',
    armorBonus: 3,
    shieldBonus: 2,
    startingGoldGp: 6
  },
  {
    id: 'pkg_fighter',
    name: 'Fighter Starting Package',
    description: 'Greatsword (2d6 slashing), Shortbow + 20 Arrows, Scale Mail (+4 AC), Adventurer Essentials, 8 gp.',
    recommendedClassIds: ['fighter', 'warrior'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'greatsword', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'shortbow' },
      { itemId: 'arrows_20' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '2d6',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 0,
    startingGoldGp: 8
  },
  {
    id: 'pkg_monk',
    name: 'Monk Starting Package',
    description:
      "Quarterstaff (1d6 bludgeoning), Sling + 10 Bullets, Monk's Outfit (Unarmored), Adventurer Essentials, 8 gp.",
    recommendedClassIds: ['monk', 'commoner'],
    freeOutfitId: 'monks_outfit',
    items: [
      { itemId: 'quarterstaff', equipSlot: 'main_hand' },
      { itemId: 'sling' },
      { itemId: 'sling_bullets_10' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d6',
    weaponDamageType: 'bludgeoning',
    armorBonus: 0,
    shieldBonus: 0,
    startingGoldGp: 8
  },
  {
    id: 'pkg_paladin',
    name: 'Paladin Starting Package',
    description:
      'Longsword (1d8), Shortbow + 20 Arrows, Scale Mail (+4 AC), Heavy Wooden Shield (+2 AC), Hooded Lantern + 3 Oil, Wooden Holy Symbol, Essentials, 24 gp.',
    recommendedClassIds: ['paladin', 'aristocrat'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'shortbow' },
      { itemId: 'arrows_20' },
      { itemId: 'hooded_lantern' },
      { itemId: 'oil_flask', quantity: 3 },
      { itemId: 'wooden_holy_symbol' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 2,
    startingGoldGp: 24
  },
  {
    id: 'pkg_ranger',
    name: 'Ranger Starting Package',
    description:
      'Longsword (1d8), Short Sword (1d6), Longbow + 20 Arrows, Studded Leather (+3 AC), Adventurer Essentials, 8 gp.',
    recommendedClassIds: ['ranger'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'short_sword', equipSlot: 'off_hand' },
      { itemId: 'studded_leather_armor', equipSlot: 'torso' },
      { itemId: 'longbow' },
      { itemId: 'arrows_20' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 3,
    shieldBonus: 0,
    startingGoldGp: 8
  },
  {
    id: 'pkg_rogue',
    name: 'Rogue Starting Package',
    description:
      "Short Sword (1d6), Light Crossbow + 10 Bolts, Dagger, Leather Armor (+2 AC), Thieves' Tools, Hooded Lantern + 3 Oil, Essentials, 16 gp.",
    recommendedClassIds: ['rogue', 'expert'],
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'short_sword', equipSlot: 'main_hand' },
      { itemId: 'leather_armor', equipSlot: 'torso' },
      { itemId: 'light_crossbow' },
      { itemId: 'crossbow_bolts_10' },
      { itemId: 'dagger' },
      { itemId: 'thieves_tools' },
      { itemId: 'hooded_lantern' },
      { itemId: 'oil_flask', quantity: 3 },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 2,
    shieldBonus: 0,
    startingGoldGp: 16
  },
  {
    id: 'pkg_sorcerer',
    name: 'Sorcerer Starting Package',
    description:
      'Shortspear (1d6), Light Crossbow + 10 Bolts, Hooded Lantern + 5 Oil, Spell Component Pouch, Adventurer Essentials, 12 gp.',
    recommendedClassIds: ['sorcerer'],
    freeOutfitId: 'travelers_outfit',
    items: [
      { itemId: 'shortspear', equipSlot: 'main_hand' },
      { itemId: 'light_crossbow' },
      { itemId: 'crossbow_bolts_10' },
      { itemId: 'hooded_lantern' },
      { itemId: 'oil_flask', quantity: 5 },
      { itemId: 'spell_component_pouch' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 0,
    shieldBonus: 0,
    startingGoldGp: 12
  },
  {
    id: 'pkg_wizard',
    name: 'Wizard Starting Package',
    description:
      'Quarterstaff (1d6), Light Crossbow + 10 Bolts, 10 Candles, Map Case, 3 Parchment, Ink, Inkpen, Component Pouch, Spellbook, Essentials, 18 gp.',
    recommendedClassIds: ['wizard'],
    freeOutfitId: 'scholars_outfit',
    items: [
      { itemId: 'quarterstaff', equipSlot: 'main_hand' },
      { itemId: 'light_crossbow' },
      { itemId: 'crossbow_bolts_10' },
      { itemId: 'candle', quantity: 10 },
      { itemId: 'map_or_scroll_case' },
      { itemId: 'parchment_sheet', quantity: 3 },
      { itemId: 'ink_vial' },
      { itemId: 'inkpen' },
      { itemId: 'spell_component_pouch' },
      { itemId: 'wizards_spellbook' },
      ...COMMON_ADVENTURER_GEAR_ITEMS
    ],
    weaponDice: '1d6',
    weaponDamageType: 'bludgeoning',
    armorBonus: 0,
    shieldBonus: 0,
    startingGoldGp: 18
  },
  {
    id: 'martial_vanguard',
    name: 'Martial Vanguard Kit',
    description:
      'Longsword (1d8 slashing), Scale Mail (+4 armor), Heavy Wooden Shield (+2 shield), Explorer Pack, 25 gp.',
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack', equipSlot: 'back' },
      { itemId: 'potion_of_cure_light_wounds' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 2,
    startingGoldGp: 25
  },
  {
    id: 'skirmisher_scout',
    name: 'Skirmisher & Scout Kit',
    description: 'Shortsword (1d6 piercing), Leather Armor (+2 armor), Thieves Tools, Backpack, 35 gp.',
    freeOutfitId: 'explorers_outfit',
    items: [
      { itemId: 'short_sword', equipSlot: 'main_hand' },
      { itemId: 'leather_armor', equipSlot: 'torso' },
      { itemId: 'thieves_tools' },
      { itemId: 'backpack', equipSlot: 'back' },
      { itemId: 'potion_of_cure_light_wounds' }
    ],
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 3,
    shieldBonus: 0,
    startingGoldGp: 35
  },
  {
    id: 'divine_templar',
    name: 'Divine Templar Kit',
    description:
      'Heavy Mace (1d8 bludgeoning), Chainmail (+5 armor), Heavy Shield (+2 shield), Wooden Holy Symbol, 20 gp.',
    freeOutfitId: 'travelers_outfit',
    items: [
      { itemId: 'heavy_mace', equipSlot: 'main_hand' },
      { itemId: 'chainmail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack', equipSlot: 'back' },
      { itemId: 'potion_of_cure_light_wounds' },
      { itemId: 'wooden_holy_symbol' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'bludgeoning',
    armorBonus: 5,
    shieldBonus: 2,
    startingGoldGp: 20
  },
  {
    id: 'arcane_scholar',
    name: 'Arcane Scholar & Monk Kit',
    description:
      "Quarterstaff (1d6 bludgeoning), Scholar's Outfit (+0 armor), Spellbook, Backpack, Cure Light Wounds Potion, 50 gp.",
    freeOutfitId: 'scholars_outfit',
    items: [
      { itemId: 'quarterstaff', equipSlot: 'main_hand' },
      { itemId: 'wizards_spellbook' },
      { itemId: 'spell_component_pouch' },
      { itemId: 'backpack', equipSlot: 'back' },
      { itemId: 'potion_of_cure_light_wounds' }
    ],
    weaponDice: '1d6',
    weaponDamageType: 'bludgeoning',
    armorBonus: 0,
    shieldBonus: 0,
    startingGoldGp: 50
  }
];

/**
 * Resolves the average starting wealth in base units (cp) for a class definition from its declarative `averageStartingGoldGp`.
 */
export function resolveClassStartingWealthCp(
  classDef: DnD35ClassDefinition | undefined,
  currencyCfg: Readonly<CurrencyConfig> = DND35E_DEFAULT_CURRENCY_CONFIG
): number {
  const gp = classDef?.averageStartingGoldGp ?? DEFAULT_FALLBACK_STARTING_GOLD_GP;
  const goldDenomId = currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId;
  return Math.max(0, toBaseUnits(gp, goldDenomId, currencyCfg));
}

/**
 * Rolls starting wealth in base units (cp) for a class definition using its declarative `startingGoldDice` expression (e.g. `"6d4*10"`).
 */
export function rollClassStartingWealthCp(
  classDef: DnD35ClassDefinition | undefined,
  currencyCfg: Readonly<CurrencyConfig> = DND35E_DEFAULT_CURRENCY_CONFIG
): number {
  const expr = classDef?.startingGoldDice;
  if (!expr) {
    return resolveClassStartingWealthCp(classDef, currencyCfg);
  }
  const starIdx = expr.indexOf('*');
  let totalGp: number;
  if (starIdx !== -1) {
    const dicePart = expr.slice(0, starIdx).trim();
    const multPart = Number(expr.slice(starIdx + 1).trim());
    const multiplier = Number.isFinite(multPart) && multPart > 0 ? multPart : 1;
    totalGp = evaluateDiceExpression(dicePart).total * multiplier;
  } else {
    totalGp = evaluateDiceExpression(expr).total;
  }
  const goldDenomId = currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId;
  return Math.max(0, toBaseUnits(totalGp, goldDenomId, currencyCfg));
}

/**
 * Computes the total cost in base units (cp) for a list of custom equipment entries.
 */
export function computeCustomKitCostCp(
  entries: ReadonlyArray<StartingPackageItemEntry>,
  itemRegistry: Readonly<Record<string, ItemDefinition | undefined>>,
  currencyCfg: Readonly<CurrencyConfig> = DND35E_DEFAULT_CURRENCY_CONFIG
): number {
  let totalCp = 0;
  for (const entry of entries) {
    const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
    const def = itemRegistry[entry.itemId];
    if (!def) continue;
    totalCp += resolveItemBaseValueInBaseUnits(def, currencyCfg) * qty;
  }
  return totalCp;
}

/**
 * Resolves all starter outfit item IDs declaratively from items tagged `"starter_outfit"`,
 * falling back to `FREE_STARTER_OUTFIT_IDS` when no items carry the tag.
 */
export function getStarterOutfitIds(
  itemRegistry: Readonly<Record<string, ItemDefinition | undefined>>
): ReadonlyArray<string> {
  const discovered = Object.values(itemRegistry)
    .filter((item): item is ItemDefinition => item !== undefined && (item.tags ?? []).includes('starter_outfit'))
    .map((item) => item.id)
    .sort((a, b) => a.localeCompare(b));
  return discovered.length > 0 ? discovered : FREE_STARTER_OUTFIT_IDS;
}

/**
 * Computes total carried weight (in lbs) for a list of package/custom items, excluding the free 1st-level starter outfit per PHB p. 111.
 */
export function computeKitTotalWeightLbs(
  entries: ReadonlyArray<StartingPackageItemEntry>,
  itemRegistry: Readonly<Record<string, ItemDefinition | undefined>>,
  freeOutfitId?: string
): number {
  let totalLbs = 0;
  let excludedFreeOutfit = false;
  for (const entry of entries) {
    const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
    const def = itemRegistry[entry.itemId];
    if (!def) continue;
    const isFreeOutfit =
      !excludedFreeOutfit &&
      ((freeOutfitId !== undefined && entry.itemId === freeOutfitId) ||
        (freeOutfitId === undefined && (def.tags ?? []).includes('starter_outfit')));
    if (isFreeOutfit) {
      excludedFreeOutfit = true;
      totalLbs += (def.weight ?? 0) * Math.max(0, qty - 1);
    } else {
      totalLbs += (def.weight ?? 0) * qty;
    }
  }
  return Math.round(totalLbs * 100) / 100;
}

/**
 * Clones a preset `StartingEquipmentPackage`'s item entries into an editable custom loadout array.
 */
export function buildCustomItemsFromPackage(pkg: StartingEquipmentPackage): ReadonlyArray<StartingPackageItemEntry> {
  return pkg.items.map((item) => ({
    itemId: item.itemId,
    quantity: item.quantity ?? 1,
    ...(item.equipSlot !== undefined ? { equipSlot: item.equipSlot } : {})
  }));
}
