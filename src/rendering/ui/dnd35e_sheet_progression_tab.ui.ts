/**
 * @file D&D 3.5e Character Sheet Tab 2:
 * Feats & Traits on the left, and Horizon 1 Level-by-Level Progression Matrix on the right.
 */

import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UICharacterSheetModel } from '../../types/ui_adapter.types.ts';
import { classifyFeatCategory } from './dnd35e_char_builder_feat_row.ui.ts';

/**
 * Renders Tab 2: Progression & Features into `container`.
 */
export function renderSheetProgressionTab(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  _preSheetModel?: UICharacterSheetModel
): void {
  const tabWrap = document.createElement('div');
  tabWrap.className = 'crpg-two-col-grid crpg-sheet-progression-layout';

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const featRegistry = sys?.feats ?? {};

  // COLUMN 1: FEATS & TRAITS
  const leftCol = document.createElement('div');
  leftCol.className = 'crpg-col-pane crpg-sheet-col-feats-traits';

  const featHeading = document.createElement('div');
  featHeading.className = 'crpg-subbanner';
  featHeading.textContent = `FEATS (${dndData.feats.length})`;
  leftCol.appendChild(featHeading);

  const featsList = document.createElement('div');
  featsList.className = 'crpg-features-grid';

  for (const featId of dndData.feats) {
    const def = featRegistry[featId];
    let badge = 'FEAT';
    if (def) {
      const cat = classifyFeatCategory(def);
      if (cat.isMagic) badge = 'MAGIC';
      else if (cat.isFighterBonus || cat.isCombat) badge = 'COMBAT';
    }
    const chip = document.createElement('div');
    chip.className = 'crpg-feature-chip feat';
    chip.innerHTML = `
      <span class="crpg-feature-chip-icon">⭐</span>
      <span class="crpg-feature-chip-title">${def?.name ?? featId.replace(/_/g, ' ')}</span>
      <span class="crpg-feature-chip-badge">${badge}</span>
    `;
    if (def?.description) chip.title = def.description;
    featsList.appendChild(chip);
  }
  leftCol.appendChild(featsList);

  const traitHeading = document.createElement('div');
  traitHeading.className = 'crpg-subbanner';
  traitHeading.textContent = 'CLASS, DOMAIN & RACIAL TRAITS';
  leftCol.appendChild(traitHeading);

  const traitsList = document.createElement('div');
  traitsList.className = 'crpg-features-grid';

  for (const cfId of dndData.activeClassFeatures ?? []) {
    const chip = document.createElement('div');
    chip.className = 'crpg-feature-chip class_feature';
    chip.innerHTML = `
      <span class="crpg-feature-chip-icon">🛡️</span>
      <span class="crpg-feature-chip-title">${cfId.replace(/_/g, ' ')}</span>
      <span class="crpg-feature-chip-badge">CLASS</span>
    `;
    traitsList.appendChild(chip);
  }

  for (const domId of dndData.domains ?? []) {
    const chip = document.createElement('div');
    chip.className = 'crpg-feature-chip domain';
    chip.innerHTML = `
      <span class="crpg-feature-chip-icon">☀️</span>
      <span class="crpg-feature-chip-title">${domId.toUpperCase()} Domain</span>
      <span class="crpg-feature-chip-badge">DOMAIN</span>
    `;
    traitsList.appendChild(chip);
  }

  if (dndData.raceId) {
    const chip = document.createElement('div');
    chip.className = 'crpg-feature-chip class_feature';
    chip.innerHTML = `
      <span class="crpg-feature-chip-icon">⚥</span>
      <span class="crpg-feature-chip-title">${dndData.raceId.toUpperCase()} Heritage</span>
      <span class="crpg-feature-chip-badge">RACE</span>
    `;
    traitsList.appendChild(chip);
  }

  leftCol.appendChild(traitsList);
  tabWrap.appendChild(leftCol);

  // COLUMN 2: LEVEL PROGRESSION MATRIX
  const rightCol = document.createElement('div');
  rightCol.className = 'crpg-col-pane crpg-sheet-col-level-matrix';

  const matrixHeading = document.createElement('div');
  matrixHeading.className = 'crpg-subbanner';
  matrixHeading.textContent = 'LEVEL PROGRESSION';
  rightCol.appendChild(matrixHeading);

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'crpg-level-matrix-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'crpg-level-matrix-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Lvl</th><th>Class / HD</th><th>HP</th><th>Skills</th><th>Feats & Gained</th></tr>';
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const history = dndData.levelHistory ?? [];
  if (history.length > 0) {
    for (const entry of history) {
      const tr = document.createElement('tr');
      const skPts = Object.values(entry.addedSkillRanks ?? {}).reduce((a: number, b: number) => a + b, 0);
      const gains =
        [...entry.selectedFeats, ...entry.selectedAcfs].map((g) => g.replace(/_/g, ' ')).join(', ') || 'Base Chassis';
      tr.innerHTML = `
        <td>${entry.characterLevel}</td>
        <td>${entry.classId} ${entry.classLevel}</td>
        <td>+${entry.hpRolled}</td>
        <td>${skPts} pts</td>
        <td>${gains}</td>
      `;
      tbody.appendChild(tr);
    }
  } else {
    let runningLvl = 1;
    for (const trk of dndData.tracks) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${runningLvl}–${runningLvl + trk.levels - 1}</td>
        <td>${trk.trackId.toUpperCase()}</td>
        <td>d${trk.hitDieSides}</td>
        <td>${Object.keys(dndData.skillRanks).length} trn</td>
        <td>${(dndData.feats ?? []).join(', ') || 'Baseline'}</td>
      `;
      tbody.appendChild(tr);
      runningLvl += trk.levels;
    }
  }
  tbl.appendChild(tbody);
  matrixWrap.appendChild(tbl);
  rightCol.appendChild(matrixWrap);

  tabWrap.appendChild(rightCol);
  container.appendChild(tabWrap);
}
