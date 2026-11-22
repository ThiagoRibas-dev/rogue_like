import { addComponent, createEntity, getComponent, removeEntity } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import type { FieldDefinition, FieldInteractionRule } from '../types/campaign/world.ts';
import {
  ComponentType,
  type DamageComponent,
  type FieldComponent,
  type FighterComponent,
  type InteractionChain,
  type PositionComponent,
  type RenderableComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import { coordToIndex, isInBounds } from '../utils/grid.ts';
import { destroyCrossingEntity, queryCrossingAtPosition, spawnCrossingEntity } from './crossing.system.ts';
import { appendInteractionFrame } from './interaction_provenance.system.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { applyStatusEffect } from './status-effect.system.ts';

/** Maximum BFS radius for orthogonal chain reactions (`32` tiles) to prevent runaway map loops. */
const MAX_FIELD_CHAIN_BFS_TILES = 32;

/** Default duration for transmuted fields (`5` turns). */
const DEFAULT_TRANSMUTED_FIELD_DURATION = 5;

/** Default duration for frozen ice crossings (`10` turns). */
const DEFAULT_FROZEN_CROSSING_DURATION = 10;

/** Canonical baseline field interaction rules applied when `rules.fieldInteractions` is not overridden. */
export const DEFAULT_FIELD_INTERACTION_RULES: ReadonlyArray<FieldInteractionRule> = [
  {
    id: 'oil_fire_ignition',
    incomingTags: ['fire'],
    targetTags: ['oil', 'flammable'],
    spawnFieldType: 'fire',
    spawnFieldDuration: 5,
    spawnFieldIntensity: 2,
    extinguishTarget: true,
    chainSpreadOrthogonal: true,
    message: 'The flammable oil ignites in a flash of fire!'
  },
  {
    id: 'water_cold_freeze',
    incomingTags: ['cold', 'ice'],
    targetTags: ['water', 'liquid', 'deep_water', 'shallow_water'],
    spawnCrossingKind: 'frozen_surface',
    spawnCrossingDuration: DEFAULT_FROZEN_CROSSING_DURATION,
    message: 'Bitter cold freezes the water into a solid ice sheet!'
  },
  {
    id: 'ice_fire_melt',
    incomingTags: ['fire'],
    targetTags: ['frozen_surface', 'ice'],
    extinguishTarget: true,
    message: 'Intense heat melts the frozen ice sheet!'
  },
  {
    id: 'water_electricity_shock',
    incomingTags: ['electricity', 'lightning'],
    targetTags: ['water', 'liquid', 'deep_water', 'shallow_water'],
    chainSpreadOrthogonal: true,
    shockDamageDice: '2d6',
    message: 'Electricity arcs violently across the conductive water!'
  },
  {
    id: 'fire_water_steam',
    incomingTags: ['water', 'liquid'],
    targetTags: ['fire'],
    spawnFieldType: 'steam_cloud',
    spawnFieldDuration: 4,
    spawnFieldIntensity: 1,
    extinguishTarget: true,
    message: 'Water douses the flames in a dense cloud of scalding steam!'
  }
];

function parseSimpleDiceTotal(diceExpr: string): number {
  const match = /^(\d+)d(\d+)(?:([+-]\d+))?$/i.exec(diceExpr.trim());
  if (!match) return 4;
  const count = Number(match[1]);
  const sides = Number(match[2]);
  const flat = match[3] ? Number(match[3]) : 0;
  let total = flat;
  for (let i = 0; i < count; i++) {
    total += Math.floor(rng.getUniform() * sides) + 1;
  }
  return Math.max(1, total);
}

function ensureFieldDefinitionExists(state: GameState, fieldType: string): GameState {
  if (state.campaign.fields[fieldType]) return state;
  const fallbackDef: FieldDefinition =
    fieldType === 'steam_cloud' || fieldType === 'smoke'
      ? {
          id: fieldType,
          name: fieldType === 'steam_cloud' ? 'Steam Cloud' : 'Smoke Cloud',
          glyph: '8',
          fg: '#ecf0f1',
          bg: '#7f8c8d',
          blocksSight: true,
          tags: [fieldType, 'obscurement', 'vapor']
        }
      : fieldType === 'oil'
        ? {
            id: 'oil',
            name: 'Oil Slick',
            glyph: '~',
            fg: '#d35400',
            bg: 'transparent',
            blocksSight: false,
            tags: ['oil', 'flammable', 'liquid']
          }
        : {
            id: fieldType,
            name: fieldType.replace(/_/g, ' '),
            glyph: '^',
            fg: '#e74c3c',
            bg: 'transparent',
            blocksSight: false,
            damagePerTurn: fieldType === 'fire' ? 4 : 0,
            tags: [fieldType]
          };
  return {
    ...state,
    campaign: {
      ...state.campaign,
      fields: {
        ...state.campaign.fields,
        [fieldType]: fallbackDef
      }
    }
  };
}

function collectTargetTagsAtTile(
  state: GameState,
  x: number,
  y: number
): {
  readonly tags: ReadonlySet<string>;
  readonly matchingFieldEntityIds: ReadonlyArray<EntityId>;
  readonly frozenCrossingEntityId: EntityId | undefined;
} {
  const tags = new Set<string>();
  const matchingFieldEntityIds: EntityId[] = [];
  let frozenCrossingEntityId: EntityId | undefined;

  if (isInBounds(x, y, state.map.width, state.map.height)) {
    const tile = state.map.tiles[coordToIndex(x, y, state.map.width)];
    const tileDef = tile ? state.campaign.tiles[tile.tileId] : undefined;
    if (tileDef) {
      for (const t of tileDef.tags ?? []) tags.add(t);
      if (tileDef.hazardKind) tags.add(tileDef.hazardKind);
    }
  }

  const crossing = queryCrossingAtPosition(state, x, y);
  if (crossing) {
    tags.add(crossing.crossing.crossingKind);
    if (crossing.crossing.crossingKind === 'frozen_surface') {
      tags.add('ice');
      frozenCrossingEntityId = crossing.entityId;
    }
  }

  const entitiesAt = state.spatialIndex.get(`${x},${y}`) ?? [];
  for (const eid of entitiesAt) {
    const f = getComponent(state, eid, ComponentType.Field) as FieldComponent | undefined;
    if (!f) continue;
    matchingFieldEntityIds.push(eid);
    tags.add(f.fieldType);
    const fDef = state.campaign.fields[f.fieldType];
    for (const t of fDef?.tags ?? []) tags.add(t);
    if (f.fieldType.includes('oil')) {
      tags.add('oil');
      tags.add('flammable');
    }
    if (f.fieldType.includes('fire')) {
      tags.add('fire');
    }
    if (f.fieldType.includes('water')) {
      tags.add('water');
      tags.add('liquid');
    }
  }

  return { tags, matchingFieldEntityIds, frozenCrossingEntityId };
}

function spawnFieldRaw(
  state: GameState,
  fieldType: string,
  x: number,
  y: number,
  intensity: number,
  duration: number,
  spreadRuleId?: string,
  interaction?: InteractionChain
): [GameState, EntityId] {
  const readyState = ensureFieldDefinitionExists(state, fieldType);
  const def = readyState.campaign.fields[fieldType]!;

  // Deduplicate same-type stationary field on the exact same tile
  const existingAtTile = readyState.spatialIndex.get(`${x},${y}`) ?? [];
  for (const existingId of existingAtTile) {
    const existingField = getComponent(readyState, existingId, ComponentType.Field) as FieldComponent | undefined;
    if (existingField && existingField.fieldType === fieldType && existingField.anchorEntityId === undefined) {
      const mergedField: FieldComponent = {
        ...existingField,
        intensity: Math.max(existingField.intensity, intensity),
        duration: Math.max(existingField.duration, duration),
        ...(spreadRuleId !== undefined ? { spreadRuleId } : {}),
        ...(interaction !== undefined
          ? {
              sourceEntityId: interaction.originatorEntityId,
              interaction: appendInteractionFrame(interaction, {
                kind: 'field',
                fieldEntityId: existingId,
                fieldType
              })
            }
          : {})
      };
      return [addComponent(readyState, existingId, mergedField), existingId];
    }
  }

  const [createdState, entityId] = createEntity(readyState);
  let nextState = createdState;

  const fieldInteraction =
    interaction !== undefined
      ? appendInteractionFrame(interaction, {
          kind: 'field',
          fieldEntityId: entityId,
          fieldType
        })
      : undefined;

  const pos: PositionComponent = { type: ComponentType.Position, x, y };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: def.glyph,
    fg: def.fg,
    bg: def.bg,
    ...(def.spriteId !== undefined ? { spriteId: def.spriteId } : {})
  };
  const field: FieldComponent = {
    type: ComponentType.Field,
    fieldType,
    intensity,
    duration,
    ...(spreadRuleId !== undefined ? { spreadRuleId } : {}),
    ...(fieldInteraction !== undefined
      ? {
          sourceEntityId: fieldInteraction.originatorEntityId,
          interaction: fieldInteraction
        }
      : {})
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);
  nextState = addComponent(nextState, entityId, field);
  nextState = addComponent(nextState, entityId, {
    type: ComponentType.Tags,
    tags: ['field', `field:${fieldType}`, ...(def.tags ?? [])]
  });

  if (def.blocksSight) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  return [nextState, entityId];
}

interface FieldInteractionTransactionResult {
  readonly state: GameState;
  readonly matched: boolean;
  readonly primarySpawnedEntityId?: EntityId | undefined;
}

function resolveFieldInteractionsTransaction(
  state: GameState,
  originX: number,
  originY: number,
  incomingTags: ReadonlyArray<string>,
  interaction?: InteractionChain
): FieldInteractionTransactionResult {
  if (incomingTags.length === 0 || !isInBounds(originX, originY, state.map.width, state.map.height)) {
    return { state, matched: false };
  }

  const rules =
    state.campaign.rules.fieldInteractions && state.campaign.rules.fieldInteractions.length > 0
      ? state.campaign.rules.fieldInteractions
      : DEFAULT_FIELD_INTERACTION_RULES;

  let nextState = state;
  const incomingSet = new Set(incomingTags);
  let matchedAnyRule = false;
  let primarySpawnedEntityId: EntityId | undefined;

  for (const rule of rules) {
    const incomingMatches = rule.incomingTags.some((t) => incomingSet.has(t));
    if (!incomingMatches) continue;

    const originTarget = collectTargetTagsAtTile(nextState, originX, originY);
    const targetMatches = rule.targetTags.some((t) => originTarget.tags.has(t));
    if (!targetMatches) continue;

    // Collect affected coordinates (single tile or orthogonal BFS connected component)
    const visited = new Set<string>();
    const queue: Array<{ readonly x: number; readonly y: number }> = [{ x: originX, y: originY }];
    const affectedCoords: Array<{ readonly x: number; readonly y: number }> = [];

    while (queue.length > 0 && affectedCoords.length < MAX_FIELD_CHAIN_BFS_TILES) {
      const curr = queue.shift()!;
      const key = `${curr.x},${curr.y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const tileTarget = collectTargetTagsAtTile(nextState, curr.x, curr.y);
      if (!rule.targetTags.some((t) => tileTarget.tags.has(t))) continue;

      affectedCoords.push(curr);

      if (rule.chainSpreadOrthogonal === true) {
        const neighbors = [
          { x: curr.x + 1, y: curr.y },
          { x: curr.x - 1, y: curr.y },
          { x: curr.x, y: curr.y + 1 },
          { x: curr.x, y: curr.y - 1 }
        ];
        for (const n of neighbors) {
          if (isInBounds(n.x, n.y, nextState.map.width, nextState.map.height) && !visited.has(`${n.x},${n.y}`)) {
            queue.push(n);
          }
        }
      }
    }

    if (affectedCoords.length === 0) continue;
    matchedAnyRule = true;

    const ruleInteraction =
      interaction !== undefined
        ? appendInteractionFrame(interaction, {
            kind: 'effect',
            effectId: rule.id,
            effectKind: 'field_interaction'
          })
        : undefined;

    if (rule.message) {
      nextState = addMessage(nextState, rule.message, MessageLogCategory.System);
    }

    for (const coord of affectedCoords) {
      const latestTarget = collectTargetTagsAtTile(nextState, coord.x, coord.y);
      let inheritedInteraction = ruleInteraction;

      if (rule.extinguishTarget === true) {
        if (latestTarget.frozenCrossingEntityId !== undefined) {
          nextState = destroyCrossingEntity(nextState, latestTarget.frozenCrossingEntityId);
        }
        for (const fId of latestTarget.matchingFieldEntityIds) {
          const fComp = getComponent(nextState, fId, ComponentType.Field) as FieldComponent | undefined;
          if (!fComp) continue;
          if (inheritedInteraction === undefined && fComp.interaction !== undefined) {
            inheritedInteraction = appendInteractionFrame(fComp.interaction, {
              kind: 'effect',
              effectId: rule.id,
              effectKind: 'field_interaction'
            });
          }
          const fDef = nextState.campaign.fields[fComp.fieldType];
          const fTags = new Set<string>([fComp.fieldType, ...(fDef?.tags ?? [])]);
          if (fComp.fieldType.includes('oil')) fTags.add('oil');
          if (fComp.fieldType.includes('fire')) fTags.add('fire');
          if (rule.targetTags.some((t) => fTags.has(t))) {
            if (fDef?.blocksSight) nextState = { ...nextState, fovNeedsUpdate: true };
            nextState = removeEntity(nextState, fId);
          }
        }
      }

      if (rule.spawnCrossingKind !== undefined) {
        const [withCrossing, crossingId] = spawnCrossingEntity({
          state: nextState,
          x: coord.x,
          y: coord.y,
          crossingKind: rule.spawnCrossingKind,
          durationTurns: rule.spawnCrossingDuration ?? DEFAULT_FROZEN_CROSSING_DURATION,
          ...(inheritedInteraction !== undefined ? { interaction: inheritedInteraction } : {})
        });
        nextState = withCrossing;
        if (primarySpawnedEntityId === undefined) {
          primarySpawnedEntityId = crossingId;
        }
      }

      if (rule.spawnFieldType !== undefined) {
        const [withField, spawnedId] = spawnFieldRaw(
          nextState,
          rule.spawnFieldType,
          coord.x,
          coord.y,
          rule.spawnFieldIntensity ?? 1,
          rule.spawnFieldDuration ?? DEFAULT_TRANSMUTED_FIELD_DURATION,
          undefined,
          inheritedInteraction
        );
        nextState = withField;
        if (primarySpawnedEntityId === undefined) {
          primarySpawnedEntityId = spawnedId;
        }
      }

      if (rule.shockDamageDice !== undefined) {
        const occupants = nextState.spatialIndex.get(`${coord.x},${coord.y}`) ?? [];
        for (const occId of occupants) {
          const fighter = getComponent(nextState, occId, ComponentType.Fighter) as FighterComponent | undefined;
          if (!fighter || fighter.hp <= 0) continue;
          const dmgAmount = parseSimpleDiceTotal(rule.shockDamageDice);
          const existingDmg = getComponent(nextState, occId, ComponentType.Damage) as DamageComponent | undefined;
          const instances = existingDmg ? [...existingDmg.instances] : [];
          instances.push({
            amount: dmgAmount,
            ...(inheritedInteraction?.originatorEntityId !== undefined
              ? { sourceEntityId: inheritedInteraction.originatorEntityId }
              : {}),
            tags: ['electricity', 'energy', 'field', 'conductive_water'],
            ...(inheritedInteraction !== undefined ? { interaction: inheritedInteraction } : {})
          });
          nextState = addComponent(nextState, occId, {
            type: ComponentType.Damage,
            instances
          });
        }
      }
    }
  }

  return {
    state: nextState,
    matched: matchedAnyRule,
    ...(primarySpawnedEntityId !== undefined ? { primarySpawnedEntityId } : {})
  };
}

/**
 * Evaluates declarative `FieldInteractionRule` chemistry at `(x, y)` for an incoming elemental/alchemical tag set
 * (e.g. `['fire']`, `['cold']`, `['electricity']`, `['water']`), supporting orthogonal BFS chain propagation
 * (`oil` + `fire` ignition, `water` + `electricity` conductive shock, `water` + `cold` -> `frozen_surface` crossing,
 * `frozen_surface` + `fire` thaw/collapse, and `fire` + `water` -> `steam_cloud` with `blocksSight: true`).
 *
 * @param state Current immutable GameState.
 * @param originX Grid X coordinate.
 * @param originY Grid Y coordinate.
 * @param incomingTags Incoming energy or substance tags.
 * @param interaction Optional causal interaction provenance chain.
 * @returns Updated GameState after resolving all matching field interactions.
 */
export function evaluateFieldInteractionsAtTile(
  state: GameState,
  originX: number,
  originY: number,
  incomingTags: ReadonlyArray<string>,
  interaction?: InteractionChain
): GameState {
  return resolveFieldInteractionsTransaction(state, originX, originY, incomingTags, interaction).state;
}

/**
 * Helper to spawn a field at a given position and evaluate any immediate declarative `FieldInteractionRule` reactions
 * as a single atomic transaction (transmuting existing reactive surfaces without spawning duplicate fields).
 */
export function spawnField(
  state: GameState,
  fieldType: string,
  x: number,
  y: number,
  intensity: number,
  duration: number,
  spreadRuleId?: string,
  interaction?: InteractionChain
): [GameState, EntityId] {
  const def = state.campaign.fields[fieldType];
  if (
    !def &&
    ![
      'steam_cloud',
      'smoke',
      'oil',
      'fire',
      'caltrops',
      'marbles',
      'grease',
      'ice',
      'water',
      'cold',
      'electricity',
      'acid',
      'web'
    ].includes(fieldType)
  ) {
    console.warn(`Attempted to spawn unknown field: ${fieldType}`);
    return [state, -1 as unknown as EntityId];
  }

  const incomingTags: string[] = [fieldType, ...(def?.tags ?? [])];
  if (fieldType.includes('fire')) incomingTags.push('fire');
  if (fieldType.includes('cold') || fieldType.includes('ice')) incomingTags.push('cold', 'ice');
  if (fieldType.includes('elec') || fieldType.includes('lightning')) incomingTags.push('electricity');
  if (fieldType.includes('water')) incomingTags.push('water', 'liquid');

  // Detect and commit transmutations BEFORE committing a raw incoming field (prevents double-spawning fire on oil).
  const reaction = resolveFieldInteractionsTransaction(state, x, y, incomingTags, interaction);
  if (reaction.matched) {
    return [reaction.state, reaction.primarySpawnedEntityId ?? (-1 as unknown as EntityId)];
  }

  return spawnFieldRaw(state, fieldType, x, y, intensity, duration, spreadRuleId, interaction);
}

/**
 * Synchronizes coordinates of all mobile emanation fields anchored to a specific entity
 * immediately upon the anchor entity moving.
 *
 * @param state Current GameState.
 * @param anchorEntityId The entity that moved.
 * @param newX New X coordinate of the anchor entity.
 * @param newY New Y coordinate of the anchor entity.
 * @returns Updated GameState with anchored field positions synchronized.
 */
export function syncAnchoredFieldsForEntity(
  state: GameState,
  anchorEntityId: EntityId,
  newX: number,
  newY: number
): GameState {
  let nextState = state;
  for (const entityId of nextState.entities) {
    const fieldCmp = getComponent(nextState, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (!fieldCmp || fieldCmp.anchorEntityId !== anchorEntityId) continue;
    const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos || pos.x !== newX || pos.y !== newY) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Position,
        x: newX,
        y: newY
      });
    }
  }
  return nextState;
}

/**
 * Ticks all fields by 1 turn, handles decay, applies effects to occupants, and processes spreading.
 */
export function processFieldsTick(state: GameState): GameState {
  let nextState = state;
  let fovNeedsUpdate = false;

  for (const entityId of [...nextState.entities]) {
    const fieldCmp = getComponent(nextState, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (!fieldCmp) continue;

    const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;

    // 0. Synchronize mobile emanations anchored to an entity
    if (fieldCmp.anchorEntityId !== undefined) {
      const anchorPos = getComponent(nextState, fieldCmp.anchorEntityId, ComponentType.Position) as
        PositionComponent | undefined;
      if (anchorPos && (anchorPos.x !== pos.x || anchorPos.y !== pos.y)) {
        nextState = addComponent(nextState, entityId, {
          type: ComponentType.Position,
          x: anchorPos.x,
          y: anchorPos.y
        });
      }
    }

    const def = nextState.campaign.fields[fieldCmp.fieldType];

    // 1. Apply effects to occupants for the current round
    if (def) {
      const entitiesAtPos = nextState.spatialIndex.get(`${pos.x},${pos.y}`);
      if (entitiesAtPos) {
        const fieldChain =
          fieldCmp.interaction !== undefined
            ? appendInteractionFrame(fieldCmp.interaction, {
                kind: 'field',
                fieldEntityId: entityId,
                fieldType: fieldCmp.fieldType
              })
            : undefined;
        for (const occupantId of entitiesAtPos) {
          if (occupantId === entityId) continue;
          const occupantField = getComponent(nextState, occupantId, ComponentType.Field);
          if (occupantField) continue; // Fields don't damage other fields here (reactions handle that)

          const fighter = getComponent(nextState, occupantId, ComponentType.Fighter);
          if (fighter) {
            // Apply Damage
            if (def.damagePerTurn !== undefined && def.damagePerTurn > 0) {
              const existingDamage = getComponent(nextState, occupantId, ComponentType.Damage) as
                DamageComponent | undefined;
              const newInstances = existingDamage ? [...existingDamage.instances] : [];
              newInstances.push({
                amount: def.damagePerTurn,
                ...(fieldChain?.originatorEntityId !== undefined
                  ? { sourceEntityId: fieldChain.originatorEntityId }
                  : {}),
                tags: ['field', fieldCmp.fieldType],
                ...(fieldChain !== undefined ? { interaction: fieldChain } : {})
              });
              nextState = addComponent(nextState, occupantId, {
                type: ComponentType.Damage,
                instances: newInstances
              });
            }

            // Apply Status Effect
            if (def.statusEffectId) {
              // Reapply for 2 turns so they stay poisoned as long as they are in it, and 1 turn after.
              nextState = applyStatusEffect(
                nextState,
                occupantId,
                def.statusEffectId,
                2,
                fieldChain?.originatorEntityId,
                fieldChain
              );
            }
          }
        }
      }
    }

    // 2. Tick duration
    const newDuration = fieldCmp.duration - 1;
    if (newDuration <= 0) {
      nextState = removeEntity(nextState, entityId);
      if (def && def.blocksSight) fovNeedsUpdate = true;
      continue;
    }

    nextState = addComponent(nextState, entityId, { ...fieldCmp, duration: newDuration });

    // 3. Process Spread Rules (Basic implementation)
    if (fieldCmp.spreadRuleId === 'fire_spread') {
      if (rng.getUniform() < 0.05) {
        // 5% chance to spread per turn
      }
    }
  }

  if (fovNeedsUpdate) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  return nextState;
}

/**
 * Advances active spatial fields across `turnsElapsed` turns.
 * When any field has active occupant effects or expires during the window, ticks turn-by-turn;
 * otherwise fast-forwards remaining durations cleanly.
 *
 * @param state Current immutable GameState.
 * @param turnsElapsed Number of elapsed turns.
 * @returns Updated GameState.
 */
export function advanceFieldsByTurns(state: GameState, turnsElapsed: number): GameState {
  if (turnsElapsed <= 0) return state;
  let nextState = state;
  for (let step = 0; step < turnsElapsed; step++) {
    let hasAnyField = false;
    for (const eid of nextState.entities) {
      if (getComponent(nextState, eid, ComponentType.Field) !== undefined) {
        hasAnyField = true;
        break;
      }
    }
    if (!hasAnyField) break;
    nextState = processFieldsTick(nextState);
  }
  return nextState;
}

/**
 * Result descriptor for an active field affecting a grid position.
 */
export interface ActiveFieldQueryResult {
  readonly entityId: EntityId;
  readonly field: FieldComponent;
}

/**
 * Queries all active fields affecting a grid coordinate, including stationary fields
 * and mobile radial emanations anchored to moving entities.
 *
 * @param state Current immutable GameState.
 * @param x Grid X coordinate.
 * @param y Grid Y coordinate.
 * @returns Array of active fields covering the coordinates.
 */
export function queryActiveFieldsAtPosition(
  state: GameState,
  x: number,
  y: number
): ReadonlyArray<ActiveFieldQueryResult> {
  const results: ActiveFieldQueryResult[] = [];

  for (const entityId of state.entities) {
    const field = getComponent(state, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (!field) continue;

    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;

    const radiusFt = field.radiusFt ?? 0;
    const radiusTiles = Math.floor(radiusFt / 5);

    if (radiusTiles <= 0) {
      if (pos.x === x && pos.y === y) {
        results.push({ entityId, field });
      }
    } else {
      const dx = Math.abs(pos.x - x);
      const dy = Math.abs(pos.y - y);
      const distTiles = Math.max(dx, dy);
      if (distTiles <= radiusTiles) {
        results.push({ entityId, field });
      }
    }
  }

  return results;
}
