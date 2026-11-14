/**
 * @file Specialized D&D 3.5e spell effect unit handlers (`spatial_field`, `dispel`, `summon`,
 * `spell_strike`, `save_or_die`, `energy_drain`) called by `spell_cast_effects.ts`.
 */

import { addComponent, createEntity, getComponent, spawnEntity } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { ComponentType, type FieldComponent, type PositionComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { revokeModifiersByPathPrefix } from '../modifiers/provenance.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ConditionId } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { StatModifier } from '../types/stats.types.ts';
import type { DnD35SpellDefinition, DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { resolveDispelCheck, type MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { evaluateSpellScalingRule } from './spell_effects.ts';
import { resolveIterativeSpellStrike } from './spell_strike_resolver.ts';

const DEFAULT_FIELD_DURATION_ROUNDS = 10;

export type QueueDamageFn = (
  state: GameState,
  targetId: EntityId,
  sourceEntityId: EntityId,
  amount: number,
  damageType: string
) => GameState;

export type BuildDiceFn = (baseDice: string, scaledDiceCount: number, scaledFlat: number) => string;

/** Applies a spatial_field, dispel, summon, spell_strike, save_or_die, or energy_drain effect unit. */
export function applySpecialSpellUnit(params: {
  readonly state: GameState;
  readonly casterId: EntityId;
  readonly targetId: EntityId;
  readonly targetPos: { readonly x: number; readonly y: number };
  readonly spell: DnD35SpellDefinition;
  readonly unit: DnD35SpellEffectUnit;
  readonly saved: boolean;
  readonly casterLevel: number;
  readonly castId: string;
  readonly metamagic: MetamagicSpellModifiers;
  readonly casterAbilityMod: number;
  readonly totalBab: number;
  readonly sysContent: DnD35SystemContent | undefined;
  readonly queueDamage: QueueDamageFn;
  readonly buildDice: BuildDiceFn;
}): GameState {
  const {
    casterId,
    targetId,
    targetPos,
    spell,
    unit,
    saved,
    casterLevel,
    castId,
    metamagic,
    sysContent,
    queueDamage,
    buildDice
  } = params;
  let runningState = params.state;

  switch (unit.type) {
    case 'spatial_field': {
      const anchorPos = unit.anchorToCaster
        ? (getComponent(runningState, casterId, ComponentType.Position) as PositionComponent | undefined)
        : targetPos;
      if (!anchorPos) return runningState;
      const [sWithEnt, fieldEntityId] = createEntity(runningState);
      const fieldComp: FieldComponent = {
        type: ComponentType.Field,
        fieldType: unit.fieldType,
        intensity: Math.max(1, casterLevel),
        duration: DEFAULT_FIELD_DURATION_ROUNDS * (metamagic.extend ? 2 : 1),
        ...(unit.anchorToCaster ? { anchorEntityId: casterId } : {}),
        radiusFt: unit.radiusFt * (metamagic.widen ? 2 : 1),
        sourceEntityId: casterId,
        blocksLoS: unit.blocksLoS,
        blocksLoE: unit.blocksLoE,
        suppressedTags: unit.suppressedTags,
        ...(unit.movementCostMultiplier !== undefined ? { movementCostMultiplier: unit.movementCostMultiplier } : {}),
        spellId: spell.id,
        castId,
        casterLevel,
        ...(unit.illuminationOverride !== undefined ? { illuminationOverride: unit.illuminationOverride } : {})
      };
      let nextState = addComponent(sWithEnt, fieldEntityId, {
        type: ComponentType.Position,
        x: anchorPos.x,
        y: anchorPos.y
      });
      nextState = addComponent(nextState, fieldEntityId, fieldComp);
      return nextState;
    }

    case 'dispel': {
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const existing = targetDnd.statModifiers ?? [];
      const spellRoots = Array.from(
        new Set(
          existing
            .map((m) => m.sourcePath)
            .filter((p): p is string => p !== undefined && p.startsWith(unit.revokesPathPrefix))
            .map((p) => p.split('/').slice(0, 2).join('/'))
        )
      );
      let cleaned: ReadonlyArray<StatModifier> = [...existing];
      let dispelledCount = 0;
      for (const rootPath of spellRoots) {
        const res = resolveDispelCheck(
          Math.min(casterLevel, unit.maxCasterLevelBonus),
          casterLevel,
          unit.maxCasterLevelBonus > 10
        );
        if (res.dispelled) {
          cleaned = revokeModifiersByPathPrefix(cleaned, rootPath);
          dispelledCount++;
        }
      }
      if (dispelledCount > 0) {
        runningState = setDnD35EntityData(runningState, targetId, { ...targetDnd, statModifiers: cleaned });
        runningState = addMessage(
          runningState,
          `${spell.name} dispels ${dispelledCount} active spell effect(s)!`,
          MessageLogCategory.System
        );
      }
      return runningState;
    }

    case 'summon': {
      const eligible = unit.summonPool.filter((entry) => casterLevel >= entry.minCasterLevel);
      const chosen = eligible[eligible.length - 1] ?? unit.summonPool[0];
      if (!chosen) return runningState;
      const durationRounds = unit.durationRoundsScaling
        ? evaluateSpellScalingRule(unit.durationRoundsScaling, casterLevel)
        : Math.max(1, casterLevel);
      const [spawnedState, minionId] = spawnEntity(runningState, chosen.raceId, targetPos.x, targetPos.y);
      let nextState = addComponent(spawnedState, minionId, {
        type: ComponentType.ControllerLink,
        controllerEntityId: casterId,
        tags: ['summon', 'temporary_ally'],
        stance: 'aggressive',
        expirationTurn: spawnedState.globalTurn + durationRounds * (metamagic.extend ? 2 : 1)
      });
      nextState = addMessage(
        nextState,
        `${spell.name} summons ${chosen.raceId.replace(/_/g, ' ')}!`,
        MessageLogCategory.System
      );
      return nextState;
    }

    case 'spell_strike': {
      const targetDag = evaluateDnD35eEntityDAG(runningState, targetId);
      const casterDnd = getDnD35EntityData(runningState, casterId);
      if (!targetDag) return runningState;
      const targetDnd = targetDag.dndData;
      const strikeRes = resolveIterativeSpellStrike({
        descriptor: unit.spellStrike,
        totalBab: params.totalBab,
        castingAbilityModifier: params.casterAbilityMod,
        casterLevel,
        targetFullAC: targetDag.dagResult.acBreakdown.fullAC,
        targetTouchAC: targetDag.dagResult.acBreakdown.touchAC,
        targetSpellResistance: targetDnd.spellResistance,
        targetImmuneToCrits: targetDnd.immunities.includes('critical_hits'),
        targetConcealmentPercent: targetDag.dagResult.concealmentMissChancePercent,
        targetFortificationPercent: targetDag.dagResult.fortificationPercent,
        deityFavoredWeaponId: casterDnd.deityFavoredWeaponId,
        itemsRegistry: sysContent?.items
      });
      if (strikeRes.blockedBySpellResistance) {
        return addMessage(
          runningState,
          `Target's Spell Resistance resists ${spell.name}!`,
          MessageLogCategory.CombatMiss
        );
      }
      return strikeRes.totalDamage > 0
        ? queueDamage(runningState, targetId, casterId, strikeRes.totalDamage, 'force')
        : runningState;
    }

    case 'save_or_die': {
      if (saved) {
        if (unit.onSavePartialDamageDice) {
          const flat = unit.onSavePartialFlatScaling
            ? evaluateSpellScalingRule(unit.onSavePartialFlatScaling, casterLevel)
            : 0;
          const dmg = evaluateDiceExpression(buildDice(unit.onSavePartialDamageDice, 0, flat)).total;
          return queueDamage(runningState, targetId, casterId, dmg, unit.onSaveDamageType ?? 'untyped');
        }
        return runningState;
      }
      if (unit.onFailOutcome === 'dead') {
        return addComponent(runningState, targetId, { type: ComponentType.Death, killerId: casterId });
      }
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const cond = unit.onFailOutcome as DnD35ConditionId;
      const nextConds = targetDnd.conditions.includes(cond) ? targetDnd.conditions : [...targetDnd.conditions, cond];
      return setDnD35EntityData(runningState, targetId, { ...targetDnd, conditions: nextConds });
    }

    case 'energy_drain': {
      const levels = Math.max(1, evaluateDiceExpression(unit.dice).total);
      const targetDnd = getDnD35EntityData(runningState, targetId);
      return setDnD35EntityData(runningState, targetId, {
        ...targetDnd,
        negativeLevels: (targetDnd.negativeLevels ?? 0) + levels
      });
    }

    default:
      return runningState;
  }
}
