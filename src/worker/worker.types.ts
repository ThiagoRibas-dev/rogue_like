import type { CampaignData } from '../types/campaign.types.ts';
import type { EntityId } from '../types/game-state.types.ts';
import type { FuzzerOptions, FuzzerReport } from '../types/fuzzer.types.ts';
import type { GeneratedArea } from '../map/generator.ts';
import type { ChunkSynthesisParams } from '../map/chunk_generator.ts';
import type { MapGenStage } from '../constants/scheduler.constants.ts';
import type {
  LegendsWorldgenInput,
  MacroSimCampaignContext,
  MacroTickDeltaBatch,
  MacroWorldState
} from '../types/macro_world.types.ts';

/** Serializable director context for thread boundaries without Set/Map. */
export interface SerializableDirectorContext {
  readonly playerLevel: number;
  readonly tokenPool: ReadonlyArray<string>;
  readonly areaMutation?: { readonly addedTags: ReadonlyArray<string>; readonly budgetModifier: number } | undefined;
  readonly reservedTokens?: ReadonlyArray<{ readonly templateId: string; readonly minionId: EntityId }> | undefined;
  readonly hotPathCoords?: ReadonlyArray<string> | undefined;
}

/** Payload for requesting a narrative fuzzer batch run. */
export interface FuzzerWorkerRequest {
  readonly id: string;
  readonly type: 'run_fuzzer';
  readonly campaign: CampaignData;
  readonly options: FuzzerOptions;
}

/** Payload for requesting asynchronous map generation. */
export interface MapWorkerRequest {
  readonly id: string;
  readonly type: 'generate_map';
  readonly campaign: CampaignData;
  readonly areaId: string;
  readonly context?: SerializableDirectorContext | undefined;
}

/** Coordinates identifying a single chunk inside a batch generation request. */
export interface StreamingChunkCoord {
  readonly cx: number;
  readonly cy: number;
  readonly cz: number;
}

/** Payload for requesting a batch of deterministically synthesized WorldChunks off-thread. */
export interface ChunkBatchWorkerRequest {
  readonly id: string;
  readonly type: 'generate_chunk_batch';
  readonly params: ChunkSynthesisParams;
  readonly coords: ReadonlyArray<StreamingChunkCoord>;
}

/** Zero-copy transferable response payload returning serialized ArrayBuffers for requested chunks. */
export interface GeneratedChunkTransferPayload {
  readonly coords: ReadonlyArray<StreamingChunkCoord>;
  readonly buffers: ReadonlyArray<ArrayBuffer>;
}

/** Payload requesting Ring 2 macro-world tick advancement in persistent `world_sim.worker.ts`. */
export interface MacroWorldTickWorkerRequest {
  readonly id: string;
  readonly type: 'macro_world_tick';
  readonly macroWorld: MacroWorldState;
  readonly targetTick: number;
  readonly context: MacroSimCampaignContext;
}

/** Payload requesting offline multi-century continent and Legends worldgen. */
export interface LegendsWorldgenWorkerRequest {
  readonly id: string;
  readonly type: 'legends_worldgen';
  readonly input: LegendsWorldgenInput;
}

/** Union of all worker request message contracts. */
export type WorkerRequest =
  | FuzzerWorkerRequest
  | MapWorkerRequest
  | ChunkBatchWorkerRequest
  | MacroWorldTickWorkerRequest
  | LegendsWorldgenWorkerRequest;

/** Progress payload reported by offloaded worker tasks. */
export interface WorkerProgressPayload {
  readonly progress: number;
  readonly message: string;
  readonly stage?: MapGenStage | undefined;
  readonly currentRun?: number | undefined;
  readonly totalRuns?: number | undefined;
  readonly currentTurn?: number | undefined;
  readonly maxTurns?: number | undefined;
}

/** Progress update message sent from worker to main thread. */
export interface WorkerProgressMessage {
  readonly id: string;
  readonly type: 'progress';
  readonly payload: WorkerProgressPayload;
}

/** Successful result message sent from worker to main thread. */
export interface WorkerSuccessMessage<T> {
  readonly id: string;
  readonly type: 'success';
  readonly result: T;
}

/** Error report message sent from worker to main thread. */
export interface WorkerErrorMessage {
  readonly id: string;
  readonly type: 'error';
  readonly error: string;
}

/** Discriminated union of all worker responses. */
export type WorkerResponse<T> = WorkerProgressMessage | WorkerSuccessMessage<T> | WorkerErrorMessage;

/** Specific response type for map generation workers. */
export type MapWorkerResponse = WorkerResponse<GeneratedArea>;

/** Specific response type for narrative fuzzer workers. */
export type FuzzerWorkerResponse = WorkerResponse<FuzzerReport>;

/** Specific response type for Ring 2 macro-world simulation workers. */
export type MacroWorldTickWorkerResponse = WorkerResponse<MacroTickDeltaBatch>;

/** Specific response type for offline Legends worldgen workers. */
export type LegendsWorldgenWorkerResponse = WorkerResponse<MacroWorldState>;
