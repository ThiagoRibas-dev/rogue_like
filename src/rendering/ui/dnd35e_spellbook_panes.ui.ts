/**
 * @file D&D 3.5e Grimoire Pane Rendering Views (Milestone 118 / Phase 26).
 * Renders prepared slots and spontaneous daily casts matrix.
 */

import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import {
  getSpontaneousConversionTargets,
  type SpellLevelSlotSummary
} from '../../rulesets/dnd35e/magic/spellbook_slots.ts';
import type {
  DnD35ClassSpellbookState,
  DnD35EntityData,
  DnD35PreparedSlotEntry
} from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35SpellDefinition, DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { dispatchSpellCastFromLiveUI } from './dnd35e_spell_cast_ui.ts';
import { unprepareSpecificSlot } from './dnd35e_spellbook_actions.ts';

export function renderPreparedSlotsPane(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  classId: string,
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>,
  spellRegistry: Readonly<Record<string, DnD35SpellDefinition | undefined>>,
  dndData: Partial<DnD35EntityData>,
  sys: DnD35SystemContent | undefined
): void {
  const slots = book.preparedSlots ?? [];

  for (const sum of summaries) {
    const lvlBox = document.createElement('div');
    lvlBox.style.marginBottom = '12px';
    lvlBox.style.border = '1px solid var(--crpg-border-inner, #a69478)';
    lvlBox.style.background = 'var(--crpg-bg-card, rgba(235, 227, 212, 0.96))';
    lvlBox.style.padding = '8px';

    const lvlHeader = document.createElement('div');
    lvlHeader.style.fontWeight = '700';
    lvlHeader.style.fontSize = '0.85rem';
    lvlHeader.style.color = 'var(--crpg-text-header, #3b2818)';
    lvlHeader.style.borderBottom = '1px solid var(--crpg-border-inner, #a69478)';
    lvlHeader.style.paddingBottom = '4px';
    lvlHeader.style.marginBottom = '6px';
    lvlHeader.textContent = `Level ${sum.spellLevel} Slots (Base: ${sum.baseSlots}${sum.bonusSlots > 0 ? ` +${sum.bonusSlots} Ability` : ''}${sum.domainSlots > 0 ? ' +1 Domain' : ''}${sum.specialistSlots > 0 ? ' +1 Specialist' : ''}) • Save DC ${sum.saveDc}`;
    lvlBox.appendChild(lvlHeader);

    const levelSlots = slots.filter((s: DnD35PreparedSlotEntry) => s.spellLevel === sum.spellLevel);
    if (levelSlots.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.fontSize = '0.78rem';
      emptyMsg.style.color = 'var(--crpg-text-muted, #8a7662)';
      emptyMsg.textContent = 'No slots available for this level.';
      lvlBox.appendChild(emptyMsg);
    } else {
      for (const slot of levelSlots) {
        const slotCard = document.createElement('div');
        slotCard.className = 'dnd35-list-item';
        slotCard.style.padding = '6px 8px';
        slotCard.style.margin = '4px 0';
        slotCard.style.display = 'flex';
        slotCard.style.justifyContent = 'space-between';
        slotCard.style.alignItems = 'center';

        const info = document.createElement('div');
        info.style.display = 'flex';
        info.style.alignItems = 'center';
        info.style.gap = '6px';

        const kindBadge = document.createElement('span');
        kindBadge.className = 'dnd35-badge';
        kindBadge.textContent = slot.slotKind.toUpperCase();
        info.appendChild(kindBadge);

        const nameSpan = document.createElement('span');
        nameSpan.style.fontSize = '0.82rem';
        if (slot.preparedSpellId) {
          const spDef = spellRegistry[slot.preparedSpellId];
          nameSpan.textContent = spDef?.name ?? slot.preparedSpellId.replace(/_/g, ' ');
          if (slot.expended) {
            nameSpan.style.textDecoration = 'line-through';
            nameSpan.style.color = 'var(--crpg-text-muted, #8a7662)';
          } else {
            nameSpan.style.fontWeight = '700';
          }
        } else {
          nameSpan.textContent = '— Empty Slot —';
          nameSpan.style.fontStyle = 'italic';
          nameSpan.style.color = 'var(--crpg-text-muted, #8a7662)';
        }
        info.appendChild(nameSpan);
        slotCard.appendChild(info);

        const actions = document.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '4px';

        if (slot.preparedSpellId && !slot.expended) {
          const castBtn = document.createElement('button');
          castBtn.type = 'button';
          castBtn.className = 'skill-use-btn';
          castBtn.textContent = 'Cast';
          castBtn.addEventListener('click', () => {
            dispatchSpellCastFromLiveUI(playerId, {
              classId,
              spellId: slot.preparedSpellId!,
              slotId: slot.slotId,
              spellLevel: slot.spellLevel
            });
          });
          actions.appendChild(castBtn);

          // Spontaneous conversion button for Cleric/Druid on general slots
          if (slot.slotKind === 'general') {
            const convOptions = getSpontaneousConversionTargets(classId, slot.spellLevel, dndData, sys);
            for (const opt of convOptions) {
              const convBtn = document.createElement('button');
              convBtn.type = 'button';
              convBtn.className = 'skill-use-btn';
              convBtn.textContent = `Conv → ${opt.label}`;
              convBtn.addEventListener('click', () => {
                dispatchSpellCastFromLiveUI(playerId, {
                  classId,
                  spellId: slot.preparedSpellId!,
                  slotId: slot.slotId,
                  spellLevel: slot.spellLevel,
                  convertedSpellId: opt.spellId
                });
              });
              actions.appendChild(convBtn);
            }
          }

          const clearBtn = document.createElement('button');
          clearBtn.type = 'button';
          clearBtn.className = 'skill-use-btn';
          clearBtn.textContent = 'Clear ×';
          clearBtn.addEventListener('click', () => {
            const next = unprepareSpecificSlot(state, playerId, classId, slot.slotId);
            setGameState(next);
            markAllDomainsDirty();
          });
          actions.appendChild(clearBtn);
        } else if (slot.expended) {
          const expSpan = document.createElement('span');
          expSpan.style.fontSize = '0.72rem';
          expSpan.style.color = 'var(--crpg-danger, #8b1e1e)';
          expSpan.textContent = 'Expended';
          actions.appendChild(expSpan);
        }

        slotCard.appendChild(actions);
        lvlBox.appendChild(slotCard);
      }
    }

    container.appendChild(lvlBox);
  }
}

export function renderSpontaneousSlotsPane(
  container: HTMLElement,
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>
): void {
  const usedMap = book.spontaneousSlotsUsedByLevel ?? {};

  for (const sum of summaries) {
    const lvlBox = document.createElement('div');
    lvlBox.style.marginBottom = '12px';
    lvlBox.style.border = '1px solid var(--crpg-border-inner, #a69478)';
    lvlBox.style.background = 'var(--crpg-bg-card, rgba(235, 227, 212, 0.96))';
    lvlBox.style.padding = '8px';

    const used = usedMap[String(sum.spellLevel)] ?? 0;
    const remaining = Math.max(0, sum.totalSlots - used);

    const title = document.createElement('div');
    title.style.fontWeight = '700';
    title.style.fontSize = '0.85rem';
    title.style.color = 'var(--crpg-text-header, #3b2818)';
    title.textContent = `Level ${sum.spellLevel}: ${remaining} / ${sum.totalSlots} Casts Remaining (DC ${sum.saveDc})`;
    lvlBox.appendChild(title);

    const pipsRow = document.createElement('div');
    pipsRow.style.display = 'flex';
    pipsRow.style.gap = '4px';
    pipsRow.style.marginTop = '6px';
    for (let i = 0; i < sum.totalSlots; i++) {
      const pip = document.createElement('span');
      pip.textContent = i < remaining ? '💎' : '✖';
      pipsRow.appendChild(pip);
    }
    lvlBox.appendChild(pipsRow);

    container.appendChild(lvlBox);
  }
}
