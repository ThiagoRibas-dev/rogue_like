import { describe, expect, it } from 'bun:test';
import { getComponent } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import {
  applyCharacterCreationToPlayer,
  applyLevelUpToActor,
  applyNegativeLevelsToActor,
  applyPermanentLevelDrainToActor,
  buildClassAndDomainEffectModifiers,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  calculateSkillAllocationCost,
  collectActiveGrantedAndVirtualFeats,
  computeFirstLevelFeatSlotBudget,
  computeNpcClassCrContribution,
  ELITE_ABILITY_ARRAY,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  getSpellLevelForClass,
  isSpellSelectableForDraft,
  NONELITE_ABILITY_ARRAY,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest,
  sanitizeDraftOnRaceOrClassChange,
  validateSpecialistSchoolSelection
} from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import {
  calculateMulticlassXpMultiplier,
  collectClassFeaturesUpToLevel,
  getClassLevelRow,
  resolveActiveClassFeatures
} from '../src/rulesets/dnd35e/progression.ts';
import {
  buildSkillRankThresholdModifiers,
  computeSkillSynergyBonus,
  getSkillsGrantedSynergyBy,
  resolveSkillCheck
} from '../src/rulesets/dnd35e/skills.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType, type FighterComponent } from '../src/types/components.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 23: D&D 3.5e Core 11 Classes, 5 NPC Classes, Prestige Classes, ACFs, Domains & Character Builder', () => {
  it('loads and validates all 11 Base PC Classes, 5 NPC Classes, 10 Prestige Classes, and 22 Cleric Domains via split JSONs', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const baseClasses = Object.values(sys.classes).filter((c) => !c.isPrestige && !c.isNpcClass);
    const npcClasses = Object.values(sys.classes).filter((c) => c.isNpcClass);
    const prestigeClasses = Object.values(sys.classes).filter((c) => c.isPrestige);

    expect(baseClasses.map((c) => c.id).sort()).toEqual([
      'barbarian',
      'bard',
      'cleric',
      'druid',
      'fighter',
      'monk',
      'paladin',
      'ranger',
      'rogue',
      'sorcerer',
      'wizard'
    ]);

    expect(npcClasses.map((c) => c.id).sort()).toEqual([
      'adept',
      'aristocrat',
      'commoner',
      'expert',
      'warrior'
    ]);

    expect(prestigeClasses.map((c) => c.id).sort()).toEqual([
      'arcane_archer',
      'assassin',
      'blackguard',
      'dragon_disciple',
      'duelist',
      'dwarven_defender',
      'eldritch_knight',
      'loremaster',
      'mystic_theurge',
      'shadowdancer'
    ]);

    expect(Object.keys(sys.domains).length).toBe(22);
    for (const dom of Object.values(sys.domains)) {
      expect(dom.grantedPowerBundle).toBeDefined();
      expect(dom.grantedPowerBundle?.bundleId).toBe(`domain_power_${dom.id}`);
    }

    // Every base PC and NPC class has maxLevel 20 and progression array with 20 rows
    for (const cls of [...baseClasses, ...npcClasses]) {
      expect(cls.maxLevel).toBe(20);
      expect(cls.progression).toBeDefined();
      expect(cls.progression.length).toBe(20);
      expect(cls.progression[0]?.level).toBe(1);
      expect(cls.progression[19]?.level).toBe(20);
    }

    // Every prestige class has progression array matching maxLevel
    for (const cls of prestigeClasses) {
      expect(cls.progression).toBeDefined();
      expect(cls.progression.length).toBe(cls.maxLevel);
    }
  });

  it('swaps features via Alternate Class Features (ACFs) across levels 1..20', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const barbarian = sys.classes['barbarian'];
    expect(barbarian).toBeDefined();
    if (!barbarian) return;

    // Default Barbarian has fast_movement and rage_1 at level 1
    const baseFeatures = collectClassFeaturesUpToLevel(barbarian, 1, []);
    expect(baseFeatures).toContain('fast_movement');
    expect(baseFeatures).toContain('rage_1');

    // With Lion Spirit Totem + Whirling Frenzy ACFs
    const acfFeatures = collectClassFeaturesUpToLevel(barbarian, 1, [
      'barbarian_lion_spirit_totem_1',
      'barbarian_whirling_frenzy_1'
    ]);
    expect(acfFeatures).not.toContain('fast_movement');
    expect(acfFeatures).toContain('pounce');
    expect(acfFeatures).not.toContain('rage_1');
    expect(acfFeatures).toContain('whirling_frenzy');

    // Fighter Dungeon Crasher ACF swaps fighter_bonus_feat_2 at level 2
    const fighter = sys.classes['fighter'];
    expect(fighter).toBeDefined();
    if (!fighter) return;
    const fighterLv6 = resolveActiveClassFeatures(
      ['fighter_bonus_feat_1', 'fighter_bonus_feat_2', 'fighter_bonus_feat_4', 'fighter_bonus_feat_6'],
      ['fighter_dungeon_crasher_2'],
      fighter
    );
    expect(fighterLv6).toContain('dungeon_crasher_1');
    expect(fighterLv6).not.toContain('fighter_bonus_feat_2');
  });

  it('evaluates Prestige Class prerequisite ASTs including alignment_in, min_spell_level, and race_in', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const arcaneArcher = sys.classes['arcane_archer'];
    const mysticTheurge = sys.classes['mystic_theurge'];
    const assassin = sys.classes['assassin'];
    expect(arcaneArcher?.prerequisites).toBeDefined();
    expect(mysticTheurge?.prerequisites).toBeDefined();
    expect(assassin?.prerequisites).toBeDefined();

    // Arcane Archer requires Elf/Half-Elf, BAB +6, feats, and 1st-level arcane spells
    if (arcaneArcher?.prerequisites) {
      const validArcherCtx = {
        abilityScores: { str: 14, dex: 18, con: 12, int: 14, wis: 10, cha: 10 },
        totalBab: 6,
        casterLevel: 1,
        sizeCategory: 'medium' as const,
        feats: ['point_blank_shot', 'precise_shot', 'weapon_focus'],
        skillRanks: {},
        tags: [],
        raceId: 'elf',
        maxArcaneSpellLevel: 1
      };
      expect(evaluatePrerequisiteAST(arcaneArcher.prerequisites, validArcherCtx)).toBe(true);
      expect(
        evaluatePrerequisiteAST(arcaneArcher.prerequisites, { ...validArcherCtx, raceId: 'human' })
      ).toBe(false);
    }

    // Mystic Theurge requires 2nd-level arcane + 2nd-level divine + Knowledge (arcana) 6 + Knowledge (religion) 6
    if (mysticTheurge?.prerequisites) {
      const validTheurgeCtx = {
        abilityScores: { str: 10, dex: 12, con: 12, int: 16, wis: 16, cha: 10 },
        totalBab: 3,
        casterLevel: 6,
        sizeCategory: 'medium' as const,
        feats: [],
        skillRanks: { knowledge_arcana: 6, knowledge_religion: 6 },
        tags: [],
        maxArcaneSpellLevel: 2,
        maxDivineSpellLevel: 2
      };
      expect(evaluatePrerequisiteAST(mysticTheurge.prerequisites, validTheurgeCtx)).toBe(true);
      expect(
        evaluatePrerequisiteAST(mysticTheurge.prerequisites, { ...validTheurgeCtx, maxDivineSpellLevel: 1 })
      ).toBe(false);
    }
  });

  it('calculates Multiclass XP penalty accurately (favored class, prestige exemption, -20% per uneven base class)', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const fighterTrack = {
      trackId: 'fighter',
      levels: 5,
      hitDieSides: 10 as const,
      babCurve: 'full' as const,
      fortCurve: 'good' as const,
      refCurve: 'poor' as const,
      willCurve: 'poor' as const,
      skillPointsPerLevel: 2
    };
    const rogueTrack = {
      trackId: 'rogue',
      levels: 2,
      hitDieSides: 6 as const,
      babCurve: 'three_quarters' as const,
      fortCurve: 'poor' as const,
      refCurve: 'good' as const,
      willCurve: 'poor' as const,
      skillPointsPerLevel: 8
    };

    // Human (favoredClass: 'any') Fighter 5 / Rogue 2 -> Fighter 5 is ignored as highest, only Rogue 2 remains -> 1.0
    expect(calculateMulticlassXpMultiplier([fighterTrack, rogueTrack], sys.classes, 'any', true)).toBe(1.0);

    // Elf (favoredClass: 'wizard') Fighter 5 / Rogue 2 -> neither is wizard; Rogue 2 is >1 below Fighter 5 -> 0.8
    expect(calculateMulticlassXpMultiplier([fighterTrack, rogueTrack], sys.classes, 'wizard', true)).toBe(0.8);

    // Prestige classes (e.g. Eldritch Knight 4) are exempt from uneven multiclass checks
    const wizardTrack = { ...rogueTrack, trackId: 'wizard', levels: 5, hitDieSides: 4 as const };
    const fighterDip = { ...fighterTrack, levels: 1 };
    const ekTrack = { ...fighterTrack, trackId: 'eldritch_knight', levels: 4, hitDieSides: 6 as const };
    expect(
      calculateMulticlassXpMultiplier([wizardTrack, fighterDip, ekTrack], sys.classes, 'wizard', true)
    ).toBe(1.0);

    // Disabled campaign toggle always returns 1.0
    expect(calculateMulticlassXpMultiplier([fighterTrack, rogueTrack], sys.classes, 'wizard', false)).toBe(1.0);
  });

  it('validates point-buy, specialist school selection, character creation commit, and level-up advancement', () => {
    initRNG(42);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const state = buildGameState(campaign);
    const sys = getDnD35SystemContent(state.campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // Point buy cost for Elite Array (15, 14, 13, 12, 10, 8) = 8 + 6 + 5 + 4 + 2 + 0 = 25
    expect(
      calculatePointBuyCost({
        str: ELITE_ABILITY_ARRAY[0] ?? 15,
        dex: ELITE_ABILITY_ARRAY[1] ?? 14,
        con: ELITE_ABILITY_ARRAY[2] ?? 13,
        int: ELITE_ABILITY_ARRAY[3] ?? 12,
        wis: ELITE_ABILITY_ARRAY[4] ?? 10,
        cha: ELITE_ABILITY_ARRAY[5] ?? 8
      })
    ).toBe(POINT_BUY_PRESETS[0]);

    // Roll 4d6 drop lowest produces valid scores in 3..18
    const rolled = rollAbilityScores4d6DropLowest();
    expect(rolled.str).toBeGreaterThanOrEqual(3);
    expect(rolled.str).toBeLessThanOrEqual(18);

    // Specialist Wizard school validation: Evocation requires 2 non-divination prohibited schools; Divination requires 1
    expect(validateSpecialistSchoolSelection('evocation', ['enchantment', 'necromancy']).valid).toBe(true);
    expect(validateSpecialistSchoolSelection('evocation', ['enchantment']).valid).toBe(false);
    expect(validateSpecialistSchoolSelection('divination', ['illusion']).valid).toBe(true);

    // Skill point budget and cross-class cost
    const clericCls = sys.classes['cleric']!;
    const humanRace = sys.races['human']!;
    expect(
      calculateLevelSkillPointBudget(
        clericCls.skillPointsPerLevel,
        1,
        true,
        humanRace.extraSkillPointsFirstLevel,
        humanRace.extraSkillPointsPerLevel
      )
    ).toBe((2 + 1) * 4 + 4);
    expect(getSkillMaxRanks(1, true)).toBe(4);
    expect(getSkillMaxRanks(1, false)).toBe(2);
    expect(calculateSkillAllocationCost({ concentration: 4, tumble: 1 }, clericCls.classSkills)).toBe(4 + 2);

    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // Commit a Level 1 Cleric with War and Chaos domains
    const createdState = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      classId: 'cleric',
      alignment: 'CG',
      selectedAcfs: ['domain_spontaneity'],
      domains: ['war', 'chaos'],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
      skillRanks: { concentration: 4, heal: 4, spellcraft: 4 },
      selectedFeats: ['combat_casting', 'improved_initiative'],
      knownSpells: ['cure_light_wounds', 'bless'],
      equipmentPackageId: 'divine_templar'
    });

    const createdDnd = getDnD35EntityData(createdState, playerId);
    expect(createdDnd.tracks[0]?.trackId).toBe('cleric');
    expect(createdDnd.domains).toEqual(['war', 'chaos']);
    expect(createdDnd.selectedAcfs).toContain('domain_spontaneity');

    // Verify hierarchical sourcePath provenance on class & domain modifiers
    const modifiers = buildClassAndDomainEffectModifiers(
      createdDnd.tracks,
      createdDnd.selectedAcfs ?? [],
      createdDnd.domains ?? [],
      sys.classes,
      sys.domains
    );
    expect(modifiers.some((m) => m.sourcePath?.startsWith('class:cleric/domain:chaos/'))).toBe(true);

    // Advance player to Level 2 via applyLevelUpToActor
    const leveledResult = applyLevelUpToActor(createdState, playerId, {
      classId: 'cleric',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, heal: 1, spellcraft: 1 },
      selectedFeats: [],
      learnedSpells: ['shield_of_faith']
    });
    expect(leveledResult.success).toBe(true);
    const leveledFighter = getComponent(leveledResult.state, playerId, ComponentType.Fighter) as FighterComponent;
    expect(leveledFighter.level).toBe(2);
    const leveledDnd = getDnD35EntityData(leveledResult.state, playerId);
    expect(leveledDnd.tracks[0]?.levels).toBe(2);
    expect(leveledDnd.skillRanks['concentration']).toBe(5);

    const prereqCtx = buildPrerequisiteContextForActor(leveledDnd, sys.classes);
    expect(prereqCtx.maxDivineSpellLevel).toBeGreaterThanOrEqual(1);
  });

  it('queries direct level rows from progression and verifies Cleric domain slots and Prestige advancesSpellcasting', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const cleric = sys.classes['cleric']!;
    const row3 = getClassLevelRow(cleric, 3);
    expect(row3).toBeDefined();
    expect(row3?.level).toBe(3);
    expect(row3?.bab).toBe(2);
    expect(row3?.fortSave).toBe(3);
    expect(row3?.refSave).toBe(1);
    expect(row3?.willSave).toBe(3);
    expect(row3?.spellsPerDay?.['2']).toBe(1);
    expect(row3?.domainSpellSlots?.['2']).toBe(1);

    const eldritchKnight = sys.classes['eldritch_knight']!;
    const ekRow1 = getClassLevelRow(eldritchKnight, 1);
    const ekRow2 = getClassLevelRow(eldritchKnight, 2);
    expect(ekRow1?.advancesSpellcasting).toBeUndefined();
    expect(ekRow2?.advancesSpellcasting).toBe('arcane');

    const mysticTheurge = sys.classes['mystic_theurge']!;
    const mtRow1 = getClassLevelRow(mysticTheurge, 1);
    expect(mtRow1?.advancesSpellcasting).toBe('both');
  });

  it('supports chronological multiclassing (Fighter 4 -> Rogue 2 -> Fighter 5), negative levels, and permanent level drain rollback', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // 1. Level 1 Human Fighter
    state = applyCharacterCreationToPlayer(state, playerId, {
      raceId: 'human',
      classId: 'fighter',
      alignment: 'LN',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 8 },
      skillRanks: { jump: 4, climb: 4 },
      selectedFeats: ['power_attack', 'cleave', 'weapon_focus_longsword'],
      knownSpells: [],
      equipmentPackageId: 'martial_vanguard'
    });

    let dnd = getDnD35EntityData(state, playerId);
    expect(dnd.tracks.length).toBe(1);
    expect(dnd.tracks[0]?.trackId).toBe('fighter');
    expect(dnd.tracks[0]?.levels).toBe(1);
    expect(dnd.levelHistory?.length).toBe(1);

    // 2. Advance to Fighter 4 (Level 2, 3, 4 with +1 STR at Level 4)
    for (let lvl = 2; lvl <= 4; lvl++) {
      const res = applyLevelUpToActor(state, playerId, {
        classId: 'fighter',
        hpMethod: 'average',
        addedSkillRanks: { jump: 1 },
        selectedFeats: lvl === 2 ? ['combat_reflexes'] : [],
        abilityScoreIncrease: lvl === 4 ? 'str' : undefined
      });
      expect(res.success).toBe(true);
      state = res.state;
    }

    dnd = getDnD35EntityData(state, playerId);
    expect(dnd.tracks[0]?.levels).toBe(4);
    expect(dnd.abilityScores.str.base).toBe(17);
    expect(dnd.levelHistory?.length).toBe(4);

    // 3. Multiclass into Rogue 1 and Rogue 2
    for (let rLvl = 1; rLvl <= 2; rLvl++) {
      const res = applyLevelUpToActor(state, playerId, {
        classId: 'rogue',
        hpMethod: 'average',
        addedSkillRanks: { tumble: 4, search: 4 },
        selectedFeats: []
      });
      expect(res.success).toBe(true);
      state = res.state;
    }

    dnd = getDnD35EntityData(state, playerId);
    expect(dnd.tracks.length).toBe(2);
    expect(dnd.tracks.find((t) => t.trackId === 'fighter')?.levels).toBe(4);
    expect(dnd.tracks.find((t) => t.trackId === 'rogue')?.levels).toBe(2);
    expect(dnd.levelHistory?.length).toBe(6);

    // 4. Return to Fighter for Fighter 5 (Character Level 7)
    const resF5 = applyLevelUpToActor(state, playerId, {
      classId: 'fighter',
      hpMethod: 'average',
      addedSkillRanks: { jump: 1 },
      selectedFeats: []
    });
    expect(resF5.success).toBe(true);
    state = resF5.state;

    dnd = getDnD35EntityData(state, playerId);
    const fTrack = dnd.tracks.find((t) => t.trackId === 'fighter')!;
    const rTrack = dnd.tracks.find((t) => t.trackId === 'rogue')!;
    expect(fTrack.levels).toBe(5);
    expect(rTrack.levels).toBe(2);
    expect(dnd.levelHistory?.length).toBe(7);
    expect(fTrack.explicitBab).toBe(5);
    expect(rTrack.explicitBab).toBe(1);

    const fighterComp = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    expect(fighterComp.level).toBe(7);
    expect(fighterComp.attack).toBe(6); // 5 + 1

    // 5. Apply 1 Temporary Negative Level
    state = applyNegativeLevelsToActor(state, playerId, 1);
    dnd = getDnD35EntityData(state, playerId);
    expect(dnd.negativeLevels).toBe(1);
    const negMods = (dnd.statModifiers ?? []).filter((m) => m.sourcePath?.startsWith('condition:negative_level'));
    expect(negMods.length).toBe(5);
    expect(negMods.find((m) => m.targetStat === 'attack')?.value).toBe(-1);

    // 6. Apply 2 Permanent Levels Drained (rolls back Fighter 5 and Rogue 2 in LIFO order)
    const drainResult = applyPermanentLevelDrainToActor(state, playerId, 2);
    expect(drainResult.success).toBe(true);
    state = drainResult.state;

    dnd = getDnD35EntityData(state, playerId);
    expect(dnd.levelHistory?.length).toBe(5);
    const rolledBackF = dnd.tracks.find((t) => t.trackId === 'fighter')!;
    const rolledBackR = dnd.tracks.find((t) => t.trackId === 'rogue')!;
    expect(rolledBackF.levels).toBe(4);
    expect(rolledBackR.levels).toBe(1);
    const postDrainFighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    expect(postDrainFighter.level).toBe(5);
    expect(postDrainFighter.attack).toBe(4); // Fighter 4 (4) + Rogue 1 (0) = 4
  });

  it('evaluates NPC Class CR scaling, Domain grantedPowerBundle atomic suppression, Ranger virtualFeatGrants with activationCondition, and Skill rankThresholdModifiers', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // 1. NPC Class CR scaling & Nonelite Ability Array
    expect(NONELITE_ABILITY_ARRAY).toEqual([13, 12, 11, 10, 9, 8]);
    expect(computeNpcClassCrContribution(1, false)).toBe(0.5);
    expect(computeNpcClassCrContribution(3, false)).toBe(2);
    expect(computeNpcClassCrContribution(2, true)).toBe(1.0); // +0.5 CR per level on monsters with RHD

    // 2. Domain grantedPowerBundle atomic suppression (e.g. Ordained Champion trading War domain power for a Fighter feat)
    const clericTrack = {
      trackId: 'cleric',
      trackCategory: 'pc' as const,
      levels: 1,
      hitDieSides: 8 as const,
      babCurve: 'three_quarters' as const,
      fortCurve: 'good' as const,
      refCurve: 'poor' as const,
      willCurve: 'good' as const,
      skillPointsPerLevel: 2
    };
    const warFeatsActive = collectActiveGrantedAndVirtualFeats(
      [clericTrack],
      [],
      ['war'],
      sys.classes,
      sys.domains,
      []
    );
    expect(warFeatsActive).toContain('weapon_focus');

    const warFeatsSuppressed = collectActiveGrantedAndVirtualFeats(
      [clericTrack],
      [],
      ['war'],
      sys.classes,
      sys.domains,
      ['domain_power_war']
    );
    expect(warFeatsSuppressed).not.toContain('weapon_focus');

    const chaosModsActive = buildClassAndDomainEffectModifiers(
      [clericTrack],
      [],
      ['chaos'],
      sys.classes,
      sys.domains,
      []
    );
    expect(chaosModsActive.length).toBeGreaterThan(0);

    const chaosModsSuppressed = buildClassAndDomainEffectModifiers(
      [clericTrack],
      [],
      ['chaos'],
      sys.classes,
      sys.domains,
      ['domain_power_chaos']
    );
    expect(chaosModsSuppressed.length).toBe(0);

    // 3. Ranger combat_style_1 virtualFeatGrants (ignorePrerequisites: true) & activationCondition (deactivates in medium/heavy armor)
    const rangerTrack = {
      trackId: 'ranger',
      trackCategory: 'pc' as const,
      levels: 2,
      hitDieSides: 8 as const,
      babCurve: 'full' as const,
      fortCurve: 'good' as const,
      refCurve: 'good' as const,
      willCurve: 'poor' as const,
      skillPointsPerLevel: 6
    };
    const rangerLightArmorFeats = collectActiveGrantedAndVirtualFeats(
      [rangerTrack],
      [],
      [],
      sys.classes,
      sys.domains,
      [],
      ['armor:light']
    );
    expect(rangerLightArmorFeats).toContain('track');
    expect(rangerLightArmorFeats).toContain('two_weapon_fighting');

    const rangerHeavyArmorFeats = collectActiveGrantedAndVirtualFeats(
      [rangerTrack],
      [],
      [],
      sys.classes,
      sys.domains,
      [],
      ['armor:heavy']
    );
    expect(rangerHeavyArmorFeats).toContain('track');
    expect(rangerHeavyArmorFeats).not.toContain('two_weapon_fighting');

    // 4. Skill actions & rankThresholdModifiers (5+ ranks in Tumble unlocks +1 dodge AC when fighting defensively)
    expect(sys.skills['tumble']?.actions.length).toBeGreaterThanOrEqual(2);
    const tumbleBelow5 = buildSkillRankThresholdModifiers({ tumble: 4 }, sys.skills);
    expect(tumbleBelow5.length).toBe(0);
    const tumbleAt5 = buildSkillRankThresholdModifiers({ tumble: 5 }, sys.skills);
    expect(tumbleAt5.length).toBe(2);
    expect(tumbleAt5.map((m) => m.sourcePath)).toContain(
      'skill:tumble/threshold:5/tumble_5_ranks_fight_defensively_ac'
    );
    expect(tumbleAt5.map((m) => m.sourcePath)).toContain(
      'skill:tumble/threshold:5/tumble_5_ranks_total_defense_ac'
    );
  });

  it('validates Milestone 112.5: 14 playable races, all 42 SRD skills + synergies + Take 10/20 flags, spell class filtering, feat slot budgeting, and draft sanitization', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // 1. 14 Playable Races tagged with isPlayableRace === true, while monstrous races default to false
    const playableRaces = Object.values(sys.races).filter((r) => r.isPlayableRace);
    expect(playableRaces.length).toBe(14);
    expect(sys.races['human']?.isPlayableRace).toBe(true);
    expect(sys.races['dwarf']?.isPlayableRace).toBe(true);
    expect(sys.races['tiefling']?.isPlayableRace).toBe(true);
    expect(sys.races['gelatinous_cube']?.isPlayableRace).toBe(false);
    expect(sys.races['beholder']?.isPlayableRace).toBe(false);

    // 2. All 50 SRD skills loaded with synergies, actions, and Take 10/20 flags
    expect(Object.keys(sys.skills).length).toBe(50);
    const bluffTargets = getSkillsGrantedSynergyBy('bluff', sys.skills);
    expect(bluffTargets).toContain('diplomacy');
    expect(bluffTargets).toContain('disguise');
    expect(bluffTargets).toContain('intimidate');
    expect(bluffTargets).toContain('sleight_of_hand');

    // Diplomacy receives +6 when Bluff, Knowledge (nobility), and Sense Motive all have 5+ ranks
    const dipDef = sys.skills['diplomacy']!;
    expect(
      computeSkillSynergyBonus(dipDef.synergyFromSkills, {
        bluff: 5,
        knowledge_nobility: 5,
        sense_motive: 5
      })
    ).toBe(6);
    // Epic synergy scaling: 25 ranks in Bluff grants +4 (+2 at 5, +2 at 25)
    expect(computeSkillSynergyBonus(['bluff'], { bluff: 25 })).toBe(4);

    // Appraise prohibits Take 20 via definition.take20Allowed === false
    const appraiseDef = sys.skills['appraise']!;
    const take20Appraise = resolveSkillCheck({
      definition: {
        skillId: appraiseDef.id,
        keyAbility: appraiseDef.keyAbility,
        trainedOnly: appraiseDef.trainedOnly,
        acpMultiplier: appraiseDef.acpMultiplier,
        synergyFromSkills: appraiseDef.synergyFromSkills,
        take10Allowed: appraiseDef.take10Allowed,
        take20Allowed: appraiseDef.take20Allowed
      },
      rawRanks: 4,
      allSkillRanks: { appraise: 4 },
      keyAbilityModifier: 2,
      armorCheckPenalty: 0,
      dc: 15,
      takeMode: 'take20'
    });
    expect(take20Appraise.allowed).toBe(false);
    expect(take20Appraise.blockedReason).toBe('take_20_prohibited');

    // 3. Class spell-list and prohibited school filtering
    const magicMissile = sys.spells['magic_missile']!;
    const cureLight = sys.spells['cure_light_wounds']!;
    const burningHands = sys.spells['burning_hands']!;

    // Cleric cannot select Magic Missile
    expect(isSpellSelectableForDraft(magicMissile, 'cleric', 1, [], []).selectable).toBe(false);
    // Cleric can select Cure Light Wounds
    expect(isSpellSelectableForDraft(cureLight, 'cleric', 1, [], []).selectable).toBe(true);
    // Cleric with Fire domain can select Burning Hands
    expect(isSpellSelectableForDraft(burningHands, 'cleric', 1, [], []).selectable).toBe(false);
    expect(isSpellSelectableForDraft(burningHands, 'cleric', 1, [], ['fire']).selectable).toBe(true);
    // Wizard with Evocation prohibited cannot select Magic Missile
    expect(isSpellSelectableForDraft(magicMissile, 'wizard', 1, ['evocation'], []).selectable).toBe(false);
    expect(getSpellLevelForClass(cureLight, 'paladin')).toBe(1);

    // 4. First-level feat slot budgeting
    expect(computeFirstLevelFeatSlotBudget(sys.races['human'], sys.classes['fighter']).totalSlots).toBe(3);
    expect(computeFirstLevelFeatSlotBudget(sys.races['elf'], sys.classes['fighter']).totalSlots).toBe(2);
    expect(computeFirstLevelFeatSlotBudget(sys.races['human'], sys.classes['wizard']).totalSlots).toBe(2);
    expect(computeFirstLevelFeatSlotBudget(sys.races['elf'], sys.classes['wizard']).totalSlots).toBe(1);

    // 5. Effective class skills & draft sanitization on class/race switch
    const clericTrickerySkills = getEffectiveClassSkillIds(sys.classes['cleric'], ['trickery'], sys);
    expect(clericTrickerySkills).toContain('bluff');
    expect(clericTrickerySkills).toContain('disguise');
    expect(clericTrickerySkills).toContain('hide');

    const sanitized = sanitizeDraftOnRaceOrClassChange(
      {
        raceId: 'elf',
        classId: 'cleric',
        alignment: 'NG',
        abilityMethod: 'point_buy',
        pointBuyBudget: 28,
        baseAbilityScores: { str: 12, dex: 14, con: 12, int: 10, wis: 16, cha: 12 },
        selectedAcfs: ['dungeon_crasher'],
        domains: ['healing', 'good', 'war'],
        prohibitedSchools: ['evocation'],
        skillRanks: { concentration: 4 },
        selectedFeats: ['power_attack', 'cleave', 'toughness'],
        knownSpells: ['magic_missile', 'cure_light_wounds'],
        equipmentPackageId: 'divine_templar'
      },
      sys
    );
    expect(sanitized.domains.length).toBe(2);
    expect(sanitized.selectedAcfs).toEqual([]);
    expect(sanitized.prohibitedSchools).toEqual([]);
    expect(sanitized.selectedFeats.length).toBe(1); // Elf Cleric gets 1 feat at level 1
    expect(sanitized.knownSpells).toEqual(['cure_light_wounds']); // Magic Missile stripped for Cleric
  });

  it('validates feature-driven class progression, ACF reactivity, and tagged companion architecture (Milestone 119)', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // 1. Wizard with Abrupt Jaunt ACF suppresses Familiar
    const jauntAcf = sys.classes['wizard']?.acfSwaps.find((s) => s.acfId === 'wizard_abrupt_jaunt_1');
    expect(jauntAcf).toBeDefined();
    expect(jauntAcf?.replacesFeature).toBe('summon_familiar');

    const wizardActiveBase = collectClassFeaturesUpToLevel(sys.classes['wizard']!, 1, []);
    expect(wizardActiveBase).toContain('summon_familiar');
    expect(wizardActiveBase).toContain('arcane_school_specialization');

    const wizardActiveJaunt = collectClassFeaturesUpToLevel(sys.classes['wizard']!, 1, ['wizard_abrupt_jaunt_1']);
    expect(wizardActiveJaunt).not.toContain('summon_familiar');
    expect(wizardActiveJaunt).toContain('abrupt_jaunt');

    // 2. Sorcerer has summon_familiar contributing to familiar_master_effective_level
    const sorcActive = collectClassFeaturesUpToLevel(sys.classes['sorcerer']!, 1, []);
    expect(sorcActive).toContain('summon_familiar');
    const sorcFamContrib = sys.classes['sorcerer']?.featureDetails['summon_familiar']?.scalingPoolContribution;
    expect(sorcFamContrib?.poolId).toBe('familiar_master_effective_level');

    // 3. Ranger favored_enemy_1 has no static modifier block (dynamic choice only)
    const rangerFe = sys.classes['ranger']?.featureDetails['favored_enemy_1'];
    expect(rangerFe?.modifiers?.length ?? 0).toBe(0);

    // 4. Rogue special abilities are data-driven from bonusFeatPool
    const rogueSa1 = sys.classes['rogue']?.featureDetails['rogue_special_ability_1'];
    expect(rogueSa1?.bonusFeatPool).toBeDefined();
    expect(rogueSa1?.bonusFeatPool).toContain('crippling_strike');
    expect(rogueSa1?.bonusFeatPool).toContain('improved_evasion');

    // 5. Races: Weasel has canonical masterEffectBundle
    const weasel = sys.races['weasel'];
    expect(weasel?.masterEffectBundle?.bundleId).toBe('familiar_weasel_bundle');
    expect(weasel?.masterEffectBundle?.name).toBe('Familiar Master Bonus (Weasel)');
    expect(weasel?.masterEffectBundle?.category).toBe('ex');
    expect(weasel?.masterEffectBundle?.modifiers[0]?.target).toBe('save_ref');
    expect(weasel?.masterEffectBundle?.virtualFeatGrants[0]?.featId).toBe('alertness');
  });
});

