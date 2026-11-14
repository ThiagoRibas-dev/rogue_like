import { getCanonicalBaseWeapons } from '../../rulesets/dnd35e/equipment_physics.ts';
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

export function getTargetedWeaponOptions(sys: DnD35SystemContent, featId?: string): ReadonlyArray<string> {
  if (featId === 'rapid_reload') {
    return ['hand_crossbow', 'light_crossbow', 'heavy_crossbow'];
  }
  const canonicalIds = getCanonicalBaseWeapons(sys).map((w) => w.id);
  const extraWeapons = ['unarmed_strike', 'bite', 'claw'];
  return Array.from(new Set([...canonicalIds, ...extraWeapons]));
}

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

export function buildFeatTargetSelect(
  sys: DnD35SystemContent,
  feat: DnD35FeatDefinition,
  selectedTargetByFeatId: Record<string, string>,
  onChangeTarget: (targetId: string) => void
): HTMLSelectElement {
  const targetSelect = document.createElement('select');
  targetSelect.style.cssText =
    'padding: 2px 4px; font-size: 0.72rem; margin-right: 4px; background: var(--crpg-bg-card, #ebe3d4); color: var(--crpg-text-main, #261d14); border: 1px solid var(--crpg-border-inner, #a69478);';
  const tCat = feat.repeatable?.targetCategory;
  const opts =
    tCat === 'weapon'
      ? getTargetedWeaponOptions(sys, feat.id)
      : tCat === 'school'
        ? TARGETED_SCHOOLS
        : Object.keys(sys.skills ?? {});
  for (const opt of opts) {
    const oEl = document.createElement('option');
    oEl.value = opt;
    oEl.textContent = opt.replace(/_/g, ' ');
    targetSelect.appendChild(oEl);
  }
  if (selectedTargetByFeatId[feat.id] && opts.includes(selectedTargetByFeatId[feat.id]!)) {
    targetSelect.value = selectedTargetByFeatId[feat.id]!;
  }
  targetSelect.addEventListener('click', (e) => e.stopPropagation());
  targetSelect.addEventListener('change', () => onChangeTarget(targetSelect.value));
  return targetSelect;
}
