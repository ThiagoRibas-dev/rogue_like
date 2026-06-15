import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type SchemeComponent,
  type AgreementComponent,
  type TagsComponent
} from '../types/components.types.ts';
import { getComponent, addComponent } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import * as ROT from 'rot-js';
import type { VillainArchetype } from '../types/campaign.types.ts';

/**
 * Executes a mastermind's background scheme plot.
 * Runs independently of the current active area.
 */
export function processSchemeTurn(state: GameState, mastermindId: EntityId): GameState {
  const schemeComponent = getComponent(state, mastermindId, ComponentType.Scheme) as SchemeComponent | undefined;
  if (!schemeComponent) return state;

  const schemeTemplate = state.campaign.schemes[schemeComponent.schemeId];
  if (!schemeTemplate) return state;

  const currentPhaseDef = schemeTemplate.phases[schemeComponent.currentPhase];
  if (!currentPhaseDef) {
    // Scheme has completed all phases!
    // We could add an event here, or transition to a "victory" state for the mastermind.
    return state;
  }

  const { requiredAgreements } = currentPhaseDef;
  const currentAgreements = schemeComponent.activeMinions.length;

  let nextState = state;

  // RECRUITMENT PHASE
  if (currentAgreements < requiredAgreements) {
    // We need to recruit a new minion
    const archetype = state.campaign.villains[schemeTemplate.villainArchetypeId];
    if (archetype) {
      nextState = recruitMinion(nextState, mastermindId, schemeComponent, archetype);
    }
  } else {
    // EXECUTION PHASE
    // All minions are recruited, queue their mission intents (stubbed for now, as we need AI behavior integration)
    // For MVP, we will advance the phase when they execute.
    // Let's just advance the phase if we have enough minions.
    const updatedScheme: SchemeComponent = {
      ...schemeComponent,
      currentPhase: schemeComponent.currentPhase + 1
    };
    nextState = addComponent(nextState, mastermindId, updatedScheme);

    // Announce to debug log that phase advanced
    nextState = addMessage(
      nextState,
      `[DEBUG] Scheme ${schemeComponent.schemeId} advanced to phase ${updatedScheme.currentPhase}!`,
      MessageLogCategory.System
    );
  }

  return nextState;
}

/**
 * Attempts to find a target NPC and convince them to join the scheme.
 */
function recruitMinion(
  state: GameState,
  mastermindId: EntityId,
  schemeComponent: SchemeComponent,
  archetype: VillainArchetype
): GameState {
  // Find all active and persistent entities that are Actors but not the Player and not already minions
  const potentialTargets: EntityId[] = [];

  // Search active area
  for (const id of state.entities) {
    if (id === mastermindId || schemeComponent.activeMinions.includes(id)) continue;
    if (getComponent(state, id, ComponentType.Actor) && !getComponent(state, id, ComponentType.Player)) {
      potentialTargets.push(id);
    }
  }

  // Search persistent entities
  for (const [id, record] of state.persistentEntities.entries()) {
    if (id === mastermindId || schemeComponent.activeMinions.includes(id)) continue;
    if (record.components[ComponentType.Actor]) {
      potentialTargets.push(id);
    }
  }

  // Filter by target tags
  const validTargets = potentialTargets.filter((id) => {
    // Active area
    const tagsComp = getComponent(state, id, ComponentType.Tags) as TagsComponent | undefined;
    // Persistent area
    const persistentRecord = state.persistentEntities.get(id);
    let tags: string[] = [];

    if (tagsComp) {
      tags = [...tagsComp.tags];
    } else if (persistentRecord) {
      const pTagsComp = persistentRecord.components[ComponentType.Tags] as TagsComponent | undefined;
      if (pTagsComp) tags = [...pTagsComp.tags];
    }

    return archetype.recruitmentPreferences.targetTags.some((tag) => tags.includes(tag));
  });

  if (validTargets.length === 0) {
    // No one to recruit right now
    return state;
  }

  // Pick a random valid target
  const targetId = ROT.RNG.getItem(validTargets);
  if (targetId === null) return state;

  // Pick a leverage based on weights (Simplified MVP: pick highest weight, or random)
  const leverageEntries = Object.entries(archetype.recruitmentPreferences.leverageWeight);
  if (leverageEntries.length === 0) return state;

  // Just pick 'money' or whatever has the highest weight for the MVP to ensure it works
  const leverageUsed = leverageEntries.sort((a, b) => b[1] - a[1])[0]![0] as 'money' | 'ideology' | 'coercion' | 'ego';

  // Pick a random agreement template
  const agreementIds = Object.keys(state.campaign.agreements);
  const agreementId = ROT.RNG.getItem(agreementIds) || 'raid_contract';

  // Attach AgreementComponent to target
  const agreement: AgreementComponent = {
    type: ComponentType.Agreement,
    mastermindId,
    agreementId,
    leverageUsed
  };

  let nextState = addComponent(state, targetId, agreement);

  // Update SchemeComponent
  const updatedScheme: SchemeComponent = {
    ...schemeComponent,
    activeMinions: [...schemeComponent.activeMinions, targetId]
  };

  nextState = addComponent(nextState, mastermindId, updatedScheme);

  nextState = addMessage(
    nextState,
    `[DEBUG] Mastermind recruited minion ${targetId} using ${leverageUsed}!`,
    MessageLogCategory.System
  );

  return nextState;
}
