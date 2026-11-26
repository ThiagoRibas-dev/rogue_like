import type { EditorController } from '../../../editor/campaign_editor.ts';
import type { ValidationError, ValidationReport } from '../../../editor/validator/validator.types.ts';
import type { CampaignData } from '../../../types/campaign.types.ts';

/** Minimum sidebar width in pixels. */
export const MIN_SIDEBAR_WIDTH = 180;
/** Default sidebar width in pixels. */
export const DEFAULT_SIDEBAR_WIDTH = 260;
/** Maximum sidebar width in pixels. */
export const MAX_SIDEBAR_WIDTH = 480;

/** Active editor workspace tab identifier (any `CampaignData` key or custom tool panel). */
export type EditorTabId = keyof CampaignData | 'simulation' | 'triggerComposer';

/** Selected entity/item target for the global `<WhereUsedDrawer />`. */
export interface WhereUsedTarget {
  readonly kind: string;
  readonly id: string;
}

/** Immutable reactive snapshot for the Campaign Editor Preact shell. */
export interface EditorStoreSnapshot {
  readonly controller: EditorController | null;
  readonly activeGroupId: string | null;
  readonly activeTabId: EditorTabId | null;
  readonly activeItemId: string | null;
  readonly searchFilter: string;
  readonly sidebarWidth: number;
  readonly sidebarCollapsed: boolean;
  readonly validationDockOpen: boolean;
  readonly whereUsedTarget: WhereUsedTarget | null;
  readonly newCampaignModalOpen: boolean;
  readonly documentVersion: number;
  readonly errors: ReadonlyArray<ValidationError>;
  readonly deepReport: ValidationReport | null;
  readonly isValidatingDeep: boolean;
}

/** Creates the clean baseline snapshot for `EditorStore`. */
export function createInitialEditorSnapshot(): EditorStoreSnapshot {
  return {
    controller: null,
    activeGroupId: null,
    activeTabId: null,
    activeItemId: null,
    searchFilter: '',
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    sidebarCollapsed: false,
    validationDockOpen: false,
    whereUsedTarget: null,
    newCampaignModalOpen: false,
    documentVersion: 0,
    errors: [],
    deepReport: null,
    isValidatingDeep: false
  };
}

/** Maps a CampaignData dictionary category key to the canonical ReferenceIndex target kind. */
export function resolveCategoryReferenceKind(categoryKey: string): string {
  const map: Readonly<Record<string, string>> = {
    entities: 'entity',
    items: 'item',
    tiles: 'tile',
    areas: 'area',
    status: 'status',
    effects: 'effect',
    fields: 'field',
    dialogues: 'dialogue',
    quests: 'quest',
    questTemplates: 'questTemplate',
    encounterProfiles: 'encounterProfile',
    factions: 'faction',
    ai: 'ai',
    tagRegistry: 'tag'
  };
  return map[categoryKey] ?? categoryKey;
}

/** Escapes a single RFC 6902 JSON Pointer segment (`~` -> `~0`, `/` -> `~1`). */
export function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Merges shallow schema errors with deep audit errors/warnings while deduplicating
 * identical `(severity, path, message)` entries.
 */
export function dedupeValidationDiagnostics(
  shallowErrors: ReadonlyArray<ValidationError>,
  deepReport: ValidationReport | null
): ReadonlyArray<ValidationError> {
  const combined: ReadonlyArray<ValidationError> = [
    ...shallowErrors,
    ...(deepReport?.errors ?? []),
    ...(deepReport?.warnings ?? [])
  ];
  const seen = new Set<string>();
  const result: ValidationError[] = [];
  for (const item of combined) {
    const key = `${item.severity}|${item.path}|${item.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
