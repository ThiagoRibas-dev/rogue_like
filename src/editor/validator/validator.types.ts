/**
 * Describes a campaign verification warning or error containing pathway keys and details.
 */
export interface ValidationError {
  readonly path: string;
  readonly message: string;
  readonly severity: 'error' | 'warning';
}

/**
 * Detailed report containing lists of errors and warnings.
 */
export interface ValidationReport {
  readonly errors: ReadonlyArray<ValidationError>;
  readonly warnings: ReadonlyArray<ValidationError>;
}
