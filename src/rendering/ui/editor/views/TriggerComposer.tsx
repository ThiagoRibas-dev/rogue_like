import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { z } from 'zod';
import { ALL_COMPOSER_PLACEHOLDERS } from '../../../../constants/trigger.constants.ts';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { compileTrigger } from '../../../../systems/trigger-composer.system.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import type { TriggerDefinition } from '../../../../types/trigger.types.ts';
import { Accordion } from '../../primitives/Accordion.tsx';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { FormField, Select, TextInput } from '../../primitives/FormControls.tsx';
import { dialogService, toastService } from '../../primitives/dialog_service.ts';
import { editorStore, escapeJsonPointerSegment } from '../editor_store.ts';

function getTemplateVariables(template: unknown): string[] {
  const vars = new Set<string>();
  if (template && typeof template === 'object' && 'expectedVariables' in template) {
    const expected = (template as Record<string, unknown>).expectedVariables;
    if (Array.isArray(expected)) {
      for (const v of expected) {
        if (typeof v === 'string' && v) vars.add(v);
      }
    }
  }
  if (template) {
    const serialized = JSON.stringify(template);
    const regex = /\$[A-Z0-9_]+/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(serialized)) !== null) {
      vars.add(match[0]);
    }
  }
  return Array.from(vars);
}

function parseVariableValue(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

function describeVariableType(raw: string): 'Boolean' | 'Number' | 'String' {
  if (raw === 'true' || raw === 'false') return 'Boolean';
  if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return 'Number';
  return 'String';
}

/** Props for `<TriggerComposer />`. */
export interface TriggerComposerProps {
  readonly controller: EditorController;
}

/**
 * Interactive Trigger Composer compiling reusable `triggerTemplates` into validated triggers
 * and baking them cleanly into the campaign via `editorStore`.
 */
export function TriggerComposer({ controller }: TriggerComposerProps): JSX.Element {
  const doc = controller.getDocument();
  const templates = doc.triggerTemplates ?? {};
  const templateIds = Object.keys(templates);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(() => templateIds[0] ?? '');
  const [bindingsState, setBindingsState] = useState<Record<string, string>>({});
  const [targetId, setTargetId] = useState<string>(
    () => `trigger_baked_${templateIds[0] ?? 'custom'}_${Date.now().toString().slice(-4)}`
  );

  useEffect(() => {
    if (templateIds.length > 0 && !templates[selectedTemplateId]) {
      setSelectedTemplateId(templateIds[0]!);
    }
  }, [templateIds, selectedTemplateId, templates]);

  const templateVars = useMemo(() => {
    return getTemplateVariables(templates[selectedTemplateId]);
  }, [templates, selectedTemplateId]);

  const compilation = useMemo(():
    { readonly ok: true; readonly compiled: TriggerDefinition } | { readonly ok: false; readonly error: string } => {
    const cleanId = targetId.trim();
    if (!cleanId) return { ok: false, error: 'Target Trigger ID cannot be empty.' };
    if (!/^[a-z0-9_-]+$/.test(cleanId)) {
      return { ok: false, error: 'Trigger ID must be lowercase alphanumeric, dashes, or underscores.' };
    }
    if (!templates[selectedTemplateId]) {
      return { ok: false, error: 'No trigger template selected.' };
    }
    try {
      const typedBindings: Record<string, string | number | boolean> = {};
      for (const v of templateVars) {
        typedBindings[v] = parseVariableValue(bindingsState[v] ?? '');
      }
      const dummyState = { campaign: { triggerTemplates: templates } } as unknown as GameState;
      const compiled = compileTrigger(selectedTemplateId, typedBindings, dummyState, cleanId);
      return { ok: true, compiled };
    } catch (err: unknown) {
      if (err instanceof z.ZodError) {
        return {
          ok: false,
          error: err.issues.map((i) => `• [${i.path.join('.')}] ${i.message}`).join('\n')
        };
      }
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }, [selectedTemplateId, targetId, templateVars, bindingsState, templates]);

  if (templateIds.length === 0) {
    return (
      <div className="ui-editor-placeholder">
        <h3>No Trigger Templates Found</h3>
        <p className="ui-editor-muted">Add templates in triggerTemplates to enable the Trigger Composer.</p>
      </div>
    );
  }

  const handleBake = async (): Promise<void> => {
    if (!compilation.ok) return;
    const cleanId = targetId.trim();
    if (doc.triggers?.[cleanId]) {
      const ok = await dialogService.confirm({
        title: 'Overwrite Existing Trigger?',
        message: `A trigger with ID "${cleanId}" already exists. Overwrite it?`,
        confirmLabel: 'Overwrite',
        danger: true
      });
      if (!ok) return;
    }

    controller.applyOperations([
      { op: 'add', path: `/triggers/${escapeJsonPointerSegment(cleanId)}`, value: compilation.compiled }
    ]);
    toastService.push(`Trigger "${cleanId}" baked to campaign.`, 'success');
    editorStore.selectTab('triggers');
    editorStore.selectItem(cleanId);
  };

  return (
    <div className="ui-editor-split">
      <div className="ui-editor-split__left">
        <FormField label="1. Choose a Trigger Template">
          <Select
            value={selectedTemplateId}
            ariaLabel="Trigger template"
            options={templateIds.map((id) => ({ value: id, label: id }))}
            onChange={(next) => {
              setSelectedTemplateId(next);
              setTargetId(`trigger_baked_${next}_${Date.now().toString().slice(-4)}`);
            }}
          />
        </FormField>

        <Accordion title="Standard System Placeholders" defaultExpanded={false}>
          <ul className="ui-editor-placeholder-list">
            {ALL_COMPOSER_PLACEHOLDERS.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Accordion>

        <div className="ui-editor-section-box">
          <h4>2. Variables & Bindings</h4>
          {templateVars.length === 0 ? (
            <p className="ui-editor-muted">No placeholders found in this template.</p>
          ) : (
            templateVars.map((v) => {
              const rawVal = bindingsState[v] ?? '';
              return (
                <FormField key={v} label={`${v} (${describeVariableType(rawVal)})`}>
                  <TextInput
                    value={rawVal}
                    ariaLabel={`Binding ${v}`}
                    placeholder="Value..."
                    onInput={(next) => setBindingsState((prev) => ({ ...prev, [v]: next }))}
                  />
                </FormField>
              );
            })
          )}
        </div>

        <div className="ui-editor-section-box">
          <h4>3. Output Configuration</h4>
          <FormField label="Target Trigger ID" hint="Must be lowercase alphanumeric, dashes, or underscores.">
            <TextInput value={targetId} ariaLabel="Target Trigger ID" onInput={setTargetId} />
          </FormField>
          <Button variant="primary" disabled={!compilation.ok} onClick={() => void handleBake()}>
            Bake Trigger to Campaign
          </Button>
        </div>
      </div>

      <div className="ui-editor-split__right">
        <div className={`ui-editor-status-banner ${compilation.ok ? 'is-valid' : 'is-invalid'}`}>
          {compilation.ok ? (
            <>
              <Badge tone="success">VALID TRIGGER</Badge>
              <span>Adheres to TriggerDefinitionSchema</span>
            </>
          ) : (
            <div>
              <Badge tone="danger">INVALID TRIGGER</Badge>
              <pre className="ui-editor-pre">{compilation.error}</pre>
            </div>
          )}
        </div>

        <pre className="ui-editor-json-preview">
          {compilation.ok ? JSON.stringify(compilation.compiled, null, 2) : 'Compilation failed.'}
        </pre>
      </div>
    </div>
  );
}
