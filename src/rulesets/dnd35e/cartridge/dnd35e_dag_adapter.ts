import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type PropertyOverlayComponent,
  type TacticalDoctrineComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { EffectiveStats } from '../../../types/ruleset.types.ts';
import {
  type DnD35ResolvedAttackRoutine,
  type NaturalWeaponLimbEntry,
  evaluateTacticalDoctrineModifiers,
  resolveActorAttackRoutine
} from '../combat/attack_resolver.ts';
import { summarizeConditionEffects } from '../combat/maneuvers_conditions.ts';
import {
  type ResolvedActorWeapons,
  resolveAllEquippedWeaponProfiles,
  resolveEquippedWeaponProfile,
  scaleWeaponDamageDice
} from '../equipment_physics.ts';
import { DND35E_BASE_AC, evaluateDnD35ActorStatDAG } from '../modifiers.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { getDnD35EntityData, getEquippedItemBonuses } from '../srd_registry.ts';
import type {
  DnD35EntityData,
  DnD35ResolvedActorStats,
  StatModifier,
  StatQueryContext
} from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';

/** Default movement speed for uninitialized entities. */
const DND35E_DEFAULT_SPEED = 100;

/** Full entity DAG evaluation result including hydrated `DnD35EntityData` and tactical doctrine attack eligibility. */
export interface DnD35EntityDAGResult {
  readonly dndData: DnD35EntityData;
  readonly dagResult: DnD35ResolvedActorStats;
  readonly selfTags: ReadonlyArray<string>;
  readonly canAttack: boolean;
  readonly resolvedWeapons: ResolvedActorWeapons;
  readonly attackRoutine: DnD35ResolvedAttackRoutine;
}

/**
 * Evaluates the full 4-Stage Topological Sub-Stat DAG for an entity in `GameState`,
 * incorporating active `PropertyOverlayComponent`s, equipped item bonuses, `TacticalDoctrineComponent`,
 * condition penalties, and optional contextual query flags (e.g. `targetTags` during combat).
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param contextOverride Optional `StatQueryContext` (such as `targetTags` or `inAntimagicField`).
 * @param prehydrated Optional pre-resolved `{ dndData, selfTags }` to avoid redundant hydration.
 * @returns `DnD35EntityDAGResult` or `undefined` if the entity lacks a `FighterComponent`.
 */
export function evaluateDnD35eEntityDAG(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext,
  prehydrated?: { readonly dndData: DnD35EntityData; readonly selfTags: ReadonlyArray<string> }
): DnD35EntityDAGResult | undefined {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) {
    return undefined;
  }
  const actor = getComponent(state, entityId, ComponentType.Actor);

  const dndData =
    prehydrated?.dndData ??
    resolveEffectiveEntityDataWithOverlays(
      getDnD35EntityData(state, entityId),
      getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
    );
  const existingTags = (getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const situationalContext = resolveEntitySituationalTagContext(state, entityId, dndData);
  const sysContent = getDnD35SystemContent(state.campaign);
  const selfTags =
    prehydrated?.selfTags ??
    projectDnD35ActorSemanticTags(dndData, existingTags, situationalContext, sysContent?.classes, sysContent?.skills);
  const condSummary = summarizeConditionEffects(dndData.conditions);

  const rawChassis = aggregateProgressionChassis(dndData.tracks, 0);
  const { equipAttackBonus, equipArmorBonus } = getEquippedItemBonuses(state, entityId);
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const hasSkillTumbleMod = (dndData.statModifiers ?? []).some((m) => (m.sourcePath ?? '').startsWith('skill:tumble'));
  const effectiveTumbleRanks = hasSkillTumbleMod ? 0 : (dndData.skillRanks['tumble'] ?? 0);
  const mainHandProfile = resolveEquippedWeaponProfile(state, entityId, 'main_hand');
  const doctrineMod = doctrine
    ? evaluateTacticalDoctrineModifiers(doctrine, rawChassis.totalBab, mainHandProfile.handedness, effectiveTumbleRanks)
    : { attackPenalty: 0, damageBonus: 0, dodgeAcBonus: 0, canAttack: true };

  const extraModifiers: StatModifier[] = [...(dndData.statModifiers ?? [])];

  if (equipAttackBonus !== 0) {
    extraModifiers.push({
      targetStat: 'attack',
      value: equipAttackBonus,
      bonusType: 'enhancement',
      sourceId: 'equipment_attack',
      sourcePath: 'item:weapon/enhancement',
      origin: 'mundane'
    });
  }
  if (doctrineMod.dodgeAcBonus > 0) {
    extraModifiers.push({
      targetStat: 'ac',
      value: doctrineMod.dodgeAcBonus,
      bonusType: 'dodge',
      sourceId: 'tactical_doctrine',
      sourcePath: 'stance:doctrine/dodge_ac',
      origin: 'ex'
    });
  }
  if (doctrineMod.attackPenalty !== 0) {
    extraModifiers.push({
      targetStat: 'attack',
      value: doctrineMod.attackPenalty,
      bonusType: 'untyped',
      sourceId: 'tactical_doctrine',
      sourcePath: 'stance:doctrine/attack_penalty',
      origin: 'ex'
    });
  }
  if (doctrineMod.damageBonus !== 0) {
    extraModifiers.push({
      targetStat: 'damage',
      value: doctrineMod.damageBonus,
      bonusType: 'untyped',
      sourceId: 'tactical_doctrine',
      sourcePath: 'stance:doctrine/damage_bonus',
      origin: 'ex'
    });
  }
  if (condSummary.acPenalty !== 0) {
    extraModifiers.push({
      targetStat: 'ac',
      value: condSummary.acPenalty,
      bonusType: 'untyped',
      sourceId: 'conditions',
      sourcePath: 'condition:status/ac_penalty',
      origin: 'ex'
    });
  }
  if (condSummary.meleeAttackPenalty !== 0) {
    extraModifiers.push({
      targetStat: 'attack',
      value: condSummary.meleeAttackPenalty,
      bonusType: 'untyped',
      sourceId: 'conditions',
      sourcePath: 'condition:status/attack_penalty',
      origin: 'ex'
    });
  }

  const isIncorporeal = dndData.subtypes?.includes('incorporeal') === true;
  const stanceTags: string[] = [];
  if (doctrine?.totalDefense === true) {
    stanceTags.push('stance:total_defense');
  } else if (doctrine?.fightingDefensively === true) {
    stanceTags.push('stance:fighting_defensively');
  }
  const mergedSelfTags = Array.from(new Set([...selfTags, ...stanceTags, ...(contextOverride?.selfTags ?? [])]));

  const dagResult = evaluateDnD35ActorStatDAG({
    baseSize: dndData.sizeCategory,
    rawAbilities: {
      str: {
        ...dndData.abilityScores.str,
        tempPenalty: dndData.abilityScores.str.tempPenalty + condSummary.strPenalty
      },
      dex: {
        ...dndData.abilityScores.dex,
        tempPenalty: dndData.abilityScores.dex.tempPenalty + condSummary.dexPenalty
      },
      con: dndData.abilityScores.con,
      int: dndData.abilityScores.int,
      wis: dndData.abilityScores.wis,
      cha: dndData.abilityScores.cha
    },
    tracks: dndData.tracks,
    baseNaturalArmor: dndData.naturalArmorBonus,
    armorBonus: Math.max(dndData.armorBonus, equipArmorBonus),
    shieldBonus: dndData.shieldBonus,
    baseMaxHp: fighter.maxHp > 0 ? fighter.maxHp : undefined,
    baseSpeed: actor?.speed ?? DND35E_DEFAULT_SPEED,
    isIncorporeal,
    hasUncannyDodge:
      (!condSummary.losesDexToAC &&
        (!mergedSelfTags.includes('self:balancing') || mergedSelfTags.includes('trait:balance_uncanny_flat_footed'))) ||
      mergedSelfTags.includes('feature:uncanny_dodge'),
    statModifiers: extraModifiers,
    context: {
      ...contextOverride,
      selfTags: mergedSelfTags
    }
  });

  // Stage 4 DAG: Resolve equipped weapons, grip mode, occupied limbs, and complete attack routine
  const resolvedWeapons = resolveAllEquippedWeaponProfiles(state, entityId, dagResult.effectiveSize);

  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const handSlotLimbGroups: string[] = [];
  for (const s of equipment?.slots ?? []) {
    if (
      s.suppressed !== true &&
      s.limbGroupId !== undefined &&
      (s.slotType === 'held' ||
        s.slotType === 'hand' ||
        s.slotType === 'main_hand' ||
        s.slotType === 'off_hand' ||
        s.id.startsWith('hand_') ||
        s.id.startsWith('main_hand') ||
        s.id.startsWith('off_hand')) &&
      !handSlotLimbGroups.includes(s.limbGroupId)
    ) {
      handSlotLimbGroups.push(s.limbGroupId);
    }
  }
  const availableHandLimbs = handSlotLimbGroups.length > 0 ? handSlotLimbGroups : ['hand_main', 'hand_off'];

  const naturalLimbs: NaturalWeaponLimbEntry[] = [];
  for (const nw of dndData.naturalWeapons ?? []) {
    const scaledDice = scaleWeaponDamageDice(nw.damageDice, dndData.sizeCategory, dagResult.effectiveSize);
    if ((nw.naturalType === 'claw' || nw.naturalType === 'slam') && nw.count > 1) {
      for (let cIdx = 0; cIdx < nw.count; cIdx++) {
        const limbGroupId = availableHandLimbs[cIdx] ?? (cIdx === 0 ? 'hand_main' : `hand_off_${cIdx}`);
        naturalLimbs.push({
          id: nw.id,
          name: nw.name,
          isPrimary: nw.isPrimary,
          count: 1,
          limbGroupId,
          dice: scaledDice,
          damageType: nw.damageType,
          critThreatMin: nw.critThreatMin,
          critMultiplier: nw.critMultiplier
        });
      }
      continue;
    }

    let limbGroupId: string | undefined;
    if (nw.naturalType === 'claw' || nw.naturalType === 'slam') {
      limbGroupId = availableHandLimbs[0] ?? 'hand_main';
    } else if (nw.naturalType === 'bite' || nw.naturalType === 'gore') {
      limbGroupId = 'head';
    }
    naturalLimbs.push({
      id: nw.id,
      name: nw.name,
      isPrimary: nw.isPrimary,
      count: nw.count,
      limbGroupId,
      dice: scaledDice,
      damageType: nw.damageType,
      critThreatMin: nw.critThreatMin,
      critMultiplier: nw.critMultiplier
    });
  }

  const strMod = dagResult.effectiveAbilityModifiers.str;
  const baseActorAttackBonus = dagResult.attackBonus - equipAttackBonus - doctrineMod.attackPenalty;
  const nonStrNonDoctrineFlatDamage = dagResult.damageBonus - strMod - doctrineMod.damageBonus;

  const attackRoutine = resolveActorAttackRoutine({
    resolvedWeapons,
    naturalWeapons: naturalLimbs,
    totalBab: rawChassis.totalBab,
    baseAttackModifier: baseActorAttackBonus,
    strModifier: strMod,
    doctrine,
    flatDamageBonus: nonStrNonDoctrineFlatDamage,
    hasTwoWeaponFightingFeat: dndData.feats?.includes('two_weapon_fighting') === true,
    hasMultiattackFeat: dndData.feats?.includes('multiattack') === true
  });

  return {
    dndData,
    dagResult,
    selfTags: mergedSelfTags,
    canAttack: doctrineMod.canAttack,
    resolvedWeapons,
    attackRoutine
  };
}

/**
 * Computes effective actor stats (`attack`, `defense`, `maxHp`, `speed`) for the `dnd35e`
 * ruleset cartridge using the 4-Stage Topological Sub-Stat DAG.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param contextOverride Optional `StatQueryContext` for target-conditional or field-conditional queries.
 * @returns Computed `EffectiveStats` (where `10 + defense` equals `Full AC`).
 */
export function computeDnD35eEffectiveStats(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext
): EffectiveStats {
  const evaluated = evaluateDnD35eEntityDAG(state, entityId, contextOverride);
  if (!evaluated) {
    const actor = getComponent(state, entityId, ComponentType.Actor);
    return {
      attack: 0,
      defense: 0,
      maxHp: 0,
      speed: actor?.speed ?? DND35E_DEFAULT_SPEED
    };
  }

  const { dagResult } = evaluated;
  return {
    attack: dagResult.attackBonus,
    defense: dagResult.acBreakdown.fullAC - DND35E_BASE_AC,
    maxHp: dagResult.maxHp,
    speed: dagResult.speed
  };
}
