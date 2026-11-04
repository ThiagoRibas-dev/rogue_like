import { rng } from '../../core/rng.ts';
import { rollD20 } from './math/dice.ts';
import { dndFloor } from './math/multipliers.ts';
import { appendSourcePath, resolveTypedModifiers } from './modifiers.ts';
import { evaluateEffectBundle } from './srd_registry.ts';
import type { AbilityId, StatModifier } from './types/dnd35e.types.ts';
import type { DnD35SkillDefinition } from './types/dnd35e_system.types.ts';
import type { AttitudeTier } from '../../types/components.types.ts';

/** Minimum whole ranks required in a source skill to grant a +2 Synergy bonus. */
export const SYNERGY_REQUIRED_RANKS = 5;

/** Untyped bonus granted per qualifying 5-rank skill synergy (`+2`). */
export const SYNERGY_BONUS_AMOUNT = 2;

/** Minimum whole ranks at which epic additional synergy increments begin (`25`). */
export const EPIC_SYNERGY_INITIAL_RANKS = 25;

/** Rank interval for each additional +2 epic synergy bonus above 5 ranks (`20`). */
export const EPIC_SYNERGY_INTERVAL_RANKS = 20;

/** Offset added to Total Hit Dice for maximum class skill ranks (`HD + 3`). */
export const CLASS_SKILL_RANK_CAP_OFFSET = 3;

/** Fixed d20 substitute value when Taking 10. */
export const TAKE_10_VALUE = 10;

/** Fixed d20 substitute value when Taking 20. */
export const TAKE_20_VALUE = 20;

/** Action duration multiplier when Taking 20 (`20x` standard duration). */
export const TAKE_20_DURATION_MULTIPLIER = 20;

/** Deterministic RNG threshold for 50/50 tie-breaking when opposed check totals and modifiers are equal. */
export const OPPOSED_CHECK_TIE_COIN_FLIP_THRESHOLD = 0.5;

/** Diplomacy DC to shift Hostile -> Unfriendly (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_UNFRIENDLY_DC = 20;

/** Diplomacy DC to shift Hostile -> Indifferent (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_INDIFFERENT_DC = 25;

/** Diplomacy DC to shift Hostile -> Friendly (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_FRIENDLY_DC = 35;

/** Diplomacy DC to shift Hostile -> Helpful (PHB p. 72). */
export const DIPLOMACY_HOSTILE_TO_HELPFUL_DC = 50;

/** Diplomacy DC to shift Unfriendly -> Indifferent (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_INDIFFERENT_DC = 15;

/** Diplomacy DC to shift Unfriendly -> Friendly (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_FRIENDLY_DC = 25;

/** Diplomacy DC to shift Unfriendly -> Helpful (PHB p. 72). */
export const DIPLOMACY_UNFRIENDLY_TO_HELPFUL_DC = 40;

/** Diplomacy DC to shift Indifferent -> Friendly (PHB p. 72). */
export const DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC = 15;

/** Diplomacy DC to shift Indifferent -> Helpful (PHB p. 72). */
export const DIPLOMACY_INDIFFERENT_TO_HELPFUL_DC = 30;

/** Diplomacy DC to shift Friendly -> Helpful (PHB p. 72). */
export const DIPLOMACY_FRIENDLY_TO_HELPFUL_DC = 20;

/** Base DC offset (`10 + CR/HD`) for Monster Lore Knowledge checks (PHB p. 78). */
export const MONSTER_LORE_BASE_DC = 10;

/** Maximum effective check result for an untrained Knowledge check (PHB p. 78). */
export const MONSTER_LORE_UNTRAINED_MAX_CAP = 10;

/** Margin interval (`5` points above DC) granting an additional piece of Monster Lore info. */
export const MONSTER_LORE_REVEAL_INTERVAL = 5;

/** Standard DC (`15`) for Heal First Aid and Long-Term Care checks (PHB p. 75). */
export const HEAL_SKILL_STANDARD_DC = 15;

/** Base DC (`15 + spellLevel`) to identify a spell being cast with Spellcraft (PHB p. 82). */
export const SPELLCRAFT_IDENTIFY_CASTING_BASE_DC = 15;

/** Base DC (`20 + spellLevel`) to decipher a scroll or identify an active aura with Spellcraft (PHB p. 82). */
export const SPELLCRAFT_DECIPHER_OR_AURA_BASE_DC = 20;

/** Trap Search / Disable Device DC threshold (`20`) above which the Trapfinding feature is required. */
export const TRAPFINDING_REQUIRED_MIN_DC = 20;

/** Failure margin (`-5` or worse) on Disable Device that accidentally springs the trap (PHB p. 72). */
export const DISABLE_DEVICE_MISHAP_MARGIN = -5;

/** Default Simple Lock DC (`20`) for Open Lock checks when no custom difficulty is specified (PHB p. 79). */
export const OPEN_LOCK_DEFAULT_SIMPLE_DC = 20;

/** Use Magic Device DC (`20`) to activate a wand (PHB p. 85). */
export const UMD_ACTIVATE_WAND_DC = 20;

/** Bluff Feint penalty (`-4`) against a creature of a different body morphology / non-humanoid (PHB p. 68). */
export const FEINT_NON_HUMANOID_PENALTY = -4;

/** Bluff Feint penalty (`-8`) against a creature of animal intelligence (Int 1 or 2) (PHB p. 68). */
export const FEINT_ANIMAL_INTELLIGENCE_PENALTY = -8;

/**Declarative definition of a D&D 3.5e skill for check resolution. */
export interface SkillCheckDefinition {
  readonly skillId: string;
  readonly keyAbility: AbilityId;
  readonly trainedOnly: boolean;
  readonly acpMultiplier: 0 | 1 | 2;
  readonly synergyFromSkills: ReadonlyArray<string>;
  readonly take10Allowed?: boolean;
  readonly take20Allowed?: boolean;
}

/** Input parameters for `resolveSkillCheck`. */
export interface SkillCheckParams {
  readonly definition: SkillCheckDefinition;
  readonly rawRanks: number;
  readonly allSkillRanks: Readonly<Record<string, number>>;
  readonly keyAbilityModifier: number;
  readonly armorCheckPenalty: number;
  readonly modifiers?: ReadonlyArray<StatModifier>;
  readonly dc: number;
  readonly takeMode?: 'roll' | 'take10' | 'take20';
  readonly isThreatenedOrDistracted?: boolean;
  readonly carriesPenaltyOnFailure?: boolean;
  readonly forcedNaturalRoll?: number;
}

/** Result of a resolved Skill Check or Ability Check. */
export interface SkillCheckResult {
  readonly allowed: boolean;
  readonly blockedReason?: string;
  readonly naturalRoll: number;
  readonly wholeRanks: number;
  readonly synergyBonus: number;
  readonly acpApplied: number;
  readonly totalModifier: number;
  readonly totalRoll: number;
  readonly dc: number;
  readonly success: boolean;
  readonly durationMultiplier: number;
}

/**
 * Computes maximum allowed skill ranks for a class skill (`HD + 3`) vs. cross-class skill (`(HD + 3) / 2`).
 *
 * @param totalHD Entity's total Hit Dice ($\ge 1$).
 * @param isClassSkill True if the skill is a class skill for any of the entity's classes.
 * @returns Maximum rank cap (`number`, allowing `.5` for cross-class).
 */
export function computeMaxSkillRankCap(totalHD: number, isClassSkill: boolean): number {
  const maxClassRanks = Math.max(1, dndFloor(totalHD)) + CLASS_SKILL_RANK_CAP_OFFSET;
  return isClassSkill ? maxClassRanks : maxClassRanks / 2;
}

/**
 * Computes the total untyped Synergy bonus (`+2` per qualifying source skill with $\lfloor \text{ranks} \rfloor \ge 5$).
 *
 * @param synergyFromSkills List of source skill IDs that grant synergy to this check.
 * @param allSkillRanks Entity's skill rank map.
 * @returns Total synergy bonus ($\ge 0$).
 */
export function computeSkillSynergyBonus(
  synergyFromSkills: ReadonlyArray<string>,
  allSkillRanks: Readonly<Record<string, number>>
): number {
  let bonus = 0;
  for (const sourceSkillId of synergyFromSkills) {
    const raw = allSkillRanks[sourceSkillId] ?? 0;
    const whole = dndFloor(raw);
    if (whole >= SYNERGY_REQUIRED_RANKS) {
      bonus += SYNERGY_BONUS_AMOUNT;
      if (whole >= EPIC_SYNERGY_INITIAL_RANKS) {
        bonus += Math.floor((whole - SYNERGY_REQUIRED_RANKS) / EPIC_SYNERGY_INTERVAL_RANKS) * SYNERGY_BONUS_AMOUNT;
      }
    }
  }
  return bonus;
}

/**
 * Finds all skills in a skill registry that receive a synergy bonus from the specified source skill.
 * @param sourceSkillId The source skill providing synergy.
 * @param skillRegistry Loaded skill definitions map.
 * @returns List of target skill IDs that list sourceSkillId in their synergyFromSkills.
 */
export function getSkillsGrantedSynergyBy(
  sourceSkillId: string,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<string> {
  const results: string[] = [];
  for (const [targetId, def] of Object.entries(skillRegistry)) {
    if (def.synergyFromSkills.includes(sourceSkillId)) {
      results.push(targetId);
    }
  }
  return results;
}

/**
 * Builds passive/conditional StatModifiers unlocked by skill rank thresholds (e.g. 5+ ranks in Tumble
 * granting +1 dodge AC when fighting defensively or using total defense).
 *
 * @param allSkillRanks Entity's skill rank map.
 * @param skillRegistry Loaded D&D 3.5e skill definitions.
 * @returns Array of unlocked `StatModifier` entries with `sourcePath: "skill:<id>/threshold:<minRanks>/<modId>"`.
 */
export function buildSkillRankThresholdModifiers(
  allSkillRanks: Readonly<Record<string, number>>,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): ReadonlyArray<StatModifier> {
  const modifiers: StatModifier[] = [];
  for (const [skillId, rawRanks] of Object.entries(allSkillRanks)) {
    const wholeRanks = dndFloor(Math.max(0, rawRanks));
    if (wholeRanks < 1) continue;
    const skillDef = skillRegistry[skillId];
    if (!skillDef || skillDef.rankThresholdModifiers.length === 0) continue;
    for (const entry of skillDef.rankThresholdModifiers) {
      if (wholeRanks < entry.minRanks) continue;
      const rootPath = appendSourcePath(`skill:${skillDef.id}`, `threshold:${entry.minRanks}`);
      for (const mod of entry.modifiers) {
        modifiers.push({
          targetStat: mod.target,
          value: mod.value,
          bonusType: mod.type,
          sourceId: `skill:${skillDef.id}:${mod.id}`,
          sourcePath: appendSourcePath(rootPath, mod.id),
          origin: 'ex',
          ...(mod.condition !== undefined ? { condition: mod.condition } : {})
        });
      }
      if (entry.effectBundle) {
        const evalResult = evaluateEffectBundle(entry.effectBundle, rootPath);
        modifiers.push(...evalResult.statModifiers);
      }
    }
  }
  return modifiers;
}

/**
 * Result of evaluating unlocked skill rank threshold effects across all skills.
 */
export interface SkillRankThresholdEffectsResult {
  readonly statModifiers: ReadonlyArray<StatModifier>;
  readonly grantedTags: ReadonlyArray<string>;
}

/**
 * Evaluates all unlocked passive stat modifiers and semantic tags granted by skill rank thresholds
 * (e.g., 5 ranks in Balance granting "trait:balance_uncanny_flat_footed", 5 ranks in Tumble granting "trait:tumble_acrobatic_defense").
 *
 * @param allSkillRanks Entity's skill rank map.
 * @param skillRegistry Loaded D&D 3.5e skill definitions.
 * @returns Combined modifiers and grantedTags.
 */
export function evaluateSkillRankThresholdEffects(
  allSkillRanks: Readonly<Record<string, number>>,
  skillRegistry: Readonly<Record<string, DnD35SkillDefinition>>
): SkillRankThresholdEffectsResult {
  const statModifiers = buildSkillRankThresholdModifiers(allSkillRanks, skillRegistry);
  const grantedTags = new Set<string>();

  for (const [skillId, rawRanks] of Object.entries(allSkillRanks)) {
    const wholeRanks = dndFloor(Math.max(0, rawRanks));
    if (wholeRanks < 1) continue;
    const skillDef = skillRegistry[skillId];
    if (!skillDef) continue;

    for (const entry of skillDef.rankThresholdModifiers) {
      if (wholeRanks < entry.minRanks) continue;
      for (const tag of entry.grantedTags ?? []) {
        grantedTags.add(tag);
      }
      if (entry.effectBundle) {
        const rootPath = appendSourcePath(`skill:${skillDef.id}`, `threshold:${entry.minRanks}`);
        const evalResult = evaluateEffectBundle(entry.effectBundle, rootPath);
        for (const tag of evalResult.grantedTags) {
          grantedTags.add(tag);
        }
      }
    }
  }

  return {
    statModifiers,
    grantedTags: Array.from(grantedTags)
  };
}

/**
 * Resolves a D&D 3.5e Skill Check with support for half-rank rounding ($\lfloor \text{ranks} \rfloor$),
 * `trainedOnly` gating, 5-rank `+2` synergy, `acpMultiplier` (`0 | 1 | 2`, e.g. Swim's `2x ACP`),
 * and `Take 10 / Take 20` validation.
 * Note: Skill checks NEVER auto-fail on a natural 1 or auto-succeed on a natural 20.
 *
 * @param params Structured `SkillCheckParams`.
 * @returns Complete `SkillCheckResult`.
 */
export function resolveSkillCheck(params: SkillCheckParams): SkillCheckResult {
  const wholeRanks = dndFloor(Math.max(0, params.rawRanks));

  if (params.definition.trainedOnly && wholeRanks < 1) {
    return {
      allowed: false,
      blockedReason: 'untrained_in_trained_only_skill',
      naturalRoll: 0,
      wholeRanks,
      synergyBonus: 0,
      acpApplied: 0,
      totalModifier: 0,
      totalRoll: 0,
      dc: params.dc,
      success: false,
      durationMultiplier: 1
    };
  }

  const takeMode = params.takeMode ?? 'roll';
  if (takeMode === 'take10') {
    if (
      params.isThreatenedOrDistracted === true ||
      params.definition.skillId === 'use_magic_device' ||
      params.definition.take10Allowed === false
    ) {
      return {
        allowed: false,
        blockedReason: 'take_10_prohibited',
        naturalRoll: 0,
        wholeRanks,
        synergyBonus: 0,
        acpApplied: 0,
        totalModifier: 0,
        totalRoll: 0,
        dc: params.dc,
        success: false,
        durationMultiplier: 1
      };
    }
  } else if (takeMode === 'take20') {
    if (
      params.isThreatenedOrDistracted === true ||
      params.carriesPenaltyOnFailure === true ||
      params.definition.skillId === 'use_magic_device' ||
      params.definition.take20Allowed === false
    ) {
      return {
        allowed: false,
        blockedReason: 'take_20_prohibited',
        naturalRoll: 0,
        wholeRanks,
        synergyBonus: 0,
        acpApplied: 0,
        totalModifier: 0,
        totalRoll: 0,
        dc: params.dc,
        success: false,
        durationMultiplier: 1
      };
    }
  }

  const synergyBonus = computeSkillSynergyBonus(params.definition.synergyFromSkills, params.allSkillRanks);
  const acpPenaltyMagnitude = Math.abs(params.armorCheckPenalty) * params.definition.acpMultiplier;
  const acpApplied = -acpPenaltyMagnitude;
  const typedBonusSum = params.modifiers ? resolveTypedModifiers(params.modifiers) : 0;

  const totalModifier = wholeRanks + params.keyAbilityModifier + synergyBonus + typedBonusSum + acpApplied;

  let naturalRoll: number;
  let durationMultiplier = 1;
  if (takeMode === 'take10') {
    naturalRoll = TAKE_10_VALUE;
  } else if (takeMode === 'take20') {
    naturalRoll = TAKE_20_VALUE;
    durationMultiplier = TAKE_20_DURATION_MULTIPLIER;
  } else {
    naturalRoll = rollD20('skill_check', totalModifier, params.forcedNaturalRoll).naturalRoll;
  }

  const totalRoll = naturalRoll + totalModifier;
  return {
    allowed: true,
    naturalRoll,
    wholeRanks,
    synergyBonus,
    acpApplied,
    totalModifier,
    totalRoll,
    dc: params.dc,
    success: totalRoll >= params.dc,
    durationMultiplier
  };
}

/**
 * Resolves a symmetric Opposed Check between an initiator and a defender.
 * Ties are broken first by highest total modifier, and if still tied, by a deterministic
 * coin flip (`rng.getUniform() < 0.5`).
 *
 * @param actorAModifier Total check modifier for Actor A.
 * @param actorBModifier Total check modifier for Actor B.
 * @param forcedRolls Optional deterministic roll overrides `{ rollA, rollB }`.
 * @returns `{ winner: 'A' | 'B', totalA: number, totalB: number, rollA: number, rollB: number }`.
 */
export function resolveOpposedCheck(
  actorAModifier: number,
  actorBModifier: number,
  forcedRolls?: { readonly rollA: number; readonly rollB: number }
): {
  readonly winner: 'A' | 'B';
  readonly totalA: number;
  readonly totalB: number;
  readonly rollA: number;
  readonly rollB: number;
} {
  const d20A = rollD20('skill_check', actorAModifier, forcedRolls?.rollA);
  const d20B = rollD20('skill_check', actorBModifier, forcedRolls?.rollB);

  let winner: 'A' | 'B';
  if (d20A.total > d20B.total) {
    winner = 'A';
  } else if (d20B.total > d20A.total) {
    winner = 'B';
  } else if (actorAModifier > actorBModifier) {
    winner = 'A';
  } else if (actorBModifier > actorAModifier) {
    winner = 'B';
  } else {
    winner = rng.getUniform() < OPPOSED_CHECK_TIE_COIN_FLIP_THRESHOLD ? 'A' : 'B';
  }

  return {
    winner,
    totalA: d20A.total,
    totalB: d20B.total,
    rollA: d20A.naturalRoll,
    rollB: d20B.naturalRoll
  };
}

/**
 * Result of resolving a D&D 3.5e Diplomacy check to adjust an NPC's attitude.
 */
export interface DiplomacyResult {
  readonly initialAttitude: AttitudeTier;
  readonly newAttitude: AttitudeTier;
  readonly rollTotal: number;
  readonly changed: boolean;
}

/**
 * Resolves a D&D 3.5e Diplomacy check to influence an NPC's attitude according to
 * the 5-tier standard progression (PHB p. 72).
 *
 * @param initialAttitude Current AttitudeTier of the target.
 * @param checkRollTotal Total Diplomacy skill check roll.
 * @returns Resulting DiplomacyResult with updated AttitudeTier.
 */
export function resolveDiplomacyCheck(initialAttitude: AttitudeTier, checkRollTotal: number): DiplomacyResult {
  const normalizedInitial: 'hostile' | 'unfriendly' | 'indifferent' | 'friendly' | 'helpful' =
    initialAttitude === 'neutral' ? 'indifferent' : initialAttitude;

  let newAttitude: AttitudeTier = normalizedInitial;

  switch (normalizedInitial) {
    case 'hostile':
      if (checkRollTotal >= DIPLOMACY_HOSTILE_TO_HELPFUL_DC) newAttitude = 'helpful';
      else if (checkRollTotal >= DIPLOMACY_HOSTILE_TO_FRIENDLY_DC) newAttitude = 'friendly';
      else if (checkRollTotal >= DIPLOMACY_HOSTILE_TO_INDIFFERENT_DC) newAttitude = 'indifferent';
      else if (checkRollTotal >= DIPLOMACY_HOSTILE_TO_UNFRIENDLY_DC) newAttitude = 'unfriendly';
      else newAttitude = 'hostile';
      break;
    case 'unfriendly':
      if (checkRollTotal >= DIPLOMACY_UNFRIENDLY_TO_HELPFUL_DC) newAttitude = 'helpful';
      else if (checkRollTotal >= DIPLOMACY_UNFRIENDLY_TO_FRIENDLY_DC) newAttitude = 'friendly';
      else if (checkRollTotal >= DIPLOMACY_UNFRIENDLY_TO_INDIFFERENT_DC) newAttitude = 'indifferent';
      else newAttitude = 'unfriendly';
      break;
    case 'indifferent':
      if (checkRollTotal >= DIPLOMACY_INDIFFERENT_TO_HELPFUL_DC) newAttitude = 'helpful';
      else if (checkRollTotal >= DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC) newAttitude = 'friendly';
      else newAttitude = 'indifferent';
      break;
    case 'friendly':
      if (checkRollTotal >= DIPLOMACY_FRIENDLY_TO_HELPFUL_DC) newAttitude = 'helpful';
      else newAttitude = 'friendly';
      break;
    case 'helpful':
      newAttitude = 'helpful';
      break;
  }

  return {
    initialAttitude,
    newAttitude,
    rollTotal: checkRollTotal,
    changed: newAttitude !== initialAttitude
  };
}

/**
 * Result of a D&D 3.5e Monster Lore knowledge check (PHB p. 78).
 */
export interface MonsterLoreResult {
  readonly success: boolean;
  readonly baseDc: number;
  readonly rollTotal: number;
  readonly piecesOfUsefulInfo: number;
  readonly revealedTraits: ReadonlyArray<string>;
}

/**
 * Resolves a D&D 3.5e Knowledge check to identify a monster and remember its vulnerabilities/defenses.
 * DC = 10 + creature's HD (or CR). Every 5 points by which the check beats the DC yields another piece of useful information.
 * An untrained check cannot exceed 10.
 *
 * @param creatureCrOrHd Creature's CR or HD.
 * @param checkRollTotal Total Knowledge check roll (already rolled or Take 10).
 * @param isTrained True if the actor has >= 1 rank in the matching Knowledge skill.
 * @param creatureTraits Known traits or features of the creature to reveal.
 * @returns Resulting MonsterLoreResult.
 */
export function resolveMonsterLoreCheck(
  creatureCrOrHd: number,
  checkRollTotal: number,
  isTrained: boolean,
  creatureTraits: ReadonlyArray<string> = []
): MonsterLoreResult {
  const baseDc = MONSTER_LORE_BASE_DC + Math.max(1, dndFloor(creatureCrOrHd));
  const effectiveRoll = isTrained ? checkRollTotal : Math.min(MONSTER_LORE_UNTRAINED_MAX_CAP, checkRollTotal);
  if (effectiveRoll < baseDc) {
    return {
      success: false,
      baseDc,
      rollTotal: effectiveRoll,
      piecesOfUsefulInfo: 0,
      revealedTraits: []
    };
  }

  const margin = effectiveRoll - baseDc;
  const piecesOfUsefulInfo = 1 + Math.floor(margin / MONSTER_LORE_REVEAL_INTERVAL);
  const revealedTraits = creatureTraits.slice(0, piecesOfUsefulInfo);

  return {
    success: true,
    baseDc,
    rollTotal: effectiveRoll,
    piecesOfUsefulInfo,
    revealedTraits
  };
}

/**
 * Resolves a D&D 3.5e Heal skill check for First Aid (stabilize dying) or Long-Term Care (PHB p. 75).
 * - First Aid: DC 15 standard action stabilizes a creature at negative HP.
 * - Long-Term Care: DC 15 restores double natural healing rate over 8 hours rest.
 *
 * @param checkRollTotal Total Heal skill check result.
 * @param dc Target DC (default 15).
 * @returns True if successful.
 */
export function resolveHealSkillCheck(checkRollTotal: number, dc = HEAL_SKILL_STANDARD_DC): boolean {
  return checkRollTotal >= dc;
}

/**
 * Resolves a D&D 3.5e Spellcraft check to identify a spell being cast or an active dweomer.
 * - Identify spell being cast: DC 15 + spell level.
 * - Decipher scroll or identify ongoing magical aura: DC 20 + spell level.
 *
 * @param checkRollTotal Total Spellcraft roll.
 * @param spellLevel Spell level (0..9).
 * @param isDecipherOrAura True for ongoing aura / scroll deciphering (DC 20 + level) vs casting (DC 15 + level).
 * @returns True if identified.
 */
export function resolveSpellcraftCheck(checkRollTotal: number, spellLevel: number, isDecipherOrAura = false): boolean {
  const baseDc = isDecipherOrAura ? SPELLCRAFT_DECIPHER_OR_AURA_BASE_DC : SPELLCRAFT_IDENTIFY_CASTING_BASE_DC;
  const dc = baseDc + Math.max(0, dndFloor(spellLevel));
  return checkRollTotal >= dc;
}

/**
 * Resolves an active Search check to discover a trap or secret door.
 * Note: Non-rogues cannot detect traps with Search DC > 20 unless they possess the Trapfinding feature.
 *
 * @param checkRollTotal Search check total.
 * @param trapDc Search DC of the trap.
 * @param hasTrapfinding True if the searcher has the Trapfinding class feature.
 * @returns True if the trap was spotted.
 */
export function resolveTrapSearchCheck(checkRollTotal: number, trapDc: number, hasTrapfinding: boolean): boolean {
  if (trapDc > TRAPFINDING_REQUIRED_MIN_DC && !hasTrapfinding) {
    return false;
  }
  return checkRollTotal >= trapDc;
}

/**
 * Resolves a Disable Device check to disarm a trap.
 * Note: Non-rogues cannot disarm traps with DC > 20 or magic traps without Trapfinding.
 * If the check fails by 5 or more, the trap is accidentally sprung!
 *
 * @param checkRollTotal Disable Device check total.
 * @param trapDc Disable DC of the trap.
 * @param isMagicTrap True if the trap is magical.
 * @param hasTrapfinding True if the actor has the Trapfinding feature.
 * @returns `{ success: boolean, triggeredTrap: boolean, margin: number }`.
 */
export function resolveDisableTrapCheck(
  checkRollTotal: number,
  trapDc: number,
  isMagicTrap: boolean,
  hasTrapfinding: boolean
): { readonly success: boolean; readonly triggeredTrap: boolean; readonly margin: number } {
  if ((trapDc > TRAPFINDING_REQUIRED_MIN_DC || isMagicTrap) && !hasTrapfinding) {
    return {
      success: false,
      triggeredTrap: true,
      margin: checkRollTotal - trapDc
    };
  }

  const margin = checkRollTotal - trapDc;
  if (margin >= 0) {
    return { success: true, triggeredTrap: false, margin };
  }

  // Failing by 5 or more triggers the trap!
  const triggeredTrap = margin <= DISABLE_DEVICE_MISHAP_MARGIN;
  return { success: false, triggeredTrap, margin };
}

/**
 * Resolves an Intimidate check to Demoralize an Opponent in Combat (PHB p. 76).
 * Opposed by target's 1d20 + Character Level or Hit Dice + Target Wisdom modifier (+ target fear save bonuses).
 * On success, target is Shaken (-2 on attacks, saves, checks) for 1 round.
 *
 * @param initiatorIntimidateTotal Total Intimidate check.
 * @param targetLevelOrHd Target's total HD or character level.
 * @param targetWisModifier Target's Wisdom modifier.
 * @param targetSaveBonus Target's bonus on saving throws against fear.
 * @returns True if demoralize succeeds.
 */
export function resolveDemoralizeCheck(
  initiatorIntimidateTotal: number,
  targetLevelOrHd: number,
  targetWisModifier: number,
  targetSaveBonus = 0
): boolean {
  const defenderRoll = rollD20('skill_check', targetLevelOrHd + targetWisModifier + targetSaveBonus);
  return initiatorIntimidateTotal >= defenderRoll.total;
}

/**
 * Resolves a Feint in Combat (Bluff vs Sense Motive) (PHB p. 68).
 * Opposed by target's 1d20 + Sense Motive modifier (or 1d20 + target BAB + target Wis mod if higher).
 * On success, the target is denied their Dexterity bonus to AC against the feinter's next melee attack.
 *
 * @param feinterBluffTotal Feinter's Bluff check total.
 * @param targetSenseMotiveTotal Target's Sense Motive check modifier.
 * @param targetBab Target's Base Attack Bonus.
 * @param targetWisMod Target's Wisdom modifier.
 * @returns True if the target was successfully feinted.
 */
export function resolveFeintCheck(
  feinterBluffTotal: number,
  targetSenseMotiveTotal: number,
  targetBab: number,
  targetWisMod: number
): boolean {
  const defenderMod = Math.max(targetSenseMotiveTotal, targetBab + targetWisMod);
  const defenderRoll = rollD20('skill_check', defenderMod);
  return feinterBluffTotal >= defenderRoll.total;
}

/**
 * Resolves an Open Lock check with thieves' tools (PHB p. 79).
 * Requires thieves' tools (or takes -2 circumstance penalty for improvised tools).
 * Trained only skill.
 *
 * @param checkRollTotal Open Lock check total.
 * @param lockDc Lock DC (Simple = 20, Average = 25, Good = 30, Amazing = 40).
 * @returns True if lock is successfully picked.
 */
export function resolveOpenLockCheck(checkRollTotal: number, lockDc: number): boolean {
  return checkRollTotal >= lockDc;
}
