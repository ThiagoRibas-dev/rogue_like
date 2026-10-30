import { generateAreaAsync } from '../map/generator_async.ts';
import type {
  MapWorkerRequest,
  WorkerProgressMessage,
  WorkerSuccessMessage,
  WorkerErrorMessage
} from './worker.types.ts';
import type { GeneratedArea } from '../map/generator.ts';
import type { DirectorContext } from '../types/encounter.types.ts';

self.onmessage = (event: MessageEvent<MapWorkerRequest>): void => {
  const data = event.data;
  if (!data || data.type !== 'generate_map') return;

  try {
    const context: DirectorContext | undefined = data.context
      ? {
          playerLevel: data.context.playerLevel,
          tokenPool: new Set(data.context.tokenPool),
          areaMutation: data.context.areaMutation,
          reservedTokens: data.context.reservedTokens,
          hotPathCoords: data.context.hotPathCoords ? new Set(data.context.hotPathCoords) : undefined
        }
      : undefined;

    const generator = generateAreaAsync(data.campaign, data.areaId, context);
    let step = generator.next();
    while (!step.done) {
      const progress = step.value;
      const progressMsg: WorkerProgressMessage = {
        id: data.id,
        type: 'progress',
        payload: {
          progress: progress.progress,
          message: progress.message,
          stage: progress.stage
        }
      };
      self.postMessage(progressMsg);
      step = generator.next();
    }

    const successMsg: WorkerSuccessMessage<GeneratedArea> = {
      id: data.id,
      type: 'success',
      result: step.value
    };
    self.postMessage(successMsg);
  } catch (err) {
    const errorMsg: WorkerErrorMessage = {
      id: data.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    };
    self.postMessage(errorMsg);
  }
};
