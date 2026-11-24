import {
  CHUNK_DIRTY_NONE,
  DEFAULT_AMBIENT_TEMP_C,
  DEFAULT_CHUNK_SIZE,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  WORLD_CHUNK_BINARY_MAGIC,
  WORLD_CHUNK_BINARY_VERSION,
  WORLD_CHUNK_BYTES_PER_CELL,
  WORLD_CHUNK_HDR_OFFSET_CX,
  WORLD_CHUNK_HDR_OFFSET_CY,
  WORLD_CHUNK_HDR_OFFSET_CZ,
  WORLD_CHUNK_HDR_OFFSET_DIRTY,
  WORLD_CHUNK_HDR_OFFSET_MAGIC,
  WORLD_CHUNK_HDR_OFFSET_SIZE,
  WORLD_CHUNK_HDR_OFFSET_TURN,
  WORLD_CHUNK_HDR_OFFSET_VERSION,
  WORLD_CHUNK_HEADER_BYTES
} from '../constants/world_chunk.constants.ts';
import type { WorldChunk } from '../types/world-chunk.types.ts';

/**
 * Allocates an initialized Structure-of-Arrays (SoA) `WorldChunk` filled with default ambient temperature
 * and zeroed tile/material/fluid/flag/region planes.
 *
 * @param cx Signed chunk X coordinate.
 * @param cy Signed chunk Y coordinate.
 * @param cz Signed chunk Z coordinate (default `0`).
 * @param size Chunk square edge length in tiles (default `DEFAULT_CHUNK_SIZE`).
 * @returns Newly allocated `WorldChunk`.
 */
export function createEmptyWorldChunk(cx: number, cy: number, cz = 0, size: number = DEFAULT_CHUNK_SIZE): WorldChunk {
  const safeSize = Math.max(MIN_CHUNK_SIZE, Math.min(MAX_CHUNK_SIZE, Math.floor(size)));
  const cellCount = safeSize * safeSize;
  const temperature = new Int16Array(cellCount);
  temperature.fill(DEFAULT_AMBIENT_TEMP_C);

  return {
    cx,
    cy,
    cz,
    size: safeSize,
    tileType: new Uint16Array(cellCount),
    materialId: new Uint16Array(cellCount),
    fluid: new Uint8Array(cellCount),
    temperature,
    flags: new Uint8Array(cellCount),
    regionId: new Uint16Array(cellCount),
    dirtyFlags: CHUNK_DIRTY_NONE,
    lastSimulatedTurn: 0
  };
}

/**
 * Creates a shallow structural clone of a `WorldChunk` with fresh copies of all SoA TypedArray planes
 * so immutable `GameState` snapshots never share mutable buffer state.
 *
 * @param chunk Source WorldChunk.
 * @returns Isolated cloned WorldChunk.
 */
export function cloneWorldChunk(chunk: WorldChunk): WorldChunk {
  return {
    cx: chunk.cx,
    cy: chunk.cy,
    cz: chunk.cz,
    size: chunk.size,
    tileType: new Uint16Array(chunk.tileType),
    materialId: new Uint16Array(chunk.materialId),
    fluid: new Uint8Array(chunk.fluid),
    temperature: new Int16Array(chunk.temperature),
    flags: new Uint8Array(chunk.flags),
    regionId: new Uint16Array(chunk.regionId),
    dirtyFlags: chunk.dirtyFlags,
    lastSimulatedTurn: chunk.lastSimulatedTurn
  };
}

/**
 * Serializes a `WorldChunk` into a compact, zero-copy transferable `ArrayBuffer`
 * suitable for Web Worker messaging and IndexedDB delta persistence (~10 bytes/tile + 32-byte header).
 *
 * @param chunk WorldChunk to encode.
 * @returns Compact binary `ArrayBuffer`.
 */
export function serializeWorldChunkToBuffer(chunk: WorldChunk): ArrayBuffer {
  const cellCount = chunk.size * chunk.size;
  const totalBytes = WORLD_CHUNK_HEADER_BYTES + cellCount * WORLD_CHUNK_BYTES_PER_CELL;
  const buffer = new ArrayBuffer(totalBytes);
  const view = new DataView(buffer);

  view.setUint32(WORLD_CHUNK_HDR_OFFSET_MAGIC, WORLD_CHUNK_BINARY_MAGIC, true);
  view.setUint16(WORLD_CHUNK_HDR_OFFSET_VERSION, WORLD_CHUNK_BINARY_VERSION, true);
  view.setUint16(WORLD_CHUNK_HDR_OFFSET_SIZE, chunk.size, true);
  view.setInt32(WORLD_CHUNK_HDR_OFFSET_CX, chunk.cx, true);
  view.setInt32(WORLD_CHUNK_HDR_OFFSET_CY, chunk.cy, true);
  view.setInt32(WORLD_CHUNK_HDR_OFFSET_CZ, chunk.cz, true);
  view.setUint32(WORLD_CHUNK_HDR_OFFSET_DIRTY, chunk.dirtyFlags, true);
  view.setFloat64(WORLD_CHUNK_HDR_OFFSET_TURN, chunk.lastSimulatedTurn, true);

  let offset = WORLD_CHUNK_HEADER_BYTES;
  // Write 16-bit planes first so every offset remains 2-byte aligned.
  new Uint16Array(buffer, offset, cellCount).set(chunk.tileType);
  offset += cellCount * 2;
  new Uint16Array(buffer, offset, cellCount).set(chunk.materialId);
  offset += cellCount * 2;
  new Int16Array(buffer, offset, cellCount).set(chunk.temperature);
  offset += cellCount * 2;
  new Uint16Array(buffer, offset, cellCount).set(chunk.regionId);
  offset += cellCount * 2;
  new Uint8Array(buffer, offset, cellCount).set(chunk.fluid);
  offset += cellCount;
  new Uint8Array(buffer, offset, cellCount).set(chunk.flags);

  return buffer;
}

/**
 * Decodes a binary `ArrayBuffer` produced by {@link serializeWorldChunkToBuffer} into an isolated `WorldChunk`.
 *
 * @param buffer Serialized chunk ArrayBuffer.
 * @returns Decoded `WorldChunk` owning fresh `TypedArray` planes.
 */
export function deserializeWorldChunkFromBuffer(buffer: ArrayBuffer): WorldChunk {
  if (buffer.byteLength < WORLD_CHUNK_HEADER_BYTES) {
    throw new Error(`Invalid WorldChunk buffer length: ${buffer.byteLength}`);
  }
  const view = new DataView(buffer);
  const magic = view.getUint32(WORLD_CHUNK_HDR_OFFSET_MAGIC, true);
  if (magic !== WORLD_CHUNK_BINARY_MAGIC) {
    throw new Error(`Invalid WorldChunk magic header: 0x${magic.toString(16)}`);
  }
  const version = view.getUint16(WORLD_CHUNK_HDR_OFFSET_VERSION, true);
  if (version !== WORLD_CHUNK_BINARY_VERSION) {
    throw new Error(`Unsupported WorldChunk binary version: ${version}`);
  }

  const size = view.getUint16(WORLD_CHUNK_HDR_OFFSET_SIZE, true);
  if (size < MIN_CHUNK_SIZE || size > MAX_CHUNK_SIZE) {
    throw new Error(`Out-of-bounds WorldChunk size: ${size}`);
  }
  const cellCount = size * size;
  const expectedBytes = WORLD_CHUNK_HEADER_BYTES + cellCount * WORLD_CHUNK_BYTES_PER_CELL;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(`Truncated WorldChunk buffer: got ${buffer.byteLength}, expected ${expectedBytes}`);
  }

  const cx = view.getInt32(WORLD_CHUNK_HDR_OFFSET_CX, true);
  const cy = view.getInt32(WORLD_CHUNK_HDR_OFFSET_CY, true);
  const cz = view.getInt32(WORLD_CHUNK_HDR_OFFSET_CZ, true);
  const dirtyFlags = view.getUint32(WORLD_CHUNK_HDR_OFFSET_DIRTY, true);
  const lastSimulatedTurn = view.getFloat64(WORLD_CHUNK_HDR_OFFSET_TURN, true);

  let offset = WORLD_CHUNK_HEADER_BYTES;
  const tileType = new Uint16Array(buffer.slice(offset, offset + cellCount * 2));
  offset += cellCount * 2;
  const materialId = new Uint16Array(buffer.slice(offset, offset + cellCount * 2));
  offset += cellCount * 2;
  const temperature = new Int16Array(buffer.slice(offset, offset + cellCount * 2));
  offset += cellCount * 2;
  const regionId = new Uint16Array(buffer.slice(offset, offset + cellCount * 2));
  offset += cellCount * 2;
  const fluid = new Uint8Array(buffer.slice(offset, offset + cellCount));
  offset += cellCount;
  const flags = new Uint8Array(buffer.slice(offset, offset + cellCount));

  return {
    cx,
    cy,
    cz,
    size,
    tileType,
    materialId,
    fluid,
    temperature,
    flags,
    regionId,
    dirtyFlags,
    lastSimulatedTurn
  };
}
