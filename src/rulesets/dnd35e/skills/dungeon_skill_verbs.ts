import { addComponent, getComponent, removeComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { SLEEPING_STATUS_ID } from '../../../systems/rest.system.ts';
import { neutralizePendingSecondaryStatuses } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type ItemComponent,
  type LockComponent,
  type PositionComponent,
  type StatusEffectsComponent,
  type TrapComponent
} from '../../../types/components.types.ts';
import {
  type ApplyFailedEvent,
  type ApplyResolvedEvent,
  type GameEvent,
  GameEventType
} from '../../../types/events.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ApplyIntent } from '../../../types/intents/interaction.intents.ts';
import {
  closeStructuralDoor,
  openStructuralDoor,
  probeTrapWithReachTool,
  repairRuinedItem,
  spikeDoorWithWedge
} from '../../../systems/durability.system.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import {
  deployTacticalFloorHazardItem,
  resolveCraftAlchemyPotionIdentification,
  resolveDipWeaponCoating
} from '../combat/floor_hazard_resolver.ts';
import { resolveSrdBreakObjectCheck } from '../combat/object_durability_resolver.ts';
import { resolveEffectiveItemDefinition } from '../equipment/item_inheritance.ts';
import { collectInventoryMedicalKitHealModifiers } from '../magic/rest_recovery.ts';
import { transcribeSpellFromBook } from '../magic/spellbook_loot.ts';
import { rollD20 } from '../math/dice.ts';
import { resolveTypedModifiers } from '../modifiers.ts';
import {
  HEAL_SKILL_STANDARD_DC,
  OPEN_LOCK_DEFAULT_SIMPLE_DC,
  resolveDisableTrapCheck,
  resolveHealSkillCheck,
  resolveOpenLockCheck,
  resolveTrapSearchCheck
} from '../skills.ts';
import { resolveRigCrossingWithGear } from '../spatial/terrain_traversal_resolver.ts';
import type { DnD35ConditionId, DnD35EntityData } from '../types/dnd35e.types.ts';
import type { DnD35ItemDefinition } from '../types/dnd35e_system.types.ts';
import {
  DEFAULT_TRAP_DISABLE_DC,
  DEFAULT_TRAP_SEARCH_DC,
  evaluateActorSkillCheck,
  findTargetEntityWithComponent,
  resolveEntityDnD35Data,
  saveEntityDnD35Data,
  SEARCH_SCAN_RADIUS_TILES
} from './skill_verb_helpers.ts';

/** Margin above disarm DC required to safely invert ownership and reset a trap (`+5`). */
const TRAP_RESET_MARGIN = 5;

/** Declarative item tag identifying physical restraint tools (`manacles`, `masterwork_manacles`). */
export const RESTRAINTS_ITEM_TAG = 'restraints';

/** Standard Escape Artist DC to slip out of iron manacles (`30` per PHB p. 126). */
export const STANDARD_MANACLES_ESCAPE_ARTIST_DC = 30;

/** Masterwork Escape Artist DC to slip out of masterwork manacles (`35` per PHB p. 126). */
export const MASTERWORK_MANACLES_ESCAPE_ARTIST_DC = 35;

/** Standard Strength Break DC to burst iron manacles (`26` per PHB p. 126). */
export const STANDARD_MANACLES_BREAK_DC = 26;

/** Masterwork Strength Break DC to burst masterwork manacles (`28` per PHB p. 126). */
export const MASTERWORK_MANACLES_BREAK_DC = 28;

/** Conditions on a target that allow applying physical restraints (`manacles`). */
const RESTRAINABLE_CONDITIONS: ReadonlySet<DnD35ConditionId> = new Set([
  'helpless',
  'unconscious',
  'paralyzed',
  'stunned',
  'bound'
]);

/** Status effect IDs representing foot wounds cured by a DC 15 Heal check. */
const HEAL_CURED_LIMP_STATUS_IDS: ReadonlySet<string> = new Set(['limping', 'caltrop_wound']);

/**
 * Checks whether `targetEntityId` is currently incapacitated (`helpless`, `unconscious`, `paralyzed`,
 * `stunned`, `bound`, or `'sleeping'` status effect) and therefore eligible to be bound in manacles.
 */
export function isTargetEligibleForRestraints(state: GameState, targetEntityId: EntityId): boolean {
  const dndData = resolveEntityDnD35Data(state, targetEntityId);
  if ((dndData.conditions ?? []).some((c) => RESTRAINABLE_CONDITIONS.has(c))) {
    return true;
  }
  const statusComp = getComponent(state, targetEntityId, ComponentType.StatusEffects) as
    StatusEffectsComponent | undefined;
  return statusComp?.activeEffects.some((e) => e.effectId === SLEEPING_STATUS_ID) ?? false;
}

/**
 * Attempts to free a bound actor (`entityId`) from physical restraints (`manacles` / `masterwork_manacles`)
 * using either an `escape_artist` skill check or a raw `strength_break` d20 + STR check.
 *
 * @param state Current immutable GameState.
 * @param entityId Bound actor EntityId.
 * @param method `'escape_artist'` or `'strength_break'`.
 * @param forcedD20 Optional deterministic `1..20` natural d20 roll override.
 * @returns Updated GameState, whether the escape/break succeeded, roll total, and target DC.
 */
export function attemptEscapeOrBreakRestraints(
  state: GameState,
  entityId: EntityId,
  method: 'escape_artist' | 'strength_break',
  forcedD20?: number
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly totalRoll: number;
  readonly dc: number;
} {
  const dndData = resolveEntityDnD35Data(state, entityId);
  const binding = dndData.restraintBinding;
  const escapeDc = binding?.escapeArtistDc ?? STANDARD_MANACLES_ESCAPE_ARTIST_DC;
  const breakDc = binding?.breakDc ?? STANDARD_MANACLES_BREAK_DC;
  const dc = method === 'escape_artist' ? escapeDc : breakDc;

  let totalRoll: number;
  if (method === 'escape_artist') {
    const dag = evaluateDnD35eEntityDAG(state, entityId);
    const mod = dag?.resolvedSkills['escape_artist']?.totalModifier ?? 0;
    const d20 = rollD20('skill_check', mod, forcedD20);
    totalRoll = d20.total;
  } else {
    const dag = evaluateDnD35eEntityDAG(state, entityId);
    const strMod =
      dag?.dagResult.effectiveAbilityModifiers.str ?? Math.floor(((dndData.abilityScores?.str?.base ?? 10) - 10) / 2);
    const d20 = rollD20('ability_check', strMod, forcedD20);
    totalRoll = d20.total;
  }

  const success = totalRoll >= dc;
  const actorName = resolveEntityDisplayName(state, entityId, 'The captive');
  if (!success) {
    return {
      state: addMessage(
        state,
        `${actorName} struggles against the restraints (${method === 'escape_artist' ? 'Escape Artist' : 'Strength Break'} ${totalRoll} vs DC ${dc}) but remains bound!`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll,
      dc
    };
  }

  const nextConditions = (dndData.conditions ?? []).filter((c) => c !== 'bound');
  const { restraintBinding: _cleared, ...restDnd } = dndData;
  const updatedDnd: DnD35EntityData = {
    ...restDnd,
    conditions: nextConditions
  };
  let nextState = saveEntityDnD35Data(state, entityId, updatedDnd);
  nextState = addMessage(
    nextState,
    `${actorName} breaks free from the restraints (${method === 'escape_artist' ? 'Escape Artist' : 'Strength Break'} ${totalRoll} vs DC ${dc})!`,
    MessageLogCategory.System
  );

  return {
    state: nextState,
    success: true,
    totalRoll,
    dc
  };
}

/**
 * Resolves dungeon exploration, restraint binding, and first-aid skill verbs (`search`, `unlock`, `disarm`, `heal`, `apply`).
 */
export function resolveDungeonSkillVerb(
  state: GameState,
  intent: ApplyIntent
): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null {
  switch (intent.verb) {
    case 'search': {
      const { check, dndData } = evaluateActorSkillCheck(state, intent.entityId, 'search', DEFAULT_TRAP_SEARCH_DC);
      const hasTrapfinding = (dndData.activeClassFeatures ?? []).includes('trapfinding');

      const centerPos: { readonly x: number; readonly y: number } | undefined =
        intent.target.type === 'tile'
          ? { x: intent.target.x, y: intent.target.y }
          : intent.target.type === 'entity'
            ? (getComponent(state, intent.target.entityId, ComponentType.Position) as PositionComponent | undefined)
            : (getComponent(state, intent.entityId, ComponentType.Position) as PositionComponent | undefined);

      let spottedTraps = 0;
      if (centerPos) {
        for (let dy = -SEARCH_SCAN_RADIUS_TILES; dy <= SEARCH_SCAN_RADIUS_TILES; dy++) {
          for (let dx = -SEARCH_SCAN_RADIUS_TILES; dx <= SEARCH_SCAN_RADIUS_TILES; dx++) {
            const entitiesAt = state.spatialIndex.get(`${centerPos.x + dx},${centerPos.y + dy}`) ?? [];
            for (const eid of entitiesAt) {
              const trap = getComponent(state, eid, ComponentType.Trap) as TrapComponent | undefined;
              if (trap && !trap.triggered) {
                if (resolveTrapSearchCheck(check.totalRoll, DEFAULT_TRAP_SEARCH_DC, hasTrapfinding)) {
                  spottedTraps++;
                }
              }
            }
          }
        }
      }

      const msg =
        spottedTraps > 0
          ? `You search carefully (Search roll: ${check.totalRoll}) and spot ${spottedTraps} hidden trap mechanism(s)!`
          : `You search carefully (Search roll: ${check.totalRoll}). Nothing hidden found nearby.`;

      const event: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return {
        state: addMessage(state, msg, MessageLogCategory.System),
        success: true,
        events: [event]
      };
    }

    case 'unlock': {
      const lockEntityId = findTargetEntityWithComponent(state, intent.target, ComponentType.Lock);
      const lockComp =
        lockEntityId !== undefined
          ? (getComponent(state, lockEntityId, ComponentType.Lock) as LockComponent | undefined)
          : undefined;
      const lockDc = lockComp && lockComp.difficulty > 0 ? lockComp.difficulty : OPEN_LOCK_DEFAULT_SIMPLE_DC;

      const { check } = evaluateActorSkillCheck(state, intent.entityId, 'open_lock', lockDc);
      if (!check.allowed) {
        return {
          state: addMessage(state, 'You cannot pick locks without training in Open Lock.', MessageLogCategory.System),
          success: false
        };
      }

      if (lockComp?.jammed === true) {
        return {
          state: addMessage(state, 'The lock mechanism is jammed and cannot be picked.', MessageLogCategory.System),
          success: false
        };
      }

      const success = resolveOpenLockCheck(check.totalRoll, lockDc);
      let nextState = state;
      if (success && lockEntityId !== undefined && lockComp !== undefined) {
        nextState = addComponent(nextState, lockEntityId, {
          ...lockComp,
          locked: false
        });
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: 'Open Lock check failed'
          };

      return {
        state: addMessage(
          nextState,
          success
            ? `You successfully pick the lock (roll: ${check.totalRoll} vs DC ${lockDc})!`
            : `You fail to pick the lock (roll: ${check.totalRoll} vs DC ${lockDc}).`,
          MessageLogCategory.System
        ),
        success,
        events: [event]
      };
    }

    case 'disarm': {
      const trapEntityId = findTargetEntityWithComponent(state, intent.target, ComponentType.Trap);
      const trapComp =
        trapEntityId !== undefined
          ? (getComponent(state, trapEntityId, ComponentType.Trap) as TrapComponent | undefined)
          : undefined;
      const trapDc = DEFAULT_TRAP_DISABLE_DC;

      const { check, dndData } = evaluateActorSkillCheck(state, intent.entityId, 'disable_device', trapDc);
      if (!check.allowed) {
        return {
          state: addMessage(
            state,
            'You cannot disarm mechanisms without training in Disable Device.',
            MessageLogCategory.System
          ),
          success: false
        };
      }

      const hasTrapfinding = (dndData.activeClassFeatures ?? []).includes('trapfinding');
      const isMagicTrap = trapComp?.triggerId.includes('magic') === true;
      const disarmOutcome = resolveDisableTrapCheck(check.totalRoll, trapDc, isMagicTrap, hasTrapfinding);

      let nextState = state;
      let wasReset = false;
      if (disarmOutcome.success && trapEntityId !== undefined && trapComp !== undefined) {
        const hasLock = getComponent(nextState, trapEntityId, ComponentType.Lock) !== undefined;
        if (!hasLock && trapComp.canReset !== false && check.totalRoll >= trapDc + TRAP_RESET_MARGIN) {
          wasReset = true;
          nextState = addComponent(nextState, trapEntityId, {
            ...trapComp,
            triggered: false,
            resetByEntityId: intent.entityId
          });
          if (!getComponent(nextState, trapEntityId, ComponentType.Renderable)) {
            nextState = addComponent(nextState, trapEntityId, {
              type: ComponentType.Renderable,
              glyph: '^',
              fg: '#4ade80',
              bg: 'transparent',
              spriteId: 'trap'
            });
          }
        } else {
          nextState = removeComponent(nextState, trapEntityId, ComponentType.Trap);
        }
      } else if (disarmOutcome.triggeredTrap && trapEntityId !== undefined && trapComp !== undefined) {
        nextState = addComponent(nextState, trapEntityId, {
          ...trapComp,
          triggered: true
        });
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = disarmOutcome.success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: disarmOutcome.triggeredTrap
              ? 'Disable Device failed by 5+ and sprung trap'
              : 'Disable Device check failed'
          };

      const msg = wasReset
        ? `You disarm and reset the trap against hostiles (roll: ${check.totalRoll} vs DC ${trapDc + TRAP_RESET_MARGIN})!`
        : disarmOutcome.success
          ? `You successfully disarm the mechanism (roll: ${check.totalRoll} vs DC ${trapDc})!`
          : disarmOutcome.triggeredTrap
            ? `Your Disable Device attempt goes awry (roll: ${check.totalRoll} vs DC ${trapDc}) and springs the trap!`
            : `You fail to disarm the mechanism (roll: ${check.totalRoll} vs DC ${trapDc}).`;

      return {
        state: addMessage(nextState, msg, MessageLogCategory.System),
        success: disarmOutcome.success,
        events: [event]
      };
    }

    case 'heal': {
      const { check } = evaluateActorSkillCheck(state, intent.entityId, 'heal', HEAL_SKILL_STANDARD_DC);
      const kitInfo = collectInventoryMedicalKitHealModifiers(state, intent.entityId);
      const dag = evaluateDnD35eEntityDAG(state, intent.entityId);
      const existingHealMods = dag?.resolvedSkills['heal']?.modifierBreakdown.activeModifiers ?? [];
      const kitBonus =
        kitInfo.modifiers.length > 0
          ? resolveTypedModifiers([...existingHealMods, ...kitInfo.modifiers]) - resolveTypedModifiers(existingHealMods)
          : 0;
      const effectiveRoll = check.totalRoll + kitBonus;
      const success = resolveHealSkillCheck(effectiveRoll, HEAL_SKILL_STANDARD_DC);

      let nextState = state;
      const patientId = intent.target.type === 'entity' ? intent.target.entityId : intent.entityId;
      if (success) {
        const patientDnd = resolveEntityDnD35Data(nextState, patientId);
        const updatedPatient: DnD35EntityData = {
          ...patientDnd,
          isStable: true
        };
        nextState = saveEntityDnD35Data(nextState, patientId, updatedPatient);

        const patientStatuses = getComponent(nextState, patientId, ComponentType.StatusEffects) as
          StatusEffectsComponent | undefined;
        if (patientStatuses && patientStatuses.activeEffects.some((e) => HEAL_CURED_LIMP_STATUS_IDS.has(e.effectId))) {
          const remaining = patientStatuses.activeEffects.filter((e) => !HEAL_CURED_LIMP_STATUS_IDS.has(e.effectId));
          nextState = addComponent(nextState, patientId, { ...patientStatuses, activeEffects: remaining });
        }

        const neutralized = neutralizePendingSecondaryStatuses(nextState, patientId);
        nextState = neutralized.state;
      }

      const event: ApplyResolvedEvent | ApplyFailedEvent = success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: 'Heal check failed'
          };

      return {
        state: addMessage(
          nextState,
          success
            ? `You administer First Aid (Heal check: ${effectiveRoll} vs DC ${HEAL_SKILL_STANDARD_DC}). The patient is stabilized and treated.`
            : `Your First Aid attempt fails (Heal check: ${effectiveRoll} vs DC ${HEAL_SKILL_STANDARD_DC}).`,
          MessageLogCategory.System
        ),
        success,
        events: [event]
      };
    }

    case 'dip': {
      if (intent.toolEntityId === undefined) return null;
      const targetItemEntityId =
        intent.target.type === 'item'
          ? intent.target.itemEntityId
          : intent.target.type === 'entity'
            ? intent.target.entityId
            : undefined;
      if (targetItemEntityId === undefined) return null;
      const dipRes = resolveDipWeaponCoating({
        state,
        actorId: intent.entityId,
        targetItemEntityId,
        coatingSourceEntityId: intent.toolEntityId
      });
      const evt: ApplyResolvedEvent | ApplyFailedEvent = dipRes.success
        ? {
            type: GameEventType.ApplyResolved,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId
          }
        : {
            type: GameEventType.ApplyFailed,
            entityId: intent.entityId,
            verb: intent.verb,
            target: intent.target,
            toolEntityId: intent.toolEntityId,
            reason: dipRes.poisonMishap ? 'Poison application mishap' : 'Invalid coating target'
          };
      return {
        state: dipRes.state,
        success: dipRes.success,
        events: [evt]
      };
    }

    case 'apply': {
      if (intent.toolEntityId === undefined) {
        return null;
      }
      const itemComp = getComponent(state, intent.toolEntityId, ComponentType.Item) as ItemComponent | undefined;
      if (!itemComp) return null;
      const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
      if (!rawDef) return null;
      const itemDef = resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp);
      const toolTags = itemDef.tags ?? [];

      if (intent.target.type === 'tile') {
        if (toolTags.includes('reach_probe')) {
          const probeRes = probeTrapWithReachTool(state, intent.entityId, intent.target.x, intent.target.y);
          return { state: probeRes.state, success: probeRes.success };
        }
        if (toolTags.includes('door_spike')) {
          const doorId = findTargetEntityWithComponent(state, intent.target, ComponentType.Structural);
          if (doorId !== undefined) {
            const spikeRes = spikeDoorWithWedge(state, intent.entityId, doorId, intent.toolEntityId);
            return { state: spikeRes.state, success: spikeRes.success };
          }
        }
        if (
          toolTags.includes('grappling_anchor') ||
          toolTags.includes('crossing_ladder') ||
          toolTags.includes('rope')
        ) {
          const rigRes = resolveRigCrossingWithGear({
            state,
            entityId: intent.entityId,
            targetX: intent.target.x,
            targetY: intent.target.y,
            crossingKind: toolTags.includes('crossing_ladder') ? 'ladder_span' : 'rope_line'
          });
          return {
            state: rigRes.state,
            success: rigRes.success
          };
        }
        if (
          toolTags.includes('caltrops_hazard') ||
          toolTags.includes('marbles_hazard') ||
          toolTags.includes('flammable_oil') ||
          toolTags.includes('smoke_emitter')
        ) {
          return deployTacticalFloorHazardItem(
            state,
            intent.entityId,
            intent.toolEntityId,
            intent.target.x,
            intent.target.y
          );
        }
        return null;
      }

      if (intent.target.type === 'item') {
        if (toolTags.includes('repair_tool')) {
          const repairRes = repairRuinedItem(state, intent.entityId, intent.target.itemEntityId);
          return { state: repairRes.state, success: repairRes.success };
        }
        return resolveCraftAlchemyPotionIdentification(state, intent.entityId, intent.target.itemEntityId);
      }

      if (intent.target.type !== 'entity') {
        return null;
      }
      if (toolTags.includes('door_spike')) {
        const spikeRes = spikeDoorWithWedge(state, intent.entityId, intent.target.entityId, intent.toolEntityId);
        return { state: spikeRes.state, success: spikeRes.success };
      }
      if (toolTags.includes('repair_tool')) {
        const repairRes = repairRuinedItem(state, intent.entityId, intent.target.entityId);
        return { state: repairRes.state, success: repairRes.success };
      }
      if (!toolTags.includes(RESTRAINTS_ITEM_TAG)) {
        return null;
      }

      const targetId = intent.target.entityId;
      if (!isTargetEligibleForRestraints(state, targetId)) {
        const failedEvent: ApplyFailedEvent = {
          type: GameEventType.ApplyFailed,
          entityId: intent.entityId,
          verb: intent.verb,
          target: intent.target,
          toolEntityId: intent.toolEntityId,
          reason: 'Target is not helpless or incapacitated'
        };
        return {
          state: addMessage(
            state,
            `You can only lock ${itemDef.name} onto a helpless, sleeping, or incapacitated target!`,
            MessageLogCategory.System
          ),
          success: false,
          events: [failedEvent]
        };
      }

      const isMasterwork =
        itemDef.magicalProperties?.isMasterwork === true || toolTags.includes('masterwork');
      const escapeArtistDc = isMasterwork ? MASTERWORK_MANACLES_ESCAPE_ARTIST_DC : STANDARD_MANACLES_ESCAPE_ARTIST_DC;
      const breakDc = isMasterwork ? MASTERWORK_MANACLES_BREAK_DC : STANDARD_MANACLES_BREAK_DC;

      const targetDnd = resolveEntityDnD35Data(state, targetId);
      const conds = targetDnd.conditions ?? [];
      const nextConditions: ReadonlyArray<DnD35ConditionId> = conds.includes('bound') ? conds : [...conds, 'bound'];
      const updatedTarget: DnD35EntityData = {
        ...targetDnd,
        conditions: nextConditions,
        restraintBinding: {
          escapeArtistDc,
          breakDc,
          restraintItemId: itemDef.id
        }
      };

      const targetName = resolveEntityDisplayName(state, targetId, 'the captive');
      let nextState = saveEntityDnD35Data(state, targetId, updatedTarget);
      nextState = addMessage(
        nextState,
        `You lock ${itemDef.name} onto ${targetName} (Escape Artist DC ${escapeArtistDc}, Break DC ${breakDc})!`,
        MessageLogCategory.System
      );

      const resolvedEvent: ApplyResolvedEvent = {
        type: GameEventType.ApplyResolved,
        entityId: intent.entityId,
        verb: intent.verb,
        target: intent.target,
        toolEntityId: intent.toolEntityId
      };
      return {
        state: nextState,
        success: true,
        events: [resolvedEvent]
      };
    }

    case 'open': {
      const doorId = findTargetEntityWithComponent(state, intent.target, ComponentType.Structural);
      if (doorId === undefined) return null;
      const res = openStructuralDoor(state, intent.entityId, doorId);
      return { state: res.state, success: res.success };
    }

    case 'close': {
      const doorId = findTargetEntityWithComponent(state, intent.target, ComponentType.Structural);
      if (doorId === undefined) return null;
      const res = closeStructuralDoor(state, intent.entityId, doorId);
      return { state: res.state, success: res.success };
    }

    case 'kick': {
      const doorId = findTargetEntityWithComponent(state, intent.target, ComponentType.Structural);
      if (doorId === undefined) return null;
      const res = resolveSrdBreakObjectCheck(state, intent.entityId, doorId);
      return { state: res.state, success: res.success };
    }

    case 'read': {
      const bookId =
        intent.target.type === 'item'
          ? intent.target.itemEntityId
          : intent.target.type === 'entity'
            ? intent.target.entityId
            : intent.toolEntityId;
      if (bookId === undefined) return null;
      const bookItem = getComponent(state, bookId, ComponentType.Item) as ItemComponent | undefined;
      const bookDef = bookItem ? state.campaign.items[bookItem.itemId] : undefined;
      if (!bookDef?.tags.includes('spellbook')) return null;
      const res = transcribeSpellFromBook(state, intent.entityId, bookId);
      return { state: res.state, success: res.success };
    }

    default:
      return null;
  }
}
