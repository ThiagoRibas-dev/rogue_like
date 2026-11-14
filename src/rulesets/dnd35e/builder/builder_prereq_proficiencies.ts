import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { HitDieTrack } from '../types/dnd35e.types.ts';

/**
 * Extracts weapon, armor, and shield proficiency categories and specific weapon IDs for an actor.
 */
export function collectActorProficiencies(
  tracks: ReadonlyArray<HitDieTrack>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  raceId: string | undefined,
  feats: ReadonlyArray<string>,
  tags: ReadonlyArray<string>,
  domains: ReadonlyArray<string>,
  deityFavoredWeaponId: string | undefined,
  sysContent?: Readonly<DnD35SystemContent>
): {
  readonly proficientWeaponCategories: ReadonlyArray<'simple' | 'martial' | 'exotic'>;
  readonly proficientWeaponIds: ReadonlyArray<string>;
  readonly proficientArmorCategories: ReadonlyArray<'light' | 'medium' | 'heavy'>;
  readonly proficientShieldCategories: ReadonlyArray<'shield' | 'tower'>;
} {
  const weaponCategories = new Set<'simple' | 'martial' | 'exotic'>();
  const weaponIds = new Set<string>();
  const armorCategories = new Set<'light' | 'medium' | 'heavy'>();
  const shieldCategories = new Set<'shield' | 'tower'>();

  for (const track of tracks) {
    if (track.levels <= 0) continue;
    const classDef = classRegistry[track.trackId];
    if (classDef) {
      for (const wp of classDef.proficiencies?.weapons ?? []) {
        if (wp === 'simple' || wp === 'martial' || wp === 'exotic') {
          weaponCategories.add(wp);
        } else {
          weaponIds.add(wp);
        }
      }
      for (const ap of classDef.proficiencies?.armor ?? []) {
        if (ap === 'light' || ap === 'medium' || ap === 'heavy') {
          armorCategories.add(ap);
        } else if (ap === 'shields') {
          shieldCategories.add('shield');
        } else if (ap === 'tower_shields') {
          shieldCategories.add('tower');
        }
      }
      for (const sp of classDef.proficiencies?.shields ?? []) {
        if (sp === 'tower_shields' || sp === 'tower') {
          shieldCategories.add('tower');
          shieldCategories.add('shield');
        } else if (sp !== 'none') {
          shieldCategories.add('shield');
        }
      }
    } else if (track.trackCategory === 'racial_hd' && sysContent) {
      const cTypeDef = sysContent.creatureTypes[track.trackId];
      for (const wp of cTypeDef?.weaponProficiencies ?? []) {
        if (wp === 'simple' || wp === 'martial' || wp === 'exotic') {
          weaponCategories.add(wp);
        } else if (wp !== 'natural') {
          weaponIds.add(wp);
        }
      }
      for (const ap of cTypeDef?.armorProficiencies ?? []) {
        if (ap === 'light' || ap === 'medium' || ap === 'heavy') {
          armorCategories.add(ap);
        } else if (ap === 'shields') {
          shieldCategories.add('shield');
        }
      }
    }
  }

  if (tags.includes('type:outsider') || tags.includes('outsider')) {
    weaponCategories.add('simple');
    weaponCategories.add('martial');
  }

  if (tags.includes('proficiency:simple') || feats.includes('simple_weapon_proficiency')) {
    weaponCategories.add('simple');
  }
  if (tags.includes('proficiency:martial') || feats.includes('martial_weapon_proficiency_all')) {
    weaponCategories.add('martial');
  }
  if (tags.includes('proficiency:armor_light') || feats.includes('armor_proficiency_light')) {
    armorCategories.add('light');
  }
  if (tags.includes('proficiency:armor_medium') || feats.includes('armor_proficiency_medium')) {
    armorCategories.add('medium');
  }
  if (tags.includes('proficiency:armor_heavy') || feats.includes('armor_proficiency_heavy')) {
    armorCategories.add('heavy');
  }
  if (tags.includes('proficiency:shields') || feats.includes('shield_proficiency')) {
    shieldCategories.add('shield');
  }
  if (tags.includes('proficiency:tower_shield') || feats.includes('tower_shield_proficiency')) {
    shieldCategories.add('tower');
  }

  for (const featId of feats) {
    if (featId.startsWith('martial_weapon_proficiency:') || featId.startsWith('exotic_weapon_proficiency:')) {
      const targetWeapon = featId.split(':')[1];
      if (targetWeapon) weaponIds.add(targetWeapon);
    } else if (featId.startsWith('martial_weapon_proficiency_')) {
      weaponIds.add(featId.slice('martial_weapon_proficiency_'.length));
    } else if (featId.startsWith('exotic_weapon_proficiency_')) {
      weaponIds.add(featId.slice('exotic_weapon_proficiency_'.length));
    }
  }

  for (const tag of tags) {
    if (tag.startsWith('proficiency:')) {
      const suffix = tag.slice('proficiency:'.length);
      if (
        suffix !== 'simple' &&
        suffix !== 'martial' &&
        suffix !== 'armor_light' &&
        suffix !== 'armor_medium' &&
        suffix !== 'armor_heavy' &&
        suffix !== 'shields' &&
        suffix !== 'tower_shield'
      ) {
        weaponIds.add(suffix);
      }
    }
  }

  if (domains.includes('war') && deityFavoredWeaponId) {
    weaponIds.add(deityFavoredWeaponId);
  }

  if (raceId && sysContent?.races[raceId]) {
    const raceDef = sysContent.races[raceId]!;
    if (weaponCategories.has('martial')) {
      for (const famWeaponId of raceDef.weaponFamiliarityIds ?? []) {
        weaponIds.add(famWeaponId);
      }
    }
    for (const bundle of raceDef.traitBundles ?? []) {
      for (const gTag of bundle.grantedTags ?? []) {
        if (gTag.startsWith('proficiency:')) {
          weaponIds.add(gTag.slice('proficiency:'.length));
        }
      }
    }
  }

  if (sysContent) {
    for (const [itemId, itemDef] of Object.entries(sysContent.items)) {
      const profCat = itemDef.weaponStats?.proficiencyCategory;
      if (profCat && weaponCategories.has(profCat)) {
        weaponIds.add(itemId);
      }
    }
  }

  if (weaponIds.has('longbow')) weaponIds.add('composite_longbow');
  if (weaponIds.has('composite_longbow')) weaponIds.add('longbow');
  if (weaponIds.has('shortbow')) weaponIds.add('composite_shortbow');
  if (weaponIds.has('composite_shortbow')) weaponIds.add('shortbow');

  return {
    proficientWeaponCategories: Array.from(weaponCategories),
    proficientWeaponIds: Array.from(weaponIds),
    proficientArmorCategories: Array.from(armorCategories),
    proficientShieldCategories: Array.from(shieldCategories)
  };
}
