import { addComponent, getComponent, removeEntity, resolveEntityDisplayName, spawnItem } from '../../../core/ecs.ts';
import { rng } from '../../../core/rng.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { advanceWorldTimeBulk } from '../../../systems/world_time_skip.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ItemComponent,
  type NemesisComponent,
  type StructuralComponent,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { rollD20 } from '../math/dice.ts';
import { resolveEntityDnD35Data, saveEntityDnD35Data } from '../skills/skill_verb_helpers.ts';
import type { DnD35SpellDefinition } from '../types/system/spell_system.types.ts';

/** Canonical spell rarity tiers parsed from `DnD35SpellDefinition.tags` (`rarity:*`). */
export type SpellRarityTier = 'common' | 'uncommon' | 'rare' | 'forbidden';

/** Base Spellcraft DC to learn and transcribe a spell from a borrowed/captured spellbook (`15 + spellLevel` per PHB p. 179). */
export const SPELLCRAFT_TRANSCRIBE_BASE_DC = 15;

/** Global turns per hour used when advancing scribing study time (`600` turns = 1 hour at 6s/turn). */
export const GLOBAL_TURNS_PER_SCRIBE_HOUR = 600;

/** Declarative tag identifying spellbook items (`wizards_spellbook`). */
export const SPELLBOOK_ITEM_TAG = 'spellbook';

const SCRIBING_PEN_ITEM_TAG = 'scribing_pen';
const SCRIBING_INK_ITEM_TAG = 'scribing_ink';

function itemHasTag(state: Readonly<GameState>, itemEntityId: EntityId, tag: string): boolean {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (itemComp) {
    const itemDef = state.campaign.items[itemComp.itemId];
    if (itemDef?.tags.includes(tag)) return true;
    const sysItems = getDnD35SystemContent(state.campaign)?.items;
    if (sysItems?.[itemComp.itemId]?.tags?.includes(tag)) return true;
  }
  const tagsComp = getComponent(state, itemEntityId, ComponentType.Tags) as TagsComponent | undefined;
  return tagsComp?.tags.includes(tag) ?? false;
}

/** Rarity weight multipliers when rolling bonus spells for an enemy wizard's captured spellbook. */
export const SPELL_RARITY_DROP_WEIGHTS: Readonly<Record<SpellRarityTier, number>> = {
  common: 60,
  uncommon: 25,
  rare: 12,
  forbidden: 3
};

/**
 * Resolves the canonical `SpellRarityTier` of a spell definition from its declarative `tags` array.
 * Spells without an explicit `rarity:*` tag default to `'common'`.
 *
 * @param spell Spell definition or tags array.
 * @returns `'common' | 'uncommon' | 'rare' | 'forbidden'`.
 */
export function getSpellRarityTier(spell: Pick<DnD35SpellDefinition, 'tags'> | ReadonlyArray<string>): SpellRarityTier {
  const tags: ReadonlyArray<string> = 'tags' in spell ? spell.tags : spell;
  if (tags.includes('rarity:forbidden')) return 'forbidden';
  if (tags.includes('rarity:rare')) return 'rare';
  if (tags.includes('rarity:uncommon')) return 'uncommon';
  return 'common';
}

function resolveSpellbookScribingClassIds(state: Readonly<GameState>, actorId: EntityId): ReadonlyArray<string> {
  const sys = getDnD35SystemContent(state.campaign);
  const dndData = resolveEntityDnD35Data(state, actorId);
  const classIds: string[] = [];
  for (const t of dndData.tracks) {
    if (t.levels <= 0) continue;
    const cls = sys?.classes[t.trackId];
    if (cls?.spellAcquisitionMode === 'spellbook_scribed' || (!cls && t.trackId === 'wizard')) {
      classIds.push(t.trackId);
    }
  }
  for (const classId of Object.keys(dndData.spellbooksByClass ?? {})) {
    if (!classIds.includes(classId)) {
      classIds.push(classId);
    }
  }
  return classIds;
}

/**
 * Inspects a slain actor (`casterEntityId`) and, if they have arcane spellbook casting (`spellAcquisitionMode === 'spellbook_scribed'`
 * or an active `spellbooksByClass` entry), spawns an inspectable `spellbook`-tagged item at `(x, y)` populated with their
 * castable arcane spells plus rarity-weighted bonus spell rolls scaled by caster level / nemesis boss rank.
 * Divine-only casters (clerics, druids, rangers, paladins) and spontaneous-only casters without a spellbook never drop a spellbook.
 *
 * @param state Current immutable GameState.
 * @param casterEntityId Slain actor EntityId.
 * @param x Drop tile X coordinate.
 * @param y Drop tile Y coordinate.
 * @returns Updated GameState and optional spawned `spellbookEntityId`.
 */
export function spawnArcaneCasterSpellbookLoot(
  state: GameState,
  casterEntityId: EntityId,
  x: number,
  y: number
): {
  readonly state: GameState;
  readonly spellbookEntityId?: EntityId | undefined;
  readonly storedSpellIds: ReadonlyArray<string>;
} {
  const sys = getDnD35SystemContent(state.campaign);
  const spellbookItemDef =
    Object.values(state.campaign.items).find((it) => it.tags.includes(SPELLBOOK_ITEM_TAG)) ??
    Object.values(sys?.items ?? {}).find((it) => it.tags.includes(SPELLBOOK_ITEM_TAG));
  if (!spellbookItemDef) {
    return { state, storedSpellIds: [] };
  }

  const dndData = resolveEntityDnD35Data(state, casterEntityId);
  const scribingClassIds = resolveSpellbookScribingClassIds(state, casterEntityId);
  if (scribingClassIds.length === 0) {
    return { state, storedSpellIds: [] };
  }

  const spellbookCasterLevels = dndData.tracks
    .filter((t) => {
      const cls = sys?.classes[t.trackId];
      return (
        scribingClassIds.includes(t.trackId) ||
        cls?.spellAcquisitionMode === 'spellbook_scribed' ||
        (cls?.isPrestige === true && cls.castingTradition === 'arcane')
      );
    })
    .reduce((sum, t) => sum + t.levels, 0);

  const classBookSpells = Object.values(dndData.spellbooksByClass ?? {}).flatMap((b) => b.knownSpellIds);
  const baseCastable = new Set<string>([
    ...(dndData.knownSpells ?? []),
    ...(dndData.preparedSpells ?? []),
    ...classBookSpells
  ]);

  if (spellbookCasterLevels <= 0 && baseCastable.size === 0) {
    return { state, storedSpellIds: [] };
  }

  const primaryClassId = scribingClassIds[0] ?? 'wizard';
  const effectiveCasterLevel = Math.max(1, spellbookCasterLevels, dndData.cr ?? 1);
  const maxSpellLevel = Math.min(9, Math.max(1, Math.ceil(effectiveCasterLevel / 2)));
  const isBossOrNemesis = getComponent(state, casterEntityId, ComponentType.Nemesis) as NemesisComponent | undefined;

  const allClassSpells = Object.values(sys?.spells ?? {}).filter((sp) => {
    const classLvl = sp.levelByClass?.[primaryClassId] ?? (primaryClassId === 'wizard' ? sp.level : undefined);
    return classLvl !== undefined && classLvl <= maxSpellLevel;
  });

  // Always include at least 1 common baseline spell if the caster had no explicit spell list populated
  if (baseCastable.size === 0) {
    for (const sp of allClassSpells) {
      if (getSpellRarityTier(sp) === 'common' && baseCastable.size < 2) {
        baseCastable.add(sp.id);
      }
    }
  }

  // Roll 1-2 rarity-weighted bonus spells scaled by caster level / boss status
  const bonusRolls = isBossOrNemesis ? 2 : 1;
  const candidatePool = allClassSpells.filter((sp) => !baseCastable.has(sp.id));
  for (let i = 0; i < bonusRolls && candidatePool.length > 0; i++) {
    const weights: Record<string, number> = {};
    for (const sp of candidatePool) {
      if (baseCastable.has(sp.id)) continue;
      const tier = getSpellRarityTier(sp);
      const bossBoost = isBossOrNemesis && (tier === 'rare' || tier === 'forbidden') ? 3 : 1;
      weights[sp.id] = SPELL_RARITY_DROP_WEIGHTS[tier] * bossBoost;
    }
    if (Object.keys(weights).length > 0) {
      const picked = rng.getWeightedValue(weights);
      if (picked) {
        baseCastable.add(picked);
      }
    }
  }

  const storedSpellIds = Array.from(baseCastable);
  let workingState = state;
  if (!workingState.campaign.items[spellbookItemDef.id]) {
    workingState = {
      ...workingState,
      campaign: {
        ...workingState.campaign,
        items: {
          ...workingState.campaign.items,
          [spellbookItemDef.id]: spellbookItemDef
        }
      }
    };
  }
  const [afterSpawn, bookEntityId] = spawnItem(workingState, spellbookItemDef.id, x, y);
  let nextState = afterSpawn;

  const bookStructural: StructuralComponent = {
    type: ComponentType.Structural,
    materialTag: 'paper',
    hardness: 1,
    hp: 3,
    maxHp: 3,
    breakDc: 12,
    objectSize: 'small',
    storedSpellIds
  };
  nextState = addComponent(nextState, bookEntityId, bookStructural);

  const existingTags =
    (getComponent(nextState, bookEntityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const spellTags = storedSpellIds.map((id) => `spell:${id}`);
  nextState = addComponent(nextState, bookEntityId, {
    type: ComponentType.Tags,
    tags: Array.from(new Set([...existingTags, SPELLBOOK_ITEM_TAG, ...spellTags]))
  });

  return {
    state: nextState,
    spellbookEntityId: bookEntityId,
    storedSpellIds
  };
}

/**
 * Extracts the list of spell IDs recorded inside a `wizards_spellbook` entity (`StructuralComponent.storedSpellIds`
 * or `spell:<id>` tags).
 *
 * @param state Current GameState.
 * @param spellbookEntityId Spellbook item EntityId.
 * @returns Array of stored spell IDs.
 */
export function getStoredSpellsOnSpellbook(
  state: Readonly<GameState>,
  spellbookEntityId: EntityId
): ReadonlyArray<string> {
  const structural = getComponent(state, spellbookEntityId, ComponentType.Structural) as
    StructuralComponent | undefined;
  if (structural?.storedSpellIds && structural.storedSpellIds.length > 0) {
    return structural.storedSpellIds;
  }
  const tagsComp = getComponent(state, spellbookEntityId, ComponentType.Tags) as TagsComponent | undefined;
  if (!tagsComp) return [];
  return tagsComp.tags.filter((t) => t.startsWith('spell:')).map((t) => t.slice('spell:'.length));
}

/**
 * Transcribes a spell (`spellId`, or the first unlearned spell in `spellbookEntityId`) into the actor's
 * spellbook (`knownSpells` and `spellbooksByClass.<classId>.knownSpellIds`) per PHB p. 179:
 * - Validates that the actor has a spellbook-scribing arcane class track (`spellAcquisitionMode === 'spellbook_scribed'`).
 * - Validates that `targetSpellId` is actually present in `storedSpells` on `spellbookEntityId`.
 * - Validates that `targetSpellId` is on the actor's spellbook-scribing class spell list (`spellDef.levelByClass`).
 * - Requires a carried `inkpen` and `ink_vial` (consumes 1 `ink_vial` charge on success).
 * - Requires a `Spellcraft` check against `DC 15 + spellLevel`.
 * - Advances elapsed study time through `advanceWorldTimeBulk(nextState, studyHours * GLOBAL_TURNS_PER_SCRIBE_HOUR, actorId)`.
 *
 * @param state Current immutable GameState.
 * @param actorId Wizard actor transcribing the spell.
 * @param spellbookEntityId Captured `wizards_spellbook` item EntityId.
 * @param options Optional target `spellId` and deterministic `forcedD20` roll.
 * @returns Updated GameState, transcribed spell ID, roll total, DC, and success boolean.
 */
export function transcribeSpellFromBook(
  state: GameState,
  actorId: EntityId,
  spellbookEntityId: EntityId,
  options?: {
    readonly spellId?: string | undefined;
    readonly forcedD20?: number | undefined;
  }
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly transcribedSpellId?: string | undefined;
  readonly totalRoll: number;
  readonly dc: number;
} {
  const storedSpells = getStoredSpellsOnSpellbook(state, spellbookEntityId);
  if (storedSpells.length === 0) {
    return {
      state: addMessage(state, 'This spellbook contains no legible arcane formulas.', MessageLogCategory.System),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  const scribingClassIds = resolveSpellbookScribingClassIds(state, actorId);
  if (scribingClassIds.length === 0) {
    return {
      state: addMessage(
        state,
        'Only an arcane caster who prepares spells from a spellbook can transcribe formulas from a grimoire.',
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  const primaryClassId = scribingClassIds[0] ?? 'wizard';
  const dndData = resolveEntityDnD35Data(state, actorId);
  const alreadyKnown = new Set<string>([
    ...(dndData.knownSpells ?? []),
    ...(dndData.spellbooksByClass?.[primaryClassId]?.knownSpellIds ?? [])
  ]);

  if (options?.spellId !== undefined && !storedSpells.includes(options.spellId)) {
    return {
      state: addMessage(
        state,
        `That spell (${options.spellId}) is not recorded in this spellbook.`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  const sys = getDnD35SystemContent(state.campaign);
  const isSpellOnScribingClassList = (spellId: string): boolean => {
    const def = sys?.spells[spellId];
    if (!def) return true;
    if (!def.levelByClass || Object.keys(def.levelByClass).length === 0) return true;
    return scribingClassIds.some(
      (cid) =>
        def.levelByClass?.[cid] !== undefined ||
        (cid === 'wizard' && def.levelByClass?.['sorcerer_wizard'] !== undefined)
    );
  };

  const targetSpellId =
    options?.spellId ?? storedSpells.find((id) => !alreadyKnown.has(id) && isSpellOnScribingClassList(id));
  if (!targetSpellId) {
    const anyUnlearned = storedSpells.some((id) => !alreadyKnown.has(id));
    return {
      state: addMessage(
        state,
        anyUnlearned
          ? 'None of the remaining spells in this grimoire belong to your class spell list.'
          : 'You have already transcribed every spell recorded in this grimoire.',
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  if (!isSpellOnScribingClassList(targetSpellId)) {
    return {
      state: addMessage(
        state,
        `${targetSpellId} is not on your arcane class spell list and cannot be transcribed.`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  if (alreadyKnown.has(targetSpellId)) {
    return {
      state: addMessage(state, `You already know ${targetSpellId}.`, MessageLogCategory.System),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  const invItems = inv?.items ?? [];
  const hasInkpen = invItems.some((id) => itemHasTag(state, id, SCRIBING_PEN_ITEM_TAG));
  const inkVialEntityId = invItems.find((id) => itemHasTag(state, id, SCRIBING_INK_ITEM_TAG));

  if (!hasInkpen || inkVialEntityId === undefined) {
    return {
      state: addMessage(
        state,
        'Transcribing a spell into your spellbook requires both an inkpen and a vial of ink.',
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: 0,
      dc: 0
    };
  }

  const spellDef = sys?.spells[targetSpellId];
  const spellLevel =
    spellDef?.levelByClass?.[primaryClassId] ?? spellDef?.levelByClass?.['wizard'] ?? spellDef?.level ?? 1;
  const dc = SPELLCRAFT_TRANSCRIBE_BASE_DC + Math.max(0, spellLevel);

  const dag = evaluateDnD35eEntityDAG(state, actorId);
  const spellcraftMod =
    dag?.resolvedSkills['spellcraft']?.totalModifier ??
    (dndData.skillRanks?.['spellcraft'] ?? 0) + Math.floor(((dndData.abilityScores?.int?.base ?? 10) - 10) / 2);

  const d20 = rollD20('skill_check', spellcraftMod, options?.forcedD20);
  const totalRoll = d20.total;
  const actorName = resolveEntityDisplayName(state, actorId, 'The wizard');
  const spellName = spellDef?.name ?? targetSpellId;

  if (totalRoll < dc) {
    return {
      state: addMessage(
        state,
        `${actorName} fails to grasp the arcane notation for ${spellName} (Spellcraft ${totalRoll} vs DC ${dc}).`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll,
      dc
    };
  }

  // Consume 1 ink_vial charge
  let nextState = state;
  const inkComp = getComponent(nextState, inkVialEntityId, ComponentType.Item) as ItemComponent | undefined;
  const remainingInk = (inkComp?.charges ?? 1) - 1;
  if (remainingInk <= 0) {
    if (inv) {
      nextState = addComponent(nextState, actorId, {
        ...inv,
        items: inv.items.filter((id) => id !== inkVialEntityId)
      });
    }
    nextState = removeEntity(nextState, inkVialEntityId);
  } else if (inkComp) {
    nextState = addComponent(nextState, inkVialEntityId, {
      ...inkComp,
      charges: remainingInk
    });
  }

  // Record the spell in knownSpells and primaryClassId spellbooksByClass (if present)
  const nextKnownSpells = Array.from(new Set([...(dndData.knownSpells ?? []), targetSpellId]));
  const existingClassBook = dndData.spellbooksByClass?.[primaryClassId];

  nextState = saveEntityDnD35Data(nextState, actorId, {
    ...dndData,
    knownSpells: nextKnownSpells,
    ...(existingClassBook
      ? {
          spellbooksByClass: {
            ...(dndData.spellbooksByClass ?? {}),
            [primaryClassId]: {
              ...existingClassBook,
              knownSpellIds: Array.from(new Set([...existingClassBook.knownSpellIds, targetSpellId]))
            }
          }
        }
      : {})
  });

  const studyHours = Math.max(1, spellLevel);
  const timeRes = advanceWorldTimeBulk(nextState, studyHours * GLOBAL_TURNS_PER_SCRIBE_HOUR, actorId);
  nextState = timeRes.state;

  nextState = addMessage(
    nextState,
    `${actorName} transcribes ${spellName} into their spellbook (Spellcraft ${totalRoll} vs DC ${dc}, ${studyHours}h study).`,
    MessageLogCategory.System
  );

  return {
    state: nextState,
    success: true,
    transcribedSpellId: targetSpellId,
    totalRoll,
    dc
  };
}
