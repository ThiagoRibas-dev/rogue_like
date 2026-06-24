import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

/** Intent to pick up an item at the actor's current grid position. */
export interface PickUpIntent extends BaseIntent {
  readonly type: IntentType.PickUp;
}

/** Intent to drop an item from inventory onto the map. */
export interface DropIntent extends BaseIntent {
  readonly type: IntentType.Drop;
  readonly itemIndex: number;
}

/** Intent to equip an item from inventory. */
export interface EquipItemIntent extends BaseIntent {
  readonly type: IntentType.EquipItem;
  readonly itemIndex: number;
}

/** Intent to unequip an item from a specific equipment slot. */
export interface UnequipItemIntent extends BaseIntent {
  readonly type: IntentType.UnequipItem;
  readonly slotId: string;
}
