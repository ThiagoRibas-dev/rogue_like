/**
 * @file Shared D&D 3.5e Right-Pane Inspector Renderer (Milestone 112.5).
 * Reusable across Character Creation and Level-Up modals. Built with pure DOM manipulation.
 */

import {
  ALL_ABILITY_IDS,
  computeSkillSynergyBonus,
  type DnD35RaceDefinition,
  type DnD35SkillDefinition,
  type DnD35SystemContent,
  getSkillsGrantedSynergyBy,
  SYNERGY_RANK_THRESHOLD
} from '../../rulesets/registry.ts';
import { createInspectorBadge, createInspectorSectionTitle } from './dnd35e_feat_spell_inspector.ui.ts';

export * from './dnd35e_feat_spell_inspector.ui.ts';

/**
 * Renders the detailed right-pane inspector for a D&D 3.5e Race definition.
 */
export function renderRaceInspector(pane: HTMLElement, race: DnD35RaceDefinition): void {
  pane.replaceChildren();

  const title = document.createElement('h3');
  title.style.margin = '0 0 4px 0';
  title.style.color = '#f1c40f';
  title.textContent = race.name;
  pane.appendChild(title);

  const badgeRow = document.createElement('div');
  badgeRow.style.display = 'flex';
  badgeRow.style.flexWrap = 'wrap';
  badgeRow.style.gap = '6px';
  badgeRow.appendChild(createInspectorBadge(`Size: ${race.size.toUpperCase()}`));
  badgeRow.appendChild(createInspectorBadge(`Type: ${race.creatureType}`));
  if (race.subtypes.length > 0) {
    badgeRow.appendChild(createInspectorBadge(`Subtypes: ${race.subtypes.join(', ')}`));
  }
  badgeRow.appendChild(createInspectorBadge(`Speed: ${race.baseLandSpeedFt} ft`));
  badgeRow.appendChild(createInspectorBadge(`Favored Class: ${race.favoredClass}`));
  if (race.levelAdjustment > 0) {
    badgeRow.appendChild(createInspectorBadge(`LA +${race.levelAdjustment}`, '#e67e22'));
  }
  if ((race.rhdProgression?.baseHdCount ?? 0) > 0) {
    badgeRow.appendChild(createInspectorBadge(`Racial HD: ${race.rhdProgression.baseHdCount}`, '#e67e22'));
  }
  pane.appendChild(badgeRow);

  pane.appendChild(createInspectorSectionTitle('Ability Score Adjustments'));
  const abGrid = document.createElement('div');
  abGrid.style.display = 'flex';
  abGrid.style.flexWrap = 'wrap';
  abGrid.style.gap = '6px';
  for (const ab of ALL_ABILITY_IDS) {
    const adj = race.abilityAdjustments[ab] ?? 0;
    const sign = adj > 0 ? `+${adj}` : `${adj}`;
    const col = adj > 0 ? '#2ecc71' : adj < 0 ? '#e74c3c' : '#8b949e';
    abGrid.appendChild(createInspectorBadge(`${ab.toUpperCase()}: ${sign}`, col));
  }
  pane.appendChild(abGrid);

  pane.appendChild(createInspectorSectionTitle('Senses & Racial Qualities'));
  const traitsList = document.createElement('div');
  traitsList.style.display = 'flex';
  traitsList.style.flexDirection = 'column';
  traitsList.style.gap = '4px';
  traitsList.style.fontSize = '0.83rem';

  const addTraitLine = (label: string): void => {
    const line = document.createElement('div');
    line.textContent = `• ${label}`;
    traitsList.appendChild(line);
  };

  if (race.darkvisionFt && race.darkvisionFt > 0) addTraitLine(`Darkvision ${race.darkvisionFt} ft.`);
  if (race.lowLightVision) addTraitLine('Low-Light Vision (see twice as far in shadowy illumination).');
  if (race.bonusFeatAtFirstLevel) addTraitLine('Bonus Feat: 1 extra general feat at 1st character level.');
  if (race.extraSkillPointsFirstLevel > 0) {
    addTraitLine(
      `Extra Skill Points: +${race.extraSkillPointsFirstLevel} at 1st level, +${race.extraSkillPointsPerLevel} per level thereafter.`
    );
  }
  if (race.unencumberedSpeedInHeavyArmor) {
    addTraitLine('Steady Stride: Base speed is never reduced by medium/heavy armor or medium/heavy load.');
  }
  if ((race.naturalArmorBonus ?? 0) > 0) {
    addTraitLine(`Natural Armor: +${race.naturalArmorBonus} natural armor bonus to AC.`);
  }
  for (const bundle of race.traitBundles) {
    addTraitLine(`${bundle.name}: ${bundle.description ?? 'Racial trait effect.'}`);
  }
  for (const mod of race.conditionalModifiers) {
    const sign = mod.value >= 0 ? `+${mod.value}` : `${mod.value}`;
    addTraitLine(`${mod.id}: ${sign} ${mod.type} bonus to ${mod.target}`);
  }
  addTraitLine(`Automatic Languages: ${race.automaticLanguages.join(', ')}`);
  pane.appendChild(traitsList);
}

/**
 * Renders the detailed right-pane inspector for a D&D 3.5e Skill definition, including
 * live breakdown of Invested Ranks vs. Ability Mod vs. Synergy vs. Racial/Feat Bonus.
 */
export function renderSkillInspector(
  pane: HTMLElement,
  skill: DnD35SkillDefinition,
  currentRanks: number,
  allRanks: Readonly<Record<string, number>>,
  abilityMod: number,
  miscBonus: number,
  isClassSkill: boolean,
  maxRanks: number,
  sys: DnD35SystemContent
): void {
  pane.replaceChildren();

  const title = document.createElement('h3');
  title.style.margin = '0 0 4px 0';
  title.style.color = '#f1c40f';
  title.textContent = `${skill.name} (${skill.keyAbility.toUpperCase()})`;
  pane.appendChild(title);

  const metaRow = document.createElement('div');
  metaRow.style.display = 'flex';
  metaRow.style.flexWrap = 'wrap';
  metaRow.style.gap = '6px';
  metaRow.appendChild(
    createInspectorBadge(
      isClassSkill ? 'Class Skill (1 pt/rank)' : 'Cross-Class (2 pts/rank)',
      isClassSkill ? '#2ecc71' : '#f39c12'
    )
  );
  metaRow.appendChild(
    createInspectorBadge(
      skill.trainedOnly ? 'Trained Only' : 'Usable Untrained',
      skill.trainedOnly ? '#e67e22' : '#58a6ff'
    )
  );
  if (skill.acpMultiplier > 0) {
    metaRow.appendChild(createInspectorBadge(`Armor Check Penalty: ${skill.acpMultiplier}x`, '#e74c3c'));
  }
  metaRow.appendChild(createInspectorBadge(`Take 10: ${skill.take10Allowed ? 'Yes' : 'No'}`));
  metaRow.appendChild(createInspectorBadge(`Take 20: ${skill.take20Allowed ? 'Yes' : 'No'}`));
  pane.appendChild(metaRow);

  const wholeRanks = Math.floor(currentRanks);
  const synBonus = computeSkillSynergyBonus(skill.synergyFromSkills, allRanks);
  const totalMod = wholeRanks + abilityMod + synBonus + miscBonus;

  pane.appendChild(createInspectorSectionTitle('Check Modifier Breakdown (Read-Only Bonuses vs Ranks)'));
  const breakdownBox = document.createElement('div');
  breakdownBox.style.display = 'grid';
  breakdownBox.style.gridTemplateColumns = '1fr auto';
  breakdownBox.style.gap = '4px 12px';
  breakdownBox.style.padding = '8px';
  breakdownBox.style.background = 'rgba(255,255,255,0.04)';
  breakdownBox.style.border = '1px solid #333947';
  breakdownBox.style.fontSize = '0.84rem';

  const addBreakRow = (label: string, valStr: string, highlight = false): void => {
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('strong');
    v.style.color = highlight ? '#f1c40f' : '#c9d1d9';
    v.textContent = valStr;
    breakdownBox.appendChild(l);
    breakdownBox.appendChild(v);
  };

  const fmtSigned = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
  addBreakRow(`Invested Ranks (Cap ${maxRanks}):`, `${currentRanks} (${fmtSigned(wholeRanks)} check ranks)`);
  addBreakRow(`Key Ability (${skill.keyAbility.toUpperCase()}):`, fmtSigned(abilityMod));
  addBreakRow('Synergy Bonus (from 5+ rank skills):', fmtSigned(synBonus));
  addBreakRow('Racial / Feat / Misc Bonus (cannot unallocate):', fmtSigned(miscBonus));
  addBreakRow('Total Skill Check Modifier:', fmtSigned(totalMod), true);
  pane.appendChild(breakdownBox);

  pane.appendChild(createInspectorSectionTitle('Skill Synergies (5+ Ranks = +2 Bonus)'));
  const synBox = document.createElement('div');
  synBox.style.display = 'flex';
  synBox.style.flexDirection = 'column';
  synBox.style.gap = '4px';
  synBox.style.fontSize = '0.82rem';

  if (skill.synergyFromSkills.length > 0) {
    for (const srcId of skill.synergyFromSkills) {
      const srcName = sys.skills[srcId]?.name ?? srcId;
      const srcRanks = Math.floor(allRanks[srcId] ?? 0);
      const unlocked = srcRanks >= SYNERGY_RANK_THRESHOLD;
      const item = document.createElement('div');
      item.style.color = unlocked ? '#2ecc71' : '#8b949e';
      item.textContent = `${unlocked ? '✔' : '○'} Receives +2 from ${srcName} (${srcRanks}/${SYNERGY_RANK_THRESHOLD} ranks)`;
      synBox.appendChild(item);
    }
  }
  const outgoing = getSkillsGrantedSynergyBy(skill.id, sys.skills);
  for (const tgtId of outgoing) {
    const tgtName = sys.skills[tgtId]?.name ?? tgtId;
    const active = wholeRanks >= SYNERGY_RANK_THRESHOLD;
    const item = document.createElement('div');
    item.style.color = active ? '#2ecc71' : '#58a6ff';
    item.textContent = `→ 5+ ranks grants +2 synergy to ${tgtName}`;
    synBox.appendChild(item);
  }
  if (skill.synergyNotes) {
    const note = document.createElement('div');
    note.style.color = '#c9d1d9';
    note.style.marginTop = '2px';
    note.textContent = skill.synergyNotes;
    synBox.appendChild(note);
  }
  pane.appendChild(synBox);

  if (skill.actions.length > 0) {
    pane.appendChild(createInspectorSectionTitle('Skill Actions & Mechanics'));
    for (const act of skill.actions) {
      const card = document.createElement('div');
      card.style.padding = '6px 8px';
      card.style.border = '1px solid #303644';
      card.style.background = 'rgba(0,0,0,0.35)';
      card.style.fontSize = '0.8rem';
      const head = document.createElement('strong');
      const dcText =
        act.dc !== undefined ? `DC ${act.dc}` : act.opposedBySkill ? `Opposed by ${act.opposedBySkill}` : 'Check';
      head.textContent = `${act.name} [${act.actionCost} | ${dcText}]`;
      const desc = document.createElement('div');
      desc.style.color = '#9da7b3';
      desc.textContent = act.description;
      card.appendChild(head);
      card.appendChild(desc);
      pane.appendChild(card);
    }
  }
}
