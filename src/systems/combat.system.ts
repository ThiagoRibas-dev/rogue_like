import type { GameState } from '../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../types/intents/combat.intents.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';

/**
 * Processes a MeleeAttackIntent by delegating to the active ruleset cartridge.
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to process.
 * @returns The updated GameState and resolution success flag.
 */
export function processMeleeAttackIntent(
  state: GameState,
  intent: MeleeAttackIntent
): { state: GameState; success: boolean } {
  return getActiveRuleset(state).resolveMeleeAttack(state, intent);
}
