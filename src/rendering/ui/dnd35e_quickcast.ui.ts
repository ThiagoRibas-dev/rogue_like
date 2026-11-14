/**
 * @file NWN2-Style Floating Quickcast HUD Overlay (`dnd35e_quickcast.ui.ts`).
 * Renders metamagic/spontaneous conversion modifier toggles, collapsible class accordions,
 * 0–9 level spine rows, and school-tinted spell tiles with stacked cast counts.
 */

import { getComponent } from '../../core/ecs.ts';
import { getGameState, setGameState } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  buildDnD35eQuickcastModel,
  type QuickcastModifierToggle,
  type QuickcastSpellTile
} from '../../rulesets/dnd35e/ui/dnd35e_quickcast_model.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { closeCartridgeModal } from './cartridge_ui_registry.ts';
import { initiateSpellCastFromUI } from './dnd35e_spell_cast_ui.ts';

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

const activeModifierIds = new Set<string>();
const collapsedClassIds = new Set<string>();
let closeBound = false;

function toggleModifierId(mod: QuickcastModifierToggle): void {
  const isAlreadyActive = activeModifierIds.has(mod.id);
  if (mod.kind === 'spontaneous_cure' && !isAlreadyActive) {
    activeModifierIds.delete('spontaneous:inflict');
  } else if (mod.kind === 'spontaneous_inflict' && !isAlreadyActive) {
    activeModifierIds.delete('spontaneous:cure');
  }

  if (isAlreadyActive) {
    activeModifierIds.delete(mod.id);
  } else {
    activeModifierIds.add(mod.id);
  }
}

function buildModifierChip(mod: QuickcastModifierToggle, playerId: EntityId): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = mod.isActive ? `quickcast-mod-btn active kind-${mod.kind}` : `quickcast-mod-btn kind-${mod.kind}`;
  btn.title = `${mod.label} (${mod.shortBadge})`;

  const badge = document.createElement('span');
  badge.className = 'quickcast-mod-badge';
  badge.textContent = mod.shortBadge;

  const shortText = document.createElement('span');
  shortText.className = 'quickcast-mod-label';
  shortText.textContent = mod.label.replace(/^Spontaneous:\s*/i, '').replace(/ Spell$/i, '');

  btn.append(badge, shortText);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleModifierId(mod);
    const live = getGameState();
    if (live) renderDnD35eQuickcastModal(live, playerId);
  });
  return btn;
}

function buildSpellTileButton(tile: QuickcastSpellTile, playerId: EntityId): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `quickcast-spell-tile school-${tile.school}${tile.isDisabled ? ' disabled' : ''}`;
  btn.disabled = tile.isDisabled;

  const countLabel = tile.remainingCount < 0 ? '∞' : `${tile.remainingCount}`;
  const metaSuffix = tile.metamagicFeatIds.length > 0 ? ` • Modifiers: ${tile.metamagicFeatIds.join(', ')}` : '';
  btn.title = `${tile.spellName} (Lv ${tile.effectiveSlotLevel}, DC ${tile.saveDc}, Range: ${tile.rangeLabel}, Rem: ${countLabel})${metaSuffix}`;

  const glyph = document.createElement('span');
  glyph.className = 'quickcast-spell-glyph';
  glyph.textContent = SCHOOL_GLYPHS[tile.school] ?? '✨';

  const name = document.createElement('span');
  name.className = 'quickcast-spell-name';
  name.textContent = tile.spellName;

  const countBadge = document.createElement('span');
  countBadge.className = 'quickcast-spell-count';
  countBadge.textContent = countLabel;

  btn.append(glyph, name, countBadge);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const live = getGameState();
    if (!live) return;
    initiateSpellCastFromUI(live, playerId, {
      classId: tile.classId,
      spellId: tile.spellId,
      slotId: tile.slotId,
      spellLevel: tile.effectiveSlotLevel,
      convertedSpellId: tile.convertedSpellId,
      metamagicFeatIds: tile.metamagicFeatIds
    });
  });

  return btn;
}

/**
 * Renders the NWN2-style Quickcast HUD overlay into `#dnd35e-quickcast-body`.
 */
export function renderDnD35eQuickcastModal(state: GameState, explicitPlayerId?: EntityId): void {
  if (!closeBound) {
    closeBound = true;
    document.getElementById('btn-close-dnd35e-quickcast')?.addEventListener('click', () => {
      const live = getGameState();
      if (!live) return;
      setGameState(closeCartridgeModal(live));
      markAllDomainsDirty();
    });
  }

  const body = document.getElementById('dnd35e-quickcast-body');
  if (!body) return;
  body.replaceChildren();

  const liveState = getGameState() ?? state;
  const playerId =
    explicitPlayerId ??
    liveState.entities.find((id) => getComponent(liveState, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return;

  const model = buildDnD35eQuickcastModel(liveState, playerId, {
    activeModifierIds: [...activeModifierIds],
    collapsedClassIds: [...collapsedClassIds]
  });

  if (model.modifiers.length > 0) {
    const tray = document.createElement('div');
    tray.className = 'quickcast-modifier-tray';
    for (const mod of model.modifiers) {
      tray.appendChild(buildModifierChip(mod, playerId));
    }
    body.appendChild(tray);
  }

  if (model.sections.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'status-empty';
    empty.textContent = 'No active spellcasting classes.';
    body.appendChild(empty);
    return;
  }

  const sectionsHost = document.createElement('div');
  sectionsHost.className = 'quickcast-sections';

  for (const sec of model.sections) {
    const secWrap = document.createElement('div');
    secWrap.className = 'quickcast-class-section';

    const headerBtn = document.createElement('button');
    headerBtn.type = 'button';
    headerBtn.className = 'quickcast-class-header';
    headerBtn.textContent = `${sec.isCollapsed ? '+' : '−'} ${sec.className.toUpperCase()} (${sec.castingMode})`;
    headerBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (collapsedClassIds.has(sec.classId)) collapsedClassIds.delete(sec.classId);
      else collapsedClassIds.add(sec.classId);
      const live = getGameState();
      if (live) renderDnD35eQuickcastModal(live, playerId);
    });
    secWrap.appendChild(headerBtn);

    if (!sec.isCollapsed) {
      if (sec.rows.length === 0) {
        const noSpells = document.createElement('div');
        noSpells.className = 'quickcast-empty-row';
        noSpells.textContent = 'No castable spells available (Rest or Memorize in Grimoire [B]).';
        secWrap.appendChild(noSpells);
      } else {
        for (const row of sec.rows) {
          const rowEl = document.createElement('div');
          rowEl.className = 'quickcast-level-row';

          const lvlBadge = document.createElement('div');
          lvlBadge.className = 'quickcast-level-badge';
          lvlBadge.textContent = `${row.spellLevel}`;
          rowEl.appendChild(lvlBadge);

          const tilesGrid = document.createElement('div');
          tilesGrid.className = 'quickcast-tiles-row';
          for (const tile of row.tiles) {
            tilesGrid.appendChild(buildSpellTileButton(tile, playerId));
          }
          rowEl.appendChild(tilesGrid);
          secWrap.appendChild(rowEl);
        }
      }
    }

    sectionsHost.appendChild(secWrap);
  }

  body.appendChild(sectionsHost);
}
