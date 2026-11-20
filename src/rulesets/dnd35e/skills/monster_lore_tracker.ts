import { addComponent, getComponent, queryEntities, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import {
  ComponentType,
  type KnowledgeItem,
  type MemoryComponent,
  type TemplateComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { resolveMonsterLoreCheck, TAKE_10_VALUE } from '../skills.ts';
import {
  CREATURE_TYPE_TO_KNOWLEDGE_SKILL,
  evaluateActorSkillCheck,
  resolveEntityDnD35Data
} from './skill_verb_helpers.ts';

/** Knowledge item key prefix used to persist discovered Monster Lore facts on `MemoryComponent.knowledge`. */
export const MONSTER_LORE_KNOWLEDGE_KEY_PREFIX = 'monster_lore:';

/**
 * Builds the canonical list of inspectable mechanical defense/vulnerability traits for a creature
 * (DR bypasses, Spell Resistance, Immunities, Vulnerabilities, Energy Resistances).
 *
 * @param state Current GameState.
 * @param targetEntityId Creature entity ID.
 * @returns Ordered list of `{ value, color }` trait descriptors.
 */
export function collectCreatureLoreTraitDescriptors(
  state: Readonly<GameState>,
  targetEntityId: EntityId
): ReadonlyArray<{ readonly value: string; readonly color: string }> {
  const targetDnd = resolveEntityDnD35Data(state, targetEntityId);
  const traits: Array<{ readonly value: string; readonly color: string }> = [];

  if (targetDnd.damageReduction && targetDnd.damageReduction.amount > 0) {
    const bypassLabel =
      targetDnd.damageReduction.bypassTags.length > 0 ? targetDnd.damageReduction.bypassTags.join(', ') : '-';
    traits.push({
      value: `DR: ${targetDnd.damageReduction.amount}/${bypassLabel}`,
      color: '#e67e22'
    });
  }
  if (targetDnd.spellResistance && targetDnd.spellResistance > 0) {
    traits.push({
      value: `SR: ${targetDnd.spellResistance}`,
      color: '#9b59b6'
    });
  }
  if (targetDnd.immunities && targetDnd.immunities.length > 0) {
    traits.push({
      value: `Immunities: ${targetDnd.immunities.join(', ')}`,
      color: '#2ecc71'
    });
  }
  if (targetDnd.vulnerabilities && targetDnd.vulnerabilities.length > 0) {
    traits.push({
      value: `Vulnerabilities: ${targetDnd.vulnerabilities.join(', ')}`,
      color: '#e74c3c'
    });
  }
  const resistEntries = Object.entries(targetDnd.energyResistance ?? {}).filter(([, val]) => val > 0);
  if (resistEntries.length > 0) {
    traits.push({
      value: `Resistances: ${resistEntries.map(([k, v]) => `${k} ${v}`).join(', ')}`,
      color: '#f1c40f'
    });
  }
  return traits;
}

/**
 * Automatically evaluates a D&D 3.5e Monster Lore check (`Knowledge` `DC 10 + HD/CR`) when `observerEntityId`
 * first sights or inspects `targetEntityId`, persisting any discovered traits onto `observerEntityId`'s
 * `MemoryComponent.knowledge` so they remain permanently unlocked in the HUD and Dossier.
 *
 * @param state Current immutable GameState.
 * @param observerEntityId Observing actor (typically the player).
 * @param targetEntityId Observed monster/NPC entity ID.
 * @param options Optional `forcedD20` roll override (defaults to Take-10 passive or explicit roll).
 * @returns Updated GameState, discovered traits array, and whether the lore check succeeded.
 */
export function evaluateAndRecordMonsterLore(
  state: GameState,
  observerEntityId: EntityId,
  targetEntityId: EntityId,
  options?: {
    readonly forcedD20?: number | undefined;
    readonly announceInLog?: boolean | undefined;
  }
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly revealedTraits: ReadonlyArray<string>;
} {
  const targetDnd = resolveEntityDnD35Data(state, targetEntityId);
  if (!targetDnd.creatureType) {
    return { state, success: false, revealedTraits: [] };
  }

  const templateComp = getComponent(state, targetEntityId, ComponentType.Template) as TemplateComponent | undefined;
  const creatureKey = templateComp?.templateId ?? `${targetDnd.creatureType}_${targetEntityId}`;
  const knowledgeKey = `${MONSTER_LORE_KNOWLEDGE_KEY_PREFIX}${creatureKey}`;

  const existingMemory = getComponent(state, observerEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  const existingEntry = existingMemory?.knowledge[knowledgeKey];
  if (existingEntry && options?.forcedD20 === undefined) {
    return {
      state,
      success: existingEntry.tags.length > 0,
      revealedTraits: existingEntry.tags
    };
  }

  const knowledgeSkillId = CREATURE_TYPE_TO_KNOWLEDGE_SKILL[targetDnd.creatureType] ?? 'knowledge_local';
  const targetChassis = aggregateProgressionChassis(targetDnd.tracks, 0);
  const crOrHd = Math.max(1, targetDnd.cr ?? targetChassis.totalHD);

  const { check } = evaluateActorSkillCheck(state, observerEntityId, knowledgeSkillId, 0, 'take10');
  const isTrained = check.wholeRanks >= 1;
  const rollTotal =
    options?.forcedD20 !== undefined ? options.forcedD20 + check.totalModifier : TAKE_10_VALUE + check.totalModifier;

  const descriptors = collectCreatureLoreTraitDescriptors(state, targetEntityId);
  const typeLabel =
    targetDnd.subtypes && targetDnd.subtypes.length > 0
      ? `Type: ${targetDnd.creatureType} (${targetDnd.subtypes.join(', ')})`
      : `Type: ${targetDnd.creatureType}`;
  const allTraitStrings = [typeLabel, ...descriptors.map((d) => d.value)];

  const loreRes = resolveMonsterLoreCheck(crOrHd, rollTotal, isTrained, allTraitStrings);
  const detailsStr = loreRes.revealedTraits.join(' | ');

  const newKnowledgeItem: KnowledgeItem = {
    id: knowledgeKey,
    type: 'weakness',
    description: detailsStr,
    tags: loreRes.revealedTraits
  };

  let nextState = addComponent(state, observerEntityId, {
    type: ComponentType.Memory,
    grudges: existingMemory?.grudges ?? [],
    factionStandings: existingMemory?.factionStandings ?? {},
    facts: existingMemory?.facts ?? [],
    ...(existingMemory ?? {}),
    knowledge: {
      ...(existingMemory?.knowledge ?? {}),
      [knowledgeKey]: newKnowledgeItem
    }
  });

  if (loreRes.success && options?.announceInLog === true) {
    const targetName = resolveEntityDisplayName(nextState, targetEntityId, creatureKey);
    nextState = addMessage(
      nextState,
      `[Knowledge] You recall lore about ${targetName}: ${loreRes.revealedTraits.join(', ')}.`,
      MessageLogCategory.System
    );
  }

  return {
    state: nextState,
    success: loreRes.success,
    revealedTraits: loreRes.revealedTraits
  };
}

/**
 * Returns any previously persisted Monster Lore traits for `targetEntityId` stored on the player's `MemoryComponent`.
 *
 * @param state Current GameState.
 * @param targetEntityId Creature entity ID.
 * @returns Array of persisted trait strings, or `null` if not yet recorded.
 */
export function getPersistedMonsterLoreTraits(
  state: Readonly<GameState>,
  targetEntityId: EntityId
): ReadonlyArray<string> | null {
  const playerEntityId = queryEntities(state as GameState, [ComponentType.Player])[0];
  if (playerEntityId === undefined) return null;

  const targetDnd = resolveEntityDnD35Data(state as GameState, targetEntityId);
  const templateComp = getComponent(state, targetEntityId, ComponentType.Template) as TemplateComponent | undefined;
  const creatureKey = templateComp?.templateId ?? `${targetDnd.creatureType ?? 'unknown'}_${targetEntityId}`;
  const knowledgeKey = `${MONSTER_LORE_KNOWLEDGE_KEY_PREFIX}${creatureKey}`;

  const memory = getComponent(state, playerEntityId, ComponentType.Memory) as MemoryComponent | undefined;
  const entry = memory?.knowledge[knowledgeKey];
  if (!entry) return null;
  return entry.tags;
}
