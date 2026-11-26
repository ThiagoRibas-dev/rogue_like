import type { JSX } from 'preact';
import { z } from 'zod';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { Accordion } from '../../primitives/Accordion.tsx';
import { Button, IconButton } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { NumberInput, TextInput } from '../../primitives/FormControls.tsx';
import { dialogService } from '../../primitives/dialog_service.ts';
import { escapeJsonPointerSegment } from '../editor_store.ts';
import { ZodFormRenderer } from './ZodFormRenderer.tsx';
import { buildDefaultValueForZodSchema, collectFieldErrors, unwrapZodFieldSchema } from './zod_form_helpers.ts';

/** Props for `<ZodRecordEditor />`. */
export interface ZodRecordEditorProps {
  readonly controller: EditorController;
  readonly schema: z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>;
  readonly value: Record<string, unknown> | undefined;
  readonly basePath: string;
  readonly label: string;
  readonly isOptional: boolean;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * First-class Preact dictionary editor for any `z.ZodRecord<K, V>` field
 * (`legend`, `entityLegend`, `weightModifiers`, `subBiomes`, `systemContent`, etc.)
 * with full add, rename, and delete support for both scalar and nested object entries.
 */
export function ZodRecordEditor({
  controller,
  schema,
  value,
  basePath,
  label,
  isOptional,
  errors
}: ZodRecordEditorProps): JSX.Element {
  const recordObj = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const entries = Object.entries(recordObj);
  const valueSchema = schema.valueSchema as z.ZodTypeAny;
  const unwrappedVal = unwrapZodFieldSchema(valueSchema).inner;
  const isScalarVal =
    unwrappedVal instanceof z.ZodString || unwrappedVal instanceof z.ZodNumber || unwrappedVal instanceof z.ZodBoolean;

  const { descendantCount } = collectFieldErrors(errors, basePath);

  const handleAddKey = async (): Promise<void> => {
    const newKey = await dialogService.prompt({
      title: `Add Entry to ${label}`,
      placeholder: 'Enter dictionary key',
      confirmLabel: 'Add',
      validator: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return 'Key cannot be empty.';
        if (trimmed in recordObj) return 'Key already exists in this record.';
        return null;
      }
    });
    if (!newKey) return;
    const cleanKey = newKey.trim();
    const defaultVal = buildDefaultValueForZodSchema(valueSchema);

    if (value === undefined) {
      controller.applyOperations([{ op: 'add', path: basePath, value: { [cleanKey]: defaultVal } }]);
    } else {
      controller.applyOperations([
        { op: 'add', path: `${basePath}/${escapeJsonPointerSegment(cleanKey)}`, value: defaultVal }
      ]);
    }
  };

  const handleRenameKey = async (oldKey: string): Promise<void> => {
    const nextKey = await dialogService.prompt({
      title: `Rename Key "${oldKey}"`,
      defaultValue: oldKey,
      placeholder: 'Enter new dictionary key',
      confirmLabel: 'Rename',
      validator: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return 'Key cannot be empty.';
        if (trimmed !== oldKey && trimmed in recordObj) return 'Key already exists in this record.';
        return null;
      }
    });
    if (!nextKey) return;
    const cleanKey = nextKey.trim();
    if (cleanKey === oldKey) return;

    const currentVal = recordObj[oldKey];
    controller.applyOperations([
      { op: 'remove', path: `${basePath}/${escapeJsonPointerSegment(oldKey)}` },
      { op: 'add', path: `${basePath}/${escapeJsonPointerSegment(cleanKey)}`, value: currentVal }
    ]);
  };

  const handleRemoveKey = async (key: string): Promise<void> => {
    const confirmed = await dialogService.confirm({
      title: 'Remove Key',
      message: `Remove "${key}" from ${label}?`,
      confirmLabel: 'Remove',
      danger: true
    });
    if (!confirmed) return;
    controller.applyOperations([{ op: 'remove', path: `${basePath}/${escapeJsonPointerSegment(key)}` }]);
  };

  return (
    <div className="ui-editor-record" data-field-path={basePath}>
      <Accordion
        title={`${label} (${entries.length})`}
        defaultExpanded={entries.length <= 8}
        badge={descendantCount > 0 ? <Badge tone="danger">{descendantCount}</Badge> : undefined}
        actions={
          isOptional ? (
            <IconButton
              ariaLabel={`Remove optional record ${label}`}
              variant="danger"
              onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
            >
              ✕
            </IconButton>
          ) : undefined
        }
      >
        <div className="ui-editor-record__entries">
          {entries.length === 0 ? (
            <div className="ui-editor-muted">No entries yet.</div>
          ) : (
            entries.map(([key, entryVal]) => {
              const entryPath = `${basePath}/${escapeJsonPointerSegment(key)}`;
              if (isScalarVal) {
                return (
                  <div key={key} className="ui-editor-record__row" data-field-path={entryPath}>
                    <span className="ui-editor-record__key" title={key}>
                      {key}
                    </span>
                    <div className="ui-editor-record__val">
                      {unwrappedVal instanceof z.ZodNumber ? (
                        <NumberInput
                          value={typeof entryVal === 'number' ? entryVal : 0}
                          ariaLabel={`${label} ${key}`}
                          onChange={(next) =>
                            controller.applyOperations([{ op: 'add', path: entryPath, value: next }], true)
                          }
                        />
                      ) : unwrappedVal instanceof z.ZodBoolean ? (
                        <input
                          type="checkbox"
                          checked={Boolean(entryVal)}
                          aria-label={`${label} ${key}`}
                          onChange={(e) =>
                            controller.applyOperations(
                              [{ op: 'add', path: entryPath, value: (e.target as HTMLInputElement).checked }],
                              true
                            )
                          }
                        />
                      ) : (
                        <TextInput
                          value={typeof entryVal === 'string' ? entryVal : String(entryVal ?? '')}
                          ariaLabel={`${label} ${key}`}
                          onInput={(next) =>
                            controller.applyOperations([{ op: 'add', path: entryPath, value: next }], true)
                          }
                        />
                      )}
                    </div>
                    <div className="ui-editor-record__actions">
                      <IconButton
                        ariaLabel={`Rename key ${key}`}
                        title="Rename key"
                        onClick={() => void handleRenameKey(key)}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        ariaLabel={`Delete key ${key}`}
                        title="Delete key"
                        variant="danger"
                        onClick={() => void handleRemoveKey(key)}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </div>
                );
              }

              return (
                <div key={key} className="ui-editor-record__nested" data-field-path={entryPath}>
                  <div className="ui-editor-record__nested-header">
                    <span className="ui-editor-record__key" title={key}>
                      {key}
                    </span>
                    <div className="ui-editor-record__actions">
                      <IconButton
                        ariaLabel={`Rename key ${key}`}
                        title="Rename key"
                        onClick={() => void handleRenameKey(key)}
                      >
                        ✎
                      </IconButton>
                      <IconButton
                        ariaLabel={`Delete key ${key}`}
                        title="Delete key"
                        variant="danger"
                        onClick={() => void handleRemoveKey(key)}
                      >
                        ✕
                      </IconButton>
                    </div>
                  </div>
                  <ZodFormRenderer
                    controller={controller}
                    schema={valueSchema}
                    value={entryVal}
                    basePath={entryPath}
                    errors={errors}
                    labelOverride={key}
                  />
                </div>
              );
            })
          )}
          <div className="ui-editor-record__footer">
            <Button size="sm" variant="secondary" onClick={() => void handleAddKey()}>
              + Add Key
            </Button>
          </div>
        </div>
      </Accordion>
    </div>
  );
}
