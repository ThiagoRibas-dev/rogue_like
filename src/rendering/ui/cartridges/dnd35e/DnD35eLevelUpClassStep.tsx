/**
 * @file Stage 1 (Class, HP, Ability Boost, Prestige & Mid-Level Options) for D&D 3.5e Level-Up (Milestone 164).
 */

import type { JSX } from 'preact';
import type { LevelUpChoice } from '../../../../rulesets/dnd35e/character_builder.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../../../../rulesets/dnd35e/prerequisites.ts';
import {
  buildHitDieTrackFromClass,
  calculateMulticlassXpMultiplier,
  collectClassFeaturesUpToLevel,
  getClassLevelRow,
  type getEligibleBaseCastingClassesForPrestige
} from '../../../../rulesets/dnd35e/progression.ts';
import { ALL_ABILITY_IDS, type DnD35EntityData } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import type {
  DnD35ClassDefinition,
  DnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { Chip } from '../../primitives/DataDisplay.tsx';
import { resolveClassFeatureLabel } from './CharBuilderClassStep.tsx';

/** Hit Dice interval for ability score increases (`4`). */
export const ABILITY_INCREASE_HD_STEP = 4;

const FALLBACK_ROGUE_SPECIAL_ABILITIES: ReadonlyArray<string> = [
  'crippling_strike',
  'defensive_roll',
  'improved_evasion',
  'opportunist',
  'skill_mastery',
  'slippery_mind'
];

/** Props for `<DnD35eLevelUpClassStep />`. */
export interface DnD35eLevelUpClassStepProps {
  readonly dndData: DnD35EntityData;
  readonly prereqCtx: PrerequisiteEvalContext;
  readonly activeCls: DnD35ClassDefinition;
  readonly nextClassLevel: number;
  readonly newTotalHd: number;
  readonly prestigeSlots: ReturnType<typeof getEligibleBaseCastingClassesForPrestige>;
  readonly effectivePrestigeTargets: ReadonlyArray<string>;
  readonly draft: LevelUpChoice;
  readonly sys: DnD35SystemContent;
  readonly onUpdateDraft: (next: LevelUpChoice) => void;
}

/**
 * Renders the Class & Prerequisite Selection stage in the Level-Up Advancement modal.
 */
export function DnD35eLevelUpClassStep({
  dndData,
  prereqCtx,
  activeCls,
  nextClassLevel,
  newTotalHd,
  prestigeSlots,
  effectivePrestigeTargets,
  draft,
  sys,
  onUpdateDraft
}: DnD35eLevelUpClassStepProps): JSX.Element {
  const classes = Object.values(sys.classes);
  const existingAdvTrack = dndData.tracks.find((t) => t.trackId === activeCls.id);
  const prevClassLevel = existingAdvTrack ? existingAdvTrack.levels : 0;
  const rowDef = getClassLevelRow(activeCls, nextClassLevel);

  const simulatedTrack = buildHitDieTrackFromClass(activeCls, nextClassLevel);
  const simulatedTracks = dndData.tracks.map((t) => (t.trackId === activeCls.id ? simulatedTrack : t));
  if (!existingAdvTrack) simulatedTracks.push(simulatedTrack);
  const xpMult = calculateMulticlassXpMultiplier(simulatedTracks, sys.classes, dndData.favoredClass ?? 'any');

  const eligibleAcfs = activeCls.acfSwaps.filter((a) => {
    if (a.level !== nextClassLevel) return false;
    if (a.requiredArcaneSchool && dndData.arcaneSchool !== a.requiredArcaneSchool) return false;
    if (a.prerequisites && !evaluatePrerequisiteAST(a.prerequisites, prereqCtx)) return false;
    return true;
  });

  const prevFeatures = collectClassFeaturesUpToLevel(activeCls, prevClassLevel, dndData.selectedAcfs ?? []);
  const currFeatures = collectClassFeaturesUpToLevel(activeCls, nextClassLevel, [
    ...(dndData.selectedAcfs ?? []),
    ...(draft.selectedAcfs ?? [])
  ]);
  const newFeatures = currFeatures.filter((f: string): boolean => !prevFeatures.includes(f));

  const existingEnemies = (dndData.favoredEnemies ?? []).map((e) => e.creatureType);
  const enemyCandidates = Object.keys(sys.creatureTypes ?? {}).filter((c) => !existingEnemies.includes(c));
  const boostCandidates = Array.from(
    new Set([...existingEnemies, ...(draft.favoredEnemyAdded ? [draft.favoredEnemyAdded] : [])])
  );

  const prevCompPool = prevFeatures.reduce((max: number, fId: string): number => {
    const contrib = activeCls.featureDetails[fId]?.scalingPoolContribution;
    if (contrib?.poolId === 'animal_companion_effective_level') {
      return prevClassLevel >= (contrib.minClassLevel ?? 1)
        ? Math.max(max, prevClassLevel * contrib.multiplier + contrib.offset)
        : max;
    }
    return max;
  }, 0);
  const nextCompPool = currFeatures.reduce((max: number, fId: string): number => {
    const contrib = activeCls.featureDetails[fId]?.scalingPoolContribution;
    if (contrib?.poolId === 'animal_companion_effective_level') {
      return nextClassLevel >= (contrib.minClassLevel ?? 1)
        ? Math.max(max, nextClassLevel * contrib.multiplier + contrib.offset)
        : max;
    }
    return max;
  }, 0);
  const hasAnimalCompanion =
    dndData.animalCompanionId !== undefined ||
    (dndData.companions ?? []).some((c) => c.tags.includes('animal_companion'));
  const companions = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('animal_companion'));

  const rogueFeatId = newFeatures.find((f: string): boolean => f.startsWith('rogue_special_ability_'));
  const roguePool = rogueFeatId
    ? (activeCls.featureDetails[rogueFeatId]?.bonusFeatPool ?? FALLBACK_ROGUE_SPECIAL_ABILITIES)
    : [];

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-card-list">
          {classes.map((cls) => {
            const existingTrack = dndData.tracks.find((t) => t.trackId === cls.id);
            const curLevel = existingTrack ? existingTrack.levels : 0;
            const isAdvancing = draft.classId === cls.id;
            const atCap = curLevel >= cls.maxLevel;
            const meetsAlign =
              !cls.allowedAlignments || cls.allowedAlignments.length === 0
                ? true
                : cls.allowedAlignments.includes(dndData.alignment ?? 'N');
            const meetsPrereq = cls.prerequisites ? evaluatePrerequisiteAST(cls.prerequisites, prereqCtx) : true;
            const isEligible = !atCap && meetsAlign && meetsPrereq;

            const reasonText = atCap
              ? 'At Maximum Level'
              : !meetsAlign
                ? `Requires Alignment: ${cls.allowedAlignments?.join('/')}`
                : !meetsPrereq
                  ? 'Prerequisites Not Met'
                  : 'Eligible';

            return (
              <button
                key={cls.id}
                type="button"
                disabled={!isEligible}
                className={[
                  'ui-dnd-list-row',
                  isAdvancing ? 'ui-dnd-list-row--selected' : '',
                  !isEligible ? 'ui-dnd-list-row--disabled' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  if (!isEligible || cls.id === draft.classId) return;
                  onUpdateDraft({
                    classId: cls.id,
                    hpMethod: draft.hpMethod,
                    ...(draft.abilityScoreIncrease !== undefined
                      ? { abilityScoreIncrease: draft.abilityScoreIncrease }
                      : {}),
                    addedSkillRanks: {},
                    selectedFeats: [],
                    selectedAcfs: [],
                    learnedSpells: [],
                    advancedSpellcastingClassIds: [],
                    learnedSpellsByClass: {}
                  });
                }}
              >
                <div className="ui-dnd-list-row__main">
                  <strong className="ui-dnd-card__title">
                    {`${cls.name} (${curLevel > 0 ? `Lv ${curLevel}` : 'New Class'})`}
                  </strong>
                  <span className="ui-dnd-card__sub">
                    {`d${cls.hitDieSides} HD • ${cls.isPrestige ? 'Prestige' : 'Base'} • ${reasonText}`}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        <h3 className="ui-dnd-inspector__title">{`Advancing: ${activeCls.name} (Level ${nextClassLevel})`}</h3>

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            {`Hit Die: d${activeCls.hitDieSides} (Gain +${Math.floor(activeCls.hitDieSides / 2) + 1} HP avg + CON mod)`}
          </div>
          <div className="ui-dnd-card__sub ui-dnd-mono">
            {`BAB: +${rowDef?.bab ?? 0} | Fort: +${rowDef?.fortSave ?? 0} | Ref: +${rowDef?.refSave ?? 0} | Will: +${rowDef?.willSave ?? 0}`}
          </div>
          <div className="ui-dnd-card__sub">
            {`Features: ${
              rowDef?.features && rowDef.features.length > 0
                ? rowDef.features.map((fId) => resolveClassFeatureLabel(fId, activeCls, sys)).join(', ')
                : 'None'
            }`}
          </div>
        </div>

        {xpMult < 1.0 ? (
          <div className="ui-dnd-banner ui-dnd-banner--warning">
            {`⚠ Multiclass XP Penalty: Non-favored class levels are uneven. Future XP gains will be reduced by -${Math.round((1.0 - xpMult) * 100)}%.`}
          </div>
        ) : null}

        {newTotalHd % ABILITY_INCREASE_HD_STEP === 0 ? (
          <>
            <div className="ui-dnd-subbanner">+1 Ability Score Increase (Every 4th Hit Die)</div>
            <div className="ui-dnd-chip-row">
              {ALL_ABILITY_IDS.map((key) => (
                <Chip
                  key={key}
                  active={draft.abilityScoreIncrease === key}
                  onClick={() => onUpdateDraft({ ...draft, abilityScoreIncrease: key })}
                >
                  {`+1 ${key.toUpperCase()}`}
                </Chip>
              ))}
            </div>
          </>
        ) : null}

        {prestigeSlots.map((slot, slotIdx) => {
          const curTarget = effectivePrestigeTargets[slotIdx];
          return (
            <div key={`${slot.label}-${slotIdx}`} className="ui-dnd-card-list">
              <div className="ui-dnd-subbanner">{slot.label}</div>
              <div className="ui-dnd-chip-row">
                {slot.eligibleClassIds.map((candId) => (
                  <Chip
                    key={candId}
                    active={curTarget === candId}
                    onClick={() => {
                      const nextTargets = [...effectivePrestigeTargets];
                      nextTargets[slotIdx] = candId;
                      onUpdateDraft({ ...draft, advancedSpellcastingClassIds: nextTargets });
                    }}
                  >
                    {sys.classes[candId]?.name ?? candId}
                  </Chip>
                ))}
              </div>
            </div>
          );
        })}

        {eligibleAcfs.length > 0 ? (
          <>
            <div className="ui-dnd-subbanner">Alternate Class Features (ACFs)</div>
            <div className="ui-dnd-card-list">
              {eligibleAcfs.map((acf) => {
                const isChecked = (draft.selectedAcfs ?? []).includes(acf.acfId);
                const replacesLabel = resolveClassFeatureLabel(acf.replacesFeature, activeCls, sys);
                const grantedLabel = resolveClassFeatureLabel(acf.grantedFeature, activeCls, sys);
                return (
                  <button
                    key={acf.acfId}
                    type="button"
                    className={isChecked ? 'ui-dnd-list-row ui-dnd-list-row--selected' : 'ui-dnd-list-row'}
                    onClick={() => {
                      const cur = draft.selectedAcfs ?? [];
                      const nextAcfs = isChecked ? cur.filter((id) => id !== acf.acfId) : [...cur, acf.acfId];
                      onUpdateDraft({ ...draft, selectedAcfs: nextAcfs });
                    }}
                  >
                    <span>
                      {`${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${replacesLabel} → ${grantedLabel})`}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {newFeatures.includes('combat_style') ? (
          <>
            <div className="ui-dnd-subbanner">{`${activeCls.name} Combat Style`}</div>
            <div className="ui-dnd-chip-row">
              <Chip
                active={draft.combatStyle === 'archery'}
                onClick={() => onUpdateDraft({ ...draft, combatStyle: 'archery' })}
              >
                Archery (Rapid Shot)
              </Chip>
              <Chip
                active={draft.combatStyle === 'two_weapon'}
                onClick={() => onUpdateDraft({ ...draft, combatStyle: 'two_weapon' })}
              >
                Two-Weapon (Two-Weapon Fighting)
              </Chip>
            </div>
          </>
        ) : null}

        {newFeatures.some((f: string): boolean => f.startsWith('favored_enemy_')) ? (
          <>
            <div className="ui-dnd-subbanner">New Favored Enemy (+2 bonus)</div>
            <div className="ui-dnd-chip-row">
              {enemyCandidates.map((cand) => (
                <Chip
                  key={cand}
                  active={draft.favoredEnemyAdded === cand}
                  onClick={() => onUpdateDraft({ ...draft, favoredEnemyAdded: cand })}
                >
                  {cand}
                </Chip>
              ))}
            </div>
            {prevFeatures.some((f: string): boolean => f.startsWith('favored_enemy_')) ? (
              <>
                <div className="ui-dnd-subbanner">Boost Existing Favored Enemy (+2 bonus)</div>
                <div className="ui-dnd-chip-row">
                  {boostCandidates.map((cand) => (
                    <Chip
                      key={cand}
                      active={draft.favoredEnemyBoosted === cand}
                      onClick={() => onUpdateDraft({ ...draft, favoredEnemyBoosted: cand })}
                    >
                      {`+2 vs ${cand}`}
                    </Chip>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {prevCompPool === 0 && nextCompPool > 0 && !hasAnimalCompanion ? (
          <>
            <div className="ui-dnd-subbanner">{`${activeCls.name} Animal Companion`}</div>
            <div className="ui-dnd-chip-row">
              {companions.map((comp) => (
                <Chip
                  key={comp.id}
                  active={draft.animalCompanionId === comp.id}
                  onClick={() => onUpdateDraft({ ...draft, animalCompanionId: comp.id })}
                >
                  {comp.name}
                </Chip>
              ))}
            </div>
          </>
        ) : null}

        {rogueFeatId ? (
          <>
            <div className="ui-dnd-subbanner">{`${activeCls.name} Special Ability`}</div>
            <div className="ui-dnd-chip-row">
              {roguePool.map((saId) => (
                <Chip
                  key={saId}
                  active={draft.rogueSpecialAbility === saId}
                  onClick={() => onUpdateDraft({ ...draft, rogueSpecialAbility: saId })}
                >
                  {activeCls.featureDetails[saId]?.name ?? saId}
                </Chip>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
