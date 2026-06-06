/**
 * Asserts that a value is not null or undefined.
 * @param value The value to check.
 * @param message Optional error message.
 */
export function assertDefined<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Value is null or undefined");
  }
  return value;
}

/**
 * Helper function for compile-time exhaustiveness checking.
 * @param x The value that should be of type 'never'.
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value: ${x}`);
}
