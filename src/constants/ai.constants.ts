import { type AIProfile } from '../types/ai.types.ts';

export const enum AIBehaviorId {
  Hunt = 'hunt',
  Wander = 'wander',
  Flee = 'flee',
  Ranged = 'ranged',
  Spell = 'spell'
}

export const enum AIProfileId {
  MeleeAggressive = 'melee_aggressive',
  MeleeCoward = 'melee_coward',
  RangedArcher = 'ranged_archer',
  CasterMage = 'caster_mage'
}

/**
 * Data-driven AI profiles that compose different behaviors.
 * Read by the AI system during an entity's turn.
 */
export const AI_PROFILES: Readonly<Record<string, AIProfile>> = {
  [AIProfileId.MeleeAggressive]: {
    id: AIProfileId.MeleeAggressive,
    behaviors: [
      { behaviorId: AIBehaviorId.Hunt, params: { aggroRadius: 5 } },
      { behaviorId: AIBehaviorId.Wander, params: {} }
    ]
  },
  [AIProfileId.MeleeCoward]: {
    id: AIProfileId.MeleeCoward,
    behaviors: [
      { behaviorId: AIBehaviorId.Flee, params: { threshold: 0.3 } },
      { behaviorId: AIBehaviorId.Hunt, params: { aggroRadius: 5 } },
      { behaviorId: AIBehaviorId.Wander, params: {} }
    ]
  },
  [AIProfileId.RangedArcher]: {
    id: AIProfileId.RangedArcher,
    behaviors: [
      { behaviorId: AIBehaviorId.Flee, params: { threshold: 0.3 } },
      { behaviorId: AIBehaviorId.Ranged, params: { range: 6 } },
      { behaviorId: AIBehaviorId.Hunt, params: { aggroRadius: 6 } },
      { behaviorId: AIBehaviorId.Wander, params: {} }
    ]
  },
  [AIProfileId.CasterMage]: {
    id: AIProfileId.CasterMage,
    behaviors: [
      { behaviorId: AIBehaviorId.Flee, params: { threshold: 0.4 } },
      {
        behaviorId: AIBehaviorId.Spell,
        params: {
          abilities: [
            { effectId: 'scroll_confusion', range: 5, cooldown: 10 },
            { effectId: 'scroll_lightning', range: 8, cooldown: 5 }
          ]
        }
      },
      { behaviorId: AIBehaviorId.Hunt, params: { aggroRadius: 8 } },
      { behaviorId: AIBehaviorId.Wander, params: {} }
    ]
  }
};
