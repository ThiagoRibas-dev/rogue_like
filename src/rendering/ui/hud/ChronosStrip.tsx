import type { JSX } from 'preact';
import {
  createAdjustCameraZAction,
  createSetRTwPSpeedAction,
  createSetZoomLevelAction,
  createToggle3DAction,
  createToggleEngineModeAction,
  createTogglePauseAction,
  createToggleRotatedAction,
  createToggleSettingsAction
} from '../../../actions/core.actions.ts';
import { ZOOM_STEP_DELTA } from '../../../constants/display.constants.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { getMapZBounds, isMultiZMap } from '../../../map/map_accessor.ts';
import { formatWorldClockShort, resolveAreaEnvironmentProfile } from '../../../systems/world_clock.system.ts';
import { ComponentType, type PositionComponent } from '../../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import { uiStore } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge } from '../primitives/DataDisplay.tsx';

/** Props for `<ChronosStrip />`. */
export interface ChronosStripProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly isHudFocused: boolean;
}

/**
 * Top-center Tactical Chronos Strip showing current area, danger rating, world clock,
 * player coordinates, TB/RTwP controls, camera view toggles, and HUD fold toggle.
 */
export function ChronosStrip({ state, playerId, isHudFocused }: ChronosStripProps): JSX.Element {
  const currentArea = state.campaign.areas[state.currentAreaId];
  const areaName = currentArea?.name ?? state.currentAreaId;
  const danger = currentArea?.dangerRating;
  const dangerLabel = typeof danger === 'number' && danger > 0 ? `DANGER ${danger}` : 'SANCTUARY';

  const env = resolveAreaEnvironmentProfile(state);
  const envLabel =
    env.environmentType === 'outdoors' ? 'Outdoors' : env.environmentType === 'underground' ? 'Underground' : 'Indoors';
  const clockText = `${formatWorldClockShort(env.clock)} • ${envLabel}`;
  const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent | undefined;
  const multiZ = isMultiZMap(state.map);
  const playerZ = pos?.z ?? 0;
  const zOffset = state.cameraZOffset ?? 0;
  const viewZ = playerZ + zOffset;
  const zBounds = multiZ ? getMapZBounds(state.map) : undefined;

  return (
    <header
      className="ui-chronos-strip ui-hud-interactive ui-hud-zone"
      data-hud-zone="0"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Chronos and camera controls"
    >
      <span className="ui-chronos-area">{areaName}</span>
      <Badge tone={typeof danger === 'number' && danger > 0 ? 'warning' : 'success'}>{dangerLabel}</Badge>
      <Badge tone="neutral">{clockText}</Badge>
      {pos ? (
        <Badge tone={zOffset !== 0 ? 'warning' : 'neutral'}>
          {multiZ
            ? zOffset !== 0
              ? `X:${pos.x} Y:${pos.y} Z:${playerZ} (View:${viewZ})`
              : `X:${pos.x} Y:${pos.y} Z:${playerZ}`
            : `X:${pos.x} Y:${pos.y}`}
        </Badge>
      ) : null}
      {multiZ && zBounds ? (
        <>
          <Button
            variant="ghost"
            size="sm"
            title="Peek Camera Down Z (PageDown / ])"
            onClick={(): void => queuePlayerIntent(createAdjustCameraZAction(playerId, -1))}
          >
            Z−
          </Button>
          {zOffset !== 0 ? (
            <Button
              variant="secondary"
              size="sm"
              title="Reset Camera Z to Player Level (Home)"
              onClick={(): void => queuePlayerIntent(createAdjustCameraZAction(playerId, 0, true))}
            >
              Z0
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            title="Peek Camera Up Z (PageUp / [)"
            onClick={(): void => queuePlayerIntent(createAdjustCameraZAction(playerId, 1))}
          >
            Z+
          </Button>
        </>
      ) : null}

      <div className="ui-chronos-divider" />

      <Button
        variant={state.engineMode === EngineMode.RTwP ? 'primary' : 'secondary'}
        size="sm"
        title="Toggle Turn-Based vs Real-Time with Pause (Backspace)"
        onClick={(): void => queuePlayerIntent(createToggleEngineModeAction(playerId))}
      >
        {state.engineMode === EngineMode.TurnBased ? 'Turn-Based' : 'RTwP'}
      </Button>

      {state.engineMode === EngineMode.RTwP ? (
        <>
          <Button
            variant={state.rtwpState.paused ? 'danger' : 'secondary'}
            size="sm"
            title="Toggle Tactical Pause (Space)"
            onClick={(): void => queuePlayerIntent(createTogglePauseAction(playerId))}
          >
            {state.rtwpState.paused ? '▶ Paused' : '⏸ Playing'}
          </Button>
          {([1, 2, 4] as const).map((spd) => (
            <Button
              key={spd}
              variant={state.rtwpState.speedMultiplier === spd ? 'primary' : 'ghost'}
              size="sm"
              ariaPressed={state.rtwpState.speedMultiplier === spd}
              onClick={(): void => queuePlayerIntent(createSetRTwPSpeedAction(playerId, spd))}
            >
              {`${spd}x`}
            </Button>
          ))}
        </>
      ) : null}

      <div className="ui-chronos-divider" />

      <Button
        variant={state.isRotated ? 'primary' : 'ghost'}
        size="sm"
        ariaPressed={state.isRotated}
        title="Toggle 45° Isometric Rotation"
        onClick={(): void => queuePlayerIntent(createToggleRotatedAction(playerId))}
      >
        45°
      </Button>
      <Button
        variant={state.is3D ? 'primary' : 'ghost'}
        size="sm"
        ariaPressed={state.is3D}
        title="Toggle 3D Perspective Tilt"
        onClick={(): void => queuePlayerIntent(createToggle3DAction(playerId))}
      >
        3D
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Zoom Out (-)"
        onClick={(): void => queuePlayerIntent(createSetZoomLevelAction(playerId, -ZOOM_STEP_DELTA))}
      >
        −
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Zoom In (+)"
        onClick={(): void => queuePlayerIntent(createSetZoomLevelAction(playerId, ZOOM_STEP_DELTA))}
      >
        +
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Fold or Unfold All HUD Panels (\)"
        onClick={(): void => uiStore.toggleHudFolded()}
      >
        ⊟ HUD
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title="Open Settings & Keybindings (Esc)"
        onClick={(): void => queuePlayerIntent(createToggleSettingsAction(playerId))}
      >
        ⚙️
      </Button>
    </header>
  );
}
