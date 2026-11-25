import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import renderToString from 'preact-render-to-string';
import { clearModals } from '../src/core/modal_manager.ts';
import { clearInputQueue } from '../src/core/input_queue.ts';
import { commandRegistry } from '../src/core/input/command_registry.ts';
import { InputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { resetSettings } from '../src/core/settings.ts';
import { getGameState, setGameState } from '../src/core/game-loop.ts';
import { PresentationDomain } from '../src/core/presentation_queue.ts';
import { uiStore } from '../src/rendering/ui/core/ui_store.ts';
import { LedgerModal } from '../src/rendering/ui/modals/LedgerModal.tsx';
import { LegendsModal } from '../src/rendering/ui/modals/LegendsModal.tsx';
import { NemesisDossierModal } from '../src/rendering/ui/modals/NemesisDossierModal.tsx';
import { buildLegendsInputFromCampaign, generateLegendsWorldSync, seedGameStateFromLegends } from '../src/systems/macro/legends_simulator.ts';
import { GameEventType } from '../src/types/events.types.ts';
import { UIMode } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function makeShiftHKeyEvent(): KeyboardEvent & { readonly defaultPrevented: boolean } {
  let prevented = false;
  return {
    key: 'H',
    code: 'KeyH',
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    preventDefault: (): void => {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    }
  } as unknown as KeyboardEvent & { readonly defaultPrevented: boolean };
}

describe('Phase 48 M186: LegendsModal UI & Keybind Wiring', () => {
  beforeEach(() => {
    resetSettings();
    clearModals();
    clearInputQueue();
    uiStore.reset();
  });

  afterEach(() => {
    clearModals();
    clearInputQueue();
    uiStore.reset();
  });

  test('LegendsModal renders clean fallback when macroWorld is absent', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = { ...buildGameState(campaign, 4808), uiMode: UIMode.Legends };
    uiStore.syncFromPresenter(state, false, new Set([PresentationDomain.Modals]));

    const html = renderToString(<LegendsModal />);
    expect(html).toContain('Local World History Only');
    expect(html).toContain('Shift+L');
  });

  test('LegendsModal renders Continental Map, Eras, Figures, Sites, Artifacts, and Chronicle tabs interactively', () => {
    const campaign = loadCampaignFromDisk('default');
    const input = buildLegendsInputFromCampaign(campaign, 4809);
    const macro = generateLegendsWorldSync({ ...input, historyYears: 100, siteCount: 8 });
    const seeded = { ...seedGameStateFromLegends(buildGameState(campaign, 4809), macro), uiMode: UIMode.Legends };

    uiStore.syncFromPresenter(seeded, false, new Set([PresentationDomain.Modals]));

    // Initial SSR snapshot shows World Map & Eras
    const ssrHtml = renderToString(<LegendsModal />);
    expect(ssrHtml).toContain('World Legends');
    expect(ssrHtml).toContain('Continental Geography');
    expect(ssrHtml).toContain('Historical Eras');

    // Interactive DOM mount switches across all 5 tabs cleanly
    const dom = new Window();
    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevWin = (globalThis as { window?: unknown }).window;
    (globalThis as { document: unknown }).document = dom.document;
    (globalThis as { window: unknown }).window = dom;

    try {
      const root = dom.document.createElement('div');
      dom.document.body.appendChild(root);
      render(<LegendsModal />, root as unknown as Element);

      const tabs = Array.from(root.querySelectorAll('[role="tab"]')) as HTMLButtonElement[];
      expect(tabs.length).toBe(5);

      // Tab 1: Historical Figures
      tabs[1]!.click();
      render(<LegendsModal />, root as unknown as Element);
      expect(root.textContent).toContain('Dynasty:');

      // Tab 2: Sites & Civilizations
      tabs[2]!.click();
      render(<LegendsModal />, root as unknown as Element);
      expect(root.textContent).toContain('Prosperity:');

      // Accessible map buttons and Site History pendingSiteDeltas check
      const siteId = Object.keys(macro.sites)[0]!;
      uiStore.syncFromPresenter(
        {
          ...seeded,
          macroWorld: {
            ...seeded.macroWorld!,
            pendingSiteDeltas: [
              {
                id: 'delta_ui_test',
                tick: 4,
                siteId,
                kind: 'site_rebuilt',
                summary: `${macro.sites[siteId]!.name} walls reinforced.`
              }
            ]
          }
        },
        false,
        new Set([PresentationDomain.Modals])
      );
      render(<LegendsModal />, root as unknown as Element);
      expect(root.textContent).toContain('walls reinforced.');

      tabs[0]!.click();
      render(<LegendsModal />, root as unknown as Element);
      expect(root.querySelectorAll('[role="button"]').length).toBeGreaterThanOrEqual(1);

      // Tab 3: Artifacts & Relics
      tabs[3]!.click();
      render(<LegendsModal />, root as unknown as Element);
      expect(root.textContent).toContain('Forged Year');

      // Tab 4: World Chronicle
      tabs[4]!.click();
      render(<LegendsModal />, root as unknown as Element);
      expect(root.textContent).toContain('All Eras');

      render(null, root as unknown as Element);
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
      (globalThis as { window?: unknown }).window = prevWin;
    }
  });

  test('Shift+H opens and closes UIMode.Legends cleanly without colliding with Vi movement or other shortcuts', () => {
    const campaign = loadCampaignFromDisk('default');
    const gameState = buildGameState(campaign, 4810);
    setGameState(gameState);

    expect(commandRegistry.getCommand('panel.legends')).toBeDefined();
    const manager = new InputScopeManager();
    const ev = makeShiftHKeyEvent();
    expect(manager.dispatchKeyEvent(ev, gameState)).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Legends);

    // Pressing Shift+H inside Legends modal closes it back to Game
    const closeEv = makeShiftHKeyEvent();
    expect(manager.dispatchKeyEvent(closeEv, getGameState())).toBe(true);
    expect(getGameState().uiMode).toBe(UIMode.Game);
  });

  test('LedgerModal formats Legends and Macro Tick event IDs without displaying Turn evt or Turn macro', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = {
      ...buildGameState(campaign, 4811),
      uiMode: UIMode.Ledger,
      historicalLedger: [
        {
          id: 'legend_evt_7',
          type: GameEventType.WorldEventFired,
          importance: 'high' as const,
          summary: '[Year 12] Founding of Stonehold.'
        },
        {
          id: 'evt_macro_5_army_1',
          type: GameEventType.MacroWorldTickSynced,
          importance: 'high' as const,
          summary: 'Bandits raided Stonehold.',
          fromTick: 4,
          toTick: 5,
          deltaCount: 1
        }
      ]
    };
    uiStore.syncFromPresenter(state, false, new Set([PresentationDomain.Modals]));
    const html = renderToString(<LedgerModal />);
    expect(html).toContain('Legends');
    expect(html).toContain('Macro Tick 5');
    expect(html).not.toContain('Turn evt');
    expect(html).not.toContain('Turn macro');

    const legendMacro = generateLegendsWorldSync({
      ...buildLegendsInputFromCampaign(campaign, 4812),
      historyYears: 20,
      siteCount: 4
    });
    const dossierState = {
      ...seedGameStateFromLegends(buildGameState(campaign, 4812), legendMacro),
      uiMode: UIMode.Dossier
    };
    uiStore.syncFromPresenter(dossierState, false, new Set([PresentationDomain.Modals]));
    const dossierHtml = renderToString(<NemesisDossierModal />);
    expect(dossierHtml).toContain('Alive');
    expect(dossierHtml).not.toContain('>Dead<');
    expect(dossierHtml).not.toContain('Turn evt');
  });
});
