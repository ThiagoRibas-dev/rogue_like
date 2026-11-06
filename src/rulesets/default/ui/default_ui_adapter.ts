import type {
  ICartridgeUIAdapter,
  UICharacterSheetModel,
  UIInspectData,
  UIInventoryItem,
  UIInventoryModel
} from '../../../types/ui_adapter.types.ts';

const STIMPACK_PRICE = 150;
const CARBINE_PRICE = 3200;
const PLATING_PRICE = 2400;
const OPTICS_PRICE = 1800;
const EMP_PRICE = 420;
const DECK_PRICE = 5000;
const DEFAULT_CREDITS = 4303;
const DEFAULT_CARRIED_WEIGHT = 28.5;
const DEFAULT_MAX_WEIGHT = 125.0;

const SCIFI_ITEMS: Readonly<Record<string, UIInventoryItem>> = {
  stimpack_v2: {
    id: 'stimpack_v2',
    name: 'Nanite Hypo-Stimpack v2',
    iconUrl: '💉',
    category: 'consumable',
    quantity: 5,
    priceGp: STIMPACK_PRICE,
    weightLbs: 0.5,
    inspectData: {
      title: 'Nanite Hypo-Stimpack v2',
      loreText: 'Military-grade medical injector that deploys cellular repair nanites directly into the bloodstream.',
      baseMetrics: [
        { label: 'Effect', value: 'Restores 45 HP' },
        { label: 'Use Time', value: 'Instant Action' },
        { label: 'Weight', value: '0.5 lbs' }
      ],
      specialProperties: [
        { text: 'Cures Radiation Poisoning', colorHint: 'green' },
        { text: '+2 CON for 3 Turns', colorHint: 'blue' }
      ]
    }
  },
  pulse_carbine: {
    id: 'pulse_carbine',
    name: 'Pulse Carbine Mk IV',
    iconUrl: '🔫',
    category: 'weapon',
    quantity: 1,
    priceGp: CARBINE_PRICE,
    weightLbs: 6.5,
    inspectData: {
      title: 'Pulse Carbine Mk IV',
      loreText: 'Phased-plasma assault carbine issued to orbital boarding teams.',
      baseMetrics: [
        { label: 'Base Damage', value: '2d10 + 4 Plasma' },
        { label: 'Critical Multiplier', value: '20 / x3' },
        { label: 'Skill Required', value: 'Small Guns 80%' },
        { label: 'Weight', value: '6.5 lbs' }
      ],
      specialProperties: [
        { text: 'EMP Overload On Critical Hit', colorHint: 'blue' },
        { text: 'Ignores 5 Thermal DR', colorHint: 'green' }
      ]
    }
  },
  subdermal_armor: {
    id: 'subdermal_armor',
    name: 'Subdermal Weave Mk II',
    iconUrl: '🦺',
    category: 'armor',
    quantity: 1,
    priceGp: PLATING_PRICE,
    weightLbs: 12.0,
    inspectData: {
      title: 'Subdermal Weave Mk II',
      loreText: 'Ballistic carbon-nanotube mesh bonded beneath the epidermis.',
      baseMetrics: [
        { label: 'Armor Class', value: '+15 AC' },
        { label: 'Damage Threshold', value: '6 Kinetic / 8 Laser' },
        { label: 'Weight', value: '12.0 lbs' }
      ],
      specialProperties: [{ text: 'Zero Movement Penalty', colorHint: 'green' }]
    }
  },
  cyber_optics: {
    id: 'cyber_optics',
    name: 'Kiroshi Target Optics',
    iconUrl: '🥽',
    category: 'accessory',
    quantity: 1,
    priceGp: OPTICS_PRICE,
    weightLbs: 1.0,
    inspectData: {
      title: 'Kiroshi Target Optics',
      loreText: 'Multi-spectrum retinal implant with real-time ballistic trajectory projection.',
      baseMetrics: [
        { label: 'Slot', value: 'Head / Optics' },
        { label: 'Weight', value: '1.0 lbs' }
      ],
      specialProperties: [
        { text: '+15% Small Guns & Big Guns Accuracy', colorHint: 'green' },
        { text: 'Thermal & Cloaking Detection', colorHint: 'purple' }
      ]
    }
  },
  neural_deck: {
    id: 'neural_deck',
    name: 'Ono-Sendai Cyberdeck',
    iconUrl: '💾',
    category: 'accessory',
    quantity: 1,
    priceGp: DECK_PRICE,
    weightLbs: 2.0,
    inspectData: {
      title: 'Ono-Sendai Cyberdeck',
      loreText: 'Direct neural ICE-breaker matrix for tactical turret & terminal intrusion.',
      baseMetrics: [
        { label: 'Slot', value: 'Neural Interface' },
        { label: 'Buffer RAM', value: '12 Slots' }
      ],
      specialProperties: [{ text: '+25% Hack & Cyb-PK Efficiency', colorHint: 'blue' }]
    }
  },
  emp_grenade: {
    id: 'emp_grenade',
    name: 'Pulse EMP Grenade',
    iconUrl: '💣',
    category: 'consumable',
    quantity: 3,
    priceGp: EMP_PRICE,
    weightLbs: 1.0,
    inspectData: {
      title: 'Pulse EMP Grenade',
      loreText: 'Discharges a high-frequency electromagnetic burst that fries synth servos.',
      baseMetrics: [
        { label: 'Blast Radius', value: '15 ft' },
        { label: 'Damage', value: '4d8 Ion vs Constructs' }
      ],
      specialProperties: [{ text: 'Stuns Androids & Turrets for 2 Rounds', colorHint: 'blue' }]
    }
  }
};

/**
 * Default Sci-Fi Cartridge UI Adapter using the 'retro-crt' skin (Image 9).
 */
export class DefaultSciFiUIAdapter implements ICartridgeUIAdapter {
  public readonly rulesetId = 'default';
  public readonly defaultThemeMode = 'retro-crt' as const;

  public getCharacterSheetData(_actor: unknown): UICharacterSheetModel {
    return {
      name: 'OPERATIVE #1337',
      levelSummary: 'Level 12 Cyber-Infiltrator',
      raceName: 'Human (Augmented)',
      alignmentName: 'Neutral Tech',
      attributes: [
        { id: 'str', name: 'Strength', score: 9, modifier: 0 },
        { id: 'con', name: 'Constitution', score: 9, modifier: 0 },
        { id: 'int', name: 'Intellect', score: 12, modifier: 2 },
        { id: 'for', name: 'Fortune', score: 9, modifier: 0 },
        { id: 'intu', name: 'Intuition', score: 9, modifier: 0 },
        { id: 'dex', name: 'Dexterity', score: 14, modifier: 3 },
        { id: 'arc', name: 'Arcane / PSI', score: 9, modifier: 0 }
      ],
      savingThrows: [
        { id: 'fortitude', name: 'Fortitude', total: 11 },
        { id: 'reflex', name: 'Reflex', total: 15 },
        { id: 'will', name: 'Willpower', total: 10 }
      ],
      hpCurrent: 95,
      hpMax: 95,
      acTotal: 15,
      babTotal: 12,
      combatSummary: [
        {
          title: 'Pulse Carbine Mk IV',
          attackBonus: '+15/+10',
          damage: '2d10 + 4',
          critRange: '20 / x3',
          specialEffects: ['EMP Overload On Hit', 'Armor Piercing']
        }
      ],
      skills: [
        { id: 'small_guns', name: 'Small Guns', totalModifier: 120, isClassSkill: true },
        { id: 'lockpick', name: 'Lockpick', totalModifier: 100, isClassSkill: true },
        { id: 'hack', name: 'Hack Terminal', totalModifier: 110, isClassSkill: true },
        { id: 'bio_pk', name: 'Bio-PK Pulse', totalModifier: 80, isClassSkill: false }
      ],
      feats: [
        { id: 'cyber_implant', name: 'Subdermal Plating', description: '+5 Armor Class' },
        { id: 'deadeye', name: 'Deadeye Targeting System', description: '+2 Critical Hit Multiplier' }
      ]
    };
  }

  public getInventoryData(_actor: unknown): UIInventoryModel {
    const stimpack = SCIFI_ITEMS.stimpack_v2!;
    const carbine = SCIFI_ITEMS.pulse_carbine!;
    const armor = SCIFI_ITEMS.subdermal_armor!;
    const optics = SCIFI_ITEMS.cyber_optics!;
    const deck = SCIFI_ITEMS.neural_deck!;
    const emp = SCIFI_ITEMS.emp_grenade!;

    return {
      equippedSlots: {
        main_hand: carbine,
        off_hand: null,
        head: optics,
        torso: armor,
        feet: null,
        hands: null,
        waist: null,
        ring_1: deck,
        ring_2: null,
        neck: null,
        cloak: null,
        ammo: emp
      },
      activeWeaponSetIndex: 1,
      stashItems: [stimpack, carbine, armor, optics, deck, emp],
      currentWeightLbs: DEFAULT_CARRIED_WEIGHT,
      maxWeightLbs: DEFAULT_MAX_WEIGHT,
      goldCurrency: DEFAULT_CREDITS
    };
  }

  public getHotbarBinding(_actor: unknown, _slotIndex: number): UIInventoryItem | null {
    return null;
  }

  public getStanceActions(_actor: unknown): ReadonlyArray<{ id: string; label: string; isActive: boolean }> {
    return [
      { id: 'stealth_field', label: 'Cloaking Field', isActive: false },
      { id: 'overclock', label: 'Overclock CPU', isActive: false },
      { id: 'scan_surroundings', label: 'Sensory Scan', isActive: true }
    ];
  }

  public getItemInspectData(item: unknown): UIInspectData {
    const uiItem = item as UIInventoryItem;
    return (
      uiItem?.inspectData ?? {
        title: uiItem?.name ?? 'Unknown Tech',
        baseMetrics: [],
        specialProperties: []
      }
    );
  }
}
