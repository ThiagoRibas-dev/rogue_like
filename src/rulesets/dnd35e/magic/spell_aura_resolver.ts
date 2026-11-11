import { addComponent, getComponent } from '../../../core/ecs.ts';
import { queryActiveFieldsAtPosition } from '../../../systems/field.system.ts';
import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import type { ConsoleStanceGroupOption } from '../../../systems/stance.system.ts';
import {
  ComponentType,
  type FactionComponent,
  type FieldComponent,
  type PositionComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ActiveRetaliationRiderEntry } from '../combat/retaliation_resolver.ts';
import { rollD20 } from '../math/dice.ts';
import type { StatModifier } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35SpellDefinition } from '../types/dnd35e_system.types.ts';
import { materializeSpellUnitModifiers, projectSpellEffectTags } from './spell_effects.ts';

/**
 * Aggregated contributions projected dynamically onto an entity occupying one or more active spell emanation fields.
 */
export interface ActiveSpellAuraContributions {
  readonly modifiers: ReadonlyArray<StatModifier>;
  readonly grantedTags: ReadonlyArray<string>;
  readonly darkvisionRangeFt: number;
  readonly lowLightVision: boolean;
  readonly retaliationRiders: ReadonlyArray<ActiveRetaliationRiderEntry>;
  readonly stanceGroupOptions: ReadonlyArray<ConsoleStanceGroupOption>;
  readonly quickenMaxSpellLevel: number;
}

/**
 * Resolves the target role (`'caster' | 'secondary_ally' | 'secondary_enemy'`) of `occupantId`
 * relative to `sourceEntityId` based on entity identity and `FactionComponent`.
 */
function resolveAuraOccupantRole(
  state: GameState,
  occupantId: EntityId,
  sourceEntityId: EntityId | undefined
): 'caster' | 'secondary_ally' | 'secondary_enemy' {
  if (sourceEntityId !== undefined && occupantId === sourceEntityId) {
    return 'caster';
  }
  if (sourceEntityId === undefined) {
    return 'secondary_enemy';
  }
  const sourceFaction = getComponent(state, sourceEntityId, ComponentType.Faction) as FactionComponent | undefined;
  const occFaction = getComponent(state, occupantId, ComponentType.Faction) as FactionComponent | undefined;
  if (sourceFaction && occFaction && sourceFaction.factionId === occFaction.factionId) {
    return 'secondary_ally';
  }
  return 'secondary_enemy';
}

/**
 * Evaluates all active spell emanation fields covering `entityId`'s position and dynamically projects
 * `stat_bundle` modifiers, `grantedTags`, `grantedSenses` (e.g. `60 ft.` Darkvision), `retaliation_rider`s,
 * `toggleGroup` stance options, and `quicken_cast_grant` caps for as long as the entity remains in the area.
 * Respects `field.auraSaveMemory` (`'saved' | 'sr_blocked'`) so creatures that passed their initial Will save
 * or Spell Resistance check against that `castId` are unaffected when remaining in or re-entering the aura.
 *
 * @param state Current immutable GameState.
 * @param entityId Occupant entity ID.
 * @param occupantSelfTags Active semantic tags on the occupant.
 * @returns Aggregated `ActiveSpellAuraContributions`.
 */
export function evaluateActiveSpellAuraContributions(
  state: GameState,
  entityId: EntityId,
  occupantSelfTags: ReadonlyArray<string> = []
): ActiveSpellAuraContributions {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) {
    return {
      modifiers: [],
      grantedTags: [],
      darkvisionRangeFt: 0,
      lowLightVision: false,
      retaliationRiders: [],
      stanceGroupOptions: [],
      quickenMaxSpellLevel: -1
    };
  }

  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) {
    return {
      modifiers: [],
      grantedTags: [],
      darkvisionRangeFt: 0,
      lowLightVision: false,
      retaliationRiders: [],
      stanceGroupOptions: [],
      quickenMaxSpellLevel: -1
    };
  }

  const activeFields = queryActiveFieldsAtPosition(state, pos.x, pos.y);
  const modifiers: StatModifier[] = [];
  const grantedTags: string[] = [];
  let darkvisionRangeFt = 0;
  let lowLightVision = false;
  const retaliationRiders: ActiveRetaliationRiderEntry[] = [];
  const stanceGroupOptions: ConsoleStanceGroupOption[] = [];
  let quickenMaxSpellLevel = -1;

  for (const { field } of activeFields) {
    if (!field.spellId) continue;
    const spell: DnD35SpellDefinition | undefined = sys.spells[field.spellId];
    if (!spell) continue;

    const castId = field.castId ?? `aura_${field.spellId}`;
    const casterLevel = field.casterLevel ?? 9;
    const role = resolveAuraOccupantRole(state, entityId, field.sourceEntityId);
    const effectTags = projectSpellEffectTags(spell);
    const saveOutcome = field.auraSaveMemory?.[String(entityId)];

    for (const unit of spell.effectUnits) {
      if (unit.type === 'spatial_field') continue;

      const roleMatches =
        unit.targetRole === 'area_occupant' ||
        unit.targetRole === role ||
        (unit.targetRole === 'primary_target' && role === 'caster');
      if (!roleMatches) continue;

      if (role === 'secondary_enemy' && (saveOutcome === 'saved' || saveOutcome === 'sr_blocked')) {
        continue;
      }

      if (unit.condition) {
        const matched = matchesEntityTagCondition(unit.condition, occupantSelfTags, effectTags, occupantSelfTags);
        if (!matched) continue;
      }

      if (unit.type === 'stat_bundle') {
        modifiers.push(...materializeSpellUnitModifiers(spell, unit, casterLevel, castId));
        for (const t of unit.effectBundle.grantedTags) {
          grantedTags.push(t);
        }
        if (unit.effectBundle.grantedSenses) {
          darkvisionRangeFt = Math.max(darkvisionRangeFt, unit.effectBundle.grantedSenses.darkvisionRangeFt ?? 0);
          if (unit.effectBundle.grantedSenses.lowLightVision) {
            lowLightVision = true;
          }
        }
        for (const act of unit.effectBundle.activatedAbilities) {
          if (act.toggleGroup) {
            stanceGroupOptions.push({
              groupId: act.toggleGroup,
              stanceId: act.abilityId,
              label: act.name,
              grantsSelfTag: act.grantsSelfTag,
              isDefaultInGroup: act.isDefaultInGroup,
              tooltipText: `${spell.name}: ${act.name}`
            });
          }
        }
      } else if (unit.type === 'retaliation_rider') {
        retaliationRiders.push({
          spellId: spell.id,
          castId,
          casterLevel,
          unit
        });
      } else if (unit.type === 'quicken_cast_grant') {
        const effectiveCl = Math.max(0, casterLevel - unit.maxSpellLevelScaling.startAboveCL);
        const steps =
          unit.maxSpellLevelScaling.clStepInterval > 0
            ? Math.floor(effectiveCl / unit.maxSpellLevelScaling.clStepInterval)
            : 0;
        let maxLvl = unit.maxSpellLevelScaling.baseValue + steps * unit.maxSpellLevelScaling.perCL;
        if (unit.maxSpellLevelScaling.maxCap !== undefined) {
          maxLvl = Math.min(unit.maxSpellLevelScaling.maxCap, maxLvl);
        }
        quickenMaxSpellLevel = Math.max(quickenMaxSpellLevel, maxLvl);
      }
    }
  }

  return {
    modifiers,
    grantedTags: Array.from(new Set(grantedTags)),
    darkvisionRangeFt,
    lowLightVision,
    retaliationRiders,
    stanceGroupOptions,
    quickenMaxSpellLevel
  };
}

/**
 * Records or resolves a creature's first-entry saving throw and Spell Resistance check against an active
 * spell aura field (`FieldComponent.auraSaveMemory`). If the creature has already rolled against this
 * field's `castId`, returns the cached outcome without re-rolling.
 *
 * @param state Current immutable GameState.
 * @param fieldEntityId Entity ID of the emanation field.
 * @param occupantId Entity ID of the creature inside or entering the aura.
 * @param params Save DC, occupant save modifier, caster level, occupant SR, and optional forced rolls.
 * @returns Updated `[GameState, 'saved' | 'failed' | 'sr_blocked']`.
 */
export function resolveAuraFirstEntrySaveAndSr(
  state: GameState,
  fieldEntityId: EntityId,
  occupantId: EntityId,
  params: {
    readonly saveDc: number;
    readonly occupantSaveModifier: number;
    readonly casterLevel: number;
    readonly occupantSpellResistance?: number | undefined;
    readonly forcedSrRoll?: number | undefined;
    readonly forcedSaveRoll?: number | undefined;
  }
): [GameState, 'saved' | 'failed' | 'sr_blocked'] {
  const field = getComponent(state, fieldEntityId, ComponentType.Field) as FieldComponent | undefined;
  if (!field) {
    return [state, 'failed'];
  }

  const key = String(occupantId);
  const existing = field.auraSaveMemory?.[key];
  if (existing !== undefined) {
    return [state, existing];
  }

  let outcome: 'saved' | 'failed' | 'sr_blocked' = 'failed';
  const sr = params.occupantSpellResistance ?? 0;
  if (sr > 0) {
    const srRoll = rollD20('caster_level_check', params.casterLevel, params.forcedSrRoll);
    if (srRoll.total < sr) {
      outcome = 'sr_blocked';
    }
  }

  if (outcome !== 'sr_blocked') {
    const saveRoll = rollD20('save', params.occupantSaveModifier, params.forcedSaveRoll);
    if (!saveRoll.isAutoFailure && (saveRoll.isAutoSuccess || saveRoll.total >= params.saveDc)) {
      outcome = 'saved';
    }
  }

  const updatedField: FieldComponent = {
    ...field,
    auraSaveMemory: {
      ...(field.auraSaveMemory ?? {}),
      [key]: outcome
    }
  };

  return [addComponent(state, fieldEntityId, updatedField), outcome];
}
