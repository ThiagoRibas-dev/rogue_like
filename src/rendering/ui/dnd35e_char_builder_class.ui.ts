import {
  type CharacterCreationDraft,
  type DnD35Alignment,
  type DnD35SpellSchool,
  getDnD35SystemContent,
  resolveClassSpellAcquisitionMode,
  validateSpecialistSchoolSelection
} from '../../rulesets/registry.ts';
import type { GameState } from '../../types/game-state.types.ts';

const SPELL_SCHOOLS: ReadonlyArray<DnD35SpellSchool> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
  'universal'
];
const ALL_ALIGNMENTS: ReadonlyArray<DnD35Alignment> = ['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE'];
const FAVORED_ENEMY_TYPES: ReadonlyArray<string> = [
  'undead',
  'goblinoid',
  'orc',
  'giant',
  'dragon',
  'magical_beast',
  'outsider',
  'aberration',
  'construct'
];

/**
 * Renders Step 2 (Class & Path Selection) of the D&D 3.5e Character Creation Wizard.
 */
export function renderClassStep(
  container: HTMLElement,
  state: GameState,
  draftState: CharacterCreationDraft,
  showNpcClasses: boolean,
  onToggleNpcClasses: () => void,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-class-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-class-right';

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const lbl = document.createElement('span');
  lbl.style.fontSize = '0.78rem';
  lbl.textContent = showNpcClasses ? 'Base & NPC Classes' : 'Core Base Classes (11)';
  const npcBtn = document.createElement('button');
  npcBtn.type = 'button';
  npcBtn.className = 'modal-btn';
  npcBtn.style.padding = '3px 8px';
  npcBtn.style.fontSize = '0.72rem';
  npcBtn.style.borderColor = showNpcClasses ? '#f1c40f' : 'var(--border-color)';
  npcBtn.textContent = showNpcClasses ? 'Hide NPC Classes' : 'Show NPC Classes';
  npcBtn.addEventListener('click', () => {
    onToggleNpcClasses();
  });
  filterBar.appendChild(lbl);
  filterBar.appendChild(npcBtn);
  leftPane.appendChild(filterBar);

  const classes = Object.values(sys.classes).filter((c) => !c.isPrestige && (showNpcClasses || !c.isNpcClass));
  for (const cls of classes) {
    const row1 = cls.progression[0] ?? { bab: 0, fortSave: 0, refSave: 0, willSave: 0 };
    const isSelected = draftState.classId === cls.id;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({
        ...draftState,
        classId: cls.id,
        selectedAcfs: [],
        domains: [],
        prohibitedSchools: []
      });
    });

    const nameSpan = document.createElement('strong');
    nameSpan.textContent = cls.name;
    const metaSpan = document.createElement('span');
    metaSpan.style.fontSize = '0.75rem';
    metaSpan.style.color = '#9da7b3';
    metaSpan.textContent = `d${cls.hitDieSides} HD • BAB +${row1.bab} • ${cls.skillPointsPerLevel}+INT Skills`;
    row.appendChild(nameSpan);
    row.appendChild(metaSpan);
    leftPane.appendChild(row);
  }

  const activeCls = sys.classes[draftState.classId];
  if (activeCls) {
    const title = document.createElement('h3');
    title.style.margin = '0 0 4px 0';
    title.style.color = '#f1c40f';
    title.textContent = `${activeCls.name} (d${activeCls.hitDieSides} Hit Die)`;
    rightPane.appendChild(title);

    const tablePreview = document.createElement('div');
    tablePreview.style.fontSize = '0.78rem';
    tablePreview.style.padding = '8px';
    tablePreview.style.background = 'rgba(0,0,0,0.35)';
    tablePreview.style.border = '1px solid #333947';
    for (const row of activeCls.progression.slice(0, 5)) {
      const rDiv = document.createElement('div');
      const featsStr = row.features.length > 0 ? ` [${row.features.join(', ')}]` : '';
      rDiv.textContent = `Lv ${row.level}: BAB +${row.bab} | Fort +${row.fortSave}, Ref +${row.refSave}, Will +${row.willSave}${featsStr}`;
      tablePreview.appendChild(rDiv);
    }
    rightPane.appendChild(tablePreview);

    if (resolveClassSpellAcquisitionMode(activeCls) === 'prayerbook_full_list') {
      const prayerBanner = document.createElement('div');
      prayerBanner.style.fontSize = '0.78rem';
      prayerBanner.style.padding = '6px 8px';
      prayerBanner.style.color = '#2ecc71';
      prayerBanner.style.background = 'rgba(46, 204, 113, 0.1)';
      prayerBanner.style.border = '1px solid #2ecc71';
      prayerBanner.textContent = ` Divine Prayerbook Rule: ${activeCls.name} automatically knows the full ${activeCls.name} spell list (plus domain spells) for all castable levels; no manual spell learning step required.`;
      rightPane.appendChild(prayerBanner);
    }

    const alignRow = document.createElement('div');
    alignRow.style.display = 'flex';
    alignRow.style.flexWrap = 'wrap';
    alignRow.style.alignItems = 'center';
    alignRow.style.gap = '4px';
    const alignTitle = document.createElement('strong');
    alignTitle.textContent = 'Alignment: ';
    alignRow.appendChild(alignTitle);
    const allowed = activeCls.allowedAlignments ?? ALL_ALIGNMENTS;
    for (const align of allowed) {
      const aBtn = document.createElement('button');
      aBtn.type = 'button';
      aBtn.className = 'modal-btn';
      aBtn.style.padding = '4px 8px';
      aBtn.style.fontSize = '0.75rem';
      aBtn.style.borderColor = draftState.alignment === align ? '#f1c40f' : 'var(--border-color)';
      aBtn.textContent = align;
      aBtn.addEventListener('click', () => {
        updateDraft({ ...draftState, alignment: align });
      });
      alignRow.appendChild(aBtn);
    }
    rightPane.appendChild(alignRow);

    for (const acf of activeCls.acfSwaps.filter((a) => a.level === 1)) {
      const isChecked = draftState.selectedAcfs.includes(acf.acfId);
      const acfBtn = document.createElement('button');
      acfBtn.type = 'button';
      acfBtn.className = 'modal-btn';
      acfBtn.style.fontSize = '0.78rem';
      acfBtn.style.borderColor = isChecked ? '#2ecc71' : 'var(--border-color)';
      acfBtn.textContent = `${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`;
      acfBtn.addEventListener('click', () => {
        const nextAcfs = isChecked
          ? draftState.selectedAcfs.filter((id) => id !== acf.acfId)
          : [...draftState.selectedAcfs, acf.acfId];
        updateDraft({ ...draftState, selectedAcfs: nextAcfs });
      });
      rightPane.appendChild(acfBtn);
    }

    if (draftState.classId === 'cleric') {
      const domHeader = document.createElement('strong');
      domHeader.style.color = '#f1c40f';
      domHeader.textContent = `Cleric Domains (${draftState.domains.length} / 2 selected):`;
      rightPane.appendChild(domHeader);
      for (const dom of Object.values(sys.domains)) {
        const chosen = draftState.domains.includes(dom.id);
        const dRow = document.createElement('div');
        dRow.className = `dnd35-list-item${chosen ? ' selected' : ''}`;
        dRow.textContent = `${chosen ? '☑' : '☐'} ${dom.name} — ${dom.grantedPowerDescription}`;
        dRow.addEventListener('click', () => {
          const nextDomains = chosen
            ? draftState.domains.filter((d) => d !== dom.id)
            : draftState.domains.length < 2
              ? [...draftState.domains, dom.id]
              : draftState.domains;
          updateDraft({ ...draftState, domains: nextDomains });
        });
        rightPane.appendChild(dRow);
      }
    }

    if (draftState.classId === 'wizard') {
      const activeSchool = draftState.arcaneSchool ?? 'universal';
      const specCheck = validateSpecialistSchoolSelection(activeSchool, draftState.prohibitedSchools);
      const specTitle = document.createElement('strong');
      specTitle.style.color = specCheck.valid ? '#2ecc71' : '#e67e22';
      specTitle.textContent = `Arcane School (${specCheck.valid ? 'Valid' : (specCheck.reason ?? 'Select prohibited schools')}):`;
      rightPane.appendChild(specTitle);

      const schoolWrap = document.createElement('div');
      schoolWrap.style.display = 'flex';
      schoolWrap.style.flexWrap = 'wrap';
      schoolWrap.style.gap = '4px';
      for (const school of SPELL_SCHOOLS) {
        const sBtn = document.createElement('button');
        sBtn.type = 'button';
        sBtn.className = 'modal-btn';
        sBtn.style.padding = '4px 8px';
        sBtn.style.fontSize = '0.74rem';
        sBtn.style.borderColor = activeSchool === school ? '#f1c40f' : 'var(--border-color)';
        sBtn.textContent = school;
        sBtn.addEventListener('click', () => {
          updateDraft({ ...draftState, arcaneSchool: school, prohibitedSchools: [] });
        });
        schoolWrap.appendChild(sBtn);
      }
      rightPane.appendChild(schoolWrap);

      if (activeSchool !== 'universal') {
        const reqCount = activeSchool === 'divination' ? 1 : 2;
        const prohibLabel = document.createElement('strong');
        prohibLabel.textContent = `Prohibited Schools (${draftState.prohibitedSchools.length} / ${reqCount}):`;
        rightPane.appendChild(prohibLabel);

        const prohibWrap = document.createElement('div');
        prohibWrap.style.display = 'flex';
        prohibWrap.style.flexWrap = 'wrap';
        prohibWrap.style.gap = '4px';
        for (const pSchool of SPELL_SCHOOLS) {
          if (pSchool === 'universal' || pSchool === 'divination' || pSchool === activeSchool) continue;
          const isProhib = draftState.prohibitedSchools.includes(pSchool);
          const pBtn = document.createElement('button');
          pBtn.type = 'button';
          pBtn.className = 'modal-btn';
          pBtn.style.padding = '4px 8px';
          pBtn.style.fontSize = '0.74rem';
          pBtn.style.borderColor = isProhib ? '#e74c3c' : 'var(--border-color)';
          pBtn.textContent = `${isProhib ? '✖ ' : ''}${pSchool}`;
          pBtn.addEventListener('click', () => {
            const nextProhib = isProhib
              ? draftState.prohibitedSchools.filter((s) => s !== pSchool)
              : draftState.prohibitedSchools.length < reqCount
                ? [...draftState.prohibitedSchools, pSchool]
                : draftState.prohibitedSchools;
            updateDraft({ ...draftState, prohibitedSchools: nextProhib });
          });
          prohibWrap.appendChild(pBtn);
        }
        rightPane.appendChild(prohibWrap);
      }
    }

    if (draftState.classId === 'ranger') {
      const feLabel = document.createElement('strong');
      feLabel.textContent = '1st Favored Enemy (+2 Bonus):';
      rightPane.appendChild(feLabel);
      const feWrap = document.createElement('div');
      feWrap.style.display = 'flex';
      feWrap.style.flexWrap = 'wrap';
      feWrap.style.gap = '4px';
      const curFe = draftState.favoredEnemyType ?? 'undead';
      for (const feType of FAVORED_ENEMY_TYPES) {
        const feBtn = document.createElement('button');
        feBtn.type = 'button';
        feBtn.className = 'modal-btn';
        feBtn.style.padding = '4px 8px';
        feBtn.style.fontSize = '0.74rem';
        feBtn.style.borderColor = curFe === feType ? '#f1c40f' : 'var(--border-color)';
        feBtn.textContent = feType;
        feBtn.addEventListener('click', () => {
          updateDraft({ ...draftState, favoredEnemyType: feType });
        });
        feWrap.appendChild(feBtn);
      }
      rightPane.appendChild(feWrap);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
