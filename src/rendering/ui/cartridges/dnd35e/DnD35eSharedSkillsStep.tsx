/**
 * @file Shared D&D 3.5e Skills Allocation Step (Milestone 164).
 * Reused across Level 1 Character Creation and Levels 2-20 Level-Up Advancement.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import { computeAbilityModifier } from '../../../../rulesets/dnd35e/abilities.ts';
import {
  applyCharacterCreationToPlayer,
  calculateLevelSkillPointBudget,
  calculateSkillAllocationCost,
  type CharacterCreationDraft,
  getEffectiveClassSkillIds,
  getSkillMaxRanks
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { computeSkillSynergyBonus } from '../../../../rulesets/dnd35e/skills.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { ALL_ABILITY_IDS, type AbilityId } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import {
  type DnD35SystemContent,
  getDnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { scoreFuzzyTextMatch } from '../../../../utils/fuzzy_match.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { TextInput } from '../../primitives/FormControls.tsx';
import { DnD35eSkillInspector } from './DnD35eInspector.tsx';

type SkillFilterMode = 'all' | 'class' | 'knowledge' | 'trained' | 'invested';

/** Props for `<DnD35eSharedSkillsStep />`. */
export interface DnD35eSharedSkillsStepProps {
  readonly sys: DnD35SystemContent;
  readonly totalHd: number;
  readonly budget: number;
  readonly activeLevelClassSkillIds: ReadonlyArray<string>;
  readonly everClassSkillIds: ReadonlyArray<string>;
  readonly priorSkillRanks: Readonly<Record<string, number>>;
  readonly addedSkillRanks: Readonly<Record<string, number>>;
  readonly abilityModifiers: Readonly<Record<AbilityId, number>>;
  readonly miscSkillBonuses: Readonly<Record<string, number>>;
  readonly onUpdateAddedRanks: (nextAddedRanks: Record<string, number>) => void;
}

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Shared 2-pane Skill Allocation step with fuzzy search, Knowledge & attribute filters.
 */
export function DnD35eSharedSkillsStep({
  sys,
  totalHd,
  budget,
  activeLevelClassSkillIds,
  everClassSkillIds,
  priorSkillRanks,
  addedSkillRanks,
  abilityModifiers,
  miscSkillBonuses,
  onUpdateAddedRanks
}: DnD35eSharedSkillsStepProps): JSX.Element {
  const [filterMode, setFilterMode] = useState<SkillFilterMode>('all');
  const [abilityFilter, setAbilityFilter] = useState<AbilityId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inspectedSkillId, setInspectedSkillId] = useState<string>('tumble');

  const spent = calculateSkillAllocationCost(addedSkillRanks, activeLevelClassSkillIds);
  const remaining = Math.max(0, Math.round((budget - spent) * 100) / 100);

  const mergedRanks: Record<string, number> = { ...priorSkillRanks };
  for (const [k, v] of Object.entries(addedSkillRanks)) {
    mergedRanks[k] = Math.round(((mergedRanks[k] ?? 0) + v) * 10) / 10;
  }

  const allSkills = Object.values(sys.skills).sort((a, b) => a.name.localeCompare(b.name));
  const resolvedInspectedId = sys.skills[inspectedSkillId] ? inspectedSkillId : (allSkills[0]?.id ?? '');
  const activeSkill = sys.skills[resolvedInspectedId] ?? allSkills[0];

  const modes: ReadonlyArray<{ readonly id: SkillFilterMode; readonly label: string }> = [
    { id: 'all', label: `All (${allSkills.length})` },
    { id: 'class', label: 'Class' },
    { id: 'knowledge', label: 'Knowledge' },
    { id: 'trained', label: 'Trained-Only' },
    { id: 'invested', label: 'Invested' }
  ];

  const trimmedQuery = searchQuery.trim();
  const filteredSkills = allSkills
    .map((skill) => {
      const isActiveClass = activeLevelClassSkillIds.includes(skill.id);
      const isEverClass = everClassSkillIds.includes(skill.id);
      const priorRanks = priorSkillRanks[skill.id] ?? 0;
      const addedDelta = addedSkillRanks[skill.id] ?? 0;
      const totalRanks = Math.round((priorRanks + addedDelta) * 10) / 10;
      const isKnowledge = skill.skillGroup === 'knowledge' || skill.studiedCreatureTags.length > 0;

      let matchesCategory = true;
      if (filterMode === 'class') matchesCategory = isEverClass;
      else if (filterMode === 'knowledge') matchesCategory = isKnowledge;
      else if (filterMode === 'trained') matchesCategory = skill.trainedOnly;
      else if (filterMode === 'invested') matchesCategory = totalRanks > 0;

      const matchesAttr = abilityFilter === 'all' || skill.keyAbility === abilityFilter;
      let fuzzyScore: number | null = 0;
      if (trimmedQuery.length > 0) {
        const searchCandidate = `${skill.name} ${skill.keyAbility} ${skill.synergyNotes ?? ''}`;
        fuzzyScore = scoreFuzzyTextMatch(trimmedQuery, searchCandidate);
      }

      return {
        skill,
        isActiveClass,
        isEverClass,
        priorRanks,
        addedDelta,
        totalRanks,
        matchesCategory,
        matchesAttr,
        fuzzyScore
      };
    })
    .filter(
      (entry) => entry.matchesCategory && entry.matchesAttr && (trimmedQuery.length === 0 || entry.fuzzyScore !== null)
    );

  if (trimmedQuery.length > 0) {
    filteredSkills.sort(
      (a, b) => (b.fuzzyScore ?? 0) - (a.fuzzyScore ?? 0) || a.skill.name.localeCompare(b.skill.name)
    );
  }

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-filter-bar">
          <Badge tone={remaining > 0 ? 'warning' : 'success'}>
            {`Points Remaining: ${remaining} / ${budget} (Spent: ${spent})`}
          </Badge>
          <TextInput
            type="search"
            ariaLabel="Search skills"
            placeholder="Fuzzy search skills by name or synergy..."
            value={searchQuery}
            onInput={setSearchQuery}
          />
          <div className="ui-dnd-chip-row">
            {modes.map((m) => (
              <Chip key={m.id} active={filterMode === m.id} onClick={() => setFilterMode(m.id)}>
                {m.label}
              </Chip>
            ))}
          </div>
          <div className="ui-dnd-chip-row">
            <Chip active={abilityFilter === 'all'} onClick={() => setAbilityFilter('all')}>
              Any Attr
            </Chip>
            {ALL_ABILITY_IDS.map((ab) => (
              <Chip key={ab} active={abilityFilter === ab} onClick={() => setAbilityFilter(ab)}>
                {ab.toUpperCase()}
              </Chip>
            ))}
          </div>
        </div>

        <div className="ui-dnd-card-list">
          {filteredSkills.length === 0 ? (
            <div className="ui-dnd-card__sub">No skills match the active search or filter criteria.</div>
          ) : null}
          {filteredSkills.map((entry) => {
            const { skill, isActiveClass, isEverClass, priorRanks, addedDelta, totalRanks } = entry;

            const maxRanks = getSkillMaxRanks(totalHd, isEverClass);
            const rankStep = isActiveClass ? 1 : 0.5;
            const abMod = abilityModifiers[skill.keyAbility] ?? 0;
            const synBonus = computeSkillSynergyBonus(skill.synergyFromSkills, mergedRanks);
            const miscBonus = miscSkillBonuses[skill.id] ?? 0;
            const totalMod = Math.floor(totalRanks) + abMod + synBonus + miscBonus;
            const bonusSum = abMod + synBonus + miscBonus;

            const costLabel = isActiveClass
              ? 'Class (1pt/rk)'
              : isEverClass
                ? 'Prior Class Cap • Cross Cost (1pt/0.5rk)'
                : 'Cross (1pt/0.5rk)';
            const priorNote = priorRanks > 0 ? ` • Prior ${priorRanks}` : '';

            const rowClasses = [
              'ui-dnd-list-row',
              addedDelta > 0 ? 'ui-dnd-list-row--selected' : '',
              resolvedInspectedId === skill.id ? 'ui-dnd-list-row--inspected' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={skill.id}
                className={rowClasses}
                role="button"
                tabIndex={0}
                onClick={() => setInspectedSkillId(skill.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInspectedSkillId(skill.id);
                  }
                }}
              >
                <div className="ui-dnd-list-row__main">
                  <strong className="ui-dnd-card__title">{`${skill.name} (${skill.keyAbility.toUpperCase()})`}</strong>
                  <span className="ui-dnd-card__sub">
                    {`${costLabel}${priorNote} • Total ${formatSigned(totalMod)} (Bonus ${formatSigned(bonusSum)})`}
                  </span>
                </div>

                <div className="ui-dnd-list-row__actions">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={addedDelta <= 0}
                    title={`Decrease ${skill.name} ranks`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectedSkillId(skill.id);
                      const nextVal = Math.max(0, Math.round((addedDelta - rankStep) * 10) / 10);
                      const nextAdded = { ...addedSkillRanks };
                      if (nextVal <= 0) {
                        delete nextAdded[skill.id];
                      } else {
                        nextAdded[skill.id] = nextVal;
                      }
                      onUpdateAddedRanks(nextAdded);
                    }}
                  >
                    −
                  </Button>
                  <span className="ui-dnd-mono">
                    {priorRanks > 0 ? `+${addedDelta} (${totalRanks}/${maxRanks})` : `${totalRanks}/${maxRanks}`}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={totalRanks + rankStep > maxRanks || remaining < 1}
                    title={`Increase ${skill.name} ranks`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setInspectedSkillId(skill.id);
                      const nextDelta = Math.min(
                        Math.max(0, maxRanks - priorRanks),
                        Math.round((addedDelta + rankStep) * 10) / 10
                      );
                      onUpdateAddedRanks({
                        ...addedSkillRanks,
                        [skill.id]: nextDelta
                      });
                    }}
                  >
                    +
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        {activeSkill ? (
          <DnD35eSkillInspector
            skill={activeSkill}
            currentRanks={mergedRanks[activeSkill.id] ?? 0}
            allRanks={mergedRanks}
            abilityMod={abilityModifiers[activeSkill.keyAbility] ?? 0}
            miscBonus={miscSkillBonuses[activeSkill.id] ?? 0}
            isClassSkill={everClassSkillIds.includes(activeSkill.id)}
            maxRanks={getSkillMaxRanks(totalHd, everClassSkillIds.includes(activeSkill.id))}
            sys={sys}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Props for `<CharBuilderSkillsStep />`. */
export interface CharBuilderSkillsStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Character Creation Step 4 (Skills) wrapper delegating to `<DnD35eSharedSkillsStep />`.
 */
export function CharBuilderSkillsStep({ state, draft, onUpdateDraft }: CharBuilderSkillsStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return null;
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  if (!cls || !race) return null;

  const classSkillIds = getEffectiveClassSkillIds(cls, draft.domains, sys);
  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (race.abilityAdjustments.int ?? 0));
  const totalHd = Math.max(1, (race.rhdProgression?.baseHdCount ?? 0) + 1);
  const budget = calculateLevelSkillPointBudget(
    cls.skillPointsPerLevel,
    intMod,
    true,
    race.extraSkillPointsFirstLevel,
    race.extraSkillPointsPerLevel
  );

  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const previewData = getDnD35EntityData(previewState, playerId);

  const abilityModifiers: Record<AbilityId, number> = {
    str: computeAbilityModifier(draft.baseAbilityScores.str + (race.abilityAdjustments.str ?? 0)),
    dex: computeAbilityModifier(draft.baseAbilityScores.dex + (race.abilityAdjustments.dex ?? 0)),
    con: computeAbilityModifier(draft.baseAbilityScores.con + (race.abilityAdjustments.con ?? 0)),
    int: intMod,
    wis: computeAbilityModifier(draft.baseAbilityScores.wis + (race.abilityAdjustments.wis ?? 0)),
    cha: computeAbilityModifier(draft.baseAbilityScores.cha + (race.abilityAdjustments.cha ?? 0))
  };

  const miscSkillBonuses: Record<string, number> = {};
  for (const mod of previewData.statModifiers ?? []) {
    if (mod.targetStat.startsWith('skill:')) {
      const skId = mod.targetStat.slice('skill:'.length);
      miscSkillBonuses[skId] = (miscSkillBonuses[skId] ?? 0) + mod.value;
    }
  }

  return (
    <DnD35eSharedSkillsStep
      sys={sys}
      totalHd={totalHd}
      budget={budget}
      activeLevelClassSkillIds={classSkillIds}
      everClassSkillIds={classSkillIds}
      priorSkillRanks={{}}
      addedSkillRanks={draft.skillRanks}
      abilityModifiers={abilityModifiers}
      miscSkillBonuses={miscSkillBonuses}
      onUpdateAddedRanks={(nextAddedRanks) => onUpdateDraft({ ...draft, skillRanks: nextAddedRanks })}
    />
  );
}
