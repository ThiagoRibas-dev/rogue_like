import { describe, expect, it } from 'bun:test';
import { getComponent } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import {
  applyCharacterCreationToPlayer,
  applyLevelUpToActor,
  buildClassAndDomainEffectModifiers,
  buildPrerequisiteContextForActor,
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  calculateSkillAllocationCost,
  ELITE_ABILITY_ARRAY,
  getSkillMaxRanks,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest,
  validateSpecialistSchoolSelection
} from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import {
  calculateMulticlassXpMultiplier,
  collectClassFeaturesUpToLevel,
  resolveActiveClassFeatures
} from '../src/rulesets/dnd35e/progression.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType, type FighterComponent } from '../src/types/components.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 23: D&D 3.5e Core 11 Classes, Prestige Classes, ACFs, Domains & Character Builder', () => {
  it('loads and validates all 11 Base Classes, 10 Prestige Classes, and 22 Cleric Domains via split JSONs', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const baseClasses = Object.values(sys.classes).filter((c) => !c.isPrestige);
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

    // Every base class has maxLevel 20 and featuresByLevel defined
    for (const cls of baseClasses) {
      expect(cls.maxLevel).toBe(20);
      expect(cls.featuresByLevel).toBeDefined();
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
});
