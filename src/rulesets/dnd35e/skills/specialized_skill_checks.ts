import type { AttitudeTier } from '../../../types/components.types.ts';
import { rollD20 } from '../math/dice.ts';
import { dndFloor } from '../math/multipliers.ts';
import {
  DIPLOMACY_FRIENDLY_TO_HELPFUL_DC,
  DIPLOMACY_HOSTILE_TO_FRIENDLY_DC,
  DIPLOMACY_HOSTILE_TO_HELPFUL_DC,
  DIPLOMACY_HOSTILE_TO_INDIFFERENT_DC,
  DIPLOMACY_HOSTILE_TO_UNFRIENDLY_DC,
  DIPLOMACY_INDIFFERENT_TO_FRIENDLY_DC,
  DIPLOMACY_INDIFFERENT_TO_HELPFUL_DC,
  DIPLOMACY_UNFRIENDLY_TO_FRIENDLY_DC,
  DIPLOMACY_UNFRIENDLY_TO_HELPFUL_DC,
  DIPLOMACY_UNFRIENDLY_TO_INDIFFERENT_DC,
  DISABLE_DEVICE_MISHAP_MARGIN,
  HEAL_SKILL_STANDARD_DC,
  MONSTER_LORE_BASE_DC,
  MONSTER_LORE_REVEAL_INTERVAL,
  MONSTER_LORE_UNTRAINED_MAX_CAP,
  SPELLCRAFT_DECIPHER_OR_AURA_BASE_DC,
  SPELLCRAFT_IDENTIFY_CASTING_BASE_DC,
  TRAPFINDING_REQUIRED_MIN_DC
} from './skill_constants.ts';

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
