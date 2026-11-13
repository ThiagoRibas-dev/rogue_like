import { computeAbilityModifier } from '../../rulesets/dnd35e/abilities.ts';
import {
  type CharacterCreationDraft,
  type ClassSpellSelectionBudget,
  computeClassSpellSelectionBudget,
  getSpellLevelForClass,
  isSpellSelectableForDraft
} from '../../rulesets/dnd35e/character_builder.ts';
import type { DnD35Alignment, DnD35SpellSchool } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import { type DnD35SystemContent, getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderSpellInspector } from './dnd35e_inspector.ui.ts';

let inspectedSpellId = 'magic_missile';
let spellLevelFilter: number | 'all' = 'all';

/** Configuration for the shared Per-Class Spell Selection step renderer. */
export interface SharedClassSpellStepConfig {
  readonly scrollPrefix: string;
  readonly classId: string;
  readonly className: string;
  readonly castingTradition: string;
  readonly budget: ClassSpellSelectionBudget;
  readonly priorKnownSpells: ReadonlyArray<string>;
  readonly selectedSpells: ReadonlyArray<string>;
  readonly prohibitedSchools: ReadonlyArray<DnD35SpellSchool>;
  readonly domains: ReadonlyArray<string>;
  readonly alignment?: DnD35Alignment | undefined;
  readonly onUpdateSelectedSpells: (nextSpells: string[]) => void;
  readonly onRefresh: () => void;
}

/**
 * Renders a per-class Spell Selection step with Spell Level Filter Chips (`All`, `Lv 0`, `Lv 1`, ...)
 * and strict enforcement of Wizard Spellbook Scribed budgets (`3 + INT` at Lv 1, `+2` at Lv 2+) and Spontaneous Spells Known deltas.
 */
export function renderSharedClassSpellStep(
  container: HTMLElement,
  sys: DnD35SystemContent,
  config: SharedClassSpellStepConfig
): void {
  const { budget } = config;
  if (!budget.requiresManualSelection || budget.maxCastableLevel < 0) {
    const msg = document.createElement('div');
    msg.className = 'dnd35-filter-bar';
    msg.textContent =
      budget.spellAcquisitionMode === 'prayerbook_full_list'
        ? ` Divine Prayerbook Rule: ${config.className} automatically accesses the full ${config.className} spell list (plus domain spells) up to Spell Level ${budget.maxCastableLevel} when preparing daily spells. No manual spell learning required.`
        : `${config.className} does not require manual spell selection at this level.`;
    container.appendChild(msg);
    return;
  }

  if (spellLevelFilter !== 'all' && spellLevelFilter > budget.maxCastableLevel) {
    spellLevelFilter = 'all';
  }

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `${config.scrollPrefix}-spells-${config.classId}-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `${config.scrollPrefix}-spells-${config.classId}-right`;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';

  const manualSelected = config.selectedSpells.filter((id) => !budget.autoGrantedCantripIds.includes(id));
  const pickedByLevel: Record<number, number> = {};
  let nonZeroPicked = 0;
  for (const spId of manualSelected) {
    const sp = sys.spells[spId];
    if (!sp) continue;
    const lvl = getSpellLevelForClass(sp, config.classId, config.domains) ?? sp.level;
    pickedByLevel[lvl] = (pickedByLevel[lvl] ?? 0) + 1;
    if (lvl >= 1) nonZeroPicked += 1;
  }

  const summaryStrong = document.createElement('strong');
  if (budget.freePickCount > 0) {
    const targetCount = budget.freePickCount;
    summaryStrong.style.color =
      nonZeroPicked === targetCount ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-gold, #f1c40f)';
    summaryStrong.textContent = `${config.className} Spellbook • Scribe Lv 1–${budget.maxCastableLevel} Spells: ${nonZeroPicked} / ${targetCount}`;
  } else {
    const parts: string[] = [];
    let allExact = true;
    for (const [lvlKey, req] of Object.entries(budget.requiredBySpellLevel)) {
      const lvl = Number(lvlKey);
      const cur = pickedByLevel[lvl] ?? 0;
      if (cur !== req) allExact = false;
      parts.push(`Lv ${lvl}: ${cur}/${req}`);
    }
    const cantripNote =
      budget.autoGrantedCantripIds.length > 0 ? ' (All non-prohibited Lv 0 Cantrips auto-scribed)' : '';
    summaryStrong.style.color = allExact ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-gold, #f1c40f)';
    summaryStrong.textContent = `${config.className} Spells • ${parts.join(' | ')}${cantripNote}`;
  }
  filterBar.appendChild(summaryStrong);

  const chipRow = document.createElement('div');
  chipRow.style.display = 'flex';
  chipRow.style.flexWrap = 'wrap';
  chipRow.style.gap = '4px';

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'modal-btn';
  allChip.style.padding = '3px 7px';
  allChip.style.fontSize = '0.72rem';
  allChip.style.borderColor = spellLevelFilter === 'all' ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
  allChip.textContent = 'All Levels';
  allChip.addEventListener('click', () => {
    spellLevelFilter = 'all';
    config.onRefresh();
  });
  chipRow.appendChild(allChip);

  for (let lvl = 0; lvl <= budget.maxCastableLevel; lvl++) {
    const lvlChip = document.createElement('button');
    lvlChip.type = 'button';
    lvlChip.className = 'modal-btn';
    lvlChip.style.padding = '3px 7px';
    lvlChip.style.fontSize = '0.72rem';
    lvlChip.style.borderColor = spellLevelFilter === lvl ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    lvlChip.textContent = `Lv ${lvl}`;
    lvlChip.addEventListener('click', () => {
      spellLevelFilter = lvl;
      config.onRefresh();
    });
    chipRow.appendChild(lvlChip);
  }
  filterBar.appendChild(chipRow);
  leftPane.appendChild(filterBar);

  const eligibleSpells = Object.values(sys.spells).filter(
    (sp) =>
      isSpellSelectableForDraft(
        sp,
        config.classId,
        budget.maxCastableLevel,
        config.prohibitedSchools,
        config.domains,
        config.alignment
      ).selectable
  );

  if (!eligibleSpells.some((s) => s.id === inspectedSpellId) && eligibleSpells.length > 0) {
    inspectedSpellId = eligibleSpells[0]!.id;
  }

  for (const spell of eligibleSpells) {
    const check = isSpellSelectableForDraft(
      spell,
      config.classId,
      budget.maxCastableLevel,
      config.prohibitedSchools,
      config.domains,
      config.alignment
    );
    const effLvl = check.effectiveLevel ?? spell.level;
    if (spellLevelFilter !== 'all' && effLvl !== spellLevelFilter) continue;

    const isAutoCantrip = budget.autoGrantedCantripIds.includes(spell.id);
    const isAlreadyOwned = config.priorKnownSpells.includes(spell.id);
    const isPicked = manualSelected.includes(spell.id);

    let canAdd = false;
    if (!isAutoCantrip && !isAlreadyOwned && !isPicked) {
      if (budget.freePickCount > 0) {
        canAdd = effLvl >= 1 && effLvl <= budget.maxCastableLevel && nonZeroPicked < budget.freePickCount;
      } else {
        const reqForLvl = budget.requiredBySpellLevel[effLvl] ?? 0;
        const curForLvl = pickedByLevel[effLvl] ?? 0;
        canAdd = curForLvl < reqForLvl;
      }
    }

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isPicked || isAutoCantrip ? ' selected' : ''}${inspectedSpellId === spell.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedSpellId = spell.id;
      renderSpellInspector(rightPane, spell, config.classId, config.domains);
    });

    const label = document.createElement('span');
    const statusIcon = isAutoCantrip ? '✔ [Auto]' : isAlreadyOwned ? '✔ [Known]' : isPicked ? '☑' : '☐';
    label.textContent = `${statusIcon} [Lv ${effLvl}] ${spell.name} (${spell.school})`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.padding = '3px 8px';
    btn.style.fontSize = '0.74rem';
    btn.textContent = isAutoCantrip ? 'Auto' : isAlreadyOwned ? 'Known' : isPicked ? 'Remove' : 'Add';
    btn.disabled = isAutoCantrip || isAlreadyOwned || (!isPicked && !canAdd);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedSpellId = spell.id;
      const nextSpells = isPicked ? manualSelected.filter((id) => id !== spell.id) : [...manualSelected, spell.id];
      config.onUpdateSelectedSpells(nextSpells);
    });

    row.appendChild(label);
    row.appendChild(btn);
    leftPane.appendChild(row);
  }

  const activeSpell = sys.spells[inspectedSpellId] ?? eligibleSpells[0];
  if (activeSpell) {
    renderSpellInspector(rightPane, activeSpell, config.classId, config.domains);
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 6 (Starting Spell Selection) in the Level 1 Character Creation Wizard via `renderSharedClassSpellStep`.
 */
export function renderCharBuilderSpellsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return;
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  if (!cls || !race) return;

  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (race.abilityAdjustments.int ?? 0));
  const budget = computeClassSpellSelectionBudget(
    cls,
    0,
    1,
    intMod,
    draft.prohibitedSchools,
    draft.domains,
    [],
    sys,
    draft.alignment
  );

  renderSharedClassSpellStep(container, sys, {
    scrollPrefix: 'char',
    classId: cls.id,
    className: cls.name,
    castingTradition: cls.castingTradition,
    budget,
    priorKnownSpells: [],
    selectedSpells: draft.knownSpells,
    prohibitedSchools: draft.prohibitedSchools,
    domains: draft.domains,
    alignment: draft.alignment,
    onUpdateSelectedSpells: (nextSpells) => updateDraft({ ...draft, knownSpells: nextSpells }),
    onRefresh: () => updateDraft(draft)
  });
}
