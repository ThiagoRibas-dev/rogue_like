import { addComponent, getComponent, removeEntity, resolveEntityDisplayName, spawnItem } from '../../../core/ecs.ts';
import { rng } from '../../../core/rng.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
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

/** Declarative tag identifying writing supplies (`ink_vial`, `inkpen`). */
export const WRITING_GEAR_ITEM_TAG = 'writing_gear';

const SCRIBING_PEN_ITEM_TAG = 'scribing_pen';
const SCRIBING_INK_ITEM_TAG = 'scribing_ink';

function itemHasTag(state: Readonly<GameState>, itemEntityId: EntityId, tag: string): boolean {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const itemDef = itemComp ? state.campaign.items[itemComp.itemId] : undefined;
  if (itemDef?.tags.includes(tag)) return true;
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

/**
 * Inspects a slain actor (`casterEntityId`) and, if they have arcane spellbook casting (`spellAcquisitionMode === 'spellbook_scribed'` or `knownSpells`/`preparedSpells`),
 * spawns an inspectable `spellbook`-tagged item at `(x, y)` populated with their castable spells plus
 * rarity-weighted bonus spell rolls scaled by caster level / nemesis boss rank.
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
  const spellbookItemDef = Object.values(state.campaign.items).find((it) => it.tags.includes(SPELLBOOK_ITEM_TAG));
  if (!spellbookItemDef) {
    return { state, storedSpellIds: [] };
  }

  const sys = getDnD35SystemContent(state.campaign);
  const dndData = resolveEntityDnD35Data(state, casterEntityId);
  const spellbookCasterLevels = dndData.tracks
    .filter((t) => {
      const cls = sys?.classes[t.trackId];
      return (
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

  const effectiveCasterLevel = Math.max(1, spellbookCasterLevels, dndData.cr ?? 1);
  const maxSpellLevel = Math.min(9, Math.max(1, Math.ceil(effectiveCasterLevel / 2)));
  const isBossOrNemesis = getComponent(state, casterEntityId, ComponentType.Nemesis) as NemesisComponent | undefined;

  const allWizardSpells = Object.values(sys?.spells ?? {}).filter((sp) => {
    const wizLvl = sp.levelByClass?.['wizard'] ?? sp.level;
    return wizLvl !== undefined && wizLvl <= maxSpellLevel;
  });

  // Always include at least 1 common baseline spell if the caster had no explicit spell list populated
  if (baseCastable.size === 0) {
    for (const sp of allWizardSpells) {
      if (getSpellRarityTier(sp) === 'common' && baseCastable.size < 2) {
        baseCastable.add(sp.id);
      }
    }
  }

  // Roll 1-2 rarity-weighted bonus spells scaled by caster level / boss status
  const bonusRolls = isBossOrNemesis ? 2 : 1;
  const candidatePool = allWizardSpells.filter((sp) => !baseCastable.has(sp.id));
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
  const [afterSpawn, bookEntityId] = spawnItem(state, spellbookItemDef.id, x, y);
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
 * wizard spellbook (`knownSpells` and `spellbooksByClass.wizard.knownSpellIds`) per PHB p. 179:
 * - Requires a carried `inkpen` and `ink_vial` (consumes 1 `ink_vial` charge on success).
 * - Requires a `Spellcraft` check against `DC 15 + spellLevel`.
 * - Advances `globalTurn` by `24` hours (`1` day of study & transcription, or `Math.max(1, spellLevel)` hours).
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

  const dndData = resolveEntityDnD35Data(state, actorId);
  const alreadyKnown = new Set<string>([
    ...(dndData.knownSpells ?? []),
    ...(dndData.spellbooksByClass?.['wizard']?.knownSpellIds ?? [])
  ]);

  const targetSpellId = options?.spellId ?? storedSpells.find((id) => !alreadyKnown.has(id));
  if (!targetSpellId) {
    return {
      state: addMessage(
        state,
        'You have already transcribed every spell recorded in this grimoire.',
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

  const sys = getDnD35SystemContent(state.campaign);
  const spellDef = sys?.spells[targetSpellId];
  const spellLevel = spellDef?.levelByClass?.['wizard'] ?? spellDef?.level ?? 1;
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

  // Record the spell in knownSpells and wizard spellbooksByClass (if present)
  const nextKnownSpells = Array.from(new Set([...(dndData.knownSpells ?? []), targetSpellId]));
  const existingWizardBook = dndData.spellbooksByClass?.['wizard'];

  nextState = saveEntityDnD35Data(nextState, actorId, {
    ...dndData,
    knownSpells: nextKnownSpells,
    ...(existingWizardBook
      ? {
          spellbooksByClass: {
            ...(dndData.spellbooksByClass ?? {}),
            wizard: {
              ...existingWizardBook,
              knownSpellIds: Array.from(new Set([...existingWizardBook.knownSpellIds, targetSpellId]))
            }
          }
        }
      : {})
  });

  const studyHours = Math.max(1, spellLevel);
  nextState = {
    ...nextState,
    globalTurn: nextState.globalTurn + studyHours * GLOBAL_TURNS_PER_SCRIBE_HOUR
  };

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
