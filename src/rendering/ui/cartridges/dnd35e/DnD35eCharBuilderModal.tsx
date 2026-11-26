/**
 * @file D&D 3.5e Character Creation Wizard Modal (Milestone 164).
 * Full-screen 2-pane Preact wizard with TextInputGuard-safe controls, validation gating,
 * and automatic race/class sprite suggestion.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import { setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { computeAbilityModifier } from '../../../../rulesets/dnd35e/abilities.ts';
import {
  applyCharacterCreationToPlayer,
  type CharacterCreationDraft,
  computeClassSpellSelectionBudget,
  sanitizeDraftOnRaceOrClassChange,
  validateCharacterCreationStep
} from '../../../../rulesets/dnd35e/character_builder.ts';
import {
  type DnD35SystemContent,
  getDnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { resolveCurrencyConfig } from '../../../../systems/currency.system.ts';
import { updateExploredTiles } from '../../../../systems/map.system.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { collectCatalogSpriteEntries, suggestCharacterSprites } from '../../../../utils/sprite_pack.ts';
import { invalidateViewportSnapshot } from '../../../presenter.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { Button } from '../../primitives/Button.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';
import { type TabItem, Tabs } from '../../primitives/Tabs.tsx';
import { CharBuilderClassStep } from './CharBuilderClassStep.tsx';
import { CharBuilderEquipmentStep } from './CharBuilderEquipmentStep.tsx';
import { CharBuilderAbilitiesStep, CharBuilderRaceStep } from './CharBuilderRaceAbilitiesStep.tsx';
import { expandDnD35SpriteHints } from './CharBuilderSpritePicker.tsx';
import { CharBuilderSummaryStep } from './CharBuilderSummaryStep.tsx';
import { CharBuilderFeatsStep } from './DnD35eSharedFeatsStep.tsx';
import { CharBuilderSkillsStep } from './DnD35eSharedSkillsStep.tsx';
import { CharBuilderSpellsStep } from './DnD35eSharedSpellsStep.tsx';

type WizardStepId = 'race' | 'class' | 'abilities' | 'skills' | 'feats' | 'spells' | 'equipment' | 'summary';

interface WizardStepDescriptor {
  readonly id: WizardStepId;
  readonly label: string;
}

function createDefaultDraft(): CharacterCreationDraft {
  return {
    characterName: 'Adventurer',
    raceId: 'human',
    classId: 'fighter',
    alignment: 'NG',
    selectedAcfs: [],
    domains: [],
    prohibitedSchools: [],
    abilityMethod: 'point_buy',
    pointBuyBudget: 28,
    baseAbilityScores: { str: 15, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    skillRanks: {},
    selectedFeats: [],
    knownSpells: [],
    equipmentPackageId: 'pkg_fighter'
  };
}

function createQuickStartHeroDraft(): CharacterCreationDraft {
  return {
    ...createDefaultDraft(),
    skillRanks: { climb: 4, jump: 4, intimidate: 4 },
    selectedFeats: ['power_attack', 'cleave', 'improved_initiative']
  };
}

function getActiveWizardSteps(
  draft: CharacterCreationDraft,
  sys: DnD35SystemContent
): ReadonlyArray<WizardStepDescriptor> {
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  const intMod = computeAbilityModifier((draft.baseAbilityScores.int ?? 10) + (race?.abilityAdjustments.int ?? 0));
  const spellBudget = cls
    ? computeClassSpellSelectionBudget(cls, 0, 1, intMod, draft.prohibitedSchools, draft.domains, [], sys)
    : undefined;
  const includeSpells = spellBudget?.requiresManualSelection === true;

  const baseSteps: WizardStepDescriptor[] = [
    { id: 'race', label: '1. Race' },
    { id: 'class', label: '2. Class & Paths' },
    { id: 'abilities', label: '3. Ability Scores' },
    { id: 'skills', label: '4. Skills' },
    { id: 'feats', label: '5. Feats' }
  ];
  if (includeSpells) {
    baseSteps.push({ id: 'spells', label: `6. ${cls?.name ?? ''} Spells`.trim() });
    baseSteps.push({ id: 'equipment', label: '7. Equipment' });
    baseSteps.push({ id: 'summary', label: '8. Review & Identity' });
  } else {
    baseSteps.push({ id: 'equipment', label: '6. Equipment' });
    baseSteps.push({ id: 'summary', label: '7. Review & Identity' });
  }
  return baseSteps;
}

let draftRevision = 0;

/**
 * Resets the character creation wizard draft state for a fresh campaign start.
 */
export function resetDnD35eCharBuilderDraft(_state: GameState): void {
  draftRevision += 1;
}

/** Props for `<DnD35eCharBuilderModal />`. */
export interface DnD35eCharBuilderModalProps {
  readonly state: GameState;
}

/**
 * Declarative Preact D&D 3.5e Character Creation Wizard Modal.
 */
export function DnD35eCharBuilderModal({ state }: DnD35eCharBuilderModalProps): JSX.Element {
  return <DnD35eCharBuilderWizardInner key={draftRevision} state={state} />;
}

function DnD35eCharBuilderWizardInner({ state }: DnD35eCharBuilderModalProps): JSX.Element {
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [showMonstrousRaces, setShowMonstrousRaces] = useState<boolean>(false);
  const [showNpcClasses, setShowNpcClasses] = useState<boolean>(false);
  const [draft, setDraft] = useState<CharacterCreationDraft>(() => createDefaultDraft());

  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);

  if (!sys || playerId === undefined) {
    return (
      <ModalShell title="Character Creation" size="md" showCloseButton={false} closeOnBackdrop={false}>
        <div className="ui-dnd-sheet-body">
          <p className="ui-dnd-card__sub">Unable to load D&amp;D 3.5e System Content for character creation.</p>
          <Button
            variant="primary"
            onClick={() => {
              setGameState(closeCartridgeModal(state));
              markAllDomainsDirty();
            }}
          >
            Continue to Dungeon
          </Button>
        </div>
      </ModalShell>
    );
  }

  let effectiveDraft = draft;
  if (!effectiveDraft.spriteManuallySelected) {
    const hints = expandDnD35SpriteHints(effectiveDraft.raceId, effectiveDraft.classId);
    const suggestedSpriteId = suggestCharacterSprites(
      collectCatalogSpriteEntries(state.campaign.theme),
      hints.primary,
      hints.secondary
    )[0]?.spriteId;
    if (suggestedSpriteId && effectiveDraft.spriteId !== suggestedSpriteId) {
      effectiveDraft = { ...effectiveDraft, spriteId: suggestedSpriteId };
    }
  }

  const currencyCfg = resolveCurrencyConfig(state);
  const activeSteps = getActiveWizardSteps(effectiveDraft, sys);
  const safeStepIndex = Math.min(stepIndex, activeSteps.length - 1);
  const activeStep = activeSteps[safeStepIndex] ?? activeSteps[0]!;
  const currentStepCheck = validateCharacterCreationStep(
    effectiveDraft,
    activeStep.id,
    sys,
    state.campaign.items,
    currencyCfg
  );

  const canNavigateToStep = (targetIdx: number): boolean => {
    if (targetIdx <= safeStepIndex) return true;
    for (let i = 0; i < targetIdx; i++) {
      const st = activeSteps[i];
      if (st && !validateCharacterCreationStep(effectiveDraft, st.id, sys, state.campaign.items, currencyCfg).valid) {
        return false;
      }
    }
    return true;
  };

  const updateDraft = (next: CharacterCreationDraft): void => {
    setDraft(sanitizeDraftOnRaceOrClassChange(next, sys));
  };

  const tabs: TabItem[] = activeSteps.map((stepDesc, idx) => {
    const valid = validateCharacterCreationStep(
      effectiveDraft,
      stepDesc.id,
      sys,
      state.campaign.items,
      currencyCfg
    ).valid;
    return {
      id: stepDesc.id,
      label: stepDesc.label,
      badge: valid ? '✓' : '!',
      disabled: !canNavigateToStep(idx)
    };
  });

  const allStepsValid = activeSteps.every(
    (st) => validateCharacterCreationStep(effectiveDraft, st.id, sys, state.campaign.items, currencyCfg).valid
  );

  const finalizeDraft = (chosenDraft: CharacterCreationDraft): void => {
    let nextState = applyCharacterCreationToPlayer(state, playerId, chosenDraft);
    nextState = updateExploredTiles(nextState);
    setGameState(closeCartridgeModal(nextState));
    invalidateViewportSnapshot();
    markAllDomainsDirty();
  };

  const footer = (
    <div className="ui-dnd-wizard-footer">
      <Button variant="secondary" onClick={() => finalizeDraft(createQuickStartHeroDraft())}>
        ⚡ Quick Start Default Hero
      </Button>

      <div className="ui-dnd-list-row__actions">
        {safeStepIndex > 0 ? (
          <Button variant="secondary" onClick={() => setStepIndex(safeStepIndex - 1)}>
            ← Previous
          </Button>
        ) : null}

        {safeStepIndex < activeSteps.length - 1 ? (
          <Button
            variant="primary"
            disabled={!currentStepCheck.valid}
            onClick={() => {
              if (!currentStepCheck.valid) return;
              setStepIndex(safeStepIndex + 1);
            }}
          >
            Next Step →
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!allStepsValid}
            onClick={() => {
              if (!allStepsValid) return;
              finalizeDraft(effectiveDraft);
            }}
          >
            ✔ Embark into the Dungeon
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <ModalShell
      title="⚔️ D&D 3.5e Character Creation"
      subtitle="Build your Level 1 adventurer across Race, Class, Abilities, Skills, Feats, Spells & Equipment"
      size="xl"
      scrollMode="panes"
      showCloseButton={false}
      closeOnBackdrop={false}
      footer={footer}
    >
      <div className="ui-dnd-sheet-body">
        <Tabs
          tabs={tabs}
          activeTabId={activeStep.id}
          ariaLabel="Character creation steps"
          onSelectTab={(tabId) => {
            const targetIdx = activeSteps.findIndex((s) => s.id === tabId);
            if (targetIdx >= 0 && canNavigateToStep(targetIdx)) {
              setStepIndex(targetIdx);
            }
          }}
        />

        {activeStep.id === 'race' ? (
          <CharBuilderRaceStep
            state={state}
            draft={effectiveDraft}
            showMonstrousRaces={showMonstrousRaces}
            onToggleMonstrousRaces={() => setShowMonstrousRaces((prev) => !prev)}
            onUpdateDraft={updateDraft}
          />
        ) : activeStep.id === 'class' ? (
          <CharBuilderClassStep
            state={state}
            draft={effectiveDraft}
            showNpcClasses={showNpcClasses}
            onToggleNpcClasses={() => setShowNpcClasses((prev) => !prev)}
            onUpdateDraft={updateDraft}
          />
        ) : activeStep.id === 'abilities' ? (
          <CharBuilderAbilitiesStep state={state} draft={effectiveDraft} onUpdateDraft={updateDraft} />
        ) : activeStep.id === 'skills' ? (
          <CharBuilderSkillsStep state={state} draft={effectiveDraft} onUpdateDraft={updateDraft} />
        ) : activeStep.id === 'feats' ? (
          <CharBuilderFeatsStep state={state} draft={effectiveDraft} onUpdateDraft={updateDraft} />
        ) : activeStep.id === 'spells' ? (
          <CharBuilderSpellsStep state={state} draft={effectiveDraft} onUpdateDraft={updateDraft} />
        ) : activeStep.id === 'equipment' ? (
          <CharBuilderEquipmentStep state={state} draft={effectiveDraft} sys={sys} onUpdateDraft={updateDraft} />
        ) : (
          <CharBuilderSummaryStep
            state={state}
            playerId={playerId}
            draft={effectiveDraft}
            onUpdateDraft={updateDraft}
          />
        )}

        {!currentStepCheck.valid && currentStepCheck.reason ? (
          <div className="ui-dnd-banner ui-dnd-banner--warning">
            {`⚠ Required before proceeding: ${currentStepCheck.reason}`}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
