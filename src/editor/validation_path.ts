/**
 * Canonical path normalizer for Zod form paths.
 * Unifies slash-leading (`/a/b`), dot (`a.b`), and bracket (`a[0]`) dialects
 * into a single canonical form used by navigators, form renderers, and error matchers.
 *
 * @see docs/research_notes.md §10.1 — §10.4
 * @see docs/DECISIONS.md — Milestone 76, Decision D4
 */

/** Canonical separator used across the editor. */
export const CANONICAL_SEPARATOR = '/';

/**
 * Convert a raw validator path (array of segments or a string in any dialect)
 * into the canonical slash-leading form.
 *
 * @param raw — Raw path segments (e.g. `['dialogues', '0', 'nodes', '1', 'nextNodeId']`)
 * @returns Canonical path string (`/dialogues/0/nodes/1/nextNodeId`)
 */
export function toFormPath(raw: ReadonlyArray<string>): string {
  const segments: string[] = [];
  for (const seg of raw) {
    if (seg === '') continue;
    // Numeric array indices are preserved as-is (already canonical)
    segments.push(seg);
  }
  if (segments.length === 0) return '/';
  return CANONICAL_SEPARATOR + segments.join(CANONICAL_SEPARATOR);
}

/**
 * Overload accepting a pre-formatted slash/dot/bracket string.
 */
export function toFormPathString(rawPath: string): string {
  // If already canonical (starts with / and uses only / separators), return as-is.
  if (rawPath.startsWith('/') && !rawPath.includes('.') && !rawPath.includes('[')) {
    return rawPath;
  }
  // Dot-notation: split on dots, ignore empty segments
  if (rawPath.includes('.')) {
    return toFormPath(rawPath.split('.').filter(s => s !== ''));
  }
  // Bracket notation: `dialogues[0][nodes]` -> split by brackets
  if (rawPath.includes('[')) {
    const parts: string[] = [];
    // Simple regex split that pulls out identifiers inside brackets
    const tokens = rawPath.split(/\[|\]/g);
    for (const token of tokens) {
      if (token === '') continue;
      // If token is just digits, treat as index
      parts.push(token);
    }
    return toFormPath(parts);
  }
  // Plain identifier (no separators) -> single segment
  return '/' + rawPath;
}

/**
 * Check if `ancestor` is a true ancestor (prefix) of `descendant` in canonical form.
 *
 * @param ancestor — Canonical ancestor path (`/a/b`)
 * @param descendant — Canonical descendant path (`/a/b/c/0`)
 * @returns `true` if descendant starts with ancestor + separator
 */
export function isPathPrefix(ancestor: string, descendant: string): boolean {
  if (ancestor === '/') return true; // root is prefix of everything
  if (ancestor === descendant) return false; // exact match is not a strict prefix
  return descendant === ancestor || descendant.startsWith(ancestor + CANONICAL_SEPARATOR);
}

/**
 * Split a canonical path into its segment array (without the leading separator).
 *
 * @param path — Canonical path (`/a/b/0`)
 * @returns Segment array (`['a', 'b', '0']`)
 */
export function splitPath(path: string): string[] {
  if (path === '/' || path === '') return [];
  return path.slice(1).split(CANONICAL_SEPARATOR);
}

/**
 * Build the ancestor chain for a canonical path (for programmatic accordion expansion).
 *
 * @param path — Canonical target path
 * @returns Array of ancestor paths from root down to the full path
 */
export function ancestorPaths(path: string): string[] {
  const parts = splitPath(path);
  const chain: string[] = [];
  for (let i = 1; i <= parts.length; i++) {
    chain.push(CANONICAL_SEPARATOR + parts.slice(0, i).join(CANONICAL_SEPARATOR));
  }
  return chain;
}
