import type { CampaignData } from '../../types/campaign.types.ts';

export interface EditorState {
  activeGroupId: string | null;
  activeTabId: keyof CampaignData | 'simulation' | 'triggerComposer' | null;
  activeItemId: string | null;
  searchFilter: string;
  isInitialized: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
}

export const editorState: EditorState = {
  activeGroupId: 'core',
  activeTabId: 'manifest',
  activeItemId: null,
  searchFilter: '',
  isInitialized: false,
  sidebarWidth: 260,
  sidebarCollapsed: false
};

type StateListener = () => void;
const listeners: StateListener[] = [];

/**
 * Subscribes a callback to change notifications in the editor state.
 * @param listener Callback function triggered when editorState is mutated.
 * @returns An unsubscribe function.
 */
export function subscribeToEditorState(listener: StateListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx > -1) {
      listeners.splice(idx, 1);
    }
  };
}

/**
 * Notifies all subscribed listeners of an editor state change.
 */
export function notifyEditorStateChanged(): void {
  for (const listener of listeners) {
    listener();
  }
}
