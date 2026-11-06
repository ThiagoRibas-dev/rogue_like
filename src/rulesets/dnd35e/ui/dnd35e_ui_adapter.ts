import type {
  ICartridgeUIAdapter,
  UIAnatomicalSlotDescriptor,
  UIAttackGroupModel,
  UICharacterSheetModel,
  UIFeatureEntryModel,
  UIInspectData,
  UIInventoryItem,
  UIInventoryModel,
  UILevelHistoryRowModel,
  UISkillRowModel
} from '../../../types/ui_adapter.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import type { AbilityScoreState, DnD35EntityData } from '../types/dnd35e.types.ts';

const DEFAULT_ABILITY_SCORE = 10;
const BASE_AC_SCORE = 10;
const LIGHT_LOAD_MULTIPLIER_LBS = 15;
const DEFAULT_GOLD_CURRENCY = 250;
const MOCK_CARRIED_WEIGHT_LBS = 18.5;

function resolveAbilityScore(scoreState: AbilityScoreState | undefined): number {
  if (!scoreState) return DEFAULT_ABILITY_SCORE;
  return computeEffectiveAbilityScore(scoreState) ?? DEFAULT_ABILITY_SCORE;
}

export interface DnD35ExtendedActorData extends Partial<DnD35EntityData> {
  readonly name?: string;
  readonly hpCurrent?: number;
  readonly goldCurrency?: number;
  readonly morphologyPreset?: 'humanoid' | 'marilith_6arm' | 'quadruped_wolf';
}

interface ItemSeed {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly cat: UIInventoryItem['category'];
  readonly qty: number;
  readonly gp: number;
  readonly lbs: number;
  readonly lore: string;
  readonly mLabel: string;
  readonly mVal: string;
  readonly prop: string;
}

const ITEM_SEEDS: ReadonlyArray<ItemSeed> = [
  { id: 'luskan_rapier', name: "Luskan Battlemage's Rapier", icon: '⚔️', cat: 'weapon', qty: 1, gp: 4500, lbs: 2.0, lore: 'Forged in the Host Tower.', mLabel: 'Damage', mVal: '1d6+5 (18-20/x2)', prop: '+3 Enhancement, +1d6 Elec/Sonic' },
  { id: 'kizu_shortsword', name: "Kizu's Short Sword", icon: '🗡️', cat: 'weapon', qty: 1, gp: 8310, lbs: 2.0, lore: 'Coated in Wyvern venom.', mLabel: 'Damage', mVal: '1d6 (19-20/x2)', prop: '+2d6 vs Chaotic, Wyvern Poison' },
  { id: 'mithral_shirt', name: 'Mithral Chain Shirt +2', icon: '🛡️', cat: 'armor', qty: 1, gp: 1100, lbs: 10.0, lore: 'Elven silver links.', mLabel: 'Armor', mVal: '+6 AC (Max Dex +6)', prop: '+2 Enhancement (Mithral)' },
  { id: 'cloak_resistance', name: 'Cloak of Resistance +2', icon: '🧥', cat: 'accessory', qty: 1, gp: 4000, lbs: 1.0, lore: 'Abjuration threads.', mLabel: 'Slot', mVal: 'Shoulders', prop: '+2 Resistance to Saves' },
  { id: 'ring_protection', name: 'Ring of Protection +2', icon: '💍', cat: 'accessory', qty: 1, gp: 8000, lbs: 0.1, lore: 'Force barrier.', mLabel: 'Slot', mVal: 'Ring', prop: '+2 Deflection to AC' },
  { id: 'amulet_natural_armor', name: 'Amulet of Natural Armor +1', icon: '📿', cat: 'accessory', qty: 1, gp: 2000, lbs: 0.2, lore: 'Amber talisman.', mLabel: 'Slot', mVal: 'Neck', prop: '+1 Natural Armor to AC' },
  { id: 'potion_cure_serious', name: 'Potion of Cure Serious Wounds', icon: '🧪', cat: 'consumable', qty: 4, gp: 750, lbs: 0.5, lore: 'Ruby phial.', mLabel: 'Heal', mVal: '3d8+5 HP', prop: 'Conjuration (Healing)' },
  { id: 'scroll_haste', name: 'Scroll of Haste', icon: '📜', cat: 'consumable', qty: 2, gp: 375, lbs: 0.1, lore: 'Chronomantic vellum.', mLabel: 'Spell', mVal: 'Wiz/Sor 3', prop: '+1 Extra Attack, +30 ft Speed' }
];

export const DND35_SHOWCASE_ITEMS: Readonly<Record<string, UIInventoryItem>> = Object.fromEntries(
  ITEM_SEEDS.map((s) => [
    s.id,
    {
      id: s.id,
      name: s.name,
      iconUrl: s.icon,
      category: s.cat,
      quantity: s.qty,
      priceGp: s.gp,
      weightLbs: s.lbs,
      inspectData: {
        title: s.name,
        loreText: s.lore,
        baseMetrics: [{ label: s.mLabel, value: s.mVal }],
        specialProperties: [{ text: s.prop, colorHint: 'green' }]
      }
    }
  ])
);

export class DnD35UIAdapter implements ICartridgeUIAdapter {
  public readonly rulesetId = 'dnd35e';
  public readonly defaultThemeMode = 'parchment' as const;

  public buildAnatomicalSlotsForPreset(
    preset: 'humanoid' | 'marilith_6arm' | 'quadruped_wolf'
  ): ReadonlyArray<UIAnatomicalSlotDescriptor> {
    const it = DND35_SHOWCASE_ITEMS;
    const base: ReadonlyArray<UIAnatomicalSlotDescriptor> = [
      { slotId: 'head', slotType: 'head', label: 'Head', emptyGlyph: '🪖', rail: 'left', equippedItem: null },
      { slotId: 'cloak', slotType: 'shoulders', label: 'Cloak', emptyGlyph: '🧥', rail: 'left', equippedItem: it.cloak_resistance! },
      { slotId: 'ring_1', slotType: 'ring', label: 'Ring 1', emptyGlyph: '💍', rail: 'left', equippedItem: it.ring_protection! },
      { slotId: 'hands', slotType: 'hands', label: 'Gloves', emptyGlyph: '🧤', rail: 'left', equippedItem: null },
      { slotId: 'main_hand', slotType: 'main_hand', label: 'Main Hand', emptyGlyph: '⚔️', rail: 'left', equippedItem: it.luskan_rapier! },
      { slotId: 'ammo', slotType: 'ranged', label: 'Ammo', emptyGlyph: '🏹', rail: 'left', equippedItem: null },
      { slotId: 'neck', slotType: 'neck', label: 'Neck', emptyGlyph: '📿', rail: 'right', equippedItem: it.amulet_natural_armor! },
      { slotId: 'torso', slotType: 'torso', label: 'Armor', emptyGlyph: '🛡️', rail: 'right', equippedItem: it.mithral_shirt! },
      { slotId: 'waist', slotType: 'waist', label: 'Belt', emptyGlyph: '🎗️', rail: 'right', equippedItem: null },
      { slotId: 'ring_2', slotType: 'ring', label: 'Ring 2', emptyGlyph: '💍', rail: 'right', equippedItem: null },
      { slotId: 'feet', slotType: 'feet', label: 'Boots', emptyGlyph: '🥾', rail: 'right', equippedItem: null },
      { slotId: 'off_hand', slotType: 'off_hand', label: 'Off Hand', emptyGlyph: '🗡️', rail: 'right', equippedItem: it.kizu_shortsword! }
    ];
    if (preset === 'marilith_6arm') {
      return [
        ...base,
        { slotId: 'arm_3_hand', slotType: 'off_hand', label: 'Arm 3 (Lower L)', emptyGlyph: '🗡️', rail: 'extra', isExtraLimb: true, equippedItem: it.kizu_shortsword! },
        { slotId: 'arm_4_hand', slotType: 'off_hand', label: 'Arm 4 (Lower R)', emptyGlyph: '⚔️', rail: 'extra', isExtraLimb: true, equippedItem: it.luskan_rapier! },
        { slotId: 'arm_5_hand', slotType: 'off_hand', label: 'Arm 5 (Ventral L)', emptyGlyph: '🗡️', rail: 'extra', isExtraLimb: true, equippedItem: it.kizu_shortsword! },
        { slotId: 'arm_6_hand', slotType: 'off_hand', label: 'Arm 6 (Ventral R)', emptyGlyph: '🛡️', rail: 'extra', isExtraLimb: true, equippedItem: null },
        { slotId: 'tail_slap', slotType: 'natural', label: 'Serpent Tail', emptyGlyph: '🐍', rail: 'extra', isExtraLimb: true, equippedItem: null }
      ];
    }
    if (preset === 'quadruped_wolf') {
      const meldedIds = new Set(['hands', 'main_hand', 'off_hand', 'ring_1', 'ring_2', 'torso', 'ammo']);
      return [
        ...base.map((s) => (meldedIds.has(s.slotId) ? { ...s, suppressed: true } : s)),
        { slotId: 'natural_bite', slotType: 'natural', label: 'Primary Bite', emptyGlyph: '🐺', rail: 'extra', isExtraLimb: true, equippedItem: null }
      ];
    }
    return base;
  }

  public getCharacterSheetData(actor: unknown): UICharacterSheetModel {
    const dndData = (actor ?? {}) as DnD35ExtendedActorData;
    const raw = dndData.abilityScores;
    const str = resolveAbilityScore(raw?.str);
    const dex = resolveAbilityScore(raw?.dex);
    const con = resolveAbilityScore(raw?.con);
    const int = resolveAbilityScore(raw?.int);
    const wis = resolveAbilityScore(raw?.wis);
    const cha = resolveAbilityScore(raw?.cha);
    const strMod = computeAbilityModifier(str);
    const dexMod = computeAbilityModifier(dex);
    const conMod = computeAbilityModifier(con);
    const wisMod = computeAbilityModifier(wis);
    const chassis = aggregateProgressionChassis(dndData.tracks ?? [], conMod, dndData.levelAdjustment ?? 0);
    const levelSummary = (dndData.tracks ?? []).map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Level 1';

    const attackGroups: ReadonlyArray<UIAttackGroupModel> = [
      { id: 'primary_rapier', label: "Luskan Battlemage's Rapier", subtitle: 'Main Hand • Iterative', category: 'manufactured', attackBonuses: `+${chassis.totalBab + strMod}`, damageFormula: `1d6 + ${Math.max(1, strMod)}`, criticalProfile: '18-20 / x2', riderNotes: '+3 Piercing, +1d6 Elec/Sonic' },
      { id: 'offhand_shortsword', label: "Kizu's Short Sword", subtitle: 'Off-Hand • TWF', category: 'off_hand', attackBonuses: `+${chassis.totalBab + strMod - 2}`, damageFormula: `1d6 + ${Math.max(1, Math.floor(strMod / 2))}`, criticalProfile: '19-20 / x2', riderNotes: '+2d6 vs Chaotic, Wyvern Poison' },
      { id: 'natural_bite', label: 'Secondary Natural Bite / Tail', subtitle: 'Natural Secondary (-5)', category: 'natural_secondary', attackBonuses: `+${chassis.totalBab + strMod - 5}`, damageFormula: `1d8 + ${Math.max(1, Math.floor(strMod / 2))}`, criticalProfile: '20 / x2', riderNotes: 'Improved Grab / Trip' }
    ];

    const skillEntries = Object.entries(dndData.skillRanks ?? {});
    const skillRows: ReadonlyArray<UISkillRowModel> =
      skillEntries.length > 0
        ? skillEntries.map(([id, ranks]) => ({ id, name: id.replace(/_/g, ' ').toUpperCase(), keyAbility: 'DEX', totalModifier: ranks + dexMod, ranks, abilityModifier: dexMod, miscModifier: 0, isClassSkill: true, isUsableActive: true }))
        : Array.from({ length: 8 }, (_, idx) => ({ id: `skill_${idx}`, name: `SKILL ${idx + 1}`, keyAbility: 'INT', totalModifier: 4, ranks: 4, abilityModifier: 0, miscModifier: 0, isClassSkill: true, isUsableActive: idx < 4 }));

    const featureEntries: ReadonlyArray<UIFeatureEntryModel> = [
      { id: 'weapon_finesse', name: 'Weapon Finesse', category: 'feat', sourceLabel: 'Feat' },
      { id: 'twf', name: 'Two-Weapon Fighting', category: 'feat', sourceLabel: 'Feat' },
      { id: 'turn_undead', name: 'Turn Undead', category: 'class_feature', badgeText: '4/day' },
      { id: 'war_domain', name: 'Domain: War', category: 'domain', sourceLabel: 'Deity' }
    ];

    const levelHistory: ReadonlyArray<UILevelHistoryRowModel> =
      (dndData.levelHistory ?? []).length > 0
        ? (dndData.levelHistory ?? []).map((entry) => ({
            level: entry.characterLevel,
            classAndLevel: `${entry.classId} ${entry.classLevel}`,
            hitDieRoll: entry.hpRolled,
            skillPointsSpent: Object.values(entry.addedSkillRanks ?? {}).reduce((a: number, b: number) => a + b, 0),
            featsAndFeatures: [...entry.selectedFeats, ...entry.selectedAcfs].join(', ') || '—'
          }))
        : [
            { level: 1, classAndLevel: 'Cleric 1', hitDieRoll: 8, skillPointsSpent: 12, featsAndFeatures: 'Weapon Focus, Turn Undead' },
            { level: 2, classAndLevel: 'Fighter 1', hitDieRoll: 10, skillPointsSpent: 3, featsAndFeatures: 'Power Attack (Bonus)' },
            { level: 3, classAndLevel: 'Cleric 2', hitDieRoll: 6, skillPointsSpent: 3, featsAndFeatures: 'Cleave (3rd HD)' }
          ];

    return {
      name: dndData.name ?? 'Adventurer',
      levelSummary,
      raceName: dndData.raceId ? dndData.raceId.toUpperCase() : 'HUMAN',
      alignmentName: dndData.alignment ? dndData.alignment.toUpperCase().replace('_', ' ') : 'Neutral Good',
      attributes: [
        { id: 'str', name: 'STR', score: str, modifier: strMod },
        { id: 'dex', name: 'DEX', score: dex, modifier: dexMod },
        { id: 'con', name: 'CON', score: con, modifier: conMod },
        { id: 'int', name: 'INT', score: int, modifier: computeAbilityModifier(int) },
        { id: 'wis', name: 'WIS', score: wis, modifier: wisMod },
        { id: 'cha', name: 'CHA', score: cha, modifier: computeAbilityModifier(cha) }
      ],
      savingThrows: [
        { id: 'fortitude', name: 'Fortitude', total: chassis.baseSaves.fort + conMod },
        { id: 'reflex', name: 'Reflex', total: chassis.baseSaves.ref + dexMod },
        { id: 'will', name: 'Will', total: chassis.baseSaves.will + wisMod }
      ],
      hpCurrent: dndData.hpCurrent ?? chassis.maxHp,
      hpMax: chassis.maxHp,
      acTotal: BASE_AC_SCORE + dexMod,
      babTotal: chassis.totalBab,
      combatSummary: [{ title: "Luskan Battlemage's Rapier", attackBonus: `+${chassis.totalBab + strMod}`, damage: `1d6 + ${Math.max(1, strMod)}`, critRange: '18-20 / x2', specialEffects: ['+3 Piercing', '+1d6 Electrical', '+1d6 Sonic'] }],
      attackGroups,
      skills: skillRows.map((s) => ({ id: s.id, name: s.name, totalModifier: s.totalModifier, isClassSkill: s.isClassSkill })),
      skillRows,
      feats: (dndData.feats ?? []).map((f) => ({ id: f, name: f.replace(/_/g, ' ').toUpperCase(), description: 'SRD 3.5e Feat' })),
      featureEntries,
      levelHistory
    };
  }

  public getInventoryData(actor: unknown): UIInventoryModel {
    const dndData = (actor ?? {}) as DnD35ExtendedActorData;
    const strScore = resolveAbilityScore(dndData.abilityScores?.str);
    const it = DND35_SHOWCASE_ITEMS;
    const preset = dndData.morphologyPreset ?? 'humanoid';
    return {
      equippedSlots: { main_hand: it.luskan_rapier!, off_hand: it.kizu_shortsword!, head: null, torso: it.mithral_shirt!, feet: null, hands: null, waist: null, ring_1: it.ring_protection!, ring_2: null, neck: it.amulet_natural_armor!, cloak: it.cloak_resistance!, ammo: null },
      anatomicalSlots: this.buildAnatomicalSlotsForPreset(preset),
      morphologyLabel: preset,
      activeWeaponSetIndex: 1,
      stashItems: Object.values(it),
      currentWeightLbs: MOCK_CARRIED_WEIGHT_LBS,
      maxWeightLbs: strScore * LIGHT_LOAD_MULTIPLIER_LBS,
      goldCurrency: dndData.goldCurrency ?? DEFAULT_GOLD_CURRENCY
    };
  }

  public getHotbarBinding(_actor: unknown, _slotIndex: number): UIInventoryItem | null {
    return null;
  }

  public getStanceActions(_actor: unknown): ReadonlyArray<{ id: string; label: string; isActive: boolean }> {
    return [
      { id: 'power_attack', label: 'Power Attack', isActive: false },
      { id: 'fighting_defensively', label: 'Fighting Defensively', isActive: false },
      { id: 'total_defense', label: 'Total Defense', isActive: false },
      { id: 'stealth', label: 'Stealth / Hide', isActive: false },
      { id: 'search', label: 'Search Mode', isActive: true }
    ];
  }

  public getItemInspectData(item: unknown): UIInspectData {
    const uiItem = item as UIInventoryItem;
    return uiItem?.inspectData ?? { title: uiItem?.name ?? 'Unknown Item', baseMetrics: [], specialProperties: [] };
  }
}
