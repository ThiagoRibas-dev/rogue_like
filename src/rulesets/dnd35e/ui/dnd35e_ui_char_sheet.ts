/**
 * @file D&D 3.5e Character Sheet Data Projector (`UICharacterSheetModel`).
 * Evaluates actor DAG, chassis, skills, attack groups, saving throws, and level matrix.
 */

import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentSlotInstance,
  type FighterComponent,
  type IdentityComponent,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type {
  UICharacterSheetModel,
  UILevelHistoryRowModel,
  UISkillRowModel
} from '../../../types/ui_adapter.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { getActorEverClassSkillIds } from '../builder/builder_core.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from '../progression.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { AbilityId, AbilityScoreState, DnD35EntityData, StatModifier } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { ACTIVE_SKILL_IDS } from './dnd35e_ui_hotbar.ts';
import { buildActorFeatureEntries, buildAttackGroupsFromStrikes } from './dnd35e_ui_projection.ts';

const DEFAULT_ABILITY_SCORE = 10;
const BASE_AC_SCORE = 10;
const SYNERGY_RANK_THRESHOLD = 5;
const SYNERGY_BONUS_PER_SKILL = 2;
const FEAR_SKILL_PENALTY = -2;

export type EvaluatedDnD35EntityResult = ReturnType<typeof evaluateDnD35eEntityDAG>;

export interface DnD35AdapterContext {
  readonly state: GameState;
  readonly entityId: EntityId;
  readonly evalResult?: EvaluatedDnD35EntityResult | undefined;
}

export interface DnD35ExtendedActorData extends Partial<DnD35EntityData> {
  readonly name?: string | undefined;
  readonly hpCurrent?: number | undefined;
  readonly goldCurrency?: number | undefined;
  readonly equipmentSlots?: ReadonlyArray<EquipmentSlotInstance> | undefined;
  readonly doctrine?: TacticalDoctrineComponent | undefined;
  readonly resourcePools?: ResourcePoolComponent | undefined;
}

export function isAdapterContext(actor: unknown): actor is DnD35AdapterContext {
  return (
    typeof actor === 'object' &&
    actor !== null &&
    'state' in actor &&
    'entityId' in actor &&
    typeof (actor as { entityId: unknown }).entityId === 'number'
  );
}

export function resolveAbilityScore(scoreState: AbilityScoreState | undefined): number {
  return scoreState ? (computeEffectiveAbilityScore(scoreState) ?? DEFAULT_ABILITY_SCORE) : DEFAULT_ABILITY_SCORE;
}

export function extractActorContext(actor: unknown): {
  readonly state?: GameState | undefined;
  readonly entityId?: EntityId | undefined;
  readonly preEvalResult?: EvaluatedDnD35EntityResult | undefined;
  readonly dndData: DnD35ExtendedActorData;
} {
  if (isAdapterContext(actor)) {
    return {
      state: actor.state,
      entityId: actor.entityId,
      preEvalResult: actor.evalResult,
      dndData: getDnD35EntityData(actor.state, actor.entityId)
    };
  }
  const raw = (actor ?? {}) as Record<string, unknown>;
  const dndData =
    typeof raw['dnd35e'] === 'object' && raw['dnd35e'] !== null
      ? (raw['dnd35e'] as DnD35ExtendedActorData)
      : (raw as DnD35ExtendedActorData);
  return { dndData };
}

function computePassiveSkillModifier(
  skill: {
    readonly id: string;
    readonly keyAbility: AbilityId;
    readonly synergyFromSkills?: ReadonlyArray<string> | undefined;
  },
  ranks: number,
  allSkillRanks: Readonly<Record<string, number>>,
  abilityMod: number,
  statModifiers: ReadonlyArray<StatModifier>,
  conditions: ReadonlyArray<string>
): { readonly totalModifier: number; readonly miscModifier: number } {
  let synergyBonus = 0;
  for (const sourceSkillId of skill.synergyFromSkills ?? []) {
    if ((allSkillRanks[sourceSkillId] ?? 0) >= SYNERGY_RANK_THRESHOLD) {
      synergyBonus += SYNERGY_BONUS_PER_SKILL;
    }
  }
  let statSkillBonus = 0;
  const targetKey = `skill:${skill.id}`;
  for (const mod of statModifiers) {
    if (mod.targetStat === targetKey || mod.targetStat === 'skills') {
      statSkillBonus += mod.value;
    }
  }
  const fearPenalty =
    conditions.includes('shaken') || conditions.includes('frightened') || conditions.includes('panicked')
      ? FEAR_SKILL_PENALTY
      : 0;
  const miscModifier = synergyBonus + statSkillBonus + fearPenalty;
  return {
    totalModifier: ranks + abilityMod + miscModifier,
    miscModifier
  };
}

export function projectCharacterSheetData(actor: unknown): UICharacterSheetModel {
  const { state, entityId, preEvalResult, dndData } = extractActorContext(actor);
  const evalResult =
    preEvalResult ?? (state && entityId !== undefined ? evaluateDnD35eEntityDAG(state, entityId) : undefined);
  const identity =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined)
      : undefined;
  const fighter =
    state && entityId !== undefined
      ? (getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined)
      : undefined;
  const sys = state ? getDnD35SystemContent(state.campaign) : undefined;

  const raw = evalResult?.dndData.abilityScores ?? dndData.abilityScores;
  const effAb = evalResult?.dagResult.effectiveAbilities;
  const effMod = evalResult?.dagResult.effectiveAbilityModifiers;
  const scoreOf = (k: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'): number =>
    effAb?.[k].base ?? resolveAbilityScore(raw?.[k]);

  const str = scoreOf('str');
  const dex = scoreOf('dex');
  const con = scoreOf('con');
  const int = scoreOf('int');
  const wis = scoreOf('wis');
  const cha = scoreOf('cha');
  const strMod = effMod?.str ?? computeAbilityModifier(str);
  const dexMod = effMod?.dex ?? computeAbilityModifier(dex);
  const conMod = effMod?.con ?? computeAbilityModifier(con);
  const intMod = effMod?.int ?? computeAbilityModifier(int);
  const wisMod = effMod?.wis ?? computeAbilityModifier(wis);
  const chaMod = effMod?.cha ?? computeAbilityModifier(cha);

  const tracks = dndData.tracks ?? [];
  const chassis = aggregateProgressionChassis(tracks, conMod, dndData.levelAdjustment ?? 0);
  const attackGroups = buildAttackGroupsFromStrikes(
    evalResult?.attackRoutine.strikes ?? [],
    dndData,
    chassis.totalBab,
    strMod
  );

  const primaryClassId = tracks[0]?.trackId ?? 'fighter';
  const everClassSkills = sys
    ? new Set(getActorEverClassSkillIds(dndData as DnD35EntityData, primaryClassId, dndData.domains ?? [], sys))
    : new Set<string>();
  const allRanks = dndData.skillRanks ?? {};
  const statModifiers = evalResult?.dndData.statModifiers ?? dndData.statModifiers ?? [];
  const conditions = dndData.conditions ?? [];
  const skillRows: UISkillRowModel[] =
    sys && state && entityId !== undefined
      ? Object.values(sys.skills).map((skill) => {
          const ranks = allRanks[skill.id] ?? 0;
          const abMod = effMod?.[skill.keyAbility] ?? 0;
          const { totalModifier, miscModifier } = computePassiveSkillModifier(
            skill,
            ranks,
            allRanks,
            abMod,
            statModifiers,
            conditions
          );
          return {
            id: skill.id,
            name: skill.name,
            keyAbility: skill.keyAbility.toUpperCase(),
            totalModifier,
            ranks,
            abilityModifier: abMod,
            miscModifier,
            isClassSkill: everClassSkills.has(skill.id),
            isUsableActive: ACTIVE_SKILL_IDS.has(skill.id)
          };
        })
      : Object.entries(allRanks).map(([id, ranks]) => ({
          id,
          name: id.replace(/_/g, ' ').toUpperCase(),
          keyAbility: 'DEX',
          totalModifier: ranks + dexMod,
          ranks,
          abilityModifier: dexMod,
          miscModifier: 0,
          isClassSkill: true,
          isUsableActive: ACTIVE_SKILL_IDS.has(id)
        }));

  const levelHistory: UILevelHistoryRowModel[] =
    (dndData.levelHistory ?? []).length > 0
      ? (dndData.levelHistory ?? []).map((e) => ({
          level: e.characterLevel,
          classAndLevel: `${e.classId} ${e.classLevel}`,
          hitDieRoll: e.hpRolled,
          skillPointsSpent: Object.values(e.addedSkillRanks ?? {}).reduce((a: number, b: number) => a + b, 0),
          featsAndFeatures: [...e.selectedFeats, ...e.selectedAcfs].join(', ') || '—'
        }))
      : tracks.map((t, idx) => ({
          level: idx + 1,
          classAndLevel: `${t.trackId} ${t.levels}`,
          hitDieRoll: t.hitDieSides,
          skillPointsSpent: Object.values(dndData.skillRanks ?? {}).reduce((a: number, b: number) => a + b, 0),
          featsAndFeatures: (dndData.feats ?? []).join(', ') || '—'
        }));

  const ac = evalResult?.dagResult.acBreakdown;
  const saves = evalResult?.dagResult.saves;

  return {
    name: identity?.name ?? dndData.name ?? 'Adventurer',
    levelSummary: tracks.map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Level 1',
    raceName: (dndData.raceId ?? 'human').toUpperCase(),
    alignmentName: (dndData.alignment ?? 'NG').toUpperCase().replace(/_/g, ' '),
    xpCurrent: fighter?.xp ?? 0,
    xpNextLevel: computeXpThresholdForLevel(chassis.ecl + 1),
    attributes: [
      { id: 'str', name: 'STR', score: str, modifier: strMod },
      { id: 'dex', name: 'DEX', score: dex, modifier: dexMod },
      { id: 'con', name: 'CON', score: con, modifier: conMod },
      { id: 'int', name: 'INT', score: int, modifier: intMod },
      { id: 'wis', name: 'WIS', score: wis, modifier: wisMod },
      { id: 'cha', name: 'CHA', score: cha, modifier: chaMod }
    ],
    savingThrows: [
      { id: 'fortitude', name: 'Fortitude', total: saves?.fort ?? chassis.baseSaves.fort + conMod },
      { id: 'reflex', name: 'Reflex', total: saves?.ref ?? chassis.baseSaves.ref + dexMod },
      { id: 'will', name: 'Will', total: saves?.will ?? chassis.baseSaves.will + wisMod }
    ],
    hpCurrent: fighter?.hp ?? dndData.hpCurrent ?? chassis.maxHp,
    hpMax: fighter?.maxHp ?? chassis.maxHp,
    acTotal: ac?.fullAC ?? BASE_AC_SCORE + dexMod,
    touchAc: ac?.touchAC ?? BASE_AC_SCORE + dexMod,
    flatFootedAc: ac?.flatFootedAC ?? BASE_AC_SCORE,
    babTotal: chassis.totalBab,
    initiativeBonus: dexMod,
    grappleBonus: chassis.totalBab + strMod,
    combatSummary: attackGroups.map((g) => ({
      title: g.label,
      attackBonus: g.attackBonuses,
      damage: g.damageFormula,
      critRange: g.criticalProfile
    })),
    attackGroups,
    skills: skillRows.map((s) => ({
      id: s.id,
      name: s.name,
      totalModifier: s.totalModifier,
      isClassSkill: s.isClassSkill
    })),
    skillRows,
    feats: (dndData.feats ?? []).map((f) => ({
      id: f,
      name: sys?.feats?.[f]?.name ?? f.replace(/_/g, ' ').toUpperCase(),
      description: sys?.feats?.[f]?.description ?? 'SRD 3.5e Feat'
    })),
    featureEntries: buildActorFeatureEntries(dndData, sys ?? undefined, state, entityId),
    levelHistory
  };
}
