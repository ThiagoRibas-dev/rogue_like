/**
 * @file Declarative Preact D&D 3.5e Right-Pane Inspectors (Milestone 163).
 * Shared across Character Sheet, Character Creation Wizard, and Level-Up modals.
 */

import type { JSX } from 'preact';
import { getSpellLevelForClass, SYNERGY_RANK_THRESHOLD } from '../../../../rulesets/dnd35e/character_builder.ts';
import {
  evaluatePrerequisiteAST,
  type PrerequisiteEvalContext,
  type PrerequisiteNode
} from '../../../../rulesets/dnd35e/prerequisites.ts';
import { computeSkillSynergyBonus, getSkillsGrantedSynergyBy } from '../../../../rulesets/dnd35e/skills.ts';
import { ALL_ABILITY_IDS } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import {
  type ContentSourceOrigin,
  type DnD35FeatDefinition,
  type DnD35RaceDefinition,
  type DnD35SkillDefinition,
  type DnD35SpellDefinition,
  type DnD35SystemContent,
  formatContentSourceOrigin
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { assertNever } from '../../../../utils/assert.ts';
import { Badge } from '../../primitives/DataDisplay.tsx';

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * Renders a provenance badge indicating whether a rule entity comes from SRD 3.5e,
 * official non-SRD material, 2nd/3rd-party sources, or homebrew.
 *
 * @param origin Optional provenance identifier (defaults to `'srd'`).
 * @returns Styled `<Badge />` element.
 */
export function renderSourceOriginBadge(origin?: ContentSourceOrigin): JSX.Element {
  const resolved: ContentSourceOrigin = origin ?? 'srd';
  const tone =
    resolved === 'homebrew'
      ? 'warning'
      : resolved === 'third_party' || resolved === 'second_party'
        ? 'info'
        : resolved === 'non_srd'
          ? 'danger'
          : 'neutral';
  return <Badge tone={tone}>{`Source: ${formatContentSourceOrigin(resolved)}`}</Badge>;
}

/** Declarative category flags derived for filtering D&D 3.5e feats. */
export interface DnD35eFeatCategoryFlags {
  readonly isFighterBonus: boolean;
  readonly isCombat: boolean;
  readonly isMetamagic: boolean;
  readonly isItemCreation: boolean;
  readonly isSpellcasting: boolean;
  readonly isMagic: boolean;
  readonly isSkillUtility: boolean;
  readonly isProficiency: boolean;
  readonly isMonster: boolean;
  readonly isNonSrd: boolean;
}

/**
 * Classifies a D&D 3.5e feat into declarative filter buckets using schema properties
 * without branching on specific feat IDs.
 *
 * @param feat Feat definition from System Content.
 * @returns Classification flags.
 */
export function classifyDnD35eFeatCategory(feat: DnD35FeatDefinition): DnD35eFeatCategoryFlags {
  const explicitCat = feat.featCategory;
  const isFighterBonus = feat.isFighterBonusFeat === true;
  const prereqJson = feat.prerequisites ? JSON.stringify(feat.prerequisites) : '';
  const descLower = feat.description.toLowerCase();
  const allModifiers = [...(feat.modifiers ?? []), ...(feat.effectBundle?.modifiers ?? [])];
  const allGrantedTags = feat.effectBundle?.grantedTags ?? [];

  const isMetamagic = explicitCat === 'metamagic' || feat.metamagicDescriptor !== undefined;

  const isProficiency =
    explicitCat === 'proficiency' ||
    feat.effectBundle?.category === 'proficiency' ||
    allGrantedTags.some((t) => t.startsWith('proficiency:')) ||
    descLower.includes('proficient with') ||
    descLower.includes('apply a shield') ||
    descLower.includes('armor check penalty');

  const isMonster =
    explicitCat === 'monster' ||
    feat.repeatable?.targetCategory === 'natural_weapon' ||
    prereqJson.includes('min_natural_') ||
    prereqJson.includes('min_fly_speed') ||
    prereqJson.includes('min_hands') ||
    prereqJson.includes('min_sla_caster_level') ||
    prereqJson.includes('size_in');

  const isSkillUtility =
    explicitCat === 'skill' ||
    feat.skillCheckCombatBonus !== undefined ||
    feat.repeatable?.targetCategory === 'skill' ||
    allModifiers.some((m) => m.target.startsWith('skill:'));

  const isSpellcasting =
    !isMetamagic &&
    (explicitCat === 'spellcasting' ||
      explicitCat === 'item_creation' ||
      feat.repeatable?.targetCategory === 'school' ||
      allModifiers.some((m) =>
        ['caster_level', 'spell_resistance', 'spell_penetration', 'spells_per_day', 'turn_undead', 'spell_dc'].some(
          (t) => m.target.includes(t)
        )
      ) ||
      prereqJson.includes('caster_level') ||
      prereqJson.includes('min_spell_level') ||
      descLower.includes('caster level') ||
      descLower.includes('turn undead') ||
      descLower.includes('spell slot') ||
      descLower.includes('cast spells'));

  const isMagic = isMetamagic || isSpellcasting;

  const isCombat =
    explicitCat === 'combat' ||
    isFighterBonus ||
    (feat.ruleOverrides !== undefined && feat.ruleOverrides.length > 0 && !isProficiency) ||
    (feat.activatedAbilities !== undefined && feat.activatedAbilities.length > 0) ||
    allModifiers.some((m) =>
      ['attack', 'damage', 'crit_threat_doubling', 'ac', 'initiative', 'grapple', 'trip', 'disarm'].some((t) =>
        m.target.includes(t)
      )
    ) ||
    prereqJson.includes('min_bab');

  const isItemCreation =
    explicitCat === 'item_creation' ||
    descLower.includes('create magic') ||
    descLower.includes('scribe a scroll') ||
    descLower.includes('brew a potion') ||
    descLower.includes('forge a magic');

  const isNonSrd = (feat.sourceOrigin ?? 'srd') !== 'srd';

  return {
    isFighterBonus,
    isCombat,
    isMetamagic,
    isItemCreation,
    isSpellcasting,
    isMagic,
    isSkillUtility,
    isProficiency,
    isMonster,
    isNonSrd
  };
}

/**
 * Formats a D&D 3.5e prerequisite AST node into a concise human-readable requirement label.
 *
 * @param node Prerequisite AST node.
 * @param ctx Actor prerequisite evaluation context.
 * @returns Human-readable label.
 */
export function formatPrerequisiteLeafLabel(node: PrerequisiteNode, ctx: PrerequisiteEvalContext): string {
  switch (node.type) {
    case 'min_ability':
      return `${node.ability.toUpperCase()} ${node.minScore}+`;
    case 'min_bab':
      return `Base Attack Bonus +${node.minBab}`;
    case 'min_skill_ranks':
      return `Skill ${node.skillId}: ${node.minRanks}+ ranks`;
    case 'min_skill_count_at_ranks':
      return `${node.minCount}+ ${node.skillPrefix.replace(/_/g, '')} skills at ${node.minRanks}+ ranks`;
    case 'has_feat': {
      if (node.targetId === '$selected') return `Feat: ${node.featId} (${ctx.targetId ?? 'selected target'})`;
      if (node.targetId) return `Feat: ${node.featId} (${node.targetId})`;
      if (node.targetPrefix) return `Feat: ${node.featId} (any ${node.targetPrefix.replace(/_/g, '')})`;
      if (node.targetIdsAny && node.targetIdsAny.length > 0) {
        return `Feat: ${node.featId} (${node.targetIdsAny.join(' / ')})`;
      }
      return `Feat: ${node.featId}`;
    }
    case 'min_feat_count':
      return `${node.minCount}+ ${node.pool.replace(/_/g, ' ')} feats`;
    case 'min_caster_level':
      return `Caster Level ${node.minCasterLevel}+`;
    case 'min_class_level':
      return `${node.classId} Level ${node.minLevel}+`;
    case 'min_character_level':
      return `Character Level ${node.minLevel}+`;
    case 'has_proficiency':
      return node.scope === 'selected_weapon'
        ? `Proficiency with ${ctx.targetId ?? 'selected weapon'}`
        : `Proficiency: ${node.scope.replace(/_/g, ' ')}`;
    case 'min_natural_attacks':
      return ctx.targetId !== undefined && ctx.naturalWeaponIds !== undefined
        ? `${node.minCount}+ Natural Attacks (${ctx.targetId})`
        : `${node.minCount}+ Natural Attacks`;
    case 'min_hands':
      return `${node.minHands}+ Hands`;
    case 'min_natural_armor':
      return `Natural Armor +${node.minBonus} or higher`;
    case 'min_fly_speed':
      return `Fly Speed (${node.minSpeedFt > 1 ? `${node.minSpeedFt} ft+` : 'any'})`;
    case 'min_sla_caster_level':
      return `Spell-Like Ability at Caster Level ${node.minCasterLevel}+`;
    case 'has_tag':
      return node.tag.includes('$selected')
        ? `Trait/Feature: ${node.tag.replace('$selected', ctx.targetId ?? 'selected target')}`
        : `Trait/Feature: ${node.tag}`;
    case 'size_in':
      return `Size: ${node.allowedSizes.join(', ')}`;
    case 'race_in':
      return `Race: ${node.allowedRaces.join(', ')}`;
    case 'alignment_in':
      return `Alignment: ${node.allowedAlignments.join(', ')}`;
    case 'min_spell_level': {
      const modeStr = node.castingMode ? `${node.castingMode} ` : '';
      const schoolStr =
        node.school && node.minSchoolSpellCount ? ` (${node.minSchoolSpellCount}+ ${node.school} spells)` : '';
      return `Cast ${node.minSpellLevel}th-level ${modeStr}${node.tradition} spells${schoolStr}`;
    }
    case 'not':
      return `Not (${formatPrerequisiteLeafLabel(node.child, ctx)})`;
    case 'and':
    case 'or':
      return node.children.map((c) => formatPrerequisiteLeafLabel(c, ctx)).join(node.type === 'and' ? ' AND ' : ' OR ');
    default:
      return assertNever(node);
  }
}

function flattenAndPrereqs(node: PrerequisiteNode): ReadonlyArray<PrerequisiteNode> {
  if (node.type === 'and') {
    return node.children.flatMap(flattenAndPrereqs);
  }
  return [node];
}

/** Props for `<DnD35eRaceInspector />`. */
export interface DnD35eRaceInspectorProps {
  readonly race: DnD35RaceDefinition;
}

/**
 * Declarative right-pane inspector for a D&D 3.5e Race definition.
 */
export function DnD35eRaceInspector({ race }: DnD35eRaceInspectorProps): JSX.Element {
  const traits: string[] = [];
  if (race.darkvisionFt && race.darkvisionFt > 0) traits.push(`Darkvision ${race.darkvisionFt} ft.`);
  if (race.lowLightVision) traits.push('Low-Light Vision (see twice as far in shadowy illumination).');
  if (race.bonusFeatAtFirstLevel) traits.push('Bonus Feat: 1 extra general feat at 1st character level.');
  if (race.extraSkillPointsFirstLevel > 0) {
    traits.push(
      `Extra Skill Points: +${race.extraSkillPointsFirstLevel} at 1st level, +${race.extraSkillPointsPerLevel} per level thereafter.`
    );
  }
  if (race.unencumberedSpeedInHeavyArmor) {
    traits.push('Steady Stride: Base speed is never reduced by medium/heavy armor or medium/heavy load.');
  }
  if ((race.naturalArmorBonus ?? 0) > 0) {
    traits.push(`Natural Armor: +${race.naturalArmorBonus} natural armor bonus to AC.`);
  }
  for (const bundle of race.traitBundles) {
    traits.push(`${bundle.name}: ${bundle.description ?? 'Racial trait effect.'}`);
  }
  for (const mod of race.conditionalModifiers) {
    traits.push(`${mod.id}: ${formatSigned(mod.value)} ${mod.type} bonus to ${mod.target}`);
  }
  traits.push(`Automatic Languages: ${race.automaticLanguages.join(', ')}`);

  return (
    <div className="ui-dnd-inspector">
      <h3 className="ui-dnd-inspector__title">{race.name}</h3>
      <div className="ui-dnd-chip-row">
        {renderSourceOriginBadge(race.sourceOrigin)}
        <Badge>{`Size: ${race.size.toUpperCase()}`}</Badge>
        <Badge>{`Type: ${race.creatureType}`}</Badge>
        {race.subtypes.length > 0 ? <Badge>{`Subtypes: ${race.subtypes.join(', ')}`}</Badge> : null}
        <Badge>{`Speed: ${race.baseLandSpeedFt} ft`}</Badge>
        <Badge>{`Favored: ${race.favoredClass}`}</Badge>
        {race.levelAdjustment > 0 ? <Badge tone="warning">{`LA +${race.levelAdjustment}`}</Badge> : null}
        {(race.rhdProgression?.baseHdCount ?? 0) > 0 ? (
          <Badge tone="warning">{`Racial HD: ${race.rhdProgression?.baseHdCount}`}</Badge>
        ) : null}
      </div>

      <div className="ui-dnd-subbanner">Ability Score Adjustments</div>
      <div className="ui-dnd-chip-row">
        {ALL_ABILITY_IDS.map((ab) => {
          const adj = race.abilityAdjustments[ab] ?? 0;
          const tone = adj > 0 ? 'success' : adj < 0 ? 'danger' : 'neutral';
          return (
            <Badge key={ab} tone={tone}>
              {`${ab.toUpperCase()}: ${formatSigned(adj)}`}
            </Badge>
          );
        })}
      </div>

      <div className="ui-dnd-subbanner">Senses &amp; Racial Qualities</div>
      <div className="ui-dnd-card-list">
        {traits.map((line, i) => (
          <div key={i} className="ui-dnd-card__sub">
            {`• ${line}`}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Props for `<DnD35eSkillInspector />`. */
export interface DnD35eSkillInspectorProps {
  readonly skill: DnD35SkillDefinition;
  readonly currentRanks: number;
  readonly allRanks: Readonly<Record<string, number>>;
  readonly abilityMod: number;
  readonly miscBonus: number;
  readonly isClassSkill: boolean;
  readonly maxRanks: number;
  readonly sys: DnD35SystemContent;
}

/**
 * Declarative right-pane inspector for a D&D 3.5e Skill with full modifier & synergy breakdown.
 */
export function DnD35eSkillInspector({
  skill,
  currentRanks,
  allRanks,
  abilityMod,
  miscBonus,
  isClassSkill,
  maxRanks,
  sys
}: DnD35eSkillInspectorProps): JSX.Element {
  const wholeRanks = Math.floor(currentRanks);
  const synBonus = computeSkillSynergyBonus(skill.synergyFromSkills, allRanks);
  const totalMod = wholeRanks + abilityMod + synBonus + miscBonus;
  const outgoing = getSkillsGrantedSynergyBy(skill.id, sys.skills);

  return (
    <div className="ui-dnd-inspector">
      <h3 className="ui-dnd-inspector__title">{`${skill.name} (${skill.keyAbility.toUpperCase()})`}</h3>
      <div className="ui-dnd-chip-row">
        {renderSourceOriginBadge(skill.sourceOrigin)}
        <Badge tone={isClassSkill ? 'success' : 'warning'}>
          {isClassSkill ? 'Class Skill (1 pt/rank)' : 'Cross-Class (2 pts/rank)'}
        </Badge>
        <Badge tone={skill.trainedOnly ? 'warning' : 'info'}>
          {skill.trainedOnly ? 'Trained Only' : 'Usable Untrained'}
        </Badge>
        {skill.acpMultiplier > 0 ? <Badge tone="danger">{`ACP: ${skill.acpMultiplier}x`}</Badge> : null}
        <Badge>{`Take 10: ${skill.take10Allowed ? 'Yes' : 'No'}`}</Badge>
        <Badge>{`Take 20: ${skill.take20Allowed ? 'Yes' : 'No'}`}</Badge>
      </div>

      <div className="ui-dnd-subbanner">Check Modifier Breakdown</div>
      <div className="ui-dnd-inspector__breakdown">
        <span>{`Invested Ranks (Cap ${maxRanks}):`}</span>
        <strong className="ui-dnd-mono">{`${currentRanks} (${formatSigned(wholeRanks)})`}</strong>
        <span>{`Key Ability (${skill.keyAbility.toUpperCase()}):`}</span>
        <strong className="ui-dnd-mono">{formatSigned(abilityMod)}</strong>
        <span>Synergy Bonus (5+ rank skills):</span>
        <strong className="ui-dnd-mono">{formatSigned(synBonus)}</strong>
        <span>Racial / Feat / Misc Bonus:</span>
        <strong className="ui-dnd-mono">{formatSigned(miscBonus)}</strong>
        <span>Total Skill Check Modifier:</span>
        <strong className="ui-dnd-mono" style={{ color: 'var(--ui-accent-primary)' }}>
          {formatSigned(totalMod)}
        </strong>
      </div>

      <div className="ui-dnd-subbanner">Skill Synergies (5+ Ranks = +2)</div>
      <div className="ui-dnd-card-list">
        {skill.synergyFromSkills.map((srcId) => {
          const srcName = sys.skills[srcId]?.name ?? srcId;
          const srcRanks = Math.floor(allRanks[srcId] ?? 0);
          const unlocked = srcRanks >= SYNERGY_RANK_THRESHOLD;
          return (
            <div key={srcId} className={unlocked ? 'ui-dnd-prereq-met' : 'ui-dnd-card__sub'}>
              {`${unlocked ? '✔' : '○'} Receives +2 from ${srcName} (${srcRanks}/${SYNERGY_RANK_THRESHOLD} ranks)`}
            </div>
          );
        })}
        {outgoing.map((tgtId) => {
          const tgtName = sys.skills[tgtId]?.name ?? tgtId;
          const active = wholeRanks >= SYNERGY_RANK_THRESHOLD;
          return (
            <div key={tgtId} className={active ? 'ui-dnd-prereq-met' : 'ui-dnd-card__sub'}>
              {`→ 5+ ranks grants +2 synergy to ${tgtName}`}
            </div>
          );
        })}
        {skill.synergyNotes ? <div className="ui-dnd-card__sub">{skill.synergyNotes}</div> : null}
      </div>

      {skill.actions.length > 0 ? (
        <>
          <div className="ui-dnd-subbanner">Skill Actions &amp; Mechanics</div>
          <div className="ui-dnd-card-list">
            {skill.actions.map((act) => {
              const dcText =
                act.dc !== undefined
                  ? `DC ${act.dc}`
                  : act.opposedBySkill
                    ? `Opposed by ${act.opposedBySkill}`
                    : 'Check';
              return (
                <div key={act.name} className="ui-dnd-card">
                  <div className="ui-dnd-card__title">{`${act.name} [${act.actionCost} | ${dcText}]`}</div>
                  <div className="ui-dnd-card__sub">{act.description}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** Props for `<DnD35eFeatInspector />`. */
export interface DnD35eFeatInspectorProps {
  readonly feat: DnD35FeatDefinition;
  readonly prereqCtx: PrerequisiteEvalContext;
}

/**
 * Declarative right-pane inspector for a D&D 3.5e Feat definition.
 */
export function DnD35eFeatInspector({ feat, prereqCtx }: DnD35eFeatInspectorProps): JSX.Element {
  const prereqLeaves = feat.prerequisites ? flattenAndPrereqs(feat.prerequisites) : [];

  return (
    <div className="ui-dnd-inspector">
      <h3 className="ui-dnd-inspector__title">{feat.name}</h3>
      <div className="ui-dnd-chip-row">
        {renderSourceOriginBadge(feat.sourceOrigin)}
        {feat.isFighterBonusFeat ? <Badge tone="warning">Fighter Bonus Feat</Badge> : null}
        {feat.metamagicDescriptor !== undefined ? <Badge tone="info">Metamagic</Badge> : null}
      </div>
      <p className="ui-dnd-inspector__desc">{feat.description}</p>

      <div className="ui-dnd-subbanner">Prerequisites</div>
      {prereqLeaves.length === 0 ? (
        <div className="ui-dnd-prereq-met">✔ None (Available to any eligible character)</div>
      ) : (
        <div className="ui-dnd-card-list">
          {prereqLeaves.map((leaf, i) => {
            const met = evaluatePrerequisiteAST(leaf, prereqCtx);
            return (
              <div key={i} className={met ? 'ui-dnd-prereq-met' : 'ui-dnd-prereq-unmet'}>
                {`${met ? '✔' : '✕'} Requires ${formatPrerequisiteLeafLabel(leaf, prereqCtx)}`}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Props for `<DnD35eSpellInspector />`. */
export interface DnD35eSpellInspectorProps {
  readonly spell: DnD35SpellDefinition;
  readonly classId: string;
  readonly domainIds: ReadonlyArray<string>;
}

/**
 * Declarative right-pane inspector for a D&D 3.5e Spell definition.
 */
export function DnD35eSpellInspector({ spell, classId, domainIds }: DnD35eSpellInspectorProps): JSX.Element {
  const effLvl = getSpellLevelForClass(spell, classId, domainIds) ?? spell.level;
  const schoolLabel = spell.subschool
    ? `${spell.school.toUpperCase()} (${spell.subschool.toUpperCase()})`
    : spell.school.toUpperCase();

  const comps: string[] = [];
  if (spell.components.verbal) comps.push('V');
  if (spell.components.somatic) comps.push('S');
  if (spell.components.material) comps.push('M');
  if (spell.components.focus) comps.push('F');
  if (spell.components.divineFocus) comps.push('DF');
  if (spell.components.sacrifice) comps.push('Sacrifice');
  if (spell.components.xpCost) comps.push(`XP (${spell.components.xpCost})`);

  const availParts = [
    ...Object.entries(spell.levelByClass).map(([c, l]) => `${c} ${l}`),
    ...Object.entries(spell.levelByDomain).map(([d, l]) => `${d} domain ${l}`),
    ...Object.entries(spell.levelByAccessTag ?? {}).map(([t, l]) => `${t} ${l}`)
  ];

  return (
    <div className="ui-dnd-inspector">
      <h3 className="ui-dnd-inspector__title">{spell.name}</h3>
      <div className="ui-dnd-chip-row">
        {renderSourceOriginBadge(spell.sourceOrigin)}
        <Badge tone="info">{`School: ${schoolLabel}`}</Badge>
        {(spell.descriptors ?? []).map((tag) => (
          <Badge key={tag} tone="info">{`[${tag.toUpperCase()}]`}</Badge>
        ))}
        <Badge>{`Level: ${effLvl}`}</Badge>
        {spell.castingTime ? <Badge>{`Cast: ${spell.castingTime}`}</Badge> : null}
        {spell.range ? <Badge>{`Range: ${spell.range}`}</Badge> : null}
        {spell.duration ? <Badge>{`Duration: ${spell.duration}`}</Badge> : null}
        <Badge>{`Components: ${comps.join(', ') || 'None'}`}</Badge>
        <Badge>{`SR: ${spell.allowsSpellResistance ? 'Yes' : 'No'}`}</Badge>
        {spell.savingThrow && spell.savingThrow.saveType !== 'none' ? (
          <Badge>{`Save: ${spell.savingThrow.saveType.toUpperCase()} (${spell.savingThrow.effect})`}</Badge>
        ) : null}
        {spell.damageDice ? (
          <Badge tone="danger">{`Effect: ${spell.damageDice} ${spell.damageType ?? ''}`.trim()}</Badge>
        ) : null}
      </div>

      {spell.description ? <p className="ui-dnd-inspector__desc">{spell.description}</p> : null}

      <div className="ui-dnd-subbanner">Class, Domain &amp; Tag Availability</div>
      <div className="ui-dnd-card__sub">{availParts.join(' • ') || `Level ${spell.level}`}</div>
    </div>
  );
}
