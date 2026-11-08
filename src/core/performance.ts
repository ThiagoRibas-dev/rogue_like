import { ComponentType } from '../types/components.types.ts';
import type { GameState } from '../types/game-state.types.ts';
import { getTelemetryStore } from './telemetry.ts';

/** Maximum number of recent turn execution samples retained in the rolling window. */
export const MAX_TURN_HISTORY_SAMPLES = 60;

/** Maximum number of recent rendered frame samples retained in the rolling window. */
export const MAX_RENDER_HISTORY_SAMPLES = 120;

/** Maximum number of recent AI turn samples retained in the rolling window. */
export const MAX_AI_HISTORY_SAMPLES = 60;

/** Threshold in milliseconds above which a turn resolution is flagged as slow. */
export const SLOW_TURN_THRESHOLD_MS = 8;

/** Threshold in milliseconds above which a rendered frame is flagged as slow (exceeds 60Hz 16.6ms budget). */
export const SLOW_RENDER_THRESHOLD_MS = 16;

/** Per-subsystem timing breakdown for a single resolved turn/intent (`applyIntentWithCost`). */
export interface TurnSubsystemsSample {
  readonly intentType: string;
  readonly actorEntityId: number;
  readonly isPlayer: boolean;
  readonly dispatchActionMs: number;
  readonly stabilizationMs: number;
  readonly fieldsAndInvestigationMs: number;
  readonly cadenceAndLedgerMs: number;
  readonly fovAndExploreMs: number;
  readonly autoPauseMs: number;
  readonly totalTurnMs: number;
}

/** Per-domain timing breakdown for a single presenter render frame (`renderPresenterFrame`). */
export interface RenderSubsystemsSample {
  readonly dirtyDomains: ReadonlyArray<string>;
  readonly snapshotBuildMs: number;
  readonly canvasDrawMs: number;
  readonly overlaysMs: number;
  readonly hudDomainMs: number;
  readonly logDomainMs: number;
  readonly inventoryDomainMs: number;
  readonly modalsDomainMs: number;
  readonly debugDomainMs: number;
  readonly totalRenderMs: number;
  readonly drawCalls: number;
  readonly fullRedraw: boolean;
}

/** Timing sample for a single AI actor decision (`processAITurn`). */
export interface AISample {
  readonly entityId: number;
  readonly durationMs: number;
  readonly intentType: string;
}

/** Rolling summary statistics for recent turn resolutions. */
export interface TurnRollingStats {
  readonly sampleCount: number;
  readonly avgTotalMs: number;
  readonly maxTotalMs: number;
  readonly avgDispatchMs: number;
  readonly avgStabilizationMs: number;
  readonly avgFieldsMs: number;
  readonly avgCadenceMs: number;
  readonly avgFovMs: number;
}

/** Rolling summary statistics for recent rendered frames. */
export interface RenderRollingStats {
  readonly sampleCount: number;
  readonly avgTotalMs: number;
  readonly maxTotalMs: number;
  readonly avgSnapshotMs: number;
  readonly avgCanvasDrawMs: number;
  readonly avgOverlaysMs: number;
  readonly avgHudMs: number;
  readonly avgLogMs: number;
  readonly avgInventoryMs: number;
  readonly avgModalsMs: number;
}

const EMPTY_TURN_SAMPLE: TurnSubsystemsSample = {
  intentType: 'none',
  actorEntityId: 0,
  isPlayer: false,
  dispatchActionMs: 0,
  stabilizationMs: 0,
  fieldsAndInvestigationMs: 0,
  cadenceAndLedgerMs: 0,
  fovAndExploreMs: 0,
  autoPauseMs: 0,
  totalTurnMs: 0
};

const EMPTY_RENDER_SAMPLE: RenderSubsystemsSample = {
  dirtyDomains: [],
  snapshotBuildMs: 0,
  canvasDrawMs: 0,
  overlaysMs: 0,
  hudDomainMs: 0,
  logDomainMs: 0,
  inventoryDomainMs: 0,
  modalsDomainMs: 0,
  debugDomainMs: 0,
  totalRenderMs: 0,
  drawCalls: 0,
  fullRedraw: false
};

/**
 * Global performance tracker store for developer and diagnostic telemetry.
 * Tracks execution times, subsystem breakdowns, rolling histories, and frequency counters.
 */
export const perfTracker = {
  lastTurnTimeMs: 0,
  lastRenderTimeMs: 0,
  lastAITimeMs: 0,
  maxTurnTimeMs: 0,
  maxRenderTimeMs: 0,
  maxAITimeMs: 0,
  turnCount: 0,
  slowTurnCount: 0,
  renderFrameCount: 0,
  slowRenderFrameCount: 0,
  aiCallCount: 0,
  schedulerSliceYields: 0,
  hoverTileChanges: 0,
  domainDirtyMarkCounts: {} as Record<string, number>,
  lastTurnBreakdown: EMPTY_TURN_SAMPLE,
  lastRenderBreakdown: EMPTY_RENDER_SAMPLE,
  turnHistory: [] as TurnSubsystemsSample[],
  renderHistory: [] as RenderSubsystemsSample[],
  aiHistory: [] as AISample[]
};

/**
 * Records a completed turn resolution sample and updates peak/rolling telemetry.
 * @param sample The subsystem breakdown for the completed turn.
 */
export function recordTurnSample(sample: TurnSubsystemsSample): void {
  perfTracker.lastTurnTimeMs = sample.totalTurnMs;
  perfTracker.lastTurnBreakdown = sample;
  perfTracker.turnCount += 1;
  if (sample.totalTurnMs > perfTracker.maxTurnTimeMs) perfTracker.maxTurnTimeMs = sample.totalTurnMs;
  if (sample.totalTurnMs >= SLOW_TURN_THRESHOLD_MS) perfTracker.slowTurnCount += 1;
  perfTracker.turnHistory.push(sample);
  if (perfTracker.turnHistory.length > MAX_TURN_HISTORY_SAMPLES) perfTracker.turnHistory.shift();
}

/**
 * Records a completed presenter render frame sample and updates peak/rolling telemetry.
 * @param sample The domain timing breakdown for the rendered frame.
 */
export function recordRenderSample(sample: RenderSubsystemsSample): void {
  perfTracker.lastRenderTimeMs = sample.totalRenderMs;
  perfTracker.lastRenderBreakdown = sample;
  perfTracker.renderFrameCount += 1;
  if (sample.totalRenderMs > perfTracker.maxRenderTimeMs) perfTracker.maxRenderTimeMs = sample.totalRenderMs;
  if (sample.totalRenderMs >= SLOW_RENDER_THRESHOLD_MS) perfTracker.slowRenderFrameCount += 1;
  perfTracker.renderHistory.push(sample);
  if (perfTracker.renderHistory.length > MAX_RENDER_HISTORY_SAMPLES) perfTracker.renderHistory.shift();
}

/**
 * Records a completed AI turn decision sample.
 * @param sample The AI entity timing sample.
 */
export function recordAISample(sample: AISample): void {
  perfTracker.lastAITimeMs = sample.durationMs;
  perfTracker.aiCallCount += 1;
  if (sample.durationMs > perfTracker.maxAITimeMs) perfTracker.maxAITimeMs = sample.durationMs;
  perfTracker.aiHistory.push(sample);
  if (perfTracker.aiHistory.length > MAX_AI_HISTORY_SAMPLES) perfTracker.aiHistory.shift();
}

/**
 * Increments the counter for how many times a given presentation domain was marked dirty.
 * @param domain The presentation domain name.
 */
export function recordDomainMarkedDirty(domain: string): void {
  perfTracker.domainDirtyMarkCounts[domain] = (perfTracker.domainDirtyMarkCounts[domain] ?? 0) + 1;
}

/** Increments the counter for pointer hover tile coordinate changes. */
export function recordHoverTileChange(): void {
  perfTracker.hoverTileChanges += 1;
}

/** Increments the counter for cooperative scheduler frame-budget slice yields. */
export function recordSchedulerSliceYield(): void {
  perfTracker.schedulerSliceYields += 1;
}

/**
 * Computes rolling averages and peaks across the retained turn history window.
 * @returns Aggregated turn rolling statistics.
 */
export function computeTurnRollingStats(): TurnRollingStats {
  const history = perfTracker.turnHistory;
  const count = history.length;
  if (count === 0) {
    return {
      sampleCount: 0,
      avgTotalMs: 0,
      maxTotalMs: 0,
      avgDispatchMs: 0,
      avgStabilizationMs: 0,
      avgFieldsMs: 0,
      avgCadenceMs: 0,
      avgFovMs: 0
    };
  }
  let sumTotal = 0;
  let maxTotal = 0;
  let sumDispatch = 0;
  let sumStabilization = 0;
  let sumFields = 0;
  let sumCadence = 0;
  let sumFov = 0;
  for (const s of history) {
    sumTotal += s.totalTurnMs;
    if (s.totalTurnMs > maxTotal) maxTotal = s.totalTurnMs;
    sumDispatch += s.dispatchActionMs;
    sumStabilization += s.stabilizationMs;
    sumFields += s.fieldsAndInvestigationMs;
    sumCadence += s.cadenceAndLedgerMs;
    sumFov += s.fovAndExploreMs;
  }
  return {
    sampleCount: count,
    avgTotalMs: sumTotal / count,
    maxTotalMs: maxTotal,
    avgDispatchMs: sumDispatch / count,
    avgStabilizationMs: sumStabilization / count,
    avgFieldsMs: sumFields / count,
    avgCadenceMs: sumCadence / count,
    avgFovMs: sumFov / count
  };
}

/**
 * Computes rolling averages and peaks across the retained render frame history window.
 * @returns Aggregated render rolling statistics.
 */
export function computeRenderRollingStats(): RenderRollingStats {
  const history = perfTracker.renderHistory;
  const count = history.length;
  if (count === 0) {
    return {
      sampleCount: 0,
      avgTotalMs: 0,
      maxTotalMs: 0,
      avgSnapshotMs: 0,
      avgCanvasDrawMs: 0,
      avgOverlaysMs: 0,
      avgHudMs: 0,
      avgLogMs: 0,
      avgInventoryMs: 0,
      avgModalsMs: 0
    };
  }
  let sumTotal = 0;
  let maxTotal = 0;
  let sumSnapshot = 0;
  let sumDraw = 0;
  let sumOverlays = 0;
  let sumHud = 0;
  let sumLog = 0;
  let sumInventory = 0;
  let sumModals = 0;
  for (const s of history) {
    sumTotal += s.totalRenderMs;
    if (s.totalRenderMs > maxTotal) maxTotal = s.totalRenderMs;
    sumSnapshot += s.snapshotBuildMs;
    sumDraw += s.canvasDrawMs;
    sumOverlays += s.overlaysMs;
    sumHud += s.hudDomainMs;
    sumLog += s.logDomainMs;
    sumInventory += s.inventoryDomainMs;
    sumModals += s.modalsDomainMs;
  }
  return {
    sampleCount: count,
    avgTotalMs: sumTotal / count,
    maxTotalMs: maxTotal,
    avgSnapshotMs: sumSnapshot / count,
    avgCanvasDrawMs: sumDraw / count,
    avgOverlaysMs: sumOverlays / count,
    avgHudMs: sumHud / count,
    avgLogMs: sumLog / count,
    avgInventoryMs: sumInventory / count,
    avgModalsMs: sumModals / count
  };
}

/**
 * Builds a complete, JSON-serializable diagnostic telemetry snapshot combining performance metrics,
 * rolling subsystem breakdowns, render debug metrics, and entity/world state counts.
 * @param state The active GameState snapshot.
 * @param renderDebug The current RenderDebugMetrics snapshot.
 * @returns Structured telemetry payload ready for file export.
 */
export function buildTelemetryExportPayload(state: GameState, renderDebug: unknown): Record<string, unknown> {
  let activeActors = 0;
  let activeItems = 0;
  let activeFields = 0;
  for (const id of state.entities) {
    const compMap = state.components.get(id);
    if (!compMap) continue;
    if (compMap[ComponentType.Actor] !== undefined) activeActors += 1;
    if (compMap[ComponentType.Item] !== undefined) activeItems += 1;
    if (compMap[ComponentType.Field] !== undefined) activeFields += 1;
  }
  return {
    exportedAtIso: new Date().toISOString(),
    sessionSummary: {
      campaignId: state.campaignId,
      rulesetId: state.campaign.manifest.rulesetId,
      currentAreaId: state.currentAreaId,
      globalTurn: state.globalTurn,
      engineMode: state.engineMode,
      uiMode: state.uiMode,
      isRotated: state.isRotated,
      is3D: state.is3D,
      zoomLevel: state.zoomLevel
    },
    worldCounts: {
      liveEntities: state.entities.length,
      activeActors,
      activeItems,
      activeFields,
      spatialBuckets: state.spatialIndex.size,
      cachedAreasCount: state.areas.size,
      persistentEntitiesCount: state.persistentEntities.size,
      historicalLedgerEntries: state.historicalLedger.length,
      messagesCount: state.messages.length,
      activeVisualEffects: state.visualEffects.length
    },
    gameplayTelemetry: getTelemetryStore(),
    performanceSummary: {
      lastTurnTimeMs: perfTracker.lastTurnTimeMs,
      maxTurnTimeMs: perfTracker.maxTurnTimeMs,
      turnCount: perfTracker.turnCount,
      slowTurnCount: perfTracker.slowTurnCount,
      lastRenderTimeMs: perfTracker.lastRenderTimeMs,
      maxRenderTimeMs: perfTracker.maxRenderTimeMs,
      renderFrameCount: perfTracker.renderFrameCount,
      slowRenderFrameCount: perfTracker.slowRenderFrameCount,
      lastAITimeMs: perfTracker.lastAITimeMs,
      maxAITimeMs: perfTracker.maxAITimeMs,
      aiCallCount: perfTracker.aiCallCount,
      schedulerSliceYields: perfTracker.schedulerSliceYields,
      hoverTileChanges: perfTracker.hoverTileChanges,
      domainDirtyMarkCounts: perfTracker.domainDirtyMarkCounts
    },
    turnRollingStats: computeTurnRollingStats(),
    renderRollingStats: computeRenderRollingStats(),
    lastTurnBreakdown: perfTracker.lastTurnBreakdown,
    lastRenderBreakdown: perfTracker.lastRenderBreakdown,
    renderDebugMetrics: renderDebug,
    recentTurnSamples: perfTracker.turnHistory,
    recentRenderSamples: perfTracker.renderHistory,
    recentAISamples: perfTracker.aiHistory
  };
}
