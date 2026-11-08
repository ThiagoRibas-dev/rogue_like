import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type FighterComponent,
  type PropertyOverlayComponent,
  type TacticalDoctrineComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { EffectiveStats } from '../../../types/ruleset.types.ts';
import {
  type DnD35ResolvedAttackRoutine,
  evaluateTacticalDoctrineModifiers,
  extractActorTacticalDials,
  resolveActorAttackRoutine
} from '../combat/attack_resolver.ts';
import { summarizeConditionEffects } from '../combat/maneuvers_conditions.ts';
import {
  type ResolvedActorWeapons,
  resolveAllEquippedWeaponProfiles,
  resolveEquippedWeaponProfile
} from '../equipment_physics.ts';
import {
  buildCombatRuleOverridesFromActiveRules,
  buildFeatEffectModifiers,
  collectActiveFeatRuleOverrides
} from '../level_ledger.ts';
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
import { buildActorNaturalWeaponLimbs, collectEquippedItemDAGContributions } from './dnd35e_equipped_item_dag.ts';

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
  readonly hasCleave: boolean;
  readonly hasGreatCleave: boolean;
}

/**
 * Per-state-revision cache for context-free `evaluateDnD35eEntityDAG` queries.
 * Keyed on the immutable `state.components` Map reference and guarded by `state.campaign?.systemContent`
 * identity so multiple HUD panels and viewport projectors sharing the same state snapshot compute
 * an actor's 4-stage DAG and attack routine at most once.
 */
const entityDagCache = new WeakMap<
  GameState['components'],
  { readonly systemContentRef: unknown; readonly byEntity: Map<EntityId, DnD35EntityDAGResult | undefined> }
>();

/**
 * Evaluates the full 4-Stage Topological Sub-Stat DAG for an entity in `GameState`,
 * incorporating active `PropertyOverlayComponent`s, equipped item bonuses, `TacticalDoctrineComponent`,
 * condition penalties, and optional contextual query flags (e.g. `targetTags` during combat).
 */
export function evaluateDnD35eEntityDAG(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext,
  prehydrated?: { readonly dndData: DnD35EntityData; readonly selfTags: ReadonlyArray<string> }
): DnD35EntityDAGResult | undefined {
  const isCacheable = contextOverride === undefined && prehydrated === undefined;
  const sysRef = state.campaign?.systemContent;
  if (isCacheable) {
    const entry = entityDagCache.get(state.components);
    if (entry && entry.systemContentRef === sysRef && entry.byEntity.has(entityId)) {
      return entry.byEntity.get(entityId);
    }
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return undefined;
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
  const suppressedIds = dndData.suppressedBundleIds ?? [];
  const activeDials = extractActorTacticalDials(dndData.feats ?? [], sysContent?.feats, suppressedIds);
  const mainHandProfile = resolveEquippedWeaponProfile(state, entityId, 'main_hand');
  const doctrineMod = doctrine
    ? evaluateTacticalDoctrineModifiers(doctrine, rawChassis.totalBab, mainHandProfile.handedness, 0, activeDials)
    : { attackPenalty: 0, damageBonus: 0, dodgeAcBonus: 0, canAttack: true };

  const itemContrib = collectEquippedItemDAGContributions(state, entityId, suppressedIds, selfTags);
  const extraModifiers: StatModifier[] = [...(dndData.statModifiers ?? []), ...itemContrib.modifiers];

  const hasFeatModsAlready = (dndData.statModifiers ?? []).some((m) => (m.sourcePath ?? '').startsWith('feat:'));
  if (!hasFeatModsAlready && (dndData.feats ?? []).length > 0 && sysContent?.feats) {
    extraModifiers.push(...buildFeatEffectModifiers(dndData.feats ?? [], sysContent.feats, suppressedIds, selfTags));
  }

  const pushMod = (
    targetStat: StatModifier['targetStat'],
    value: number,
    bonusType: StatModifier['bonusType'],
    sourceId: string,
    sourcePath: string,
    origin: StatModifier['origin']
  ): void => {
    if (value !== 0) extraModifiers.push({ targetStat, value, bonusType, sourceId, sourcePath, origin });
  };
  pushMod('attack', equipAttackBonus, 'enhancement', 'equipment_attack', 'item:weapon/enhancement', 'mundane');
  if (doctrineMod.dodgeAcBonus > 0) {
    pushMod('ac', doctrineMod.dodgeAcBonus, 'dodge', 'tactical_doctrine', 'stance:doctrine/dodge_ac', 'ex');
  }
  pushMod('attack', doctrineMod.attackPenalty, 'untyped', 'tactical_doctrine', 'stance:doctrine/attack_penalty', 'ex');
  pushMod('damage', doctrineMod.damageBonus, 'untyped', 'tactical_doctrine', 'stance:doctrine/damage_bonus', 'ex');
  pushMod('ac', condSummary.acPenalty, 'untyped', 'conditions', 'condition:status/ac_penalty', 'ex');
  pushMod('attack', condSummary.meleeAttackPenalty, 'untyped', 'conditions', 'condition:status/attack_penalty', 'ex');

  const isIncorporeal = dndData.subtypes?.includes('incorporeal') === true;
  const stanceTags: string[] = [];
  if (doctrine?.totalDefense === true) stanceTags.push('stance:total_defense');
  else if (doctrine?.fightingDefensively === true) stanceTags.push('stance:fighting_defensively');

  const resolvedWeapons = resolveAllEquippedWeaponProfiles(state, entityId, dndData.sizeCategory);
  if (resolvedWeapons.offHandWeapons.length > 0) {
    stanceTags.push('wielding:two_weapons');
  }
  const mergedSelfTags = Array.from(
    new Set([...selfTags, ...itemContrib.grantedTags, ...stanceTags, ...(contextOverride?.selfTags ?? [])])
  );

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
    armorBonus: itemContrib.hasStructuredArmorOrShield
      ? dndData.armorBonus
      : Math.max(dndData.armorBonus, equipArmorBonus),
    shieldBonus: dndData.shieldBonus,
    maxDexBonus: itemContrib.maxDexBonusCap,
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

  const finalWeapons =
    dagResult.effectiveSize === dndData.sizeCategory
      ? resolvedWeapons
      : resolveAllEquippedWeaponProfiles(state, entityId, dagResult.effectiveSize);
  const naturalLimbs = buildActorNaturalWeaponLimbs(state, entityId, dndData, dagResult.effectiveSize);

  const strMod = dagResult.effectiveAbilityModifiers.str;
  const dexMod = dagResult.effectiveAbilityModifiers.dex;
  const baseActorAttackBonus = dagResult.attackBonus - equipAttackBonus - doctrineMod.attackPenalty;
  const nonStrNonDoctrineFlatDamage = dagResult.damageBonus - strMod - doctrineMod.damageBonus;

  const featRuleOverrides = collectActiveFeatRuleOverrides(
    dndData.feats ?? [],
    sysContent?.feats,
    suppressedIds,
    mergedSelfTags
  );
  const offHandIsLight =
    finalWeapons.offHandWeapons.length > 0 && finalWeapons.offHandWeapons.every((w) => w.handedness === 'light');
  const activeCombatRules = buildCombatRuleOverridesFromActiveRules(featRuleOverrides, offHandIsLight);

  const attackRoutine = resolveActorAttackRoutine({
    resolvedWeapons: finalWeapons,
    naturalWeapons: naturalLimbs,
    totalBab: rawChassis.totalBab,
    baseAttackModifier: baseActorAttackBonus,
    strModifier: strMod,
    dexModifier: dexMod,
    hasWeaponFinesse: activeCombatRules.hasWeaponFinesse || dndData.feats?.includes('weapon_finesse') === true,
    doctrine,
    flatDamageBonus: nonStrNonDoctrineFlatDamage,
    hasTwoWeaponFightingFeat:
      activeCombatRules.combatOverrides.twfPrimaryPenalty !== undefined ||
      dndData.feats?.includes('two_weapon_fighting') === true ||
      dndData.feats?.includes('multiweapon_fighting') === true,
    hasMultiattackFeat:
      activeCombatRules.combatOverrides.secondaryNaturalPenalty !== undefined ||
      dndData.feats?.includes('multiattack') === true,
    overrides: activeCombatRules.combatOverrides,
    statModifiers: extraModifiers,
    selfTags: mergedSelfTags
  });

  const finalDagResult: DnD35EntityDAGResult = {
    dndData,
    dagResult,
    selfTags: mergedSelfTags,
    canAttack: doctrineMod.canAttack,
    resolvedWeapons: finalWeapons,
    attackRoutine,
    hasCleave: activeCombatRules.hasCleave || dndData.feats?.includes('cleave') === true,
    hasGreatCleave: activeCombatRules.hasGreatCleave || dndData.feats?.includes('great_cleave') === true
  };

  if (isCacheable) {
    let entry = entityDagCache.get(state.components);
    if (!entry || entry.systemContentRef !== sysRef) {
      entry = { systemContentRef: sysRef, byEntity: new Map() };
      entityDagCache.set(state.components, entry);
    }
    entry.byEntity.set(entityId, finalDagResult);
  }

  return finalDagResult;
}

/**
 * Computes effective actor stats (`attack`, `defense`, `maxHp`, `speed`) for the `dnd35e`
 * ruleset cartridge using the 4-Stage Topological Sub-Stat DAG.
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
