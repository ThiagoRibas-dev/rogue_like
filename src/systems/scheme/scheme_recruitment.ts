import { type GameState, type EntityId } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type SchemeComponent,
  type AgreementComponent,
  type MemoryComponent,
  type PositionComponent,
  type ClueComponent,
  toItemInstanceId
} from '../../types/components.types.ts';
import { getComponent, addComponent, createEntity, removeComponent, moveToLimbo, spawnEntity } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../message.system.ts';
import { rng } from '../../core/rng.ts';
import type { VillainArchetype } from '../../types/campaign.types.ts';
import { GameEventType, type GameEvent } from '../../types/events.types.ts';

/**
 * Evaluates active minions for missing status or morale-driven confession/abandonment,
 * updating scheme conspiracy awareness and emitting SchemeEscalated if threshold reached.
 */
export function evaluateMinionMoraleAndAwareness(
  state: GameState,
  mastermindId: EntityId,
  schemeComponent: SchemeComponent
): { state: GameState; schemeComponent: SchemeComponent } {
  let nextState = state;
  const currentPhaseDef = schemeComponent.phases[schemeComponent.currentPhase];
  const currentMinions = schemeComponent.activeMinions;
  let awarenessDelta = 0;
  const validMinions: EntityId[] = [];

  for (const minionId of currentMinions) {
    const exists = nextState.entities.includes(minionId);
    if (!exists) {
      awarenessDelta += 25;
      continue;
    }

    const mem = getComponent(nextState, minionId, ComponentType.Memory) as MemoryComponent | undefined;
    if (mem && (mem.compromiseScore || 0) > 50) {
      if (rng.getUniform() < 0.5) {
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

        if (rng.getUniform() < 0.5) {
          const pos = getComponent(nextState, minionId, ComponentType.Position) as PositionComponent | undefined;
          const agreement = getComponent(nextState, minionId, ComponentType.Agreement) as
            AgreementComponent | undefined;
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
                bg: 'transparent',
                spriteId: 'scroll'
              });

              const instanceId = toItemInstanceId(`clue_item_${nextState.nextItemInstanceId}`);
              nextState = { ...nextState, nextItemInstanceId: nextState.nextItemInstanceId + 1 };

              nextState = addComponent(nextState, clueEntity, {
                type: ComponentType.Item,
                itemId: 'clue_item',
                instanceId
              });

              const narrativeVerb = currentPhaseDef?.narrativeVerb || 'operate';
              const tagsStr =
                currentPhaseDef?.evidenceTags && currentPhaseDef.evidenceTags.length > 0
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

        nextState = removeComponent(nextState, minionId, ComponentType.Agreement);
        continue;
      }
    }
    validMinions.push(minionId);
  }

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

  return { state: nextState, schemeComponent: updatedSchemeComponent };
}

/**
 * Attempts to find a target NPC or create a background token minion to join the scheme.
 */
export function recruitMinion(
  state: GameState,
  mastermindId: EntityId,
  schemeComponent: SchemeComponent,
  archetype: VillainArchetype
): GameState {
  const currentPhaseDef = schemeComponent.phases[schemeComponent.currentPhase];

  let targetAreaId = 'dungeon_1';
  if (currentPhaseDef?.mutations && currentPhaseDef.mutations.length > 0) {
    targetAreaId = currentPhaseDef.mutations[0]!.targetAreaId;
  } else {
    const areas = Object.keys(state.campaign.areas).filter((id) => id !== 'safe_hub');
    if (areas.length > 0) {
      targetAreaId = rng.getItem(areas) || 'dungeon_1';
    }
  }

  const preferredTags = archetype.recruitmentPreferences.targetTags;
  const eligibleTemplates = Object.entries(state.campaign.entities)
    .filter(([id, ent]) => {
      if (id === 'player') return false;
      return preferredTags.some((tag) => ent.tags?.includes(tag));
    })
    .map(([id]) => id);

  let templateId: string;
  if (eligibleTemplates.length > 0) {
    templateId = rng.getItem(eligibleTemplates) || 'orc';
  } else {
    templateId = 'orc';
    console.warn(`[DEBUG] Scheme recruitment pool exhausted for archetype ${archetype.id}, falling back to 'orc'`);
  }

  let nextState = state;
  const [spawnedState, minionId] = spawnEntity(nextState, templateId, 0, 0);
  nextState = spawnedState;
  nextState = removeComponent(nextState, minionId, ComponentType.Position);

  const personalityKeys = Object.keys(state.campaign.personalityGeneration);
  const personalityTable =
    personalityKeys.length > 0 ? state.campaign.personalityGeneration[personalityKeys[0]!] : undefined;

  const facets: Record<string, number> = {};
  if (personalityTable?.facets) {
    for (const facet of personalityTable.facets) {
      facets[facet] = rng.getUniformInt(0, 100);
    }
  }

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

  const agreementIds = Object.keys(state.campaign.agreements);
  const agreementId = rng.getItem(agreementIds) || 'raid_contract';

  const agreement: AgreementComponent = {
    type: ComponentType.Agreement,
    mastermindId,
    agreementId,
    leverageUsed,
    targetAreaId,
    isFulfilled: false
  };
  nextState = addComponent(nextState, minionId, agreement);

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

  nextState = moveToLimbo(nextState, minionId, targetAreaId);

  return nextState;
}
