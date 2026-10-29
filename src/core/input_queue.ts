import type { Intent } from '../types/intents/intent.union.ts';

/**
 * Asynchronous FIFO queue for player inputs, decoupling UI and keypress
 * capture from simulation stepping and turn execution.
 */
class InputCommandQueue {
  private queue: Intent[] = [];

  /**
   * Enqueues an intent into the FIFO buffer.
   * @param intent The player intent to enqueue.
   */
  enqueue(intent: Intent): void {
    this.queue.push(intent);
  }

  /**
   * Dequeues the next intent to be processed by the player turn.
   * @returns The next Intent, or undefined if the queue is empty.
   */
  dequeue(): Intent | undefined {
    return this.queue.shift();
  }

  /**
   * Peeks at the next intent without removing it.
   * @returns The next Intent, or undefined if the queue is empty.
   */
  peek(): Intent | undefined {
    return this.queue[0];
  }

  /**
   * Checks whether the queue has pending intents.
   * @returns True if one or more intents are buffered.
   */
  hasPending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Returns the number of pending intents.
   * @returns Current queue size.
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clears all pending intents (e.g. on game over, area change, or RTwP unpaused override).
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * Replaces the current queue with a batch of intents (used by Replays).
   * @param intents Readonly array of intents to load into the queue.
   */
  loadIntents(intents: ReadonlyArray<Intent>): void {
    this.queue = [...intents];
  }
}

/**
 * Singleton instance of the InputCommandQueue.
 */
export const inputQueue = new InputCommandQueue();

/**
 * Enqueues a player intent into the input queue.
 * @param intent The intent to enqueue.
 */
export function enqueueIntent(intent: Intent): void {
  inputQueue.enqueue(intent);
}

/**
 * Dequeues the next player intent.
 * @returns The next intent, or undefined.
 */
export function dequeueIntent(): Intent | undefined {
  return inputQueue.dequeue();
}

/**
 * Peeks at the next intent without removing it from the queue.
 * @returns The next intent, or undefined.
 */
export function peekIntent(): Intent | undefined {
  return inputQueue.peek();
}

/**
 * Checks whether the input queue contains any pending intents.
 * @returns True if there are pending intents.
 */
export function hasPendingIntents(): boolean {
  return inputQueue.hasPending();
}

/**
 * Clears all pending intents from the input queue.
 */
export function clearInputQueue(): void {
  inputQueue.clear();
}

/**
 * Loads a sequence of intents into the input queue (e.g. during replay playback).
 * @param intents Readonly array of intents to load.
 */
export function loadInputQueue(intents: ReadonlyArray<Intent>): void {
  inputQueue.loadIntents(intents);
}

/**
 * Returns the number of pending intents currently queued.
 * @returns Number of pending intents.
 */
export function getInputQueueSize(): number {
  return inputQueue.size();
}
