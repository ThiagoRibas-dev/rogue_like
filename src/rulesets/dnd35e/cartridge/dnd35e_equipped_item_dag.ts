import { getComponent } from '../../../core/ecs.ts';
import { ComponentType, type EquipmentComponent, type ItemComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { NaturalWeaponLimbEntry } from '../combat/attack_resolver.ts';
import { computeMaterialEquipmentStats } from '../equipment/special_materials.ts';
import { scaleWeaponDamageDice } from '../equipment_physics.ts';
import { evaluateEffectBundle } from '../srd_registry.ts';
import type { CreatureSizeCategory, DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';

/** Result of evaluating equipped item DAG contributions across active anatomical slots. */
export interface EquippedItemDAGContributions {
  readonly modifiers: ReadonlyArray<StatModifier>;
  readonly grantedTags: ReadonlyArray<string>;
  readonly maxDexBonusCap: number | undefined;
  readonly hasStructuredArmorOrShield: boolean;
}

/**
 * Evaluates declarative effect bundles, armor/shield bonuses, Ghost Touch tags, and Max Dex caps
 * across all active, non-suppressed equipped items on an entity.
 *
 * @param state - Current game state
 * @param entityId - Actor entity ID
 * @param suppressedBundleIds - Suppressed effect bundle IDs on the actor
 * @param activeSelfTags - Active semantic self-tags on the actor
 * @returns Aggregated modifiers, granted tags, Max Dex cap, and structured armor presence flag
 */
export function collectEquippedItemDAGContributions(
  state: GameState,
  entityId: EntityId,
  suppressedBundleIds: ReadonlyArray<string>,
  activeSelfTags: ReadonlyArray<string>
): EquippedItemDAGContributions {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equipment) {
    return { modifiers: [], grantedTags: [], maxDexBonusCap: undefined, hasStructuredArmorOrShield: false };
  }

  const modifiers: StatModifier[] = [];
  const grantedTags: string[] = [];
  let maxDexBonusCap: number | undefined;
  let hasStructuredArmorOrShield = false;

  for (const slot of equipment.slots) {
    if (slot.equippedItem === null || slot.suppressed === true) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const itemDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!itemDef) continue;

    const itemRoot = `item:${itemDef.id}`;
    const itemTags = itemDef.tags ?? [];
    const isGhostTouch = itemDef.magicalProperties?.ghostTouch === true || itemTags.includes('ghost_touch');
    const isMithral =
      itemDef.specialMaterial === 'mithral' || itemTags.includes('mithral') || itemTags.includes('material:mithral');

    if (itemDef.armorStats) {
      hasStructuredArmorOrShield = true;
      const isShield =
        itemDef.armorStats.armorCategory === 'shield' || itemDef.armorStats.armorCategory === 'tower_shield';
      const targetSubStat = isShield ? 'worn_shield_bonus' : 'worn_armor_bonus';
      const baseType = isShield ? 'shield' : 'armor';
      const enhType = isShield ? 'shield_enhancement' : 'armor_enhancement';
      const enhVal = itemDef.magicalProperties?.enhancementBonus ?? 0;

      if (itemDef.armorStats.armorBonus > 0) {
        modifiers.push({
          targetStat: targetSubStat,
          value: itemDef.armorStats.armorBonus,
          bonusType: 'base',
          sourceId: `${itemRoot}:${baseType}`,
          sourcePath: `${itemRoot}/${baseType}`,
          origin: 'mundane',
          ...(isGhostTouch ? { effectTags: ['ghost_touch', 'force'] } : {})
        });
      }
      if (enhVal > 0) {
        modifiers.push({
          targetStat: targetSubStat,
          value: enhVal,
          bonusType: enhType,
          sourceId: `${itemRoot}:${enhType}`,
          sourcePath: `${itemRoot}/${enhType}`,
          origin: 'su',
          ...(isGhostTouch ? { effectTags: ['ghost_touch', 'force'] } : {})
        });
      }
      if (itemDef.armorStats.maxDexBonus !== null && itemDef.armorStats.maxDexBonus !== undefined) {
        const mithralDelta = isMithral ? computeMaterialEquipmentStats('mithral').maxDexBonusDelta : 0;
        const effectiveCap = itemDef.armorStats.maxDexBonus + mithralDelta;
        maxDexBonusCap = maxDexBonusCap === undefined ? effectiveCap : Math.min(maxDexBonusCap, effectiveCap);
      }
    }

    if (itemDef.category === 'weapon' && (itemDef.magicalProperties?.keen === true || itemTags.includes('keen'))) {
      modifiers.push({
        targetStat: 'crit_threat_doubling',
        value: 1,
        bonusType: 'threat_expansion',
        sourceId: `${itemRoot}:keen`,
        sourcePath: `${itemRoot}/keen`,
        origin: 'magical',
        condition: { effectTagsAny: [`weapon:${itemDef.id}`] }
      });
    }

    if (itemDef.effectBundle) {
      const evalRes = evaluateEffectBundle(itemDef.effectBundle, itemRoot, suppressedBundleIds, activeSelfTags);
      modifiers.push(...evalRes.statModifiers);
      grantedTags.push(...evalRes.grantedTags);
    }
  }

  return { modifiers, grantedTags, maxDexBonusCap, hasStructuredArmorOrShield };
}

/**
 * Builds natural weapon limb entries scaled to the actor's effective size and mapped to anatomical limb groups.
 *
 * @param state - Current game state
 * @param entityId - Actor entity ID
 * @param dndData - Hydrated actor D&D 3.5e data
 * @param effectiveSize - Resolved effective size category
 * @returns Array of natural weapon limb entries for full-attack resolution
 */
export function buildActorNaturalWeaponLimbs(
  state: GameState,
  entityId: EntityId,
  dndData: DnD35EntityData,
  effectiveSize: CreatureSizeCategory
): ReadonlyArray<NaturalWeaponLimbEntry> {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const handSlotLimbGroups: string[] = [];
  for (const s of equipment?.slots ?? []) {
    if (
      s.suppressed !== true &&
      s.limbGroupId !== undefined &&
      (s.slotType === 'held' ||
        s.slotType === 'hand' ||
        s.slotType === 'main_hand' ||
        s.slotType === 'off_hand' ||
        s.id.startsWith('hand_') ||
        s.id.startsWith('main_hand') ||
        s.id.startsWith('off_hand')) &&
      !handSlotLimbGroups.includes(s.limbGroupId)
    ) {
      handSlotLimbGroups.push(s.limbGroupId);
    }
  }
  const availableHandLimbs = handSlotLimbGroups.length > 0 ? handSlotLimbGroups : ['hand_main', 'hand_off'];

  const naturalLimbs: NaturalWeaponLimbEntry[] = [];
  for (const nw of dndData.naturalWeapons ?? []) {
    const scaledDice = scaleWeaponDamageDice(nw.damageDice, dndData.sizeCategory, effectiveSize);
    if ((nw.naturalType === 'claw' || nw.naturalType === 'slam') && nw.count > 1) {
      for (let cIdx = 0; cIdx < nw.count; cIdx++) {
        const limbGroupId = availableHandLimbs[cIdx] ?? (cIdx === 0 ? 'hand_main' : `hand_off_${cIdx}`);
        naturalLimbs.push({
          id: nw.id,
          name: nw.name,
          isPrimary: nw.isPrimary,
          count: 1,
          limbGroupId,
          dice: scaledDice,
          damageType: nw.damageType,
          critThreatMin: nw.critThreatMin,
          critMultiplier: nw.critMultiplier
        });
      }
      continue;
    }

    let limbGroupId: string | undefined;
    if (nw.naturalType === 'claw' || nw.naturalType === 'slam') limbGroupId = availableHandLimbs[0] ?? 'hand_main';
    else if (nw.naturalType === 'bite' || nw.naturalType === 'gore') limbGroupId = 'head';
    naturalLimbs.push({
      id: nw.id,
      name: nw.name,
      isPrimary: nw.isPrimary,
      count: nw.count,
      limbGroupId,
      dice: scaledDice,
      damageType: nw.damageType,
      critThreatMin: nw.critThreatMin,
      critMultiplier: nw.critMultiplier
    });
  }
  return naturalLimbs;
}
