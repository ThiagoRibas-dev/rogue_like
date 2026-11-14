import { getCanonicalBaseWeapons } from '../../rulesets/dnd35e/equipment_physics.ts';
import type { PrerequisiteEvalContext } from '../../rulesets/dnd35e/prerequisites.ts';
import type { DnD35FeatDefinition, DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';

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

/** Canonical D&D 3.5e natural weapon identifiers for Improved Natural Attack targeting. */
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
 *
 * @param sys Loaded D&D 3.5e system content.
 * @param repeatable Optional `repeatable` descriptor on the feat definition.
 * @param prereqCtx Optional actor prerequisite evaluation context used to filter to owned natural weapons.
 * @returns Ordered list of selectable target IDs.
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
  const extraWeapons = ['unarmed_strike', ...CANONICAL_NATURAL_WEAPONS];
  return Array.from(new Set([...canonicalIds, ...extraWeapons]));
}

/**
 * Classifies a feat definition into Fighter Bonus, Combat, and Metamagic/Magic UI filter buckets.
 *
 * @param feat Feat definition from System Content.
 * @returns Category flags.
 */
export function classifyFeatCategory(feat: DnD35FeatDefinition): {
  readonly isFighterBonus: boolean;
  readonly isCombat: boolean;
  readonly isMagic: boolean;
} {
  const isFighterBonus = feat.isFighterBonusFeat === true;
  const prereqJson = feat.prerequisites ? JSON.stringify(feat.prerequisites) : '';
  const descLower = feat.description.toLowerCase();

  const isMagic =
    feat.metamagicDescriptor !== undefined ||
    (feat.modifiers !== undefined &&
      feat.modifiers.some((m) =>
        ['caster_level', 'spell_resistance', 'spell_penetration', 'spells_per_day', 'turn_undead'].some((target) =>
          m.target.includes(target)
        )
      )) ||
    prereqJson.includes('caster_level') ||
    prereqJson.includes('spells') ||
    descLower.includes('metamagic') ||
    descLower.includes('caster level') ||
    descLower.includes('turn undead') ||
    descLower.includes('spell');

  const isCombat =
    isFighterBonus ||
    (feat.ruleOverrides !== undefined && feat.ruleOverrides.length > 0) ||
    (feat.activatedAbilities !== undefined && feat.activatedAbilities.length > 0) ||
    (feat.modifiers !== undefined &&
      feat.modifiers.some((m) =>
        ['attack', 'damage', 'crit_threat_doubling', 'ac', 'initiative', 'grapple', 'trip', 'disarm'].some((target) =>
          m.target.includes(target)
        )
      )) ||
    prereqJson.includes('min_bab');

  return { isFighterBonus, isCombat, isMagic };
}

/**
 * Resolves the selectable target IDs for any targeted feat (`weapon`, `natural_weapon`,
 * `school`, `ability`, or `skill`) purely from its `repeatable` metadata.
 *
 * @param sys Loaded D&D 3.5e system content.
 * @param feat Feat definition.
 * @param prereqCtx Optional actor prerequisite evaluation context used to filter to owned targets.
 * @returns Array of selectable target IDs.
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

/**
 * Builds the `<select>` control for choosing a target parameter on a repeatable targeted feat row.
 *
 * @param sys Loaded D&D 3.5e system content.
 * @param feat Feat definition.
 * @param selectedTargetByFeatId Mutable map tracking currently chosen target per feat ID.
 * @param onChangeTarget Callback invoked when user changes the dropdown selection.
 * @param prereqCtx Optional actor prerequisite evaluation context used to filter to owned targets.
 * @returns Configured `HTMLSelectElement`.
 */
export function buildFeatTargetSelect(
  sys: DnD35SystemContent,
  feat: DnD35FeatDefinition,
  selectedTargetByFeatId: Record<string, string>,
  onChangeTarget: (targetId: string) => void,
  prereqCtx?: PrerequisiteEvalContext
): HTMLSelectElement {
  const targetSelect = document.createElement('select');
  targetSelect.style.cssText =
    'padding: 2px 4px; font-size: 0.72rem; margin-right: 4px; background: var(--crpg-bg-card, #ebe3d4); color: var(--crpg-text-main, #261d14); border: 1px solid var(--crpg-border-inner, #a69478);';
  const opts = getFeatTargetOptions(sys, feat, prereqCtx);
  for (const opt of opts) {
    const oEl = document.createElement('option');
    oEl.value = opt;
    oEl.textContent = opt.replace(/_/g, ' ');
    targetSelect.appendChild(oEl);
  }
  const current = selectedTargetByFeatId[feat.id];
  if (current && opts.includes(current)) {
    targetSelect.value = current;
  } else if (opts.length > 0) {
    targetSelect.value = opts[0]!;
    selectedTargetByFeatId[feat.id] = opts[0]!;
  }
  targetSelect.addEventListener('click', (e) => e.stopPropagation());
  targetSelect.addEventListener('change', () => onChangeTarget(targetSelect.value));
  return targetSelect;
}
