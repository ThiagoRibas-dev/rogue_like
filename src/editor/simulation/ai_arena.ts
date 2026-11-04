import { dispatchAction } from '../../actions/action.registry.ts';
import { getComponent } from '../../core/ecs.ts';
import { processAITurn } from '../../systems/ai.system.ts';
import { processDamageSystem } from '../../systems/damage.system.ts';
import { processDeathSystem } from '../../systems/death.system.ts';
import { processStatusEffectsTick } from '../../systems/status-effect.system.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import {
  type ArenaOptions,
  type ArenaResult,
  type ArenaTelemetry,
  createArenaMockState
} from './arena_state_factory.ts';

export * from './arena_state_factory.ts';

/**
 * Collects arena state for later aggregation.
 */
interface ArenaDamageTracker {
  damageToA: number;
  damageToB: number;
}

/**
 * Runs a head-to-head AI arena simulation.
 *
 * @param combatantAId  Template ID for combatant A.
 * @param combatantBId  Template ID for combatant B.
 * @param campaign      Campaign data with entity/item/etc registries.
 * @param maxTurns      Maximum simulation turns before declaring a draw.
 * @param options       Optional overrides for map layout, placement, extra entities.
 * @returns ArenaResult with logs and structured telemetry.
 */
export function runAIArena(
  combatantAId: string,
  combatantBId: string,
  campaign: CampaignData,
  maxTurns: number = 100,
  options?: ArenaOptions
): ArenaResult {
  const {
    state: initialState,
    entA,
    entB,
    extraEntityIds
  } = createArenaMockState(combatantAId, combatantBId, campaign, options);
  let state = initialState;

  const logs: string[] = [`=== Simulation Started: ${combatantAId} vs ${combatantBId} ===`];
  if (extraEntityIds.length > 0) {
    logs.push(`  + ${extraEntityIds.length} extra entities spawned.`);
  }

  const tracker: ArenaDamageTracker = { damageToA: 0, damageToB: 0 };

  let turns = 0;
  while (turns < maxTurns) {
    turns++;
    logs.push(`\n--- Turn ${turns} ---`);

    const allActors = [entA, entB, ...extraEntityIds];

    for (const actor of allActors) {
      const fighter = getComponent(state, actor, ComponentType.Fighter);
      if (!fighter || fighter.hp <= 0) continue;

      const prevMessageCount = state.messages.length;

      state = processStatusEffectsTick(state, actor);
      state = processDamageSystem(state);
      state = processDeathSystem(state);

      if ((getComponent(state, actor, ComponentType.Fighter)?.hp ?? 0) <= 0) {
        continue;
      }

      const aiTurnResult = processAITurn(state, actor);
      state = aiTurnResult.state;
      const intent = aiTurnResult.intent;

      if (intent) {
        const startHpA = getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0;
        const startHpB = getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0;

        const result = dispatchAction(state, intent);
        state = result.state;

        state = processDamageSystem(state);
        state = processDeathSystem(state);

        const afterHpA = getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0;
        const afterHpB = getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0;

        if (actor.toString() === entA.toString()) {
          tracker.damageToB += startHpB - afterHpB;
        } else if (actor.toString() === entB.toString()) {
          tracker.damageToA += startHpA - afterHpA;
        } else {
          tracker.damageToA += startHpA - afterHpA;
          tracker.damageToB += startHpB - afterHpB;
        }

        state = { ...state, events: [] };
      } else {
        const name = actor === entA ? combatantAId : actor === entB ? combatantBId : `extra_${actor}`;
        logs.push(`${name} waits.`);
      }

      if (state.messages.length > prevMessageCount) {
        const newMessages = state.messages.slice(prevMessageCount);
        for (const msg of newMessages) {
          logs.push(msg.text);
        }
      }
    }

    const fighterA = getComponent(state, entA, ComponentType.Fighter);
    const fighterB = getComponent(state, entB, ComponentType.Fighter);

    if (!fighterA || fighterA.hp <= 0) {
      logs.push(`\n>>> ${combatantAId} died. ${combatantBId} wins! <<<`);
      break;
    }
    if (!fighterB || fighterB.hp <= 0) {
      logs.push(`\n>>> ${combatantBId} died. ${combatantAId} wins! <<<`);
      break;
    }
  }

  const finalHpA = Math.max(0, getComponent(state, entA, ComponentType.Fighter)?.hp ?? 0);
  const finalHpB = Math.max(0, getComponent(state, entB, ComponentType.Fighter)?.hp ?? 0);

  let winner: ArenaTelemetry['winner'] = 'draw';
  if (finalHpA <= 0 && finalHpB > 0) winner = 'b';
  else if (finalHpB <= 0 && finalHpA > 0) winner = 'a';

  if (turns >= maxTurns) {
    logs.push(`\n>>> Simulation ended after ${maxTurns} turns (Draw) <<<`);
  }

  const telemetry: ArenaTelemetry = {
    winner,
    turnsElapsed: turns,
    damageDealtA: tracker.damageToB,
    damageDealtB: tracker.damageToA,
    finalHpA,
    finalHpB
  };

  return { logs, telemetry };
}
