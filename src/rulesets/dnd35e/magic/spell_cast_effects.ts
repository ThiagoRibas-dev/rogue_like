/**
 * @file Per-target effect-unit application helpers for runtime D&D 3.5e spell execution.
 * Applies evaluated `DnD35SpellEffectUnit`s and top-level `effectBundle`s.
 */

import { addComponent, getComponent, queryEntities, removeComponent } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import { getEffectiveWorldClockConfig } from '../../../systems/world_clock.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FighterComponent,
  type MovementModes,
  type PositionComponent,
  type PropertyOverlayComponent,
  type StatusEffectsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { assertNever } from '../../../utils/assert.ts';
import { isHostile } from '../../../utils/faction.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { applyConditionWithEscalation } from '../combat/condition_registry.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import {
  measureFootprintToFootprintDistanceFt,
  syncDnD35eActorSpatialFootprint
} from '../spatial/footprint_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import {
  ALL_ABILITY_IDS,
  type AbilityScoresRecord,
  type DnD35ConditionId,
  type StatModifier
} from '../types/dnd35e.types.ts';
import { applyNegativeLevelsToActor } from '../progression/ledger_level_drain.ts';
import type { DnD35RaceDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellDefinition, DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { evaluateMetamagicDamage, type MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { applySpecialSpellUnit } from './spell_cast_units.ts';
import {
  evaluateSpellScalingRule,
  materializeSpellUnitModifiers,
  materializeTopLevelSpellModifiers
} from './spell_effects.ts';
import {
  classifyEffectPolarity,
  EXTEND_METAMAGIC_DURATION_MULTIPLIER,
  formatSpellModifiersSummary,
  parseSpellDurationTurns,
  POLARITY_COLORS
} from './spell_duration.ts';

const MIN_ABILITY_SCORE_DEFAULT = 1;
const DEFAULT_FORM_ABILITY_SCORE = 10;
const DEFAULT_FORM_LAND_SPEED_FT = 30;
const SHAPECHANGE_OVERLAY_PRIORITY = 115;
const POLYMORPH_OVERLAY_PRIORITY = 110;
const CURE_ONLY_CONDITION_SENTINELS: ReadonlySet<string> = new Set([
  'none',
  'heal_restoration',
  'flesh_restored',
  'poison_neutralized'
]);

/** Maximum radius in feet for Healing Hymn performance aura (`30 ft`, Complete Champion p. 47). */
export const HEALING_HYMN_RADIUS_FT = 30;

/**
 * Computes the bonus healing granted by an active Healing Hymn performed by the caster or
 * a nearby ally within 30 feet (Complete Champion p. 47).
 * Grants +1 HP per Perform rank of the highest-ranking active performer.
 */
export function resolveHealingHymnBonus(state: GameState, casterId: EntityId): number {
  const casterPos = getComponent(state, casterId, ComponentType.Position) as PositionComponent | undefined;
  let maxBonus = 0;

  const candidateIds = queryEntities(state, [ComponentType.StatusEffects]);
  for (const candidateId of candidateIds) {
    const statusComp = getComponent(state, candidateId, ComponentType.StatusEffects) as
      StatusEffectsComponent | undefined;
    if (!statusComp || !statusComp.activeEffects.some((eff) => eff.effectId === 'healing_hymn_active')) {
      continue;
    }
    if (candidateId !== casterId) {
      if (isHostile(state, casterId, candidateId)) continue;
      if (casterPos) {
        const candidatePos = getComponent(state, candidateId, ComponentType.Position) as PositionComponent | undefined;
        if (candidatePos) {
          const dist = measureFootprintToFootprintDistanceFt(
            casterPos.x,
            casterPos.y,
            casterPos.footprintWidth ?? 1,
            casterPos.footprintHeight ?? 1,
            candidatePos.x,
            candidatePos.y,
            candidatePos.footprintWidth ?? 1,
            candidatePos.footprintHeight ?? 1
          );
          if (dist > HEALING_HYMN_RADIUS_FT) continue;
        }
      }
    }

    const singerDnd = getDnD35EntityData(state, candidateId);
    let performRanks = singerDnd.skillRanks['perform'] ?? 0;
    for (const [skillId, ranks] of Object.entries(singerDnd.skillRanks)) {
      if (skillId.startsWith('perform') && ranks > performRanks) {
        performRanks = ranks;
      }
    }
    if (performRanks > maxBonus) {
      maxBonus = performRanks;
    }
  }

  return maxBonus;
}

/** Inputs required to apply resolved spell units onto a single target entity. */
export interface ApplySpellEffectsContext {
  readonly state: GameState;
  readonly casterId: EntityId;
  readonly targetId: EntityId;
  readonly targetPos: { readonly x: number; readonly y: number };
  readonly spell: DnD35SpellDefinition;
  readonly units: ReadonlyArray<DnD35SpellEffectUnit>;
  readonly casterLevel: number;
  readonly castId: string;
  readonly metamagic: MetamagicSpellModifiers;
  readonly casterAbilityMod: number;
  readonly totalBab: number;
  readonly saveResultByUnitId: Readonly<Record<string, boolean>>;
  readonly sysContent: DnD35SystemContent | undefined;
}

function buildScaledDiceExpression(baseDice: string, scaledDiceCount: number, scaledFlat: number): string {
  const normalized = baseDice.replace(/\s+/g, '');
  const match = /^(\d+)d(\d+)(?:([+-])(\d+))?$/i.exec(normalized);
  if (!match) {
    return scaledFlat !== 0 ? `${normalized}${scaledFlat > 0 ? `+${scaledFlat}` : scaledFlat}` : normalized;
  }
  const count = scaledDiceCount > 0 ? scaledDiceCount : Number.parseInt(match[1] ?? '1', 10);
  const sides = Number.parseInt(match[2] ?? '6', 10);
  const baseSign = match[3] === '-' ? -1 : 1;
  const baseFlat = match[4] !== undefined ? Number.parseInt(match[4], 10) : 0;
  const totalFlat = baseSign * baseFlat + scaledFlat;
  if (totalFlat === 0) return `${count}d${sides}`;
  return totalFlat > 0 ? `${count}d${sides}+${totalFlat}` : `${count}d${sides}${totalFlat}`;
}

function queueDamageOnEntity(
  state: GameState,
  targetId: EntityId,
  sourceEntityId: EntityId,
  amount: number,
  damageType: string
): GameState {
  if (amount <= 0) return state;
  const existing = getComponent(state, targetId, ComponentType.Damage) as DamageComponent | undefined;
  const nextInstance = { amount, sourceEntityId, tags: [damageType] };
  return addComponent(state, targetId, {
    type: ComponentType.Damage,
    instances: [...(existing?.instances ?? []), nextInstance]
  });
}

function appendTargetModifiers(
  state: GameState,
  targetId: EntityId,
  spellId: string,
  castId: string,
  newModifiers: ReadonlyArray<StatModifier>
): GameState {
  if (newModifiers.length === 0) return state;
  const targetDnd = getDnD35EntityData(state, targetId);
  const existing = targetDnd.statModifiers ?? [];
  const bareSpellRoot = `spell:${spellId}`;
  const currentCastPrefix = `spell:${spellId}:${castId}`;
  const incomingPaths = new Set(newModifiers.map((m) => m.sourcePath ?? m.sourceId));
  const cleaned = existing.filter((m) => {
    const path = m.sourcePath ?? m.sourceId;
    if (incomingPaths.has(path)) return false;
    const isThisSpell =
      path === bareSpellRoot || path.startsWith(`${bareSpellRoot}:`) || path.startsWith(`${bareSpellRoot}/`);
    if (!isThisSpell) return true;
    return path === currentCastPrefix || path.startsWith(`${currentCastPrefix}/`);
  });
  return setDnD35EntityData(state, targetId, {
    ...targetDnd,
    statModifiers: [...cleaned, ...newModifiers]
  });
}

interface AppliedTargetSpellEffectsTracker {
  readonly modifiers: StatModifier[];
  readonly grantedTags: string[];
  readonly appliedConditions: Array<{
    readonly unitId: string;
    readonly conditionId: string;
    readonly unit: Extract<DnD35SpellEffectUnit, { type: 'condition' }>;
  }>;
  hasAbilityHarm: boolean;
}

function applySingleSpellUnit(
  ctx: ApplySpellEffectsContext,
  unit: DnD35SpellEffectUnit,
  saved: boolean,
  tracker: AppliedTargetSpellEffectsTracker
): GameState {
  const { casterId, targetId, targetPos, spell, casterLevel, castId, metamagic, sysContent } = ctx;
  let runningState = ctx.state;
  const saveEffect = unit.savingThrow?.effect ?? spell.savingThrow?.effect ?? 'negates';

  if (saved && (saveEffect === 'negates' || saveEffect === 'disbelief')) {
    return runningState;
  }

  switch (unit.type) {
    case 'damage': {
      const diceCount = unit.diceCountScaling ? evaluateSpellScalingRule(unit.diceCountScaling, casterLevel) : 0;
      const flatBonus = unit.flatBonusScaling ? evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel) : 0;
      const projectiles = unit.projectileCountScaling
        ? Math.max(1, evaluateSpellScalingRule(unit.projectileCountScaling, casterLevel))
        : 1;
      const expr = buildScaledDiceExpression(unit.dice, diceCount, flatBonus);
      const unitMeta = unit.metamagicScalable ? metamagic : undefined;
      let totalAmt = 0;
      for (let p = 0; p < projectiles; p++) {
        totalAmt += evaluateMetamagicDamage(expr, unitMeta).totalDamage;
      }
      if (saved && saveEffect === 'half') {
        totalAmt = Math.floor(totalAmt / 2);
      }
      return queueDamageOnEntity(runningState, targetId, casterId, totalAmt, unit.damageType);
    }

    case 'healing': {
      const flatBonus = unit.flatBonusScaling ? evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel) : 0;
      const expr = buildScaledDiceExpression(unit.dice, 0, flatBonus);
      const unitMeta = unit.metamagicScalable ? metamagic : undefined;
      let amount = Math.max(1, evaluateMetamagicDamage(expr, unitMeta).totalDamage);
      const hymnBonus = resolveHealingHymnBonus(runningState, casterId);
      if (hymnBonus > 0) {
        amount += hymnBonus;
        runningState = addMessage(
          runningState,
          `Healing Hymn empowers healing (+${hymnBonus} HP).`,
          MessageLogCategory.CombatHit
        );
      }
      if (saved && saveEffect === 'half') {
        amount = Math.floor(amount / 2);
      }
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const targetDag = evaluateDnD35eEntityDAG(runningState, targetId);
      const isUndead =
        targetDnd.creatureType === 'undead' ||
        (targetDag?.selfTags.includes('type:undead') ?? false) ||
        (targetDag?.selfTags.includes('undead') ?? false);
      if (isUndead && unit.invertsForUndead) {
        return queueDamageOnEntity(runningState, targetId, casterId, amount, 'positive');
      }
      if (unit.isTemporaryHp) {
        const nextTemp = Math.max(targetDnd.tempHp, amount);
        runningState = setDnD35EntityData(runningState, targetId, { ...targetDnd, tempHp: nextTemp });
        runningState = addFloatingText(runningState, targetId, `+${amount} TMP`, '#38bdf8');
        return addMessage(runningState, `${spell.name} grants ${amount} temporary HP.`, MessageLogCategory.System);
      }
      const fighter = getComponent(runningState, targetId, ComponentType.Fighter) as FighterComponent | undefined;
      if (!fighter) return runningState;
      const dag = evaluateDnD35eEntityDAG(runningState, targetId);
      const maxHp = Math.max(fighter.maxHp, dag?.dagResult.maxHp ?? fighter.maxHp);
      const nextHp = Math.min(maxHp, fighter.hp + amount);
      const restored = Math.max(0, nextHp - fighter.hp);
      runningState = addComponent(runningState, targetId, { ...fighter, hp: nextHp });
      if (targetDnd.nonlethalDamage > 0 && amount > 0) {
        const reducedNonlethal = Math.min(targetDnd.nonlethalDamage, amount);
        runningState = setDnD35EntityData(runningState, targetId, {
          ...targetDnd,
          nonlethalDamage: targetDnd.nonlethalDamage - reducedNonlethal
        });
      }
      if (restored > 0) {
        runningState = addFloatingText(runningState, targetId, `+${restored}`, '#4ade80');
      }
      return addMessage(runningState, `${spell.name} heals ${restored} HP.`, MessageLogCategory.System);
    }

    case 'stat_bundle': {
      const unitMods = materializeSpellUnitModifiers(spell, unit, casterLevel, castId);
      tracker.modifiers.push(...unitMods);
      for (const gTag of unit.effectBundle.grantedTags) {
        if (!tracker.grantedTags.includes(gTag)) tracker.grantedTags.push(gTag);
      }
      runningState = appendTargetModifiers(runningState, targetId, spell.id, castId, unitMods);
      const clearsDrain = unit.effectBundle.ruleOverrides.some(
        (r) => r.ruleKey === 'clears_negative_levels_and_ability_drain' && r.value === true
      );
      if (clearsDrain) {
        let restoredAnything = false;
        const preDnd = getDnD35EntityData(runningState, targetId);
        if ((preDnd.negativeLevels ?? 0) > 0) {
          runningState = applyNegativeLevelsToActor(runningState, targetId, 0);
          restoredAnything = true;
        }
        const curDnd = getDnD35EntityData(runningState, targetId);
        const nextAbilities: Record<string, AbilityScoresRecord[keyof AbilityScoresRecord]> = {
          ...curDnd.abilityScores
        };
        for (const abId of ALL_ABILITY_IDS) {
          const score = curDnd.abilityScores[abId];
          if (score.damage > 0 || score.drain > 0 || score.tempPenalty > 0) {
            nextAbilities[abId] = { ...score, damage: 0, drain: 0, tempPenalty: 0 };
            restoredAnything = true;
          }
        }
        const abilityIdSet = new Set<string>(ALL_ABILITY_IDS);
        const existingMods = curDnd.statModifiers ?? [];
        const removedPrefixes = new Set<string>();
        const cleanedMods = existingMods.filter((m) => {
          const shouldRemove = m.origin === 'spell' && m.value < 0 && abilityIdSet.has(m.targetStat);
          if (shouldRemove && m.sourcePath) {
            removedPrefixes.add(m.sourcePath.split('/').slice(0, 2).join('/'));
          }
          return !shouldRemove;
        });
        if (cleanedMods.length !== existingMods.length) {
          restoredAnything = true;
        }
        if (restoredAnything) {
          runningState = setDnD35EntityData(runningState, targetId, {
            ...curDnd,
            abilityScores: nextAbilities as unknown as AbilityScoresRecord,
            statModifiers: cleanedMods
          });
          if (removedPrefixes.size > 0) {
            const statusComp = getComponent(runningState, targetId, ComponentType.StatusEffects) as
              StatusEffectsComponent | undefined;
            if (statusComp) {
              const filteredStatuses = statusComp.activeEffects.filter((eff) => {
                if (!eff.sourcePath || !removedPrefixes.has(eff.sourcePath)) return true;
                const stillHasMods = cleanedMods.some((m) => (m.sourcePath ?? '').startsWith(eff.sourcePath!));
                return stillHasMods || eff.linkedConditionId !== undefined || (eff.grantedTags?.length ?? 0) > 0;
              });
              if (filteredStatuses.length === 0) {
                runningState = removeComponent(runningState, targetId, ComponentType.StatusEffects);
              } else if (filteredStatuses.length !== statusComp.activeEffects.length) {
                runningState = addComponent(runningState, targetId, {
                  ...statusComp,
                  activeEffects: filteredStatuses
                });
              }
            }
          }
          runningState = addMessage(
            runningState,
            `${spell.name} restores drained abilities and dispels negative levels.`,
            MessageLogCategory.System
          );
        }
      }
      return runningState;
    }

    case 'condition': {
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const cureSet = new Set(unit.curesConditions);
      const filtered = targetDnd.conditions.filter((c) => !cureSet.has(c));
      const rawCondId = unit.conditionId;
      const isValidCondition =
        rawCondId !== 'none' &&
        (sysContent?.conditionEffects === undefined
          ? !CURE_ONLY_CONDITION_SENTINELS.has(rawCondId)
          : sysContent.conditionEffects[rawCondId] !== undefined);
      const nextConds = isValidCondition
        ? applyConditionWithEscalation(filtered, rawCondId as DnD35ConditionId, sysContent?.conditionEffects)
        : filtered;
      runningState = setDnD35EntityData(runningState, targetId, { ...targetDnd, conditions: nextConds });
      if (isValidCondition) {
        tracker.appliedConditions.push({ unitId: unit.unitId, conditionId: rawCondId, unit });
      }
      const statusComp = getComponent(runningState, targetId, ComponentType.StatusEffects) as
        StatusEffectsComponent | undefined;
      if (statusComp && cureSet.size > 0) {
        const nextActive = statusComp.activeEffects.filter(
          (eff) => !cureSet.has(eff.effectId) && !(eff.effectId === 'poison' && cureSet.has('poisoned'))
        );
        if (nextActive.length === 0) {
          runningState = removeComponent(runningState, targetId, ComponentType.StatusEffects);
        } else if (nextActive.length !== statusComp.activeEffects.length) {
          runningState = addComponent(runningState, targetId, { ...statusComp, activeEffects: nextActive });
        }
      }
      return runningState;
    }

    case 'ability_harm': {
      const flat = unit.flatBonusScaling ? evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel) : 0;
      const expr = buildScaledDiceExpression(unit.dice, 0, flat);
      const penalty = Math.max(MIN_ABILITY_SCORE_DEFAULT, evaluateDiceExpression(expr).total);
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const mod: StatModifier = {
        sourceId: unit.unitId,
        sourcePath: `spell:${spell.id}:${castId}/unit:${unit.unitId}`,
        targetStat: unit.ability,
        bonusType: 'untyped',
        value: -penalty,
        origin: 'spell'
      };
      tracker.modifiers.push(mod);
      tracker.hasAbilityHarm = true;
      return setDnD35EntityData(runningState, targetId, {
        ...targetDnd,
        statModifiers: [...(targetDnd.statModifiers ?? []), mod]
      });
    }

    case 'spatial_field':
    case 'dispel':
    case 'summon':
    case 'spell_strike':
    case 'save_or_die':
    case 'energy_drain':
      return applySpecialSpellUnit({
        state: runningState,
        casterId,
        targetId,
        targetPos,
        spell,
        unit,
        saved,
        casterLevel,
        castId,
        metamagic,
        casterAbilityMod: ctx.casterAbilityMod,
        totalBab: ctx.totalBab,
        sysContent,
        queueDamage: queueDamageOnEntity,
        buildDice: buildScaledDiceExpression
      });

    case 'quicken_cast_grant': {
      const maxQuickenLevel = evaluateSpellScalingRule(unit.maxSpellLevelScaling, casterLevel);
      const quickenMod: StatModifier = {
        sourceId: unit.unitId,
        sourcePath: `spell:${spell.id}:${castId}/unit:${unit.unitId}`,
        targetStat: 'quicken_max_spell_level',
        bonusType: 'untyped',
        value: maxQuickenLevel,
        origin: 'spell',
        ...(unit.condition !== undefined ? { condition: unit.condition } : {})
      };
      tracker.modifiers.push(quickenMod);
      runningState = appendTargetModifiers(runningState, targetId, spell.id, castId, [quickenMod]);
      return addMessage(
        runningState,
        `${spell.name} enables quickened casting up to spell level ${maxQuickenLevel}.`,
        MessageLogCategory.System
      );
    }

    case 'retaliation_rider': {
      const riderMod: StatModifier = {
        sourceId: unit.unitId,
        sourcePath: `spell:${spell.id}:${castId}/unit:${unit.unitId}`,
        targetStat: 'retaliation_rider_active',
        bonusType: 'untyped',
        value: Math.max(1, casterLevel),
        origin: 'spell',
        ...(unit.condition !== undefined ? { condition: unit.condition } : {})
      };
      tracker.modifiers.push(riderMod);
      return appendTargetModifiers(runningState, targetId, spell.id, castId, [riderMod]);
    }

    case 'form_overlay': {
      const races = sysContent?.races ?? {};
      const maxHd =
        typeof unit.maxHitDiceScaling === 'number'
          ? unit.maxHitDiceScaling
          : unit.maxHitDiceScaling !== undefined
            ? evaluateSpellScalingRule(unit.maxHitDiceScaling, casterLevel)
            : unit.overlayMode === 'baleful_polymorph'
              ? 1
              : Math.max(1, casterLevel);
      const getRaceHd = (race: DnD35RaceDefinition): number =>
        Math.max(1, race.rhdProgression?.baseHdCount || race.racialHitDice?.count || 1);
      const eligible = Object.values(races).filter((race) => {
        if (unit.allowedCreatureTypes.length > 0 && !unit.allowedCreatureTypes.includes(race.creatureType)) {
          return false;
        }
        return getRaceHd(race) <= maxHd;
      });
      if (eligible.length === 0) return runningState;

      eligible.sort((a, b) => {
        const hdA = getRaceHd(a);
        const hdB = getRaceHd(b);
        const strA = a.defaultAbilityScores?.str ?? DEFAULT_FORM_ABILITY_SCORE + (a.abilityAdjustments?.str ?? 0);
        const strB = b.defaultAbilityScores?.str ?? DEFAULT_FORM_ABILITY_SCORE + (b.abilityAdjustments?.str ?? 0);
        if (unit.overlayMode === 'baleful_polymorph') {
          return hdA - hdB || strA - strB;
        }
        const naA = a.naturalArmorBonus ?? 0;
        const naB = b.naturalArmorBonus ?? 0;
        return hdB - hdA || strB + naB - (strA + naA);
      });

      const chosen = eligible[0]!;
      const str =
        chosen.defaultAbilityScores?.str ?? DEFAULT_FORM_ABILITY_SCORE + (chosen.abilityAdjustments?.str ?? 0);
      const dex =
        chosen.defaultAbilityScores?.dex ?? DEFAULT_FORM_ABILITY_SCORE + (chosen.abilityAdjustments?.dex ?? 0);
      const con =
        chosen.defaultAbilityScores?.con ?? DEFAULT_FORM_ABILITY_SCORE + (chosen.abilityAdjustments?.con ?? 0);
      const movementModesOverride: MovementModes = {
        land: chosen.movementModes?.land ?? chosen.baseLandSpeedFt ?? DEFAULT_FORM_LAND_SPEED_FT,
        ...(chosen.movementModes?.fly !== undefined ? { fly: chosen.movementModes.fly } : {}),
        ...(chosen.movementModes?.swim !== undefined ? { swim: chosen.movementModes.swim } : {}),
        ...(chosen.movementModes?.climb !== undefined ? { climb: chosen.movementModes.climb } : {}),
        ...(chosen.movementModes?.burrow !== undefined ? { burrow: chosen.movementModes.burrow } : {})
      };
      const isPermanent = spell.duration === 'instantaneous' || unit.overlayMode === 'baleful_polymorph';
      const durationTurns = Math.max(1, casterLevel) * (metamagic.extend ? 2 : 1);
      const overlay: PropertyOverlayComponent = {
        type: ComponentType.PropertyOverlay,
        source: `spell:${spell.id}:${castId}`,
        priority: unit.overlayMode === 'shapechange' ? SHAPECHANGE_OVERLAY_PRIORITY : POLYMORPH_OVERLAY_PRIORITY,
        ...(!isPermanent ? { durationTurns } : {}),
        sizeCategoryOverride: chosen.size,
        creatureTypeOverride: chosen.creatureType,
        movementModesOverride,
        ...(chosen.naturalWeapons && chosen.naturalWeapons.length > 0
          ? { naturalWeaponsOverride: chosen.naturalWeapons }
          : {}),
        ...(chosen.footprint !== undefined ? { footprintOverride: chosen.footprint } : {}),
        ...(chosen.footprintsBySize !== undefined ? { footprintsBySizeOverride: chosen.footprintsBySize } : {}),
        statOverrides: {
          str,
          dex,
          con,
          naturalArmorBonus: chosen.naturalArmorBonus ?? 0
        },
        grantedTags: [
          `form:${chosen.id}`,
          chosen.creatureType,
          `overlay:${unit.overlayMode}`,
          unit.overlayMode === 'baleful_polymorph' ? 'baleful_polymorphed' : 'polymorphed'
        ]
      };
      runningState = addComponent(runningState, targetId, overlay);
      runningState = addFloatingText(runningState, targetId, chosen.name.toUpperCase(), '#a855f7');
      return addMessage(
        runningState,
        `${spell.name} transforms target into a ${chosen.name}!`,
        MessageLogCategory.CombatHit
      );
    }

    default:
      return assertNever(unit);
  }
}

/**
 * Applies top-level `spell.effectBundle` and all evaluated `units` onto a single target entity,
 * registering timed/permanent spell buffs, debuffs, and conditions in `StatusEffectsComponent`.
 */
export function applyResolvedSpellEffectsToTarget(ctx: ApplySpellEffectsContext): GameState {
  let runningState = ctx.state;
  const tracker: AppliedTargetSpellEffectsTracker = {
    modifiers: [],
    grantedTags: [...(ctx.spell.effectBundle?.grantedTags ?? [])],
    appliedConditions: [],
    hasAbilityHarm: false
  };

  const topMods = materializeTopLevelSpellModifiers(ctx.spell, ctx.castId);
  if (topMods.length > 0) {
    tracker.modifiers.push(...topMods);
    runningState = appendTargetModifiers(runningState, ctx.targetId, ctx.spell.id, ctx.castId, topMods);
  }

  for (const unit of ctx.units) {
    const saved = ctx.saveResultByUnitId[unit.unitId] === true;
    runningState = applySingleSpellUnit({ ...ctx, state: runningState }, unit, saved, tracker);
  }

  if (ctx.units.length === 0 && ctx.spell.damageDice && !ctx.spell.effectBundle) {
    const rolled = evaluateMetamagicDamage(ctx.spell.damageDice, ctx.metamagic).totalDamage;
    const saved = ctx.saveResultByUnitId['top_level'] === true;
    const finalDmg = saved ? Math.floor(rolled / 2) : rolled;
    runningState = queueDamageOnEntity(
      runningState,
      ctx.targetId,
      ctx.casterId,
      finalDmg,
      ctx.spell.damageType ?? 'untyped'
    );
  }

  const spellSourcePath = `spell:${ctx.spell.id}:${ctx.castId}`;
  const isExtended = ctx.metamagic.extend === true;
  const activeClock = getEffectiveWorldClockConfig(runningState);

  if (tracker.modifiers.length > 0 || tracker.grantedTags.length > 0) {
    const parsed = parseSpellDurationTurns(ctx.spell.duration, ctx.casterLevel, {
      extend: isExtended,
      isConditionOrBuffSpell: true,
      clock: activeClock
    });
    if (parsed.isPermanent || parsed.durationTurns > 0) {
      const singleCondId =
        tracker.appliedConditions.length === 1 ? tracker.appliedConditions[0]!.conditionId : undefined;
      const polarity = classifyEffectPolarity(tracker.modifiers, {
        ...(singleCondId !== undefined ? { linkedConditionId: singleCondId } : {}),
        hasAbilityHarm: tracker.hasAbilityHarm
      });
      const summary = formatSpellModifiersSummary(tracker.modifiers, {
        grantedTags: tracker.grantedTags,
        ...(singleCondId !== undefined ? { linkedConditionId: singleCondId } : {})
      });
      runningState = applyStatusEffect(
        runningState,
        ctx.targetId,
        `spell:${ctx.spell.id}`,
        parsed.isPermanent ? 1 : parsed.durationTurns,
        ctx.casterId,
        undefined,
        {
          displayName: ctx.spell.name,
          ...(summary ? { summary } : {}),
          polarity,
          color: POLARITY_COLORS[polarity],
          sourcePath: spellSourcePath,
          casterLevel: ctx.casterLevel,
          ...(singleCondId !== undefined ? { linkedConditionId: singleCondId } : {}),
          ...(tracker.grantedTags.length > 0 ? { grantedTags: tracker.grantedTags } : {}),
          ...(parsed.isPermanent ? { isPermanent: true } : {}),
          replaceExisting: true
        }
      );
    }
  }

  const shouldRegisterIndividualConditions =
    tracker.appliedConditions.length > 1 ||
    (tracker.appliedConditions.length === 1 && tracker.modifiers.length === 0 && tracker.grantedTags.length === 0);

  if (shouldRegisterIndividualConditions) {
    const singleCond = tracker.appliedConditions.length === 1;
    for (const entry of tracker.appliedConditions) {
      let condDurationTurns = 0;
      let condIsPermanent = false;
      if (entry.unit.durationRoundsScaling) {
        condDurationTurns = Math.max(1, evaluateSpellScalingRule(entry.unit.durationRoundsScaling, ctx.casterLevel));
        if (isExtended) condDurationTurns *= EXTEND_METAMAGIC_DURATION_MULTIPLIER;
      } else {
        const parsedCond = parseSpellDurationTurns(entry.unit.duration ?? ctx.spell.duration, ctx.casterLevel, {
          extend: isExtended,
          fallbackRoundsForCondition: true,
          clock: activeClock
        });
        condDurationTurns = parsedCond.durationTurns;
        condIsPermanent = parsedCond.isPermanent;
      }
      if (!condIsPermanent && condDurationTurns <= 0) continue;

      const polarity = classifyEffectPolarity([], {
        linkedConditionId: entry.conditionId,
        targetRole: entry.unit.targetRole
      });
      const summary = formatSpellModifiersSummary([], { linkedConditionId: entry.conditionId });
      const condStatusId = singleCond ? `spell:${ctx.spell.id}` : `spell:${ctx.spell.id}:${entry.unitId}`;
      runningState = applyStatusEffect(
        runningState,
        ctx.targetId,
        condStatusId,
        condIsPermanent ? 1 : condDurationTurns,
        ctx.casterId,
        undefined,
        {
          displayName: ctx.spell.name,
          ...(summary ? { summary } : {}),
          polarity,
          color: POLARITY_COLORS[polarity],
          sourcePath: spellSourcePath,
          casterLevel: ctx.casterLevel,
          linkedConditionId: entry.conditionId,
          ...(condIsPermanent ? { isPermanent: true } : {}),
          replaceExisting: true
        }
      );
    }
  }

  return syncDnD35eActorSpatialFootprint(runningState, ctx.targetId);
}
