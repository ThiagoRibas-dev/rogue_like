import type { EntityId, GameState } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FighterComponent,
  type DamageComponent,
  type DeathComponent,
  type EquipmentComponent,
  type ItemComponent,
  type ChronicleComponent,
  type IdentityComponent
} from '../types/components.types.ts';
import { GameEventType } from '../types/events.types.ts';
import { getComponent, addComponent, removeComponent } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { getSettings } from '../core/settings.ts';
import { applyStatusEffect } from './status-effect.system.ts';
import { promoteEntity, recordChronicleEvent } from './chronicle.system.ts';
import { ARTIFACT_PROMOTION_CHANCE } from '../constants/pacing.constants.ts';

/**
 * Helper to add floating text above an entity.
 */
export function addFloatingText(state: GameState, entityId: EntityId, content: string, color: string): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position);
  if (!pos) return state;

  const visualEffect = {
    id: `txt_${Math.floor(rng.getUniform() * 1000000)}`,
    type: 'floating_text' as const,
    x: pos.x + (rng.getUniform() - 0.5) * 0.8,
    y: pos.y + (rng.getUniform() - 0.5) * 0.8,
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
      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
      continue;
    }

    if (totalDamage > 0) {
      const newHp = Math.max(0, fighter.hp - totalDamage);

      const nextFighter: FighterComponent = {
        ...fighter,
        hp: newHp
      };

      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
      nextState = addComponent(nextState, entityId, nextFighter);

      if (newHp === 0) {
        // Entity died, attach DeathComponent
        const deathComp: DeathComponent = { type: ComponentType.Death, killerId: lastKillerId, causeOfDeath };
        nextState = addComponent(nextState, entityId, deathComp);

        if (lastKillerId !== undefined) {
          const attackerEquipment = getComponent(nextState, lastKillerId, ComponentType.Equipment) as
            | EquipmentComponent
            | undefined;
          if (attackerEquipment) {
            const weaponId = attackerEquipment.slots.find(
              (s) => s.slotType === 'hand' && s.equippedItem !== null
            )?.equippedItem;
            if (weaponId) {
              let chronicle = getComponent(nextState, weaponId, ComponentType.Chronicle) as
                | ChronicleComponent
                | undefined;
              if (!chronicle && rng.getUniform() < ARTIFACT_PROMOTION_CHANCE) {
                nextState = promoteEntity(nextState, weaponId);
                chronicle = getComponent(nextState, weaponId, ComponentType.Chronicle) as
                  | ChronicleComponent
                  | undefined;
                if (chronicle) {
                  nextState = addFloatingText(nextState, lastKillerId, `Weapon Awakened!`, '#ffd700');
                }
              }

              if (chronicle) {
                const victimIdentity = getComponent(nextState, entityId, ComponentType.Identity) as
                  | IdentityComponent
                  | undefined;
                const victimName = victimIdentity ? victimIdentity.name : 'an enemy';
                const eventId = `evt_${nextState.globalTurn}_kill_${Math.floor(rng.getUniform() * 10000)}`;
                nextState = {
                  ...nextState,
                  events: [
                    ...nextState.events,
                    {
                      id: eventId,
                      importance: 'low',
                      summary: `Slew ${victimName} in combat.`,
                      type: GameEventType.ItemKill,
                      entityId: weaponId
                    }
                  ]
                };
                nextState = recordChronicleEvent(nextState, weaponId, eventId);
              }
            }
          }
        }
      } else {
        // Organic Promotion check: survived damage, hp < 20%, source was player
        if (newHp / fighter.maxHp < 0.2 && lastKillerId !== undefined) {
          const isPlayerSource = getComponent(nextState, lastKillerId, ComponentType.Player) !== undefined;
          if (isPlayerSource) {
            nextState = promoteEntity(nextState, entityId);
          }
        }
      }

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
                  nextState = applyStatusEffect(
                    nextState,
                    entityId,
                    itemDef.equippable.onHit.statusId,
                    itemDef.equippable.onHit.duration,
                    meleeSourceId
                  );
                }
              }
            }
          }
        }
      }
    } else {
      // No damage taken, just clear component
      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
    }
  }

  return nextState;
}
