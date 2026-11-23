import { createToggleSettingsAction } from '../../actions/core.actions.ts';
import { createToggleInspectAction } from '../../actions/inspect.actions.ts';
import { createToggleTargetingAction } from '../../actions/targeting.actions.ts';
import { ComponentType } from '../../types/components.types.ts';
import { type GameState, UIMode } from '../../types/game-state.types.ts';
import type { InputScopeId, KeyChord } from '../../types/input.types.ts';
import { getComponent } from '../ecs.ts';
import { queuePlayerIntent } from '../game-loop.ts';
import { getIsPlayingReplay } from '../replay.ts';
import { getCommandBindings } from '../settings.ts';
import { chordFromKeyboardEvent, commandRegistry, matchesChord } from './command_registry.ts';
import { handleGameplayOrTargetingKey } from './gameplay_input.ts';
import { handleModalKey, isModalUIMode } from './modal_input.ts';
import { isEditableEventTarget } from './text_input_guard.ts';

/** Hook contract when listening for a user keybinding capture. */
export interface RebindCaptureHook {
  readonly onCapture: (chord: KeyChord) => void;
  readonly onClear?: (() => void) | undefined;
  readonly onCancel: () => void;
}

/** Hook contract for blocking in-app Alert / Confirm / Prompt dialogs. */
export interface SystemDialogHook {
  readonly isOpen: () => boolean;
  readonly onEscape: () => void;
  readonly onConfirm?: (() => void) | undefined;
}

/** Hook contract for the global contextual F1 Help Overlay. */
export interface HelpOverlayHook {
  readonly isOpen: () => boolean;
  readonly toggle: () => void;
  readonly close: () => void;
  readonly focusSearch?: (() => void) | undefined;
}

/** Hook contract for F6 Keyboard HUD Focus traversal. */
export interface HudFocusHook {
  readonly isActive: () => boolean;
  readonly toggleOrCycle: (reverse: boolean) => void;
  readonly exit: () => void;
  readonly handleKey?: ((event: KeyboardEvent) => boolean) | undefined;
}

/** Hook contract for Campaign Editor workspace shortcuts (`Ctrl+Z`, `Ctrl+S`, `F2`, `Esc`). */
export interface EditorInputHook {
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onSave?: (() => void) | undefined;
  readonly onPlaytest?: (() => void) | undefined;
  readonly onEscape?: (() => void) | undefined;
}

/**
 * Single priority-ordered global keyboard dispatcher across Gameplay, Modals, HUD Focus, Help, Dialogs, and Editor.
 */
export class InputScopeManager {
  private rebindCapture: RebindCaptureHook | null = null;
  private systemDialogHook: SystemDialogHook | null = null;
  private helpOverlayHook: HelpOverlayHook | null = null;
  private hudFocusHook: HudFocusHook | null = null;
  private editorHook: EditorInputHook | null = null;
  private windowListener: ((event: KeyboardEvent) => void) | null = null;

  /** Registers or clears the active key-capture session (Priority 1). */
  public setRebindCapture(hook: RebindCaptureHook | null): void {
    this.rebindCapture = hook;
  }

  /** Registers or clears the active system dialog hook (Priority 2). */
  public setSystemDialogHook(hook: SystemDialogHook | null): void {
    this.systemDialogHook = hook;
  }

  /** Registers or clears the contextual F1 Help overlay hook (Priority 3). */
  public setHelpOverlayHook(hook: HelpOverlayHook | null): void {
    this.helpOverlayHook = hook;
  }

  /** Registers or clears the F6 Keyboard HUD Focus hook (Priority 5). */
  public setHudFocusHook(hook: HudFocusHook | null): void {
    this.hudFocusHook = hook;
  }

  /** Registers or clears the Campaign Editor input hook (Priority 8). */
  public setEditorHook(hook: EditorInputHook | null): void {
    this.editorHook = hook;
  }

  /** Computes active scopes ordered from highest priority to lowest for Help & diagnostics. */
  public getActiveScopes(state: GameState): ReadonlyArray<InputScopeId> {
    if (this.rebindCapture !== null) return ['rebind_capture'];
    if (this.systemDialogHook?.isOpen()) return ['system_dialog'];
    if (this.helpOverlayHook?.isOpen()) return ['help_overlay'];
    if (isModalUIMode(state.uiMode)) return ['active_modal'];
    if (state.uiMode === UIMode.Editor) return ['editor'];
    if (state.uiMode === UIMode.Game) {
      if (this.hudFocusHook?.isActive()) return ['hud_focus'];
      if (state.targetingMode?.active || state.inspectMode?.active) {
        return ['targeting_inspect', 'world_gameplay'];
      }
      return ['world_gameplay'];
    }
    return [];
  }

  /** Returns the primary topmost active scope for contextual Help / HUD badges. */
  public getPrimaryScope(state: GameState): InputScopeId {
    return this.getActiveScopes(state)[0] ?? 'world_gameplay';
  }

  /** Attaches a single global `keydown` listener on `window` backed by `getState`. */
  public attachToWindow(getState: () => GameState): void {
    this.detachFromWindow();
    this.windowListener = (event: KeyboardEvent): void => {
      this.dispatchKeyEvent(event, getState());
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.windowListener);
    }
  }

  /** Detaches the global `window` `keydown` listener. */
  public detachFromWindow(): void {
    if (this.windowListener && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.windowListener);
    }
    this.windowListener = null;
  }

  /** Dispatches a single KeyboardEvent through the 8-tier priority stack and TextInputGuard. */
  public dispatchKeyEvent(event: KeyboardEvent, state: GameState): boolean {
    if (getIsPlayingReplay()) {
      event.preventDefault();
      return true;
    }

    // Priority 1: Keybind capture
    if (this.rebindCapture !== null) {
      return this.handleRebindCapture(event, this.rebindCapture);
    }

    const isTextInput = isEditableEventTarget(event);
    const overrides = getCommandBindings();
    const activeRulesetId = state.campaign?.manifest?.rulesetId;

    // Global F1 Contextual Help toggle (allowInTextInput = true, preventDefault suppresses browser help tab)
    if (this.isCommandBound(event, 'system.toggle_help', overrides, isTextInput, activeRulesetId)) {
      event.preventDefault();
      this.helpOverlayHook?.toggle();
      return true;
    }

    // Priority 2: System Dialog
    if (this.systemDialogHook?.isOpen()) {
      return this.handleSystemDialog(event, this.systemDialogHook, isTextInput, overrides, activeRulesetId);
    }

    // Priority 3: Help Overlay
    if (this.helpOverlayHook?.isOpen()) {
      return this.handleHelpOverlay(event, this.helpOverlayHook, isTextInput, overrides, activeRulesetId);
    }

    // Main Menu / Selection / GameOver overlays manage their own component-local Escape & navigation
    if (
      state.uiMode === UIMode.MainMenu ||
      state.uiMode === UIMode.RulesetSelect ||
      state.uiMode === UIMode.GameOver ||
      state.uiMode === UIMode.CampaignSelect
    ) {
      return false;
    }

    // Priority 8: Campaign Editor workspace
    if (state.uiMode === UIMode.Editor) {
      return this.handleEditorScope(event, isTextInput, overrides, activeRulesetId);
    }

    const playerEntityId = state.entities.find((id) => getComponent(state, id, ComponentType.Player));
    if (playerEntityId === undefined) return false;

    // Priority 4: Active Modal overlay
    if (isModalUIMode(state.uiMode)) {
      if (isTextInput) {
        if (this.isCommandBound(event, 'system.escape_or_pause', overrides, true, activeRulesetId)) {
          event.preventDefault();
          if (state.uiMode === UIMode.VerbMenu) {
            handleModalKey(event, state, playerEntityId);
          } else {
            blurActiveElement();
          }
          return true;
        }
        return false;
      }
      handleModalKey(event, state, playerEntityId);
      return true;
    }

    // Priority 5: Keyboard HUD Focus Mode (F6)
    if (this.hudFocusHook?.isActive()) {
      return this.handleHudFocus(event, this.hudFocusHook, isTextInput, overrides, activeRulesetId);
    }

    if (isTextInput) {
      return false;
    }

    // Enter HUD Focus via F6
    if (this.isCommandBound(event, 'hud.cycle_focus', overrides, false, activeRulesetId)) {
      event.preventDefault();
      this.hudFocusHook?.toggleOrCycle(Boolean(event.shiftKey));
      return true;
    }

    // Priority 6 & 7: Targeting / Inspect Escape -> World Gameplay Escape (Pause/Settings)
    if (this.isCommandBound(event, 'system.escape_or_pause', overrides, false, activeRulesetId)) {
      event.preventDefault();
      if (state.targetingMode?.active) {
        queuePlayerIntent(createToggleTargetingAction(playerEntityId));
      } else if (state.inspectMode?.active) {
        queuePlayerIntent(createToggleInspectAction(playerEntityId));
      } else {
        queuePlayerIntent(createToggleSettingsAction(playerEntityId));
      }
      return true;
    }

    return handleGameplayOrTargetingKey(event, state, playerEntityId);
  }

  private isCommandBound(
    event: KeyboardEvent,
    commandId: string,
    overrides: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    isTextInput: boolean,
    activeRulesetId: string | undefined
  ): boolean {
    const cmd = commandRegistry.getCommand(commandId);
    if (!cmd) return false;
    if (isTextInput && cmd.allowInTextInput !== true) return false;
    if (cmd.source.startsWith('cartridge:') && activeRulesetId && cmd.source !== `cartridge:${activeRulesetId}`) {
      return false;
    }
    const bindings = commandRegistry.getEffectiveBindings(commandId, overrides);
    return bindings.some((chord) => matchesChord(event, chord));
  }

  private handleRebindCapture(event: KeyboardEvent, capture: RebindCaptureHook): boolean {
    event.preventDefault();
    if (event.key === 'Escape' || event.code === 'Escape') {
      capture.onCancel();
      return true;
    }
    if (
      (event.code === 'Backspace' || event.code === 'Delete' || event.key === 'Backspace' || event.key === 'Delete') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey
    ) {
      capture.onClear?.();
      return true;
    }
    const chord = chordFromKeyboardEvent(event);
    if (chord === null) return true;
    capture.onCapture(chord);
    return true;
  }

  private handleSystemDialog(
    event: KeyboardEvent,
    dialogHook: SystemDialogHook,
    isTextInput: boolean,
    overrides: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    activeRulesetId: string | undefined
  ): boolean {
    if (this.isCommandBound(event, 'system.escape_or_pause', overrides, true, activeRulesetId)) {
      event.preventDefault();
      dialogHook.onEscape();
      return true;
    }
    const targetTag = (event.target as { tagName?: string } | null)?.tagName;
    if ((event.key === 'Enter' || event.code === 'Enter') && targetTag !== 'TEXTAREA' && dialogHook.onConfirm) {
      event.preventDefault();
      dialogHook.onConfirm();
      return true;
    }
    return !isTextInput;
  }

  private handleHelpOverlay(
    event: KeyboardEvent,
    helpHook: HelpOverlayHook,
    isTextInput: boolean,
    overrides: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    activeRulesetId: string | undefined
  ): boolean {
    if (this.isCommandBound(event, 'system.escape_or_pause', overrides, true, activeRulesetId)) {
      event.preventDefault();
      helpHook.close();
      return true;
    }
    if (!isTextInput && event.key === '/') {
      event.preventDefault();
      helpHook.focusSearch?.();
      return true;
    }
    return false;
  }

  private handleHudFocus(
    event: KeyboardEvent,
    hudHook: HudFocusHook,
    isTextInput: boolean,
    overrides: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    activeRulesetId: string | undefined
  ): boolean {
    if (this.isCommandBound(event, 'system.escape_or_pause', overrides, true, activeRulesetId)) {
      event.preventDefault();
      hudHook.exit();
      return true;
    }
    if (!isTextInput && this.isCommandBound(event, 'hud.cycle_focus', overrides, false, activeRulesetId)) {
      event.preventDefault();
      hudHook.toggleOrCycle(Boolean(event.shiftKey));
      return true;
    }
    if (hudHook.handleKey?.(event)) {
      return true;
    }
    return false;
  }

  private handleEditorScope(
    event: KeyboardEvent,
    isTextInput: boolean,
    overrides: Readonly<Record<string, ReadonlyArray<KeyChord>>>,
    activeRulesetId: string | undefined
  ): boolean {
    if (isTextInput && this.isCommandBound(event, 'system.escape_or_pause', overrides, true, activeRulesetId)) {
      event.preventDefault();
      blurActiveElement();
      return true;
    }

    const matched = commandRegistry.findMatchingCommand(event, 'editor', overrides, isTextInput, activeRulesetId);
    if (matched) {
      event.preventDefault();
      if (matched.id === 'editor.undo') this.editorHook?.onUndo();
      else if (matched.id === 'editor.redo') this.editorHook?.onRedo();
      else if (matched.id === 'editor.save') this.editorHook?.onSave?.();
      else if (matched.id === 'editor.playtest') this.editorHook?.onPlaytest?.();
      return true;
    }

    if (!isTextInput && this.isCommandBound(event, 'system.escape_or_pause', overrides, false, activeRulesetId)) {
      event.preventDefault();
      this.editorHook?.onEscape?.();
      return true;
    }

    return false;
  }
}

function blurActiveElement(): void {
  if (typeof document === 'undefined') return;
  const active = document.activeElement as { blur?: () => void } | null;
  active?.blur?.();
}

/** Singleton global InputScopeManager instance. */
export const inputScopeManager = new InputScopeManager();
