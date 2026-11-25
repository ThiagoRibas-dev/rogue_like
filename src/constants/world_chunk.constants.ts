/** Default horizontal and vertical side length of a square WorldChunk in tiles. */
export const DEFAULT_CHUNK_SIZE = 16 as const;

/** Minimum supported WorldChunk side length in tiles. */
export const MIN_CHUNK_SIZE = 8 as const;

/** Maximum supported WorldChunk side length in tiles. */
export const MAX_CHUNK_SIZE = 64 as const;

/** Default Chebyshev radius (in chunks) kept synchronously loaded around the active focal anchor (Ring 0). */
export const DEFAULT_ACTIVE_RADIUS_CHUNKS = 4 as const;

/** Default Chebyshev radius (in chunks) queued for background async worker prefetching (Ring 1). */
export const DEFAULT_PREFETCH_RADIUS_CHUNKS = 6 as const;

/** Default Chebyshev radius (in chunks) beyond which chunks are evicted and distant entities sleep. */
export const DEFAULT_EVICT_RADIUS_CHUNKS = 7 as const;

/** Maximum number of prefetched inactive chunks retained in memory before FIFO eviction. */
export const MAX_PREFETCH_CACHE_CHUNKS = 256 as const;

/** Default tile temperature (degrees Celsius) assigned to newly initialized WorldChunk cells. */
export const DEFAULT_AMBIENT_TEMP_C = 20 as const;

/** Reserved TilePaletteRegistry index representing an empty/unloaded cell. */
export const VOID_TILE_PALETTE_INDEX = 0 as const;

/** Bitmask flag indicating a tile has been explored by the player. */
export const CHUNK_FLAG_EXPLORED = 1 << 0;

/** Bitmask flag indicating natural/unsmoothed worldgen terrain. */
export const CHUNK_FLAG_NATURAL = 1 << 1;

/** Bitmask flag indicating the cell is outdoors / exposed to sky lighting. */
export const CHUNK_FLAG_OUTDOOR = 1 << 2;

/** Bitmask flag indicating worked/smoothed terrain (reserved for sculpting phases). */
export const CHUNK_FLAG_SMOOTHED = 1 << 3;

/** Bitmask flag indicating a cell requires cellular simulation catch-up. */
export const CHUNK_FLAG_DIRTY_CELL = 1 << 4;

/** Chunk-level dirty bitmask: clean (no changes needing persistence or simulation). */
export const CHUNK_DIRTY_NONE = 0;

/** Chunk-level dirty bitmask: chunk has mutations that must be persisted to delta storage. */
export const CHUNK_DIRTY_PERSIST = 1 << 0;

/** Chunk-level dirty bitmask: chunk walkability changed and HPA* regions need rebuild. */
export const CHUNK_DIRTY_REGION = 1 << 1;

/** Chunk-level dirty bitmask: chunk contains active cellular fluid cells. */
export const CHUNK_DIRTY_FLUID = 1 << 2;

/** Chunk-level dirty bitmask: chunk has active temperature gradient diffusion. */
export const CHUNK_DIRTY_TEMP = 1 << 3;

/** Bias applied to signed coordinates for 26-bit integer packing (supports +/- 33,554,431 tiles per axis). */
export const COORD_PACK_BIAS = 33_554_432 as const;

/** Multiplier shifting packed Y coordinates above signed 26-bit packed X coordinates. */
export const COORD_PACK_MULTIPLIER = 67_108_864 as const;

/** Bias applied to signed X/Y coordinates for 20-bit 3D packing (+/- 524,287). */
export const COORD3D_XY_BIAS = 524_288 as const;

/** Radix span for 20-bit signed X/Y coordinates (2^20). */
export const COORD3D_XY_SPAN = 1_048_576 as const;

/** Bias applied to signed Z coordinates for 12-bit 3D packing (+/- 2,047 Z-levels). */
export const COORD3D_Z_BIAS = 2_048 as const;

/** Radix span for 12-bit signed Z coordinates (2^12). */
export const COORD3D_Z_SPAN = 4_096 as const;

/** Multiplier shifting Y above 20-bit X (2^20). */
export const COORD3D_Y_MULT = 1_048_576 as const;

/** Multiplier shifting Z above 40-bit (X, Y) (2^40). */
export const COORD3D_Z_MULT = 1_099_511_627_776 as const;

/** Default vertical elevation height per Z-level in feet (isotropic 5-ft voxel). */
export const DEFAULT_FEET_PER_Z_LEVEL = 5 as const;

/** Safety cap for vertical fall scans when resolving gravity over unbounded open air. */
export const MAX_FALL_DISTANCE_Z = 32 as const;

/** Fallback Console fall damage per Z-level fallen beyond a 1-Z safe hop when no ruleset hook handles falls. */
export const DEFAULT_FALL_DAMAGE_PER_Z = 5 as const;

/** Default vertical chunk streaming radius around originChunkZ when multi-Z streaming is active. */
export const DEFAULT_ACTIVE_RADIUS_Z = 2 as const;

/** Minimum allowed vertical chunk streaming radius in Z-levels. */
export const MIN_ACTIVE_RADIUS_Z = 0 as const;

/** Maximum allowed vertical chunk streaming radius in Z-levels. */
export const MAX_ACTIVE_RADIUS_Z = 8 as const;

/** Maximum lower Z-slices inspected beneath `open_air` during multi-Z viewport rendering. */
export const MAX_RENDER_DEPTH_LAYERS = 3 as const;

/** Maximum vertical span scanned above or below the observer by 3D shadowcasting. */
export const MAX_FOV_Z_RANGE = 8 as const;

/** IndexedDB database name storing delta-serialized streaming WorldChunk buffers. */
export const WORLD_CHUNKS_DB_NAME = 'roguelike_world_chunks' as const;

/** IndexedDB schema version for WorldChunk binary delta storage. */
export const WORLD_CHUNKS_DB_VERSION = 1 as const;

/** IndexedDB object store name holding serialized WorldChunk ArrayBuffers. */
export const WORLD_CHUNKS_STORE = 'world_chunks' as const;

/** 4-byte binary magic header ('RLCK') validating serialized WorldChunk buffers. */
export const WORLD_CHUNK_BINARY_MAGIC = 0x524c434b as const;

/** Binary format version for serialized WorldChunk buffers. */
export const WORLD_CHUNK_BINARY_VERSION = 1 as const;

/** Fixed byte length of the serialized WorldChunk binary header before SoA TypedArray planes. */
export const WORLD_CHUNK_HEADER_BYTES = 32 as const;

/** Fixed byte storage per tile across all six SoA TypedArray planes (`4 * 2B + 2 * 1B`). */
export const WORLD_CHUNK_BYTES_PER_CELL = 10 as const;

/** Byte offset of the 4-byte binary magic header inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_MAGIC = 0 as const;

/** Byte offset of the 2-byte binary format version inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_VERSION = 4 as const;

/** Byte offset of the 2-byte chunk edge size inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_SIZE = 6 as const;

/** Byte offset of the signed 32-bit chunk X coordinate inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_CX = 8 as const;

/** Byte offset of the signed 32-bit chunk Y coordinate inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_CY = 12 as const;

/** Byte offset of the signed 32-bit chunk Z coordinate inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_CZ = 16 as const;

/** Byte offset of the 32-bit dirty flags mask inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_DIRTY = 20 as const;

/** Byte offset of the 64-bit float `lastSimulatedTurn` inside a serialized WorldChunk buffer. */
export const WORLD_CHUNK_HDR_OFFSET_TURN = 24 as const;

/** Minimum allowed Ring 0 active radius in chunks for streaming overworlds. */
export const MIN_ACTIVE_RADIUS_CHUNKS = 1 as const;

/** Maximum allowed Ring 0 active radius in chunks for streaming overworlds. */
export const MAX_ACTIVE_RADIUS_CHUNKS = 12 as const;

/** Minimum allowed Ring 1 prefetch radius in chunks for streaming overworlds. */
export const MIN_PREFETCH_RADIUS_CHUNKS = 1 as const;

/** Maximum allowed Ring 1 prefetch radius in chunks for streaming overworlds. */
export const MAX_PREFETCH_RADIUS_CHUNKS = 16 as const;

/** Minimum allowed eviction radius in chunks for streaming overworlds. */
export const MIN_EVICT_RADIUS_CHUNKS = 2 as const;

/** Maximum allowed eviction radius in chunks for streaming overworlds. */
export const MAX_EVICT_RADIUS_CHUNKS = 20 as const;

/** Default deterministic world seed used by `streaming_overworld` areas when omitted. */
export const DEFAULT_STREAMING_WORLD_SEED = 1337 as const;

/** Default open spawn clearing radius (tiles) around `(0, 0)` on newly generated overworlds. */
export const DEFAULT_SPAWN_CLEARING_RADIUS = 4 as const;

/** Minimum configurable open spawn clearing radius (tiles). */
export const MIN_SPAWN_CLEARING_RADIUS = 1 as const;

/** Maximum configurable open spawn clearing radius (tiles). */
export const MAX_SPAWN_CLEARING_RADIUS = 16 as const;

/** Squared origin distance threshold (`distSq <= 2`) paving road tiles inside the spawn clearing. */
export const SPAWN_CLEARING_ROAD_DIST_SQ = 2 as const;

/** Primary coarse octave cell span (tiles) for streaming overworld fractal value noise. */
export const NOISE_OCTAVE1_SPAN = 24 as const;

/** Primary coarse octave weight for streaming overworld fractal value noise. */
export const NOISE_OCTAVE1_WEIGHT = 0.6 as const;

/** Secondary medium octave cell span (tiles) for streaming overworld fractal value noise. */
export const NOISE_OCTAVE2_SPAN = 10 as const;

/** Secondary medium octave weight for streaming overworld fractal value noise. */
export const NOISE_OCTAVE2_WEIGHT = 0.28 as const;

/** Tertiary fine octave cell span (tiles) for streaming overworld fractal value noise. */
export const NOISE_OCTAVE3_SPAN = 4 as const;

/** Tertiary fine octave weight for streaming overworld fractal value noise. */
export const NOISE_OCTAVE3_WEIGHT = 0.12 as const;

/** Maximum normalized elevation classified as open water in overworld chunk synthesis. */
export const BIOME_WATER_ELEVATION_MAX = 0.24 as const;

/** Maximum normalized elevation classified as shoreline in overworld chunk synthesis. */
export const BIOME_SHORE_ELEVATION_MAX = 0.29 as const;

/** Minimum normalized elevation classified as mountain/cliff ridge in overworld chunk synthesis. */
export const BIOME_RIDGE_ELEVATION_MIN = 0.78 as const;

/** Minimum normalized moisture classified as forest terrain in overworld chunk synthesis. */
export const BIOME_FOREST_MOISTURE_MIN = 0.56 as const;

/** Default maximum sampling iterations for {@link findRandomWalkableCoord}. */
export const DEFAULT_RANDOM_WALKABLE_ATTEMPTS = 100 as const;

/** Default square tile preview span used when inspecting/baking unbounded streaming areas in the editor. */
export const DEFAULT_STREAMING_PREVIEW_SPAN = 40 as const;
