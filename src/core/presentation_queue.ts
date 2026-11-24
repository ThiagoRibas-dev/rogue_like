import {
  ComponentType,
  type EquipmentComponent,
  type InventoryComponent,
  type PositionComponent
} from '../types/components.types.ts';
import { type EntityId, type GameMap, type GameState, UIMode } from '../types/game-state.types.ts';
import { toMapTileKey } from '../map/map_accessor.ts';
import { recordDomainMarkedDirty } from './performance.ts';

/**
 * Granular UI & rendering domains tracked for selective frame presentation.
 */
export enum PresentationDomain {
  Map = 'Map', // Canvas map tiles, fog of war, camera scrolling
  Entities = 'Entities', // Canvas visible entities, animations
  HUD = 'HUD', // Player stats, HP, energy, turns, RTwP controls
  Log = 'Log', // Message log panel
  Inventory = 'Inventory', // Inventory, equipment panel
  Modals = 'Modals', // Dialogues, verb menu, targeting, inspect, dossiers, factions, quests
  Editor = 'Editor', // Campaign creator and area editor views
  Debug = 'Debug', // Debug overlay, historical ledger UI
  VFX = 'VFX' // Ephemeral visual effects, floating text
}

/**
 * Ephemeral visual or audio event to be presented on the subsequent frame.
 */
export interface PresentationEvent {
  readonly type: 'floating_text' | 'screen_shake' | 'sound_cue';
  readonly payload: unknown;
}

interface ComponentDiffResult {
  readonly entitiesDirty: boolean;
  readonly hudDirty: boolean;
  readonly inventoryDirty: boolean;
}

function isFootprintInFov(
  pos: PositionComponent | undefined,
  map: Readonly<GameMap>,
  fov: ReadonlySet<number>
): boolean {
  if (!pos) return false;
  const w = pos.footprintWidth ?? 1;
  const h = pos.footprintHeight ?? 1;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (fov.has(toMapTileKey(map, pos.x + dx, pos.y + dy))) {
        return true;
      }
    }
  }
  return false;
}

function collectPlayerOwnedItems(compMap: Readonly<Record<string, unknown>> | undefined, out: Set<EntityId>): void {
  if (!compMap) return;
  const inv = compMap[ComponentType.Inventory] as InventoryComponent | undefined;
  if (inv) {
    for (const itemId of inv.items) {
      out.add(itemId);
    }
  }
  const equip = compMap[ComponentType.Equipment] as EquipmentComponent | undefined;
  if (equip) {
    for (const slot of equip.slots) {
      if (slot.equippedItem !== null) {
        out.add(slot.equippedItem);
      }
    }
  }
}

function classifyPresentationComponentDiff(prev: GameState, next: GameState): ComponentDiffResult {
  if (prev.entities !== next.entities) {
    return { entitiesDirty: true, hudDirty: true, inventoryDirty: true };
  }

  let entitiesDirty = next.map.isFullyExplored === true && prev.components !== next.components;
  let hudDirty = prev.cachedFov !== next.cachedFov;
  let inventoryDirty =
    prev.identifiedItems !== next.identifiedItems || prev.itemUnidentifiedNames !== next.itemUnidentifiedNames;

  let playerId: EntityId | undefined;
  for (const id of next.entities) {
    if (next.components.get(id)?.[ComponentType.Player] !== undefined) {
      playerId = id;
      break;
    }
  }

  const playerItemIds = new Set<EntityId>();
  if (playerId !== undefined) {
    collectPlayerOwnedItems(prev.components.get(playerId), playerItemIds);
    collectPlayerOwnedItems(next.components.get(playerId), playerItemIds);
  }

  for (const id of next.entities) {
    const pMap = prev.components.get(id);
    const nMap = next.components.get(id);
    if (pMap === nMap) continue;

    if (id === playerId) {
      entitiesDirty = true;
      hudDirty = true;
      inventoryDirty = true;
      continue;
    }

    if (playerItemIds.has(id)) {
      hudDirty = true;
      inventoryDirty = true;
      continue;
    }

    if (pMap?.[ComponentType.Field] !== undefined || nMap?.[ComponentType.Field] !== undefined) {
      entitiesDirty = true;
      hudDirty = true;
      continue;
    }

    if (pMap?.[ComponentType.ControllerLink] !== undefined || nMap?.[ComponentType.ControllerLink] !== undefined) {
      hudDirty = true;
    }

    const pPos = pMap?.[ComponentType.Position] as PositionComponent | undefined;
    const nPos = nMap?.[ComponentType.Position] as PositionComponent | undefined;
    if (
      isFootprintInFov(nPos, next.map, next.cachedFov) ||
      isFootprintInFov(pPos, next.map, next.cachedFov) ||
      isFootprintInFov(pPos, prev.map, prev.cachedFov)
    ) {
      entitiesDirty = true;
      hudDirty = true;
    }
  }

  if (!entitiesDirty && prev.spatialIndex !== next.spatialIndex && prev.components === next.components) {
    entitiesDirty = true;
  }

  return { entitiesDirty, hudDirty, inventoryDirty };
}

/**
 * Queue and tracker managing dirty rendering domains and ephemeral presentation events.
 */
class PresentationEventQueue {
  private dirtyDomains = new Set<PresentationDomain>();
  private events: PresentationEvent[] = [];

  /**
   * Flags a specific domain for redraw on the next presentation frame.
   * @param domain Domain to mark dirty.
   */
  markDirty(domain: PresentationDomain): void {
    this.dirtyDomains.add(domain);
    recordDomainMarkedDirty(domain);
  }

  /**
   * Flags all domains for redraw (e.g. initial load, area transitions, UI mode switches).
   */
  markAllDirty(): void {
    for (const domain of Object.values(PresentationDomain)) {
      this.dirtyDomains.add(domain);
    }
  }

  /**
   * Returns whether a given domain is currently marked dirty.
   * @param domain Domain to check.
   * @returns True if the domain is dirty.
   */
  isDirty(domain: PresentationDomain): boolean {
    return this.dirtyDomains.has(domain);
  }

  /**
   * Returns the set of dirty domains and clears the internal tracking set.
   * @returns ReadonlySet of dirty domains.
   */
  consumeDirtyDomains(): ReadonlySet<PresentationDomain> {
    const current = new Set(this.dirtyDomains);
    this.dirtyDomains.clear();
    return current;
  }

  /**
   * Pushes a transient visual event to be presented on the next frame.
   * @param event Ephemeral presentation event.
   */
  pushEvent(event: PresentationEvent): void {
    this.events.push(event);
  }

  /**
   * Consumes all pending presentation events.
   * @returns ReadonlyArray of pending events.
   */
  consumeEvents(): ReadonlyArray<PresentationEvent> {
    const list = this.events;
    this.events = [];
    return list;
  }

  /**
   * Computes dirty domains based on reference equality between previous and next GameState.
   * @param prev The prior GameState or null.
   * @param next The current GameState.
   */
  markDirtyFromStateDiff(prev: GameState | null, next: GameState): void {
    if (!prev) {
      this.markAllDirty();
      return;
    }

    if (
      prev.map !== next.map ||
      prev.cachedFov !== next.cachedFov ||
      prev.isRotated !== next.isRotated ||
      prev.is3D !== next.is3D ||
      prev.zoomLevel !== next.zoomLevel ||
      prev.currentAreaId !== next.currentAreaId
    ) {
      this.markDirty(PresentationDomain.Map);
    }

    if (
      prev.components !== next.components ||
      prev.entities !== next.entities ||
      prev.spatialIndex !== next.spatialIndex ||
      prev.cachedFov !== next.cachedFov ||
      prev.identifiedItems !== next.identifiedItems ||
      prev.itemUnidentifiedNames !== next.itemUnidentifiedNames
    ) {
      const diff = classifyPresentationComponentDiff(prev, next);
      if (diff.entitiesDirty) {
        this.markDirty(PresentationDomain.Entities);
      }
      if (diff.hudDirty) {
        this.markDirty(PresentationDomain.HUD);
      }
      if (diff.inventoryDirty) {
        this.markDirty(PresentationDomain.Inventory);
      }
      if (
        (prev.components !== next.components || prev.entities !== next.entities) &&
        (next.uiMode === UIMode.CartridgeModal || next.uiMode === UIMode.Inventory || next.uiMode === UIMode.Trade)
      ) {
        this.markDirty(PresentationDomain.Modals);
      }
    }

    if (prev.messages !== next.messages) {
      this.markDirty(PresentationDomain.Log);
    }

    if (prev.uiMode !== next.uiMode) {
      this.markDirty(PresentationDomain.Modals);
      this.markDirty(PresentationDomain.HUD);
      this.markDirty(PresentationDomain.Editor);
      this.markDirty(PresentationDomain.Inventory);
    }

    if (
      prev.activeDialogue !== next.activeDialogue ||
      prev.verbMenu !== next.verbMenu ||
      prev.targetingMode !== next.targetingMode ||
      prev.inspectMode !== next.inspectMode ||
      prev.activeTrade !== next.activeTrade ||
      prev.activeService !== next.activeService
    ) {
      this.markDirty(PresentationDomain.Modals);
    }

    if (prev.targetingMode !== next.targetingMode || prev.inspectMode !== next.inspectMode) {
      this.markDirty(PresentationDomain.Map);
    }

    if (prev.rtwpState !== next.rtwpState || prev.globalTurn !== next.globalTurn) {
      this.markDirty(PresentationDomain.HUD);
    }

    if (prev.visualEffects !== next.visualEffects) {
      this.markDirty(PresentationDomain.VFX);
    }
  }
}

/**
 * Singleton instance of PresentationEventQueue.
 */
export const presentationQueue = new PresentationEventQueue();

/**
 * Marks a single presentation domain dirty.
 * @param domain Domain to mark.
 */
export function markDomainDirty(domain: PresentationDomain): void {
  presentationQueue.markDirty(domain);
}

/**
 * Marks all presentation domains dirty.
 */
export function markAllDomainsDirty(): void {
  presentationQueue.markAllDirty();
}

/**
 * Checks whether a presentation domain is currently dirty.
 * @param domain Domain to query.
 * @returns True if dirty.
 */
export function isDomainDirty(domain: PresentationDomain): boolean {
  return presentationQueue.isDirty(domain);
}

/**
 * Consumes and clears all dirty presentation domains.
 * @returns ReadonlySet of consumed dirty domains.
 */
export function consumeDirtyDomains(): ReadonlySet<PresentationDomain> {
  return presentationQueue.consumeDirtyDomains();
}

/**
 * Derives dirty domains from state reference diffs.
 * @param prev Prior GameState or null.
 * @param next Current GameState.
 */
export function markDirtyFromStateDiff(prev: GameState | null, next: GameState): void {
  presentationQueue.markDirtyFromStateDiff(prev, next);
}

/**
 * Pushes an ephemeral presentation event.
 * @param event Event to push.
 */
export function pushPresentationEvent(event: PresentationEvent): void {
  presentationQueue.pushEvent(event);
}

/**
 * Consumes and clears all pending presentation events.
 * @returns ReadonlyArray of presentation events.
 */
export function consumePresentationEvents(): ReadonlyArray<PresentationEvent> {
  return presentationQueue.consumeEvents();
}
