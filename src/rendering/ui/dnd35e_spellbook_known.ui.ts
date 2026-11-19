/**
 * @file D&D 3.5e Grimoire Known Spells Pane (Milestone 118 / Phase 26).
 * Renders known spells and prayerbooks with prep & spontaneous casting buttons.
 */

import { setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import {
  canPrepareSpellInDomainSlot,
  collectActorDomainSpellIds,
  isActorDomainSpellAtLevel,
  type SpellLevelSlotSummary
} from '../../rulesets/dnd35e/magic/spellbook_slots.ts';
import type {
  DnD35ClassSpellbookState,
  DnD35EntityData,
  DnD35PreparedSlotEntry
} from '../../rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35SpellDefinition, DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { prepareSpellIntoSlot } from '../../rulesets/dnd35e/magic/spellbook_actions.ts';
import { dispatchSpellCastFromLiveUI } from './dnd35e_spell_cast_ui.ts';

/**
 * Renders the right pane showing all known spells grouped by spell level,
 * with context-sensitive "+ Prep" or "Cast" action buttons.
 */
export function renderKnownSpellsPane(
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
  const hasDomainAccess =
    (dndData.domains?.length ?? 0) > 0 &&
    (book.domainSpellSlots !== undefined || summaries.some((s) => s.domainSlots > 0));
  const allSpellIds = new Set<string>(book.knownSpellIds);
  if (hasDomainAccess) {
    for (const spId of collectActorDomainSpellIds(dndData.domains, sys?.domains, spellRegistry)) {
      allSpellIds.add(spId);
    }
  }

  for (const sum of summaries) {
    const spellsAtLevel: DnD35SpellDefinition[] = [];
    for (const id of allSpellIds) {
      const sp = spellRegistry[id];
      if (!sp) continue;
      const clsLvl = sp.levelByClass?.[classId];
      const matchesClass = clsLvl === sum.spellLevel;
      const matchesDomain =
        hasDomainAccess && isActorDomainSpellAtLevel(sp.id, sp, sum.spellLevel, dndData.domains, sys?.domains);
      if (matchesClass || matchesDomain) {
        spellsAtLevel.push(sp);
      }
    }

    if (spellsAtLevel.length === 0) continue;

    const groupHeader = document.createElement('div');
    groupHeader.style.fontWeight = '700';
    groupHeader.style.fontSize = '0.85rem';
    groupHeader.style.color = 'var(--crpg-text-header, #3b2818)';
    groupHeader.style.margin = '10px 0 4px 0';
    groupHeader.textContent = `Level ${sum.spellLevel} Known Spells (${spellsAtLevel.length})`;
    container.appendChild(groupHeader);

    for (const sp of spellsAtLevel) {
      const row = document.createElement('div');
      row.className = 'dnd35-list-item';
      row.style.padding = '6px 8px';
      row.style.margin = '3px 0';
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';

      const left = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = sp.name;
      const schoolBadge = document.createElement('span');
      schoolBadge.className = 'dnd35-badge';
      schoolBadge.style.marginLeft = '6px';
      schoolBadge.textContent = sp.school.toUpperCase();
      left.append(name, schoolBadge);
      row.appendChild(left);

      const right = document.createElement('div');
      right.style.display = 'flex';
      right.style.gap = '4px';

      if (book.castingMode === 'prepared') {
        const slots = book.preparedSlots ?? [];
        const openGenCount = slots.filter(
          (s: DnD35PreparedSlotEntry) =>
            s.spellLevel === sum.spellLevel && s.slotKind === 'general' && !s.preparedSpellId && !s.expended
        ).length;

        const prepBtn = document.createElement('button');
        prepBtn.type = 'button';
        prepBtn.className = 'skill-use-btn';
        prepBtn.textContent = `+ Prep (${openGenCount} open)`;
        prepBtn.disabled = openGenCount <= 0;
        prepBtn.addEventListener('click', () => {
          const next = prepareSpellIntoSlot(state, playerId, classId, sp.id, 'general', sum.spellLevel);
          setGameState(next);
          markAllDomainsDirty();
        });
        right.appendChild(prepBtn);

        // Domain prep button across ALL owned domains (1..N) + Cure/Inflict when Spontaneous Domain Casting is active
        if (hasDomainAccess && sum.domainSlots > 0) {
          const isDomainEligible = canPrepareSpellInDomainSlot(sp.id, sp, sum.spellLevel, dndData, sys, classId);
          if (isDomainEligible) {
            const openDomSlot = slots.find(
              (s: DnD35PreparedSlotEntry) =>
                s.spellLevel === sum.spellLevel && s.slotKind === 'domain' && !s.preparedSpellId && !s.expended
            );
            const domPrepBtn = document.createElement('button');
            domPrepBtn.type = 'button';
            domPrepBtn.className = 'skill-use-btn';
            domPrepBtn.textContent = '+ Prep Domain';
            domPrepBtn.disabled = !openDomSlot;
            domPrepBtn.addEventListener('click', () => {
              const next = prepareSpellIntoSlot(state, playerId, classId, sp.id, 'domain', sum.spellLevel);
              setGameState(next);
              markAllDomainsDirty();
            });
            right.appendChild(domPrepBtn);
          }
        }

        // Specialist prep button
        if (
          sys?.classes?.[classId]?.supportsArcaneSchoolSpecialization === true &&
          sum.specialistSlots > 0 &&
          sp.school === dndData.arcaneSchool
        ) {
          const openSpecSlot = slots.find(
            (s: DnD35PreparedSlotEntry) =>
              s.spellLevel === sum.spellLevel && s.slotKind === 'specialist' && !s.preparedSpellId && !s.expended
          );
          const specPrepBtn = document.createElement('button');
          specPrepBtn.type = 'button';
          specPrepBtn.className = 'skill-use-btn';
          specPrepBtn.textContent = '+ Prep Specialist';
          specPrepBtn.disabled = !openSpecSlot;
          specPrepBtn.addEventListener('click', () => {
            const next = prepareSpellIntoSlot(state, playerId, classId, sp.id, 'specialist', sum.spellLevel);
            setGameState(next);
            markAllDomainsDirty();
          });
          right.appendChild(specPrepBtn);
        }
      } else {
        // Spontaneous casting button
        const used = (book.spontaneousSlotsUsedByLevel ?? {})[String(sum.spellLevel)] ?? 0;
        const remaining = Math.max(0, sum.totalSlots - used);
        const castBtn = document.createElement('button');
        castBtn.type = 'button';
        castBtn.className = 'skill-use-btn';
        castBtn.textContent = `✨ Cast (Uses Lv ${sum.spellLevel})`;
        castBtn.disabled = remaining <= 0;
        castBtn.addEventListener('click', () => {
          dispatchSpellCastFromLiveUI(playerId, {
            classId,
            spellId: sp.id,
            spellLevel: sum.spellLevel
          });
        });
        right.appendChild(castBtn);
      }

      row.appendChild(right);
      container.appendChild(row);
    }
  }
}
