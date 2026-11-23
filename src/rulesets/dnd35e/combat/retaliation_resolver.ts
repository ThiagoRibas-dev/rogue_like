import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { canUseTriggeredReactionThisRound, incrementTriggeredReactionUse } from '../../../systems/stance.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type PositionComponent,
  type TacticalDoctrineComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import { evaluateActiveSpellAuraContributions } from '../magic/spell_aura_resolver.ts';
import { evaluateSpellScalingRule, projectSpellEffectTags } from '../magic/spell_effects.ts';
import { evaluateDiceExpression } from '../math/dice.ts';
import { measureFootprintToFootprintDistanceFt } from '../spatial/footprint_resolver.ts';
import { FEET_PER_GRID_SQUARE } from '../spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { DamageReductionRule, DnD35EntityData } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35DamageType } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellEffectUnit } from '../types/system/spell_system.types.ts';
import { mitigateIncomingDamage } from './damage_vitality.ts';

/** Maximum grid distance in tiles (`1`, i.e. 5 ft.) considered adjacent for `melee_adjacent` / `melee_or_spell_adjacent`. */
const ADJACENT_MAX_TILE_DISTANCE = 1;

/**
 * Active target-side retaliation rider instance protecting an actor.
 */
export interface ActiveRetaliationRiderEntry {
  readonly spellId: string;
  readonly castId: string;
  readonly casterLevel: number;
  readonly unit: Extract<DnD35SpellEffectUnit, { readonly type: 'retaliation_rider' }>;
}

/**
 * Result of resolving all active target-side retaliation riders on a struck defender.
 */
export interface RetaliationResolutionResult {
  readonly totalDamageToAttacker: number;
  readonly updatedDefenderDoctrine: TacticalDoctrineComponent | undefined;
  readonly logMessages: ReadonlyArray<string>;
}

/**
 * Resolves all active target-side `retaliation_rider` units protecting a defender when struck by an attacker.
 */
export function resolveRetaliationRiders(params: {
  readonly activeRiders: ReadonlyArray<ActiveRetaliationRiderEntry>;
  readonly defenderDoctrine: TacticalDoctrineComponent | undefined;
  readonly triggerType: 'melee' | 'spell' | 'ranged';
  readonly chebyshevDistanceTiles: number;
  readonly attackerName: string;
  readonly defenderName: string;
  readonly attackerDr?: DamageReductionRule | undefined;
  readonly attackerEnergyResistance?: Readonly<Record<string, number>> | undefined;
  readonly attackerImmunities?: ReadonlyArray<string> | undefined;
  readonly attackerVulnerabilities?: ReadonlyArray<string> | undefined;
  readonly forcedDiceTotal?: number | undefined;
}): RetaliationResolutionResult {
  if (params.activeRiders.length === 0) {
    return {
      totalDamageToAttacker: 0,
      updatedDefenderDoctrine: params.defenderDoctrine,
      logMessages: []
    };
  }

  let runningDoctrine = params.defenderDoctrine;
  let totalDamageToAttacker = 0;
  const logMessages: string[] = [];
  const isAdjacent = params.chebyshevDistanceTiles <= ADJACENT_MAX_TILE_DISTANCE;

  for (const entry of params.activeRiders) {
    const { unit, spellId, castId, casterLevel } = entry;
    if (unit.triggerCondition === 'melee_adjacent') {
      if (params.triggerType !== 'melee' || !isAdjacent) continue;
    } else if (unit.triggerCondition === 'melee_or_spell_adjacent') {
      if ((params.triggerType !== 'melee' && params.triggerType !== 'spell') || !isAdjacent) continue;
    }

    const triggerKey = `retaliation:${spellId}:${castId}:${unit.unitId}`;
    if (!canUseTriggeredReactionThisRound(runningDoctrine, triggerKey, unit.maxUsesPerRound)) {
      continue;
    }

    runningDoctrine = incrementTriggeredReactionUse(runningDoctrine, triggerKey);
    const rolledDice =
      params.forcedDiceTotal !== undefined ? params.forcedDiceTotal : evaluateDiceExpression(unit.dice).total;
    const flatBonus = evaluateSpellScalingRule(unit.flatBonusScaling, casterLevel);
    const rawDamage = Math.max(0, rolledDice + flatBonus);

    const dmgType: DnD35DamageType = unit.damageType;
    const effectiveDr = unit.bypassesDr ? undefined : params.attackerDr;
    const mitigated = mitigateIncomingDamage({
      rawDamage,
      damageType: dmgType,
      attackBypassTags: ['spell', dmgType, ...(unit.bypassesDr ? ['bypass:all'] : [])],
      ...(effectiveDr !== undefined ? { damageReduction: effectiveDr } : {}),
      ...(params.attackerEnergyResistance !== undefined ? { energyResistance: params.attackerEnergyResistance } : {}),
      ...(params.attackerImmunities !== undefined ? { immunities: params.attackerImmunities } : {}),
      ...(params.attackerVulnerabilities !== undefined ? { vulnerabilities: params.attackerVulnerabilities } : {})
    });

    totalDamageToAttacker += mitigated.finalDamage;
    logMessages.push(
      `Retaliating spectral blade (${params.defenderName}) strikes ${params.attackerName} for ${mitigated.finalDamage} ${dmgType} damage!`
    );
  }

  return {
    totalDamageToAttacker,
    updatedDefenderDoctrine: runningDoctrine,
    logMessages
  };
}

function collectDirectSpellRetaliationRiders(
  state: GameState,
  defenderId: EntityId,
  defenderSelfTags: ReadonlyArray<string>
): ReadonlyArray<ActiveRetaliationRiderEntry> {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return [];
  const defenderData = getDnD35EntityData(state, defenderId);
  const directMods = (defenderData.statModifiers ?? []).filter((m) => m.targetStat === 'retaliation_rider_active');
  if (directMods.length === 0) return [];

  const directRiders: ActiveRetaliationRiderEntry[] = [];
  for (const mod of directMods) {
    const path = mod.sourcePath ?? '';
    const segments = path.split('/');
    const spellSeg = segments.find((s) => s.startsWith('spell:'));
    const unitSeg = segments.find((s) => s.startsWith('unit:'));
    if (!spellSeg || !unitSeg) continue;
    const spellParts = spellSeg.split(':');
    const spellId = spellParts[1];
    const castId = spellParts.slice(2).join(':') || `direct_${spellId}`;
    const unitId = unitSeg.slice(5);
    if (!spellId) continue;
    const spell = sys.spells[spellId];
    if (!spell) continue;
    const unit = spell.effectUnits.find(
      (u): u is Extract<DnD35SpellEffectUnit, { readonly type: 'retaliation_rider' }> =>
        u.type === 'retaliation_rider' && u.unitId === unitId
    );
    if (!unit) continue;
    const effectTags = projectSpellEffectTags(spell);
    if (
      unit.condition &&
      !matchesEntityTagCondition(unit.condition, defenderSelfTags, effectTags, defenderSelfTags)
    ) {
      continue;
    }
    directRiders.push({
      spellId: spell.id,
      castId,
      casterLevel: Math.max(1, mod.value),
      unit
    });
  }
  return directRiders;
}

/**
 * Executes Phase 4 (`PostStrikeReactionPhase`) of the melee combat exchange pipeline,
 * evaluating defender aura and direct retaliation riders and queueing retaliation damage onto the attacker.
 */
export function applyPostStrikeRetaliationPhase(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId,
  attackerData: DnD35EntityData,
  defenderSelfTags: ReadonlyArray<string>
): GameState {
  const defenderAuraContrib = evaluateActiveSpellAuraContributions(state, defenderId, defenderSelfTags);
  const directRiders = collectDirectSpellRetaliationRiders(state, defenderId, defenderSelfTags);
  const seenKeys = new Set<string>();
  const combinedRiders: ActiveRetaliationRiderEntry[] = [];
  for (const entry of [...defenderAuraContrib.retaliationRiders, ...directRiders]) {
    const k = `${entry.spellId}:${entry.castId}:${entry.unit.unitId}`;
    if (!seenKeys.has(k)) {
      seenKeys.add(k);
      combinedRiders.push(entry);
    }
  }
  if (combinedRiders.length === 0) return state;

  let runningState = state;
  const attackerPos = getComponent(runningState, attackerId, ComponentType.Position) as PositionComponent | undefined;
  const defenderPos = getComponent(runningState, defenderId, ComponentType.Position) as PositionComponent | undefined;
  const distTiles =
    attackerPos && defenderPos
      ? Math.floor(
          measureFootprintToFootprintDistanceFt(
            attackerPos.x,
            attackerPos.y,
            attackerPos.footprintWidth ?? 1,
            attackerPos.footprintHeight ?? 1,
            defenderPos.x,
            defenderPos.y,
            defenderPos.footprintWidth ?? 1,
            defenderPos.footprintHeight ?? 1
          ) / FEET_PER_GRID_SQUARE
        )
      : 1;
  const defenderDoctrine = getComponent(runningState, defenderId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const attackerName = resolveEntityDisplayName(runningState, attackerId, 'Attacker');
  const defenderName = resolveEntityDisplayName(runningState, defenderId, 'Defender');

  const retResult = resolveRetaliationRiders({
    activeRiders: combinedRiders,
    defenderDoctrine,
    triggerType: 'melee',
    chebyshevDistanceTiles: distTiles,
    attackerName,
    defenderName,
    attackerDr: attackerData.damageReduction,
    attackerEnergyResistance: attackerData.energyResistance,
    attackerImmunities: attackerData.immunities,
    attackerVulnerabilities: attackerData.vulnerabilities
  });

  if (retResult.updatedDefenderDoctrine) {
    runningState = addComponent(runningState, defenderId, retResult.updatedDefenderDoctrine);
  }
  for (const msg of retResult.logMessages) {
    runningState = addMessage(runningState, msg, MessageLogCategory.CombatHit);
  }
  if (retResult.totalDamageToAttacker > 0) {
    const attackerExistingDmg = getComponent(runningState, attackerId, ComponentType.Damage) as
      DamageComponent | undefined;
    runningState = addComponent(runningState, attackerId, {
      type: ComponentType.Damage,
      instances: [
        ...(attackerExistingDmg?.instances ?? []),
        { amount: retResult.totalDamageToAttacker, sourceEntityId: defenderId, tags: ['retaliation', 'force', 'spell'] }
      ]
    });
  }
  return runningState;
}
