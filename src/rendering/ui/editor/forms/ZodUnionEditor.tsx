import type { JSX } from 'preact';
import { z } from 'zod';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { IconButton } from '../../primitives/Button.tsx';
import { FormField, Select } from '../../primitives/FormControls.tsx';
import { ZodFormRenderer } from './ZodFormRenderer.tsx';
import { buildDefaultValueForZodSchema, unwrapZodFieldSchema } from './zod_form_helpers.ts';

/** Props for `<ZodUnionEditor />`. */
export interface ZodUnionEditorProps {
  readonly controller: EditorController;
  readonly schema:
    | z.ZodDiscriminatedUnion<string, ReadonlyArray<z.ZodDiscriminatedUnionOption<string>>>
    | z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>;
  readonly value: unknown;
  readonly basePath: string;
  readonly label: string;
  readonly isOptional: boolean;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

function describeUnionOption(opt: z.ZodTypeAny, idx: number): string {
  const { inner } = unwrapZodFieldSchema(opt);
  if (inner instanceof z.ZodString) return 'String';
  if (inner instanceof z.ZodNumber) return 'Number';
  if (inner instanceof z.ZodBoolean) return 'Boolean';
  if (inner instanceof z.ZodArray) return 'Array';
  if (inner instanceof z.ZodRecord) return 'Record';
  if (inner instanceof z.ZodObject) {
    return inner.description || `Object (${Object.keys(inner.shape).slice(0, 3).join(', ')})`;
  }
  return `Option ${idx + 1}`;
}

/**
 * First-class Preact variant editor for `z.ZodDiscriminatedUnion` (e.g. conditions,
 * consequences, rewards, AI behaviors) and `z.ZodUnion` (e.g. `SpritePackRefSchema`, strings vs objects).
 */
export function ZodUnionEditor({
  controller,
  schema,
  value,
  basePath,
  label,
  isOptional,
  errors
}: ZodUnionEditorProps): JSX.Element {
  if (schema instanceof z.ZodDiscriminatedUnion) {
    const discriminator = schema.discriminator;
    const optionKeys = Array.from(schema.optionsMap.keys()).map((k) => String(k));
    const currentRec =
      value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const rawDisc = currentRec[discriminator];
    const activeDisc = typeof rawDisc === 'string' && optionKeys.includes(rawDisc) ? rawDisc : (optionKeys[0] ?? '');
    const activeBranch = schema.optionsMap.get(activeDisc);

    const handleSwitchVariant = (nextDisc: string): void => {
      const targetSchema = schema.optionsMap.get(nextDisc);
      const nextVal = targetSchema ? buildDefaultValueForZodSchema(targetSchema) : { [discriminator]: nextDisc };
      controller.applyOperations([{ op: 'add', path: basePath, value: nextVal }]);
    };

    return (
      <div className="ui-editor-union" data-field-path={basePath}>
        <div className="ui-editor-union__header">
          <FormField label={`${label} (${discriminator})`}>
            <Select
              value={activeDisc}
              options={optionKeys.map((k) => ({ value: k, label: k }))}
              ariaLabel={`${label} variant`}
              onChange={handleSwitchVariant}
            />
          </FormField>
          {isOptional ? (
            <IconButton
              ariaLabel={`Remove ${label}`}
              variant="danger"
              onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
            >
              ✕
            </IconButton>
          ) : null}
        </div>
        {activeBranch ? (
          <ZodFormRenderer
            controller={controller}
            schema={activeBranch}
            value={value}
            basePath={basePath}
            errors={errors}
            labelOverride={activeDisc}
          />
        ) : null}
      </div>
    );
  }

  const options = schema.options as ReadonlyArray<z.ZodTypeAny>;
  let activeIdx = options.findIndex((opt) => opt.safeParse(value).success);
  if (activeIdx < 0) {
    activeIdx = 0;
  }
  const activeSchema = options[activeIdx]!;

  return (
    <div className="ui-editor-union" data-field-path={basePath}>
      <div className="ui-editor-union__header">
        <FormField label={`${label} Variant`}>
          <Select
            value={String(activeIdx)}
            options={options.map((opt, idx) => ({ value: String(idx), label: describeUnionOption(opt, idx) }))}
            ariaLabel={`${label} variant`}
            onChange={(nextIdxStr) => {
              const target = options[Number(nextIdxStr)];
              if (!target) return;
              controller.applyOperations([{ op: 'add', path: basePath, value: buildDefaultValueForZodSchema(target) }]);
            }}
          />
        </FormField>
        {isOptional ? (
          <IconButton
            ariaLabel={`Remove ${label}`}
            variant="danger"
            onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
          >
            ✕
          </IconButton>
        ) : null}
      </div>
      <ZodFormRenderer
        controller={controller}
        schema={activeSchema}
        value={value}
        basePath={basePath}
        errors={errors}
        labelOverride={label}
      />
    </div>
  );
}
