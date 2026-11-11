/**
 * @file D&D 3.5e Cartridge UI Adapter (`ICartridgeUIAdapter` implementation).
 * Projects live ECS components (`RulesetData`, `Identity`, `Fighter`, `Equipment`, `Inventory`,
 * `TacticalDoctrine`, `ResourcePool`, `StatusEffects`) and SRD 3.5e JSON registries into
 * Tier 1 Console UI models (`UICharacterSheetModel`, `UIInventoryModel`, `UIHotbarModel`).
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type {
  ICartridgeUIAdapter,
  UICharacterSheetModel,
  UIHotbarModel,
  UIInspectData,
  UIInventoryItem,
  UIInventoryModel
} from '../../../types/ui_adapter.types.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { evaluateActiveSpellAuraContributions } from '../magic/spell_aura_resolver.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { buildActorActionPips, buildActorHotbarSlots, buildActorStanceModes } from './dnd35e_ui_hotbar.ts';
import { buildAnatomicalSlotsFromEquipment, mapEntityItemToUI } from './dnd35e_ui_projection.ts';
import {
  extractActorContext,
  projectCharacterSheetData,
  resolveAbilityScore,
  type DnD35ExtendedActorData
} from './dnd35e_ui_char_sheet.ts';

const LIGHT_LOAD_MULTIPLIER_LBS = 15;
const DEFAULT_GOLD_CURRENCY = 0;
const TOTAL_HOTBAR_BANKS = 10;

const BODY_PLAN_GLYPHS: Record<string, string> = { marilith_6arm: '🐍', quadruped: '🐺' };
const CLASS_GLYPHS: Record<string, string> = {
  cleric: '☀️',
  druid: '🌿',
  wizard: '🧙‍♂️',
  sorcerer: '🧙‍♂️',
  rogue: '🗡️',
  ranger: '🏹',
  bard: '🎵',
  monk: '🥋',
  barbarian: '🪓'
};

function resolveAvatarGlyph(dndData: DnD35ExtendedActorData): string {
  if (dndData.anatomyBodyPlan && BODY_PLAN_GLYPHS[dndData.anatomyBodyPlan]) {
    return BODY_PLAN_GLYPHS[dndData.anatomyBodyPlan]!;
  }
  const cls = dndData.tracks?.[0]?.trackId ?? '';
  return CLASS_GLYPHS[cls] ?? '⚔️';
}

export class DnD35UIAdapter implements ICartridgeUIAdapter {
  public readonly rulesetId = 'dnd35e';
  public readonly defaultThemeMode = 'parchment' as const;

  public getCharacterSheetData(actor: unknown): UICharacterSheetModel {
    return projectCharacterSheetData(actor);
  }

  public getInventoryData(actor: unknown): UIInventoryModel {
    const { state, entityId, dndData } = extractActorContext(actor);
    const strScore = resolveAbilityScore(dndData.abilityScores?.str);
    const equipment =
      state && entityId !== undefined
        ? (getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined)
        : undefined;
    const inventory =
      state && entityId !== undefined
        ? (getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined)
        : undefined;
    const anatomicalSlots = buildAnatomicalSlotsFromEquipment(equipment?.slots ?? dndData.equipmentSlots, state);
    const equippedSlots: Record<string, UIInventoryItem | null> = {};
    for (const slot of anatomicalSlots) equippedSlots[slot.slotId] = slot.equippedItem;

    const stashItems: UIInventoryItem[] = [];
    let currentWeightLbs = 0;
    inventory?.items.forEach((itemEntityId, idx) => {
      if (!state) return;
      const isEquipped = equipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
      const uiItem = mapEntityItemToUI(state, itemEntityId, isEquipped, idx);
      if (uiItem) {
        stashItems.push(uiItem);
        currentWeightLbs += uiItem.weightLbs;
      }
    });

    return {
      equippedSlots,
      anatomicalSlots,
      avatarGlyph: resolveAvatarGlyph(dndData),
      activeWeaponSetIndex: 1,
      stashItems,
      currentWeightLbs,
      maxWeightLbs: strScore * LIGHT_LOAD_MULTIPLIER_LBS,
      goldCurrency: dndData.goldCurrency ?? DEFAULT_GOLD_CURRENCY
    };
  }

  public getHotbarBinding(actor: unknown, slotIndex: number): UIInventoryItem | null {
    return this.getInventoryData(actor).stashItems[slotIndex] ?? null;
  }

  public getStanceActions(actor: unknown): ReadonlyArray<{ id: string; label: string; isActive: boolean }> {
    return this.getHotbarData(actor).stanceModes.map((s) => ({ id: s.id, label: s.label, isActive: s.isActive }));
  }

  public getHotbarData(actor: unknown, activeBank = 1): UIHotbarModel {
    const { state, entityId, dndData } = extractActorContext(actor);
    const chassis = aggregateProgressionChassis(dndData.tracks ?? [], 0, dndData.levelAdjustment ?? 0);
    const doctrine =
      state && entityId !== undefined
        ? (getComponent(state, entityId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent | undefined)
        : dndData.doctrine;
    const resourcePools =
      state && entityId !== undefined
        ? (getComponent(state, entityId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined)
        : dndData.resourcePools;

    const sys = state ? getDnD35SystemContent(state.campaign) : undefined;
    const auraContrib =
      state && entityId !== undefined ? evaluateActiveSpellAuraContributions(state, entityId) : undefined;
    return {
      activeBank,
      totalBanks: TOTAL_HOTBAR_BANKS,
      stanceModes: buildActorStanceModes(
        dndData,
        chassis.totalBab,
        doctrine,
        resourcePools,
        sys?.feats,
        auraContrib?.stanceGroupOptions
      ),
      slots: buildActorHotbarSlots(dndData, state, entityId),
      actionPips: buildActorActionPips(dndData)
    };
  }

  public getItemInspectData(item: unknown): UIInspectData {
    const uiItem = item as UIInventoryItem | undefined;
    return uiItem?.inspectData ?? { title: uiItem?.name ?? 'Unknown Item', baseMetrics: [], specialProperties: [] };
  }
}
export { type DnD35AdapterContext, type DnD35ExtendedActorData } from './dnd35e_ui_char_sheet.ts';
