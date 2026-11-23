/**
 * @file NWN2-Style Preact Quickcast Overlay (`DnD35eQuickcastOverlay.tsx`, Milestone 163).
 * Renders metamagic & spontaneous conversion toggle chips, collapsible class accordions,
 * 0–9 level spine rows, and school-tinted keyboard-focusable spell tiles.
 */

import type { JSX } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import { getGameState, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import {
  buildDnD35eQuickcastModel,
  type QuickcastModifierToggle,
  type QuickcastSpellTile
} from '../../../../rulesets/dnd35e/ui/dnd35e_quickcast_model.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { initiateSpellCastFromUI } from '../../dnd35e_spell_cast_ui.ts';
import { Accordion } from '../../primitives/Accordion.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';

const SCHOOL_GLYPHS: Readonly<Record<string, string>> = {
  abjuration: '🛡',
  conjuration: '🌀',
  divination: '👁',
  enchantment: '💫',
  evocation: '🔥',
  illusion: '🎭',
  necromancy: '💀',
  transmutation: '⚗',
  universal: '✦'
};

function isSpontaneousModifierKind(kind: QuickcastModifierToggle['kind']): boolean {
  return (
    kind === 'spontaneous_cure' ||
    kind === 'spontaneous_inflict' ||
    kind === 'spontaneous_sna' ||
    kind === 'spontaneous_domain'
  );
}

/** Props for `<DnD35eQuickcastOverlay />`. */
export interface DnD35eQuickcastOverlayProps {
  readonly state: GameState;
}

/**
 * Accessible Preact Quickcast modal overlay with metamagic toggles, class accordions, and spell tiles.
 */
export function DnD35eQuickcastOverlay({ state }: DnD35eQuickcastOverlayProps): JSX.Element {
  const [activeModifierIds, setActiveModifierIds] = useState<ReadonlyArray<string>>([]);
  const [collapsedClassIds, setCollapsedClassIds] = useState<ReadonlyArray<string>>([]);

  const handleClose = useCallback((): void => {
    const live = getGameState() ?? state;
    setGameState(closeCartridgeModal(live));
    markAllDomainsDirty();
  }, [state]);

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    return (
      <ModalShell title="Quickcast Spells" size="lg" showHelpHint onClose={handleClose}>
        <div className="ui-dnd-card__sub">No player entity found.</div>
      </ModalShell>
    );
  }

  const model = buildDnD35eQuickcastModel(state, playerId, {
    activeModifierIds,
    collapsedClassIds
  });

  const handleToggleModifier = (mod: QuickcastModifierToggle): void => {
    setActiveModifierIds((prev) => {
      const exists = prev.includes(mod.id);
      if (exists) {
        return prev.filter((id) => id !== mod.id);
      }
      const base = isSpontaneousModifierKind(mod.kind) ? prev.filter((id) => !id.startsWith('spontaneous:')) : prev;
      return [...base, mod.id];
    });
  };

  const handleToggleClass = (classId: string, expanded: boolean): void => {
    setCollapsedClassIds((prev) => {
      if (expanded) {
        return prev.filter((id) => id !== classId);
      }
      return prev.includes(classId) ? prev : [...prev, classId];
    });
  };

  const handleCastTile = (tile: QuickcastSpellTile, casterId: EntityId): void => {
    const live = getGameState() ?? state;
    initiateSpellCastFromUI(live, casterId, {
      classId: tile.classId,
      spellId: tile.spellId,
      slotId: tile.slotId,
      spellLevel: tile.effectiveSlotLevel,
      convertedSpellId: tile.convertedSpellId,
      metamagicFeatIds: tile.metamagicFeatIds
    });
  };

  return (
    <ModalShell
      title="Quickcast Spells"
      subtitle="Metamagic & Spontaneous Casting"
      size="lg"
      showHelpHint
      onClose={handleClose}
    >
      <div className="ui-dnd-sheet-body">
        {model.modifiers.length > 0 ? (
          <div className="ui-dnd-quickcast-tray" role="group" aria-label="Spellcasting modifiers">
            {model.modifiers.map((mod) => (
              <Chip
                key={mod.id}
                active={mod.isActive}
                title={`${mod.label} (${mod.shortBadge})`}
                onClick={() => handleToggleModifier(mod)}
              >
                {`[${mod.shortBadge}] ${mod.label.replace(/^Spontaneous:\s*/i, '').replace(/ Spell$/i, '')}`}
              </Chip>
            ))}
          </div>
        ) : null}

        {model.sections.length === 0 ? (
          <div className="ui-dnd-card__sub">No active spellcasting classes.</div>
        ) : (
          <div className="ui-dnd-card-list">
            {model.sections.map((sec) => (
              <Accordion
                key={sec.classId}
                title={sec.className.toUpperCase()}
                badge={<Badge tone="info">{sec.castingMode}</Badge>}
                expanded={!sec.isCollapsed}
                onToggle={(expanded) => handleToggleClass(sec.classId, expanded)}
              >
                {sec.rows.length === 0 ? (
                  <div className="ui-dnd-card__sub">
                    No castable spells available (Rest or Memorize in Spellbook [B]).
                  </div>
                ) : (
                  sec.rows.map((row) => (
                    <div key={row.spellLevel} className="ui-dnd-quickcast-level-row">
                      <div className="ui-dnd-quickcast-level-badge" aria-label={`Spell level ${row.spellLevel}`}>
                        {row.spellLevel}
                      </div>
                      <div className="ui-dnd-quickcast-tiles">
                        {row.tiles.map((tile) => {
                          const countLabel = tile.remainingCount < 0 ? '∞' : `${tile.remainingCount}`;
                          const metaSuffix =
                            tile.metamagicFeatIds.length > 0 ? ` • Modifiers: ${tile.metamagicFeatIds.join(', ')}` : '';
                          const title = `${tile.spellName} (Lv ${tile.effectiveSlotLevel}, DC ${tile.saveDc}, Range: ${tile.rangeLabel}, Rem: ${countLabel})${metaSuffix}`;
                          return (
                            <button
                              key={`${tile.classId}_${tile.spellId}_${tile.slotId ?? tile.effectiveSlotLevel}_${tile.convertedSpellId ?? ''}`}
                              type="button"
                              disabled={tile.isDisabled}
                              title={title}
                              className={`ui-dnd-quickcast-tile ui-dnd-quickcast-tile--${tile.school}`}
                              onClick={() => handleCastTile(tile, playerId)}
                            >
                              <span aria-hidden="true">{SCHOOL_GLYPHS[tile.school] ?? '✨'}</span>
                              <span>{tile.spellName}</span>
                              <span className="ui-dnd-quickcast-count">{countLabel}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </Accordion>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
