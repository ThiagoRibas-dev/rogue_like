import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, queryEntities, spawnItem } from '../src/core/ecs.ts';
import {
  buildCreationDraftPrerequisiteContext,
  buildPostLevelUpPrerequisiteContext,
  buildPrerequisiteContextForActor,
  type CharacterCreationDraft
} from '../src/rulesets/dnd35e/character_builder.ts';
import { collectActorProficiencies } from '../src/rulesets/dnd35e/builder/builder_prereq_proficiencies.ts';
import { executeCombatStrikeExchange } from '../src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts';
import {
  resolveSpecialAbilitySaveDc
} from '../src/rulesets/dnd35e/combat/maneuvers_conditions.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { buildActorNaturalWeaponLimbs } from '../src/rulesets/dnd35e/cartridge/dnd35e_equipped_item_dag.ts';
import { resolveFeatEffectBundle } from '../src/rulesets/dnd35e/effect_bundle.ts';
import {
  evaluateNonproficiencyPenalty,
  resolveAllEquippedWeaponProfiles,
  stepDamageDiceLadder
} from '../src/rulesets/dnd35e/equipment_physics.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import { collectClassChoiceFeats } from '../src/rulesets/dnd35e/progression/ledger_choices.ts';
import { evaluateRacialModifiers } from '../src/rulesets/dnd35e/races.ts';
import { projectDnD35ActorSemanticTags } from '../src/rulesets/dnd35e/semantic_tags.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { applyCreatureTemplate } from '../src/rulesets/dnd35e/templates.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { classifyDnD35eFeatCategory as classifyFeatCategory } from '../src/rendering/ui/cartridges/dnd35e/DnD35eInspector.tsx';
import {
  CANONICAL_NATURAL_WEAPONS,
  CANONICAL_SPECIAL_ATTACKS,
  getFeatTargetOptions
} from '../src/rendering/ui/cartridges/dnd35e/DnD35eSharedFeatsStep.tsx';
import { MessageLogCategory } from '../src/systems/message.system.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type TacticalDoctrineComponent
} from '../src/types/components.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('D&D 3.5e Declarative Feat & Weapon Mechanics (Ability Focus, Bastard Sword, Improved Natural Attack)', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;

  test('Ability Focus: UI lists canonical special attacks (not skills), tags project declaratively, and save DC gets +2', () => {
    const abilityFocusDef = sys.feats['ability_focus']!;
    const options = getFeatTargetOptions(sys, abilityFocusDef);
    expect(options).toEqual(CANONICAL_SPECIAL_ATTACKS);
    expect(options).toContain('breath_weapon');
    expect(options).toContain('poison');
    expect(options).not.toContain('diplomacy');
    expect(options).not.toContain('climb');

    // Race with breathWeapon declaratively emits trait:special_attack via evaluateRacialModifiers
    const redDragonRace = sys.races['dragon_red']!;
    const racialEval = evaluateRacialModifiers(redDragonRace);
    expect(racialEval.grantedTags).toContain('trait:special_attack');

    // Half-Dragon template declaratively merges grantedTags into subtypes -> projected tags
    const halfDragonRed = sys.templates['half_dragon_red']!;
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseData = getDnD35EntityData(state, playerId);
    const halfDragonData = applyCreatureTemplate(baseData, halfDragonRed);
    const halfDragonTags = projectDnD35ActorSemanticTags(
      halfDragonData,
      [],
      undefined,
      sys.classes,
      sys.skills,
      sys.domains
    );
    expect(halfDragonTags).toContain('trait:special_attack');

    // Class features (Rogue Sneak Attack, Paladin Smite Evil) & Sun domain declaratively project tags
    const rogueDraft: CharacterCreationDraft = {
      raceId: 'human',
      alignment: 'NG',
      classId: 'rogue',
      baseAbilityScores: { str: 10, dex: 16, con: 12, int: 14, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { hide: 4, move_silently: 4 },
      selectedFeats: ['improved_initiative'],
      knownSpells: []
    };
    const roguePrereqCtx = buildCreationDraftPrerequisiteContext(rogueDraft, sys);
    expect(roguePrereqCtx.tags).toContain('trait:special_attack');
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, roguePrereqCtx)).toBe(true);

    const clericTags = projectDnD35ActorSemanticTags(
      {
        ...baseData,
        domains: ['sun']
      },
      [],
      undefined,
      sys.classes,
      sys.skills,
      sys.domains
    );
    expect(clericTags).toContain('feature:turn_or_rebuke');

    // Save DC resolver applies +2 strictly to targeted ability
    const breathBundle = resolveFeatEffectBundle(abilityFocusDef, 'breath_weapon');
    const breathMods = breathBundle.modifiers.map((m) => ({
      targetStat: m.target,
      value: m.value,
      bonusType: m.type,
      sourceId: 'feat:ability_focus:breath_weapon',
      ...(m.condition ? { condition: m.condition } : {})
    }));
    expect(resolveSpecialAbilitySaveDc(16, 'breath_weapon', breathMods)).toBe(18);
    expect(resolveSpecialAbilitySaveDc(16, 'poison', breathMods)).toBe(16);
  });

  test('Bastard Sword & Proficiencies: UI filters declaratively, 1H requires exotic, 2H requires martial, Weapon Focus qualifies for martial', () => {
    const exoticFeat = sys.feats['exotic_weapon_proficiency']!;
    const martialFeat = sys.feats['martial_weapon_proficiency']!;
    const rapidReloadFeat = sys.feats['rapid_reload']!;
    const weaponFocusFeat = sys.feats['weapon_focus']!;

    const exoticOpts = getFeatTargetOptions(sys, exoticFeat);
    expect(exoticOpts).toContain('bastard_sword');
    expect(exoticOpts).toContain('dwarven_waraxe');
    expect(exoticOpts).not.toContain('longsword');

    const martialOpts = getFeatTargetOptions(sys, martialFeat);
    expect(martialOpts).toContain('longsword');
    expect(martialOpts).not.toContain('bastard_sword');
    expect(martialOpts).not.toContain('club');

    const rapidOpts = getFeatTargetOptions(sys, rapidReloadFeat);
    expect(rapidOpts).toEqual(['hand_crossbow', 'light_crossbow', 'heavy_crossbow']);

    // martial_weapon_proficiency:bastard_sword must NOT grant 1H exotic proficiency
    expect(
      evaluateNonproficiencyPenalty(
        'bastard_sword',
        'bastard_sword',
        true,
        'one_handed',
        { feats: ['martial_weapon_proficiency:bastard_sword'] },
        [],
        'exotic',
        sys.classes
      )
    ).toBe(-4);

    // exotic_weapon_proficiency:bastard_sword grants 0 nonproficiency penalty 1H
    expect(
      evaluateNonproficiencyPenalty(
        'bastard_sword',
        'bastard_sword',
        true,
        'one_handed',
        { feats: ['exotic_weapon_proficiency:bastard_sword'] },
        [],
        'exotic',
        sys.classes
      )
    ).toBe(0);

    // Fighter (martial proficiencies) vs Wizard (simple proficiencies) with Bastard Sword in 1H vs 2H grip
    const state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseData = getDnD35EntityData(state, playerId);

    const eqComp = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent;
    let [testState, itemId] = spawnItem(state, 'bastard_sword', 0, 0);
    let equippedPrimary = false;
    testState = addComponent(testState, playerId, {
      ...eqComp,
      slots: eqComp.slots.map((s) => {
        if (s.slotType === 'hand' || s.slotType === 'main_hand' || s.slotType === 'held') {
          if (!equippedPrimary) {
            equippedPrimary = true;
            return { ...s, equippedItem: itemId };
          }
          return { ...s, equippedItem: null };
        }
        if (s.slotType === 'off_hand') {
          return { ...s, equippedItem: null };
        }
        return s;
      })
    });

    const fighterTrack = [
      {
        trackId: 'fighter',
        levels: 1,
        hitDieSides: 10 as const,
        babCurve: 'full' as const,
        fortCurve: 'good' as const,
        refCurve: 'poor' as const,
        willCurve: 'poor' as const,
        skillPointsPerLevel: 2,
        trackCategory: 'pc' as const
      }
    ];
    testState = setDnD35EntityData(testState, playerId, { ...baseData, tracks: fighterTrack, feats: [] });
    const fighter1H = resolveAllEquippedWeaponProfiles(testState, playerId);
    expect(fighter1H.primaryWeapon.weaponItemId).toBe('bastard_sword');
    expect(fighter1H.primaryWeapon.nonproficiencyPenalty).toBe(-4);

    // Switch Fighter to two_handed grip -> 0 penalty!
    const twoHandedDoctrine: TacticalDoctrineComponent = {
      type: ComponentType.TacticalDoctrine,
      gripMode: 'two_handed'
    };
    const fighter2HState = addComponent(testState, playerId, twoHandedDoctrine);
    const fighter2H = resolveAllEquippedWeaponProfiles(fighter2HState, playerId);
    expect(fighter2H.primaryWeapon.handedness).toBe('two_handed');
    expect(fighter2H.primaryWeapon.nonproficiencyPenalty).toBe(0);

    // Wizard (only simple weapons) gripping Bastard Sword in two hands STILL takes -4!
    const wizardTrack = [
      {
        trackId: 'wizard',
        levels: 1,
        hitDieSides: 4 as const,
        babCurve: 'half' as const,
        fortCurve: 'poor' as const,
        refCurve: 'poor' as const,
        willCurve: 'good' as const,
        skillPointsPerLevel: 2,
        trackCategory: 'pc' as const
      }
    ];
    const wizard2HState = setDnD35EntityData(fighter2HState, playerId, { ...baseData, tracks: wizardTrack, feats: [] });
    const wizard2H = resolveAllEquippedWeaponProfiles(wizard2HState, playerId);
    expect(wizard2H.primaryWeapon.handedness).toBe('two_handed');
    expect(wizard2H.primaryWeapon.nonproficiencyPenalty).toBe(-4);

    // Data-driven isExotic1HMartial2H qualifies Fighter for Weapon Focus (Bastard Sword), but NOT Wizard
    const fighterProfs = collectActorProficiencies(fighterTrack, sys.classes, 'human', [], [], [], undefined, sys);
    expect(fighterProfs.proficientWeaponIds).toContain('bastard_sword');
    expect(fighterProfs.proficientWeaponIds).toContain('dwarven_waraxe');
    const fighterCtx = buildPrerequisiteContextForActor(
      { ...baseData, tracks: fighterTrack, feats: [] },
      sys.classes,
      sys
    );
    expect(evaluatePrerequisiteAST(weaponFocusFeat.prerequisites!, { ...fighterCtx, targetId: 'bastard_sword' })).toBe(true);

    const wizardCtx = buildPrerequisiteContextForActor(
      { ...baseData, tracks: wizardTrack, feats: [] },
      sys.classes,
      sys
    );
    expect(evaluatePrerequisiteAST(weaponFocusFeat.prerequisites!, { ...wizardCtx, targetId: 'bastard_sword' })).toBe(false);

    // War domain with exotic favored weapon grants exotic_weapon_proficiency:<weapon>
    const warExotic = collectClassChoiceFeats([], ['war'], 'bastard_sword', undefined, undefined, undefined, {}, [], sys);
    expect(warExotic).toContain('exotic_weapon_proficiency:bastard_sword');
    expect(warExotic).toContain('weapon_focus:bastard_sword');
  });

  test('Improved Natural Attack: targets natural_weapon, classifies as Combat, emits StatModifier, and steps damage dice', () => {
    const inaDef = sys.feats['improved_natural_attack']!;
    expect(getFeatTargetOptions(sys, inaDef)).toEqual(CANONICAL_NATURAL_WEAPONS);
    expect(classifyFeatCategory(inaDef).isCombat).toBe(true);

    const inaBundle = resolveFeatEffectBundle(inaDef, 'bite');
    expect(inaBundle.modifiers.length).toBe(1);
    expect(inaBundle.modifiers[0]?.target).toBe('natural_damage_size_step');
    expect(inaBundle.modifiers[0]?.value).toBe(1);
    expect(inaBundle.modifiers[0]?.condition?.effectTagsAll).toEqual(['weapon:bite']);

    expect(stepDamageDiceLadder('1d6', 1)).toBe('1d8');
    expect(stepDamageDiceLadder('1d8', 1)).toBe('2d6');

    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...baseData,
      sizeCategory: 'medium',
      feats: ['improved_natural_attack:bite'],
      naturalWeapons: [
        {
          id: 'bite',
          name: 'Bite',
          naturalType: 'bite',
          isPrimary: true,
          count: 1,
          damageDice: '1d6',
          damageType: 'piercing',
          critThreatMin: 20,
          critMultiplier: 2
        },
        {
          id: 'claw',
          name: 'Claw',
          naturalType: 'claw',
          isPrimary: false,
          count: 2,
          damageDice: '1d4',
          damageType: 'slashing',
          critThreatMin: 20,
          critMultiplier: 2
        }
      ]
    });

    const dagEval = evaluateDnD35eEntityDAG(state, playerId)!;
    const biteRoutine = dagEval.attackRoutine.strikes.find((e) => e.naturalWeaponId === 'bite');
    const clawRoutine = dagEval.attackRoutine.strikes.find((e) => e.naturalWeaponId === 'claw');
    expect(biteRoutine?.weaponDice).toBe('1d8');
    expect(clawRoutine?.weaponDice).toBe('1d4');

    const directLimbs = buildActorNaturalWeaponLimbs(
      state,
      playerId,
      getDnD35EntityData(state, playerId),
      'medium',
      [
        {
          targetStat: 'natural_damage_size_step',
          value: 1,
          bonusType: 'untyped',
          sourceId: 'feat:improved_natural_attack:bite',
          condition: { effectTagsAll: ['weapon:bite'] }
        }
      ]
    );
    expect(directLimbs.find((l) => l.id === 'bite')?.dice).toBe('1d8');
    expect(directLimbs.find((l) => l.id === 'claw')?.dice).toBe('1d4');
  });

  test('Live OnHitRider Combat Pipeline: Giant Spider bite triggers spider_venom, Ability Focus raises DC 14 -> 16, DR 0 dmg suppresses injury poison', () => {
    let state = buildGameState(campaign);
    const defenderId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseDefenderData = getDnD35EntityData(state, defenderId);
    const defenderStats = getComponent(state, defenderId, ComponentType.Fighter) as FighterComponent;
    const defenderPos = getComponent(state, defenderId, ComponentType.Position)!;

    // Normalize defender Fort save bonus (+0 total) and clean conditions/DR
    const neutralStats = {
      base: 10,
      inherentBonus: 0,
      damage: 0,
      drain: 0,
      tempPenalty: 0
    };
    state = setDnD35EntityData(state, defenderId, {
      ...baseDefenderData,
      raceId: 'human',
      abilityScores: {
        str: neutralStats,
        dex: neutralStats,
        con: neutralStats,
        int: neutralStats,
        wis: neutralStats,
        cha: neutralStats
      },
      tracks: [
        {
          trackId: 'fighter',
          levels: 1,
          hitDieSides: 10,
          babCurve: 'full',
          fortCurve: 'poor',
          refCurve: 'poor',
          willCurve: 'poor',
          skillPointsPerLevel: 2,
          trackCategory: 'pc'
        }
      ],
      feats: [],
      domains: [],
      activeClassFeatures: [],
      conditions: ['normal'],
      immunities: [],
      damageReduction: undefined
    });

    // Spawn Giant Spider attacker adjacent to defender
    const [s1, spiderId] = createEntity(state);
    state = s1;
    state = addComponent(state, spiderId, { type: ComponentType.Identity, name: 'Giant Spider', glyph: 's', fg: '#fff', bg: '#000' });
    state = addComponent(state, spiderId, { ...defenderPos, x: defenderPos.x + 1 });
    state = addComponent(state, spiderId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });
    state = addComponent(state, spiderId, { type: ComponentType.Faction, factionId: 'monsters' });
    state = addComponent(state, spiderId, { type: ComponentType.Equipment, slots: [] });

    const giantSpiderRace = sys.races['giant_spider']!;
    state = setDnD35EntityData(state, spiderId, {
      ...baseDefenderData,
      raceId: 'giant_spider',
      creatureType: giantSpiderRace.creatureType,
      subtypes: giantSpiderRace.subtypes,
      sizeCategory: giantSpiderRace.size,
      tracks: [
        {
          trackId: 'racial_giant_spider',
          levels: 2,
          hitDieSides: 8,
          babCurve: 'three_quarters',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'poor',
          skillPointsPerLevel: 2,
          trackCategory: 'racial_hd'
        }
      ],
      naturalWeapons: giantSpiderRace.naturalWeapons,
      feats: ['ability_focus:poison']
    });

    const attackerEval = evaluateDnD35eEntityDAG(state, spiderId)!;
    const defenderEval = evaluateDnD35eEntityDAG(state, defenderId)!;
    const biteStrike = attackerEval.attackRoutine.strikes.find((s) => s.naturalWeaponId === 'bite')!;
    expect(biteStrike).toBeDefined();
    expect(biteStrike.onHitRiders?.[0]?.riderId).toBe('spider_venom');
    expect(biteStrike.onHitRiders?.[0]?.dc).toBe(14);

    // Fort save = 0; rolling 14 totals 14 -> would SAVE vs base DC 14, but FAILS vs boosted DC 16!
    const boostedResult = executeCombatStrikeExchange({
      state,
      attackerId: spiderId,
      defenderId,
      strike: biteStrike,
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData: getDnD35EntityData(state, spiderId),
      defenderData: getDnD35EntityData(state, defenderId),
      attackerSelfTags: attackerEval.selfTags,
      defenderSelfTags: defenderEval.selfTags,
      attackerEval,
      defenderEval,
      defenderHpRemaining: defenderStats.hp,
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 18,
      forcedRiderSaveRoll: 14
    });
    expect(boostedResult.hit).toBe(true);
    expect(getDnD35EntityData(boostedResult.state, defenderId).conditions).toContain('sickened');
    const dcLog = boostedResult.state.messages.find(
      (m) => m.cssClass === MessageLogCategory.CombatHit && m.text.includes('DC 16')
    );
    expect(dcLog).toBeDefined();

    // Injury poison must NOT trigger when physical damage is reduced to 0 by DR
    const drState = setDnD35EntityData(state, defenderId, {
      ...getDnD35EntityData(state, defenderId),
      damageReduction: { amount: 20, bypassTags: ['epic'] }
    });
    const drDefenderEval = evaluateDnD35eEntityDAG(drState, defenderId)!;
    const drResult = executeCombatStrikeExchange({
      state: drState,
      attackerId: spiderId,
      defenderId,
      strike: biteStrike,
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData: getDnD35EntityData(drState, spiderId),
      defenderData: getDnD35EntityData(drState, defenderId),
      attackerSelfTags: attackerEval.selfTags,
      defenderSelfTags: drDefenderEval.selfTags,
      attackerEval,
      defenderEval: drDefenderEval,
      defenderHpRemaining: defenderStats.hp,
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 18,
      forcedRiderSaveRoll: 1
    });
    expect(drResult.hit).toBe(true);
    expect(getDnD35EntityData(drResult.state, defenderId).conditions).not.toContain('sickened');
  });

  test('Owned-Target Gating & Dropdown Filtering: Ability Focus ($selected) and Improved Natural Attack (naturalWeaponIds)', () => {
    const abilityFocusDef = sys.feats['ability_focus']!;
    const inaDef = sys.feats['improved_natural_attack']!;

    const rogueDraft: CharacterCreationDraft = {
      raceId: 'human',
      alignment: 'NG',
      classId: 'rogue',
      baseAbilityScores: { str: 10, dex: 16, con: 12, int: 14, wis: 10, cha: 10 },
      equipmentPackageId: 'martial_vanguard',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      skillRanks: { hide: 4, move_silently: 4 },
      selectedFeats: [],
      knownSpells: []
    };
    const rogueCtx = buildCreationDraftPrerequisiteContext(rogueDraft, sys);
    expect(rogueCtx.tags).toContain('special_attack:sneak_attack');
    expect(getFeatTargetOptions(sys, abilityFocusDef, rogueCtx)).toEqual(['sneak_attack']);
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, { ...rogueCtx, targetId: 'sneak_attack' })).toBe(true);
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, { ...rogueCtx, targetId: 'breath_weapon' })).toBe(false);

    const fighterDraft: CharacterCreationDraft = {
      ...rogueDraft,
      classId: 'fighter',
      skillRanks: {}
    };
    const fighterNoSpecialCtx = buildCreationDraftPrerequisiteContext(fighterDraft, sys);
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, { ...fighterNoSpecialCtx, targetId: 'breath_weapon' })).toBe(
      false
    );
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, fighterNoSpecialCtx)).toBe(false);

    // Selecting Stunning Fist in Step 5 dynamically unlocks Ability Focus:stun
    const monkWithStunCtx = buildCreationDraftPrerequisiteContext(fighterDraft, sys, ['stunning_fist']);
    expect(monkWithStunCtx.tags).toContain('special_attack:stun');
    expect(getFeatTargetOptions(sys, abilityFocusDef, monkWithStunCtx)).toEqual(['stun']);
    expect(evaluatePrerequisiteAST(abilityFocusDef.prerequisites!, { ...monkWithStunCtx, targetId: 'stun' })).toBe(true);

    // Improved Natural Attack: dropdown and prerequisite check restrict to owned natural weapons
    const state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseData = getDnD35EntityData(state, playerId);
    const biteOnlyData = {
      ...baseData,
      naturalWeapons: [
        {
          id: 'bite',
          name: 'Bite',
          naturalType: 'bite' as const,
          isPrimary: true,
          count: 1,
          damageDice: '1d6',
          damageType: 'piercing' as const,
          critThreatMin: 20,
          critMultiplier: 2
        }
      ],
      tracks: [
        {
          trackId: 'fighter',
          levels: 4,
          hitDieSides: 10 as const,
          babCurve: 'full' as const,
          fortCurve: 'good' as const,
          refCurve: 'poor' as const,
          willCurve: 'poor' as const,
          skillPointsPerLevel: 2,
          trackCategory: 'pc' as const
        }
      ]
    };
    const biteCtx = buildPrerequisiteContextForActor(biteOnlyData, sys.classes, sys);
    expect(biteCtx.naturalWeaponIds).toEqual(['bite']);
    expect(getFeatTargetOptions(sys, inaDef, biteCtx)).toEqual(['bite']);
    expect(evaluatePrerequisiteAST(inaDef.prerequisites!, { ...biteCtx, targetId: 'bite' })).toBe(true);
    expect(evaluatePrerequisiteAST(inaDef.prerequisites!, { ...biteCtx, targetId: 'claw' })).toBe(false);

    // Level-up context preserves naturalWeaponIds and projects accumulated feats like Stunning Fist
    const lvlUpCtx = buildPostLevelUpPrerequisiteContext(
      biteOnlyData,
      {
        classId: 'fighter',
        hpRolled: 6,
        addedSkillRanks: {},
        selectedFeats: []
      },
      sys.classes['fighter']!,
      sys,
      ['stunning_fist']
    );
    expect(lvlUpCtx.naturalWeaponIds).toEqual(['bite']);
    expect(lvlUpCtx.tags).toContain('special_attack:stun');
  });

  test('Rule 21 Declarative Parity: War domain, Ranger combatStyleFeatByChoice, Composite Bow equivalence, and Barbarian+Wizard Illiteracy', () => {
    // 1. Bow proficiency equivalence declared on items/*.json
    const rogueProfs = collectActorProficiencies(
      [
        {
          trackId: 'rogue',
          levels: 1,
          hitDieSides: 6,
          babCurve: 'three_quarters',
          fortCurve: 'poor',
          refCurve: 'good',
          willCurve: 'poor',
          skillPointsPerLevel: 8,
          trackCategory: 'pc'
        }
      ],
      sys.classes,
      'human',
      [],
      [],
      [],
      undefined,
      sys
    );
    expect(rogueProfs.proficientWeaponIds).toContain('shortbow');
    expect(rogueProfs.proficientWeaponIds).toContain('composite_shortbow');
    expect(rogueProfs.proficientWeaponIds).not.toContain('longbow');

    // 2. Ranger combatStyleFeatByChoice: grants in light/no armor, suppresses in medium/heavy armor
    const rangerArcheryLight = collectClassChoiceFeats(
      ['combat_style', 'improved_combat_style', 'combat_style_mastery'],
      [],
      undefined,
      'archery',
      undefined,
      undefined,
      {},
      [],
      sys,
      ['armor:light']
    );
    expect(rangerArcheryLight).toEqual(['rapid_shot', 'manyshot', 'improved_precise_shot']);

    const rangerArcheryHeavy = collectClassChoiceFeats(
      ['combat_style', 'improved_combat_style', 'combat_style_mastery'],
      [],
      undefined,
      'archery',
      undefined,
      undefined,
      {},
      [],
      sys,
      ['armor:heavy']
    );
    expect(rangerArcheryHeavy).toEqual([]);

    // 3. Barbarian + Wizard multiclass loses Illiteracy purely via activationCondition selfTagsNone: ['trait:literate']
    const state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseData = getDnD35EntityData(state, playerId);
    const barbOnlyTags = projectDnD35ActorSemanticTags(
      {
        ...baseData,
        tracks: [
          {
            trackId: 'barbarian',
            levels: 1,
            hitDieSides: 12,
            babCurve: 'full',
            fortCurve: 'good',
            refCurve: 'poor',
            willCurve: 'poor',
            skillPointsPerLevel: 4,
            trackCategory: 'pc'
          }
        ],
        activeClassFeatures: ['illiteracy']
      },
      [],
      undefined,
      sys.classes,
      sys.skills,
      sys.domains,
      sys.feats
    );
    expect(barbOnlyTags).toContain('trait:illiterate');
    expect(barbOnlyTags).toContain('feature:illiteracy');

    const barbWizTags = projectDnD35ActorSemanticTags(
      {
        ...baseData,
        tracks: [
          {
            trackId: 'barbarian',
            levels: 1,
            hitDieSides: 12,
            babCurve: 'full',
            fortCurve: 'good',
            refCurve: 'poor',
            willCurve: 'poor',
            skillPointsPerLevel: 4,
            trackCategory: 'pc'
          },
          {
            trackId: 'wizard',
            levels: 1,
            hitDieSides: 4,
            babCurve: 'half',
            fortCurve: 'poor',
            refCurve: 'poor',
            willCurve: 'good',
            skillPointsPerLevel: 2,
            trackCategory: 'pc'
          }
        ],
        activeClassFeatures: ['illiteracy']
      },
      [],
      undefined,
      sys.classes,
      sys.skills,
      sys.domains,
      sys.feats
    );
    expect(barbWizTags).toContain('trait:literate');
    expect(barbWizTags).not.toContain('trait:illiterate');
    expect(barbWizTags).not.toContain('feature:illiteracy');
  });
});
