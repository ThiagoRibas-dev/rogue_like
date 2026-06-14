import type { GameState } from '../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../types/intents/combat.intents.ts';
import { ComponentType } from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { rng } from '../core/rng.ts';

import { getEffectiveStats } from '../utils/stats.ts';
import { getSettings } from '../core/settings.ts';
import type { MemoryComponent, FactionComponent, DamageComponent, DamageInstance } from '../types/components.types.ts';

/**
 * Processes a MeleeAttackIntent.
 * Calculates damage based on attacker's attack and defender's defense.
 * Attaches a DamageComponent to the defender for the pipeline to process.
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to process.
 * @returns The updated GameState.
 */
export function processMeleeAttackIntent(
  state: GameState,
  intent: MeleeAttackIntent
): { state: GameState; success: boolean } {
  const { entityId, defenderId } = intent;

  const attackerFighter = getComponent(state, entityId, ComponentType.Fighter);
  const defenderFighter = getComponent(state, defenderId, ComponentType.Fighter);
  const attackerRenderable = getComponent(state, entityId, ComponentType.Renderable);
  const defenderRenderable = getComponent(state, defenderId, ComponentType.Renderable);

  if (!attackerFighter || !defenderFighter) {
    return { state, success: false };
  }

  const attackerName = attackerRenderable ? attackerRenderable.glyph : 'Someone';
  const defenderName = defenderRenderable ? defenderRenderable.glyph : 'Someone';

  const attackerStats = getEffectiveStats(state, entityId);
  const defenderStats = getEffectiveStats(state, defenderId);

  const damage = Math.max(1, attackerStats.attack - defenderStats.defense);

  let nextState = state;
  let nextComponents = new Map(state.components);
  let stateModified = false;

  const attackerMemory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
  const defenderFaction = getComponent(state, defenderId, ComponentType.Faction) as FactionComponent | undefined;

  if (attackerMemory && defenderFaction) {
    const currentStanding = attackerMemory.factionStandings[defenderFaction.factionId] ?? 0;
    const nextMemory: MemoryComponent = {
      ...attackerMemory,
      factionStandings: {
        ...attackerMemory.factionStandings,
        [defenderFaction.factionId]: currentStanding - 5
      }
    };
    const attackerComps = nextComponents.get(entityId) ?? [];
    nextComponents.set(
      entityId,
      attackerComps.map((c) => (c.type === ComponentType.Memory ? nextMemory : c))
    );
    stateModified = true;
  }

  if (stateModified) {
    nextState = { ...nextState, components: nextComponents };
  }

  if (damage > 0) {
    nextState = addMessage(nextState, `${attackerName} hits ${defenderName}.`, MessageLogCategory.CombatHit);

    // Attach DamageComponent
    nextComponents = new Map(nextState.components);
    const defenderComps = nextComponents.get(defenderId) ?? [];
    const existingDamageComp = defenderComps.find((c) => c.type === ComponentType.Damage) as
      | DamageComponent
      | undefined;

    const damageInstance: DamageInstance = {
      amount: damage,
      sourceEntityId: entityId,
      tags: ['melee', 'physical']
    };

    if (existingDamageComp) {
      const newDamageComp = { ...existingDamageComp, instances: [...existingDamageComp.instances, damageInstance] };
      nextComponents.set(
        defenderId,
        defenderComps.map((c) => (c.type === ComponentType.Damage ? newDamageComp : c))
      );
    } else {
      const newDamageComp: DamageComponent = {
        type: ComponentType.Damage,
        instances: [damageInstance]
      };
      nextComponents.set(defenderId, [...defenderComps, newDamageComp]);
    }

    nextState = { ...nextState, components: nextComponents };
  } else {
    nextState = addMessage(
      nextState,
      `${attackerName} attacks ${defenderName} but deals no damage.`,
      MessageLogCategory.CombatMiss
    );
    if (getSettings().visualFeedback.showDamageNumbers) {
      const defenderPos = getComponent(state, defenderId, ComponentType.Position);
      if (defenderPos) {
        const visualEffect = {
          id: `blk_${Math.floor(rng.getUniform() * 1000000)}`,
          type: 'floating_text' as const,
          x: defenderPos.x,
          y: defenderPos.y,
          content: `Blocked`,
          color: '#7f8490', // var(--text-dim)
          expiresAt: performance.now() + 1000
        };
        nextState = { ...nextState, visualEffects: [...nextState.visualEffects, visualEffect] };
      }
    }
  }

  return { state: nextState, success: true };
}
