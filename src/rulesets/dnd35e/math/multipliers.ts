/**
 * D&D 3.5e rounding and abstract vs. real-world multiplier combinators (`/docs/dnd35e/rules/combat/multiplying.md`).
 */

/** Base identity multiplier for D&D 3.5e multiplier math. */
const BASE_MULTIPLIER = 1;

/**
 * Applies the universal D&D 3.5e rounding rule: always round down (`Math.floor`) toward
 * negative infinity (or minimum clamp when specified).
 *
 * @param value Raw numeric value to floor.
 * @param minimum Optional floor clamp (e.g. `1` for minimum damage/HP per HD).
 * @returns Floored integer value.
 */
export function dndFloor(value: number, minimum?: number): number {
  const floored = Math.floor(value);
  if (minimum !== undefined) {
    return Math.max(minimum, floored);
  }
  return floored;
}

/**
 * Combines multiple abstract D&D 3.5e multipliers (such as critical hit multipliers,
 * valorous charge doubling, or Spirited Charge) using the SRD additive-excess formula:
 *
 * $$M_{\text{total}} = 1 + \sum_{i} (M_i - 1)$$
 *
 * Example: two $\times 2$ multipliers combine into $\times 3$ ($1 + (2-1) + (2-1) = 3$),
 * and $\times 2$ with $\times 1.5$ combines into $\times 2.5$.
 *
 * @param multipliers Array of abstract multipliers (each $\ge 1$).
 * @returns Combined effective multiplier.
 */
export function combineAbstractMultipliers(multipliers: ReadonlyArray<number>): number {
  if (multipliers.length === 0) return BASE_MULTIPLIER;

  let excessSum = 0;
  for (const m of multipliers) {
    if (m > BASE_MULTIPLIER) {
      excessSum += m - BASE_MULTIPLIER;
    }
  }
  return BASE_MULTIPLIER + excessSum;
}

/**
 * Combines multipliers that apply to real-world physical quantities (distance, weight,
 * carrying capacity, light radius, or time) using standard sequential multiplication:
 *
 * $$M_{\text{real}} = \prod_{i} M_i$$
 *
 * @param multipliers Array of real-world multipliers.
 * @returns Product of all multipliers.
 */
export function combineRealWorldMultipliers(multipliers: ReadonlyArray<number>): number {
  if (multipliers.length === 0) return BASE_MULTIPLIER;

  let product = BASE_MULTIPLIER;
  for (const m of multipliers) {
    product *= m;
  }
  return product;
}
