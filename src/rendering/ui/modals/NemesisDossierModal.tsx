import type { JSX } from 'preact';
import { createToggleDossierAction, createToggleLegendsAction } from '../../../actions/core.actions.ts';
import { getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { formatLedgerEventLabel } from '../../../systems/ledger_queries.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type FighterComponent,
  type IdentityComponent,
  type MemoryComponent,
  type NemesisComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import { type EntityId, UIMode } from '../../../types/game-state.types.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, type BadgeTone } from '../primitives/DataDisplay.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';

interface NotableChronicleEntry {
  readonly id: EntityId;
  readonly identity?: IdentityComponent | undefined;
  readonly chronicle: ChronicleComponent;
  readonly memory?: MemoryComponent | undefined;
  readonly isAlive: boolean;
}

const STRESS_HIGH = 80;
const STRESS_MEDIUM = 40;
const MAX_STRESS = 100;

/**
 * Nemesis Hierarchies, Player Chronicle Timeline, and Notable Entity Chronicles modal
 * with zero `.innerHTML` and semantic status tones.
 */
export function NemesisDossierModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Dossier) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const hierarchies = Object.entries(state.campaign.nemesisHierarchies ?? {});
  const playerChronicle = getComponent(state, playerId, ComponentType.Chronicle) as ChronicleComponent | undefined;

  const notableEntries: NotableChronicleEntry[] = [];
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player) !== undefined) continue;
    const chronicle = getComponent(state, entityId, ComponentType.Chronicle) as ChronicleComponent | undefined;
    if (!chronicle) continue;
    const identity = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
    const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
    const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    notableEntries.push({
      id: entityId,
      identity,
      chronicle,
      memory,
      isAlive: fighter ? fighter.hp > 0 : false
    });
  }

  for (const [entityId, record] of state.persistentEntities.entries()) {
    const chronicle = record.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
    if (!chronicle) continue;
    const identity = record.components[ComponentType.Identity] as IdentityComponent | undefined;
    const fighter = record.components[ComponentType.Fighter] as FighterComponent | undefined;
    const memory = record.components[ComponentType.Memory] as MemoryComponent | undefined;
    const tags = record.components[ComponentType.Tags] as TagsComponent | undefined;
    const legendFigure =
      fighter === undefined && tags?.tags.includes('historical_legend') && state.macroWorld
        ? Object.values(state.macroWorld.legends.figures).find((fig) => fig.seededEntityId === entityId)
        : undefined;
    const isAlive = fighter ? fighter.hp > 0 : legendFigure ? legendFigure.isAlive : false;
    notableEntries.push({
      id: entityId,
      identity,
      chronicle,
      memory,
      isAlive
    });
  }

  const handleClose = (): void => {
    queuePlayerIntent(createToggleDossierAction(playerId));
  };

  return (
    <ModalShell
      title="Chronicle & Nemesis Dossier"
      subtitle="Power hierarchies, personal timeline, and notable figures"
      size="xl"
      onClose={handleClose}
      footer={
        <div style={{ display: 'flex', gap: 'var(--ui-space-2)' }}>
          {state.macroWorld !== undefined ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={(): void => queuePlayerIntent(createToggleLegendsAction(playerId))}
            >
              🗺️ World Legends
            </Button>
          ) : null}
          <Button variant="primary" size="sm" onClick={handleClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="ui-card-stack">
        {hierarchies.length > 0 ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)' }}>
            <h3 className="ui-dossier-section-title">Nemesis Hierarchies</h3>
            {hierarchies.map(([hierarchyId, hierarchy]) => {
              const factionName = hierarchy.factionId.charAt(0).toUpperCase() + hierarchy.factionId.slice(1);
              const sortedRanks = [...hierarchy.ranks].sort((a, b) => b.tier - a.tier);
              return (
                <div key={hierarchyId} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <strong style={{ color: 'var(--ui-accent-primary)' }}>{`${factionName} Hierarchy`}</strong>
                  {sortedRanks.map((rank) => {
                    const occupants = state.nemesisSlots[`${hierarchyId}:${rank.rankId}`] ?? [];
                    return (
                      <div key={rank.rankId} className="ui-nemesis-rank">
                        <span
                          style={{ fontSize: 'var(--ui-font-xs)', fontWeight: 700, color: 'var(--ui-text-secondary)' }}
                        >
                          {`${rank.displayName} (Tier ${rank.tier})`}
                        </span>
                        <div className="ui-nemesis-slots">
                          {Array.from({ length: rank.maxSlots }, (_, idx) => {
                            const occId = occupants[idx];
                            if (occId === undefined) {
                              return (
                                <div key={`vacant_${idx}`} className="ui-nemesis-slot" data-vacant="true">
                                  <div>[Vacant Slot]</div>
                                  <div>???</div>
                                </div>
                              );
                            }

                            const activeComps = state.components.get(occId);
                            const record = activeComps ? undefined : state.persistentEntities.get(occId);
                            const comps = activeComps ?? record?.components;
                            const fighter = comps?.[ComponentType.Fighter] as FighterComponent | undefined;
                            const chronicle = comps?.[ComponentType.Chronicle] as ChronicleComponent | undefined;
                            const nemesis = comps?.[ComponentType.Nemesis] as NemesisComponent | undefined;
                            const isAlive = fighter ? fighter.hp > 0 : false;
                            const inLimbo =
                              !activeComps && nemesis?.returnDelay !== undefined && nemesis.returnDelay > 0;
                            const statusText = inLimbo ? 'Missing' : isAlive ? 'Active' : 'Dead';
                            const statusTone: BadgeTone = inLimbo ? 'warning' : isAlive ? 'success' : 'danger';
                            const name = resolveEntityDisplayName(state, occId, `Nemesis #${occId}`);

                            return (
                              <div key={`occ_${occId}`} className="ui-nemesis-slot">
                                <div style={{ fontWeight: 700, marginBottom: '4px' }}>{name}</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <Badge tone={statusTone}>{statusText}</Badge>
                                  <span style={{ color: 'var(--ui-text-muted)' }}>{`PIS: ${chronicle?.pis ?? 0}`}</span>
                                </div>
                                {chronicle && chronicle.scars.length > 0 ? (
                                  <div
                                    style={{ marginTop: '4px', fontStyle: 'italic', color: 'var(--ui-accent-primary)' }}
                                  >
                                    {`Scars: ${chronicle.scars.join(', ')}`}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </section>
        ) : null}

        {playerChronicle && playerChronicle.eventExcerpts.length > 0 ? (
          <section style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <h3 className="ui-dossier-section-title">Your Chronicle (Timeline)</h3>
            {playerChronicle.eventExcerpts.map((eventId) => {
              const event = state.historicalLedger.find((le) => le.id === eventId);
              if (!event) return null;
              const turn = event.id ? event.id.split('_')[1] : '?';
              return (
                <div key={eventId} className="ui-ledger-entry">
                  <strong style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-accent-secondary)' }}>
                    {`Turn ${turn}`}
                  </strong>
                  <span style={{ fontSize: 'var(--ui-font-sm)' }}>{event.summary ?? 'Unknown event.'}</span>
                </div>
              );
            })}
          </section>
        ) : null}

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-2)' }}>
          <h3 className="ui-dossier-section-title">Notable Chronicles</h3>
          {notableEntries.length === 0 ? (
            <div style={{ padding: '12px', color: 'var(--ui-text-muted)' }}>No notable entities recorded yet.</div>
          ) : (
            notableEntries.map((entry) => {
              const nameStr = resolveEntityDisplayName(state, entry.id, `Unknown Entity #${entry.id}`);
              const stress = Math.min(MAX_STRESS, Math.max(0, entry.memory?.stress ?? 0));
              const stressTone: BadgeTone =
                stress >= STRESS_HIGH ? 'danger' : stress >= STRESS_MEDIUM ? 'warning' : 'success';

              return (
                <article key={entry.id} className="ui-quest-card">
                  <div className="ui-quest-card__head">
                    <h4 className="ui-quest-card__title">{nameStr}</h4>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <Badge tone={stressTone}>{`Stress ${stress}/${MAX_STRESS}`}</Badge>
                      <Badge tone="neutral">{`PIS ${entry.chronicle.pis}`}</Badge>
                      <Badge tone={entry.isAlive ? 'success' : 'danger'}>{entry.isAlive ? 'Alive' : 'Dead'}</Badge>
                    </div>
                  </div>

                  {entry.chronicle.coreMemories && entry.chronicle.coreMemories.length > 0 ? (
                    <div className="ui-ledger-entry">
                      <strong style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-accent-primary)' }}>
                        Core Memories
                      </strong>
                      {entry.chronicle.coreMemories.map((mem, idx) => (
                        <div key={`cm_${idx}`} style={{ fontStyle: 'italic', fontSize: 'var(--ui-font-xs)' }}>
                          {`"${mem}"`}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-text-secondary)' }}>
                    <strong>Recent Thoughts:</strong>{' '}
                    {entry.memory?.thoughts && entry.memory.thoughts.length > 0
                      ? entry.memory.thoughts
                          .map(
                            (t) =>
                              `[T${t.turn}] ${t.eventSummary} (${t.stressDelta >= 0 ? '+' : ''}${t.stressDelta} Stress)`
                          )
                          .join(' · ')
                      : 'No transient thoughts.'}
                  </div>

                  <div style={{ fontSize: 'var(--ui-font-xs)', color: 'var(--ui-text-primary)' }}>
                    <strong>Chronicle:</strong>{' '}
                    {entry.chronicle.eventExcerpts.length > 0
                      ? entry.chronicle.eventExcerpts
                          .map((evtId) => {
                            const e = state.historicalLedger.find((le) => le.id === evtId);
                            if (!e) return null;
                            return `[${formatLedgerEventLabel(e.id)}] ${e.summary}`;
                          })
                          .filter(Boolean)
                          .join(' · ')
                      : 'No history recorded.'}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </ModalShell>
  );
}
