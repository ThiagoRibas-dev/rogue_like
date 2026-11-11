/**
 * @file Default / Classic Sci-Fi Cartridge UI Adapter (`ICartridgeUIAdapter` implementation).
 * Projects live ECS components (`Identity`, `Fighter`, `Actor`, `Equipment`, `Inventory`,
 * `StatusEffects`, `Tags`) into unified Tier 1 Console UI models using the `'retro-crt'` skin.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type ActorComponent,
  type EquipmentComponent,
  type FighterComponent,
  type IdentityComponent,
  type InventoryComponent,
  type StatusEffectsComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type {
  ICartridgeUIAdapter,
  UIAnatomicalSlotDescriptor,
  UICharacterSheetModel,
  UIFeatureEntryModel,
  UIHotbarModel,
  UIHotbarSlot,
  UIInspectData,
  UIInventoryItem,
  UIInventoryModel
} from '../../../types/ui_adapter.types.ts';

const BASE_AC_SCORE = 10;
const DEFAULT_MAX_WEIGHT_LBS = 100;
const DEFAULT_ITEM_PRICE = 20;
const DEFAULT_ITEM_WEIGHT_LBS = 1.0;
const ASCII_LOWERCASE_A = 97;
const MAX_HOTKEY_INDEX = 26;
const HOTBAR_SLOT_COUNT = 12;
const TOTAL_HOTBAR_BANKS = 10;

export interface ClassicAdapterContext {
  readonly state: GameState;
  readonly entityId: EntityId;
}

function isClassicContext(actor: unknown): actor is ClassicAdapterContext {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    'state' in actor &&
    'entityId' in actor &&
    typeof (actor as { entityId: unknown }).entityId === 'number'
  );
}

const DEFAULT_CLASSIC_SLOTS: ReadonlyArray<UIAnatomicalSlotDescriptor> = (
  [
    ['head', 'Head', '🪖', 'left'],
    ['main_hand', 'Main Hand', '⚔️', 'left'],
    ['torso', 'Armor', '🛡️', 'right'],
    ['off_hand', 'Off Hand', '🗡️', 'right']
  ] as const
).map(([slotId, label, emptyGlyph, rail]) => ({
  slotId,
  slotType: slotId,
  label,
  emptyGlyph,
  rail,
  equippedItem: null
}));

function mapClassicItemToUI(
  state: GameState,
  itemEntityId: EntityId,
  isEquipped: boolean,
  inventoryIndex?: number
): UIInventoryItem | null {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return null;
  const def = state.campaign?.items?.[itemComp.itemId];
  const name = def?.name ?? itemComp.itemId.replace(/_/g, ' ');
  const renderable = getComponent(state, itemEntityId, ComponentType.Renderable);
  const slot = def?.equippable?.slot ?? 'held';
  const isWeapon = def?.category === 'weapon' || slot === 'main_hand' || slot === 'off_hand';
  const isArmor = def?.category === 'armor' || slot === 'torso' || slot === 'body';
  const isConsumable = def?.category === 'consumable' || def?.consumable !== undefined;
  const weight = def?.weight ?? DEFAULT_ITEM_WEIGHT_LBS;
  const metrics = [
    ...(def?.equippable?.attackBonus ? [{ label: 'Attack Bonus', value: `+${def.equippable.attackBonus}` }] : []),
    ...(def?.equippable?.defenseBonus ? [{ label: 'Defense Bonus', value: `+${def.equippable.defenseBonus}` }] : []),
    { label: 'Weight', value: `${weight.toFixed(1)} lbs` }
  ];
  return {
    id: inventoryIndex !== undefined ? `${itemComp.itemId}_${inventoryIndex}` : itemComp.itemId,
    entityId: itemEntityId,
    ...(inventoryIndex !== undefined ? { inventoryIndex } : {}),
    ...(inventoryIndex !== undefined && inventoryIndex < MAX_HOTKEY_INDEX
      ? { hotkeyLabel: String.fromCharCode(ASCII_LOWERCASE_A + inventoryIndex) }
      : {}),
    name,
    iconUrl: isWeapon ? '⚔️' : isArmor ? '🛡️' : isConsumable ? '🧪' : (renderable?.glyph ?? '📦'),
    category: isWeapon ? 'weapon' : isArmor ? 'armor' : isConsumable ? 'consumable' : 'accessory',
    quantity: itemComp.charges ?? 1,
    priceGp: def?.baseValue ?? DEFAULT_ITEM_PRICE,
    weightLbs: weight,
    isEquipped,
    inspectData: {
      title: `${name}${isEquipped ? ' (Equipped)' : ''}`,
      loreText: def?.description ?? 'Standard equipment.',
      baseMetrics: metrics,
      specialProperties: (def?.tags ?? []).map((t) => ({ text: `Tag: ${t}`, colorHint: 'green' as const }))
    }
  };
}

export class DefaultSciFiUIAdapter implements ICartridgeUIAdapter {
  public readonly rulesetId = 'default';
  public readonly defaultThemeMode = 'retro-crt' as const;

  public getCharacterSheetData(actor: unknown): UICharacterSheetModel {
    const ctx = isClassicContext(actor) ? actor : undefined;
    const raw = (actor ?? {}) as Record<string, unknown>;
    const identity = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.Identity) as IdentityComponent | undefined)
      : undefined;
    const fighter = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.Fighter) as FighterComponent | undefined)
      : undefined;
    const actorComp = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.Actor) as ActorComponent | undefined)
      : undefined;
    const equipment = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.Equipment) as EquipmentComponent | undefined)
      : undefined;
    const statusComp = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined)
      : undefined;
    const tagsComp = ctx
      ? (getComponent(ctx.state, ctx.entityId, ComponentType.Tags) as TagsComponent | undefined)
      : undefined;

    let equipAtk = 0;
    let equipDef = 0;
    let equipHp = 0;
    for (const s of equipment?.slots ?? []) {
      const itComp =
        ctx && s.equippedItem !== null ? getComponent(ctx.state, s.equippedItem, ComponentType.Item) : undefined;
      const eq = ctx && itComp ? ctx.state.campaign.items[itComp.itemId]?.equippable : undefined;
      if (eq) {
        equipAtk += eq.attackBonus;
        equipDef += eq.defenseBonus;
        equipHp += eq.maxHpBonus;
      }
    }

    const lvl = fighter?.level ?? (typeof raw['level'] === 'number' ? raw['level'] : 1);
    const totalAtk = (fighter?.attack ?? (typeof raw['attack'] === 'number' ? raw['attack'] : 10)) + equipAtk;
    const totalDef = (fighter?.defense ?? (typeof raw['defense'] === 'number' ? raw['defense'] : 10)) + equipDef;
    const maxHp = Math.max(1, (fighter?.maxHp ?? (typeof raw['maxHp'] === 'number' ? raw['maxHp'] : 30)) + equipHp);
    const hpCurr = fighter?.hp ?? (typeof raw['hp'] === 'number' ? raw['hp'] : maxHp);
    const featureEntries: UIFeatureEntryModel[] = [
      ...(tagsComp?.tags ?? []).map((t) => ({ id: `tag_${t}`, name: t.toUpperCase(), category: 'trait' as const })),
      ...(statusComp?.activeEffects ?? []).map((eff) => ({
        id: eff.effectId,
        name: `${eff.effectId} (${eff.duration}t)`,
        category: 'condition' as const
      }))
    ];

    return {
      name: identity?.name ?? (typeof raw['name'] === 'string' ? raw['name'] : 'Adventurer'),
      levelSummary: `Level ${lvl}`,
      raceName: 'Adventurer',
      xpCurrent: fighter?.xp ?? 0,
      attributes: [
        { id: 'atk', name: 'ATK', score: totalAtk, modifier: equipAtk },
        { id: 'def', name: 'DEF', score: totalDef, modifier: equipDef },
        { id: 'spd', name: 'SPD', score: actorComp?.speed ?? 100, modifier: 0 }
      ],
      savingThrows: [
        { id: 'fortitude', name: 'Fortitude', total: totalDef },
        { id: 'reflex', name: 'Reflex', total: totalDef },
        { id: 'will', name: 'Will', total: lvl }
      ],
      hpCurrent: hpCurr,
      hpMax: maxHp,
      acTotal: BASE_AC_SCORE + totalDef,
      babTotal: totalAtk,
      combatSummary: [
        { title: 'Primary Attack', attackBonus: `+${totalAtk}`, damage: `${totalAtk}`, critRange: '20 / x2' }
      ],
      skills: [],
      skillRows: [],
      feats: [],
      featureEntries
    };
  }

  public getInventoryData(actor: unknown): UIInventoryModel {
    if (!isClassicContext(actor)) {
      return {
        equippedSlots: {},
        anatomicalSlots: DEFAULT_CLASSIC_SLOTS,
        activeWeaponSetIndex: 1,
        stashItems: [],
        currentWeightLbs: 0,
        maxWeightLbs: DEFAULT_MAX_WEIGHT_LBS,
        goldCurrency: 0
      };
    }

    const { state, entityId } = actor;
    const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
    const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
    const anatomicalSlots: UIAnatomicalSlotDescriptor[] = (equipment?.slots ?? []).map((slot) => ({
      slotId: slot.id,
      slotType: slot.slotType,
      label: slot.id.replace(/_/g, ' ').toUpperCase(),
      emptyGlyph: slot.slotType === 'main_hand' ? '⚔️' : slot.slotType === 'torso' ? '🛡️' : '📦',
      rail: slot.slotType === 'main_hand' || slot.slotType === 'head' ? ('left' as const) : ('right' as const),
      equippedItem: slot.equippedItem !== null ? mapClassicItemToUI(state, slot.equippedItem, true) : null
    }));

    const equippedSlots: Record<string, UIInventoryItem | null> = {};
    for (const s of anatomicalSlots) equippedSlots[s.slotId] = s.equippedItem;

    const stashItems: UIInventoryItem[] = [];
    let currentWeightLbs = 0;
    inventory?.items.forEach((itemEntityId, idx) => {
      const isEquipped = equipment?.slots.some((s) => s.equippedItem === itemEntityId) ?? false;
      const uiItem = mapClassicItemToUI(state, itemEntityId, isEquipped, idx);
      if (uiItem) {
        stashItems.push(uiItem);
        currentWeightLbs += uiItem.weightLbs;
      }
    });

    return {
      equippedSlots,
      anatomicalSlots: anatomicalSlots.length > 0 ? anatomicalSlots : DEFAULT_CLASSIC_SLOTS,
      activeWeaponSetIndex: 1,
      stashItems,
      currentWeightLbs,
      maxWeightLbs: inventory?.baseCapacity ?? DEFAULT_MAX_WEIGHT_LBS,
      goldCurrency: 0
    };
  }

  public getHotbarBinding(actor: unknown, slotIndex: number): UIInventoryItem | null {
    return this.getInventoryData(actor).stashItems[slotIndex] ?? null;
  }

  public getStanceActions(actor: unknown): ReadonlyArray<{ id: string; label: string; isActive: boolean }> {
    if (!isClassicContext(actor)) {
      return [
        { id: 'search', label: 'Search', isActive: false },
        { id: 'wait', label: 'Wait / Guard', isActive: false }
      ];
    }
    const status = getComponent(actor.state, actor.entityId, ComponentType.StatusEffects) as
      StatusEffectsComponent | undefined;
    return [
      { id: 'search', label: 'Search', isActive: false },
      ...(status?.activeEffects ?? []).map((e) => ({
        id: `status:${e.effectId}`,
        label: `${e.effectId} (${e.duration}t)`,
        isActive: true
      }))
    ];
  }

  public getHotbarData(actor: unknown, activeBank = 1): UIHotbarModel {
    const consumables = this.getInventoryData(actor).stashItems.filter((it) => !it.isEquipped);
    const slots: UIHotbarSlot[] = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) => {
      const keyLabel = i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : `${i + 1}`;
      const it = consumables[i];
      return it
        ? {
            slotIndex: i,
            keyLabel,
            label: it.name,
            iconUrl: it.iconUrl,
            tooltipTitle: it.name,
            actionPayload: { kind: 'item', id: it.id, entityId: it.entityId }
          }
        : { slotIndex: i, keyLabel, label: '' };
    });

    return {
      activeBank,
      totalBanks: TOTAL_HOTBAR_BANKS,
      stanceModes: this.getStanceActions(actor).map((s) => ({ ...s, description: s.label })),
      slots,
      actionPips: [
        { id: 'std', label: 'ACT', available: true },
        { id: 'mov', label: 'MOV', available: true }
      ]
    };
  }

  public getItemInspectData(item: unknown): UIInspectData {
    const uiItem = item as UIInventoryItem | undefined;
    return uiItem?.inspectData ?? { title: uiItem?.name ?? 'Unknown Item', baseMetrics: [], specialProperties: [] };
  }
}
