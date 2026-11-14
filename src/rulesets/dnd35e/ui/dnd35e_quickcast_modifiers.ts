import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { DnD35ClassSpellbookState, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

export interface QuickcastModifierToggle {
  readonly id: string;
  readonly label: string;
  readonly shortBadge: string;
  readonly kind: 'metamagic' | 'spontaneous_cure' | 'spontaneous_inflict' | 'spontaneous_sna' | 'essence';
  readonly slotLevelBump: number;
  readonly isActive: boolean;
}

/**
 * Collects metamagic feat toggles, carried metamagic rods, and Cleric/Druid spontaneous
 * conversion toggles for the Quickcast HUD tray.
 */
export function collectQuickcastModifierToggles(
  state: GameState,
  playerId: EntityId,
  dndData: Partial<DnD35EntityData>,
  classBooks: Readonly<Record<string, DnD35ClassSpellbookState>>,
  sys: DnD35SystemContent | undefined,
  activeSet: ReadonlySet<string>
): ReadonlyArray<QuickcastModifierToggle> {
  const toggles: QuickcastModifierToggle[] = [];
  const seenIds = new Set<string>();

  for (const fid of dndData.feats ?? []) {
    const featDef = sys?.feats?.[fid];
    if (!featDef?.metamagicDescriptor || seenIds.has(fid)) continue;
    seenIds.add(fid);
    const bump = featDef.metamagicDescriptor.slotLevelAdjustment;
    toggles.push({
      id: fid,
      label: featDef.name,
      shortBadge: featDef.metamagicDescriptor.isVariableHeighten ? '+Var' : `+${bump}`,
      kind: 'metamagic',
      slotLevelBump: bump,
      isActive: activeSet.has(fid)
    });
  }

  const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equip = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const itemIds = [...(inv?.items ?? [])];
  for (const slot of equip?.slots ?? []) {
    if (slot.equippedItem !== null && !itemIds.includes(slot.equippedItem)) itemIds.push(slot.equippedItem);
  }
  for (const eid of itemIds) {
    const ic = getComponent(state, eid, ComponentType.Item) as ItemComponent | undefined;
    const def = ic ? state.campaign.items[ic.itemId] : undefined;
    const rodTag = def?.tags?.find((t) => t.startsWith('metamagic_rod:'));
    if (!def || !rodTag) continue;
    const rodId = `rod:${rodTag.slice('metamagic_rod:'.length)}`;
    if (seenIds.has(rodId)) continue;
    seenIds.add(rodId);
    toggles.push({
      id: rodId,
      label: def.name,
      shortBadge: 'ROD',
      kind: 'metamagic',
      slotLevelBump: 0,
      isActive: activeSet.has(rodId)
    });
  }

  if (classBooks['cleric']) {
    const isGood = dndData.alignment?.endsWith('G') ?? false;
    const isEvil = dndData.alignment?.endsWith('E') ?? false;
    if (!isEvil) {
      toggles.push({
        id: 'spontaneous:cure',
        label: 'Spontaneous: Cure Wounds (Positive)',
        shortBadge: 'CURE',
        kind: 'spontaneous_cure',
        slotLevelBump: 0,
        isActive: activeSet.has('spontaneous:cure')
      });
    }
    if (!isGood) {
      toggles.push({
        id: 'spontaneous:inflict',
        label: 'Spontaneous: Inflict Wounds (Negative)',
        shortBadge: 'INFL',
        kind: 'spontaneous_inflict',
        slotLevelBump: 0,
        isActive: activeSet.has('spontaneous:inflict')
      });
    }
  }

  if (classBooks['druid']) {
    toggles.push({
      id: 'spontaneous:sna',
      label: "Spontaneous: Summon Nature's Ally",
      shortBadge: 'SNA',
      kind: 'spontaneous_sna',
      slotLevelBump: 0,
      isActive: activeSet.has('spontaneous:sna')
    });
  }

  return toggles;
}
