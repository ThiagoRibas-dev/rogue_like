/** Curated starting equipment packages for character creation. */
export interface StartingEquipmentPackage {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly items: ReadonlyArray<{
    readonly itemId: string;
    readonly equipSlot?: 'main_hand' | 'off_hand' | 'torso' | 'body' | 'hand' | undefined;
  }>;
  readonly weaponDice: string;
  readonly weaponDamageType: 'slashing' | 'piercing' | 'bludgeoning';
  readonly armorBonus: number;
  readonly shieldBonus: number;
}

/** Canonical starting equipment packages selectable in Step 7 of Character Creation. */
export const STARTING_EQUIPMENT_PACKAGES: ReadonlyArray<StartingEquipmentPackage> = [
  {
    id: 'martial_vanguard',
    name: 'Martial Vanguard Kit',
    description: 'Longsword (1d8 slashing), Scale Mail (+4 armor), Heavy Wooden Shield (+2 shield), Explorer Pack.',
    items: [
      { itemId: 'longsword', equipSlot: 'main_hand' },
      { itemId: 'scale_mail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'slashing',
    armorBonus: 4,
    shieldBonus: 2
  },
  {
    id: 'skirmisher_scout',
    name: 'Skirmisher & Scout Kit',
    description: 'Shortsword (1d6 piercing), Leather Armor (+3 armor), Thieves Tools, Backpack.',
    items: [
      { itemId: 'short_sword', equipSlot: 'main_hand' },
      { itemId: 'leather_armor', equipSlot: 'torso' },
      { itemId: 'lockpick' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d6',
    weaponDamageType: 'piercing',
    armorBonus: 3,
    shieldBonus: 0
  },
  {
    id: 'divine_templar',
    name: 'Divine Templar Kit',
    description: 'Heavy Mace (1d8 bludgeoning), Chainmail (+5 armor), Heavy Shield (+2 shield), Wooden Holy Symbol.',
    items: [
      { itemId: 'heavy_mace', equipSlot: 'main_hand' },
      { itemId: 'chainmail', equipSlot: 'torso' },
      { itemId: 'heavy_wooden_shield', equipSlot: 'off_hand' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' },
      { itemId: 'wooden_holy_symbol' }
    ],
    weaponDice: '1d8',
    weaponDamageType: 'bludgeoning',
    armorBonus: 5,
    shieldBonus: 2
  },
  {
    id: 'arcane_scholar',
    name: 'Arcane Scholar & Monk Kit',
    description: 'Quarterstaff (1d6 bludgeoning), Scholar Robes (+0 armor), Backpack, Health Potion.',
    items: [
      { itemId: 'quarterstaff', equipSlot: 'main_hand' },
      { itemId: 'scholar_robes', equipSlot: 'torso' },
      { itemId: 'backpack' },
      { itemId: 'health_potion' }
    ],
    weaponDice: '1d6',
    weaponDamageType: 'bludgeoning',
    armorBonus: 0,
    shieldBonus: 0
  }
];
