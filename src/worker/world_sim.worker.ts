import { advanceMacroWorldTicks } from '../systems/macro/macro_world.system.ts';
import type { MacroTickDeltaBatch } from '../types/macro_world.types.ts';
import type { MacroWorldTickWorkerRequest, WorkerErrorMessage, WorkerSuccessMessage } from './worker.types.ts';

self.onmessage = (event: MessageEvent<MacroWorldTickWorkerRequest>): void => {
  const data = event.data;
  if (!data || data.type !== 'macro_world_tick') return;

  try {
    const batch = advanceMacroWorldTicks(data.macroWorld, data.targetTick, data.context);
    const successMsg: WorkerSuccessMessage<MacroTickDeltaBatch> = {
      id: data.id,
      type: 'success',
      result: batch
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
