/**
 * Global performance tracker store for developer telemetry.
 * Tracks execution times for turn processing, AI decision making, and UI rendering.
 */
export const perfTracker = {
  lastTurnTimeMs: 0,
  lastRenderTimeMs: 0,
  lastAITimeMs: 0
};
