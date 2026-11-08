import { rng } from '../core/rng.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { Quest } from '../types/quests.types.ts';

interface ProceduralTargetCandidate {
  readonly id: string;
  readonly name: string;
  readonly wikiLink: string;
}

/**
 * Procedurally generates a quest from templates, assigning random targets and objectives.
 */
export function generateProceduralQuest(
  state: GameState,
  templateId: string
): { nextState: GameState; questId: string | null } {
  const template = state.campaign.questTemplates[templateId];
  if (!template) {
    console.error(`Procedural quest template ${templateId} not found.`);
    return { nextState: state, questId: null };
  }

  let validTargets: ProceduralTargetCandidate[] = [];

  if (template.objectiveType === 'gather') {
    validTargets = Object.values(state.campaign.items)
      .filter((itemDef) => {
        if (template.targetTags && template.targetTags.length > 0) {
          const itemTags = itemDef.tags ?? [];
          return template.targetTags.some((tag) => itemTags.includes(tag));
        }
        return true;
      })
      .map((itemDef) => ({
        id: itemDef.id,
        name: itemDef.name,
        wikiLink: `[${itemDef.name}](item:${itemDef.id})`
      }));
  } else if (template.objectiveType === 'explore') {
    validTargets = Object.values(state.campaign.areas)
      .filter((areaDef) => {
        if (areaDef.id === state.currentAreaId) return false;
        if (template.targetTags && template.targetTags.length > 0) {
          const areaTags = areaDef.tags ?? [];
          return template.targetTags.some((tag) => areaTags.includes(tag));
        }
        return true;
      })
      .map((areaDef) => ({
        id: areaDef.id,
        name: areaDef.name,
        wikiLink: areaDef.name
      }));
  } else {
    validTargets = Object.values(state.campaign.entities)
      .filter((entityDef) => {
        if (!entityDef.isActor || entityDef.id === 'player') return false;
        if (template.targetTags && template.targetTags.length > 0) {
          const entityTags = entityDef.tags ?? [];
          const roleTags = entityDef.roleTags ?? [];
          const encounterTags = entityDef.encounterTags ?? [];
          const factionTag = entityDef.faction ? [entityDef.faction] : [];
          const allTags = [...entityTags, ...roleTags, ...encounterTags, ...factionTag];
          const hasMatchingTag = template.targetTags.some((tag) => allTags.includes(tag));
          if (!hasMatchingTag) return false;
        }
        if (template.targetFactions && template.targetFactions.length > 0) {
          if (!entityDef.faction || !template.targetFactions.includes(entityDef.faction)) {
            return false;
          }
        }
        return true;
      })
      .map((entityDef) => ({
        id: entityDef.id,
        name: entityDef.name,
        wikiLink: `[${entityDef.name}](entity:${entityDef.id})`
      }));
  }

  if (validTargets.length === 0) {
    console.warn(`No valid targets found for quest template ${templateId}.`);
    return { nextState: state, questId: null };
  }

  // Pick random target
  const targetDef = rng.getItem(validTargets);
  if (!targetDef) {
    return { nextState: state, questId: null };
  }

  // Pick random amount
  const [min, max] = template.amountRange;
  const amount = template.objectiveType === 'explore' ? 1 : Math.floor(rng.getUniform() * (max - min + 1)) + min;

  // Construct strings
  const title = template.titleTemplate
    .replace('{targetName}', targetDef.wikiLink)
    .replace('{amount}', amount.toString());

  const description = template.descriptionTemplate
    .replace('{targetName}', targetDef.wikiLink)
    .replace('{amount}', amount.toString());

  // Determine reward (e.g. 50 XP * amount)
  const xpReward = Math.floor(amount * template.rewardXpMultiplier);

  const questId = `dyn_${templateId}_${state.nextQuestId}`;

  const quest: Quest = {
    id: questId,
    title,
    description,
    objectives: [
      {
        id: `obj_0`,
        description: `${template.objectiveType} ${amount} ${targetDef.wikiLink}`,
        type: template.objectiveType,
        targetId: targetDef.id,
        requiredAmount: amount
      }
    ],
    rewards: [
      {
        type: 'xp',
        amount: xpReward
      }
    ]
  };

  const nextDynamicQuests = { ...state.dynamicQuests, [questId]: quest };

  return {
    nextState: {
      ...state,
      nextQuestId: state.nextQuestId + 1,
      dynamicQuests: nextDynamicQuests
    },
    questId
  };
}
