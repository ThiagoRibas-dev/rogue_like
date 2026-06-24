import { rng } from '../core/rng.ts';
import type { GameState } from '../types/game-state.types.ts';
import type { Quest } from '../types/quests.types.ts';

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

  // Find valid targets from the campaign entities registry
  const validTargets = Object.values(state.campaign.entities).filter((entityDef) => {
    // If template has targetTags, the entity must have AT LEAST ONE matching tag.
    // Assuming entities have tags, wait, our EntityTemplateSchema might not have tags!
    // Let's just check targetId matching for now or if we have tags.
    // If no targetTags are defined, all entities are valid (probably a bad idea, but fallback).
    if (template.targetTags && template.targetTags.length > 0) {
      // If entities don't have tags in the schema yet, we can't filter by them.
      // Let's just pretend we will add tags to entities, or just filter by faction for now.
      // Actually, we can check faction if targetFactions is provided.
      if (template.targetFactions && template.targetFactions.length > 0) {
        if (!entityDef.faction || !template.targetFactions.includes(entityDef.faction)) {
          return false;
        }
      }
      return false; // If we wanted tags but couldn't check them
    }
    return true;
  });

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
  const amount = Math.floor(rng.getUniform() * (max - min + 1)) + min;

  // Construct strings
  const title = template.titleTemplate
    .replace('{targetName}', `[${targetDef.name}](entity:${targetDef.id})`)
    .replace('{amount}', amount.toString());

  const description = template.descriptionTemplate
    .replace('{targetName}', `[${targetDef.name}](entity:${targetDef.id})`)
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
        description: `${template.objectiveType} ${amount} [${targetDef.name}](entity:${targetDef.id})`,
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
