import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import * as ROT from 'rot-js';
import { rng } from '../../../../core/rng.ts';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { runEncounterArena } from '../../../../editor/simulation/ai_arena.ts';
import { runEncounterDirector } from '../../../../map/encounter_director.ts';
import { generateArea, type GeneratedArea } from '../../../../map/generator.ts';
import { Button } from '../../primitives/Button.tsx';
import { FormField, NumberInput, Select, TextInput } from '../../primitives/FormControls.tsx';
import { Tabs } from '../../primitives/Tabs.tsx';
import { dialogService, toastService } from '../../primitives/dialog_service.ts';
import { buildBakedStaticArea } from '../../director/director_telemetry_view.ts';
import { editorStore, escapeJsonPointerSegment } from '../editor_store.ts';
import {
  DirectorMiniMap,
  DirectorReceiptView,
  DirectorSimReportView,
  type EncounterArenaReport
} from './DirectorSandboxViews.tsx';

const DEFAULT_PLAYER_LEVEL = 1;
const MIN_PLAYER_LEVEL = 1;
const MAX_PLAYER_LEVEL = 20;
const DEFAULT_MAX_SIM_TURNS = 100;
const MAX_RANDOM_SEED = 2147483647;

/** Props for `<DirectorSandbox />`. */
export interface DirectorSandboxProps {
  readonly controller: EditorController;
}

/**
 * Encounter Director Sandbox allowing procedural seed previews, budget/profile overrides,
 * auto-combat QA, and static area baking in declarative JSX.
 */
export function DirectorSandbox({ controller }: DirectorSandboxProps): JSX.Element {
  const doc = controller.getDocument();
  const directorAreas = Object.entries(doc.areas ?? {}).filter(([, area]) => area.encounterProfileId || area.crBudget);
  const profiles = Object.entries(doc.encounterProfiles ?? {});

  const [selectedAreaId, setSelectedAreaId] = useState<string>(() => directorAreas[0]?.[0] ?? '');
  const [seed, setSeed] = useState<number>(0);
  const [budgetOverrideText, setBudgetOverrideText] = useState<string>('');
  const [profileOverride, setProfileOverride] = useState<string>('');
  const [playerLevel, setPlayerLevel] = useState<number>(DEFAULT_PLAYER_LEVEL);
  const [generated, setGenerated] = useState<GeneratedArea | null>(null);
  const [rightTab, setRightTab] = useState<'receipt' | 'json'>('receipt');
  const [simReport, setSimReport] = useState<EncounterArenaReport | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const selectedArea = selectedAreaId ? doc.areas[selectedAreaId] : undefined;

  const handleGenerate = (): void => {
    if (!selectedAreaId || !selectedArea) return;
    const effectiveSeed = seed || Math.floor(rng.getUniform() * MAX_RANDOM_SEED);
    if (!seed) setSeed(effectiveSeed);

    const parsedBudget = budgetOverrideText.trim() ? Number.parseInt(budgetOverrideText.trim(), 10) : null;
    const budgetOverride = parsedBudget !== null && Number.isFinite(parsedBudget) ? parsedBudget : null;
    const profOverride = profileOverride || null;

    let effectiveDef = selectedArea;
    if (budgetOverride !== null || profOverride !== null) {
      effectiveDef = {
        ...selectedArea,
        ...(budgetOverride !== null ? { crBudget: budgetOverride } : {}),
        ...(profOverride !== null ? { encounterProfileId: profOverride } : {})
      };
    }

    const savedState = ROT.RNG.getState();
    try {
      ROT.RNG.setSeed(effectiveSeed);
      const context = { playerLevel, tokenPool: new Set<string>() };
      let nextGenerated = generateArea(doc, selectedAreaId, context);

      if (budgetOverride !== null || profOverride !== null) {
        const rooms = nextGenerated.rooms.map((r) => ({
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          centerX: r.centerX,
          centerY: r.centerY
        }));
        const directorRes = runEncounterDirector(doc, effectiveDef, nextGenerated.map, rooms, [], context);
        nextGenerated = {
          ...nextGenerated,
          placedEntities: directorRes.newEntities,
          directorReceipt: directorRes.receipt
        };
      }

      setGenerated(nextGenerated);
      setSimReport(null);
      setSimError(null);
    } finally {
      ROT.RNG.setState(savedState);
    }
  };

  const handleBake = async (): Promise<void> => {
    if (!generated || !selectedAreaId || !selectedArea) return;
    const newId = await dialogService.prompt({
      title: 'Bake Generated Area to Static Area',
      defaultValue: `${selectedAreaId}_baked`,
      placeholder: 'Unique static area ID',
      confirmLabel: 'Bake Area',
      validator: (val) =>
        /^[a-z0-9_-]+$/.test(val.trim()) ? null : 'ID must be lowercase alphanumeric, dashes, or underscores.'
    });
    if (!newId) return;
    const cleanId = newId.trim();
    if (doc.areas[cleanId]) {
      const overwrite = await dialogService.confirm({
        title: 'Overwrite Existing Area?',
        message: `An area with ID "${cleanId}" already exists. Overwrite it?`,
        confirmLabel: 'Overwrite',
        danger: true
      });
      if (!overwrite) return;
    }

    const staticArea = buildBakedStaticArea(cleanId, selectedArea, generated);
    controller.applyOperations([{ op: 'add', path: `/areas/${escapeJsonPointerSegment(cleanId)}`, value: staticArea }]);
    toastService.push(`Area "${cleanId}" baked to static map.`, 'success');
    editorStore.selectTab('areas');
    editorStore.selectItem(cleanId);
  };

  const handleAutoSimulate = (): void => {
    if (!generated?.placedEntities?.length) return;
    setIsSimulating(true);
    setSimError(null);
    const playerTemplateId =
      Object.entries(doc.entities).find(([, e]) => e.tags?.includes('actor') && e.roleTags?.includes('protein'))?.[0] ??
      Object.keys(doc.entities)[0] ??
      'goblin';

    setTimeout(() => {
      try {
        const report = runEncounterArena(
          playerTemplateId,
          (generated.placedEntities ?? []).map((e) => ({ templateId: e.templateId, x: e.x, y: e.y })),
          doc,
          generated.map,
          generated.startPos,
          DEFAULT_MAX_SIM_TURNS
        );
        setSimReport(report);
      } catch (err: unknown) {
        setSimError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsSimulating(false);
      }
    }, 30);
  };

  const handlePlayEncounter = (): void => {
    if (!generated) return;
    window.dispatchEvent(new CustomEvent('PlaySandboxEncounter', { detail: { generatedArea: generated } }));
  };

  const jsonPreviewText = useMemo(() => {
    if (!generated || !selectedArea) return '';
    return JSON.stringify(buildBakedStaticArea(`${selectedAreaId}_baked`, selectedArea, generated), null, 2);
  }, [generated, selectedArea, selectedAreaId]);

  return (
    <div className="ui-editor-lab-pane">
      <div className="ui-editor-lab-controls">
        <FormField label="Area">
          <Select
            value={selectedAreaId}
            ariaLabel="Sandbox Area"
            options={[
              { value: '', label: '— Select an Area —' },
              ...directorAreas.map(([id, area]) => ({ value: id, label: `${area.name} (${id})` }))
            ]}
            onChange={(val) => {
              setSelectedAreaId(val);
              setGenerated(null);
              setSimReport(null);
            }}
          />
        </FormField>

        <FormField label="Seed">
          <div className="ui-editor-row--tight">
            <NumberInput value={seed} ariaLabel="Generator Seed" onChange={setSeed} />
            <Button
              size="sm"
              title="Randomize Seed"
              onClick={() => setSeed(Math.floor(rng.getUniform() * MAX_RANDOM_SEED))}
            >
              🎲
            </Button>
          </div>
        </FormField>

        <FormField label="Budget Override">
          <TextInput
            value={budgetOverrideText}
            placeholder="(area default)"
            ariaLabel="Budget Override"
            onInput={setBudgetOverrideText}
          />
        </FormField>

        <FormField label="Profile Override">
          <Select
            value={profileOverride}
            ariaLabel="Profile Override"
            options={[
              { value: '', label: '(use area default)' },
              ...profiles.map(([id, p]) => ({ value: id, label: `${p.name} (${id})` }))
            ]}
            onChange={setProfileOverride}
          />
        </FormField>

        <FormField label="Player Level">
          <NumberInput
            value={playerLevel}
            min={MIN_PLAYER_LEVEL}
            max={MAX_PLAYER_LEVEL}
            ariaLabel="Player Level"
            onChange={setPlayerLevel}
          />
        </FormField>

        <div className="ui-editor-lab-actions">
          <Button variant="primary" disabled={!selectedArea} onClick={handleGenerate}>
            ⚙ Generate
          </Button>
          <Button disabled={!generated} onClick={() => void handleBake()}>
            💾 Bake Static Area
          </Button>
          <Button disabled={!generated?.placedEntities?.length || isSimulating} onClick={handleAutoSimulate}>
            {isSimulating ? '⏳ Simulating...' : '🤖 Auto-Simulate'}
          </Button>
          <Button variant="primary" disabled={!generated?.placedEntities?.length} onClick={handlePlayEncounter}>
            🎮 Play Encounter
          </Button>
        </div>
      </div>

      {selectedArea ? (
        <div className="ui-editor-muted">
          <strong>{selectedArea.name}</strong> | Budget:{' '}
          <code>
            {selectedArea.budgetScaling
              ? `${selectedArea.budgetScaling.baseBudget} + ${selectedArea.budgetScaling.scalingFactor} × level`
              : String(selectedArea.crBudget ?? 0)}
          </code>{' '}
          | Profile: <code>{selectedArea.encounterProfileId ?? '(none)'}</code> | Generator:{' '}
          <code>{selectedArea.generatorType}</code>
        </div>
      ) : null}

      {generated ? (
        <div className="ui-editor-split">
          <div className="ui-editor-split__left">
            <DirectorMiniMap doc={doc} generated={generated} />
          </div>

          <div className="ui-editor-split__right">
            <Tabs
              ariaLabel="Director Sandbox Output"
              activeTabId={rightTab}
              tabs={[
                { id: 'receipt', label: '📋 Receipt' },
                { id: 'json', label: '📝 View JSON' }
              ]}
              onSelectTab={(id) => setRightTab(id as 'receipt' | 'json')}
            />
            {rightTab === 'receipt' ? (
              generated.directorReceipt ? (
                <DirectorReceiptView doc={doc} receipt={generated.directorReceipt} />
              ) : (
                <p className="ui-editor-muted">No Encounter Director receipt emitted for this area.</p>
              )
            ) : (
              <pre className="ui-editor-json-preview">{jsonPreviewText}</pre>
            )}
          </div>
        </div>
      ) : null}

      {simError ? <div className="ui-editor-error-box">Simulation Error: {simError}</div> : null}
      {simReport ? <DirectorSimReportView report={simReport} /> : null}
    </div>
  );
}
