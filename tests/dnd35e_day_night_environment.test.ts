import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, queryEntities, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { executeEightHourRest } from '../src/rulesets/dnd35e/magic/rest_recovery.ts';
import { executeWaitUntilPhase } from '../src/systems/rest.system.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { onDnD35eActorMovementStep, onDnD35eActorTurnStart } from '../src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts';
import {
  applyConditionWithEscalation,
  summarizeConditionEffects
} from '../src/rulesets/dnd35e/combat/maneuvers_conditions.ts';
import { resolveStrikePreAttackContext } from '../src/rulesets/dnd35e/combat/combat_exchange_phases.ts';
import { EIGHT_HOURS_IN_ROUNDS } from '../src/rulesets/dnd35e/magic/aoe_rest.ts';
import { applySpecialSpellUnit } from '../src/rulesets/dnd35e/magic/spell_cast_units.ts';
import { resolveTileLightReading, evaluateConcealmentAndSenses } from '../src/rulesets/dnd35e/spatial/cover_senses.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { DnD35ConditionId } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35RaceDefinition } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { applyRaceToActorChassis } from '../src/rulesets/dnd35e/races.ts';
import { consumeResourcePool } from '../src/core/ecs/ecs_lifecycle.ts';
import { processUseItemIntent } from '../src/systems/effects.system.ts';
import { runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import { processChangeAreaIntent } from '../src/systems/map.system.ts';
import { buildAreaDirectorContext, triggerActiveAreaRespawnIfDue } from '../src/systems/map/map_wake_respawn.ts';
import {
  computeTurnsUntilPhase,
  readWorldClock,
  resolveAreaEnvironmentProfile
} from '../src/systems/world_clock.system.ts';
import { ComponentType, type FighterComponent, type HungerComponent } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function withAreaEnvironment(
  state: GameState,
  env: 'outdoors' | 'indoors' | 'underground',
  ambientOverride?: 'bright' | 'shadowy' | 'darkness'
): GameState {
  const area = state.campaign.areas[state.currentAreaId]!;
  return {
    ...state,
    campaign: {
      ...state.campaign,
      areas: {
        ...state.campaign.areas,
        [state.currentAreaId]: {
          ...area,
          environmentType: env,
          ...(ambientOverride !== undefined ? { ambientIllumination: ambientOverride } : {})
        }
      }
    }
  };
}

describe('World Clock, Area Environment, Condition Effects, Hunger Scaling & D&D 3.5e Light Mechanics', () => {
  const sharedCryptCampaign = loadCampaignFromDisk('dnd35e-crypt');
  const sysContent = getDnD35SystemContent(sharedCryptCampaign)!;

  test('Phase 0: 21 declarative conditionEffects JSONs match exact mechanics and dazzled penalizes Attack/Spot/Search', () => {
    const condReg = sysContent.conditionEffects;
    expect(Object.keys(condReg).length).toBe(21);

    const expected: Record<
      DnD35ConditionId,
      { atk: number; ac: number; losesDex: boolean; str: number; dex: number; act: boolean }
    > = {
      blinded: { atk: 0, ac: -2, losesDex: true, str: 0, dex: 0, act: true },
      bound: { atk: 0, ac: -4, losesDex: true, str: 0, dex: 0, act: false },
      dazzled: { atk: -1, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      entangled: { atk: -2, ac: 0, losesDex: false, str: 0, dex: 4, act: true },
      fatigued: { atk: 0, ac: 0, losesDex: false, str: 2, dex: 2, act: true },
      exhausted: { atk: 0, ac: 0, losesDex: false, str: 6, dex: 6, act: true },
      shaken: { atk: -2, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      frightened: { atk: -2, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      panicked: { atk: -2, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      sickened: { atk: -2, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      prone: { atk: -4, ac: -4, losesDex: false, str: 0, dex: 0, act: true },
      stunned: { atk: 0, ac: -2, losesDex: true, str: 0, dex: 0, act: false },
      helpless: { atk: 0, ac: -4, losesDex: true, str: 0, dex: 0, act: false },
      paralyzed: { atk: 0, ac: -4, losesDex: true, str: 0, dex: 0, act: false },
      unconscious: { atk: 0, ac: -4, losesDex: true, str: 0, dex: 0, act: false },
      flat_footed: { atk: 0, ac: 0, losesDex: true, str: 0, dex: 0, act: true },
      deafened: { atk: 0, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      grappled: { atk: 0, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      nauseated: { atk: 0, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      staggered: { atk: 0, ac: 0, losesDex: false, str: 0, dex: 0, act: true },
      charging: { atk: 0, ac: -2, losesDex: false, str: 0, dex: 0, act: true }
    };

    for (const [condId, exp] of Object.entries(expected)) {
      const sum = summarizeConditionEffects([condId as DnD35ConditionId], condReg);
      expect({
        condId,
        atk: sum.meleeAttackPenalty,
        ac: sum.acPenalty,
        losesDex: sum.losesDexToAC,
        str: sum.strPenalty,
        dex: sum.dexPenalty,
        act: sum.canTakeActions
      }).toEqual({ condId, ...exp });
    }

    // Fatigue + Exhausted non-stacking abilityPenaltyGroup
    const fatExh = summarizeConditionEffects(['fatigued', 'exhausted'], condReg);
    expect(fatExh.strPenalty).toBe(6);
    expect(fatExh.dexPenalty).toBe(6);

    // Fear escalation chain via declarative escalationGroup
    expect(applyConditionWithEscalation(['shaken'], 'shaken', condReg)).toEqual(['frightened']);
    expect(applyConditionWithEscalation(['frightened'], 'shaken', condReg)).toEqual(['panicked']);
    expect(applyConditionWithEscalation(['fatigued'], 'fatigued', condReg)).toEqual(['exhausted']);

    // Verify dazzled -1 applies to Spot and Search in DAG
    let state = buildGameState(sharedCryptCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const baseEval = evaluateDnD35eEntityDAG(state, playerId)!;
    state = setDnD35EntityData(state, playerId, {
      ...baseEval.dndData,
      conditions: ['dazzled']
    });
    const dazzledEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(dazzledEval.dagResult.attackBonus).toBe(baseEval.dagResult.attackBonus - 1);
    expect(dazzledEval.resolvedSkills['spot']!.totalModifier).toBe(baseEval.resolvedSkills['spot']!.totalModifier - 1);
    expect(dazzledEval.resolvedSkills['search']!.totalModifier).toBe(
      baseEval.resolvedSkills['search']!.totalModifier - 1
    );
  });

  test('World Clock tracks day/hour/phase across midnight wrap and Player Turn Start increments 1 globalTurn', () => {
    let state = buildGameState(sharedCryptCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;

    // Default start = Day 1 08:00 AM (day)
    const c0 = readWorldClock(state);
    expect(c0.day).toBe(1);
    expect(c0.hour).toBe(8);
    expect(c0.phaseId).toBe('day');
    expect(c0.isNaturalSunlight).toBe(true);

    // Turns until Nightfall (20:00 = +12 hours = 7200 turns)
    const turnsToNight = computeTurnsUntilPhase(state, 'night')!;
    expect(turnsToNight).toBe(7200);
    const nightClock = readWorldClock(state, turnsToNight);
    expect(nightClock.day).toBe(1);
    expect(nightClock.hour).toBe(20);
    expect(nightClock.phaseId).toBe('night');
    expect(nightClock.skyIllumination).toBe('shadowy');
    expect(nightClock.isNaturalSunlight).toBe(false);

    // Turns until Dawn from Night (20:00 -> 05:00 Day 2 = 9h = 5400 turns)
    const atNightState = { ...state, globalTurn: turnsToNight };
    const turnsToDawn = computeTurnsUntilPhase(atNightState, 'dawn')!;
    expect(turnsToDawn).toBe(5400);
    const dawnClock = readWorldClock(atNightState, turnsToDawn);
    expect(dawnClock.day).toBe(2);
    expect(dawnClock.hour).toBe(5);
    expect(dawnClock.phaseId).toBe('dawn');

    // Player Turn Start increments globalTurn by 1; NPC Turn Start & intra-turn actions do NOT
    const turnBefore = state.globalTurn;
    state = runActorTurnStart(state, playerId);
    expect(state.globalTurn).toBe(turnBefore + 1);

    const npcId = state.entities.find((id) => id !== playerId && getComponent(state, id, ComponentType.Fighter) !== undefined)!;
    state = runActorTurnStart(state, npcId);
    expect(state.globalTurn).toBe(turnBefore + 1);

    const afterIntent = applyIntentWithCost(state, { type: IntentType.Wait, entityId: playerId });
    expect(afterIntent.state.globalTurn).toBe(turnBefore + 1);
  });

  test('Area Environment Profiles control outdoors day/night, underground darkness, legacy default, and concealment', () => {
    let state = buildGameState(sharedCryptCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const pPos = getComponent(state, playerId, ComponentType.Position)!;
    let banditId;
    [state, banditId] = spawnEntity(state, 'bandit', pPos.x + 1, pPos.y);

    // 1. Omitted environmentType -> legacy indoors/bright
    const noEnvState: GameState = {
      ...state,
      campaign: {
        ...state.campaign,
        areas: {
          ...state.campaign.areas,
          [state.currentAreaId]: {
            ...state.campaign.areas[state.currentAreaId]!,
            environmentType: undefined
          }
        }
      }
    };
    expect(resolveAreaEnvironmentProfile(noEnvState).environmentType).toBe('indoors');
    expect(resolveAreaEnvironmentProfile(noEnvState).illumination).toBe('bright');

    // 2. Outdoors: bright sunlight during day -> shadowy moonlight at night (20% concealment without low-light/darkvision)
    const outdoorDay = withAreaEnvironment(state, 'outdoors');
    expect(resolveAreaEnvironmentProfile(outdoorDay).illumination).toBe('bright');
    expect(resolveAreaEnvironmentProfile(outdoorDay).isNaturalSunlight).toBe(true);
    expect(resolveTileLightReading(outdoorDay, pPos.x, pPos.y).isSunlight).toBe(true);

    // Cross-area Director context uses targetAreaId's environmentType ('underground') even while player is in 'safe_hub' ('outdoors')
    const crossAreaCtx = buildAreaDirectorContext(outdoorDay, 'dungeon_1', false);
    expect(crossAreaCtx.areaMutation?.addedTags).toContain('env:underground');
    expect(crossAreaCtx.areaMutation?.addedTags).not.toContain('env:outdoors');

    const outdoorNight = { ...outdoorDay, globalTurn: 7200 };
    expect(resolveAreaEnvironmentProfile(outdoorNight).illumination).toBe('shadowy');
    expect(resolveAreaEnvironmentProfile(outdoorNight).isNaturalSunlight).toBe(false);
    const nightSensory = evaluateConcealmentAndSenses(
      resolveTileLightReading(outdoorNight, pPos.x + 1, pPos.y).level,
      pPos,
      { x: pPos.x + 1, y: pPos.y },
      { lowLightVision: false, darkvisionRangeFt: 0, blindsenseRangeFt: 0, blindsightRangeFt: 0, tremorsenseRangeFt: 0, scentRangeFt: 0 }
    );
    expect(nightSensory.missChancePercent).toBe(20);

    // 3. Underground: defaults to darkness (50% concealment without darkvision) unless lit
    const undergroundState = withAreaEnvironment(state, 'underground');
    expect(resolveAreaEnvironmentProfile(undergroundState).illumination).toBe('darkness');
    const preAtk = resolveStrikePreAttackContext(
      undergroundState,
      playerId,
      banditId,
      {
        label: 'Sword',
        attackBonus: 5,
        attackSource: 'manufactured_primary',
        weaponDice: '1d8',
        strDamageBonus: 0,
        doctrineDamageBonus: 0,
        flatDamageBonus: 0,
        critThreatMin: 20,
        critMultiplier: 2,
        weaponDamageType: 'slashing',
        bypassTags: []
      },
      0,
      1,
      getDnD35EntityData(undergroundState, playerId),
      getDnD35EntityData(undergroundState, banditId),
      [],
      [],
      evaluateDnD35eEntityDAG(undergroundState, playerId)!,
      evaluateDnD35eEntityDAG(undergroundState, banditId)!
    );
    expect(preAtk.concealmentMissChance).toBe(50);
  });

  test('Drow Light Blindness blinds for 1 round on abrupt exposure, clears to Dazzled on next turn, and resets in darkness', () => {
    let state = buildGameState(sharedCryptCampaign);
    let drowId;
    [state, drowId] = createEntity(state);

    const baseData = getDnD35EntityData(state, drowId);
    const applied = applyRaceToActorChassis(
      baseData,
      sysContent.races['drow']!,
      sysContent.creatureTypes['humanoid']
    );
    state = addComponent(state, drowId, { type: ComponentType.Position, x: 6, y: 6 });
    state = addComponent(state, drowId, {
      type: ComponentType.Fighter,
      hp: 12,
      maxHp: 12,
      attack: 3,
      defense: 12,
      xp: 0,
      level: 1
    });
    state = setDnD35EntityData(state, drowId, {
      ...applied.entityData,
      skillRanks: { spot: 4, search: 4 }
    });

    // 1. Underground darkness: not blinded, not dazzled
    state = withAreaEnvironment(state, 'underground');
    state = onDnD35eActorTurnStart(state, drowId);
    expect(getDnD35EntityData(state, drowId).conditions).not.toContain('blinded');
    const darkDag = evaluateDnD35eEntityDAG(state, drowId)!;
    expect(darkDag.selfTags).toContain('env:underground');
    expect(darkDag.selfTags).not.toContain('condition:dazzled');

    // 2. Step/enter outdoor Day bright sunlight -> blinded 1 round + lightExposure: 'blinded'
    state = withAreaEnvironment(state, 'outdoors');
    state = onDnD35eActorMovementStep(state, drowId, { x: 6, y: 6 }, { x: 7, y: 6 });
    expect(getDnD35EntityData(state, drowId).conditions).toContain('blinded');
    expect(getDnD35EntityData(state, drowId).lightExposure).toBe('blinded');
    const blindedDag = evaluateDnD35eEntityDAG(state, drowId)!;
    expect(blindedDag.dagResult.acBreakdown.touchAC).toBeLessThan(darkDag.dagResult.acBreakdown.touchAC);

    // 3. Next turn start in bright light -> clears blinded to 'acclimated', stays Dazzled (-1 Atk/Spot/Search)
    state = onDnD35eActorTurnStart(state, drowId);
    expect(getDnD35EntityData(state, drowId).conditions).not.toContain('blinded');
    expect(getDnD35EntityData(state, drowId).lightExposure).toBe('acclimated');
    const acclimatedDag = evaluateDnD35eEntityDAG(state, drowId)!;
    expect(acclimatedDag.selfTags).toContain('condition:dazzled');
    expect(acclimatedDag.dagResult.attackBonus).toBe(darkDag.dagResult.attackBonus - 1);
    expect(acclimatedDag.resolvedSkills['spot']!.totalModifier).toBe(darkDag.resolvedSkills['spot']!.totalModifier - 1);
    expect(acclimatedDag.resolvedSkills['search']!.totalModifier).toBe(
      darkDag.resolvedSkills['search']!.totalModifier - 1
    );

    // 4. Retreats into darkness -> resets lightExposure -> future Daylight spell re-blinds!
    state = withAreaEnvironment(state, 'underground');
    state = onDnD35eActorMovementStep(state, drowId, { x: 7, y: 6 }, { x: 6, y: 6 });
    expect(getDnD35EntityData(state, drowId).lightExposure).toBeUndefined();

    const daylightSpell = sysContent.spells['daylight']!;
    const unit = daylightSpell.effectUnits[0]!;
    state = applySpecialSpellUnit({
      state,
      casterId: drowId,
      targetId: drowId,
      targetPos: { x: 6, y: 6 },
      spell: daylightSpell,
      unit,
      saved: false,
      casterLevel: 5,
      castId: 'test_daylight',
      metamagic: { extend: false, empower: false, maximize: false, silent: false, still: false, widen: false, quicken: false, judicious: false, reach: false, heightenLevel: undefined },
      casterAbilityMod: 0,
      totalBab: 1,
      sysContent,
      queueDamage: (s) => s,
      buildDice: (d) => d
    });
    expect(getDnD35EntityData(state, drowId).conditions).toContain('blinded');

    // 5. Casting Darkness over an outdoor sunlight-blinded Drow (outside Daylight spell field) immediately clears light-induced blinded & lightExposure
    let outdoorBlinded = withAreaEnvironment(state, 'outdoors');
    outdoorBlinded = addComponent(outdoorBlinded, drowId, { type: ComponentType.Position, x: 25, y: 25 });
    outdoorBlinded = onDnD35eActorMovementStep(outdoorBlinded, drowId, { x: 24, y: 25 }, { x: 25, y: 25 });
    expect(getDnD35EntityData(outdoorBlinded, drowId).conditions).toContain('blinded');
    const darknessSpell = sysContent.spells['darkness']!;
    outdoorBlinded = applySpecialSpellUnit({
      state: outdoorBlinded,
      casterId: drowId,
      targetId: drowId,
      targetPos: { x: 25, y: 25 },
      spell: darknessSpell,
      unit: darknessSpell.effectUnits[0]!,
      saved: false,
      casterLevel: 3,
      castId: 'test_darkness',
      metamagic: { extend: false, empower: false, maximize: false, silent: false, still: false, widen: false, quicken: false, judicious: false, reach: false, heightenLevel: undefined },
      casterAbilityMod: 0,
      totalBab: 1,
      sysContent,
      queueDamage: (s) => s,
      buildDice: (d) => d
    });
    expect(getDnD35EntityData(outdoorBlinded, drowId).conditions).not.toContain('blinded');
    expect(getDnD35EntityData(outdoorBlinded, drowId).lightExposure).toBeUndefined();
  });

  test('Kobold/Orc Light Sensitivity reacts to sunlight & daylight (not torch light) and Rule 21 modded race works cleanly', () => {
    let state = buildGameState(sharedCryptCampaign);
    const [s2, actorId] = createEntity(state);
    state = addComponent(s2, actorId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, actorId, {
      type: ComponentType.Fighter,
      hp: 10,
      maxHp: 10,
      attack: 1,
      defense: 12,
      xp: 0,
      level: 1
    });

    // Apply Kobold race
    const koboldApplied = applyRaceToActorChassis(getDnD35EntityData(state, actorId), sysContent.races['kobold']!);
    state = setDnD35EntityData(state, actorId, {
      ...koboldApplied.entityData,
      skillRanks: { spot: 4, search: 4 }
    });

    // 1. Underground darkness + Light cantrip (torch light): NO sunlight -> NO dazzled penalty
    state = withAreaEnvironment(state, 'underground');
    const lightSpell = sysContent.spells['light']!;
    const withTorch = applySpecialSpellUnit({
      state,
      casterId: actorId,
      targetId: actorId,
      targetPos: { x: 5, y: 5 },
      spell: lightSpell,
      unit: lightSpell.effectUnits[0]!,
      saved: false,
      casterLevel: 1,
      castId: 'test_light',
      metamagic: { extend: false, empower: false, maximize: false, silent: false, still: false, widen: false, quicken: false, judicious: false, reach: false, heightenLevel: undefined },
      casterAbilityMod: 0,
      totalBab: 1,
      sysContent,
      queueDamage: (s) => s,
      buildDice: (d) => d
    });
    const torchDag = evaluateDnD35eEntityDAG(withTorch, actorId)!;
    expect(torchDag.selfTags).toContain('light:bright');
    expect(torchDag.selfTags).not.toContain('light:sunlight');
    expect(torchDag.selfTags).not.toContain('condition:dazzled');

    // 2. Outdoors daytime sunlight -> -1 Attack, -1 Spot, -1 Search
    const sunState = withAreaEnvironment(state, 'outdoors');
    const sunDag = evaluateDnD35eEntityDAG(sunState, actorId)!;
    expect(sunDag.selfTags).toContain('light:sunlight');
    expect(sunDag.selfTags).toContain('condition:dazzled');
    expect(sunDag.dagResult.attackBonus).toBe(torchDag.dagResult.attackBonus - 1);
    expect(sunDag.resolvedSkills['spot']!.totalModifier).toBe(torchDag.resolvedSkills['spot']!.totalModifier - 1);
    expect(sunDag.resolvedSkills['search']!.totalModifier).toBe(torchDag.resolvedSkills['search']!.totalModifier - 1);

    // 3. Explicit 'dazzled' condition in sunlight -> strictly -1 total, no double-count!
    const bothDazzled = setDnD35EntityData(sunState, actorId, {
      ...sunDag.dndData,
      conditions: ['dazzled']
    });
    const bothDag = evaluateDnD35eEntityDAG(bothDazzled, actorId)!;
    expect(bothDag.dagResult.attackBonus).toBe(torchDag.dagResult.attackBonus - 1);
    expect(bothDag.resolvedSkills['spot']!.totalModifier).toBe(torchDag.resolvedSkills['spot']!.totalModifier - 1);

    // 4. Rule 21 Litmus Test: brand-new modded race JSON (no .ts edits) inherits Light Sensitivity declaratively
    const moddedRace: DnD35RaceDefinition = {
      ...sysContent.races['kobold']!,
      id: 'deep_stalker_mod',
      name: 'Deep Stalker'
    };
    const [s3, modId] = createEntity(sunState);
    state = addComponent(s3, modId, { type: ComponentType.Position, x: 8, y: 8 });
    state = addComponent(state, modId, {
      type: ComponentType.Fighter,
      hp: 10,
      maxHp: 10,
      attack: 1,
      defense: 10,
      xp: 0,
      level: 1
    });
    const modApplied = applyRaceToActorChassis(getDnD35EntityData(state, modId), moddedRace);
    state = setDnD35EntityData(state, modId, { ...modApplied.entityData, skillRanks: { spot: 4 } });
    const modSunDag = evaluateDnD35eEntityDAG(state, modId)!;
    const modUnderDag = evaluateDnD35eEntityDAG(withAreaEnvironment(state, 'underground'), modId)!;
    expect(modSunDag.selfTags).toContain('condition:dazzled');
    expect(modSunDag.dagResult.attackBonus).toBe(modUnderDag.dagResult.attackBonus - 1);
  });

  test('Knowledge (dungeoneering) and Knowledge (nature) grant +2 Survival strictly in underground vs aboveground env', () => {
    let state = buildGameState(sharedCryptCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      skillRanks: {
        survival: 2,
        knowledge_dungeoneering: 5,
        knowledge_nature: 5
      }
    });

    // Indoors / outdoors aboveground -> only Knowledge (nature) +2 applies
    const aboveDag = evaluateDnD35eEntityDAG(withAreaEnvironment(state, 'outdoors'), playerId)!;
    const underDag = evaluateDnD35eEntityDAG(withAreaEnvironment(state, 'underground'), playerId)!;
    // Compare against 0-knowledge baseline
    const noKnowledgeState = setDnD35EntityData(withAreaEnvironment(state, 'outdoors'), playerId, {
      ...getDnD35EntityData(state, playerId),
      skillRanks: { survival: 2 }
    });
    const baseDag = evaluateDnD35eEntityDAG(noKnowledgeState, playerId)!;

    expect(aboveDag.resolvedSkills['survival']!.totalModifier).toBe(baseDag.resolvedSkills['survival']!.totalModifier + 2);
    expect(underDag.resolvedSkills['survival']!.totalModifier).toBe(baseDag.resolvedSkills['survival']!.totalModifier + 2);
  });

  test('Rest & Wait are gated by visible hostiles, heal 1 HP/totalLevel, advance SRD hunger, and wake-respawn saved floors', () => {
    let state = buildGameState(sharedCryptCampaign);
    const playerId = queryEntities(state, [ComponentType.Player])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    // Give player Level 5 single-track chassis with 10/30 HP + Turn Undead spent charge
    const baseDnd = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...baseDnd,
      tracks: [{ ...baseDnd.tracks[0]!, levels: 5 }]
    });
    const baseFighter = getComponent(state, playerId, ComponentType.Fighter)!;
    state = addComponent(state, playerId, { ...baseFighter, hp: 10, maxHp: 30, level: 5 });
    state = addComponent(state, playerId, {
      type: ComponentType.ResourcePool,
      pools: {
        turn_undead: { poolId: 'turn_undead', label: 'Turn Undead', current: 3, max: 5, refreshCycle: 'rest_8h', resetOnRest: true }
      }
    });
    const poolCheck = consumeResourcePool(state, playerId, 'turn_undead', 1);
    expect(poolCheck.allowed).toBe(true);
    state = poolCheck.state;

    // 1. Place visible hostile goblin within FOV -> Rest & Wait must be blocked
    let goblinId;
    [state, goblinId] = spawnEntity(state, 'goblin', playerPos.x + 2, playerPos.y);
    const blockedRest = executeEightHourRest(state, playerId);
    expect(blockedRest.globalTurn).toBe(state.globalTurn);
    expect(blockedRest.messages[blockedRest.messages.length - 1]?.text).toContain('hostile');
    const blockedWait = executeWaitUntilPhase(state, playerId, 'night');
    expect(blockedWait.globalTurn).toBe(state.globalTurn);

    // Move hostile far outside sight/proximity
    state = addComponent(state, goblinId, { type: ComponentType.Position, x: playerPos.x + 40, y: playerPos.y + 40 });
    state = { ...state, cachedFov: new Set<number>() };

    // 2. Execute 8-hour rest -> advances 4800 turns, heals +5 HP (1 HP * 5 levels), refreshes pools, loses SRD hunger
    const initialHunger = (getComponent(state, playerId, ComponentType.Hunger) as HungerComponent).satiation;
    const afterRest = executeEightHourRest(state, playerId);
    expect(afterRest.globalTurn).toBe(state.globalTurn + EIGHT_HOURS_IN_ROUNDS);
    expect(getComponent(afterRest, playerId, ComponentType.ResourcePool)?.pools['turn_undead']?.current).toBe(5);
    const afterRestHunger = (getComponent(afterRest, playerId, ComponentType.Hunger) as HungerComponent).satiation;
    expect(afterRestHunger).toBeCloseTo(initialHunger - 4800 * 0.035, 2);
    const fighterAfterRest = getComponent(afterRest, playerId, ComponentType.Fighter) as FighterComponent;
    expect(fighterAfterRest.hp).toBe(15);

    // 3. Test apple = 1/4 ration (125 vs 500 satiation) via live processUseItemIntent
    let foodState = addComponent(afterRest, playerId, { type: ComponentType.Hunger, satiation: 500 });
    let rationItemId;
    let appleItemId;
    [foodState, rationItemId] = spawnItem(foodState, 'food_ration', playerPos.x, playerPos.y);
    [foodState, appleItemId] = spawnItem(foodState, 'apple', playerPos.x, playerPos.y);
    const inv = getComponent(foodState, playerId, ComponentType.Inventory) ?? { type: ComponentType.Inventory, items: [] };
    foodState = addComponent(foodState, playerId, {
      ...inv,
      items: [rationItemId, appleItemId]
    });
    const afterRation = processUseItemIntent(foodState, playerId, 0).state;
    expect((getComponent(afterRation, playerId, ComponentType.Hunger) as HungerComponent).satiation).toBe(1000);
    const afterApple = processUseItemIntent(afterRation, playerId, 0).state;
    expect((getComponent(afterApple, playerId, ComponentType.Hunger) as HungerComponent).satiation).toBe(1125);
    expect(foodState.campaign.effects['food_ration']!.value).toBe(500);
    expect(foodState.campaign.effects['apple']!.value).toBe(125);

    // 4. Wait until Dawn advances to Dawn cleanly and logs clock
    const waited = executeWaitUntilPhase(afterRest, playerId, 'dawn');
    expect(readWorldClock(waited).phaseId).toBe('dawn');

    // 5. Lazy Respawn triggers on non-safe area after elapsed respawn cycles (both active and wakeSavedAreaFloor)
    const dungeonState: GameState = {
      ...waited,
      currentAreaId: 'dungeon_1',
      lastSpawnTurn: 0
    };
    const respawnCheck = triggerActiveAreaRespawnIfDue(dungeonState);
    expect(respawnCheck.state.lastSpawnTurn).toBe(dungeonState.globalTurn);

    // Also verify returning to a saved floor after time elapsed in safe_hub updates lastSpawnTurn via wakeSavedAreaFloor
    const enteredDungeon = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'dungeon_1'
    }).state;
    const backToHub = processChangeAreaIntent(enteredDungeon, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'safe_hub'
    }).state;
    const restedInHub = executeEightHourRest(backToHub, playerId);
    const reenteredDungeon = processChangeAreaIntent(restedInHub, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'dungeon_1'
    }).state;
    expect(reenteredDungeon.lastSpawnTurn).toBe(restedInHub.globalTurn);
  });
});
