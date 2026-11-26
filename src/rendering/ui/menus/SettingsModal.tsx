import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAX_LOW_HEALTH_PERCENT, MIN_LOW_HEALTH_PERCENT } from '../../../constants/autopause.constants.ts';
import { getGameState } from '../../../core/game-loop.ts';
import { getCachedSpritePackCatalog, loadSpritePackCatalog } from '../../../core/loader/sprite_pack_loader.ts';
import { closeSettingsModal } from '../../../core/session/session_dom.ts';
import {
  importSaveFromFile,
  triggerReplayDownload,
  triggerSaveExportDownload,
  triggerTelemetryDownload
} from '../../../core/session/session_settings.ts';
import {
  getDebugModeEnabled,
  getSettings,
  resetSettings,
  setDebugModeEnabled,
  updateAutoPause,
  updateSettings
} from '../../../core/settings.ts';
import type { SpritePackCatalog } from '../../../types/campaign.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { DEFAULT_PREFERRED_SPRITE_PACK } from '../../../utils/sprite_pack.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { applyDisplaySettingsUpdate } from '../hud_dock.ui.ts';
import { Button } from '../primitives/Button.tsx';
import { Checkbox, FormField, NumberInput, Select, type SelectOption } from '../primitives/FormControls.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { Panel } from '../primitives/Panel.tsx';
import { type TabItem, Tabs } from '../primitives/Tabs.tsx';
import { applySettingsToDOM } from '../core/apply_settings.ts';
import { getAttributionCardItems, hydrateAttributionContributors } from '../settings_attributions.ts';
import { KeybindMatrix } from './KeybindMatrix.tsx';

const SETTINGS_TABS: ReadonlyArray<TabItem> = [
  { id: 'keybinds', label: 'Keybindings' },
  { id: 'display', label: 'Display & Theme' },
  { id: 'autopause', label: 'RTwP Auto-Pause' },
  { id: 'data', label: 'Save & Telemetry' },
  { id: 'credits', label: 'Credits & Licenses' }
];

const THEME_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'auto', label: 'Auto (Default / Match Game System)' },
  { value: 'obsidian-brass', label: 'Obsidian & Brass (Classic Dark)' },
  { value: 'parchment', label: 'Parchment' },
  { value: 'retro-crt', label: 'Retro Phosphor CRT' }
];

const SCALE_OPTIONS: ReadonlyArray<SelectOption> = [
  { value: 'small', label: 'Compact (90%)' },
  { value: 'normal', label: 'Standard (100%)' },
  { value: 'large', label: 'Large (112%)' }
];

const AUTOPAUSE_SPECS: ReadonlyArray<{
  readonly key:
    | 'pauseOnEnemySpotted'
    | 'pauseOnNemesisSpotted'
    | 'pauseOnLowHealth'
    | 'pauseOnDetrimentalStatus'
    | 'pauseOnNarrative';
  readonly label: string;
}> = [
  { key: 'pauseOnEnemySpotted', label: 'Pause when a hostile actor is spotted' },
  { key: 'pauseOnNemesisSpotted', label: 'Pause when a Nemesis rival is spotted' },
  { key: 'pauseOnLowHealth', label: 'Pause automatically at low health' },
  { key: 'pauseOnDetrimentalStatus', label: 'Pause when afflicted by a detrimental status' },
  { key: 'pauseOnNarrative', label: 'Pause on major narrative & world events' }
];

/** Tabbed Settings & Keybindings Modal (`UIMode.Settings`). */
export function SettingsModal(): JSX.Element | null {
  const gameState = useUiSelector((s) => s.gameState);
  const hasSave = useUiSelector((s) => s.hasSave);
  const initialTab = useUiSelector((s) => s.settingsInitialTab);
  const settingsVersion = useUiSelector((s) => s.settingsVersion);
  void settingsVersion;

  const [activeTab, setActiveTab] = useState<string>('keybinds');
  const [catalog, setCatalog] = useState<SpritePackCatalog | null>(() => getCachedSpritePackCatalog() ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isOpen = gameState?.uiMode === UIMode.Settings;

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab);
      uiStore.setSettingsInitialTab(null);
    }
  }, [isOpen, initialTab]);

  useEffect(() => {
    if (!isOpen) return;
    const cached = getCachedSpritePackCatalog();
    if (cached) {
      setCatalog(cached);
      void hydrateAttributionContributors(cached).then(() => setCatalog({ ...cached }));
    } else {
      void loadSpritePackCatalog().then((loaded) => {
        setCatalog(loaded);
        void hydrateAttributionContributors(loaded).then(() => setCatalog({ ...loaded }));
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const settings = getSettings();
  const spritePackOptions: SelectOption[] = [
    { value: DEFAULT_PREFERRED_SPRITE_PACK, label: 'Auto (Campaign Default)' }
  ];
  if (catalog) {
    for (const pack of catalog.packs) {
      if (pack.selectableInSettings) spritePackOptions.push({ value: pack.id, label: pack.name });
    }
  }
  const attributions = getAttributionCardItems(catalog);
  const hasActiveRun = (gameState?.entities.length ?? 0) > 0;

  return (
    <ModalShell
      title="Settings & Keybindings"
      subtitle="Configure controls, visual themes, accessibility, and RTwP auto-pause"
      size="xl"
      onClose={(): void => closeSettingsModal()}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={(): void => {
              resetSettings();
              applySettingsToDOM();
              try {
                applyDisplaySettingsUpdate(getGameState());
              } catch {
                // No active game state yet
              }
            }}
          >
            Reset All Settings
          </Button>
          <Button variant="primary" size="md" onClick={(): void => closeSettingsModal()}>
            Done
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <Tabs tabs={SETTINGS_TABS} activeTabId={activeTab} onSelectTab={setActiveTab} ariaLabel="Settings sections" />

        {activeTab === 'keybinds' ? <KeybindMatrix /> : null}

        {activeTab === 'display' ? (
          <div className="ui-settings-grid">
            <Panel title="Theme & Accessibility">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <FormField label="Visual Theme" htmlFor="setting-console-theme">
                  <Select
                    id="setting-console-theme"
                    value={settings.accessibility.consoleThemePreference ?? 'auto'}
                    options={THEME_OPTIONS}
                    onChange={(val): void => {
                      updateSettings({
                        accessibility: {
                          ...settings.accessibility,
                          consoleThemePreference: val as 'auto' | 'parchment' | 'retro-crt' | 'obsidian-brass'
                        }
                      });
                      applySettingsToDOM();
                    }}
                  />
                </FormField>
                <FormField label="Interface Scale" htmlFor="setting-ui-scale">
                  <Select
                    id="setting-ui-scale"
                    value={settings.accessibility.uiScale}
                    options={SCALE_OPTIONS}
                    onChange={(val): void => {
                      updateSettings({
                        accessibility: { ...settings.accessibility, uiScale: val as 'small' | 'normal' | 'large' }
                      });
                      applySettingsToDOM();
                    }}
                  />
                </FormField>
                <Checkbox
                  id="setting-high-contrast"
                  checked={settings.accessibility.highContrast}
                  label="High Contrast Mode (WCAG AAA Borders & Text)"
                  onChange={(checked): void => {
                    updateSettings({ accessibility: { ...settings.accessibility, highContrast: checked } });
                    applySettingsToDOM();
                  }}
                />
                <Checkbox
                  id="setting-disable-animations"
                  checked={settings.accessibility.disableAnimations}
                  label="Reduce Motion & Disable UI Animations"
                  onChange={(checked): void => {
                    updateSettings({ accessibility: { ...settings.accessibility, disableAnimations: checked } });
                    applySettingsToDOM();
                  }}
                />
              </div>
            </Panel>

            <Panel title="Viewport & Tactical Feedback">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <FormField label="Preferred Tile Sprite Pack" htmlFor="setting-sprite-pack">
                  <Select
                    id="setting-sprite-pack"
                    value={settings.visualFeedback.preferredSpritePack ?? DEFAULT_PREFERRED_SPRITE_PACK}
                    options={spritePackOptions}
                    onChange={(val): void => {
                      updateSettings({ visualFeedback: { ...settings.visualFeedback, preferredSpritePack: val } });
                      try {
                        applyDisplaySettingsUpdate(getGameState());
                      } catch {
                        // Ignore when no game session active
                      }
                    }}
                  />
                </FormField>
                <Checkbox
                  id="setting-dmg-numbers"
                  checked={settings.visualFeedback.showDamageNumbers}
                  label="Show Floating Damage Numbers"
                  onChange={(checked): void =>
                    updateSettings({ visualFeedback: { ...settings.visualFeedback, showDamageNumbers: checked } })
                  }
                />
                <Checkbox
                  id="setting-status-text"
                  checked={settings.visualFeedback.showStatusText}
                  label="Show Floating Status & Condition Popups"
                  onChange={(checked): void =>
                    updateSettings({ visualFeedback: { ...settings.visualFeedback, showStatusText: checked } })
                  }
                />
                <Checkbox
                  id="setting-danger-telegraphs"
                  checked={settings.visualFeedback.showDangerTelegraphs}
                  label="Show Hazard & AoE Danger Telegraphs"
                  onChange={(checked): void =>
                    updateSettings({ visualFeedback: { ...settings.visualFeedback, showDangerTelegraphs: checked } })
                  }
                />
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'autopause' ? (
          <Panel title="Real-Time with Pause (RTwP) Triggers">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {AUTOPAUSE_SPECS.map((spec) => (
                <Checkbox
                  key={spec.key}
                  checked={settings.autoPause[spec.key]}
                  label={spec.label}
                  onChange={(checked): void => updateAutoPause({ [spec.key]: checked })}
                />
              ))}
              <FormField
                label={`Low Health Auto-Pause Threshold (${MIN_LOW_HEALTH_PERCENT}% – ${MAX_LOW_HEALTH_PERCENT}%)`}
                htmlFor="setting-autopause-threshold"
              >
                <NumberInput
                  id="setting-autopause-threshold"
                  value={settings.autoPause.lowHealthThresholdPercent}
                  min={MIN_LOW_HEALTH_PERCENT}
                  max={MAX_LOW_HEALTH_PERCENT}
                  onChange={(val): void => updateAutoPause({ lowHealthThresholdPercent: val })}
                />
              </FormField>
            </div>
          </Panel>
        ) : null}

        {activeTab === 'data' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Panel title="Save Files, Replay Logs & Diagnostics">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={!hasSave}
                  onClick={(): void => triggerSaveExportDownload()}
                >
                  Export Save JSON
                </Button>
                <Button variant="secondary" size="md" onClick={(): void => fileInputRef.current?.click()}>
                  Import Save JSON
                </Button>
                {hasActiveRun ? (
                  <Button variant="secondary" size="md" onClick={(): void => triggerReplayDownload()}>
                    Download Active Replay
                  </Button>
                ) : null}
                <Button variant="secondary" size="md" onClick={(): void => triggerTelemetryDownload()}>
                  Export Telemetry Snapshot
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  style={{ display: 'none' }}
                  onChange={(e): void => {
                    const target = e.currentTarget;
                    const file = target.files?.[0];
                    if (file) void importSaveFromFile(file).finally(() => (target.value = ''));
                  }}
                />
              </div>
            </Panel>

            <Panel title="Developer & Debug Mode">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Checkbox
                  id="setting-debug-mode"
                  checked={getDebugModeEnabled()}
                  label="Enable Developer Debug Mode (Alt+R Reveal Map, Alt+G God Mode, Alt+E Spawn Entity, Alt+` Telemetry, Omniscient Automap)"
                  onChange={(checked): void => {
                    setDebugModeEnabled(checked);
                  }}
                />
                <span className="ui-field__hint">
                  Disabled by default so regular play never accidentally triggers map reveal or cheat shortcuts.
                </span>
              </div>
            </Panel>
          </div>
        ) : null}

        {activeTab === 'credits' ? (
          <div className="ui-attribution-list">
            {attributions.map((item) => (
              <div key={item.id} className="ui-attribution-card">
                <div className="ui-attribution-title">
                  {item.title} — {item.attribution.license}
                </div>
                <div>Author: {item.attribution.author}</div>
                {item.attribution.notes ? <div>{item.attribution.notes}</div> : null}
                {item.attribution.restrictions && item.attribution.restrictions.length > 0 ? (
                  <ul className="ui-selection-feature-list">
                    {item.attribution.restrictions.map((term, idx) => (
                      <li key={`${item.id}_term_${idx}`}>{term}</li>
                    ))}
                  </ul>
                ) : null}
                <div className="ui-attribution-links">
                  {item.attribution.sourceUrl ? (
                    <a
                      className="ui-attribution-link"
                      href={item.attribution.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Source
                    </a>
                  ) : null}
                  {item.attribution.licenseUrl ? (
                    <a
                      className="ui-attribution-link"
                      href={item.attribution.licenseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      License
                    </a>
                  ) : null}
                </div>
                {item.attribution.contributors && item.attribution.contributors.length > 0 ? (
                  <details>
                    <summary style={{ cursor: 'pointer' }}>
                      Contributors ({item.attribution.contributors.length})
                    </summary>
                    <div style={{ marginTop: '4px' }}>{item.attribution.contributors.join(' · ')}</div>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </ModalShell>
  );
}
