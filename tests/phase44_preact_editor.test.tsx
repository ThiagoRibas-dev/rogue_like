import { afterEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { z } from 'zod';
import { inputScopeManager } from '../src/core/input/input_scope_manager.ts';
import { PresentationDomain } from '../src/core/presentation_queue.ts';
import { CampaignEditor } from '../src/editor/campaign_editor.ts';
import { buildReferenceIndex, queryUsages, resolveFieldReferenceKind } from '../src/editor/reference_index.ts';
import {
  CAMPAIGN_CATEGORY_META,
  VIEW_GROUPS,
  resolveCategoryPanelType
} from '../src/rendering/editor/editor_config.ts';
import { AppUiRoot } from '../src/rendering/ui/core/AppUiRoot.tsx';
import { uiStore } from '../src/rendering/ui/core/ui_store.ts';
import { dedupeValidationDiagnostics, editorStore } from '../src/rendering/ui/editor/editor_store.ts';
import { ZodObjectField } from '../src/rendering/ui/editor/forms/ZodFormContainers.tsx';
import { ZodFormRenderer } from '../src/rendering/ui/editor/forms/ZodFormRenderer.tsx';
import { ZodRecordEditor } from '../src/rendering/ui/editor/forms/ZodRecordEditor.tsx';
import { ZodUnionEditor } from '../src/rendering/ui/editor/forms/ZodUnionEditor.tsx';
import { SimulationLab } from '../src/rendering/ui/editor/labs/SimulationLab.tsx';
import { AreaEditor } from '../src/rendering/ui/editor/views/AreaEditor.tsx';
import { AreaStaticPainter } from '../src/rendering/ui/editor/views/AreaStaticPainter.tsx';
import { DialogueEditor } from '../src/rendering/ui/editor/views/DialogueEditor.tsx';
import { FactionMatrixEditor } from '../src/rendering/ui/editor/views/FactionMatrixEditor.tsx';
import { TriggerComposer } from '../src/rendering/ui/editor/views/TriggerComposer.tsx';
import { getReferenceOptions } from '../src/rendering/ui/ui_utils.ts';
import { getRuleset } from '../src/rulesets/registry.ts';
import { CampaignCategorySchemas, CampaignDataSchema } from '../src/types/campaign.types.ts';
import { UIMode } from '../src/types/game-state.types.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

interface DomGlobalsBackup {
  readonly window: unknown;
  readonly document: unknown;
  readonly navigator: unknown;
  readonly HTMLElement: unknown;
  readonly requestAnimationFrame: unknown;
  readonly sessionStorage: unknown;
}

function setupHappyDom(): {
  readonly domWindow: Window;
  readonly container: HTMLElement;
  readonly cleanup: () => Promise<void>;
} {
  const domWindow = new Window({ url: 'http://localhost:3000/' });
  const g = globalThis as Record<string, unknown>;
  const backup: DomGlobalsBackup = {
    window: g['window'],
    document: g['document'],
    navigator: g['navigator'],
    HTMLElement: g['HTMLElement'],
    requestAnimationFrame: g['requestAnimationFrame'],
    sessionStorage: g['sessionStorage']
  };

  g['window'] = domWindow;
  g['document'] = domWindow.document;
  g['navigator'] = domWindow.navigator;
  g['HTMLElement'] = domWindow.HTMLElement;
  g['sessionStorage'] = domWindow.sessionStorage;
  g['requestAnimationFrame'] = (cb: FrameRequestCallback): number => {
    cb(0);
    return 1;
  };

  domWindow.document.body.innerHTML = '<div id="app"><div id="ui-root"></div></div>';
  const container = domWindow.document.getElementById('ui-root') as unknown as HTMLElement;

  const cleanup = async (): Promise<void> => {
    render(null, container);
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
    await domWindow.happyDOM.close();
    g['window'] = backup.window;
    g['document'] = backup.document;
    g['navigator'] = backup.navigator;
    g['HTMLElement'] = backup.HTMLElement;
    g['requestAnimationFrame'] = backup.requestAnimationFrame;
    g['sessionStorage'] = backup.sessionStorage;
  };

  return { domWindow, container, cleanup };
}

afterEach(() => {
  editorStore.reset();
  uiStore.reset();
  inputScopeManager.setEditorHook(null);
});

describe('Phase 44 Preact Campaign Editor & Schema Auto-Discovery', () => {
  it('auto-discovers 100% of CampaignDataSchema keys in VIEW_GROUPS and CAMPAIGN_CATEGORY_META', () => {
    const schemaKeys = Object.keys(CampaignDataSchema.shape) as Array<keyof typeof CampaignDataSchema.shape>;
    expect(schemaKeys.length).toBeGreaterThanOrEqual(36);

    const viewGroupTabIds = new Set<string>();
    for (const group of VIEW_GROUPS) {
      for (const tab of group.tabs) {
        viewGroupTabIds.add(tab.id);
      }
    }

    for (const key of schemaKeys) {
      expect(CAMPAIGN_CATEGORY_META[key]).toBeDefined();
      expect(CampaignCategorySchemas[key]).toBeDefined();
      expect(viewGroupTabIds.has(key)).toBe(true);
    }

    expect(resolveCategoryPanelType('items')).toBe('dictionary');
    expect(resolveCategoryPanelType('areas')).toBe('dictionary');
    expect(resolveCategoryPanelType('manifest')).toBe('singleton');
    expect(resolveCategoryPanelType('factions')).toBe('custom');

    const classicGroups = getRuleset('classic').getEditorViewGroups(VIEW_GROUPS);
    const dndGroups = getRuleset('dnd35e').getEditorViewGroups(VIEW_GROUPS);
    expect(classicGroups.length).toBe(VIEW_GROUPS.length);
    expect(dndGroups.length).toBe(VIEW_GROUPS.length);
  });

  it('unifies resolveFieldReferenceKind, getReferenceOptions, and buildReferenceIndex', () => {
    const campaign = loadCampaignFromDisk('default');
    expect(resolveFieldReferenceKind('startingAreaId', '/rules/map/startingAreaId')).toBe('area');
    expect(resolveFieldReferenceKind('templateId', '/areas/start/placedEntities/0/templateId')).toBe('entity');
    expect(resolveFieldReferenceKind('inventory', '/entities/player/inventory/0')).toBe('item');
    expect(resolveFieldReferenceKind('faction', '/entities/goblin/faction')).toBe('faction');

    const areaOptions = getReferenceOptions('startingAreaId', campaign, '/rules/map/startingAreaId');
    expect(areaOptions).not.toBeNull();
    expect(areaOptions!.some((opt) => opt.value === campaign.rules.map.startingAreaId)).toBe(true);

    const index = buildReferenceIndex(campaign);
    const startUsages = queryUsages(index, 'area', campaign.rules.map.startingAreaId);
    expect(startUsages.some((u) => u.sourcePath === '/rules/map/startingAreaId')).toBe(true);
  });

  it('deduplicates identical shallow and deep validation diagnostics', () => {
    const shallow = [
      { path: '/areas/start/name', message: 'Required', severity: 'error' as const },
      { path: '/rules/map/width', message: 'Too small', severity: 'warning' as const }
    ];
    const deep = {
      isValid: false,
      errors: [
        { path: '/areas/start/name', message: 'Required', severity: 'error' as const },
        { path: '/areas/crypt', message: 'Unreachable', severity: 'error' as const }
      ],
      warnings: [{ path: '/rules/map/width', message: 'Too small', severity: 'warning' as const }]
    };

    const deduped = dedupeValidationDiagnostics(shallow, deep);
    expect(deduped.length).toBe(3);
  });

  it('renders recursive ZodRecordEditor (scalar + nested rename/delete), non-nested Accordion actions, ZodUnionEditor, and numeric-index ZodArrayField', async () => {
    const { domWindow, container, cleanup } = setupHappyDom();
    try {
      const campaign = loadCampaignFromDisk('default');
      const areaId = Object.keys(campaign.areas)[0]!;
      campaign.areas[areaId] = {
        ...campaign.areas[areaId]!,
        staticMap: {
          layout: ['..', '..'],
          legend: { '.': Object.keys(campaign.tiles)[0] ?? 'floor' }
        }
      };
      const controller = new CampaignEditor(campaign);

      // 1. Real scalar ZodRecordEditor mutation on staticMap/legend + no nested buttons inside Accordion trigger
      const legendSchema = z.record(z.string(), z.string());
      render(
        <ZodRecordEditor
          controller={controller}
          schema={legendSchema}
          value={controller.getDocument().areas[areaId]!.staticMap!.legend}
          basePath={`/areas/${areaId}/staticMap/legend`}
          label="Legend"
          isOptional={true}
        />,
        container
      );
      expect(container.querySelector('.ui-accordion__trigger button')).toBeNull();
      expect(container.querySelector('button[aria-label="Rename key ."]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="Delete key ."]')).not.toBeNull();

      const textInput = container.querySelector('.ui-editor-record__val input') as HTMLInputElement | null;
      expect(textInput).not.toBeNull();
      const altTile = Object.keys(campaign.tiles)[1] ?? Object.keys(campaign.tiles)[0] ?? 'wall';
      textInput!.value = altTile;
      textInput!.dispatchEvent(new domWindow.Event('input', { bubbles: true }));
      expect(controller.getDocument().areas[areaId]!.staticMap!.legend['.']).toBe(altTile);

      // 2. Non-scalar ZodRecordEditor renders both Rename and Delete buttons on nested entries
      const nestedSchema = z.record(z.string(), z.object({ label: z.string() }));
      render(
        <ZodRecordEditor
          controller={controller}
          schema={nestedSchema}
          value={{ alpha: { label: 'Alpha' } }}
          basePath="/rules/nestedSample"
          label="Nested Sample"
          isOptional={true}
        />,
        container
      );
      expect(container.querySelector('.ui-accordion__trigger button')).toBeNull();
      expect(container.querySelector('button[aria-label="Rename key alpha"]')).not.toBeNull();
      expect(container.querySelector('button[aria-label="Delete key alpha"]')).not.toBeNull();

      // 3. Optional ZodObjectField places remove button outside Accordion trigger
      render(
        <ZodObjectField
          controller={controller}
          schema={z.object({ title: z.string() })}
          value={{ title: 'Hello' }}
          basePath="/rules/optObj"
          label="Opt Obj"
          isOptional={true}
        />,
        container
      );
      expect(container.querySelector('.ui-accordion__trigger button')).toBeNull();
      expect(container.querySelector('.ui-accordion__actions button')).not.toBeNull();

      // 4. ZodDiscriminatedUnion switching
      const unionSchema = z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('alpha'), label: z.string().default('Alpha') }),
        z.object({ kind: z.literal('beta'), count: z.number().default(5) })
      ]);
      const opsLog: Array<ReadonlyArray<{ readonly op: string; readonly path: string; readonly value?: unknown }>> = [];
      const spyController: CampaignEditor = Object.create(controller) as CampaignEditor;
      spyController.applyOperations = (ops): void => {
        opsLog.push(ops);
      };

      render(
        <ZodUnionEditor
          controller={spyController}
          schema={unionSchema}
          value={{ kind: 'alpha', label: 'Alpha' }}
          basePath="/rules/sampleUnion"
          label="Sample Union"
          isOptional={false}
        />,
        container
      );
      const selectEl = container.querySelector('select') as HTMLSelectElement | null;
      expect(selectEl).not.toBeNull();
      selectEl!.value = 'beta';
      selectEl!.dispatchEvent(new domWindow.Event('change', { bubbles: true }));
      expect(opsLog[0]?.[0]?.path).toBe('/rules/sampleUnion');
      expect(opsLog[0]?.[0]?.value).toEqual({ kind: 'beta', count: 5 });

      // 5. ZodArrayField numeric append index (/N rather than /-)
      const arraySchema = z.array(z.string());
      render(
        <ZodFormRenderer
          controller={spyController}
          schema={arraySchema}
          value={['one', 'two']}
          basePath="/rules/sampleList"
          labelOverride="Sample List"
        />,
        container
      );
      const addItemBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('+ Add Item')
      );
      expect(addItemBtn).toBeDefined();
      addItemBtn!.click();
      expect(opsLog[1]?.[0]?.path).toBe('/rules/sampleList/2');
    } finally {
      await cleanup();
    }
  });

  it('supports Multi-Z slice management in AreaStaticPainter and Z-slice stepping without seed reroll in AreaEditor', async () => {
    const { container, cleanup } = setupHappyDom();
    try {
      const campaign = loadCampaignFromDisk('default');
      const areaId = Object.keys(campaign.areas)[0]!;
      campaign.areas[areaId] = {
        ...campaign.areas[areaId]!,
        staticMap: {
          layout: ['....', '....'],
          legend: { '.': Object.keys(campaign.tiles)[0] ?? 'floor' },
          zLevels: { '1': ['....', '....'] }
        },
        placedEntities: [{ templateId: Object.keys(campaign.entities)[0] ?? 'player', x: 1, y: 1, z: 1 }]
      };
      const controller = new CampaignEditor(campaign);
      const area = controller.getDocument().areas[areaId]!;

      render(
        <AreaStaticPainter
          controller={controller}
          doc={controller.getDocument()}
          area={area}
          basePath={`/areas/${areaId}`}
        />,
        container
      );

      expect(container.textContent).toContain('Z+0');
      expect(container.textContent).toContain('Z+1');

      const addAboveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('+ Z Above')
      );
      expect(addAboveBtn).toBeDefined();
      addAboveBtn!.click();

      const updatedZLevels = controller.getDocument().areas[areaId]!.staticMap!.zLevels!;
      expect(updatedZLevels['2']).toBeDefined();
      expect(updatedZLevels['2']!.length).toBe(2);

      // Verify AreaEditor does NOT call generateSandboxArea again when stepping Z- / Z+
      const procAreaId = Object.keys(campaign.areas).find((k) => campaign.areas[k]?.generatorType !== 'static');
      if (procAreaId) {
        const procController = new CampaignEditor(loadCampaignFromDisk('default'));
        let genCalls = 0;
        const origGenerate = procController.generateSandboxArea.bind(procController);
        procController.generateSandboxArea = (id: string) => {
          genCalls += 1;
          const res = origGenerate(id);
          return {
            ...res,
            map: { ...res.map, minZ: 0, maxZ: 2 }
          };
        };

        render(null, container);
        render(
          <AreaEditor
            controller={procController}
            area={procController.getDocument().areas[procAreaId]!}
            basePath={`/areas/${procAreaId}`}
          />,
          container
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        expect(genCalls).toBe(1);

        const zPlusBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Z+');
        expect(zPlusBtn).toBeDefined();
        zPlusBtn!.click();
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        expect(container.textContent).toContain('Z=1');
        expect(genCalls).toBe(1);
      }
    } finally {
      await cleanup();
    }
  });

  it('routes EditorScope keyboard shortcuts and TextInputGuard properly via InputScopeManager', async () => {
    const { domWindow, cleanup } = setupHappyDom();
    try {
      const campaign = loadCampaignFromDisk('default');
      const editorState = { ...buildGameState(campaign), uiMode: UIMode.Editor };

      let undoCount = 0;
      let saveCount = 0;
      let playtestCount = 0;
      let escapeCount = 0;
      inputScopeManager.setEditorHook({
        onUndo: () => {
          undoCount += 1;
        },
        onRedo: () => {},
        onSave: () => {
          saveCount += 1;
        },
        onPlaytest: () => {
          playtestCount += 1;
        },
        onEscape: () => {
          escapeCount += 1;
        }
      });

      const saveEvt = new domWindow.KeyboardEvent('keydown', { key: 's', code: 'KeyS', ctrlKey: true });
      inputScopeManager.dispatchKeyEvent(saveEvt as unknown as KeyboardEvent, editorState);
      expect(saveCount).toBe(1);

      const playEvt = new domWindow.KeyboardEvent('keydown', { key: 'F2', code: 'F2' });
      inputScopeManager.dispatchKeyEvent(playEvt as unknown as KeyboardEvent, editorState);
      expect(playtestCount).toBe(1);

      const undoEvt = new domWindow.KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
      inputScopeManager.dispatchKeyEvent(undoEvt as unknown as KeyboardEvent, editorState);
      expect(undoCount).toBe(1);

      const escEvt = new domWindow.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
      inputScopeManager.dispatchKeyEvent(escEvt as unknown as KeyboardEvent, editorState);
      expect(escapeCount).toBe(1);
    } finally {
      await cleanup();
    }
  });

  it('mounts EditorShell inside AppUiRoot when uiMode === Editor and renders theme switcher and specialized panels', async () => {
    const { domWindow, container, cleanup } = setupHappyDom();
    try {
      const campaign = loadCampaignFromDisk('default');
      const controller = new CampaignEditor(campaign);
      const gameState = { ...buildGameState(campaign), uiMode: UIMode.Editor };

      editorStore.bindController(controller);
      uiStore.syncFromPresenter(gameState, false, new Set([PresentationDomain.Editor]));

      render(<AppUiRoot />, container);
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      const shell = container.querySelector('.ui-editor-shell');
      expect(shell).not.toBeNull();
      expect(shell!.getAttribute('data-ui-density')).toBe('compact');

      // Toolbar theme switcher switches document theme cleanly
      const themeSelect = container.querySelector('select[aria-label="Editor UI Theme"]') as HTMLSelectElement | null;
      expect(themeSelect).not.toBeNull();
      themeSelect!.value = 'parchment';
      themeSelect!.dispatchEvent(new domWindow.Event('change', { bubbles: true }));
      expect(domWindow.document.documentElement.getAttribute('data-ui-theme')).toBe('parchment');

      // Switch to Factions custom panel via Activity Bar / Tab
      editorStore.selectTab('factions');
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      expect(container.querySelector('.ui-editor-factions__table')).not.toBeNull();

      // Switch to Simulation Lab and exercise tabs
      editorStore.selectTab('simulation');
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      expect(container.querySelector('.ui-editor-simulation-lab')).not.toBeNull();

      // Switch to Validation Dock & WhereUsedDrawer interactively inside EditorShell
      editorStore.setValidationDockOpen(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      expect(container.querySelector('.ui-editor-validation-dock')).not.toBeNull();

      const startAreaId = campaign.rules.map.startingAreaId;
      editorStore.setWhereUsedTarget({ kind: 'area', id: startAreaId });
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      const whereUsedDrawer = container.querySelector('.ui-editor-where-used');
      expect(whereUsedDrawer).not.toBeNull();
      expect(whereUsedDrawer!.textContent).toContain('startingAreaId');

      // Render DialogueEditor, FactionMatrixEditor, TriggerComposer, SimulationLab cleanly
      render(null, container);
      const dialogueId = Object.keys(campaign.dialogues)[0];
      if (dialogueId) {
        render(
          <DialogueEditor
            controller={controller}
            tree={campaign.dialogues[dialogueId]!}
            basePath={`/dialogues/${dialogueId}`}
          />,
          container
        );
        expect(container.querySelector('.ui-editor-node-list')).not.toBeNull();
      }

      render(null, container);
      render(<FactionMatrixEditor controller={controller} basePath="/factions" />, container);
      expect(container.querySelector('.ui-editor-factions__table')).not.toBeNull();

      render(null, container);
      render(<TriggerComposer controller={controller} />, container);
      expect(
        container.querySelector('.ui-editor-split') ?? container.querySelector('.ui-editor-placeholder')
      ).not.toBeNull();

      render(null, container);
      render(<SimulationLab controller={controller} />, container);
      const directorTab = Array.from(container.querySelectorAll('[role="tab"]')).find((el) =>
        el.textContent?.includes('Director Sandbox')
      ) as HTMLElement | undefined;
      expect(directorTab).toBeDefined();
      directorTab!.dispatchEvent(new domWindow.MouseEvent('click', { bubbles: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 60));
      expect(container.textContent).toContain('Director');

      // Navigate to a specific field via editorStore
      editorStore.navigateToPath('/rules/map/startingAreaId');
      expect(editorStore.getSnapshot().activeTabId).toBe('rules');
    } finally {
      await cleanup();
    }
  });
});
