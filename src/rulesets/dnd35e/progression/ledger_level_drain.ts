import { addComponent, getComponent } from '../../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from '../progression.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35CharacterLevelRecord, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { buildNegativeLevelModifiers, HP_PENALTY_PER_NEGATIVE_LEVEL } from './ledger_features_spells.ts';

/**
 * Applies permanent level drain to an actor, popping the last `levelsDrained` records
 * from their chronological levelHistory and rebuilding actor state on the fly.
 */
export function applyPermanentLevelDrainToActor(
  state: GameState,
  entityId: EntityId,
  levelsDrained: number,
  rebuildFn: (
    data: DnD35EntityData,
    history: ReadonlyArray<DnD35CharacterLevelRecord>,
    content: DnD35SystemContent
  ) => DnD35EntityData
): { readonly state: GameState; readonly success: boolean; readonly errorReason?: string } {
  const sysContent = state.campaign.systemContent as DnD35SystemContent | undefined;
  if (!sysContent || !sysContent.classes) {
    return { state, success: false, errorReason: 'D&D 3.5e system content not loaded.' };
  }
  const dndData = getDnD35EntityData(state, entityId);
  const history = dndData.levelHistory ?? [];
  if (history.length === 0) {
    return { state, success: false, errorReason: 'Actor has no levelHistory to drain.' };
  }

  const drainCount = Math.max(1, Math.floor(levelsDrained));
  const remainingCount = Math.max(0, history.length - drainCount);
  const updatedHistory = history.slice(0, remainingCount);

  const updatedData = rebuildFn(dndData, updatedHistory, sysContent);
  const nextState = setDnD35EntityData(state, entityId, updatedData);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) {
    return { state: nextState, success: true };
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);

  const newXpFloor = computeXpThresholdForLevel(chassis.ecl);
  return {
    state: addComponent(nextState, entityId, {
      ...fighter,
      level: chassis.ecl,
      maxHp: chassis.maxHp,
      hp: Math.min(fighter.hp, chassis.maxHp),
      attack: chassis.totalBab,
      xp: Math.min(fighter.xp, newXpFloor)
    }),
    success: true
  };
}

/**
 * Applies temporary negative levels to an actor.
 */
export function applyNegativeLevelsToActor(state: GameState, entityId: EntityId, negativeLevels: number): GameState {
  const sysContent = state.campaign.systemContent as DnD35SystemContent | undefined;
  if (!sysContent) return state;
  const dndData = getDnD35EntityData(state, entityId);
  const count = Math.max(0, Math.floor(negativeLevels));

  const nonNegMods = (dndData.statModifiers ?? []).filter(
    (m) => !(m.sourcePath ?? '').startsWith('condition:negative_level')
  );
  const negMods = buildNegativeLevelModifiers(count);

  const updatedData: DnD35EntityData = {
    ...dndData,
    negativeLevels: count,
    statModifiers: [...nonNegMods, ...negMods]
  };

  const nextState = setDnD35EntityData(state, entityId, updatedData);
  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return nextState;

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);
  const effectiveMaxHp = Math.max(1, chassis.maxHp - count * HP_PENALTY_PER_NEGATIVE_LEVEL);

  return addComponent(nextState, entityId, {
    ...fighter,
    maxHp: effectiveMaxHp,
    hp: Math.min(fighter.hp, effectiveMaxHp),
    attack: Math.max(0, chassis.totalBab - count)
  });
}
