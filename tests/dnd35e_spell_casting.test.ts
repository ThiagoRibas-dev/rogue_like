import { describe, expect, it } from 'bun:test';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { createFireAimedAction, createToggleTargetingAction } from '../src/actions/targeting.actions.ts';
import { addComponent, getComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import { prepareSpellIntoSlot } from '../src/rendering/ui/dnd35e_spellbook_actions.ts';
import { createRoundActionBudget } from '../src/rulesets/dnd35e/action_economy.ts';
import { resolveDnD35eActionEnergyCost } from '../src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts';
import { applyCharacterCreationToPlayer, type CharacterCreationDraft } from '../src/rulesets/dnd35e/character_builder.ts';
import { executeDnD35eSpellCast } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { buildDnD35eQuickcastModel } from '../src/rulesets/dnd35e/ui/dnd35e_quickcast_model.ts';
import { buildActorHotbarSlots } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';
import {
  ComponentType,
  type FighterComponent,
  type InventoryComponent,
  type PositionComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function ensureWalkableLine(state: GameState, startX: number, y: number, length: number): GameState {
  const tiles = [...state.map.tiles];
  for (let dx = 0; dx <= length; dx++) {
    const x = startX + dx;
    if (x >= 0 && x < state.map.width && y >= 0 && y < state.map.height) {
      const idx = y * state.map.width + x;
      tiles[idx] = { ...tiles[idx]!, tileId: 'stone_floor' };
    }
  }
  return { ...state, map: { ...state.map, tiles } };
}

function buildWizardPlayerState(): { state: GameState; playerId: EntityId } {
  initRNG(42);
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;
  let state = buildGameState(campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
  const draft: CharacterCreationDraft = {
    raceId: 'human',
    classId: 'wizard',
    alignment: 'NG',
    selectedAcfs: [],
    domains: [],
    arcaneSchool: 'universal',
    prohibitedSchools: [],
    abilityMethod: 'point_buy',
    pointBuyBudget: 28,
    baseAbilityScores: { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    skillRanks: { concentration: 4, spellcraft: 4, knowledge_arcana: 4 },
    selectedFeats: ['spell_focus:evocation', 'combat_casting'],
    knownSpells: ['mage_armor', 'magic_missile', 'shield', 'fireball'],
    equipmentPackageId: 'arcane_scholar'
  };
  state = applyCharacterCreationToPlayer(state, playerId, draft, sys);
  const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
  state = ensureWalkableLine(state, pos.x, pos.y, 5);
  return { state, playerId };
}

describe('D&D 3.5e End-to-End Spell Casting & Quickcast Matrix', () => {
  it('casts mage_armor on caster tile, expends slot, applies +4 armor modifier, and avoids duplicate stacking', () => {
    let { state, playerId } = buildWizardPlayerState();
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'mage_armor', 'general', 1);
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'mage_armor', 'general', 1);
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    const slotsBefore = getDnD35EntityData(state, playerId).spellbooksByClass?.['wizard']?.preparedSlots ?? [];
    const preparedMageArmor = slotsBefore.filter((s) => s.preparedSpellId === 'mage_armor' && !s.expended);
    expect(preparedMageArmor.length).toBeGreaterThanOrEqual(2);

    const toggle = createToggleTargetingAction(playerId, {
      verb: 'cast_spell',
      classId: 'wizard',
      spellId: 'mage_armor',
      slotId: preparedMageArmor[0]!.slotId
    });
    state = dispatchAction(state, toggle).state;
    expect(state.targetingMode?.active).toBe(true);
    expect(state.targetingMode?.x).toBe(pos.x);

    const fired = dispatchAction(state, createFireAimedAction(playerId));
    state = fired.state;
    expect(fired.success).toBe(true);
    expect(state.targetingMode).toBeUndefined();

    const afterFirst = getDnD35EntityData(state, playerId);
    const armorMods = (afterFirst.statModifiers ?? []).filter((m) =>
      (m.sourcePath ?? '').startsWith('spell:mage_armor:')
    );
    expect(armorMods.length).toBe(1);
    expect(armorMods[0]?.value).toBe(4);
    expect(
      afterFirst.spellbooksByClass?.['wizard']?.preparedSlots?.find((s) => s.slotId === preparedMageArmor[0]!.slotId)
        ?.expended
    ).toBe(true);

    // Recast second slot: replaces previous mage_armor modifier instead of stacking
    state = executeDnD35eSpellCast(state, playerId, { x: pos.x, y: pos.y }, {
      classId: 'wizard',
      spellId: 'mage_armor',
      slotId: preparedMageArmor[1]!.slotId
    }).state;
    const afterSecondMods = (getDnD35EntityData(state, playerId).statModifiers ?? []).filter((m) =>
      (m.sourcePath ?? '').startsWith('spell:mage_armor:')
    );
    expect(afterSecondMods.length).toBe(1);
  });

  it('fires targeted magic_missile via RulesetContract.resolveAimedAction and deals force damage', () => {
    let { state, playerId } = buildWizardPlayerState();
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'magic_missile', 'general', 1);
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const [sWithEnemy, enemyId] = spawnEntity(state, 'skeleton', playerPos.x + 2, playerPos.y);
    state = sWithEnemy;
    const enemyBeforeHp = (getComponent(state, enemyId, ComponentType.Fighter) as FighterComponent).hp;

    state = dispatchAction(
      state,
      createToggleTargetingAction(playerId, { verb: 'cast_spell', classId: 'wizard', spellId: 'magic_missile' })
    ).state;
    state = { ...state, targetingMode: { ...state.targetingMode!, x: playerPos.x + 2, y: playerPos.y } };
    state = dispatchAction(state, createFireAimedAction(playerId)).state;

    const enemyAfterHp = (getComponent(state, enemyId, ComponentType.Fighter) as FighterComponent).hp;
    expect(enemyAfterHp).toBeLessThan(enemyBeforeHp);
  });

  it('casts 20ft AoE fireball hitting multiple enemies in blast radius', () => {
    let { state, playerId } = buildWizardPlayerState();
    const dnd = getDnD35EntityData(state, playerId);
    const wizBook = dnd.spellbooksByClass!['wizard']!;
    state = setDnD35EntityData(state, playerId, {
      ...dnd,
      spellbooksByClass: {
        ...dnd.spellbooksByClass,
        wizard: {
          ...wizBook,
          effectiveCasterLevel: 5,
          maxCastableSpellLevel: 3,
          spellsPerDay: { ...wizBook.spellsPerDay, '3': 1 },
          preparedSlots: [
            ...(wizBook.preparedSlots ?? []),
            { slotId: 'wiz_l3_test', spellLevel: 3, slotKind: 'general', preparedSpellId: 'fireball', expended: false }
          ]
        }
      }
    });

    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const [s1, e1] = spawnEntity(state, 'skeleton', pPos.x + 3, pPos.y);
    const [s2, e2] = spawnEntity(s1, 'skeleton', pPos.x + 4, pPos.y);
    state = s2;
    const e1Hp = (getComponent(state, e1, ComponentType.Fighter) as FighterComponent).hp;
    const e2Hp = (getComponent(state, e2, ComponentType.Fighter) as FighterComponent).hp;

    state = executeDnD35eSpellCast(state, playerId, { x: pPos.x + 3, y: pPos.y }, {
      classId: 'wizard',
      spellId: 'fireball',
      slotId: 'wiz_l3_test'
    }).state;

    expect((getComponent(state, e1, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(e1Hp);
    expect((getComponent(state, e2, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(e2Hp);
  });

  it('inverts cure_light_wounds into positive energy damage against undead and heals living allies', () => {
    initRNG(77);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign)!;
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    const draft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'cleric',
      alignment: 'TN',
      selectedAcfs: [],
      domains: ['healing', 'good'],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
      skillRanks: { concentration: 4, heal: 4 },
      selectedFeats: ['combat_casting', 'toughness'],
      knownSpells: [],
      equipmentPackageId: 'divine_crusader'
    };
    state = applyCharacterCreationToPlayer(state, playerId, draft, sys);
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    state = ensureWalkableLine(state, pPos.x, pPos.y, 3);
    const f = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, playerId, { ...f, hp: Math.max(1, f.maxHp - 6) });
    const [sWithSkel, skelId] = spawnEntity(state, 'skeleton', pPos.x + 2, pPos.y);
    state = sWithSkel;
    const skelHpBefore = (getComponent(state, skelId, ComponentType.Fighter) as FighterComponent).hp;

    // Cleric prepares two general lv1 slots then spontaneously converts to Cure Light Wounds
    state = prepareSpellIntoSlot(state, playerId, 'cleric', 'bless', 'general', 1);
    state = prepareSpellIntoSlot(state, playerId, 'cleric', 'bless', 'general', 1);
    const preparedGeneral = getDnD35EntityData(state, playerId).spellbooksByClass!['cleric']!.preparedSlots!.filter(
      (s) => s.spellLevel === 1 && s.slotKind === 'general' && s.preparedSpellId === 'bless' && !s.expended
    );
    expect(preparedGeneral.length).toBeGreaterThanOrEqual(2);

    state = executeDnD35eSpellCast(state, playerId, { x: pPos.x, y: pPos.y }, {
      classId: 'cleric',
      spellId: 'bless',
      slotId: preparedGeneral[0]!.slotId,
      convertedSpellId: 'cure_light_wounds'
    }).state;
    const healedHp = (getComponent(state, playerId, ComponentType.Fighter) as FighterComponent).hp;
    expect(healedHp).toBeGreaterThan(Math.max(1, f.maxHp - 6));

    // Next round: refresh round action budget and cast cure_light_wounds against adjacent undead skeleton
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      actionBudget: createRoundActionBudget({ dexModifier: 0 })
    });
    const [sAdjSkel, adjSkelId] = spawnEntity(state, 'skeleton', pPos.x + 1, pPos.y);
    state = setDnD35EntityData(sAdjSkel, adjSkelId, {
      ...getDnD35EntityData(sAdjSkel, adjSkelId),
      creatureType: 'undead'
    });
    const adjSkelHpBefore = (getComponent(state, adjSkelId, ComponentType.Fighter) as FighterComponent).hp;
    state = executeDnD35eSpellCast(state, playerId, { x: pPos.x + 1, y: pPos.y }, {
      classId: 'cleric',
      spellId: 'bless',
      slotId: preparedGeneral[1]!.slotId,
      convertedSpellId: 'cure_light_wounds'
    }).state;
    const adjSkelHpAfter = (getComponent(state, adjSkelId, ComponentType.Fighter) as FighterComponent).hp;
    expect(adjSkelHpAfter).toBeLessThan(adjSkelHpBefore);
    expect(skelHpBefore).toBeGreaterThan(0);
  });

  it('enforces spontaneous metamagic Full-Round cost (Empower) vs Swift action preservation (Quicken / Quicken Rod)', () => {
    initRNG(88);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    state = ensureWalkableLine(state, pPos.x, pPos.y, 3);
    const [sWithEnemy, enemyId] = spawnEntity(state, 'skeleton', pPos.x + 1, pPos.y);
    state = sWithEnemy;
    const baseDnd = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...baseDnd,
      abilityScores: {
        ...baseDnd.abilityScores,
        cha: { ...baseDnd.abilityScores.cha, base: 16 }
      },
      feats: ['empower_spell', 'quicken_spell'],
      actionBudget: createRoundActionBudget({ dexModifier: 0 }),
      spellbooksByClass: {
        sorcerer: {
          classId: 'sorcerer',
          castingMode: 'spontaneous',
          castingTradition: 'arcane',
          spellAcquisitionMode: 'known_spontaneous',
          governingAbility: 'cha',
          effectiveCasterLevel: 6,
          maxCastableSpellLevel: 3,
          knownSpellIds: ['magic_missile'],
          preparedSpellIds: [],
          spellsPerDay: { '0': 6, '1': 4, '2': 3, '3': 2 },
          spontaneousSlotsUsedByLevel: {}
        }
      }
    });

    const model = buildDnD35eQuickcastModel(state, playerId, {
      activeModifierIds: ['empower_spell'],
      collapsedClassIds: []
    });
    const sorcSection = model.sections.find((s) => s.classId === 'sorcerer')!;
    expect(sorcSection.rows.map((r) => r.spellLevel)).toEqual([3]);
    expect(sorcSection.rows[0]!.tiles[0]!.effectiveSlotLevel).toBe(3);

    const [sRod, rodId] = spawnItem(state, 'rod_of_metamagic_quicken_lesser');
    state = sRod;
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent;
    state = addComponent(state, playerId, { ...inv, items: [...inv.items, rodId] });
    const rodModel = buildDnD35eQuickcastModel(state, playerId, {
      activeModifierIds: ['rod:quicken'],
      collapsedClassIds: []
    });
    expect(rodModel.modifiers.some((m) => m.id === 'rod:quicken' && m.slotLevelBump === 0)).toBe(true);

    // Cast Empowered Magic Missile -> spends Lv 3 slot and Full-Round action (standardRemaining=0, moveRemaining=0)
    state = executeDnD35eSpellCast(state, playerId, { x: pPos.x + 1, y: pPos.y }, {
      classId: 'sorcerer',
      spellId: 'magic_missile',
      spellLevel: 1,
      metamagicFeatIds: ['empower_spell']
    }).state;
    const afterEmpower = getDnD35EntityData(state, playerId);
    expect(afterEmpower.spellbooksByClass?.['sorcerer']?.spontaneousSlotsUsedByLevel?.['3']).toBe(1);
    expect(afterEmpower.actionBudget?.standardRemaining).toBe(0);
    expect(afterEmpower.actionBudget?.moveRemaining).toBe(0);

    // Refresh round budget and cast via Quicken Rod -> consumes Swift only, preserving Standard action
    state = setDnD35EntityData(state, playerId, {
      ...afterEmpower,
      actionBudget: createRoundActionBudget({ dexModifier: 0 })
    });
    const enemyHpBefore = (getComponent(state, enemyId, ComponentType.Fighter) as FighterComponent).hp;
    state = executeDnD35eSpellCast(state, playerId, { x: pPos.x + 1, y: pPos.y }, {
      classId: 'sorcerer',
      spellId: 'magic_missile',
      spellLevel: 1,
      metamagicFeatIds: ['rod:quicken']
    }).state;
    const afterQuicken = getDnD35EntityData(state, playerId);
    expect(afterQuicken.actionBudget?.swiftRemaining).toBe(0);
    expect(afterQuicken.actionBudget?.standardRemaining).toBe(1);
    expect(afterQuicken.spellbooksByClass?.['sorcerer']?.spontaneousSlotsUsedByLevel?.['1']).toBe(1);
    expect((getComponent(state, enemyId, ComponentType.Fighter) as FighterComponent).hp).toBeLessThan(enemyHpBefore);

    const energyRes = resolveDnD35eActionEnergyCost(state, createFireAimedAction(playerId), 100);
    expect(energyRes.energyCost).toBe(0);
  });

  it('projects stacked prepared spells into Hotbar with remainingCount & slotId and exposes Cleric/Druid spontaneous toggles', () => {
    let { state, playerId } = buildWizardPlayerState();
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'magic_missile', 'general', 1);
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'magic_missile', 'general', 1);
    const dndWiz = getDnD35EntityData(state, playerId);
    const hotbarSlots = buildActorHotbarSlots(dndWiz, state, playerId);
    const mmHotbar = hotbarSlots.find((s) => s.actionPayload?.kind === 'spell' && s.actionPayload.id === 'magic_missile');
    expect(mmHotbar).toBeDefined();
    expect(mmHotbar?.actionPayload?.remainingCount).toBe(2);
    expect(mmHotbar?.actionPayload?.slotId).toBeDefined();

    // Neutral Cleric in Quickcast sees both Cure and Inflict conversion toggles
    state = setDnD35EntityData(state, playerId, {
      ...dndWiz,
      alignment: 'TN',
      spellbooksByClass: {
        cleric: {
          classId: 'cleric',
          castingMode: 'prepared',
          castingTradition: 'divine',
          spellAcquisitionMode: 'prayerbook_full_list',
          governingAbility: 'wis',
          effectiveCasterLevel: 1,
          maxCastableSpellLevel: 1,
          knownSpellIds: ['bless'],
          preparedSpellIds: ['bless'],
          preparedSlots: [
            { slotId: 'clr_1', spellLevel: 1, slotKind: 'general', preparedSpellId: 'bless', expended: false }
          ],
          spellsPerDay: { '0': 3, '1': 1 }
        },
        druid: {
          classId: 'druid',
          castingMode: 'prepared',
          castingTradition: 'divine',
          spellAcquisitionMode: 'prayerbook_full_list',
          governingAbility: 'wis',
          effectiveCasterLevel: 1,
          maxCastableSpellLevel: 1,
          knownSpellIds: ['entangle'],
          preparedSpellIds: [],
          spellsPerDay: { '0': 3, '1': 1 }
        }
      }
    });
    const quick = buildDnD35eQuickcastModel(state, playerId, {
      activeModifierIds: ['spontaneous:inflict'],
      collapsedClassIds: []
    });
    expect(quick.modifiers.some((m) => m.id === 'spontaneous:cure')).toBe(true);
    expect(quick.modifiers.some((m) => m.id === 'spontaneous:inflict')).toBe(true);
    expect(quick.modifiers.some((m) => m.id === 'spontaneous:sna')).toBe(true);
    const clericRow1 = quick.sections.find((s) => s.classId === 'cleric')?.rows.find((r) => r.spellLevel === 1);
    expect(clericRow1?.tiles.some((t) => t.convertedSpellId === 'inflict_light_wounds')).toBe(true);
  });
});
