import { type GameState, UIMode } from '../types/game-state.types.ts';
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
      prev.spatialIndex !== next.spatialIndex
    ) {
      this.markDirty(PresentationDomain.Entities);
      this.markDirty(PresentationDomain.HUD);
      this.markDirty(PresentationDomain.Inventory);
      if (next.uiMode === UIMode.CartridgeModal || next.uiMode === UIMode.Inventory) {
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
