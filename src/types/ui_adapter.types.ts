/**
 * Data model for floating item inspection cards (Examine popover).
 */
export interface UIInspectData {
  readonly title: string;
  readonly iconUrl?: string;
  readonly loreText?: string;
  readonly baseMetrics: ReadonlyArray<{ label: string; value: string }>;
  readonly specialProperties: ReadonlyArray<{
    text: string;
    colorHint?: 'green' | 'blue' | 'purple' | 'orange';
  }>;
}

/**
 * Data model for inventory items.
 */
export interface UIInventoryItem {
  readonly id: string;
  readonly entityId?: number;
  readonly inventoryIndex?: number;
  readonly hotkeyLabel?: string;
  readonly name: string;
  readonly iconUrl?: string;
  readonly category: 'weapon' | 'armor' | 'consumable' | 'accessory' | 'quest' | 'misc';
  readonly quantity: number;
  readonly priceGp: number;
  readonly weightLbs: number;
  readonly isEquipped?: boolean;
  readonly inspectData: UIInspectData;
}

/**
 * Reactive anatomical slot descriptor supporting standard 12-slot humanoids,
 * extra/repeated limbs (e.g., 6-armed Marilith), melded Wild Shape slots, and 2H grip links.
 */
export interface UIAnatomicalSlotDescriptor {
  readonly slotId: string;
  readonly slotType: string;
  readonly label: string;
  readonly emptyGlyph: string;
  readonly rail: 'left' | 'right' | 'extra';
  readonly equippedItem: UIInventoryItem | null;
  readonly suppressed?: boolean;
  readonly occupiedBySlotId?: string;
  readonly isExtraLimb?: boolean;
}

/**
 * Grouped attack routine entry representing a manufactured limb's iterative sequence
 * or a primary/secondary natural weapon group.
 */
export interface UIAttackGroupModel {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly category: 'manufactured' | 'off_hand' | 'extra_limb' | 'natural_primary' | 'natural_secondary';
  readonly attackBonuses: string;
  readonly damageFormula: string;
  readonly criticalProfile: string;
  readonly riderNotes?: string;
}

/**
 * Detailed Pen-and-Paper skill row model.
 */
export interface UISkillRowModel {
  readonly id: string;
  readonly name: string;
  readonly keyAbility: string;
  readonly totalModifier: number;
  readonly ranks: number;
  readonly abilityModifier: number;
  readonly miscModifier: number;
  readonly isClassSkill: boolean;
  readonly isUsableActive?: boolean;
}

/**
 * Categorized feat, class feature, domain, racial trait, or active condition.
 */
export interface UIFeatureEntryModel {
  readonly id: string;
  readonly name: string;
  readonly category: 'feat' | 'class_feature' | 'domain' | 'trait' | 'condition';
  readonly sourceLabel?: string;
  readonly badgeText?: string;
  readonly description?: string;
}

/**
 * Horizon 1 Level-by-Level Progression Matrix row.
 */
export interface UILevelHistoryRowModel {
  readonly level: number;
  readonly classAndLevel: string;
  readonly hitDieRoll: number;
  readonly skillPointsSpent: number;
  readonly featsAndFeatures: string;
}

/**
 * Data model for character sheet details rendered in the Console UI host.
 */
export interface UICharacterSheetModel {
  readonly name: string;
  readonly portraitUrl?: string;
  readonly levelSummary: string;
  readonly raceName: string;
  readonly alignmentName?: string;
  readonly xpCurrent?: number;
  readonly xpNextLevel?: number;
  readonly attributes: ReadonlyArray<{ id: string; name: string; score: number; modifier: number }>;
  readonly savingThrows: ReadonlyArray<{ id: string; name: string; total: number }>;
  readonly hpCurrent: number;
  readonly hpMax: number;
  readonly acTotal: number;
  readonly touchAc?: number;
  readonly flatFootedAc?: number;
  readonly babTotal: number;
  readonly initiativeBonus?: number;
  readonly grappleBonus?: number;
  readonly speedFt?: number;
  readonly combatSummary: ReadonlyArray<{
    title: string;
    attackBonus: string;
    damage: string;
    critRange: string;
    specialEffects?: ReadonlyArray<string>;
  }>;
  readonly attackGroups?: ReadonlyArray<UIAttackGroupModel>;
  readonly skills: ReadonlyArray<{ id: string; name: string; totalModifier: number; isClassSkill: boolean }>;
  readonly skillRows?: ReadonlyArray<UISkillRowModel>;
  readonly feats: ReadonlyArray<{ id: string; name: string; description: string }>;
  readonly featureEntries?: ReadonlyArray<UIFeatureEntryModel>;
  readonly levelHistory?: ReadonlyArray<UILevelHistoryRowModel>;
}

/**
 * Data model for inventory and equipment state.
 */
export interface UIInventoryModel {
  readonly equippedSlots: Readonly<Record<string, UIInventoryItem | null>>;
  readonly anatomicalSlots?: ReadonlyArray<UIAnatomicalSlotDescriptor>;
  readonly morphologyLabel?: string;
  readonly activeWeaponSetIndex: number;
  readonly stashItems: ReadonlyArray<UIInventoryItem>;
  readonly currentWeightLbs: number;
  readonly maxWeightLbs: number;
  readonly goldCurrency: number;
}

/**
 * Represents a toggleable tactical mode or numeric stance dial (e.g., Power Attack, Combat Expertise, Stealth).
 */
export interface UIStanceModeEntry {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly isActive: boolean;
  readonly description?: string;
  readonly tooltipText?: string;
  /** Optional numeric dial value (e.g. Power Attack / Combat Expertise trade-off points). */
  readonly numericValue?: number;
  /** Minimum value for numeric dial. */
  readonly minNumericValue?: number;
  /** Maximum value for numeric dial (e.g. current BAB cap). */
  readonly maxNumericValue?: number;
}

/**
 * Represents a round action-economy pip in the tactical dock (`STD`, `MOV`, `SWF`, `AoO`).
 */
export interface UIActionEconomyPip {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  readonly detailText?: string;
}

/**
 * Data model representing a bound action inside a Console Hotbar slot.
 */
export interface UIHotbarSlot {
  readonly slotIndex: number;
  readonly label: string;
  readonly iconUrl?: string | undefined;
  readonly keyLabel: string;
  readonly cooldownProgress?: number | undefined;
  readonly activeToggle?: boolean | undefined;
  readonly isDisabled?: boolean | undefined;
  readonly tooltipTitle?: string | undefined;
  readonly tooltipDescription?: string | undefined;
  readonly actionPayload?:
    | {
        readonly kind: 'item' | 'spell' | 'skill' | 'ability' | 'weapon';
        readonly id: string;
        readonly entityId?: number | undefined;
        readonly classId?: string | undefined;
        readonly slotIdx?: number | undefined;
      }
    | undefined;
}

/**
 * Represents the bottom NWN2-style Action Hotbar & Stance Modes dock.
 */
export interface UIHotbarModel {
  readonly activeBank: number;
  readonly totalBanks: number;
  readonly stanceModes: ReadonlyArray<UIStanceModeEntry>;
  readonly slots: ReadonlyArray<UIHotbarSlot>;
  readonly actionPips?: ReadonlyArray<UIActionEconomyPip>;
}

/**
 * Standard interface implemented by all Ruleset Cartridge UI Adapters.
 */
export interface ICartridgeUIAdapter {
  readonly rulesetId: string;
  readonly defaultThemeMode: 'parchment' | 'retro-crt';

  getCharacterSheetData(actor: unknown): UICharacterSheetModel;
  getInventoryData(actor: unknown): UIInventoryModel;
  getHotbarBinding(actor: unknown, slotIndex: number): UIInventoryItem | null;
  getStanceActions(actor: unknown): ReadonlyArray<{ id: string; label: string; isActive: boolean }>;
  getHotbarData?(actor: unknown, activeBank?: number): UIHotbarModel;
  getItemInspectData(item: unknown): UIInspectData;
}
