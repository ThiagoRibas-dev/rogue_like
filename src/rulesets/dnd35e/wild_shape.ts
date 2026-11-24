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
  NaturalWeaponDescriptor,
  StatModifier
} from './types/dnd35e.types.ts';
import { SIZE_METRICS } from './spatial/grid_geometry.ts';
import type { DnD35RaceDefinition } from './types/dnd35e_system.types.ts';
import { addFloatingText } from '../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { getEffectiveWorldClockConfig } from '../../systems/world_clock.system.ts';
import { getTurnsPerHour } from '../../utils/duration.ts';

export * from './shapeshift.ts';

/** Default priority for Wild Shape base form overlay (`100`). */
const WILD_SHAPE_OVERLAY_PRIORITY = 100;

/** Baseline ability score used when a race lacks an explicit default score. */
const WILD_SHAPE_DEFAULT_ABILITY_BASE = 10;

/** Default land speed in feet when a race lacks an explicit speed. */
const WILD_SHAPE_DEFAULT_SPEED_FT = 30;

/**
 * Definition of a target animal, plant, or elemental form for Wild Shape.
 */
export interface WildShapeFormDefinition {
  readonly formId: string;
  readonly name: string;
  readonly creatureType: 'animal' | 'plant' | 'elemental';
  readonly sizeCategory: CreatureSizeCategory;
  readonly physicalScores: { readonly str: number; readonly dex: number; readonly con: number };
  readonly naturalArmorBonus: number;
  readonly naturalWeapons: ReadonlyArray<NaturalWeaponDescriptor>;
  readonly landSpeedFt: number;
  readonly flySpeedFt?: number | undefined;
  readonly swimSpeedFt?: number | undefined;
  readonly footprint?: { readonly width: number; readonly height: number } | undefined;
  readonly footprintsBySize?:
    Readonly<Record<string, { readonly width: number; readonly height: number } | undefined>> | undefined;
}

export function isWildShapeFormEligible(druidLevel: number, form: WildShapeFormDefinition): boolean {
  if (druidLevel < 5) return false;
  const s = form.sizeCategory;
  if (form.creatureType === 'animal') {
    if (s === 'small' || s === 'medium') return druidLevel >= 5;
    if (s === 'large') return druidLevel >= 8;
    if (s === 'tiny') return druidLevel >= 11;
    return s === 'huge' && druidLevel >= 15;
  }
  if (form.creatureType === 'plant') {
    if (druidLevel < 12) return false;
    return s === 'small' || s === 'medium' || s === 'large' || (s === 'huge' && druidLevel >= 15);
  }
  if (form.creatureType === 'elemental') {
    if (druidLevel < 16) return false;
    return s === 'small' || s === 'medium' || s === 'large' || (s === 'huge' && druidLevel >= 20);
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
  const durationTurns = Math.max(1, Math.round(druidLevel * getTurnsPerHour(getEffectiveWorldClockConfig(nextState))));
  const overlay: PropertyOverlayComponent = {
    type: ComponentType.PropertyOverlay,
    source: `wild_shape:${form.formId}`,
    priority: WILD_SHAPE_OVERLAY_PRIORITY,
    durationTurns,
    sizeCategoryOverride: form.sizeCategory,
    creatureTypeOverride: form.creatureType,
    movementModesOverride,
    ...(form.naturalWeapons.length > 0 ? { naturalWeaponsOverride: form.naturalWeapons } : {}),
    ...(form.footprint !== undefined ? { footprintOverride: form.footprint } : {}),
    ...(form.footprintsBySize !== undefined ? { footprintsBySizeOverride: form.footprintsBySize } : {}),
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
 * Derives a `WildShapeFormDefinition` declaratively from a System Content `DnD35RaceDefinition`
 * when its `creatureType` is `'animal'`, `'plant'`, or `'elemental'`.
 *
 * @param raceDef Declarative race definition from `races/*.json`.
 * @returns Hydrated `WildShapeFormDefinition` or `null` if the race is not a Wild Shape creature type.
 */
export function deriveWildShapeFormFromRace(raceDef: DnD35RaceDefinition): WildShapeFormDefinition | null {
  if (raceDef.creatureType !== 'animal' && raceDef.creatureType !== 'plant' && raceDef.creatureType !== 'elemental') {
    return null;
  }

  const baseScores = raceDef.defaultAbilityScores;
  const adj = raceDef.abilityAdjustments;
  const str = baseScores?.str ?? WILD_SHAPE_DEFAULT_ABILITY_BASE + (adj?.str ?? 0);
  const dex = baseScores?.dex ?? WILD_SHAPE_DEFAULT_ABILITY_BASE + (adj?.dex ?? 0);
  const con = baseScores?.con ?? WILD_SHAPE_DEFAULT_ABILITY_BASE + (adj?.con ?? 0);
  const landSpeedFt = raceDef.movementModes?.land ?? raceDef.baseLandSpeedFt ?? WILD_SHAPE_DEFAULT_SPEED_FT;

  return {
    formId: raceDef.id,
    name: raceDef.name,
    creatureType: raceDef.creatureType,
    sizeCategory: raceDef.size,
    physicalScores: { str, dex, con },
    naturalArmorBonus: raceDef.naturalArmorBonus ?? 0,
    naturalWeapons: raceDef.naturalWeapons ?? [],
    landSpeedFt,
    ...(raceDef.movementModes?.fly !== undefined ? { flySpeedFt: raceDef.movementModes.fly } : {}),
    ...(raceDef.movementModes?.swim !== undefined ? { swimSpeedFt: raceDef.movementModes.swim } : {}),
    ...(raceDef.footprint !== undefined ? { footprint: raceDef.footprint } : {}),
    ...(raceDef.footprintsBySize !== undefined ? { footprintsBySize: raceDef.footprintsBySize } : {})
  };
}

/**
 * Selects the strongest (or explicitly requested) eligible `WildShapeFormDefinition` from loaded
 * `races/*.json` definitions, enforcing both creature-type/size unlocks and the PHB HD <= Druid level cap.
 *
 * @param druidLevel Current effective Druid level.
 * @param races Loaded race definitions registry.
 * @param preferredFormId Optional specific race/form ID to assume.
 * @returns Eligible `WildShapeFormDefinition` or `null`.
 */
export function selectBestEligibleWildShapeForm(
  druidLevel: number,
  races: Readonly<Record<string, DnD35RaceDefinition>>,
  preferredFormId?: string
): WildShapeFormDefinition | null {
  const getRaceHd = (r: DnD35RaceDefinition): number =>
    Math.max(1, r.rhdProgression?.baseHdCount || r.racialHitDice?.count || 1);

  if (preferredFormId !== undefined) {
    const preferredRace = races[preferredFormId];
    if (!preferredRace) return null;
    const form = deriveWildShapeFormFromRace(preferredRace);
    if (!form) return null;
    return getRaceHd(preferredRace) <= druidLevel && isWildShapeFormEligible(druidLevel, form) ? form : null;
  }

  const eligible: Array<{ readonly form: WildShapeFormDefinition; readonly score: number }> = [];
  for (const raceDef of Object.values(races)) {
    const form = deriveWildShapeFormFromRace(raceDef);
    if (!form) continue;
    const hd = getRaceHd(raceDef);
    if (hd > druidLevel || !isWildShapeFormEligible(druidLevel, form)) continue;
    const score = hd * 100 + form.physicalScores.str + form.naturalArmorBonus;
    eligible.push({ form, score });
  }

  if (eligible.length === 0) return null;
  eligible.sort((a, b) => b.score - a.score);
  return eligible[0]!.form;
}

/**
 * Executes a Druid Wild Shape activation or reversion from a `ResourcePoolComponent` slot,
 * checking eligibility before consuming a daily charge and reverting for free per PHB p. 37.
 */
export function executeWildShapePoolActivation(params: {
  readonly state: GameState;
  readonly actorId: EntityId;
  readonly druidLevel: number;
  readonly races: Readonly<Record<string, DnD35RaceDefinition>>;
  readonly label: string;
  readonly consumeActionAndCharge: (
    s: GameState,
    spendCharge: boolean
  ) => { readonly state: GameState; readonly allowed: boolean };
}): { readonly state: GameState; readonly success: boolean } {
  const { state, actorId, druidLevel, races, label, consumeActionAndCharge } = params;
  const existingOverlay = getComponent(state, actorId, ComponentType.PropertyOverlay) as
    PropertyOverlayComponent | undefined;
  const isReverting = existingOverlay?.source.startsWith('wild_shape:') === true;

  if (isReverting) {
    const step = consumeActionAndCharge(state, false);
    if (!step.allowed) return { state: step.state, success: false };
    let nextState = revertWildShapeForm(step.state, actorId);
    nextState = addFloatingText(nextState, actorId, 'NORMAL FORM', '#dfe6e9');
    return {
      state: addMessage(nextState, 'Reverted from Wild Shape to normal form.', MessageLogCategory.System),
      success: true
    };
  }

  const form = selectBestEligibleWildShapeForm(druidLevel, races);
  if (!form) {
    return {
      state: addMessage(
        state,
        `${label}: No eligible creature form available at level ${druidLevel}.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const step = consumeActionAndCharge(state, true);
  if (!step.allowed) return { state: step.state, success: false };
  let nextState = applyWildShapeForm(step.state, actorId, form, druidLevel);
  nextState = addFloatingText(nextState, actorId, form.name.toUpperCase(), '#55efc4');
  return {
    state: addMessage(
      nextState,
      `Wild Shaped into ${form.name} (${form.sizeCategory} ${form.creatureType})!`,
      MessageLogCategory.System
    ),
    success: true
  };
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
      ...(overlay.statModifiers !== undefined ? { statModifiers: overlay.statModifiers } : {}),
      ...(overlay.sizeCategoryOverride !== undefined ? { sizeCategoryOverride: overlay.sizeCategoryOverride } : {}),
      ...(overlay.creatureTypeOverride !== undefined ? { creatureTypeOverride: overlay.creatureTypeOverride } : {}),
      ...(overlay.movementModesOverride !== undefined ? { movementModesOverride: overlay.movementModesOverride } : {}),
      ...(overlay.footprintOverride !== undefined ? { footprintOverride: overlay.footprintOverride } : {}),
      ...(overlay.footprintsBySizeOverride !== undefined
        ? { footprintsBySizeOverride: overlay.footprintsBySizeOverride }
        : {}),
      ...(overlay.naturalWeaponsOverride !== undefined
        ? { naturalWeaponsOverride: overlay.naturalWeaponsOverride }
        : {}),
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
  let naturalWeapons = baseData.naturalWeapons;
  let footprint = baseData.footprint;
  let footprintsBySize = baseData.footprintsBySize;
  const overlayModifiers: StatModifier[] = [...(baseData.statModifiers ?? [])];

  for (const layer of layersToApply) {
    const overrides = layer.statOverrides;
    if (overrides) {
      for (const s of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const) {
        if (overrides[s] !== undefined) nextScores[s] = { ...nextScores[s], base: overrides[s]! };
      }
      if (overrides['naturalArmorBonus'] !== undefined) {
        naturalArmorBonus = overrides['naturalArmorBonus']!;
        overlayModifiers.push({
          targetStat: 'natural_armor',
          value: naturalArmorBonus,
          bonusType: 'form_override',
          sourceId: `${layer.source}:natural_armor`,
          sourcePath: `${layer.source}/natural_armor`,
          origin: 'ex'
        });
      }
    }
    if (layer.statModifiers !== undefined) {
      overlayModifiers.push(...(layer.statModifiers as ReadonlyArray<StatModifier>));
    }
    if (layer.sizeCategoryOverride !== undefined) {
      sizeCategory = layer.sizeCategoryOverride as CreatureSizeCategory;
      overlayModifiers.push({
        targetStat: 'size',
        value: SIZE_METRICS[sizeCategory].rankIndex,
        bonusType: 'form_override',
        sourceId: `${layer.source}:size`,
        sourcePath: `${layer.source}/size:${sizeCategory}`,
        origin: 'su'
      });
    }
    if (layer.creatureTypeOverride !== undefined) creatureType = layer.creatureTypeOverride;
    if (layer.movementModesOverride !== undefined) movementModes = layer.movementModesOverride;
    if (layer.footprintOverride !== undefined) footprint = layer.footprintOverride;
    if (layer.footprintsBySizeOverride !== undefined) footprintsBySize = layer.footprintsBySizeOverride;
    if (layer.naturalWeaponsOverride !== undefined) {
      naturalWeapons = layer.naturalWeaponsOverride as ReadonlyArray<NaturalWeaponDescriptor>;
    }
  }

  return {
    ...baseData,
    abilityScores: nextScores,
    naturalArmorBonus,
    sizeCategory,
    statModifiers: overlayModifiers,
    ...(creatureType !== undefined ? { creatureType } : {}),
    ...(movementModes !== undefined ? { movementModes } : {}),
    ...(footprint !== undefined ? { footprint } : {}),
    ...(footprintsBySize !== undefined ? { footprintsBySize } : {}),
    ...(naturalWeapons !== undefined ? { naturalWeapons } : {})
  };
}
