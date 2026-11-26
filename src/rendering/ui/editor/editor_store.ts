import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorController } from '../../../editor/campaign_editor.ts';
import { validateCampaign } from '../../../editor/campaign_validator.ts';
import { revealField } from '../../../editor/validation_navigator.ts';
import { splitPath, toFormPathString } from '../../../editor/validation_path.ts';
import type { ValidationReport } from '../../../editor/validator/validator.types.ts';
import { getRuleset } from '../../../rulesets/registry.ts';
import type { CampaignData } from '../../../types/campaign.types.ts';
import { resolveCategoryPanelType, VIEW_GROUPS } from '../../editor/editor_config.ts';
import {
  createInitialEditorSnapshot,
  DEFAULT_SIDEBAR_WIDTH,
  dedupeValidationDiagnostics,
  type EditorStoreSnapshot,
  type EditorTabId,
  escapeJsonPointerSegment,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  resolveCategoryReferenceKind,
  type WhereUsedTarget
} from './editor_store_helpers.ts';

export {
  DEFAULT_SIDEBAR_WIDTH,
  dedupeValidationDiagnostics,
  type EditorStoreSnapshot,
  type EditorTabId,
  escapeJsonPointerSegment,
  MAX_SIDEBAR_WIDTH,
  MIN_SIDEBAR_WIDTH,
  resolveCategoryReferenceKind,
  type WhereUsedTarget
};

/** Reactive singleton store driving `<EditorShell />` and all sub-editors. */
export class EditorStore {
  private snapshot: EditorStoreSnapshot = createInitialEditorSnapshot();
  private readonly listeners = new Set<() => void>();
  private boundController: EditorController | null = null;
  private deepValidationSeq = 0;

  /** Returns the current immutable store snapshot. */
  public getSnapshot(): EditorStoreSnapshot {
    return this.snapshot;
  }

  /** Subscribes a listener invoked on every store mutation. */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /** Resets store state cleanly (primarily for unit tests). */
  public reset(): void {
    this.boundController = null;
    this.deepValidationSeq += 1;
    this.snapshot = createInitialEditorSnapshot();
    this.notify();
  }

  /** Idempotently binds an `EditorController` once per identity and restores session tab/item selection. */
  public bindController(controller: EditorController): void {
    if (this.boundController === controller) {
      return;
    }
    this.boundController = controller;

    const doc = controller.getDocument();
    const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
    const savedCat = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('editor_active_category') : null;
    const savedItem = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('editor_active_item') : null;

    let initialGroupId: string | null = activeGroups[0]?.id ?? null;
    let initialTabId: EditorTabId | null = (activeGroups[0]?.tabs[0]?.id as EditorTabId | undefined) ?? null;
    let initialItemId: string | null = null;

    if (savedCat) {
      const foundGroup = activeGroups.find((g) => g.tabs.some((t) => t.id === savedCat));
      if (foundGroup) {
        initialGroupId = foundGroup.id;
        initialTabId = savedCat as EditorTabId;
        if (savedItem) {
          initialItemId = savedItem;
        }
      }
    }

    this.commit({
      controller,
      activeGroupId: initialGroupId,
      activeTabId: initialTabId,
      activeItemId: initialItemId,
      errors: controller.validate(),
      documentVersion: this.snapshot.documentVersion + 1
    });

    controller.onChange((updatedDoc, errors, isCoalesced) => {
      if (this.boundController !== controller) return;
      this.commit({
        errors,
        documentVersion: this.snapshot.documentVersion + 1
      });
      if (!isCoalesced) {
        void this.runDeepValidation(updatedDoc, controller);
      }
    });

    void this.runDeepValidation(doc, controller);
  }

  /** Runs asynchronous deep validation while discarding stale out-of-order responses. */
  public async runDeepValidation(doc: CampaignData, controller: EditorController): Promise<ValidationReport | null> {
    const seq = ++this.deepValidationSeq;
    this.commit({ isValidatingDeep: true });
    try {
      const report = await validateCampaign(doc);
      if (seq !== this.deepValidationSeq || this.boundController !== controller) {
        return null;
      }
      this.commit({ deepReport: report, isValidatingDeep: false });
      return report;
    } catch (err) {
      console.error('Deep campaign validation error:', err);
      if (seq === this.deepValidationSeq) {
        this.commit({ isValidatingDeep: false });
      }
      return null;
    }
  }

  /** Forces an immediate UI refresh of document-derived views (e.g. accordion toggle updates). */
  public bumpVersion(): void {
    this.commit({ documentVersion: this.snapshot.documentVersion + 1 });
  }

  /** Selects an Activity Bar group and defaults to its first tab (or returns to Splash with `null`). */
  public selectGroup(groupId: string | null): void {
    if (groupId === null) {
      this.commit({ activeGroupId: null, activeTabId: null, activeItemId: null });
      return;
    }
    const doc = this.snapshot.controller?.getDocument();
    const activeGroups = getRuleset(doc?.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
    const group = activeGroups.find((g) => g.id === groupId);
    const firstTab = (group?.tabs[0]?.id as EditorTabId | undefined) ?? null;
    this.persistSelection(firstTab, null);
    this.commit({ activeGroupId: groupId, activeTabId: firstTab, activeItemId: null });
  }

  /** Selects a horizontal category/tool tab inside the active group. */
  public selectTab(tabId: EditorTabId | null): void {
    if (tabId && this.snapshot.controller) {
      const doc = this.snapshot.controller.getDocument();
      const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
      const ownerGroup = activeGroups.find((g) => g.tabs.some((t) => t.id === tabId));
      this.persistSelection(tabId, null);
      this.commit({
        activeGroupId: ownerGroup?.id ?? this.snapshot.activeGroupId,
        activeTabId: tabId,
        activeItemId: null
      });
      return;
    }
    this.persistSelection(tabId, null);
    this.commit({ activeTabId: tabId, activeItemId: null });
  }

  /** Selects a dictionary entry within the active category tab. */
  public selectItem(itemId: string | null): void {
    this.persistSelection(this.snapshot.activeTabId, itemId);
    this.commit({ activeItemId: itemId });
  }

  /** Updates the sidebar search query. */
  public setSearchFilter(searchFilter: string): void {
    this.commit({ searchFilter });
  }

  /** Sets the resizable sidebar width clamped to `180..480`. */
  public setSidebarWidth(width: number): void {
    const clamped = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.round(width)));
    if (clamped !== this.snapshot.sidebarWidth) {
      this.commit({ sidebarWidth: clamped });
    }
  }

  /** Sets or toggles sidebar collapsed state. */
  public setSidebarCollapsed(collapsed: boolean): void {
    this.commit({ sidebarCollapsed: collapsed });
  }

  /** Opens or closes the collapsible bottom Validation Dock. */
  public setValidationDockOpen(open: boolean): void {
    this.commit({ validationDockOpen: open });
  }

  /** Opens or clears the global Where-Used reverse-reference drawer. */
  public setWhereUsedTarget(target: WhereUsedTarget | null): void {
    this.commit({ whereUsedTarget: target });
  }

  /** Opens or closes the New Campaign wizard modal. */
  public setNewCampaignModalOpen(open: boolean): void {
    this.commit({ newCampaignModalOpen: open });
  }

  /**
   * Navigates directly to a canonical or dotted/bracket field path (`/areas/crypt/name`),
   * switching group/tab/item, expanding parent accordions, and focusing `[data-field-path]`.
   */
  public navigateToPath(rawPath: string): void {
    const canonical = toFormPathString(rawPath);
    const nav = revealField(canonical);
    const parts = splitPath(canonical);
    const rootKey = parts[0] as EditorTabId | undefined;

    let nextGroupId = this.snapshot.activeGroupId;
    let nextTabId = this.snapshot.activeTabId;
    let nextItemId = this.snapshot.activeItemId;

    if (rootKey && this.snapshot.controller) {
      const doc = this.snapshot.controller.getDocument();
      const activeGroups = getRuleset(doc.manifest?.rulesetId).getEditorViewGroups(VIEW_GROUPS);
      const foundGroup = activeGroups.find((g) => g.tabs.some((t) => t.id === rootKey));
      if (foundGroup) {
        nextGroupId = foundGroup.id;
        nextTabId = rootKey;
        const tabDef = foundGroup.tabs.find((t) => t.id === rootKey);
        const isDict =
          tabDef?.panelType === 'dictionary' ||
          (rootKey in doc && resolveCategoryPanelType(rootKey as keyof CampaignData) === 'dictionary');
        if (isDict && parts[1]) {
          nextItemId = parts[1];
        } else if (!isDict) {
          nextItemId = null;
        }
      }
    }

    this.persistSelection(nextTabId, nextItemId);
    this.commit({
      activeGroupId: nextGroupId,
      activeTabId: nextTabId,
      activeItemId: nextItemId,
      sidebarCollapsed: false,
      documentVersion: this.snapshot.documentVersion + 1
    });

    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined') {
      requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(nav.focusSelector);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          const focusable = target.matches('input, select, textarea, button')
            ? target
            : target.querySelector<HTMLElement>('input, select, textarea, button');
          (focusable ?? target).focus?.();
        }
      });
    }
  }

  private persistSelection(tabId: EditorTabId | null, itemId: string | null): void {
    if (typeof sessionStorage === 'undefined') return;
    if (tabId) {
      sessionStorage.setItem('editor_active_category', tabId);
    } else {
      sessionStorage.removeItem('editor_active_category');
    }
    if (itemId) {
      sessionStorage.setItem('editor_active_item', itemId);
    } else {
      sessionStorage.removeItem('editor_active_item');
    }
  }

  private commit(partial: Partial<EditorStoreSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** Singleton reactive store for the Campaign Editor workspace. */
export const editorStore = new EditorStore();

/** Subscribes a Preact component to a slice of `editorStore`. */
export function useEditorSelector<T>(
  selector: (snap: EditorStoreSnapshot) => T,
  equalityFn: (a: T, b: T) => boolean = Object.is
): T {
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equalityFn);
  selectorRef.current = selector;
  equalityRef.current = equalityFn;

  const [sliceBox, setSliceBox] = useState<{ readonly value: T }>(() => ({
    value: selector(editorStore.getSnapshot())
  }));
  const currentRef = useRef<T>(sliceBox.value);
  currentRef.current = sliceBox.value;

  useEffect(() => {
    const checkAndSync = (): void => {
      const nextValue = selectorRef.current(editorStore.getSnapshot());
      if (!equalityRef.current(currentRef.current, nextValue)) {
        currentRef.current = nextValue;
        setSliceBox({ value: nextValue });
      }
    };
    checkAndSync();
    return editorStore.subscribe(checkAndSync);
  }, []);

  return sliceBox.value;
}
