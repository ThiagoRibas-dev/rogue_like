import { getComponent } from '../core/ecs.ts';
import { getActiveRuleset } from '../rulesets/registry.ts';
import {
  ComponentType,
  type ActorComponent,
  type TagsComponent,
  type TemplateComponent
} from '../types/components.types.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type { LanguageComprehensionResult } from '../types/ruleset.types.ts';
import { COMPANION_ORDERS_DIALOGUE_ID } from './companion_commands.system.ts';

/** Canonical language identifier shared by default campaign inhabitants unless overridden. */
export const DEFAULT_SHARED_LANGUAGE_ID = 'common';

/** Human-readable display names for canonical fantasy and campaign language identifiers. */
export const LANGUAGE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  common: 'Common',
  elven: 'Elven',
  dwarven: 'Dwarven',
  gnomish: 'Gnome',
  gnome: 'Gnome',
  halfling: 'Halfling',
  orc: 'Orc',
  goblin: 'Goblin',
  giant: 'Giant',
  gnoll: 'Gnoll',
  draconic: 'Draconic',
  sylvan: 'Sylvan',
  undercommon: 'Undercommon',
  abyssal: 'Abyssal',
  infernal: 'Infernal',
  celestial: 'Celestial',
  terran: 'Terran',
  aquan: 'Aquan',
  auran: 'Auran',
  ignan: 'Ignan',
  druidic: 'Druidic',
  thieves_cant: "Thieves' Cant",
  animal_speech: 'Beast Speech',
  plant_speech: 'Verdant Speech',
  dead_speech: 'Whispers of the Dead'
};

interface PhoneticProfile {
  readonly onsets: ReadonlyArray<string>;
  readonly vowels: ReadonlyArray<string>;
  readonly codas: ReadonlyArray<string>;
}

const DEFAULT_PHONETIC_PROFILE: PhoneticProfile = {
  onsets: ['k', 'v', 'th', 's', 'r', 'm', 'n', 'zh', 'dr', 'l'],
  vowels: ['a', 'e', 'i', 'o', 'u', 'ae', 'ou'],
  codas: ['', 'n', 'r', 's', 'th', 'k', 'l', 'sh']
};

const LANGUAGE_PHONETIC_PROFILES: Readonly<Record<string, PhoneticProfile>> = {
  elven: {
    onsets: ['l', 's', 'th', 'v', 'ael', 'sh', 'r', 'n', 'm', 'f'],
    vowels: ['ae', 'ei', 'ia', 'a', 'e', 'i', 'o', 'u'],
    codas: ['', 'l', 'n', 's', 'th', 'r', 'iel']
  },
  dwarven: {
    onsets: ['kh', 'gr', 'th', 'br', 'd', 'k', 'z', 'dr', 'g', 't'],
    vowels: ['a', 'o', 'u', 'au', 'e', 'i'],
    codas: ['k', 'g', 'z', 'd', 'r', 'm', 'rn', '']
  },
  orc: {
    onsets: ['gr', 'kr', 'zg', 'gh', 'br', 'th', 'k', 'g', 'ur', 'dr'],
    vowels: ['a', 'u', 'o', 'aa', 'ou'],
    codas: ['g', 'k', 'kh', 'z', 'sh', 'r', '']
  },
  goblin: {
    onsets: ['sk', 'sn', 'kr', 'z', 'ch', 'kl', 'gr', 't', 'k'],
    vowels: ['i', 'e', 'a', 'u', 'ee'],
    codas: ['k', 't', 'z', 'ch', 'x', '']
  },
  draconic: {
    onsets: ['s', 'v', 'k', 'zh', 'th', 'r', 'x', 'sz', 'dr'],
    vowels: ['a', 'ae', 'ei', 'o', 'u', 'ia'],
    codas: ['x', 's', 'ss', 'r', 'k', 'th', '']
  },
  sylvan: {
    onsets: ['l', 'w', 'f', 'y', 'sh', 'th', 'm', 'n', 'v'],
    vowels: ['ae', 'ie', 'oa', 'a', 'e', 'i', 'y'],
    codas: ['', 'l', 'n', 'w', 'f', 's']
  },
  abyssal: {
    onsets: ['xz', 'khr', 'v', 'zh', 'qr', 'az', 'th', 'sk', 'g'],
    vowels: ['a', 'o', 'u', 'ae', 'ei'],
    codas: ['zh', 'x', 'k', 'th', 'r', 'g', '']
  },
  infernal: {
    onsets: ['v', 'm', 'd', 'zh', 'kr', 's', 't', 'br', 'n'],
    vowels: ['a', 'e', 'i', 'o', 'u', 'ae'],
    codas: ['s', 'x', 'r', 'n', 'th', 'k', '']
  },
  celestial: {
    onsets: ['al', 'el', 's', 'r', 'l', 'th', 'v', 'm', 'h'],
    vowels: ['a', 'e', 'i', 'o', 'ae', 'ia', 'el'],
    codas: ['', 'l', 'n', 'r', 's', 'm']
  },
  animal_speech: {
    onsets: ['gr', 'sn', 'wh', 'ch', 'h', 'b', 'y', 'r', 'k'],
    vowels: ['a', 'u', 'o', 'i', 'ee', 'ou'],
    codas: ['r', 'rr', 'f', 'p', 'k', '']
  },
  plant_speech: {
    onsets: ['sh', 'wh', 'l', 's', 'r', 'w', 'th', 'm'],
    vowels: ['oo', 'a', 'e', 'u', 'ae', 'ou'],
    codas: ['', 'sh', 'l', 'm', 'th', 's']
  },
  dead_speech: {
    onsets: ['h', 'wh', 'sh', 'th', 'm', 'k', 'v', 's'],
    vowels: ['u', 'o', 'a', 'e', 'oo'],
    codas: ['', 'h', 's', 'th', 'n', 'r']
  }
};

const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const MAX_SYLLABLES_PER_WORD = 3;

function hashStringDeterministic(input: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

function nextPseudoRandom(seed: number): number {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function stripWikiMarkupForCipher(text: string): string {
  return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
}

function applyWordCasePattern(sourceWord: string, generated: string): string {
  if (generated.length === 0) return generated;
  if (sourceWord.length > 1 && sourceWord === sourceWord.toUpperCase()) {
    return generated.toUpperCase();
  }
  const firstChar = sourceWord.charAt(0);
  if (firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase()) {
    return generated.charAt(0).toUpperCase() + generated.slice(1);
  }
  return generated;
}

function obfuscateSingleWord(word: string, languageId: string, seedOffset: number): string {
  const profile = LANGUAGE_PHONETIC_PROFILES[languageId.toLowerCase()] ?? DEFAULT_PHONETIC_PROFILE;
  const lower = word.toLowerCase();
  let state = hashStringDeterministic(`${languageId}:${lower}:${seedOffset}`);
  const syllableCount = Math.min(MAX_SYLLABLES_PER_WORD, Math.max(1, Math.ceil(word.length / 3)));

  let out = '';
  for (let s = 0; s < syllableCount; s++) {
    state = nextPseudoRandom(state);
    const onset = profile.onsets[state % profile.onsets.length] ?? 'k';
    state = nextPseudoRandom(state);
    const vowel = profile.vowels[state % profile.vowels.length] ?? 'a';
    out += onset + vowel;
    if (s === syllableCount - 1) {
      state = nextPseudoRandom(state);
      const coda = profile.codas[state % profile.codas.length] ?? '';
      out += coda;
    }
  }
  return applyWordCasePattern(word, out);
}

/**
 * Formats a canonical language ID (e.g. `'elven'`, `'ancient_vaelish'`) into a human-readable label.
 *
 * @param languageId Language identifier.
 * @returns Formatted display name.
 */
export function getLanguageDisplayName(languageId: string): string {
  const normalized = languageId.trim().toLowerCase();
  const known = LANGUAGE_DISPLAY_NAMES[normalized];
  if (known !== undefined) return known;
  return normalized
    .split(/[_-]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

/**
 * Resolves all known language IDs for an actor from `ActorComponent` and `EntityTemplate`.
 *
 * @param state Current readonly GameState.
 * @param entityId Target actor EntityId.
 * @returns Deduplicated array of known language identifiers.
 */
export function getActorKnownLanguages(state: Readonly<GameState>, entityId: EntityId): ReadonlyArray<string> {
  const actor = getComponent(state, entityId, ComponentType.Actor) as ActorComponent | undefined;
  const templateComp = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const template = templateComp ? state.campaign.entities[templateComp.templateId] : undefined;

  const combined: string[] = [];
  const pushLang = (lang: string | undefined): void => {
    if (!lang) return;
    const norm = lang.trim().toLowerCase();
    if (norm.length > 0 && !combined.includes(norm)) {
      combined.push(norm);
    }
  };

  pushLang(actor?.primaryLanguage);
  for (const lang of actor?.languages ?? []) pushLang(lang);
  pushLang(template?.primaryLanguage);
  for (const lang of template?.languages ?? []) pushLang(lang);

  return combined;
}

/**
 * Deterministically obfuscates spoken text into a language-flavored phonetic cipher while
 * preserving punctuation, line breaks, and word capitalization patterns.
 *
 * @param text Original dialogue text (WikiText brackets are flattened first).
 * @param languageId Canonical language identifier driving the phonetic profile.
 * @param seedOffset Optional per-sentence/option seed offset.
 * @returns Deterministically ciphered text.
 */
export function obfuscateDialogueText(text: string, languageId: string, seedOffset = 0): string {
  const plain = stripWikiMarkupForCipher(text);
  return plain.replace(/[A-Za-z]+(?:'[A-Za-z]+)?/g, (token) => {
    const clean = token.replace(/'/g, '');
    return obfuscateSingleWord(clean, languageId, seedOffset);
  });
}

/**
 * Evaluates whether `listenerId` understands `speakerId`'s current dialogue line,
 * delegating to `activeRuleset.evaluateLanguageComprehension` when implemented or using
 * Console language matching (`ActorComponent.languages` / `primaryLanguage`) otherwise.
 *
 * @param state Current readonly GameState.
 * @param listenerId Listener EntityId (typically the player).
 * @param speakerId Speaker EntityId (NPC, creature, or object).
 * @param explicitNodeLanguageId Optional language override declared on the current dialogue node.
 * @param explicitTreeLanguageId Optional language declared on the dialogue tree.
 * @param dialogueTreeId Optional dialogue tree ID (exempts tactical companion orders).
 * @returns Structured comprehension evaluation (`LanguageComprehensionResult`).
 */
export function evaluateActorDialogueComprehension(
  state: Readonly<GameState>,
  listenerId: EntityId,
  speakerId: EntityId,
  explicitNodeLanguageId?: string,
  explicitTreeLanguageId?: string,
  dialogueTreeId?: string
): LanguageComprehensionResult {
  if (
    dialogueTreeId === COMPANION_ORDERS_DIALOGUE_ID &&
    explicitNodeLanguageId === undefined &&
    explicitTreeLanguageId === undefined
  ) {
    return {
      understood: true,
      canSpeakBack: true,
      activeLanguageId: DEFAULT_SHARED_LANGUAGE_ID
    };
  }

  const explicitLanguage = (explicitNodeLanguageId ?? explicitTreeLanguageId)?.trim().toLowerCase();
  const speakerActor = getComponent(state, speakerId, ComponentType.Actor) as ActorComponent | undefined;
  const speakerKnown = getActorKnownLanguages(state, speakerId);
  const effectiveLanguageIds = explicitLanguage
    ? [explicitLanguage]
    : speakerKnown.length > 0
      ? speakerKnown
      : speakerActor?.primaryLanguage
        ? [speakerActor.primaryLanguage.trim().toLowerCase()]
        : [];

  const activeRuleset = getActiveRuleset(state as GameState);
  if (activeRuleset.evaluateLanguageComprehension) {
    return activeRuleset.evaluateLanguageComprehension(state, listenerId, speakerId, effectiveLanguageIds);
  }

  const targetLang = effectiveLanguageIds[0];
  if (!targetLang) {
    return {
      understood: true,
      canSpeakBack: true,
      activeLanguageId: DEFAULT_SHARED_LANGUAGE_ID
    };
  }

  const listenerTags = (getComponent(state, listenerId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  if (
    listenerTags.includes('lang:speak_all') ||
    listenerTags.includes('trait:telepathy') ||
    listenerTags.includes('lang:comprehend_all')
  ) {
    const canSpeak = listenerTags.includes('lang:speak_all') || listenerTags.includes('trait:telepathy');
    return {
      understood: true,
      canSpeakBack: canSpeak,
      activeLanguageId: targetLang,
      comprehendedViaMagic: true,
      comprehensionReason: canSpeak ? 'Translated via Tongues or Telepathy.' : 'Understood via Comprehend Languages.'
    };
  }

  const listenerKnown = getActorKnownLanguages(state, listenerId);
  if (listenerKnown.length === 0 && targetLang === DEFAULT_SHARED_LANGUAGE_ID) {
    return { understood: true, canSpeakBack: true, activeLanguageId: targetLang };
  }

  const understandsTarget = effectiveLanguageIds.some((lang) => listenerKnown.includes(lang));
  if (understandsTarget) {
    return { understood: true, canSpeakBack: true, activeLanguageId: targetLang };
  }

  return {
    understood: false,
    canSpeakBack: false,
    activeLanguageId: targetLang,
    comprehensionReason: `You do not understand ${getLanguageDisplayName(targetLang)}.`
  };
}
