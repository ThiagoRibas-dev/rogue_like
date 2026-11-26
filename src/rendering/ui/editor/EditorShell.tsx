import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { inputScopeManager } from '../../../core/input/input_scope_manager.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { EditorActivityBar } from './EditorActivityBar.tsx';
import { EditorSidebar } from './EditorSidebar.tsx';
import { EditorToolbar, launchEditorPlaytest, requestExitEditor } from './EditorToolbar.tsx';
import { EditorWorkspace } from './EditorWorkspace.tsx';
import { NewCampaignModal } from './NewCampaignModal.tsx';
import { ValidationDock } from './ValidationDock.tsx';
import { WhereUsedDrawer } from './WhereUsedDrawer.tsx';
import { editorStore, useEditorSelector } from './editor_store.ts';

/**
 * Top-level Preact Campaign Editor shell mounted in `#ui-root` whenever `uiMode === UIMode.Editor`.
 * Scopes compact density tokens, registers `EditorInputHook`, and hosts resizable workspace panes.
 */
export function EditorShell(): JSX.Element | null {
  const uiMode = useUiSelector((s) => s.gameState?.uiMode);
  const controller = useEditorSelector((s) => s.controller);
  const sidebarCollapsed = useEditorSelector((s) => s.sidebarCollapsed);

  const shellRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef<boolean>(false);

  useEffect(() => {
    if (uiMode !== UIMode.Editor || !controller) {
      inputScopeManager.setEditorHook(null);
      return;
    }

    inputScopeManager.setEditorHook({
      onUndo: () => controller.undo(),
      onRedo: () => controller.redo(),
      onSave: () => {
        void controller.saveWorkspace();
      },
      onPlaytest: () => {
        void launchEditorPlaytest();
      },
      onEscape: () => {
        void requestExitEditor();
      }
    });

    const win = window;
    const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (controller.hasUnsavedChanges()) {
        e.preventDefault();
      }
    };
    win.addEventListener('beforeunload', handleBeforeUnload);

    return (): void => {
      inputScopeManager.setEditorHook(null);
      win.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [uiMode, controller]);

  useEffect(() => {
    const win = window;
    const onMouseMove = (e: MouseEvent): void => {
      if (!isResizingRef.current) return;
      const activityBarWidth =
        shellRef.current?.querySelector('.ui-editor-activity-bar')?.getBoundingClientRect().right ?? 60;
      editorStore.setSidebarWidth(e.clientX - activityBarWidth);
    };
    const onMouseUp = (): void => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        if (typeof document !== 'undefined') {
          document.body.style.cursor = '';
        }
      }
    };
    win.addEventListener('mousemove', onMouseMove);
    win.addEventListener('mouseup', onMouseUp);
    return (): void => {
      win.removeEventListener('mousemove', onMouseMove);
      win.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  if (uiMode !== UIMode.Editor || !controller) {
    return null;
  }

  return (
    <div
      ref={shellRef}
      className="ui-editor-shell"
      data-ui-density="compact"
      role="application"
      aria-label="Campaign Editor"
    >
      <EditorToolbar />
      <div className="ui-editor-body">
        <EditorActivityBar />
        <EditorSidebar />
        <div
          className="ui-editor-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize or collapse category sidebar"
          title="Drag to resize sidebar • Double-click to collapse/expand"
          onMouseDown={(e) => {
            e.preventDefault();
            isResizingRef.current = true;
            document.body.style.cursor = 'col-resize';
          }}
          onDblClick={() => editorStore.setSidebarCollapsed(!sidebarCollapsed)}
        />
        <EditorWorkspace />
        <WhereUsedDrawer />
      </div>
      <ValidationDock />
      <NewCampaignModal />
    </div>
  );
}
