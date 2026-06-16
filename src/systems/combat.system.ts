import { addComponent, getComponent } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../types/intents/combat.intents.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';
import { removeComponent } from '../core/ecs.ts';

import { getSettings } from '../core/settings.ts';
import {
  ComponentType,
  type DamageComponent,
  type DamageInstance,
  type FactionComponent,
  type MemoryComponent,
  type EquipmentComponent,
  type CoatingComponent
} from '../types/components.types.ts';
import { getEffectiveStats } from '../utils/stats.ts';

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
    nextState = addComponent(nextState, entityId, nextMemory);
  }

  if (damage > 0) {
    nextState = addMessage(nextState, `${attackerName} hits ${defenderName}.`, MessageLogCategory.CombatHit);

    // Attach DamageComponent
    const existingDamageComp = getComponent(nextState, defenderId, ComponentType.Damage) as DamageComponent | undefined;

    const damageInstance: DamageInstance = {
      amount: damage,
      sourceEntityId: entityId,
      tags: ['melee', 'physical']
    };

    if (existingDamageComp) {
      const newDamageComp = { ...existingDamageComp, instances: [...existingDamageComp.instances, damageInstance] };
      nextState = addComponent(nextState, defenderId, newDamageComp);
    } else {
      const newDamageComp: DamageComponent = {
        type: ComponentType.Damage,
        instances: [damageInstance]
      };
      nextState = addComponent(nextState, defenderId, newDamageComp);
    }

    // Apply weapon coating if present
    const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equipment && equipment.slots) {
      const weaponSlot = equipment.slots.find((s) => s.slotType === 'hand' && s.equippedItem !== null);
      if (weaponSlot && weaponSlot.equippedItem) {
        const weaponId = weaponSlot.equippedItem;
        const coating = getComponent(nextState, weaponId, ComponentType.Coating) as CoatingComponent | undefined;
        if (coating) {
          nextState = applyStatusEffect(nextState, defenderId, coating.statusId, coating.duration, entityId);

          const newCharges = coating.charges - 1;
          if (newCharges <= 0) {
            nextState = removeComponent(nextState, weaponId, ComponentType.Coating);
            nextState = addMessage(
              nextState,
              `The coating on ${attackerName}'s weapon wears off.`,
              MessageLogCategory.System
            );
          } else {
            nextState = addComponent(nextState, weaponId, { ...coating, charges: newCharges });
          }
        }
      }
    }
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
