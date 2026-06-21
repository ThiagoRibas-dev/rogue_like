import * as ROT from 'rot-js';

/**
 * The global random number generator instance.
 * We wrap ROT.RNG to ensure all random events in the game are deterministic
 * and can be reproduced by reusing the same seed.
 */
export const rng = ROT.RNG;

/**
 * Initializes the RNG with a specific seed, or a random one if not provided.
 * @param seed Optional seed to initialize the RNG with.
 * @returns The seed that was actually used.
 */
export function initRNG(seed?: number): number {
  const finalSeed = seed !== undefined ? seed : Date.now();
  rng.setSeed(finalSeed);
  console.log(`[RNG] Initialized with seed: ${finalSeed}`);
  return finalSeed;
}

/**
 * Simulates a 3d6 roll (3 six-sided dice), returning a value from 3 to 18.
 * This naturally creates a bell curve distribution where extreme values (3 or 18) are very rare (~0.46%).
 */
export function roll3d6(): number {
  return (
    Math.floor(rng.getUniform() * 6) + 1 + Math.floor(rng.getUniform() * 6) + 1 + Math.floor(rng.getUniform() * 6) + 1
  );
}

/**
 * Generates a personality facet value (0 to 100) using a 3d6 bell curve.
 * 3 -> 0
 * 18 -> 100
 */
export function rollFacetValue(): number {
  const roll = roll3d6();
  // Map 3-18 to 0-100: (roll - 3) * (100 / 15)
  return Math.round((roll - 3) * (100 / 15));
}

/**
 * Generates a personality value (-50 to +50) using a 3d6 bell curve.
 * 3 -> -50
 * 18 -> 50
 */
export function rollPersonalityValue(): number {
  const roll = roll3d6();
  // Map 3-18 to -50 to 50: (roll - 3) * (100 / 15) - 50
  return Math.round((roll - 3) * (100 / 15)) - 50;
}
