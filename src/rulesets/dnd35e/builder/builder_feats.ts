import { parseParameterizedFeatId } from '../effect_bundle.ts';
import type { DnD35ClassDefinition, DnD35FeatDefinition, DnD35RaceDefinition } from '../types/dnd35e_system.types.ts';

/** The five canonical feat slot pool categories. */
export type FeatSlotPoolType = 'general' | 'racial_bonus' | 'fighter_bonus' | 'wizard_bonus' | 'monk_bonus';

/** Descriptor for an individual feat slot earned at character creation or level-up. */
export interface FeatSlotDescriptor {
  readonly slotIndex: number;
  readonly poolType: FeatSlotPoolType;
  readonly label: string;
  readonly allowedFeatIds?: ReadonlyArray<string> | undefined;
  readonly ignorePrerequisites?: boolean | undefined;
}

/** Item creation and spell mastery feats eligible for Wizard bonus feat slots. */
export const WIZARD_BONUS_ITEM_CREATION_AND_MASTERY_FEATS: ReadonlyArray<string> = [
  'scribe_scroll',
  'brew_potion',
  'craft_wondrous_item',
  'craft_magic_arms_and_armor',
  'craft_wand',
  'craft_rod',
  'craft_staff',
  'forge_ring',
  'spell_mastery'
];

/**
 * Checks whether a candidate feat definition is allowed in a given feat slot.
 *
 * @param featDef The candidate feat definition.
 * @param slot The feat slot descriptor.
 * @returns True if the feat is eligible for this slot.
 */
export function isFeatAllowedInSlot(featDef: DnD35FeatDefinition, slot: FeatSlotDescriptor): boolean {
  const { baseFeatId } = parseParameterizedFeatId(featDef.id);

  if (slot.allowedFeatIds && slot.allowedFeatIds.length > 0) {
    return slot.allowedFeatIds.includes(featDef.id) || slot.allowedFeatIds.includes(baseFeatId);
  }

  switch (slot.poolType) {
    case 'general':
    case 'racial_bonus':
      return true;
    case 'fighter_bonus':
      return featDef.isFighterBonusFeat === true;
    case 'wizard_bonus': {
      const isMetamagic = featDef.metamagicDescriptor !== undefined;
      const isItemCreationOrMastery =
        WIZARD_BONUS_ITEM_CREATION_AND_MASTERY_FEATS.includes(featDef.id) ||
        WIZARD_BONUS_ITEM_CREATION_AND_MASTERY_FEATS.includes(baseFeatId);
      return isMetamagic || isItemCreationOrMastery;
    }
    case 'monk_bonus':
      return (
        slot.allowedFeatIds !== undefined &&
        (slot.allowedFeatIds.includes(featDef.id) || slot.allowedFeatIds.includes(baseFeatId))
      );
  }
}

/**
 * Computes the 1st-level feat slot budget breakdown.
 *
 * @param raceDef Selected race definition.
 * @param classDef Selected starting class definition.
 * @param selectedAcfs Optional selected ACFs at 1st level.
 * @returns Feat budget counts and typed slot descriptors.
 */
export function computeFirstLevelFeatSlotBudget(
  raceDef: DnD35RaceDefinition | undefined,
  classDef: DnD35ClassDefinition | undefined,
  selectedAcfs: ReadonlyArray<string> = []
): {
  readonly generalSlots: number;
  readonly humanBonusSlots: number;
  readonly fighterBonusSlots: number;
  readonly totalSlots: number;
  readonly slots: ReadonlyArray<FeatSlotDescriptor>;
} {
  const slots: FeatSlotDescriptor[] = [];
  let slotIndex = 0;

  // 1. General slot at level 1
  slots.push({
    slotIndex: slotIndex++,
    poolType: 'general',
    label: 'General Feat (1st Level)'
  });
  const generalSlots = 1;

  // 2. Racial bonus slot (e.g. Human)
  let humanBonusSlots = 0;
  if (raceDef?.bonusFeatAtFirstLevel === true) {
    humanBonusSlots = 1;
    slots.push({
      slotIndex: slotIndex++,
      poolType: 'racial_bonus',
      label: 'Racial Bonus Feat'
    });
  }

  // 3. Class bonus feats at level 1 (e.g. Fighter 1, Monk 1)
  let fighterBonusSlots = 0;
  if (classDef) {
    const row1 = classDef.progression.find((r) => r.level === 1);
    const rawFeatures = row1?.features ?? [];
    const activeFeatures: string[] = [];
    for (const fId of rawFeatures) {
      const swap = classDef.acfSwaps.find((s) => s.replacesFeature === fId && selectedAcfs.includes(s.acfId));
      if (swap) {
        if (swap.grantedFeature) activeFeatures.push(swap.grantedFeature);
      } else {
        activeFeatures.push(fId);
      }
    }

    for (const fId of activeFeatures) {
      if (fId.startsWith('fighter_bonus_feat')) {
        fighterBonusSlots = 1;
        slots.push({
          slotIndex: slotIndex++,
          poolType: 'fighter_bonus',
          label: 'Fighter Bonus Feat'
        });
      } else {
        const detail = classDef.featureDetails[fId];
        if (detail?.bonusFeatPool && detail.bonusFeatPool.length > 0) {
          slots.push({
            slotIndex: slotIndex++,
            poolType: 'monk_bonus',
            label: detail.name ?? `Bonus Feat (${fId})`,
            allowedFeatIds: detail.bonusFeatPool,
            ignorePrerequisites: true
          });
        }
      }
    }
  }

  return {
    generalSlots,
    humanBonusSlots,
    fighterBonusSlots,
    totalSlots: slots.length,
    slots
  };
}

/**
 * Computes the typed feat slots earned when advancing an actor by one level.
 *
 * @param classDef The class definition being advanced.
 * @param nextClassLevel The new level in that class (e.g. 1 for multiclass, or prevLevel + 1).
 * @param nextTotalCharacterLevel The new total character level across all classes.
 * @param selectedAcfs Selected ACFs for this level (or previous levels).
 * @returns Array of typed `FeatSlotDescriptor`s earned at this level (may be empty).
 */
export function computeLevelUpFeatSlots(
  classDef: DnD35ClassDefinition | undefined,
  nextClassLevel: number,
  nextTotalCharacterLevel: number,
  selectedAcfs: ReadonlyArray<string> = []
): ReadonlyArray<FeatSlotDescriptor> {
  const slots: FeatSlotDescriptor[] = [];
  let slotIndex = 0;

  // General feat at 3, 6, 9, 12, 15, 18
  if (nextTotalCharacterLevel % 3 === 0) {
    slots.push({
      slotIndex: slotIndex++,
      poolType: 'general',
      label: `General Feat (Level ${nextTotalCharacterLevel})`
    });
  }

  if (!classDef) return slots;

  const row = classDef.progression.find((r) => r.level === nextClassLevel);
  if (!row) return slots;

  const rawFeatures = row.features ?? [];
  const activeFeatures: string[] = [];
  for (const fId of rawFeatures) {
    const swap = classDef.acfSwaps.find((s) => s.replacesFeature === fId && selectedAcfs.includes(s.acfId));
    if (swap) {
      if (swap.grantedFeature) activeFeatures.push(swap.grantedFeature);
    } else {
      activeFeatures.push(fId);
    }
  }

  for (const fId of activeFeatures) {
    if (fId.startsWith('fighter_bonus_feat')) {
      slots.push({
        slotIndex: slotIndex++,
        poolType: 'fighter_bonus',
        label: `Fighter Bonus Feat (Fighter ${nextClassLevel})`
      });
    } else if (fId.startsWith('wizard_bonus_feat')) {
      slots.push({
        slotIndex: slotIndex++,
        poolType: 'wizard_bonus',
        label: 'Wizard Bonus Feat (Metamagic / Item Creation)'
      });
    } else {
      const detail = classDef.featureDetails[fId];
      if (detail?.bonusFeatPool && detail.bonusFeatPool.length > 0) {
        slots.push({
          slotIndex: slotIndex++,
          poolType: 'monk_bonus',
          label: detail.name ?? `Bonus Feat (${fId})`,
          allowedFeatIds: detail.bonusFeatPool,
          ignorePrerequisites: true
        });
      }
    }
  }

  return slots;
}
