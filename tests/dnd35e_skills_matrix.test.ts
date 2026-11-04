import { describe, expect, it } from 'bun:test';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, getComponent, queryEntities } from '../src/core/ecs.ts';
import { ComponentType, type AttitudeComponent, type LockComponent, type TrapComponent } from '../src/types/components.types.ts';
import type { EntityId } from '../src/types/game-state.types.ts';
import { UIMode } from '../src/types/game-state.types.ts';
import { processApplyIntent, getValidVerbsForTarget } from '../src/systems/apply.system.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { validateDnD35eSystemContentIntegrity } from '../src/rulesets/dnd35e/dnd35e_validator.ts';
import {
  projectDnD35eInspectLoreLines,
  resolveEntityDnD35Data
} from '../src/rulesets/dnd35e/skill_verbs.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import {
  buildSkillRankThresholdModifiers,
  computeSkillSynergyBonus,
  evaluateSkillRankThresholdEffects,
  resolveDemoralizeCheck,
  resolveDisableTrapCheck,
  resolveFeintCheck,
  resolveHealSkillCheck,
  resolveMonsterLoreCheck,
  resolveOpenLockCheck,
  resolveTrapSearchCheck
} from '../src/rulesets/dnd35e/skills.ts';
import {
  getEffectiveClassSkillIds,
  getActorEverClassSkillIds
} from '../src/rulesets/dnd35e/character_builder.ts';
import { resolveEightHourRest } from '../src/rulesets/dnd35e/magic/aoe_rest.ts';
import { projectDnD35ActorSemanticTags } from '../src/rulesets/dnd35e/srd_registry.ts';

describe('Milestone 113: Complete 50-Skill Matrix & Active Dungeon/Combat Skill Verbs', () => {
  it('loads all 50 skills including the 8 new Knowledge and Craft sub-skills', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    expect(Object.keys(sys.skills).length).toBe(50);

    // Verify 8 new skills are present
    const newSkillIds = [
      'knowledge_architecture',
      'knowledge_geography',
      'knowledge_history',
      'craft_alchemy',
      'craft_armorsmithing',
      'craft_bowmaking',
      'craft_trapmaking',
      'craft_weaponsmithing'
    ];
    for (const id of newSkillIds) {
      expect(sys.skills[id]).toBeDefined();
      expect(sys.skills[id]?.id).toBe(id);
    }

    // Verify all 10 Knowledge skills
    const knowledgeSkills = Object.keys(sys.skills).filter((s) => s.startsWith('knowledge_'));
    expect(knowledgeSkills.length).toBe(10);
    expect(knowledgeSkills.sort()).toEqual([
      'knowledge_arcana',
      'knowledge_architecture',
      'knowledge_dungeoneering',
      'knowledge_geography',
      'knowledge_history',
      'knowledge_local',
      'knowledge_nature',
      'knowledge_nobility',
      'knowledge_planes',
      'knowledge_religion'
    ]);
  });

  it('validates bidirectional 5-rank synergies for new Knowledge skills', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // Knowledge (architecture and engineering) grants synergy to Search
    const searchDef = sys.skills['search']!;
    expect(searchDef.synergyFromSkills).toContain('knowledge_architecture');
    const searchSynergy = computeSkillSynergyBonus(searchDef.synergyFromSkills, {
      knowledge_architecture: 5
    });
    expect(searchSynergy).toBe(2);

    // Knowledge (geography) grants synergy to Survival
    const survivalDef = sys.skills['survival']!;
    expect(survivalDef.synergyFromSkills).toContain('knowledge_geography');
    const survivalSynergy = computeSkillSynergyBonus(survivalDef.synergyFromSkills, {
      knowledge_geography: 5
    });
    expect(survivalSynergy).toBe(2);
  });

  it('automatically expands craft to all craft_* sub-skills for class skills', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // Fighter has 'craft' on class skill list
    const fighterDef = sys.classes['fighter'];
    expect(fighterDef?.classSkills).toContain('craft');

    const effectiveSkills = getEffectiveClassSkillIds(fighterDef, [], sys);
    expect(effectiveSkills).toContain('craft');
    expect(effectiveSkills).toContain('craft_alchemy');
    expect(effectiveSkills).toContain('craft_armorsmithing');
    expect(effectiveSkills).toContain('craft_bowmaking');
    expect(effectiveSkills).toContain('craft_trapmaking');
    expect(effectiveSkills).toContain('craft_weaponsmithing');

    const everSkills = getActorEverClassSkillIds(undefined, 'fighter', [], sys);
    expect(everSkills).toContain('craft_weaponsmithing');
  });

  it('evaluates skill rank threshold effects, semantic tags, and stance:fighting_defensively / stance:total_defense AC bonuses', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign);
    expect(sys).not.toBeNull();
    if (!sys) return;

    // Balance 5 ranks unlocks trait:balance_uncanny_flat_footed
    const balanceThresholds = evaluateSkillRankThresholdEffects({ balance: 5 }, sys.skills);
    expect(balanceThresholds.grantedTags).toContain('trait:balance_uncanny_flat_footed');

    // Tumble 5 ranks unlocks trait:tumble_acrobatic_defense and 2 dodge AC modifiers
    const tumbleThresholds = evaluateSkillRankThresholdEffects({ tumble: 5 }, sys.skills);
    expect(tumbleThresholds.grantedTags).toContain('trait:tumble_acrobatic_defense');
    expect(tumbleThresholds.statModifiers.length).toBe(2);

    // projectDnD35ActorSemanticTags projects both tags declaratively via sys.skills
    const baseDndData = {
      archetypeId: 'player',
      sizeCategory: 'medium' as const,
      creatureType: 'humanoid',
      subtypes: ['human'],
      tracks: [{ trackId: 'rogue', levels: 5, hitDieSides: 6 as const, babCurve: 'three_quarters' as const, fortCurve: 'poor' as const, refCurve: 'good' as const, willCurve: 'poor' as const, skillPointsPerLevel: 8 }],
      skillRanks: { balance: 5, tumble: 5 },
      abilityScores: {
        str: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 },
        dex: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 },
        con: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 },
        int: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 },
        wis: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 },
        cha: { base: 10, inherentBonus: 0, tempPenalty: 0, damage: 0, drain: 0 }
      },
      weaponDice: '1d6',
      weaponDamageType: 'piercing' as const,
      weaponCritThreatMin: 20,
      weaponCritMultiplier: 2,
      weaponBypassTags: [],
      armorBonus: 0,
      shieldBonus: 0,
      naturalArmorBonus: 0,
      energyResistance: {},
      immunities: [],
      vulnerabilities: [],
      feats: [],
      conditions: [],
      nonlethalDamage: 0,
      tempHp: 0,
      isStable: true,
      statModifiers: buildSkillRankThresholdModifiers({ balance: 5, tumble: 5 }, sys.skills)
    };
    const tags = projectDnD35ActorSemanticTags(baseDndData, [], undefined, sys.classes, sys.skills);
    expect(tags).toContain('trait:balance_uncanny_flat_footed');
    expect(tags).toContain('trait:tumble_acrobatic_defense');

    // Verify stance:fighting_defensively and stance:total_defense project into evaluateDnD35eEntityDAG
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    state = addComponent(state, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: baseDndData as unknown as Readonly<Record<string, unknown>>
    });
    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      fightingDefensively: true
    });
    const dagFightingDef = evaluateDnD35eEntityDAG(state, playerId);
    // Base AC 10 + 2 (fighting defensively) + 1 (tumble 5 ranks threshold modifier) = 13
    expect(dagFightingDef?.dagResult.acBreakdown.fullAC).toBe(13);

    state = addComponent(state, playerId, {
      type: ComponentType.TacticalDoctrine,
      totalDefense: true
    });
    const dagTotalDef = evaluateDnD35eEntityDAG(state, playerId);
    // Base AC 10 + 4 (total defense) + 2 (tumble 5 ranks threshold modifier) = 16
    expect(dagTotalDef?.dagResult.acBreakdown.fullAC).toBe(16);
  });

  it('resolves active dungeon/combat skill checks: Monster Lore, Search, Disable Trap, Open Lock, Feint, Demoralize, Heal', () => {
    // 1. Monster Lore: DC = 10 + CR. Every 5 points beats DC reveals another trait. Untrained capped at 10.
    const loreTrained = resolveMonsterLoreCheck(4, 19, true, ['Fire Immunity', 'Cold Vulnerability', 'Damage Reduction 5/Silver']);
    expect(loreTrained.success).toBe(true);
    expect(loreTrained.baseDc).toBe(14);
    expect(loreTrained.piecesOfUsefulInfo).toBe(2); // 19 - 14 = 5 -> 1 + 1 = 2 pieces
    expect(loreTrained.revealedTraits).toEqual(['Fire Immunity', 'Cold Vulnerability']);

    const loreUntrained = resolveMonsterLoreCheck(4, 19, false, ['Fire Immunity']);
    expect(loreUntrained.success).toBe(false); // Capped at 10, DC is 14

    // 2. Search for traps: Non-rogues cannot spot DC > 20 without Trapfinding
    expect(resolveTrapSearchCheck(25, 22, false)).toBe(false);
    expect(resolveTrapSearchCheck(25, 22, true)).toBe(true);
    expect(resolveTrapSearchCheck(18, 15, false)).toBe(true);

    // 3. Disable Trap: Non-rogues cannot disarm DC > 20 without Trapfinding. Failing by 5+ triggers trap.
    const disarmPass = resolveDisableTrapCheck(25, 22, false, true);
    expect(disarmPass.success).toBe(true);
    expect(disarmPass.triggeredTrap).toBe(false);

    const disarmFailSpring = resolveDisableTrapCheck(15, 22, false, true);
    expect(disarmFailSpring.success).toBe(false);
    expect(disarmFailSpring.triggeredTrap).toBe(true); // 15 - 22 = -7 <= -5

    const disarmNonRogueGate = resolveDisableTrapCheck(30, 22, false, false);
    expect(disarmNonRogueGate.success).toBe(false);
    expect(disarmNonRogueGate.triggeredTrap).toBe(true);

    // 4. Open Lock
    expect(resolveOpenLockCheck(22, 20)).toBe(true);
    expect(resolveOpenLockCheck(18, 20)).toBe(false);

    // 5. Heal: DC 15 First Aid & Long-Term Care
    expect(resolveHealSkillCheck(16, 15)).toBe(true);
    expect(resolveHealSkillCheck(14, 15)).toBe(false);

    // Long-Term Care doubles 8-hour rest recovery
    const standardRest = resolveEightHourRest({
      slots: [],
      restCompletionTurn: 4800,
      characterLevel: 3,
      isThreatened: false,
      hasLongTermCare: false
    });
    expect(standardRest.naturalHpHealed).toBe(3);
    expect(standardRest.abilityDamageHealedPerStat).toBe(1);

    const ltcRest = resolveEightHourRest({
      slots: [],
      restCompletionTurn: 4800,
      characterLevel: 3,
      isThreatened: false,
      hasLongTermCare: true
    });
    expect(ltcRest.naturalHpHealed).toBe(6);
    expect(ltcRest.abilityDamageHealedPerStat).toBe(2);

    // 6. Feint in Combat
    expect(resolveFeintCheck(30, 10, 2, 0)).toBe(true);

    // 7. Demoralize in Combat
    expect(resolveDemoralizeCheck(35, 3, 0, 0)).toBe(true);
  });

  it('mutates LockComponent, TrapComponent, AttitudeComponent, and target conditions via active skill verbs and gates Monster Lore', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign)!;
    let state = buildGameState(campaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Give the player high skill ranks in open_lock, disable_device, heal, diplomacy, intimidate, bluff, and knowledge_religion
    const playerDnd = {
      ...resolveEntityDnD35Data(state, playerId),
      skillRanks: {
        open_lock: 25,
        disable_device: 25,
        search: 25,
        heal: 25,
        diplomacy: 25,
        intimidate: 35,
        bluff: 35,
        knowledge_religion: 15
      },
      activeClassFeatures: ['trapfinding']
    };
    state = addComponent(state, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: playerDnd as unknown as Readonly<Record<string, unknown>>
    });

    // Create a locked & trapped chest entity (ID 9001) and a monster entity without MemoryComponent (ID 9002)
    const chestId = 9001 as EntityId;
    state = addComponent(state, chestId, {
      type: ComponentType.Lock,
      difficulty: 20,
      locked: true
    });
    state = addComponent(state, chestId, {
      type: ComponentType.Trap,
      triggerId: 'dart_trap',
      triggered: false
    });

    // Valid verbs on chest include unlock and disarm
    const chestVerbs = getValidVerbsForTarget(state, playerId, { type: 'entity', entityId: chestId });
    expect(chestVerbs).toContain('unlock');
    expect(chestVerbs).toContain('disarm');

    // Execute unlock -> mutates LockComponent.locked to false
    const unlockRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'unlock',
      target: { type: 'entity', entityId: chestId }
    });
    expect(unlockRes.success).toBe(true);
    state = unlockRes.state;
    const lockAfter = getComponent(state, chestId, ComponentType.Lock) as LockComponent | undefined;
    expect(lockAfter?.locked).toBe(false);

    // Execute disarm -> removes TrapComponent
    const disarmRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'disarm',
      target: { type: 'entity', entityId: chestId }
    });
    expect(disarmRes.success).toBe(true);
    state = disarmRes.state;
    const trapAfter = getComponent(state, chestId, ComponentType.Trap) as TrapComponent | undefined;
    expect(trapAfter).toBeUndefined();

    // Create a combat monster without MemoryComponent
    const monsterId = 9002 as EntityId;
    state = addComponent(state, monsterId, {
      type: ComponentType.Fighter,
      hp: 12,
      maxHp: 12,
      attack: 2,
      defense: 2,
      xp: 0,
      level: 1
    });
    const monsterDnd = {
      ...resolveEntityDnD35Data(state, monsterId),
      creatureType: 'undead',
      subtypes: ['incorporeal'],
      damageReduction: { amount: 5, bypassTags: ['bludgeoning'] },
      isStable: false,
      conditions: []
    };
    state = addComponent(state, monsterId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: monsterDnd as unknown as Readonly<Record<string, unknown>>
    });

    // Execute intimidate on monster without MemoryComponent -> applies 'shaken' condition
    const intimRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'intimidate',
      target: { type: 'entity', entityId: monsterId }
    });
    expect(intimRes.success).toBe(true);
    state = intimRes.state;
    expect(resolveEntityDnD35Data(state, monsterId).conditions).toContain('shaken');

    // Execute feint on monster -> applies 'flat_footed' condition
    const feintRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'feint',
      target: { type: 'entity', entityId: monsterId }
    });
    expect(feintRes.success).toBe(true);
    state = feintRes.state;
    expect(resolveEntityDnD35Data(state, monsterId).conditions).toContain('flat_footed');

    // Execute persuade -> updates AttitudeComponent on target
    const persuadeRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'persuade',
      target: { type: 'entity', entityId: monsterId }
    });
    expect(persuadeRes.success).toBe(true);
    state = persuadeRes.state;
    const attAfter = getComponent(state, monsterId, ComponentType.Attitude) as AttitudeComponent | undefined;
    expect(attAfter?.attitude === 'friendly' || attAfter?.attitude === 'helpful').toBe(true);

    // Execute heal -> stabilizes target (isStable: true)
    const healRes = processApplyIntent(state, {
      entityId: playerId,
      verb: 'heal',
      target: { type: 'entity', entityId: monsterId }
    });
    expect(healRes.success).toBe(true);
    state = healRes.state;
    expect(resolveEntityDnD35Data(state, monsterId).isStable).toBe(true);

    // Monster Lore inspection: trained in knowledge_religion reveals undead Type & DR
    state = { ...state, uiMode: UIMode.Game };
    const loreTrainedLines = projectDnD35eInspectLoreLines(state, monsterId);
    expect(loreTrainedLines.some((l) => l.value.includes('Type: undead'))).toBe(true);
    expect(loreTrainedLines.some((l) => l.value.includes('DR: 5/bludgeoning'))).toBe(true);

    // Untrained in knowledge_religion (0 ranks) hides Monster Lore in Game UIMode (since untrained cap is 10 vs DC 11)
    state = addComponent(state, playerId, {
      type: ComponentType.RulesetData,
      rulesetId: 'dnd35e',
      payload: {
        ...playerDnd,
        skillRanks: { ...playerDnd.skillRanks, knowledge_religion: 0 }
      } as unknown as Readonly<Record<string, unknown>>
    });
    const loreUntrainedLines = projectDnD35eInspectLoreLines(state, monsterId);
    expect(loreUntrainedLines.length).toBe(0);

    // Validator catches unknown skillId in min_skill_ranks prerequisite AST
    const brokenSys = {
      ...sys,
      feats: {
        ...sys.feats,
        acrobatic: {
          ...sys.feats['acrobatic']!,
          prerequisites: {
            type: 'min_skill_ranks' as const,
            skillId: 'nonexistent_skill_xyz',
            minRanks: 5
          }
        }
      }
    };
    const valErrors = validateDnD35eSystemContentIntegrity(brokenSys);
    expect(valErrors.some((e) => e.message.includes('nonexistent_skill_xyz'))).toBe(true);
  });
});

