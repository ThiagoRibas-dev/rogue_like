import { queryActiveFieldsAtPosition } from '../../../systems/field.system.ts';
import { resolveAreaEnvironmentProfile } from '../../../systems/world_clock.system.ts';
import type { GameState } from '../../../types/game-state.types.ts';
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
  observerPos: {
    readonly x: number;
    readonly y: number;
    readonly footprintWidth?: number | undefined;
    readonly footprintHeight?: number | undefined;
  },
  targetPos: {
    readonly x: number;
    readonly y: number;
    readonly footprintWidth?: number | undefined;
    readonly footprintHeight?: number | undefined;
  },
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
  const obsW = Math.max(1, observerPos.footprintWidth ?? 1);
  const obsH = Math.max(1, observerPos.footprintHeight ?? 1);
  const tgtW = Math.max(1, targetPos.footprintWidth ?? 1);
  const tgtH = Math.max(1, targetPos.footprintHeight ?? 1);
  let distanceFt = Infinity;
  for (let ody = 0; ody < obsH; ody++) {
    for (let odx = 0; odx < obsW; odx++) {
      for (let tdy = 0; tdy < tgtH; tdy++) {
        for (let tdx = 0; tdx < tgtW; tdx++) {
          const d = measureDnD35DistanceFt(
            observerPos.x + odx,
            observerPos.y + ody,
            targetPos.x + tdx,
            targetPos.y + tdy
          );
          if (d < distanceFt) distanceFt = d;
        }
      }
    }
  }

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

/** Tile illumination + sunlight/daylight descriptor reading returned by `resolveTileLightReading`. */
export interface TileLightReading {
  readonly level: IlluminationLevel;
  readonly isBright: boolean;
  readonly isSunlight: boolean;
}

/** Sunlight/daylight field descriptors recognized by Light Sensitivity mechanics. */
const SUNLIGHT_FIELD_DESCRIPTORS: ReadonlySet<string> = new Set(['sunlight', 'daylight', 'field_daylight']);

/**
 * Selects the winning active `illuminationOverride` descriptor at `(x, y)` after applying
 * `yieldsToDescriptors` and spell-level priority rules.
 */
function resolveWinningFieldIlluminationOverride(
  state: GameState,
  x: number,
  y: number
):
  | {
      readonly fieldType: string;
      readonly spellId: string | undefined;
      readonly level: IlluminationLevel;
      readonly descriptors: ReadonlyArray<string>;
    }
  | undefined {
  const activeFields = queryActiveFieldsAtPosition(state, x, y);
  const overrides = activeFields
    .map((f) => ({
      fieldType: f.field.fieldType,
      spellId: f.field.spellId,
      override: f.field.illuminationOverride
    }))
    .filter(
      (
        entry
      ): entry is {
        fieldType: string;
        spellId: string | undefined;
        override: NonNullable<typeof entry.override>;
      } => entry.override !== undefined
    );

  if (overrides.length === 0) return undefined;

  const allActiveDescriptors = new Set<string>();
  for (const entry of overrides) {
    allActiveDescriptors.add(entry.fieldType);
    if (entry.spellId) allActiveDescriptors.add(entry.spellId);
    for (const d of entry.override.descriptors ?? []) {
      allActiveDescriptors.add(d);
    }
  }

  const nonYielding = overrides.filter((entry) => {
    const yieldsTo = entry.override.yieldsToDescriptors ?? [];
    return !yieldsTo.some((yTag) => allActiveDescriptors.has(yTag));
  });

  const candidates = nonYielding.length > 0 ? nonYielding : overrides;
  let winner = candidates[0]!;
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    if (candidate.override.spellLevel >= winner.override.spellLevel) {
      winner = candidate;
    }
  }

  return {
    fieldType: winner.fieldType,
    spellId: winner.spellId,
    level: winner.override.level,
    descriptors: winner.override.descriptors ?? []
  };
}

/**
 * Resolves the effective `IlluminationLevel` (`'bright' | 'shadowy' | 'darkness'`) AND whether the tile
 * carries bright sunlight or *Daylight*-caliber radiance (`isSunlight`).
 */
export function resolveTileLightReading(
  state: GameState,
  x: number,
  y: number,
  ambientOverride?: IlluminationLevel
): TileLightReading {
  const envProfile = resolveAreaEnvironmentProfile(state);
  const baselineLevel = ambientOverride ?? envProfile.illumination;
  const winner = resolveWinningFieldIlluminationOverride(state, x, y);
  const level = winner?.level ?? baselineLevel;
  const isBright = level === 'bright';

  const fieldGrantsSunlight =
    winner !== undefined &&
    (SUNLIGHT_FIELD_DESCRIPTORS.has(winner.fieldType) ||
      (winner.spellId !== undefined && SUNLIGHT_FIELD_DESCRIPTORS.has(winner.spellId)) ||
      winner.descriptors.some((d) => SUNLIGHT_FIELD_DESCRIPTORS.has(d)));

  const naturalSunlightActive = ambientOverride === undefined && envProfile.isNaturalSunlight;
  const isSunlight = isBright && (fieldGrantsSunlight || (winner === undefined && naturalSunlightActive));

  return { level, isBright, isSunlight };
}

/**
 * Resolves the effective `IlluminationLevel` (`'bright' | 'shadowy' | 'darkness'`) at `(x, y)`
 * by comparing active `FieldComponent.illuminationOverride` descriptors against `ambientIllumination`
 * (or the current area's environment & World Clock profile when `ambientIllumination` is omitted).
 *
 * @param state Current immutable GameState.
 * @param x Grid X coordinate.
 * @param y Grid Y coordinate.
 * @param ambientIllumination Optional explicit ambient illumination override.
 * @returns Effective `IlluminationLevel`.
 */
export function resolveEffectiveTileIllumination(
  state: GameState,
  x: number,
  y: number,
  ambientIllumination?: IlluminationLevel
): IlluminationLevel {
  return resolveTileLightReading(state, x, y, ambientIllumination).level;
}
