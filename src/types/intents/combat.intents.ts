import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';
import type { EntityId } from '../game-state.types.ts';

export interface MeleeAttackIntent extends BaseIntent {
  readonly type: IntentType.MeleeAttack;
  readonly defenderId: EntityId;
}

export interface ToggleTargetingIntent extends BaseIntent {
  readonly type: IntentType.ToggleTargeting;
  readonly isImmediate: true;
}

export interface MoveTargetIntent extends BaseIntent {
  readonly type: IntentType.MoveTarget;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}

export interface FireAimedIntent extends BaseIntent {
  readonly type: IntentType.FireAimed;
}

export interface UseAbilityIntent extends BaseIntent {
  readonly type: IntentType.UseAbility;
  readonly effectId: string;
  readonly abilityName: string;
  readonly cooldown?: number;
}
