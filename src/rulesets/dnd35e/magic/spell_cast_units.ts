/**
 * @file Specialized D&D 3.5e spell effect unit handlers (`spatial_field`, `dispel`, `summon`,
 * `spell_strike`, `save_or_die`, `energy_drain`) called by `spell_cast_effects.ts`.
 */

import { addComponent, createEntity, getComponent, removeComponent, spawnEntity } from '../../../core/ecs.ts';
import { getTileDefAt, getTileIdAt, isInMapBounds } from '../../../map/map_accessor.ts';
import { scheduleTimedTerrainRevert, sculptTerrainVoxel } from '../../../systems/construction.system.ts';
import { applyFluidToVoxel, processDirtyFluidChunks } from '../../../systems/physics/fluid_physics.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type FieldComponent,
  type PositionComponent,
  type StatusEffectsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { revokeModifiersByPathPrefix } from '../modifiers/provenance.ts';
import { syncDnD35eActorSpatialFootprint } from '../spatial/footprint_resolver.ts';
import { evaluateActorLightExposure } from '../spatial/light_exposure.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ConditionId } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { StatModifier } from '../types/stats.types.ts';
import type { DnD35SpellDefinition, DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { resolveDispelCheck, type MetamagicSpellModifiers } from './metamagic_dispel.ts';
import { evaluateSpellScalingRule } from './spell_effects.ts';
import { DEFAULT_DISPEL_FALLBACK_CL } from './spell_duration.ts';
import { materializeSummonedCreatureModifiers } from './spell_modifiers.ts';
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
  readonly targetPos: { readonly x: number; readonly y: number; readonly z?: number | undefined };
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
      if (unit.illuminationOverride !== undefined) {
        for (const actorId of nextState.entities) {
          if (getComponent(nextState, actorId, ComponentType.Fighter)) {
            nextState = evaluateActorLightExposure(nextState, actorId, 'move_or_field');
          }
        }
      }
      return nextState;
    }

    case 'dispel': {
      const targetDnd = getDnD35EntityData(runningState, targetId);
      const existing = targetDnd.statModifiers ?? [];
      const statusComp = getComponent(runningState, targetId, ComponentType.StatusEffects) as
        StatusEffectsComponent | undefined;
      const activeStatuses = statusComp?.activeEffects ?? [];

      const clByRoot = new Map<string, number>();
      for (const eff of activeStatuses) {
        if (!eff.sourcePath || !eff.sourcePath.startsWith(unit.revokesPathPrefix)) continue;
        const rootPath = eff.sourcePath.split('/').slice(0, 2).join('/');
        if (eff.casterLevel !== undefined && !clByRoot.has(rootPath)) {
          clByRoot.set(rootPath, eff.casterLevel);
        } else if (!clByRoot.has(rootPath)) {
          clByRoot.set(rootPath, DEFAULT_DISPEL_FALLBACK_CL);
        }
      }

      const spellRoots = Array.from(
        new Set([
          ...existing
            .map((m) => m.sourcePath)
            .filter((p): p is string => p !== undefined && p.startsWith(unit.revokesPathPrefix))
            .map((p) => p.split('/').slice(0, 2).join('/')),
          ...clByRoot.keys()
        ])
      );

      let cleaned: ReadonlyArray<StatModifier> = [...existing];
      const dispelledRoots = new Set<string>();
      for (const rootPath of spellRoots) {
        const targetSpellCl = clByRoot.get(rootPath) ?? DEFAULT_DISPEL_FALLBACK_CL;
        const res = resolveDispelCheck(
          Math.min(casterLevel, unit.maxCasterLevelBonus),
          targetSpellCl,
          unit.maxCasterLevelBonus > 10
        );
        if (res.dispelled) {
          cleaned = revokeModifiersByPathPrefix(cleaned, rootPath);
          dispelledRoots.add(rootPath);
        }
      }

      if (dispelledRoots.size > 0) {
        const remainingStatuses = activeStatuses.filter(
          (eff) => !eff.sourcePath || !dispelledRoots.has(eff.sourcePath.split('/').slice(0, 2).join('/'))
        );
        const removedConditions = activeStatuses
          .filter((eff) => eff.sourcePath && dispelledRoots.has(eff.sourcePath.split('/').slice(0, 2).join('/')))
          .map((eff) => eff.linkedConditionId)
          .filter((c): c is string => c !== undefined);

        const nextConditions =
          removedConditions.length > 0
            ? (targetDnd.conditions ?? []).filter((cond) => {
                if (!removedConditions.includes(cond)) return true;
                return remainingStatuses.some((rem) => rem.linkedConditionId === cond);
              })
            : targetDnd.conditions;

        runningState = setDnD35EntityData(runningState, targetId, {
          ...targetDnd,
          statModifiers: cleaned,
          conditions: nextConditions
        });

        if (statusComp) {
          if (remainingStatuses.length === 0) {
            runningState = removeComponent(runningState, targetId, ComponentType.StatusEffects);
          } else if (remainingStatuses.length !== activeStatuses.length) {
            runningState = addComponent(runningState, targetId, {
              ...statusComp,
              activeEffects: remainingStatuses
            });
          }
        }

        runningState = syncDnD35eActorSpatialFootprint(runningState, targetId);
        runningState = addMessage(
          runningState,
          `${spell.name} dispels ${dispelledRoots.size} active spell effect(s)!`,
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
      const casterDag = evaluateDnD35eEntityDAG(runningState, casterId);
      const casterMods = casterDag?.statModifiers ?? getDnD35EntityData(runningState, casterId).statModifiers ?? [];
      const summonMods = materializeSummonedCreatureModifiers(spell, unit, casterMods, castId, {
        casterSelfTags: casterDag?.selfTags ?? [],
        metamagic
      });
      if (summonMods.length > 0) {
        const minionDnd = getDnD35EntityData(nextState, minionId);
        nextState = setDnD35EntityData(nextState, minionId, {
          ...minionDnd,
          statModifiers: [...(minionDnd.statModifiers ?? []), ...summonMods]
        });
      }
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

    case 'terrain_sculpt': {
      const casterPos = getComponent(runningState, casterId, ComponentType.Position) as PositionComponent | undefined;
      const targetZ = targetPos.z ?? casterPos?.z ?? 0;
      const radius = unit.radiusTiles * (metamagic.widen ? 2 : 1);
      const revertDuration = unit.durationTurnsScaling
        ? Math.max(1, evaluateSpellScalingRule(unit.durationTurnsScaling, casterLevel)) * (metamagic.extend ? 2 : 1)
        : undefined;
      let nextState = runningState;
      let sculptedCount = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const vx = targetPos.x + dx;
          const vy = targetPos.y + dy;
          if (!isInMapBounds(nextState.map, vx, vy, targetZ)) continue;

          const curTileId = getTileIdAt(nextState.map, vx, vy, targetZ);
          const curDef = getTileDefAt(nextState, vx, vy, targetZ);
          if (!curTileId || !curDef) continue;

          if (unit.requiredSourceTags.length > 0) {
            const tileTags = new Set(curDef.tags ?? []);
            if (curDef.isSolidObstacle || !curDef.walkable) tileTags.add('solid');
            if (!unit.requiredSourceTags.some((req) => tileTags.has(req))) continue;
          }

          if (nextState.campaign.tiles[unit.targetTileId]) {
            nextState = sculptTerrainVoxel(nextState, vx, vy, targetZ, unit.targetTileId, { dropYield: false });
            sculptedCount += 1;
            if (revertDuration !== undefined) {
              nextState = scheduleTimedTerrainRevert(nextState, {
                areaId: nextState.currentAreaId,
                x: vx,
                y: vy,
                z: targetZ,
                revertTileId: unit.revertTileId ?? curTileId,
                revertTurn: (nextState.globalTurn ?? 0) + revertDuration,
                sourceId: `spell:${spell.id}:${castId}`
              });
            }
          }
          if (unit.spawnFluidKind && unit.spawnFluidKind !== 'none' && unit.spawnFluidDepth !== undefined) {
            nextState = applyFluidToVoxel(nextState, vx, vy, targetZ, unit.spawnFluidKind, unit.spawnFluidDepth);
          }
        }
      }

      if (unit.spawnFluidKind && unit.spawnFluidKind !== 'none') {
        nextState = processDirtyFluidChunks(nextState);
      }
      if (sculptedCount > 0) {
        nextState = addMessage(
          nextState,
          `${spell.name} reshapes ${sculptedCount} terrain section(s)!`,
          MessageLogCategory.System
        );
      }
      return nextState;
    }

    case 'fluid_spawn': {
      const casterPos = getComponent(runningState, casterId, ComponentType.Position) as PositionComponent | undefined;
      const targetZ = targetPos.z ?? casterPos?.z ?? 0;
      const radius = unit.radiusTiles * (metamagic.widen ? 2 : 1);
      const rawDepth = unit.depthScaling ? evaluateSpellScalingRule(unit.depthScaling, casterLevel) : unit.depth;
      const depth = Math.max(1, Math.min(7, rawDepth));
      let nextState = runningState;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue;
          const vx = targetPos.x + dx;
          const vy = targetPos.y + dy;
          if (!isInMapBounds(nextState.map, vx, vy, targetZ)) continue;
          const curDef = getTileDefAt(nextState, vx, vy, targetZ);
          if (!curDef || curDef.isSolidObstacle === true || !curDef.walkable) continue;
          nextState = applyFluidToVoxel(nextState, vx, vy, targetZ, unit.fluidKind, depth);
        }
      }

      nextState = processDirtyFluidChunks(nextState);
      return addMessage(nextState, `${spell.name} pours ${unit.fluidKind} across the area!`, MessageLogCategory.System);
    }

    default:
      return runningState;
  }
}
