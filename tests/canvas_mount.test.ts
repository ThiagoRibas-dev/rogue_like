import { test, expect } from 'bun:test';
import { mountDisplayWithFogOverlay } from '../src/rendering/display.ts';
import { loadCampaignFromDisk } from './helpers.ts';

interface FakeCanvas {
  id: string;
  parentElement: FakeContainer | null;
  remove(): void;
}

interface FakeContainer {
  id: string;
  style: Record<string, string>;
  children: FakeCanvas[];
  appendChild(el: FakeCanvas): void;
  insertBefore(el: FakeCanvas, ref: FakeCanvas): void;
  querySelectorAll(): FakeCanvas[];
}

function makeCanvas(id: string): FakeCanvas {
  return {
    id,
    parentElement: null,
    remove(): void {
      const parent = this.parentElement;
      if (!parent) return;
      const index = parent.children.indexOf(this);
      if (index >= 0) parent.children.splice(index, 1);
      this.parentElement = null;
    }
  };
}

function makeContainer(): FakeContainer {
  const container: FakeContainer = {
    id: 'game-canvas-wrapper',
    style: {},
    children: [],
    appendChild(el: FakeCanvas): void {
      el.parentElement = container;
      container.children.push(el);
    },
    insertBefore(el: FakeCanvas, ref: FakeCanvas): void {
      el.parentElement = container;
      const index = container.children.indexOf(ref);
      if (index >= 0) container.children.splice(index, 0, el);
      else container.children.push(el);
    },
    querySelectorAll(): FakeCanvas[] {
      return container.children.slice();
    }
  };
  return container;
}

test('re-mount removes the stale canvas when ROT reallocates it', () => {
  const campaign = loadCampaignFromDisk('megacampaign'); // ASCII → no fog overlay
  const container = makeContainer();
  const canvasA = makeCanvas('canvas-A');
  const canvasB = makeCanvas('canvas-B');
  let current = canvasA;

  const previousDocument = (globalThis as Record<string, unknown>)['document'];
  (globalThis as Record<string, unknown>)['document'] = {
    getElementById: (id: string) => (id === 'game-canvas-wrapper' ? container : null),
    querySelector: () => null,
    createElement: () => makeCanvas('fog-overlay')
  };

  try {
    const display = { getContainer: () => current };

    mountDisplayWithFogOverlay(display as never, campaign);
    expect(container.children.map((c) => c.id)).toEqual(['canvas-A']);

    // Simulate ROT allocating a fresh canvas on a layout change.
    current = canvasB;
    mountDisplayWithFogOverlay(display as never, campaign);

    expect(container.children.map((c) => c.id)).toEqual(['canvas-B']);
    expect(container.children.length).toBe(1);
  } finally {
    (globalThis as Record<string, unknown>)['document'] = previousDocument;
  }
});
