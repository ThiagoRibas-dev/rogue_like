import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type SchemeComponent,
  type MemoryComponent,
  type TagsComponent,
  type DirectorBudgetComponent
} from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import { GameEventType } from '../types/events.types.ts';
import { evaluateMinionMoraleAndAwareness, recruitMinion } from './scheme/scheme_recruitment.ts';

/**
 * Executes a mastermind's background scheme plot.
 * Runs independently of the current active area.
 */
export function processSchemeTurn(state: GameState, mastermindId: EntityId): GameState {
  const schemeComponent = getComponent(state, mastermindId, ComponentType.Scheme) as SchemeComponent | undefined;
  if (!schemeComponent) return state;

  const recipe = state.campaign.schemeRecipes[schemeComponent.recipeId];
  if (!recipe) return state;

  const currentPhaseDef = schemeComponent.phases[schemeComponent.currentPhase];
  if (!currentPhaseDef) {
    return state;
  }

  const moraleResult = evaluateMinionMoraleAndAwareness(state, mastermindId, schemeComponent);
  let nextState = moraleResult.state;
  const schemeComponentForPhase = moraleResult.schemeComponent;

  const { requiredAgreements } = currentPhaseDef;
  const currentAgreements = schemeComponentForPhase.activeMinions.length;

  if (currentAgreements < requiredAgreements) {
    const archetype = state.campaign.villains[recipe.villainArchetypeId];
    if (archetype) {
      nextState = recruitMinion(nextState, mastermindId, schemeComponentForPhase, archetype);
    }
  } else {
    if (currentPhaseDef.mutations) {
      for (const mut of currentPhaseDef.mutations) {
        const areaId = mut.targetAreaId;
        const areaEntId = nextState.areaEntityIds[areaId];

        if (areaEntId) {
          if (mut.addedTags && mut.addedTags.length > 0) {
            const tagsComp = getComponent(nextState, areaEntId, ComponentType.Tags) as TagsComponent | undefined;
            if (tagsComp) {
              const newTags = Array.from(new Set([...tagsComp.tags, ...mut.addedTags]));
              nextState = addComponent(nextState, areaEntId, { ...tagsComp, tags: newTags });
            }
          }
          if (mut.budgetModifier) {
            const budgetComp = getComponent(nextState, areaEntId, ComponentType.DirectorBudget) as
              DirectorBudgetComponent | undefined;
            if (budgetComp) {
              nextState = addComponent(nextState, areaEntId, {
                ...budgetComp,
                budgetModifier: budgetComp.budgetModifier + mut.budgetModifier
              });
            }
          }
        }

        nextState = {
          ...nextState,
          events: [
            ...nextState.events,
            {
              type: GameEventType.SchemeMutatedArea,
              areaId,
              tagsAdded: mut.addedTags || [],
              budgetModifier: mut.budgetModifier || 0
            }
          ]
        };
      }
    }

    for (const minionId of schemeComponentForPhase.activeMinions) {
      const minionMemory = getComponent(nextState, minionId, ComponentType.Memory) as MemoryComponent | undefined;
      if (minionMemory) {
        nextState = addComponent(nextState, minionId, {
          ...minionMemory,
          compromiseScore: (minionMemory.compromiseScore || 0) + 10
        });
      }
    }

    const updatedScheme: SchemeComponent = {
      ...schemeComponentForPhase,
      currentPhase: schemeComponentForPhase.currentPhase + 1
    };
    nextState = addComponent(nextState, mastermindId, updatedScheme);

    const justCompletedPhase = schemeComponentForPhase.phases[schemeComponentForPhase.currentPhase];
    const targetAreaId = justCompletedPhase?.mutations?.[0]?.targetAreaId;

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.SchemeAdvanced,
          schemeId: schemeComponentForPhase.recipeId,
          newPhase: updatedScheme.currentPhase,
          targetAreaId
        }
      ]
    };

    nextState = addMessage(
      nextState,
      `[DEBUG] Scheme ${schemeComponentForPhase.recipeId} advanced to phase ${updatedScheme.currentPhase}!`,
      MessageLogCategory.System
    );
  }

  return nextState;
}
