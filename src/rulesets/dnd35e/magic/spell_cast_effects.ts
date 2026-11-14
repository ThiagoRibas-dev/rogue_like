/**
 * @file Per-target effect-unit application helpers for runtime D&D 3.5e spell execution.
 * Applies evaluated `DnD35SpellEffectUnit`s and top-level `effectBundle`s.
 */

import { addComponent, getComponent } from '../../../core/ecs.ts';
import { addFloatingText } from '../../../systems/damage.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { ComponentType, type DamageComponent, type FighterComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { assertNever } from '../../../utils/assert.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { revokeModifiersByPathPrefix } from '../modifiers/provenance.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ConditionId, StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellDefinition, DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { evaluateMetamagicDamage, type MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { applySpecialSpellUnit } from './spell_cast_units.ts';
import {
  evaluateSpellScalingRule,
  materializeSpellUnitModifiers,
  materializeTopLevelSpellModifiers
} from './spell_effects.ts';

const MIN_ABILITY_SCORE_DEFAULT = 1;

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
  newModifiers: ReadonlyArray<StatModifier>
): GameState {
  if (newModifiers.length === 0) return state;
  const targetDnd = getDnD35EntityData(state, targetId);
  const existing = targetDnd.statModifiers ?? [];
  const spellPrefix = `spell:${spellId}:`;
  const cleaned = revokeModifiersByPathPrefix(existing, `spell:${spellId}`).filter(
    (m) => !(m.sourcePath ?? m.sourceId).startsWith(spellPrefix)
  );
  return setDnD35EntityData(state, targetId, {
    ...targetDnd,
    statModifiers: [...cleaned, ...newModifiers]
  });
}

function applySingleSpellUnit(ctx: ApplySpellEffectsContext, unit: DnD35SpellEffectUnit, saved: boolean): GameState {
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
      if (restored > 0) {
        runningState = addFloatingText(runningState, targetId, `+${restored}`, '#4ade80');
      }
      return addMessage(runningState, `${spell.name} heals ${restored} HP.`, MessageLogCategory.System);
    }

    case 'stat_bundle':
      return appendTargetModifiers(
        runningState,
        targetId,
        spell.id,
        materializeSpellUnitModifiers(spell, unit, casterLevel, castId)
      );

    case 'condition': {
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const cureSet = new Set(unit.curesConditions);
      const filtered = targetDnd.conditions.filter((c) => !cureSet.has(c));
      const condId = unit.conditionId as DnD35ConditionId;
      const nextConds = filtered.includes(condId) ? filtered : [...filtered, condId];
      return setDnD35EntityData(runningState, targetId, { ...targetDnd, conditions: nextConds });
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

    case 'quicken_cast_grant':
    case 'retaliation_rider':
    case 'form_overlay':
      return runningState;

    default:
      return assertNever(unit);
  }
}

/**
 * Applies top-level `spell.effectBundle` and all evaluated `units` onto a single target entity.
 */
export function applyResolvedSpellEffectsToTarget(ctx: ApplySpellEffectsContext): GameState {
  let runningState = ctx.state;
  const topMods = materializeTopLevelSpellModifiers(ctx.spell, ctx.castId);
  if (topMods.length > 0) {
    runningState = appendTargetModifiers(runningState, ctx.targetId, ctx.spell.id, topMods);
  }

  for (const unit of ctx.units) {
    const saved = ctx.saveResultByUnitId[unit.unitId] === true;
    runningState = applySingleSpellUnit({ ...ctx, state: runningState }, unit, saved);
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

  return runningState;
}
