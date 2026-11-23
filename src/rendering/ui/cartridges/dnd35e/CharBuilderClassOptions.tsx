/**
 * @file Character Creation Class-Specific Options (Cleric Domains, Arcane Schools, Familiar, Companion, Favored Enemy).
 */

import type { JSX } from 'preact';
import {
  type CharacterCreationDraft,
  validateSpecialistSchoolSelection
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { getCanonicalBaseWeapons } from '../../../../rulesets/dnd35e/equipment_physics.ts';
import type { DnD35SpellSchool } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import type {
  DnD35ClassDefinition,
  DnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';

const SPELL_SCHOOLS: ReadonlyArray<DnD35SpellSchool> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
  'universal'
];

/** Props for `<CharBuilderClassOptions />`. */
export interface CharBuilderClassOptionsProps {
  readonly sys: DnD35SystemContent;
  readonly activeCls: DnD35ClassDefinition;
  readonly activeFeatures: ReadonlyArray<string>;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Renders declarative Level 1 class sub-choices driven by active class features.
 */
export function CharBuilderClassOptions({
  sys,
  activeCls,
  activeFeatures,
  draft,
  onUpdateDraft
}: CharBuilderClassOptionsProps): JSX.Element {
  const hasClericDomains = activeFeatures.includes('cleric_domains') || activeFeatures.includes('deity_domains');
  const hasArcaneSpec = activeFeatures.includes('arcane_school_specialization');
  const grantsFamiliar =
    hasArcaneSpec ||
    activeFeatures.some(
      (fId) => activeCls.featureDetails[fId]?.scalingPoolContribution?.poolId === 'familiar_master_effective_level'
    );
  const grantsAnimalCompanion = activeFeatures.some(
    (fId) =>
      activeCls.featureDetails[fId]?.scalingPoolContribution?.poolId === 'animal_companion_effective_level' &&
      (activeCls.featureDetails[fId]?.scalingPoolContribution?.minClassLevel ?? 1) <= 1
  );
  const grantsFavoredEnemy = activeFeatures.some((fId) => fId.startsWith('favored_enemy_'));

  const activeSchool = draft.arcaneSchool ?? 'universal';
  const specCheck = validateSpecialistSchoolSelection(activeSchool, draft.prohibitedSchools);
  const reqProhibCount = activeSchool === 'divination' ? 1 : 2;
  const familiars = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('familiar'));
  const companions = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('animal_companion'));
  const enemyTypes = Object.keys(sys.creatureTypes ?? {});
  const weapons = getCanonicalBaseWeapons(sys);
  const curWpn = draft.deityFavoredWeaponId ?? 'longsword';
  const curFe = draft.favoredEnemyType ?? 'undead';

  return (
    <div className="ui-dnd-card-list">
      {hasClericDomains ? (
        <>
          <div className="ui-dnd-subbanner">
            <span>{`Cleric Domains (${draft.domains.length} / 2 selected)`}</span>
          </div>
          <div className="ui-dnd-card-list">
            {Object.values(sys.domains).map((dom) => {
              const chosen = draft.domains.includes(dom.id);
              const alignAllowed = !dom.allowedAlignments || dom.allowedAlignments.includes(draft.alignment);
              const alignNote = !alignAllowed ? ` [Alignment Mismatch: ${dom.allowedAlignments?.join('/')}]` : '';
              return (
                <button
                  key={dom.id}
                  type="button"
                  disabled={!alignAllowed && !chosen}
                  className={[
                    'ui-dnd-list-row',
                    chosen ? 'ui-dnd-list-row--selected' : '',
                    !alignAllowed && !chosen ? 'ui-dnd-list-row--disabled' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={!alignAllowed ? `Requires alignment in: ${dom.allowedAlignments?.join(', ')}` : undefined}
                  onClick={() => {
                    if (!alignAllowed && !chosen) return;
                    const nextDomains = chosen
                      ? draft.domains.filter((d) => d !== dom.id)
                      : draft.domains.length < 2
                        ? [...draft.domains, dom.id]
                        : draft.domains;
                    onUpdateDraft({
                      ...draft,
                      domains: nextDomains,
                      ...(nextDomains.includes('war')
                        ? { deityFavoredWeaponId: draft.deityFavoredWeaponId ?? 'longsword' }
                        : { deityFavoredWeaponId: undefined })
                    });
                  }}
                >
                  <span>{`${chosen ? '☑' : '☐'} ${dom.name} — ${dom.grantedPowerDescription}${alignNote}`}</span>
                </button>
              );
            })}
          </div>

          {draft.domains.includes('war') ? (
            <>
              <div className="ui-dnd-subbanner">War Domain: Deity&apos;s Favored Weapon</div>
              <div className="ui-dnd-chip-row">
                {weapons.map((wpn) => (
                  <Chip
                    key={wpn.id}
                    active={curWpn === wpn.id}
                    onClick={() => onUpdateDraft({ ...draft, deityFavoredWeaponId: wpn.id })}
                  >
                    {wpn.name}
                  </Chip>
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {hasArcaneSpec ? (
        <>
          <div className="ui-dnd-subbanner">
            <span>Arcane School</span>
            <Badge tone={specCheck.valid ? 'success' : 'warning'}>
              {specCheck.valid ? 'Valid' : (specCheck.reason ?? 'Select prohibited schools')}
            </Badge>
          </div>
          <div className="ui-dnd-chip-row">
            {SPELL_SCHOOLS.map((school) => (
              <Chip
                key={school}
                active={activeSchool === school}
                onClick={() => onUpdateDraft({ ...draft, arcaneSchool: school, prohibitedSchools: [] })}
              >
                {school}
              </Chip>
            ))}
          </div>

          {activeSchool !== 'universal' ? (
            <>
              <div className="ui-dnd-subbanner">{`Prohibited Schools (${draft.prohibitedSchools.length} / ${reqProhibCount})`}</div>
              <div className="ui-dnd-chip-row">
                {SPELL_SCHOOLS.filter((s) => s !== 'universal' && s !== 'divination' && s !== activeSchool).map(
                  (pSchool) => {
                    const isProhib = draft.prohibitedSchools.includes(pSchool);
                    return (
                      <Chip
                        key={pSchool}
                        active={isProhib}
                        onClick={() => {
                          const nextProhib = isProhib
                            ? draft.prohibitedSchools.filter((s) => s !== pSchool)
                            : draft.prohibitedSchools.length < reqProhibCount
                              ? [...draft.prohibitedSchools, pSchool]
                              : draft.prohibitedSchools;
                          onUpdateDraft({ ...draft, prohibitedSchools: nextProhib });
                        }}
                      >
                        {`${isProhib ? '✖ ' : ''}${pSchool}`}
                      </Chip>
                    );
                  }
                )}
              </div>
            </>
          ) : null}
        </>
      ) : null}

      {grantsFamiliar ? (
        <>
          <div className="ui-dnd-subbanner">Summon Familiar</div>
          <div className="ui-dnd-chip-row">
            {familiars.map((fam) => {
              const isCur = draft.familiarId === fam.id;
              const mod0 = fam.masterEffectBundle?.modifiers?.[0];
              const bonusDesc = mod0 ? `+${mod0.value} ${mod0.target.replace('skill:', '')}` : 'Alertness';
              return (
                <Chip
                  key={fam.id}
                  active={isCur}
                  onClick={() => onUpdateDraft({ ...draft, familiarId: isCur ? undefined : fam.id })}
                >
                  {`${fam.name} (${bonusDesc})`}
                </Chip>
              );
            })}
          </div>
        </>
      ) : null}

      {grantsAnimalCompanion ? (
        <>
          <div className="ui-dnd-subbanner">1st-Level Animal Companion</div>
          <div className="ui-dnd-chip-row">
            {companions.map((comp) => (
              <Chip
                key={comp.id}
                active={draft.animalCompanionId === comp.id}
                onClick={() => onUpdateDraft({ ...draft, animalCompanionId: comp.id })}
              >
                {`${comp.name} (AC +${comp.naturalArmorBonus ?? 0}, Spd ${comp.baseLandSpeedFt}ft)`}
              </Chip>
            ))}
          </div>
        </>
      ) : null}

      {grantsFavoredEnemy ? (
        <>
          <div className="ui-dnd-subbanner">1st Favored Enemy (+2 Bonus)</div>
          <div className="ui-dnd-chip-row">
            {enemyTypes.map((feType) => (
              <Chip
                key={feType}
                active={curFe === feType}
                onClick={() => onUpdateDraft({ ...draft, favoredEnemyType: feType })}
              >
                {feType}
              </Chip>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
