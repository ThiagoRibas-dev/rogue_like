/**
 * @file D&D 3.5e Character Sheet Column 1: Consolidated Identity, Reactive Paper Doll & Defenses.
 */

import { createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  aggregateProgressionChassis,
  ALL_ABILITY_IDS,
  computeXpThresholdForLevel,
  DnD35UIAdapter,
  evaluateDnD35eEntityDAG,
  getDnD35EntityData
} from '../../rulesets/registry.ts';
import { ComponentType, type FighterComponent, type IdentityComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderReactivePaperDollWidget } from './console_inventory.ui.ts';

const DEFAULT_ABILITY_SCORE = 10;
const dndAdapter = new DnD35UIAdapter();

let activeWeaponSet = 1;

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

/**
 * Renders Column 1 (Left Column): Identity, Attributes, Reactive Paper Doll & Defenses into `container`.
 */
export function renderSheetOverviewTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const dndData = getDnD35EntityData(state, playerId);
  const identity = getComponent(state, playerId, ComponentType.Identity) as IdentityComponent | undefined;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const xpCurr = fighter?.xp ?? 0;
  const xpNext = computeXpThresholdForLevel(chassis.ecl + 1);
  const trackSummary = dndData.tracks.map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Adventurer 1';

  const nameHeading = document.createElement('h3');
  nameHeading.className = 'crpg-section-heading';
  nameHeading.textContent = identity?.name ?? 'Adventurer';
  col.appendChild(nameHeading);

  const xpRow = document.createElement('div');
  xpRow.className = 'crpg-xp-row';
  for (const txt of [
    `ECL ${chassis.ecl}`,
    trackSummary,
    `${xpCurr.toLocaleString()} / ${xpNext.toLocaleString()} XP`
  ]) {
    const sp = document.createElement('span');
    sp.textContent = txt;
    xpRow.appendChild(sp);
  }
  col.appendChild(xpRow);

  const split = document.createElement('div');
  split.className = 'crpg-identity-split';

  const portraitFrame = document.createElement('div');
  portraitFrame.className = 'crpg-portrait-frame';
  const avatarGlyph = document.createElement('div');
  avatarGlyph.className = 'crpg-portrait-avatar';
  avatarGlyph.textContent =
    dndData.anatomyBodyPlan === 'marilith_6arm' ? '🐍' : dndData.anatomyBodyPlan === 'quadruped' ? '🐺' : '🧙‍♂️';

  const hpPill = document.createElement('div');
  hpPill.className = 'crpg-portrait-hp-pill';
  const heart = document.createElement('span');
  heart.className = 'crpg-hp-heart';
  heart.textContent = '♥';
  const hpText = document.createElement('span');
  hpText.textContent = `${fighter?.hp ?? chassis.maxHp}/${fighter?.maxHp ?? chassis.maxHp}`;
  hpPill.append(heart, hpText);
  portraitFrame.append(avatarGlyph, hpPill);

  const rightIdentity = document.createElement('div');
  rightIdentity.className = 'crpg-identity-right';

  const alignPill = document.createElement('div');
  alignPill.className = 'crpg-alignment-pill';
  alignPill.textContent = (dndData.alignment ?? 'NG').toUpperCase().replace(/_/g, ' ');
  rightIdentity.appendChild(alignPill);

  const raceLine = document.createElement('div');
  raceLine.className = 'crpg-race-line';
  raceLine.textContent = `⚥ ${(dndData.raceId ?? 'human').toUpperCase()}`;
  rightIdentity.appendChild(raceLine);

  const attrTable = document.createElement('div');
  attrTable.className = 'crpg-attr-table';
  for (const ab of ALL_ABILITY_IDS) {
    const scoreVal = evalResult?.dagResult.effectiveAbilities[ab]?.base ?? DEFAULT_ABILITY_SCORE;
    const modVal = evalResult?.dagResult.effectiveAbilityModifiers[ab] ?? 0;
    const row = document.createElement('div');
    row.className = 'crpg-attr-row';
    const lbl = document.createElement('span');
    lbl.className = 'crpg-attr-label';
    lbl.textContent = ab.toUpperCase();
    const sc = document.createElement('span');
    sc.className = 'crpg-attr-score';
    sc.textContent = `${scoreVal}`;
    const md = document.createElement('span');
    md.className = 'crpg-attr-mod';
    md.textContent = formatSigned(modVal);
    row.append(lbl, sc, md);
    attrTable.appendChild(row);
  }
  rightIdentity.appendChild(attrTable);
  split.append(portraitFrame, rightIdentity);
  col.appendChild(split);

  // Reactive Anatomical Paper Doll driven 100% by live EquipmentComponent
  const pdHost = document.createElement('div');
  const invData = dndAdapter.getInventoryData({ state, entityId: playerId });
  renderReactivePaperDollWidget(
    pdHost,
    {
      ...invData,
      activeWeaponSetIndex: activeWeaponSet
    },
    {
      onHoverItem: (item, event) => {
        if (item?.inspectData) showConsoleItemInspectCard(item.inspectData, event);
        else hideConsoleItemInspectCard();
      },
      onUnequipItem: (slotId) => {
        queuePlayerIntent(createUnequipItemAction(playerId, slotId));
        markAllDomainsDirty();
      },
      onSelectWeaponSet: (idx) => {
        activeWeaponSet = idx;
      }
    }
  );
  col.appendChild(pdHost);

  // Armor Class & Saving Throws Strip
  const defHeader = document.createElement('div');
  defHeader.className = 'crpg-subbanner';
  defHeader.textContent = 'Armor Class & Saving Throws';
  col.appendChild(defHeader);

  const acBreakdown = evalResult?.dagResult.acBreakdown;
  const saves = evalResult?.dagResult.saves;
  const defGrid = document.createElement('div');
  defGrid.className = 'crpg-ac-saves-grid';
  for (const c of [
    { label: 'Armor Class', value: `${acBreakdown?.fullAC ?? 10}` },
    { label: 'Flat-footed', value: `${acBreakdown?.flatFootedAC ?? 10}` },
    { label: 'Touch', value: `${acBreakdown?.touchAC ?? 10}` },
    { label: 'Fortitude', value: formatSigned(saves?.fort ?? chassis.baseSaves.fort) },
    { label: 'Reflex', value: formatSigned(saves?.ref ?? chassis.baseSaves.ref) },
    { label: 'Will', value: formatSigned(saves?.will ?? chassis.baseSaves.will) }
  ]) {
    const cell = document.createElement('div');
    cell.className = 'crpg-defense-cell';
    const lbl = document.createElement('span');
    lbl.className = 'crpg-defense-cell-label';
    lbl.textContent = c.label;
    const val = document.createElement('span');
    val.className = 'crpg-defense-cell-val';
    val.textContent = c.value;
    cell.append(lbl, val);
    defGrid.appendChild(cell);
  }
  col.appendChild(defGrid);

  const dexMod = evalResult?.dagResult.effectiveAbilityModifiers.dex ?? 0;
  const strMod = evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const speedFooter = document.createElement('div');
  speedFooter.className = 'crpg-speed-footer';
  speedFooter.textContent = `BAB ${formatSigned(chassis.totalBab)} • Grapple ${formatSigned(chassis.totalBab + strMod)} • Init ${formatSigned(dexMod)} • Speed 30 ft.`;
  col.appendChild(speedFooter);

  container.appendChild(col);
}
