import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { z } from 'zod';
import { loadRulesetSystemContent } from '../../../../core/loader.ts';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { resolveFieldReferenceKind } from '../../../../editor/reference_index.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import type { RulesetId } from '../../../../types/ruleset.types.ts';
import { Button, IconButton } from '../../primitives/Button.tsx';
import {
  Checkbox,
  FormField,
  NumberInput,
  Select,
  type SelectOption,
  TextInput
} from '../../primitives/FormControls.tsx';
import { getReferenceOptions } from '../../ui_utils.ts';
import { resolveCategoryReferenceKind } from '../editor_store.ts';

/** Props for `<ZodPrimitiveField />`. */
export interface ZodPrimitiveFieldProps {
  readonly controller: EditorController;
  readonly schema: z.ZodTypeAny;
  readonly value: unknown;
  readonly basePath: string;
  readonly label: string;
  readonly isOptional: boolean;
  readonly exactErrors: ReadonlyArray<ValidationError>;
}

function validateValueInline(schema: z.ZodTypeAny, value: unknown): string | null {
  const res = schema.safeParse(value);
  if (res.success) return null;
  return res.error.issues[0]?.message ?? 'Invalid value';
}

function ColorPickerControl({
  label,
  value,
  hint,
  error,
  onChange
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string | undefined;
  readonly error?: string | null | undefined;
  readonly onChange: (next: string) => void;
}): JSX.Element {
  const safeHex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff';
  return (
    <FormField label={label} hint={hint} error={error}>
      <div className="ui-editor-color-row">
        <input
          type="color"
          className="ui-editor-color-swatch"
          value={safeHex}
          aria-label={`${label} color picker`}
          onInput={(e) => onChange((e.target as HTMLInputElement).value)}
        />
        <TextInput value={value} ariaLabel={`${label} hex`} onInput={onChange} />
      </div>
    </FormField>
  );
}

function RawJsonFallbackField({
  label,
  value,
  hint,
  onCommit
}: {
  readonly label: string;
  readonly value: unknown;
  readonly hint?: string | undefined;
  readonly onCommit: (next: unknown) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<string>(() => JSON.stringify(value ?? {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(JSON.stringify(value ?? {}, null, 2));
    setParseError(null);
  }, [value]);

  const handleBlur = (): void => {
    try {
      const parsed = JSON.parse(draft) as unknown;
      setParseError(null);
      onCommit(parsed);
    } catch {
      setParseError('Invalid JSON syntax — fix formatting before applying.');
    }
  };

  return (
    <FormField label={label} hint={hint} error={parseError}>
      <textarea
        className="ui-input ui-editor-json-textarea"
        value={draft}
        onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        onBlur={handleBlur}
        aria-label={label}
      />
    </FormField>
  );
}

/**
 * Multi-select checkbox list for string tag arrays (`*tag*` fields).
 */
export function MultiSelectTagsField({
  label,
  value,
  options,
  onChange
}: {
  readonly label: string;
  readonly value: ReadonlyArray<string>;
  readonly options: ReadonlyArray<SelectOption>;
  readonly onChange: (next: string[]) => void;
}): JSX.Element {
  const selectedSet = new Set(value);
  return (
    <FormField label={label}>
      <div className="ui-editor-tag-grid">
        {options.map((opt) => {
          const checked = selectedSet.has(opt.value);
          return (
            <Checkbox
              key={opt.value}
              label={opt.label}
              checked={checked}
              onChange={(nextChecked) => {
                const next = nextChecked ? [...value, opt.value] : value.filter((v) => v !== opt.value);
                onChange(Array.from(new Set(next)));
              }}
            />
          );
        })}
      </div>
    </FormField>
  );
}

/**
 * Preact primitive field renderer for `ZodString`, `ZodNumber`, `ZodBoolean`, `ZodEnum`,
 * `ZodLiteral`, and untyped `ZodUnknown`/`ZodAny` fallback JSON fields, with sidebar drag-drop reference linking.
 */
export function ZodPrimitiveField({
  controller,
  schema,
  value,
  basePath,
  label,
  isOptional,
  exactErrors
}: ZodPrimitiveFieldProps): JSX.Element {
  const [inlineErr, setInlineErr] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const key = basePath.split('/').pop() || 'Field';
  const doc = controller.getDocument();

  const firstIssue = exactErrors[0];
  const combinedError = firstIssue?.message ?? inlineErr;
  const combinedHint = firstIssue?.fixSuggestion ? `💡 Fix: ${firstIssue.fixSuggestion}` : undefined;

  const commitValue = (nextVal: unknown, coalesce = true): void => {
    setInlineErr(validateValueInline(schema, nextVal));
    controller.applyOperations([{ op: 'add', path: basePath, value: nextVal }], coalesce);
  };

  let control: JSX.Element;

  if (schema instanceof z.ZodString) {
    const strVal = typeof value === 'string' ? value : '';
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('color') || lowerKey.endsWith('fg') || lowerKey.endsWith('bg') || lowerKey === 'background') {
      control = (
        <ColorPickerControl
          label={label}
          value={strVal}
          hint={combinedHint}
          error={combinedError}
          onChange={(next) => commitValue(next)}
        />
      );
    } else {
      const refOptions = getReferenceOptions(key, doc, basePath);
      if (refOptions) {
        const expectedKind = resolveFieldReferenceKind(key, basePath);
        const hasCurrent = refOptions.some((o) => o.value === strVal);
        const mergedOptions = hasCurrent
          ? refOptions
          : [{ value: strVal, label: strVal ? `${strVal} (Unresolved)` : '— Select —' }, ...refOptions];
        control = (
          <div
            className={`ui-editor-drop-target ${isDragOver ? 'is-drag-over' : ''}`}
            onDragOver={(e) => {
              if (!e.dataTransfer?.types.includes('application/x-editor-ref')) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'link';
              if (!isDragOver) setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(e) => {
              setIsDragOver(false);
              const raw = e.dataTransfer?.getData('application/x-editor-ref');
              if (!raw) return;
              e.preventDefault();
              try {
                const payload = JSON.parse(raw) as { readonly id?: unknown; readonly category?: unknown };
                if (typeof payload.id !== 'string' || typeof payload.category !== 'string') return;
                const droppedKind = resolveCategoryReferenceKind(payload.category);
                if (expectedKind && droppedKind !== expectedKind) return;
                commitValue(payload.id, false);
              } catch {
                // Ignore malformed drag payload
              }
            }}
          >
            <FormField label={label} hint={combinedHint} error={combinedError}>
              <Select value={strVal} options={mergedOptions} ariaLabel={label} onChange={(next) => commitValue(next)} />
            </FormField>
          </div>
        );
      } else {
        control = (
          <FormField label={label} hint={combinedHint} error={combinedError}>
            <TextInput value={strVal} ariaLabel={label} onInput={(next) => commitValue(next)} />
          </FormField>
        );
      }
    }
  } else if (schema instanceof z.ZodNumber) {
    const numVal = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    control = (
      <FormField label={label} hint={combinedHint} error={combinedError}>
        <NumberInput value={numVal} ariaLabel={label} onChange={(next) => commitValue(next)} />
      </FormField>
    );
  } else if (schema instanceof z.ZodBoolean) {
    control = (
      <FormField label="" hint={combinedHint} error={combinedError}>
        <Checkbox label={label} checked={Boolean(value)} onChange={(next) => commitValue(next)} />
      </FormField>
    );
  } else if (schema instanceof z.ZodEnum) {
    const enumOpts: SelectOption[] = (schema.options as ReadonlyArray<string | number>).map((opt) => ({
      value: String(opt),
      label: String(opt)
    }));
    const curStr = typeof value === 'string' || typeof value === 'number' ? String(value) : (enumOpts[0]?.value ?? '');
    control = (
      <FormField label={label} hint={combinedHint} error={combinedError}>
        <Select
          value={curStr}
          options={enumOpts}
          ariaLabel={label}
          onChange={(next) => {
            commitValue(next);
            if (basePath.endsWith('rulesetId')) {
              loadRulesetSystemContent(next as RulesetId)
                .then((sysContent) => {
                  if (Object.keys(sysContent).length > 0) {
                    controller.applyOperations([{ op: 'add', path: '/systemContent', value: sysContent }]);
                  }
                })
                .catch(console.error);
            }
          }}
        />
      </FormField>
    );
  } else if (schema instanceof z.ZodLiteral) {
    control = (
      <FormField label={label} hint={combinedHint} error={combinedError}>
        <TextInput value={String(schema.value)} disabled ariaLabel={label} onInput={() => {}} />
      </FormField>
    );
  } else {
    control = (
      <RawJsonFallbackField
        label={label}
        value={value}
        hint={combinedHint}
        onCommit={(parsed) => commitValue(parsed, false)}
      />
    );
  }

  return (
    <div className="ui-editor-field-row" data-field-path={basePath}>
      <div className="ui-editor-field-row__main">{control}</div>
      {isOptional ? (
        <IconButton
          ariaLabel={`Remove optional field ${label}`}
          title="Remove Optional Field"
          variant="danger"
          onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
        >
          ✕
        </IconButton>
      ) : null}
    </div>
  );
}

/** Button rendered when an optional schema field currently has `undefined`/`null` value. */
export function AddOptionalFieldButton({
  label,
  onClick
}: {
  readonly label: string;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <div className="ui-editor-optional-add">
      <Button size="sm" variant="secondary" onClick={onClick}>
        + Add {label}
      </Button>
    </div>
  );
}
