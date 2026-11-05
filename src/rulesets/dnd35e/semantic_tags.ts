import { getComponent } from '../../core/ecs.ts';
import { ComponentType, type EquipmentComponent, type ItemComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { evaluateEffectBundle } from './effect_bundle.ts';
import { appendSourcePath } from './modifiers.ts';
import type { CreatureSizeCategory, DnD35EntityData, StatModifier } from './types/dnd35e.types.ts';
import type {
  DnD35ClassDefinition,
  DnD35CreatureTypeEngine,
  DnD35ItemDefinition,
  DnD35SkillDefinition,
  DnD35SubtypeDefinition
} from './types/dnd35e_system.types.ts';
import { computeMaterialEquipmentStats } from './equipment/special_materials.ts';

/** Canonical SRD Construct Bonus HP by Size emitted by the `type:construct` Effect Provider. */
export const CONSTRUCT_BONUS_HP_BY_SIZE: Readonly<Partial<Record<CreatureSizeCategory, number>>> = {
  small: 10,
  medium: 20,
  large: 30,
  huge: 40,
  gargantuan: 60,
  colossal: 80
};

/** Live situational equipment and encumbrance context for Horizon 3 semantic tag projection. */
export interface SituationalTagContext {
  readonly armorCategory?: 'none' | 'light' | 'medium' | 'heavy' | undefined;
  readonly hasShield?: boolean | undefined;
  readonly isMetalArmorOrShield?: boolean | undefined;
  readonly loadCategory?: 'light' | 'medium' | 'heavy' | undefined;
}

/** Minimum armor bonus threshold heuristic for Heavy Armor when no item tag is present. */
export const HEAVY_ARMOR_BONUS_THRESHOLD = 6;

/** Minimum armor bonus threshold heuristic for Medium Armor when no item tag is present. */
export const MEDIUM_ARMOR_BONUS_THRESHOLD = 4;

/** Standard 5-rank threshold for Balance/Tumble acrobatics trait projection when skillRegistry is omitted. */
export const DEFAULT_ACROBATIC_SKILL_THRESHOLD_RANKS = 5;

/**
 * Emits declarative `StatModifier` entries for an actor's Creature Type (`type:construct` bonus HP by size)
 * and Subtypes (`subtype:incorporeal` Charisma deflection AC bonus, min +1, plus any declarative subtype modifiers),
 * tagging each modifier with its hierarchical `sourcePath` lineage.
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
 */
export function projectDnD35ActorSemanticTags(
  dndData: DnD35EntityData,
  existingTags: ReadonlyArray<string> = [],
  situationalContext?: SituationalTagContext,
  classRegistry?: Readonly<Record<string, DnD35ClassDefinition>>,
  skillRegistry?: Readonly<Record<string, DnD35SkillDefinition>>
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
    if (featId === 'illiteracy' && tags.has('trait:literate')) {
      continue;
    }
    tags.add(`feature:${featId}`);
    if (featId === 'illiteracy') {
      tags.add('trait:illiterate');
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

  const hasExplicitShieldTag = Array.from(tags).some((t) => t.startsWith('shield:'));
  if (!hasExplicitShieldTag) {
    const hasShield = situationalContext?.hasShield ?? dndData.shieldBonus > 0;
    tags.add(hasShield ? 'shield:any' : 'shield:none');
  }

  if (situationalContext?.isMetalArmorOrShield) {
    tags.add('armor_material:metal');
  }

  const hasExplicitLoadTag = Array.from(tags).some((t) => t.startsWith('load:'));
  if (!hasExplicitLoadTag) {
    const loadCat = situationalContext?.loadCategory ?? 'light';
    tags.add(`load:${loadCat}`);
  }

  return Array.from(tags);
}

/**
 * Inspects an entity's equipped items in `GameState` to derive live Horizon 3 `SituationalTagContext`
 * (`armorCategory`, `hasShield`, `isMetalArmorOrShield`, `loadCategory`) using declarative `armorStats`
 * and `specialMaterial` (with tag/threshold fallbacks).
 */
export function resolveEntitySituationalTagContext(
  state: GameState,
  entityId: EntityId,
  dndData: DnD35EntityData
): SituationalTagContext {
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  let armorCategory: 'none' | 'light' | 'medium' | 'heavy' | undefined;
  let hasShield = dndData.shieldBonus > 0;
  let isMetalArmorOrShield = false;

  if (equipment && Array.isArray(equipment.slots)) {
    for (const slot of equipment.slots) {
      if (slot.equippedItem === null || slot.suppressed === true) continue;
      const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
      const itemDef = itemComp ? (state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined) : undefined;
      if (!itemDef) continue;

      const itemTags = itemDef.tags ?? [];
      const armorStats = itemDef.armorStats;
      const isMithral =
        itemDef.specialMaterial === 'mithral' || itemTags.includes('mithral') || itemTags.includes('material:mithral');

      if (armorStats) {
        if (armorStats.isMetal && itemDef.specialMaterial !== 'darkwood') {
          isMetalArmorOrShield = true;
        }
        if (armorStats.armorCategory === 'shield' || armorStats.armorCategory === 'tower_shield') {
          hasShield = true;
        } else {
          const effectiveCat = isMithral
            ? (computeMaterialEquipmentStats('mithral', armorStats.armorCategory).effectiveArmorCategory ??
              armorStats.armorCategory)
            : armorStats.armorCategory;
          if (effectiveCat === 'heavy') {
            armorCategory = 'heavy';
          } else if (effectiveCat === 'medium' && armorCategory !== 'heavy') {
            armorCategory = 'medium';
          } else if (effectiveCat === 'light' && !armorCategory) {
            armorCategory = 'light';
          }
        }
        continue;
      }

      if (itemTags.includes('metal') || itemTags.includes('armor_material:metal')) {
        isMetalArmorOrShield = true;
      }
      if (slot.slotType === 'off_hand' || itemTags.includes('shield')) {
        if ((itemDef.equippable?.defenseBonus ?? 0) > 0 || itemTags.includes('shield')) {
          hasShield = true;
        }
      }
      if (slot.slotType === 'torso' || slot.slotType === 'body' || (itemDef.equippable?.defenseBonus ?? 0) > 0) {
        const defBonus = itemDef.equippable?.defenseBonus ?? 0;
        let rawCat: 'light' | 'medium' | 'heavy' | undefined;
        if (
          itemTags.includes('armor:heavy') ||
          itemTags.includes('heavy_armor') ||
          defBonus >= HEAVY_ARMOR_BONUS_THRESHOLD
        ) {
          rawCat = 'heavy';
        } else if (
          itemTags.includes('armor:medium') ||
          itemTags.includes('medium_armor') ||
          defBonus >= MEDIUM_ARMOR_BONUS_THRESHOLD
        ) {
          rawCat = 'medium';
        } else if (defBonus >= 1 || itemTags.includes('armor:light') || itemTags.includes('light_armor')) {
          rawCat = 'light';
        }
        if (rawCat) {
          const effectiveCat = isMithral
            ? ((computeMaterialEquipmentStats('mithral', rawCat).effectiveArmorCategory as
                'light' | 'medium' | 'heavy') ?? rawCat)
            : rawCat;
          if (effectiveCat === 'heavy') armorCategory = 'heavy';
          else if (effectiveCat === 'medium' && armorCategory !== 'heavy') armorCategory = 'medium';
          else if (effectiveCat === 'light' && !armorCategory) armorCategory = 'light';
        }
      }
    }
  }

  if (!armorCategory) {
    armorCategory =
      dndData.armorBonus >= HEAVY_ARMOR_BONUS_THRESHOLD
        ? 'heavy'
        : dndData.armorBonus >= MEDIUM_ARMOR_BONUS_THRESHOLD
          ? 'medium'
          : dndData.armorBonus >= 1
            ? 'light'
            : 'none';
  }

  return {
    armorCategory,
    hasShield,
    isMetalArmorOrShield,
    loadCategory: 'light'
  };
}
