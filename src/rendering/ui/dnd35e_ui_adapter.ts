/**
 * @file D&D 3.5e Ruleset UI Adapter (Phase 26 / Milestone 118).
 * Bridges headless D&D 3.5e systems with the Console Slot/Modal Host API.
 */

import { createApplyAction } from '../../actions/interaction.actions.ts';
import type { Verb } from '../../constants/verbs.constants.ts';
import { getComponent } from '../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../core/game-loop.ts';
import { openModal } from '../../core/modal_manager.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import { aggregateProgressionChassis, DnD35UIAdapter, getDnD35EntityData } from '../../rulesets/registry.ts';
import { ComponentType, type TacticalDoctrineComponent } from '../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import { type CartridgeUIDefinition, closeCartridgeModal, registerCartridgeUI } from './cartridge_ui_registry.ts';
import { hideConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderDnD35eCharBuilderModal, resetDnD35eCharBuilderDraft } from './dnd35e_char_builder.ui.ts';
import { applyDoctrineUpdate } from './dnd35e_doctrine_actions.ts';
import { canPlayerLevelUpDnD35e, renderDnD35eLevelUpModal } from './dnd35e_level_up.ui.ts';
import { renderDnD35eSheetModal as renderSheetModalImpl } from './dnd35e_sheet.ui.ts';
import { renderDnD35eSpellbookModal as renderSpellbookModalImpl } from './dnd35e_spellbook.ui.ts';
import { unprepareSpellSlot } from './dnd35e_spellbook_actions.ts';
import { triggerQuickBeltSlot } from './hud_bottom_dock.ui.ts';

const FIXED_EXPERTISE_CAP = 5;
const dndAdapter = new DnD35UIAdapter();
let closeListenersBound = false;

const SKILL_VERB_MAP: Readonly<Record<string, Verb>> = {
  search: 'search',
  open_lock: 'unlock',
  disable_device: 'disarm',
  heal: 'heal',
  intimidate: 'intimidate',
  diplomacy: 'persuade'
};

function bindModalCloseButtons(): void {
  if (closeListenersBound) return;
  closeListenersBound = true;
  document.getElementById('btn-close-dnd35e-sheet')?.addEventListener('click', () => {
    hideConsoleItemInspectCard();
    setGameState(closeCartridgeModal(getGameState()));
    markAllDomainsDirty();
  });
  document.getElementById('btn-close-dnd35e-spellbook')?.addEventListener('click', () => {
    setGameState(closeCartridgeModal(getGameState()));
    markAllDomainsDirty();
  });
}

/**
 * Renders the D&D 3.5e Character Sheet overlay modal.
 */
export function renderDnD35eSheetModal(state: GameState): void {
  bindModalCloseButtons();
  const overlay = document.getElementById('dnd35e-sheet-overlay');
  if (!overlay) return;
  const isSheetActive =
    (state.uiMode === UIMode.CartridgeModal &&
      (state.activeCartridgeModalId === 'character_sheet' || state.activeCartridgeModalId === 'inventory')) ||
    state.uiMode === UIMode.Inventory;
  if (!isSheetActive) {
    hideConsoleItemInspectCard();
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  renderSheetModalImpl(state);
}

/**
 * Renders the D&D 3.5e Vancian Spellbook overlay modal.
 */
export function renderDnD35eSpellbookModal(state: GameState): void {
  bindModalCloseButtons();
  const overlay = document.getElementById('dnd35e-spellbook-overlay');
  if (!overlay) return;
  if (state.uiMode !== UIMode.CartridgeModal || state.activeCartridgeModalId !== 'spellbook') {
    overlay.classList.add('hidden');
    return;
  }
  overlay.classList.remove('hidden');
  renderSpellbookModalImpl(state);
}

/**
 * Canonical D&D 3.5e Cartridge UI Definition.
 */
export const dnd35eUIDefinition: CartridgeUIDefinition = {
  rulesetId: 'dnd35e',
  defaultThemeMode: 'parchment',

  onStartNewGame(state: GameState): GameState {
    resetDnD35eCharBuilderDraft(state);
    return openModal(state, UIMode.CartridgeModal, 'char_creation');
  },

  dockCommands: [
    {
      id: 'dnd35e_sheet',
      label: 'Sheet',
      icon: '📜',
      modalId: 'character_sheet',
      defaultKey: 'c'
    },
    {
      id: 'dnd35e_inventory',
      label: 'Pack',
      icon: '🎒',
      modalId: 'character_sheet',
      defaultKey: 'i'
    },
    {
      id: 'dnd35e_spellbook',
      label: 'Spells',
      icon: '✨',
      modalId: 'spellbook',
      defaultKey: 'b',
      isAvailable: (state: GameState, playerId: EntityId): boolean => {
        const dndData = getDnD35EntityData(state, playerId);
        return Object.keys(dndData.spellbooksByClass ?? {}).length > 0;
      }
    },
    {
      id: 'dnd35e_level_up',
      label: 'Level Up',
      icon: '⭐',
      modalId: 'level_up',
      defaultKey: 'u',
      isAvailable: (state: GameState, playerId: EntityId): boolean => canPlayerLevelUpDnD35e(state, playerId)
    }
  ],

  projectHudAlerts(state: GameState, playerId: EntityId) {
    if (canPlayerLevelUpDnD35e(state, playerId)) {
      return [
        {
          label: 'Level Up Available!',
          detail: 'Your hero has acquired enough XP to advance in level. Press [U] to open advancement.',
          severity: 'warning' as const
        }
      ];
    }
    return [];
  },

  getHotbarData: (state, playerId, bank) => dndAdapter.getHotbarData({ state, entityId: playerId }, bank),

  onToggleStance: (state, playerId, stanceId) => {
    const docComp = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
      TacticalDoctrineComponent | undefined;
    const currentPA = docComp?.powerAttackAmount ?? 0;
    const currentCE = docComp?.combatExpertiseAmount ?? 0;
    const currentFD = docComp?.fightingDefensively ?? false;
    const currentTD = docComp?.totalDefense ?? false;
    const currentGrip = docComp?.gripMode ?? 'one_handed';

    if (stanceId === 'power_attack') {
      applyDoctrineUpdate(state, playerId, { powerAttackAmount: currentPA > 0 ? 0 : 1 });
    } else if (stanceId === 'combat_expertise') {
      applyDoctrineUpdate(state, playerId, { combatExpertiseAmount: currentCE > 0 ? 0 : 1 });
    } else if (stanceId === 'fighting_defensively') {
      const nextFD = !currentFD;
      applyDoctrineUpdate(state, playerId, {
        fightingDefensively: nextFD,
        totalDefense: nextFD ? false : currentTD
      });
    } else if (stanceId === 'total_defense') {
      const nextTD = !currentTD;
      applyDoctrineUpdate(state, playerId, {
        totalDefense: nextTD,
        fightingDefensively: nextTD ? false : currentFD
      });
    } else if (stanceId === 'two_handed_grip') {
      applyDoctrineUpdate(state, playerId, {
        gripMode: currentGrip === 'two_handed' ? 'one_handed' : 'two_handed'
      });
    }
  },

  onStepStance: (state, playerId, stanceId, delta) => {
    const dndData = getDnD35EntityData(state, playerId);
    const docComp = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
      TacticalDoctrineComponent | undefined;
    const chassis = aggregateProgressionChassis(dndData.tracks ?? [], 0, dndData.levelAdjustment ?? 0);
    const bab = chassis.totalBab;

    if (stanceId === 'power_attack') {
      const cur = docComp?.powerAttackAmount ?? 0;
      const next = Math.max(0, Math.min(bab, cur + delta));
      applyDoctrineUpdate(state, playerId, {
        powerAttackAmount: next,
        settings: { ...(docComp?.settings ?? {}), power_attack: next, power_attack_dial: next }
      });
    } else if (stanceId === 'combat_expertise') {
      const cur = docComp?.combatExpertiseAmount ?? 0;
      const maxCe = Math.min(FIXED_EXPERTISE_CAP, bab);
      const next = Math.max(0, Math.min(maxCe, cur + delta));
      applyDoctrineUpdate(state, playerId, {
        combatExpertiseAmount: next,
        settings: { ...(docComp?.settings ?? {}), combat_expertise: next, combat_expertise_dial: next }
      });
    } else {
      const cur = (docComp?.settings?.[stanceId] as number | undefined) ?? 0;
      const next = Math.max(0, Math.min(bab, cur + delta));
      applyDoctrineUpdate(state, playerId, {
        settings: { ...(docComp?.settings ?? {}), [stanceId]: next }
      });
    }
  },

  onExecuteHotbarSlot: (state, playerId, slotIndex, bank) => {
    const hotbar = dndAdapter.getHotbarData({ state, entityId: playerId }, bank);
    const slot = hotbar.slots[slotIndex];
    const payload = slot?.actionPayload;
    if (!payload) {
      triggerQuickBeltSlot(state, playerId, slotIndex);
      return;
    }

    if (payload.kind === 'item' && payload.entityId !== undefined) {
      queuePlayerIntent(
        createApplyAction(playerId, 'apply', { type: 'item', itemEntityId: payload.entityId as EntityId })
      );
    } else if (payload.kind === 'skill') {
      const verb = SKILL_VERB_MAP[payload.id];
      if (verb) {
        queuePlayerIntent(createApplyAction(playerId, verb, { type: 'self' }));
      }
    } else if (payload.kind === 'spell' && payload.classId && payload.slotIdx !== undefined) {
      setGameState(unprepareSpellSlot(state, playerId, payload.classId, payload.slotIdx));
    }
  },

  modals: {
    char_creation: {
      modalId: 'char_creation',
      overlayElementId: 'char-creation-overlay',
      allowEscapeClose: false,
      render: renderDnD35eCharBuilderModal
    },
    level_up: {
      modalId: 'level_up',
      overlayElementId: 'level-up-overlay',
      allowEscapeClose: true,
      render: renderDnD35eLevelUpModal
    },
    character_sheet: {
      modalId: 'character_sheet',
      overlayElementId: 'dnd35e-sheet-overlay',
      allowEscapeClose: true,
      render: renderDnD35eSheetModal
    },
    spellbook: {
      modalId: 'spellbook',
      overlayElementId: 'dnd35e-spellbook-overlay',
      allowEscapeClose: true,
      render: renderDnD35eSpellbookModal
    }
  }
};

/**
 * Registers the D&D 3.5e UI Adapter into the Console Cartridge UI Registry.
 */
export function registerDnD35eUIAdapter(): void {
  registerCartridgeUI(dnd35eUIDefinition);
}
