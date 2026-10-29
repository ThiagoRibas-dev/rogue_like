import { ComponentType, type TagsComponent, type TraitsComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState } from '../../types/game-state.types.ts';
import { getComponent } from '../../core/ecs.ts';

/**
 * Centralized helper to pool and resolve barks from an entity's active tags and traits.
 *
 * @param state The current global game state.
 * @param entityId The EntityId of the entity to retrieve barks for.
 * @param barkType The category of bark (e.g., 'encounter_nemesis', 'cheat_death', 'victory_taunt').
 * @returns An array of matching bark strings.
 */
export function getEntityBarks(state: GameState, entityId: EntityId, barkType: string): string[] {
  const barks: string[] = [];

  const tagsComp = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  if (tagsComp) {
    for (const tag of tagsComp.tags) {
      const tagDef = state.campaign.tagRegistry[tag];
      if (tagDef && tagDef.barks && tagDef.barks[barkType]) {
        barks.push(...tagDef.barks[barkType]);
      }
    }
  }

  const traitsComp = getComponent(state, entityId, ComponentType.Traits) as TraitsComponent | undefined;
  if (traitsComp) {
    for (const trait of traitsComp.traits) {
      const traitDef = state.campaign.traitRegistry[trait];
      if (traitDef && traitDef.barks && traitDef.barks[barkType]) {
        barks.push(...traitDef.barks[barkType]);
      }
    }
  }

  return barks;
}
