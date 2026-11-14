/**
 * @file Pure NWN2-Style Quickcast Matrix View-Model (`buildDnD35eQuickcastModel`).
 * Computes metamagic toggles, metamagic rods, Cleric/Druid spontaneous conversions,
 * collapsible class sections, and level-0..9 compact spell tile rows.
 */

import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier } from '../abilities.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import {
  computeClassLevelSlotSummaries,
  getSpontaneousConversionTargets,
  reconcilePreparedSlots,
  type SpellLevelSlotSummary
} from '../magic/spellbook_slots.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ClassSpellbookState, DnD35EntityData, DnD35PreparedSlotEntry } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35SystemContent } from '../types/dnd35e_system.types.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';
import { collectQuickcastModifierToggles, type QuickcastModifierToggle } from './dnd35e_quickcast_modifiers.ts';

export type { QuickcastModifierToggle };

const MAX_SPELL_LEVEL = 9;
const BASE_SPELL_DC = 10;

export interface QuickcastUIState {
  readonly activeModifierIds: ReadonlyArray<string>;
  readonly collapsedClassIds: ReadonlyArray<string>;
}

export interface QuickcastSpellTile {
  readonly spellId: string;
  readonly spellName: string;
  readonly school: string;
  readonly classId: string;
  readonly baseLevel: number;
  readonly effectiveSlotLevel: number;
  readonly remainingCount: number;
  readonly slotId?: string | undefined;
  readonly convertedSpellId?: string | undefined;
  readonly metamagicFeatIds: ReadonlyArray<string>;
  readonly rangeLabel: string;
  readonly saveDc: number;
  readonly isDisabled: boolean;
}

export interface QuickcastLevelRow {
  readonly spellLevel: number;
  readonly tiles: ReadonlyArray<QuickcastSpellTile>;
}

export interface QuickcastClassSection {
  readonly classId: string;
  readonly className: string;
  readonly castingMode: 'prepared' | 'spontaneous' | 'innate';
  readonly isCollapsed: boolean;
  readonly rows: ReadonlyArray<QuickcastLevelRow>;
}

export interface QuickcastPanelViewModel {
  readonly modifiers: ReadonlyArray<QuickcastModifierToggle>;
  readonly sections: ReadonlyArray<QuickcastClassSection>;
}

function makeTile(
  spellId: string,
  spell: DnD35SpellDefinition | undefined,
  classId: string,
  baseLevel: number,
  effectiveSlotLevel: number,
  remainingCount: number,
  saveDc: number,
  metaIds: ReadonlyArray<string>,
  extra?: { readonly slotId?: string; readonly convertedSpellId?: string; readonly isDisabled?: boolean }
): QuickcastSpellTile {
  return {
    spellId,
    spellName: spell?.name ?? spellId.replace(/_/g, ' '),
    school: spell?.school ?? 'universal',
    classId,
    baseLevel,
    effectiveSlotLevel,
    remainingCount,
    ...(extra?.slotId !== undefined ? { slotId: extra.slotId } : {}),
    ...(extra?.convertedSpellId !== undefined ? { convertedSpellId: extra.convertedSpellId } : {}),
    metamagicFeatIds: metaIds,
    rangeLabel: spell?.range ?? 'close',
    saveDc,
    isDisabled: extra?.isDisabled ?? remainingCount === 0
  };
}

function buildPreparedRows(
  classId: string,
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>,
  dndData: Partial<DnD35EntityData>,
  govAbMod: number,
  sys: DnD35SystemContent | undefined,
  activeSet: ReadonlySet<string>,
  activeRodIds: ReadonlyArray<string>
): ReadonlyArray<QuickcastLevelRow> {
  const slots =
    book.preparedSlots && book.preparedSlots.length > 0
      ? book.preparedSlots
      : reconcilePreparedSlots(book, summaries, sys?.spells);
  const convertCure = classId === 'cleric' && activeSet.has('spontaneous:cure');
  const convertInflict = classId === 'cleric' && activeSet.has('spontaneous:inflict');
  const convertSna = classId === 'druid' && activeSet.has('spontaneous:sna');
  const rows: QuickcastLevelRow[] = [];

  for (let lvl = 0; lvl <= MAX_SPELL_LEVEL; lvl++) {
    const levelSlots = slots.filter(
      (s: DnD35PreparedSlotEntry) => s.spellLevel === lvl && !s.expended && s.preparedSpellId
    );
    if (levelSlots.length === 0) continue;

    if ((convertCure || convertInflict || convertSna) && lvl >= 1) {
      const generalSlots = levelSlots.filter((s) => s.slotKind === 'general');
      if (generalSlots.length === 0) continue;
      const polarity = convertInflict ? 'negative' : 'positive';
      const convTargets = getSpontaneousConversionTargets(classId, lvl, dndData, sys, polarity);
      const tiles = convTargets.map((opt) => {
        const sp = sys?.spells?.[opt.spellId];
        return makeTile(
          generalSlots[0]!.preparedSpellId!,
          sp,
          classId,
          lvl,
          lvl,
          generalSlots.length,
          BASE_SPELL_DC + lvl + govAbMod,
          activeRodIds,
          {
            slotId: generalSlots[0]!.slotId,
            convertedSpellId: opt.spellId
          }
        );
      });
      if (tiles.length > 0) rows.push({ spellLevel: lvl, tiles });
      continue;
    }

    const grouped = new Map<string, DnD35PreparedSlotEntry[]>();
    for (const s of levelSlots) {
      const id = s.preparedSpellId!;
      const arr = grouped.get(id) ?? [];
      arr.push(s);
      grouped.set(id, arr);
    }

    const tiles: QuickcastSpellTile[] = [];
    for (const [spellId, group] of grouped.entries()) {
      const sp = sys?.spells?.[spellId];
      const baseLvl = sp?.levelByClass[classId] ?? sp?.level ?? lvl;
      tiles.push(
        makeTile(spellId, sp, classId, baseLvl, lvl, group.length, BASE_SPELL_DC + baseLvl + govAbMod, activeRodIds, {
          slotId: group[0]!.slotId
        })
      );
    }
    if (tiles.length > 0) rows.push({ spellLevel: lvl, tiles });
  }
  return rows;
}

function buildSpontaneousRows(
  classId: string,
  book: DnD35ClassSpellbookState,
  summaries: ReadonlyArray<SpellLevelSlotSummary>,
  govAbMod: number,
  sys: DnD35SystemContent | undefined,
  activeMetaIds: ReadonlyArray<string>,
  totalMetaBump: number
): ReadonlyArray<QuickcastLevelRow> {
  const byLevel = new Map<number, QuickcastSpellTile[]>();
  const usedMap = book.spontaneousSlotsUsedByLevel ?? {};
  const summaryMap = new Map(summaries.map((s) => [s.spellLevel, s]));

  for (const spellId of book.knownSpellIds) {
    const sp = sys?.spells?.[spellId];
    const baseLvl = sp?.levelByClass[classId] ?? sp?.level ?? 0;
    const effectiveLvl = baseLvl + totalMetaBump;
    if (effectiveLvl > MAX_SPELL_LEVEL || effectiveLvl > book.maxCastableSpellLevel) continue;

    const sum = summaryMap.get(effectiveLvl);
    const totalDaily = sum?.totalSlots ?? book.spellsPerDay[String(effectiveLvl)] ?? 0;
    const isAtWill = (effectiveLvl === 0 && totalDaily === 0) || classId === 'warlock' || classId === 'innate';
    const remaining = isAtWill ? -1 : Math.max(0, totalDaily - (usedMap[String(effectiveLvl)] ?? 0));
    if (!isAtWill && totalDaily <= 0) continue;

    const arr = byLevel.get(effectiveLvl) ?? [];
    arr.push(
      makeTile(
        spellId,
        sp,
        classId,
        baseLvl,
        effectiveLvl,
        remaining,
        BASE_SPELL_DC + baseLvl + govAbMod,
        activeMetaIds
      )
    );
    byLevel.set(effectiveLvl, arr);
  }

  return [...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([spellLevel, tiles]) => ({ spellLevel, tiles }));
}

/**
 * Builds the complete NWN2-style Quickcast HUD view-model for a character.
 */
export function buildDnD35eQuickcastModel(
  state: GameState,
  playerId: EntityId,
  uiState: QuickcastUIState
): QuickcastPanelViewModel {
  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign) ?? undefined;
  const classBooks = dndData.spellbooksByClass ?? {};
  const activeSet = new Set(uiState.activeModifierIds);
  const collapsedSet = new Set(uiState.collapsedClassIds);
  const dag = evaluateDnD35eEntityDAG(state, playerId);

  const modifiers = collectQuickcastModifierToggles(state, playerId, dndData, classBooks, sys, activeSet);
  const activeMetaToggles = modifiers.filter((m) => m.kind === 'metamagic' && m.isActive);
  const activeMetaIds = activeMetaToggles.map((m) => m.id);
  const activeRodIds = activeMetaToggles.filter((m) => m.slotLevelBump === 0).map((m) => m.id);
  const totalMetaBump = activeMetaToggles.reduce((sum, m) => sum + m.slotLevelBump, 0);

  const sections: QuickcastClassSection[] = [];
  for (const [classId, book] of Object.entries(classBooks)) {
    const classDef = sys?.classes?.[classId];
    const effectiveAbilities = dag?.dagResult.effectiveAbilities ?? dndData.abilityScores;
    const govAbScore = effectiveAbilities?.[book.governingAbility]?.base ?? 10;
    const govAbMod =
      dag?.dagResult.effectiveAbilityModifiers[book.governingAbility] ?? computeAbilityModifier(govAbScore);
    const summaries = computeClassLevelSlotSummaries(book, dndData, effectiveAbilities, sys);

    const rows =
      book.castingMode === 'prepared'
        ? buildPreparedRows(classId, book, summaries, dndData, govAbMod, sys, activeSet, activeRodIds)
        : buildSpontaneousRows(classId, book, summaries, govAbMod, sys, activeMetaIds, totalMetaBump);

    sections.push({
      classId,
      className: classDef?.name ?? classId.replace(/_/g, ' '),
      castingMode: classId === 'warlock' || classId === 'innate' ? 'innate' : book.castingMode,
      isCollapsed: collapsedSet.has(classId),
      rows
    });
  }

  return { modifiers, sections };
}
