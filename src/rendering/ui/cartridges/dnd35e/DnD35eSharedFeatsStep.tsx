/**
 * @file Shared D&D 3.5e Feats Selection Step (Milestone 164).
 * Reused across Level 1 Character Creation and Levels 2-20 Level-Up Advancement.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import {
  buildCreationDraftPrerequisiteContext,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  type FeatSlotDescriptor,
  isFeatAllowedInSlot
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { getCanonicalBaseWeapons } from '../../../../rulesets/dnd35e/equipment_physics.ts';
import { evaluatePrerequisiteAST, type PrerequisiteEvalContext } from '../../../../rulesets/dnd35e/prerequisites.ts';
import {
  type DnD35FeatDefinition,
  type DnD35SystemContent,
  getDnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { scoreFuzzyTextMatch } from '../../../../utils/fuzzy_match.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { Select, TextInput } from '../../primitives/FormControls.tsx';
import { classifyDnD35eFeatCategory, DnD35eFeatInspector } from './DnD35eInspector.tsx';

type FeatFilterMode =
  | 'all'
  | 'eligible'
  | 'fighter'
  | 'combat'
  | 'metamagic'
  | 'item_creation'
  | 'spellcasting'
  | 'skill'
  | 'proficiency'
  | 'monster'
  | 'non_srd';

const TARGETED_SCHOOLS: ReadonlyArray<string> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation'
];

/** Canonical D&D 3.5e natural weapon identifiers for targeted monster feats. */
export const CANONICAL_NATURAL_WEAPONS: ReadonlyArray<string> = [
  'bite',
  'claw',
  'gore',
  'slam',
  'sting',
  'talon',
  'tentacle',
  'pincers'
];

/** Canonical D&D 3.5e special attack identifiers for Ability Focus targeting. */
export const CANONICAL_SPECIAL_ATTACKS: ReadonlyArray<string> = [
  'breath_weapon',
  'poison',
  'paralysis',
  'disease',
  'gaze',
  'energy_drain',
  'web',
  'spittle',
  'constrict',
  'trample',
  'stun'
];

/**
 * Resolves weapon or natural-weapon target IDs for a repeatable feat declaratively from its
 * `repeatable` metadata (`allowedTargets`, `targetCategory`, and `weaponProficiencyFilter`).
 */
export function getTargetedWeaponOptions(
  sys: DnD35SystemContent,
  repeatable?: DnD35FeatDefinition['repeatable'],
  prereqCtx?: PrerequisiteEvalContext
): ReadonlyArray<string> {
  if (repeatable?.allowedTargets && repeatable.allowedTargets.length > 0) {
    return repeatable.allowedTargets;
  }
  if (repeatable?.targetCategory === 'natural_weapon') {
    if (prereqCtx?.naturalWeaponIds && prereqCtx.naturalWeaponIds.length > 0) {
      return prereqCtx.naturalWeaponIds;
    }
    return CANONICAL_NATURAL_WEAPONS;
  }
  const canonicalWeapons = getCanonicalBaseWeapons(sys);
  if (repeatable?.weaponProficiencyFilter) {
    return canonicalWeapons
      .filter((w) => w.weaponStats?.proficiencyCategory === repeatable.weaponProficiencyFilter)
      .map((w) => w.id);
  }
  const canonicalIds = canonicalWeapons.map((w) => w.id);
  return Array.from(new Set([...canonicalIds, 'unarmed_strike', ...CANONICAL_NATURAL_WEAPONS]));
}

/**
 * Resolves the selectable target IDs for any targeted feat purely from its `repeatable` metadata.
 */
export function getFeatTargetOptions(
  sys: DnD35SystemContent,
  feat: DnD35FeatDefinition,
  prereqCtx?: PrerequisiteEvalContext
): ReadonlyArray<string> {
  const repeatable = feat.repeatable;
  const tCat = repeatable?.targetCategory;
  if (tCat === 'weapon' || tCat === 'natural_weapon') {
    return getTargetedWeaponOptions(sys, repeatable, prereqCtx);
  }
  if (tCat === 'school') {
    return repeatable?.allowedTargets && repeatable.allowedTargets.length > 0
      ? repeatable.allowedTargets
      : TARGETED_SCHOOLS;
  }
  if (tCat === 'ability') {
    if (repeatable?.allowedTargets && repeatable.allowedTargets.length > 0) {
      return repeatable.allowedTargets;
    }
    if (prereqCtx) {
      const ownedSpecialAttacks = Array.from(
        new Set(
          prereqCtx.tags
            .filter((t) => t.startsWith('special_attack:'))
            .map((t) => t.slice('special_attack:'.length))
            .filter((id) => id.length > 0)
        )
      );
      if (ownedSpecialAttacks.length > 0) {
        return ownedSpecialAttacks;
      }
    }
    return CANONICAL_SPECIAL_ATTACKS;
  }
  if (repeatable?.allowedTargets && repeatable.allowedTargets.length > 0) {
    return repeatable.allowedTargets;
  }
  return Object.keys(sys.skills ?? {});
}

/** Props for `<DnD35eSharedFeatsStep />`. */
export interface DnD35eSharedFeatsStepProps {
  readonly sys: DnD35SystemContent;
  readonly slotSummaryLabel: string;
  readonly totalSlots: number;
  readonly slots?: ReadonlyArray<FeatSlotDescriptor> | undefined;
  readonly alreadyOwnedFeatIds: ReadonlyArray<string>;
  readonly selectedFeatIds: ReadonlyArray<string>;
  readonly prereqCtx: PrerequisiteEvalContext;
  readonly onUpdateSelectedFeats: (nextFeats: string[]) => void;
}

/**
 * Shared 2-pane Feat Selection step with fuzzy search, category filter chips, and repeatable target pickers.
 */
export function DnD35eSharedFeatsStep({
  sys,
  slotSummaryLabel,
  totalSlots,
  slots,
  alreadyOwnedFeatIds,
  selectedFeatIds,
  prereqCtx,
  onUpdateSelectedFeats
}: DnD35eSharedFeatsStepProps): JSX.Element {
  const [filterMode, setFilterMode] = useState<FeatFilterMode>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [inspectedFeatId, setInspectedFeatId] = useState<string>('');
  const [selectedTargetByFeatId, setSelectedTargetByFeatId] = useState<Record<string, string>>({});

  const allFeats = Object.values(sys.feats).sort((a, b) => a.name.localeCompare(b.name));
  const hasNonSrdFeats = allFeats.some((f) => (f.sourceOrigin ?? 'srd') !== 'srd');
  const resolvedInspectedId = sys.feats[inspectedFeatId] ? inspectedFeatId : (allFeats[0]?.id ?? '');
  const activeFeat = sys.feats[resolvedInspectedId] ?? allFeats[0];

  const activeSlot = slots?.[selectedFeatIds.length];
  const chainedFeats = Array.from(new Set([...prereqCtx.feats, ...selectedFeatIds]));

  const featModes: Array<{ readonly id: FeatFilterMode; readonly label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'eligible', label: 'Eligible' },
    { id: 'fighter', label: 'Fighter Bonus' },
    { id: 'combat', label: 'Combat' },
    { id: 'metamagic', label: 'Metamagic' },
    { id: 'item_creation', label: 'Item Creation' },
    { id: 'spellcasting', label: 'Spellcasting' },
    { id: 'skill', label: 'Skill & Utility' },
    { id: 'proficiency', label: 'Proficiency' },
    { id: 'monster', label: 'Monster / Natural' }
  ];
  if (hasNonSrdFeats) {
    featModes.push({ id: 'non_srd', label: 'Homebrew / Non-SRD' });
  }

  const trimmedQuery = searchQuery.trim();
  const evaluatedFeats = allFeats
    .map((feat) => {
      const matchingSelected = selectedFeatIds.filter((f) => f === feat.id || f.startsWith(`${feat.id}:`));
      const isSelected = matchingSelected.length > 0;
      const isTargeted = feat.repeatable?.mode === 'targeted';
      const isStacking = feat.repeatable?.mode === 'stacking';

      const targetOpts = isTargeted ? getFeatTargetOptions(sys, feat, prereqCtx) : [];
      const curTarget = isTargeted
        ? selectedTargetByFeatId[feat.id] && targetOpts.includes(selectedTargetByFeatId[feat.id]!)
          ? selectedTargetByFeatId[feat.id]
          : targetOpts[0]
        : undefined;

      const candidateId = isTargeted && curTarget ? `${feat.id}:${curTarget}` : feat.id;
      const evalCtx: PrerequisiteEvalContext = {
        ...prereqCtx,
        feats: chainedFeats,
        ...(curTarget ? { targetId: curTarget } : {})
      };

      const alreadyOwned = isStacking
        ? false
        : isTargeted
          ? alreadyOwnedFeatIds.includes(candidateId)
          : alreadyOwnedFeatIds.includes(feat.id);
      const alreadyPickedCurrentTarget = isTargeted && selectedFeatIds.includes(candidateId);
      const allowedInSlot = activeSlot ? isFeatAllowedInSlot(feat, activeSlot) : true;
      const meets = activeSlot?.ignorePrerequisites
        ? true
        : feat.prerequisites
          ? evaluatePrerequisiteAST(feat.prerequisites, evalCtx)
          : true;
      const cat = classifyDnD35eFeatCategory(feat);

      let matchesCategory = true;
      if (filterMode === 'eligible') matchesCategory = meets && !alreadyOwned && allowedInSlot;
      else if (filterMode === 'fighter') matchesCategory = cat.isFighterBonus;
      else if (filterMode === 'combat') matchesCategory = cat.isCombat;
      else if (filterMode === 'metamagic') matchesCategory = cat.isMetamagic;
      else if (filterMode === 'item_creation') matchesCategory = cat.isItemCreation;
      else if (filterMode === 'spellcasting') matchesCategory = cat.isSpellcasting;
      else if (filterMode === 'skill') matchesCategory = cat.isSkillUtility;
      else if (filterMode === 'proficiency') matchesCategory = cat.isProficiency;
      else if (filterMode === 'monster') matchesCategory = cat.isMonster;
      else if (filterMode === 'non_srd') matchesCategory = cat.isNonSrd;

      let fuzzyScore: number | null = 0;
      if (trimmedQuery.length > 0) {
        const searchCandidate = `${feat.name} ${feat.description} ${feat.sourceOrigin ?? 'srd'}`;
        fuzzyScore = scoreFuzzyTextMatch(trimmedQuery, searchCandidate);
      }

      return {
        feat,
        matchingSelected,
        isSelected,
        isTargeted,
        isStacking,
        targetOpts,
        curTarget,
        candidateId,
        alreadyOwned,
        alreadyPickedCurrentTarget,
        allowedInSlot,
        meets,
        matchesCategory,
        fuzzyScore
      };
    })
    .filter((entry) => entry.matchesCategory && (trimmedQuery.length === 0 || entry.fuzzyScore !== null));

  if (trimmedQuery.length > 0) {
    evaluatedFeats.sort((a, b) => (b.fuzzyScore ?? 0) - (a.fuzzyScore ?? 0) || a.feat.name.localeCompare(b.feat.name));
  }

  const activeFeatTarget = activeFeat ? selectedTargetByFeatId[activeFeat.id] : undefined;

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-filter-bar">
          <Badge tone={selectedFeatIds.length >= totalSlots ? 'success' : 'warning'}>{slotSummaryLabel}</Badge>
          <TextInput
            type="search"
            ariaLabel="Search feats"
            placeholder="Fuzzy search feats by name or effect..."
            value={searchQuery}
            onInput={setSearchQuery}
          />
          <div className="ui-dnd-chip-row">
            {featModes.map((fm) => (
              <Chip key={fm.id} active={filterMode === fm.id} onClick={() => setFilterMode(fm.id)}>
                {fm.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="ui-dnd-card-list">
          {evaluatedFeats.length === 0 ? (
            <div className="ui-dnd-card__sub">No feats match the active search or category filter.</div>
          ) : null}
          {evaluatedFeats.map((entry) => {
            const {
              feat,
              matchingSelected,
              isSelected,
              isTargeted,
              isStacking,
              targetOpts,
              curTarget,
              candidateId,
              alreadyOwned,
              alreadyPickedCurrentTarget,
              allowedInSlot,
              meets
            } = entry;

            const canAddMore =
              !alreadyOwned &&
              !alreadyPickedCurrentTarget &&
              allowedInSlot &&
              meets &&
              selectedFeatIds.length < totalSlots &&
              (!isSelected || isStacking || isTargeted);
            const canToggle = isSelected || canAddMore;

            const targetBadge =
              matchingSelected.length > 0
                ? isStacking && matchingSelected.length > 1
                  ? ` (x${matchingSelected.length})`
                  : ` (${matchingSelected
                      .map((m) => (m.includes(':') ? m.split(':')[1] : ''))
                      .filter(Boolean)
                      .join(', ')})`
                : '';
            const statusPrefix = alreadyOwned ? '✔ [Owned]' : isSelected ? '☑' : meets && allowedInSlot ? '🟢' : '🔴';

            const rowClasses = [
              'ui-dnd-list-row',
              isSelected ? 'ui-dnd-list-row--selected' : '',
              resolvedInspectedId === feat.id ? 'ui-dnd-list-row--inspected' : ''
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                key={feat.id}
                className={rowClasses}
                role="button"
                tabIndex={0}
                onClick={() => setInspectedFeatId(feat.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setInspectedFeatId(feat.id);
                  }
                }}
              >
                <div className="ui-dnd-list-row__main">
                  <span className="ui-dnd-card__title">{`${statusPrefix} ${feat.name}${targetBadge}`}</span>
                </div>

                <div className="ui-dnd-list-row__actions" onClick={(e) => e.stopPropagation()}>
                  {isTargeted && targetOpts.length > 0 ? (
                    <Select
                      ariaLabel={`${feat.name} target`}
                      value={curTarget ?? targetOpts[0]!}
                      options={targetOpts.map((o) => ({ value: o, label: o.replace(/_/g, ' ') }))}
                      onChange={(nextVal) => {
                        setSelectedTargetByFeatId((prev) => ({ ...prev, [feat.id]: nextVal }));
                        setInspectedFeatId(feat.id);
                      }}
                    />
                  ) : null}

                  {(isStacking || isTargeted) && isSelected && canAddMore ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setInspectedFeatId(feat.id);
                        onUpdateSelectedFeats([...selectedFeatIds, candidateId]);
                      }}
                    >
                      + Add
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant={isSelected ? 'danger' : 'primary'}
                    disabled={!canToggle}
                    onClick={() => {
                      setInspectedFeatId(feat.id);
                      if (isSelected) {
                        if (isStacking) {
                          const idx = selectedFeatIds.lastIndexOf(feat.id);
                          const nextFeats =
                            idx >= 0 ? selectedFeatIds.filter((_, i) => i !== idx) : [...selectedFeatIds];
                          onUpdateSelectedFeats(nextFeats);
                          return;
                        }
                        if (isTargeted && alreadyPickedCurrentTarget) {
                          onUpdateSelectedFeats(selectedFeatIds.filter((id) => id !== candidateId));
                          return;
                        }
                        onUpdateSelectedFeats(
                          selectedFeatIds.filter((id) => id !== feat.id && !id.startsWith(`${feat.id}:`))
                        );
                        return;
                      }
                      onUpdateSelectedFeats([...selectedFeatIds, candidateId]);
                    }}
                  >
                    {isSelected ? 'Remove' : 'Select'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        {activeFeat ? (
          <DnD35eFeatInspector
            feat={activeFeat}
            prereqCtx={{
              ...prereqCtx,
              feats: chainedFeats,
              ...(activeFeatTarget ? { targetId: activeFeatTarget } : {})
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Props for `<CharBuilderFeatsStep />`. */
export interface CharBuilderFeatsStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Character Creation Step 5 (Feats) wrapper delegating to `<DnD35eSharedFeatsStep />`.
 */
export function CharBuilderFeatsStep({ state, draft, onUpdateDraft }: CharBuilderFeatsStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return null;

  const race = sys.races[draft.raceId];
  const cls = sys.classes[draft.classId];
  const budget = computeFirstLevelFeatSlotBudget(race, cls, draft.selectedAcfs);
  const basePrereqCtx = buildCreationDraftPrerequisiteContext(draft, sys, []);
  const prereqCtx = buildCreationDraftPrerequisiteContext(draft, sys, draft.selectedFeats);
  const parts = budget.slots.map((s) => s.label);

  return (
    <DnD35eSharedFeatsStep
      sys={sys}
      slotSummaryLabel={`Feats Selected: ${draft.selectedFeats.length} / ${budget.totalSlots} (${parts.join(' + ')})`}
      totalSlots={budget.totalSlots}
      slots={budget.slots}
      alreadyOwnedFeatIds={basePrereqCtx.feats}
      selectedFeatIds={draft.selectedFeats}
      prereqCtx={prereqCtx}
      onUpdateSelectedFeats={(nextFeats) => onUpdateDraft({ ...draft, selectedFeats: nextFeats })}
    />
  );
}
