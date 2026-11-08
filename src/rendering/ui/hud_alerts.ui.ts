/**
 * @file RimWorld-style right-edge floating alert ribbons for hostiles in FOV,
 * low health, starvation, detrimental status effects, and active quests.
 */

import { createToggleQuestsAction } from '../../actions/core.actions.ts';
import { ALERT_CRITICAL_HP_RATIO, ALERT_LOW_HP_RATIO } from '../../constants/ui.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { setHoveredTile } from '../../core/hover_state.ts';
import { markDomainDirty, PresentationDomain } from '../../core/presentation_queue.ts';
import { resolveEntityDisplayName } from '../inspect_tooltip.ts';
import { getActiveCartridgeUI } from './cartridge_ui_registry.ts';
import { getHungerState } from '../../systems/hunger.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type HungerComponent,
  type NemesisComponent,
  type PositionComponent,
  type QuestLogComponent,
  type StatusEffectsComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { isHostile } from '../../utils/faction.ts';
import { coordToIndex } from '../../utils/grid.ts';
import { getEffectiveStats } from '../../utils/stats.ts';

/**
 * Severity level for RimWorld-style HUD alert ribbons.
 */
type AlertSeverity = 'critical' | 'warning' | 'info';

/**
 * Descriptor for a single floating alert ribbon.
 */
interface HudAlertDescriptor {
  readonly label: string;
  readonly detail: string;
  readonly severity: AlertSeverity;
  readonly onClick?: (() => void) | undefined;
}

/**
 * Renders RimWorld-style color-coded alert ribbons in `#hud-alerts-container`.
 *
 * @param state The current GameState.
 */
export function renderHudAlerts(state: GameState): void {
  const container = document.getElementById('hud-alerts-container');
  if (!container) return;

  container.replaceChildren();

  const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerEntityId === undefined) return;

  const alerts: HudAlertDescriptor[] = [];

  // 1. Check Player Health
  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    const stats = getEffectiveStats(state, playerEntityId);
    const hpRatio = fighter.hp / Math.max(1, stats.maxHp);
    if (hpRatio <= ALERT_CRITICAL_HP_RATIO) {
      alerts.push({
        label: 'Critical Wounds',
        detail: `${fighter.hp}/${stats.maxHp} HP`,
        severity: 'critical'
      });
    } else if (hpRatio <= ALERT_LOW_HP_RATIO) {
      alerts.push({
        label: 'Injured',
        detail: `${fighter.hp}/${stats.maxHp} HP`,
        severity: 'warning'
      });
    }
  }

  // 2. Check Visible Hostiles & Nemeses in FOV
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

    const tileIdx = coordToIndex(pos.x, pos.y, state.map.width);
    const isVisible = state.map.isFullyExplored || state.cachedFov.has(tileIdx);
    if (!isVisible) continue;

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

  // 3. Check Hunger State
  const hunger = getComponent(state, playerEntityId, ComponentType.Hunger) as HungerComponent | undefined;
  if (hunger) {
    const hungerLabel = getHungerState(state, hunger.satiation);
    if (hungerLabel === 'Starving') {
      alerts.push({
        label: 'Starving',
        detail: 'Find food immediately',
        severity: 'critical'
      });
    } else if (hungerLabel === 'Hungry') {
      alerts.push({
        label: 'Hungry',
        detail: 'Satiation low',
        severity: 'warning'
      });
    }
  }

  // 4. Active Status Effects
  const statuses = getComponent(state, playerEntityId, ComponentType.StatusEffects) as
    StatusEffectsComponent | undefined;
  if (statuses) {
    for (const active of statuses.activeEffects) {
      const def = state.campaign.status[active.effectId];
      alerts.push({
        label: def?.name ?? active.effectId,
        detail: `${active.duration}t remaining`,
        severity: 'warning'
      });
    }
  }

  // 5. Active Quests Summary Ribbon
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

  // 6. Cartridge-contributed HUD alert ribbons (e.g. Level Up Available)
  const cartridgeUI = getActiveCartridgeUI(state);
  if (cartridgeUI?.projectHudAlerts) {
    const extraAlerts = cartridgeUI.projectHudAlerts(state, playerEntityId);
    alerts.push(...extraAlerts);
  }

  for (const alert of alerts) {
    const ribbon = document.createElement('button');
    ribbon.type = 'button';
    ribbon.className = `hud-alert-ribbon alert-${alert.severity}`;

    const titleSpan = document.createElement('span');
    titleSpan.className = 'hud-alert-title';
    titleSpan.textContent = alert.label;

    const detailSpan = document.createElement('span');
    detailSpan.className = 'hud-alert-detail';
    detailSpan.textContent = alert.detail;

    ribbon.appendChild(titleSpan);
    ribbon.appendChild(detailSpan);

    if (alert.onClick) {
      ribbon.addEventListener('click', alert.onClick);
    }

    container.appendChild(ribbon);
  }
}
