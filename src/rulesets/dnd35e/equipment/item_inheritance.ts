import type { ItemComponent } from '../../../types/components.types.ts';
import type { DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';
import type { SpecialMaterialType } from './special_materials.ts';

const NONPROFICIENCY_ATTACK_PENALTY = -4;
const CRIT_THREAT_CEILING = 21;
const MIN_CRIT_THREAT_ROLL = 2;

/**
 * Doubles a weapon's critical threat range (e.g. 20 -> 19, 19 -> 17, 18 -> 15) for Keen or Improved Critical.
 * Per SRD rules, Keen and Improved Critical do not stack with each other.
 */
export function computeExpandedCritThreatMin(baseCritThreatMin: number, expandThreatRange: boolean | number): number {
  const expansionSteps = typeof expandThreatRange === 'boolean' ? (expandThreatRange ? 1 : 0) : expandThreatRange;
  if (expansionSteps <= 0) return baseCritThreatMin;
  const span = Math.max(1, CRIT_THREAT_CEILING - baseCritThreatMin);
  return Math.max(MIN_CRIT_THREAT_ROLL, CRIT_THREAT_CEILING - span * (1 + expansionSteps));
}

/**
 * Returns all canonical base weapons from system content (category: 'weapon', no baseItemId),
 * sorted alphabetically by display name.
 */
export function getCanonicalBaseWeapons(sys: {
  readonly items: Record<string, DnD35ItemDefinition>;
}): ReadonlyArray<DnD35ItemDefinition> {
  return Object.values(sys.items)
    .filter((item) => item.category === 'weapon' && !item.baseItemId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolves an item definition by recursively merging base item templates (via `baseItemId`)
 * and instance overrides on `ItemComponent`.
 */
export function resolveEffectiveItemDefinition(
  rawItemDef: DnD35ItemDefinition,
  itemsRegistry: Record<string, DnD35ItemDefinition | unknown>,
  itemComp?: ItemComponent,
  visited: Set<string> = new Set<string>()
): DnD35ItemDefinition {
  if (visited.has(rawItemDef.id)) {
    return rawItemDef;
  }
  visited.add(rawItemDef.id);

  let effective = rawItemDef;
  if (rawItemDef.baseItemId && rawItemDef.baseItemId !== rawItemDef.id) {
    const baseDef = itemsRegistry[rawItemDef.baseItemId] as DnD35ItemDefinition | undefined;
    if (baseDef) {
      const resolvedBase = resolveEffectiveItemDefinition(baseDef, itemsRegistry, undefined, visited);
      const mergedTags = Array.from(new Set([...(resolvedBase.tags ?? []), ...(rawItemDef.tags ?? [])]));
      const mergedEnhancements = Array.from(
        new Set([
          ...(resolvedBase.magicalProperties?.enhancements ?? []),
          ...(rawItemDef.magicalProperties?.enhancements ?? [])
        ])
      );
      const enhBonus =
        rawItemDef.magicalProperties?.enhancementBonus ?? resolvedBase.magicalProperties?.enhancementBonus ?? 0;
      const isMasterwork =
        enhBonus > 0 ||
        rawItemDef.magicalProperties?.isMasterwork === true ||
        resolvedBase.magicalProperties?.isMasterwork === true;
      const isKeen =
        rawItemDef.magicalProperties?.keen === true ||
        resolvedBase.magicalProperties?.keen === true ||
        mergedEnhancements.includes('keen');

      effective = {
        ...resolvedBase,
        ...rawItemDef,
        baseItemId: resolvedBase.baseItemId ?? resolvedBase.id,
        name: rawItemDef.name ?? resolvedBase.name,
        description: rawItemDef.description ?? resolvedBase.description,
        specialMaterial: rawItemDef.specialMaterial ?? resolvedBase.specialMaterial,
        weaponStats: rawItemDef.weaponStats
          ? { ...(resolvedBase.weaponStats ?? {}), ...rawItemDef.weaponStats }
          : resolvedBase.weaponStats,
        armorStats: rawItemDef.armorStats
          ? { ...(resolvedBase.armorStats ?? {}), ...rawItemDef.armorStats }
          : resolvedBase.armorStats,
        equippable: rawItemDef.equippable
          ? { ...(resolvedBase.equippable ?? {}), ...rawItemDef.equippable }
          : resolvedBase.equippable,
        consumable: rawItemDef.consumable
          ? { ...(resolvedBase.consumable ?? {}), ...rawItemDef.consumable }
          : resolvedBase.consumable,
        tags: mergedTags,
        magicalProperties: {
          ...(resolvedBase.magicalProperties ?? {}),
          ...(rawItemDef.magicalProperties ?? {}),
          enhancementBonus: enhBonus,
          enhancements: mergedEnhancements,
          isMasterwork,
          keen: isKeen
        }
      };
    }
  }

  if (itemComp) {
    const compEnhancements = itemComp.enhancements ?? [];
    const mergedEnhancements = Array.from(
      new Set([...(effective.magicalProperties?.enhancements ?? []), ...compEnhancements])
    );
    const enhBonus = itemComp.enhancementBonus ?? effective.magicalProperties?.enhancementBonus ?? 0;
    const isMasterwork = enhBonus > 0 || effective.magicalProperties?.isMasterwork === true;
    const isKeen = effective.magicalProperties?.keen === true || mergedEnhancements.includes('keen');
    const compMat = itemComp.specialMaterial as SpecialMaterialType | undefined;

    effective = {
      ...effective,
      name: itemComp.customName ?? effective.name,
      description: itemComp.customDescription ?? effective.description,
      specialMaterial: compMat ?? effective.specialMaterial,
      magicalProperties: {
        ...(effective.magicalProperties ?? {}),
        enhancementBonus: enhBonus,
        enhancements: mergedEnhancements,
        isMasterwork,
        keen: isKeen
      }
    };
  }

  return effective;
}

/**
 * Evaluates the nonproficiency attack penalty (`0` or `-4`) for a weapon based on its
 * resolved grip handedness and the actor's proficiencies/racial familiarity.
 */
export function evaluateNonproficiencyPenalty(
  weaponItemId: string | undefined,
  baseWeaponId: string | undefined,
  isExotic1HMartial2H: boolean | undefined,
  finalHandedness: 'light' | 'one_handed' | 'two_handed',
  dndData: Partial<DnD35EntityData> | undefined,
  familiaritySubtypes: ReadonlyArray<string> = [],
  proficiencyCategory?: 'simple' | 'martial' | 'exotic',
  classesRegistry?: Readonly<Record<string, DnD35ClassDefinition>>
): number {
  const feats = dndData?.feats ?? [];
  const weaponIdsToCheck = Array.from(
    new Set([...(weaponItemId ? [weaponItemId] : []), ...(baseWeaponId ? [baseWeaponId] : [])])
  );
  const isDeityWeapon =
    dndData?.deityFavoredWeaponId !== undefined && weaponIdsToCheck.includes(dndData.deityFavoredWeaponId);

  if (isDeityWeapon) {
    return 0;
  }

  let effectiveCategory: 'simple' | 'martial' | 'exotic' =
    isExotic1HMartial2H === true && finalHandedness === 'two_handed'
      ? 'martial'
      : (proficiencyCategory ?? (isExotic1HMartial2H === true ? 'exotic' : 'simple'));

  if (effectiveCategory === 'exotic' && familiaritySubtypes.length > 0) {
    const actorSubtypes = new Set<string>([...(dndData?.raceId ? [dndData.raceId] : []), ...(dndData?.subtypes ?? [])]);
    if (familiaritySubtypes.some((sub) => actorSubtypes.has(sub))) {
      effectiveCategory = 'martial';
    }
  }

  if (effectiveCategory === 'exotic') {
    const hasExoticProficiency = feats.some(
      (f) =>
        f === 'exotic_weapon_proficiency' ||
        weaponIdsToCheck.some(
          (wId) =>
            f === `exotic_weapon_proficiency_${wId}` ||
            f === `exotic_weapon_proficiency:${wId}` ||
            f === `proficiency:weapon:${wId}` ||
            f === `martial_weapon_proficiency:${wId}`
        )
    );
    return hasExoticProficiency ? 0 : NONPROFICIENCY_ATTACK_PENALTY;
  }

  // Simple or Martial proficiency check when classesRegistry and class tracks are present
  const classTracks = (dndData?.tracks ?? []).filter(
    (t) => t.levels > 0 && t.trackCategory !== 'racial_hd' && classesRegistry?.[t.trackId] !== undefined
  );
  if (!classesRegistry || classTracks.length === 0) {
    return 0;
  }

  const hasSpecificOrCategoryFeat = feats.some(
    (f) =>
      (effectiveCategory === 'martial' && f === 'martial_weapon_proficiency') ||
      (effectiveCategory === 'simple' && f === 'simple_weapon_proficiency') ||
      weaponIdsToCheck.some(
        (wId) =>
          f === `martial_weapon_proficiency_${wId}` ||
          f === `martial_weapon_proficiency:${wId}` ||
          f === `simple_weapon_proficiency:${wId}` ||
          f === `proficiency:weapon:${wId}` ||
          f === `exotic_weapon_proficiency:${wId}`
      )
  );
  if (hasSpecificOrCategoryFeat) {
    return 0;
  }

  for (const track of classTracks) {
    const classDef = classesRegistry[track.trackId];
    const classProfs = classDef?.proficiencies?.weapons ?? [];
    if (
      classProfs.includes(effectiveCategory) ||
      (effectiveCategory === 'simple' && classProfs.includes('martial')) ||
      weaponIdsToCheck.some((wId) => classProfs.includes(wId))
    ) {
      return 0;
    }
  }

  return NONPROFICIENCY_ATTACK_PENALTY;
}
