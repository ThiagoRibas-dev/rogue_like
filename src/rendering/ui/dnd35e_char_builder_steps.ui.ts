/**
 * @file Shared Step Renderers (Skills, Feats, Per-Class Spells, Equipment) for D&D 3.5e Character Creation & Level-Up (Milestone 112.9).
 * Full-screen 2-pane layout with multiclass rank-cap vs. rank-cost separation, filter chips, per-class spellbooks, and live right-pane inspector.
 */

import {
  type CharacterCreationDraft,
  resolveClassSpellAcquisitionMode,
  STARTING_EQUIPMENT_PACKAGES
} from '../../rulesets/dnd35e/character_builder.ts';
import type { DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';

export * from './dnd35e_char_builder_feats.ui.ts';
export * from './dnd35e_char_builder_skills.ui.ts';
export * from './dnd35e_char_builder_spells.ui.ts';

/**
 * Renders Step 7 (Starting Equipment Kit Selection & Final Character Sheet Preview) in a 2-pane layout.
 */
export function renderCharBuilderEquipmentStep(
  container: HTMLElement,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void,
  sys?: DnD35SystemContent
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-equip-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-equip-right';

  for (const pkg of STARTING_EQUIPMENT_PACKAGES) {
    const selected = draft.equipmentPackageId === pkg.id;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${selected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({ ...draft, equipmentPackageId: pkg.id });
    });
    const info = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = pkg.name;
    const desc = document.createElement('div');
    desc.style.fontSize = '0.78rem';
    desc.style.color = 'var(--crpg-text-dim, #9da7b3)';
    desc.textContent = pkg.description;
    info.appendChild(title);
    info.appendChild(desc);
    row.appendChild(info);
    leftPane.appendChild(row);
  }

  const activePkg =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
  const summaryTitle = document.createElement('h3');
  summaryTitle.style.margin = '0 0 6px 0';
  summaryTitle.style.color = 'var(--crpg-gold, #f1c40f)';
  summaryTitle.textContent = `Character Summary & ${activePkg.name}`;
  rightPane.appendChild(summaryTitle);

  const cls = sys?.classes[draft.classId];
  const spellMode = cls ? resolveClassSpellAcquisitionMode(cls) : 'none';
  const spellSummaryLine =
    spellMode === 'prayerbook_full_list'
      ? `Spellcasting: Divine Prayerbook (Full ${cls?.name ?? draft.classId} spell list & domain access)`
      : `Known Spells (${draft.knownSpells.length}): ${draft.knownSpells.join(', ') || 'None'}`;

  const lines = [
    `Race: ${draft.raceId.toUpperCase()} | Class: ${draft.classId.toUpperCase()} (Lv 1) | Alignment: ${draft.alignment}`,
    `Weapon: ${activePkg.weaponDice} ${activePkg.weaponDamageType} | Armor: +${activePkg.armorBonus} | Shield: +${activePkg.shieldBonus}`,
    `Feats (${draft.selectedFeats.length}): ${draft.selectedFeats.join(', ') || 'None'}`,
    `Skills Invested (${Object.keys(draft.skillRanks).length}): ${
      Object.entries(draft.skillRanks)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ') || 'None'
    }`,
    spellSummaryLine
  ];
  for (const text of lines) {
    const p = document.createElement('div');
    p.style.fontSize = '0.84rem';
    p.style.padding = '4px 0';
    p.style.borderBottom = '1px solid var(--crpg-border-subtle, #282e3b)';
    p.textContent = text;
    rightPane.appendChild(p);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}
