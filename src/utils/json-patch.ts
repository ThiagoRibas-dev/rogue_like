/**
 * Represents a single JSON Patch operation (RFC 6902 subset).
 */
export interface PatchOperation {
  readonly op: 'replace' | 'add' | 'remove';
  readonly path: string;
  readonly value?: unknown;
}

/**
 * Splits a JSON pointer path into its individual keys, decoding pointer escapes.
 * @param path The JSON pointer path string (e.g. "/items/health_potion/name")
 * @returns An array of string keys representing the path segments
 */
function parsePath(path: string): string[] {
  if (!path || path === '/') return [];
  const segments = path.split('/');
  if (segments[0] === '') {
    segments.shift();
  }
  return segments.map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/**
 * Gets a nested value from an object at the specified path segments.
 * @param obj The target object
 * @param segments The parsed path segments
 * @returns The value at the path, or undefined if not found
 */
function getValueAtPath(obj: unknown, segments: string[]): unknown {
  let curr: unknown = obj;
  for (const seg of segments) {
    if (curr === null || typeof curr !== 'object') {
      return undefined;
    }
    const record = curr as Record<string, unknown>;
    curr = record[seg];
  }
  return curr;
}

/**
 * Clones a JSON-serializable value.
 * @param val Value to clone
 * @returns Cloned value
 */
function cloneDeep<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Mutates an object by applying a JSON Patch operation in-place.
 * @param obj The target object to modify
 * @param op The patch operation to apply
 * @returns A boolean indicating whether the operation succeeded
 */
function applySingleOperation(obj: Record<string, unknown>, op: PatchOperation): boolean {
  const segments = parsePath(op.path);
  if (segments.length === 0) return false;

  const targetKey = segments[segments.length - 1];
  if (targetKey === undefined) return false;

  const parentSegments = segments.slice(0, -1);
  const parentVal = getValueAtPath(obj, parentSegments);

  if (parentVal === null || typeof parentVal !== 'object') {
    return false;
  }

  const parent = parentVal as Record<string, unknown> | unknown[];

  if (Array.isArray(parent)) {
    const idx = parseInt(targetKey, 10);
    if (isNaN(idx)) return false;

    if (op.op === 'replace') {
      if (idx < 0 || idx >= parent.length) return false;
      (parent as unknown[])[idx] = op.value;
      return true;
    } else if (op.op === 'add') {
      if (idx < 0 || idx > parent.length) return false;
      (parent as unknown[]).splice(idx, 0, op.value);
      return true;
    } else if (op.op === 'remove') {
      if (idx < 0 || idx >= parent.length) return false;
      parent.splice(idx, 1);
      return true;
    }
  } else {
    if (op.op === 'replace') {
      if (!(targetKey in parent)) return false;
      parent[targetKey] = op.value;
      return true;
    } else if (op.op === 'add') {
      parent[targetKey] = op.value;
      return true;
    } else if (op.op === 'remove') {
      if (!(targetKey in parent)) return false;
      delete parent[targetKey];
      return true;
    }
  }

  return false;
}

/**
 * Applies a list of JSON Patch operations to an object.
 * Returns a deep clone of the modified object if successful, or throws an error.
 * @param obj The original object
 * @param patches The list of patch operations
 * @returns The newly modified, cloned object
 */
export function applyPatch<T>(obj: T, patches: ReadonlyArray<PatchOperation>): T {
  const cloned = cloneDeep(obj) as Record<string, unknown>;
  for (const op of patches) {
    const success = applySingleOperation(cloned, op);
    if (!success) {
      throw new Error(`Failed to apply patch operation: ${JSON.stringify(op)}`);
    }
  }
  return cloned as unknown as T;
}

/**
 * Generates the inverse operations for a list of JSON Patch operations on a document,
 * enabling undo functionality.
 * @param doc The state of the document BEFORE applying the patches
 * @param patches The patch operations to invert
 * @returns The list of inverse patch operations
 */
export function generateInversePatch(doc: unknown, patches: ReadonlyArray<PatchOperation>): PatchOperation[] {
  const inverse: PatchOperation[] = [];

  // We clone the doc so we can simulate the intermediate states of applying the patches
  // to get the correct values for deletion/modification
  const currentDoc = cloneDeep(doc);

  for (const op of patches) {
    const segments = parsePath(op.path);
    const targetKey = segments[segments.length - 1];

    if (targetKey === undefined) {
      throw new Error(`Invalid path: ${op.path}`);
    }

    if (op.op === 'replace') {
      const oldValue = getValueAtPath(currentDoc, segments);
      inverse.unshift({
        op: 'replace',
        path: op.path,
        value: oldValue
      });
    } else if (op.op === 'add') {
      inverse.unshift({
        op: 'remove',
        path: op.path
      });
    } else if (op.op === 'remove') {
      const oldValue = getValueAtPath(currentDoc, segments);
      inverse.unshift({
        op: 'add',
        path: op.path,
        value: oldValue
      });
    }

    // Apply the operation to currentDoc so we track the intermediate values correctly
    if (currentDoc !== null && typeof currentDoc === 'object') {
      applySingleOperation(currentDoc as Record<string, unknown>, op);
    }
  }

  return inverse;
}
