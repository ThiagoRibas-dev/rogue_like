import { test, expect } from 'bun:test';
import { loadCampaignFromDisk, buildGameState, makeRecordingDisplay } from './helpers.ts';
import { updateExploredTiles } from '../src/systems/map.system.ts';
import { buildViewportSnapshot } from '../src/rendering/viewport_snapshot.ts';
import { render } from '../src/rendering/renderer.ts';
import { drawCell } from '../src/rendering/display.ts';
import type { ViewportSnapshot } from '../src/rendering/viewport_snapshot.types.ts';

function buildSnap(): { snap: ViewportSnapshot; width: number; height: number } {
  const campaign = loadCampaignFromDisk('default');
  const state = updateExploredTiles(buildGameState(campaign));
  const width = campaign.theme.ui.displayWidth;
  const height = campaign.theme.ui.displayHeight;
  const snap = buildViewportSnapshot(state, width, height);
  return { snap, width, height };
}

test('render emits draw calls for explored cells', () => {
  const { snap, width, height } = buildSnap();
  const { display, draws } = makeRecordingDisplay(width, height);

  const drawCalls = render(display as never, snap, undefined);
  expect(drawCalls).toBeGreaterThan(0);
  expect(draws.length).toBe(drawCalls);
});

test('sprite-mode render never passes a glyph character as a sprite key', () => {
  const { snap, width, height } = buildSnap();
  const { display, draws } = makeRecordingDisplay(width, height);

  render(display as never, snap, undefined);

  const glyphChars = new Set(['X', '.', '#', '<', '>', '~', '8', '@', '%', '?', '!', ' ', 'o', 'g', 'T', 's']);
  for (const draw of draws) {
    const chars = Array.isArray(draw.chars) ? (draw.chars as unknown[]) : [draw.chars];
    for (const ch of chars) {
      expect(glyphChars.has(String(ch))).toBe(false);
    }
  }
});

test('sprite-mode highlight does not fabricate a sprite key for the glyph', () => {
  const { snap, width, height } = buildSnap();
  const { display, draws } = makeRecordingDisplay(width, height);

  const idx = snap.cells.findIndex((c) => c.isExplored);
  const highlighted = {
    ...snap,
    cells: snap.cells.map((c, i) =>
      i === idx ? { ...c, highlight: { glyph: 'X', fg: '#000000', bg: '#ffff00' } } : c
    )
  };

  render(display as never, highlighted, snap);

  const chars = draws.flatMap((d) => (Array.isArray(d.chars) ? (d.chars as unknown[]) : [d.chars]));
  expect(chars.map(String)).not.toContain('X');
});

test('ASCII drawCell never clears with a transparent background', () => {
  const calls: Array<{ bg: unknown }> = [];
  const display = {
    draw: (_x: number, _y: number, _ch: unknown, _fg: unknown, bg: unknown) => {
      calls.push({ bg });
    }
  };

  drawCell(
    display as never,
    1,
    1,
    false,
    { glyph: '.', fg: '#ffffff', bg: '#000000' },
    [{ glyph: '@', fg: '#ffffff', bg: 'transparent' }]
  );

  expect(calls.length).toBe(1);
  expect(calls[0]?.bg).not.toBe('transparent');
  expect(calls[0]?.bg).toBe('#000000');
});

test('ASCII drawCell falls back to an opaque colour when both bgs are transparent', () => {
  const calls: Array<{ bg: unknown }> = [];
  const display = {
    draw: (_x: number, _y: number, _ch: unknown, _fg: unknown, bg: unknown) => {
      calls.push({ bg });
    }
  };

  drawCell(
    display as never,
    1,
    1,
    false,
    { glyph: '.', fg: '#ffffff', bg: 'transparent' },
    [{ glyph: '@', fg: '#ffffff', bg: 'transparent' }]
  );

  expect(calls[0]?.bg).toBe('#000000');
});
