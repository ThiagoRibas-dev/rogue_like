import type { EntityId, GameState } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FighterComponent,
  type DamageComponent,
  type DeathComponent,
  type EquipmentComponent,
  type ItemComponent
} from '../types/components.types.ts';
import { getComponent } from '../core/ecs.ts';
import { getSettings } from '../core/settings.ts';
import { applyStatusEffect } from './status-effect.system.ts';

/**
 * Helper to add floating text above an entity.
 */
export function addFloatingText(state: GameState, entityId: EntityId, content: string, color: string): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const visualEffect = {
    id: `txt_${Date.now()}_${Math.random()}`,
    type: 'floating_text' as const,
    x: pos.x + (Math.random() - 0.5) * 0.8,
    y: pos.y + (Math.random() - 0.5) * 0.8,
    content,
    color,
    expiresAt: performance.now() + 1000
  };

  return { ...state, visualEffects: [...state.visualEffects, visualEffect] };
}

/**
 * Processes all entities that have a DamageComponent.
 * Calculates total damage, reduces HP, handles floating text and on-hit effects,
 * and attaches a DeathComponent if the entity drops to 0 HP.
 */
export function processDamageSystem(state: GameState): GameState {
  let nextState = state;
  let nextComponents = new Map(nextState.components);
  let anyModified = false;

  for (const entityId of nextState.entities) {
    const damageComp = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    if (!damageComp || damageComp.instances.length === 0) continue;

    const fighter = getComponent(nextState, entityId, ComponentType.Fighter);
    const isGod = getComponent(nextState, entityId, ComponentType.GodMode) !== undefined;

    let totalDamage = 0;
    let lastKillerId: EntityId | undefined;
    let hitByMelee = false;
    let meleeSourceId: EntityId | undefined;
    let causeOfDeath: string | undefined;

    for (const instance of damageComp.instances) {
      const dmg = isGod ? 0 : instance.amount;
      if (dmg > 0) {
        totalDamage += dmg;
        lastKillerId = instance.sourceEntityId;

        if (instance.tags.includes('spell')) causeOfDeath = 'spell';
        else if (instance.tags.includes('scroll')) causeOfDeath = 'scroll';
        else if (instance.tags.includes('potion')) causeOfDeath = 'potion';
        else if (instance.tags.includes('trap')) causeOfDeath = 'trap';
        else if (instance.tags.includes('melee')) causeOfDeath = 'melee';

        if (instance.tags.includes('melee')) {
          hitByMelee = true;
          meleeSourceId = instance.sourceEntityId;
        }
      }
    }

    if (!fighter) {
      // Entity can't take damage, just clear the component
      const comps = nextComponents.get(entityId) ?? [];
      nextComponents.set(
        entityId,
        comps.filter((c) => c.type !== ComponentType.Damage)
      );
      anyModified = true;
      continue;
    }

    if (totalDamage > 0) {
      const newHp = Math.max(0, fighter.hp - totalDamage);

      const nextFighter: FighterComponent = {
        ...fighter,
        hp: newHp
      };

      const entityComps = nextComponents.get(entityId) ?? [];
      const withoutDamage = entityComps.filter((c) => c.type !== ComponentType.Damage);

      const newComps = withoutDamage.map((c) => (c.type === ComponentType.Fighter ? nextFighter : c));

      if (newHp === 0) {
        // Entity died, attach DeathComponent
        const deathComp: DeathComponent = { type: ComponentType.Death, killerId: lastKillerId, causeOfDeath };
        newComps.push(deathComp);
      }

      nextComponents.set(entityId, newComps);
      anyModified = true;

      if (getSettings().visualFeedback.showDamageNumbers) {
        nextState = addFloatingText(nextState, entityId, `-${totalDamage}`, '#ff4757'); // var(--color-health)
      }

      // Check for on-hit effects if this was a melee attack
      if (newHp > 0 && hitByMelee && meleeSourceId !== undefined) {
        const equipment = getComponent(nextState, meleeSourceId, ComponentType.Equipment) as
          | EquipmentComponent
          | undefined;
        if (equipment) {
          for (const slot of equipment.slots) {
            if (slot.equippedItem !== null) {
              const item = getComponent(nextState, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
              if (item) {
                const itemDef = nextState.campaign.items[item.itemId];
                if (itemDef?.equippable?.onHit) {
                  // We update nextState with the status effect application
                  nextState = { ...nextState, components: nextComponents };
                  nextState = applyStatusEffect(
                    nextState,
                    entityId,
                    itemDef.equippable.onHit.statusId,
                    itemDef.equippable.onHit.duration,
                    meleeSourceId
                  );
                  // Refresh components map after status effect
                  nextComponents = new Map(nextState.components);
                }
              }
            }
          }
        }
      }
    } else {
      // No damage taken, just clear component
      const comps = nextComponents.get(entityId) ?? [];
      nextComponents.set(
        entityId,
        comps.filter((c) => c.type !== ComponentType.Damage)
      );
      anyModified = true;
    }
  }

  if (anyModified) {
    nextState = { ...nextState, components: nextComponents };
  }

  return nextState;
}
