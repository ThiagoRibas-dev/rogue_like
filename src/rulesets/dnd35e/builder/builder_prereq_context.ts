import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { dndFloor } from '../math/multipliers.ts';
import type { PrerequisiteEvalContext } from '../prerequisites.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel,
  computeEffectiveClassCastingLevel
} from '../progression.ts';
import { collectClassChoiceFeats } from '../progression/ledger_choices.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import type {
  AbilityId,
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  DnD35SpellSchool,
  HitDieTrack
} from '../types/dnd35e.types.ts';
import type { DnD35ClassDefinition, DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { CharacterCreationDraft, LevelUpChoice } from './builder_core.ts';

/** Minimum class level at which half-casters (Paladin, Ranger) gain a Caster Level (`4`). */
const HALF_CASTER_MIN_CLASS_LEVEL = 4;

/** Divisor for half-caster Caster Level (`floor(effectiveClassLevel / 2)`). */
const HALF_CASTER_CL_DIVISOR = 2;

/** Hand count for 6-armed Marilith body plans (`6`) vs standard humanoid/quadruped (`2`). */
const MARILITH_HAND_COUNT = 6;
const DEFAULT_HAND_COUNT = 2;

/** Canonical Item Creation & Metamagic feat IDs for Loremaster / prerequisite pool counting. */
const ITEM_CREATION_AND_METAMAGIC_FEAT_IDS: ReadonlySet<string> = new Set([
  'empower_spell',
  'enlarge_spell',
  'extend_spell',
  'heighten_spell',
  'maximize_spell',
  'quicken_spell',
  'silent_spell',
  'still_spell',
  'widen_spell',
  'brew_potion',
  'craft_magic_arms_and_armor',
  'craft_rod',
  'craft_staff',
  'craft_wand',
  'craft_wondrous_item',
  'forge_ring',
  'scribe_scroll'
]);

/**
 * Computes the effective Caster Level for a single class track per D&D 3.5e SRD rules:
 * - Half-casters (`paladin`, `ranger`) have CL 0 at levels 1–3, and `floor(effectiveLevel / 2)` at level 4+.
 * - Other spellcasting classes have CL equal to their effective class casting level (including Prestige advancement).
 */
function computeSingleClassCasterLevel(
  classDef: DnD35ClassDefinition,
  tracks: ReadonlyArray<HitDieTrack>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  levelHistory?: ReadonlyArray<DnD35CharacterLevelRecord>
): number {
  if (classDef.castingMode === 'none') return 0;
  const effectiveLevel = computeEffectiveClassCastingLevel(tracks, classDef, classRegistry, levelHistory);
  if (effectiveLevel <= 0) return 0;
  if (classDef.id === 'paladin' || classDef.id === 'ranger') {
    return effectiveLevel >= HALF_CASTER_MIN_CLASS_LEVEL ? dndFloor(effectiveLevel / HALF_CASTER_CL_DIVISOR) : 0;
  }
  return effectiveLevel;
}

/**
 * Extracts weapon, armor, and shield proficiency categories and specific weapon IDs for an actor.
 */
function collectActorProficiencies(
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

  // Creature type automatic proficiencies (e.g., Outsiders are proficient with all simple and martial weapons)
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

  // Racial weapon familiarity (e.g., Dwarven Waraxe / Urgrosh, Gnome Hooked Hammer) treated as martial weapons
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

  // Expand weapon categories from sysContent.items if available
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

/**
 * Counts how many Metamagic and Item Creation feats the actor possesses.
 */
function countMetamagicAndItemCreationFeats(
  feats: ReadonlyArray<string>,
  sysContent?: Readonly<DnD35SystemContent>
): number {
  let count = 0;
  for (const featId of feats) {
    const baseId = featId.split(':')[0]!;
    const featDef = sysContent?.feats[baseId];
    if (featDef?.metamagicDescriptor !== undefined || ITEM_CREATION_AND_METAMAGIC_FEAT_IDS.has(baseId)) {
      count++;
    }
  }
  return count;
}

/**
 * Computes casting metrics (caster level, max arcane/divine prepared/spontaneous spell levels,
 * and known/accessible spell counts and max levels by school) across all tracks.
 */
function computeActorSpellcastingPrereqMetrics(
  tracks: ReadonlyArray<HitDieTrack>,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  levelHistory: ReadonlyArray<DnD35CharacterLevelRecord> | undefined,
  spellbooksByClass: DnD35EntityData['spellbooksByClass'],
  domains: ReadonlyArray<string>,
  addedSpellsForClass?: { readonly classId: string; readonly spellIds: ReadonlyArray<string> },
  sysContent?: Readonly<DnD35SystemContent>
): {
  readonly casterLevel: number;
  readonly maxArcaneSpellLevel: number;
  readonly maxDivineSpellLevel: number;
  readonly maxPreparedArcaneSpellLevel: number;
  readonly maxSpontaneousArcaneSpellLevel: number;
  readonly maxPreparedDivineSpellLevel: number;
  readonly maxSpontaneousDivineSpellLevel: number;
  readonly spellCountBySchool: Readonly<Partial<Record<DnD35SpellSchool, number>>>;
  readonly maxSpellLevelBySchool: Readonly<Partial<Record<DnD35SpellSchool, number>>>;
} {
  let maxArcaneSpellLevel = 0;
  let maxDivineSpellLevel = 0;
  let maxPreparedArcaneSpellLevel = -1;
  let maxSpontaneousArcaneSpellLevel = -1;
  let maxPreparedDivineSpellLevel = -1;
  let maxSpontaneousDivineSpellLevel = -1;
  let highestCasterLevel = 0;

  const spellsBySchool = new Map<DnD35SpellSchool, Set<string>>();
  const maxSpellLevelBySchool: Partial<Record<DnD35SpellSchool, number>> = {};

  const recordSpellSchool = (spellId: string, spellLevel: number): void => {
    const spellDef = sysContent?.spells[spellId];
    if (!spellDef) return;
    const school = spellDef.school as DnD35SpellSchool;
    let set = spellsBySchool.get(school);
    if (!set) {
      set = new Set<string>();
      spellsBySchool.set(school, set);
    }
    set.add(spellId);
    const prevMax = maxSpellLevelBySchool[school] ?? -1;
    if (spellLevel > prevMax) {
      maxSpellLevelBySchool[school] = spellLevel;
    }
  };

  for (const track of tracks) {
    const classDef = classRegistry[track.trackId];
    if (!classDef || classDef.castingMode === 'none') continue;
    const effectiveLevel = computeEffectiveClassCastingLevel(tracks, classDef, classRegistry, levelHistory);
    const classCl = computeSingleClassCasterLevel(classDef, tracks, classRegistry, levelHistory);
    if (classCl > highestCasterLevel) {
      highestCasterLevel = classCl;
    }

    const row = classDef.progression.find((r) => r.level === effectiveLevel);
    if (!row || !row.spellsPerDay) continue;
    let highestSlot = -1;
    for (const [lvlKey, slots] of Object.entries(row.spellsPerDay)) {
      const spellLvl = Number(lvlKey);
      if (!Number.isNaN(spellLvl) && slots >= 0 && spellLvl > highestSlot) {
        highestSlot = spellLvl;
      }
    }
    if (highestSlot < 0) continue;

    if (classDef.castingTradition === 'arcane') {
      if (highestSlot > maxArcaneSpellLevel) maxArcaneSpellLevel = highestSlot;
      if (classDef.castingMode === 'prepared' && highestSlot > maxPreparedArcaneSpellLevel) {
        maxPreparedArcaneSpellLevel = highestSlot;
      } else if (classDef.castingMode === 'spontaneous' && highestSlot > maxSpontaneousArcaneSpellLevel) {
        maxSpontaneousArcaneSpellLevel = highestSlot;
      }
    } else if (classDef.castingTradition === 'divine') {
      if (highestSlot > maxDivineSpellLevel) maxDivineSpellLevel = highestSlot;
      if (classDef.castingMode === 'prepared' && highestSlot > maxPreparedDivineSpellLevel) {
        maxPreparedDivineSpellLevel = highestSlot;
      } else if (classDef.castingMode === 'spontaneous' && highestSlot > maxSpontaneousDivineSpellLevel) {
        maxSpontaneousDivineSpellLevel = highestSlot;
      }
    }

    if (sysContent) {
      if (classDef.spellAcquisitionMode === 'prayerbook_full_list') {
        for (const [spellId, spellDef] of Object.entries(sysContent.spells)) {
          const lvl = spellDef.levelByClass[classDef.id];
          if (lvl !== undefined && lvl <= highestSlot) {
            recordSpellSchool(spellId, lvl);
          }
        }
        for (const domId of domains) {
          const domDef = sysContent.domains[domId];
          if (!domDef) continue;
          for (const [lvlKey, spellId] of Object.entries(domDef.domainSpells)) {
            const lvl = Number(lvlKey);
            if (!Number.isNaN(lvl) && lvl <= highestSlot) {
              recordSpellSchool(spellId, lvl);
            }
          }
        }
      } else {
        const knownIds = new Set<string>(spellbooksByClass?.[classDef.id]?.knownSpellIds ?? []);
        if (addedSpellsForClass && addedSpellsForClass.classId === classDef.id) {
          for (const sId of addedSpellsForClass.spellIds) {
            knownIds.add(sId);
          }
        }
        for (const spellId of knownIds) {
          const spellDef = sysContent.spells[spellId];
          if (!spellDef) continue;
          const lvl = spellDef.levelByClass[classDef.id] ?? spellDef.level;
          if (lvl <= highestSlot) {
            recordSpellSchool(spellId, lvl);
          }
        }
      }
    }
  }

  const spellCountBySchool: Partial<Record<DnD35SpellSchool, number>> = {};
  for (const [school, set] of spellsBySchool.entries()) {
    spellCountBySchool[school] = set.size;
  }

  return {
    casterLevel: highestCasterLevel,
    maxArcaneSpellLevel,
    maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel,
    spellCountBySchool,
    maxSpellLevelBySchool
  };
}

/**
 * Counts total natural attack weapons on an actor.
 */
function countActorNaturalAttacks(dndData: DnD35EntityData): number {
  let total = 0;
  for (const nw of dndData.naturalWeapons ?? []) {
    total += nw.count ?? 1;
  }
  return total;
}

/**
 * Computes maximum Spell-Like Ability (SLA) Caster Level on an actor.
 */
function computeMaxSlaCasterLevel(
  dndData: DnD35EntityData,
  characterLevel: number,
  sysContent?: Readonly<DnD35SystemContent>
): number {
  let maxSlaCl = 0;
  const raceDef = dndData.raceId ? sysContent?.races[dndData.raceId] : undefined;
  for (const bundle of raceDef?.traitBundles ?? []) {
    if (bundle.category === 'sp' || bundle.usageMode === 'spell_like') {
      maxSlaCl = Math.max(maxSlaCl, characterLevel);
    }
    for (const ab of bundle.activatedAbilities ?? []) {
      if (ab.spellLikeSpellId !== undefined) {
        maxSlaCl = Math.max(maxSlaCl, characterLevel);
      }
    }
  }
  return maxSlaCl;
}

/**
 * Builds a `PrerequisiteEvalContext` snapshot for an actor (`DnD35EntityData`) so feats, ACFs,
 * Templates, and Prestige Classes can be validated via `evaluatePrerequisiteAST()`.
 *
 * @param dndData The actor's `DnD35EntityData`.
 * @param classRegistry Loaded D&D 3.5e class definitions.
 * @param sysContent Optional full D&D 3.5e system content.
 * @returns `PrerequisiteEvalContext`.
 */
export function buildPrerequisiteContextForActor(
  dndData: DnD35EntityData,
  classRegistry: Readonly<Record<string, DnD35ClassDefinition>>,
  sysContent?: Readonly<DnD35SystemContent>
): PrerequisiteEvalContext {
  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(dndData.abilityScores.con));
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };

  const baseTags = projectDnD35ActorSemanticTags(dndData, [], undefined, classRegistry, sysContent?.skills);
  const raceDefForTags = dndData.raceId ? sysContent?.races[dndData.raceId] : undefined;
  const activeTags =
    raceDefForTags?.breathWeapon !== undefined && !baseTags.includes('trait:special_attack')
      ? [...baseTags, 'trait:special_attack']
      : baseTags;

  const classLevels: Record<string, number> = {};
  let characterLevel = 0;
  for (const track of dndData.tracks) {
    if (track.levels > 0) {
      characterLevel += track.levels;
      if (track.trackCategory !== 'racial_hd') {
        classLevels[track.trackId] = (classLevels[track.trackId] ?? 0) + track.levels;
      }
    }
  }
  characterLevel = Math.max(1, characterLevel);

  const profs = collectActorProficiencies(
    dndData.tracks,
    classRegistry,
    dndData.raceId,
    dndData.feats,
    activeTags,
    dndData.domains ?? [],
    dndData.deityFavoredWeaponId,
    sysContent
  );

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    dndData.tracks,
    classRegistry,
    dndData.levelHistory,
    dndData.spellbooksByClass,
    dndData.domains ?? [],
    undefined,
    sysContent
  );

  const handCount = dndData.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: dndData.skillRanks,
    feats: dndData.feats,
    tags: activeTags,
    casterLevel: castingMetrics.casterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel: castingMetrics.maxArcaneSpellLevel,
    maxDivineSpellLevel: castingMetrics.maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel: castingMetrics.maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel: castingMetrics.maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel: castingMetrics.maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel: castingMetrics.maxSpontaneousDivineSpellLevel,
    classLevels,
    characterLevel,
    proficientWeaponCategories: profs.proficientWeaponCategories,
    proficientWeaponIds: profs.proficientWeaponIds,
    proficientArmorCategories: profs.proficientArmorCategories,
    proficientShieldCategories: profs.proficientShieldCategories,
    naturalAttackCount: countActorNaturalAttacks(dndData),
    handCount,
    naturalArmorBonus: dndData.naturalArmorBonus,
    flySpeedFt: dndData.movementModes?.fly ?? 0,
    maxSlaCasterLevel: computeMaxSlaCasterLevel(dndData, characterLevel, sysContent),
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(dndData.feats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(dndData.arcaneSchool !== undefined ? { arcaneSchool: dndData.arcaneSchool } : {})
  };
}

/**
 * Builds a forward-projected `PrerequisiteEvalContext` representing the actor *after* applying the current level-up
 * choice (ability score increase, advanced class BAB/saves, added skill ranks, and feats granted or selected this level).
 *
 * @param dndData Current entity data before level-up.
 * @param choice The current level-up selection.
 * @param classDef Class definition of the advancing class.
 * @param sysContent Complete system content.
 * @param accumulatedFeatsThisLevel Feats chosen in earlier slots of the same level-up.
 * @returns Post-level-up `PrerequisiteEvalContext`.
 */
export function buildPostLevelUpPrerequisiteContext(
  dndData: DnD35EntityData,
  choice: LevelUpChoice,
  classDef: DnD35ClassDefinition,
  sysContent: DnD35SystemContent,
  accumulatedFeatsThisLevel: ReadonlyArray<string> = []
): PrerequisiteEvalContext {
  const abilityScores: Record<AbilityId, number | null> = {
    str: computeEffectiveAbilityScore(dndData.abilityScores.str),
    dex: computeEffectiveAbilityScore(dndData.abilityScores.dex),
    con: computeEffectiveAbilityScore(dndData.abilityScores.con),
    int: computeEffectiveAbilityScore(dndData.abilityScores.int),
    wis: computeEffectiveAbilityScore(dndData.abilityScores.wis),
    cha: computeEffectiveAbilityScore(dndData.abilityScores.cha)
  };
  if (choice.abilityScoreIncrease && abilityScores[choice.abilityScoreIncrease] !== null) {
    abilityScores[choice.abilityScoreIncrease] = (abilityScores[choice.abilityScoreIncrease] as number) + 1;
  }

  const existingTrack = dndData.tracks.find((t) => t.trackId === classDef.id);
  const nextClassLevel = (existingTrack ? existingTrack.levels : 0) + 1;

  const simulatedTracks: HitDieTrack[] = dndData.tracks.map((t) =>
    t.trackId === classDef.id ? buildHitDieTrackFromClass(classDef, nextClassLevel) : t
  );
  if (!existingTrack) {
    simulatedTracks.push(buildHitDieTrackFromClass(classDef, 1));
  }

  const conMod = computeAbilityModifier(abilityScores.con);
  const chassis = aggregateProgressionChassis(simulatedTracks, conMod, dndData.levelAdjustment ?? 0);

  const simulatedSkills: Record<string, number> = { ...dndData.skillRanks };
  for (const [skillId, ranks] of Object.entries(choice.addedSkillRanks)) {
    if (ranks > 0) {
      simulatedSkills[skillId] = (simulatedSkills[skillId] ?? 0) + ranks;
    }
  }

  const activeFeatures = collectClassFeaturesUpToLevel(classDef, nextClassLevel, [
    ...(dndData.selectedAcfs ?? []),
    ...(choice.selectedAcfs ?? [])
  ]);
  const combinedActiveFeatures = Array.from(new Set([...(dndData.activeClassFeatures ?? []), ...activeFeatures]));
  const combinedDomains = Array.from(new Set(dndData.domains ?? []));
  const simulatedDndForTags: DnD35EntityData = {
    ...dndData,
    tracks: simulatedTracks,
    activeClassFeatures: combinedActiveFeatures,
    domains: combinedDomains,
    skillRanks: simulatedSkills
  };
  const activeTags = projectDnD35ActorSemanticTags(
    simulatedDndForTags,
    [],
    undefined,
    sysContent.classes,
    sysContent.skills
  );

  const choiceFeats = collectClassChoiceFeats(
    combinedActiveFeatures,
    combinedDomains,
    choice.deityFavoredWeaponId ?? dndData.deityFavoredWeaponId,
    choice.combatStyle ?? dndData.combatStyle,
    choice.familiarId ?? dndData.familiarId,
    dndData.companions,
    dndData.scalingPools ?? {},
    [...(dndData.rogueSpecialAbilities ?? []), ...(choice.rogueSpecialAbility ? [choice.rogueSpecialAbility] : [])],
    sysContent,
    activeTags
  );

  const simulatedFeats: string[] = [...(dndData.feats ?? []), ...choiceFeats, ...accumulatedFeatsThisLevel];
  for (const featKey of activeFeatures) {
    const featDetail = classDef.featureDetails[featKey];
    if (featDetail?.grantedFeats) {
      simulatedFeats.push(...featDetail.grantedFeats);
    }
  }
  const deduplicatedFeats = Array.from(new Set(simulatedFeats));

  const classLevels: Record<string, number> = {};
  let characterLevel = 0;
  for (const track of simulatedTracks) {
    if (track.levels > 0) {
      characterLevel += track.levels;
      if (track.trackCategory !== 'racial_hd') {
        classLevels[track.trackId] = (classLevels[track.trackId] ?? 0) + track.levels;
      }
    }
  }
  characterLevel = Math.max(1, characterLevel);

  const profs = collectActorProficiencies(
    simulatedTracks,
    sysContent.classes,
    dndData.raceId,
    deduplicatedFeats,
    activeTags,
    combinedDomains,
    choice.deityFavoredWeaponId ?? dndData.deityFavoredWeaponId,
    sysContent
  );

  const simulatedHistory: DnD35CharacterLevelRecord[] = [
    ...(dndData.levelHistory ?? []),
    {
      characterLevel,
      classId: classDef.id,
      classLevel: nextClassLevel,
      hpRolled: 1,
      addedSkillRanks: choice.addedSkillRanks,
      selectedFeats: choice.selectedFeats,
      selectedAcfs: choice.selectedAcfs ?? [],
      learnedSpells: choice.learnedSpells ?? [],
      ...(choice.advancedSpellcastingClassIds !== undefined
        ? { advancedSpellcastingClassIds: choice.advancedSpellcastingClassIds }
        : {}),
      ...(choice.learnedSpellsByClass !== undefined ? { learnedSpellsByClass: choice.learnedSpellsByClass } : {})
    }
  ];

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    simulatedTracks,
    sysContent.classes,
    simulatedHistory,
    dndData.spellbooksByClass,
    combinedDomains,
    choice.learnedSpells ? { classId: classDef.id, spellIds: choice.learnedSpells } : undefined,
    sysContent
  );

  const handCount = dndData.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;

  return {
    abilityScores,
    totalBab: chassis.totalBab,
    skillRanks: simulatedSkills,
    feats: deduplicatedFeats,
    tags: activeTags,
    casterLevel: castingMetrics.casterLevel,
    sizeCategory: dndData.sizeCategory,
    ...(dndData.alignment !== undefined ? { alignment: dndData.alignment } : {}),
    ...(dndData.raceId !== undefined ? { raceId: dndData.raceId } : {}),
    maxArcaneSpellLevel: castingMetrics.maxArcaneSpellLevel,
    maxDivineSpellLevel: castingMetrics.maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel: castingMetrics.maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel: castingMetrics.maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel: castingMetrics.maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel: castingMetrics.maxSpontaneousDivineSpellLevel,
    classLevels,
    characterLevel,
    proficientWeaponCategories: profs.proficientWeaponCategories,
    proficientWeaponIds: profs.proficientWeaponIds,
    proficientArmorCategories: profs.proficientArmorCategories,
    proficientShieldCategories: profs.proficientShieldCategories,
    naturalAttackCount: countActorNaturalAttacks(dndData),
    handCount,
    naturalArmorBonus: dndData.naturalArmorBonus,
    flySpeedFt: dndData.movementModes?.fly ?? 0,
    maxSlaCasterLevel: computeMaxSlaCasterLevel(dndData, characterLevel, sysContent),
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(deduplicatedFeats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(dndData.arcaneSchool !== undefined ? { arcaneSchool: dndData.arcaneSchool } : {})
  };
}

/**
 * Builds a complete `PrerequisiteEvalContext` for a 1st-level `CharacterCreationDraft`
 * (including racial traits, class features, domains, weapon/armor proficiencies, and half-caster CL rules).
 *
 * @param draft Current `CharacterCreationDraft`.
 * @param sysContent Loaded D&D 3.5e system content.
 * @param accumulatedFeatsThisStep Feats already chosen in earlier slots during Step 5.
 * @returns Complete `PrerequisiteEvalContext`.
 */
export function buildCreationDraftPrerequisiteContext(
  draft: CharacterCreationDraft,
  sysContent: DnD35SystemContent,
  accumulatedFeatsThisStep: ReadonlyArray<string> = []
): PrerequisiteEvalContext {
  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];

  const abilityScores: Record<AbilityId, number | null> = {
    str: draft.baseAbilityScores.str + (raceDef?.abilityAdjustments.str ?? 0),
    dex: draft.baseAbilityScores.dex + (raceDef?.abilityAdjustments.dex ?? 0),
    con: draft.baseAbilityScores.con + (raceDef?.abilityAdjustments.con ?? 0),
    int: draft.baseAbilityScores.int + (raceDef?.abilityAdjustments.int ?? 0),
    wis: draft.baseAbilityScores.wis + (raceDef?.abilityAdjustments.wis ?? 0),
    cha: draft.baseAbilityScores.cha + (raceDef?.abilityAdjustments.cha ?? 0)
  };

  if (!raceDef || !classDef) {
    return {
      abilityScores,
      totalBab: classDef?.progression[0]?.bab ?? 0,
      skillRanks: draft.skillRanks,
      feats: accumulatedFeatsThisStep,
      tags: [],
      casterLevel: 0,
      sizeCategory: raceDef?.size ?? 'medium',
      alignment: draft.alignment,
      raceId: draft.raceId
    };
  }

  const simulatedTracks: HitDieTrack[] = [buildHitDieTrackFromClass(classDef, 1)];
  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);

  const tags = new Set<string>([`size:${raceDef.size}`, raceDef.creatureType, `type:${raceDef.creatureType}`]);
  for (const sub of raceDef.subtypes ?? []) {
    tags.add(sub);
    tags.add(`subtype:${sub}`);
  }
  for (const bundle of raceDef.traitBundles ?? []) {
    for (const gTag of bundle.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  for (const fId of activeFeatures) {
    tags.add(`feature:${fId}`);
    if (fId === 'turn_or_rebuke_undead' || fId === 'turn_undead_paladin' || fId === 'command_undead') {
      tags.add('feature:turn_or_rebuke');
    }
    if (fId === 'wild_shape_1' || fId.startsWith('wild_shape')) {
      tags.add('feature:wild_shape');
    }
    if (fId.startsWith('sneak_attack') || fId.startsWith('smite_') || fId === 'death_attack') {
      tags.add('trait:special_attack');
    }
    const detail = classDef.featureDetails[fId];
    for (const gTag of detail?.grantedTags ?? []) {
      tags.add(gTag);
    }
  }
  for (const domId of draft.domains) {
    const domDef = sysContent.domains[domId];
    for (const gTag of domDef?.grantedPowerBundle?.grantedTags ?? []) {
      tags.add(gTag);
    }
    if (
      domId === 'air' ||
      domId === 'earth' ||
      domId === 'fire' ||
      domId === 'water' ||
      domId === 'plant' ||
      domId === 'sun'
    ) {
      tags.add('feature:turn_or_rebuke');
    }
  }
  if ((raceDef.movementModes?.fly ?? 0) > 0) {
    tags.add('movement:fly');
  }
  if (raceDef.breathWeapon !== undefined) {
    tags.add('trait:special_attack');
  }
  const activeTags = Array.from(tags);

  const autoGrantedFeats: string[] = [...(raceDef.feats ?? [])];
  for (const bundle of raceDef.traitBundles ?? []) {
    autoGrantedFeats.push(...(bundle.grantedFeats ?? []));
  }
  for (const fId of activeFeatures) {
    const detail = classDef.featureDetails[fId];
    if (detail?.grantedFeats) {
      autoGrantedFeats.push(...detail.grantedFeats);
    }
  }
  for (const domId of draft.domains) {
    const domDef = sysContent.domains[domId];
    if (domDef?.featGrants) {
      autoGrantedFeats.push(...domDef.featGrants);
    }
    if (domDef?.grantedPowerBundle?.grantedFeats) {
      autoGrantedFeats.push(...domDef.grantedPowerBundle.grantedFeats);
    }
  }
  const choiceFeats = collectClassChoiceFeats(
    activeFeatures,
    draft.domains,
    draft.deityFavoredWeaponId,
    draft.combatStyle,
    draft.familiarId,
    [],
    {},
    [],
    sysContent,
    activeTags
  );
  const allFeats = Array.from(new Set([...autoGrantedFeats, ...choiceFeats, ...accumulatedFeatsThisStep]));

  const profs = collectActorProficiencies(
    simulatedTracks,
    sysContent.classes,
    raceDef.id,
    allFeats,
    activeTags,
    draft.domains,
    draft.deityFavoredWeaponId,
    sysContent
  );

  const castingMetrics = computeActorSpellcastingPrereqMetrics(
    simulatedTracks,
    sysContent.classes,
    undefined,
    undefined,
    draft.domains,
    { classId: classDef.id, spellIds: draft.knownSpells },
    sysContent
  );

  const characterLevel = Math.max(1, (raceDef.rhdProgression?.baseHdCount ?? 0) + 1);
  const handCount = raceDef.anatomyBodyPlan === 'marilith_6arm' ? MARILITH_HAND_COUNT : DEFAULT_HAND_COUNT;
  let naturalAttackCount = 0;
  for (const nw of raceDef.naturalWeapons ?? []) {
    naturalAttackCount += nw.count ?? 1;
  }

  return {
    abilityScores,
    totalBab: classDef.progression[0]?.bab ?? 0,
    skillRanks: draft.skillRanks,
    feats: allFeats,
    tags: activeTags,
    casterLevel: castingMetrics.casterLevel,
    sizeCategory: raceDef.size,
    alignment: draft.alignment,
    raceId: raceDef.id,
    maxArcaneSpellLevel: castingMetrics.maxArcaneSpellLevel,
    maxDivineSpellLevel: castingMetrics.maxDivineSpellLevel,
    maxPreparedArcaneSpellLevel: castingMetrics.maxPreparedArcaneSpellLevel,
    maxSpontaneousArcaneSpellLevel: castingMetrics.maxSpontaneousArcaneSpellLevel,
    maxPreparedDivineSpellLevel: castingMetrics.maxPreparedDivineSpellLevel,
    maxSpontaneousDivineSpellLevel: castingMetrics.maxSpontaneousDivineSpellLevel,
    classLevels: { [classDef.id]: 1 },
    characterLevel,
    proficientWeaponCategories: profs.proficientWeaponCategories,
    proficientWeaponIds: profs.proficientWeaponIds,
    proficientArmorCategories: profs.proficientArmorCategories,
    proficientShieldCategories: profs.proficientShieldCategories,
    naturalAttackCount,
    handCount,
    naturalArmorBonus: raceDef.naturalArmorBonus ?? 0,
    flySpeedFt: raceDef.movementModes?.fly ?? 0,
    maxSlaCasterLevel: 0,
    metamagicOrItemCreationFeatCount: countMetamagicAndItemCreationFeats(allFeats, sysContent),
    spellCountBySchool: castingMetrics.spellCountBySchool,
    maxSpellLevelBySchool: castingMetrics.maxSpellLevelBySchool,
    ...(draft.arcaneSchool !== undefined ? { arcaneSchool: draft.arcaneSchool } : {})
  };
}
