import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel
} from '../progression.ts';
import { collectClassChoiceFeats } from '../progression/ledger_choices.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import type { AbilityId, DnD35EntityData, HitDieTrack } from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { LevelUpChoice } from './builder_core.ts';

/**
 * Builds a `PrerequisiteEvalContext` snapshot for an actor (`DnD35EntityData`) so feats and
 * Prestige Classes can be validated via `evaluatePrerequisiteAST()`.
 *
 * @param dndData The actor's `DnD35EntityData`.
 * @param classRegistry Loaded D&D 3.5e class definitions.
 * @returns `PrerequisiteEvalContext`.
 */
export function buildPrerequisiteContextForActor(
  dndData: DnD35EntityData,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>
): PrerequisiteEvalContext {
  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };

  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let totalCasterLevel = 0;

  for (const track of dndData.tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef || classDef.castingMode === 'none') continue;
    totalCasterLevel += track.levels;
    const row = classDef.progression.find((r) => r.level === track.levels);
    if (!row || !row.spellsPerDay) continue;
    let highestSlot = 0;
    for (const [lvlKey, slots] of Object.entries(row.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (classDef.castingTradition === 'arcane' && highestSlot > maxArcaneSpellLevel) {
      maxArcaneSpellLevel = highestSlot;
    } else if (classDef.castingTradition === 'divine' && highestSlot > maxDivineSpellLevel) {
      maxDivineSpellLevel = highestSlot;
    }
  }

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: dndData.skillRanks,
    feats: dndData.feats,
    tags: projectDnD35ActorSemanticTags(dndData),
    casterLevel: totalCasterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel,
    maxDivineSpellLevel
  };
}

/**
 * Builds a forward-projected `PrerequisiteEvalContext` representing the actor *after* applying the current level-up
 * choice (ability score increase, advanced class BAB/saves, added skill ranks, and feats granted or selected this level).
 *
 * @param dndData Current entity data before level-up.
 * @param choice The current level-up selection.
 * @param classDef Class definition of the advancing class.
 * @param sysContent Complete system content.
 * @param accumulatedFeatsThisLevel Feats chosen in earlier slots of the same level-up.
 * @returns Post-level-up `PrerequisiteEvalContext`.
 */
export function buildPostLevelUpPrerequisiteContext(
  dndData: DnD35EntityData,
  choice: LevelUpChoice,
  classDef: DnD35ClassDefinition,
  sysContent: DnD35SystemContent,
  accumulatedFeatsThisLevel: ReadonlyArray<string> = []
): PrerequisiteEvalContext {
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };
  if (choice.abilityScoreIncrease && abilityScores[choice.abilityScoreIncrease] !== null) {
    abilityScores[choice.abilityScoreIncrease] = (abilityScores[choice.abilityScoreIncrease] as number) + 1;
  }

  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  const simulatedTracks: HitDieTrack[] = dndData.tracks.map((t) =>
    t.trackId === classDef.id ? buildHitDieTrackFromClass(classDef, nextClassLevel) : t
  );
  if (!existingTrack) {
    simulatedTracks.push(buildHitDieTrackFromClass(classDef, 1));
  }

  const conMod = computeAbilityModifier(abilityScores.con);
  const chassis = aggregateProgressionChassis(simulatedTracks, conMod, dndData.levelAdjustment ?? 0);

  const simulatedSkills: Record<string, number> = { ...dndData.skillRanks };
  for (const [skillId, ranks] of Object.entries(choice.addedSkillRanks)) {
    if (ranks > 0) {
      simulatedSkills[skillId] = (simulatedSkills[skillId] ?? 0) + ranks;
    }
  }

  const activeTags = projectDnD35ActorSemanticTags(dndData);
  const activeFeatures = collectClassFeaturesUpToLevel(classDef, nextClassLevel, [
    ...(dndData.selectedAcfs ?? []),
    ...(choice.selectedAcfs ?? [])
  ]);
  const choiceFeats = collectClassChoiceFeats(
    [...(dndData.activeClassFeatures ?? []), ...activeFeatures],
    dndData.domains ?? [],
    choice.deityFavoredWeaponId ?? dndData.deityFavoredWeaponId,
    choice.combatStyle ?? dndData.combatStyle,
    choice.familiarId ?? dndData.familiarId,
    dndData.companions,
    dndData.scalingPools ?? {},
    [...(dndData.rogueSpecialAbilities ?? []), ...(choice.rogueSpecialAbility ? [choice.rogueSpecialAbility] : [])],
    sysContent,
    activeTags
  );

  const simulatedFeats: string[] = [...(dndData.feats ?? []), ...choiceFeats, ...accumulatedFeatsThisLevel];
  const row = classDef.progression.find((r) => r.level === nextClassLevel);
  if (row?.features) {
    for (const featKey of row.features) {
      const featDetail = classDef.featureDetails[featKey];
      if (featDetail?.grantedFeats) {
        simulatedFeats.push(...featDetail.grantedFeats);
      }
    }
  }

  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let totalCasterLevel = 0;

  for (const track of simulatedTracks) {
    const cDef = sysContent.classes[track.trackId];
    if (!cDef || cDef.castingMode === 'none') continue;
    totalCasterLevel += track.levels;
    const pRow = cDef.progression.find((r) => r.level === track.levels);
    if (!pRow || !pRow.spellsPerDay) continue;
    let highestSlot = 0;
    for (const [lvlKey, slots] of Object.entries(pRow.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (cDef.castingTradition === 'arcane' && highestSlot > maxArcaneSpellLevel) {
      maxArcaneSpellLevel = highestSlot;
    } else if (cDef.castingTradition === 'divine' && highestSlot > maxDivineSpellLevel) {
      maxDivineSpellLevel = highestSlot;
    }
  }

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: simulatedSkills,
    feats: Array.from(new Set(simulatedFeats)),
    tags: activeTags,
    casterLevel: totalCasterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel,
    maxDivineSpellLevel
  };
}
