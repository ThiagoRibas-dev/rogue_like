import { type GameState, type EntityId } from '../types/game-state.types.ts';
import { ComponentType, type SchemeComponent, type AgreementComponent } from '../types/components.types.ts';
import { getComponent, addComponent, createEntity } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import * as ROT from 'rot-js';
import type { VillainArchetype } from '../types/campaign.types.ts';
import { GameEventType } from '../types/events.types.ts';

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
    // Apply phase mutations
    if (currentPhaseDef.mutations) {
      const nextMutations = { ...nextState.areaMutations };
      for (const mut of currentPhaseDef.mutations) {
        const areaId = mut.targetAreaId;
        const currentMutation = nextMutations[areaId] || { addedTags: [], budgetModifier: 0 };
        nextMutations[areaId] = {
          addedTags: Array.from(new Set([...currentMutation.addedTags, ...(mut.addedTags || [])])),
          budgetModifier: currentMutation.budgetModifier + (mut.budgetModifier || 0)
        };

        // Emit Event (for investigation board / ledger)
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
      nextState = { ...nextState, areaMutations: nextMutations };
    }

    const updatedScheme: SchemeComponent = {
      ...schemeComponent,
      currentPhase: schemeComponent.currentPhase + 1
    };
    nextState = addComponent(nextState, mastermindId, updatedScheme);

    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.SchemeAdvanced,
          schemeId: schemeComponent.schemeId,
          newPhase: updatedScheme.currentPhase
        }
      ]
    };

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
 * Attempts to find a target NPC or create a background token minion to join the scheme.
 */
function recruitMinion(
  state: GameState,
  mastermindId: EntityId,
  schemeComponent: SchemeComponent,
  archetype: VillainArchetype
): GameState {
  const schemeTemplate = state.campaign.schemes[schemeComponent.schemeId];
  const currentPhaseDef = schemeTemplate ? schemeTemplate.phases[schemeComponent.currentPhase] : undefined;

  // Determine target area
  let targetAreaId = 'dungeon_1'; // Fallback
  if (currentPhaseDef?.mutations && currentPhaseDef.mutations.length > 0) {
    targetAreaId = currentPhaseDef.mutations[0]!.targetAreaId;
  } else {
    const areas = Object.keys(state.campaign.areas).filter((id) => id !== 'safe_hub');
    if (areas.length > 0) {
      targetAreaId = ROT.RNG.getItem(areas) || 'dungeon_1';
    }
  }

  // Determine minion template
  const preferredTags = archetype.recruitmentPreferences.targetTags;
  const eligibleTemplates = Object.entries(state.campaign.entities)
    .filter(([id, ent]) => {
      if (id === 'player') return false;
      return preferredTags.some((tag) => ent.tags?.includes(tag));
    })
    .map(([id]) => id);

  let templateId: string;
  if (eligibleTemplates.length > 0) {
    templateId = ROT.RNG.getItem(eligibleTemplates) || 'orc';
  } else {
    // Fail-graceful: pool exhausted or empty. Write debug log, fallback to generic 'orc'
    templateId = 'orc';
    console.warn(`[DEBUG] Scheme recruitment pool exhausted for archetype ${archetype.id}, falling back to 'orc'`);
  }

  // Create the placeholder entity in ECS (no PositionComponent!)
  let nextState = state;
  const [tempState, minionId] = createEntity(nextState);
  nextState = tempState;

  // Attach Template component so we know what template it is
  nextState = addComponent(nextState, minionId, {
    type: ComponentType.Template,
    templateId
  });

  // Pick a leverage based on weights
  const leverageEntries = Object.entries(archetype.recruitmentPreferences.leverageWeight);
  const leverageUsed =
    leverageEntries.length > 0
      ? (leverageEntries.sort((a, b) => b[1] - a[1])[0]![0] as 'money' | 'ideology' | 'coercion' | 'ego')
      : 'money';

  // Pick a random agreement template
  const agreementIds = Object.keys(state.campaign.agreements);
  const agreementId = ROT.RNG.getItem(agreementIds) || 'raid_contract';

  // Attach AgreementComponent to target
  const agreement: AgreementComponent = {
    type: ComponentType.Agreement,
    mastermindId,
    agreementId,
    leverageUsed,
    targetAreaId,
    isFulfilled: false
  };
  nextState = addComponent(nextState, minionId, agreement);

  // Update SchemeComponent
  const updatedScheme: SchemeComponent = {
    ...schemeComponent,
    activeMinions: [...schemeComponent.activeMinions, minionId]
  };
  nextState = addComponent(nextState, mastermindId, updatedScheme);

  nextState = addMessage(
    nextState,
    `[DEBUG] Mastermind recruited minion ${minionId} (template: ${templateId}) using ${leverageUsed} for area ${targetAreaId}!`,
    MessageLogCategory.System
  );

  return nextState;
}
