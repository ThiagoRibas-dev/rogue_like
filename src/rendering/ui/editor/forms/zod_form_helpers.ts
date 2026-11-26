import { z } from 'zod';
import type { ValidationError } from '../../../../editor/validator/validator.types.ts';

/** Result of unwrapping `ZodOptional`, `ZodNullable`, `ZodDefault`, and `ZodEffects`. */
export interface UnwrappedZodSchema {
  readonly inner: z.ZodTypeAny;
  readonly isOptional: boolean;
}

/**
 * Unwraps nested wrapper schemas (`ZodOptional`, `ZodNullable`, `ZodDefault`, `ZodEffects`)
 * while tracking whether the field is optional or nullable.
 */
export function unwrapZodFieldSchema(schema: z.ZodTypeAny): UnwrappedZodSchema {
  let inner = schema;
  let isOptional = false;

  for (;;) {
    if (inner instanceof z.ZodOptional) {
      isOptional = true;
      inner = (inner as z.ZodOptional<z.ZodTypeAny>).unwrap();
      continue;
    }
    if (inner instanceof z.ZodNullable) {
      isOptional = true;
      inner = (inner as z.ZodNullable<z.ZodTypeAny>).unwrap();
      continue;
    }
    if (inner instanceof z.ZodDefault) {
      inner = (inner as z.ZodDefault<z.ZodTypeAny>).removeDefault();
      continue;
    }
    if (inner instanceof z.ZodEffects) {
      inner = (inner as z.ZodEffects<z.ZodTypeAny>).innerType();
      continue;
    }
    break;
  }

  return { inner, isOptional };
}

/**
 * Builds a schema-valid default value when instantiating optional fields, array items,
 * dictionary entries, or discriminated-union variants.
 */
export function buildDefaultValueForZodSchema(schema: z.ZodTypeAny): unknown {
  let current: z.ZodTypeAny = schema;
  for (;;) {
    if (current instanceof z.ZodDefault) {
      return structuredClone((current as z.ZodDefault<z.ZodTypeAny>)._def.defaultValue());
    }
    if (current instanceof z.ZodOptional) {
      current = (current as z.ZodOptional<z.ZodTypeAny>).unwrap();
      continue;
    }
    if (current instanceof z.ZodNullable) {
      current = (current as z.ZodNullable<z.ZodTypeAny>).unwrap();
      continue;
    }
    if (current instanceof z.ZodEffects) {
      current = (current as z.ZodEffects<z.ZodTypeAny>).innerType();
      continue;
    }
    break;
  }

  const inner = current;

  if (inner instanceof z.ZodLiteral) return inner.value;
  if (inner instanceof z.ZodString) return '';
  if (inner instanceof z.ZodNumber) return 0;
  if (inner instanceof z.ZodBoolean) return false;
  if (inner instanceof z.ZodArray) return [];
  if (inner instanceof z.ZodRecord) return {};
  if (inner instanceof z.ZodEnum) {
    const opts = inner.options as ReadonlyArray<string | number>;
    return opts[0] ?? '';
  }
  if (inner instanceof z.ZodTuple) {
    const items = inner.items as ReadonlyArray<z.ZodTypeAny>;
    return items.map((item) => buildDefaultValueForZodSchema(item));
  }
  if (inner instanceof z.ZodDiscriminatedUnion) {
    const options = Array.from(inner.optionsMap.values()) as ReadonlyArray<z.ZodTypeAny>;
    return options[0] ? buildDefaultValueForZodSchema(options[0]) : {};
  }
  if (inner instanceof z.ZodUnion) {
    const options = inner.options as ReadonlyArray<z.ZodTypeAny>;
    return options[0] ? buildDefaultValueForZodSchema(options[0]) : {};
  }
  if (inner instanceof z.ZodObject) {
    const out: Record<string, unknown> = {};
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    for (const [k, prop] of Object.entries(shape)) {
      if (prop instanceof z.ZodDefault) {
        out[k] = buildDefaultValueForZodSchema(prop);
        continue;
      }
      const unwrapped = unwrapZodFieldSchema(prop);
      if (!unwrapped.isOptional) {
        out[k] = buildDefaultValueForZodSchema(prop);
      }
    }
    return out;
  }

  return {};
}

/**
 * Filters validation errors matching exact path or strict descendant paths.
 */
export function collectFieldErrors(
  errors: ReadonlyArray<ValidationError> | undefined,
  basePath: string
): { readonly exact: ReadonlyArray<ValidationError>; readonly descendantCount: number } {
  if (!errors || errors.length === 0) {
    return { exact: [], descendantCount: 0 };
  }
  const exact: ValidationError[] = [];
  let descendantCount = 0;
  const prefix = `${basePath}/`;
  for (const err of errors) {
    if (err.path === basePath) {
      exact.push(err);
    } else if (err.path.startsWith(prefix)) {
      descendantCount += 1;
    }
  }
  return { exact, descendantCount };
}
