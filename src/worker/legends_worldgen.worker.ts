import { simulateWorldLegendsAsync } from '../systems/macro/legends_simulator.ts';
import type { MacroWorldState } from '../types/macro_world.types.ts';
import type {
  LegendsWorldgenWorkerRequest,
  WorkerErrorMessage,
  WorkerProgressMessage,
  WorkerSuccessMessage
} from './worker.types.ts';

self.onmessage = (event: MessageEvent<LegendsWorldgenWorkerRequest>): void => {
  const data = event.data;
  if (!data || data.type !== 'legends_worldgen') return;

  try {
    const generator = simulateWorldLegendsAsync(data.input);
    let step = generator.next();
    while (!step.done) {
      const progressMsg: WorkerProgressMessage = {
        id: data.id,
        type: 'progress',
        payload: step.value
      };
      self.postMessage(progressMsg);
      step = generator.next();
    }
    const successMsg: WorkerSuccessMessage<MacroWorldState> = {
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
