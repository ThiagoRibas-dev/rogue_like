import { MAX_REPLAY_HISTORY, REPLAY_STORAGE_KEY } from '../constants/replay.constants.ts';
import type { Intent } from '../types/intents/intent.union.ts';
import { getGameState, setGameState } from './game-loop.ts';
import { initRNG } from './rng.ts';
import { unlockEngine } from './scheduler.ts';

export interface ReplayData {
  readonly campaignId: string;
  readonly seed: number;
  readonly intents: ReadonlyArray<Intent>;
  readonly date: string;
}

let activeReplay: { campaignId: string; seed: number; intents: Intent[] } | null = null;
let isPlayingReplay = false;

/**
 * Checks if the engine is currently playing back a replay.
 */
export function getIsPlayingReplay(): boolean {
  return isPlayingReplay;
}

/**
 * Starts recording a new replay session.
 */
export function startRecording(campaignId: string, seed: number): void {
  activeReplay = {
    campaignId,
    seed,
    intents: []
  };
  console.log(`[Replay] Started recording campaign: ${campaignId} with seed: ${seed}`);
}

/**
 * Appends a player intent to the active replay log.
 */
export function recordIntent(intent: Intent): void {
  if (!activeReplay || isPlayingReplay) return;
  activeReplay.intents.push(intent);
}

/**
 * Gets the current active replay data.
 */
export function getActiveReplay(): ReplayData | null {
  if (!activeReplay) return null;
  return {
    ...activeReplay,
    date: new Date().toISOString()
  };
}

/**
 * Saves the current active replay session to the rolling localStorage history.
 */
export function saveCurrentReplay(): void {
  if (!activeReplay || activeReplay.intents.length === 0) return;

  const newReplay: ReplayData = {
    ...activeReplay,
    date: new Date().toISOString()
  };

  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    const list: ReplayData[] = raw ? JSON.parse(raw) : [];

    // Add to the front of the list, limit to MAX_REPLAY_HISTORY
    list.unshift(newReplay);
    if (list.length > MAX_REPLAY_HISTORY) {
      list.pop();
    }

    localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(list));
    console.log(`[Replay] Successfully saved current replay. Total recorded intents: ${newReplay.intents.length}`);
  } catch (e) {
    console.error('[Replay] Failed to save replay to localStorage:', e);
  }
}

/**
 * Retrieves the rolling list of saved replays.
 */
export function getSavedReplays(): ReadonlyArray<ReplayData> {
  try {
    const raw = localStorage.getItem(REPLAY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('[Replay] Failed to read saved replays:', e);
    return [];
  }
}

/**
 * Replays a recorded gameplay session deterministically using a start callback.
 */
export async function playReplay(
  replay: ReplayData,
  startNewGameCallback: (campaignId: string, seed: number) => Promise<void>
): Promise<void> {
  console.log(`[Replay] Starting playback for campaign: ${replay.campaignId} with ${replay.intents.length} intents...`);
  isPlayingReplay = true;

  try {
    // 1. Set seed
    initRNG(replay.seed);

    // 2. Launch startNewGame using the injected seed
    await startNewGameCallback(replay.campaignId, replay.seed);

    // 3. Queue all recorded intents and unlock the engine
    const state = getGameState();
    setGameState({
      ...state,
      playerCommandQueue: replay.intents
    });

    console.log(`[Replay] Injected ${replay.intents.length} intents into playerCommandQueue. Unlocking engine...`);
    unlockEngine();
  } catch (e) {
    console.error('[Replay] Playback failed:', e);
  } finally {
    isPlayingReplay = false;
  }
}
