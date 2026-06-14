import { type CampaignData, CampaignDataSchema } from '../types/campaign.types.ts';
import { type PatchOperation, applyPatch, generateInversePatch } from '../utils/json-patch.ts';
import {
  readCampaignFromDirectory,
  writeCampaignToDirectory,
  readCampaignFromZip,
  writeCampaignToZip
} from './workspace_file_service.ts';
import { generateArea } from '../map/generator.ts';

import type { ValidationError } from './validator/validator.types.ts';

/**
 * Controller class coordinating active workspace document modifications and undo/redo stacks.
 */
export class CampaignEditor {
  private doc: CampaignData;
  private undoStack: Array<PatchOperation[]> = [];
  private redoStack: Array<PatchOperation[]> = [];
  private dirHandle: FileSystemDirectoryHandle | null = null;
  private isDirty = false;
  private lastEditedPath: string | null = null;
  private lastEditedTime = 0;
  private coalescedOriginalValue: unknown = undefined;

  // Listeners
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
    // Trigger immediately with initial state
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
    this.dirHandle = null;
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
   * Prompts the user to select a local directory and loads the workspace.
   */
  public async openWorkspace(): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access API. Please use a Chromium-based browser.');
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      const newDoc = await readCampaignFromDirectory(handle);
      this.doc = newDoc;
      this.dirHandle = handle;
      this.undoStack = [];
      this.redoStack = [];
      this.isDirty = false;
      this.lastEditedPath = null;
      this.coalescedOriginalValue = undefined;
      this.emitChange();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Failed to open workspace:', err);
        alert(`Failed to open workspace: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Saves the current workspace to the associated directory handle.
   */
  public async saveWorkspace(): Promise<void> {
    if (!this.dirHandle) {
      if (!('showDirectoryPicker' in window)) {
        alert('Your browser does not support the File System Access API. Please export as ZIP instead.');
        throw new Error('Workspace directory is not set.');
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
        this.dirHandle = handle;
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Failed to select workspace directory:', err);
          alert(`Failed to select workspace directory: ${(err as Error).message}`);
        }
        return;
      }
    }

    try {
      await writeCampaignToDirectory(this.dirHandle!, this.doc);
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
      this.dirHandle = null; // Detach from any directory handle
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
   * Handles keystroke coalescing for text/number fields to group typing into single undo steps.
   * @param ops The operations to apply.
   * @param coalesce Whether to coalesce this operation with consecutive edits to the same path.
   */
  public applyOperations(ops: PatchOperation[], coalesce = false): void {
    if (ops.length === 0) return;
    this.isDirty = true;

    const now = Date.now();
    const primaryOp = ops[0];
    const path = primaryOp?.path ?? '';

    // If coalescing is requested (e.g., character input)
    if (coalesce && primaryOp) {
      if (this.lastEditedPath === path && now - this.lastEditedTime < 800) {
        // Just apply in-place, keeping the very first original value in our undo history
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
        // Debounce window expired, or path changed. Finalize any ongoing coalesced edit.
        this.flushCoalescedEdit();

        // Start new coalesced sequence. Find original value before application:
        this.coalescedOriginalValue = this.getValueAtPath(this.doc, path);
        this.lastEditedPath = path;
        this.lastEditedTime = now;
      }
    } else {
      // Direct, non-coalesced operation (e.g. button click or blur). Finalize typing first.
      this.flushCoalescedEdit();
    }

    try {
      const inverse = generateInversePatch(this.doc, ops);
      this.doc = applyPatch(this.doc, ops);

      this.undoStack.push(inverse);
      this.redoStack = []; // Clear redo stack on new operation

      this.emitChange();
    } catch (err) {
      console.error('Failed to apply patch operations:', err);
    }
  }

  /**
   * Performs an Undo operation, reverting the last change.
   */
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

  /**
   * Performs a Redo operation, re-applying a previously undone change.
   */
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

  /**
   * Checks whether an undo operation is currently available.
   * @returns True if undo stack is not empty.
   */
  public canUndo(): boolean {
    return this.undoStack.length > 0 || this.lastEditedPath !== null;
  }

  /**
   * Checks whether a redo operation is currently available.
   * @returns True if redo stack is not empty.
   */
  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /**
   * Validates the current document against the Zod schema and returns any errors.
   */
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

    // 2. Cross-Registry Link Auditing
    this.auditLinks(errors);

    return errors;
  }

  /**
   * Finalizes any ongoing debounced keystroke editing sequence and pushes the final aggregated undo step.
   */
  private flushCoalescedEdit(): void {
    if (this.lastEditedPath === null) return;

    const path = this.lastEditedPath;
    const finalValue = this.getValueAtPath(this.doc, path);
    const origValue = this.coalescedOriginalValue;

    // Reset tracking state first to prevent recursion loops
    this.lastEditedPath = null;
    this.coalescedOriginalValue = undefined;

    // If value actually changed, record the undo step
    if (JSON.stringify(origValue) !== JSON.stringify(finalValue)) {
      const undoOp: PatchOperation = {
        op: origValue === undefined ? 'remove' : 'replace',
        path: path,
        value: origValue
      };
      this.undoStack.push([undoOp]);
      this.redoStack = []; // Clear redo stack
    }
  }

  /**
   * Resolves a value inside a document structure using a pointer path.
   */
  private getValueAtPath(obj: unknown, path: string): unknown {
    if (!path || path === '/') return obj;
    const segments = path.split('/');
    if (segments[0] === '') segments.shift();

    let curr: unknown = obj;
    for (const seg of segments) {
      if (curr === null || typeof curr !== 'object') return undefined;
      curr = (curr as Record<string, unknown>)[seg];
    }
    return curr;
  }

  /**
   * Helper that checks all foreign key relationships in the CampaignData.
   */
  private auditLinks(errors: ValidationError[]): void {
    const data = this.doc;

    // Factions Registry cache
    const factions = Object.keys(data.factions);
    const effects = Object.keys(data.effects);
    const dialogues = Object.keys(data.dialogues);
    const aiProfiles = Object.keys(data.ai);
    const items = Object.keys(data.items);
    const statusEffects = Object.keys(data.status);
    const areas = Object.keys(data.areas);

    // Audit Entities (Actors)
    for (const [id, entity] of Object.entries(data.entities)) {
      if (entity.faction && !factions.includes(entity.faction)) {
        errors.push({
          path: `/entities/${id}/faction`,
          message: `Entity '${entity.name}' references non-existent faction '${entity.faction}'.`,
          severity: 'error'
        });
      }
      if (entity.dialogueId && !dialogues.includes(entity.dialogueId)) {
        errors.push({
          path: `/entities/${id}/dialogueId`,
          message: `Entity '${entity.name}' references non-existent dialogue '${entity.dialogueId}'.`,
          severity: 'error'
        });
      }
      if (entity.ai?.profileId && !aiProfiles.includes(entity.ai.profileId)) {
        errors.push({
          path: `/entities/${id}/ai/profileId`,
          message: `Entity '${entity.name}' references non-existent AI profile '${entity.ai.profileId}'.`,
          severity: 'error'
        });
      }
    }

    // Audit Items
    for (const [id, item] of Object.entries(data.items)) {
      if (item.consumable?.effectId && !effects.includes(item.consumable.effectId)) {
        errors.push({
          path: `/items/${id}/consumable/effectId`,
          message: `Item '${item.name}' consumable references non-existent effect '${item.consumable.effectId}'.`,
          severity: 'error'
        });
      }
      if (item.equippable?.onHit?.statusId && !statusEffects.includes(item.equippable.onHit.statusId)) {
        errors.push({
          path: `/items/${id}/equippable/onHit/statusId`,
          message: `Item '${item.name}' equippable on-hit references non-existent status effect '${item.equippable.onHit.statusId}'.`,
          severity: 'error'
        });
      }
    }

    // Audit Item Effects
    for (const [id, effect] of Object.entries(data.effects)) {
      if (effect.statusId && !statusEffects.includes(effect.statusId)) {
        errors.push({
          path: `/effects/${id}/statusId`,
          message: `Effect '${id}' references non-existent status effect '${effect.statusId}'.`,
          severity: 'error'
        });
      }
    }

    // Audit Area connections
    for (const [areaId, area] of Object.entries(data.areas)) {
      if (area.connections) {
        area.connections.forEach((conn, index) => {
          if (!areas.includes(conn.targetAreaId)) {
            errors.push({
              path: `/areas/${areaId}/connections/${index}/targetAreaId`,
              message: `Area '${area.name}' portal references non-existent target area '${conn.targetAreaId}'.`,
              severity: 'error'
            });
          }
        });
      }
    }

    // Audit Rules Config
    if (!areas.includes(data.rules.map.startingAreaId)) {
      errors.push({
        path: '/rules/map/startingAreaId',
        message: `Rules configuration references invalid starting area ID: '${data.rules.map.startingAreaId}'.`,
        severity: 'error'
      });
    }

    // Spawning lists checking
    for (const entId of Object.keys(data.rules.spawning.spawnWeights)) {
      if (!Object.keys(data.entities).includes(entId)) {
        errors.push({
          path: `/rules/spawning/spawnWeights/${entId}`,
          message: `Spawn weight table references invalid entity template ID: '${entId}'.`,
          severity: 'warning'
        });
      }
    }
    for (const itemId of Object.keys(data.rules.spawning.lootTable)) {
      if (!items.includes(itemId)) {
        errors.push({
          path: `/rules/spawning/lootTable/${itemId}`,
          message: `Loot spawn table references invalid item definition ID: '${itemId}'.`,
          severity: 'warning'
        });
      }
    }
  }

  /**
   * Notifies listeners of changes in the campaign document.
   */
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
