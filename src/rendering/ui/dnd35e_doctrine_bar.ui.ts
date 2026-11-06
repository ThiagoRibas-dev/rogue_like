/**
 * @file D&D 3.5e HUD Tactical Doctrine Bar & Combat Action Tray (Milestone 118).
 * Renders compact Power Attack & Combat Expertise sliders, grip mode pills,
 * stance toggles (Fighting Defensively, Total Defense), 5-tier action budget pips,
 * and quick-action maneuver verb buttons.
 */

import { getComponent } from '../../core/ecs.ts';
import {
  aggregateProgressionChassis,
  type DnD35ActionBudget,
  extractActorTacticalDials,
  getDnD35EntityData,
  getDnD35SystemContent
} from '../../rulesets/registry.ts';
import { ComponentType, type TacticalDoctrineComponent, type WeaponGripMode } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { applyDoctrineUpdate } from './dnd35e_doctrine_actions.ts';

const FIXED_DIAL_CAP = 5;

/**
 * Builds a compact range slider for a variable tactical dial (Power Attack, Combat Expertise).
 */
function createDialSlider(
  label: string,
  currentVal: number,
  maxVal: number,
  onChange: (val: number) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'doctrine-slider-row';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'doctrine-slider-label';
  labelSpan.textContent = `${label} (${currentVal}/${maxVal})`;
  row.appendChild(labelSpan);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = maxVal.toString();
  slider.value = currentVal.toString();
  slider.className = 'doctrine-slider';
  slider.disabled = maxVal <= 0;

  slider.addEventListener('input', () => {
    const val = parseInt(slider.value, 10) || 0;
    labelSpan.textContent = `${label} (${val}/${maxVal})`;
    onChange(val);
  });

  row.appendChild(slider);
  return row;
}

/**
 * Renders the Tactical Doctrine Bar in the HUD cartridge slot (`#hud-cartridge-panel-slot`).
 */
export function renderDnD35eDoctrineBar(container: HTMLElement, state: GameState, playerId: EntityId): void {
  container.replaceChildren();

  const dndData = getDnD35EntityData(state, playerId);
  const doctrine = (getComponent(state, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined) ?? {
    type: ComponentType.TacticalDoctrine,
    powerAttackAmount: 0,
    combatExpertiseAmount: 0,
    fightingDefensively: false,
    totalDefense: false,
    gripMode: 'one_handed' as WeaponGripMode
  };

  const sys = getDnD35SystemContent(state.campaign);
  const chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const bab = chassis.totalBab;

  const card = document.createElement('div');
  card.className = 'hud-card doctrine-card';

  const header = document.createElement('div');
  header.className = 'hud-card-header';
  const title = document.createElement('h2');
  title.textContent = 'Tactical Doctrine';
  header.appendChild(title);
  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'hud-card-body doctrine-card-body';

  // 1. Variable Dials (Power Attack, Combat Expertise)
  const dials = extractActorTacticalDials(dndData.feats, sys?.feats);
  for (const dial of dials) {
    const maxVal = dial.maxCapRule === 'bab' ? bab : FIXED_DIAL_CAP;
    const currentVal =
      dial.abilityId === 'power_attack'
        ? (doctrine.powerAttackAmount ?? 0)
        : dial.abilityId === 'combat_expertise'
          ? (doctrine.combatExpertiseAmount ?? 0)
          : 0;

    const sliderRow = createDialSlider(dial.name ?? dial.abilityId, currentVal, maxVal, (val) => {
      if (dial.abilityId === 'power_attack') {
        applyDoctrineUpdate(state, playerId, { powerAttackAmount: val });
      } else if (dial.abilityId === 'combat_expertise') {
        applyDoctrineUpdate(state, playerId, { combatExpertiseAmount: val });
      }
    });
    body.appendChild(sliderRow);
  }

  // 2. Stance Toggles & Grip Mode
  const stanceRow = document.createElement('div');
  stanceRow.className = 'doctrine-stance-row';

  // Fighting Defensively Toggle
  const fightDefBtn = document.createElement('button');
  fightDefBtn.type = 'button';
  fightDefBtn.className = doctrine.fightingDefensively ? 'doctrine-chip active' : 'doctrine-chip';
  fightDefBtn.textContent = 'Fight Def.';
  fightDefBtn.title = 'Fighting Defensively: -4 attack penalty, +2 (+3 with 5 Tumble ranks) Dodge AC';
  fightDefBtn.addEventListener('click', () => {
    applyDoctrineUpdate(state, playerId, {
      fightingDefensively: !doctrine.fightingDefensively,
      totalDefense: false
    });
  });
  stanceRow.appendChild(fightDefBtn);

  // Total Defense Toggle
  const totalDefBtn = document.createElement('button');
  totalDefBtn.type = 'button';
  totalDefBtn.className = doctrine.totalDefense ? 'doctrine-chip active' : 'doctrine-chip';
  totalDefBtn.textContent = 'Total Def.';
  totalDefBtn.title = 'Total Defense: Standard action, forfeit attacks, +4 (+6 with 5 Tumble ranks) Dodge AC';
  totalDefBtn.addEventListener('click', () => {
    applyDoctrineUpdate(state, playerId, {
      totalDefense: !doctrine.totalDefense,
      fightingDefensively: false
    });
  });
  stanceRow.appendChild(totalDefBtn);

  // Grip Mode Toggle (One-Handed vs Two-Handed)
  const gripBtn = document.createElement('button');
  gripBtn.type = 'button';
  gripBtn.className = 'doctrine-chip';
  const is2H = doctrine.gripMode === 'two_handed';
  gripBtn.textContent = is2H ? 'Grip: 2-Hand' : 'Grip: 1-Hand';
  gripBtn.title = is2H ? 'Two-handed grip (1.5x STR damage, 2x Power Attack)' : 'One-handed grip (1x STR damage)';
  gripBtn.addEventListener('click', () => {
    applyDoctrineUpdate(state, playerId, {
      gripMode: is2H ? 'one_handed' : 'two_handed'
    });
  });
  stanceRow.appendChild(gripBtn);

  body.appendChild(stanceRow);

  // 3. 5-Tier Action Budget Pips
  const budget = (dndData as { readonly actionBudget?: DnD35ActionBudget | undefined }).actionBudget;
  if (budget) {
    const pipsRow = document.createElement('div');
    pipsRow.className = 'doctrine-pips-row';

    const renderPip = (label: string, active: boolean, titleText: string): void => {
      const pip = document.createElement('span');
      pip.className = active ? 'budget-pip active' : 'budget-pip spent';
      pip.textContent = label;
      pip.title = titleText;
      pipsRow.appendChild(pip);
    };

    renderPip('STD', budget.standardRemaining > 0, 'Standard Action remaining');
    renderPip('MOV', budget.moveRemaining > 0, 'Move Action remaining');
    renderPip('SWF', budget.swiftRemaining > 0, 'Swift Action remaining');
    renderPip(`AoO:${budget.aooRemaining}`, budget.aooRemaining > 0, 'Attacks of Opportunity remaining');

    body.appendChild(pipsRow);
  }

  card.appendChild(body);
  container.appendChild(card);
}
