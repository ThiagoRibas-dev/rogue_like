import type { JSX } from 'preact';
import { createToggleCartridgeModalAction } from '../../../actions/core.actions.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { markDomainDirty, PresentationDomain } from '../../../core/presentation_queue.ts';
import { type EntityId, type GameState, UIMode } from '../../../types/game-state.types.ts';
import { isEffectiveSpriteMode } from '../../procedural_sprites.ts';
import { getActiveCartridgeUI } from '../cartridge_ui_registry.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { DOCK_COMMANDS, toggleRenderMode } from '../hud_dock.ui.ts';
import { IconButton } from '../primitives/Button.tsx';
import { Keycap } from '../primitives/Keycap.tsx';

/** Props for `<CommandDockCard />`. */
export interface CommandDockCardProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly isHudFocused: boolean;
}

/**
 * Left-stack Command Dock HUD Card with live `<Keycap />` shortcut badges,
 * 2D Tiles vs. ASCII mode switcher, and Cartridge-contributed dock commands.
 */
export function CommandDockCard({ state, playerId, isHudFocused }: CommandDockCardProps): JSX.Element {
  const folded = useUiSelector((s) => Boolean(s.hudFolded['dock']));
  const settingsVersion = useUiSelector((s) => s.settingsVersion);
  void settingsVersion;

  const inSpriteMode = isEffectiveSpriteMode(state.campaign);
  const cartridgeUI = getActiveCartridgeUI(state);
  const cartridgeCommands = (cartridgeUI?.dockCommands ?? []).filter(
    (cmd) => !cmd.isAvailable || cmd.isAvailable(state, playerId)
  );

  return (
    <section
      className="ui-hud-card ui-hud-zone"
      data-hud-zone="2"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Command Dock"
    >
      <div className="ui-hud-card__header">
        <h3 className="ui-hud-card__title">Command Dock</h3>
        <IconButton
          ariaLabel={folded ? 'Expand Command Dock' : 'Fold Command Dock'}
          onClick={(): void => uiStore.toggleHudFolded('dock')}
        >
          {folded ? '▸' : '▾'}
        </IconButton>
      </div>

      {!folded ? (
        <div className="ui-hud-card__body">
          <div className="ui-command-dock-grid">
            <button
              type="button"
              className="ui-dock-btn"
              aria-pressed={inSpriteMode}
              title="Toggle between 2D Pixel Sprites and Classic ASCII"
              onClick={(): void => {
                toggleRenderMode(state);
                markDomainDirty(PresentationDomain.HUD);
              }}
            >
              <span>{inSpriteMode ? '🖼️ 2D Tiles' : '🔤 ASCII'}</span>
              <Keycap fallbackLabel="MODE" />
            </button>

            {DOCK_COMMANDS.map((spec) => {
              const isActive =
                (spec.activeMode !== undefined && state.uiMode === spec.activeMode) ||
                (spec.commandId === 'action.target_toggle' && Boolean(state.targetingMode?.active)) ||
                (spec.commandId === 'action.inspect' && Boolean(state.inspectMode?.active));
              return (
                <button
                  key={spec.id}
                  id={spec.id}
                  type="button"
                  className="ui-dock-btn"
                  aria-pressed={isActive}
                  onClick={(): void => spec.onTrigger(state, playerId)}
                >
                  <span>{`${spec.icon} ${spec.label}`}</span>
                  <Keycap commandId={spec.commandId} fallbackLabel={spec.fallbackBadge} />
                </button>
              );
            })}

            {cartridgeCommands.map((cmd) => {
              const isActive =
                cmd.modalId !== undefined &&
                state.uiMode === UIMode.CartridgeModal &&
                state.activeCartridgeModalId === cmd.modalId;
              return (
                <button
                  key={cmd.id}
                  id={`dock-btn-cartridge-${cmd.id}`}
                  type="button"
                  className="ui-dock-btn"
                  aria-pressed={isActive}
                  onClick={(): void => {
                    if (cmd.onTrigger) {
                      cmd.onTrigger(state, playerId);
                    } else if (cmd.modalId !== undefined) {
                      queuePlayerIntent(createToggleCartridgeModalAction(playerId, cmd.modalId));
                    }
                  }}
                >
                  <span>{`${cmd.icon ?? '✨'} ${cmd.label}`}</span>
                  <Keycap commandId={cmd.commandId ?? cmd.id} fallbackLabel={cmd.defaultKey.toUpperCase()} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
