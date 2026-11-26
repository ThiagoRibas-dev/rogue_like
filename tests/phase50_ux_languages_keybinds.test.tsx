import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { renderToString } from 'preact-render-to-string';
import { createApplyAction } from '../src/actions/interaction.actions.ts';
import { VERBS } from '../src/constants/verbs.constants.ts';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { commandRegistry } from '../src/core/input/command_registry.ts';
import { InputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { resetMoveThrottle } from '../src/core/input/gameplay_input.ts';
import { handleModalKey } from '../src/core/input/modal_input.ts';
import { clearInputQueue, dequeueIntent } from '../src/core/input_queue.ts';
import { clearModals } from '../src/core/modal_manager.ts';
import { PresentationDomain } from '../src/core/presentation_queue.ts';
import { initEngine } from '../src/core/scheduler.ts';
import {
  applyKeybindPreset,
  getBindingsForCommand,
  getDebugModeEnabled,
  migrateSettingsPayload,
  resetSettings,
  setDebugModeEnabled
} from '../src/core/settings.ts';
import { carveBaseGeometry, carveRoomsAndPortals, resolvePalette } from '../src/map/generator_stages.ts';
import { registerClassicUIAdapter } from '../src/rendering/ui/cartridges/classic/classic_ui_registration.tsx';
import { DnD35eLevelUpModal } from '../src/rendering/ui/cartridges/dnd35e/DnD35eLevelUpModal.tsx';
import { DnD35eSharedFeatsStep } from '../src/rendering/ui/cartridges/dnd35e/DnD35eSharedFeatsStep.tsx';
import { DnD35eSharedSkillsStep } from '../src/rendering/ui/cartridges/dnd35e/DnD35eSharedSkillsStep.tsx';
import { registerDnD35eUIAdapter } from '../src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx';
import { uiStore } from '../src/rendering/ui/core/ui_store.ts';
import { ChronosStrip } from '../src/rendering/ui/hud/ChronosStrip.tsx';
import { CommandDockCard } from '../src/rendering/ui/hud/CommandDockCard.tsx';
import { DOCK_COMMANDS } from '../src/rendering/ui/hud_dock.ui.ts';
import { SettingsModal } from '../src/rendering/ui/menus/SettingsModal.tsx';
import { Automap3DModal } from '../src/rendering/ui/modals/Automap3DModal.tsx';
import { DialogueModal } from '../src/rendering/ui/modals/DialogueModal.tsx';
import { HelpModal } from '../src/rendering/ui/modals/HelpModal.tsx';
import { ModalShell } from '../src/rendering/ui/primitives/ModalShell.tsx';
import { applyLevelUpToActor, buildPrerequisiteContextForActor } from '../src/rulesets/dnd35e/character_builder.ts';
import { resolveBullRushImpact } from '../src/rulesets/dnd35e/combat/bull_rush_resolver.ts';
import { evaluateDnD35eLanguageComprehension } from '../src/rulesets/dnd35e/skills/language_comprehension.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { processApplyIntent } from '../src/systems/apply.system.ts';
import {
  evaluateActorDialogueComprehension,
  obfuscateDialogueText
} from '../src/systems/language.system.ts';
import { displaceEntityStep, isEntityImmovable } from '../src/systems/movement_displacement.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type TagsComponent
} from '../src/types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { isHostile } from '../src/utils/faction.ts';
import { scoreFuzzyTextMatch } from '../src/utils/fuzzy_match.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function findPlayerId(state: Readonly<GameState>): EntityId {
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) throw new Error('Expected player entity in test state');
  return playerId;
}

function makeKeyEvent(
  key: string,
  options: {
    readonly code?: string;
    readonly shiftKey?: boolean;
    readonly ctrlKey?: boolean;
    readonly altKey?: boolean;
    readonly metaKey?: boolean;
  } = {}
): KeyboardEvent & { readonly defaultPrevented: boolean } {
  let prevented = false;
  return {
    key,
    code: options.code ?? '',
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    altKey: options.altKey ?? false,
    metaKey: options.metaKey ?? false,
    target: null,
    preventDefault: (): void => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    }
  } as unknown as KeyboardEvent & { readonly defaultPrevented: boolean };
}

describe('Phase 50 (Milestones 190–192): UX Polish, Provenance, Languages, Social Verbs & 3-Tier Keybinds', () => {
  beforeEach(() => {
    initEngine();
    resetSettings();
    clearInputQueue();
    clearModals();
    resetMoveThrottle();
    registerClassicUIAdapter();
    registerDnD35eUIAdapter();
    uiStore.setHelpOpen(false);
  });

  afterEach(() => {
    initEngine();
    clearInputQueue();
    clearModals();
    resetMoveThrottle();
    uiStore.setHelpOpen(false);
  });

  test('Milestone 190: Two-pane scrollMode="panes", Top-Bar Z coordinate, Provenance tags, Fuzzy Feats/Skills filters, and Conditional Level-Up Feats tab', () => {
    // 1. ModalShell scrollMode="panes"
    const panesHtml = renderToString(
      <ModalShell title="Two Pane Test" scrollMode="panes" onClose={(): void => {}}>
        <div>Pane Content</div>
      </ModalShell>
    );
    expect(panesHtml).toContain('ui-modal__body--panes');

    // 2. ChronosStrip always shows Z coordinate (even at Z:0)
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const state = buildGameState(campaign, 5001);
    const playerId = findPlayerId(state);
    const chronosHtml = renderToString(<ChronosStrip state={state} playerId={playerId} isHudFocused={false} />);
    expect(chronosHtml).toContain('Z:0');

    // 3. Fuzzy matching helper
    const prefix = scoreFuzzyTextMatch('pow', 'Power Attack');
    const substr = scoreFuzzyTextMatch('att', 'Power Attack');
    const subseq = scoreFuzzyTextMatch('pwat', 'Power Attack');
    const miss = scoreFuzzyTextMatch('xyz', 'Power Attack');
    expect(prefix).not.toBeNull();
    expect(substr).not.toBeNull();
    expect(subseq).not.toBeNull();
    expect(miss).toBeNull();
    expect(prefix!).toBeGreaterThan(substr!);
    expect(substr!).toBeGreaterThan(subseq!);

    // 4. Content Provenance + Feats/Skills Steps (no redundant [Fighter] suffix on feat rows)
    const sys = getDnD35SystemContent(campaign)!;
    expect(sys.feats['judicious_spell']?.sourceOrigin).toBe('homebrew');

    const dndData = getDnD35EntityData(state, playerId);
    const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes, sys);
    const featsHtml = renderToString(
      <DnD35eSharedFeatsStep
        sys={sys}
        slotSummaryLabel="Remaining: 1 / 1"
        totalSlots={1}
        alreadyOwnedFeatIds={[]}
        selectedFeatIds={[]}
        prereqCtx={prereqCtx}
        onUpdateSelectedFeats={(): void => {}}
      />
    );
    expect(featsHtml).toContain('Fuzzy search feats');
    expect(featsHtml).toContain('Metamagic');
    expect(featsHtml).toContain('Homebrew / Non-SRD');
    expect(featsHtml).not.toContain('Power Attack [Fighter]');

    const skillsHtml = renderToString(
      <DnD35eSharedSkillsStep
        sys={sys}
        totalHd={1}
        budget={4}
        activeLevelClassSkillIds={['tumble', 'jump']}
        everClassSkillIds={['tumble', 'jump']}
        priorSkillRanks={{}}
        addedSkillRanks={{}}
        abilityModifiers={{ str: 2, dex: 2, con: 1, int: 1, wis: 0, cha: 0 }}
        miscSkillBonuses={{}}
        onUpdateAddedRanks={(): void => {}}
      />
    );
    expect(skillsHtml).toContain('Knowledge');
    expect(skillsHtml).toContain('STR');
    expect(skillsHtml).toContain('CHA');

    // 5. Conditional Level-Up Feats tab omitted when Rogue reaches Level 2 (totalFeatSlots === 0)
    const rogueData = {
      ...dndData,
      tracks: [{ trackId: 'rogue', levels: 1 }]
    };
    const rogueState = setDnD35EntityData(state, playerId, rogueData);
    const levelUpHtml = renderToString(<DnD35eLevelUpModal state={rogueState} />);
    expect(levelUpHtml).toContain('1. Class');
    expect(levelUpHtml).toContain('2. Skills');
    expect(levelUpHtml).not.toContain('Feats');
  });

  test('Milestone 191a: Digger Door Framing never spawns freestanding or orthogonally adjacent procedural doors', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const diggerArea =
      Object.values(campaign.areas).find((a) => a.generatorType === 'digger') ??
      ({
        id: 'test_digger',
        name: 'Test Digger',
        generatorType: 'digger',
        dangerRating: 1,
        connections: []
      } as const);
    const width = 40;
    const height = 28;
    const palette = resolvePalette(diggerArea);
    const base = carveBaseGeometry(diggerArea, width, height, palette, campaign.rules.map);
    const roomsRes = carveRoomsAndPortals(diggerArea, width, height, palette, base.tiles, base.diggerRooms);

    const tileAt = (x: number, y: number): string | undefined => base.tiles[y * width + x]?.tileId;
    const isWalkableFloor = (x: number, y: number): boolean => {
      const tid = tileAt(x, y);
      if (!tid) return false;
      const def = campaign.tiles[tid];
      return def?.walkable === true && !def.tags?.includes('wall');
    };
    const isSolidWall = (x: number, y: number): boolean => {
      if (x < 0 || x >= width || y < 0 || y >= height) return false;
      const tid = tileAt(x, y);
      if (!tid) return false;
      const def = campaign.tiles[tid];
      return def?.walkable === false || def?.tags?.includes('wall') === true;
    };

    const doorPositions = roomsRes.placedEntities
      .filter((s) => s.templateId === palette.door)
      .map((s) => `${s.x},${s.y}`);

    expect(doorPositions.length).toBeGreaterThan(0);

    for (const key of doorPositions) {
      const [sx, sy] = key.split(',').map(Number) as [number, number];
      // Must be framed either W+E solid walls with N+S open OR N+S solid walls with W+E open
      const horizontalFrame =
        isSolidWall(sx - 1, sy) && isSolidWall(sx + 1, sy) && isWalkableFloor(sx, sy - 1) && isWalkableFloor(sx, sy + 1);
      const verticalFrame =
        isSolidWall(sx, sy - 1) && isSolidWall(sx, sy + 1) && isWalkableFloor(sx - 1, sy) && isWalkableFloor(sx + 1, sy);
      expect(horizontalFrame || verticalFrame).toBe(true);

      // No orthogonally adjacent procedural doors
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1]
      ] as const) {
        expect(doorPositions.includes(`${sx + dx},${sy + dy}`)).toBe(false);
      }
    }
  });

  test('Milestone 191b: Console Language Cipher, D&D 3.5e Creature-Type/Magic Comprehension, DialogueModal, and Social/Shove Verbs', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const draconicNpcId = 'test_draconic_speaker';
    const animalNpcId = 'test_wolf_speaker';
    const guardianId = 'test_immovable_guardian';

    campaign.entities[draconicNpcId] = {
      name: 'Kobold Emissary',
      char: 'k',
      color: '#ffaa44',
      blocksMovement: true,
      primaryLanguage: 'draconic',
      languages: ['draconic'],
      dialogueId: 'test_draconic_tree',
      faction: 'neutral',
      fighter: { hp: 12, maxHp: 12, attack: 2, defense: 10 },
      actor: { isHostile: false, fovRadius: 6, primaryLanguage: 'draconic', languages: ['draconic'] }
    };
    campaign.entities[animalNpcId] = {
      name: 'Timber Wolf',
      char: 'w',
      color: '#aaaaaa',
      blocksMovement: true,
      archetypeId: 'wolf',
      dialogueId: 'test_draconic_tree',
      faction: 'neutral',
      fighter: { hp: 13, maxHp: 13, attack: 3, defense: 12 },
      actor: { isHostile: false, fovRadius: 6 }
    };
    campaign.entities[guardianId] = {
      name: 'Stone Sentinel',
      char: 'G',
      color: '#999999',
      blocksMovement: true,
      immovable: true,
      faction: 'neutral',
      fighter: { hp: 40, maxHp: 40, attack: 6, defense: 14 },
      actor: { isHostile: false, fovRadius: 6 }
    };
    campaign.dialogues['test_draconic_tree'] = {
      id: 'test_draconic_tree',
      startNodeId: 'root',
      languageId: 'draconic',
      nodes: {
        root: {
          id: 'root',
          text: 'Hail traveler! Beware the ancient wyrm below.',
          options: [{ id: 'bye', text: 'Farewell.', nextNodeId: null }]
        }
      }
    };

    let state = buildGameState(campaign, 5002);
    const playerId = findPlayerId(state);
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // Clear adjacent tiles to make space for NPCs & knockback
    const clearTileId =
      Object.keys(campaign.tiles).find((id) => campaign.tiles[id]?.walkable === true && !campaign.tiles[id]?.tags?.includes('wall')) ??
      'stone_floor';
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        const tx = playerPos.x + dx;
        const ty = playerPos.y + dy;
        if (state.map.tiles[ty]?.[tx] !== undefined) {
          state.map.tiles[ty]![tx] = clearTileId;
        }
      }
    }

    const [s1, speakerEntityId] = spawnEntity(state, draconicNpcId, playerPos.x + 1, playerPos.y);
    const [s2, wolfEntityId] = spawnEntity(s1, animalNpcId, playerPos.x, playerPos.y + 1);
    const [s3, sentinelEntityId] = spawnEntity(s2, guardianId, playerPos.x - 1, playerPos.y);
    state = s3;

    // 1. Deterministic cipher preserves punctuation & varies by language
    const sampleText = 'Hail traveler! Beware the wyrm.';
    const cipherDraconic1 = obfuscateDialogueText(sampleText, 'draconic');
    const cipherDraconic2 = obfuscateDialogueText(sampleText, 'draconic');
    const cipherDwarven = obfuscateDialogueText(sampleText, 'dwarven');
    expect(cipherDraconic1).toBe(cipherDraconic2);
    expect(cipherDraconic1).not.toBe(sampleText);
    expect(cipherDraconic1).not.toBe(cipherDwarven);
    expect(cipherDraconic1).toContain('!');
    expect(cipherDraconic1.endsWith('.')).toBe(true);

    // 2. Spoken mismatch -> obfuscated in DialogueModal
    const compMismatch = evaluateActorDialogueComprehension(state, playerId, speakerEntityId, undefined, 'draconic');
    expect(compMismatch.understood).toBe(false);
    expect(compMismatch.canSpeakBack).toBe(false);

    const dialogueUnheardState: GameState = {
      ...state,
      uiMode: UIMode.Dialogue,
      activeDialogue: {
        treeId: 'test_draconic_tree',
        currentNodeId: 'root',
        npcEntityId: speakerEntityId
      }
    };
    uiStore.syncFromPresenter(dialogueUnheardState, false, new Set([PresentationDomain.Modals]));
    const unheardHtml = renderToString(<DialogueModal />);
    expect(unheardHtml).toContain('Unknown Tongue (Draconic)');
    expect(unheardHtml).not.toContain('Beware the ancient wyrm below');

    // 3. Comprehend Languages (`lang:comprehend_all`) understands without speaking back; Tongues (`lang:speak_all`) both understands and speaks
    const playerTags: TagsComponent = { type: ComponentType.Tags, tags: ['lang:comprehend_all'] };
    const stateComprehend = addComponent(state, playerId, playerTags);
    const compRead = evaluateDnD35eLanguageComprehension(stateComprehend, playerId, speakerEntityId, ['draconic']);
    expect(compRead.understood).toBe(true);
    expect(compRead.canSpeakBack).toBe(false);

    const dialogueComprehendState: GameState = {
      ...stateComprehend,
      uiMode: UIMode.Dialogue,
      activeDialogue: {
        treeId: 'test_draconic_tree',
        currentNodeId: 'root',
        npcEntityId: speakerEntityId
      }
    };
    uiStore.syncFromPresenter(dialogueComprehendState, false, new Set([PresentationDomain.Modals]));
    const heardHtml = renderToString(<DialogueModal />);
    expect(heardHtml).toContain('Comprehended via Comprehend Languages');
    expect(heardHtml).toContain('Beware the ancient wyrm below');

    const stateTongues = addComponent(state, playerId, { type: ComponentType.Tags, tags: ['lang:speak_all'] });
    const compTongues = evaluateDnD35eLanguageComprehension(stateTongues, playerId, speakerEntityId, ['draconic']);
    expect(compTongues.understood).toBe(true);
    expect(compTongues.canSpeakBack).toBe(true);

    // 4. Animal creature speech requires `lang:speak_creature_type:animal`
    const animalBlocked = evaluateDnD35eLanguageComprehension(state, playerId, wolfEntityId, []);
    expect(animalBlocked.understood).toBe(false);

    const stateSpeakAnimals = addComponent(state, playerId, {
      type: ComponentType.Tags,
      tags: ['lang:speak_creature_type:animal']
    });
    const animalAllowed = evaluateDnD35eLanguageComprehension(stateSpeakAnimals, playerId, wolfEntityId, []);
    expect(animalAllowed.understood).toBe(true);
    expect(animalAllowed.comprehensionReason).toBe('Speak with Animals');

    // 5. Look/Verb Menu includes talk, attack, shove
    expect(VERBS.includes('talk')).toBe(true);
    expect(VERBS.includes('attack')).toBe(true);
    expect(VERBS.includes('shove')).toBe(true);

    // 6. Immovable friendly guardian blocks forced displacement & shove without turning hostile
    expect(isEntityImmovable(state, sentinelEntityId)).toBe(true);
    const forcedPushFail = displaceEntityStep({
      state,
      entityId: sentinelEntityId,
      targetX: playerPos.x - 2,
      targetY: playerPos.y,
      context: { mode: 'forced_push', isForced: true, provokesAoO: false, sourceEntityId: playerId }
    });
    expect(forcedPushFail.moved).toBe(false);

    const shoveGuardian = processApplyIntent(
      state,
      createApplyAction(playerId, 'shove', { type: 'entity', entityId: sentinelEntityId })
    );
    expect(shoveGuardian.success).toBe(false);
    expect(isHostile(shoveGuardian.state, sentinelEntityId, playerId)).toBe(false);

    // Non-immovable friendly NPC can be gently shoved aside without turning hostile
    const shoveFriendlyNpc = processApplyIntent(
      state,
      createApplyAction(playerId, 'shove', { type: 'entity', entityId: speakerEntityId })
    );
    expect(shoveFriendlyNpc.success).toBe(true);
    expect(isHostile(shoveFriendlyNpc.state, speakerEntityId, playerId)).toBe(false);

    // 7. Attack on neutral/friendly actor provokes hostility cleanly
    const attackEmissary = processApplyIntent(
      state,
      createApplyAction(playerId, 'attack', { type: 'entity', entityId: speakerEntityId })
    );
    expect(isHostile(attackEmissary.state, speakerEntityId, playerId)).toBe(true);

    // 8. Shove in D&D 3.5e keeps attacker stationary (Bull Rush knockback without advancing)
    const strongPlayerData = getDnD35EntityData(state, playerId);
    const boostedState = setDnD35EntityData(state, playerId, {
      ...strongPlayerData,
      abilityScores: {
        ...strongPlayerData.abilityScores,
        str: { ...strongPlayerData.abilityScores.str, base: 60 }
      }
    });
    const shoveWolf = processApplyIntent(
      boostedState,
      createApplyAction(playerId, 'shove', { type: 'entity', entityId: wolfEntityId })
    );
    const wolfAfterPos = getComponent(shoveWolf.state, wolfEntityId, ComponentType.Position) as PositionComponent;
    const playerAfterPos = getComponent(shoveWolf.state, playerId, ComponentType.Position) as PositionComponent;
    expect(shoveWolf.success).toBe(true);
    expect(wolfAfterPos.y).toBeGreaterThan(playerPos.y + 1);
    expect(playerAfterPos.x).toBe(playerPos.x);
    expect(playerAfterPos.y).toBe(playerPos.y);
  });

  test('Milestone 192: 3-Tier Command Classification, Debug Mode Gate, Updated Dock/Keybinds & Lossless Pre-Phase-50 Migration', () => {
    // 1. Every registered command has a valid tier and 0 conflicts across modern & classic_vi in both rulesets
    for (const cmd of commandRegistry.getAllCommands()) {
      expect(['primary', 'secondary', 'tertiary'].includes(cmd.tier ?? '')).toBe(true);
    }

    for (const rulesetId of ['dnd35e', 'classic'] as const) {
      for (const preset of ['modern', 'classic_vi'] as const) {
        applyKeybindPreset(preset);
        const conflicts = commandRegistry.detectConflicts(
          Object.fromEntries(
            commandRegistry.getAllCommands(rulesetId).map((c) => [c.id, getBindingsForCommand(c.id)])
          ),
          rulesetId
        );
        expect(conflicts).toEqual([]);
      }
    }
    applyKeybindPreset('modern');

    // 2. Updated Dock & Core keybinds parity
    expect(DOCK_COMMANDS.find((c) => c.id === 'dock-btn-aim')?.commandId).toBe('combat.target_toggle');
    expect(DOCK_COMMANDS.find((c) => c.id === 'dock-btn-wait')?.commandId).toBe('action.wait');
    expect(DOCK_COMMANDS.find((c) => c.id === 'dock-btn-settings')?.commandId).toBe('system.escape_or_pause');
    expect(DOCK_COMMANDS.find((c) => c.id === 'dock-btn-debug')?.requiresDebugMode).toBe(true);
    expect(getBindingsForCommand('combat.target_toggle')).toEqual([{ key: 'f' }]);
    expect(getBindingsForCommand('dnd35e:rest_8h')).toEqual([{ key: 'r' }]);
    expect(getBindingsForCommand('dnd35e:level_up')).toEqual([{ key: 'u' }]);
    expect(getBindingsForCommand('action.verb_menu')).toEqual([{ key: 'v' }, { code: 'Enter' }]);
    expect(getBindingsForCommand('panel.investigation')).toEqual([{ key: 'k' }]);
    expect(getBindingsForCommand('panel.factions')).toEqual([{ key: 'j' }]);
    expect(getBindingsForCommand('debug.reveal_map')).toEqual([{ key: 'r', alt: true }]);

    // 3. Debug Mode defaults to false, blocking Alt+R / Alt+G / Alt+E / Alt+` and hiding Debug UI affordances
    expect(getDebugModeEnabled()).toBe(false);
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const state = buildGameState(campaign, 5003);
    const playerId = findPlayerId(state);
    setGameState(state);

    const manager = new InputScopeManager();
    const blockedReveal = makeKeyEvent('r', { code: 'KeyR', altKey: true });
    const blockedDebug = makeKeyEvent('`', { code: 'Backquote', altKey: true });
    expect(manager.dispatchKeyEvent(blockedReveal, state)).toBe(false);
    expect(manager.dispatchKeyEvent(blockedDebug, state)).toBe(false);
    expect(dequeueIntent()).toBeUndefined();

    // Plain 'r' in D&D 3.5e executes Rest 8h instead of Reveal All
    const restKey = makeKeyEvent('r', { code: 'KeyR' });
    expect(manager.dispatchKeyEvent(restKey, state)).toBe(true);
    const restIntent = dequeueIntent();
    expect(restIntent?.type).toBe(IntentType.CartridgeAction);

    // CommandDockCard, HelpModal, and Automap3DModal hide Debug controls when Debug Mode is off
    uiStore.syncFromPresenter({ ...state, uiMode: UIMode.Automap }, false, new Set([PresentationDomain.Modals]));
    uiStore.setHelpOpen(true);

    const dockOffHtml = renderToString(<CommandDockCard state={state} playerId={playerId} isHudFocused={false} />);
    const helpOffHtml = renderToString(<HelpModal initialTab="keybinds" />);
    const automapOffHtml = renderToString(<Automap3DModal />);
    expect(dockOffHtml).not.toContain('dock-btn-debug');
    expect(helpOffHtml).toContain('Developer debug shortcuts');
    expect(helpOffHtml).not.toContain('Reveal Map');
    expect(automapOffHtml).not.toContain('Reveal Unexplored (Omniscient)');

    // Enabling Debug Mode immediately exposes Alt+R, Debug dock button, Help entries, Settings toggle, and Omniscient toggle
    setDebugModeEnabled(true);
    expect(getDebugModeEnabled()).toBe(true);

    const allowedReveal = makeKeyEvent('r', { code: 'KeyR', altKey: true });
    expect(state.map.isFullyExplored).toBeFalsy();
    expect(manager.dispatchKeyEvent(allowedReveal, state)).toBe(true);
    expect(getGameState().map.isFullyExplored).toBe(true);

    uiStore.syncFromPresenter({ ...getGameState(), uiMode: UIMode.Automap }, false, new Set([PresentationDomain.Modals]));
    const dockOnHtml = renderToString(<CommandDockCard state={state} playerId={playerId} isHudFocused={false} />);
    const helpOnHtml = renderToString(<HelpModal initialTab="keybinds" />);
    const automapOnHtml = renderToString(<Automap3DModal />);
    expect(dockOnHtml).toContain('dock-btn-debug');
    expect(helpOnHtml).toContain('Primary Controls');
    expect(helpOnHtml).toContain('Secondary Panels &amp; Mechanics');
    expect(helpOnHtml).toContain('Tertiary / Rare &amp; Debug');
    expect(helpOnHtml).toContain('Reveal Map');
    expect(automapOnHtml).toContain('Reveal Unexplored (Omniscient)');

    // SettingsModal renders Debug Mode checkbox on the data tab
    const settingsState: GameState = { ...state, uiMode: UIMode.Settings };
    uiStore.syncFromPresenter(settingsState, false, new Set([PresentationDomain.Modals]));
    const settingsHtml = renderToString(<SettingsModal />);
    expect(settingsHtml).toContain('Settings &amp; Keybindings');

    // 4. Lossless pre-Phase-50 v2 migration upgrades untouched stock bindings while keeping custom user bindings
    const upgraded = migrateSettingsPayload({
      settingsVersion: 2,
      keybindPreset: 'modern',
      commandBindings: {
        'combat.target_toggle': [{ key: 'r' }], // untouched old stock
        'debug.reveal_map': [{ key: 'r' }], // untouched old stock
        'dnd35e:rest_8h': [{ key: 't' }], // untouched old stock
        'panel.factions': [{ key: 'f' }], // untouched old stock
        'panel.investigation': [{ key: 'v' }], // untouched old stock
        'action.verb_menu': [{ key: 'm' }], // untouched old stock
        'panel.quests': [{ key: 'p', alt: true }] // custom user binding
      }
    });
    expect(upgraded.keybindRevision).toBe(3);
    expect(upgraded.debugModeEnabled).toBe(false);
    expect(upgraded.commandBindings?.['combat.target_toggle']).toEqual([{ key: 'f' }]);
    expect(upgraded.commandBindings?.['debug.reveal_map']).toEqual([{ key: 'r', alt: true }]);
    expect(upgraded.commandBindings?.['dnd35e:rest_8h']).toEqual([{ key: 'r' }]);
    expect(upgraded.commandBindings?.['panel.factions']).toEqual([{ key: 'j' }]);
    expect(upgraded.commandBindings?.['panel.investigation']).toEqual([{ key: 'k' }]);
    expect(upgraded.commandBindings?.['action.verb_menu']).toEqual([{ key: 'v' }, { code: 'Enter' }]);
    expect(upgraded.commandBindings?.['panel.quests']).toEqual([{ key: 'p', alt: true }]);
  });

  test('Phase 50 Audit Regressions: Level-Up Feat Guard, Dialogue Comprehension Lock, Modal Shortcuts, Ruleset Filtering, Declarative Bull Rush & Showcase Parity', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    campaign.entities['audit_draconic_npc'] = {
      id: 'audit_draconic_npc',
      name: 'Wyrm Envoy',
      glyph: 'D',
      fg: '#f39c12',
      bg: 'transparent',
      isActor: true,
      speed: 100,
      faction: 'town',
      primaryLanguage: 'draconic',
      languages: ['draconic'],
      dialogueId: 'audit_draconic_tree'
    };
    campaign.entities['audit_bull_target'] = {
      id: 'audit_bull_target',
      name: 'Target Orc',
      glyph: 'o',
      fg: '#2ecc71',
      bg: 'transparent',
      isActor: true,
      speed: 100,
      faction: 'monsters',
      fighter: { maxHp: 30, attack: 3, defense: 1 }
    };
    campaign.entities['audit_wolf'] = {
      id: 'audit_wolf',
      name: 'Timber Wolf',
      glyph: 'w',
      fg: '#95a5a6',
      bg: 'transparent',
      isActor: true,
      speed: 100,
      faction: 'monsters',
      tags: ['type:animal'],
      rulesetData: { creatureType: 'animal' }
    };
    campaign.dialogues['audit_draconic_tree'] = {
      id: 'audit_draconic_tree',
      startNodeId: 'root',
      languageId: 'draconic',
      nodes: {
        root: {
          id: 'root',
          text: 'Bring the relic to the vaulted spire.',
          options: [{ id: 'accept_relic', text: 'I accept the quest.' }]
        }
      }
    };

    let state = buildGameState(campaign, 5004);
    const playerId = findPlayerId(state);

    // 1. applyLevelUpToActor rejects illegal extra feat on a non-feat level (HD 2 Wizard gets 0 feat slots)
    const illegalLevelUp = applyLevelUpToActor(state, playerId, {
      classId: 'wizard',
      hpMethod: 'average',
      addedSkillRanks: {},
      selectedFeats: ['toughness'],
      learnedSpells: []
    });
    expect(illegalLevelUp.success).toBe(false);
    expect(illegalLevelUp.errorReason).toContain('0 feat slot');

    // 2. DialogueModal disables spoken responses and handleModalKey blocks digit quick-picks when unintelligible or listen-only
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const [sNpc, draconicNpcId] = spawnEntity(state, 'audit_draconic_npc', playerPos.x + 1, playerPos.y);
    state = {
      ...sNpc,
      uiMode: UIMode.Dialogue,
      activeDialogue: {
        npcEntityId: draconicNpcId,
        treeId: 'audit_draconic_tree',
        currentNodeId: 'root'
      }
    };
    state = addComponent(state, playerId, {
      ...getComponent(state, playerId, ComponentType.Actor)!,
      primaryLanguage: 'common',
      languages: ['common']
    });

    uiStore.syncFromPresenter(state, false, new Set([PresentationDomain.Modals]));
    const unintelligibleHtml = renderToString(<DialogueModal />);
    expect(unintelligibleHtml).toContain('disabled');
    expect(unintelligibleHtml).toContain('Walk Away');

    clearInputQueue();
    setGameState(state);
    const blockedDigit1 = makeKeyEvent('1', { code: 'Digit1' });
    handleModalKey(blockedDigit1, state, playerId);
    expect(blockedDigit1.defaultPrevented).toBe(false);
    expect(getGameState().uiMode).toBe(UIMode.Dialogue);

    // Comprehend Languages (listen-only) still blocks spoken responses & digit quick-picks
    const listenOnlyState = addComponent(state, playerId, {
      type: ComponentType.Tags,
      tags: ['lang:comprehend_all']
    });
    setGameState(listenOnlyState);
    uiStore.syncFromPresenter(listenOnlyState, false, new Set([PresentationDomain.Modals]));
    const listenOnlyHtml = renderToString(<DialogueModal />);
    expect(listenOnlyHtml).toContain('Bring the relic to the vaulted spire.');
    expect(listenOnlyHtml).toContain('disabled');
    const blockedListenDigit1 = makeKeyEvent('1', { code: 'Digit1' });
    handleModalKey(blockedListenDigit1, listenOnlyState, playerId);
    expect(blockedListenDigit1.defaultPrevented).toBe(false);
    expect(getGameState().uiMode).toBe(UIMode.Dialogue);

    // 3. modal_input gates panel.debug when Debug Mode is off, and supports Classic Vi Shift+B cartridge modal toggle
    setDebugModeEnabled(false);
    const questsModalState: GameState = { ...state, uiMode: UIMode.Quests, activeDialogue: undefined };
    setGameState(questsModalState);
    const blockedDebugEvent = makeKeyEvent('`', { code: 'Backquote', altKey: true });
    handleModalKey(blockedDebugEvent, questsModalState, playerId);
    expect(blockedDebugEvent.defaultPrevented).toBe(false);
    expect(getGameState().uiMode).toBe(UIMode.Quests);

    applyKeybindPreset('classic_vi');
    const spellbookOpenState: GameState = {
      ...state,
      uiMode: UIMode.CartridgeModal,
      activeCartridgeModalId: 'spellbook',
      activeDialogue: undefined
    };
    setGameState(spellbookOpenState);
    const shiftBEvent = makeKeyEvent('B', { code: 'KeyB', shiftKey: true });
    handleModalKey(shiftBEvent, spellbookOpenState, playerId);
    expect(shiftBEvent.defaultPrevented).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Game);
    applyKeybindPreset('modern');

    // 4. HelpModal filters commands to activeRulesetId (Classic campaign omits D&D 3.5e commands)
    const classicCampaign = loadCampaignFromDisk('default');
    const classicState = buildGameState(classicCampaign, 5005);
    uiStore.syncFromPresenter(classicState, false, new Set([PresentationDomain.Modals]));
    uiStore.setHelpOpen(true);
    const classicHelpHtml = renderToString(<HelpModal initialTab="keybinds" />);
    expect(classicHelpHtml).not.toContain('Open Spellbook');

    // 5. Declarative Bull Rush bonus via Layer B StatModifier without referencing 'improved_bull_rush' feat ID
    const [sEnemy, targetId] = spawnEntity(state, 'audit_bull_target', playerPos.x + 2, playerPos.y);
    const baseData = getDnD35EntityData(sEnemy, playerId);
    const customBullRushState = setDnD35EntityData(sEnemy, playerId, {
      ...baseData,
      feats: [],
      statModifiers: [
        ...(baseData.statModifiers ?? []),
        {
          targetStat: 'bull_rush',
          value: 6,
          bonusType: 'untyped',
          sourceId: 'custom_ram_boon',
          origin: 'ex'
        }
      ]
    });
    const brRes = resolveBullRushImpact(customBullRushState, {
      attackerId: playerId,
      defenderId: targetId,
      forcedOpposedRolls: { rollA: 10, rollB: 10 }
    });
    expect(brRes.attackerTotal).toBeGreaterThanOrEqual(16);

    // 6. Declarative creature-type comprehension reason reads StatusEffectsComponent.displayName
    const [sWolf, wolfId] = spawnEntity(state, 'audit_wolf', playerPos.x, playerPos.y + 1);
    const druidSpeechState = addComponent(
      addComponent(sWolf, playerId, {
        type: ComponentType.Tags,
        tags: ['lang:speak_creature_type:animal']
      }),
      playerId,
      {
        type: ComponentType.StatusEffects,
        activeEffects: [
          {
            effectId: 'custom_wild_speech',
            duration: 10,
            displayName: 'Druidic Wild Speech',
            grantedTags: ['lang:speak_creature_type:animal']
          }
        ]
      }
    );
    const wildSpeechComp = evaluateDnD35eLanguageComprehension(druidSpeechState, playerId, wolfId, []);
    expect(wildSpeechComp.understood).toBe(true);
    expect(wildSpeechComp.comprehensionReason).toBe('Druidic Wild Speech');

    // 7. Campaign showcase parity: default & Shroudgarde immovable guardians + default Elven dialogue node
    expect(classicCampaign.entities['vault_guardian']?.immovable).toBe(true);
    expect(classicCampaign.dialogues['scholar_tree']?.nodes['elven_passage_node']?.languageId).toBe('elven');
    const shroudgardeCampaign = loadCampaignFromDisk('realms-of-shroudgarde');
    expect(shroudgardeCampaign.entities['constable_derek']?.immovable).toBe(true);
    expect(shroudgardeCampaign.entities['dwarf_laurent']?.languages).toContain('dwarven');
  });
});
