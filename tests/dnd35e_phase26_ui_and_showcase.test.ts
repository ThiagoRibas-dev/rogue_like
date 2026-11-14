import { describe, expect, it } from 'bun:test';
import { createToggleCartridgeModalAction } from '../src/actions/core.actions.ts';
import { dispatchAction } from '../src/actions/action.registry.ts';
import { addComponent, getComponent } from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import {
  applyCartridgeNewGameHook,
  closeCartridgeModal,
  getActiveCartridgeUI,
  isCartridgeModalOpen,
  openCartridgeModal,
  toggleCartridgeModal
} from '../src/rendering/ui/cartridge_ui_registry.ts';
import { updateActorTacticalDoctrine } from '../src/rendering/ui/dnd35e_doctrine_actions.ts';
import {
  executeEightHourRest,
  prepareSpellIntoSlot,
  unprepareSpellSlot
} from '../src/rendering/ui/dnd35e_spellbook_actions.ts';
import { registerDnD35eUIAdapter } from '../src/rendering/ui/dnd35e_ui_registration.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import {
  applyCharacterCreationToPlayer,
  type CharacterCreationDraft,
  validateCharacterCreationStep
} from '../src/rulesets/dnd35e/character_builder.ts';
import { getDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType, type FighterComponent, type TacticalDoctrineComponent } from '../src/types/components.types.ts';
import { UIMode } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('Phase 26 (M118 & M119): Console Slot/Modal Host API, D&D 3.5e Tactical UI, Spellbook & Sunless Reliquary Showcase', () => {
  it('registers D&D 3.5e UI Adapter into Console Cartridge UI Registry and manages LIFO CartridgeModals', () => {
    registerDnD35eUIAdapter();
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);

    const uiDef = getActiveCartridgeUI(state);
    expect(uiDef).toBeDefined();
    expect(uiDef?.rulesetId).toBe('dnd35e');
    expect(Object.keys(uiDef?.modals ?? {})).toEqual([
      'char_creation',
      'level_up',
      'character_sheet',
      'spellbook',
      'quickcast'
    ]);

    // Test new game hook opens char_creation via generic CartridgeModal
    state = applyCartridgeNewGameHook(state);
    expect(state.uiMode).toBe(UIMode.CartridgeModal);
    expect(state.activeCartridgeModalId).toBe('char_creation');
    expect(isCartridgeModalOpen(state, 'char_creation')).toBe(true);
    expect(isCartridgeModalOpen(state, 'character_sheet')).toBe(false);

    // Close char_creation
    state = closeCartridgeModal(state);
    expect(state.uiMode).toBe(UIMode.Game);
    expect(state.activeCartridgeModalId).toBeUndefined();

    // Toggle character_sheet via ToggleCartridgeModalIntent
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    const toggleSheetIntent = createToggleCartridgeModalAction(playerId, 'character_sheet');
    state = dispatchAction(state, toggleSheetIntent).state;
    expect(isCartridgeModalOpen(state, 'character_sheet')).toBe(true);

    // Switch directly to spellbook and verify modal stack
    state = openCartridgeModal(state, 'spellbook');
    expect(isCartridgeModalOpen(state, 'spellbook')).toBe(true);

    // Toggle spellbook closed -> restores previous modal (character_sheet)
    state = toggleCartridgeModal(state, 'spellbook');
    expect(isCartridgeModalOpen(state, 'character_sheet')).toBe(true);

    // Close character_sheet -> back to Game
    state = closeCartridgeModal(state);
    expect(state.uiMode).toBe(UIMode.Game);
  });

  it('projects Level Up Available alert ribbon and dock command availability when player XP >= threshold', () => {
    registerDnD35eUIAdapter();
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    const uiDef = getActiveCartridgeUI(state)!;
    const levelUpDockCmd = uiDef.dockCommands?.find((c) => c.modalId === 'level_up')!;

    expect(levelUpDockCmd.isAvailable?.(state, playerId)).toBe(false);
    expect(uiDef.projectHudAlerts?.(state, playerId).length).toBe(0);

    // Grant 1,000 XP (Level 2 threshold)
    const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, playerId, { ...fighter, xp: 1000 });

    expect(levelUpDockCmd.isAvailable?.(state, playerId)).toBe(true);
    const alerts = uiDef.projectHudAlerts?.(state, playerId) ?? [];
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.label).toBe('Level Up Available!');
  });

  it('updates TacticalDoctrineComponent dials, stances, and grip mode and reflects changes in Stat DAG', () => {
    initRNG(101);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign)!;
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    const fighterDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'fighter',
      alignment: 'NG',
      selectedAcfs: [],
      domains: [],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 14, con: 14, int: 13, wis: 10, cha: 8 },
      skillRanks: { climb: 4, jump: 4, intimidate: 4 },
      selectedFeats: ['power_attack', 'combat_expertise', 'cleave'],
      knownSpells: [],
      equipmentPackageId: 'martial_vanguard'
    };

    state = applyCharacterCreationToPlayer(state, playerId, fighterDraft, sys);
    const baseEval = evaluateDnD35eEntityDAG(state, playerId)!;
    const baseAc = baseEval.dagResult.acBreakdown.fullAC;

    // Activate Fighting Defensively (+2 Dodge AC, -4 Attack)
    state = updateActorTacticalDoctrine(state, playerId, {
      fightingDefensively: true,
      gripMode: 'two_handed'
    });

    const docComp = getComponent(state, playerId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent;
    expect(docComp.fightingDefensively).toBe(true);
    expect(docComp.gripMode).toBe('two_handed');

    const updatedEval = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(updatedEval.dagResult.acBreakdown.fullAC).toBe(baseAc + 2);
  });

  it('prepares, unprepares, and rests Vancian spell slots in per-class spellbooks', () => {
    initRNG(202);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign)!;
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    const wizardDraft: CharacterCreationDraft = {
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
      knownSpells: ['magic_missile', 'mage_armor', 'shield', 'burning_hands'],
      equipmentPackageId: 'arcane_scholar'
    };

    state = applyCharacterCreationToPlayer(state, playerId, wizardDraft, sys);
    let dndData = getDnD35EntityData(state, playerId);
    expect(dndData.feats).toContain('scribe_scroll');
    const initialPreparedCount = dndData.spellbooksByClass?.['wizard']?.preparedSpellIds.length ?? 0;

    // Prepare magic_missile
    state = prepareSpellIntoSlot(state, playerId, 'wizard', 'magic_missile');
    dndData = getDnD35EntityData(state, playerId);
    expect(dndData.spellbooksByClass?.['wizard']?.preparedSpellIds.length).toBe(initialPreparedCount + 1);

    // Unprepare last slot
    const lastIdx = (dndData.spellbooksByClass?.['wizard']?.preparedSpellIds.length ?? 1) - 1;
    state = unprepareSpellSlot(state, playerId, 'wizard', lastIdx);
    dndData = getDnD35EntityData(state, playerId);
    expect(dndData.spellbooksByClass?.['wizard']?.preparedSpellIds.length).toBe(initialPreparedCount);

    // Damage player and execute 8-hour rest
    const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    state = addComponent(state, playerId, { ...fighter, hp: 1 });
    state = executeEightHourRest(state, playerId);
    const restedFighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    expect(restedFighter.hp).toBeGreaterThan(1);
  });

  it('enforces SRD Power Attack (STR 13+, no BAB requirement) and Weapon Focus (BAB +1 and weapon proficiency)', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = getDnD35SystemContent(campaign)!;

    // Level 1 Cleric (BAB +0) with STR 16 meets SRD Power Attack (STR 13+)
    const clericDraft: CharacterCreationDraft = {
      raceId: 'human',
      classId: 'cleric',
      alignment: 'NG',
      selectedAcfs: [],
      domains: ['war', 'good'],
      prohibitedSchools: [],
      abilityMethod: 'point_buy',
      pointBuyBudget: 28,
      baseAbilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
      skillRanks: {},
      selectedFeats: ['power_attack', 'toughness'],
      knownSpells: [],
      equipmentPackageId: 'divine_crusader'
    };

    const clericValid = validateCharacterCreationStep(clericDraft, 'feats', sys);
    expect(clericValid.valid).toBe(true);

    // Level 1 Cleric with STR 12 fails Power Attack
    const lowStrClericValidation = validateCharacterCreationStep(
      {
        ...clericDraft,
        baseAbilityScores: { str: 12, dex: 14, con: 14, int: 10, wis: 16, cha: 10 }
      },
      'feats',
      sys
    );
    expect(lowStrClericValidation.valid).toBe(false);
    expect(lowStrClericValidation.reason).toContain('Prerequisites not met for feat: Power Attack');

    // Fighter at Level 1 has BAB +1 and martial weapon proficiency, meeting Power Attack, Cleave & Weapon Focus (Longsword)
    const fighterDraft: CharacterCreationDraft = {
      ...clericDraft,
      classId: 'fighter',
      domains: [],
      selectedFeats: ['power_attack', 'cleave', 'weapon_focus:longsword']
    };
    const fighterValidation = validateCharacterCreationStep(fighterDraft, 'feats', sys);
    expect(fighterValidation.valid).toBe(true);
  });

  it('verifies The Sunless Reliquary (dnd35e-crypt) showcase campaign zones', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    expect(campaign.manifest.rulesetId).toBe('dnd35e');
    expect(campaign.areas['safe_hub']?.name).toBe('Outfitter Sanctuary Hub');
    expect(campaign.areas['dungeon_1']?.name).toBe('Goblinoid & Orcish Outer Warrens');
    expect(campaign.areas['dungeon_2']?.name).toBe('Desecrated Ossuary');
    expect(campaign.areas['bandit_stronghold']?.name).toBe('Reliquary Sanctum');
  });
});
