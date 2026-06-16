import type { EntityId, GameState } from '../types/game-state.types.ts';
import {
  ComponentType,
  type FieldComponent,
  type PositionComponent,
  type DamageComponent,
  type RenderableComponent
} from '../types/components.types.ts';
import { getComponent, addComponent, removeEntity, createEntity } from '../core/ecs.ts';
import { rng } from '../core/rng.ts';
import { applyStatusEffect } from './status-effect.system.ts';

/**
 * Helper to spawn a field at a given position.
 */
export function spawnField(
  state: GameState,
  fieldType: string,
  x: number,
  y: number,
  intensity: number,
  duration: number,
  spreadRuleId?: string
): [GameState, EntityId] {
  const def = state.campaign.fields[fieldType];
  if (!def) {
    console.warn(`Attempted to spawn unknown field: ${fieldType}`);
    return [state, -1 as unknown as EntityId];
  }

  const [createdState, entityId] = createEntity(state);
  let nextState = createdState;

  const pos: PositionComponent = { type: ComponentType.Position, x, y };
  const render: RenderableComponent = {
    type: ComponentType.Renderable,
    glyph: def.glyph,
    fg: def.fg,
    bg: def.bg
  };
  const field: FieldComponent = {
    type: ComponentType.Field,
    fieldType,
    intensity,
    duration,
    spreadRuleId
  };

  nextState = addComponent(nextState, entityId, pos);
  nextState = addComponent(nextState, entityId, render);
  nextState = addComponent(nextState, entityId, field);
  nextState = addComponent(nextState, entityId, {
    type: ComponentType.Tags,
    tags: ['field', `field:${fieldType}`]
  });

  if (def.blocksSight) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  return [nextState, entityId];
}

/**
 * Ticks all fields, handles decay, applies effects to occupants, and processes spreading.
 */
export function processFieldsTick(state: GameState): GameState {
  let nextState = state;
  let fovNeedsUpdate = false;

  for (const entityId of nextState.entities) {
    const fieldCmp = getComponent(nextState, entityId, ComponentType.Field) as FieldComponent | undefined;
    if (!fieldCmp) continue;

    const pos = getComponent(nextState, entityId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) continue;

    const def = nextState.campaign.fields[fieldCmp.fieldType];

    // 1. Tick duration
    const newDuration = fieldCmp.duration - 1;
    if (newDuration <= 0) {
      nextState = removeEntity(nextState, entityId);
      if (def && def.blocksSight) fovNeedsUpdate = true;
      continue;
    }

    nextState = addComponent(nextState, entityId, { ...fieldCmp, duration: newDuration });

    if (!def) continue;

    // 2. Apply effects to occupants
    const entitiesAtPos = nextState.spatialIndex.get(`${pos.x},${pos.y}`);
    if (entitiesAtPos) {
      for (const occupantId of entitiesAtPos) {
        if (occupantId === entityId) continue;
        const occupantField = getComponent(nextState, occupantId, ComponentType.Field);
        if (occupantField) continue; // Fields don't damage other fields here (reactions handle that)

        const fighter = getComponent(nextState, occupantId, ComponentType.Fighter);
        if (fighter) {
          // Apply Damage
          if (def.damagePerTurn !== undefined && def.damagePerTurn > 0) {
            const existingDamage = getComponent(nextState, occupantId, ComponentType.Damage) as
              | DamageComponent
              | undefined;
            const newInstances = existingDamage ? [...existingDamage.instances] : [];
            newInstances.push({
              amount: def.damagePerTurn,
              tags: ['field', fieldCmp.fieldType]
            });
            nextState = addComponent(nextState, occupantId, {
              type: ComponentType.Damage,
              instances: newInstances
            });
          }

          // Apply Status Effect
          if (def.statusEffectId) {
            // Reapply for 2 turns so they stay poisoned as long as they are in it, and 1 turn after.
            nextState = applyStatusEffect(nextState, occupantId, def.statusEffectId, 2);
          }
        }
      }
    }

    // 3. Process Spread Rules (Basic implementation)
    // To implement deterministic spread, we'd roll rng here based on spreadRuleId.
    if (fieldCmp.spreadRuleId === 'fire_spread') {
      if (rng.getUniform() < 0.05) {
        // 5% chance to spread per turn
        // For a full implementation, we'd check adjacent tiles for 'flammable' tags
      }
    }
  }

  if (fovNeedsUpdate) {
    nextState = { ...nextState, fovNeedsUpdate: true };
  }

  return nextState;
}
