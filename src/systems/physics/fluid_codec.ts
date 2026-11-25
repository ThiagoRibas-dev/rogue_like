import {
  FLUID_DEPTH_MASK,
  FLUID_KIND_MASK,
  FLUID_KIND_SHIFT,
  FluidKindCode,
  MAX_FLUID_DEPTH,
  type FluidKind
} from '../../constants/world_chunk.constants.ts';

/** Decoded fluid kind + 0..7 depth extracted from a packed `WorldChunk.fluid` byte. */
export interface FluidCellInfo {
  readonly kind: FluidKind;
  readonly depth: number;
}

const CODE_TO_KIND: Readonly<Record<number, FluidKind>> = {
  [FluidKindCode.None]: 'none',
  [FluidKindCode.Water]: 'water',
  [FluidKindCode.Magma]: 'magma',
  [FluidKindCode.Oil]: 'oil',
  [FluidKindCode.Mud]: 'mud'
};

const KIND_TO_CODE: Readonly<Record<FluidKind, FluidKindCode>> = {
  none: FluidKindCode.None,
  water: FluidKindCode.Water,
  magma: FluidKindCode.Magma,
  oil: FluidKindCode.Oil,
  mud: FluidKindCode.Mud
};

/** Encodes a `FluidKind` and integer depth `0..7` into a single `Uint8` fluid cell byte. */
export function packFluidCell(kind: FluidKind, depth: number): number {
  const clampedDepth = Math.max(0, Math.min(MAX_FLUID_DEPTH, Math.round(depth)));
  if (kind === 'none' || clampedDepth <= 0) return 0;
  const code = KIND_TO_CODE[kind];
  return ((code << FLUID_KIND_SHIFT) & FLUID_KIND_MASK) | (clampedDepth & FLUID_DEPTH_MASK);
}

/** Decodes an 8-bit fluid cell byte into `{ kind, depth }`. */
export function unpackFluidCell(byte: number): FluidCellInfo {
  const depth = byte & FLUID_DEPTH_MASK;
  const code = (byte & FLUID_KIND_MASK) >> FLUID_KIND_SHIFT;
  const kind = CODE_TO_KIND[code] ?? 'none';
  if (depth <= 0 || kind === 'none') {
    return { kind: 'none', depth: 0 };
  }
  return { kind, depth };
}

/** Extracts just the numeric `FluidKindCode` from an 8-bit fluid byte. */
export function unpackFluidKindCode(byte: number): number {
  return (byte & FLUID_KIND_MASK) >> FLUID_KIND_SHIFT;
}
