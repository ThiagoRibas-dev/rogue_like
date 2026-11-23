import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { createToggleInvestigationAction } from '../../../actions/core.actions.ts';
import {
  INVESTIGATION_EMPTY_CLUES,
  INVESTIGATION_EMPTY_CLUES_FILTERED,
  INVESTIGATION_EMPTY_SUSPECTS,
  INVESTIGATION_EMPTY_SUSPECTS_FILTERED,
  INVESTIGATION_FILTERS,
  getInvestigationFilter,
  type InvestigationFilterDefinition,
  type InvestigationFilterId
} from '../../../constants/investigation_filter.constants.ts';
import { getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import {
  ComponentType,
  type Component,
  type FighterComponent,
  type KnowledgeItem,
  type MemoryComponent
} from '../../../types/components.types.ts';
import { type EntityId, type GameState, UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, Chip } from '../primitives/DataDisplay.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

function getSuspectComponents(state: GameState, actorId: EntityId): Readonly<Record<string, Component>> | undefined {
  const active = state.components.get(actorId);
  if (active !== undefined) return active;
  return state.persistentEntities.get(actorId)?.components;
}

function matchesSuspectFilter(state: GameState, actorId: EntityId, filter: InvestigationFilterDefinition): boolean {
  if (!filter.filtersSuspects || filter.suspectComponent === undefined) return true;
  const comps = getSuspectComponents(state, actorId);
  return comps !== undefined && comps[filter.suspectComponent] !== undefined;
}

function matchesKnowledgeFilter(item: KnowledgeItem | undefined, filter: InvestigationFilterDefinition): boolean {
  if (filter.id === 'all') return true;
  if (item === undefined) return false;
  if (filter.knowledgeTypes.includes(item.type)) return true;
  return item.tags.some((tag) => filter.knowledgeTags.includes(tag));
}

/**
 * Investigation Board modal showing identified Suspects and Discovered Clues,
 * filterable via declarative `INVESTIGATION_FILTERS` chips.
 */
export function InvestigationModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  const [filterId, setFilterId] = useState<InvestigationFilterId>('all');
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Investigation) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const filter = getInvestigationFilter(filterId);
  const memory = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent | undefined;

  const allSuspects = state.investigation.knownActors;
  const visibleSuspects = allSuspects.filter((id) => matchesSuspectFilter(state, id, filter));

  const allClues = memory ? Object.entries(memory.knowledge).map(([clueId, item]) => ({ clueId, item })) : [];
  const visibleClues = allClues.filter((clue) => !filter.filtersClues || matchesKnowledgeFilter(clue.item, filter));

  const handleClose = (): void => {
    queuePlayerIntent(createToggleInvestigationAction(playerId));
  };

  return (
    <ModalShell
      title="Investigation Board"
      subtitle="Known persons of interest and discovered evidence"
      size="lg"
      onClose={handleClose}
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }} role="group" aria-label="Filter evidence">
          {INVESTIGATION_FILTERS.map((f) => (
            <Chip key={f.id} active={filterId === f.id} onClick={(): void => setFilterId(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>

        <div className="ui-two-col">
          <section className="ui-trade-pane" aria-label="Suspects">
            <h3 className="ui-trade-pane-title">{`Suspects (${visibleSuspects.length})`}</h3>
            <div className="ui-trade-list">
              {allSuspects.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>{INVESTIGATION_EMPTY_SUSPECTS}</div>
              ) : visibleSuspects.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>
                  {INVESTIGATION_EMPTY_SUSPECTS_FILTERED}
                </div>
              ) : (
                visibleSuspects.map((actorId) => {
                  const comps = getSuspectComponents(state, actorId);
                  const fighter = comps?.[ComponentType.Fighter] as FighterComponent | undefined;
                  const isAlive = fighter !== undefined && fighter.hp > 0;
                  const name = comps
                    ? resolveEntityDisplayName(state, actorId, 'A Shadowy Figure')
                    : 'Deceased Suspect';

                  return (
                    <div key={actorId} className="ui-faction-row">
                      <span>{name}</span>
                      <Badge tone={isAlive ? 'warning' : 'success'}>{isAlive ? 'At Large' : 'Neutralized'}</Badge>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="ui-trade-pane" aria-label="Clues and Evidence">
            <h3 className="ui-trade-pane-title">{`Evidence (${visibleClues.length})`}</h3>
            <div className="ui-trade-list">
              {allClues.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>{INVESTIGATION_EMPTY_CLUES}</div>
              ) : visibleClues.length === 0 ? (
                <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>
                  {INVESTIGATION_EMPTY_CLUES_FILTERED}
                </div>
              ) : (
                visibleClues.map((clue) => (
                  <div key={clue.clueId} className="ui-ledger-entry">
                    <strong style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-accent-primary)' }}>
                      {`Evidence: ${clue.clueId}`}
                    </strong>
                    <span style={{ fontSize: 'var(--ui-font-sm)' }}>
                      {clue.item?.description ?? 'Ties a minion to a mastermind...'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </ModalShell>
  );
}
