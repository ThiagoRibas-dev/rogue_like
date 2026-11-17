import type { EntityId, GameState } from '../types/game-state.types.ts';
import { UIMode } from '../types/game-state.types.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';
import {
  ComponentType,
  type DeathComponent,
  type EquipmentComponent,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent,
  type ShopComponent,
  type TagsComponent,
  type TemplateComponent,
  type NemesisComponent,
  type SchemeComponent,
  type AgreementComponent
} from '../types/components.types.ts';
import { getComponent, removeEntity, addComponent, spawnItem, resolveEntityDisplayName } from '../core/ecs.ts';
import {
  decomposeToCoins,
  formatCurrency,
  getEntityCurrencyBalance,
  resolveCurrencyConfig
} from './currency.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { removeActor, addActor } from '../core/scheduler.ts';
import { deleteSave } from '../core/save.ts';
import { processQuestEvent } from './quest.system.ts';
import { evaluateCheatDeath } from './nemesis.system.ts';
import { rng } from '../core/rng.ts';
import { getEntityBarks } from './nemesis.system.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';

/**
 * Helper to grant XP to an entity and handle level ups by delegating to the
 * active ruleset cartridge (`getActiveRuleset(state).grantActorXp`).
 *
 * @param state The current GameState.
 * @param entityId The recipient EntityId.
 * @param amount The XP amount to award.
 * @returns The updated GameState.
 */
export function grantXp(state: GameState, entityId: EntityId, amount: number): GameState {
  return getActiveRuleset(state).grantActorXp(state, entityId, amount);
}

/**
 * Processes all entities that have a DeathComponent.
 * Removes them from the world, emits death messages, grants XP, and handles Game Over for the player.
 */
export function processDeathSystem(state: GameState): GameState {
  let nextState = state;

  // We copy the entities array because removing entities mutates the array
  // Wait, removeEntity returns a new state object, but state.entities is iterated.
  // It's safer to iterate a copy of the entities array
  const entities = [...nextState.entities];

  for (const entityId of entities) {
    const deathComp = getComponent(nextState, entityId, ComponentType.Death) as DeathComponent | undefined;
    if (!deathComp) continue;

    const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
    const fighter = getComponent(nextState, entityId, ComponentType.Fighter);

    const name = resolveEntityDisplayName(nextState, entityId, 'Someone');

    nextState = addMessage(nextState, `${name} dies!`, MessageLogCategory.CombatDeath);

    const tagsComponent = getComponent(nextState, entityId, ComponentType.Tags) as TagsComponent | undefined;
    const tags = tagsComponent ? tagsComponent.tags : [];

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.EntityDied,
          victimId: entityId,
          ...(deathComp.killerId !== undefined ? { killerId: deathComp.killerId } : {}),
          tags
        }
      ]
    };

    if (isPlayer) {
      let causeText = 'slain';
      if (deathComp.causeOfDeath) {
        causeText = `killed by a ${deathComp.causeOfDeath}`;
      }
      nextState = addMessage(nextState, `Game Over! You have been ${causeText}.`, MessageLogCategory.CombatDeath);

      if (deathComp.killerId !== undefined) {
        const killerNemesis = getComponent(nextState, deathComp.killerId, ComponentType.Nemesis) as
          NemesisComponent | undefined;
        if (killerNemesis) {
          const barks = getEntityBarks(nextState, deathComp.killerId, 'victory_taunt');
          if (barks.length > 0) {
            const bark = rng.getItem(barks);
            if (bark) {
              const killerName = resolveEntityDisplayName(nextState, deathComp.killerId, 'Someone');
              nextState = addMessage(nextState, `${killerName} taunts: "${bark}"`, MessageLogCategory.Flavor);
            }
          }
        }
      }

      nextState = { ...nextState, isGameOver: true, uiMode: UIMode.GameOver };
      deleteSave(); // Enforce permadeath
    } else {
      // Check for cheat death before removing entity
      const cheatResult = evaluateCheatDeath(nextState, entityId, deathComp.killerId);
      if (cheatResult.shouldCheatDeath) {
        nextState = cheatResult.state;
        continue; // Entity moves to limbo; do not remove completely or drop loot yet
      }

      // If this entity was a nemesis and died permanently, clean up its hierarchy slot and record the vacancy
      const nemesis = getComponent(nextState, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
      if (nemesis) {
        const slotKey = `${nemesis.hierarchyId}:${nemesis.rankId}`;
        const nextSlots = { ...nextState.nemesisSlots };
        if (nextSlots[slotKey]) {
          nextSlots[slotKey] = nextSlots[slotKey]!.filter((id) => id !== entityId);
        }
        nextState = {
          ...nextState,
          nemesisSlots: nextSlots,
          events: [
            ...nextState.events,
            {
              type: GameEventType.NemesisVacancy,
              hierarchyId: nemesis.hierarchyId,
              rankId: nemesis.rankId,
              vacatedByEntityId: entityId
            }
          ]
        };
      }

      // Grant XP to killer if applicable (using Cartridge CR-vs-ECL hook when implemented)
      if (deathComp.killerId !== undefined) {
        const xpToGrant =
          getActiveRuleset(nextState).resolveKillXpReward?.(nextState, deathComp.killerId, entityId) ??
          fighter?.xpGiven ??
          0;
        if (xpToGrant > 0) {
          nextState = grantXp(nextState, deathComp.killerId, xpToGrant);
        }

        // Notify quest system if player killed it
        if (deathComp.killerId === state.entities.find((e) => getComponent(state, e, ComponentType.Player))) {
          const templateComp = getComponent(nextState, entityId, ComponentType.Template) as
            TemplateComponent | undefined;
          if (templateComp) {
            nextState = processQuestEvent(nextState, 'kill', templateComp.templateId, 1);
          }
        }
      }

      const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
      const deadTemplateComp = getComponent(nextState, entityId, ComponentType.Template) as
        TemplateComponent | undefined;
      const deadTemplate = deadTemplateComp ? nextState.campaign.entities[deadTemplateComp.templateId] : undefined;

      if (pos) {
        const isShopkeeper = getComponent(nextState, entityId, ComponentType.Shop) as ShopComponent | undefined;
        const deadInv = getComponent(nextState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
        const deadEquip = getComponent(nextState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

        // 1. Drop carried & equipped items (excluding ShopComponent.inventory and 'no_drop' natural armaments)
        const droppedEntityIds = new Set<EntityId>();
        const candidateIds: EntityId[] = [...(deadInv?.items ?? [])];
        if (deadEquip) {
          for (const slot of deadEquip.slots) {
            if (slot.equippedItem !== null && !candidateIds.includes(slot.equippedItem)) {
              candidateIds.push(slot.equippedItem);
            }
          }
        }

        const remainingInvIds: EntityId[] = [];
        for (const itemEntityId of candidateIds) {
          const itemTags = getComponent(nextState, itemEntityId, ComponentType.Tags) as TagsComponent | undefined;
          if (itemTags?.tags.includes('no_drop')) {
            remainingInvIds.push(itemEntityId);
            continue;
          }
          const itemComp = getComponent(nextState, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
          const itemDef = itemComp ? nextState.campaign.items[itemComp.itemId] : undefined;
          if (!itemComp || !itemDef) continue;

          nextState = addComponent(nextState, itemEntityId, { type: ComponentType.Position, x: pos.x, y: pos.y });
          droppedEntityIds.add(itemEntityId);
          nextState = addMessage(nextState, `${name} drops ${itemDef.name}.`, MessageLogCategory.CombatDeath);
        }

        if (deadInv && droppedEntityIds.size > 0) {
          nextState = addComponent(nextState, entityId, {
            ...deadInv,
            items: remainingInvIds
          });
        }

        // 2. Roll template-declared lootDrops (or fall back to global campaign lootTable)
        if (deadTemplate?.lootDrops && deadTemplate.lootDrops.length > 0) {
          for (const drop of deadTemplate.lootDrops) {
            if (!nextState.campaign.items[drop.itemId]) continue;
            if (rng.getUniform() > drop.chance) continue;
            const count =
              drop.maxCount <= drop.minCount ? drop.minCount : rng.getUniformInt(drop.minCount, drop.maxCount);
            const dropDef = nextState.campaign.items[drop.itemId]!;
            for (let i = 0; i < count; i++) {
              [nextState] = spawnItem(nextState, drop.itemId, pos.x, pos.y);
            }
            const qtyLabel = count > 1 ? `${count}x ` : '';
            nextState = addMessage(
              nextState,
              `${name} drops ${qtyLabel}${dropDef.name}.`,
              MessageLogCategory.CombatDeath
            );
          }
        } else {
          const lootTable = nextState.campaign.rules.spawning.lootTable;
          const lootDropChance = nextState.campaign.rules.spawning.lootDropChance;
          if (Object.keys(lootTable).length > 0 && rng.getUniform() < lootDropChance) {
            const itemId = rng.getWeightedValue(lootTable as Record<string, number>);
            if (itemId && nextState.campaign.items[itemId]) {
              const itemDef = nextState.campaign.items[itemId]!;
              [nextState] = spawnItem(nextState, itemId, pos.x, pos.y);
              nextState = addMessage(nextState, `${name} drops ${itemDef.name}.`, MessageLogCategory.CombatDeath);
            }
          }
        }

        // 3. Roll template currencyDrop or drop carried non-shop wallet balance
        const currencyCfg = resolveCurrencyConfig(nextState);
        const dropCurrencyBucket = (denominationId: string, amount: number): void => {
          if (amount <= 0) return;
          const matchingCoinDef =
            Object.values(nextState.campaign.items).find(
              (def) => def.currencyGrant?.denominationId === denominationId && def.currencyGrant.amount === 1
            ) ??
            Object.values(nextState.campaign.items).find((def) => def.currencyGrant?.denominationId === denominationId);
          if (!matchingCoinDef) return;
          const [afterSpawn, coinEntityId] = spawnItem(nextState, matchingCoinDef.id, pos.x, pos.y);
          nextState = afterSpawn;
          const coinComp = getComponent(nextState, coinEntityId, ComponentType.Item) as ItemComponent | undefined;
          if (coinComp) {
            const denomUnitAmount = Math.max(1, matchingCoinDef.currencyGrant?.amount ?? 1);
            const charges = Math.max(1, Math.round(amount / denomUnitAmount));
            nextState = addComponent(nextState, coinEntityId, { ...coinComp, charges });
          }
          nextState = addMessage(
            nextState,
            `${name} drops ${amount} ${denominationId}.`,
            MessageLogCategory.CombatDeath
          );
        };

        if (deadTemplate?.currencyDrop && rng.getUniform() <= deadTemplate.currencyDrop.chance) {
          const { denominationId, minAmount, maxAmount } = deadTemplate.currencyDrop;
          const rolled = maxAmount <= minAmount ? minAmount : rng.getUniformInt(minAmount, maxAmount);
          dropCurrencyBucket(denominationId, rolled);
        }

        if (!isShopkeeper) {
          const carriedBalance = getEntityCurrencyBalance(nextState, entityId);
          if (carriedBalance > 0) {
            const buckets = decomposeToCoins(carriedBalance, currencyCfg);
            let droppedAny = false;
            for (const bucket of buckets) {
              if (bucket.amount > 0) {
                dropCurrencyBucket(bucket.id, bucket.amount);
                droppedAny = true;
              }
            }
            if (!droppedAny) {
              nextState = addMessage(
                nextState,
                `${name} carried ${formatCurrency(carriedBalance, currencyCfg)}.`,
                MessageLogCategory.CombatDeath
              );
            }
          }
        }
      }

      // Emit SchemeNodeDisrupted if the dead entity was a minion
      const agreement = getComponent(nextState, entityId, ComponentType.Agreement) as AgreementComponent | undefined;
      if (agreement) {
        const mastermindId = agreement.mastermindId;
        const mastermindScheme = getComponent(nextState, mastermindId, ComponentType.Scheme) as
          SchemeComponent | undefined;
        const recipeId = mastermindScheme ? mastermindScheme.recipeId : '';
        nextState = {
          ...nextState,
          events: [
            ...nextState.events,
            {
              type: GameEventType.SchemeNodeDisrupted,
              schemeId: recipeId,
              mastermindId,
              minionId: entityId
            } as GameEvent
          ]
        };
      }

      // Intercept mastermind death to transfer Scheme to a minion (leaderless state)
      const schemeComp = getComponent(nextState, entityId, ComponentType.Scheme) as SchemeComponent | undefined;
      if (schemeComp && schemeComp.activeMinions.length > 0) {
        const newLeaderId = schemeComp.activeMinions[0]!;
        const updatedScheme: SchemeComponent = {
          ...schemeComp,
          isLeaderless: true,
          activeMinions: schemeComp.activeMinions.filter((id) => id !== newLeaderId)
        };
        nextState = addComponent(nextState, newLeaderId, updatedScheme);
        nextState = addComponent(nextState, newLeaderId, { type: ComponentType.Actor, speed: 100 });
        addActor(newLeaderId);

        const mastermindName = resolveEntityDisplayName(nextState, entityId, `Mastermind #${entityId}`);
        const newLeaderName = resolveEntityDisplayName(nextState, newLeaderId, `Minion #${newLeaderId}`);
        nextState = addMessage(
          nextState,
          `[DEBUG] Mastermind ${mastermindName} died! Transferring scheme ${schemeComp.recipeId} to minion ${newLeaderName} (leaderless state).`,
          MessageLogCategory.System
        );
      }

      // Strip the dead entity from the world
      nextState = removeEntity(nextState, entityId);
      removeActor(entityId);
    }
  }

  return nextState;
}
