import { useEffect, useRef, useState } from 'preact/hooks';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { subscribeSettingsChange } from '../../../core/settings.ts';
import type { CampaignRegistryEntry } from '../../../types/campaign.types.ts';
import type { GameState } from '../../../types/game-state.types.ts';
import type { RulesetId } from '../../../types/ruleset.types.ts';
import type { InspectTooltipDTO } from '../../viewport_snapshot.types.ts';
import { subscribeConsoleThemeChange } from './console_theme.ts';

/** Maximum hotbar bank index (1-based). */
export const MAX_HOTBAR_BANKS = 10;

/** Total number of F6 HUD focus landmark zones. */
export const HUD_FOCUS_ZONE_COUNT = 6;

/** Severity tone for non-blocking toast notifications. */
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

/** Visual placement rectangle for active keyboard or pointer tooltips. */
export interface TooltipAnchorRect {
  readonly x: number;
  readonly y: number;
}

/** Active floating tooltip payload hosted by `<TooltipHost />`. */
export interface TooltipState {
  readonly id: string;
  readonly title: string;
  readonly body?: string | undefined;
  readonly meta?: ReadonlyArray<string> | undefined;
  readonly anchor?: TooltipAnchorRect | undefined;
}

/** Non-blocking toast notification queued in `<ToastHost />`. */
export interface ToastItem {
  readonly id: string;
  readonly message: string;
  readonly tone: ToastTone;
  readonly createdAt: number;
}

/** Reactive state for the full-screen loading & generation progress overlay. */
export interface LoadingOverlayState {
  readonly visible: boolean;
  readonly title: string;
  readonly progress: number;
  readonly message: string;
}

/** Discriminated request descriptor for `<DialogHost />`. */
export type ActiveDialogRequest =
  | {
      readonly id: string;
      readonly kind: 'alert';
      readonly title: string;
      readonly message: string;
      readonly confirmLabel: string;
      readonly resolve: () => void;
    }
  | {
      readonly id: string;
      readonly kind: 'confirm';
      readonly title: string;
      readonly message: string;
      readonly confirmLabel: string;
      readonly cancelLabel: string;
      readonly danger: boolean;
      readonly resolve: (confirmed: boolean) => void;
    }
  | {
      readonly id: string;
      readonly kind: 'prompt';
      readonly title: string;
      readonly message?: string | undefined;
      readonly defaultValue: string;
      readonly placeholder?: string | undefined;
      readonly confirmLabel: string;
      readonly cancelLabel: string;
      readonly validator?: ((value: string) => string | null) | undefined;
      readonly resolve: (value: string | null) => void;
    };

/** Per-domain monotonic render counters incremented only when a PresentationDomain is dirty. */
export type DomainVersionMap = Readonly<Record<PresentationDomain, number>>;

/** Complete immutable UI store snapshot consumed by Preact views via `useUiSelector`. */
export interface UIStoreSnapshot {
  readonly gameState: GameState | null;
  readonly hasSave: boolean;
  readonly activeBank: number;
  readonly helpOpen: boolean;
  readonly helpContextOverride: string | null;
  readonly hudFocusZone: number | null;
  readonly hudFolded: Readonly<Record<string, boolean>>;
  readonly inspectTooltip: InspectTooltipDTO | null;
  readonly settingsVersion: number;
  readonly settingsInitialTab: string | null;
  readonly selectedRulesetId: RulesetId;
  readonly selectedCampaignId: string | null;
  readonly availableCampaigns: ReadonlyArray<CampaignRegistryEntry>;
  readonly isStartingCampaign: boolean;
  readonly loadingOverlay: LoadingOverlayState;
  readonly domainVersions: DomainVersionMap;
  readonly dialogs: ReadonlyArray<ActiveDialogRequest>;
  readonly toasts: ReadonlyArray<ToastItem>;
  readonly tooltip: TooltipState | null;
}

function createInitialDomainVersions(): DomainVersionMap {
  return {
    [PresentationDomain.Map]: 0,
    [PresentationDomain.Entities]: 0,
    [PresentationDomain.HUD]: 0,
    [PresentationDomain.Log]: 0,
    [PresentationDomain.Inventory]: 0,
    [PresentationDomain.Modals]: 0,
    [PresentationDomain.Editor]: 0,
    [PresentationDomain.Debug]: 0,
    [PresentationDomain.VFX]: 0
  };
}

function createInitialSnapshot(): UIStoreSnapshot {
  return {
    gameState: null,
    hasSave: false,
    activeBank: 1,
    helpOpen: false,
    helpContextOverride: null,
    hudFocusZone: null,
    hudFolded: {},
    inspectTooltip: null,
    settingsVersion: 0,
    settingsInitialTab: null,
    selectedRulesetId: 'classic',
    selectedCampaignId: null,
    availableCampaigns: [],
    isStartingCampaign: false,
    loadingOverlay: {
      visible: false,
      title: 'Descending into the Depths...',
      progress: 0,
      message: ''
    },
    domainVersions: createInitialDomainVersions(),
    dialogs: [],
    toasts: [],
    tooltip: null
  };
}

/** PresentationDomain-gated Preact store bridging immutable `GameState` and transient UI slices. */
export class UIStore {
  private snapshot: UIStoreSnapshot = createInitialSnapshot();
  private readonly listeners = new Set<() => void>();

  constructor() {
    subscribeSettingsChange(() => this.bumpSettingsVersion());
    subscribeConsoleThemeChange(() => this.bumpSettingsVersion());
  }

  /** Returns the current immutable store snapshot. */
  public getSnapshot(): UIStoreSnapshot {
    return this.snapshot;
  }

  /** Subscribes a listener invoked on every committed store update. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** Resets transient UI state back to clean defaults (primarily for tests). */
  public reset(): void {
    this.snapshot = createInitialSnapshot();
    this.notify();
  }

  /** Bumps `settingsVersion` so `<Keycap>` badges, Help, and Settings re-render cleanly. */
  public bumpSettingsVersion(): void {
    this.commit({ settingsVersion: this.snapshot.settingsVersion + 1 });
  }

  /** Synchronizes `GameState`, `hasSave`, and dirty `PresentationDomain` version counters. */
  public syncFromPresenter(state: GameState, hasSave: boolean, dirtyDomains: ReadonlySet<PresentationDomain>): void {
    const relevantDirty =
      dirtyDomains.has(PresentationDomain.HUD) ||
      dirtyDomains.has(PresentationDomain.Log) ||
      dirtyDomains.has(PresentationDomain.Inventory) ||
      dirtyDomains.has(PresentationDomain.Modals) ||
      dirtyDomains.has(PresentationDomain.Debug) ||
      dirtyDomains.has(PresentationDomain.Editor);

    if (!relevantDirty && this.snapshot.gameState !== null && this.snapshot.hasSave === hasSave) {
      return;
    }

    const nextVersions: Record<PresentationDomain, number> = { ...this.snapshot.domainVersions };
    for (const domain of dirtyDomains) {
      nextVersions[domain] = nextVersions[domain] + 1;
    }

    this.commit({ gameState: state, hasSave, domainVersions: nextVersions });
  }

  /** Sets the 1-based active hotbar bank (`1..10`) as the sole source of truth. */
  public setActiveBank(bank: number): number {
    const clamped = Math.max(1, Math.min(MAX_HOTBAR_BANKS, Math.round(bank)));
    if (clamped !== this.snapshot.activeBank) {
      this.commit({ activeBank: clamped });
    }
    return clamped;
  }

  /** Cycles the 1-based active hotbar bank wrapping around `1..10`. */
  public cycleActiveBank(delta: number): number {
    const zeroBased =
      (((this.snapshot.activeBank - 1 + delta) % MAX_HOTBAR_BANKS) + MAX_HOTBAR_BANKS) % MAX_HOTBAR_BANKS;
    const next = zeroBased + 1;
    this.commit({ activeBank: next });
    return next;
  }

  /** Opens, closes, or toggles the global F1 Help overlay. */
  public setHelpOpen(open: boolean, contextOverride: string | null = null): void {
    this.commit({ helpOpen: open, helpContextOverride: open ? contextOverride : null });
  }

  /** Updates the active F6 HUD keyboard focus landmark zone (`null` = inactive). */
  public setHudFocusZone(zone: number | null): void {
    if (this.snapshot.hudFocusZone !== zone) {
      this.commit({ hudFocusZone: zone });
    }
  }

  /** Toggles folded state of a single HUD card or all HUD cards at once. */
  public toggleHudFolded(cardId?: string): void {
    if (cardId) {
      const next = { ...this.snapshot.hudFolded, [cardId]: !this.snapshot.hudFolded[cardId] };
      this.commit({ hudFolded: next });
      return;
    }
    const keys = ['vitals', 'dock', 'scanner', 'log'];
    const anyUnfolded = keys.some((k) => !this.snapshot.hudFolded[k]);
    const next: Record<string, boolean> = {};
    for (const k of keys) next[k] = anyUnfolded;
    this.commit({ hudFolded: next });
  }

  /** Updates the presentational inspect tooltip DTO for `<TacticalScannerCard />`. */
  public setInspectTooltip(dto: InspectTooltipDTO | null): void {
    this.commit({ inspectTooltip: dto });
  }

  /** Sets the initial tab ID to activate when Settings opens (`'keybinds'`, `'display'`, etc.). */
  public setSettingsInitialTab(tabId: string | null): void {
    this.commit({ settingsInitialTab: tabId });
  }

  /** Updates menu selection slice fields (ruleset, campaign, campaign list, or loading flag). */
  public updateMenuSelection(
    partial: Partial<
      Pick<UIStoreSnapshot, 'selectedRulesetId' | 'selectedCampaignId' | 'availableCampaigns' | 'isStartingCampaign'>
    >
  ): void {
    this.commit(partial);
  }

  /** Updates the full-screen loading overlay state. */
  public setLoadingOverlay(partial: Partial<LoadingOverlayState>): void {
    this.commit({ loadingOverlay: { ...this.snapshot.loadingOverlay, ...partial } });
  }

  /** Appends a blocking system dialog request onto the dialog queue. */
  public enqueueDialog(dialog: ActiveDialogRequest): void {
    this.commit({ dialogs: [...this.snapshot.dialogs, dialog] });
  }

  /** Removes a resolved/dismissed dialog request by ID. */
  public removeDialog(id: string): void {
    const filtered = this.snapshot.dialogs.filter((d) => d.id !== id);
    if (filtered.length !== this.snapshot.dialogs.length) {
      this.commit({ dialogs: filtered });
    }
  }

  /** Appends a non-blocking toast item. */
  public pushToast(toast: ToastItem): void {
    this.commit({ toasts: [...this.snapshot.toasts.slice(-4), toast] });
  }

  /** Dismisses a toast item by ID. */
  public removeToast(id: string): void {
    const filtered = this.snapshot.toasts.filter((t) => t.id !== id);
    if (filtered.length !== this.snapshot.toasts.length) {
      this.commit({ toasts: filtered });
    }
  }

  /** Sets or clears the active floating tooltip. */
  public setTooltip(tooltip: TooltipState | null): void {
    this.commit({ tooltip });
  }

  private commit(partial: Partial<UIStoreSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Singleton reactive UI bridge store shared across Console HUD, Modals, and Editor. */
export const uiStore = new UIStore();

/** Subscribes a Preact component to a slice of `uiStore`. */
export function useUiSelector<T>(
  selector: (snap: UIStoreSnapshot) => T,
  equalityFn: (a: T, b: T) => boolean = Object.is
): T {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equalityFn);
  selectorRef.current = selector;
  equalityRef.current = equalityFn;

  const [sliceBox, setSliceBox] = useState<{ readonly value: T }>(() => ({
    value: selector(uiStore.getSnapshot())
  }));
  const currentRef = useRef<T>(sliceBox.value);
  currentRef.current = sliceBox.value;

  useEffect(() => {
    const checkAndSync = (): void => {
      const nextValue = selectorRef.current(uiStore.getSnapshot());
      if (!equalityRef.current(currentRef.current, nextValue)) {
        currentRef.current = nextValue;
        setSliceBox({ value: nextValue });
      }
    };
    checkAndSync();
    return uiStore.subscribe(checkAndSync);
  }, []);

  return sliceBox.value;
}
