import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';

export interface PickUpIntent extends BaseIntent {
  readonly type: IntentType.PickUp;
}

export interface DropIntent extends BaseIntent {
  readonly type: IntentType.Drop;
  readonly itemIndex: number;
}

export interface EquipItemIntent extends BaseIntent {
  readonly type: IntentType.EquipItem;
  readonly itemIndex: number;
}

export interface UnequipItemIntent extends BaseIntent {
  readonly type: IntentType.UnequipItem;
  readonly slotId: string;
}
