import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { z } from 'zod';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { collapsePath, expandAncestors, isPathExpanded } from '../../../../editor/validation_navigator.ts';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';
import { Accordion } from '../../primitives/Accordion.tsx';
import { Button, IconButton } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { ZodFormRenderer } from './ZodFormRenderer.tsx';
import { buildDefaultValueForZodSchema, collectFieldErrors } from './zod_form_helpers.ts';

/** Runtime-only transient schema properties managed by loaders, hidden from manual editor forms. */
const HIDDEN_TRANSIENT_FORM_KEYS = new Set<string>(['loadedSpritePacks', 'srcBasePath']);

/** Props for `<ZodObjectField />`. */
export interface ZodObjectFieldProps {
  readonly controller: EditorController;
  readonly schema: z.ZodObject<z.ZodRawShape>;
  readonly value: unknown;
  readonly basePath: string;
  readonly label: string;
  readonly isOptional: boolean;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * Collapsible Preact `<Accordion />` object form syncing expansion state with `validation_navigator.ts`.
 */
export function ZodObjectField({
  controller,
  schema,
  value,
  basePath,
  label,
  isOptional,
  errors
}: ZodObjectFieldProps): JSX.Element {
  const isTopLevel = basePath.split('/').filter(Boolean).length <= 2;
  const [, setLocalTick] = useState<number>(0);

  const safeObj = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const { descendantCount, exact } = collectFieldErrors(errors, basePath);
  const totalIssues = descendantCount + exact.length;
  const expanded = isTopLevel ? true : isPathExpanded(basePath);

  const hasGlyphSwatch = 'glyph' in shape && 'fg' in shape && 'bg' in shape;

  return (
    <div className="ui-editor-object" data-field-path={basePath}>
      <Accordion
        title={label}
        expanded={expanded}
        onToggle={(nextExpanded) => {
          if (nextExpanded) {
            expandAncestors(basePath);
          } else {
            collapsePath(basePath);
          }
          setLocalTick((t) => t + 1);
        }}
        badge={totalIssues > 0 ? <Badge tone="danger">{totalIssues}</Badge> : undefined}
        actions={
          isOptional ? (
            <IconButton
              ariaLabel={`Remove optional object ${label}`}
              variant="danger"
              onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
            >
              ✕
            </IconButton>
          ) : undefined
        }
      >
        {hasGlyphSwatch ? (
          <div className="ui-editor-glyph-preview">
            <div
              className="ui-editor-glyph-preview__swatch"
              style={{
                color: typeof safeObj.fg === 'string' ? safeObj.fg : '#ffffff',
                backgroundColor: typeof safeObj.bg === 'string' ? safeObj.bg : '#000000'
              }}
            >
              {(typeof safeObj.glyph === 'string' && safeObj.glyph) || '?'}
            </div>
            <span className="ui-editor-glyph-preview__name">
              {(typeof safeObj.name === 'string' && safeObj.name) ||
                (typeof safeObj.id === 'string' && safeObj.id) ||
                ''}
            </span>
          </div>
        ) : null}

        <div className="ui-editor-object__fields">
          {Object.entries(shape).map(([key, propSchema]) => {
            if (HIDDEN_TRANSIENT_FORM_KEYS.has(key)) return null;
            return (
              <ZodFormRenderer
                key={key}
                controller={controller}
                schema={propSchema}
                value={safeObj[key]}
                basePath={`${basePath}/${key}`}
                errors={errors}
              />
            );
          })}
        </div>
      </Accordion>
    </div>
  );
}

/** Props for `<ZodArrayField />`. */
export interface ZodArrayFieldProps {
  readonly controller: EditorController;
  readonly schema: z.ZodArray<z.ZodTypeAny>;
  readonly value: ReadonlyArray<unknown> | undefined;
  readonly basePath: string;
  readonly label: string;
  readonly isOptional: boolean;
  readonly errors?: ReadonlyArray<ValidationError> | undefined;
}

/**
 * Reorderable Preact array editor with both HTML5 drag/drop and accessible Up/Down reorder buttons.
 */
export function ZodArrayField({
  controller,
  schema,
  value,
  basePath,
  label,
  isOptional,
  errors
}: ZodArrayFieldProps): JSX.Element {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const safeArr = Array.isArray(value) ? value : [];

  const moveItem = (fromIndex: number, toIndex: number): void => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= safeArr.length) return;
    const moved = safeArr[fromIndex];
    controller.applyOperations([
      { op: 'remove', path: `${basePath}/${fromIndex}` },
      { op: 'add', path: `${basePath}/${toIndex}`, value: moved }
    ]);
  };

  const handleAdd = (): void => {
    const defaultItem = buildDefaultValueForZodSchema(schema.element);
    if (!Array.isArray(value)) {
      controller.applyOperations([{ op: 'add', path: basePath, value: [defaultItem] }]);
      return;
    }
    controller.applyOperations([{ op: 'add', path: `${basePath}/${safeArr.length}`, value: defaultItem }]);
  };

  return (
    <fieldset className="ui-editor-array" data-field-path={basePath}>
      <legend className="ui-editor-array__legend">
        <span>
          {label} ({safeArr.length})
        </span>
        {isOptional ? (
          <IconButton
            ariaLabel={`Remove list ${label}`}
            variant="danger"
            onClick={() => controller.applyOperations([{ op: 'remove', path: basePath }])}
          >
            ✕
          </IconButton>
        ) : null}
      </legend>

      <div className="ui-editor-array__items">
        {safeArr.map((item, idx) => (
          <div
            key={`${basePath}_${idx}`}
            className="ui-editor-array__row"
            data-field-path={`${basePath}/${idx}`}
            draggable
            onDragStart={() => setDragIndex(idx)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) {
                moveItem(dragIndex, idx);
                setDragIndex(null);
              }
            }}
          >
            <span className="ui-editor-array__handle" title="Drag to reorder">
              ⠿
            </span>
            <div className="ui-editor-array__item-body">
              <ZodFormRenderer
                controller={controller}
                schema={schema.element}
                value={item}
                basePath={`${basePath}/${idx}`}
                errors={errors}
                labelOverride={`Item #${idx + 1}`}
              />
            </div>
            <div className="ui-editor-array__row-actions">
              <IconButton
                ariaLabel={`Move item ${idx + 1} up`}
                disabled={idx === 0}
                onClick={() => moveItem(idx, idx - 1)}
              >
                ↑
              </IconButton>
              <IconButton
                ariaLabel={`Move item ${idx + 1} down`}
                disabled={idx === safeArr.length - 1}
                onClick={() => moveItem(idx, idx + 1)}
              >
                ↓
              </IconButton>
              <IconButton
                ariaLabel={`Remove item ${idx + 1}`}
                variant="danger"
                onClick={() => controller.applyOperations([{ op: 'remove', path: `${basePath}/${idx}` }])}
              >
                ✕
              </IconButton>
            </div>
          </div>
        ))}
      </div>

      <Button size="sm" variant="secondary" onClick={handleAdd}>
        + Add Item
      </Button>
    </fieldset>
  );
}
