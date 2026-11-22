import { addComponent, createEntity, getComponent, removeEntity, resolveEntityDisplayName } from '../core/ecs.ts';
import {
  ComponentType,
  type CorpseComponent,
  type InventoryComponent,
  type PositionComponent,
  type RulesetDataComponent,
  type TagsComponent,
  type TemplateComponent,
  toItemInstanceId
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';

/** Default number of global turns before a dropped physical corpse rots away (`300` turns = 30 minutes). */
export const DEFAULT_CORPSE_DECAY_TURNS = 300;

/** Canonical harvestable corpse tags (`pelt`, `venom_gland`, `reagent`, `bounty_trophy`, `zombie_husk`). */
export type HarvestableCorpseTag = 'pelt' | 'venom_gland' | 'reagent' | 'bounty_trophy' | 'zombie_husk';

/** Creature tags that leave no corporeal corpse behind (e.g. incorporeal or elemental energy dissipation). */
const INCORPOREAL_TAGS: ReadonlySet<string> = new Set([
  'incorporeal',
  'no_corpse',
  'summoned',
  'elemental',
  'type:elemental',
  'subtype:incorporeal'
]);

/**
 * Derives the harvestable tags for a slain creature based on its declarative tags and creature type.
 *
 * @param state Current GameState.
 * @param victimId Slain entity ID.
 * @returns Array of harvestable tag strings.
 */
export function deriveHarvestableCorpseTags(state: Readonly<GameState>, victimId: EntityId): ReadonlyArray<string> {
  const tagsComp = getComponent(state, victimId, ComponentType.Tags) as TagsComponent | undefined;
  const tags = tagsComp?.tags ?? [];
  const rulesetComp = getComponent(state, victimId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  const creatureType =
    typeof rulesetComp?.payload?.['creatureType'] === 'string'
      ? (rulesetComp.payload['creatureType'] as string)
      : undefined;

  const harvestable = new Set<string>(['bounty_trophy']);
  if (creatureType !== 'undead' && creatureType !== 'construct' && creatureType !== 'elemental') {
    harvestable.add('zombie_husk');
  }
  if (creatureType === 'animal' || creatureType === 'magical_beast' || tags.includes('furred')) {
    harvestable.add('pelt');
  }
  if (creatureType === 'vermin' || tags.includes('poisonous') || tags.includes('venomous')) {
    harvestable.add('venom_gland');
  }
  if (
    creatureType === 'aberration' ||
    creatureType === 'dragon' ||
    creatureType === 'outsider' ||
    creatureType === 'fey'
  ) {
    harvestable.add('reagent');
  }
  return Array.from(harvestable);
}

/**
 * Spawns a world-owned decaying corpse entity carrying `ComponentType.Corpse` at `(x, y)` when
 * a corporeal creature (`victimId`) dies.
 *
 * @param state Current immutable GameState.
 * @param victimId Slain entity ID.
 * @param x Death tile X coordinate.
 * @param y Death tile Y coordinate.
 * @param decayTurns Optional custom decay duration in turns (defaults to `DEFAULT_CORPSE_DECAY_TURNS`).
 * @returns Updated GameState and optional spawned `corpseEntityId`.
 */
export function spawnCorpseForSlainEntity(
  state: GameState,
  victimId: EntityId,
  x: number,
  y: number,
  decayTurns = DEFAULT_CORPSE_DECAY_TURNS
): { readonly state: GameState; readonly corpseEntityId?: EntityId | undefined } {
  const tagsComp = getComponent(state, victimId, ComponentType.Tags) as TagsComponent | undefined;
  if (tagsComp?.tags.some((t) => INCORPOREAL_TAGS.has(t))) {
    return { state };
  }

  const rulesetComp = getComponent(state, victimId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  const creatureType =
    typeof rulesetComp?.payload?.['creatureType'] === 'string'
      ? (rulesetComp.payload['creatureType'] as string)
      : undefined;
  const subtypes = Array.isArray(rulesetComp?.payload?.['subtypes'])
    ? (rulesetComp.payload['subtypes'] as ReadonlyArray<unknown>).filter((s): s is string => typeof s === 'string')
    : [];
  if (creatureType === 'elemental' || subtypes.includes('incorporeal') || subtypes.includes('elemental')) {
    return { state };
  }

  const templateComp = getComponent(state, victimId, ComponentType.Template) as TemplateComponent | undefined;
  const sourceTemplateId = templateComp?.templateId ?? 'unknown_creature';
  const creatureName = resolveEntityDisplayName(state, victimId, sourceTemplateId);

  const harvestableTags = deriveHarvestableCorpseTags(state, victimId);

  const [afterCreate, corpseId] = createEntity(state);
  let nextState = afterCreate;

  nextState = addComponent(nextState, corpseId, {
    type: ComponentType.Position,
    x,
    y,
    canShareTile: true
  });

  nextState = addComponent(nextState, corpseId, {
    type: ComponentType.Renderable,
    glyph: '%',
    fg: '#7f8c8d',
    bg: 'transparent'
  });

  const corpseComp: CorpseComponent = {
    type: ComponentType.Corpse,
    sourceTemplateId,
    creatureName,
    ...(creatureType !== undefined ? { creatureType } : {}),
    decayTurn: nextState.globalTurn + Math.max(1, decayTurns),
    harvestableTags,
    harvestedTags: []
  };
  nextState = addComponent(nextState, corpseId, corpseComp);
  nextState = addComponent(nextState, corpseId, {
    type: ComponentType.Tags,
    tags: ['corpse', ...harvestableTags.map((t) => `harvest:${t}`)]
  });

  return { state: nextState, corpseEntityId: corpseId };
}

/**
 * Returns `true` when `corpseEntityId` is a corpse entity with at least one unharvested yield tag
 * (excluding internal necromancy `'zombie_husk'` unless it is the only remaining tag).
 */
export function canHarvestCorpseEntity(state: Readonly<GameState>, corpseEntityId: EntityId): boolean {
  const corpse = getComponent(state, corpseEntityId, ComponentType.Corpse) as CorpseComponent | undefined;
  if (!corpse) return false;
  const harvested = corpse.harvestedTags ?? [];
  return corpse.harvestableTags.some((tag) => tag !== 'zombie_husk' && !harvested.includes(tag));
}

function spawnHarvestYieldItemForActor(
  state: GameState,
  actorId: EntityId,
  corpse: CorpseComponent,
  tagToHarvest: string
): GameState {
  const [afterCreate, itemId] = createEntity(state);
  let nextState = afterCreate;
  const matchedTemplate = Object.values(nextState.campaign.items).find((itemDef) =>
    (itemDef.tags ?? []).includes(`harvest_yield:${tagToHarvest}`)
  );
  const itemTemplateId = matchedTemplate?.id ?? `harvested_${tagToHarvest}`;

  nextState = addComponent(nextState, itemId, {
    type: ComponentType.Item,
    itemId: itemTemplateId,
    instanceId: toItemInstanceId(`${itemTemplateId}_${itemId}`)
  });
  nextState = addComponent(nextState, itemId, {
    type: ComponentType.Renderable,
    glyph: matchedTemplate?.glyph ?? ',',
    fg: matchedTemplate?.fg ?? '#d35400',
    bg: 'transparent'
  });
  nextState = addComponent(nextState, itemId, {
    type: ComponentType.Tags,
    tags: ['harvest_yield', tagToHarvest, `source:${corpse.sourceTemplateId}`]
  });

  const inv = getComponent(nextState, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inv && inv.items.length < inv.baseCapacity) {
    nextState = addComponent(nextState, actorId, {
      ...inv,
      items: [...inv.items, itemId]
    });
  } else {
    const actorPos = getComponent(nextState, actorId, ComponentType.Position) as PositionComponent | undefined;
    if (actorPos) {
      nextState = addComponent(nextState, itemId, {
        type: ComponentType.Position,
        x: actorPos.x,
        y: actorPos.y,
        canShareTile: true
      });
    }
  }
  return nextState;
}

/**
 * Harvests a specific `tagToHarvest` (`'pelt' | 'venom_gland' | 'reagent' | 'bounty_trophy' | 'zombie_husk'`)
 * from a corpse entity (`corpseEntityId`). Consuming `'zombie_husk'` or burning the corpse destroys the husk.
 *
 * @param state Current immutable GameState.
 * @param actorId Actor harvesting or consuming the corpse.
 * @param corpseEntityId Target entity carrying `ComponentType.Corpse`.
 * @param tagToHarvest Tag to extract from `corpse.harvestableTags`.
 * @returns `{ state, success }`.
 */
export function harvestCorpseTag(
  state: GameState,
  actorId: EntityId,
  corpseEntityId: EntityId,
  tagToHarvest: string
): { readonly state: GameState; readonly success: boolean } {
  const corpse = getComponent(state, corpseEntityId, ComponentType.Corpse) as CorpseComponent | undefined;
  if (!corpse) {
    return {
      state: addMessage(state, 'There is no harvestable corpse there.', MessageLogCategory.System),
      success: false
    };
  }

  const alreadyHarvested = corpse.harvestedTags ?? [];
  if (!corpse.harvestableTags.includes(tagToHarvest) || alreadyHarvested.includes(tagToHarvest)) {
    return {
      state: addMessage(
        state,
        `Nothing of type "${tagToHarvest}" remains to be harvested from the ${corpse.creatureName} corpse.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  const actorName = resolveEntityDisplayName(state, actorId, 'Someone');
  let nextState = state;

  if (tagToHarvest === 'zombie_husk') {
    nextState = removeEntity(nextState, corpseEntityId);
    nextState = addMessage(
      nextState,
      `${actorName} consumes the ${corpse.creatureName} corpse husk.`,
      MessageLogCategory.System
    );
    return { state: nextState, success: true };
  }

  const nextHarvested = [...alreadyHarvested, tagToHarvest];
  nextState = addComponent(nextState, corpseEntityId, {
    ...corpse,
    harvestedTags: nextHarvested
  });
  nextState = spawnHarvestYieldItemForActor(nextState, actorId, corpse, tagToHarvest);
  nextState = addMessage(
    nextState,
    `${actorName} harvests ${tagToHarvest.replace(/_/g, ' ')} from the ${corpse.creatureName} corpse.`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true };
}

/**
 * Harvests the next available non-husk yield tag (`pelt`, `venom_gland`, `reagent`, `bounty_trophy`)
 * from `corpseEntityId` via the `'harvest'` interaction verb.
 */
export function harvestCorpseEntity(
  state: GameState,
  actorId: EntityId,
  corpseEntityId: EntityId
): { readonly state: GameState; readonly success: boolean } {
  const corpse = getComponent(state, corpseEntityId, ComponentType.Corpse) as CorpseComponent | undefined;
  if (!corpse) {
    return {
      state: addMessage(state, 'There is no harvestable corpse there.', MessageLogCategory.System),
      success: false
    };
  }
  const harvested = corpse.harvestedTags ?? [];
  const preferredOrder: ReadonlyArray<string> = ['pelt', 'venom_gland', 'reagent', 'bounty_trophy'];
  const nextTag =
    preferredOrder.find((tag) => corpse.harvestableTags.includes(tag) && !harvested.includes(tag)) ??
    corpse.harvestableTags.find((tag) => tag !== 'zombie_husk' && !harvested.includes(tag));
  if (!nextTag) {
    return {
      state: addMessage(
        state,
        `Nothing usable remains on the ${corpse.creatureName} corpse.`,
        MessageLogCategory.System
      ),
      success: false
    };
  }
  return harvestCorpseTag(state, actorId, corpseEntityId, nextTag);
}

/**
 * Ticks corpse decay across the active map and removes any corpses whose `decayTurn <= state.globalTurn`
 * or that occupy an active `'fire'` hazard field (fire denial preventing necromancy/revival).
 *
 * @param state Current immutable GameState.
 * @returns Updated GameState.
 */
export function tickCorpseDecay(state: GameState): GameState {
  let nextState = state;
  const entitiesSnapshot = [...nextState.entities];

  for (const entityId of entitiesSnapshot) {
    const corpse = getComponent(nextState, entityId, ComponentType.Corpse) as CorpseComponent | undefined;
    if (!corpse) continue;

    if (nextState.globalTurn >= corpse.decayTurn) {
      nextState = removeEntity(nextState, entityId);
      continue;
    }

    const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (pos) {
      const tileEntities = nextState.spatialIndex.get(`${pos.x},${pos.y}`) ?? [];
      const hasFireOnTile = tileEntities.some((eid) => {
        const field = getComponent(nextState, eid, ComponentType.Field);
        return field !== undefined && 'fieldType' in field && field.fieldType.includes('fire');
      });
      if (hasFireOnTile) {
        nextState = removeEntity(nextState, entityId);
      }
    }
  }

  return nextState;
}
