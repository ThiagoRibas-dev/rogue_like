import type { JSX } from 'preact';
import { z } from 'zod';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { getReferenceOptions } from '../../ui_utils.ts';
import { ZodArrayField, ZodObjectField } from './ZodFormContainers.tsx';
import { AddOptionalFieldButton, MultiSelectTagsField, ZodPrimitiveField } from './ZodFormPrimitives.tsx';
import { ZodRecordEditor } from './ZodRecordEditor.tsx';
import { ZodUnionEditor } from './ZodUnionEditor.tsx';
import { buildDefaultValueForZodSchema, collectFieldErrors, unwrapZodFieldSchema } from './zod_form_helpers.ts';

/** Props for recursive `<ZodFormRenderer />`. */
export interface ZodFormRendererProps {
  readonly controller: EditorController;
  readonly schema: z.ZodTypeAny;
  readonly value: unknown;
  readonly basePath: string;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
  readonly labelOverride?: string | undefined;
}

/**
 * Recursive Preact form generator dispatching any Zod schema node to typed UI primitives,
 * record dictionary editors, discriminated union selectors, or collapsible object accordions.
 */
export function ZodFormRenderer({
  controller,
  schema,
  value,
  basePath,
  errors,
  labelOverride
}: ZodFormRendererProps): JSX.Element {
  const { inner, isOptional } = unwrapZodFieldSchema(schema);
  const key = basePath.split('/').pop() || 'Field';
  const label = labelOverride ?? (inner.description || schema.description || key);
  const hasValue = value !== undefined && value !== null;

  if (isOptional && !hasValue) {
    return (
      <div data-field-path={basePath}>
        <AddOptionalFieldButton
          label={label}
          onClick={() =>
            controller.applyOperations([{ op: 'add', path: basePath, value: buildDefaultValueForZodSchema(inner) }])
          }
        />
      </div>
    );
  }

  if (inner instanceof z.ZodObject) {
    return (
      <ZodObjectField
        controller={controller}
        schema={inner}
        value={value}
        basePath={basePath}
        label={label}
        isOptional={isOptional}
        errors={errors}
      />
    );
  }

  if (inner instanceof z.ZodRecord) {
    return (
      <ZodRecordEditor
        controller={controller}
        schema={inner as z.ZodRecord<z.ZodTypeAny, z.ZodTypeAny>}
        value={value as Record<string, unknown> | undefined}
        basePath={basePath}
        label={label}
        isOptional={isOptional}
        errors={errors}
      />
    );
  }

  if (inner instanceof z.ZodDiscriminatedUnion || inner instanceof z.ZodUnion) {
    return (
      <ZodUnionEditor
        controller={controller}
        schema={
          inner as
            | z.ZodDiscriminatedUnion<string, ReadonlyArray<z.ZodDiscriminatedUnionOption<string>>>
            | z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>
        }
        value={value}
        basePath={basePath}
        label={label}
        isOptional={isOptional}
        errors={errors}
      />
    );
  }

  if (inner instanceof z.ZodArray) {
    if (key.toLowerCase().includes('tag')) {
      const options = getReferenceOptions(key, controller.getDocument(), basePath);
      if (options) {
        return (
          <div data-field-path={basePath}>
            <MultiSelectTagsField
              label={label}
              value={Array.isArray(value) ? (value as string[]) : []}
              options={options}
              onChange={(next) => controller.applyOperations([{ op: 'add', path: basePath, value: next }], true)}
            />
          </div>
        );
      }
    }

    return (
      <ZodArrayField
        controller={controller}
        schema={inner as z.ZodArray<z.ZodTypeAny>}
        value={Array.isArray(value) ? value : undefined}
        basePath={basePath}
        label={label}
        isOptional={isOptional}
        errors={errors}
      />
    );
  }

  const { exact } = collectFieldErrors(errors, basePath);

  return (
    <ZodPrimitiveField
      controller={controller}
      schema={inner}
      value={hasValue ? value : undefined}
      basePath={basePath}
      label={label}
      isOptional={isOptional}
      exactErrors={exact}
    />
  );
}
