import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { resolveEffectiveItemDefinition } from '../equipment/item_inheritance.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { CreatureSizeCategory } from '../types/dnd35e.types.ts';
import type { DnD35FeatDefinition, DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';
import type { AttackRollParams } from './attack_roll.ts';

/** Minimum whole ranks in Tumble required for enhanced defensive fighting (+3 / +6 Dodge AC). */
const TUMBLE_SYNERGY_MIN_RANKS = 5;

const FIXED_CAP_FIVE = 5;

/** Attack roll penalty incurred when executing Monk's Decisive Strike stance (`2`, PHB II p. 51). */
export const DECISIVE_STRIKE_ATTACK_PENALTY = 2;

/**
 * Declarative descriptor for a variable doctrine dial (e.g., Power Attack, Combat Expertise).
 */
export interface TacticalDialDescriptor {
  readonly abilityId: string;
  readonly name?: string | undefined;
  readonly min: number;
  readonly maxCapRule: 'bab' | 'fixed_5' | 'class_level';
  readonly attackDeltaPerPoint: number;
  readonly damageDeltaPerPoint: number;
  readonly acDeltaPerPoint: number;
  readonly twoHandedMultiplier?: number | undefined;
  readonly legacyPropertyKey?: 'powerAttackAmount' | 'combatExpertiseAmount' | undefined;
}

/** Canonical fallback doctrine dials for SRD feats. */
export const CANONICAL_TACTICAL_DIALS: ReadonlyArray<TacticalDialDescriptor> = [
  {
    abilityId: 'power_attack',
    name: 'Power Attack',
    min: 0,
    maxCapRule: 'bab',
    attackDeltaPerPoint: -1,
    damageDeltaPerPoint: 1,
    acDeltaPerPoint: 0,
    twoHandedMultiplier: 2,
    legacyPropertyKey: 'powerAttackAmount'
  },
  {
    abilityId: 'combat_expertise',
    name: 'Combat Expertise',
    min: 0,
    maxCapRule: 'fixed_5',
    attackDeltaPerPoint: -1,
    damageDeltaPerPoint: 0,
    acDeltaPerPoint: 1,
    legacyPropertyKey: 'combatExpertiseAmount'
  }
];

/**
 * Extracts active `TacticalDialDescriptor` entries declaratively from an actor's owned feats
 * (`featDef.activatedAbilities[].variableDial` or `featDef.effectBundle.activatedAbilities[].variableDial`),
 * falling back to `CANONICAL_TACTICAL_DIALS` only when no feat registry is provided.
 */
export function extractActorTacticalDials(
  featIds: ReadonlyArray<string>,
  featRegistry: Readonly<Record<string, DnD35FeatDefinition>> | undefined,
  suppressedBundleIds: ReadonlyArray<string> = []
): ReadonlyArray<TacticalDialDescriptor> {
  if (!featRegistry) {
    const ownedSet = new Set(featIds.map((f) => (f.includes(':') ? f.split(':')[0]! : f)));
    return CANONICAL_TACTICAL_DIALS.filter(
      (d) => ownedSet.has(d.abilityId) && !suppressedBundleIds.includes(d.abilityId)
    );
  }
  const dials: TacticalDialDescriptor[] = [];

  for (const rawFeatId of featIds) {
    const baseFeatId = rawFeatId.includes(':') ? rawFeatId.split(':')[0]! : rawFeatId;
    const featDef = featRegistry[rawFeatId] ?? featRegistry[baseFeatId];
    if (!featDef) continue;
    if (suppressedBundleIds.includes(rawFeatId) || suppressedBundleIds.includes(featDef.id)) continue;

    const activated = [...(featDef.activatedAbilities ?? []), ...(featDef.effectBundle?.activatedAbilities ?? [])];

    for (const act of activated) {
      const vd = act.variableDial;
      if (!vd) continue;
      const isPowerAttack = featDef.id === 'power_attack';
      const isCombatExpertise = featDef.id === 'combat_expertise';
      dials.push({
        abilityId: featDef.id,
        name: featDef.name ?? act.name,
        min: vd.min ?? 0,
        maxCapRule: vd.maxCapRule,
        attackDeltaPerPoint: vd.attackDeltaPerPoint,
        damageDeltaPerPoint: vd.damageDeltaPerPoint,
        acDeltaPerPoint: vd.acDeltaPerPoint,
        ...(isPowerAttack ? { twoHandedMultiplier: 2 } : {}),
        ...(isPowerAttack
          ? { legacyPropertyKey: 'powerAttackAmount' }
          : isCombatExpertise
            ? { legacyPropertyKey: 'combatExpertiseAmount' }
            : {})
      });
    }
  }

  return dials;
}

/**
 * Evaluates attack roll and damage/AC adjustments resulting from active tactical doctrines
 * (Power Attack, Combat Expertise, Fighting Defensively, Total Defense), including 5-rank
 * Tumble synergy (`+3` Dodge AC when Fighting Defensively, `+6` Dodge AC in Total Defense).
 */
export function evaluateTacticalDoctrineModifiers(
  doctrine: TacticalDoctrineComponent,
  bab: number,
  handedness: 'light' | 'one_handed' | 'two_handed',
  tumbleRanks = 0,
  customDials?: ReadonlyArray<TacticalDialDescriptor>
): {
  readonly attackPenalty: number;
  readonly damageBonus: number;
  readonly dodgeAcBonus: number;
  readonly canAttack: boolean;
} {
  const hasTumbleSynergy = dndFloor(tumbleRanks) >= TUMBLE_SYNERGY_MIN_RANKS;

  if (doctrine.totalDefense === true) {
    return {
      attackPenalty: 0,
      damageBonus: 0,
      dodgeAcBonus: hasTumbleSynergy ? 6 : 4,
      canAttack: false
    };
  }

  let attackPenalty = 0;
  let damageBonus = 0;
  let dodgeAcBonus = 0;

  const dials = customDials ?? CANONICAL_TACTICAL_DIALS;
  for (const dial of dials) {
    let dialValue = 0;
    if (doctrine.settings) {
      const settingVal = doctrine.settings[dial.abilityId] ?? doctrine.settings[`${dial.abilityId}_dial`];
      if (typeof settingVal === 'number') dialValue = settingVal;
    }
    if (dialValue === 0 && dial.legacyPropertyKey !== undefined) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') dialValue = legacyVal;
    }

    if (dialValue > 0) {
      let maxCap = bab;
      if (dial.maxCapRule === 'fixed_5') maxCap = Math.min(FIXED_CAP_FIVE, bab);
      const clamped = Math.max(dial.min, Math.min(dialValue, maxCap));
      if (clamped > 0) {
        if (dial.attackDeltaPerPoint !== 0) attackPenalty += clamped * Math.abs(dial.attackDeltaPerPoint);
        if (dial.acDeltaPerPoint > 0) dodgeAcBonus += clamped * dial.acDeltaPerPoint;
        if (dial.damageDeltaPerPoint > 0) {
          if (handedness === 'two_handed') {
            damageBonus += clamped * dial.damageDeltaPerPoint * (dial.twoHandedMultiplier ?? 2);
          } else if (handedness !== 'light') {
            damageBonus += clamped * dial.damageDeltaPerPoint;
          }
        }
      }
    }
  }

  if (doctrine.fightingDefensively === true) {
    attackPenalty += 4;
    dodgeAcBonus += hasTumbleSynergy ? 3 : 2;
  }

  if (doctrine.decisiveStrike === true) {
    attackPenalty += DECISIVE_STRIKE_ATTACK_PENALTY;
  }

  return {
    attackPenalty: -attackPenalty,
    damageBonus,
    dodgeAcBonus,
    canAttack: true
  };
}

/**
 * Computes the doctrine damage bonus (e.g., Power Attack) specifically for an individual strike
 * based on its handedness and whether it is a manufactured vs. natural/unarmed attack.
 */
export function computeStrikeDoctrineDamageBonus(
  doctrine: TacticalDoctrineComponent | undefined,
  bab: number,
  strikeHandedness: AttackRollParams['handedness'],
  isNaturalOrUnarmed: boolean,
  cannotTwoHandStr?: boolean,
  customDials?: ReadonlyArray<TacticalDialDescriptor>
): number {
  if (!doctrine) return 0;
  const dials = customDials ?? CANONICAL_TACTICAL_DIALS;
  let totalDmgBonus = 0;

  for (const dial of dials) {
    if (dial.damageDeltaPerPoint <= 0) continue;
    let dialValue = 0;
    if (doctrine.settings) {
      const settingVal = doctrine.settings[dial.abilityId] ?? doctrine.settings[`${dial.abilityId}_dial`];
      if (typeof settingVal === 'number') dialValue = settingVal;
    }
    if (dialValue === 0 && dial.legacyPropertyKey !== undefined) {
      const legacyVal = doctrine[dial.legacyPropertyKey];
      if (typeof legacyVal === 'number') dialValue = legacyVal;
    }
    if (dialValue <= 0) continue;

    let maxCap = bab;
    if (dial.maxCapRule === 'fixed_5') maxCap = Math.min(FIXED_CAP_FIVE, bab);
    const clamped = Math.max(dial.min, Math.min(dialValue, maxCap));
    if (clamped <= 0) continue;

    if (!isNaturalOrUnarmed && (strikeHandedness === 'light' || strikeHandedness === 'off_hand')) {
      continue;
    }

    if (strikeHandedness === 'two_handed' || strikeHandedness === 'primary_natural_sole') {
      totalDmgBonus += cannotTwoHandStr
        ? clamped * dial.damageDeltaPerPoint
        : clamped * dial.damageDeltaPerPoint * (dial.twoHandedMultiplier ?? 2);
    } else {
      totalDmgBonus += clamped * dial.damageDeltaPerPoint;
    }
  }

  return totalDmgBonus;
}

/** Size multipliers for carrying capacity (bipedal). */
const BIPED_SIZE_CARRY_MULTIPLIER: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 0.125,
  diminutive: 0.25,
  tiny: 0.5,
  small: 0.75,
  medium: 1,
  large: 2,
  huge: 4,
  gargantuan: 8,
  colossal: 16
};

/** Size multipliers for carrying capacity (quadrupeds, PHB p. 162). */
const QUADRUPED_SIZE_CARRY_MULTIPLIER: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 0.25,
  diminutive: 0.5,
  tiny: 0.75,
  small: 1,
  medium: 1.5,
  large: 3,
  huge: 6,
  gargantuan: 12,
  colossal: 24
};

/** Base heavy load table for Strength 1–20 in pounds. */
const BASE_STR_HEAVY_LOAD: Readonly<Record<number, number>> = {
  1: 10,
  2: 20,
  3: 30,
  4: 40,
  5: 50,
  6: 60,
  7: 70,
  8: 80,
  9: 90,
  10: 100,
  11: 115,
  12: 130,
  13: 150,
  14: 175,
  15: 200,
  16: 230,
  17: 260,
  18: 300,
  19: 350,
  20: 400
};

/** SRD Strength increment (`10`) at which carrying capacity quadruples (`x4`) above 20. */
const HIGH_STR_DECADE_STEP = 10;

/** SRD high-Strength carrying capacity multiplier (`4`) per decade above 20. */
const HIGH_STR_DECADE_MULTIPLIER = 4;

/** Maximum Strength covered directly by the base carrying table (`20`). */
const MAX_TABLE_STRENGTH = 20;

/** Tag marking starter clothing outfits where 1 worn/carried outfit weighs 0 lb per SRD. */
const STARTER_OUTFIT_TAG = 'starter_outfit';

/**
 * Computes total carried weight in pounds for an actor by deduplicating items across
 * `InventoryComponent` and `EquipmentComponent` slots, resolving `baseItemId` inheritance,
 * multiplying by `quantity`, and excluding up to 1 `starter_outfit` per SRD (PHB p. 131).
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns Total carried weight in pounds (`>= 0`).
 */
export function computeActorCarriedWeightLbs(state: GameState, entityId: EntityId): number {
  const seenItemIds = new Set<EntityId>();
  const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  for (const id of inventory?.items ?? []) {
    seenItemIds.add(id);
  }
  for (const slot of equipment?.slots ?? []) {
    if (slot.equippedItem !== null) {
      seenItemIds.add(slot.equippedItem);
    }
  }

  let totalLbs = 0;
  let excludedStarterOutfit = false;
  for (const itemEntityId of seenItemIds) {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!rawDef) continue;
    const itemDef = resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp);
    if (!excludedStarterOutfit && (itemDef.tags ?? []).includes(STARTER_OUTFIT_TAG)) {
      excludedStarterOutfit = true;
      continue;
    }
    totalLbs += itemDef.weight ?? 0;
  }
  return totalLbs;
}

/**
 * Computes Light/Medium/Heavy carrying capacity thresholds and effective encumbrance constraints,
 * supporting Strength scores above 20 (`x4` per `+10` STR) and quadruped carry multipliers.
 */
export function computeEncumbranceState(
  strScore: number,
  sizeCategory: CreatureSizeCategory,
  carriedWeightLb: number,
  baseSpeedFt = 30,
  isQuadruped = false
): {
  readonly loadTier: 'light' | 'medium' | 'heavy' | 'overloaded';
  readonly lightMaxLb: number;
  readonly mediumMaxLb: number;
  readonly heavyMaxLb: number;
  readonly maxDexBonus: number | undefined;
  readonly acp: number;
  readonly effectiveSpeedFt: number;
} {
  const wholeStr = Math.max(1, dndFloor(strScore));
  const decadesOver20 =
    wholeStr > MAX_TABLE_STRENGTH
      ? Math.floor((wholeStr - (MAX_TABLE_STRENGTH - HIGH_STR_DECADE_STEP + 1)) / HIGH_STR_DECADE_STEP)
      : 0;
  const lookupStr = wholeStr > MAX_TABLE_STRENGTH ? wholeStr - decadesOver20 * HIGH_STR_DECADE_STEP : wholeStr;
  const baseHeavy = (BASE_STR_HEAVY_LOAD[lookupStr] ?? 100) * HIGH_STR_DECADE_MULTIPLIER ** decadesOver20;
  const sizeMult = isQuadruped
    ? QUADRUPED_SIZE_CARRY_MULTIPLIER[sizeCategory]
    : BIPED_SIZE_CARRY_MULTIPLIER[sizeCategory];
  const heavyMaxLb = dndFloor(baseHeavy * sizeMult);
  const lightMaxLb = dndFloor(heavyMaxLb / 3);
  const mediumMaxLb = dndFloor((heavyMaxLb * 2) / 3);
  const reducedSpeed = baseSpeedFt === 30 ? 20 : 15;

  if (carriedWeightLb <= lightMaxLb) {
    return {
      loadTier: 'light',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: undefined,
      acp: 0,
      effectiveSpeedFt: baseSpeedFt
    };
  }
  if (carriedWeightLb <= mediumMaxLb) {
    return {
      loadTier: 'medium',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: 3,
      acp: -3,
      effectiveSpeedFt: reducedSpeed
    };
  }
  if (carriedWeightLb <= heavyMaxLb) {
    return {
      loadTier: 'heavy',
      lightMaxLb,
      mediumMaxLb,
      heavyMaxLb,
      maxDexBonus: 1,
      acp: -6,
      effectiveSpeedFt: reducedSpeed
    };
  }
  return {
    loadTier: 'overloaded',
    lightMaxLb,
    mediumMaxLb,
    heavyMaxLb,
    maxDexBonus: 0,
    acp: -6,
    effectiveSpeedFt: 5
  };
}
