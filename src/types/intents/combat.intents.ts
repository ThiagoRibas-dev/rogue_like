import type { IntentType } from './intent.enum.ts';
import type { BaseIntent } from './core.intents.ts';
import type { EntityId } from '../game-state.types.ts';

/** Intent to execute a melee attack against a defender entity. */
export interface MeleeAttackIntent extends BaseIntent {
  readonly type: IntentType.MeleeAttack;
  readonly defenderId: EntityId;
}

/** Intent to toggle the manual targeting/aiming mode. */
export interface ToggleTargetingIntent extends BaseIntent {
  readonly type: IntentType.ToggleTargeting;
  readonly isImmediate: true;
  readonly context?:
    | {
        readonly verb: string;
        readonly toolEntityId?: EntityId;
      }
    | undefined;
}

/** Intent to move the targeting cursor in manual aiming mode. */
export interface MoveTargetIntent extends BaseIntent {
  readonly type: IntentType.MoveTarget;
  readonly dx: number;
  readonly dy: number;
  readonly isImmediate: true;
}

/** Intent to confirm and fire/resolve the action at the targeting cursor. */
export interface FireAimedIntent extends BaseIntent {
  readonly type: IntentType.FireAimed;
}

/** Intent to trigger a special combat ability or spell effect. */
export interface UseAbilityIntent extends BaseIntent {
  readonly type: IntentType.UseAbility;
  readonly effectId: string;
  readonly abilityName: string;
  readonly cooldown?: number;
}
