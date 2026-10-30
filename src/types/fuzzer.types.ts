export interface FuzzerOptions {
  readonly runs: number;
  readonly maxTurns: number;
  readonly seedOverride?: string | undefined;
  readonly stopOnFirstError?: boolean | undefined;
}

export type FuzzerErrorType = 'softlock' | 'runaway_trigger' | 'save_bloat' | 'unhandled_exception';

export interface FuzzerError {
  readonly type: FuzzerErrorType;
  readonly message: string;
  readonly turn: number;
  readonly seed: string;
}

export interface FuzzerTelemetry {
  readonly seed: string;
  readonly turnsElapsed: number;
  readonly error: FuzzerError | null;
  readonly events: ReadonlyArray<string>; // Timeline of major drama events
  readonly dramaCount: number;
  readonly clueCount: number;
  readonly schemeMutations: number;
  readonly finalSaveSize: number;
}

export interface FuzzerReport {
  readonly results: ReadonlyArray<FuzzerTelemetry>;
  readonly aggregate: {
    readonly totalRuns: number;
    readonly successfulRuns: number;
    readonly failedRuns: number;
    readonly avgTurns: number;
    readonly avgDramaEventsPerHour: number; // Assuming 1 hour = ~1000 turns for math
    readonly clueToEventRatio: number;
    readonly avgSaveSize: number;
  };
}
