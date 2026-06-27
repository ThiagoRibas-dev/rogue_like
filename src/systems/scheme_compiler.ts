import type { GameState, EntityId } from '../types/game-state.types.ts';
import type { CampaignData, PhaseBlock } from '../types/campaign.types.ts';
import { ComponentType, type SchemeComponent } from '../types/components.types.ts';
import { addComponent } from '../core/ecs.ts';
import * as ROT from 'rot-js';

/**
 * Compiles a scheme dynamically from a SchemeRecipe and the available PhaseBlocks.
 * Employs deterministic RNG for phase block selection.
 *
 * @param state The current GameState.
 * @param recipeId The ID of the SchemeRecipe to compile.
 * @param mastermindId The entity ID of the scheme mastermind.
 * @returns The updated GameState with the compiled SchemeComponent attached to the mastermind.
 */
export function compileScheme(state: GameState, recipeId: string, mastermindId: EntityId): GameState {
  const recipe = state.campaign.schemeRecipes[recipeId];
  if (!recipe) {
    console.warn(`[DEBUG] compileScheme failed: recipeId ${recipeId} not found.`);
    return state;
  }

  const compiledPhases = compilePhases(state.campaign, recipeId);

  const schemeComponent: SchemeComponent = {
    type: ComponentType.Scheme,
    recipeId: recipe.id,
    currentPhase: 0,
    activeMinions: [],
    phases: compiledPhases,
    conspiracyAwareness: 0
  };

  return addComponent(state, mastermindId, schemeComponent);
}

/**
 * Compiles a list of phases based on the given SchemeRecipe.
 */
export function compilePhases(campaign: CampaignData, recipeId: string): PhaseBlock[] {
  const recipe = campaign.schemeRecipes[recipeId];
  if (!recipe) return [];

  let candidates = Object.values(campaign.phaseBlocks);
  if (recipe.phaseTags && recipe.phaseTags.length > 0) {
    candidates = candidates.filter((b: PhaseBlock) =>
      recipe.phaseTags!.some((t: string) => b.evidenceTags.includes(t))
    );
  }

  if (candidates.length === 0) {
    candidates = Object.values(campaign.phaseBlocks);
  }

  const compiledPhases = [];
  const pool = [...candidates];

  for (let i = 0; i < recipe.phaseLength; i++) {
    if (pool.length === 0) break;
    const index = ROT.RNG.getUniformInt(0, pool.length - 1);
    const block = pool[index];
    if (block) compiledPhases.push(block);
    pool.splice(index, 1);
  }

  return compiledPhases;
}
