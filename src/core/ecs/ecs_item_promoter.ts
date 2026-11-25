import {
  ComponentType,
  type PositionComponent,
  type RenderableComponent,
  type ItemComponent,
  type ChronicleComponent,
  type IdentityComponent,
  toItemInstanceId
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { rng } from '../rng.ts';
import { addComponent, createEntity, getComponent } from './ecs_core.ts';

/**
 * Spawns an item entity on the map from an ITEM_REGISTRY definition.
 * Creates the entity with Position, Renderable, and Item components.
 * @param state The current game state.
 * @param itemId The ID of the item definition in ITEM_REGISTRY.
 * @param x The map X coordinate.
 * @param y The map Y coordinate.
 * @param z The map Z coordinate (defaults to 0).
 * @returns A tuple of the updated state and the new EntityId.
 */
export function spawnItem(state: GameState, itemId: string, x: number, y: number, z = 0): [GameState, EntityId] {
  const def = state.campaign.items[itemId];
  if (!def) throw new Error(`Unknown item ID: ${itemId}`);

  const [stateAfterCreate, entityId] = createEntity(state);
  let nextState = stateAfterCreate;

  const pos: PositionComponent = { type: ComponentType.Position, x, y, ...(z !== 0 ? { z } : {}) };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: def.glyph,
    fg: def.fg,
    bg: def.bg,
    ...(def.spriteId !== undefined ? { spriteId: def.spriteId } : {})
  };
  const instanceId = toItemInstanceId(`${itemId}_${nextState.nextItemInstanceId}`);
  const initialCharges =
    def.consumable?.charges ?? def.zappable?.charges ?? def.zappable?.currentCharges ?? def.zappable?.maxCharges;
  const item: ItemComponent = {
    type: ComponentType.Item,
    itemId: def.id,
    instanceId,
    ...(initialCharges !== undefined ? { charges: initialCharges } : {})
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);
  nextState = addComponent(nextState, entityId, item);
  nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

  if (def.structural) {
    const s = def.structural;
    const defaultHardnessByMaterial: Readonly<Record<string, number>> = {
      paper: 0,
      cloth: 0,
      rope: 0,
      glass: 1,
      ice: 0,
      leather: 2,
      hide: 2,
      wood: 5,
      darkwood: 5,
      stone: 8,
      iron: 10,
      steel: 10,
      cold_iron: 10,
      alchemical_silver: 8,
      silver: 8,
      mithral: 15,
      adamantine: 20
    };
    const defaultHpPerInchByMaterial: Readonly<Record<string, number>> = {
      paper: 2,
      cloth: 2,
      rope: 2,
      glass: 1,
      ice: 3,
      leather: 5,
      hide: 5,
      wood: 10,
      darkwood: 10,
      stone: 15,
      iron: 30,
      steel: 30,
      cold_iron: 30,
      alchemical_silver: 10,
      silver: 10,
      mithral: 30,
      adamantine: 40
    };
    const computedMaxHp =
      s.maxHp ?? Math.max(1, Math.round(s.thicknessInches * (defaultHpPerInchByMaterial[s.materialId] ?? 10)));
    const computedHp = s.isRuined === true ? 0 : (s.hp ?? computedMaxHp);
    const computedHardness = s.hardnessOverride ?? defaultHardnessByMaterial[s.materialId] ?? 5;
    const magicProps = def.magicalProperties as { readonly enhancementBonus?: number | undefined } | undefined;
    nextState = addComponent(nextState, entityId, {
      type: ComponentType.Structural,
      materialTag: s.materialId,
      hardness: computedHardness,
      hp: computedHp,
      maxHp: computedMaxHp,
      breakDc: s.breakDc ?? 15,
      objectSize: 'medium',
      ...(magicProps?.enhancementBonus !== undefined ? { enhancementBonus: magicProps.enhancementBonus } : {}),
      ...(s.isDoor !== undefined ? { isDoor: s.isDoor } : {}),
      ...(s.isOpen !== undefined ? { isOpen: s.isOpen } : {}),
      ...(s.isStuck !== undefined ? { jammed: s.isStuck } : {}),
      ...(s.isRuined === true || computedHp === 0 ? { ruined: true } : {})
    });
  }

  if (def.isArtifact) {
    nextState = promoteEntity(nextState, entityId);
  }

  return [nextState, entityId];
}

/**
 * Promotes a generic entity to a named, persistent entity.
 * Generates an identity, creates a chronicle, and marks them persistent.
 *
 * @param state The current game state.
 * @param entityId The ID of the entity to promote.
 * @returns The updated game state.
 */
export function promoteEntity(state: GameState, entityId: EntityId): GameState {
  if (getComponent(state, entityId, ComponentType.Chronicle)) {
    return state;
  }

  let nextState = state;
  const templateCmp = getComponent(state, entityId, ComponentType.Template);
  const templateId = templateCmp ? templateCmp.templateId : 'orc';

  const identityKey = `${templateId}_identity`;
  let table = state.campaign.identityGeneration[identityKey];
  if (!table) {
    const keys = Object.keys(state.campaign.identityGeneration);
    if (keys.length > 0) {
      table = state.campaign.identityGeneration[keys[0]!]!;
    }
  }

  const name = table && table.firstNames.length > 0 ? (rng.getItem(table.firstNames) ?? 'Gruk') : 'Gruk';
  const title = table && table.titles.length > 0 ? (rng.getItem(table.titles) ?? 'the Unknown') : 'the Unknown';
  const mannerism =
    table && table.mannerisms.length > 0 ? (rng.getItem(table.mannerisms) ?? 'stares blankly') : 'stares blankly';
  const color = table && table.colors && table.colors.length > 0 ? rng.getItem(table.colors) : undefined;

  const identity: IdentityComponent = {
    type: ComponentType.Identity,
    name,
    title,
    mannerisms: [mannerism],
    colorOverride: color ?? undefined
  };

  nextState = addComponent(nextState, entityId, identity);

  const chronicle: ChronicleComponent = {
    type: ComponentType.Chronicle,
    pis: 1,
    scars: [],
    coreMemories: [],
    eventExcerpts: []
  };

  nextState = addComponent(nextState, entityId, chronicle);
  nextState = addComponent(nextState, entityId, { type: ComponentType.Persistent });

  return nextState;
}
