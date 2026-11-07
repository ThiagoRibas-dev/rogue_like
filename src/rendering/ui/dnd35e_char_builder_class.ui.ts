import {
  type CharacterCreationDraft,
  type DnD35Alignment,
  getDnD35SystemContent,
  resolveClassSpellAcquisitionMode
} from '../../rulesets/registry.ts';
import type { GameState } from '../../types/game-state.types.ts';
import {
  renderClericOptions,
  renderDruidOptions,
  renderFamiliarOptions,
  renderRangerOptions,
  renderWizardOptions
} from './dnd35e_char_builder_class_options.ui.ts';

const ALL_ALIGNMENTS: ReadonlyArray<DnD35Alignment> = ['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE'];

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
  npcBtn.style.borderColor = showNpcClasses ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
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
    metaSpan.style.color = 'var(--crpg-text-dim, #9da7b3)';
    metaSpan.textContent = `d${cls.hitDieSides} HD • BAB +${row1.bab} • ${cls.skillPointsPerLevel}+INT Skills`;
    row.appendChild(nameSpan);
    row.appendChild(metaSpan);
    leftPane.appendChild(row);
  }

  const activeCls = sys.classes[draftState.classId];
  if (activeCls) {
    const title = document.createElement('h3');
    title.style.margin = '0 0 4px 0';
    title.style.color = 'var(--crpg-gold, #f1c40f)';
    title.textContent = `${activeCls.name} (d${activeCls.hitDieSides} Hit Die)`;
    rightPane.appendChild(title);

    const tablePreview = document.createElement('div');
    tablePreview.style.fontSize = '0.78rem';
    tablePreview.style.padding = '8px';
    tablePreview.style.background = 'var(--crpg-bg-card, rgba(235, 227, 212, 0.96))';
    tablePreview.style.color = 'var(--crpg-text-main, #261d14)';
    tablePreview.style.border = '1px solid var(--crpg-border-inner, #a69478)';
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
      prayerBanner.style.color = 'var(--crpg-success, #2ecc71)';
      prayerBanner.style.background = 'rgba(46, 204, 113, 0.1)';
      prayerBanner.style.border = '1px solid var(--crpg-success, #2ecc71)';
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
      aBtn.style.borderColor = draftState.alignment === align ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
      aBtn.textContent = align;
      aBtn.addEventListener('click', () => {
        updateDraft({ ...draftState, alignment: align });
      });
      alignRow.appendChild(aBtn);
    }
    rightPane.appendChild(alignRow);

    const activeFeatures = Object.keys(activeCls.featureDetails).filter((fId) => {
      const row = activeCls.progression[0];
      const hasBase = row?.features.includes(fId) ?? false;
      const swapReplaced = activeCls.acfSwaps.some(
        (s) => s.level === 1 && draftState.selectedAcfs.includes(s.acfId) && s.replacesFeature === fId
      );
      const swapGranted = activeCls.acfSwaps.some(
        (s) => s.level === 1 && draftState.selectedAcfs.includes(s.acfId) && s.grantedFeature === fId
      );
      return (hasBase && !swapReplaced) || swapGranted;
    });

    for (const acf of activeCls.acfSwaps.filter((a) => a.level === 1)) {
      const isChecked = draftState.selectedAcfs.includes(acf.acfId);
      const acfBtn = document.createElement('button');
      acfBtn.type = 'button';
      acfBtn.className = 'modal-btn';
      acfBtn.style.fontSize = '0.78rem';
      acfBtn.style.borderColor = isChecked ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
      acfBtn.textContent = `${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`;
      acfBtn.addEventListener('click', () => {
        const nextAcfs = isChecked
          ? draftState.selectedAcfs.filter((id) => id !== acf.acfId)
          : [...draftState.selectedAcfs, acf.acfId];
        const nextDraft: CharacterCreationDraft = {
          ...draftState,
          selectedAcfs: nextAcfs,
          ...(acf.replacesFeature === 'summon_familiar' ? { familiarId: undefined } : {}),
          ...(acf.replacesFeature === 'animal_companion' ? { animalCompanionId: undefined } : {})
        };
        updateDraft(nextDraft);
      });
      rightPane.appendChild(acfBtn);
    }

    const hasClericDomains = activeFeatures.includes('cleric_domains') || activeFeatures.includes('deity_domains');
    if (hasClericDomains) {
      renderClericOptions(rightPane, sys, draftState, updateDraft);
    }

    if (activeFeatures.includes('arcane_school_specialization')) {
      renderWizardOptions(rightPane, sys, draftState, updateDraft);
    } else {
      const grantsFamiliar = activeFeatures.some(
        (fId) => activeCls.featureDetails[fId]?.scalingPoolContribution?.poolId === 'familiar_master_effective_level'
      );
      if (grantsFamiliar) {
        renderFamiliarOptions(rightPane, sys, draftState, updateDraft);
      }
    }

    const grantsAnimalCompanion = activeFeatures.some(
      (fId) =>
        activeCls.featureDetails[fId]?.scalingPoolContribution?.poolId === 'animal_companion_effective_level' &&
        (activeCls.featureDetails[fId]?.scalingPoolContribution?.minClassLevel ?? 1) <= 1
    );
    if (grantsAnimalCompanion) {
      renderDruidOptions(rightPane, sys, draftState, updateDraft);
    }

    const grantsFavoredEnemy = activeFeatures.some((fId) => fId.startsWith('favored_enemy_'));
    if (grantsFavoredEnemy) {
      renderRangerOptions(rightPane, sys, draftState, updateDraft);
    }
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
