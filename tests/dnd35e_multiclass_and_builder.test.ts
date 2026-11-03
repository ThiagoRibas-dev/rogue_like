import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import {
  applyCharacterCreationToPlayer,
  applyLevelUpToActor,
  type CharacterCreationDraft,
  computeClassSpellSelectionBudget,
  getActorEverClassSkillIds,
  getEffectiveClassSkillIds,
  getSkillMaxRanks,
  validateCharacterCreationStep,
  validateLevelUpStep
} from '../src/rulesets/dnd35e/character_builder.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import {
  computeEffectiveClassCastingLevel,
  getEligibleBaseCastingClassesForPrestige
} from '../src/rulesets/dnd35e/progression.ts';
import {
  getDnD35EntityData,
  projectDnD35ActorSemanticTags,
  setDnD35EntityData
} from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildBaseWizardDraft(): CharacterCreationDraft {
  return {
    raceId: 'human',
    classId: 'wizard',
    alignment: 'NG',
    selectedAcfs: [],
    domains: [],
    arcaneSchool: 'universal',
    prohibitedSchools: [],
    abilityMethod: 'point_buy',
    pointBuyBudget: 28,
    baseAbilityScores: { str: 10, dex: 14, con: 14, int: 12, wis: 14, cha: 12 },
    skillRanks: {
      concentration: 4,
      spellcraft: 4,
      knowledge_arcana: 4,
      knowledge_religion: 4
    },
    selectedFeats: ['combat_casting', 'improved_initiative'],
    knownSpells: [
      'magic_missile',
      'mage_armor',
      'shield',
      'burning_hands'
    ],
    equipmentPackageId: 'arcane_scholar'
  };
}

describe('Milestone 112.9: Declarative Multiclass Composition, 3-Horizon Stat Pipeline, Per-Class Spellbooks & Builder Step Gating', () => {
  it('separates multiclass skill max-rank cap (ever-class skill = HD + 3) from active-level rank purchase cost', () => {
    initRNG(42);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // Create a Rogue 1 (Tumble & Disable Device are Rogue class skills)
    const rogueDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'rogue',
      alignment: 'NG',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 12, dex: 16, con: 14, int: 14, wis: 10, cha: 10 },
      skillRanks: {
        tumble: 4,
        disable_device: 4,
        hide: 4,
        move_silently: 4,
        search: 4,
        spot: 4,
        listen: 4,
        open_lock: 4,
        sleight_of_hand: 4,
        balance: 4,
        escape_artist: 4
      },
      selectedFeats: ['dodge', 'weapon_finesse'],
      knownSpells: [],
      equipmentPackageId: 'shadow_stalker'
    };
    state = applyCharacterCreationToPlayer(state, playerId, rogueDraft);
    const rogueData = getDnD35EntityData(state, playerId);

    // Now level up as Fighter 1 (Character Level 2).
    // Tumble is NOT a Fighter class skill, so purchasing +1 rank in Tumble costs 2 skill points (cross-class cost),
    // BUT because Tumble was a Rogue class skill, its max rank cap at HD 2 is 2 + 3 = 5 (NOT cross-class 2.5)!
    const fighterClass = sys.classes['fighter']!;
    const activeFighterSkills = getEffectiveClassSkillIds(fighterClass, [], sys);
    const everClassSkills = getActorEverClassSkillIds(rogueData, 'fighter', [], sys);

    expect(activeFighterSkills).not.toContain('tumble');
    expect(everClassSkills).toContain('tumble');
    expect(everClassSkills).toContain('climb');

    // Max rank cap for Tumble at HD 2 is 5 because it's in everClassSkills
    expect(getSkillMaxRanks(2, everClassSkills.includes('tumble'))).toBe(5);
    // Max rank cap for Spellcraft (never a class skill for Rogue or Fighter) at HD 2 is 2.5
    expect(getSkillMaxRanks(2, everClassSkills.includes('spellcraft'))).toBe(2.5);

    // Spend 2 Fighter skill points to buy +1.0 cross-class rank in Tumble (bringing Tumble from 4 to 5) and +3 ranks in Climb
    const levelUpRes = applyLevelUpToActor(state, playerId, {
      classId: 'fighter',
      hpMethod: 'average',
      addedSkillRanks: { tumble: 1, climb: 3 },
      selectedFeats: ['power_attack'],
      learnedSpells: []
    });
    const multiclassData = getDnD35EntityData(levelUpRes.state, playerId);
    expect(multiclassData.skillRanks['tumble']).toBe(5);
    expect(multiclassData.skillRanks['climb']).toBe(3);
  });

  it('enforces declarative Barbarian illiteracy at Lv 1, preserves literacy for Fighter 1 -> Barbarian 1, and cures illiteracy when multiclassing into a literate class or spending 2 skill points', () => {
    initRNG(101);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    const state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // Case A: Single-class Barbarian 1 is illiterate
    const barbDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'barbarian',
      alignment: 'CN',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
      skillRanks: { climb: 4, jump: 4, intimidate: 4, listen: 4, survival: 4 },
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: [],
      equipmentPackageId: 'martial_vanguard'
    };
    const barbState = applyCharacterCreationToPlayer(state, playerId, barbDraft);
    const barbData = getDnD35EntityData(barbState, playerId);
    expect(barbData.activeClassFeatures).toContain('illiteracy');
    const barbTags = projectDnD35ActorSemanticTags(barbData, [], undefined, sys.classes);
    expect(barbTags).toContain('trait:illiterate');
    expect(barbTags).not.toContain('trait:literate');

    // Case B: Barbarian 1 multiclassing into Wizard 1 gains trait:literate and deactivates illiteracy
    const barbWizRes = applyLevelUpToActor(barbState, playerId, {
      classId: 'wizard',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, spellcraft: 1, knowledge_arcana: 1 },
      selectedFeats: [],
      learnedSpells: ['magic_missile', 'mage_armor', 'shield']
    });
    const barbWizData = getDnD35EntityData(barbWizRes.state, playerId);
    expect(barbWizData.activeClassFeatures).not.toContain('illiteracy');
    const barbWizTags = projectDnD35ActorSemanticTags(barbWizData, [], undefined, sys.classes);
    expect(barbWizTags).toContain('trait:literate');
    expect(barbWizTags).not.toContain('trait:illiterate');

    // Case C: Barbarian 1 -> Barbarian 2 spending 2 skill points for literacy cures illiteracy
    const barbLitRes = applyLevelUpToActor(barbState, playerId, {
      classId: 'barbarian',
      hpMethod: 'average',
      addedSkillRanks: { climb: 1, jump: 1, survival: 1 },
      spendSkillPointsForLiteracy: true,
      selectedFeats: [],
      learnedSpells: []
    });
    const barbLitData = getDnD35EntityData(barbLitRes.state, playerId);
    expect(barbLitData.spentLiteracySkillPoints).toBe(true);
    expect(barbLitData.activeClassFeatures).not.toContain('illiteracy');
    expect(projectDnD35ActorSemanticTags(barbLitData, [], undefined, sys.classes)).toContain('trait:literate');

    // Case D: Fighter 1 -> Barbarian 1 never becomes illiterate
    const fighterDraft: CharacterCreationDraft = {
      ...barbDraft,
      classId: 'fighter',
      alignment: 'NG',
      skillRanks: { climb: 4, jump: 4, intimidate: 4 },
      selectedFeats: ['power_attack', 'cleave', 'improved_initiative']
    };
    const fighterState = applyCharacterCreationToPlayer(state, playerId, fighterDraft);
    const fighterBarbRes = applyLevelUpToActor(fighterState, playerId, {
      classId: 'barbarian',
      hpMethod: 'average',
      addedSkillRanks: { climb: 1, jump: 1, intimidate: 1, listen: 1, survival: 1 },
      selectedFeats: [],
      learnedSpells: []
    });
    const fighterBarbData = getDnD35EntityData(fighterBarbRes.state, playerId);
    expect(fighterBarbData.activeClassFeatures).not.toContain('illiteracy');
    expect(projectDnD35ActorSemanticTags(fighterBarbData, [], undefined, sys.classes)).toContain('trait:literate');
  });

  it('declaratively upgrades duplicate uncanny_dodge to improved_uncanny_dodge and accumulates scalingPools for Uncanny Dodge, Turn Undead, and Familiar', () => {
    initRNG(202);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // 1. Barbarian 2 / Rogue 4 -> Uncanny Dodge granted twice -> upgrades to Improved Uncanny Dodge, pool = 6
    const barbDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'barbarian',
      alignment: 'CN',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
      skillRanks: { climb: 4, jump: 4, intimidate: 4, listen: 4, survival: 4 },
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: [],
      equipmentPackageId: 'martial_vanguard'
    };
    state = applyCharacterCreationToPlayer(state, playerId, barbDraft);
    // Barbarian 2 (gains uncanny_dodge)
    state = applyLevelUpToActor(state, playerId, {
      classId: 'barbarian',
      hpMethod: 'average',
      addedSkillRanks: { climb: 1, jump: 1, intimidate: 1, listen: 1, survival: 1 },
      selectedFeats: [],
      learnedSpells: []
    }).state;
    const barb2Data = getDnD35EntityData(state, playerId);
    expect(barb2Data.activeClassFeatures).toContain('uncanny_dodge');
    expect(barb2Data.activeClassFeatures).not.toContain('improved_uncanny_dodge');
    expect(barb2Data.scalingPools?.['uncanny_dodge_effective_level']).toBe(2);

    // Advance 4 levels of Rogue (Rogue 4 also grants uncanny_dodge -> upgrades to improved_uncanny_dodge!)
    for (let rLvl = 1; rLvl <= 4; rLvl++) {
      const nextHd = 2 + rLvl;
      state = applyLevelUpToActor(state, playerId, {
        classId: 'rogue',
        hpMethod: 'average',
        ...(nextHd % 4 === 0 ? { abilityScoreIncrease: 'dex' as const } : {}),
        addedSkillRanks: { tumble: 1 },
        selectedFeats: nextHd % 3 === 0 ? ['dodge'] : [],
        learnedSpells: []
      }).state;
    }
    const barb2Rogue4Data = getDnD35EntityData(state, playerId);
    expect(barb2Rogue4Data.activeClassFeatures).toContain('uncanny_dodge');
    expect(barb2Rogue4Data.activeClassFeatures).toContain('improved_uncanny_dodge');
    expect(barb2Rogue4Data.scalingPools?.['uncanny_dodge_effective_level']).toBe(6);

    // 2. Cleric 3 / Paladin 4 -> Turn Undead Effective Level = 3 + (4 - 3) = 4
    let clericState = buildGameState(campaign);
    const cPlayerId = clericState.entities.find((id) => getComponent(clericState, id, ComponentType.Player) !== undefined)!;
    const clericDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'cleric',
      alignment: 'LG',
      selectedAcfs: [],
      domains: ['good', 'healing'],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 15, cha: 14 },
      skillRanks: { concentration: 4, heal: 4, knowledge_religion: 4 },
      selectedFeats: ['combat_casting', 'extra_turning'],
      knownSpells: [],
      equipmentPackageId: 'divine_templar'
    };
    clericState = applyCharacterCreationToPlayer(clericState, cPlayerId, clericDraft);
    for (let l = 2; l <= 3; l++) {
      clericState = applyLevelUpToActor(clericState, cPlayerId, {
        classId: 'cleric',
        hpMethod: 'average',
        addedSkillRanks: { concentration: 1, heal: 1, knowledge_religion: 1 },
        selectedFeats: l === 3 ? ['toughness'] : [],
        learnedSpells: []
      }).state;
    }
    for (let pLvl = 1; pLvl <= 4; pLvl++) {
      const nextHd = 3 + pLvl;
      clericState = applyLevelUpToActor(clericState, cPlayerId, {
        classId: 'paladin',
        hpMethod: 'average',
        ...(nextHd % 4 === 0 ? { abilityScoreIncrease: 'wis' as const } : {}),
        addedSkillRanks: { concentration: 1, heal: 1, knowledge_religion: 1 },
        selectedFeats: nextHd % 3 === 0 ? ['weapon_focus'] : [],
        learnedSpells: []
      }).state;
    }
    const clericPaladinData = getDnD35EntityData(clericState, cPlayerId);
    expect(clericPaladinData.scalingPools?.['turn_undead_effective_level']).toBe(4);
  });

  it('evaluates Horizon 3 dynamic situational tags so equipping Heavy Armor suppresses Barbarian Fast Movement (+10 ft) and unequipping restores it without rebuilding levelHistory', () => {
    initRNG(303);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    const barbDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'barbarian',
      alignment: 'CN',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
      skillRanks: { climb: 4, jump: 4, intimidate: 4, listen: 4, survival: 4 },
      selectedFeats: ['power_attack', 'cleave'],
      knownSpells: [],
      equipmentPackageId: 'shadow_stalker' // Light armor package (+2 leather)
    };
    state = applyCharacterCreationToPlayer(state, playerId, barbDraft);

    // In light armor, Barbarian Fast Movement (+10) is active on top of baseSpeed (100): 100 + 10 = 110
    const lightBreakdown = evaluateDnD35eEntityDAG(state, playerId);
    expect(lightBreakdown?.dagResult.speed).toBe(110);

    // Put on Heavy Armor (armorBonus = 8 -> Horizon 3 projects 'armor:heavy' without touching levelHistory or statModifiers)
    const beforeHeavyData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, { ...beforeHeavyData, armorBonus: 8 });
    state = addComponent(state, playerId, { type: ComponentType.Tags, tags: ['armor:heavy'] });

    // In Heavy Armor, Horizon 3 projects 'armor:heavy', which suppresses fast_movement (selfTagsNone: ['armor:heavy', 'load:heavy'])
    const heavyBreakdown = evaluateDnD35eEntityDAG(state, playerId);
    expect(heavyBreakdown?.dagResult.speed).toBe(100);

    // Remove Heavy Armor (back to Light Armor) -> Fast Movement (+10) immediately returns (110) without rebuilding levelHistory
    state = setDnD35EntityData(state, playerId, { ...beforeHeavyData, armorBonus: 2 });
    state = addComponent(state, playerId, { type: ComponentType.Tags, tags: ['armor:light'] });
    const restoredBreakdown = evaluateDnD35eEntityDAG(state, playerId);
    expect(restoredBreakdown?.dagResult.speed).toBe(110);
  });

  it('maintains isolated per-class spellbooks for Wizard/Sorcerer/Mystic Theurge, enforces Divine Prayerbook full-list access for Cleric/Druid, and gates incomplete steps', () => {
    initRNG(404);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    // 1. Validate step gating on Character Creation Draft
    const wizDraft = buildBaseWizardDraft();
    expect(validateCharacterCreationStep(wizDraft, 'race', sys).valid).toBe(true);
    expect(validateCharacterCreationStep(wizDraft, 'class', sys).valid).toBe(true);
    expect(validateCharacterCreationStep(wizDraft, 'abilities', sys).valid).toBe(true);
    expect(validateCharacterCreationStep(wizDraft, 'skills', sys).valid).toBe(true);
    expect(validateCharacterCreationStep(wizDraft, 'feats', sys).valid).toBe(true);
    expect(validateCharacterCreationStep(wizDraft, 'spells', sys).valid).toBe(true);

    // Unspent skill points or missing Wizard spells fail validation gating
    expect(
      validateCharacterCreationStep({ ...wizDraft, skillRanks: { concentration: 2 } }, 'skills', sys).valid
    ).toBe(false);
    expect(
      validateCharacterCreationStep({ ...wizDraft, knownSpells: ['magic_missile'] }, 'spells', sys).valid
    ).toBe(false);

    // 2. Embark Wizard 1 (INT 12 -> +1 mod -> 4 Lv1 spells + all Lv0 cantrips)
    state = applyCharacterCreationToPlayer(state, playerId, wizDraft);
    const wiz1Data = getDnD35EntityData(state, playerId);
    const wizBook1 = wiz1Data.spellbooksByClass?.['wizard'];
    expect(wizBook1).toBeDefined();
    expect(wizBook1?.spellAcquisitionMode).toBe('spellbook_scribed');
    expect(wizBook1?.knownSpellIds).toContain('read_magic'); // auto-granted Lv0 cantrip
    expect(wizBook1?.knownSpellIds).toContain('magic_missile'); // scribed Lv1 spell

    // 3. Multiclass into Sorcerer 1 at Character Level 2 -> isolated Sorcerer spellbook
    const sorcClass = sys.classes['sorcerer']!;
    const sorc1Budget = computeClassSpellSelectionBudget(sorcClass, 0, 1, 1, [], [], [], sys);
    expect(sorc1Budget.requiresManualSelection).toBe(true);
    expect(sorc1Budget.requiredBySpellLevel[0]).toBe(4);
    expect(sorc1Budget.requiredBySpellLevel[1]).toBe(2);

    const sorcSpells = [
      'daze',
      'detect_magic',
      'light',
      'mage_hand',
      'cause_fear',
      'ray_of_enfeeblement'
    ];
    state = applyLevelUpToActor(state, playerId, {
      classId: 'sorcerer',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, spellcraft: 1, knowledge_arcana: 1, bluff: 1 },
      selectedFeats: [],
      learnedSpells: sorcSpells,
      learnedSpellsByClass: { sorcerer: sorcSpells }
    }).state;

    const wizSorcData = getDnD35EntityData(state, playerId);
    expect(wizSorcData.spellbooksByClass?.['wizard']).toBeDefined();
    expect(wizSorcData.spellbooksByClass?.['sorcerer']).toBeDefined();
    expect(wizSorcData.spellbooksByClass?.['sorcerer']?.spellAcquisitionMode).toBe('spontaneous_known');
    expect(wizSorcData.spellbooksByClass?.['sorcerer']?.knownSpellIds).toContain('cause_fear');
    expect(wizSorcData.spellbooksByClass?.['wizard']?.knownSpellIds).not.toContain('cause_fear');
    expect(wizSorcData.scalingPools?.['familiar_master_effective_level']).toBe(2);

    // 4. Multiclass into Cleric 1 -> Divine Prayerbook full-list access without manual spell step
    const clericClass = sys.classes['cleric']!;
    const clericBudget = computeClassSpellSelectionBudget(clericClass, 0, 1, 1, [], ['good', 'healing'], [], sys);
    expect(clericBudget.spellAcquisitionMode).toBe('prayerbook_full_list');
    expect(clericBudget.requiresManualSelection).toBe(false);

    state = applyLevelUpToActor(state, playerId, {
      classId: 'cleric',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, spellcraft: 1, knowledge_religion: 1, heal: 1 },
      selectedFeats: ['toughness'],
      learnedSpells: []
    }).state;
    const triData = getDnD35EntityData(state, playerId);
    expect(triData.spellbooksByClass?.['cleric']?.spellAcquisitionMode).toBe('prayerbook_full_list');
    expect(triData.spellbooksByClass?.['cleric']?.knownSpellIds).toContain('cure_light_wounds');
    expect(triData.spellbooksByClass?.['cleric']?.knownSpellIds).toContain('bless');

    // Advance Wizard 2, Wizard 3, Cleric 2, Cleric 3 to satisfy Mystic Theurge prerequisites (2nd-level arcane & divine + 6 ranks in Knowledge Arcana/Religion)
    state = applyLevelUpToActor(state, playerId, {
      classId: 'wizard',
      hpMethod: 'average',
      abilityScoreIncrease: 'int',
      addedSkillRanks: { knowledge_arcana: 1, knowledge_religion: 1, concentration: 1, spellcraft: 1 },
      selectedFeats: [],
      learnedSpells: ['sleep', 'grease'],
      learnedSpellsByClass: { wizard: ['sleep', 'grease'] }
    }).state;
    state = applyLevelUpToActor(state, playerId, {
      classId: 'wizard',
      hpMethod: 'average',
      addedSkillRanks: { knowledge_arcana: 1, knowledge_religion: 1, concentration: 1, spellcraft: 1 },
      selectedFeats: [],
      learnedSpells: []
    }).state;
    state = applyLevelUpToActor(state, playerId, {
      classId: 'cleric',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, spellcraft: 1, heal: 1, diplomacy: 1 },
      selectedFeats: ['great_fortitude'],
      learnedSpells: []
    }).state;
    state = applyLevelUpToActor(state, playerId, {
      classId: 'cleric',
      hpMethod: 'average',
      addedSkillRanks: { concentration: 1, spellcraft: 1, heal: 1, diplomacy: 1 },
      selectedFeats: [],
      learnedSpells: []
    }).state;

    const preMtData = getDnD35EntityData(state, playerId);

    // 5. Mystic Theurge advances both an arcane target and a divine target explicitly
    const mtClass = sys.classes['mystic_theurge']!;
    const mtSlots = getEligibleBaseCastingClassesForPrestige(preMtData.tracks, mtClass, 1, sys.classes);
    expect(mtSlots.length).toBe(2);
    expect(mtSlots[0]?.slotKey).toBe('arcane');
    expect(mtSlots[0]?.eligibleClassIds).toEqual(['wizard', 'sorcerer']);
    expect(mtSlots[1]?.slotKey).toBe('divine');
    expect(mtSlots[1]?.eligibleClassIds).toEqual(['cleric']);

    // Advance Mystic Theurge 1 choosing 'wizard' for arcane slot and 'cleric' for divine slot
    // Wizard effective level advances 3 -> 4 (+2 free scribed spells); Cleric effective level advances 3 -> 4
    const wiz4StepInvalid = validateLevelUpStep(
      preMtData,
      {
        classId: 'mystic_theurge',
        hpMethod: 'average',
        addedSkillRanks: {},
        selectedFeats: [],
        learnedSpells: [],
        advancedSpellcastingClassIds: ['wizard', 'cleric'],
        learnedSpellsByClass: { wizard: ['cause_fear'] } // only 1 picked instead of 2!
      },
      'spells:wizard',
      sys
    );
    expect(wiz4StepInvalid.valid).toBe(false);

    const wiz4StepValid = validateLevelUpStep(
      preMtData,
      {
        classId: 'mystic_theurge',
        hpMethod: 'average',
        addedSkillRanks: {},
        selectedFeats: [],
        learnedSpells: [],
        advancedSpellcastingClassIds: ['wizard', 'cleric'],
        learnedSpellsByClass: { wizard: ['cause_fear', 'ray_of_enfeeblement'] }
      },
      'spells:wizard',
      sys
    );
    expect(wiz4StepValid.valid).toBe(true);

    const mtResult = applyLevelUpToActor(state, playerId, {
      classId: 'mystic_theurge',
      hpMethod: 'average',
      abilityScoreIncrease: 'wis',
      addedSkillRanks: { concentration: 1, spellcraft: 1, knowledge_arcana: 1, knowledge_religion: 1 },
      selectedFeats: [],
      learnedSpells: [],
      advancedSpellcastingClassIds: ['wizard', 'cleric'],
      learnedSpellsByClass: { wizard: ['cause_fear', 'ray_of_enfeeblement'] }
    });
    expect(mtResult.success).toBe(true);
    state = mtResult.state;

    const afterMtData = getDnD35EntityData(state, playerId);
    expect(
      computeEffectiveClassCastingLevel(afterMtData.tracks, sys.classes['wizard']!, sys.classes, afterMtData.levelHistory)
    ).toBe(4);
    expect(
      computeEffectiveClassCastingLevel(afterMtData.tracks, sys.classes['sorcerer']!, sys.classes, afterMtData.levelHistory)
    ).toBe(1);
    expect(
      computeEffectiveClassCastingLevel(afterMtData.tracks, sys.classes['cleric']!, sys.classes, afterMtData.levelHistory)
    ).toBe(4);
    expect(afterMtData.spellbooksByClass?.['wizard']?.knownSpellIds).toContain('cause_fear');
    expect(afterMtData.spellbooksByClass?.['wizard']?.knownSpellIds).toContain('ray_of_enfeeblement');
  });
});
