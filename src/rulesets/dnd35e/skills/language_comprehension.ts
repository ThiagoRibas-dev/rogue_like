import { getComponent } from '../../../core/ecs.ts';
import {
  DEFAULT_SHARED_LANGUAGE_ID,
  getActorKnownLanguages,
  getLanguageDisplayName
} from '../../../systems/language.system.ts';
import {
  ComponentType,
  type ActorComponent,
  type FighterComponent,
  type StatusEffectsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { LanguageComprehensionResult } from '../../../types/ruleset.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { getDnD35EntityData } from '../srd_registry.ts';

/** Creature types that cannot speak normal humanoid tongues without specific creature-type magic. */
const NON_VOCAL_CREATURE_TYPES: Readonly<Record<string, string>> = {
  animal: 'animal_speech',
  plant: 'plant_speech',
  vermin: 'animal_speech',
  ooze: 'animal_speech'
};

/** Fallback human-readable plural nouns for non-vocal creature types when no active status display name exists. */
const CREATURE_TYPE_PLURALS: Readonly<Record<string, string>> = {
  animal: 'Animals',
  plant: 'Plants',
  vermin: 'Vermin',
  ooze: 'Oozes',
  undead: 'Dead'
};

function resolveTagComprehensionSourceName(
  state: Readonly<GameState>,
  listenerId: EntityId,
  requiredTag: string,
  fallbackLabel: string
): string {
  const statusComp = getComponent(state, listenerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const matchingEffect = statusComp?.activeEffects.find(
    (effect) => effect.grantedTags?.includes(requiredTag) === true && effect.displayName !== undefined
  );
  if (matchingEffect?.displayName) {
    return matchingEffect.displayName;
  }
  return fallbackLabel;
}

function formatCreatureTypeSpeechFallback(creatureType: string): string {
  const plural =
    CREATURE_TYPE_PLURALS[creatureType] ?? `${creatureType.charAt(0).toUpperCase()}${creatureType.slice(1)}s`;
  return `Speak with ${plural}`;
}

/**
 * Evaluates whether `listenerId` can understand `speakerId` under D&D 3.5e rules:
 * - Animals, plants, vermin, oozes, and mindless/dead undead require declarative creature-type
 *   communication tags (`lang:speak_creature_type:<type>`) such as *Speak with Animals/Plants/Dead*.
 * - Spoken languages check `ActorComponent.languages`, `DnD35EntityData.languages`, and race languages,
 *   plus Layer B spell/trait tags (`lang:speak_all` for *Tongues*, `lang:comprehend_all` for
 *   *Comprehend Languages*, or `trait:telepathy`).
 *
 * @param state Current readonly GameState.
 * @param listenerId Listening actor EntityId.
 * @param speakerId Speaking actor/object EntityId.
 * @param effectiveLanguageIds Explicit dialogue or actor language IDs resolved by Console.
 * @returns Structured comprehension evaluation result.
 */
export function evaluateDnD35eLanguageComprehension(
  state: Readonly<GameState>,
  listenerId: EntityId,
  speakerId: EntityId,
  effectiveLanguageIds: ReadonlyArray<string>
): LanguageComprehensionResult {
  const gameState = state as GameState;
  const listenerDag = evaluateDnD35eEntityDAG(gameState, listenerId);
  const speakerDag = evaluateDnD35eEntityDAG(gameState, speakerId);
  const listenerDnd = listenerDag?.dndData ?? getDnD35EntityData(gameState, listenerId);
  const speakerDnd = speakerDag?.dndData ?? getDnD35EntityData(gameState, speakerId);

  const listenerTags = listenerDag?.selfTags ?? [];
  const speakerTags = speakerDag?.selfTags ?? [];
  const speakerFighter = getComponent(state, speakerId, ComponentType.Fighter) as FighterComponent | undefined;
  const speakerType = speakerDnd.creatureType ?? speakerTags.find((t) => t.startsWith('type:'))?.slice('type:'.length);

  // 1. Dead targets or mindless undead require Speak with Dead (`lang:speak_creature_type:undead`)
  const isSpeakerDead = speakerFighter !== undefined && speakerFighter.hp <= 0;
  const isMindlessUndead = speakerType === 'undead' && speakerDnd.abilityScores?.int?.base === null;
  if (isSpeakerDead || isMindlessUndead) {
    const langId = effectiveLanguageIds[0] ?? 'dead_speech';
    if (listenerTags.includes('lang:speak_creature_type:undead')) {
      return {
        understood: true,
        canSpeakBack: true,
        activeLanguageId: langId,
        comprehendedViaMagic: true,
        comprehensionReason: resolveTagComprehensionSourceName(
          state,
          listenerId,
          'lang:speak_creature_type:undead',
          formatCreatureTypeSpeechFallback('undead')
        )
      };
    }
    return {
      understood: false,
      canSpeakBack: false,
      activeLanguageId: langId,
      comprehensionReason: 'Requires Speak with Dead to commune with the dead.'
    };
  }

  // 2. Non-speaking creature types (Animals, Plants, Vermin, Oozes) unless explicitly intelligent (INT >= 3)
  const speakerInt = speakerDnd.abilityScores?.int?.base ?? null;
  const isIntelligentNonHumanoid =
    speakerInt !== null && speakerInt >= 3 && speakerType !== 'animal' && speakerType !== 'plant';
  const nonVocalLanguage = speakerType !== undefined ? NON_VOCAL_CREATURE_TYPES[speakerType] : undefined;
  if (speakerType !== undefined && nonVocalLanguage !== undefined && !isIntelligentNonHumanoid) {
    const requiredTag = `lang:speak_creature_type:${speakerType}`;
    const langId = effectiveLanguageIds[0] ?? nonVocalLanguage;
    if (listenerTags.includes(requiredTag) || listenerTags.includes('trait:telepathy')) {
      const reason = listenerTags.includes('trait:telepathy')
        ? resolveTagComprehensionSourceName(state, listenerId, 'trait:telepathy', 'Telepathy')
        : resolveTagComprehensionSourceName(
            state,
            listenerId,
            requiredTag,
            formatCreatureTypeSpeechFallback(speakerType)
          );
      return {
        understood: true,
        canSpeakBack: true,
        activeLanguageId: langId,
        comprehendedViaMagic: true,
        comprehensionReason: reason
      };
    }
    return {
      understood: false,
      canSpeakBack: false,
      activeLanguageId: langId,
      comprehensionReason: `You cannot converse with ${speakerType}s without magic.`
    };
  }

  // 3. Spoken language resolution
  const speakerActor = getComponent(state, speakerId, ComponentType.Actor) as ActorComponent | undefined;
  const speakerLanguages = Array.from(
    new Set([
      ...effectiveLanguageIds.map((l) => l.trim().toLowerCase()),
      ...getActorKnownLanguages(state, speakerId),
      ...(speakerDnd.languages ?? []).map((l) => l.trim().toLowerCase())
    ])
  );
  const targetLang =
    effectiveLanguageIds[0]?.trim().toLowerCase() ??
    speakerActor?.primaryLanguage?.trim().toLowerCase() ??
    speakerLanguages[0] ??
    DEFAULT_SHARED_LANGUAGE_ID;

  if (listenerTags.includes('lang:speak_all')) {
    return {
      understood: true,
      canSpeakBack: true,
      activeLanguageId: targetLang,
      comprehendedViaMagic: true,
      comprehensionReason: 'Tongues'
    };
  }

  if (listenerTags.includes('trait:telepathy')) {
    return {
      understood: true,
      canSpeakBack: true,
      activeLanguageId: targetLang,
      comprehendedViaMagic: true,
      comprehensionReason: 'Telepathy'
    };
  }

  const rawListenerLangs = Array.from(
    new Set([
      ...getActorKnownLanguages(state, listenerId),
      ...(listenerDnd.languages ?? []).map((l) => l.trim().toLowerCase())
    ])
  );
  const listenerLangs = rawListenerLangs.length > 0 ? rawListenerLangs : [DEFAULT_SHARED_LANGUAGE_ID];

  const hasDirectMatch =
    effectiveLanguageIds.length > 0
      ? effectiveLanguageIds.some((l) => listenerLangs.includes(l.trim().toLowerCase()))
      : listenerLangs.includes(targetLang) ||
        (speakerLanguages.length > 0 && speakerLanguages.some((l) => listenerLangs.includes(l)));

  if (hasDirectMatch) {
    return {
      understood: true,
      canSpeakBack: true,
      activeLanguageId: targetLang
    };
  }

  if (listenerTags.includes('lang:comprehend_all')) {
    return {
      understood: true,
      canSpeakBack: false,
      activeLanguageId: targetLang,
      comprehendedViaMagic: true,
      comprehensionReason: 'Comprehend Languages'
    };
  }

  return {
    understood: false,
    canSpeakBack: false,
    activeLanguageId: targetLang,
    comprehensionReason: `You do not speak ${getLanguageDisplayName(targetLang)}.`
  };
}
