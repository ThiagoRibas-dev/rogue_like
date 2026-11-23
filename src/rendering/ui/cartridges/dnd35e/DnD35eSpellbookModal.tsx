/**
 * @file D&D 3.5e Vancian Spellbook & Grimoire Modal (Milestone 163).
 * Multi-class tabbed grimoire with 8-Hour Rest & declarative `waitTargets`, level filter chips,
 * and SplitPane Prepared/Spontaneous Slots + Known Spells panes.
 */

import type { JSX } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import { CLOCK_PHASE_ICONS } from '../../../../constants/world_clock.constants.ts';
import { getComponent } from '../../../../core/ecs.ts';
import { getGameState, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import {
  computeClassLevelSlotSummaries,
  reconcilePreparedSlots
} from '../../../../rulesets/dnd35e/magic/spellbook_slots.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { getClockPhaseLabel, getEffectiveWorldClockConfig } from '../../../../systems/world_clock.system.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { applyRestActionAsync, applyWaitUntilPhaseAsync } from '../../dnd35e_rest_actions.ts';
import { Button } from '../../primitives/Button.tsx';
import { Chip } from '../../primitives/DataDisplay.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';
import { SplitPane } from '../../primitives/Panel.tsx';
import { type TabItem, Tabs } from '../../primitives/Tabs.tsx';
import { DnD35eSpellbookKnownPane, DnD35eSpellbookSlotsPane } from './DnD35eSpellbookPanes.tsx';

const ALL_LEVELS_FILTER = -1;

/** Props for `<DnD35eSpellbookModal />`. */
export interface DnD35eSpellbookModalProps {
  readonly state: GameState;
}

function RestAndWaitButtons({
  state,
  playerId
}: {
  readonly state: GameState;
  readonly playerId: EntityId;
}): JSX.Element {
  const waitTargets = getEffectiveWorldClockConfig(state).waitTargets ?? ['dawn', 'night'];

  return (
    <div className="ui-dnd-chip-row">
      <Button
        size="sm"
        variant="primary"
        title="Refresh daily spell slots, restore vitality, and advance world time 8 hours"
        onClick={() => {
          void applyRestActionAsync(getGameState() ?? state, playerId, () => {
            markAllDomainsDirty();
          });
        }}
      >
        💤 8-Hour Rest
      </Button>
      {waitTargets.map((targetPhase) => {
        const label = getClockPhaseLabel(state, targetPhase);
        const icon = CLOCK_PHASE_ICONS[targetPhase] ?? '⏳';
        return (
          <Button
            key={targetPhase}
            size="sm"
            title={`Wait until ${label} (blocked when hostiles are visible)`}
            onClick={() => {
              void applyWaitUntilPhaseAsync(getGameState() ?? state, playerId, targetPhase, () => {
                markAllDomainsDirty();
              });
            }}
          >
            {`${icon} Wait until ${label}`}
          </Button>
        );
      })}
    </div>
  );
}

/**
 * Complete Preact D&D 3.5e Vancian Spellbook & Preparation Grimoire modal.
 */
export function DnD35eSpellbookModal({ state }: DnD35eSpellbookModalProps): JSX.Element {
  const [selectedClassId, setSelectedClassId] = useState<string | undefined>(undefined);
  const [levelFilter, setLevelFilter] = useState<number>(ALL_LEVELS_FILTER);

  const handleClose = useCallback((): void => {
    const live = getGameState() ?? state;
    setGameState(closeCartridgeModal(live));
    markAllDomainsDirty();
  }, [state]);

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) {
    return (
      <ModalShell title="Spellbook & Grimoire" size="xl" showHelpHint onClose={handleClose}>
        <div className="ui-dnd-card__sub">No player entity found.</div>
      </ModalShell>
    );
  }

  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const spellRegistry = sys?.spells ?? {};
  const classBooks = dndData.spellbooksByClass ?? {};
  const classIds = Object.keys(classBooks);

  if (classIds.length === 0) {
    return (
      <ModalShell title="Spellbook & Grimoire" size="lg" showHelpHint onClose={handleClose}>
        <div className="ui-dnd-sheet-body">
          <div className="ui-dnd-card__sub">This character possesses no spellcasting classes or grimoires.</div>
          <RestAndWaitButtons state={state} playerId={playerId} />
        </div>
      </ModalShell>
    );
  }

  const activeClassId = selectedClassId && classBooks[selectedClassId] ? selectedClassId : classIds[0]!;
  let activeBook = classBooks[activeClassId]!;
  const summaries = computeClassLevelSlotSummaries(activeBook, dndData, dndData.abilityScores, sys ?? undefined);
  if (activeBook.castingMode === 'prepared') {
    activeBook = {
      ...activeBook,
      preparedSlots: reconcilePreparedSlots(activeBook, summaries, spellRegistry)
    };
  }

  const classTabs: ReadonlyArray<TabItem> = classIds.map((cid) => ({
    id: cid,
    label: `${cid.toUpperCase()} (${classBooks[cid]!.castingMode})`
  }));

  const castableSummaries = summaries.filter((s) => s.canCast);
  const filteredSummaries = castableSummaries.filter(
    (s) => levelFilter === ALL_LEVELS_FILTER || s.spellLevel === levelFilter
  );

  return (
    <ModalShell
      title="Spellbook & Grimoire"
      subtitle={`${activeClassId.toUpperCase()} • ${activeBook.castingMode} spellcasting`}
      size="xl"
      showHelpHint
      onClose={handleClose}
    >
      <div className="ui-dnd-sheet-body">
        <div className="ui-dnd-spellbook-toolbar">
          <Tabs
            tabs={classTabs}
            activeTabId={activeClassId}
            ariaLabel="Spellcasting classes"
            onSelectTab={(id) => {
              setSelectedClassId(id);
              setLevelFilter(ALL_LEVELS_FILTER);
            }}
          />
          <RestAndWaitButtons state={state} playerId={playerId} />
        </div>

        <div className="ui-dnd-chip-row" role="group" aria-label="Filter by spell level">
          <Chip active={levelFilter === ALL_LEVELS_FILTER} onClick={() => setLevelFilter(ALL_LEVELS_FILTER)}>
            All Spell Levels
          </Chip>
          {castableSummaries.map((sum) => (
            <Chip
              key={sum.spellLevel}
              active={levelFilter === sum.spellLevel}
              onClick={() => setLevelFilter(sum.spellLevel)}
            >
              {`Lv ${sum.spellLevel} (${sum.totalSlots} • DC ${sum.saveDc})`}
            </Chip>
          ))}
        </div>

        <SplitPane
          leftWidth="50%"
          left={
            <DnD35eSpellbookSlotsPane
              state={state}
              playerId={playerId}
              classId={activeClassId}
              book={activeBook}
              summaries={filteredSummaries}
              spellRegistry={spellRegistry}
              dndData={dndData}
              sys={sys ?? undefined}
            />
          }
          right={
            <DnD35eSpellbookKnownPane
              state={state}
              playerId={playerId}
              classId={activeClassId}
              book={activeBook}
              summaries={filteredSummaries}
              spellRegistry={spellRegistry}
              dndData={dndData}
              sys={sys ?? undefined}
            />
          }
        />
      </div>
    </ModalShell>
  );
}
