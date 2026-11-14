import { projectConsoleStanceSelfTags } from '../../systems/stance.system.ts';
import { evaluateEffectBundle, isActivationConditionMet, parseParameterizedFeatId } from './effect_bundle.ts';
import { appendSourcePath } from './modifiers.ts';
import {
  HEAVY_ARMOR_BONUS_THRESHOLD,
  MEDIUM_ARMOR_BONUS_THRESHOLD,
  type SituationalTagContext
} from './semantic_tags_context.ts';
import type { CreatureSizeCategory, DnD35EntityData, StatModifier } from './types/dnd35e.types.ts';
import type {
  DnD35ClassDefinition,
  DnD35CreatureTypeEngine,
  DnD35DomainDefinition,
  DnD35FeatDefinition,
  DnD35SkillDefinition,
  DnD35SubtypeDefinition
} from './types/dnd35e_system.types.ts';

export * from './semantic_tags_context.ts';

/** Canonical SRD Construct Bonus HP by Size emitted by the `type:construct` Effect Provider. */
export const CONSTRUCT_BONUS_HP_BY_SIZE: Readonly<Partial<Record<CreatureSizeCategory, number>>> = {
  small: 10,
  medium: 20,
  large: 30,
  huge: 40,
  gargantuan: 60,
  colossal: 80
};

/** Standard 5-rank threshold for Balance/Tumble acrobatics trait projection when skillRegistry is omitted. */
export const DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS = 5;

/** Default semantic tags emitted by on-hit rider descriptors when omitted in JSON. */
const DEFAULT_RIDER_SPECIAL_ATTACK_TAGS: ReadonlyArray<string> = ['trait:special_attack'];

/**
 * Emits declarative `StatModifier` entries for an actor's Creature Type (`type:construct` bonus HP by size)
 * and Subtypes (`subtype:incorporeal` Charisma deflection AC bonus, min +1, plus any declarative subtype modifiers),
 * tagging each modifier with its hierarchical `sourcePath` lineage.
 *
 * @param creatureType Canonical creature type string.
 * @param subtypes Array of creature subtypes.
 * @param chaModifier Actor Charisma modifier (for incorporeal deflection).
 * @param parentSourcePath Hierarchical parent source path.
 * @param systemContent System content dictionary for creature types/subtypes.
 * @returns Array of generated `StatModifier`s.
 */
export function buildCreatureTypeAndSubtypeModifiers(
  creatureType: string | undefined,
  subtypes: ReadonlyArray<string> | undefined,
  chaModifier = 0,
  parentSourcePath?: string,
  systemContent?: Record<string, unknown>
): ReadonlyArray<StatModifier> {
  const mods: StatModifier[] = [];

  if (creatureType === 'construct') {
    const typePath = appendSourcePath(parentSourcePath, 'type:construct/trait:construct_bonus_hp');
    const customBonusTable =
      (systemContent?.['creatureTypes'] as Record<string, DnD35CreatureTypeEngine> | undefined)?.['construct']
        ?.constructBonusHpBySize ?? CONSTRUCT_BONUS_HP_BY_SIZE;
    for (const [sizeKey, bonusHp] of Object.entries(customBonusTable)) {
      if (bonusHp !== undefined && bonusHp > 0) {
        mods.push({
          targetStat: 'max_hp',
          value: bonusHp,
          bonusType: 'untyped',
          sourceId: `type:construct:bonus_hp:${sizeKey}`,
          sourcePath: typePath,
          origin: 'ex',
          condition: { selfTagsAll: ['type:construct', `size:${sizeKey}`] }
        });
      }
    }
  }

  if (subtypes && subtypes.includes('incorporeal')) {
    const incorporealDeflection = Math.max(1, chaModifier);
    const subtypePath = appendSourcePath(parentSourcePath, 'subtype:incorporeal/deflection_ac');
    mods.push({
      targetStat: 'ac',
      value: incorporealDeflection,
      bonusType: 'deflection',
      sourceId: 'subtype:incorporeal:deflection_ac',
      sourcePath: subtypePath,
      origin: 'su',
      condition: { selfTagsAll: ['subtype:incorporeal'] }
    });
  }

  const subtypeRegistry = systemContent?.['subtypes'] as Record<string, DnD35SubtypeDefinition> | undefined;
  if (subtypeRegistry && subtypes) {
    for (const subId of subtypes) {
      const subDef = subtypeRegistry[subId];
      if (!subDef) continue;
      const subRoot = appendSourcePath(parentSourcePath, `subtype:${subId}`);
      for (const m of subDef.modifiers) {
        mods.push({
          targetStat: m.target,
          value: m.value,
          bonusType: m.type,
          sourceId: `subtype:${subId}:${m.id}`,
          sourcePath: appendSourcePath(subRoot, m.id),
          origin: 'ex',
          ...(m.effectTags !== undefined ? { effectTags: m.effectTags } : {}),
          ...(m.condition !== undefined ? { condition: m.condition } : {})
        });
      }
      for (const bundle of subDef.traitBundles) {
        const evalRes = evaluateEffectBundle(bundle, subRoot);
        mods.push(...evalRes.statModifiers);
      }
    }
  }

  return mods;
}

/**
 * Projects semantic creature type, subtype, size, literacy, active class feature, and situational
 * equipment/load tags (`type:<creatureType>`, `subtype:<subtype>`, `size:<sizeCategory>`,
 * `trait:literate`, `trait:illiterate`, `feature:<id>`, `armor:<category>`, `load:<category>`)
 * from `DnD35EntityData`, merging them deduplicated with any existing tags on the entity.
 *
 * @param dndData Actor's `DnD35EntityData`.
 * @param existingTags Existing tags already on the actor or from ControllerLink.
 * @param situationalContext Live situational equipment and encumbrance context.
 * @param classRegistry Optional loaded class definitions.
 * @param skillRegistry Optional loaded skill definitions.
 * @param domainRegistry Optional loaded domain definitions.
 * @param featRegistry Optional loaded feat definitions.
 * @returns Deduplicated array of projected semantic tags.
 */
export function projectDnD35ActorSemanticTags(
  dndData: DnD35EntityData,
  existingTags: ReadonlyArray<string> = [],
  situationalContext?: SituationalTagContext,
  classRegistry?: Readonly<Record<string, DnD35ClassDefinition>>,
  skillRegistry?: Readonly<Record<string, DnD35SkillDefinition>>,
  domainRegistry?: Readonly<Record<string, DnD35DomainDefinition>>,
  featRegistry?: Readonly<Record<string, DnD35FeatDefinition>>
): ReadonlyArray<string> {
  const tags = new Set<string>(existingTags);
  tags.add(`size:${dndData.sizeCategory}`);
  if (dndData.creatureType) {
    tags.add(dndData.creatureType);
    tags.add(`type:${dndData.creatureType}`);
  }
  for (const subtype of dndData.subtypes ?? []) {
    tags.add(subtype);
    tags.add(`subtype:${subtype}`);
  }

  if (dndData.alignment) {
    const alignUpper = dndData.alignment.toUpperCase();
    tags.add(`alignment:${alignUpper.toLowerCase()}`);
    if (alignUpper.includes('L')) tags.add('alignment:lawful');
    if (alignUpper.includes('C')) tags.add('alignment:chaotic');
    if (alignUpper.includes('G')) tags.add('alignment:good');
    if (alignUpper.includes('E')) tags.add('alignment:evil');
    if (alignUpper === 'N' || alignUpper.includes('N')) tags.add('alignment:neutral');
  }

  const hasClassTracks = dndData.tracks.some((t) => t.levels > 0 && t.trackCategory !== 'racial_hd');
  const hasLiterateClass = dndData.tracks.some((t) => {
    if (t.levels <= 0 || t.trackCategory === 'racial_hd') return false;
    if (classRegistry && classRegistry[t.trackId]) {
      return classRegistry[t.trackId]!.grantsLiteracy !== false;
    }
    return true;
  });

  if (dndData.spentLiteracySkillPoints === true || hasLiterateClass || !hasClassTracks) {
    tags.add('trait:literate');
  }

  for (const featId of dndData.activeClassFeatures ?? []) {
    if (classRegistry) {
      const currentTagSnapshot = Array.from(tags);
      let matchingDetailFound = false;
      let anyDetailActivated = false;
      for (const track of dndData.tracks) {
        const detail = classRegistry[track.trackId]?.featureDetails?.[featId];
        if (!detail) continue;
        matchingDetailFound = true;
        if (!isActivationConditionMet(detail.activationCondition, currentTagSnapshot)) {
          continue;
        }
        anyDetailActivated = true;
        for (const gTag of detail.grantedTags ?? []) {
          tags.add(gTag);
        }
      }
      if (!matchingDetailFound || anyDetailActivated) {
        tags.add(`feature:${featId}`);
      }
    } else {
      tags.add(`feature:${featId}`);
    }
  }

  for (const domId of dndData.domains ?? []) {
    tags.add(`domain:${domId}`);
    const domDef = domainRegistry?.[domId];
    for (const gTag of domDef?.grantedPowerBundle?.grantedTags ?? []) {
      tags.add(gTag);
    }
  }

  if (featRegistry) {
    const featTagSnapshot = Array.from(tags);
    const suppressed = dndData.suppressedBundleIds ?? [];
    for (const rawFeatId of dndData.feats ?? []) {
      const parsed = parseParameterizedFeatId(rawFeatId);
      const featDef = featRegistry[rawFeatId] ?? featRegistry[parsed.baseFeatId];
      const bundle = featDef?.effectBundle;
      if (!bundle || suppressed.includes(bundle.bundleId)) continue;
      if (!isActivationConditionMet(bundle.activationCondition, featTagSnapshot)) continue;
      for (const gTag of bundle.grantedTags ?? []) {
        tags.add(gTag);
      }
    }
  }

  if ((dndData.movementModes?.fly ?? 0) > 0) {
    tags.add('movement:fly');
  }

  if (dndData.hasPounce === true) {
    tags.add('trait:special_attack');
    tags.add('special_attack:pounce');
  }

  for (const nw of dndData.naturalWeapons ?? []) {
    for (const rider of nw.riders ?? []) {
      for (const rTag of rider.grantedTags ?? DEFAULT_RIDER_SPECIAL_ATTACK_TAGS) {
        tags.add(rTag);
      }
      tags.add(`special_attack:${rider.type}`);
      tags.add(`special_attack:${rider.riderId}`);
    }
  }

  if (skillRegistry) {
    for (const [skillId, rawRanks] of Object.entries(dndData.skillRanks ?? {})) {
      const wholeRanks = Math.floor(Math.max(0, rawRanks));
      if (wholeRanks < 1) continue;
      const skillDef = skillRegistry[skillId];
      if (!skillDef) continue;
      for (const entry of skillDef.rankThresholdModifiers) {
        if (wholeRanks < entry.minRanks) continue;
        for (const tag of entry.grantedTags ?? []) tags.add(tag);
        for (const tag of entry.effectBundle?.grantedTags ?? []) tags.add(tag);
      }
    }
  } else {
    if (Math.floor(dndData.skillRanks?.['balance'] ?? 0) >= DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS) {
      tags.add('trait:balance_uncanny_flat_footed');
    }
    if (Math.floor(dndData.skillRanks?.['tumble'] ?? 0) >= DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS) {
      tags.add('trait:tumble_acrobatic_defense');
    }
  }

  const hasExplicitArmorTag = Array.from(tags).some((t) => t.startsWith('armor:'));
  if (!hasExplicitArmorTag) {
    const armorCat =
      situationalContext?.armorCategory ??
      (dndData.armorBonus >= HEAVY_ARMOR_BONUS_THRESHOLD
        ? 'heavy'
        : dndData.armorBonus >= MEDIUM_ARMOR_BONUS_THRESHOLD
          ? 'medium'
          : dndData.armorBonus >= 1
            ? 'light'
            : 'none');
    tags.add(`armor:${armorCat}`);
  }

  for (const comp of dndData.companions ?? []) {
    for (const cTag of comp.tags) {
      tags.add(`has_companion:${cTag}`);
    }
  }

  for (const t of existingTags) {
    if (['animal_companion', 'familiar', 'mount', 'cohort', 'hireling', 'summon', 'temporary_ally'].includes(t)) {
      tags.add(`companion:${t}`);
    }
  }

  if (situationalContext?.doctrine) {
    for (const stanceTag of projectConsoleStanceSelfTags(situationalContext.doctrine)) {
      tags.add(stanceTag);
    }
  }

  return Array.from(tags);
}
