import { measureDnD35DistanceFt } from './grid_geometry.ts';
import type { CoverState, IlluminationLevel, SensoryProfile } from '../types/dnd35e.types.ts';

/** AC bonus granted by Standard Cover or Soft Cover (`+4`). */
const STANDARD_COVER_AC_BONUS = 4;

/** AC bonus granted by Improved Cover (`+8`). */
const IMPROVED_COVER_AC_BONUS = 8;

/** Reflex save bonus granted by Standard Cover (`+2`). */
const STANDARD_COVER_REFLEX_BONUS = 2;

/** Reflex save bonus granted by Improved Cover (`+4`). */
const IMPROVED_COVER_REFLEX_BONUS = 4;

/** Melee attack bonus granted when Flanking a target (`+2`). */
export const FLANKING_ATTACK_BONUS = 2;

/** Penalty applied to ranged attacks fired into melee without Precise Shot (`-4`). */
export const SHOOTING_INTO_MELEE_PENALTY = -4;

/** Concealment miss chance percentage in shadowy illumination (`20%`). */
export const CONCEALMENT_MISS_CHANCE_PERCENT = 20;

/** Total Concealment miss chance percentage in darkness or against invisible foes (`50%`). */
export const TOTAL_CONCEALMENT_MISS_CHANCE_PERCENT = 50;

/** Distance in feet within which Scent automatically pinpoints a target (`5 ft`). */
const SCENT_PINPOINT_RANGE_FT = 5;

/** Result of evaluating Cover, Soft Cover, and Line of Effect between two squares. */
export interface CoverEvaluationResult {
  readonly coverState: CoverState;
  readonly acBonus: number;
  readonly reflexBonus: number;
  readonly blocksAoO: boolean;
  readonly blocksLineOfEffect: boolean;
}

/**
 * Traces a supercover Bresenham line between `(x1, y1)` and `(x2, y2)` to evaluate
 * Total Cover, Improved Cover, Standard Cover, Soft Cover, and AoO suppression:
 * - Standard Cover (`+4` AC, `+2` Reflex) and Improved Cover (`+8` AC, `+4` Reflex)
 *   **prohibit executing Attacks of Opportunity** against the covered target.
 * - Soft Cover (`+4` AC vs. ranged attacks from intervening creatures) grants no Reflex
 *   save bonus and does NOT block AoOs.
 *
 * @param attackerPos Attacker `{ x, y }` coordinate.
 * @param targetPos Target `{ x, y }` coordinate.
 * @param isWallAt Predicate returning `true` if `(x, y)` blocks Line of Effect.
 * @param hasInterveningCreatureAt Optional predicate returning `true` if a creature occupies `(x, y)`.
 * @param isRangedAttack Whether the evaluation is for a ranged attack (enabling Soft Cover).
 * @returns Complete `CoverEvaluationResult`.
 */
export function evaluateCover(
  attackerPos: { readonly x: number; readonly y: number },
  targetPos: { readonly x: number; readonly y: number },
  isWallAt: (x: number, y: number) => boolean,
  hasInterveningCreatureAt?: (x: number, y: number) => boolean,
  isRangedAttack = false
): CoverEvaluationResult {
  const dx = Math.abs(targetPos.x - attackerPos.x);
  const dy = Math.abs(targetPos.y - attackerPos.y);
  const sx = attackerPos.x < targetPos.x ? 1 : -1;
  const sy = attackerPos.y < targetPos.y ? 1 : -1;

  let x = attackerPos.x;
  let y = attackerPos.y;
  let err = dx - dy;
  let wallBlockedRay = false;
  let cornerWallGrazed = false;
  let creatureInterposed = false;

  while (x !== targetPos.x || y !== targetPos.y) {
    const e2 = err * 2;
    const prevX = x;
    const prevY = y;

    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }

    // Check diagonal corner grazing
    if (x !== prevX && y !== prevY) {
      if (isWallAt(x, prevY) && isWallAt(prevX, y)) {
        wallBlockedRay = true;
        break;
      }
      if (isWallAt(x, prevY) || isWallAt(prevX, y)) {
        cornerWallGrazed = true;
      }
    }

    if (x === targetPos.x && y === targetPos.y) {
      break;
    }

    if (isWallAt(x, y)) {
      wallBlockedRay = true;
      break;
    }

    if (hasInterveningCreatureAt !== undefined && hasInterveningCreatureAt(x, y)) {
      creatureInterposed = true;
    }
  }

  if (wallBlockedRay) {
    return {
      coverState: 'total',
      acBonus: IMPROVED_COVER_AC_BONUS,
      reflexBonus: IMPROVED_COVER_REFLEX_BONUS,
      blocksAoO: true,
      blocksLineOfEffect: true
    };
  }

  if (cornerWallGrazed) {
    return {
      coverState: 'standard',
      acBonus: STANDARD_COVER_AC_BONUS,
      reflexBonus: STANDARD_COVER_REFLEX_BONUS,
      blocksAoO: true,
      blocksLineOfEffect: false
    };
  }

  if (isRangedAttack && creatureInterposed) {
    return {
      coverState: 'soft',
      acBonus: STANDARD_COVER_AC_BONUS,
      reflexBonus: 0,
      blocksAoO: false,
      blocksLineOfEffect: false
    };
  }

  return {
    coverState: 'none',
    acBonus: 0,
    reflexBonus: 0,
    blocksAoO: false,
    blocksLineOfEffect: false
  };
}

/**
 * Checks whether an attacker and at least one threatening ally flank a defender by
 * occupying opposite sides or opposite corners across the defender's center coordinate.
 *
 * @param attackerPos Attacker `{ x, y }` tile coordinate.
 * @param threateningAllyPositions Array of `{ x, y }` coordinates of allies who actively threaten the defender.
 * @param defenderPos Defender `{ x, y }` tile coordinate.
 * @param defenderImmuneToFlanking True if defender has All-Around Vision or un-outflanked Improved Uncanny Dodge.
 * @returns True if the attacker receives the `+2` Flanking bonus.
 */
export function isFlankingTarget(
  attackerPos: { readonly x: number; readonly y: number },
  threateningAllyPositions: ReadonlyArray<{ readonly x: number; readonly y: number }>,
  defenderPos: { readonly x: number; readonly y: number },
  defenderImmuneToFlanking = false
): boolean {
  if (defenderImmuneToFlanking) {
    return false;
  }

  const vxA = Math.sign(attackerPos.x - defenderPos.x);
  const vyA = Math.sign(attackerPos.y - defenderPos.y);
  if (vxA === 0 && vyA === 0) {
    return false;
  }

  for (const ally of threateningAllyPositions) {
    const vxB = Math.sign(ally.x - defenderPos.x);
    const vyB = Math.sign(ally.y - defenderPos.y);
    if (vxB === -vxA && vyB === -vyA) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluates observer perception and Concealment miss-chance % (`0%`, `20%`, or `50%`)
 * given tile illumination, distance, target invisibility/blur, and observer `SensoryProfile`.
 * Note: Any target with Total Concealment (`50%`) **cannot** be targeted by an Attack of Opportunity.
 *
 * @param illumination Target tile's `IlluminationLevel` (`'bright' | 'shadowy' | 'darkness'`).
 * @param observerPos Observer `{ x, y }` position.
 * @param targetPos Target `{ x, y }` position.
 * @param senses Observer's `SensoryProfile`.
 * @param options Optional `{ targetInvisible?, targetBlurred?, targetGrounded? }`.
 * @returns `{ visible: boolean, pinpointed: boolean, missChancePercent: 0 | 20 | 50, blocksAoO: boolean }`.
 */
export function evaluateConcealmentAndSenses(
  illumination: IlluminationLevel,
  observerPos: { readonly x: number; readonly y: number },
  targetPos: { readonly x: number; readonly y: number },
  senses: SensoryProfile,
  options?: {
    readonly targetInvisible?: boolean;
    readonly targetBlurred?: boolean;
    readonly targetGrounded?: boolean;
  }
): {
  readonly visible: boolean;
  readonly pinpointed: boolean;
  readonly missChancePercent: 0 | 20 | 50;
  readonly blocksAoO: boolean;
} {
  const distanceFt = measureDnD35DistanceFt(observerPos.x, observerPos.y, targetPos.x, targetPos.y);

  // Blindsight within range negates darkness, invisibility, and blur concealment completely.
  if (senses.blindsightRangeFt >= distanceFt && distanceFt > 0) {
    return {
      visible: true,
      pinpointed: true,
      missChancePercent: 0,
      blocksAoO: false
    };
  }

  const isDarkClearedByDarkvision = illumination === 'darkness' && senses.darkvisionRangeFt >= distanceFt;
  const isShadowyClearedByLowLight = illumination === 'shadowy' && senses.lowLightVision;

  let missChance: 0 | 20 | 50 = 0;
  if (options?.targetInvisible === true) {
    missChance = TOTAL_CONCEALMENT_MISS_CHANCE_PERCENT;
  } else if (illumination === 'darkness' && !isDarkClearedByDarkvision) {
    missChance = TOTAL_CONCEALMENT_MISS_CHANCE_PERCENT;
  } else if (
    options?.targetBlurred === true ||
    (illumination === 'shadowy' && !isShadowyClearedByLowLight && !isDarkClearedByDarkvision)
  ) {
    missChance = CONCEALMENT_MISS_CHANCE_PERCENT;
  }

  const visible = missChance < TOTAL_CONCEALMENT_MISS_CHANCE_PERCENT;
  const pinpointedByExtraSense =
    senses.blindsenseRangeFt >= distanceFt ||
    (senses.tremorsenseRangeFt >= distanceFt && options?.targetGrounded !== false) ||
    (senses.scentRangeFt >= distanceFt && distanceFt <= SCENT_PINPOINT_RANGE_FT);

  return {
    visible,
    pinpointed: visible || pinpointedByExtraSense,
    missChancePercent: missChance,
    blocksAoO: missChance === TOTAL_CONCEALMENT_MISS_CHANCE_PERCENT
  };
}
