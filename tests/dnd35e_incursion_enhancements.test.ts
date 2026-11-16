import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { spellBehavior } from '../src/ai/spell.behavior.ts';
import { processTraps } from '../src/systems/trigger/systemic.ts';
import {
  ComponentType,
  type FighterComponent,
  type TacticalDoctrineComponent,
  type TrapComponent
} from '../src/types/components.types.ts';
import { GameEventType } from '../src/types/events.types.ts';
import { EngineMode } from '../src/types/game-state.types.ts';
import { createRoundActionBudget } from '../src/rulesets/dnd35e/action_economy.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { getNextCounterspellReactionTrigger } from '../src/rulesets/dnd35e/combat/immediate_reactions.ts';
import { evaluateReactiveCounterspellInterrupt } from '../src/rulesets/dnd35e/magic/counterspell_interrupt.ts';
import {
  computeSpellRangeTiles,
  matchesTargetCategoryFilter,
  predictSpellAoEVictims,
  summarizeMetamagic
} from '../src/rulesets/dnd35e/magic/spell_cast_helpers.ts';
import { executeDnD35eSpellCast } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { evaluatePrerequisiteAST } from '../src/rulesets/dnd35e/prerequisites.ts';
import { resolveDungeonSkillVerb } from '../src/rulesets/dnd35e/skills/dungeon_skill_verbs.ts';
import { buildKnowledgeDevotionModifiers } from '../src/rulesets/dnd35e/skills/skill_synergies.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function makeOpenArena(state: GameState): GameState {
  const floorId = Object.keys(state.campaign.tiles).find((k) => state.campaign.tiles[k]?.walkable) ?? 'floor';
  const tiles = state.map.tiles.map((t) => ({ ...t, tileId: floorId }));
  return { ...state, map: { ...state.map, tiles } };
}

describe('Incursion-Inspired Tactical & Systemic Enhancements', () => {
  test('1. Trap Resetting defaults to enabled at DC+5, honors canReset: false, and spares resetter & allies', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);

    const [s1, rogueId] = createEntity(state);
    const [s2, enemyId] = createEntity(s1);
    const [s3, resettableTrapId] = createEntity(s2);
    const [s4, oneShotTrapId] = createEntity(s3);
    state = s4;

    state = addComponent(state, rogueId, { type: ComponentType.Player });
    state = addComponent(state, rogueId, { type: ComponentType.Position, x: 4, y: 5 });
    state = addComponent(state, rogueId, {
      type: ComponentType.Fighter,
      maxHp: 30,
      hp: 30,
      attack: 5,
      defense: 12,
      xp: 0,
      level: 5,
      xpGiven: 0
    });
    state = addComponent(state, rogueId, { type: ComponentType.Faction, factionId: 'player' });
    state = setDnD35EntityData(state, rogueId, {
      ...getDnD35EntityData(state, rogueId),
      skillRanks: { disable_device: 25 }
    });

    state = addComponent(state, enemyId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, enemyId, {
      type: ComponentType.Fighter,
      maxHp: 20,
      hp: 20,
      attack: 3,
      defense: 10,
      xp: 0,
      level: 1,
      xpGiven: 50
    });
    state = addComponent(state, enemyId, { type: ComponentType.Faction, factionId: 'monster' });

    state = addComponent(state, resettableTrapId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, resettableTrapId, {
      type: ComponentType.Trap,
      triggerId: 'spike_trap',
      triggered: false,
      canReset: true
    });

    state = addComponent(state, oneShotTrapId, { type: ComponentType.Position, x: 4, y: 6 });
    state = addComponent(state, oneShotTrapId, {
      type: ComponentType.Trap,
      triggerId: 'collapse_trap',
      triggered: false,
      canReset: false
    });

    // High Disable Device skill (>= DC 15 + 5 = 20) resets the default/canReset:true trap
    const resetRes = resolveDungeonSkillVerb(state, {
      entityId: rogueId,
      verb: 'disarm',
      target: { type: 'entity', entityId: resettableTrapId }
    } as Parameters<typeof resolveDungeonSkillVerb>[1]);
    expect(resetRes?.success).toBe(true);
    const trapAfterReset = getComponent(resetRes!.state, resettableTrapId, ComponentType.Trap) as TrapComponent;
    expect(trapAfterReset).toBeDefined();
    expect(trapAfterReset.triggered).toBe(false);
    expect(trapAfterReset.resetByEntityId).toBe(rogueId);

    // Owner walks safely over reset trap
    let stepState = addComponent(resetRes!.state, rogueId, { type: ComponentType.Position, x: 5, y: 5 });
    stepState = processTraps(stepState, rogueId);
    expect((getComponent(stepState, resettableTrapId, ComponentType.Trap) as TrapComponent).triggered).toBe(false);

    // Hostile stepping onto reset trap springs it and records resetByEntityId
    stepState = addComponent(stepState, enemyId, { type: ComponentType.Position, x: 5, y: 5 });
    stepState = processTraps(stepState, enemyId);
    expect((getComponent(stepState, resettableTrapId, ComponentType.Trap) as TrapComponent).triggered).toBe(true);
    const trapEvt = stepState.events.find((e) => e.type === GameEventType.TrapTriggered);
    expect(trapEvt?.type).toBe(GameEventType.TrapTriggered);
    if (trapEvt?.type === GameEventType.TrapTriggered) {
      expect(trapEvt.resetByEntityId).toBe(rogueId);
    }

    // Trap with canReset: false is permanently removed instead of reset
    const oneShotRes = resolveDungeonSkillVerb(state, {
      entityId: rogueId,
      verb: 'disarm',
      target: { type: 'entity', entityId: oneShotTrapId }
    } as Parameters<typeof resolveDungeonSkillVerb>[1]);
    expect(oneShotRes?.success).toBe(true);
    expect(getComponent(oneShotRes!.state, oneShotTrapId, ComponentType.Trap)).toBeUndefined();
  });

  test('2. Composable target categories filter creatures, allies, enemies, doors, walls, and objects', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);

    const [s1, casterId] = createEntity(state);
    const [s2, allyId] = createEntity(s1);
    const [s3, enemyId] = createEntity(s2);
    const [s4, doorId] = createEntity(s3);
    const [s5, wallId] = createEntity(s4);
    state = s5;

    state = addComponent(state, casterId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, casterId, {
      type: ComponentType.Fighter,
      maxHp: 20,
      hp: 20,
      attack: 1,
      defense: 10,
      xp: 0,
      level: 1,
      xpGiven: 0
    });
    state = addComponent(state, allyId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, allyId, {
      type: ComponentType.Fighter,
      maxHp: 20,
      hp: 20,
      attack: 1,
      defense: 10,
      xp: 0,
      level: 1,
      xpGiven: 0
    });
    state = addComponent(state, enemyId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, enemyId, {
      type: ComponentType.Fighter,
      maxHp: 20,
      hp: 20,
      attack: 1,
      defense: 10,
      xp: 0,
      level: 1,
      xpGiven: 50
    });
    state = addComponent(state, doorId, {
      type: ComponentType.Lock,
      difficulty: 20,
      locked: true
    });
    state = addComponent(state, wallId, { type: ComponentType.Tags, tags: ['wall'] });

    expect(matchesTargetCategoryFilter(state, casterId, casterId, ['ally'])).toBe(false);
    expect(matchesTargetCategoryFilter(state, casterId, casterId, ['self', 'ally'])).toBe(true);
    expect(matchesTargetCategoryFilter(state, casterId, allyId, ['self', 'ally'])).toBe(true);
    expect(matchesTargetCategoryFilter(state, casterId, enemyId, ['self', 'ally'])).toBe(false);
    expect(matchesTargetCategoryFilter(state, casterId, doorId, ['enemy', 'door', 'wall'])).toBe(true);
    expect(matchesTargetCategoryFilter(state, casterId, wallId, ['enemy', 'door', 'wall'])).toBe(true);
    expect(matchesTargetCategoryFilter(state, casterId, allyId, ['enemy', 'door', 'wall'])).toBe(false);
    expect(matchesTargetCategoryFilter(state, casterId, enemyId, ['enemy', 'door', 'wall'])).toBe(true);
  });

  test('3. Judicious Spell skips allies/self in AoE, Reach Spell projects Touch to Close, & AI avoids AoE friendly fire', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sysContent = getDnD35SystemContent(campaign)!;
    let state = makeOpenArena(buildGameState(campaign));

    expect(sysContent.feats['judicious_spell']?.metamagicDescriptor?.skipAlliesInAoE).toBe(true);
    expect(sysContent.feats['reach_spell']?.metamagicDescriptor?.projectTouchToCloseRange).toBe(true);

    const reachMeta = summarizeMetamagic(['reach_spell'], sysContent);
    expect(reachMeta.flags.projectTouch).toBe(true);
    expect(computeSpellRangeTiles('touch', 6, reachMeta.rangeMultiplier, reachMeta.flags.projectTouch)).toBe(8);
    expect(computeSpellRangeTiles('touch', 6, 1, false)).toBe(1);

    const [s1, casterId] = createEntity(state);
    const [s2, allyId] = createEntity(s1);
    const [s3, enemyId] = createEntity(s2);
    state = s3;

    state = addComponent(state, casterId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, casterId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, casterId, {
      type: ComponentType.Fighter,
      maxHp: 30,
      hp: 30,
      attack: 2,
      defense: 12,
      xp: 0,
      level: 6,
      xpGiven: 0
    });
    state = addComponent(state, allyId, { type: ComponentType.Position, x: 7, y: 5 });
    state = addComponent(state, allyId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, allyId, {
      type: ComponentType.Fighter,
      maxHp: 30,
      hp: 30,
      attack: 2,
      defense: 12,
      xp: 0,
      level: 5,
      xpGiven: 0
    });
    state = addComponent(state, enemyId, { type: ComponentType.Position, x: 8, y: 5 });
    state = addComponent(state, enemyId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, enemyId, {
      type: ComponentType.Fighter,
      maxHp: 30,
      hp: 30,
      attack: 2,
      defense: 12,
      xp: 0,
      level: 5,
      xpGiven: 100
    });

    const fireball = sysContent.spells['fireball']!;
    const normalPredict = predictSpellAoEVictims(state, casterId, { type: ComponentType.Position, x: 5, y: 5 }, { x: 8, y: 5 }, fireball, 1, false);
    expect(normalPredict.hostileIds).toContain(enemyId);
    expect(normalPredict.allyIds).toContain(allyId);

    const judiciousPredict = predictSpellAoEVictims(
      state,
      casterId,
      { type: ComponentType.Position, x: 5, y: 5 },
      { x: 8, y: 5 },
      fireball,
      1,
      true
    );
    expect(judiciousPredict.hostileIds).toContain(enemyId);
    expect(judiciousPredict.allyIds).toEqual([]);
    expect(judiciousPredict.hitsSelf).toBe(false);

    // AI spellBehavior skips AoE ability that would catch self/ally and selects safe fallback
    const [s4, orcCasterId] = createEntity(state);
    state = addComponent(s4, orcCasterId, { type: ComponentType.Position, x: 9, y: 5 });
    state = addComponent(state, orcCasterId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, orcCasterId, {
      type: ComponentType.Fighter,
      maxHp: 25,
      hp: 25,
      attack: 2,
      defense: 12,
      xp: 0,
      level: 4,
      xpGiven: 100
    });
    const firstEffectId = Object.keys(state.campaign.effects)[0]!;
    const intent = spellBehavior(state, orcCasterId, {
      abilities: [
        { effectId: firstEffectId, abilityName: 'Unsafe Fireball', range: 6, cooldown: 3, aoeRadiusTiles: 3 },
        { effectId: firstEffectId, abilityName: 'Safe Bolt', range: 6, cooldown: 1 }
      ]
    });
    expect(intent).not.toBeNull();
    if (intent?.type === 'UseAbility') {
      expect(intent.abilityName).toBe('Safe Bolt');
    }
  });

  test('4. Reactive Off-Turn Counterspelling toggles cleanly and counters enemy spells via Spellcraft + slot', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sysContent = getDnD35SystemContent(campaign)!;
    let state = makeOpenArena({ ...buildGameState(campaign), engineMode: EngineMode.TurnBased });

    expect(getNextCounterspellReactionTrigger('off')).toBe('on_enemy_spell_cast');
    expect(getNextCounterspellReactionTrigger('on_enemy_spell_cast')).toBe('off');

    const [s1, enemyMageId] = createEntity(state);
    const [s2, defenderWizardId] = createEntity(s1);
    state = s2;

    state = addComponent(state, enemyMageId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, enemyMageId, { type: ComponentType.Faction, factionId: 'monster' });
    state = addComponent(state, enemyMageId, {
      type: ComponentType.Fighter,
      maxHp: 40,
      hp: 40,
      attack: 3,
      defense: 12,
      xp: 0,
      level: 6,
      xpGiven: 200
    });
    state = setDnD35EntityData(state, enemyMageId, {
      ...getDnD35EntityData(state, enemyMageId),
      actionBudget: createRoundActionBudget(30),
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          governingAbility: 'int',
          effectiveCasterLevel: 6,
          maxCastableSpellLevel: 3,
          knownSpellIds: ['fireball'],
          preparedSpellIds: ['fireball'],
          preparedSlots: [
            { slotId: 'wiz_3_0', spellLevel: 3, slotKind: 'standard', preparedSpellId: 'fireball', expended: false }
          ],
          spellsPerDay: { '3': 1 },
          domainIds: []
        }
      }
    });

    state = addComponent(state, defenderWizardId, { type: ComponentType.Position, x: 8, y: 5 });
    state = addComponent(state, defenderWizardId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, defenderWizardId, { type: ComponentType.Identity, name: 'Elara' });
    state = addComponent(state, defenderWizardId, {
      type: ComponentType.Fighter,
      maxHp: 40,
      hp: 40,
      attack: 3,
      defense: 14,
      xp: 0,
      level: 6,
      xpGiven: 0
    });
    state = addComponent(state, defenderWizardId, {
      type: ComponentType.TacticalDoctrine,
      reactionPolicies: {
        counterspell: { enabled: true, trigger: 'on_enemy_spell_cast' }
      }
    } as TacticalDoctrineComponent);
    state = setDnD35EntityData(state, defenderWizardId, {
      ...getDnD35EntityData(state, defenderWizardId),
      skillRanks: { spellcraft: 9 },
      abilityScores: {
        ...getDnD35EntityData(state, defenderWizardId).abilityScores,
        int: { base: 18, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      },
      actionBudget: createRoundActionBudget(30),
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          governingAbility: 'int',
          effectiveCasterLevel: 6,
          maxCastableSpellLevel: 3,
          knownSpellIds: ['dispel_magic'],
          preparedSpellIds: ['dispel_magic'],
          preparedSlots: [
            { slotId: 'def_3_0', spellLevel: 3, slotKind: 'standard', preparedSpellId: 'dispel_magic', expended: false }
          ],
          spellsPerDay: { '3': 1 },
          domainIds: []
        }
      }
    });

    // Direct forced roll verifies Spellcraft DC (15 + 3 = 18) and slot + Immediate Action consumption
    const fireball = sysContent.spells['fireball']!;
    const interruptRes = evaluateReactiveCounterspellInterrupt(
      state,
      enemyMageId,
      { type: ComponentType.Position, x: 5, y: 5 },
      fireball,
      sysContent,
      10
    );
    expect(interruptRes.countered).toBe(true);
    expect(interruptRes.reactorId).toBe(defenderWizardId);

    const defDataAfter = getDnD35EntityData(interruptRes.state, defenderWizardId);
    expect(defDataAfter.spellbooksByClass?.['wizard']?.preparedSlots?.[0]?.expended).toBe(true);
    expect(defDataAfter.actionBudget?.immediateUsedOffTurn).toBe(true);

    // Runtime executeDnD35eSpellCast also aborts before applying fireball damage when defender has >= +17 Spellcraft mod
    let highSkillState = setDnD35EntityData(state, defenderWizardId, {
      ...getDnD35EntityData(state, defenderWizardId),
      skillRanks: { spellcraft: 18 }
    });
    const castRes = executeDnD35eSpellCast(highSkillState, enemyMageId, { x: 8, y: 5 }, {
      classId: 'wizard',
      spellId: 'fireball'
    });
    expect(castRes.success).toBe(true);
    expect((getComponent(castRes.state, defenderWizardId, ComponentType.Fighter) as FighterComponent).hp).toBe(40);
  });

  test('5. Authentic Knowledge Devotion (Complete Champion p. 60) scales insight attack & damage by creature type', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sysContent = getDnD35SystemContent(campaign)!;
    const kdFeat = sysContent.feats['knowledge_devotion']!;
    expect(kdFeat).toBeDefined();
    expect(sysContent.skills['knowledge_religion']?.studiedCreatureTags).toContain('type:undead');

    let state = buildGameState(campaign);
    const [s1, scholarId] = createEntity(state);
    state = s1;
    state = addComponent(state, scholarId, {
      type: ComponentType.Fighter,
      maxHp: 30,
      hp: 30,
      attack: 5,
      defense: 12,
      xp: 0,
      level: 5,
      xpGiven: 0
    });
    state = setDnD35EntityData(state, scholarId, {
      ...getDnD35EntityData(state, scholarId),
      feats: ['knowledge_devotion'],
      skillRanks: { knowledge_religion: 9 },
      abilityScores: {
        ...getDnD35EntityData(state, scholarId).abilityScores,
        int: { base: 16, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      }
    });

    // Prerequisite fails at 4 ranks, succeeds at 5 ranks
    expect(
      evaluatePrerequisiteAST(kdFeat.prerequisites!, {
        abilityScores: { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 },
        totalBab: 1,
        skillRanks: { knowledge_religion: 4 },
        feats: [],
        tags: [],
        casterLevel: 0
      })
    ).toBe(false);
    expect(
      evaluatePrerequisiteAST(kdFeat.prerequisites!, {
        abilityScores: { str: 10, dex: 10, con: 10, int: 14, wis: 10, cha: 10 },
        totalBab: 1,
        skillRanks: { knowledge_religion: 5 },
        feats: [],
        tags: [],
        casterLevel: 0
      })
    ).toBe(true);

    // Baseline check: 10 + 9 ranks + 3 INT = 22 -> Tier 16-25 (+2 insight attack & damage vs type:undead)
    const mods = buildKnowledgeDevotionModifiers(
      ['knowledge_devotion'],
      { knowledge_religion: 9 },
      getDnD35EntityData(state, scholarId).abilityScores,
      sysContent.feats,
      sysContent.skills
    );
    expect(mods.length).toBe(2);
    expect(mods[0]?.value).toBe(2);
    expect(mods[0]?.bonusType).toBe('insight');

    const vsUndeadDag = evaluateDnD35eEntityDAG(state, scholarId, { targetTags: ['type:undead'] })!;
    const vsAnimalDag = evaluateDnD35eEntityDAG(state, scholarId, { targetTags: ['type:animal'] })!;
    expect(vsUndeadDag.dagResult.attackBonus - vsAnimalDag.dagResult.attackBonus).toBe(2);
    expect(vsUndeadDag.dagResult.damageBonus - vsAnimalDag.dagResult.damageBonus).toBe(2);

    // Unified Entity Stat & Skill Breakdown Registry: resolvedSkills, abilityBreakdowns, saveBreakdowns
    expect(vsUndeadDag.resolvedSkills['knowledge_religion']?.totalModifier).toBe(12);
    expect(vsUndeadDag.dagResult.abilityBreakdowns?.int.effectiveScore).toBe(16);
    expect(vsUndeadDag.dagResult.saveBreakdowns?.will).toBeDefined();

    // Horizon 3 temporary INT buff (+8 enhancement -> +4 INT mod) and +2 competence skill bonus
    // pushes checkTotal from 22 to 28 (Tier 26-30 -> +3 insight attack & damage!)
    state = setDnD35EntityData(state, scholarId, {
      ...getDnD35EntityData(state, scholarId),
      statModifiers: [
        {
          targetStat: 'int',
          value: 8,
          bonusType: 'enhancement',
          sourceId: 'item_headband_int',
          sourcePath: 'item:headband_of_intellect/int',
          origin: 'magical'
        },
        {
          targetStat: 'skill:knowledge_religion',
          value: 2,
          bonusType: 'competence',
          sourceId: 'item_tome_religion',
          sourcePath: 'item:tome/skill:knowledge_religion',
          origin: 'mundane'
        }
      ]
    });
    const buffedUndeadDag = evaluateDnD35eEntityDAG(state, scholarId, { targetTags: ['type:undead'] })!;
    const buffedAnimalDag = evaluateDnD35eEntityDAG(state, scholarId, { targetTags: ['type:animal'] })!;
    expect(buffedUndeadDag.resolvedSkills['knowledge_religion']?.totalModifier).toBe(18);
    expect(buffedUndeadDag.dagResult.attackBonus - buffedAnimalDag.dagResult.attackBonus).toBe(3);
    expect(buffedUndeadDag.dagResult.damageBonus - buffedAnimalDag.dagResult.damageBonus).toBe(3);
  });
});
