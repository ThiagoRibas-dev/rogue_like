import { describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { renderToString } from 'preact-render-to-string';
import { AppUiRoot, mountAppUiRoot, unmountAppUiRoot } from '../src/rendering/ui/core/AppUiRoot.tsx';
import { setConsoleThemeMode } from '../src/rendering/ui/core/console_theme.ts';

describe('Preact UI Runtime Mount & Theme DOM Sync', () => {
  it('renders AppUiRoot cleanly via preact-render-to-string', () => {
    const html = renderToString(<AppUiRoot />);
    expect(html).toContain('ui-shell-anchor');
    expect(html).toContain('data-ui-shell="ready"');
  });

  it('mounts AppUiRoot into sibling #ui-root without touching #game-canvas-wrapper and syncs theme attributes', () => {
    const domWindow = new Window();
    const prevDocument = (globalThis as Record<string, unknown>)['document'];
    (globalThis as Record<string, unknown>)['document'] = domWindow.document;

    try {
      domWindow.document.body.innerHTML =
        '<div id="app"><div id="game-canvas-wrapper"><canvas id="rot-canvas"></canvas></div><div id="ui-root"></div></div>';

      const canvasWrapper = domWindow.document.getElementById('game-canvas-wrapper') as unknown as HTMLElement;
      const uiRoot = domWindow.document.getElementById('ui-root') as unknown as HTMLElement;

      mountAppUiRoot(uiRoot);
      expect(uiRoot.querySelector('[data-ui-shell="ready"]')).not.toBeNull();
      expect(canvasWrapper.children.length).toBe(1);
      expect(canvasWrapper.children[0]?.id).toBe('rot-canvas');

      setConsoleThemeMode('obsidian-brass');
      expect(domWindow.document.documentElement.getAttribute('data-ui-theme')).toBe('obsidian-brass');
      expect(domWindow.document.documentElement.getAttribute('data-console-theme')).toBe('obsidian-brass');

      setConsoleThemeMode('parchment');
      expect(domWindow.document.documentElement.getAttribute('data-ui-theme')).toBe('parchment');

      unmountAppUiRoot();
      expect(uiRoot.children.length).toBe(0);
    } finally {
      (globalThis as Record<string, unknown>)['document'] = prevDocument;
      void domWindow.close();
    }
  });
});
