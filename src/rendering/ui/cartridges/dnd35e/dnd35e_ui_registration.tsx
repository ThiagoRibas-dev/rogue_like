/**
 * @file D&D 3.5e Ruleset UI Adapter (Milestone 163).
 * Registers the D&D 3.5e CartridgeUIDefinition with Preact `ConsoleModalHost` renderers,
 * canonical commands, declarative helpSections, tactical stance handlers, and hotbar routing.
 */

import type { ComponentChildren } from 'preact';
import { createApplyAction } from '../../../../actions/interaction.actions.ts';
import type { Verb } from '../../../../constants/verbs.constants.ts';
import { getComponent } from '../../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../../core/game-loop.ts';
import { openModal } from '../../../../core/modal_manager.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { aggregateProgressionChassis } from '../../../../rulesets/dnd35e/progression.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { DnD35UIAdapter } from '../../../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { ComponentType, type TacticalDoctrineComponent } from '../../../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../../../types/game-state.types.ts';
import { IntentType } from '../../../../types/intents/intent.enum.ts';
import { type CartridgeUIDefinition, registerCartridgeUI } from '../../cartridge_ui_registry.ts';
import { applyDoctrineUpdate, toggleDnD35eActorStance } from '../../dnd35e_doctrine_actions.ts';
import { applyRestActionAsync } from '../../dnd35e_rest_actions.ts';
import { initiateSpellCastFromUI } from '../../dnd35e_spell_cast_ui.ts';
import { triggerQuickBeltSlot } from '../../hud_bottom_dock.ui.ts';
import { DnD35eCharBuilderModal, resetDnD35eCharBuilderDraft } from './DnD35eCharBuilderModal.tsx';
import { canPlayerLevelUpDnD35e, DnD35eLevelUpModal } from './DnD35eLevelUpModal.tsx';
import { DnD35eQuickcastOverlay } from './DnD35eQuickcastOverlay.tsx';
import { DnD35eSheetModal } from './DnD35eSheetModal.tsx';
import { DnD35eSpellbookModal } from './DnD35eSpellbookModal.tsx';

const FIXED_EXPERTISE_CAP = 5;
const dndAdapter = new DnD35UIAdapter();

function renderCharBuilderPreact(state: GameState): ComponentChildren {
  return <DnD35eCharBuilderModal state={state} />;
}

function renderLevelUpPreact(state: GameState): ComponentChildren {
  return <DnD35eLevelUpModal state={state} />;
}

function renderSheetPreact(state: GameState): ComponentChildren {
  return <DnD35eSheetModal state={state} />;
}

function renderSpellbookPreact(state: GameState): ComponentChildren {
  return <DnD35eSpellbookModal state={state} />;
}

function renderQuickcastPreact(state: GameState): ComponentChildren {
  return <DnD35eQuickcastOverlay state={state} />;
}

/**
 * Canonical D&D 3.5e Cartridge UI Definition.
 */
export const dnd35eUIDefinition: CartridgeUIDefinition = {
  rulesetId: 'dnd35e',
  defaultThemeMode: dndAdapter.defaultThemeMode,

  commands: [
    {
      id: 'dnd35e:sheet',
      label: 'Character Sheet',
      description: 'Open or close the D&D 3.5e character sheet.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'c' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    },
    {
      id: 'dnd35e:inventory',
      label: 'Pack & Gear',
      description: 'Open or close inventory and anatomical paperdoll.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'i' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    },
    {
      id: 'dnd35e:quickcast',
      label: 'Quickcast Spells',
      description: 'Open or close the spell quickcast bar.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'z' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    },
    {
      id: 'dnd35e:spellbook',
      label: 'Spellbook',
      description: 'Open or close the Vancian spellbook and preparation slots.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'b' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    },
    {
      id: 'dnd35e:rest_8h',
      label: 'Rest (8 Hours)',
      description: 'Rest for 8 hours to recover HP, daily pools, and prepared spells.',
      category: 'cartridge',
      scopes: ['world_gameplay'],
      defaultBindings: [{ key: 't' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    },
    {
      id: 'dnd35e:level_up',
      label: 'Level Up',
      description: 'Open the level advancement modal when enough XP is earned.',
      category: 'cartridge',
      scopes: ['world_gameplay', 'active_modal'],
      defaultBindings: [{ key: 'u' }],
      preventDefault: true,
      source: 'cartridge:dnd35e'
    }
  ],

  helpSections: [
    {
      id: 'dnd35e_action_economy',
      title: 'D&D 3.5e Turn Budget & 5-ft Step',
      icon: '🎲',
      entries: [
        {
          title: 'Standard, Move, Swift & Full-Round Actions',
          summary:
            'Attacking without moving executes a Full-Round Iterative + Natural Attack routine; toggle 5-ft Step to shift 1 tile without AoOs.'
        },
        {
          title: 'Tactical Doctrines & Stances',
          summary:
            'Toggle Power Attack, Combat Expertise, or Fighting Defensively in the bottom Doctrine Bar to trade attack bonus for damage or AC.'
        }
      ]
    },
    {
      id: 'dnd35e_magic_and_rest',
      title: 'Vancian Spell Preparation & 8-Hour Rest',
      icon: '✨',
      entries: [
        {
          title: 'Spellbook & Metamagic Slots',
          summary:
            'Press B to prepare daily Vancian slots (or apply Metamagic feats), and press Z to cast via Quickcast.'
        },
        {
          title: '8-Hour Camp Rest',
          summary:
            'Press T when safe to rest for 8 hours, recovering HP, daily resource pools, and prepared spell slots.'
        }
      ]
    }
  ],

  onStartNewGame(state: GameState): GameState {
    resetDnD35eCharBuilderDraft(state);
    return openModal(state, UIMode.CartridgeModal, 'char_creation');
  },

  dockCommands: [
    {
      id: 'dnd35e_sheet',
      commandId: 'dnd35e:sheet',
      label: 'Sheet',
      icon: '📜',
      modalId: 'character_sheet',
      defaultKey: 'c'
    },
    {
      id: 'dnd35e_inventory',
      commandId: 'dnd35e:inventory',
      label: 'Pack',
      icon: '🎒',
      modalId: 'character_sheet',
      defaultKey: 'i'
    },
    {
      id: 'dnd35e_quickcast',
      commandId: 'dnd35e:quickcast',
      label: 'Quickcast',
      icon: '⚡',
      modalId: 'quickcast',
      defaultKey: 'z',
      isAvailable: (state: GameState, playerId: EntityId): boolean => {
        const dndData = getDnD35EntityData(state, playerId);
        return Object.keys(dndData.spellbooksByClass ?? {}).length > 0;
      }
    },
    {
      id: 'dnd35e_spellbook',
      commandId: 'dnd35e:spellbook',
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
      id: 'dnd35e_rest_8h',
      commandId: 'dnd35e:rest_8h',
      label: 'Rest (8h)',
      icon: '💤',
      defaultKey: 't',
      onTrigger: (state: GameState, playerId: EntityId): void => {
        void applyRestActionAsync(state, playerId);
      }
    },
    {
      id: 'dnd35e_level_up',
      commandId: 'dnd35e:level_up',
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
    const hotbar = dndAdapter.getHotbarData({ state, entityId: playerId }, 1);
    toggleDnD35eActorStance(state, playerId, stanceId, hotbar.stanceModes);
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
      const verb = (payload.verb ?? getDnD35SystemContent(state.campaign)?.skills?.[payload.id]?.activeVerb) as
        Verb | undefined;
      if (verb) {
        queuePlayerIntent(createApplyAction(playerId, verb, { type: 'self' }));
      }
    } else if (payload.kind === 'ability') {
      queuePlayerIntent({
        type: IntentType.UseAbility,
        entityId: playerId,
        effectId: payload.verb === 'charge' ? 'action:charge' : `pool:${payload.id}`,
        abilityName: slot.label
      });
      markAllDomainsDirty();
    } else if (payload.kind === 'spell' && payload.classId) {
      initiateSpellCastFromUI(state, playerId, {
        classId: payload.classId,
        spellId: payload.id,
        ...(payload.slotId !== undefined ? { slotId: payload.slotId } : {}),
        ...(payload.spellLevel !== undefined ? { spellLevel: payload.spellLevel } : {}),
        ...(payload.convertedSpellId !== undefined ? { convertedSpellId: payload.convertedSpellId } : {})
      });
    }
  },

  modals: {
    char_creation: {
      modalId: 'char_creation',
      overlayElementId: 'char-creation-overlay',
      allowEscapeClose: false,
      renderPreact: renderCharBuilderPreact
    },
    level_up: {
      modalId: 'level_up',
      overlayElementId: 'level-up-overlay',
      allowEscapeClose: true,
      renderPreact: renderLevelUpPreact
    },
    character_sheet: {
      modalId: 'character_sheet',
      overlayElementId: 'dnd35e-sheet-overlay',
      allowEscapeClose: true,
      handlesInventoryHotkeys: true,
      renderPreact: renderSheetPreact
    },
    spellbook: {
      modalId: 'spellbook',
      overlayElementId: 'dnd35e-spellbook-overlay',
      allowEscapeClose: true,
      renderPreact: renderSpellbookPreact
    },
    quickcast: {
      modalId: 'quickcast',
      overlayElementId: 'dnd35e-quickcast-overlay',
      allowEscapeClose: true,
      renderPreact: renderQuickcastPreact
    }
  }
};

/**
 * Registers the D&D 3.5e UI Adapter into the Console Cartridge UI Registry.
 */
export function registerDnD35eUIAdapter(): void {
  registerCartridgeUI(dnd35eUIDefinition);
}
