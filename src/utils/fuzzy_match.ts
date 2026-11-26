const FUZZY_PREFIX_BASE_SCORE = 100;
const FUZZY_SUBSTRING_BASE_SCORE = 75;
const FUZZY_SUBSEQUENCE_BASE_SCORE = 50;

/**
 * Computes a deterministic fuzzy match score for `candidateText` against `query`,
 * returning `null` if the characters of `query` do not appear in order inside `candidateText`.
 *
 * @param query User search string.
 * @param candidateText Candidate string to match against.
 * @returns Positive numeric relevance score (`0` for empty query), or `null` when unmatched.
 */
export function scoreFuzzyTextMatch(query: string, candidateText: string): number | null {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) return 0;

  const candidate = candidateText.toLowerCase();
  if (candidate.startsWith(trimmed)) {
    return FUZZY_PREFIX_BASE_SCORE - candidate.length;
  }

  const subIdx = candidate.indexOf(trimmed);
  if (subIdx >= 0) {
    return FUZZY_SUBSTRING_BASE_SCORE - subIdx;
  }

  let qIdx = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let i = 0; i < candidate.length && qIdx < trimmed.length; i++) {
    if (candidate[i] === trimmed[qIdx]) {
      if (firstMatch < 0) firstMatch = i;
      lastMatch = i;
      qIdx++;
    }
  }

  if (qIdx < trimmed.length) return null;
  const span = Math.max(0, lastMatch - firstMatch);
  return Math.max(1, FUZZY_SUBSEQUENCE_BASE_SCORE - span);
}
