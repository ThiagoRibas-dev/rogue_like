import {
  ALL_ABILITY_IDS,
  buildHitDieTrackFromClass,
  calculateMulticlassXpMultiplier,
  type ClassSpellSelectionBudget,
  computeClassSpellSelectionBudget,
  computeEffectiveClassCastingLevel,
  type DnD35ClassDefinition,
  type DnD35EntityData,
  type DnD35SystemContent,
  evaluatePrerequisiteAST,
  getClassLevelRow,
  getEligibleBaseCastingClassesForPrestige,
  type LevelUpChoice,
  type PrerequisiteEvalContext
} from '../../rulesets/registry.ts';

/** Hit Dice interval for ability score increases (`4`). */
export const ABILITY_INCREASE_HD_STEP = 4;

/** Hit Dice interval for general feat slots (`3`). */
export const GENERAL_FEAT_HD_STEP = 3;

/** Descriptor for a per-class spell learning tab during Level-Up. */
export interface SpellTabDescriptor {
  readonly tabId: `spells:${string}`;
  readonly classId: string;
  readonly className: string;
  readonly castingTradition: string;
  readonly budget: ClassSpellSelectionBudget;
}

/**
 * Computes the Prestige Class spellcasting advancement slots and per-class spell tabs for a level-up draft.
 */
export function computeLevelUpSpellTabs(
  dndData: DnD35EntityData,
  activeCls: DnD35ClassDefinition,
  nextClassLevel: number,
  intMod: number,
  draft: LevelUpChoice,
  sys: DnD35SystemContent
): {
  readonly prestigeSlots: ReturnType<typeof getEligibleBaseCastingClassesForPrestige>;
  readonly effectivePrestigeTargets: ReadonlyArray<string>;
  readonly spellTabs: ReadonlyArray<SpellTabDescriptor>;
} {
  const prestigeSlots = getEligibleBaseCastingClassesForPrestige(
    dndData.tracks,
    activeCls,
    nextClassLevel,
    sys.classes
  );

  let effectivePrestigeTargets = [...(draft.advancedSpellcastingClassIds ?? [])];
  if (prestigeSlots.length > 0 && effectivePrestigeTargets.length === 0) {
    effectivePrestigeTargets = prestigeSlots
      .map((slot) => slot.eligibleClassIds[0])
      .filter((id): id is string => id !== undefined);
  }

  const advancedCastingClassIds: string[] = [];
  if (activeCls.castingMode !== 'none' && !activeCls.isPrestige) {
    advancedCastingClassIds.push(activeCls.id);
  }
  for (const targetId of effectivePrestigeTargets) {
    if (targetId && !advancedCastingClassIds.includes(targetId)) {
      advancedCastingClassIds.push(targetId);
    }
  }

  const spellTabs: SpellTabDescriptor[] = [];

  for (const targetClassId of advancedCastingClassIds) {
    const targetCls = sys.classes[targetClassId];
    if (!targetCls) continue;
    const prevEffLvl = computeEffectiveClassCastingLevel(dndData.tracks, targetCls, sys.classes, dndData.levelHistory);
    const nextEffLvl = prevEffLvl + 1;
    const existingKnown =
      dndData.spellbooksByClass?.[targetClassId]?.knownSpellIds ??
      (targetClassId === dndData.tracks[0]?.trackId ? (dndData.knownSpells ?? []) : []);
    const spBudget = computeClassSpellSelectionBudget(
      targetCls,
      prevEffLvl,
      nextEffLvl,
      intMod,
      dndData.prohibitedSchools ?? [],
      dndData.domains ?? [],
      existingKnown,
      sys
    );
    if (spBudget.requiresManualSelection) {
      spellTabs.push({
        tabId: `spells:${targetClassId}`,
        classId: targetClassId,
        className: targetCls.name,
        castingTradition: targetCls.castingTradition,
        budget: spBudget
      });
    }
  }

  return { prestigeSlots, effectivePrestigeTargets, spellTabs };
}

/**
 * Renders the 2-pane Class, Hit Points, 4th-HD Ability Score Increase, and Prestige Spellcasting Target stage.
 */
export function renderLevelUpClassStage(
  stageHost: HTMLElement,
  dndData: DnD35EntityData,
  prereqCtx: PrerequisiteEvalContext,
  activeCls: DnD35ClassDefinition,
  nextClassLevel: number,
  nextCharLevel: number,
  prestigeSlots: ReturnType<typeof getEligibleBaseCastingClassesForPrestige>,
  effectivePrestigeTargets: ReadonlyArray<string>,
  levelUpDraft: LevelUpChoice,
  sys: DnD35SystemContent,
  onUpdateDraft: (nextDraft: LevelUpChoice) => void
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'lvlup-class-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'lvlup-class-right';

  for (const cls of Object.values(sys.classes).filter((c) => !c.isNpcClass)) {
    const meetsPrereqs = cls.prerequisites ? evaluatePrerequisiteAST(cls.prerequisites, prereqCtx) : true;
    const alignOk = cls.allowedAlignments ? cls.allowedAlignments.includes(dndData.alignment ?? 'N') : true;
    const eligible = meetsPrereqs && alignOk;

    const trk = dndData.tracks.find((t) => t.trackId === cls.id);
    const nxtLvl = (trk ? trk.levels : 0) + 1;
    const previewTracks = trk
      ? dndData.tracks.map((t) => (t.trackId === cls.id ? buildHitDieTrackFromClass(cls, nxtLvl) : t))
      : [...dndData.tracks, buildHitDieTrackFromClass(cls, 1)];
    const xpMult = calculateMulticlassXpMultiplier(
      previewTracks,
      sys.classes,
      dndData.favoredClass ?? 'any',
      dndData.enforceMulticlassXpPenalty ?? true
    );
    const rRow = getClassLevelRow(cls, nxtLvl) ?? cls.progression[cls.progression.length - 1]!;
    const isSelected = levelUpDraft.classId === cls.id;

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}`;
    const tag = cls.isPrestige ? '[Prestige]' : '[Base]';
    const xpNote = xpMult < 1 ? ` ⚠ XP ${Math.round(xpMult * 100)}%` : '';
    row.textContent = `${eligible ? '🟢' : '🔴'} ${tag} ${cls.name} (Lv ${nxtLvl}, d${cls.hitDieSides}, BAB +${rRow.bab})${xpNote}`;
    row.addEventListener('click', () => {
      if (!eligible) return;
      onUpdateDraft({
        ...levelUpDraft,
        classId: cls.id,
        addedSkillRanks: {},
        selectedFeats: [],
        learnedSpells: [],
        advancedSpellcastingClassIds: [],
        learnedSpellsByClass: {}
      });
    });
    leftPane.appendChild(row);
  }

  const rTitle = document.createElement('h3');
  rTitle.style.margin = '0 0 6px 0';
  rTitle.style.color = 'var(--crpg-success, #2ecc71)';
  rTitle.textContent = `${activeCls.name} Level ${nextClassLevel} Advancement`;
  rightPane.appendChild(rTitle);

  const hpRow = document.createElement('div');
  hpRow.style.display = 'flex';
  hpRow.style.gap = '8px';
  for (const method of ['average', 'roll'] as const) {
    const mBtn = document.createElement('button');
    mBtn.type = 'button';
    mBtn.className = 'modal-btn';
    mBtn.style.borderColor = levelUpDraft.hpMethod === method ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    mBtn.textContent =
      method === 'average'
        ? `Fixed Average (+${Math.floor(activeCls.hitDieSides / 2) + 1} HP)`
        : `🎲 Roll 1d${activeCls.hitDieSides}`;
    mBtn.addEventListener('click', () => {
      onUpdateDraft({ ...levelUpDraft, hpMethod: method });
    });
    hpRow.appendChild(mBtn);
  }
  rightPane.appendChild(hpRow);

  if (nextCharLevel % ABILITY_INCREASE_HD_STEP === 0) {
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

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  stageHost.appendChild(stage);
}

/**
 * Renders the validation gate banner and Previous / Next / Confirm footer bar for the Level-Up modal.
 */
export function renderLevelUpFooter(
  content: HTMLElement,
  currentTabCheck: { readonly valid: boolean; readonly reason?: string },
  activeTabIndex: number,
  totalTabs: number,
  allTabsValid: boolean,
  onCancel: () => void,
  onNavigateDelta: (delta: -1 | 1) => void,
  onConfirm: () => void
): void {
  if (!currentTabCheck.valid && currentTabCheck.reason) {
    const gateBanner = document.createElement('div');
    gateBanner.style.cssText =
      'padding: 5px 10px; font-size: 0.78rem; color: var(--crpg-warning, #f39c12); border: 1px solid var(--crpg-warning, #e67e22); background: rgba(230, 126, 34, 0.12);';
    gateBanner.textContent = `⚠ Required before proceeding: ${currentTabCheck.reason}`;
    content.appendChild(gateBanner);
  }

  const footer = document.createElement('div');
  footer.style.cssText =
    'display: flex; justify-content: space-between; padding-top: 6px; border-top: 1px solid var(--crpg-border-subtle, #333947);';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'modal-btn';
  cancelBtn.textContent = 'Later (Esc)';
  cancelBtn.addEventListener('click', onCancel);

  const navRight = document.createElement('div');
  navRight.style.cssText = 'display: flex; gap: 8px;';

  if (activeTabIndex > 0) {
    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'modal-btn';
    prevBtn.textContent = '← Previous';
    prevBtn.addEventListener('click', () => onNavigateDelta(-1));
    navRight.appendChild(prevBtn);
  }

  if (activeTabIndex < totalTabs - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'modal-btn';
    nextBtn.textContent = 'Next Step →';
    nextBtn.disabled = !currentTabCheck.valid;
    nextBtn.addEventListener('click', () => {
      if (currentTabCheck.valid) onNavigateDelta(1);
    });
    navRight.appendChild(nextBtn);
  }

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'modal-btn';
  confirmBtn.style.borderColor = allTabsValid ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
  confirmBtn.textContent = '✔ Confirm Level Up';
  confirmBtn.disabled = !allTabsValid;
  confirmBtn.addEventListener('click', () => {
    if (allTabsValid) onConfirm();
  });
  navRight.appendChild(confirmBtn);

  footer.appendChild(cancelBtn);
  footer.appendChild(navRight);
  content.appendChild(footer);
}
