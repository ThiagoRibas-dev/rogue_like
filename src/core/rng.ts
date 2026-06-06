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
