import { addComponent, getComponent, removeComponent } from '../../core/ecs.ts';
import { rng } from '../../core/rng.ts';
import { getSettings } from '../../core/settings.ts';
import { NEMESIS_ENCOUNTER_COOLDOWN_TURNS } from '../../constants/nemesis.constants.ts';
import { ARTIFACT_PROMOTION_CHANCE } from '../../constants/pacing.constants.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../../types/intents/combat.intents.ts';
import { GameEventType } from '../../types/events.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type CoatingComponent,
  type DamageComponent,
  type DamageInstance,
  type DeathComponent,
  type EquipmentComponent,
  type FactionComponent,
  type FighterComponent,
  type IdentityComponent,
  type ItemComponent,
  type MemoryComponent,
  type NemesisComponent
} from '../../types/components.types.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { addFloatingText } from '../../systems/damage.system.ts';
import { applyStatusEffect } from '../../systems/status-effect.system.ts';
import { getEntityBarks } from '../../systems/nemesis.system.ts';
import { promoteEntity, recordChronicleEvent } from '../../systems/chronicle.system.ts';
import { computeClassicEffectiveStats } from './classic_stats.ts';

export { addFloatingText };

/** Faction standing penalty applied when an actor attacks a member of a faction. */
const ATTACK_FACTION_STANDING_PENALTY = 5;

/** Minimum melee damage dealt on a classic attack hit. */
const MIN_CLASSIC_MELEE_DAMAGE = 1;

/** Duration in milliseconds for floating combat text overlays. */
const FLOATING_TEXT_DURATION_MS = 1000;

/** Random ID range for floating text visual effects. */
const VFX_ID_MAX = 1000000;

/** Random ID range for kill event suffixes. */
const KILL_EVENT_ID_MAX = 10000;

/** Health ratio threshold below which surviving a player hit triggers organic nemesis promotion. */
const ORGANIC_PROMOTION_HP_THRESHOLD = 0.2;

/**
 * Resolves a melee attack under the `classic` ruleset (`Math.max(1, attack - defense)`).
 *
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to process.
 * @returns The updated GameState and success flag.
 */
export function resolveClassicMeleeAttack(
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

  const attackerStats = computeClassicEffectiveStats(state, entityId);
  const defenderStats = computeClassicEffectiveStats(state, defenderId);
  const damage = Math.max(MIN_CLASSIC_MELEE_DAMAGE, attackerStats.attack - defenderStats.defense);

  let nextState = state;

  const attackerNemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
  if (attackerNemesis && getComponent(state, defenderId, ComponentType.Player)) {
    const lastTurn = attackerNemesis.lastEncounterTurn ?? 0;
    if ((state.globalTurn ?? 0) - lastTurn > NEMESIS_ENCOUNTER_COOLDOWN_TURNS) {
      const barks = getEntityBarks(state, entityId, 'encounter_nemesis');
      if (barks.length > 0) {
        const bark = rng.getItem(barks);
        if (bark) {
          nextState = addMessage(nextState, `${attackerName} shouts: "${bark}"`, MessageLogCategory.Flavor);
          nextState = addComponent(nextState, entityId, {
            ...attackerNemesis,
            lastEncounterTurn: state.globalTurn ?? 0
          });
        }
      }
    }
  }

  const attackerMemory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
  const defenderFaction = getComponent(state, defenderId, ComponentType.Faction) as FactionComponent | undefined;

  if (attackerMemory && defenderFaction) {
    const currentStanding = attackerMemory.factionStandings[defenderFaction.factionId] ?? 0;
    const nextMemory: MemoryComponent = {
      ...attackerMemory,
      factionStandings: {
        ...attackerMemory.factionStandings,
        [defenderFaction.factionId]: currentStanding - ATTACK_FACTION_STANDING_PENALTY
      }
    };
    nextState = addComponent(nextState, entityId, nextMemory);
  }

  if (damage > 0) {
    nextState = addMessage(nextState, `${attackerName} hits ${defenderName}.`, MessageLogCategory.CombatHit);

    const existingDamageComp = getComponent(nextState, defenderId, ComponentType.Damage) as DamageComponent | undefined;
    const damageInstance: DamageInstance = {
      amount: damage,
      sourceEntityId: entityId,
      tags: ['melee', 'physical']
    };

    if (existingDamageComp) {
      nextState = addComponent(nextState, defenderId, {
        ...existingDamageComp,
        instances: [...existingDamageComp.instances, damageInstance]
      });
    } else {
      const newDamageComp: DamageComponent = {
        type: ComponentType.Damage,
        instances: [damageInstance]
      };
      nextState = addComponent(nextState, defenderId, newDamageComp);
    }

    const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (equipment?.slots) {
      const weaponSlot = equipment.slots.find((s) => s.slotType === 'hand' && s.equippedItem !== null);
      if (weaponSlot?.equippedItem) {
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
          id: `blk_${Math.floor(rng.getUniform() * VFX_ID_MAX)}`,
          type: 'floating_text' as const,
          x: defenderPos.x,
          y: defenderPos.y,
          content: 'Blocked',
          color: '#7f8490',
          expiresAt: performance.now() + FLOATING_TEXT_DURATION_MS
        };
        nextState = { ...nextState, visualEffects: [...nextState.visualEffects, visualEffect] };
      }
    }
  }

  return { state: nextState, success: true };
}

/**
 * Processes pending DamageComponent instances across entities under the `classic` ruleset.
 *
 * @param state The current GameState.
 * @returns The updated GameState.
 */
export function processClassicDamage(state: GameState): GameState {
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
      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
      continue;
    }

    if (totalDamage > 0) {
      const newHp = Math.max(0, fighter.hp - totalDamage);
      const nextFighter: FighterComponent = { ...fighter, hp: newHp };
      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
      nextState = addComponent(nextState, entityId, nextFighter);

      if (newHp === 0) {
        const deathComp: DeathComponent = { type: ComponentType.Death, killerId: lastKillerId, causeOfDeath };
        nextState = addComponent(nextState, entityId, deathComp);

        if (lastKillerId !== undefined) {
          const attackerEquipment = getComponent(nextState, lastKillerId, ComponentType.Equipment) as
            EquipmentComponent | undefined;
          const weaponId = attackerEquipment?.slots.find(
            (s) => s.slotType === 'hand' && s.equippedItem !== null
          )?.equippedItem;
          if (weaponId) {
            let chronicle = getComponent(nextState, weaponId, ComponentType.Chronicle) as
              ChronicleComponent | undefined;
            if (!chronicle && rng.getUniform() < ARTIFACT_PROMOTION_CHANCE) {
              nextState = promoteEntity(nextState, weaponId);
              chronicle = getComponent(nextState, weaponId, ComponentType.Chronicle) as ChronicleComponent | undefined;
              if (chronicle) {
                nextState = addFloatingText(nextState, lastKillerId, 'Weapon Awakened!', '#ffd700');
              }
            }
            if (chronicle) {
              const victimIdentity = getComponent(nextState, entityId, ComponentType.Identity) as
                IdentityComponent | undefined;
              const victimName = victimIdentity ? victimIdentity.name : 'an enemy';
              const eventId = `evt_${nextState.globalTurn}_kill_${Math.floor(rng.getUniform() * KILL_EVENT_ID_MAX)}`;
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
      } else if (newHp / fighter.maxHp < ORGANIC_PROMOTION_HP_THRESHOLD && lastKillerId !== undefined) {
        const isPlayerSource = getComponent(nextState, lastKillerId, ComponentType.Player) !== undefined;
        if (isPlayerSource) {
          nextState = promoteEntity(nextState, entityId);
        }
      }

      if (getSettings().visualFeedback.showDamageNumbers) {
        nextState = addFloatingText(nextState, entityId, `-${totalDamage}`, '#ff4757');
      }

      if (newHp > 0 && hitByMelee && meleeSourceId !== undefined) {
        const equipment = getComponent(nextState, meleeSourceId, ComponentType.Equipment) as
          EquipmentComponent | undefined;
        if (equipment) {
          for (const slot of equipment.slots) {
            if (slot.equippedItem !== null) {
              const item = getComponent(nextState, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
              const itemDef = item ? nextState.campaign.items[item.itemId] : undefined;
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
    } else {
      nextState = removeComponent(nextState, entityId, ComponentType.Damage);
    }
  }

  return nextState;
}

export { grantClassicXp } from './classic_stats.ts';
