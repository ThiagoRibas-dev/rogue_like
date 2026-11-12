import {
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type ActorComponent,
  type FighterComponent,
  type AIComponent,
  type PlayerComponent,
  type InventoryComponent,
  type QuestLogComponent,
  type LockComponent,
  type InteractableComponent,
  type ShopComponent
} from '../../types/components.types.ts';
import { type EntityId, type GameState, toEntityId } from '../../types/game-state.types.ts';
import { IntentType } from '../../types/intents/intent.enum.ts';
import type { StartDialogueIntent } from '../../types/intents/ui.intents.ts';
import type { Intent } from '../../types/intents/intent.union.ts';
import { rollFacetValue, rollPersonalityValue } from '../rng.ts';
import { addComponent, createEntity, getComponent, removeComponent } from './ecs_core.ts';
import { spawnItem, promoteEntity } from './ecs_item_promoter.ts';
import { equipActorDefaultArmaments, initializeActorEquipmentAndInventory } from './ecs_spawner_equipment.ts';

export { spawnItem, promoteEntity };

/**
 * Spawns an entity from a template at the given coordinates.
 * @param state The current game state.
 * @param templateId The ID of the template from ENTITY_TEMPLATES.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @param dynamicTraits Optional additional traits to apply to the entity at spawn.
 * @param staticInventory Optional array of item IDs to place into the entity's inventory.
 * @returns A tuple of the updated state and the new EntityId.
 */
export function spawnEntity(
  state: GameState,
  templateId: string,
  x: number,
  y: number,
  dynamicTraits?: ReadonlyArray<string>,
  staticInventory?: ReadonlyArray<string>
): [GameState, EntityId] {
  const template = state.campaign.entities[templateId];
  if (!template) throw new Error(`Unknown entity template: ${templateId}`);

  const [stateAfterCreate, entityId] = createEntity(state);
  let nextState = stateAfterCreate;

  const pos: PositionComponent = { type: ComponentType.Position, x, y };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: template.glyph,
    fg: template.fg,
    bg: template.bg,
    ...(template.spriteId !== undefined ? { spriteId: template.spriteId } : {})
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, { type: ComponentType.Template, templateId });

  if (template.renderable !== false) {
    nextState = addComponent(nextState, entityId, render);
  }

  if (template.trap) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Trap,
      triggerId: template.trap.triggerId,
      triggered: false
    });
  }

  if (template.isActor) {
    const actor: ActorComponent = { type: ComponentType.Actor, speed: template.speed ?? 100 };
    nextState = addComponent(nextState, entityId, actor);
  }

  if (template.fighter) {
    const fighter: FighterComponent = {
      type: ComponentType.Fighter,
      maxHp: template.fighter.maxHp,
      hp: template.fighter.maxHp,
      attack: template.fighter.attack,
      defense: template.fighter.defense,
      xp: 0,
      level: 1,
      xpGiven: template.fighter.xpGiven ?? 0
    };
    nextState = addComponent(nextState, entityId, fighter);
  }

  if (template.ai) {
    const ai: AIComponent = {
      type: ComponentType.AI,
      profileId: template.ai.profileId,
      ...(template.ai.aggroRadius !== undefined ? { aggroRadius: template.ai.aggroRadius } : {}),
      ...(template.ai.wanders !== undefined ? { wanders: template.ai.wanders } : {})
    };
    nextState = addComponent(nextState, entityId, ai);
  }

  if (template.faction) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Faction,
      factionId: template.faction
    });
  }

  if (template.tags && template.tags.length > 0) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Tags,
      tags: template.tags
    });
  }

  const combinedTraits = [...(template.traits ?? []), ...(dynamicTraits ?? [])];
  if (combinedTraits.length > 0) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Traits,
      traits: combinedTraits
    });
  }

  nextState = initializeActorEquipmentAndInventory(nextState, entityId, templateId, template);

  if (template.persistent) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Persistent
    });
  }

  if (template.memory) {
    let facets = template.memory.facets ? { ...template.memory.facets } : undefined;
    let values = template.memory.values ? { ...template.memory.values } : undefined;

    if (!facets || !values) {
      const firstKey = Object.keys(state.campaign.personalityGeneration)[0];
      const table = firstKey ? state.campaign.personalityGeneration[firstKey] : undefined;
      if (!facets && table && table.facets.length > 0) {
        facets = {};
        for (const f of table.facets) facets[f] = rollFacetValue();
      }
      if (!values && table && table.values.length > 0) {
        values = {};
        for (const v of table.values) values[v] = rollPersonalityValue();
      }
    }

    const patienceFacet = facets ? (facets['patience'] ?? 50) : 50;
    const derivedThreshold = Math.floor(patienceFacet / 20) + 2;

    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Memory,
      factionStandings: template.memory.factionStandings ?? {},
      grudges: template.memory.grudges ?? [],
      facts: template.memory.facts ?? [],
      facets,
      values,
      stress: template.memory.stress ?? 0,
      thoughts: template.memory.thoughts
        ? template.memory.thoughts.map((t) => ({
            ...t,
            relatedEntityId: t.relatedEntityId !== undefined ? toEntityId(t.relatedEntityId) : undefined
          }))
        : [],
      knowledge: template.memory.knowledge ?? {},
      timesTalked: template.memory.timesTalked ?? 0,
      timesTraded: template.memory.timesTraded ?? 0,
      timesIntimidated: template.memory.timesIntimidated ?? 0,
      timesHelped: template.memory.timesHelped ?? 0,
      timesBetrayed: template.memory.timesBetrayed ?? 0,
      patienceThreshold: template.memory.patienceThreshold ?? derivedThreshold,
      annoyedDuration: template.memory.annoyedDuration ?? 0,
      gratefulDuration: template.memory.gratefulDuration ?? 0,
      deflectionLines: template.memory.deflectionLines
    });
  }

  if (template.dialogueId) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Dialogue,
      dialogueId: template.dialogueId
    });
  }

  if (template.attitude) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Attitude,
      attitude: template.attitude
    });
  }

  if (template.lock) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Lock,
      difficulty: template.lock.difficulty,
      keyTag: template.lock.keyTag,
      locked: template.lock.locked,
      jammed: template.lock.jammed,
      breakable: template.lock.breakable
    } as LockComponent);

    const interactable = getComponent(nextState, entityId, ComponentType.Interactable) as
      InteractableComponent | undefined;
    const intents = interactable ? [...interactable.intents] : [];

    intents.push({
      type: IntentType.Apply,
      entityId: -1 as unknown as EntityId,
      verb: template.lock.locked ? 'unlock' : 'open',
      target: { type: 'self' } as const
    } as Intent);

    if (template.lock.breakable) {
      intents.push({
        type: IntentType.Apply,
        entityId: -1 as unknown as EntityId,
        verb: 'kick',
        target: { type: 'self' } as const
      } as Intent);
    }

    if (interactable) {
      nextState = addComponent(nextState, entityId, { ...interactable, intents });
    } else {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Interactable,
        intents
      });
    }
  }

  if (template.dialogueId) {
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Interactable,
      intents: [
        {
          type: IntentType.StartDialogue,
          entityId: -1 as unknown as EntityId,
          targetId: entityId,
          dialogueId: template.dialogueId
        } as StartDialogueIntent
      ]
    });
  }

  if (template.shop) {
    const shopInventoryIds: EntityId[] = [];
    if (template.shop.inventory) {
      for (const itemId of template.shop.inventory) {
        if (state.campaign.items[itemId]) {
          let itemEntityId: EntityId;
          [nextState, itemEntityId] = spawnItem(nextState, itemId, x, y);
          nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
          shopInventoryIds.push(itemEntityId);
        }
      }
    }
    const shopCmp: ShopComponent = {
      type: ComponentType.Shop,
      inventory: shopInventoryIds,
      markupMultiplier: template.shop.markupMultiplier,
      buyTags: template.shop.buyTags,
      sellTags: template.shop.sellTags,
      supplierHierarchyId: template.shop.supplierHierarchyId
    };
    nextState = addComponent(nextState, entityId, shopCmp);
  }

  if (templateId === 'player') {
    const player: PlayerComponent = { type: ComponentType.Player };
    nextState = addComponent(nextState, entityId, player);
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Hunger,
      satiation: 1000
    });

    if (!template.memory) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Memory,
        factionStandings: {},
        grudges: [],
        facts: [],
        knowledge: {}
      });
    }

    const questLog: QuestLogComponent = {
      type: ComponentType.QuestLog,
      quests: {}
    };
    nextState = addComponent(nextState, entityId, questLog);
  }

  if (staticInventory && staticInventory.length > 0) {
    const inventory = getComponent(nextState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
    if (!inventory) {
      console.warn(`Entity template ${templateId} does not have an InventoryComponent, ignoring static inventory.`);
    } else {
      const itemEntityIds: EntityId[] = [];
      for (const itemId of staticInventory) {
        if (state.campaign.items[itemId]) {
          let itemEntityId: EntityId;
          [nextState, itemEntityId] = spawnItem(nextState, itemId, x, y);
          nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
          itemEntityIds.push(itemEntityId);
        } else {
          console.warn(`Static inventory item ${itemId} not found in items registry.`);
        }
      }
      if (itemEntityIds.length > 0) {
        nextState = addComponent(nextState, entityId, {
          ...inventory,
          items: [...inventory.items, ...itemEntityIds]
        });
      }
    }
  }

  nextState = equipActorDefaultArmaments(nextState, entityId, templateId, x, y);

  return [nextState, entityId];
}
