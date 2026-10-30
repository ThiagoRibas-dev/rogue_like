import type { CampaignData } from '../types/campaign.types.ts';
import type { DirectorContext } from '../types/encounter.types.ts';
import type { FuzzerOptions, FuzzerReport } from '../editor/simulation/fuzzer.types.ts';
import type { GeneratedArea } from '../map/generator.ts';
import { generateAreaAsync } from '../map/generator_async.ts';
import { runNarrativeFuzzerAsync } from '../editor/simulation/narrative_fuzzer_async.ts';
import type {
  WorkerProgressPayload,
  WorkerResponse,
  FuzzerWorkerRequest,
  MapWorkerRequest,
  SerializableDirectorContext
} from '../types/worker.types.ts';

let nextRequestId = 1;

/**
 * Checks whether Web Workers are supported in the current runtime environment.
 * @returns True if Worker constructor is globally available.
 */
export function isWorkerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Converts a live DirectorContext with Sets into a plain serializable DTO for worker messaging.
 * @param context Live director context.
 * @returns Plain serializable director context DTO.
 */
function serializeDirectorContext(context?: DirectorContext): SerializableDirectorContext | undefined {
  if (!context) return undefined;
  return {
    playerLevel: context.playerLevel,
    tokenPool: Array.from(context.tokenPool),
    areaMutation: context.areaMutation,
    reservedTokens: context.reservedTokens,
    hotPathCoords: context.hotPathCoords ? Array.from(context.hotPathCoords) : undefined
  };
}

/**
 * Executes a worker task over postMessage, resolving upon success or rejecting on error.
 * @param createWorker Factory creating a fresh dedicated Web Worker.
 * @param request Request payload to send.
 * @param onProgress Optional progress callback.
 * @returns Settled task result promise.
 */
function dispatchWorkerJob<TReq extends FuzzerWorkerRequest | MapWorkerRequest, TRes>(
  createWorker: () => Worker,
  request: TReq,
  onProgress?: (progress: WorkerProgressPayload) => void
): Promise<TRes> {
  return new Promise<TRes>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = createWorker();
    } catch (err) {
      reject(err);
      return;
    }

    worker.onmessage = (event: MessageEvent<WorkerResponse<TRes>>): void => {
      const msg = event.data;
      if (!msg || msg.id !== request.id) return;

      if (msg.type === 'progress') {
        onProgress?.(msg.payload);
      } else if (msg.type === 'success') {
        worker.terminate();
        resolve(msg.result);
      } else if (msg.type === 'error') {
        worker.terminate();
        reject(new Error(msg.error));
      }
    };

    worker.onerror = (err: ErrorEvent): void => {
      worker.terminate();
      reject(new Error(err.message || 'Worker thread execution encountered an unhandled error.'));
    };

    worker.postMessage(request);
  });
}

/**
 * Main-thread cooperative fallback for narrative fuzzer simulations when workers are unavailable.
 * Slices execution across event loop cycles using setTimeout(..., 0).
 */
async function runFuzzerMainThreadFallback(
  campaign: CampaignData,
  options: FuzzerOptions,
  onProgress?: (progress: WorkerProgressPayload) => void
): Promise<FuzzerReport> {
  const generator = runNarrativeFuzzerAsync(campaign, options);
  let step = generator.next();

  while (!step.done) {
    const progress = step.value;
    onProgress?.({
      progress: progress.percent,
      message: progress.message,
      currentRun: progress.currentRun,
      totalRuns: progress.totalRuns,
      currentTurn: progress.currentTurn,
      maxTurns: progress.maxTurns
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    step = generator.next();
  }

  return step.value;
}

/**
 * Main-thread cooperative fallback for procedural map generation when workers are unavailable.
 * Slices execution across event loop cycles using setTimeout(..., 0).
 */
async function generateMapMainThreadFallback(
  campaign: CampaignData,
  areaId: string,
  context?: DirectorContext,
  onProgress?: (progress: WorkerProgressPayload) => void
): Promise<GeneratedArea> {
  const generator = generateAreaAsync(campaign, areaId, context);
  let step = generator.next();

  while (!step.done) {
    const progress = step.value;
    onProgress?.({
      progress: progress.progress,
      message: progress.message,
      stage: progress.stage
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    step = generator.next();
  }

  return step.value;
}

/**
 * Dispatches a narrative fuzzer batch to a Web Worker, falling back to main-thread async generator.
 * @param campaign Active campaign data.
 * @param options Fuzzer execution options.
 * @param onProgress Optional progress handler.
 * @returns Final fuzzer aggregate report.
 */
export async function runFuzzerOffload(
  campaign: CampaignData,
  options: FuzzerOptions,
  onProgress?: (progress: WorkerProgressPayload) => void
): Promise<FuzzerReport> {
  const id = `fuzzer_${nextRequestId++}`;
  const request: FuzzerWorkerRequest = {
    id,
    type: 'run_fuzzer',
    campaign,
    options
  };

  if (!isWorkerAvailable()) {
    return runFuzzerMainThreadFallback(campaign, options, onProgress);
  }

  try {
    return await dispatchWorkerJob<FuzzerWorkerRequest, FuzzerReport>(
      () => new Worker(new URL('./fuzzer.worker.ts', import.meta.url), { type: 'module' }),
      request,
      onProgress
    );
  } catch (err) {
    console.warn('Fuzzer worker dispatch failed, falling back to main thread generator:', err);
    return runFuzzerMainThreadFallback(campaign, options, onProgress);
  }
}

/**
 * Dispatches procedural map generation to a Web Worker, falling back to main-thread async generator.
 * @param campaign Active campaign data.
 * @param areaId ID of area to generate.
 * @param context Optional director scaling context.
 * @param onProgress Optional progress handler.
 * @returns Fully generated area output.
 */
export async function generateMapOffload(
  campaign: CampaignData,
  areaId: string,
  context?: DirectorContext,
  onProgress?: (progress: WorkerProgressPayload) => void
): Promise<GeneratedArea> {
  const id = `map_${nextRequestId++}`;
  const request: MapWorkerRequest = {
    id,
    type: 'generate_map',
    campaign,
    areaId,
    context: serializeDirectorContext(context)
  };

  if (!isWorkerAvailable()) {
    return generateMapMainThreadFallback(campaign, areaId, context, onProgress);
  }

  try {
    return await dispatchWorkerJob<MapWorkerRequest, GeneratedArea>(
      () => new Worker(new URL('./map.worker.ts', import.meta.url), { type: 'module' }),
      request,
      onProgress
    );
  } catch (err) {
    console.warn('Map worker dispatch failed, falling back to main thread generator:', err);
    return generateMapMainThreadFallback(campaign, areaId, context, onProgress);
  }
}
