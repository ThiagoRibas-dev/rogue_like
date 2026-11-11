import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent } from '../src/core/ecs.ts';
import { runActorMovementStep, runActorTurnStart } from '../src/systems/lifecycle.system.ts';
import {
  canUseTriggeredReactionThisRound,
  incrementTriggeredReactionUse
} from '../src/systems/stance.system.ts';
import {
  ComponentType,
  type DamageComponent,
  type FieldComponent,
  type TacticalDoctrineComponent
} from '../src/types/components.types.ts';
import { executeCombatStrikeExchange } from '../src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts';
import { resolveStrikePreAttackContext } from '../src/rulesets/dnd35e/combat/combat_exchange_phases.ts';
import { DnD35UIAdapter } from '../src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { buildActorStanceModes } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import {
  evaluateDnD35eEntityDAG,
  type DnD35EntityDAGResult
} from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import type { DnD35ResolvedStrikeProfile } from '../src/rulesets/dnd35e/combat/attack_routine.ts';
import type { DnD35EntityData } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';

describe('Milestone 126 — Unified Console Lifecycle Windows & Composable Combat Exchange Pipeline', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');

  function createMinimalDndData(overrides: Partial<DnD35EntityData> = {}): DnD35EntityData {
    return {
      abilityScores: {
        str: { base: 14, temp: 0, drain: 0 },
        dex: { base: 14, temp: 0, drain: 0 },
        con: { base: 14, temp: 0, drain: 0 },
        int: { base: 10, temp: 0, drain: 0 },
        wis: { base: 10, temp: 0, drain: 0 },
        cha: { base: 10, temp: 0, drain: 0 }
      },
      hp: { current: 30, max: 30, temp: 0 },
      armorClass: { base: 10, armor: 0, shield: 0, dex: 2, natural: 0, deflection: 0, dodge: 0, size: 0, misc: 0 },
      bab: 3,
      size: 'medium',
      feats: [],
      skills: {},
      savingThrows: { fort: 3, ref: 3, will: 1 },
      levelHistory: [],
      damageReduction: [],
      energyResistance: {},
      immunities: [],
      vulnerabilities: [],
      spellResistance: 0,
      turnUndead: { effectiveLevel: 0, usesRemaining: 0, maxUses: 0 },
      equipment: { weapons: [], armor: [], shields: [], rings: [], amulets: [], wondrous: [] },
      spellcasting: { slotsByLevel: {}, preparedSpells: [], knownSpells: [] },
      ...overrides
    };
  }

  function createMinimalEval(ac = 14, overrides: Partial<DnD35EntityDAGResult> = {}): DnD35EntityDAGResult {
    return {
      dndData: createMinimalDndData(),
      selfTags: [],
      totalAttackBonus: 5,
      canAttack: true,
      hasBlindFight: false,
      hasCleave: false,
      hasGreatCleave: false,
      hasWeaponFinesse: false,
      hasCombatReflexes: false,
      aooMax: 1,
      attackRoutine: {
        strikes: [],
        totalIterativeAttacks: 1,
        hasOffHandAttacks: false,
        isFlurryActive: false
      },
      dagResult: {
        acBreakdown: {
          fullAC: ac,
          touchAC: 12,
          flatFootedAC: 12,
          modifiersByType: {}
        },
        flankingBonus: 2,
        attackModifiers: [],
        damageModifiers: [],
        acModifiers: [],
        saveModifiers: [],
        skillModifiers: [],
        abilityModifiers: []
      },
      ...overrides
    };
  }

  test('1. TurnStart Reaction Quota Reset: resets per-round reactions symmetrically on actor turn start', () => {
    let state = buildGameState(campaign);
    const [state1, defenderId] = createEntity(state);
    state = state1;

    let doctrine: TacticalDoctrineComponent = {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0,
      triggeredReactionUses: {}
    };

    // Before hit: reaction available
    expect(canUseTriggeredReactionThisRound(doctrine, 'retaliation:melee', 1)).toBe(true);

    // Consume 1 use
    doctrine = incrementTriggeredReactionUse(doctrine, 'retaliation:melee');
    expect(canUseTriggeredReactionThisRound(doctrine, 'retaliation:melee', 1)).toBe(false);

    // Add component to defender entity
    state = addComponent(state, defenderId, doctrine);

    // Run Tier 1 Console TurnStart lifecycle window for defender
    state = runActorTurnStart(state, defenderId);

    // Tactical doctrine reaction quota is reset for the new round
    const updatedDoctrine = getComponent(state, defenderId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent;
    expect(updatedDoctrine).toBeDefined();
    expect(canUseTriggeredReactionThisRound(updatedDoctrine, 'retaliation:melee', 1)).toBe(true);
  });

  test('2. Per-Step Mobile Emanation Sync: anchored aura updates position and triggers auto entry save', () => {
    let state = buildGameState(campaign);
    const [state1, casterId] = createEntity(state);
    const [state2, enemyId] = createEntity(state1);
    const [state3, fieldId] = createEntity(state2);
    state = state3;

    // Caster at (10, 10)
    state = addComponent(state, casterId, { type: ComponentType.Position, x: 10, y: 10 });
    state = addComponent(state, casterId, { type: ComponentType.Identity, name: 'Cleric' });

    // Enemy at (11, 11)
    state = addComponent(state, enemyId, { type: ComponentType.Position, x: 11, y: 11 });
    state = addComponent(state, enemyId, { type: ComponentType.Identity, name: 'Evil Cultist' });
    state = addComponent(state, enemyId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });
    const enemyData = createMinimalDndData({
      savingThrows: { fort: 2, ref: 2, will: 0 }
    });
    state = setDnD35EntityData(state, enemyId, enemyData);

    // Mobile emanation field anchored to Caster with 15ft radius (3 tiles)
    const fieldComp: FieldComponent = {
      type: ComponentType.Field,
      fieldType: 'blade_tempest_invocation',
      intensity: 1,
      duration: 10,
      anchorEntityId: casterId,
      radiusFt: 15,
      spellId: 'blade_tempest_invocation',
      casterLevel: 9,
      auraSaveMemory: {}
    };
    state = addComponent(state, fieldId, { type: ComponentType.Position, x: 10, y: 10 });
    state = addComponent(state, fieldId, fieldComp);

    // Step 5 ft: move caster from (10, 10) to (11, 10)
    state = addComponent(state, casterId, { type: ComponentType.Position, x: 11, y: 10 });
    const stateAfterStep = runActorMovementStep(state, casterId, { x: 10, y: 10 }, { x: 11, y: 10 });

    // Anchored field origin automatically followed caster to (11, 10)
    const updatedPos = getComponent(stateAfterStep, fieldId, ComponentType.Position) as PositionComponent;
    expect(updatedPos.x).toBe(11);
    expect(updatedPos.y).toBe(10);

    // Stationary enemy at (11, 11) engulfed by moving anchored aura automatically rolled first-entry save
    const updatedField = getComponent(stateAfterStep, fieldId, ComponentType.Field) as FieldComponent;
    expect(updatedField.auraSaveMemory?.[String(enemyId)]).toBeDefined();
  });

  test('3. Phase 1 PreAttackPhase: calculates spatial flanking and sensory concealment', () => {
    let state = buildGameState(campaign);
    const [state1, attackerId] = createEntity(state);
    const [state2, defenderId] = createEntity(state1);
    const [state3, allyId] = createEntity(state2);
    state = state3;

    // Attacker at (5, 5), Defender at (6, 5), Ally at (7, 5) -> Exact opposite flank
    state = addComponent(state, attackerId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, defenderId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, defenderId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });
    state = addComponent(state, allyId, { type: ComponentType.Position, x: 7, y: 5 });
    state = addComponent(state, allyId, { type: ComponentType.Fighter, hp: 20, maxHp: 20 });

    const attackerData = createMinimalDndData();
    const defenderData = createMinimalDndData();
    const attackerEval = createMinimalEval(14, {
      dagResult: {
        acBreakdown: { fullAC: 14, touchAC: 10, flatFootedAC: 12, modifiersByType: {} },
        flankingBonus: 4, // Coordinated Host or Outflank gives +4
        attackModifiers: [],
        damageModifiers: [],
        acModifiers: [],
        saveModifiers: [],
        skillModifiers: [],
        abilityModifiers: []
      }
    });
    const defenderEval = createMinimalEval(14);

    const strike: DnD35ResolvedStrikeProfile = {
      index: 0,
      attackBonus: 5,
      critThreatMin: 20,
      critMultiplier: 2,
      strDamageBonus: 2,
      doctrineDamageBonus: 0,
      flatDamageBonus: 0,
      weaponDice: '1d8',
      weaponDamageType: 'slashing',
      attackSource: 'manufactured_primary',
      handedness: 'one_handed',
      isNaturalOrUnarmed: false,
      bypassTags: ['slashing'],
      label: 'Longsword'
    };

    const preContext = resolveStrikePreAttackContext(
      state,
      attackerId,
      defenderId,
      strike,
      0,
      1,
      attackerData,
      defenderData,
      ['alignment:good'],
      ['alignment:evil'],
      attackerEval,
      defenderEval
    );

    // Flanking bonus (+4) added to base attack bonus (5) = 9
    expect(preContext.effectiveAttackBonus).toBe(9);
    expect(preContext.strikeLabel).toContain('Flanking +4');
  });

  test('4. Phase 5 OnDropFollowupPhase: executes Cleave bonus strike against adjacent foe using secondary target AC', () => {
    let state = buildGameState(campaign);
    const [state1, attackerId] = createEntity(state);
    const [state2, goblinAId] = createEntity(state1);
    const [state3, goblinBId] = createEntity(state2);
    state = state3;

    // Attacker at (5, 5), Goblin A at (6, 5), Goblin B at (5, 6)
    state = addComponent(state, attackerId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, attackerId, { type: ComponentType.Player });
    state = addComponent(state, attackerId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });

    state = addComponent(state, goblinAId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, goblinAId, { type: ComponentType.Fighter, hp: 4, maxHp: 10 });
    state = addComponent(state, goblinAId, { type: ComponentType.Identity, name: 'Goblin Scout A' });
    state = addComponent(state, goblinAId, { type: ComponentType.Attitude, attitude: 'hostile' });

    state = addComponent(state, goblinBId, { type: ComponentType.Position, x: 5, y: 6 });
    state = addComponent(state, goblinBId, { type: ComponentType.Fighter, hp: 12, maxHp: 12, attack: 2, defense: 0, xp: 10 });
    state = addComponent(state, goblinBId, { type: ComponentType.Identity, name: 'Goblin Scout B' });
    state = addComponent(state, goblinBId, { type: ComponentType.Attitude, attitude: 'hostile' });
    // Give Goblin B +4 natural armor so its fullAC is 14 instead of Goblin A's AC 10
    const baseGoblinB = getDnD35EntityData(state, goblinBId);
    state = setDnD35EntityData(state, goblinBId, {
      ...baseGoblinB,
      naturalArmorBonus: 4
    });

    const attackerData = createMinimalDndData();
    const defenderData = createMinimalDndData();
    const attackerEval = createMinimalEval(10, { hasCleave: true });
    const defenderEval = createMinimalEval(10);

    const strike: DnD35ResolvedStrikeProfile = {
      index: 0,
      attackBonus: 20, // guaranteed hit
      critThreatMin: 20,
      critMultiplier: 2,
      strDamageBonus: 10,
      doctrineDamageBonus: 0,
      flatDamageBonus: 0,
      weaponDice: '1d8',
      weaponDamageType: 'slashing',
      attackSource: 'manufactured_primary',
      handedness: 'one_handed',
      isNaturalOrUnarmed: false,
      bypassTags: ['slashing'],
      label: 'Greatsword'
    };

    const result = executeCombatStrikeExchange({
      state,
      attackerId,
      defenderId: goblinAId,
      strike,
      strikeIndex: 0,
      totalStrikes: 1,
      attackerData,
      defenderData,
      attackerSelfTags: ['player'],
      defenderSelfTags: ['monster', 'evil'],
      attackerEval,
      defenderEval,
      defenderHpRemaining: 4, // will drop to <= 0
      cleavesUsedThisTurn: 0,
      forcedAttackRoll: 15
    });

    expect(result.foeDropped).toBe(true);
    expect(result.cleavesUsedThisTurn).toBe(1);

    const expectedGoblinBAC = evaluateDnD35eEntityDAG(state, goblinBId)!.dagResult.acBreakdown.fullAC;
    expect(expectedGoblinBAC).toBeGreaterThan(10);

    // Goblin B was adjacent and received damage from the Cleave strike evaluated against Goblin B's own AC!
    const goblinBDamage = getComponent(result.state, goblinBId, ComponentType.Damage) as DamageComponent | undefined;
    expect(goblinBDamage).toBeDefined();
    expect(result.state.messages.some((m) => m.text.includes(`vs AC ${expectedGoblinBAC}`))).toBe(true);
  });

  test('5. HUD Stance Dock: projects active spell aura stance options dynamically into hotbar stance dock', () => {
    let state = buildGameState(campaign);
    const [state1, casterId] = createEntity(state);
    state = state1;

    state = addComponent(state, casterId, { type: ComponentType.Player });
    state = addComponent(state, casterId, { type: ComponentType.Fighter, hp: 30, maxHp: 30 });
    const dndData = createMinimalDndData();
    state = setDnD35EntityData(state, casterId, dndData);

    const auraStanceOptions = [
      {
        groupId: 'battle_cadence',
        stanceId: 'spectral_assault',
        label: 'Spectral Assault',
        tooltipText: 'Spectral blades strike nearby foes',
        isDefaultInGroup: true
      },
      {
        groupId: 'battle_cadence',
        stanceId: 'flurry_of_steel',
        label: 'Flurry of Steel',
        tooltipText: '+1 iterative attack at full BAB'
      },
      {
        groupId: 'battle_cadence',
        stanceId: 'divine_celerity',
        label: 'Divine Celerity',
        tooltipText: '+10ft movement and +2 Dodge AC'
      }
    ];

    const modes = buildActorStanceModes(
      dndData,
      5,
      undefined,
      undefined,
      undefined,
      auraStanceOptions
    );

    // All 3 cadence stances are projected into stance modes
    expect(modes.some((m) => m.id === 'spectral_assault')).toBe(true);
    expect(modes.some((m) => m.id === 'flurry_of_steel')).toBe(true);
    expect(modes.some((m) => m.id === 'divine_celerity')).toBe(true);

    // Spectral Assault is active by default
    const spectralMode = modes.find((m) => m.id === 'spectral_assault')!;
    expect(spectralMode.isActive).toBe(true);
    expect(spectralMode.groupId).toBe('battle_cadence');

    // UI Adapter projects them into getHotbarData
    const uiAdapter = new DnD35UIAdapter();
    const hotbarData = uiAdapter.getHotbarData(state, casterId, dndData);
    expect(hotbarData.stanceModes.length).toBeGreaterThan(0);
  });
});
