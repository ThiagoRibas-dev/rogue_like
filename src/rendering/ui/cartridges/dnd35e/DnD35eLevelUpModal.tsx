/**
 * @file D&D 3.5e Interactive Level-Up Advancement Modal (Milestone 164).
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import { setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { computeAbilityModifier } from '../../../../rulesets/dnd35e/abilities.ts';
import {
  applyLevelUpToActor,
  buildPostLevelUpPrerequisiteContext,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  computeLevelUpFeatSlots,
  getActorEverClassSkillIds,
  getEffectiveClassSkillIds,
  type LevelUpChoice,
  validateLevelUpStep
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from '../../../../rulesets/dnd35e/progression.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { type AbilityId, ALL_ABILITY_IDS } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType, type FighterComponent } from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { computeLevelUpSpellTabs } from '../../dnd35e_level_up_tabs.ts';
import { Button } from '../../primitives/Button.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';
import { type TabItem, Tabs } from '../../primitives/Tabs.tsx';
import { DnD35eLevelUpClassStep } from './DnD35eLevelUpClassStep.tsx';
import { DnD35eSharedFeatsStep } from './DnD35eSharedFeatsStep.tsx';
import { DnD35eSharedSkillsStep } from './DnD35eSharedSkillsStep.tsx';
import { DnD35eSharedSpellsStep } from './DnD35eSharedSpellsStep.tsx';

type LevelUpTabId = 'class' | 'skills' | 'feats' | `spells:${string}`;

function createDefaultLevelUpDraft(defaultClassId: string): LevelUpChoice {
  return {
    classId: defaultClassId,
    hpMethod: 'average',
    addedSkillRanks: {},
    selectedFeats: [],
    learnedSpells: [],
    advancedSpellcastingClassIds: [],
    learnedSpellsByClass: {}
  };
}

/**
 * Checks whether the player actor has enough XP to advance to the next character level.
 *
 * @param state Current GameState.
 * @param playerId Player EntityId.
 * @returns True if player XP meets or exceeds next ECL threshold.
 */
export function canPlayerLevelUpDnD35e(state: GameState, playerId: EntityId): boolean {
  if (state.campaign.manifest.rulesetId !== 'dnd35e') return false;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return false;
  const dndData = getDnD35EntityData(state, playerId);
  const chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const nextThreshold = computeXpThresholdForLevel(chassis.ecl + 1);
  return fighter.xp >= nextThreshold;
}

/** Props for `<DnD35eLevelUpModal />`. */
export interface DnD35eLevelUpModalProps {
  readonly state: GameState;
}

/**
 * Declarative Preact D&D 3.5e Level-Up Advancement Modal.
 */
export function DnD35eLevelUpModal({ state }: DnD35eLevelUpModalProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return null;

  const dndData = getDnD35EntityData(state, playerId);
  const initialClassId = dndData.tracks[0]?.trackId ?? 'fighter';

  const [activeTab, setActiveTab] = useState<LevelUpTabId>('class');
  const [draft, setDraft] = useState<LevelUpChoice>(() => createDefaultLevelUpDraft(initialClassId));

  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes, sys);
  const currentChassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
  const nextCharLevel = currentChassis.totalHD + 1;

  const activeCls = sys.classes[draft.classId] ?? Object.values(sys.classes)[0]!;
  const existingTrack = dndData.tracks.find((t) => t.trackId === activeCls.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  const raceDef = dndData.raceId ? sys.races[dndData.raceId] : undefined;
  const intScore = (dndData.abilityScores.int.base ?? 10) + (draft.abilityScoreIncrease === 'int' ? 1 : 0);
  const intMod = computeAbilityModifier(intScore);
  const skillBudget = calculateLevelSkillPointBudget(
    activeCls.skillPointsPerLevel,
    intMod,
    false,
    0,
    raceDef?.extraSkillPointsPerLevel ?? 0
  );
  const activeLevelClassSkillIds = getEffectiveClassSkillIds(activeCls, dndData.domains ?? [], sys);
  const everClassSkillIds = getActorEverClassSkillIds(dndData, activeCls.id, dndData.domains ?? [], sys);
  const literacyCost = draft.spendSkillPointsForLiteracy === true ? 2 : 0;
  const skillSpent = calculateSkillAllocationCost(draft.addedSkillRanks, activeLevelClassSkillIds) + literacyCost;
  const skillRemaining = Math.max(0, Math.round((skillBudget - skillSpent) * 100) / 100);

  const activeAcfs = [...(dndData.selectedAcfs ?? []), ...(draft.selectedAcfs ?? [])];
  const featSlots = computeLevelUpFeatSlots(activeCls, nextClassLevel, nextCharLevel, activeAcfs);
  const totalFeatSlots = featSlots.length;

  const { prestigeSlots, effectivePrestigeTargets, spellTabs } = computeLevelUpSpellTabs(
    dndData,
    activeCls,
    nextClassLevel,
    intMod,
    draft,
    sys
  );
  const effectiveDraft: LevelUpChoice =
    effectivePrestigeTargets.length > 0 && (draft.advancedSpellcastingClassIds ?? []).length === 0
      ? { ...draft, advancedSpellcastingClassIds: effectivePrestigeTargets }
      : draft;

  const tabsMeta: Array<{ readonly id: LevelUpTabId; readonly label: string }> = [
    { id: 'class', label: `1. Class & HP (HD ${nextCharLevel})` },
    { id: 'skills', label: `2. Skills (${skillRemaining}/${skillBudget} pts)` }
  ];
  if (totalFeatSlots > 0) {
    tabsMeta.push({
      id: 'feats',
      label: `3. Feats (${effectiveDraft.selectedFeats.length}/${totalFeatSlots})`
    });
  }
  spellTabs.forEach((st) => {
    const pickedCount =
      effectiveDraft.learnedSpellsByClass?.[st.classId]?.length ??
      (st.classId === activeCls.id ? (effectiveDraft.learnedSpells ?? []).length : 0);
    const stepNum = tabsMeta.length + 1;
    tabsMeta.push({ id: st.tabId, label: `${stepNum}. ${st.className} Spells (${pickedCount})` });
  });

  const resolvedTab: LevelUpTabId = tabsMeta.some((t) => t.id === activeTab) ? activeTab : 'class';
  const activeTabIndex = tabsMeta.findIndex((t) => t.id === resolvedTab);
  const currentTabCheck = validateLevelUpStep(dndData, effectiveDraft, resolvedTab, sys);

  const canNavigateToTab = (targetIdx: number): boolean => {
    if (targetIdx <= activeTabIndex) return true;
    for (let i = 0; i < targetIdx; i++) {
      const tb = tabsMeta[i];
      if (tb && !validateLevelUpStep(dndData, effectiveDraft, tb.id, sys).valid) return false;
    }
    return true;
  };

  const tabItems: TabItem[] = tabsMeta.map((t, idx) => {
    const valid = validateLevelUpStep(dndData, effectiveDraft, t.id, sys).valid;
    return {
      id: t.id,
      label: t.label,
      badge: valid ? '✓' : '!',
      disabled: !canNavigateToTab(idx)
    };
  });

  const abilityModifiers = {} as Record<AbilityId, number>;
  for (const k of ALL_ABILITY_IDS) {
    abilityModifiers[k] = computeAbilityModifier(
      (dndData.abilityScores[k].base ?? 10) + (effectiveDraft.abilityScoreIncrease === k ? 1 : 0)
    );
  }
  const miscSkillBonuses: Record<string, number> = {};
  for (const mod of dndData.statModifiers ?? []) {
    if (mod.targetStat.startsWith('skill:')) {
      const skId = mod.targetStat.slice('skill:'.length);
      miscSkillBonuses[skId] = (miscSkillBonuses[skId] ?? 0) + mod.value;
    }
  }

  const allTabsValid = tabsMeta.every((tb) => validateLevelUpStep(dndData, effectiveDraft, tb.id, sys).valid);
  const handleClose = (): void => {
    setGameState(closeCartridgeModal(state));
    markAllDomainsDirty();
  };

  const footer = (
    <div className="ui-dnd-wizard-footer">
      <Button variant="secondary" onClick={handleClose}>
        Cancel
      </Button>
      <div className="ui-dnd-list-row__actions">
        {activeTabIndex > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              const prev = tabsMeta[activeTabIndex - 1];
              if (prev) setActiveTab(prev.id);
            }}
          >
            ← Previous
          </Button>
        ) : null}
        {activeTabIndex < tabsMeta.length - 1 ? (
          <Button
            variant="primary"
            disabled={!currentTabCheck.valid}
            onClick={() => {
              const next = tabsMeta[activeTabIndex + 1];
              if (next && currentTabCheck.valid) setActiveTab(next.id);
            }}
          >
            Next →
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!allTabsValid}
            onClick={() => {
              if (!allTabsValid) return;
              const result = applyLevelUpToActor(state, playerId, effectiveDraft);
              setGameState(closeCartridgeModal(result.state));
              markAllDomainsDirty();
            }}
          >
            ✔ Complete Level-Up
          </Button>
        )}
      </div>
    </div>
  );

  const postPrereqCtx = buildPostLevelUpPrerequisiteContext(
    dndData,
    effectiveDraft,
    activeCls,
    sys,
    effectiveDraft.selectedFeats
  );
  const featSummaryLabel =
    totalFeatSlots > 0
      ? `Feats Selected: ${effectiveDraft.selectedFeats.length} / ${totalFeatSlots} (${featSlots.map((s) => s.label).join(' + ')})`
      : 'No new feat slots earned at this Hit Die (General feats gained at HD 3, 6, 9, 12, 15, 18)';

  const activeSpellTab = resolvedTab.startsWith('spells:')
    ? spellTabs.find((st) => st.classId === resolvedTab.slice('spells:'.length))
    : undefined;

  return (
    <ModalShell
      title={`⭐ Level Up Advancement (Hit Die ${nextCharLevel})`}
      subtitle={
        totalFeatSlots > 0
          ? 'Choose advancing class track, skill ranks, feats, and new spells'
          : 'Choose advancing class track, skill ranks, and new spells'
      }
      size="xl"
      scrollMode="panes"
      onClose={handleClose}
      footer={footer}
    >
      <div className="ui-dnd-sheet-body">
        <Tabs
          tabs={tabItems}
          activeTabId={resolvedTab}
          ariaLabel="Level up stages"
          onSelectTab={(tabId) => {
            const targetIdx = tabsMeta.findIndex((t) => t.id === tabId);
            if (targetIdx >= 0 && canNavigateToTab(targetIdx)) {
              setActiveTab(tabId as LevelUpTabId);
            }
          }}
        />

        {resolvedTab === 'class' ? (
          <DnD35eLevelUpClassStep
            dndData={dndData}
            prereqCtx={prereqCtx}
            activeCls={activeCls}
            nextClassLevel={nextClassLevel}
            newTotalHd={nextCharLevel}
            prestigeSlots={prestigeSlots}
            effectivePrestigeTargets={effectivePrestigeTargets}
            draft={effectiveDraft}
            sys={sys}
            onUpdateDraft={setDraft}
          />
        ) : resolvedTab === 'skills' ? (
          <DnD35eSharedSkillsStep
            sys={sys}
            totalHd={nextCharLevel}
            budget={Math.max(0, skillBudget - literacyCost)}
            activeLevelClassSkillIds={activeLevelClassSkillIds}
            everClassSkillIds={everClassSkillIds}
            priorSkillRanks={dndData.skillRanks}
            addedSkillRanks={effectiveDraft.addedSkillRanks}
            abilityModifiers={abilityModifiers}
            miscSkillBonuses={miscSkillBonuses}
            onUpdateAddedRanks={(nextAdded) => setDraft({ ...effectiveDraft, addedSkillRanks: nextAdded })}
          />
        ) : resolvedTab === 'feats' ? (
          <DnD35eSharedFeatsStep
            sys={sys}
            slotSummaryLabel={featSummaryLabel}
            totalSlots={totalFeatSlots}
            slots={featSlots}
            alreadyOwnedFeatIds={dndData.feats}
            selectedFeatIds={effectiveDraft.selectedFeats}
            prereqCtx={postPrereqCtx}
            onUpdateSelectedFeats={(nextFeats) => setDraft({ ...effectiveDraft, selectedFeats: nextFeats })}
          />
        ) : activeSpellTab ? (
          <DnD35eSharedSpellsStep
            sys={sys}
            classId={activeSpellTab.classId}
            className={activeSpellTab.className}
            budget={activeSpellTab.budget}
            priorKnownSpells={
              dndData.spellbooksByClass?.[activeSpellTab.classId]?.knownSpellIds ??
              (activeSpellTab.classId === dndData.tracks[0]?.trackId ? (dndData.knownSpells ?? []) : [])
            }
            selectedSpells={
              effectiveDraft.learnedSpellsByClass?.[activeSpellTab.classId] ??
              (activeSpellTab.classId === activeCls.id ? (effectiveDraft.learnedSpells ?? []) : [])
            }
            prohibitedSchools={dndData.prohibitedSchools ?? []}
            domains={dndData.domains ?? []}
            alignment={dndData.alignment}
            onUpdateSelectedSpells={(nextSpells) => {
              const nextByClass = {
                ...(effectiveDraft.learnedSpellsByClass ?? {}),
                [activeSpellTab.classId]: nextSpells
              };
              setDraft({
                ...effectiveDraft,
                learnedSpells:
                  activeSpellTab.classId === activeCls.id ? nextSpells : (effectiveDraft.learnedSpells ?? []),
                learnedSpellsByClass: nextByClass
              });
            }}
          />
        ) : null}

        {!currentTabCheck.valid && currentTabCheck.reason ? (
          <div className="ui-dnd-banner ui-dnd-banner--warning">
            {`⚠ Required before proceeding: ${currentTabCheck.reason}`}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
