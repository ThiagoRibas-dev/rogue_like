import { appendSourcePath } from '../modifiers.ts';
import type { DnD35CompanionEntry, StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Skills receiving Ranger Favored Enemy bonus (PHB p. 47). */
const FAVORED_ENEMY_SKILLS: ReadonlyArray<string> = ['bluff', 'listen', 'sense_motive', 'spot', 'survival'];

/**
 * Collects feats granted dynamically by class and domain choices
 * (War domain deity weapon, Ranger combat style progression in light/no armor, Familiar Alertness, and Rogue special ability feats).
 *
 * @param activeFeatures Array of active class feature IDs accumulated by the character.
 * @param domains Selected Cleric domains.
 * @param deityFavoredWeaponId Selected deity favored weapon ID.
 * @param combatStyle Selected Ranger combat style ('archery' | 'two_weapon').
 * @param familiarId Selected Arcane Familiar ID.
 * @param companions Registered companions array.
 * @param scalingPools Active scaling pool values.
 * @param rogueSpecialAbilities Selected Rogue special abilities.
 * @param sysContent Loaded D&D 3.5e system content.
 * @param activeTags Active semantic tags on the actor (used to enforce light/no-armor condition for Ranger combat style).
 * @returns Deduplicated array of granted feat IDs.
 */
export function collectClassChoiceFeats(
  activeFeatures: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  deityFavoredWeaponId?: string,
  combatStyle?: 'archery' | 'two_weapon',
  familiarId?: string,
  companions?: ReadonlyArray<DnD35CompanionEntry>,
  scalingPools: Readonly<Record<string, number>> = {},
  rogueSpecialAbilities: ReadonlyArray<string> = [],
  sysContent?: DnD35SystemContent,
  activeTags: ReadonlyArray<string> = []
): ReadonlyArray<string> {
  const granted = new Set<string>();

  if (domains.includes('war') && deityFavoredWeaponId) {
    granted.add(`martial_weapon_proficiency:${deityFavoredWeaponId}`);
    granted.add(`weapon_focus:${deityFavoredWeaponId}`);
  }

  const wearingMediumOrHeavyArmor = activeTags.includes('armor:medium') || activeTags.includes('armor:heavy');

  if (!wearingMediumOrHeavyArmor && combatStyle === 'archery') {
    if (activeFeatures.includes('combat_style')) granted.add('rapid_shot');
    if (activeFeatures.includes('improved_combat_style')) granted.add('manyshot');
    if (activeFeatures.includes('combat_style_mastery')) granted.add('improved_precise_shot');
  } else if (!wearingMediumOrHeavyArmor && combatStyle === 'two_weapon') {
    if (activeFeatures.includes('combat_style')) granted.add('two_weapon_fighting');
    if (activeFeatures.includes('improved_combat_style')) granted.add('improved_two_weapon_fighting');
    if (activeFeatures.includes('combat_style_mastery')) granted.add('greater_two_weapon_fighting');
  }

  const famRaceId = familiarId ?? companions?.find((c) => c.tags.includes('familiar'))?.raceId;
  const famMasterLevel = scalingPools['familiar_master_effective_level'] ?? (famRaceId ? 1 : 0);
  if (famRaceId && famMasterLevel > 0) {
    const famRace = sysContent?.races?.[famRaceId];
    const famFeats = famRace?.masterEffectBundle?.virtualFeatGrants ?? [
      { featId: 'alertness', ignorePrerequisites: true }
    ];
    for (const f of famFeats) {
      granted.add(f.featId);
    }
  }

  if (sysContent?.feats) {
    for (const ab of rogueSpecialAbilities) {
      if (sysContent.feats[ab]) {
        granted.add(ab);
      }
    }
  }

  return Array.from(granted);
}

/**
 * Emits active Effect Provider StatModifiers for Ranger Favored Enemies and Familiar Master bonuses.
 *
 * @param favoredEnemies Accumulated Ranger favored enemy entries and bonuses.
 * @param familiarId Optional Arcane Familiar ID.
 * @param companions Optional registered companions array.
 * @param scalingPools Active scaling pool values.
 * @param sysContent Optional loaded D&D 3.5e system content.
 * @returns Array of `StatModifier`s with hierarchical `sourcePath`.
 */
export function buildClassChoiceModifiers(
  favoredEnemies: ReadonlyArray<{ readonly creatureType: string; readonly bonus: number }>,
  familiarId?: string,
  companions?: ReadonlyArray<DnD35CompanionEntry>,
  scalingPools: Readonly<Record<string, number>> = {},
  sysContent?: DnD35SystemContent
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];

  for (const { creatureType, bonus } of favoredEnemies) {
    const targetTag = creatureType.includes(':') ? creatureType : `type:${creatureType}`;
    const sourcePath = appendSourcePath('class:ranger', `feature:favored_enemy/${creatureType}`);
    const cond = { targetTagsAny: [targetTag] };

    modifiers.push({
      sourceId: `ranger_favored_enemy_dmg_${creatureType}`,
      targetStat: 'strike_damage',
      value: bonus,
      bonusType: 'untyped',
      condition: cond,
      sourcePath
    });

    for (const sk of FAVORED_ENEMY_SKILLS) {
      modifiers.push({
        sourceId: `ranger_favored_enemy_${sk}_${creatureType}`,
        targetStat: `skill:${sk}`,
        value: bonus,
        bonusType: 'untyped',
        condition: cond,
        sourcePath
      });
    }
  }

  const famRaceId = familiarId ?? companions?.find((c) => c.tags.includes('familiar'))?.raceId;
  const famMasterLevel = scalingPools['familiar_master_effective_level'] ?? (famRaceId ? 1 : 0);
  if (famRaceId && famMasterLevel > 0 && sysContent?.races?.[famRaceId]?.masterEffectBundle?.modifiers) {
    const bundleMods = sysContent.races[famRaceId].masterEffectBundle?.modifiers ?? [];
    for (const mod of bundleMods) {
      modifiers.push({
        sourceId: mod.id ?? `familiar_${mod.target}`,
        targetStat: mod.target,
        value: mod.value,
        bonusType: mod.type ?? 'untyped',
        sourcePath: `familiar:${famRaceId}`
      });
    }
  }

  return modifiers;
}
