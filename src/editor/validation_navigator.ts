/**
 * Validation navigator: drives field reveal, ancestor expansion, tab switching,
 * and DOM focus for the campaign editor's interactive diagnostics flow.
 *
 * Accordion open-state is preserved in a module-level `Set<string>` so that
 * workspace DOM replacements (`renderWorkspace`) do not reset user toggles.
 *
 * @see docs/archive/research_notes.md §10.2 — §10.4
 * @see docs/DECISIONS.md — Milestone 76, Decision D3 (accordion persistence)
 */
import { isPathPrefix, ancestorPaths } from './validation_path';

/** Module-level in-memory persistence for accordion open/close state. */
export const expandedPaths: Set<string> = new Set();

/**
 * Programmatically expand all ancestor sections of a target field path,
 * so that clicking an error link reveals the nested field.
 *
 * @param targetPath — Canonical path of the target field (`/dialogues/0/nodes/1/options/0/nextNodeId`)
 */
export function expandAncestors(targetPath: string): void {
  const chain = ancestorPaths(targetPath);
  for (const p of chain) {
    expandedPaths.add(p);
  }
  // The full path itself is also considered open when focused (optional behavior)
  expandedPaths.add(targetPath);
}

/**
 * Collapse a path and all its descendants (used when closing a section manually).
 */
export function collapsePath(path: string): void {
  expandedPaths.delete(path);
  // Also remove descendants so nested sections stay collapsed
  const descendants = Array.from(expandedPaths).filter((p) => isPathPrefix(path, p));
  for (const desc of descendants) {
    expandedPaths.delete(desc);
  }
}

/**
 * Reveal a field by expanding its ancestors, then return navigation instructions
 * for the controller layer (`editor_workspace.ts`, `editor_toolbar.ts`).
 *
 * The navigator itself does not touch the DOM; it only updates the persistent
 * `expandedPaths` set and returns the target info for downstream consumers.
 *
 * @param targetPath — Canonical path of the field to reveal
 * @returns Navigation descriptor with expanded chain + focus target
 */
export function revealField(targetPath: string): {
  readonly expanded: ReadonlyArray<string>;
  readonly targetPath: string;
  readonly focusSelector: string;
} {
  expandAncestors(targetPath);

  // Build a CSS-attribute selector for the DOM focus step
  // The form renderer tags containers with `data-field-path` (see D4 / Task 3)
  const focusSelector = `[data-field-path="${targetPath}"]`;

  return {
    expanded: Array.from(expandedPaths),
    targetPath,
    focusSelector
  };
}

/**
 * Toggle a single path (open if closed, close if open) without affecting descendants.
 * Used by accordion click handlers in `zod_form_renderer.ts`.
 */
export function togglePath(path: string): boolean {
  if (expandedPaths.has(path)) {
    expandedPaths.delete(path);
    return false; // now closed
  } else {
    expandedPaths.add(path);
    return true; // now open
  }
}

/**
 * Check whether a specific path is currently expanded.
 */
export function isPathExpanded(path: string): boolean {
  return expandedPaths.has(path);
}
