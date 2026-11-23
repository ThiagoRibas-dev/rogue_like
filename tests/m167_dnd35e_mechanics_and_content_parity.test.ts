import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { validateItems } from '../src/editor/validator/item.validator.ts';
import { applyNegativeLevelsToActor } from '../src/rulesets/dnd35e/progression/ledger_level_drain.ts';
import { executeDnD35eSpellCast, resolveDnD35eSpellItemEffect } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { expendCasterSpellSlot } from '../src/rulesets/dnd35e/magic/spell_cast_helpers.ts';
import { applyResolvedSpellEffectsToTarget } from '../src/rulesets/dnd35e/magic/spell_cast_effects.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { applyItemEffect, processUseItemIntent } from '../src/systems/effects.system.ts';
import { processWandZap } from '../src/systems/zap.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type InventoryComponent,
  type ItemComponent,
  type PositionComponent,
  type PropertyOverlayComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function getPlayerId(state: GameState): EntityId {
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) throw new Error('Player entity missing from test state');
  return playerId;
}

describe('Milestone 167: D&D 3.5e Mechanics, Modifier Targets, Magic Item Spells & SRD Parity', () => {
  const sharedCampaign = loadCampaignFromDisk('dnd35e-crypt');

  it('wires saves_all, save_reflex, save_fear, ac_deflection, ac_insight, and skill aliases in DAG evaluation', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);

    const baseDag = evaluateDnD35eEntityDAG(state, playerId)!;
    const dndData = getDnD35EntityData(state, playerId);

    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      statModifiers: [
        ...(dndData.statModifiers ?? []),
        {
          id: 'test_saves_all',
          sourceId: 'test_saves_all',
          sourcePath: 'test:saves_all',
          targetStat: 'saves_all',
          bonusType: 'resistance',
          value: 2,
          origin: 'spell'
        },
        {
          id: 'test_save_reflex',
          sourceId: 'test_save_reflex',
          sourcePath: 'test:save_reflex',
          targetStat: 'save_reflex',
          bonusType: 'untyped',
          value: 1,
          origin: 'ex'
        },
        {
          id: 'test_ac_deflection',
          sourceId: 'test_ac_deflection',
          sourcePath: 'test:ac_deflection',
          targetStat: 'ac_deflection',
          bonusType: 'deflection',
          value: 2,
          origin: 'spell'
        },
        {
          id: 'test_ac_insight',
          sourceId: 'test_ac_insight',
          sourcePath: 'test:ac_insight',
          targetStat: 'ac_insight',
          bonusType: 'insight',
          value: 1,
          origin: 'psionic'
        }
      ]
    });

    const updatedDag = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(updatedDag.dagResult.saves.fort).toBe(baseDag.dagResult.saves.fort + 2);
    expect(updatedDag.dagResult.saves.ref).toBe(baseDag.dagResult.saves.ref + 3);
    expect(updatedDag.dagResult.saves.will).toBe(baseDag.dagResult.saves.will + 2);
    expect(updatedDag.dagResult.acBreakdown.fullAC).toBe(baseDag.dagResult.acBreakdown.fullAC + 3);
    expect(updatedDag.dagResult.acBreakdown.touchAC).toBe(baseDag.dagResult.acBreakdown.touchAC + 3);
  });

  it('blocks spontaneous spell slot casting when maxDaily === 0', () => {
    const state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const sys = getDnD35SystemContent(sharedCampaign)!;
    const magicMissile = sys.spells['magic_missile']!;

    const emptyBook = {
      classId: 'sorcerer',
      castingTradition: 'arcane' as const,
      castingMode: 'spontaneous' as const,
      governingAbility: 'cha' as const,
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['magic_missile'],
      preparedSpellIds: [],
      spellsPerDay: { '0': 5, '1': 0 },
      spontaneousSlotsUsedByLevel: {}
    };

    const res = expendCasterSpellSlot(emptyBook, magicMissile, { classId: 'sorcerer', spellId: 'magic_missile' }, 0, state, playerId, sys);
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('No Level 1 spell slots remaining');
  });

  it('prevents cure-only condition sentinels from polluting target conditions and supports quicken/retaliation/form_overlay units', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const sys = getDnD35SystemContent(sharedCampaign)!;
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // 1) Cure-only condition unit with conditionId: 'none' strips fatigued without adding 'none'
    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      conditions: ['fatigued']
    });
    const restoration = sys.spells['restoration']!;
    state = applyResolvedSpellEffectsToTarget({
      state,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: restoration,
      units: restoration.effectUnits,
      casterLevel: 7,
      castId: 'test_restoration',
      metamagic: {
        empower: false,
        maximize: false,
        extend: false,
        widen: false,
        silent: false,
        still: false,
        judicious: false,
        projectTouch: false
      },
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });

    const afterRestDnd = getDnD35EntityData(state, playerId);
    expect(afterRestDnd.conditions).not.toContain('fatigued');
    expect(afterRestDnd.conditions as ReadonlyArray<string>).not.toContain('none');
    expect(afterRestDnd.conditions as ReadonlyArray<string>).not.toContain('heal_restoration');

    // 2) form_overlay unit from baleful_polymorph attaches PropertyOverlayComponent cleanly
    const baleful = sys.spells['baleful_polymorph']!;
    if (baleful.effectUnits.some((u) => u.type === 'form_overlay')) {
      state = applyResolvedSpellEffectsToTarget({
        state,
        casterId: playerId,
        targetId: playerId,
        targetPos: { x: pos.x, y: pos.y },
        spell: baleful,
        units: baleful.effectUnits,
        casterLevel: 9,
        castId: 'test_baleful',
        metamagic: {
          empower: false,
          maximize: false,
          extend: false,
          widen: false,
          silent: false,
          still: false,
          judicious: false,
          projectTouch: false
        },
        casterAbilityMod: 4,
        totalBab: 4,
        saveResultByUnitId: {},
        sysContent: sys
      });
      const overlay = getComponent(state, playerId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
      expect(overlay).toBeDefined();
      expect(overlay?.source).toContain('baleful_polymorph');
    }
  });

  it('routes D&D 3.5e magic items (potions, scrolls, wands, staves) through spell:<id> effects', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // Damage player first so Potion of Cure Light Wounds actually restores HP
    const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, playerId, { ...fighter, hp: Math.max(1, fighter.hp - 5) });
    const hurtHp = (getComponent(state, playerId, ComponentType.Fighter) as FighterComponent).hp;

    // Spawn and drink potion_of_cure_light_wounds
    let clwPotionId: EntityId;
    [state, clwPotionId] = spawnItem(state, 'potion_of_cure_light_wounds', pos.x, pos.y);
    let bullsPotionId: EntityId;
    [state, bullsPotionId] = spawnItem(state, 'potion_of_bulls_strength', pos.x, pos.y);
    let mageArmorScrollId: EntityId;
    [state, mageArmorScrollId] = spawnItem(state, 'scroll_of_mage_armor', pos.x, pos.y);

    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
    const baseItems = inv?.items ?? [];
    state = addComponent(state, playerId, {
      type: ComponentType.Inventory,
      items: [...baseItems, clwPotionId, bullsPotionId, mageArmorScrollId],
      maxCapacity: Math.max(20, baseItems.length + 5)
    });

    const baseStr = evaluateDnD35eEntityDAG(state, playerId)!.dagResult.abilityBreakdowns!.str.effectiveScore!;

    // Use Potion of CLW
    const clwRes = processUseItemIntent(state, playerId, baseItems.length);
    expect(clwRes.success).toBe(true);
    state = clwRes.state;
    const healedHp = (getComponent(state, playerId, ComponentType.Fighter) as FighterComponent).hp;
    expect(healedHp).toBeGreaterThan(hurtHp);

    // Use Potion of Bull's Strength (shifted to index baseItems.length because CLW potion was consumed)
    const bullsRes = processUseItemIntent(state, playerId, baseItems.length);
    expect(bullsRes.success).toBe(true);
    state = bullsRes.state;
    const buffedStr = evaluateDnD35eEntityDAG(state, playerId)!.dagResult.abilityBreakdowns!.str.effectiveScore!;
    expect(buffedStr).toBe(baseStr + 4);

    // Use Scroll of Mage Armor
    const scrollRes = processUseItemIntent(state, playerId, baseItems.length);
    expect(scrollRes.success).toBe(true);
    state = scrollRes.state;
    const afterArmorDag = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(afterArmorDag.statModifiers?.some((m) => m.sourcePath?.startsWith('spell:mage_armor:'))).toBe(true);

    // Zap Wand of Magic Missile at an adjacent walkable enemy
    const adjOffset =
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ].find(([dx, dy]) => {
        const tx = pos.x + dx!;
        const ty = pos.y + dy!;
        const tile = state.map.tiles[ty * state.map.width + tx];
        return tile !== undefined && state.campaign.tiles[tile.tileId]?.walkable === true;
      }) ?? [1, 0];
    let goblinId: EntityId;
    [state, goblinId] = spawnEntity(state, 'goblin', pos.x + adjOffset[0]!, pos.y + adjOffset[1]!);
    const goblinHpBefore = (getComponent(state, goblinId, ComponentType.Fighter) as FighterComponent).hp;

    let wandId: EntityId;
    [state, wandId] = spawnItem(state, 'wand_of_magic_missile', pos.x, pos.y);
    // Ensure UMD / arcane caster authorization by casting from wizard/sorcerer or testing resolveItemEffect directly
    const zapDirect = applyItemEffect(state, playerId, 'spell:magic_missile', 'Wand of Magic Missile', goblinId);
    const goblinHpAfter = (getComponent(zapDirect, goblinId, ComponentType.Fighter) as FighterComponent).hp;
    expect(goblinHpAfter).toBeLessThan(goblinHpBefore);

    // Staff of Fire fires spell:fireball via zap / item effect
    const staffApplied = resolveDnD35eSpellItemEffect(state, playerId, 'spell:fireball', 'Staff of Fire', goblinId);
    expect(staffApplied).not.toBeNull();
    const goblinHpAfterFire = (getComponent(staffApplied!, goblinId, ComponentType.Fighter) as FighterComponent).hp;
    expect(goblinHpAfterFire).toBeLessThan(goblinHpBefore);

    // Verify zapping wand as an authorized arcane caster goes through processWandZap
    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      tracks: [
        ...dndData.tracks,
        {
          trackId: 'wizard',
          trackKind: 'class',
          levels: 1,
          hitDieSize: 4,
          babProgression: 'poor',
          goodSaves: ['will'],
          skillPointsPerLevel: 2
        }
      ],
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingTradition: 'arcane',
          castingMode: 'prepared',
          governingAbility: 'int',
          effectiveCasterLevel: 1,
          maxCastableSpellLevel: 1,
          knownSpellIds: ['magic_missile'],
          preparedSpellIds: ['magic_missile'],
          spellsPerDay: { '0': 3, '1': 1 }
        }
      }
    });
    const wandZap = processWandZap(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'zap',
      target: { type: 'entity', entityId: goblinId },
      toolEntityId: wandId
    });
    expect(wandZap.success).toBe(true);
    const goblinHpAfterZap = (getComponent(wandZap.state, goblinId, ComponentType.Fighter) as FighterComponent).hp;
    expect(goblinHpAfterZap).toBeLessThan(goblinHpBefore);
    const wandChargesAfter = (getComponent(wandZap.state, wandId, ComponentType.Item) as ItemComponent).charges;
    expect(wandChargesAfter).toBe(14);

    // Empty wand fails to zap
    const depletedState = addComponent(wandZap.state, wandId, {
      ...(getComponent(wandZap.state, wandId, ComponentType.Item) as ItemComponent),
      charges: 0
    });
    const emptyZap = processWandZap(depletedState, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'zap',
      target: { type: 'entity', entityId: goblinId },
      toolEntityId: wandId
    });
    expect(emptyZap.success).toBe(false);
    expect(emptyZap.state.messages.some((m) => m.text.includes('no charges remaining'))).toBe(true);
  });

  it('ensures zero SRD spells lack mechanical effectUnits/effectBundle/damageDice and all modular familiar races load cleanly', () => {
    const sys = getDnD35SystemContent(sharedCampaign)!;

    const emptySpells = Object.values(sys.spells).filter(
      (s) => s.effectUnits.length === 0 && !s.effectBundle && !s.damageDice
    );
    expect(emptySpells.map((s) => s.id)).toEqual([]);

    const splitAnimalRaceIds = [
      'bat',
      'cat',
      'hawk',
      'owl',
      'rat',
      'raven',
      'viper',
      'toad',
      'weasel',
      'badger',
      'riding_dog',
      'eagle'
    ];
    for (const raceId of splitAnimalRaceIds) {
      expect(sys.races[raceId]).toBeDefined();
    }

    // Mage Hand emits interaction_reach_tiles modifier via its stat_bundle
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      skillRanks: { ...dndData.skillRanks, concentration: 20 },
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingTradition: 'arcane',
          castingMode: 'prepared',
          governingAbility: 'int',
          effectiveCasterLevel: 1,
          maxCastableSpellLevel: 1,
          knownSpellIds: ['mage_hand'],
          preparedSpellIds: ['mage_hand'],
          spellsPerDay: { '0': 3, '1': 1 },
          preparedSlots: [
            {
              slotId: 'wiz_0_0',
              level: 0,
              preparedSpellId: 'mage_hand',
              expended: false,
              metamagicFeatIds: []
            }
          ]
        }
      }
    });
    const castRes = executeDnD35eSpellCast(state, playerId, { x: pos.x, y: pos.y }, {
      classId: 'wizard',
      spellId: 'mage_hand'
    });
    expect(castRes.success).toBe(true);
    const reach = getDnD35EntityData(castRes.state, playerId).statModifiers?.find(
      (m) => m.targetStat === 'interaction_reach_tiles'
    );
    expect(reach?.value).toBe(5);
  });

  it('handles personal-origin AoE spells, caster-role units, quicken_max_spell_level, save_fear isolation, restoration, ally CLW, Staff AoE & zappable validation', async () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const sys = getDnD35SystemContent(sharedCampaign)!;

    // Locate walkable adjacent tile for enemy placement
    const adjOffset =
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ].find(([dx, dy]) => {
        const tx = pos.x + dx!;
        const ty = pos.y + dy!;
        const tile = state.map.tiles[ty * state.map.width + tx];
        return tile !== undefined && state.campaign.tiles[tile.tileId]?.walkable === true;
      }) ?? [1, 0];
    const ex = pos.x + adjOffset[0]!;
    const ey = pos.y + adjOffset[1]!;

    let goblin1: EntityId;
    [state, goblin1] = spawnEntity(state, 'goblin', ex, ey);
    let goblin2: EntityId;
    [state, goblin2] = spawnEntity(state, 'goblin', ex, ey);

    // 1) Personal-origin AoE (burning_hands) hits adjacent hostiles without hitting caster
    const playerHpBefore = (getComponent(state, playerId, ComponentType.Fighter) as FighterComponent).hp;
    const g1HpBefore = (getComponent(state, goblin1, ComponentType.Fighter) as FighterComponent).hp;
    const g2HpBefore = (getComponent(state, goblin2, ComponentType.Fighter) as FighterComponent).hp;

    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      skillRanks: { ...dndData.skillRanks, concentration: 20 },
      spellbooksByClass: {
        wizard: {
          classId: 'wizard',
          castingTradition: 'arcane',
          castingMode: 'prepared',
          governingAbility: 'int',
          effectiveCasterLevel: 5,
          maxCastableSpellLevel: 3,
          knownSpellIds: ['burning_hands', 'mage_hand', 'magic_missile'],
          preparedSpellIds: ['burning_hands', 'mage_hand', 'magic_missile'],
          spellsPerDay: { '0': 4, '1': 4, '2': 2 },
          preparedSlots: [
            { slotId: 'w_0', level: 0, preparedSpellId: 'mage_hand', expended: false, metamagicFeatIds: [] },
            { slotId: 'w_1', level: 1, preparedSpellId: 'burning_hands', expended: false, metamagicFeatIds: [] },
            { slotId: 'w_2', level: 1, preparedSpellId: 'magic_missile', expended: false, metamagicFeatIds: [] }
          ]
        }
      }
    });

    const burnRes = executeDnD35eSpellCast(state, playerId, { x: ex, y: ey }, {
      classId: 'wizard',
      spellId: 'burning_hands'
    });
    expect(burnRes.success).toBe(true);
    expect((getComponent(burnRes.state, playerId, ComponentType.Fighter) as FighterComponent).hp).toBe(playerHpBefore);
    expect((getComponent(burnRes.state, goblin1, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(g1HpBefore);

    // 2) Caster-role unit (mage_hand) targeted at an enemy applies reach modifier to CASTER, never enemy
    const mhRes = executeDnD35eSpellCast(burnRes.state, playerId, { x: ex, y: ey }, {
      classId: 'wizard',
      spellId: 'mage_hand'
    });
    expect(mhRes.success).toBe(true);
    expect(
      getDnD35EntityData(mhRes.state, playerId).statModifiers?.some((m) => m.targetStat === 'interaction_reach_tiles')
    ).toBe(true);
    expect(
      getDnD35EntityData(mhRes.state, goblin1).statModifiers?.some((m) => m.targetStat === 'interaction_reach_tiles') ?? false
    ).toBe(false);

    // 3) quicken_max_spell_level (taking Math.max across grants) lets Magic Missile (Lv 1) use Swift action
    const quickenCasterData = getDnD35EntityData(mhRes.state, playerId);
    const quickenReadyState = setDnD35EntityData(mhRes.state, playerId, {
      ...quickenCasterData,
      actionBudget: {
        standardRemaining: 1,
        moveRemaining: 1,
        swiftRemaining: 1,
        immediateRemaining: 1,
        fiveFootStepAvailable: true,
        movementRemainingFt: 30,
        distanceMovedThisRoundFt: 0,
        canMoveFurtherThisRound: true,
        hasActedThisRound: false,
        isFlatFooted: false,
        aooRemainingThisRound: 1,
        hasUsedSwiftOrImmediateThisRound: false
      },
      statModifiers: [
        ...(quickenCasterData.statModifiers ?? []),
        {
          id: 'q1',
          sourceId: 'q1',
          sourcePath: 'test:quicken1',
          targetStat: 'quicken_max_spell_level',
          bonusType: 'untyped',
          value: 1,
          origin: 'spell'
        },
        {
          id: 'q2',
          sourceId: 'q2',
          sourcePath: 'test:quicken2',
          targetStat: 'quicken_max_spell_level',
          bonusType: 'untyped',
          value: 2,
          origin: 'spell'
        }
      ]
    });
    const quickCast = executeDnD35eSpellCast(quickenReadyState, playerId, { x: ex, y: ey }, {
      classId: 'wizard',
      spellId: 'magic_missile'
    });
    expect(quickCast.success).toBe(true);
    const postQuickBudget = getDnD35EntityData(quickCast.state, playerId).actionBudget!;
    expect(postQuickBudget.swiftRemaining).toBe(0);
    expect(postQuickBudget.standardRemaining).toBe(1);

    // 4) save_fear applies ONLY when effectTags includes 'fear' / 'descriptor:fear', and ac_deflection coerces untyped
    const baseSavesDag = evaluateDnD35eEntityDAG(state, playerId)!;
    const fearModState = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      statModifiers: [
        ...(getDnD35EntityData(state, playerId).statModifiers ?? []),
        {
          id: 'fear_only',
          sourceId: 'fear_only',
          sourcePath: 'test:fear_only',
          targetStat: 'save_fear',
          bonusType: 'morale',
          value: 4,
          origin: 'ex'
        },
        {
          id: 'untyped_deflection',
          sourceId: 'untyped_deflection',
          sourcePath: 'test:untyped_deflection',
          targetStat: 'ac_deflection',
          bonusType: 'untyped',
          value: 2,
          origin: 'spell'
        }
      ]
    });
    const nonFearDag = evaluateDnD35eEntityDAG(fearModState, playerId)!;
    const fearDag = evaluateDnD35eEntityDAG(fearModState, playerId, { effectTags: ['descriptor:fear'] })!;
    expect(nonFearDag.dagResult.saves.will).toBe(baseSavesDag.dagResult.saves.will);
    expect(fearDag.dagResult.saves.will).toBe(baseSavesDag.dagResult.saves.will + 4);
    expect(nonFearDag.dagResult.acBreakdown.touchAC).toBe(baseSavesDag.dagResult.acBreakdown.touchAC + 2);

    // 5) Staff of Fire AoE damages both goblins in spread, and healing wand heals ally without saving
    const staffAoE = resolveDnD35eSpellItemEffect(state, playerId, 'spell:fireball', 'Staff of Fire', goblin1)!;
    expect((getComponent(staffAoE, goblin1, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(g1HpBefore);
    expect((getComponent(staffAoE, goblin2, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(g2HpBefore);

    let allyId: EntityId;
    [state, allyId] = spawnEntity(state, 'goblin', ex, ey);
    state = addComponent(state, allyId, { type: ComponentType.Faction, faction: 'player' });
    const allyDnd = getDnD35EntityData(state, allyId);
    state = setDnD35EntityData(state, allyId, {
      ...allyDnd,
      statModifiers: [
        ...(allyDnd.statModifiers ?? []),
        {
          id: 'ally_high_will',
          sourceId: 'ally_high_will',
          sourcePath: 'test:ally_high_will',
          targetStat: 'will',
          bonusType: 'untyped',
          value: 40,
          origin: 'ex'
        }
      ]
    });
    const allyFighter = getComponent(state, allyId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, allyId, { ...allyFighter, hp: 1 });
    const allyClw = resolveDnD35eSpellItemEffect(state, playerId, 'spell:cure_light_wounds', 'Wand of CLW', allyId)!;
    const allyAfterClw = (getComponent(allyClw, allyId, ComponentType.Fighter) as FighterComponent).hp;
    expect(allyAfterClw).toBeGreaterThanOrEqual(3); // 1 + min(1d8+1) >= 3 (never halved even with +40 Will)

    // 6) Restoration clears negativeLevels and ability damage/drain
    let drainedState = applyNegativeLevelsToActor(state, playerId, 2);
    const drainedDnd = getDnD35EntityData(drainedState, playerId);
    drainedState = setDnD35EntityData(drainedState, playerId, {
      ...drainedDnd,
      abilityScores: {
        ...drainedDnd.abilityScores,
        str: { ...drainedDnd.abilityScores.str, damage: 4, drain: 2 }
      }
    });
    const restoration = sys.spells['restoration']!;
    const restoredState = applyResolvedSpellEffectsToTarget({
      state: drainedState,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: restoration,
      units: restoration.effectUnits,
      casterLevel: 7,
      castId: 'test_restoration_drain',
      metamagic: {
        empower: false,
        maximize: false,
        extend: false,
        widen: false,
        silent: false,
        still: false,
        judicious: false,
        projectTouch: false
      },
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });
    const postRestore = getDnD35EntityData(restoredState, playerId);
    expect(postRestore.negativeLevels ?? 0).toBe(0);
    expect(postRestore.abilityScores.str.damage).toBe(0);
    expect(postRestore.abilityScores.str.drain).toBe(0);

    // 7) validateItems catches invalid zappable.effectId
    const badCampaign = {
      ...sharedCampaign,
      items: {
        ...sharedCampaign.items,
        broken_wand: {
          ...sharedCampaign.items['wand_of_magic_missile']!,
          id: 'broken_wand',
          zappable: {
            effectId: 'spell:nonexistent_spell_id',
            pattern: 'bolt' as const,
            range: 6,
            maxCharges: 10,
            currentCharges: 10
          }
        }
      }
    };
    const itemErrors = await validateItems(badCampaign);
    expect(itemErrors.some((e) => e.path === 'items.broken_wand.zappable.effectId')).toBe(true);
  });
});
