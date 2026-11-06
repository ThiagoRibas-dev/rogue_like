/**
 * @file D&D 3.5e Character Sheet Feats, Features, and Conditions Tabs (Milestone 118).
 * Renders lists of acquired feats with descriptions, class features & domains,
 * progression tracks, and active conditions using native DOM elements.
 */

import { getComponent } from '../../core/ecs.ts';
import { aggregateProgressionChassis, getDnD35EntityData, getDnD35SystemContent } from '../../rulesets/registry.ts';
import { ComponentType, type StatusEffectsComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

/**
 * Renders Tab 5: Feats of the Character Sheet.
 */
export function renderSheetFeatsTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const featRegistry = sys?.feats ?? {};

  const list = document.createElement('div');
  list.className = 'sheet-cards-list';

  if (dndData.feats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No feats acquired.';
    list.appendChild(empty);
  } else {
    for (const featId of dndData.feats) {
      const featDef = featRegistry[featId];
      const card = document.createElement('div');
      card.className = 'sheet-detail-card';

      const header = document.createElement('div');
      header.className = 'sheet-card-header';
      const titleStrong = document.createElement('strong');
      titleStrong.textContent = featDef?.name ?? featId;
      header.appendChild(titleStrong);
      card.appendChild(header);

      if (featDef?.description) {
        const desc = document.createElement('p');
        desc.className = 'sheet-card-desc';
        desc.textContent = featDef.description;
        card.appendChild(desc);
      }

      list.appendChild(card);
    }
  }

  container.appendChild(list);
}

/**
 * Renders Tab 6: Special Abilities & Domains of the Character Sheet.
 */
export function renderSheetSpecialAbilitiesTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const dndData = getDnD35EntityData(state, playerId);
  const features = dndData.activeClassFeatures ?? [];
  const domains = dndData.domains ?? [];

  const list = document.createElement('div');
  list.className = 'sheet-cards-list';

  if (features.length === 0 && domains.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No special class features or domains active.';
    list.appendChild(empty);
  } else {
    for (const featureId of features) {
      const card = document.createElement('div');
      card.className = 'sheet-detail-card';
      const strongEl = document.createElement('strong');
      strongEl.textContent = featureId.replace(/_/g, ' ').toUpperCase();
      card.appendChild(strongEl);
      list.appendChild(card);
    }

    for (const domainId of domains) {
      const card = document.createElement('div');
      card.className = 'sheet-detail-card';
      const strongEl = document.createElement('strong');
      strongEl.textContent = `Domain: ${domainId.toUpperCase()}`;
      card.appendChild(strongEl);
      list.appendChild(card);
    }
  }

  container.appendChild(list);
}

/**
 * Renders Tab 2: Progression (Tracks, HD, XP) of the Character Sheet.
 */
export function renderSheetProgressionTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const dndData = getDnD35EntityData(state, playerId);
  const chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);

  const card = document.createElement('div');
  card.className = 'sheet-detail-card';

  const title = document.createElement('h3');
  title.textContent = `Character Level ${chassis.ecl} (Total HD: ${chassis.totalHD})`;
  card.appendChild(title);

  const tracksList = document.createElement('div');
  tracksList.className = 'sheet-stats-list';
  for (const track of dndData.tracks) {
    const row = document.createElement('div');
    row.className = 'sheet-stat-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'stat-name';
    nameSpan.textContent = track.trackId.toUpperCase();
    row.appendChild(nameSpan);

    const valStrong = document.createElement('strong');
    valStrong.className = 'stat-val';
    valStrong.textContent = `Level ${track.levels}`;
    row.appendChild(valStrong);

    tracksList.appendChild(row);
  }
  card.appendChild(tracksList);

  container.appendChild(card);
}

/**
 * Renders Tab 7: Conditions & Auras of the Character Sheet.
 */
export function renderSheetConditionsTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const statusComp = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;

  const effects = statusComp?.activeEffects ?? [];
  const dndConditions = getDnD35EntityData(state, playerId).conditions;
  const list = document.createElement('div');
  list.className = 'sheet-cards-list';

  if (effects.length === 0 && dndConditions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'Healthy. No active debilitating conditions or curses.';
    list.appendChild(empty);
  } else {
    for (const cond of dndConditions) {
      const card = document.createElement('div');
      card.className = 'sheet-detail-card condition-card';
      const strongEl = document.createElement('strong');
      strongEl.textContent = cond.toUpperCase();
      card.appendChild(strongEl);
      list.appendChild(card);
    }

    for (const eff of effects) {
      const card = document.createElement('div');
      card.className = 'sheet-detail-card condition-card';
      const strongEl = document.createElement('strong');
      strongEl.textContent = eff.effectId;
      card.appendChild(strongEl);

      const durSpan = document.createElement('span');
      durSpan.className = 'condition-duration';
      durSpan.textContent = ` (${eff.duration} turns remaining)`;
      card.appendChild(durSpan);

      list.appendChild(card);
    }
  }

  container.appendChild(list);
}
