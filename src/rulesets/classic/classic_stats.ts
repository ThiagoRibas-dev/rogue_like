import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { EffectiveStats, HudVitalsDTO } from '../../types/ruleset.types.ts';
import { addComponent, getComponent } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';

/** Default actor speed when ActorComponent is absent. */
const DEFAULT_CLASSIC_ACTOR_SPEED = 100;

/** Flat defense modifier for the 'fragile' trait in the classic ruleset. */
const CLASSIC_FRAGILE_DEFENSE_PENALTY = 2;

/** Flat defense modifier for the 'tough' trait in the classic ruleset. */
const CLASSIC_TOUGH_DEFENSE_BONUS = 2;

/** Minimum allowed effective max HP. */
const MIN_EFFECTIVE_MAX_HP = 1;

/** Percentage multiplier for HUD bar calculation. */
const PERCENT_MULTIPLIER = 100;

/**
 * Computes effective combat and movement stats for an entity under the `classic` ruleset
 * by summing base FighterComponent values with equipped item and active status modifiers.
 *
 * @param state The current GameState.
 * @param entityId The entity whose stats to compute.
 * @returns The computed EffectiveStats.
 */
export function computeClassicEffectiveStats(state: GameState, entityId: EntityId): EffectiveStats {
  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  const actor = getComponent(state, entityId, ComponentType.Actor);

  let baseAttack = 0;
  let baseDefense = 0;
  let baseMaxHp = 0;
  let baseSpeed = DEFAULT_CLASSIC_ACTOR_SPEED;

  if (fighter) {
    baseAttack = fighter.attack;
    baseDefense = fighter.defense;
    baseMaxHp = fighter.maxHp;
  }

  if (actor) {
    baseSpeed = actor.speed;
  }

  let attackBonus = 0;
  let defenseBonus = 0;
  let maxHpBonus = 0;
  let speedBonus = 0;

  const equipment = getComponent(state, entityId, ComponentType.Equipment);
  if (equipment) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem !== null) {
        const item = getComponent(state, slot.equippedItem, ComponentType.Item);
        if (item) {
          const def = state.campaign.items[item.itemId];
          if (def?.equippable) {
            attackBonus += def.equippable.attackBonus;
            defenseBonus += def.equippable.defenseBonus;
            maxHpBonus += def.equippable.maxHpBonus;
          }
        }
      }
    }
  }

  const statuses = getComponent(state, entityId, ComponentType.StatusEffects);
  if (statuses) {
    for (const active of statuses.activeEffects) {
      const def = state.campaign.status[active.effectId];
      if (def?.statModifiers) {
        attackBonus += def.statModifiers.attack ?? 0;
        defenseBonus += def.statModifiers.defense ?? 0;
        maxHpBonus += def.statModifiers.maxHp ?? 0;
        speedBonus += def.statModifiers.speed ?? 0;
      }
    }
  }

  const finalAttack = baseAttack + attackBonus;
  let finalDefense = baseDefense + defenseBonus;
  const finalMaxHp = baseMaxHp + maxHpBonus;
  const finalSpeed = baseSpeed + speedBonus;

  const traitsCmp = getComponent(state, entityId, ComponentType.Traits);
  if (traitsCmp) {
    if (traitsCmp.traits.includes('fragile')) {
      finalDefense = Math.max(0, finalDefense - CLASSIC_FRAGILE_DEFENSE_PENALTY);
    }
    if (traitsCmp.traits.includes('tough')) {
      finalDefense += CLASSIC_TOUGH_DEFENSE_BONUS;
    }
  }

  return {
    attack: Math.max(0, finalAttack),
    defense: Math.max(0, finalDefense),
    maxHp: Math.max(MIN_EFFECTIVE_MAX_HP, finalMaxHp),
    speed: Math.max(0, finalSpeed)
  };
}

/**
 * Projects the HUD Vitals Plate DTO for the player entity under the `classic` ruleset.
 *
 * @param state The current GameState.
 * @param playerEntityId The player entity ID.
 * @returns The projected HudVitalsDTO, or null if the player lacks a FighterComponent.
 */
export function projectClassicHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null {
  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter);
  if (!fighter) return null;

  const effectiveStats = computeClassicEffectiveStats(state, playerEntityId);
  const hpPercent = Math.max(0, Math.min(PERCENT_MULTIPLIER, (fighter.hp / effectiveStats.maxHp) * PERCENT_MULTIPLIER));

  const currentAdvancement = state.campaign.advancement.find((a) => a.level === fighter.level);
  const nextAdvancement = state.campaign.advancement.find((a) => a.level === fighter.level + 1);
  const baseLevelXp = currentAdvancement ? currentAdvancement.requiredXp : 0;
  const currentXpInLevel = Math.max(0, fighter.xp - baseLevelXp);

  let xpPercent = PERCENT_MULTIPLIER;
  let xpText = `MAX (${fighter.xp})`;
  if (nextAdvancement) {
    const xpNeededForNextLevel = Math.max(1, nextAdvancement.requiredXp - baseLevelXp);
    xpPercent = Math.max(
      0,
      Math.min(PERCENT_MULTIPLIER, (currentXpInLevel / xpNeededForNextLevel) * PERCENT_MULTIPLIER)
    );
    xpText = `${fighter.xp} / ${nextAdvancement.requiredXp}`;
  }

  return {
    levelLabel: fighter.level.toString(),
    hpCurrent: fighter.hp,
    hpMax: effectiveStats.maxHp,
    hpPercent,
    xpPercent,
    xpText,
    primaryStat: {
      label: 'ATK',
      value: effectiveStats.attack.toString()
    },
    secondaryStat: {
      label: 'DEF',
      value: effectiveStats.defense.toString()
    }
  };
}

/**
 * Grants XP to an entity and processes level advancement thresholds under the `classic` ruleset.
 *
 * @param state The current GameState.
 * @param entityId The recipient entity ID.
 * @param amount The XP amount to award.
 * @returns The updated GameState.
 */
export function grantClassicXp(state: GameState, entityId: EntityId, amount: number): GameState {
  if (amount <= 0) return state;

  const fighter = getComponent(state, entityId, ComponentType.Fighter);
  if (!fighter) return state;

  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
  let nextState = state;
  let nextFighter = { ...fighter, xp: fighter.xp + amount };

  if (isPlayer) {
    nextState = addMessage(nextState, `You gained ${amount} XP.`, MessageLogCategory.System);
  }

  let nextLevelDef = state.campaign.advancement.find((a) => a.level === nextFighter.level + 1);
  while (nextLevelDef && nextFighter.xp >= nextLevelDef.requiredXp) {
    const newMaxHp = nextFighter.maxHp + nextLevelDef.hpGain;
    nextFighter = {
      ...nextFighter,
      level: nextLevelDef.level,
      maxHp: newMaxHp,
      hp: newMaxHp,
      attack: nextFighter.attack + nextLevelDef.attackGain,
      defense: nextFighter.defense + nextLevelDef.defenseGain
    };

    if (isPlayer) {
      nextState = addMessage(nextState, `You reached level ${nextFighter.level}!`, MessageLogCategory.System);
    }

    nextLevelDef = state.campaign.advancement.find((a) => a.level === nextFighter.level + 1);
  }

  return addComponent(nextState, entityId, nextFighter);
}
