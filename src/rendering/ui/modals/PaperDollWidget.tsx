import type { JSX, TargetedKeyboardEvent, TargetedMouseEvent } from 'preact';
import type { UIAnatomicalSlotDescriptor, UIInventoryItem } from '../../../types/ui_adapter.types.ts';
import { Button } from '../primitives/Button.tsx';

/** Normalized equipment, anatomy, stash, weight, and currency model consumed by PaperDoll and Stash widgets. */
export interface ConsoleInventoryData {
  readonly equippedSlots: Readonly<Record<string, UIInventoryItem | null>>;
  readonly anatomicalSlots?: ReadonlyArray<UIAnatomicalSlotDescriptor> | undefined;
  readonly morphologyLabel?: string | undefined;
  readonly avatarGlyph?: string | undefined;
  readonly activeWeaponSetIndex: number;
  readonly stashItems: ReadonlyArray<UIInventoryItem>;
  readonly currentWeightLbs: number;
  readonly maxWeightLbs: number;
  readonly goldCurrency: number;
  readonly currencyFormatted?: string | undefined;
}

const WEAPON_SET_LABELS: ReadonlyArray<string> = ['I', 'II', 'III', 'IV'];
const MEDIUM_LOAD_RATIO = 0.33;
const PERCENT_SCALE = 100;

const DEFAULT_HUMANOID_TUPLES: ReadonlyArray<readonly [string, string, string, string, 'left' | 'right']> = [
  ['head', 'head', 'Head', '🪖', 'left'],
  ['cloak', 'shoulders', 'Cloak', '🧥', 'left'],
  ['ring_1', 'ring', 'Ring 1', '💍', 'left'],
  ['hands', 'hands', 'Gloves', '🧤', 'left'],
  ['main_hand', 'main_hand', 'Main Hand', '⚔️', 'left'],
  ['ammo', 'ranged', 'Ammo', '🏹', 'left'],
  ['neck', 'neck', 'Neck', '📿', 'right'],
  ['torso', 'torso', 'Armor', '🛡️', 'right'],
  ['waist', 'waist', 'Belt', '🎗️', 'right'],
  ['ring_2', 'ring', 'Ring 2', '💍', 'right'],
  ['feet', 'feet', 'Boots', '🥾', 'right'],
  ['off_hand', 'off_hand', 'Off Hand', '🗡️', 'right']
];

const DEFAULT_HUMANOID_SPEC: ReadonlyArray<Omit<UIAnatomicalSlotDescriptor, 'equippedItem'>> =
  DEFAULT_HUMANOID_TUPLES.map(([slotId, slotType, label, emptyGlyph, rail]) => ({
    slotId,
    slotType,
    label,
    emptyGlyph,
    rail
  }));

/** Props for `<PaperDollWidget />`. */
export interface PaperDollWidgetProps {
  readonly data: ConsoleInventoryData;
  readonly onUnequipItem?: ((slotId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onSelectWeaponSet?: ((setIndex: number) => void) | undefined;
  readonly onInspectItem?: ((item: UIInventoryItem | null, clientX: number, clientY: number) => void) | undefined;
}

/**
 * Reactive Anatomical Paper Doll widget built on semantic keyboard-focusable `<button>` slots,
 * Weapon Sets I–IV switcher, extra-limbs anatomy drawer, encumbrance meter, and `?`/`Alt+I` item examine.
 */
export function PaperDollWidget({
  data,
  onUnequipItem,
  onSelectWeaponSet,
  onInspectItem
}: PaperDollWidgetProps): JSX.Element {
  const slots: ReadonlyArray<UIAnatomicalSlotDescriptor> =
    data.anatomicalSlots && data.anatomicalSlots.length > 0
      ? data.anatomicalSlots
      : DEFAULT_HUMANOID_SPEC.map((s) => ({ ...s, equippedItem: data.equippedSlots[s.slotId] ?? null }));

  const leftSlots = slots.filter((s) => s.rail === 'left');
  const rightSlots = slots.filter((s) => s.rail === 'right');
  const extraLimbs = slots.filter((s) => s.rail === 'extra');
  const avatarGlyph =
    data.avatarGlyph ?? (extraLimbs.length >= 3 ? '🐍' : slots.some((s) => s.suppressed) ? '🐺' : '🤺');

  const maxW = Math.max(1, data.maxWeightLbs);
  const pct = Math.min(PERCENT_SCALE, Math.round((data.currentWeightLbs / maxW) * PERCENT_SCALE));

  const renderSlotButton = (slot: UIAnatomicalSlotDescriptor): JSX.Element => {
    const equipped = slot.equippedItem;
    const title = slot.suppressed
      ? `${slot.label}: Melded / Suppressed`
      : slot.occupiedBySlotId
        ? `${slot.label}: 2H Grip (${slot.occupiedBySlotId})`
        : equipped
          ? `${slot.label}: ${equipped.name} (Click or Enter to Unequip, ? to Examine)`
          : `${slot.label} (${slot.slotType})`;

    const tagText = slot.suppressed ? 'Melded' : slot.occupiedBySlotId ? '2H' : slot.isExtraLimb ? '+Limb' : null;

    const handleKeyDown = (event: TargetedKeyboardEvent<HTMLButtonElement>): void => {
      if (!equipped || !onInspectItem) return;
      if (event.key === '?' || (event.altKey && event.key.toLowerCase() === 'i')) {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onInspectItem(equipped, rect.right, rect.top);
      }
    };

    const handleMouseEnter = (event: TargetedMouseEvent<HTMLButtonElement>): void => {
      if (equipped && onInspectItem) {
        onInspectItem(equipped, event.clientX, event.clientY);
      }
    };

    return (
      <button
        key={slot.slotId}
        type="button"
        className="ui-pd-slot"
        data-equipped={equipped ? 'true' : undefined}
        data-suppressed={slot.suppressed ? 'true' : undefined}
        title={title}
        disabled={slot.suppressed === true}
        onClick={(): void => {
          if (equipped && !slot.suppressed) {
            onUnequipItem?.(slot.slotId, equipped);
          }
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={(): void => onInspectItem?.(null, 0, 0)}
        onBlur={(): void => onInspectItem?.(null, 0, 0)}
        onKeyDown={handleKeyDown}
      >
        <span className="ui-pd-slot__icon" aria-hidden="true">
          {slot.suppressed ? '🔒' : (equipped?.iconUrl ?? slot.emptyGlyph)}
        </span>
        <span className="ui-pd-slot__caption">{equipped ? equipped.name : slot.label}</span>
        {tagText ? <span className="ui-pd-slot__tag">{tagText}</span> : null}
      </button>
    );
  };

  return (
    <div className="ui-paperdoll" aria-label="Anatomical Equipment Paper Doll">
      <div className="ui-paperdoll-body">
        <div className="ui-paperdoll-rail">{leftSlots.map(renderSlotButton)}</div>

        <div className="ui-paperdoll-center">
          <div className="ui-paperdoll-avatar" title={data.morphologyLabel ?? 'Character Silhouette'}>
            {avatarGlyph}
          </div>
          <div className="ui-weapon-sets" role="group" aria-label="Weapon loadouts">
            {WEAPON_SET_LABELS.map((roman, idx) => {
              const setIdx = idx + 1;
              const isActive = data.activeWeaponSetIndex === setIdx;
              return (
                <Button
                  key={roman}
                  variant={isActive ? 'primary' : 'secondary'}
                  size="sm"
                  ariaPressed={isActive}
                  onClick={(): void => onSelectWeaponSet?.(setIdx)}
                >
                  {roman}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="ui-paperdoll-rail">{rightSlots.map(renderSlotButton)}</div>
      </div>

      {extraLimbs.length > 0 ? (
        <div className="ui-extra-limbs">
          <span style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-text-secondary)', fontWeight: 700 }}>
            {`Extra Anatomy & Multi-Limb Slots (${extraLimbs.length})`}
          </span>
          <div className="ui-extra-limbs-grid">{extraLimbs.map(renderSlotButton)}</div>
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div className="ui-stash-footer">
          <span>{`Load: ${data.currentWeightLbs.toFixed(1)} lbs`}</span>
          <span>{`Med ${Math.round(maxW * MEDIUM_LOAD_RATIO)} • Max ${maxW.toFixed(0)} lbs`}</span>
        </div>
        <div className="ui-meter-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="ui-meter-fill ui-meter-fill--xp" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
