/**
 * @file Reusable Tier 1 Console 3-Column Master Dossier UI Renderer (Milestone 118.1).
 * Consolidates Pen-and-Paper Character Sheet, Reactive Paper Doll, and 10x4 Stash into a single unified CRPG layout.
 */

import type { UICharacterSheetModel, UIInventoryModel } from '../../types/ui_adapter.types.ts';
import {
  type ConsoleInventoryCallbacks,
  renderCompactStashWidget,
  renderReactivePaperDollWidget
} from './console_inventory.ui.ts';

export interface ConsoleDossierExtraAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly onClick: () => void;
}

export interface ConsoleDossierCallbacks extends ConsoleInventoryCallbacks {
  readonly onClose?: () => void;
  readonly onUseSkill?: (skillId: string) => void;
  readonly extraActions?: ReadonlyArray<ConsoleDossierExtraAction>;
}

let skillsTrainedOnlyFilter = false;

function renderIdentityDefensesColumn(
  container: HTMLElement,
  sheet: UICharacterSheetModel,
  inv: UIInventoryModel,
  callbacks: ConsoleDossierCallbacks
): void {
  const col = document.createElement('div');
  col.className = 'crpg-dossier-col crpg-dossier-col-left';

  // 1. Portrait & Health Pill
  const portRow = document.createElement('div');
  portRow.className = 'crpg-portrait-health-row';
  const portrait = document.createElement('div');
  portrait.className = 'crpg-character-portrait';
  portrait.textContent = sheet.portraitUrl ? '' : '👤';
  if (sheet.portraitUrl) {
    portrait.style.backgroundImage = `url(${sheet.portraitUrl})`;
  }

  const hpPill = document.createElement('div');
  hpPill.className = 'crpg-hp-pill';
  hpPill.textContent = `♥ ${sheet.hpCurrent} / ${sheet.hpMax}`;
  portRow.append(portrait, hpPill);
  col.appendChild(portRow);

  // 2. Attributes Score Block
  const attrTable = document.createElement('div');
  attrTable.className = 'crpg-attributes-grid';
  for (const attr of sheet.attributes) {
    const row = document.createElement('div');
    row.className = 'crpg-attr-chip';
    const modSign = attr.modifier >= 0 ? `+${attr.modifier}` : `${attr.modifier}`;
    row.innerHTML = `<span class="attr-id">${attr.id.toUpperCase()}</span> <span class="attr-val">${attr.score}</span> <span class="attr-mod">${modSign}</span>`;
    attrTable.appendChild(row);
  }
  col.appendChild(attrTable);

  // 3. Reactive Anatomical Paper Doll (Console Tier 1 Widget)
  const pdWrap = document.createElement('div');
  pdWrap.className = 'crpg-dossier-paperdoll-section';
  renderReactivePaperDollWidget(pdWrap, inv, callbacks);
  col.appendChild(pdWrap);

  // 4. Armor Class & Saving Throws 6-Box Strip
  const defBox = document.createElement('div');
  defBox.className = 'crpg-defenses-strip';
  const fortSave = sheet.savingThrows.find((s) => s.id === 'fortitude')?.total ?? 0;
  const refSave = sheet.savingThrows.find((s) => s.id === 'reflex')?.total ?? 0;
  const willSave = sheet.savingThrows.find((s) => s.id === 'will')?.total ?? 0;

  const defStats: ReadonlyArray<{ label: string; value: string }> = [
    { label: 'AC', value: `${sheet.acTotal}` },
    { label: 'Touch', value: `${sheet.touchAc ?? sheet.acTotal}` },
    { label: 'Flat-Footed', value: `${sheet.flatFootedAc ?? sheet.acTotal}` },
    { label: 'Fortitude', value: fortSave >= 0 ? `+${fortSave}` : `${fortSave}` },
    { label: 'Reflex', value: refSave >= 0 ? `+${refSave}` : `${refSave}` },
    { label: 'Will', value: willSave >= 0 ? `+${willSave}` : `${willSave}` }
  ];

  for (const s of defStats) {
    const chip = document.createElement('div');
    chip.className = 'crpg-defense-box';
    chip.innerHTML = `<span class="def-label">${s.label}</span><span class="def-val">${s.value}</span>`;
    defBox.appendChild(chip);
  }
  col.appendChild(defBox);

  // 5. Combat Vitals Footer (Speed, BAB, Grapple, Init)
  const vitalsFooter = document.createElement('div');
  vitalsFooter.className = 'crpg-vitals-footer';
  const babSign = sheet.babTotal >= 0 ? `+${sheet.babTotal}` : `${sheet.babTotal}`;
  const initVal = sheet.initiativeBonus ?? 0;
  const initSign = initVal >= 0 ? `+${initVal}` : `${initVal}`;
  vitalsFooter.textContent = `Speed: ${sheet.speedFt ?? 30}ft • BAB: ${babSign} • Grapple: +${sheet.grappleBonus ?? sheet.babTotal} • Init: ${initSign}`;
  col.appendChild(vitalsFooter);

  container.appendChild(col);
}

function renderAttackLedgerColumn(container: HTMLElement, sheet: UICharacterSheetModel): void {
  const col = document.createElement('div');
  col.className = 'crpg-dossier-col crpg-dossier-col-center';

  // 1. Full-Attack & Natural Routine Ledger
  const attackSec = document.createElement('div');
  attackSec.className = 'crpg-dossier-section';
  const atkTitle = document.createElement('h3');
  atkTitle.className = 'crpg-section-title';
  atkTitle.textContent = 'Attack Routines & Maneuvers';
  attackSec.appendChild(atkTitle);

  if (sheet.attackGroups && sheet.attackGroups.length > 0) {
    const list = document.createElement('div');
    list.className = 'crpg-attack-routine-list';
    for (const group of sheet.attackGroups) {
      const card = document.createElement('div');
      card.className = `crpg-attack-routine-card ${group.category}`;
      const head = document.createElement('div');
      head.className = 'routine-header';
      head.innerHTML = `<strong>${group.label}</strong> <span class="routine-tag">${group.subtitle}</span>`;
      const body = document.createElement('div');
      body.className = 'routine-body';
      body.innerHTML = `<span class="atk-bonus">${group.attackBonuses}</span> • <span class="atk-dmg">${group.damageFormula}</span> (${group.criticalProfile})`;
      card.append(head, body);
      if (group.riderNotes) {
        const riders = document.createElement('div');
        riders.className = 'routine-riders';
        riders.textContent = group.riderNotes;
        card.appendChild(riders);
      }
      list.appendChild(card);
    }
    attackSec.appendChild(list);
  } else if (sheet.combatSummary.length > 0) {
    const list = document.createElement('div');
    list.className = 'crpg-attack-routine-list';
    for (const item of sheet.combatSummary) {
      const card = document.createElement('div');
      card.className = 'crpg-attack-routine-card manufactured';
      card.innerHTML = `<div class="routine-header"><strong>${item.title}</strong></div>
        <div class="routine-body"><span class="atk-bonus">${item.attackBonus}</span> • <span class="atk-dmg">${item.damage}</span> (${item.critRange})</div>`;
      list.appendChild(card);
    }
    attackSec.appendChild(list);
  }
  col.appendChild(attackSec);

  // 2. Feats, Domains & Active Buffs Chip Grid
  const featsSec = document.createElement('div');
  featsSec.className = 'crpg-dossier-section';
  const featsTitle = document.createElement('h3');
  featsTitle.className = 'crpg-section-title';
  featsTitle.textContent = 'Feats, Traits & Conditions';
  featsSec.appendChild(featsTitle);

  const chipsGrid = document.createElement('div');
  chipsGrid.className = 'crpg-features-grid';
  if (sheet.featureEntries && sheet.featureEntries.length > 0) {
    for (const f of sheet.featureEntries) {
      const chip = document.createElement('div');
      chip.className = `crpg-feature-badge cat-${f.category}`;
      chip.title = f.description ?? f.name;
      const icon =
        f.category === 'feat' ? '⭐' : f.category === 'domain' ? '☀️' : f.category === 'condition' ? '⚠️' : '🛡️';
      chip.textContent = `${icon} ${f.name}`;
      chipsGrid.appendChild(chip);
    }
  } else {
    for (const ft of sheet.feats) {
      const chip = document.createElement('div');
      chip.className = 'crpg-feature-badge cat-feat';
      chip.title = ft.description;
      chip.textContent = `⭐ ${ft.name}`;
      chipsGrid.appendChild(chip);
    }
  }
  featsSec.appendChild(chipsGrid);
  col.appendChild(featsSec);

  // 3. Horizon 1 Level-by-Level Matrix
  if (sheet.levelHistory && sheet.levelHistory.length > 0) {
    const histSec = document.createElement('div');
    histSec.className = 'crpg-dossier-section';
    const histTitle = document.createElement('h3');
    histTitle.className = 'crpg-section-title';
    histTitle.textContent = 'Progression History';
    histSec.appendChild(histTitle);

    const tbl = document.createElement('table');
    tbl.className = 'crpg-level-matrix-table';
    tbl.innerHTML = `<thead><tr><th>Lv</th><th>Track</th><th>HP</th><th>Skills</th><th>Grants</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const row of sheet.levelHistory) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${row.level}</td><td>${row.classAndLevel}</td><td>d${row.hitDieRoll}</td><td>${row.skillPointsSpent}</td><td>${row.featsAndFeatures || '—'}</td>`;
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    histSec.appendChild(tbl);
    col.appendChild(histSec);
  }

  container.appendChild(col);
}

function renderSkillsStashColumn(
  container: HTMLElement,
  sheet: UICharacterSheetModel,
  inv: UIInventoryModel,
  callbacks: ConsoleDossierCallbacks
): void {
  const col = document.createElement('div');
  col.className = 'crpg-dossier-col crpg-dossier-col-right';

  // 1. Pen & Paper Skills Table
  const skillSec = document.createElement('div');
  skillSec.className = 'crpg-dossier-section';
  const skillHeader = document.createElement('div');
  skillHeader.className = 'crpg-section-header-split';
  const skTitle = document.createElement('h3');
  skTitle.className = 'crpg-section-title';
  skTitle.textContent = 'Skills';
  const filterBtn = document.createElement('button');
  filterBtn.type = 'button';
  filterBtn.className = skillsTrainedOnlyFilter ? 'crpg-filter-btn active' : 'crpg-filter-btn';
  filterBtn.textContent = skillsTrainedOnlyFilter ? 'Trained Only' : 'All Skills';
  filterBtn.addEventListener('click', () => {
    skillsTrainedOnlyFilter = !skillsTrainedOnlyFilter;
    filterBtn.className = skillsTrainedOnlyFilter ? 'crpg-filter-btn active' : 'crpg-filter-btn';
    filterBtn.textContent = skillsTrainedOnlyFilter ? 'Trained Only' : 'All Skills';
    populateSkillsList();
  });
  skillHeader.append(skTitle, filterBtn);
  skillSec.appendChild(skillHeader);

  const skillsList = document.createElement('div');
  skillsList.className = 'crpg-skills-list-pane';

  function populateSkillsList(): void {
    skillsList.replaceChildren();
    const rows = sheet.skillRows ?? [];
    const displayList = rows.filter((r) => (skillsTrainedOnlyFilter ? r.ranks > 0 : true));
    for (const s of displayList) {
      const row = document.createElement('div');
      row.className = `crpg-skill-row${s.isClassSkill ? ' class-skill' : ''}`;
      const sign = s.totalModifier >= 0 ? `+${s.totalModifier}` : `${s.totalModifier}`;
      const marker = s.isClassSkill ? '■' : '□';
      row.innerHTML = `<span class="sk-marker">${marker}</span> <span class="sk-name">${s.name} (${s.keyAbility.toUpperCase()})</span> <strong class="sk-total">${sign}</strong> <span class="sk-ranks">${s.ranks} rk</span>`;
      if (s.isUsableActive) {
        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'crpg-skill-use-btn';
        useBtn.textContent = 'Use';
        useBtn.addEventListener('click', () => callbacks.onUseSkill?.(s.id));
        row.appendChild(useBtn);
      }
      skillsList.appendChild(row);
    }
  }

  populateSkillsList();
  skillSec.appendChild(skillsList);
  col.appendChild(skillSec);

  // 2. Compact 10x4 Backpack & Stash Grid (Console Tier 1 Widget)
  const stashSec = document.createElement('div');
  stashSec.className = 'crpg-dossier-section';
  renderCompactStashWidget(stashSec, inv, callbacks);
  col.appendChild(stashSec);

  container.appendChild(col);
}

/**
 * Renders the full 3-Column CRPG Master Dossier into the specified container.
 *
 * @param container Target modal overlay container.
 * @param sheet Character Sheet data model.
 * @param inv Inventory and Anatomical Slots data model.
 * @param callbacks Event handling callbacks.
 */
export function renderConsoleMasterDossier(
  container: HTMLElement,
  sheet: UICharacterSheetModel,
  inv: UIInventoryModel,
  callbacks: ConsoleDossierCallbacks
): void {
  container.replaceChildren();

  const root = document.createElement('div');
  root.className = 'crpg-dossier-shell';

  // Top Identity Bar & Header
  const header = document.createElement('div');
  header.className = 'crpg-dossier-topbar';

  const leftInfo = document.createElement('div');
  leftInfo.className = 'crpg-dossier-identity';
  const nameEl = document.createElement('h2');
  nameEl.className = 'crpg-char-name';
  nameEl.textContent = sheet.name;
  const subEl = document.createElement('div');
  subEl.className = 'crpg-char-sub';
  subEl.textContent = `${sheet.raceName} • ${sheet.levelSummary}${sheet.alignmentName ? ` • ${sheet.alignmentName}` : ''}`;
  leftInfo.append(nameEl, subEl);
  header.appendChild(leftInfo);

  if (sheet.xpCurrent !== undefined && sheet.xpNextLevel !== undefined) {
    const xpBox = document.createElement('div');
    xpBox.className = 'crpg-xp-block';
    const xpLabel = document.createElement('span');
    xpLabel.textContent = `${sheet.xpCurrent.toLocaleString()} / ${sheet.xpNextLevel.toLocaleString()} XP`;
    const xpBar = document.createElement('div');
    xpBar.className = 'crpg-xp-bar';
    const pct = Math.min(100, Math.round((sheet.xpCurrent / sheet.xpNextLevel) * 100));
    const fill = document.createElement('div');
    fill.className = 'crpg-xp-fill';
    fill.style.width = `${pct}%`;
    xpBar.appendChild(fill);
    xpBox.append(xpLabel, xpBar);
    header.appendChild(xpBox);
  }

  const actionsBox = document.createElement('div');
  actionsBox.className = 'crpg-dossier-actions';
  for (const extra of callbacks.extraActions ?? []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'modal-btn crpg-header-action-btn';
    b.textContent = extra.label;
    b.addEventListener('click', extra.onClick);
    actionsBox.appendChild(b);
  }
  if (callbacks.onClose) {
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'modal-btn crpg-close-btn';
    closeBtn.textContent = '✕ Close';
    closeBtn.addEventListener('click', callbacks.onClose);
    actionsBox.appendChild(closeBtn);
  }
  header.appendChild(actionsBox);
  root.appendChild(header);

  // 3-Column Master Grid
  const grid = document.createElement('div');
  grid.className = 'crpg-dossier-grid';
  renderIdentityDefensesColumn(grid, sheet, inv, callbacks);
  renderAttackLedgerColumn(grid, sheet);
  renderSkillsStashColumn(grid, sheet, inv, callbacks);
  root.appendChild(grid);

  container.appendChild(root);
}
