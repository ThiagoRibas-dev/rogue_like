import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { commandRegistry, formatKeyChord } from '../../../core/input/command_registry.ts';
import { inputScopeManager } from '../../../core/input/input_scope_manager.ts';
import { openSettingsModal } from '../../../core/session/session_dom.ts';
import { getBindingsForCommand } from '../../../core/settings.ts';
import { getRuleset } from '../../../rulesets/registry.ts';
import { type GameState, UIMode } from '../../../types/game-state.types.ts';
import type { CommandDefinition, InputScopeId, UIHelpSection } from '../../../types/input.types.ts';
import { getActiveCartridgeUI, getCartridgeUI } from '../cartridge_ui_registry.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, Chip } from '../primitives/DataDisplay.tsx';
import { TextInput } from '../primitives/FormControls.tsx';
import { Keycap } from '../primitives/Keycap.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel } from '../primitives/Panel.tsx';
import { type TabItem, Tabs } from '../primitives/Tabs.tsx';

const HELP_TABS: ReadonlyArray<TabItem> = [
  { id: 'context', label: 'This Screen' },
  { id: 'keybinds', label: 'All Keybinds' },
  { id: 'ruleset', label: 'System Guide' }
];

const HELP_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  movement: 'Movement',
  combat_actions: 'Tactical Actions',
  hotbar: 'Hotbar & Banks',
  panels: 'Menus & Panels',
  cartridge: 'Character & Abilities',
  hud_camera: 'Camera & RTwP',
  navigation: 'UI Navigation',
  system: 'System & Help',
  editor: 'Editor'
};

function describeActiveScreen(state: GameState | null): { readonly title: string; readonly summary: string } {
  if (!state) {
    return {
      title: 'Main Menu',
      summary: 'Use Up/Down arrows or Tab to navigate options, Enter to confirm, and F1 anytime for contextual help.'
    };
  }
  switch (state.uiMode) {
    case UIMode.MainMenu:
      return {
        title: 'Main Menu',
        summary: 'Start a new adventure, continue a saved run, launch the Campaign Editor, or customize keybindings.'
      };
    case UIMode.RulesetSelect:
      return {
        title: 'Ruleset Selection',
        summary:
          'Use Up/Down arrows in the ruleset list to inspect mechanics and default visual themes, then press Enter.'
      };
    case UIMode.CampaignSelect:
      return {
        title: 'Campaign Selection',
        summary: 'Select a campaign with Up/Down arrows or install a custom .zip campaign.'
      };
    case UIMode.Game:
      if (inputScopeManager.getActiveScopes(state).includes('targeting_inspect')) {
        return {
          title: 'Examine / Target Reticle',
          summary:
            'Move the cursor across tiles to inspect actors and hazards. Press Enter/F to confirm or Escape to exit.'
        };
      }
      return {
        title: 'Tactical Gameplay Viewport',
        summary:
          'Move with Arrow keys, Numpad, or WASD/Vi keys. Press F6 to focus HUD cards via keyboard, V for context actions, or X to examine tiles.'
      };
    case UIMode.VerbMenu:
      return {
        title: 'Context Interaction Menu',
        summary:
          'Use Up/Down arrows or number keys 1–9 to choose an interaction verb, Enter to execute, or Escape to cancel.'
      };
    case UIMode.CartridgeModal: {
      const modalLabels: Readonly<Record<string, string>> = {
        char_creation: 'Character Creation',
        character_sheet: 'Character Sheet',
        dossier: 'Character Sheet',
        spellbook: 'Spellbook',
        quickcast: 'Quickcast Spells',
        level_up: 'Level Up'
      };
      const modalTitle =
        (state.activeCartridgeModalId ? modalLabels[state.activeCartridgeModalId] : undefined) ??
        (state.activeCartridgeModalId ? state.activeCartridgeModalId.replace(/_/g, ' ') : 'Character Sheet');
      return {
        title: modalTitle,
        summary:
          'Use Tab to move between panels, Arrow keys to navigate lists/grids, ? or Alt+I to inspect highlighted items, and Escape to close.'
      };
    }
    case UIMode.Editor:
      return {
        title: 'Campaign Editor',
        summary:
          'Author campaigns, maps, dialogues, factions, and simulation tests. Use Undo/Redo, Save, Play Test, or Escape to exit.'
      };
    default:
      return {
        title: `Active Screen (${state.uiMode})`,
        summary: 'Use Tab and Arrow keys to navigate controls, Enter/Space to activate, and Escape to return.'
      };
  }
}

function getFallbackRulesetSections(state: GameState | null, selectedRulesetId: string): ReadonlyArray<UIHelpSection> {
  const rulesetId = state?.campaign?.manifest?.rulesetId ?? (selectedRulesetId === 'dnd35e' ? 'dnd35e' : 'classic');
  const uiDef = (state ? getActiveCartridgeUI(state) : undefined) ?? getCartridgeUI(rulesetId);
  if (uiDef?.helpSections && uiDef.helpSections.length > 0) {
    return uiDef.helpSections;
  }
  const ruleset = getRuleset(rulesetId);
  return [
    {
      id: `${rulesetId}_overview`,
      title: `${ruleset.metadata.badgeIcon} ${ruleset.metadata.name} Overview`,
      entries: ruleset.metadata.features.map((feat, idx) => ({
        title: `Feature ${idx + 1}`,
        summary: feat
      }))
    }
  ];
}

function filterCommandsForScopes(
  commands: ReadonlyArray<CommandDefinition>,
  scopes: ReadonlyArray<InputScopeId>
): ReadonlyArray<CommandDefinition> {
  const scopeSet = new Set<InputScopeId>(scopes);
  return commands.filter((cmd) => cmd.scopes.some((s) => scopeSet.has(s)));
}

/**
 * Contextual and Cartridge-Aware `F1` Help Modal (`HelpOverlayScope`).
 */
export function HelpModal(): JSX.Element | null {
  const helpOpen = useUiSelector((s) => s.helpOpen);
  const gameState = useUiSelector((s) => s.gameState);
  const selectedRulesetId = useUiSelector((s) => s.selectedRulesetId);
  const settingsVersion = useUiSelector((s) => s.settingsVersion);
  void settingsVersion;

  const [activeTab, setActiveTab] = useState<string>('context');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputScopeManager.setHelpOverlayHook({
      isOpen: (): boolean => uiStore.getSnapshot().helpOpen,
      toggle: (): void => {
        const cur = uiStore.getSnapshot().helpOpen;
        uiStore.setHelpOpen(!cur);
      },
      close: (): void => {
        uiStore.setHelpOpen(false);
      },
      focusSearch: (): void => {
        setActiveTab('keybinds');
        searchInputRef.current?.focus();
      }
    });
  }, []);

  if (!helpOpen) {
    return null;
  }

  const activeScopes: ReadonlyArray<InputScopeId> = gameState
    ? inputScopeManager.getActiveScopes(gameState)
    : ['help_overlay', 'active_modal'];
  const allCommands = commandRegistry.getAllCommands();
  const contextCommands = filterCommandsForScopes(allCommands, activeScopes);
  const screenInfo = describeActiveScreen(gameState);
  const rulesetSections = getFallbackRulesetSections(gameState, selectedRulesetId);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredAllCommands = allCommands.filter((cmd) => {
    if (!normalizedQuery) return true;
    const bindings = getBindingsForCommand(cmd.id)
      .map((c) => formatKeyChord(c).toLowerCase())
      .join(' ');
    return (
      cmd.label.toLowerCase().includes(normalizedQuery) ||
      cmd.description.toLowerCase().includes(normalizedQuery) ||
      cmd.category.toLowerCase().includes(normalizedQuery) ||
      bindings.includes(normalizedQuery)
    );
  });

  return (
    <ModalShell
      title="Help & Controls"
      subtitle={screenInfo.title}
      size="lg"
      layer="help"
      showHelpHint={false}
      onClose={(): void => uiStore.setHelpOpen(false)}
      headerActions={
        <Button
          variant="secondary"
          size="sm"
          onClick={(): void => {
            uiStore.setHelpOpen(false);
            openSettingsModal('keybinds');
          }}
        >
          Customize Keybinds
        </Button>
      }
      footer={
        <Button variant="primary" size="sm" onClick={(): void => uiStore.setHelpOpen(false)}>
          Close Help (Esc)
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Tabs tabs={HELP_TABS} activeTabId={activeTab} onSelectTab={setActiveTab} ariaLabel="Help topics" />

        {activeTab === 'context' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Panel
              title={screenInfo.title}
              headerActions={
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {activeScopes.map((scope) => (
                    <Badge key={scope} tone="accent">
                      {scope}
                    </Badge>
                  ))}
                </div>
              }
            >
              <p className="ui-selection-detail-desc">{screenInfo.summary}</p>
            </Panel>
            <div className="ui-help-command-grid" role="list" aria-label="Commands active on this screen">
              {contextCommands.map((cmd) => (
                <div key={cmd.id} className="ui-help-command-card" role="listitem">
                  <div className="ui-keybind-info">
                    <span className="ui-keybind-label">{cmd.label}</span>
                    <span className="ui-keybind-desc">{cmd.description}</span>
                  </div>
                  <Keycap commandId={cmd.id} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'keybinds' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <TextInput
              inputRef={searchInputRef}
              type="search"
              value={searchQuery}
              placeholder="Filter commands by name, category, or key (press / to focus)..."
              ariaLabel="Filter commands"
              onInput={setSearchQuery}
            />
            <div className="ui-help-command-grid" role="list" aria-label="All registered keybindings">
              {filteredAllCommands.map((cmd) => (
                <div key={cmd.id} className="ui-help-command-card" role="listitem">
                  <div className="ui-keybind-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className="ui-keybind-label">{cmd.label}</span>
                      <Chip>{HELP_CATEGORY_LABELS[cmd.category] ?? cmd.category}</Chip>
                    </div>
                    <span className="ui-keybind-desc">{cmd.description}</span>
                  </div>
                  <Keycap commandId={cmd.id} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {activeTab === 'ruleset' ? (
          <div className="ui-help-guide-sections">
            {rulesetSections.map((section) => (
              <Panel key={section.id} title={section.icon ? `${section.icon} ${section.title}` : section.title}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {section.entries.map((entry, idx) => (
                    <div key={`${section.id}_entry_${idx}`}>
                      <div className="ui-keybind-label">{entry.title}</div>
                      <p className="ui-selection-detail-desc">{entry.summary}</p>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
