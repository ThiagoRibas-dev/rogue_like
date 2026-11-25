import {
  CHUNK_DIRTY_FLUID,
  CHUNK_DIRTY_PERSIST,
  CHUNK_DIRTY_TEMP,
  DEFAULT_AMBIENT_TEMP_C,
  FLUID_DEPTH_MASK,
  FLUID_KIND_MASK,
  FLUID_KIND_SHIFT,
  FluidKindCode,
  SHALLOW_EVAPORATION_TURNS,
  TEMP_AMBIENT_RELAXATION_LAMBDA,
  TEMP_CONVERGENCE_EPSILON_C
} from '../../constants/world_chunk.constants.ts';
import { cloneWorldChunk } from '../../map/world_chunk.ts';
import type { FinitePhysicsSlice, GameState } from '../../types/game-state.types.ts';
import type { WorldChunk } from '../../types/world-chunk.types.ts';

function settleTemperatureValue(
  tempC: number,
  ambientTempC: number,
  factor: number
): {
  readonly nextTemp: number;
  readonly settled: boolean;
} {
  const relaxed = Math.round(ambientTempC + (tempC - ambientTempC) * factor);
  if (Math.abs(relaxed - ambientTempC) <= TEMP_CONVERGENCE_EPSILON_C) {
    return { nextTemp: ambientTempC, settled: true };
  }
  return { nextTemp: relaxed, settled: false };
}

function evaporateShallowFluidByte(byte: number, deltaTurns: number): number {
  if (byte === 0) return 0;
  const depth = byte & FLUID_DEPTH_MASK;
  const kind = (byte & FLUID_KIND_MASK) >> FLUID_KIND_SHIFT;
  if (
    depth === 1 &&
    deltaTurns >= SHALLOW_EVAPORATION_TURNS &&
    (kind === FluidKindCode.Water || kind === FluidKindCode.Oil)
  ) {
    return 0;
  }
  return byte;
}

/**
 * Computes closed-form $O(N_{\text{cells}})$ analytical sleep catch-up on a dormant `WorldChunk`
 * when it wakes from storage (`deltaTurns = currentTurn - chunk.lastSimulatedTurn`).
 *
 * Avoids any per-turn tick loop across arbitrary sleep durations:
 * - Exponentially relaxes cell temperatures toward `ambientTempC`.
 * - Evaporates isolated shallow (`1/7`) water/oil puddles once `deltaTurns >= SHALLOW_EVAPORATION_TURNS`.
 * - Clears `CHUNK_DIRTY_TEMP` / `CHUNK_DIRTY_FLUID` when planes have fully settled.
 */
export function applyAnalyticalChunkCatchUp(
  chunk: WorldChunk,
  currentTurn: number,
  ambientTempC: number = DEFAULT_AMBIENT_TEMP_C
): WorldChunk {
  const deltaTurns = Math.max(0, Math.floor(currentTurn - chunk.lastSimulatedTurn));
  if (deltaTurns <= 0) {
    return chunk.lastSimulatedTurn === currentTurn ? chunk : { ...chunk, lastSimulatedTurn: currentTurn };
  }

  const tempFactor = Math.exp(-TEMP_AMBIENT_RELAXATION_LAMBDA * deltaTurns);
  const needsTempPass = (chunk.dirtyFlags & CHUNK_DIRTY_TEMP) !== 0;
  const needsFluidPass = (chunk.dirtyFlags & CHUNK_DIRTY_FLUID) !== 0 && deltaTurns >= SHALLOW_EVAPORATION_TURNS;

  if (!needsTempPass && !needsFluidPass) {
    return { ...chunk, lastSimulatedTurn: currentTurn };
  }

  const cloned = cloneWorldChunk(chunk);
  let allTempSettled = true;
  let hasFluidRemaining = false;
  let mutated = false;

  const cellCount = cloned.size * cloned.size;
  for (let i = 0; i < cellCount; i++) {
    if (needsTempPass) {
      const curT = cloned.temperature[i] ?? ambientTempC;
      const res = settleTemperatureValue(curT, ambientTempC, tempFactor);
      if (res.nextTemp !== curT) {
        cloned.temperature[i] = res.nextTemp;
        mutated = true;
      }
      if (!res.settled) {
        allTempSettled = false;
      }
    }

    const curF = cloned.fluid[i] ?? 0;
    if (needsFluidPass && curF !== 0) {
      const nextF = evaporateShallowFluidByte(curF, deltaTurns);
      if (nextF !== curF) {
        cloned.fluid[i] = nextF;
        mutated = true;
      }
      if (nextF !== 0) {
        hasFluidRemaining = true;
      }
    } else if (curF !== 0) {
      hasFluidRemaining = true;
    }
  }

  let nextDirtyFlags = cloned.dirtyFlags;
  if (needsTempPass && allTempSettled) {
    nextDirtyFlags &= ~CHUNK_DIRTY_TEMP;
  }
  if (needsFluidPass && !hasFluidRemaining) {
    nextDirtyFlags &= ~CHUNK_DIRTY_FLUID;
  }
  if (mutated) {
    nextDirtyFlags |= CHUNK_DIRTY_PERSIST;
  }

  return {
    ...cloned,
    dirtyFlags: nextDirtyFlags,
    lastSimulatedTurn: currentTurn
  };
}

function applyAnalyticalFiniteSliceCatchUp(
  slice: FinitePhysicsSlice,
  currentTurn: number,
  ambientTempC: number
): FinitePhysicsSlice {
  const deltaTurns = Math.max(0, Math.floor(currentTurn - slice.lastSimulatedTurn));
  if (deltaTurns <= 0) {
    return slice.lastSimulatedTurn === currentTurn ? slice : { ...slice, lastSimulatedTurn: currentTurn };
  }

  const tempFactor = Math.exp(-TEMP_AMBIENT_RELAXATION_LAMBDA * deltaTurns);
  const needsTempPass = (slice.dirtyFlags & CHUNK_DIRTY_TEMP) !== 0;
  const needsFluidPass = (slice.dirtyFlags & CHUNK_DIRTY_FLUID) !== 0 && deltaTurns >= SHALLOW_EVAPORATION_TURNS;

  if (!needsTempPass && !needsFluidPass) {
    return { ...slice, lastSimulatedTurn: currentTurn };
  }

  const nextTemp = needsTempPass ? [...slice.temperature] : slice.temperature;
  const nextFluid = needsFluidPass ? [...slice.fluid] : slice.fluid;
  let allTempSettled = true;
  let hasFluidRemaining = false;

  for (let i = 0; i < slice.fluid.length; i++) {
    if (needsTempPass) {
      const curT = slice.temperature[i] ?? ambientTempC;
      const res = settleTemperatureValue(curT, ambientTempC, tempFactor);
      (nextTemp as number[])[i] = res.nextTemp;
      if (!res.settled) allTempSettled = false;
    }
    const curF = slice.fluid[i] ?? 0;
    if (needsFluidPass && curF !== 0) {
      const nextF = evaporateShallowFluidByte(curF, deltaTurns);
      (nextFluid as number[])[i] = nextF;
      if (nextF !== 0) hasFluidRemaining = true;
    } else if (curF !== 0) {
      hasFluidRemaining = true;
    }
  }

  let nextDirtyFlags = slice.dirtyFlags;
  if (needsTempPass && allTempSettled) nextDirtyFlags &= ~CHUNK_DIRTY_TEMP;
  if (needsFluidPass && !hasFluidRemaining) nextDirtyFlags &= ~CHUNK_DIRTY_FLUID;

  return {
    ...slice,
    fluid: nextFluid,
    temperature: nextTemp,
    dirtyFlags: nextDirtyFlags,
    lastSimulatedTurn: currentTurn
  };
}

/**
 * Applies closed-form analytical catch-up across every loaded chunk or finite physics slice
 * in `state.map` (used during bulk time-skips and dormant area wakes).
 */
export function applyAnalyticalActiveGridCatchUp(
  state: GameState,
  deltaTurns: number,
  ambientTempC: number = DEFAULT_AMBIENT_TEMP_C
): GameState {
  if (deltaTurns <= 0) return state;
  const effectiveTurn = state.globalTurn;
  const grid = state.map.chunkGrid;

  if (grid !== undefined) {
    let anyChanged = false;
    const nextChunks = new Map(grid.chunks);
    for (const [key, chunk] of grid.chunks.entries()) {
      const targetChunk =
        chunk.lastSimulatedTurn > effectiveTurn - deltaTurns
          ? { ...chunk, lastSimulatedTurn: effectiveTurn - deltaTurns }
          : chunk;
      const updated = applyAnalyticalChunkCatchUp(targetChunk, effectiveTurn, ambientTempC);
      if (updated !== chunk) {
        nextChunks.set(key, updated);
        anyChanged = true;
      }
    }
    if (!anyChanged) return state;
    return {
      ...state,
      map: {
        ...state.map,
        chunkGrid: { ...grid, chunks: nextChunks }
      }
    };
  }

  const slices = state.map.physicsOverlay?.slices;
  if (!slices) return state;

  let anyChanged = false;
  const nextSlices: Record<number, FinitePhysicsSlice> = {};
  for (const [zStr, slice] of Object.entries(slices)) {
    const z = Number(zStr);
    const baselineSlice =
      slice.lastSimulatedTurn > effectiveTurn - deltaTurns
        ? { ...slice, lastSimulatedTurn: effectiveTurn - deltaTurns }
        : slice;
    const updated = applyAnalyticalFiniteSliceCatchUp(baselineSlice, effectiveTurn, ambientTempC);
    nextSlices[z] = updated;
    if (updated !== slice) anyChanged = true;
  }

  if (!anyChanged) return state;
  return {
    ...state,
    map: {
      ...state.map,
      physicsOverlay: { slices: nextSlices }
    }
  };
}
