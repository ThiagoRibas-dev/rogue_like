import { test, expect } from 'bun:test';
import { applyViewportResize } from '../src/core/session_controller.ts';
import { consumeDirtyDomains, PresentationDomain } from '../src/core/presentation_queue.ts';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';

test('applyViewportResize re-syncs layout and forces a full redraw', () => {
  const campaign = loadCampaignFromDisk('megacampaign'); // ASCII → no fog overlay canvas
  const state = buildGameState(campaign);

  consumeDirtyDomains(); // start from a clean dirty set

  const setOptionsCalls: unknown[] = [];
  const display = {
    getOptions: () => ({ width: 50, height: 25 }),
    setOptions: (options: unknown) => {
      setOptionsCalls.push(options);
    },
    _backend: { _spacingX: 8, _spacingY: 16 }
  };

  const previousDocument = (globalThis as Record<string, unknown>)['document'];
  (globalThis as Record<string, unknown>)['document'] = { getElementById: () => null };

  try {
    applyViewportResize(display as never, state);
  } finally {
    (globalThis as Record<string, unknown>)['document'] = previousDocument;
  }

  expect(setOptionsCalls.length).toBeGreaterThan(0);
  const dirty = consumeDirtyDomains();
  expect(dirty.has(PresentationDomain.Map)).toBe(true);
});
