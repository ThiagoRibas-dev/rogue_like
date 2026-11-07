import {
  RANGER_COMBAT_STYLE_LEVEL,
  RANGER_COMBAT_STYLE_MASTERY_LEVEL,
  RANGER_IMPROVED_COMBAT_STYLE_LEVEL
} from '../companions.ts';
import { appendSourcePath } from '../modifiers.ts';
import type { HitDieTrack, StatModifier } from '../types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Skills receiving Ranger Favored Enemy bonus (PHB p. 47). */
const FAVORED_ENEMY_SKILLS: ReadonlyArray<string> = ['bluff', 'listen', 'sense_motive', 'spot', 'survival'];

/**
 * Collects feats granted dynamically by class and domain choices
 * (War domain deity weapon, Ranger combat style progression in light/no armor, Familiar Alertness, and Rogue special ability feats).
 *
 * @param tracks Active Hit Die tracks.
 * @param domains Selected Cleric domains.
 * @param deityFavoredWeaponId Selected deity favored weapon ID.
 * @param combatStyle Selected Ranger combat style ('archery' | 'two_weapon').
 * @param familiarId Selected Arcane Familiar ID.
 * @param rogueSpecialAbilities Selected Rogue special abilities.
 * @param sysContent Loaded D&D 3.5e system content.
 * @param activeTags Active semantic tags on the actor (used to enforce light/no-armor condition for Ranger combat style).
 * @returns Deduplicated array of granted feat IDs.
 */
export function collectClassChoiceFeats(
  tracks: ReadonlyArray<HitDieTrack>,
  domains: ReadonlyArray<string>,
  deityFavoredWeaponId?: string,
  combatStyle?: 'archery' | 'two_weapon',
  familiarId?: string,
  rogueSpecialAbilities: ReadonlyArray<string> = [],
  sysContent?: DnD35SystemContent,
  activeTags: ReadonlyArray<string> = []
): ReadonlyArray<string> {
  const granted = new Set<string>();

  if (domains.includes('war') && deityFavoredWeaponId) {
    granted.add(`martial_weapon_proficiency:${deityFavoredWeaponId}`);
    granted.add(`weapon_focus:${deityFavoredWeaponId}`);
  }

  const rangerTrack = tracks.find((t) => t.trackId === 'ranger');
  const rangerLvl = rangerTrack ? rangerTrack.levels : 0;
  const wearingMediumOrHeavyArmor = activeTags.includes('armor:medium') || activeTags.includes('armor:heavy');

  if (!wearingMediumOrHeavyArmor && combatStyle === 'archery') {
    if (rangerLvl >= RANGER_COMBAT_STYLE_LEVEL) granted.add('rapid_shot');
    if (rangerLvl >= RANGER_IMPROVED_COMBAT_STYLE_LEVEL) granted.add('manyshot');
    if (rangerLvl >= RANGER_COMBAT_STYLE_MASTERY_LEVEL) granted.add('improved_precise_shot');
  } else if (!wearingMediumOrHeavyArmor && combatStyle === 'two_weapon') {
    if (rangerLvl >= RANGER_COMBAT_STYLE_LEVEL) granted.add('two_weapon_fighting');
    if (rangerLvl >= RANGER_IMPROVED_COMBAT_STYLE_LEVEL) granted.add('improved_two_weapon_fighting');
    if (rangerLvl >= RANGER_COMBAT_STYLE_MASTERY_LEVEL) granted.add('greater_two_weapon_fighting');
  }

  if (familiarId) {
    const famRace = sysContent?.races?.[familiarId];
    const famFeats = famRace?.masterEffectBundle?.virtualFeatGrants ?? ['alertness'];
    for (const f of famFeats) {
      granted.add(f);
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
 * @param sysContent Optional loaded D&D 3.5e system content.
 * @returns Array of `StatModifier`s with hierarchical `sourcePath`.
 */
export function buildClassChoiceModifiers(
  favoredEnemies: ReadonlyArray<{ readonly creatureType: string; readonly bonus: number }>,
  familiarId?: string,
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

  if (familiarId && sysContent?.races?.[familiarId]?.masterEffectBundle?.modifiers) {
    const bundleMods = sysContent.races[familiarId].masterEffectBundle?.modifiers ?? [];
    for (const mod of bundleMods) {
      modifiers.push({
        sourceId: mod.sourceId,
        targetStat: mod.targetStat,
        value: mod.value,
        bonusType: mod.bonusType ?? 'untyped',
        sourcePath: mod.sourcePath ?? `familiar:${familiarId}`
      });
    }
  }

  return modifiers;
}
