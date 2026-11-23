import { afterEach, describe, expect, it } from 'bun:test';
import { addComponent, getComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { handleGameplayOrTargetingKey, resetMoveThrottle } from '../src/core/input/gameplay_input.ts';
import { ACTION_TO_COMMAND_ID, migrateV1KeybindsToV2 } from '../src/core/input/keybind_migration.ts';
import { clearInputQueue } from '../src/core/input_queue.ts';
import { cancelPendingSave } from '../src/core/persistence_service.ts';
import { clearScheduler, initEngine } from '../src/core/scheduler.ts';
import { buildInspectTooltip } from '../src/rendering/inspect_tooltip.ts';
import { getCartridgeUI } from '../src/rendering/ui/cartridge_ui_registry.ts';
import { registerDnD35eUIAdapter } from '../src/rendering/ui/cartridges/dnd35e/dnd35e_ui_registration.tsx';
import { filterFuzzyVerbOptions, scoreFuzzyVerbMatch } from '../src/rendering/ui/hud/VerbMenuPopover.tsx';
import { getRuleset } from '../src/rulesets/registry.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { validateDnD35eClassesRacesTemplates } from '../src/rulesets/dnd35e/validation/class_race_validator.ts';
import { REACH_PROBE_ITEM_TAG } from '../src/systems/durability.system.ts';
import {
  computeInteractionTargetDistanceTiles,
  getValidVerbsForTarget,
  isTargetWithinInteractionReach,
  processApplyIntent,
  resolveActorInteractionReachTiles
} from '../src/systems/apply.system.ts';
import {
  ComponentType,
  type InventoryComponent,
  type PositionComponent,
  type TagsComponent
} from '../src/types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../src/types/game-state.types.ts';
import type { VerbOption } from '../src/types/intents/interaction.intents.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import type { ValidationError } from '../src/types/ruleset.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function makeKeyEvent(key: string): KeyboardEvent {
  let prevented = false;
  return {
    key,
    code: key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: (): void => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    }
  } as unknown as KeyboardEvent;
}

function getPlayerId(state: GameState): EntityId {
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) throw new Error('Player entity missing from test state');
  return playerId;
}

describe('Milestone 166: Post-Phase-43 UI, Inspect Hook, Look+Enter Reach & Fuzzy VerbMenu', () => {
  afterEach(() => {
    clearInputQueue();
    clearScheduler();
    cancelPendingSave();
    resetMoveThrottle();
  });

  it('projects D&D 3.5e Inspect stats via RulesetContract while keeping Classic fallback & Patience', () => {
    const dndCampaign = loadCampaignFromDisk('dnd35e-crypt');
    const dndState = buildGameState(dndCampaign);
    const dndPlayerId = getPlayerId(dndState);
    const dndPos = getComponent(dndState, dndPlayerId, ComponentType.Position) as PositionComponent;

    const dndTooltip = buildInspectTooltip(
      {
        ...dndState,
        map: { ...dndState.map, isFullyExplored: true },
        inspectMode: { active: true, x: dndPos.x, y: dndPos.y }
      },
      0,
      0,
      dndState.map.width,
      dndState.map.height
    );
    expect(dndTooltip.active).toBe(true);
    const labels = dndTooltip.sections.filter((s) => s.type === 'stat').map((s) => s.label);
    expect(labels).toContain('HP');
    expect(labels).toContain('AC');
    expect(labels).toContain('BAB');
    expect(labels).toContain('Saves');
    expect(labels).not.toContain('ATK');
    expect(labels).not.toContain('DEF');

    const acStat = dndTooltip.sections.find((s) => s.type === 'stat' && s.label === 'AC');
    expect(acStat?.value).toContain('(T ');
    expect(acStat?.value).toContain('/ FF ');

    // Memory patience remains displayed alongside D&D 3.5e inspect stats
    const dndNpcWithMemory = addComponent(dndState, dndPlayerId, {
      type: ComponentType.Memory,
      visitedLocations: {},
      grudges: [],
      patience: 2,
      patienceThreshold: 5
    });
    const patienceTooltip = buildInspectTooltip(
      {
        ...dndNpcWithMemory,
        map: { ...dndNpcWithMemory.map, isFullyExplored: true },
        inspectMode: { active: true, x: dndPos.x, y: dndPos.y }
      },
      0,
      0,
      dndNpcWithMemory.map.width,
      dndNpcWithMemory.map.height
    );
    expect(patienceTooltip.sections.some((s) => s.type === 'stat' && s.label === 'Patience')).toBe(true);

    const classicCampaign = loadCampaignFromDisk('default');
    const classicState = buildGameState(classicCampaign);
    const classicPlayerId = getPlayerId(classicState);
    const classicPos = getComponent(classicState, classicPlayerId, ComponentType.Position) as PositionComponent;

    const classicTooltip = buildInspectTooltip(
      {
        ...classicState,
        map: { ...classicState.map, isFullyExplored: true },
        inspectMode: { active: true, x: classicPos.x, y: classicPos.y }
      },
      0,
      0,
      classicState.map.width,
      classicState.map.height
    );
    const classicLabels = classicTooltip.sections.filter((s) => s.type === 'stat').map((s) => s.label);
    expect(classicLabels).toContain('ATK');
    expect(classicLabels).toContain('DEF');
  });

  it('enforces touch/melee interaction reach and supports reach_probe tools & interaction_reach_tiles modifiers', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const playerId = getPlayerId(state);
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    const chestX = playerPos.x + 1;
    const chestY = playerPos.y;
    let adjacentChestId: EntityId;
    [state, adjacentChestId] = spawnEntity(state, 'wooden_chest', chestX, chestY);

    let distantChestId: EntityId;
    [state, distantChestId] = spawnEntity(state, 'wooden_chest', playerPos.x + 3, playerPos.y);

    expect(
      computeInteractionTargetDistanceTiles(state, playerId, { type: 'entity', entityId: adjacentChestId })
    ).toBe(1);
    expect(
      computeInteractionTargetDistanceTiles(state, playerId, { type: 'entity', entityId: distantChestId })
    ).toBe(3);

    expect(
      isTargetWithinInteractionReach(state, playerId, 'open', { type: 'entity', entityId: adjacentChestId })
    ).toBe(true);
    expect(
      isTargetWithinInteractionReach(state, playerId, 'open', { type: 'entity', entityId: distantChestId })
    ).toBe(false);

    const distantVerbs = getValidVerbsForTarget(state, playerId, { type: 'entity', entityId: distantChestId });
    expect(distantVerbs).not.toContain('open');
    expect(distantVerbs).not.toContain('search');

    const failOpen = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'open',
      target: { type: 'entity', entityId: distantChestId }
    });
    expect(failOpen.success).toBe(false);
    expect(failOpen.state.messages.some((m) => m.text === 'That is out of reach.')).toBe(true);

    // 2 tiles away: reach_probe item extends search/disarm reach to 2 tiles
    let tile2ChestId: EntityId;
    [state, tile2ChestId] = spawnEntity(state, 'wooden_chest', playerPos.x + 2, playerPos.y);
    expect(isTargetWithinInteractionReach(state, playerId, 'search', { type: 'entity', entityId: tile2ChestId })).toBe(
      false
    );

    let probeItemId: EntityId;
    [state, probeItemId] = spawnItem(state, 'torch', playerPos.x, playerPos.y);
    const probeTags = (getComponent(state, probeItemId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
    state = addComponent(state, probeItemId, {
      type: ComponentType.Tags,
      tags: [...probeTags, REACH_PROBE_ITEM_TAG]
    });
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
    state = addComponent(state, playerId, {
      type: ComponentType.Inventory,
      items: [...(inv?.items ?? []), probeItemId],
      maxCapacity: inv?.maxCapacity ?? 20
    });

    expect(resolveActorInteractionReachTiles(state, playerId, 'search')).toBe(2);
    expect(isTargetWithinInteractionReach(state, playerId, 'search', { type: 'entity', entityId: tile2ChestId })).toBe(
      true
    );
    expect(isTargetWithinInteractionReach(state, playerId, 'open', { type: 'entity', entityId: tile2ChestId })).toBe(
      false
    );

    // Declarative 'interaction_reach_tiles' StatModifier (e.g. Mage Hand) extends reach dynamically
    const dndData = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dndData,
      statModifiers: [
        ...(dndData.statModifiers ?? []),
        {
          id: 'test_mage_hand_reach',
          source: 'spell:mage_hand',
          sourcePath: 'spell:mage_hand',
          targetStat: 'interaction_reach_tiles',
          bonusType: 'untyped',
          value: 4,
          active: true
        }
      ]
    });

    expect(resolveActorInteractionReachTiles(state, playerId, 'open')).toBeGreaterThanOrEqual(5);
    expect(
      isTargetWithinInteractionReach(state, playerId, 'open', { type: 'entity', entityId: distantChestId })
    ).toBe(true);
    const extendedVerbs = getValidVerbsForTarget(state, playerId, { type: 'entity', entityId: distantChestId });
    expect(extendedVerbs).toContain('open');
  });

  it('targets Look reticle coordinates on Enter instead of player tile and blocks out-of-reach targets cleanly', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    let state = buildGameState(campaign);
    const playerId = getPlayerId(state);
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    let adjChestId: EntityId;
    [state, adjChestId] = spawnEntity(state, 'wooden_chest', playerPos.x + 1, playerPos.y);
    let farChestId: EntityId;
    [state, farChestId] = spawnEntity(state, 'wooden_chest', playerPos.x + 4, playerPos.y);

    expect(adjChestId).toBeDefined();
    expect(farChestId).toBeDefined();

    initEngine();
    clearInputQueue();

    // 1) Look at distant chest (+4, 0) and press Enter -> logs 'That is out of reach.' and keeps inspectMode active
    setGameState({
      ...state,
      isSandbox: true,
      inspectMode: { active: true, x: playerPos.x + 4, y: playerPos.y }
    });
    const farHandled = handleGameplayOrTargetingKey(makeKeyEvent('Enter'), getGameState(), playerId);
    expect(farHandled).toBe(true);
    const afterFar = getGameState();
    expect(afterFar.inspectMode?.active).toBe(true);
    expect(afterFar.messages.some((m) => m.text === 'That is out of reach.')).toBe(true);

    // 2) Look at adjacent chest (+1, 0) and press Enter -> opens VerbMenu for the adjacent chest
    setGameState({
      ...state,
      isSandbox: true,
      inspectMode: { active: true, x: playerPos.x + 1, y: playerPos.y }
    });
    const adjHandled = handleGameplayOrTargetingKey(makeKeyEvent('Enter'), getGameState(), playerId);
    expect(adjHandled).toBe(true);
    const afterAdj = getGameState();
    expect(afterAdj.inspectMode).toBeUndefined();
    expect(afterAdj.uiMode).toBe(UIMode.VerbMenu);
    expect(afterAdj.verbMenu?.target).toEqual({ type: 'entity', entityId: adjChestId });
  });

  it('filters VerbMenu strictly to valid options and ranks fuzzy search matches deterministically', () => {
    const options: ReadonlyArray<VerbOption> = [
      { verb: 'kick', valid: true },
      { verb: 'open', valid: true },
      { verb: 'unlock', valid: false, disabledReason: 'Locked' },
      { verb: 'inspect', valid: true },
      { verb: 'search', valid: true }
    ];

    const allValid = filterFuzzyVerbOptions(options, '');
    expect(allValid.map((o) => o.verb)).toEqual(['kick', 'open', 'inspect', 'search']);

    const opMatch = filterFuzzyVerbOptions(options, 'op');
    expect(opMatch.map((o) => o.verb)).toEqual(['open']);

    // Invalid 'unlock' is excluded even when query matches it
    expect(filterFuzzyVerbOptions(options, 'un')).toEqual([]);

    // Prefix > substring > subsequence ordering
    expect(scoreFuzzyVerbMatch('se', 'search')!).toBeGreaterThan(scoreFuzzyVerbMatch('se', 'inspect')!);
    expect(filterFuzzyVerbOptions(options, 'src').map((o) => o.verb)).toEqual(['search']);
  });

  it('enforces complete class featureDetails in validator & removes duplicate D&D 3.5e dock Sheet button', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const validationErrors = getRuleset('dnd35e').validateCampaignRuleset?.(campaign) ?? [];
    const featureDetailErrors = validationErrors.filter((e) =>
      e.message.includes('missing from both class featureDetails and systemContent.feats')
    );
    expect(featureDetailErrors).toEqual([]);

    const sys = getDnD35SystemContent(campaign);
    expect(sys).toBeDefined();
    if (sys) {
      const brokenSys = {
        ...sys,
        classes: {
          ...sys.classes,
          fighter: {
            ...sys.classes.fighter!,
            progression: sys.classes.fighter!.progression.map((row, idx) =>
              idx === 0 ? { ...row, features: [...row.features, 'nonexistent_missing_detail_feat'] } : row
            )
          }
        }
      };
      const errors: ValidationError[] = [];
      validateDnD35eClassesRacesTemplates(brokenSys, errors);
      expect(
        errors.some((e) => e.message.includes('nonexistent_missing_detail_feat'))
      ).toBe(true);
    }

    // D&D 3.5e UI dock keeps single Pack [I] button and removes separate Sheet [C]
    registerDnD35eUIAdapter();
    const dockItems = getCartridgeUI('dnd35e')?.dockCommands ?? [];
    const ids = dockItems.map((item) => item.id);
    expect(ids).not.toContain('dnd_char_sheet');

    // Legacy keybindings with character_sheet migrate cleanly to panel.inventory [I]
    expect(ACTION_TO_COMMAND_ID['character_sheet']).toBe('panel.inventory');
    const migrated = migrateV1KeybindsToV2({ character_sheet: ['c'], inventory: ['i'] });
    expect(migrated['dnd35e:char_sheet']).toBeUndefined();
    expect(migrated['panel.inventory']?.some((chord) => chord.key === 'i')).toBe(true);
  });
});
