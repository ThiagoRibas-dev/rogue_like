/**
 * @file D&D 3.5e Grimoire Left & Right Panes (Milestone 163).
 * Declarative Preact renderers for Prepared Slots, Spontaneous Casts, and Known/Domain/Specialist Spells.
 */

import type { JSX } from 'preact';
import { getGameState, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { prepareSpellIntoSlot, unprepareSpecificSlot } from '../../../../rulesets/dnd35e/magic/spellbook_actions.ts';
import {
  canPrepareSpellInDomainSlot,
  collectActorDomainSpellIds,
  getSpontaneousConversionTargets,
  isActorDomainSpellAtLevel,
  type SpellLevelSlotSummary
} from '../../../../rulesets/dnd35e/magic/spellbook_slots.ts';
import type {
  DnD35ClassSpellbookState,
  DnD35EntityData,
  DnD35PreparedSlotEntry
} from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import type {
  DnD35SpellDefinition,
  DnD35SystemContent
} from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { dispatchSpellCastFromLiveUI } from '../../dnd35e_spell_cast_ui.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge } from '../../primitives/DataDisplay.tsx';

/** Props shared by `<DnD35eSpellbookSlotsPane />` and `<DnD35eSpellbookKnownPane />`. */
export interface DnD35eSpellbookPaneProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly classId: string;
  readonly book: DnD35ClassSpellbookState;
  readonly summaries: ReadonlyArray<SpellLevelSlotSummary>;
  readonly spellRegistry: Readonly<Record<string, DnD35SpellDefinition | undefined>>;
  readonly dndData: Partial<DnD35EntityData>;
  readonly sys: DnD35SystemContent | undefined;
}

/**
 * Left pane of the Spellbook modal: Prepared spell slots (with Cast / Convert / Clear)
 * or Spontaneous daily cast pips.
 */
export function DnD35eSpellbookSlotsPane({
  state,
  playerId,
  classId,
  book,
  summaries,
  spellRegistry,
  dndData,
  sys
}: DnD35eSpellbookPaneProps): JSX.Element {
  if (book.castingMode !== 'prepared') {
    const usedMap = book.spontaneousSlotsUsedByLevel ?? {};
    return (
      <div className="ui-dnd-col">
        <div className="ui-dnd-subbanner">Daily Spell Casts Remaining</div>
        {summaries.map((sum) => {
          const used = usedMap[String(sum.spellLevel)] ?? 0;
          const remaining = Math.max(0, sum.totalSlots - used);
          return (
            <div key={sum.spellLevel} className="ui-dnd-spell-level-group">
              <div className="ui-dnd-card__title">
                {`Level ${sum.spellLevel}: ${remaining} / ${sum.totalSlots} Casts Remaining (DC ${sum.saveDc})`}
              </div>
              <div className="ui-dnd-chip-row" aria-label={`${remaining} of ${sum.totalSlots} casts remaining`}>
                {Array.from({ length: sum.totalSlots }, (_, i) => (
                  <span key={i} aria-hidden="true">
                    {i < remaining ? '💎' : '✖'}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const slots = book.preparedSlots ?? [];

  return (
    <div className="ui-dnd-col">
      <div className="ui-dnd-subbanner">Memorized Spell Slots</div>
      {summaries.map((sum) => {
        const levelSlots = slots.filter((s: DnD35PreparedSlotEntry) => s.spellLevel === sum.spellLevel);
        const slotHeader = `Level ${sum.spellLevel} Slots (Base: ${sum.baseSlots}${sum.bonusSlots > 0 ? ` +${sum.bonusSlots} Ability` : ''}${sum.domainSlots > 0 ? ' +1 Domain' : ''}${sum.specialistSlots > 0 ? ' +1 Specialist' : ''}) • Save DC ${sum.saveDc}`;

        return (
          <div key={sum.spellLevel} className="ui-dnd-spell-level-group">
            <div className="ui-dnd-card__title">{slotHeader}</div>
            {levelSlots.length === 0 ? (
              <div className="ui-dnd-card__sub">No slots available for this level.</div>
            ) : (
              levelSlots.map((slot) => {
                const spDef = slot.preparedSpellId ? spellRegistry[slot.preparedSpellId] : undefined;
                const spellLabel = slot.preparedSpellId
                  ? (spDef?.name ?? slot.preparedSpellId.replace(/_/g, ' '))
                  : '— Empty Slot —';
                const convOptions =
                  slot.preparedSpellId && !slot.expended && slot.slotKind === 'general'
                    ? getSpontaneousConversionTargets(classId, slot.spellLevel, dndData, sys)
                    : [];

                return (
                  <div key={slot.slotId} className="ui-dnd-spell-row">
                    <div className="ui-dnd-chip-row">
                      <Badge>{slot.slotKind.toUpperCase()}</Badge>
                      <span
                        className={
                          !slot.preparedSpellId
                            ? 'ui-dnd-spell-row__name ui-dnd-spell-row__name--empty'
                            : slot.expended
                              ? 'ui-dnd-spell-row__name ui-dnd-spell-row__name--expended'
                              : 'ui-dnd-spell-row__name'
                        }
                      >
                        {spellLabel}
                      </span>
                    </div>

                    <div className="ui-dnd-chip-row">
                      {slot.preparedSpellId && !slot.expended ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              dispatchSpellCastFromLiveUI(playerId, {
                                classId,
                                spellId: slot.preparedSpellId!,
                                slotId: slot.slotId,
                                spellLevel: slot.spellLevel
                              })
                            }
                          >
                            Cast
                          </Button>
                          {convOptions.map((opt) => (
                            <Button
                              key={opt.spellId}
                              size="sm"
                              onClick={() =>
                                dispatchSpellCastFromLiveUI(playerId, {
                                  classId,
                                  spellId: slot.preparedSpellId!,
                                  slotId: slot.slotId,
                                  spellLevel: slot.spellLevel,
                                  convertedSpellId: opt.spellId
                                })
                              }
                            >
                              {`Conv → ${opt.label}`}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const live = getGameState() ?? state;
                              setGameState(unprepareSpecificSlot(live, playerId, classId, slot.slotId));
                              markAllDomainsDirty();
                            }}
                          >
                            Clear ×
                          </Button>
                        </>
                      ) : slot.expended ? (
                        <Badge tone="danger">Expended</Badge>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Right pane of the Spellbook modal: Known Spells & Prayerbook grouped by spell level
 * with `+ Prep`, `+ Prep Domain`, `+ Prep Specialist`, or Spontaneous `Cast` actions.
 */
export function DnD35eSpellbookKnownPane({
  state,
  playerId,
  classId,
  book,
  summaries,
  spellRegistry,
  dndData,
  sys
}: DnD35eSpellbookPaneProps): JSX.Element {
  const hasDomainAccess =
    (dndData.domains?.length ?? 0) > 0 &&
    (book.domainSpellSlots !== undefined || summaries.some((s) => s.domainSlots > 0));
  const allSpellIds = new Set<string>(book.knownSpellIds);
  if (hasDomainAccess) {
    for (const spId of collectActorDomainSpellIds(dndData.domains, sys?.domains, spellRegistry)) {
      allSpellIds.add(spId);
    }
  }

  const slots = book.preparedSlots ?? [];
  const supportsSpecialist = sys?.classes?.[classId]?.supportsArcaneSchoolSpecialization === true;

  return (
    <div className="ui-dnd-col">
      <div className="ui-dnd-subbanner">
        {book.castingMode === 'prepared' ? 'Known Spells & Prayerbook' : 'Known Spells'}
      </div>
      {summaries.map((sum) => {
        const spellsAtLevel: DnD35SpellDefinition[] = [];
        for (const id of allSpellIds) {
          const sp = spellRegistry[id];
          if (!sp) continue;
          const matchesClass = sp.levelByClass?.[classId] === sum.spellLevel;
          const matchesDomain =
            hasDomainAccess && isActorDomainSpellAtLevel(sp.id, sp, sum.spellLevel, dndData.domains, sys?.domains);
          if (matchesClass || matchesDomain) {
            spellsAtLevel.push(sp);
          }
        }
        if (spellsAtLevel.length === 0) return null;

        const openGenCount = slots.filter(
          (s: DnD35PreparedSlotEntry) =>
            s.spellLevel === sum.spellLevel && s.slotKind === 'general' && !s.preparedSpellId && !s.expended
        ).length;
        const hasOpenDom = slots.some(
          (s: DnD35PreparedSlotEntry) =>
            s.spellLevel === sum.spellLevel && s.slotKind === 'domain' && !s.preparedSpellId && !s.expended
        );
        const hasOpenSpec = slots.some(
          (s: DnD35PreparedSlotEntry) =>
            s.spellLevel === sum.spellLevel && s.slotKind === 'specialist' && !s.preparedSpellId && !s.expended
        );
        const spontUsed = (book.spontaneousSlotsUsedByLevel ?? {})[String(sum.spellLevel)] ?? 0;
        const spontRem = Math.max(0, sum.totalSlots - spontUsed);

        return (
          <div key={sum.spellLevel} className="ui-dnd-spell-level-group">
            <div className="ui-dnd-card__title">{`Level ${sum.spellLevel} Known Spells (${spellsAtLevel.length})`}</div>
            {spellsAtLevel.map((sp) => {
              const canDomain =
                hasDomainAccess &&
                sum.domainSlots > 0 &&
                canPrepareSpellInDomainSlot(sp.id, sp, sum.spellLevel, dndData, sys, classId);
              const canSpec = supportsSpecialist && sum.specialistSlots > 0 && sp.school === dndData.arcaneSchool;

              return (
                <div key={sp.id} className="ui-dnd-spell-row">
                  <div className="ui-dnd-chip-row">
                    <span className="ui-dnd-spell-row__name">{sp.name}</span>
                    <Badge tone="info">{sp.school.toUpperCase()}</Badge>
                  </div>

                  <div className="ui-dnd-chip-row">
                    {book.castingMode === 'prepared' ? (
                      <>
                        <Button
                          size="sm"
                          disabled={openGenCount <= 0}
                          onClick={() => {
                            const live = getGameState() ?? state;
                            setGameState(
                              prepareSpellIntoSlot(live, playerId, classId, sp.id, 'general', sum.spellLevel)
                            );
                            markAllDomainsDirty();
                          }}
                        >
                          {`+ Prep (${openGenCount} open)`}
                        </Button>
                        {canDomain ? (
                          <Button
                            size="sm"
                            disabled={!hasOpenDom}
                            onClick={() => {
                              const live = getGameState() ?? state;
                              setGameState(
                                prepareSpellIntoSlot(live, playerId, classId, sp.id, 'domain', sum.spellLevel)
                              );
                              markAllDomainsDirty();
                            }}
                          >
                            + Prep Domain
                          </Button>
                        ) : null}
                        {canSpec ? (
                          <Button
                            size="sm"
                            disabled={!hasOpenSpec}
                            onClick={() => {
                              const live = getGameState() ?? state;
                              setGameState(
                                prepareSpellIntoSlot(live, playerId, classId, sp.id, 'specialist', sum.spellLevel)
                              );
                              markAllDomainsDirty();
                            }}
                          >
                            + Prep Specialist
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={spontRem <= 0}
                        onClick={() =>
                          dispatchSpellCastFromLiveUI(playerId, {
                            classId,
                            spellId: sp.id,
                            spellLevel: sum.spellLevel
                          })
                        }
                      >
                        {`✨ Cast (Lv ${sum.spellLevel})`}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
