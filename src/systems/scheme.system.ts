import { type GameState, type EntityId } from '../types/game-state.types.ts';
import {
  ComponentType,
  type SchemeComponent,
  type AgreementComponent,
  type MemoryComponent,
  type PositionComponent,
  type ClueComponent,
  toItemInstanceId
} from '../types/components.types.ts';
import { getComponent, addComponent, createEntity, removeComponent, moveToLimbo, spawnEntity } from '../core/ecs.ts';
import { addMessage, MessageLogCategory } from './message.system.ts';
import * as ROT from 'rot-js';
import type { VillainArchetype } from '../types/campaign.types.ts';
import { GameEventType, type GameEvent } from '../types/events.types.ts';

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
    // Scheme has completed all phases!
    return state;
  }

  let nextState = state;

  // -- LOCAL REPAIR & RETALIATION CHECK --
  const currentMinions = schemeComponent.activeMinions;
  let awarenessDelta = 0;
  const validMinions: EntityId[] = [];

  for (const minionId of currentMinions) {
    const exists = nextState.entities.includes(minionId);
    if (!exists) {
      // Minion is missing (dead/disrupted)
      awarenessDelta += 25;
      continue;
    }

    const mem = getComponent(nextState, minionId, ComponentType.Memory) as MemoryComponent | undefined;
    if (mem && (mem.compromiseScore || 0) > 50) {
      // Roll morale check (50% chance to flee and confess)
      if (ROT.RNG.getUniform() < 0.5) {
        // Abandon & Confess
        // 1. Add secret knowledge to minion's memory
        const knowledgeId = `confession_${schemeComponent.recipeId}_${minionId}`;
        const knowledgeItem = {
          id: knowledgeId,
          type: 'secret' as const,
          description: `Confession: Scheme ${schemeComponent.recipeId} is operating in this area.`,
          tags: ['confession', schemeComponent.recipeId]
        };
        const nextKnowledge = { ...(mem.knowledge || {}) };
        nextKnowledge[knowledgeId] = knowledgeItem;
        nextState = addComponent(nextState, minionId, {
          ...mem,
          knowledge: nextKnowledge
        });

        // 2. 50% chance to drop clue at their feet if they have a physical position and agreement
        if (ROT.RNG.getUniform() < 0.5) {
          const pos = getComponent(nextState, minionId, ComponentType.Position) as PositionComponent | undefined;
          const agreement = getComponent(nextState, minionId, ComponentType.Agreement) as
            | AgreementComponent
            | undefined;
          if (pos && agreement) {
            const agreementDef = nextState.campaign.agreements[agreement.agreementId];
            if (agreementDef && agreementDef.clueTemplates.length > 0) {
              const clueTemplateId = agreementDef.clueTemplates[0]!;
              let clueEntity: EntityId;
              [nextState, clueEntity] = createEntity(nextState);

              nextState = addComponent(nextState, clueEntity, pos);
              nextState = addComponent(nextState, clueEntity, {
                type: ComponentType.Renderable,
                glyph: '?',
                fg: '#ffff00',
                bg: 'transparent'
              });

              const instanceId = toItemInstanceId(`clue_item_${nextState.nextItemInstanceId}`);
              nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

              nextState = addComponent(nextState, clueEntity, {
                type: ComponentType.Item,
                itemId: 'clue_item',
                instanceId
              });

              const narrativeVerb = currentPhaseDef.narrativeVerb || 'operate';
              const tagsStr =
                currentPhaseDef.evidenceTags && currentPhaseDef.evidenceTags.length > 0
                  ? currentPhaseDef.evidenceTags.join(', ')
                  : 'suspicious';
              const clueText = `Incriminating ${tagsStr} evidence regarding a plan to ${narrativeVerb}...`;

              nextState = addComponent(nextState, clueEntity, {
                type: ComponentType.Clue,
                clueId: clueTemplateId,
                text: clueText,
                implicatesEntityId: agreement.mastermindId
              } as ClueComponent);

              const renderable = getComponent(nextState, minionId, ComponentType.Renderable);
              const name = renderable ? renderable.glyph : 'Someone';
              nextState = addMessage(
                nextState,
                `${name} dropped something suspicious while fleeing!`,
                MessageLogCategory.System
              );
            }
          }
        }

        // Strip the AgreementComponent so they are no longer part of the scheme
        nextState = removeComponent(nextState, minionId, ComponentType.Agreement);

        // Abandoned, so we don't add to validMinions
        continue;
      }
    }
    validMinions.push(minionId);
  }

  // Update scheme component with surviving minions and awareness
  let updatedSchemeComponent = schemeComponent;
  if (awarenessDelta > 0 || validMinions.length !== schemeComponent.activeMinions.length) {
    const currentAwareness = schemeComponent.conspiracyAwareness || 0;
    const newAwareness = currentAwareness + awarenessDelta;

    updatedSchemeComponent = {
      ...schemeComponent,
      activeMinions: validMinions,
      conspiracyAwareness: newAwareness
    };
    nextState = addComponent(nextState, mastermindId, updatedSchemeComponent);

    if (newAwareness >= 100) {
      // Emit SchemeEscalated event and reset conspiracyAwareness
      nextState = {
        ...nextState,
        events: [
          ...nextState.events,
          {
            type: GameEventType.SchemeEscalated,
            schemeId: schemeComponent.recipeId
          } as GameEvent
        ]
      };

      const resetScheme = {
        ...updatedSchemeComponent,
        conspiracyAwareness: Math.max(0, newAwareness - 100)
      };
      updatedSchemeComponent = resetScheme;
      nextState = addComponent(nextState, mastermindId, resetScheme);

      nextState = addMessage(
        nextState,
        `[DEBUG] Scheme ${schemeComponent.recipeId} conspiracy awareness escalated to maximum! Emitting escalation countermeasures.`,
        MessageLogCategory.System
      );
    }
  }

  const schemeComponentForPhase = updatedSchemeComponent;
  const { requiredAgreements } = currentPhaseDef;
  const currentAgreements = schemeComponentForPhase.activeMinions.length;

  // RECRUITMENT PHASE
  if (currentAgreements < requiredAgreements) {
    // We need to recruit a new minion
    const archetype = state.campaign.villains[recipe.villainArchetypeId];
    if (archetype) {
      nextState = recruitMinion(nextState, mastermindId, schemeComponentForPhase, archetype);
    }
  } else {
    // EXECUTION PHASE
    // Apply phase mutations
    if (currentPhaseDef.mutations) {
      for (const mut of currentPhaseDef.mutations) {
        const areaId = mut.targetAreaId;
        const areaEntId = nextState.areaEntityIds[areaId];

        if (areaEntId) {
          if (mut.addedTags && mut.addedTags.length > 0) {
            const tagsComp = getComponent(nextState, areaEntId, ComponentType.Tags) as
              | import('../types/components.types.ts').TagsComponent
              | undefined;
            if (tagsComp) {
              const newTags = Array.from(new Set([...tagsComp.tags, ...mut.addedTags]));
              nextState = addComponent(nextState, areaEntId, { ...tagsComp, tags: newTags });
            }
          }
          if (mut.budgetModifier) {
            const budgetComp = getComponent(nextState, areaEntId, ComponentType.DirectorBudget) as
              | import('../types/components.types.ts').DirectorBudgetComponent
              | undefined;
            if (budgetComp) {
              nextState = addComponent(nextState, areaEntId, {
                ...budgetComp,
                budgetModifier: budgetComp.budgetModifier + mut.budgetModifier
              });
            }
          }
        }

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
    }

    // Increment compromise score for all active minions
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

/**
 * Attempts to find a target NPC or create a background token minion to join the scheme.
 */
function recruitMinion(
  state: GameState,
  mastermindId: EntityId,
  schemeComponent: SchemeComponent,
  archetype: VillainArchetype
): GameState {
  const currentPhaseDef = schemeComponent.phases[schemeComponent.currentPhase];

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

  // Create the minion via spawnEntity to generate its inventory, stats, and traits properly.
  // We spawn at 0,0 and immediately remove the Position component so it is off-map.
  let nextState = state;
  const [spawnedState, minionId] = spawnEntity(nextState, templateId, 0, 0);
  nextState = spawnedState;
  nextState = removeComponent(nextState, minionId, ComponentType.Position);

  const personalityKeys = Object.keys(state.campaign.personalityGeneration);
  const personalityTable =
    personalityKeys.length > 0 ? state.campaign.personalityGeneration[personalityKeys[0]!] : undefined;

  // Roll facets for MemoryComponent
  const facets: Record<string, number> = {};
  if (personalityTable?.facets) {
    for (const facet of personalityTable.facets) {
      facets[facet] = ROT.RNG.getUniformInt(0, 100);
    }
  }

  // Preserve any memory stats generated by spawnEntity
  const existingMemory = getComponent(nextState, minionId, ComponentType.Memory) as MemoryComponent | undefined;
  const memory: MemoryComponent = {
    type: ComponentType.Memory,
    grudges: existingMemory?.grudges || [],
    factionStandings: existingMemory?.factionStandings || {},
    facts: existingMemory?.facts || [],
    knowledge: existingMemory?.knowledge || {},
    facets: Object.keys(facets).length > 0 ? facets : existingMemory?.facets || {},
    compromiseScore: 0
  };
  nextState = addComponent(nextState, minionId, memory);

  // Pick a leverage based on weights & personality facets
  const mappings = personalityTable?.leverageMappings;
  let bestLeverage: 'money' | 'ideology' | 'coercion' | 'ego' = 'money';
  let bestScore = -1;

  const leverageEntries = Object.entries(archetype.recruitmentPreferences.leverageWeight);
  if (leverageEntries.length > 0) {
    for (const [leverage, baseWeight] of leverageEntries) {
      let score = baseWeight;
      const mappedFacets = mappings?.[leverage as 'money' | 'ideology' | 'coercion' | 'ego'] || [];
      for (const f of mappedFacets) {
        score += (facets[f] || 0) * 0.5;
      }
      if (score > bestScore) {
        bestScore = score;
        bestLeverage = leverage as 'money' | 'ideology' | 'coercion' | 'ego';
      }
    }
  }
  const leverageUsed = bestLeverage;

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

  // Send the minion (and its generated inventory/equipment) to Limbo targeting targetAreaId
  nextState = moveToLimbo(nextState, minionId, targetAreaId);

  return nextState;
}
