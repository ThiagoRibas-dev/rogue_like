import { addComponent, getComponent } from '../../../core/ecs.ts';
import { ComponentType, type FighterComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { syncActorCompanionsAndFamiliars } from '../companions.ts';
import { rebuildActorStateFromLevelHistory, syncActorResourcePoolsComponent } from '../level_ledger.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';
import { evaluatePrerequisiteAST } from '../prerequisites.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35CharacterLevelRecord } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { LevelUpChoice } from './builder_core.ts';
import { buildPrerequisiteContextForActor } from './builder_validation.ts';

/**
 * Applies an interactive Level-Up choice to an actor, advancing an existing class track or
 * adding a new Base/Prestige Class track.
 */
export function applyLevelUpToActor(
  state: GameState,
  entityId: EntityId,
  choice: LevelUpChoice
): { readonly state: GameState; readonly success: boolean; readonly errorReason?: string } {
  const sysContent = getDnD35SystemContent(state.campaign);
  if (!sysContent) return { state, success: false, errorReason: 'D&D 3.5e system content not loaded.' };

  const classDef = sysContent.classes[choice.classId];
  if (!classDef) return { state, success: false, errorReason: `Unknown class "${choice.classId}".` };

  const dndData = getDnD35EntityData(state, entityId);
  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;
  if (nextClassLevel > classDef.maxLevel) {
    return {
      state,
      success: false,
      errorReason: `Cannot exceed maximum level ${classDef.maxLevel} in ${classDef.name}.`
    };
  }

  if (classDef.prerequisites) {
    const prereqCtx = buildPrerequisiteContextForActor(dndData, sysContent.classes);
    if (!evaluatePrerequisiteAST(classDef.prerequisites, prereqCtx)) {
      return { state, success: false, errorReason: `Prerequisites not met for ${classDef.name}.` };
    }
  }

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const prevChassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const nextCharLevel = prevChassis.totalHD + 1;

  const rawRoll =
    choice.hpMethod === 'roll'
      ? evaluateDiceExpression(`1d${classDef.hitDieSides}`).total
      : dndFloor(classDef.hitDieSides / 2) + 1;

  const flatLearnedSpells = new Set<string>(choice.learnedSpells ?? []);
  if (choice.learnedSpellsByClass) {
    for (const spList of Object.values(choice.learnedSpellsByClass)) {
      for (const spId of spList) flatLearnedSpells.add(spId);
    }
  }

  const newRecord: DnD35CharacterLevelRecord = {
    characterLevel: nextCharLevel,
    classId: classDef.id,
    classLevel: nextClassLevel,
    hpRolled: rawRoll,
    ...(choice.abilityScoreIncrease !== undefined ? { abilityScoreIncrease: choice.abilityScoreIncrease } : {}),
    addedSkillRanks: choice.addedSkillRanks,
    selectedFeats: choice.selectedFeats,
    selectedAcfs: choice.selectedAcfs ?? [],
    learnedSpells: Array.from(flatLearnedSpells),
    ...(choice.combatStyle !== undefined ? { combatStyle: choice.combatStyle } : {}),
    ...(choice.favoredEnemyAdded !== undefined ? { favoredEnemyAdded: choice.favoredEnemyAdded } : {}),
    ...(choice.favoredEnemyBoosted !== undefined ? { favoredEnemyBoosted: choice.favoredEnemyBoosted } : {}),
    ...(choice.rogueSpecialAbility !== undefined ? { rogueSpecialAbility: choice.rogueSpecialAbility } : {}),
    ...(choice.animalCompanionId !== undefined ? { animalCompanionId: choice.animalCompanionId } : {}),
    ...(choice.advancedSpellcastingClassIds !== undefined
      ? { advancedSpellcastingClassIds: choice.advancedSpellcastingClassIds }
      : {}),
    ...(choice.learnedSpellsByClass !== undefined ? { learnedSpellsByClass: choice.learnedSpellsByClass } : {})
  };

  let prevHistory = dndData.levelHistory ?? [];
  if (prevHistory.length === 0) {
    let charLvl = 1;
    const synthesized: DnD35CharacterLevelRecord[] = [];
    for (const track of dndData.tracks) {
      if (sysContent.classes[track.trackId]) {
        for (let l = 1; l <= track.levels; l++) {
          synthesized.push({
            characterLevel: charLvl++,
            classId: track.trackId,
            classLevel: l,
            hpRolled: track.hitDieSides,
            addedSkillRanks: {},
            selectedFeats: [],
            selectedAcfs: [],
            learnedSpells: []
          });
        }
      }
    }
    prevHistory = synthesized;
  }
  const updatedHistory = [...prevHistory, newRecord];

  let baseAbilities = dndData.abilityScores;
  if (choice.abilityScoreIncrease !== undefined) {
    const abId = choice.abilityScoreIncrease;
    const prev = baseAbilities[abId];
    if (prev.base !== null) {
      baseAbilities = { ...baseAbilities, [abId]: { ...prev, base: prev.base + 1 } };
    }
  }

  const updatedData = rebuildActorStateFromLevelHistory(
    {
      ...dndData,
      abilityScores: baseAbilities,
      ...(dndData.spentLiteracySkillPoints === true || choice.spendSkillPointsForLiteracy === true
        ? { spentLiteracySkillPoints: true }
        : {})
    },
    updatedHistory,
    sysContent
  );

  const nextConMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const hpGain = Math.max(1, rawRoll + nextConMod);
  const nextChassis = aggregateProgressionChassis(updatedData.tracks, nextConMod, updatedData.levelAdjustment ?? 0);

  let nextState = setDnD35EntityData(state, entityId, updatedData);
  nextState = syncActorResourcePoolsComponent(nextState, entityId, updatedData, sysContent);
  nextState = syncActorCompanionsAndFamiliars(nextState, entityId);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return { state: nextState, success: true };

  return {
    state: addComponent(nextState, entityId, {
      ...fighter,
      level: nextChassis.ecl,
      maxHp: fighter.maxHp + hpGain,
      hp: fighter.hp + hpGain,
      attack: nextChassis.totalBab
    }),
    success: true
  };
}
