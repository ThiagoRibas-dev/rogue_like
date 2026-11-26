import type { JSX } from 'preact';
import { Button, IconButton } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';
import { dedupeValidationDiagnostics, editorStore, useEditorSelector } from './editor_store.ts';

/**
 * Collapsible bottom validation diagnostics dock listing shallow schema errors and deep audit findings.
 * Clicking any diagnostic expands ancestor accordions and focuses `[data-field-path]`.
 */
export function ValidationDock(): JSX.Element | null {
  const isOpen = useEditorSelector((s) => s.validationDockOpen);
  const errors = useEditorSelector((s) => s.errors);
  const deepReport = useEditorSelector((s) => s.deepReport);
  const isValidatingDeep = useEditorSelector((s) => s.isValidatingDeep);

  if (!isOpen) return null;

  const allIssues = dedupeValidationDiagnostics(errors, deepReport);

  return (
    <section className="ui-editor-validation-dock" aria-label="Campaign Validation Diagnostics">
      <div className="ui-editor-validation-dock__header">
        <div className="ui-editor-row">
          <strong>
            Diagnostics: {allIssues.length} issue{allIssues.length === 1 ? '' : 's'}
          </strong>
          {isValidatingDeep ? <Badge tone="info">Deep checking...</Badge> : null}
        </div>
        <div className="ui-editor-row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const ctrl = editorStore.getSnapshot().controller;
              if (ctrl) void editorStore.runDeepValidation(ctrl.getDocument(), ctrl);
            }}
          >
            Re-run Deep Check
          </Button>
          <IconButton ariaLabel="Close validation dock" onClick={() => editorStore.setValidationDockOpen(false)}>
            ✕
          </IconButton>
        </div>
      </div>

      {allIssues.length === 0 ? (
        <div className="ui-editor-muted">No validation errors or warnings detected.</div>
      ) : (
        <ul className="ui-editor-validation-dock__list">
          {allIssues.map((issue, idx) => (
            <li key={`${issue.path}_${idx}`} className="ui-editor-validation-dock__row">
              <button
                type="button"
                className={`ui-editor-validation-dock__btn is-${issue.severity}`}
                onClick={() => editorStore.navigateToPath(issue.path)}
              >
                <Badge tone={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'info'}>
                  {issue.severity.toUpperCase()}
                </Badge>
                <span className="ui-editor-validation-dock__path">{issue.path || '/'}</span>
                <span className="ui-editor-validation-dock__msg">{issue.message}</span>
                {issue.fixSuggestion ? (
                  <span className="ui-editor-validation-dock__fix">💡 {issue.fixSuggestion}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
