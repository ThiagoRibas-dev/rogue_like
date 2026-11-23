import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { getComponent } from '../../../core/ecs.ts';
import { inputScopeManager } from '../../../core/input/input_scope_manager.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { ComponentType } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { HUD_FOCUS_ZONE_COUNT, uiStore, useUiSelector } from '../core/ui_store.ts';
import { queryFocusableElements } from '../primitives/focus_hooks.ts';
import { AlertsStack } from './AlertsStack.tsx';
import { BottomActionDock } from './BottomActionDock.tsx';
import { ChronicleLogCard } from './ChronicleLogCard.tsx';
import { ChronosStrip } from './ChronosStrip.tsx';
import { CommandDockCard } from './CommandDockCard.tsx';
import { TacticalScannerCard } from './TacticalScannerCard.tsx';
import { VitalsCard } from './VitalsCard.tsx';

/**
 * Root Tactical Floating HUD shell mounted inside `<AppUiRoot />`.
 * Wires `F6` Keyboard HUD Focus traversal (`HudFocusScope`) across all 6 HUD landmark zones
 * while keeping pointer-events transparent over the ROT.js canvas viewport.
 */
export function HudRoot(): JSX.Element | null {
  const gameState = useUiSelector((s) => s.gameState);
  const hudVersion = useUiSelector((s) => s.domainVersions[PresentationDomain.HUD]);
  const logVersion = useUiSelector((s) => s.domainVersions[PresentationDomain.Log]);
  const hudFocusZone = useUiSelector((s) => s.hudFocusZone);
  void hudVersion;
  void logVersion;

  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const focusZoneElement = (zoneIndex: number): void => {
      const container = rootRef.current?.querySelector<HTMLElement>(`[data-hud-zone="${zoneIndex}"]`);
      if (!container) return;
      const focusables = queryFocusableElements(container);
      const first = focusables[0];
      if (first) {
        first.focus();
      } else {
        container.focus();
      }
    };

    inputScopeManager.setHudFocusHook({
      isActive: (): boolean => uiStore.getSnapshot().hudFocusZone !== null,
      toggleOrCycle: (reverse: boolean): void => {
        const cur = uiStore.getSnapshot().hudFocusZone;
        let next: number;
        if (cur === null) {
          next = reverse ? HUD_FOCUS_ZONE_COUNT - 1 : 0;
        } else {
          next = (cur + (reverse ? -1 : 1) + HUD_FOCUS_ZONE_COUNT) % HUD_FOCUS_ZONE_COUNT;
        }
        uiStore.setHudFocusZone(next);
        focusZoneElement(next);
      },
      exit: (): void => {
        uiStore.setHudFocusZone(null);
        const active = document.activeElement as HTMLElement | null;
        if (active && rootRef.current?.contains(active)) {
          active.blur();
        }
      }
    });

    return (): void => {
      inputScopeManager.setHudFocusHook(null);
    };
  }, []);

  if (!gameState) return null;

  const isPlayVisible =
    gameState.uiMode === UIMode.Game ||
    gameState.uiMode === UIMode.VerbMenu ||
    gameState.uiMode === UIMode.CartridgeModal ||
    gameState.uiMode === UIMode.Inventory ||
    gameState.uiMode === UIMode.Quests ||
    gameState.uiMode === UIMode.Factions ||
    gameState.uiMode === UIMode.Investigation ||
    gameState.uiMode === UIMode.Dossier ||
    gameState.uiMode === UIMode.Ledger ||
    gameState.uiMode === UIMode.Dialogue ||
    gameState.uiMode === UIMode.Trade ||
    gameState.uiMode === UIMode.Debug;

  if (!isPlayVisible) {
    return null;
  }

  const playerId = gameState.entities.find((id) => getComponent(gameState, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    return null;
  }

  return (
    <div ref={rootRef} className="ui-hud-layer" data-hud-focus-active={hudFocusZone !== null ? 'true' : undefined}>
      <ChronosStrip state={gameState} playerId={playerId} isHudFocused={hudFocusZone === 0} />

      <div className="ui-hud-body">
        <div className="ui-hud-stack ui-hud-stack--left">
          <VitalsCard state={gameState} playerId={playerId} isHudFocused={hudFocusZone === 1} />
          <CommandDockCard state={gameState} playerId={playerId} isHudFocused={hudFocusZone === 2} />
        </div>

        <div className="ui-hud-stack ui-hud-stack--right">
          <AlertsStack state={gameState} playerId={playerId} />
          <TacticalScannerCard isHudFocused={hudFocusZone === 3} />
          <ChronicleLogCard state={gameState} isHudFocused={hudFocusZone === 4} />
        </div>
      </div>

      {gameState.uiMode === UIMode.Game ? (
        <BottomActionDock state={gameState} playerId={playerId} isHudFocused={hudFocusZone === 5} />
      ) : null}
    </div>
  );
}
