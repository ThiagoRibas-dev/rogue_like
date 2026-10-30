import { runNarrativeFuzzerAsync } from '../editor/simulation/narrative_fuzzer_async.ts';
import type {
  FuzzerWorkerRequest,
  WorkerProgressMessage,
  WorkerSuccessMessage,
  WorkerErrorMessage
} from './worker.types.ts';
import type { FuzzerReport } from '../editor/simulation/fuzzer.types.ts';

self.onmessage = (event: MessageEvent<FuzzerWorkerRequest>): void => {
  const data = event.data;
  if (!data || data.type !== 'run_fuzzer') return;

  try {
    const generator = runNarrativeFuzzerAsync(data.campaign, data.options);
    let step = generator.next();
    while (!step.done) {
      const progress = step.value;
      const progressMsg: WorkerProgressMessage = {
        id: data.id,
        type: 'progress',
        payload: {
          progress: progress.percent,
          message: progress.message,
          currentRun: progress.currentRun,
          totalRuns: progress.totalRuns,
          currentTurn: progress.currentTurn,
          maxTurns: progress.maxTurns
        }
      };
      self.postMessage(progressMsg);
      step = generator.next();
    }

    const successMsg: WorkerSuccessMessage<FuzzerReport> = {
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
