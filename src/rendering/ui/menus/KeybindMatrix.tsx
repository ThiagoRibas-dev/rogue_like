import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { commandRegistry, formatKeyChord } from '../../../core/input/command_registry.ts';
import { inputScopeManager } from '../../../core/input/input_scope_manager.ts';
import {
  applyKeybindPreset,
  clearCommandSlot,
  getBindingsForCommand,
  getCommandBindings,
  getDebugModeEnabled,
  getSettings,
  rebindCommandSlot,
  resetCommandBindings
} from '../../../core/settings.ts';
import type { CommandTier, KeybindPresetId, KeyChord } from '../../../types/input.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, Chip } from '../primitives/DataDisplay.tsx';
import { Select, type SelectOption, TextInput } from '../primitives/FormControls.tsx';
import { Toolbar } from '../primitives/Panel.tsx';

interface CapturingTarget {
  readonly commandId: string;
  readonly label: string;
  readonly slotIndex: number;
}

const CATEGORY_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'all', label: 'All Categories' },
  { value: 'movement', label: 'Movement' },
  { value: 'combat_actions', label: 'Tactical Actions' },
  { value: 'hotbar', label: 'Hotbar & Banks' },
  { value: 'panels', label: 'Menus & Panels' },
  { value: 'cartridge', label: 'Character & Abilities' },
  { value: 'hud_camera', label: 'Camera & RTwP' },
  { value: 'navigation', label: 'UI Navigation' },
  { value: 'system', label: 'System & Help' }
];

const PRESET_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'modern', label: 'Modern Preset (WASD / Arrows / Function Keys)' },
  { value: 'classic_vi', label: 'Classic Vi Preset (HJKL + YUBN)' }
];

const TIER_LABELS: Readonly<Record<CommandTier, string>> = {
  primary: 'Primary',
  secondary: 'Secondary',
  tertiary: 'Tertiary'
};

function isClearKeyChord(chord: KeyChord): boolean {
  const k = (chord.key ?? '').toLowerCase();
  return !chord.ctrl && !chord.alt && !chord.shift && !chord.meta && (k === 'backspace' || k === 'delete');
}

/**
 * Multi-Slot Keybind Editor with category/search filters, preset switching, interactive
 * `RebindCaptureScope` chord listener, and live scope-aware conflict detection.
 */
export function KeybindMatrix(): JSX.Element {
  const settingsVersion = useUiSelector((s) => s.settingsVersion);
  const gameState = useUiSelector((s) => s.gameState);
  const selectedRulesetId = useUiSelector((s) => s.selectedRulesetId);
  void settingsVersion;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [capturing, setCapturing] = useState<CapturingTarget | null>(null);

  useEffect(() => {
    if (!capturing) {
      inputScopeManager.setRebindCapture(null);
      return;
    }
    inputScopeManager.setRebindCapture({
      onCancel: (): void => {
        setCapturing(null);
        inputScopeManager.setRebindCapture(null);
      },
      onCapture: (chord: KeyChord): void => {
        if (isClearKeyChord(chord)) {
          clearCommandSlot(capturing.commandId, capturing.slotIndex);
        } else {
          rebindCommandSlot(capturing.commandId, capturing.slotIndex, chord, false);
        }
        setCapturing(null);
        inputScopeManager.setRebindCapture(null);
      }
    });
    return (): void => {
      inputScopeManager.setRebindCapture(null);
    };
  }, [capturing]);

  const settings = getSettings();
  const activePreset: KeybindPresetId = settings.keybindPreset ?? 'modern';
  const activeRulesetId = gameState?.campaign?.manifest?.rulesetId ?? (selectedRulesetId || undefined);
  const allCommands = commandRegistry.getAllCommands(activeRulesetId);
  const allBindings = getCommandBindings();
  const conflicts = commandRegistry.detectConflicts(allBindings, activeRulesetId);

  const conflictCommandSet = new Set<string>();
  for (const c of conflicts) {
    conflictCommandSet.add(c.commandId);
    conflictCommandSet.add(c.otherCommandId);
  }

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredCommands = allCommands.filter((cmd) => {
    if (categoryFilter !== 'all' && cmd.category !== categoryFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const formattedChords = getBindingsForCommand(cmd.id)
      .map((c) => formatKeyChord(c).toLowerCase())
      .join(' ');
    return (
      cmd.label.toLowerCase().includes(normalizedQuery) ||
      cmd.description.toLowerCase().includes(normalizedQuery) ||
      formattedChords.includes(normalizedQuery)
    );
  });

  const renderSlotButton = (
    commandId: string,
    label: string,
    slotIndex: number,
    chord: KeyChord | undefined
  ): JSX.Element => {
    const isThisCapturing = capturing?.commandId === commandId && capturing.slotIndex === slotIndex;
    const text = isThisCapturing
      ? 'Press key...'
      : chord
        ? formatKeyChord(chord)
        : slotIndex === 0
          ? 'Unbound'
          : '+ Alt Key';

    return (
      <Button
        key={`${commandId}_slot_${slotIndex}`}
        variant={isThisCapturing ? 'primary' : 'secondary'}
        size="sm"
        className="ui-keybind-slot-btn"
        title={`${label} slot ${slotIndex + 1}: ${text}`}
        onClick={(): void => {
          setCapturing({ commandId, label, slotIndex });
        }}
      >
        {text}
      </Button>
    );
  };

  return (
    <div className="ui-keybind-matrix">
      <Toolbar ariaLabel="Keybinding filters and presets">
        <TextInput
          type="search"
          value={searchQuery}
          placeholder="Search commands or keys..."
          ariaLabel="Search commands"
          onInput={setSearchQuery}
        />
        <Select
          value={categoryFilter}
          options={CATEGORY_OPTIONS}
          ariaLabel="Filter by command category"
          onChange={setCategoryFilter}
        />
        <Select
          value={activePreset}
          options={PRESET_OPTIONS}
          ariaLabel="Keymap preset"
          onChange={(val): void => {
            applyKeybindPreset(val as KeybindPresetId);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={(): void => {
            resetCommandBindings(activePreset);
          }}
        >
          Reset Defaults
        </Button>
      </Toolbar>

      {capturing ? (
        <div className="ui-keybind-capture-banner" role="status" aria-live="assertive">
          <span>
            Rebinding <strong>{capturing.label}</strong> (Slot {capturing.slotIndex + 1}) — Press any key combination,{' '}
            <strong>Backspace/Delete</strong> to unbind, or <strong>Esc</strong> to cancel.
          </span>
          <Button variant="secondary" size="sm" onClick={(): void => setCapturing(null)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {conflicts.length > 0 ? (
        <div className="ui-keybind-conflict-banner" role="alert">
          <strong>Keybinding Conflict Detected ({conflicts.length})</strong>
          {conflicts.map((conflict, idx) => (
            <span key={`conflict_${idx}`}>
              [{formatKeyChord(conflict.chord)}] is shared in scope &ldquo;{conflict.scope}&rdquo; by{' '}
              {commandRegistry.getCommand(conflict.commandId)?.label ?? conflict.commandId} &amp;{' '}
              {commandRegistry.getCommand(conflict.otherCommandId)?.label ?? conflict.otherCommandId}
            </span>
          ))}
        </div>
      ) : null}

      <div className="ui-keybind-list" role="list" aria-label="Command keybindings">
        {filteredCommands.map((cmd) => {
          const slots = getBindingsForCommand(cmd.id);
          const hasConflict = conflictCommandSet.has(cmd.id);
          const tier = cmd.tier ?? 'secondary';
          const isDebugLocked = cmd.requiresDebugMode === true && !getDebugModeEnabled();
          return (
            <div
              key={cmd.id}
              className="ui-keybind-row"
              role="listitem"
              data-conflict={hasConflict ? 'true' : undefined}
            >
              <div className="ui-keybind-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span className="ui-keybind-label">{cmd.label}</span>
                  <Badge tone={tier === 'primary' ? 'accent' : 'neutral'}>{TIER_LABELS[tier]}</Badge>
                  {isDebugLocked ? <Badge tone="warning">Debug Mode Off</Badge> : null}
                  {hasConflict ? <Badge tone="warning">Conflict</Badge> : null}
                </div>
                <span className="ui-keybind-desc">{cmd.description}</span>
              </div>
              <div>
                <Chip>{cmd.category}</Chip>
              </div>
              <div className="ui-keybind-slots">
                {renderSlotButton(cmd.id, cmd.label, 0, slots[0])}
                {renderSlotButton(cmd.id, cmd.label, 1, slots[1])}
              </div>
              <div>
                {slots.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    title={`Clear bindings for ${cmd.label}`}
                    onClick={(): void => {
                      clearCommandSlot(cmd.id, 0);
                      clearCommandSlot(cmd.id, 0);
                    }}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
