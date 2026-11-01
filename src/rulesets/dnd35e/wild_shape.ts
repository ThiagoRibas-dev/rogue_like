import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type {
  EquipmentComponent,
  EquipmentSlotInstance,
  ItemComponent,
  MovementModes,
  PropertyOverlayComponent,
  PropertyOverlayLayer
} from '../../types/components.types.ts';
import { addComponent, getComponent, removeComponent } from '../../core/ecs.ts';
import type {
  CreatureSizeCategory,
  DnD35EntityData,
  NaturalWeaponDescriptor
} from './types/dnd35e.types.ts';

/** Number of combat rounds in 1 hour (`600`). */
const ROUNDS_PER_HOUR = 600;

/** Default priority for Wild Shape base form overlay (`100`). */
const WILD_SHAPE_OVERLAY_PRIORITY = 100;

/**
 * Definition of a target animal, plant, or elemental form for Wild Shape.
 */
export interface WildShapeFormDefinition {
  readonly formId: string;
  readonly name: string;
  readonly creatureType: 'animal' | 'plant' | 'elemental';
  readonly sizeCategory: CreatureSizeCategory;
  readonly physicalScores: {
    readonly str: number;
    readonly dex: number;
    readonly con: number;
  };
  readonly naturalArmorBonus: number;
  readonly naturalWeapons: ReadonlyArray<NaturalWeaponDescriptor>;
  readonly landSpeedFt: number;
  readonly flySpeedFt?: number | undefined;
  readonly swimSpeedFt?: number | undefined;
}

/**
 * Checks if a Druid of the given level is eligible to Wild Shape into the specified form.
 * Level progression:
 * - Level 5: Small or Medium Animal
 * - Level 8: Large Animal
 * - Level 11: Tiny Animal
 * - Level 12: Plant (Small, Medium, Large)
 * - Level 15: Huge Animal or Plant
 * - Level 16: Small, Medium, Large Elemental
 * - Level 20: Huge Elemental
 */
export function isWildShapeFormEligible(druidLevel: number, form: WildShapeFormDefinition): boolean {
  if (druidLevel < 5) return false;

  if (form.creatureType === 'animal') {
    if (form.sizeCategory === 'small' || form.sizeCategory === 'medium') return druidLevel >= 5;
    if (form.sizeCategory === 'large') return druidLevel >= 8;
    if (form.sizeCategory === 'tiny') return druidLevel >= 11;
    if (form.sizeCategory === 'huge') return druidLevel >= 15;
    return false;
  }

  if (form.creatureType === 'plant') {
    if (druidLevel < 12) return false;
    if (form.sizeCategory === 'small' || form.sizeCategory === 'medium' || form.sizeCategory === 'large') return true;
    if (form.sizeCategory === 'huge') return druidLevel >= 15;
    return false;
  }

  if (form.creatureType === 'elemental') {
    if (druidLevel < 16) return false;
    if (form.sizeCategory === 'small' || form.sizeCategory === 'medium' || form.sizeCategory === 'large') return true;
    if (form.sizeCategory === 'huge') return druidLevel >= 20;
    return false;
  }

  return false;
}

/**
 * Applies Wild Shape to an entity by attaching a PropertyOverlayComponent and melding equipment slots
 * (except items tagged `wild` or `wild_melds_active`, such as *Wild* armor).
 * Duration is 1 hour (600 combat turns) per druid level.
 */
export function applyWildShapeForm(
  state: GameState,
  entityId: EntityId,
  form: WildShapeFormDefinition,
  druidLevel: number
): GameState {
  if (!isWildShapeFormEligible(druidLevel, form)) {
    throw new Error(
      `Druid level ${druidLevel} is not eligible to assume form ${form.name} (${form.sizeCategory} ${form.creatureType})`
    );
  }

  let nextState = state;

  // 1. Meld equipment: mark slots with suppressed: true unless item has 'wild' or 'wild_melds_active' tag
  const equipCmp = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (equipCmp) {
    const meldedSlots: EquipmentSlotInstance[] = equipCmp.slots.map((slot) => {
      if (slot.equippedItem !== null) {
        const itemComp = getComponent(nextState, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
        const itemDef = itemComp ? nextState.campaign.items[itemComp.itemId] : undefined;
        const itemTags = itemDef?.tags ?? [];
        if (itemTags.includes('wild_melds_active') || itemTags.includes('wild')) {
          return slot;
        }
      }
      return {
        ...slot,
        suppressed: true
      };
    });
    nextState = addComponent(nextState, entityId, {
      ...equipCmp,
      slots: meldedSlots
    });
  }

  // 2. Build movementModes override
  const movementModesOverride: MovementModes = {
    land: form.landSpeedFt,
    ...(form.flySpeedFt !== undefined ? { fly: form.flySpeedFt } : {}),
    ...(form.swimSpeedFt !== undefined ? { swim: form.swimSpeedFt } : {})
  };

  // 3. Attach PropertyOverlayComponent
  const durationTurns = druidLevel * ROUNDS_PER_HOUR;
  const overlay: PropertyOverlayComponent = {
    type: ComponentType.PropertyOverlay,
    source: `wild_shape:${form.formId}`,
    priority: WILD_SHAPE_OVERLAY_PRIORITY,
    durationTurns,
    sizeCategoryOverride: form.sizeCategory,
    creatureTypeOverride: form.creatureType,
    movementModesOverride,
    statOverrides: {
      str: form.physicalScores.str,
      dex: form.physicalScores.dex,
      con: form.physicalScores.con,
      naturalArmorBonus: form.naturalArmorBonus
    },
    grantedTags: ['wild_shape', `form:${form.formId}`, form.creatureType]
  };

  nextState = addComponent(nextState, entityId, overlay);
  return nextState;
}

/**
 * Reverts Wild Shape form, removing the PropertyOverlayComponent and un-suppressing equipment slots.
 */
export function revertWildShapeForm(state: GameState, entityId: EntityId): GameState {
  let nextState = state;

  // 1. Remove overlay
  nextState = removeComponent(nextState, entityId, ComponentType.PropertyOverlay);

  // 2. Un-suppress equipment slots
  const equipCmp = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (equipCmp) {
    const unmeldedSlots: EquipmentSlotInstance[] = equipCmp.slots.map((slot) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { suppressed, ...rest } = slot;
      return rest;
    });
    nextState = addComponent(nextState, entityId, {
      ...equipCmp,
      slots: unmeldedSlots
    });
  }

  return nextState;
}

/**
 * Resolves effective entity data combining base DnD35EntityData with any active PropertyOverlayComponent
 * and its priority-sorted `layers` stack.
 */
export function resolveEffectiveEntityDataWithOverlays(
  baseData: DnD35EntityData,
  overlay?: PropertyOverlayComponent
): DnD35EntityData {
  if (!overlay) return baseData;

  const layersToApply: PropertyOverlayLayer[] = [
    {
      layerId: overlay.source,
      source: overlay.source,
      priority: overlay.priority,
      ...(overlay.durationTurns !== undefined ? { durationTurns: overlay.durationTurns } : {}),
      ...(overlay.statOverrides !== undefined ? { statOverrides: overlay.statOverrides } : {}),
      ...(overlay.sizeCategoryOverride !== undefined ? { sizeCategoryOverride: overlay.sizeCategoryOverride } : {}),
      ...(overlay.creatureTypeOverride !== undefined ? { creatureTypeOverride: overlay.creatureTypeOverride } : {}),
      ...(overlay.movementModesOverride !== undefined ? { movementModesOverride: overlay.movementModesOverride } : {}),
      ...(overlay.grantedTags !== undefined ? { grantedTags: overlay.grantedTags } : {}),
      ...(overlay.suppressedTags !== undefined ? { suppressedTags: overlay.suppressedTags } : {}),
      ...(overlay.suppressedSlots !== undefined ? { suppressedSlots: overlay.suppressedSlots } : {})
    },
    ...(overlay.layers ?? [])
  ];

  // Sort ascending by priority so higher-priority layers override lower-priority layers
  layersToApply.sort((a, b) => a.priority - b.priority);

  const nextScores = { ...baseData.abilityScores };
  let naturalArmorBonus = baseData.naturalArmorBonus;
  let sizeCategory = baseData.sizeCategory;
  let creatureType = baseData.creatureType;
  let movementModes = baseData.movementModes;

  for (const layer of layersToApply) {
    const overrides = layer.statOverrides;
    if (overrides) {
      for (const s of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
        if (overrides[s] !== undefined) {
          nextScores[s] = {
            ...nextScores[s],
            base: overrides[s]!
          };
        }
      }
      if (overrides['naturalArmorBonus'] !== undefined) {
        naturalArmorBonus = overrides['naturalArmorBonus']!;
      }
    }

    if (layer.sizeCategoryOverride !== undefined) {
      sizeCategory = layer.sizeCategoryOverride as CreatureSizeCategory;
    }
    if (layer.creatureTypeOverride !== undefined) {
      creatureType = layer.creatureTypeOverride;
    }
    if (layer.movementModesOverride !== undefined) {
      movementModes = layer.movementModesOverride;
    }
  }

  return {
    ...baseData,
    abilityScores: nextScores,
    naturalArmorBonus,
    sizeCategory,
    ...(creatureType !== undefined ? { creatureType } : {}),
    ...(movementModes !== undefined ? { movementModes } : {})
  };
}
