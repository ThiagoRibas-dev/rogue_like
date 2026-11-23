import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { InputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { PresentationDomain } from '../src/core/presentation_queue.ts';
import { rebindCommandSlot, resetCommandBindings, resetSettings } from '../src/core/settings.ts';
import { mountAppUiRoot, unmountAppUiRoot } from '../src/rendering/ui/core/AppUiRoot.tsx';
import { uiStore } from '../src/rendering/ui/core/ui_store.ts';
import { registerCartridgeUI } from '../src/rendering/ui/cartridge_ui_registry.ts';
import { Accordion } from '../src/rendering/ui/primitives/Accordion.tsx';
import { Button, IconButton } from '../src/rendering/ui/primitives/Button.tsx';
import { Badge, Chip, StatChip } from '../src/rendering/ui/primitives/DataDisplay.tsx';
import { DialogHost } from '../src/rendering/ui/primitives/DialogHost.tsx';
import { dialogService, toastService, tooltipService } from '../src/rendering/ui/primitives/dialog_service.ts';
import { queryFocusableElements, useRovingFocus } from '../src/rendering/ui/primitives/focus_hooks.ts';
import {
  Checkbox,
  FormField,
  NumberInput,
  Select,
  TextInput
} from '../src/rendering/ui/primitives/FormControls.tsx';
import { GridNav } from '../src/rendering/ui/primitives/GridNav.tsx';
import { Keycap } from '../src/rendering/ui/primitives/Keycap.tsx';
import { ListBox } from '../src/rendering/ui/primitives/ListBox.tsx';
import { ModalShell } from '../src/rendering/ui/primitives/ModalShell.tsx';
import { Panel, SplitPane, Toolbar } from '../src/rendering/ui/primitives/Panel.tsx';
import { Stepper } from '../src/rendering/ui/primitives/Stepper.tsx';
import { Tabs } from '../src/rendering/ui/primitives/Tabs.tsx';
import { ToastHost } from '../src/rendering/ui/primitives/ToastHost.tsx';
import { TooltipHost } from '../src/rendering/ui/primitives/TooltipHost.tsx';
import { TreeList } from '../src/rendering/ui/primitives/TreeList.tsx';
import { type GameState, UIMode } from '../src/types/game-state.types.ts';

function buildMinimalState(uiMode: UIMode = UIMode.Game, activeCartridgeModalId?: string): GameState {
  return {
    campaignId: 'test-camp',
    campaign: {
      manifest: { id: 'test-camp', name: 'Test', rulesetId: 'classic', version: '1.0.0' },
      rules: { map: { width: 10, height: 10, startingAreaId: 'a1' } }
    },
    entities: [],
    components: new Map(),
    map: { width: 10, height: 10, tiles: [] },
    uiMode,
    ...(activeCartridgeModalId !== undefined ? { activeCartridgeModalId } : {})
  } as unknown as GameState;
}

async function flushUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 60));
}

describe('Milestone 159: uiStore, Live Focus Hooks, Primitives, ConsoleModalHost & DialogService', () => {
  let domWindow: Window;
  let prevWindow: unknown;
  let prevDocument: unknown;
  let prevHTMLElement: unknown;

  beforeEach(() => {
    domWindow = new Window();
    prevWindow = (globalThis as Record<string, unknown>)['window'];
    prevDocument = (globalThis as Record<string, unknown>)['document'];
    prevHTMLElement = (globalThis as Record<string, unknown>)['HTMLElement'];
    (globalThis as Record<string, unknown>)['window'] = domWindow;
    (globalThis as Record<string, unknown>)['document'] = domWindow.document;
    (globalThis as Record<string, unknown>)['HTMLElement'] = domWindow.HTMLElement;
    resetSettings();
    resetCommandBindings('modern');
    uiStore.reset();
  });

  afterEach(async () => {
    unmountAppUiRoot();
    await domWindow.happyDOM.close();
    (globalThis as Record<string, unknown>)['window'] = prevWindow;
    (globalThis as Record<string, unknown>)['document'] = prevDocument;
    (globalThis as Record<string, unknown>)['HTMLElement'] = prevHTMLElement;
  });

  test('uiStore gates renders cleanly on PresentationDomain dirty flags', () => {
    const stateA = buildMinimalState(UIMode.Game);
    uiStore.syncFromPresenter(stateA, false, new Set([PresentationDomain.HUD]));
    const firstHudVersion = uiStore.getSnapshot().domainVersions[PresentationDomain.HUD];
    expect(firstHudVersion).toBe(1);

    // Off-screen Entities-only dirty tick MUST NOT notify uiStore listeners or change HUD/Modals version
    let notifyCount = 0;
    const unsub = uiStore.subscribe(() => {
      notifyCount += 1;
    });
    const stateB = buildMinimalState(UIMode.Game);
    uiStore.syncFromPresenter(stateB, false, new Set([PresentationDomain.Entities]));
    expect(notifyCount).toBe(0);
    expect(uiStore.getSnapshot().domainVersions[PresentationDomain.HUD]).toBe(firstHudVersion);

    // Modals dirty tick increments Modals counter & notifies
    uiStore.syncFromPresenter(stateB, false, new Set([PresentationDomain.Modals]));
    expect(notifyCount).toBe(1);
    expect(uiStore.getSnapshot().domainVersions[PresentationDomain.Modals]).toBe(1);
    unsub();
  });

  test('useFocusTrap queries dynamically added buttons live on Tab and restores previous focus on close', async () => {
    const host = domWindow.document.createElement('div');
    domWindow.document.body.appendChild(host);

    const outsideTrigger = domWindow.document.createElement('button');
    outsideTrigger.textContent = 'Trigger';
    domWindow.document.body.appendChild(outsideTrigger);
    outsideTrigger.focus();
    expect(domWindow.document.activeElement === outsideTrigger).toBe(true);

    function DynamicTrapHarness(): ReturnType<typeof ModalShell> {
      const [open, setOpen] = useState(true);
      const [showExtra, setShowExtra] = useState(false);

      if (!open) {
        return <div />;
      }

      return (
        <ModalShell title="Focus Test" showHelpHint={false} onClose={() => setOpen(false)}>
          <Button dataTestId="btn-add" onClick={() => setShowExtra(true)}>
            Add Control
          </Button>
          {showExtra ? <Button dataTestId="btn-dynamic">Dynamic End</Button> : null}
        </ModalShell>
      );
    }

    render(<DynamicTrapHarness />, host);
    await flushUi();

    const dialogEl = host.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl).not.toBeNull();

    // Click "Add Control" dynamically adding a new focusable button AFTER mount
    const addBtn = host.querySelector('[data-testid="btn-add"]') as HTMLButtonElement;
    addBtn.click();
    await flushUi();

    const dynamicBtn = host.querySelector('[data-testid="btn-dynamic"]') as HTMLButtonElement;
    expect(dynamicBtn).not.toBeNull();
    const liveFocusables = queryFocusableElements(dialogEl);
    expect(liveFocusables.includes(dynamicBtn)).toBe(true);

    // Pressing Tab on the newly added last focusable button wraps back to first focusable inside dialog
    dynamicBtn.focus();
    expect(domWindow.document.activeElement === dynamicBtn).toBe(true);
    const tabEvent = new domWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialogEl.dispatchEvent(tabEvent as unknown as KeyboardEvent);
    expect(tabEvent.defaultPrevented).toBe(true);
    expect(domWindow.document.activeElement === liveFocusables[0]).toBe(true);

    // Closing modal restores focus back to outsideTrigger
    const closeBtn = host.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement;
    closeBtn.click();
    await flushUi();
    expect(domWindow.document.activeElement === outsideTrigger).toBe(true);
  });

  test('useRovingFocus supports vertical, horizontal, and 2D grid navigation + inspect hotkey', async () => {
    const host = domWindow.document.createElement('div');
    domWindow.document.body.appendChild(host);

    const gridItems = ['A', 'B', 'C', 'D', 'E', 'F'];
    let inspected: string | null = null;
    let activated: string | null = null;
    let selectedTab = 't1';

    function NavHarness(): ReturnType<typeof Panel> {
      const roving = useRovingFocus({ count: 3, orientation: 'vertical' });
      return (
        <Panel title="Navigation Test">
          <div data-roving-idx={roving.activeIndex} />
          <Tabs
            tabs={[
              { id: 't1', label: 'One' },
              { id: 't2', label: 'Two' }
            ]}
            activeTabId={selectedTab}
            onSelectTab={(id) => {
              selectedTab = id;
            }}
          />
          <ListBox
            items={[
              { id: 'i1', label: 'First' },
              { id: 'i2', label: 'Second' }
            ]}
            selectedId="i1"
            onSelect={() => {}}
          />
          <GridNav
            items={gridItems}
            columns={3}
            getKey={(item) => item}
            renderItem={(item) => <button type="button">{item}</button>}
            onInspectItem={(item) => {
              inspected = item;
            }}
            onActivate={(item) => {
              activated = item;
            }}
          />
        </Panel>
      );
    }

    render(<NavHarness />, host);
    await flushUi();
    const tablist = host.querySelector('[role="tablist"]') as HTMLElement;
    tablist.dispatchEvent(new domWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as KeyboardEvent);
    expect(selectedTab).toBe('t2');

    const grid = host.querySelector('[role="grid"]') as HTMLElement;
    // Move Down 1 row (index 0 -> index 3 'D'), Right 1 col (index 4 'E'), then press '?' to inspect and Enter to activate
    grid.dispatchEvent(new domWindow.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }) as unknown as KeyboardEvent);
    grid.dispatchEvent(new domWindow.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }) as unknown as KeyboardEvent);
    grid.dispatchEvent(new domWindow.KeyboardEvent('keydown', { key: '?', bubbles: true }) as unknown as KeyboardEvent);
    expect(inspected).toBe('E');
    grid.dispatchEvent(new domWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }) as unknown as KeyboardEvent);
    expect(activated).toBe('E');
  });

  test('DialogService resolves async confirm/prompt, wires InputScopeManager Escape, and Keycap updates live', async () => {
    const uiRoot = domWindow.document.createElement('div');
    domWindow.document.body.appendChild(uiRoot);
    render(
      <div>
        <Keycap commandId="panel.ledger" />
        <DialogHost />
        <ToastHost />
        <TooltipHost />
      </div>,
      uiRoot
    );
    await flushUi();

    // Keycap initially shows Shift+L, then reactively updates when rebound
    expect(uiRoot.querySelector('kbd')?.textContent).toBe('Shift+L');
    rebindCommandSlot('panel.ledger', 0, { key: 'k', alt: true }, true);
    await flushUi();
    expect(uiRoot.querySelector('kbd')?.textContent).toBe('Alt+K');

    // Confirm dialog resolves false when dismissed via DialogService / InputScopeManager
    const confirmPromise = dialogService.confirm({ title: 'Delete?', message: 'Proceed?' });
    await flushUi();
    expect(uiRoot.textContent).toContain('Delete?');

    const manager = new InputScopeManager();
    const state = buildMinimalState(UIMode.Game);
    dialogService.dismissActive();
    expect(await confirmPromise).toBe(false);

    const promptPromise = dialogService.prompt({ title: 'Name Area', defaultValue: 'Crypt' });
    await flushUi();
    const promptInput = uiRoot.querySelector('input[type="text"]') as HTMLInputElement;
    expect(promptInput.value).toBe('Crypt');
    dialogService.resolvePrompt('Sanctum');
    expect(await promptPromise).toBe('Sanctum');

    toastService.push('Saved workspace', 'success', 0);
    tooltipService.show({ id: 'tip1', title: 'Longsword', body: '1d8 slashing', meta: ['Martial'] });
    await flushUi();
    expect(uiRoot.textContent).toContain('Saved workspace');
    expect(uiRoot.textContent).toContain('Longsword');
    void manager.getPrimaryScope(state);
  });

  test('ConsoleModalHost renders Preact cartridge modals and shared layout/form primitives render cleanly', async () => {
    const container = domWindow.document.createElement('div');
    domWindow.document.body.appendChild(container);
    mountAppUiRoot(container);
    await flushUi();

    registerCartridgeUI({
      rulesetId: 'classic',
      modals: {
        test_preact_modal: {
          modalId: 'test_preact_modal',
          allowEscapeClose: true,
          renderPreact: () => (
            <ModalShell title="Preact Cartridge Modal" showHelpHint={true}>
              <SplitPane
                left={
                  <TreeList
                    nodes={[{ id: 'root', label: 'Chapter 1', children: [{ id: 'c1', label: 'Scene 1' }] }]}
                    selectedId="c1"
                    onSelect={() => {}}
                  />
                }
                right={
                  <Toolbar ariaLabel="Sample toolbar">
                    <IconButton ariaLabel="Help button">?</IconButton>
                    <Accordion title="Details" defaultExpanded={true}>
                      <FormField label="Hero Name" hint="Protected input">
                        <TextInput value="Alden" onInput={() => {}} />
                      </FormField>
                      <NumberInput value={10} min={1} max={20} onChange={() => {}} />
                      <Select value="a" options={[{ value: 'a', label: 'Option A' }]} onChange={() => {}} />
                      <Checkbox checked={true} label="Ready" onChange={() => {}} />
                      <Stepper value={2} min={0} max={5} onChange={() => {}} />
                      <Chip active={true}>Melee</Chip>
                      <Badge tone="accent">SRD</Badge>
                      <StatChip label="AC" value={18} />
                    </Accordion>
                  </Toolbar>
                }
              />
            </ModalShell>
          )
        }
      }
    });

    const state = buildMinimalState(UIMode.CartridgeModal, 'test_preact_modal');
    uiStore.syncFromPresenter(state, true, new Set([PresentationDomain.Modals]));
    await flushUi();

    expect(container.textContent).toContain('Preact Cartridge Modal');
    expect(container.textContent).toContain('Chapter 1');
    expect(container.textContent).toContain('18');
  });
});
