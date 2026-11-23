/**
 * @file Shared D&D 3.5e Per-Class Spell Selection Step (Milestone 164).
 * Enforces Wizard Spellbook Scribed budgets (`3 + INT` at Lv 1, `+2` at Lv 2+) and Spontaneous Spells Known deltas.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { computeAbilityModifier } from '../../../../rulesets/dnd35e/abilities.ts';
import {
  type CharacterCreationDraft,
  type ClassSpellSelectionBudget,
  computeClassSpellSelectionBudget,
  getSpellLevelForClass,
  isSpellSelectableForDraft
} from '../../../../rulesets/dnd35e/character_builder.ts';
import type { DnD35Alignment, DnD35SpellSchool } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import {
  type DnD35SystemContent,
  getDnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { DnD35eSpellInspector } from './DnD35eInspector.tsx';

/** Props for `<DnD35eSharedSpellsStep />`. */
export interface DnD35eSharedSpellsStepProps {
  readonly sys: DnD35SystemContent;
  readonly classId: string;
  readonly className: string;
  readonly budget: ClassSpellSelectionBudget;
  readonly priorKnownSpells: ReadonlyArray<string>;
  readonly selectedSpells: ReadonlyArray<string>;
  readonly prohibitedSchools: ReadonlyArray<DnD35SpellSchool>;
  readonly domains: ReadonlyArray<string>;
  readonly alignment?: DnD35Alignment | undefined;
  readonly onUpdateSelectedSpells: (nextSpells: string[]) => void;
}

/**
 * Shared 2-pane Per-Class Spell Selection step for Character Creation and Level-Up Advancement.
 */
export function DnD35eSharedSpellsStep({
  sys,
  classId,
  className,
  budget,
  priorKnownSpells,
  selectedSpells,
  prohibitedSchools,
  domains,
  alignment,
  onUpdateSelectedSpells
}: DnD35eSharedSpellsStepProps): JSX.Element {
  const [spellLevelFilter, setSpellLevelFilter] = useState<number | 'all'>('all');
  const [inspectedSpellId, setInspectedSpellId] = useState<string>('magic_missile');

  if (!budget.requiresManualSelection || budget.maxCastableLevel < 0) {
    return (
      <div className="ui-dnd-banner ui-dnd-banner--info">
        {budget.spellAcquisitionMode === 'prayerbook_full_list'
          ? `Divine Prayerbook Rule: ${className} automatically accesses the full ${className} spell list (plus domain spells) up to Spell Level ${budget.maxCastableLevel} when preparing daily spells. No manual spell learning required.`
          : `${className} does not require manual spell selection at this level.`}
      </div>
    );
  }

  const effectiveFilter =
    spellLevelFilter !== 'all' && spellLevelFilter > budget.maxCastableLevel ? 'all' : spellLevelFilter;

  const manualSelected = selectedSpells.filter((id) => !budget.autoGrantedCantripIds.includes(id));
  const pickedByLevel: Record<number, number> = {};
  let nonZeroPicked = 0;
  for (const spId of manualSelected) {
    const sp = sys.spells[spId];
    if (!sp) continue;
    const lvl = getSpellLevelForClass(sp, classId, domains, [], sys.domains) ?? sp.level;
    pickedByLevel[lvl] = (pickedByLevel[lvl] ?? 0) + 1;
    if (lvl >= 1) nonZeroPicked += 1;
  }

  let summaryText = '';
  let budgetMet = false;
  if (budget.freePickCount > 0) {
    budgetMet = nonZeroPicked === budget.freePickCount;
    summaryText = `${className} Spellbook • Scribe Lv 1–${budget.maxCastableLevel} Spells: ${nonZeroPicked} / ${budget.freePickCount}`;
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
    budgetMet = allExact;
    summaryText = `${className} Spells • ${parts.join(' | ')}${cantripNote}`;
  }

  const eligibleSpells = Object.values(sys.spells).filter(
    (sp) =>
      isSpellSelectableForDraft(
        sp,
        classId,
        budget.maxCastableLevel,
        prohibitedSchools,
        domains,
        alignment,
        sys.domains
      ).selectable
  );

  const resolvedInspectedId = eligibleSpells.some((s) => s.id === inspectedSpellId)
    ? inspectedSpellId
    : (eligibleSpells[0]?.id ?? '');
  const activeSpell = sys.spells[resolvedInspectedId] ?? eligibleSpells[0];

  const levelChips: number[] = [];
  for (let lvl = 0; lvl <= budget.maxCastableLevel; lvl++) {
    levelChips.push(lvl);
  }

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-filter-bar">
          <Badge tone={budgetMet ? 'success' : 'warning'}>{summaryText}</Badge>
          <div className="ui-dnd-chip-row">
            <Chip active={effectiveFilter === 'all'} onClick={() => setSpellLevelFilter('all')}>
              All Levels
            </Chip>
            {levelChips.map((lvl) => (
              <Chip key={lvl} active={effectiveFilter === lvl} onClick={() => setSpellLevelFilter(lvl)}>
                {`Lv ${lvl}`}
              </Chip>
            ))}
          </div>
        </div>

        <div className="ui-dnd-card-list">
          {eligibleSpells.map((spell) => {
            const check = isSpellSelectableForDraft(
              spell,
              classId,
              budget.maxCastableLevel,
              prohibitedSchools,
              domains,
              alignment,
              sys.domains
            );
            const effLvl = check.effectiveLevel ?? spell.level;
            if (effectiveFilter !== 'all' && effLvl !== effectiveFilter) return null;

            const isAutoCantrip = budget.autoGrantedCantripIds.includes(spell.id);
            const isAlreadyOwned = priorKnownSpells.includes(spell.id);
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

            const statusIcon = isAutoCantrip ? '✔ [Auto]' : isAlreadyOwned ? '✔ [Known]' : isPicked ? '☑' : '☐';
            const rowClasses = [
              'ui-dnd-list-row',
              isPicked || isAutoCantrip ? 'ui-dnd-list-row--selected' : '',
              resolvedInspectedId === spell.id ? 'ui-dnd-list-row--inspected' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={spell.id}
                className={rowClasses}
                role="button"
                tabIndex={0}
                onClick={() => setInspectedSpellId(spell.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInspectedSpellId(spell.id);
                  }
                }}
              >
                <span className="ui-dnd-card__title">{`${statusIcon} [Lv ${effLvl}] ${spell.name} (${spell.school})`}</span>
                <Button
                  size="sm"
                  variant={isPicked ? 'danger' : 'primary'}
                  disabled={isAutoCantrip || isAlreadyOwned || (!isPicked && !canAdd)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInspectedSpellId(spell.id);
                    const nextSpells = isPicked
                      ? manualSelected.filter((id) => id !== spell.id)
                      : [...manualSelected, spell.id];
                    onUpdateSelectedSpells(nextSpells);
                  }}
                >
                  {isAutoCantrip ? 'Auto' : isAlreadyOwned ? 'Known' : isPicked ? 'Remove' : 'Add'}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        {activeSpell ? <DnD35eSpellInspector spell={activeSpell} classId={classId} domainIds={domains} /> : null}
      </div>
    </div>
  );
}

/** Props for `<CharBuilderSpellsStep />`. */
export interface CharBuilderSpellsStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Character Creation Step 6 (Starting Spells) wrapper delegating to `<DnD35eSharedSpellsStep />`.
 */
export function CharBuilderSpellsStep({ state, draft, onUpdateDraft }: CharBuilderSpellsStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return null;
  const cls = sys.classes[draft.classId];
  const race = sys.races[draft.raceId];
  if (!cls || !race) return null;

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

  return (
    <DnD35eSharedSpellsStep
      sys={sys}
      classId={cls.id}
      className={cls.name}
      budget={budget}
      priorKnownSpells={[]}
      selectedSpells={draft.knownSpells}
      prohibitedSchools={draft.prohibitedSchools}
      domains={draft.domains}
      alignment={draft.alignment}
      onUpdateSelectedSpells={(nextSpells) => onUpdateDraft({ ...draft, knownSpells: nextSpells })}
    />
  );
}
