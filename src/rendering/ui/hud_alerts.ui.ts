/**
 * @file RimWorld-style right-edge floating alert ribbon projector for hostiles in FOV,
 * low health, starvation, detrimental status effects, and active quests.
 */

import { createToggleQuestsAction } from '../../actions/core.actions.ts';
import {
  DEFAULT_ACTOR_TURN_DURATION,
  RTWP_IDLE_WAIT_DURATION,
  RTWP_MS_PER_100_DURATION
} from '../../constants/scheduler.constants.ts';
import { ALERT_CRITICAL_HP_RATIO, ALERT_LOW_HP_RATIO } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { setHoveredTile } from '../../core/hover_state.ts';
import { hasPendingIntents } from '../../core/input_queue.ts';
import { markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { getActiveTurnActorId, getActorRemainingScheduleTime, isTurnProcessingActive } from '../../core/scheduler.ts';
import { getHungerState } from '../../systems/hunger.system.ts';
import { getEffectiveWorldClockConfig } from '../../systems/world_clock.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type HungerComponent,
  type NemesisComponent,
  type PositionComponent,
  type QuestLogComponent,
  type StatusEffectsComponent
} from '../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../types/game-state.types.ts';
import { formatTurnDurationCompact } from '../../utils/duration.ts';
import { isHostile } from '../../utils/faction.ts';
import { isTileKeyInFov } from '../../map/map_accessor.ts';
import { getEffectiveStats } from '../../utils/stats.ts';
import { resolveEntityDisplayName } from '../inspect_tooltip.ts';
import { getActiveCartridgeUI } from './cartridge_ui_registry.ts';

/** Minimum RTwP speed multiplier divisor preventing division-by-zero when formatting cooldown seconds. */
const MIN_RTWP_SPEED_MULTIPLIER = 0.1;

/** Milliseconds per second (`1000`). */
const MS_PER_SECOND = 1000;

/** Severity level for RimWorld-style HUD alert ribbons. */
export type AlertSeverity = 'critical' | 'warning' | 'info' | 'turn-ready';

/** Descriptor for a single floating alert ribbon. */
export interface HudAlertDescriptor {
  readonly label: string;
  readonly detail: string;
  readonly severity: AlertSeverity;
  readonly onClick?: (() => void) | undefined;
}

/**
 * Checks whether `actorId` can currently be perceived by the player (same entity,
 * visible footprint tile in FOV/explored map, and not concealed by invisibility).
 */
export function isActorPerceivedByPlayer(state: GameState, actorId: EntityId, playerId: EntityId): boolean {
  if (actorId === playerId) return true;

  const pos = getComponent(state, actorId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return false;

  const width = Math.max(1, pos.footprintWidth ?? 1);
  const height = Math.max(1, pos.footprintHeight ?? 1);
  let anyTileVisible = state.map.isFullyExplored;
  if (!anyTileVisible) {
    for (let dy = 0; dy < height && !anyTileVisible; dy++) {
      for (let dx = 0; dx < width; dx++) {
        if (isTileKeyInFov(state, pos.x + dx, pos.y + dy)) {
          anyTileVisible = true;
          break;
        }
      }
    }
  }
  if (!anyTileVisible) return false;

  const statuses = getComponent(state, actorId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  if (statuses?.activeEffects.some((e) => e.effectId === 'invisible' || e.effectId === 'invisible_active')) {
    return false;
  }

  const rulesetComp = getComponent(state, actorId, ComponentType.RulesetData);
  const conditions = (rulesetComp?.payload as { readonly conditions?: ReadonlyArray<string> } | undefined)?.conditions;
  if (conditions?.includes('invisible')) {
    return false;
  }

  return true;
}

/**
 * Builds the pinned top-right RimWorld-style Turn / RTwP Action Readiness ribbon descriptor.
 */
export function buildTurnStatusRibbon(state: GameState, playerId: EntityId): HudAlertDescriptor {
  const playerName = resolveEntityDisplayName(state, playerId, 'Adventurer');
  const focusPos = (targetId: EntityId): (() => void) | undefined => {
    const pos = getComponent(state, targetId, ComponentType.Position) as PositionComponent | undefined;
    if (!pos) return undefined;
    return () => {
      if (setHoveredTile({ x: pos.x, y: pos.y })) {
        markDomainDirty(PresentationDomain.Map);
        markDomainDirty(PresentationDomain.HUD);
      }
    };
  };

  if (state.engineMode === EngineMode.RTwP) {
    const remainingEnergy = getActorRemainingScheduleTime(playerId);
    const queued = hasPendingIntents();
    if (state.rtwpState.paused) {
      return {
        label: `⏸ Tactical Pause (${playerName})`,
        detail: `Round ${state.globalTurn} • ${queued ? 'Action Queued (Unpause to act)' : 'Issue command or unpause'}`,
        severity: 'info',
        onClick: focusPos(playerId)
      };
    }

    if (remainingEnergy > RTWP_IDLE_WAIT_DURATION) {
      const speed = Math.max(MIN_RTWP_SPEED_MULTIPLIER, state.rtwpState.speedMultiplier);
      const remainingSec = (
        ((remainingEnergy / DEFAULT_ACTOR_TURN_DURATION) * (RTWP_MS_PER_100_DURATION / MS_PER_SECOND)) /
        speed
      ).toFixed(1);
      return {
        label: `⏳ Recovering: ${remainingSec}s`,
        detail: `Round ${state.globalTurn} • ${queued ? 'Next action queued...' : 'Waiting for next turn...'}`,
        severity: 'warning',
        onClick: focusPos(playerId)
      };
    }

    return {
      label: `🟢 Ready: ${playerName}`,
      detail: `Round ${state.globalTurn} • Real-Time (${state.rtwpState.speedMultiplier}x)`,
      severity: 'turn-ready',
      onClick: focusPos(playerId)
    };
  }

  const activeActorId = getActiveTurnActorId();
  const processing = isTurnProcessingActive();
  if ((activeActorId === null || activeActorId === playerId) && !processing) {
    return {
      label: `Your Turn: ${playerName}`,
      detail: `Round ${state.globalTurn} • Ready for command`,
      severity: 'turn-ready',
      onClick: focusPos(playerId)
    };
  }

  if (
    activeActorId !== null &&
    activeActorId !== playerId &&
    isActorPerceivedByPlayer(state, activeActorId, playerId)
  ) {
    const activeName = resolveEntityDisplayName(state, activeActorId, 'Creature');
    return {
      label: `Turn: ${activeName}`,
      detail: `Round ${state.globalTurn} • Acting — please wait...`,
      severity: 'warning',
      onClick: focusPos(activeActorId)
    };
  }

  return {
    label: 'Turn: ???',
    detail: `Round ${state.globalTurn} • Unseen activity — please wait...`,
    severity: 'warning'
  };
}

/**
 * Projects all active HUD alert ribbons for the current player entity.
 */
export function projectHudAlertsList(state: GameState, playerEntityId: EntityId): ReadonlyArray<HudAlertDescriptor> {
  const alerts: HudAlertDescriptor[] = [buildTurnStatusRibbon(state, playerEntityId)];

  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    const stats = getEffectiveStats(state, playerEntityId);
    const hpRatio = fighter.hp / Math.max(1, stats.maxHp);
    if (hpRatio <= ALERT_CRITICAL_HP_RATIO) {
      alerts.push({ label: 'Critical Wounds', detail: `${fighter.hp}/${stats.maxHp} HP`, severity: 'critical' });
    } else if (hpRatio <= ALERT_LOW_HP_RATIO) {
      alerts.push({ label: 'Injured', detail: `${fighter.hp}/${stats.maxHp} HP`, severity: 'warning' });
    }
  }

  const visibleHostiles: Array<{
    readonly id: EntityId;
    readonly name: string;
    readonly pos: PositionComponent;
    readonly isNemesis: boolean;
  }> = [];
  for (const entityId of state.entities) {
    if (entityId === playerEntityId) continue;
    const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
    const targetFighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    if (!pos || !targetFighter) continue;

    if (!isTileKeyInFov(state, pos.x, pos.y)) continue;

    if (isHostile(state, playerEntityId, entityId)) {
      const nemesis = getComponent(state, entityId, ComponentType.Nemesis) as NemesisComponent | undefined;
      visibleHostiles.push({
        id: entityId,
        name: resolveEntityDisplayName(state, entityId),
        pos,
        isNemesis: Boolean(nemesis)
      });
    }
  }

  const firstHostile = visibleHostiles[0];
  if (firstHostile !== undefined) {
    const hasNemesis = visibleHostiles.some((h) => h.isNemesis);
    alerts.push({
      label: hasNemesis ? 'Nemesis Spotted!' : `Hostiles (${visibleHostiles.length})`,
      detail: visibleHostiles.length === 1 ? firstHostile.name : `${firstHostile.name} +${visibleHostiles.length - 1}`,
      severity: 'critical',
      onClick: () => {
        if (setHoveredTile({ x: firstHostile.pos.x, y: firstHostile.pos.y })) {
          markDomainDirty(PresentationDomain.Map);
          markDomainDirty(PresentationDomain.HUD);
        }
      }
    });
  }

  const hunger = getComponent(state, playerEntityId, ComponentType.Hunger) as HungerComponent | undefined;
  if (hunger) {
    const hungerLabel = getHungerState(state, hunger.satiation);
    if (hungerLabel === 'Starving') {
      alerts.push({ label: 'Starving', detail: 'Find food immediately', severity: 'critical' });
    } else if (hungerLabel === 'Hungry') {
      alerts.push({ label: 'Hungry', detail: 'Satiation low', severity: 'warning' });
    }
  }

  const statuses = getComponent(state, playerEntityId, ComponentType.StatusEffects) as
    StatusEffectsComponent | undefined;
  if (statuses) {
    const clock = getEffectiveWorldClockConfig(state);
    for (const active of statuses.activeEffects) {
      const def = state.campaign.status[active.effectId];
      const isFriendlyOrNeutral =
        active.polarity === 'buff' ||
        active.polarity === 'neutral' ||
        (active.polarity === undefined && def !== undefined && !def.detrimental);
      if (isFriendlyOrNeutral) continue;
      alerts.push({
        label: active.displayName ?? def?.name ?? active.effectId,
        detail: `${formatTurnDurationCompact(active.duration, active.isPermanent, clock)} remaining`,
        severity: 'warning'
      });
    }
  }

  const questLog = getComponent(state, playerEntityId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  const activeQuestCount = questLog ? Object.values(questLog.quests).filter((q) => q.status === 'active').length : 0;
  if (activeQuestCount > 0) {
    alerts.push({
      label: `Active Quests (${activeQuestCount})`,
      detail: 'Click to view journal [Q]',
      severity: 'info',
      onClick: () => {
        queuePlayerIntent(createToggleQuestsAction(playerEntityId));
      }
    });
  }

  const cartridgeUI = getActiveCartridgeUI(state);
  if (cartridgeUI?.projectHudAlerts) {
    const extraAlerts = cartridgeUI.projectHudAlerts(state, playerEntityId);
    alerts.push(...extraAlerts);
  }

  return alerts;
}
