/**
 * @file Character Creation Step 2 (Class & Paths) for D&D 3.5e (Milestone 164).
 */

import type { JSX } from 'preact';
import {
  type CharacterCreationDraft,
  resolveClassSpellAcquisitionMode
} from '../../../../rulesets/dnd35e/character_builder.ts';
import type { DnD35Alignment } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { Chip } from '../../primitives/DataDisplay.tsx';
import { CharBuilderClassOptions } from './CharBuilderClassOptions.tsx';

const ALL_ALIGNMENTS: ReadonlyArray<DnD35Alignment> = ['LG', 'NG', 'CG', 'LN', 'N', 'CN', 'LE', 'NE', 'CE'];

/** Props for `<CharBuilderClassStep />`. */
export interface CharBuilderClassStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly showNpcClasses: boolean;
  readonly onToggleNpcClasses: () => void;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Step 2 (Class, Alignment, ACFs & Class Options) of the D&D 3.5e Character Creation Wizard.
 */
export function CharBuilderClassStep({
  state,
  draft,
  showNpcClasses,
  onToggleNpcClasses,
  onUpdateDraft
}: CharBuilderClassStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return null;

  const classes = Object.values(sys.classes).filter((c) => !c.isPrestige && (showNpcClasses || !c.isNpcClass));
  const activeCls = sys.classes[draft.classId];

  const activeFeatures = activeCls
    ? Object.keys(activeCls.featureDetails).filter((fId) => {
        const row = activeCls.progression[0];
        const hasBase = row?.features.includes(fId) ?? false;
        const swapReplaced = activeCls.acfSwaps.some(
          (s) => s.level === 1 && draft.selectedAcfs.includes(s.acfId) && s.replacesFeature === fId
        );
        const swapGranted = activeCls.acfSwaps.some(
          (s) => s.level === 1 && draft.selectedAcfs.includes(s.acfId) && s.grantedFeature === fId
        );
        return (hasBase && !swapReplaced) || swapGranted;
      })
    : [];

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-filter-bar">
          <span>{showNpcClasses ? 'Base & NPC Classes' : 'Core Base Classes (11)'}</span>
          <Chip active={showNpcClasses} onClick={onToggleNpcClasses}>
            {showNpcClasses ? 'Hide NPC Classes' : 'Show NPC Classes'}
          </Chip>
        </div>

        <div className="ui-dnd-card-list">
          {classes.map((cls) => {
            const row1 = cls.progression[0] ?? { bab: 0, fortSave: 0, refSave: 0, willSave: 0 };
            const isSelected = draft.classId === cls.id;
            return (
              <button
                key={cls.id}
                type="button"
                className={isSelected ? 'ui-dnd-list-row ui-dnd-list-row--selected' : 'ui-dnd-list-row'}
                onClick={() =>
                  onUpdateDraft({
                    ...draft,
                    classId: cls.id,
                    selectedAcfs: [],
                    domains: [],
                    prohibitedSchools: []
                  })
                }
              >
                <strong className="ui-dnd-card__title">{cls.name}</strong>
                <span className="ui-dnd-card__sub">
                  {`d${cls.hitDieSides} HD • BAB +${row1.bab} • ${cls.skillPointsPerLevel}+INT Skills`}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        {activeCls ? (
          <>
            <h3 className="ui-dnd-inspector__title">{`${activeCls.name} (d${activeCls.hitDieSides} Hit Die)`}</h3>

            <div className="ui-dnd-card">
              {activeCls.progression.slice(0, 5).map((row) => {
                const featsStr = row.features.length > 0 ? ` [${row.features.join(', ')}]` : '';
                return (
                  <div key={row.level} className="ui-dnd-card__sub ui-dnd-mono">
                    {`Lv ${row.level}: BAB +${row.bab} | Fort +${row.fortSave}, Ref +${row.refSave}, Will +${row.willSave}${featsStr}`}
                  </div>
                );
              })}
            </div>

            {resolveClassSpellAcquisitionMode(activeCls) === 'prayerbook_full_list' ? (
              <div className="ui-dnd-banner ui-dnd-banner--success">
                {`Divine Prayerbook Rule: ${activeCls.name} automatically knows the full ${activeCls.name} spell list (plus domain spells) for all castable levels; no manual spell learning step required.`}
              </div>
            ) : null}

            <div className="ui-dnd-subbanner">Alignment</div>
            <div className="ui-dnd-chip-row">
              {(activeCls.allowedAlignments ?? ALL_ALIGNMENTS).map((align) => (
                <Chip
                  key={align}
                  active={draft.alignment === align}
                  onClick={() => onUpdateDraft({ ...draft, alignment: align })}
                >
                  {align}
                </Chip>
              ))}
            </div>

            {activeCls.acfSwaps.filter((a) => a.level === 1).length > 0 ? (
              <>
                <div className="ui-dnd-subbanner">Level 1 Alternate Class Features (ACFs)</div>
                <div className="ui-dnd-card-list">
                  {activeCls.acfSwaps
                    .filter((a) => a.level === 1)
                    .map((acf) => {
                      const meetsSchool = !acf.requiredArcaneSchool || draft.arcaneSchool === acf.requiredArcaneSchool;
                      const isChecked = draft.selectedAcfs.includes(acf.acfId);
                      const reqSuffix =
                        acf.requiredArcaneSchool && !meetsSchool
                          ? ` [Requires ${acf.requiredArcaneSchool} specialist]`
                          : '';
                      return (
                        <button
                          key={acf.acfId}
                          type="button"
                          disabled={!meetsSchool && !isChecked}
                          className={[
                            'ui-dnd-list-row',
                            isChecked ? 'ui-dnd-list-row--selected' : '',
                            !meetsSchool && !isChecked ? 'ui-dnd-list-row--disabled' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (!meetsSchool && !isChecked) return;
                            const nextAcfs = isChecked
                              ? draft.selectedAcfs.filter((id) => id !== acf.acfId)
                              : [...draft.selectedAcfs, acf.acfId];
                            onUpdateDraft({
                              ...draft,
                              selectedAcfs: nextAcfs,
                              ...(acf.replacesFeature === 'summon_familiar' ? { familiarId: undefined } : {}),
                              ...(acf.replacesFeature === 'animal_companion' ? { animalCompanionId: undefined } : {})
                            });
                          }}
                        >
                          <span>
                            {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})${reqSuffix}`}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </>
            ) : null}

            <CharBuilderClassOptions
              sys={sys}
              activeCls={activeCls}
              activeFeatures={activeFeatures}
              draft={draft}
              onUpdateDraft={onUpdateDraft}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
