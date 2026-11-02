import { addComponent, getComponent, removeComponent } from '../../core/ecs.ts';
import { addFloatingText } from '../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type PropertyOverlayComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from './wild_shape.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { MeleeAttackIntent } from '../../types/intents/combat.intents.ts';
import type {
  EffectiveStats,
  HudVitalsDTO,
  RulesetContract,
  RulesetSystemFileDescriptor,
  ValidationError,
  ViewGroup
} from '../../types/ruleset.types.ts';
import { DnD35SystemContentSchema, parseDnD35SystemContent } from './types/dnd35e_system.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from './abilities.ts';
import { evaluateTacticalDoctrineModifiers, resolveAttackRoll } from './combat/attack_resolver.ts';
import { evaluateVitalityStatus, mitigateIncomingDamage } from './combat/damage_vitality.ts';
import { summarizeConditionEffects } from './combat/maneuvers_conditions.ts';
import {
  DND35E_BASE_AC,
  evaluateDnD35ActorStatDAG
} from './modifiers.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from './progression.ts';
import {
  getDnD35EntityData,
  getEquippedItemBonuses,
  projectDnD35ActorSemanticTags,
  resolveDamageTypeFromTags,
  setDnD35EntityData
} from './srd_registry.ts';
import type {
  DnD35EntityData,
  DnD35ResolvedActorStats,
  StatModifier,
  StatQueryContext
} from './types/dnd35e.types.ts';

/** Default movement speed for uninitialized entities. */
const DND35E_DEFAULT_SPEED = 100;

/** Full entity DAG evaluation result including hydrated `DnD35EntityData` and tactical doctrine attack eligibility. */
export interface DnD35EntityDAGResult {
  readonly dndData: DnD35EntityData;
  readonly dagResult: DnD35ResolvedActorStats;
  readonly selfTags: ReadonlyArray<string>;
  readonly canAttack: boolean;
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
  const selfTags = prehydrated?.selfTags ?? projectDnD35ActorSemanticTags(dndData);
  const condSummary = summarizeConditionEffects(dndData.conditions);

  const rawChassis = aggregateProgressionChassis(dndData.tracks, 0);
  const { equipAttackBonus, equipArmorBonus } = getEquippedItemBonuses(state, entityId);
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    | TacticalDoctrineComponent
    | undefined;
  const tumbleRanks = dndData.skillRanks['tumble'] ?? 0;
  const doctrineMod = doctrine
    ? evaluateTacticalDoctrineModifiers(doctrine, rawChassis.totalBab, 'one_handed', tumbleRanks)
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
  const mergedSelfTags =
    contextOverride?.selfTags !== undefined
      ? Array.from(new Set([...selfTags, ...contextOverride.selfTags]))
      : selfTags;

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
    hasUncannyDodge: !condSummary.losesDexToAC,
    statModifiers: extraModifiers,
    context: {
      ...contextOverride,
      selfTags: mergedSelfTags
    }
  });

  return {
    dndData,
    dagResult,
    selfTags: mergedSelfTags,
    canAttack: doctrineMod.canAttack
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

/**
 * Resolves a melee attack intent in the `dnd35e` ruleset cartridge using `resolveAttackRoll`
 * ($d20 + \text{AtkBonus} \ge \text{TargetAC}$, natural 1/20 bounds, critical threat & confirmation,
 * and weapon dice + STR damage).
 *
 * @param state The current GameState.
 * @param intent The MeleeAttackIntent to resolve.
 * @returns Updated GameState and success boolean.
 */
function resolveDnD35eMeleeAttack(state: GameState, intent: MeleeAttackIntent): { state: GameState; success: boolean } {
  const { entityId: attackerId, defenderId } = intent;
  const attackerFighter = getComponent(state, attackerId, ComponentType.Fighter);
  const targetFighter = getComponent(state, defenderId, ComponentType.Fighter);
  if (!attackerFighter || !targetFighter) {
    return { state, success: false };
  }

  const attackerData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(state, attackerId),
    getComponent(state, attackerId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );
  const defenderData = resolveEffectiveEntityDataWithOverlays(
    getDnD35EntityData(state, defenderId),
    getComponent(state, defenderId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
  );

  const attackerSelfTags = projectDnD35ActorSemanticTags(attackerData);
  const defenderSelfTags = projectDnD35ActorSemanticTags(defenderData);

  // Evaluate both attacker and defender across the full 4-Stage DAG with mutual targetTags
  const attackerEval = evaluateDnD35eEntityDAG(
    state,
    attackerId,
    { targetTags: defenderSelfTags },
    { dndData: attackerData, selfTags: attackerSelfTags }
  );
  const defenderEval = evaluateDnD35eEntityDAG(
    state,
    defenderId,
    { targetTags: attackerSelfTags },
    { dndData: defenderData, selfTags: defenderSelfTags }
  );

  if (!attackerEval || !defenderEval) {
    return { state, success: false };
  }

  if (!attackerEval.canAttack) {
    return {
      state: addMessage(state, 'Cannot attack while in Total Defense stance!', MessageLogCategory.CombatMiss),
      success: false
    };
  }

  const effectiveAttackBonus = attackerEval.dagResult.attackBonus;
  const targetAC = defenderEval.dagResult.acBreakdown.fullAC;
  const strMod = attackerEval.dagResult.effectiveAbilityModifiers.str;
  const flatDamageBonus = attackerEval.dagResult.damageBonus - strMod;

  const rollResult = resolveAttackRoll({
    attackBonus: effectiveAttackBonus,
    targetAC,
    weaponDice: attackerData.weaponDice,
    strModifier: strMod,
    handedness: 'one_handed',
    flatDamageBonus,
    critThreatMin: attackerData.weaponCritThreatMin,
    critMultiplier: attackerData.weaponCritMultiplier,
    targetImmuneToCrits: defenderData.abilityScores.con.base === null
  });

  if (!rollResult.hit) {
    return {
      state: addMessage(
        state,
        `[d20: ${rollResult.naturalAttackRoll} + ${effectiveAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}] Melee attack misses!`,
        MessageLogCategory.CombatMiss
      ),
      success: true
    };
  }

  const existingDamage = getComponent(state, defenderId, ComponentType.Damage) as DamageComponent | undefined;
  const instance = {
    amount: rollResult.totalDamage,
    sourceEntityId: attackerId,
    tags: ['melee', 'physical', attackerData.weaponDamageType, ...attackerData.weaponBypassTags]
  };
  const nextInstances = existingDamage ? [...existingDamage.instances, instance] : [instance];

  const nextState = addComponent(state, defenderId, {
    type: ComponentType.Damage,
    instances: nextInstances
  });

  const critText = rollResult.isCriticalConfirmed ? ' CRITICAL HIT!' : '';
  return {
    state: addMessage(
      nextState,
      `[d20: ${rollResult.naturalAttackRoll} + ${effectiveAttackBonus} = ${rollResult.totalAttackRoll} vs AC ${targetAC}]${critText} Deals ${rollResult.totalDamage} ${attackerData.weaponDamageType} damage!`,
      MessageLogCategory.CombatHit
    ),
    success: true
  };
}

/**
 * Processes queued `DamageComponent` instances on entities for the `dnd35e` cartridge,
 * applying `mitigateIncomingDamage` (`DR`, Energy Resistance, Immunity/Vulnerability) and
 * `evaluateVitalityStatus` (`0 HP` Disabled, `-1..-9 HP` Dying, `-10 HP` Dead, or `0 HP`
 * immediate destruction for `CON: null` Undead/Constructs).
 *
 * @param state The current GameState.
 * @returns Updated GameState.
 */
function processDnD35eDamage(state: GameState): GameState {
  let nextState = state;
  for (const entityId of state.entities) {
    const damageComp = getComponent(nextState, entityId, ComponentType.Damage) as DamageComponent | undefined;
    if (!damageComp || damageComp.instances.length === 0) continue;

    nextState = removeComponent(nextState, entityId, ComponentType.Damage);
    const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!fighter) continue;

    const defenderData = getDnD35EntityData(nextState, entityId);
    let totalDamage = 0;
    let lastAttackerId: EntityId | undefined;

    for (const inst of damageComp.instances) {
      const dmgType = resolveDamageTypeFromTags(inst.tags);
      const mitigated = mitigateIncomingDamage({
        rawDamage: Math.max(0, inst.amount),
        damageType: dmgType,
        attackBypassTags: inst.tags,
        ...(defenderData.damageReduction !== undefined ? { damageReduction: defenderData.damageReduction } : {}),
        energyResistance: defenderData.energyResistance,
        immunities: defenderData.immunities,
        vulnerabilities: defenderData.vulnerabilities
      });
      totalDamage += mitigated.finalDamage;
      if (inst.sourceEntityId !== undefined) lastAttackerId = inst.sourceEntityId;
    }

    const newHp = fighter.hp - totalDamage;
    nextState = addComponent(nextState, entityId, { ...fighter, hp: newHp });
    nextState = {
      ...nextState,
      events: [
        ...nextState.events,
        {
          type: GameEventType.EntityDamaged,
          entityId,
          amount: totalDamage,
          ...(lastAttackerId !== undefined ? { sourceEntityId: lastAttackerId } : {})
        }
      ]
    };

    if (totalDamage > 0) {
      nextState = addFloatingText(nextState, entityId, `-${totalDamage}`, '#ff4757');
    }

    const isPlayer = getComponent(nextState, entityId, ComponentType.Player) !== undefined;
    const conIsNull = defenderData.abilityScores.con.base === null;
    const vitality = evaluateVitalityStatus(newHp, defenderData.nonlethalDamage, defenderData.isStable, conIsNull);

    if (vitality.status === 'dead' || (!isPlayer && newHp <= 0)) {
      nextState = addComponent(nextState, entityId, {
        type: ComponentType.Death,
        ...(lastAttackerId !== undefined ? { killerId: lastAttackerId } : {})
      });
    }
  }
  return nextState;
}

/**
 * Grants XP to an actor under the D&D 3.5e triangular XP progression table
 * ($\text{Threshold}(L+1) = \frac{L(L+1)}{2} \times 1000$).
 *
 * @param state The current GameState.
 * @param entityId The recipient entity ID.
 * @param amount The XP amount to grant.
 * @returns Updated GameState.
 */
function grantDnD35eXp(state: GameState, entityId: EntityId, amount: number): GameState {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter || amount <= 0) return state;

  const newXp = fighter.xp + amount;
  const nextLevel = fighter.level + 1;
  const nextThreshold = computeXpThresholdForLevel(nextLevel);

  if (newXp >= nextThreshold) {
    const dndData = getDnD35EntityData(state, entityId);
    const primaryTrack = dndData.tracks[0];
    const nextTracks = primaryTrack
      ? [{ ...primaryTrack, levels: nextLevel }, ...dndData.tracks.slice(1)]
      : dndData.tracks;
    const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
    const nextChassis = aggregateProgressionChassis(nextTracks, conMod);
    const hpGain = Math.max(1, Math.floor((primaryTrack?.hitDieSides ?? 10) / 2) + 1 + conMod);

    const withRuleset = setDnD35EntityData(state, entityId, {
      ...dndData,
      tracks: nextTracks
    });

    return addComponent(withRuleset, entityId, {
      ...fighter,
      xp: newXp,
      level: nextLevel,
      attack: nextChassis.totalBab,
      maxHp: fighter.maxHp + hpGain,
      hp: fighter.hp + hpGain
    });
  }

  return addComponent(state, entityId, { ...fighter, xp: newXp });
}

/**
 * Projects HUD vitals for the `dnd35e` ruleset cartridge (displaying BAB and Full AC sockets).
 *
 * @param state The current GameState.
 * @param playerEntityId The player entity ID.
 * @returns The projected `HudVitalsDTO`, or `null` if the player lacks combat stats.
 */
function projectDnD35eHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null {
  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return null;

  const stats = computeDnD35eEffectiveStats(state, playerEntityId);
  const hpMax = Math.max(0, stats.maxHp);
  const hpCurrent = fighter.hp;
  const rawHpPercent = hpMax > 0 ? Math.round((hpCurrent / hpMax) * 100) : 0;
  const hpPercent = Math.max(0, Math.min(100, rawHpPercent));

  const xpNext = Math.max(1, computeXpThresholdForLevel(fighter.level + 1));
  const xpPercent = Math.max(0, Math.min(100, Math.round((fighter.xp / xpNext) * 100)));

  const formattedBab = stats.attack >= 0 ? `+${stats.attack}` : `${stats.attack}`;
  const armorClass = DND35E_BASE_AC + stats.defense;

  return {
    levelLabel: `ECL ${fighter.level}`,
    hpCurrent,
    hpMax,
    hpPercent,
    xpPercent,
    xpText: `${fighter.xp} / ${xpNext}`,
    primaryStat: { label: 'BAB', value: formattedBab },
    secondaryStat: { label: 'AC', value: armorClass.toString() }
  };
}

/**
 * The `dnd35e` (Dungeons & Dragons 3.5e SRD) ruleset cartridge entry point.
 */
export const dnd35eRulesetContract: RulesetContract = {
  id: 'dnd35e',
  metadata: {
    id: 'dnd35e',
    name: 'Dungeons & Dragons 3.5e (SRD)',
    shortLabel: 'D&D 3.5e',
    badgeIcon: '🐉',
    version: '1.0.0',
    description:
      'Tactical d20 open-gaming ruleset featuring 6 Ability Scores, 18-type bonus stacking, 5-ft footprint/reach & cover geometry, 5-tier action economy, Attacks of Opportunity, and Vancian spellcasting.',
    features: [
      '6 Ability Scores & 18-Type Bonus Stacking Engine',
      'Full / Touch / Flat-Footed AC & Saving Throws (Fort/Ref/Will)',
      '5-Foot Grid Reach Rings, Cover & Flanking Geometry',
      '5-Tier Action Economy, Attacks of Opportunity & Vancian Magic'
    ]
  },
  getEffectiveActorStats: computeDnD35eEffectiveStats,
  resolveMeleeAttack: resolveDnD35eMeleeAttack,
  processDamage: processDnD35eDamage,
  grantActorXp: grantDnD35eXp,
  projectHudVitals: projectDnD35eHudVitals,
  getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup> {
    return baseGroups;
  },
  getSystemContentFiles(): ReadonlyArray<RulesetSystemFileDescriptor> {
    return [
      { key: 'archetypes', filename: 'archetypes.json' },
      { key: 'classes', filename: 'classes.json' },
      { key: 'skills', filename: 'skills.json' },
      { key: 'feats', filename: 'feats.json' },
      { key: 'spells', filename: 'spells.json' },
      { key: 'templates', filename: 'templates.json' },
      { key: 'races', filename: 'races.json' },
      { key: 'creatureTypes', filename: 'creature_types.json' },
      { key: 'dragonFamilies', filename: 'dragon_families.json' }
    ];
  },
  parseSystemContent(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    return parseDnD35SystemContent(raw) as unknown as Readonly<Record<string, unknown>>;
  },
  validateCampaignRuleset(campaign: Readonly<CampaignData>): ReadonlyArray<ValidationError> {
    const errors: ValidationError[] = [];
    if (!campaign.systemContent) {
      errors.push({
        path: 'campaign.systemContent',
        message: 'D&D 3.5e campaign requires systemContent (loaded from public/data/rulesets/dnd35e/)',
        severity: 'error'
      });
      return errors;
    }
    const parseRes = DnD35SystemContentSchema.safeParse(campaign.systemContent);
    if (!parseRes.success) {
      for (const issue of parseRes.error.issues) {
        errors.push({
          path: `systemContent.${issue.path.join('.')}`,
          message: issue.message,
          severity: 'error'
        });
      }
      return errors;
    }
    const archetypes = parseRes.data.archetypes;
    for (const [entityId, entity] of Object.entries(campaign.entities)) {
      if (entity.archetypeId && !archetypes[entity.archetypeId]) {
        errors.push({
          path: `entities.${entityId}.archetypeId`,
          message: `Entity template "${entityId}" references unknown system archetype "${entity.archetypeId}"`,
          severity: 'error'
        });
      }
    }
    return errors;
  }
};
