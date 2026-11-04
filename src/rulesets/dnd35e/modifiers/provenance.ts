import type {
  BonusType,
  CreatureSizeCategory,
  EffectProvenanceIndex,
  OriginLayer,
  StatModifier
} from '../types/dnd35e.types.ts';

/** Base Armor Class before modifiers in D&D 3.5e (`10`). */
export const DND35E_BASE_AC = 10;

/** Size modifiers to Armor Class and Attack Rolls across all 9 creature sizes. */
export const SIZE_AC_AND_ATTACK_MODIFIERS: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 8,
  diminutive: 4,
  tiny: 2,
  small: 1,
  medium: 0,
  large: -1,
  huge: -2,
  gargantuan: -4,
  colossal: -8
};

/**
 * Maps integer rank indices (`-4` through `+4`) to their canonical `CreatureSizeCategory`.
 */
export const SIZE_CATEGORIES_BY_RANK: Readonly<Record<number, CreatureSizeCategory>> = {
  [-4]: 'fine',
  [-3]: 'diminutive',
  [-2]: 'tiny',
  [-1]: 'small',
  0: 'medium',
  1: 'large',
  2: 'huge',
  3: 'gargantuan',
  4: 'colossal'
};

/**
 * Appends a child segment to a parent provenance path (`"parent/child"`),
 * or returns `segment` when no parent path is present.
 *
 * @param parentPath Optional slash-delimited parent provenance path.
 * @param segment Child node segment (e.g., `'subtype:incorporeal'`, `'trait:construct_bonus_hp'`).
 * @returns Combined slash-delimited `sourcePath`.
 */
export function appendSourcePath(parentPath: string | undefined, segment: string): string {
  if (!parentPath || parentPath.trim().length === 0) {
    return segment;
  }
  return `${parentPath}/${segment}`;
}

/**
 * Returns the canonical provenance path for a modifier (`modifier.sourcePath ?? modifier.sourceId`).
 *
 * @param modifier The `StatModifier` to inspect.
 * @returns Non-empty provenance path string.
 */
export function getModifierSourcePath(modifier: StatModifier): string {
  return modifier.sourcePath ?? modifier.sourceId;
}

/**
 * Revokes (filters out) all `StatModifier` entries whose `sourcePath` (or `sourceId`)
 * matches `pathPrefix` or is a descendant of `pathPrefix/` (e.g., revoking `"spell:shapechange"`
 * removes `"spell:shapechange/form:iron_golem/type:construct/trait:construct_bonus_hp"`).
 *
 * @param modifiers Input array of `StatModifier` entries.
 * @param pathPrefix Root or intermediate provenance path prefix to revoke.
 * @returns Filtered array of remaining `StatModifier` entries.
 */
export function revokeModifiersByPathPrefix(
  modifiers: ReadonlyArray<StatModifier>,
  pathPrefix: string
): ReadonlyArray<StatModifier> {
  const normalizedPrefix = pathPrefix.endsWith('/') ? pathPrefix.slice(0, -1) : pathPrefix;
  const descendantPrefix = `${normalizedPrefix}/`;
  return modifiers.filter((mod) => {
    const path = getModifierSourcePath(mod);
    return path !== normalizedPrefix && !path.startsWith(descendantPrefix);
  });
}

/**
 * Builds a fast runtime lookup index (`EffectProvenanceIndex`) from an array of `StatModifier` entries,
 * indexing every modifier by its cumulative path prefixes (`byPathPrefix`), individual causal nodes (`byNode`),
 * and target stat (`byTargetStat`).
 *
 * @param modifiers Array of active `StatModifier` entries on an actor.
 * @returns `EffectProvenanceIndex` for $O(1)$ prefix, node, and stat breakdown queries.
 */
export function buildEffectProvenanceIndex(modifiers: ReadonlyArray<StatModifier>): EffectProvenanceIndex {
  const byPathPrefix: Record<string, StatModifier[]> = {};
  const byNode: Record<string, StatModifier[]> = {};
  const byTargetStat: Record<string, StatModifier[]> = {};

  for (const mod of modifiers) {
    const fullPath = getModifierSourcePath(mod);
    const segments = fullPath.split('/').filter((s) => s.length > 0);

    let cumulative = '';
    for (const seg of segments) {
      cumulative = cumulative.length === 0 ? seg : `${cumulative}/${seg}`;
      const prefixBucket = byPathPrefix[cumulative] ?? [];
      prefixBucket.push(mod);
      byPathPrefix[cumulative] = prefixBucket;

      const nodeBucket = byNode[seg] ?? [];
      if (!nodeBucket.includes(mod)) {
        nodeBucket.push(mod);
      }
      byNode[seg] = nodeBucket;
    }

    const statBucket = byTargetStat[mod.targetStat] ?? [];
    statBucket.push(mod);
    byTargetStat[mod.targetStat] = statBucket;
  }

  return {
    byPathPrefix,
    byNode,
    byTargetStat
  };
}

/**
 * Classifies a `StatModifier` into an orthogonal `OriginLayer` based on the root segment
 * of its hierarchical `sourcePath` (or `sourceId`).
 *
 * @param modifier The `StatModifier` to classify.
 * @returns The assigned `OriginLayer`.
 */
export function classifyModifierOriginLayer(modifier: StatModifier): OriginLayer {
  const fullPath = getModifierSourcePath(modifier);
  const rootSegment = fullPath.split('/')[0] ?? '';
  const prefix = rootSegment.includes(':') ? (rootSegment.split(':')[0] ?? '') : rootSegment;

  switch (prefix) {
    case 'race':
    case 'racial':
      return 'racial';
    case 'class':
    case 'feat':
    case 'template':
    case 'type':
    case 'subtype':
    case 'progression':
      return 'progression';
    case 'form':
    case 'wild_shape':
    case 'polymorph':
      return 'form';
    case 'item':
    case 'equip':
    case 'armor':
    case 'shield':
    case 'weapon':
    case 'equipment':
      return 'equipment';
    case 'spell':
    case 'condition':
    case 'stance':
    case 'effect':
    case 'temporary':
      return 'temporary';
    case 'field':
    case 'aura':
    case 'zone':
    case 'environment':
      return 'environment';
    default:
      return 'base';
  }
}

/**
 * Checks if a modifier origin is suppressed inside an Antimagic Field (`su`, `sp`, `spell`, `magical`).
 *
 * @param modifier The `StatModifier` to test.
 * @returns True if suppressed by Antimagic Field.
 */
export function isSuppressedByAntimagic(modifier: StatModifier): boolean {
  if (modifier.origin === undefined) return false;
  switch (modifier.origin) {
    case 'magical':
    case 'spell':
    case 'sp':
    case 'su':
      return true;
    case 'ex':
    case 'mundane':
      return false;
  }
}

/**
 * Checks if a bonus type is a physical armor/shield/natural armor type ignored by Touch Attacks.
 *
 * @param bonusType The `BonusType` to check.
 * @returns True if ignored by Touch AC.
 */
export function isArmorOrNaturalBonus(bonusType: BonusType): boolean {
  switch (bonusType) {
    case 'armor':
    case 'armor_enhancement':
    case 'shield':
    case 'shield_enhancement':
    case 'natural_armor':
    case 'natural_armor_enhancement':
      return true;
    default:
      return false;
  }
}
