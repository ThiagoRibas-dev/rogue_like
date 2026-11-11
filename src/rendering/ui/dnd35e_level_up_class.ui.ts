import type { LevelUpChoice } from '../../rulesets/dnd35e/character_builder.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../../rulesets/dnd35e/prerequisites.ts';
import {
  buildHitDieTrackFromClass,
  calculateMulticlassXpMultiplier,
  getClassLevelRow,
  type getEligibleBaseCastingClassesForPrestige
} from '../../rulesets/dnd35e/progression.ts';
import { ALL_ABILITY_IDS, type DnD35EntityData } from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { renderLevelUpClassOptions } from './dnd35e_level_up_class_options.ui.ts';
import { computeLevelUpSpellTabs, type SpellTabDescriptor } from './dnd35e_level_up_tabs.ts';

export { renderLevelUpFooter } from './dnd35e_level_up_footer.ui.ts';
export { computeLevelUpSpellTabs, type SpellTabDescriptor };

/** Hit Dice interval for ability score increases (`4`). */
export const ABILITY_INCREASE_HD_STEP = 4;

/** Hit Dice interval for general feat slots (`3`). */
export const GENERAL_FEAT_HD_STEP = 3;

/**
 * Renders the Class & Prerequisite Selection stage (Stage 1) in the Level-Up modal.
 *
 * @param stageHost Host container element.
 * @param dndData Actor's current `DnD35EntityData`.
 * @param prereqCtx Actor's prerequisite evaluation context.
 * @param activeCls Advancing class definition.
 * @param nextClassLevel New level in the advancing class.
 * @param newTotalHd New total Hit Dice after level-up.
 * @param prestigeSlots Prestige spellcasting advancement slots.
 * @param effectivePrestigeTargets Selected base spellcasting class targets.
 * @param levelUpDraft Current `LevelUpChoice` draft.
 * @param sys Loaded D&D 3.5e system content.
 * @param onUpdateDraft Callback to update the level-up draft.
 */
export function renderLevelUpClassStage(
  stageHost: HTMLElement,
  dndData: DnD35EntityData,
  prereqCtx: PrerequisiteEvalContext,
  activeCls: DnD35ClassDefinition,
  nextClassLevel: number,
  newTotalHd: number,
  prestigeSlots: ReturnType<typeof getEligibleBaseCastingClassesForPrestige>,
  effectivePrestigeTargets: ReadonlyArray<string>,
  levelUpDraft: LevelUpChoice,
  sys: DnD35SystemContent,
  onUpdateDraft: (next: LevelUpChoice) => void
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'lvlup-class-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'lvlup-class-right';

  const classes = Object.values(sys.classes);
  for (const cls of classes) {
    const existingTrack = dndData.tracks.find((t) => t.trackId === cls.id);
    const curLevel = existingTrack ? existingTrack.levels : 0;
    const isAdvancing = levelUpDraft.classId === cls.id;
    const atCap = curLevel >= cls.maxLevel;
    const meetsPrereq = cls.prerequisites ? evaluatePrerequisiteAST(cls.prerequisites, prereqCtx) : true;
    const isEligible = !atCap && meetsPrereq;

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isAdvancing ? ' selected' : ''}${!isEligible ? ' disabled' : ''}`;
    if (isEligible) {
      row.addEventListener('click', () => {
        onUpdateDraft({
          ...levelUpDraft,
          classId: cls.id,
          selectedAcfs: [],
          advancedSpellcastingClassIds: []
        });
      });
    }

    const titleSpan = document.createElement('strong');
    titleSpan.textContent = `${cls.name} (${curLevel > 0 ? `Lv ${curLevel}` : 'New Class'})`;

    const metaSpan = document.createElement('span');
    metaSpan.style.fontSize = '0.74rem';
    metaSpan.style.color = 'var(--crpg-text-dim, #9da7b3)';
    const reasonText = atCap ? 'At Maximum Level' : !meetsPrereq ? 'Prerequisites Not Met' : 'Eligible';
    metaSpan.textContent = `d${cls.hitDieSides} HD • ${cls.isPrestige ? 'Prestige' : 'Base'} • ${reasonText}`;

    row.appendChild(titleSpan);
    row.appendChild(metaSpan);
    leftPane.appendChild(row);
  }

  const existingAdvTrack = dndData.tracks.find((t) => t.trackId === activeCls.id);
  const rowDef = getClassLevelRow(activeCls, nextClassLevel);

  const title = document.createElement('h3');
  title.style.margin = '0 0 6px 0';
  title.style.color = 'var(--crpg-gold, #f1c40f)';
  title.textContent = `Advancing: ${activeCls.name} (Level ${nextClassLevel})`;
  rightPane.appendChild(title);

  const previewBox = document.createElement('div');
  previewBox.style.cssText =
    'padding: 8px; font-size: 0.78rem; background: var(--crpg-bg-card, rgba(0,0,0,0.35)); border: 1px solid var(--crpg-border-subtle, #333947); margin-bottom: 8px;';

  const hdLine = document.createElement('div');
  hdLine.textContent = `Hit Die: d${activeCls.hitDieSides} (Gain +${Math.floor(activeCls.hitDieSides / 2) + 1} HP avg + CON mod)`;
  const babLine = document.createElement('div');
  babLine.textContent = `BAB: +${rowDef?.bab ?? 0} | Fort: +${rowDef?.fortSave ?? 0} | Ref: +${rowDef?.refSave ?? 0} | Will: +${rowDef?.willSave ?? 0}`;
  const featLine = document.createElement('div');
  featLine.textContent = `Features: ${rowDef?.features && rowDef.features.length > 0 ? rowDef.features.join(', ') : 'None'}`;
  previewBox.appendChild(hdLine);
  previewBox.appendChild(babLine);
  previewBox.appendChild(featLine);
  rightPane.appendChild(previewBox);

  // Multiclass XP Penalty Evaluation
  const simulatedTrack = buildHitDieTrackFromClass(activeCls, nextClassLevel);
  const simulatedTracks = dndData.tracks.map((t) => (t.trackId === activeCls.id ? simulatedTrack : t));
  if (!existingAdvTrack) {
    simulatedTracks.push(simulatedTrack);
  }
  const xpMult = calculateMulticlassXpMultiplier(simulatedTracks, sys.classes, dndData.favoredClass ?? 'any');
  if (xpMult < 1.0) {
    const penaltyPct = Math.round((1.0 - xpMult) * 100);
    const xpNotice = document.createElement('div');
    xpNotice.style.cssText =
      'padding: 6px 10px; font-size: 0.76rem; color: var(--crpg-warning, #f39c12); background: rgba(243, 156, 18, 0.12); border: 1px solid var(--crpg-warning, #f39c12); margin-bottom: 8px;';
    xpNotice.textContent = `⚠ Multiclass XP Penalty: Non-favored class levels are uneven. Future XP gains will be reduced by -${penaltyPct}%.`;
    rightPane.appendChild(xpNotice);
  }

  // +1 Ability Score Increase every 4th HD
  if (newTotalHd % ABILITY_INCREASE_HD_STEP === 0) {
    const abTitle = document.createElement('strong');
    abTitle.style.color = 'var(--crpg-gold, #f1c40f)';
    abTitle.textContent = '+1 Ability Score Increase (Every 4th Hit Die):';
    rightPane.appendChild(abTitle);
    const abWrap = document.createElement('div');
    abWrap.style.display = 'flex';
    abWrap.style.flexWrap = 'wrap';
    abWrap.style.gap = '6px';
    for (const key of ALL_ABILITY_IDS) {
      const kBtn = document.createElement('button');
      kBtn.type = 'button';
      kBtn.className = 'modal-btn';
      kBtn.style.padding = '4px 8px';
      kBtn.style.borderColor =
        levelUpDraft.abilityScoreIncrease === key ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
      kBtn.textContent = `+1 ${key.toUpperCase()}`;
      kBtn.addEventListener('click', () => {
        onUpdateDraft({ ...levelUpDraft, abilityScoreIncrease: key });
      });
      abWrap.appendChild(kBtn);
    }
    rightPane.appendChild(abWrap);
  }

  if (prestigeSlots.length > 0) {
    prestigeSlots.forEach((slot, slotIdx) => {
      const slotHeader = document.createElement('strong');
      slotHeader.style.color = 'var(--crpg-info, #58a6ff)';
      slotHeader.textContent = `${slot.label}:`;
      rightPane.appendChild(slotHeader);

      const slotWrap = document.createElement('div');
      slotWrap.style.display = 'flex';
      slotWrap.style.flexWrap = 'wrap';
      slotWrap.style.gap = '6px';
      const curTarget = effectivePrestigeTargets[slotIdx];
      for (const candId of slot.eligibleClassIds) {
        const candCls = sys.classes[candId];
        const cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.className = 'modal-btn';
        cBtn.style.padding = '4px 8px';
        cBtn.style.borderColor = curTarget === candId ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
        cBtn.textContent = candCls?.name ?? candId;
        cBtn.addEventListener('click', () => {
          const nextTargets = [...effectivePrestigeTargets];
          nextTargets[slotIdx] = candId;
          onUpdateDraft({
            ...levelUpDraft,
            advancedSpellcastingClassIds: nextTargets
          });
        });
        slotWrap.appendChild(cBtn);
      }
      rightPane.appendChild(slotWrap);
    });
  }

  renderLevelUpClassOptions(rightPane, dndData, activeCls, nextClassLevel, levelUpDraft, sys, onUpdateDraft);

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  stageHost.appendChild(stage);
}
