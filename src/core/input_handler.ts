import { type GameState, type EntityId, UIMode, EngineMode } from '../types/game-state.types.ts';
import {
  ComponentType,
  type InventoryComponent,
  type EquipmentComponent,
  type ItemComponent
} from '../types/components.types.ts';
import { getComponent } from './ecs.ts';
import { isAction, type ActionType, rebindAction } from './settings.ts';
import { queuePlayerIntent, setGameState } from './game-loop.ts';
import { addMessage, MessageLogCategory } from '../systems/message.system.ts';
import { getDirectionDelta } from '../utils/direction.ts';
import { Direction } from '../utils/direction.ts';
import { renderSettingsMenu } from '../rendering/ui.ts';
import { getValidVerbsForTarget } from '../systems/apply.system.ts';
import type { ApplyIntentTarget } from '../types/intents/interaction.intents.ts';

import {
  createMoveAction,
  createWaitAction,
  createToggleSettingsAction,
  createToggleFactionsAction,
  createToggleQuestsAction,
  createToggleInvestigationAction,
  createTogglePauseAction,
  createToggleDebugAction,
  createToggleDossierAction,
  createToggleLedgerAction
} from '../actions/core.actions.ts';
import { createApplyAction } from '../actions/interaction.actions.ts';
import {
  createDebugRevealMapAction,
  createDebugGodModeAction,
  createDebugSpawnEntityAction
} from '../actions/debug.actions.ts';
import {
  createToggleTargetingAction,
  createMoveTargetAction,
  createFireAimedAction
} from '../actions/targeting.actions.ts';
import { createToggleInspectAction, createMoveInspectAction } from '../actions/inspect.actions.ts';
import {
  createPickUpAction,
  createDropAction,
  createToggleInventoryAction,
  createEquipItemAction,
  createUnequipItemAction
} from '../actions/inventory.actions.ts';

let lastMoveTime = 0;
const MOVE_THROTTLE_MS = 200;

function handleSmartInteraction(
  state: GameState,
  playerEntityId: EntityId,
  target: ApplyIntentTarget,
  toolEntityId?: EntityId
): void {
  const validVerbs = getValidVerbsForTarget(state, playerEntityId, target, toolEntityId);

  if (validVerbs.length === 0) {
    setGameState(addMessage(state, `Nothing interesting to interact with there.`, MessageLogCategory.System));
    return;
  }

  // If there's exactly 1 verb, or we want to smartly execute the first (highest priority? Verb array isn't sorted by priority yet, but maybe we just take the first).
  // The plan says: if exactly 1 verb -> execute.
  if (validVerbs.length === 1 && validVerbs[0] !== undefined) {
    queuePlayerIntent(createApplyAction(playerEntityId, validVerbs[0], target, toolEntityId));
    return;
  }

  // Otherwise, open verb menu
  setGameState({
    ...state,
    uiMode: UIMode.VerbMenu,
    verbMenu:
      toolEntityId !== undefined
        ? { target, toolEntityId, availableVerbs: validVerbs }
        : { target, availableVerbs: validVerbs }
  });
}

/**
 * Entry point for keyboard input processing in the game, routing keystrokes based on the active UI mode.
 */
export function handleKeyDown(
  event: KeyboardEvent,
  currentState: GameState,
  rebindingAction: ActionType | null,
  setRebindingAction: (action: ActionType | null) => void
): void {
  const rebindingOverlay = document.getElementById('rebinding-overlay');

  if (rebindingAction) {
    event.preventDefault();
    if (event.key === 'Escape') {
      setRebindingAction(null);
      rebindingOverlay?.classList.add('hidden');
      return;
    }
    // Only bind single characters, arrows, space, enter, etc. Ignore modifiers alone.
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;

    rebindAction(rebindingAction, event.key);
    setRebindingAction(null);
    rebindingOverlay?.classList.add('hidden');
    renderSettingsMenu(currentState);
    return;
  }

  if (
    currentState.uiMode === UIMode.MainMenu ||
    currentState.uiMode === UIMode.GameOver ||
    currentState.uiMode === UIMode.CampaignSelect
  ) {
    return; // Menu buttons handle input
  }

  const playerEntityId = currentState.entities.find((id) => getComponent(currentState, id, ComponentType.Player)) as
    | EntityId
    | undefined;
  if (!playerEntityId) return;

  if (currentState.uiMode === UIMode.VerbMenu) {
    if (event.key === 'Escape') {
      event.preventDefault();
      // Revert to Game mode, targeting mode remains if it was active
      setGameState({ ...currentState, uiMode: UIMode.Game, verbMenu: undefined });
      return;
    }

    const { availableVerbs, target, toolEntityId } = currentState.verbMenu!;

    // Check 1-9
    const num = parseInt(event.key, 10);
    if (!isNaN(num) && num > 0 && num <= availableVerbs.length) {
      const verb = availableVerbs[num - 1];
      if (verb) {
        event.preventDefault();
        queuePlayerIntent(createApplyAction(playerEntityId, verb, target, toolEntityId));
        setGameState({ ...currentState, uiMode: UIMode.Game, verbMenu: undefined });
        return;
      }
    }

    // Enter = first verb
    if (event.key === 'Enter' && availableVerbs.length > 0) {
      const verb = availableVerbs[0];
      if (verb) {
        event.preventDefault();
        queuePlayerIntent(createApplyAction(playerEntityId, verb, target, toolEntityId));
        setGameState({ ...currentState, uiMode: UIMode.Game, verbMenu: undefined });
        return;
      }
    }

    return; // Block other input
  }

  const isTargeting = currentState.targetingMode?.active;
  const isInventoryOpen = currentState.uiMode === UIMode.Inventory;

  const isSettingsOpen = currentState.uiMode === UIMode.Settings;
  const isFactionsOpen = currentState.uiMode === UIMode.Factions;
  const isQuestsOpen = currentState.uiMode === UIMode.Quests;
  const isInvestigationOpen = currentState.uiMode === UIMode.Investigation;
  const isDebugOpen = currentState.uiMode === UIMode.Debug;
  const isDossierOpen = currentState.uiMode === UIMode.Dossier;
  const isLedgerOpen = currentState.uiMode === UIMode.Ledger;

  if (event.key === '`') {
    event.preventDefault();
    queuePlayerIntent(createToggleDebugAction(playerEntityId));
    return;
  }

  if (isDebugOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      queuePlayerIntent(createToggleDebugAction(playerEntityId));
    }
    return;
  }

  if (isSettingsOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      queuePlayerIntent(createToggleSettingsAction(playerEntityId));
    }
    return;
  }

  if (isFactionsOpen) {
    if (event.key === 'Escape' || isAction(event, 'factions')) {
      event.preventDefault();
      queuePlayerIntent(createToggleFactionsAction(playerEntityId));
    }
    return;
  }

  if (isQuestsOpen) {
    if (event.key === 'Escape' || isAction(event, 'quests')) {
      event.preventDefault();
      queuePlayerIntent(createToggleQuestsAction(playerEntityId));
    }
    return;
  }

  if (isInvestigationOpen) {
    if (event.key === 'Escape' || isAction(event, 'investigation')) {
      event.preventDefault();
      queuePlayerIntent(createToggleInvestigationAction(playerEntityId));
    }
    return;
  }

  if (isDossierOpen) {
    if (event.key === 'Escape' || isAction(event, 'dossier')) {
      event.preventDefault();
      queuePlayerIntent(createToggleDossierAction(playerEntityId));
    }
    return;
  }

  if (isLedgerOpen) {
    if (event.key === 'Escape' || isAction(event, 'ledger')) {
      event.preventDefault();
      queuePlayerIntent(createToggleLedgerAction(playerEntityId));
    }
    return;
  }

  // Inventory panel: letter keys select a slot, Escape closes
  if (isInventoryOpen) {
    if (event.key === 'Escape') {
      event.preventDefault();
      queuePlayerIntent(createToggleInventoryAction(playerEntityId));
      return;
    }

    // Ignore multi-character keys or non a-z keys
    if (event.key.length !== 1) return;
    const code = event.key.toLowerCase().charCodeAt(0);
    if (code < 97 || code > 122) return;

    event.preventDefault();
    const slotIndex = code - 97;

    const inventory = getComponent(currentState, playerEntityId, ComponentType.Inventory) as
      | InventoryComponent
      | undefined;
    if (!inventory || slotIndex >= inventory.items.length) return;

    const itemEntityId = inventory.items[slotIndex];
    const equipment = getComponent(currentState, playerEntityId, ComponentType.Equipment) as
      | EquipmentComponent
      | undefined;
    const itemComp = itemEntityId
      ? (getComponent(currentState, itemEntityId, ComponentType.Item) as ItemComponent | undefined)
      : undefined;
    const def = itemComp ? currentState.campaign.items[itemComp.itemId] : undefined;

    let itemName = 'item';
    if (def && itemComp) {
      const isIdentified = currentState.identifiedItems.has(itemComp.itemId);
      itemName = isIdentified
        ? def.name
        : (currentState.itemUnidentifiedNames.get(itemComp.itemId) ?? def.unidentifiedName ?? itemComp.itemId);
    }

    if (event.shiftKey) {
      setGameState(addMessage(currentState, `Queued: Drop ${itemName}`, MessageLogCategory.System));
      queuePlayerIntent(createDropAction(playerEntityId, slotIndex));
      return;
    }

    if (event.altKey) {
      if (itemEntityId && equipment && def?.equippable) {
        const equippedSlot = equipment.slots.find((s) => s.equippedItem === itemEntityId);
        if (equippedSlot) {
          setGameState(addMessage(currentState, `Queued: Unequip ${itemName}`, MessageLogCategory.System));
          queuePlayerIntent(createUnequipItemAction(playerEntityId, equippedSlot.id));
          return;
        }
      }

      setGameState(addMessage(currentState, `Queued: Equip ${itemName}`, MessageLogCategory.System));
      queuePlayerIntent(createEquipItemAction(playerEntityId, slotIndex));
      return;
    }

    setGameState(addMessage(currentState, `Queued: Use ${itemName}`, MessageLogCategory.System));
    if (itemEntityId) {
      queuePlayerIntent(createApplyAction(playerEntityId, 'apply', { type: 'item', itemEntityId }));
    }
    return;
  }

  // Debug keys
  if (isAction(event, 'debug_reveal_map')) {
    event.preventDefault();
    queuePlayerIntent(createDebugRevealMapAction(playerEntityId));
    return;
  }
  if (isAction(event, 'debug_god_mode')) {
    event.preventDefault();
    queuePlayerIntent(createDebugGodModeAction(playerEntityId));
    return;
  }
  if (isAction(event, 'debug_spawn_entity')) {
    event.preventDefault();
    queuePlayerIntent(createDebugSpawnEntityAction(playerEntityId));
    return;
  }

  // Item interaction
  if (isAction(event, 'pick_up')) {
    event.preventDefault();
    queuePlayerIntent(createPickUpAction(playerEntityId));
    return;
  }

  if (isAction(event, 'inventory')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInventoryAction(playerEntityId));
    return;
  }

  if (isAction(event, 'factions')) {
    event.preventDefault();
    queuePlayerIntent(createToggleFactionsAction(playerEntityId));
    return;
  }

  if (isAction(event, 'quests')) {
    event.preventDefault();
    queuePlayerIntent(createToggleQuestsAction(playerEntityId));
    return;
  }

  if (isAction(event, 'investigation')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInvestigationAction(playerEntityId));
    return;
  }

  if (isAction(event, 'dossier')) {
    event.preventDefault();
    queuePlayerIntent(createToggleDossierAction(playerEntityId));
    return;
  }

  if (isAction(event, 'ledger')) {
    event.preventDefault();
    queuePlayerIntent(createToggleLedgerAction(playerEntityId));
    return;
  }

  // Handle targeting specific keys
  if (isAction(event, 'target_toggle')) {
    event.preventDefault();
    queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    return;
  }

  if (isTargeting && isAction(event, 'target_confirm')) {
    event.preventDefault();
    const context = currentState.targetingMode?.context;

    if (context?.verb === 'throw' && context.toolEntityId) {
      queuePlayerIntent(
        createApplyAction(
          playerEntityId,
          'throw',
          { type: 'tile', x: currentState.targetingMode!.x, y: currentState.targetingMode!.y },
          context.toolEntityId
        )
      );
      queuePlayerIntent(createToggleTargetingAction(playerEntityId));
    } else {
      queuePlayerIntent(createFireAimedAction(playerEntityId));
    }
    return;
  }

  if (isTargeting && isAction(event, 'verb_menu')) {
    event.preventDefault();
    // Open verb menu for targeted tile
    handleSmartInteraction(currentState, playerEntityId, {
      type: 'tile',
      x: currentState.targetingMode!.x,
      y: currentState.targetingMode!.y
    });
    return;
  }

  // Handle inspect specific keys
  if (isAction(event, 'inspect')) {
    event.preventDefault();
    queuePlayerIntent(createToggleInspectAction(playerEntityId));
    return;
  }

  let direction: Direction | undefined;
  if (isAction(event, 'move_north')) direction = Direction.North;
  else if (isAction(event, 'move_south')) direction = Direction.South;
  else if (isAction(event, 'move_east')) direction = Direction.East;
  else if (isAction(event, 'move_west')) direction = Direction.West;

  if (direction !== undefined) {
    event.preventDefault(); // Prevent standard page scroll

    // Throttle movement in turn-based mode to prevent teleporting/spam
    if (currentState.engineMode === EngineMode.TurnBased) {
      const now = performance.now();
      if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
      lastMoveTime = now;
    }

    const { dx, dy } = getDirectionDelta(direction);

    if (isTargeting) {
      queuePlayerIntent(createMoveTargetAction(playerEntityId, dx, dy));
    } else if (currentState.inspectMode?.active) {
      queuePlayerIntent(createMoveInspectAction(playerEntityId, dx, dy));
    } else {
      queuePlayerIntent(createMoveAction(playerEntityId, dx, dy));
    }
  } else if (isAction(event, 'wait')) {
    event.preventDefault();
    if (currentState.engineMode === EngineMode.RTwP) {
      queuePlayerIntent(createTogglePauseAction(playerEntityId));
    } else {
      // Throttle waiting in turn-based mode
      const now = performance.now();
      if (now - lastMoveTime < MOVE_THROTTLE_MS) return;
      lastMoveTime = now;

      queuePlayerIntent(createWaitAction(playerEntityId));
    }
  } else if (isAction(event, 'interact')) {
    event.preventDefault();
    if (isTargeting) {
      handleSmartInteraction(currentState, playerEntityId, {
        type: 'tile',
        x: currentState.targetingMode!.x,
        y: currentState.targetingMode!.y
      });
    } else if (currentState.inspectMode?.active) {
      handleSmartInteraction(currentState, playerEntityId, {
        type: 'tile',
        x: currentState.inspectMode.x,
        y: currentState.inspectMode.y
      });
    } else {
      const pos = getComponent(currentState, playerEntityId, ComponentType.Position);
      if (pos) {
        const spatialIndexKey = `${pos.x},${pos.y}`;
        const entitiesOnTile = currentState.spatialIndex.get(spatialIndexKey) ?? [];
        const interactableEntity = entitiesOnTile.find((id) => id !== playerEntityId);

        if (interactableEntity) {
          handleSmartInteraction(currentState, playerEntityId, { type: 'entity', entityId: interactableEntity });
        } else {
          handleSmartInteraction(currentState, playerEntityId, { type: 'tile', x: pos.x, y: pos.y });
        }
      }
    }
  } else if (isAction(event, 'verb_menu')) {
    event.preventDefault();
    const pos = getComponent(currentState, playerEntityId, ComponentType.Position);
    if (pos) {
      const spatialIndexKey = `${pos.x},${pos.y}`;
      const entitiesOnTile = currentState.spatialIndex.get(spatialIndexKey) ?? [];
      const interactableEntity = entitiesOnTile.find((id) => id !== playerEntityId);

      if (interactableEntity) {
        handleSmartInteraction(currentState, playerEntityId, { type: 'entity', entityId: interactableEntity });
      } else {
        handleSmartInteraction(currentState, playerEntityId, { type: 'tile', x: pos.x, y: pos.y });
      }
    }
  }
}
