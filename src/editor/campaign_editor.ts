import * as ROT from 'rot-js';
import { CURRENT_SCHEMA_VERSION } from '../constants/campaign.constants.ts';
import { loadEditorWorkspace, saveEditorWorkspace } from '../core/campaign_store.ts';
import { runEncounterDirector } from '../map/encounter_director.ts';
import { generateArea } from '../map/generator.ts';
import { type CampaignData, CampaignDataSchema } from '../types/campaign.types.ts';
import { applyPatch, generateInversePatch, type PatchOperation } from '../utils/json-patch.ts';
import { auditCampaignLinks, getValueAtPath } from './campaign_link_auditor.ts';
import type { ValidationError } from './validator/validator.types.ts';
import { readCampaignFromZip, writeCampaignToZip } from './workspace_file_service.ts';

export * from './campaign_link_auditor.ts';

/**
 * Controller class coordinating active workspace document modifications and undo/redo stacks.
 */
export class CampaignEditor {
  private doc: CampaignData;
  private undoStack: Array<PatchOperation[]> = [];
  private redoStack: Array<PatchOperation[]> = [];
  private workspaceId: string | null = null;
  private isDirty = false;
  private lastEditedPath: string | null = null;
  private lastEditedTime = 0;
  private coalescedOriginalValue: unknown = undefined;

  private onChangeListeners: Array<
    (doc: CampaignData, errors: ReadonlyArray<ValidationError>, isCoalesced: boolean) => void
  > = [];

  constructor(initialData: CampaignData) {
    this.doc = initialData;
  }

  /**
   * Subscribes a listener to change events.
   * @param listener The listener function to add.
   */
  public onChange(
    listener: (doc: CampaignData, errors: ReadonlyArray<ValidationError>, isCoalesced: boolean) => void
  ): void {
    this.onChangeListeners.push(listener);
    listener(this.doc, this.validate(), false);
  }

  /**
   * Returns the current state of the document.
   * @returns The active CampaignData document.
   */
  public getDocument(): CampaignData {
    return this.doc;
  }

  /**
   * Sets a new document state (e.g. on load or wizard creation) and flushes the history stacks.
   * @param newDoc The new CampaignData.
   */
  public resetDocument(newDoc: CampaignData): void {
    this.doc = newDoc;
    this.undoStack = [];
    this.redoStack = [];
    this.workspaceId = null;
    this.isDirty = false;
    this.lastEditedPath = null;
    this.coalescedOriginalValue = undefined;
    this.emitChange();
  }

  /**
   * Generates a sample map for the given area using the map generator.
   */
  public generateSandboxArea(areaId: string): ReturnType<typeof generateArea> {
    return generateArea(this.doc, areaId);
  }

  /**
   * Generates a sandbox area with a specific seed and optional budget/profile overrides.
   * Saves and restores the global RNG state to avoid polluting the editor's RNG stream.
   */
  public generateSandboxAreaWithSeed(
    areaId: string,
    seed: number,
    overrides?: { crBudget?: number; encounterProfileId?: string }
  ): ReturnType<typeof generateArea> {
    const savedState = ROT.RNG.getState();
    try {
      ROT.RNG.setSeed(seed);

      const areaDef = this.doc.areas[areaId];
      if (!areaDef) {
        throw new Error(`Area ${areaId} not found.`);
      }

      if (overrides && (overrides.crBudget !== undefined || overrides.encounterProfileId !== undefined)) {
        const result = generateArea(this.doc, areaId);
        const effectiveAreaDef = {
          ...areaDef,
          ...(overrides.crBudget !== undefined ? { crBudget: overrides.crBudget } : {}),
          ...(overrides.encounterProfileId !== undefined ? { encounterProfileId: overrides.encounterProfileId } : {})
        };
        const rooms = result.rooms.map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          centerX: r.centerX,
          centerY: r.centerY
        }));
        const directorResult = runEncounterDirector(this.doc, effectiveAreaDef, result.map, rooms, [], undefined);
        return {
          ...result,
          placedEntities: directorResult.newEntities,
          directorReceipt: directorResult.receipt
        };
      }

      return generateArea(this.doc, areaId);
    } finally {
      ROT.RNG.setState(savedState);
    }
  }

  /**
   * Loads a workspace from IndexedDB.
   */
  public async loadFromIDB(workspaceId: string): Promise<void> {
    try {
      const newDoc = await loadEditorWorkspace(workspaceId);
      if (!newDoc) throw new Error('Workspace not found in database.');
      this.doc = newDoc;
      this.workspaceId = workspaceId;
      this.undoStack = [];
      this.redoStack = [];
      this.isDirty = false;
      this.lastEditedPath = null;
      this.coalescedOriginalValue = undefined;
      this.emitChange();
    } catch (err) {
      console.error('Failed to load workspace:', err);
      alert(`Failed to load workspace: ${(err as Error).message}`);
    }
  }

  /**
   * Saves the current workspace to IndexedDB.
   */
  public async saveWorkspace(): Promise<void> {
    if (!this.workspaceId) {
      this.workspaceId = crypto.randomUUID();
    }

    try {
      await saveEditorWorkspace(this.workspaceId, this.doc);
      this.isDirty = false;
      alert('Workspace saved successfully!');
    } catch (err) {
      console.error('Failed to save workspace:', err);
      alert(`Failed to save workspace: ${(err as Error).message}`);
    }
  }

  /**
   * Imports a campaign from a selected ZIP file.
   */
  public async importZipWorkspace(file: File): Promise<void> {
    try {
      const newDoc = await readCampaignFromZip(file);
      this.doc = newDoc;
      this.workspaceId = null;
      this.undoStack = [];
      this.redoStack = [];
      this.lastEditedPath = null;
      this.coalescedOriginalValue = undefined;
      this.emitChange();
    } catch (err) {
      console.error('Failed to import ZIP:', err);
      alert(`Failed to import ZIP: ${(err as Error).message}`);
    }
  }

  /**
   * Exports the current campaign document as a ZIP blob and triggers a download.
   */
  public async exportZipWorkspace(): Promise<void> {
    this.doc.manifest.schemaVersion = CURRENT_SCHEMA_VERSION;

    const errors = this.validate();
    const hasErrors = errors.some((e) => e.severity === 'error');
    if (hasErrors) {
      if (!confirm(`Campaign has validation errors. Export anyway?`)) {
        return;
      }
    }

    try {
      const blob = await writeCampaignToZip(this.doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.doc.manifest.id || 'campaign'}_export.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export ZIP:', err);
      alert(`Failed to export ZIP: ${(err as Error).message}`);
    }
  }

  /**
   * Applies a series of patch operations to the document.
   */
  public applyOperations(ops: PatchOperation[], coalesce = false): void {
    if (ops.length === 0) return;
    this.isDirty = true;

    const now = performance.now();
    const primaryOp = ops[0];
    const path = primaryOp?.path ?? '';

    if (coalesce && primaryOp) {
      if (this.lastEditedPath === path && now - this.lastEditedTime < 800) {
        try {
          this.doc = applyPatch(this.doc, ops);
          this.lastEditedTime = now;
          this.emitChange(true);
          return;
        } catch (err) {
          console.error('Failed to apply coalesced operation:', err);
          return;
        }
      } else {
        this.flushCoalescedEdit();
        this.coalescedOriginalValue = getValueAtPath(this.doc, path);
        this.lastEditedPath = path;
        this.lastEditedTime = now;
      }
    } else {
      this.flushCoalescedEdit();
    }

    try {
      const inverse = generateInversePatch(this.doc, ops);
      this.doc = applyPatch(this.doc, ops);

      this.undoStack.push(inverse);
      this.redoStack = [];

      this.emitChange();
    } catch (err) {
      console.error('Failed to apply patch operations:', err);
    }
  }

  /** Performs an Undo operation, reverting the last change. */
  public undo(): void {
    this.flushCoalescedEdit();

    const ops = this.undoStack.pop();
    if (!ops) return;

    try {
      const inverse = generateInversePatch(this.doc, ops);
      this.doc = applyPatch(this.doc, ops);
      this.redoStack.push(inverse);
      this.emitChange();
    } catch (err) {
      console.error('Failed to apply Undo operation:', err);
    }
  }

  /** Performs a Redo operation, re-applying a previously undone change. */
  public redo(): void {
    this.flushCoalescedEdit();

    const ops = this.redoStack.pop();
    if (!ops) return;

    try {
      const inverse = generateInversePatch(this.doc, ops);
      this.doc = applyPatch(this.doc, ops);
      this.undoStack.push(inverse);
      this.emitChange();
    } catch (err) {
      console.error('Failed to apply Redo operation:', err);
    }
  }

  /** Checks whether an undo operation is currently available. */
  public canUndo(): boolean {
    return this.undoStack.length > 0 || this.lastEditedPath !== null;
  }

  /** Checks whether a redo operation is currently available. */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Validates the current document against the Zod schema and returns any errors. */
  public validate(): ReadonlyArray<ValidationError> {
    const errors: ValidationError[] = [];
    const result = CampaignDataSchema.safeParse(this.doc);

    if (!result.success) {
      for (const err of result.error.issues) {
        errors.push({
          path: '/' + err.path.join('/'),
          message: err.message,
          severity: 'error'
        });
      }
    }

    auditCampaignLinks(this.doc, errors);

    return errors;
  }

  private flushCoalescedEdit(): void {
    if (this.lastEditedPath === null) return;

    const path = this.lastEditedPath;
    const finalValue = getValueAtPath(this.doc, path);
    const origValue = this.coalescedOriginalValue;

    this.lastEditedPath = null;
    this.coalescedOriginalValue = undefined;

    if (JSON.stringify(origValue) !== JSON.stringify(finalValue)) {
      const undoOp: PatchOperation = {
        op: origValue === undefined ? 'remove' : 'replace',
        path: path,
        value: origValue
      };
      this.undoStack.push([undoOp]);
      this.redoStack = [];
    }
  }

  /** Returns whether the document has unsaved changes. */
  public hasUnsavedChanges(): boolean {
    return this.isDirty;
  }

  private emitChange(isCoalesced = false): void {
    const errors = this.validate();
    for (const listener of this.onChangeListeners) {
      try {
        listener(this.doc, errors, isCoalesced);
      } catch (err) {
        console.error('Error in change listener:', err);
      }
    }
  }
}
