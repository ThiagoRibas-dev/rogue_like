import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { SIZE_METRICS } from '../spatial/grid_geometry.ts';
import {
  type AbilityId,
  type AbilityScoreState,
  type ACBreakdownDTO,
  ALL_ABILITY_IDS,
  type DnD35ResolvedActorStats,
  type SaveType,
  type StatModifier,
  type StatQueryContext,
  type StatResolutionBreakdown
} from '../types/dnd35e.types.ts';
import { buildSizeEffectProviderModifiers, resolveEffectiveSizeCategory } from './ac_breakdown.ts';
import {
  buildStage3CompoundEmittedModifier,
  type DnD35ActorStatDAGInput,
  partitionDAGModifiers,
  refineStage4AcBreakdownOriginLayers
} from './dag_helpers.ts';
import { DND35E_BASE_AC, SIZE_AC_AND_ATTACK_MODIFIERS } from './provenance.ts';
import { resolveTypedModifiers, resolveTypedModifiersWithBreakdown } from './stacking_engine.ts';

/**
 * Evaluates an actor across the complete 4-Stage Topological Sub-Stat DAG:
 * 1. Stage 1 (`'size'`): Resolves Effective Size category and emits Size Effect Provider modifiers.
 * 2. Stage 2 (`'str'`..`'cha'`): Resolves typed ability score modifiers, computing effective ability scores and ability mods.
 * 3. Stage 3 (Compound Defenses): Resolves `'natural_armor'`, `'worn_armor_bonus'`, `'worn_shield_bonus'` sub-stats.
 * 4. Stage 4 (Combat Stats): Injects CHA Incorporeal Deflection, computes AC triplet, attack, damage, saves, and HP.
 *
 * @param input Complete actor DAG input parameters.
 * @returns Full `DnD35ResolvedActorStats` structure.
 */
export function evaluateDnD35ActorStatDAG(input: DnD35ActorStatDAGInput): DnD35ResolvedActorStats {
  const allModifiers = input.statModifiers ?? [];
  const baseContext = input.context ?? {};
  const { modsByStat, naExtraMods, wornArmorExtraMods, wornShieldExtraMods, rawStandaloneAcMods } =
    partitionDAGModifiers(allModifiers);

  // STAGE 1: Size Sub-Stat & Effect Provider
  const sizeModifiers = modsByStat['size'] ?? [];
  const sizeResult = resolveEffectiveSizeCategory(input.baseSize, sizeModifiers, baseContext);
  const sizeEffectModifiers = buildSizeEffectProviderModifiers(sizeResult.sizeCategory, sizeResult.winningSourcePath);

  const existingSelfTags = (baseContext.selfTags ?? []).filter((t) => !t.startsWith('size:'));
  const stageSelfTagSet = new Set<string>(existingSelfTags);
  stageSelfTagSet.add(`size:${sizeResult.sizeCategory}`);
  if (input.isIncorporeal === true) {
    stageSelfTagSet.add('incorporeal');
    stageSelfTagSet.add('subtype:incorporeal');
  }
  const stageSelfTags: ReadonlyArray<string> = Array.from(stageSelfTagSet);
  const stageContext: StatQueryContext = {
    ...baseContext,
    selfTags: stageSelfTags
  };

  // STAGE 2: Ability Score Sub-Stats
  const effectiveAbilitiesPartial: Record<AbilityId, AbilityScoreState> = {
    str: input.rawAbilities.str,
    dex: input.rawAbilities.dex,
    con: input.rawAbilities.con,
    int: input.rawAbilities.int,
    wis: input.rawAbilities.wis,
    cha: input.rawAbilities.cha
  };
  const effectiveAbilityModifiersPartial: Record<AbilityId, number> = {
    str: 0,
    dex: 0,
    con: 0,
    int: 0,
    wis: 0,
    cha: 0
  };

  for (const abId of ALL_ABILITY_IDS) {
    const rawState = input.rawAbilities[abId];
    const abilityMods = modsByStat[abId] ?? [];
    const typedBonusNet = resolveTypedModifiers(abilityMods, stageContext);
    const effScore = computeEffectiveAbilityScore(rawState, typedBonusNet);
    const effMod = computeAbilityModifier(effScore);

    effectiveAbilitiesPartial[abId] = {
      base: effScore,
      inherentBonus: 0,
      damage: 0,
      drain: 0,
      tempPenalty: 0
    };
    effectiveAbilityModifiersPartial[abId] = effMod;
  }

  // STAGE 3: Compound Defense Sub-Stats
  const stage4EmittedMods: StatModifier[] = [];

  const naMods: StatModifier[] = [];
  if (input.baseNaturalArmor && input.baseNaturalArmor > 0 && !input.stripNaturalArmor) {
    naMods.push({
      targetStat: 'natural_armor',
      value: input.baseNaturalArmor,
      bonusType: 'base',
      sourceId: 'race_natural_armor',
      sourcePath: 'race:base/natural_armor',
      origin: 'ex'
    });
  }
  if (input.naturalArmorDelta && input.naturalArmorDelta !== 0 && !input.stripNaturalArmor) {
    naMods.push({
      targetStat: 'natural_armor',
      value: input.naturalArmorDelta,
      bonusType: 'untyped',
      sourceId: 'template_natural_armor_delta',
      sourcePath: 'template:delta/natural_armor',
      origin: 'ex'
    });
  }
  for (const m of naExtraMods) {
    naMods.push(m);
  }
  const naturalArmorBreakdown = resolveTypedModifiersWithBreakdown(naMods, stageContext);
  if (naturalArmorBreakdown.total !== 0 && !input.stripNaturalArmor) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        naturalArmorBreakdown,
        'natural_armor',
        'natural_armor_substat',
        'race:base/natural_armor',
        'ex'
      )
    );
  }

  const wornArmorMods: StatModifier[] = [];
  if (input.armorBonus && input.armorBonus > 0) {
    wornArmorMods.push({
      targetStat: 'worn_armor_bonus',
      value: input.armorBonus,
      bonusType: 'base',
      sourceId: 'physical_armor',
      sourcePath: 'item:armor/base_armor',
      origin: 'mundane'
    });
  }
  for (const m of wornArmorExtraMods) {
    wornArmorMods.push(m);
  }
  const wornArmorBreakdown = resolveTypedModifiersWithBreakdown(wornArmorMods, stageContext);
  if (wornArmorBreakdown.total !== 0) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        wornArmorBreakdown,
        'armor',
        'worn_armor_substat',
        'item:armor/base_armor',
        'mundane'
      )
    );
  }

  const wornShieldMods: StatModifier[] = [];
  if (input.shieldBonus && input.shieldBonus > 0) {
    wornShieldMods.push({
      targetStat: 'worn_shield_bonus',
      value: input.shieldBonus,
      bonusType: 'base',
      sourceId: 'physical_shield',
      sourcePath: 'item:shield/base_shield',
      origin: 'mundane'
    });
  }
  for (const m of wornShieldExtraMods) {
    wornShieldMods.push(m);
  }
  const wornShieldBreakdown = resolveTypedModifiersWithBreakdown(wornShieldMods, stageContext);
  if (wornShieldBreakdown.total !== 0) {
    stage4EmittedMods.push(
      buildStage3CompoundEmittedModifier(
        wornShieldBreakdown,
        'shield',
        'worn_shield_substat',
        'item:shield/base_shield',
        'mundane'
      )
    );
  }

  // STAGE 4: Terminal Combat Stats
  const chaDeflection = Math.max(1, effectiveAbilityModifiersPartial.cha);
  let hasIncorporealDeflectionMod = false;
  const standaloneAcModifiers: StatModifier[] = rawStandaloneAcMods.map((m) => {
    if (m.sourceId === 'subtype:incorporeal:deflection_ac' || m.sourceId === 'incorporeal_cha_deflection') {
      hasIncorporealDeflectionMod = true;
      return {
        ...m,
        value: chaDeflection
      };
    }
    return m;
  });

  if ((input.isIncorporeal === true || stageSelfTagSet.has('subtype:incorporeal')) && !hasIncorporealDeflectionMod) {
    stage4EmittedMods.push({
      targetStat: 'ac',
      value: chaDeflection,
      bonusType: 'deflection',
      sourceId: 'incorporeal_cha_deflection',
      sourcePath: 'subtype:incorporeal/deflection_ac',
      origin: 'su'
    });
  }

  const sizeAcMod = sizeEffectModifiers.filter((m) => m.targetStat === 'ac');
  const allAcModifiers: StatModifier[] = [...standaloneAcModifiers, ...stage4EmittedMods, ...sizeAcMod];

  const hasUncannyDodge = input.hasUncannyDodge === true;
  const effectiveMaxDex = input.maxDexBonus ?? stageContext.maxDexBonus;
  const effectiveDexMod =
    effectiveMaxDex !== undefined
      ? Math.min(effectiveAbilityModifiersPartial.dex, effectiveMaxDex)
      : effectiveAbilityModifiersPartial.dex;
  const flatFootedDex = hasUncannyDodge ? effectiveDexMod : Math.min(0, effectiveDexMod);
  const sizeContribution = SIZE_AC_AND_ATTACK_MODIFIERS[sizeResult.sizeCategory];

  const substatBreakdowns: Readonly<Record<string, StatResolutionBreakdown>> = {
    natural_armor_substat: naturalArmorBreakdown,
    worn_armor_substat: wornArmorBreakdown,
    worn_shield_substat: wornShieldBreakdown
  };

  const rawAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, stageContext);
  const isAgainstIncorporealTouch =
    stageContext.againstIncorporealTouch === true ||
    stageContext.effectTags?.includes('attack:incorporeal_touch') === true;
  const rawTouchAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, {
    ...stageContext,
    ignoreArmorAndNatural: true,
    ...(isAgainstIncorporealTouch ? { againstIncorporealTouch: true } : {})
  });
  const rawFlatFootedAcResolution = resolveTypedModifiersWithBreakdown(allAcModifiers, {
    ...stageContext,
    ignorePositiveDexAndDodge: !hasUncannyDodge
  });

  const acResolution = refineStage4AcBreakdownOriginLayers(rawAcResolution, substatBreakdowns);
  const touchAcResolution = refineStage4AcBreakdownOriginLayers(rawTouchAcResolution, substatBreakdowns);
  const flatFootedAcResolution = refineStage4AcBreakdownOriginLayers(rawFlatFootedAcResolution, substatBreakdowns);

  const acBreakdown: ACBreakdownDTO = {
    fullAC: DND35E_BASE_AC + effectiveDexMod + acResolution.total,
    touchAC: DND35E_BASE_AC + effectiveDexMod + touchAcResolution.total,
    flatFootedAC: DND35E_BASE_AC + flatFootedDex + flatFootedAcResolution.total,
    baseAC: DND35E_BASE_AC,
    dexContribution: effectiveDexMod,
    sizeContribution,
    modifierTotal: acResolution.total
  };

  const conMod = effectiveAbilityModifiersPartial.con;
  const chassis = aggregateProgressionChassis(input.tracks, conMod);
  const strMod = effectiveAbilityModifiersPartial.str;
  const dexMod = effectiveAbilityModifiersPartial.dex;
  const wisMod = effectiveAbilityModifiersPartial.wis;

  const sharedSaveMods = modsByStat['saves'] ?? [];
  const fortMods = [...(modsByStat['fort'] ?? []), ...sharedSaveMods];
  const refMods = [...(modsByStat['ref'] ?? []), ...sharedSaveMods];
  const willMods = [...(modsByStat['will'] ?? []), ...sharedSaveMods];

  const saves: Record<SaveType, number> = {
    fort: chassis.baseSaves.fort + conMod + resolveTypedModifiers(fortMods, stageContext),
    ref: chassis.baseSaves.ref + dexMod + resolveTypedModifiers(refMods, stageContext),
    will: chassis.baseSaves.will + wisMod + resolveTypedModifiers(willMods, stageContext)
  };

  const attackMods = modsByStat['attack'] ?? [];
  const sizeAtkMod = SIZE_METRICS[sizeResult.sizeCategory].attackAndAcModifier;
  const attackBonus = chassis.totalBab + strMod + sizeAtkMod + resolveTypedModifiers(attackMods, stageContext);

  const damageMods = modsByStat['damage'] ?? [];
  const damageBonus = strMod + resolveTypedModifiers(damageMods, stageContext);

  const maxHpMods = modsByStat['max_hp'] ?? [];
  const maxHpBonus = resolveTypedModifiers(maxHpMods, stageContext);
  const baseHp = input.baseMaxHp !== undefined && input.baseMaxHp > 0 ? input.baseMaxHp : chassis.maxHp;
  const maxHp = baseHp + maxHpBonus;

  const speedMods = [...(modsByStat['speed'] ?? []), ...(modsByStat['land_speed'] ?? [])];
  const speedBonus = resolveTypedModifiers(speedMods, stageContext);
  const speed = (input.baseSpeed ?? 30) + speedBonus;

  const fortificationMods = modsByStat['fortification'] ?? [];
  const rawFortification = resolveTypedModifiers(fortificationMods, stageContext);
  const fortificationPercent = Math.min(100, Math.max(0, rawFortification));

  const missChanceMods = [...(modsByStat['miss_chance'] ?? []), ...(modsByStat['concealment'] ?? [])];
  const rawMissChance = resolveTypedModifiers(missChanceMods, stageContext);
  const concealmentMissChancePercent = Math.min(100, Math.max(0, rawMissChance));

  const flankingMods = [...(modsByStat['flanking_attack_bonus'] ?? []), ...(modsByStat['flanking_bonus'] ?? [])];
  const flankingBonus = 2 + resolveTypedModifiers(flankingMods, stageContext);

  return {
    effectiveSize: sizeResult.sizeCategory,
    sizeRankIndex: sizeResult.rankIndex,
    sizeWinningSourcePath: sizeResult.winningSourcePath,
    effectiveAbilities: effectiveAbilitiesPartial,
    effectiveAbilityModifiers: effectiveAbilityModifiersPartial,
    naturalArmorBreakdown,
    wornArmorBreakdown,
    wornShieldBreakdown,
    acBreakdown,
    acResolution,
    touchAcResolution,
    flatFootedAcResolution,
    attackBonus,
    damageBonus,
    maxHp,
    saves,
    speed,
    flankingBonus,
    ...(fortificationPercent > 0 ? { fortificationPercent } : {}),
    ...(concealmentMissChancePercent > 0 ? { concealmentMissChancePercent } : {})
  };
}
