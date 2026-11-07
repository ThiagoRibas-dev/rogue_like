/**
 * @file D&D 3.5e Character Sheet Column 2 (Center Column):
 * Multi-Weapon/Natural Attack Routine Ledger, Feats/Features/Conditions & Level-by-Level Matrix.
 */

import { getComponent } from '../../core/ecs.ts';
import { DnD35UIAdapter, getDnD35EntityData, getDnD35SystemContent } from '../../rulesets/registry.ts';
import { ComponentType, type StatusEffectsComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';

const dndAdapter = new DnD35UIAdapter();

/**
 * Renders Column 2 (Center Column): Attack Routine Ledger, Feats/Features/Conditions & Level-by-Level Matrix.
 */
export function renderSheetFeatsAndFeaturesTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const dndData = getDnD35EntityData(state, playerId);
  const sheetModel = dndAdapter.getCharacterSheetData({ state, entityId: playerId });
  const sys = getDnD35SystemContent(state.campaign);
  const featRegistry = sys?.feats ?? {};

  // SECTION 1: Multi-Weapon, Iterative & Natural Weapon Attack Routine Ledger
  const atkHeading = document.createElement('h3');
  atkHeading.className = 'crpg-section-heading';
  atkHeading.textContent = 'Full-Attack & Natural Weapon Routine';
  col.appendChild(atkHeading);

  const attackGroups = sheetModel.attackGroups ?? [];

  const routineList = document.createElement('div');
  routineList.className = 'crpg-attack-routine-list';

  for (const grp of attackGroups) {
    const row = document.createElement('div');
    row.className = 'crpg-attack-routine-row';

    const hdr = document.createElement('div');
    hdr.className = 'crpg-attack-group-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'crpg-attack-group-title';
    titleSpan.textContent = grp.label;
    const subSpan = document.createElement('span');
    subSpan.className = 'crpg-attack-group-sub';
    subSpan.textContent = grp.subtitle;
    hdr.append(titleSpan, subSpan);

    const metrics = document.createElement('div');
    metrics.className = 'crpg-attack-group-metrics';
    const atkChain = document.createElement('span');
    atkChain.className = 'crpg-attack-bonus-chain';
    atkChain.textContent = `ATK ${grp.attackBonuses}`;
    const dmgCrit = document.createElement('span');
    dmgCrit.className = 'crpg-attack-dmg-crit';
    dmgCrit.textContent = `${grp.damageFormula} (${grp.criticalProfile})`;
    metrics.append(atkChain, dmgCrit);

    row.append(hdr, metrics);
    if (grp.riderNotes) {
      const note = document.createElement('div');
      note.className = 'crpg-attack-rider-note';
      note.textContent = grp.riderNotes;
      row.appendChild(note);
    }
    routineList.appendChild(row);
  }
  col.appendChild(routineList);

  // SECTION 2: Feats, Class Features, Domains & Active Conditions
  const featBanner = document.createElement('div');
  featBanner.className = 'crpg-subbanner';
  featBanner.textContent = `Feats (${dndData.feats.length}), Class Features & Active Conditions`;
  col.appendChild(featBanner);

  const badgeGrid = document.createElement('div');
  badgeGrid.className = 'crpg-features-grid';

  const appendFeatureChip = (
    catClass: 'feat' | 'class_feature' | 'domain' | 'condition',
    icon: string,
    name: string,
    badge: string
  ): void => {
    const chip = document.createElement('div');
    chip.className = `crpg-feature-chip ${catClass}`;
    const ic = document.createElement('span');
    ic.className = 'crpg-feature-chip-icon';
    ic.textContent = icon;
    const nm = document.createElement('span');
    nm.className = 'crpg-feature-chip-title';
    nm.textContent = name;
    const bd = document.createElement('span');
    bd.className = 'crpg-feature-chip-badge';
    bd.textContent = badge;
    chip.append(ic, nm, bd);
    badgeGrid.appendChild(chip);
  };

  for (const featId of dndData.feats) {
    const def = featRegistry[featId];
    appendFeatureChip('feat', '⭐', def?.name ?? featId.replace(/_/g, ' '), 'Feat');
  }
  for (const cfId of dndData.activeClassFeatures ?? []) {
    appendFeatureChip('class_feature', '🛡️', cfId.replace(/_/g, ' '), 'Class');
  }
  for (const domId of dndData.domains ?? []) {
    appendFeatureChip('domain', '☀️', `${domId.toUpperCase()} Domain`, 'Domain');
  }
  for (const cond of dndData.conditions) {
    appendFeatureChip('condition', '⚠️', cond.toUpperCase(), 'Cond');
  }
  const statusComp = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  for (const eff of statusComp?.activeEffects ?? []) {
    appendFeatureChip('condition', '✨', eff.effectId, `${eff.duration}t`);
  }
  if (badgeGrid.childElementCount === 0) {
    appendFeatureChip('class_feature', '🛡️', 'Martial & Simple Proficiency', 'Base');
  }
  col.appendChild(badgeGrid);

  // SECTION 3: Horizon 1 Level-by-Level Progression Matrix
  const matrixBanner = document.createElement('div');
  matrixBanner.className = 'crpg-subbanner';
  matrixBanner.textContent = 'Level-by-Level Progression Matrix (Horizon 1 Ledger)';
  col.appendChild(matrixBanner);

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'crpg-level-matrix-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'crpg-level-matrix-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of ['Lvl', 'Class / RHD', 'HP', 'Skills', 'Feats & Features']) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const history = dndData.levelHistory ?? [];
  if (history.length > 0) {
    for (const entry of history) {
      const tr = document.createElement('tr');
      const skPts = Object.values(entry.addedSkillRanks ?? {}).reduce((a: number, b: number) => a + b, 0);
      const gains =
        [...entry.selectedFeats, ...entry.selectedAcfs].map((g) => g.replace(/_/g, ' ')).join(', ') || 'Base Chassis';
      for (const txt of [
        `${entry.characterLevel}`,
        `${entry.classId} ${entry.classLevel}`,
        `+${entry.hpRolled}`,
        `${skPts} pts`,
        gains
      ]) {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  } else {
    let runningLvl = 1;
    for (const trk of dndData.tracks) {
      const tr = document.createElement('tr');
      for (const txt of [
        `${runningLvl}–${runningLvl + trk.levels - 1}`,
        trk.trackId.toUpperCase(),
        `d${trk.hitDieSides}`,
        `${Object.keys(dndData.skillRanks).length} trn`,
        (dndData.feats ?? []).join(', ') || 'Baseline'
      ]) {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
      runningLvl += trk.levels;
    }
  }
  tbl.appendChild(tbody);
  matrixWrap.appendChild(tbl);
  col.appendChild(matrixWrap);

  container.appendChild(col);
}
