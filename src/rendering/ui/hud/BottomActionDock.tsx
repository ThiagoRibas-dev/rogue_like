import type { JSX } from 'preact';
import { createWaitAction } from '../../../actions/core.actions.ts';
import { getGameState, queuePlayerIntent } from '../../../core/game-loop.ts';
import { markAllDomainsDirty, markDomainDirty, PresentationDomain } from '../../../core/presentation_queue.ts';
import { EngineMode, type EntityId, type GameState } from '../../../types/game-state.types.ts';
import type { UIHotbarSlot } from '../../../types/ui_adapter.types.ts';
import { getActiveCartridgeUI } from '../cartridge_ui_registry.ts';
import { MAX_HOTBAR_BANKS, uiStore, useUiSelector } from '../core/ui_store.ts';
import { triggerQuickBeltSlot } from '../hud_bottom_dock.ui.ts';
import { Button } from '../primitives/Button.tsx';
import { Chip } from '../primitives/DataDisplay.tsx';
import { Stepper } from '../primitives/Stepper.tsx';

const HOTBAR_SLOT_COUNT = 12;

const EMPTY_HOTBAR_SLOTS: ReadonlyArray<UIHotbarSlot> = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, i) => ({
  slotIndex: i,
  keyLabel: i === 9 ? '0' : i === 10 ? '-' : i === 11 ? '=' : `${i + 1}`,
  label: ''
}));

/** Props for `<BottomActionDock />`. */
export interface BottomActionDockProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly isHudFocused: boolean;
}

/**
 * Bottom-center Tactical Action Dock featuring Cartridge combat stances & numeric steppers,
 * action economy pips, 10-bank hotbar switcher (`uiStore.activeBank`), 12 hotbar slots,
 * and Turn-Based End Turn trigger.
 */
export function BottomActionDock({ state, playerId, isHudFocused }: BottomActionDockProps): JSX.Element {
  const activeBank = useUiSelector((s) => s.activeBank);
  const cartridgeUI = getActiveCartridgeUI(state);
  const hotbarData = cartridgeUI?.getHotbarData ? cartridgeUI.getHotbarData(state, playerId, activeBank) : undefined;

  const stances = hotbarData?.stanceModes ?? [];
  const actionPips = hotbarData?.actionPips ?? [];
  const slots: ReadonlyArray<UIHotbarSlot> =
    hotbarData?.slots && hotbarData.slots.length > 0 ? hotbarData.slots : EMPTY_HOTBAR_SLOTS;

  const handleCycleBank = (delta: number): void => {
    uiStore.cycleActiveBank(delta);
    markDomainDirty(PresentationDomain.HUD);
  };

  const handleExecuteSlot = (slotIndex: number): void => {
    const liveState = getGameState() ?? state;
    if (cartridgeUI?.onExecuteHotbarSlot) {
      cartridgeUI.onExecuteHotbarSlot(liveState, playerId, slotIndex, activeBank);
    } else {
      triggerQuickBeltSlot(liveState, playerId, slotIndex);
    }
    markAllDomainsDirty();
  };

  return (
    <section
      className="ui-bottom-dock ui-hud-interactive ui-hud-zone"
      data-hud-zone="5"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Action Hotbar and Combat Stances"
    >
      {(stances.length > 0 || actionPips.length > 0) && (
        <div className="ui-bottom-dock__top">
          <div className="ui-stance-strip" role="group" aria-label="Combat stances and doctrines">
            {stances.map((stance) => (
              <div
                key={stance.id}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                title={stance.tooltipText}
              >
                <Chip
                  active={stance.isActive}
                  title={stance.tooltipText}
                  onClick={(): void => {
                    const liveState = getGameState() ?? state;
                    if (cartridgeUI?.onToggleStance) {
                      cartridgeUI.onToggleStance(liveState, playerId, stance.id);
                    } else {
                      markDomainDirty(PresentationDomain.HUD);
                    }
                  }}
                >
                  {stance.label}
                </Chip>
                {stance.numericValue !== undefined ? (
                  <Stepper
                    label={stance.label}
                    value={stance.numericValue}
                    min={stance.minNumericValue}
                    max={stance.maxNumericValue}
                    onChange={(nextVal): void => {
                      const delta = nextVal - (stance.numericValue ?? 0);
                      if (delta !== 0 && cartridgeUI?.onStepStance) {
                        cartridgeUI.onStepStance(getGameState() ?? state, playerId, stance.id, delta);
                      }
                    }}
                  />
                ) : null}
              </div>
            ))}
          </div>

          {actionPips.length > 0 ? (
            <div className="ui-action-pips" aria-label="Round action economy">
              {actionPips.map((pip) => (
                <span
                  key={pip.id}
                  className="ui-action-pip"
                  data-available={pip.available ? 'true' : 'false'}
                  title={pip.detailText ?? pip.label}
                >
                  {`${pip.available ? '●' : '○'} ${pip.label}`}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="ui-hotbar-row">
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Button variant="ghost" size="sm" title="Previous Hotbar Bank ([)" onClick={(): void => handleCycleBank(-1)}>
            ◀
          </Button>
          <span
            style={{
              fontFamily: 'var(--ui-font-mono)',
              fontSize: 'var(--ui-font-xs)',
              minWidth: '42px',
              textAlign: 'center'
            }}
            aria-label={`Hotbar bank ${activeBank} of ${MAX_HOTBAR_BANKS}`}
          >
            {`${activeBank}/${MAX_HOTBAR_BANKS}`}
          </span>
          <Button variant="ghost" size="sm" title="Next Hotbar Bank (])" onClick={(): void => handleCycleBank(1)}>
            ▶
          </Button>
        </div>

        <div className="ui-hotbar-grid" role="toolbar" aria-label="Quick action hotbar slots">
          {slots.map((slot) => {
            const tooltip = [slot.tooltipTitle, slot.tooltipDescription].filter(Boolean).join(' — ');
            const remaining = slot.actionPayload?.remainingCount;
            return (
              <button
                key={`hb_${activeBank}_${slot.slotIndex}`}
                type="button"
                className="ui-hotbar-slot"
                data-ready={slot.isDisabled ? 'false' : 'true'}
                data-active={slot.activeToggle ? 'true' : undefined}
                title={tooltip || slot.label || `Slot ${slot.keyLabel}`}
                disabled={!slot.label || slot.isDisabled === true}
                onClick={(): void => handleExecuteSlot(slot.slotIndex)}
              >
                <span className="ui-hotbar-slot__key">{slot.keyLabel}</span>
                <span className="ui-hotbar-slot__label">{slot.label || '—'}</span>
                {remaining !== undefined ? (
                  <span style={{ fontSize: '10px', color: 'var(--ui-accent-primary)' }}>{`×${remaining}`}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        {state.engineMode === EngineMode.TurnBased ? (
          <Button
            variant="primary"
            size="sm"
            className="ui-hotbar-end-turn"
            title="End Turn / Wait (Space)"
            onClick={(): void => queuePlayerIntent(createWaitAction(playerId))}
          >
            End Turn
          </Button>
        ) : null}
      </div>
    </section>
  );
}
