import { dndFloor } from '../math/multipliers.ts';
import { evaluateCover, evaluateCover3D } from '../spatial/cover_senses.ts';
import { FEET_PER_GRID_SQUARE, measureDnD35Distance3DFt, measureDnD35DistanceFt } from '../spatial/grid_geometry.ts';
import { getBresenhamLine3D } from '../../../utils/grid.ts';
import type { DnD35ClassSpellbookState, DnD35PreparedSlotEntry } from '../types/dnd35e.types.ts';
import type { PreparedSpellSlot } from './spellcasting.ts';

/** Number of 6-second combat rounds in 8 hours (`8 * 60 * 10 = 4800` rounds). */
export const EIGHT_HOURS_IN_ROUNDS = 4800;

/** Number of 6-second combat rounds required to prepare a spell into an open slot (`15 min = 150` rounds). */
export const OPEN_SLOT_PREPARATION_ROUNDS = 150;

/** Natural HP and ability damage recovery multiplier (`1`) during standard 8-hour rest. */
export const STANDARD_NATURAL_HEAL_MULTIPLIER = 1;

/** Natural HP and ability damage recovery multiplier (`2`) under Heal skill Long-Term Care (PHB p. 75). */
export const LONG_TERM_CARE_HEAL_MULTIPLIER = 2;

/** Supported Area-of-Effect geometric templates in D&D 3.5e. */
export type AoETemplateShape = 'burst' | 'spread' | 'cone' | 'line';

/**
 * Computes all grid coordinates `{ x, y }` affected by a D&D 3.5e Area-of-Effect (`AoE`) template:
 * - `'burst'`: radiates from `(originX, originY)` up to `radiusFt`, blocked by Total Cover (`evaluateCover`).
 * - `'spread'`: flows around corners up to `radiusFt` along walkable non-wall tiles.
 * - `'cone'`: 90-degree directional cone from `(originX, originY)` toward `(targetX, targetY)` up to `radiusFt`.
 * - `'line'`: Bresenham ray from `(originX, originY)` to `(targetX, targetY)` stopped by walls.
 *
 * @param shape The `AoETemplateShape` (`'burst' | 'spread' | 'cone' | 'line'`).
 * @param originPos Origin `{ x, y }` tile coordinate.
 * @param targetPos Directional target `{ x, y }` tile coordinate.
 * @param radiusFt Radius or length in feet (e.g. `20` for Fireball, `15` for Burning Hands).
 * @param isWallAt Predicate returning `true` if `(x, y)` is an impassable wall.
 * @returns Array of affected `{ x, y }` coordinates.
 */
export function computeAoEAffectedSquares(
  shape: AoETemplateShape,
  originPos: { readonly x: number; readonly y: number },
  targetPos: { readonly x: number; readonly y: number },
  radiusFt: number,
  isWallAt: (x: number, y: number) => boolean
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const tileRadius = Math.max(1, dndFloor(radiusFt / FEET_PER_GRID_SQUARE));
  const results: Array<{ readonly x: number; readonly y: number }> = [];

  if (shape === 'line') {
    const dx = Math.abs(targetPos.x - originPos.x);
    const dy = Math.abs(targetPos.y - originPos.y);
    const sx = originPos.x < targetPos.x ? 1 : -1;
    const sy = originPos.y < targetPos.y ? 1 : -1;
    let x = originPos.x;
    let y = originPos.y;
    let err = dx - dy;

    const maxLineSteps = tileRadius * 2 + 2;
    for (let step = 0; step < maxLineSteps; step++) {
      if (x !== originPos.x || y !== originPos.y) {
        if (isWallAt(x, y)) break;
        if (measureDnD35DistanceFt(originPos.x, originPos.y, x, y) > radiusFt) break;
        results.push({ x, y });
      }
      if (x === targetPos.x && y === targetPos.y) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
    return results;
  }

  if (shape === 'spread') {
    // Dijkstra flood-fill around corners up to radiusFt
    const distMap: Record<string, number> = { [`${originPos.x},${originPos.y}`]: 0 };
    const queue: Array<{ readonly x: number; readonly y: number; readonly dist: number }> = [
      { x: originPos.x, y: originPos.y, dist: 0 }
    ];

    while (queue.length > 0) {
      queue.sort((a, b) => a.dist - b.dist);
      const curr = queue.shift()!;
      results.push({ x: curr.x, y: curr.y });

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = curr.x + dx;
          const ny = curr.y + dy;
          if (isWallAt(nx, ny)) continue;
          const stepCost = dx !== 0 && dy !== 0 ? FEET_PER_GRID_SQUARE * 1.5 : FEET_PER_GRID_SQUARE;
          const nextDist = dndFloor(curr.dist + stepCost);
          if (nextDist > radiusFt) continue;
          const key = `${nx},${ny}`;
          const prevDist = distMap[key];
          if (prevDist === undefined || nextDist < prevDist) {
            distMap[key] = nextDist;
            queue.push({ x: nx, y: ny, dist: nextDist });
          }
        }
      }
    }
    return results;
  }

  const dirX = targetPos.x - originPos.x;
  const dirY = targetPos.y - originPos.y;
  const dirLen = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;

  for (let y = originPos.y - tileRadius; y <= originPos.y + tileRadius; y++) {
    for (let x = originPos.x - tileRadius; x <= originPos.x + tileRadius; x++) {
      if (isWallAt(x, y)) continue;
      const distFt = measureDnD35DistanceFt(originPos.x, originPos.y, x, y);
      if (distFt > radiusFt) continue;

      if (shape === 'cone') {
        if (x === originPos.x && y === originPos.y) continue;
        const vx = x - originPos.x;
        const vy = y - originPos.y;
        const vLen = Math.hypot(vx, vy) || 1;
        const dot = (vx * ux + vy * uy) / vLen;
        // 90-degree cone corresponds to cos(45 deg) ~= 0.7071
        if (dot < 0.7) continue;
      }

      const cover = evaluateCover(originPos, { x, y }, isWallAt);
      if (!cover.blocksLineOfEffect) {
        results.push({ x, y });
      }
    }
  }

  return results;
}

/**
 * Computes true 3D spherical/conical/beam grid voxels `{ x, y, z }` affected by a D&D 3.5e AoE template.
 */
export function computeAoEAffectedSquares3D(
  shape: AoETemplateShape,
  originPos: { readonly x: number; readonly y: number; readonly z?: number | undefined },
  targetPos: { readonly x: number; readonly y: number; readonly z?: number | undefined },
  radiusFt: number,
  isWallAt: (x: number, y: number, z: number) => boolean
): ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }> {
  const oz = originPos.z ?? 0;
  const tz = targetPos.z ?? oz;
  const tileRadius = Math.max(1, dndFloor(radiusFt / FEET_PER_GRID_SQUARE));
  const results: Array<{ readonly x: number; readonly y: number; readonly z: number }> = [];

  if (shape === 'line') {
    const line = getBresenhamLine3D(originPos.x, originPos.y, oz, targetPos.x, targetPos.y, tz);
    for (let i = 1; i < line.length; i++) {
      const pt = line[i]!;
      if (isWallAt(pt.x, pt.y, pt.z)) break;
      if (measureDnD35Distance3DFt(originPos.x, originPos.y, oz, pt.x, pt.y, pt.z) > radiusFt) break;
      results.push({ x: pt.x, y: pt.y, z: pt.z });
    }
    return results;
  }

  if (shape === 'spread') {
    const distMap: Record<string, number> = { [`${originPos.x},${originPos.y},${oz}`]: 0 };
    const queue: Array<{ readonly x: number; readonly y: number; readonly z: number; readonly dist: number }> = [
      { x: originPos.x, y: originPos.y, z: oz, dist: 0 }
    ];
    while (queue.length > 0) {
      queue.sort((a, b) => a.dist - b.dist);
      const curr = queue.shift()!;
      results.push({ x: curr.x, y: curr.y, z: curr.z });

      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const nx = curr.x + dx;
            const ny = curr.y + dy;
            const nz = curr.z + dz;
            if (isWallAt(nx, ny, nz)) continue;
            const nonZeroAxes = (dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) + (dz !== 0 ? 1 : 0);
            const stepCost = nonZeroAxes > 1 ? FEET_PER_GRID_SQUARE * 1.5 : FEET_PER_GRID_SQUARE;
            const nextDist = dndFloor(curr.dist + stepCost);
            if (nextDist > radiusFt) continue;
            const key = `${nx},${ny},${nz}`;
            const prevDist = distMap[key];
            if (prevDist === undefined || nextDist < prevDist) {
              distMap[key] = nextDist;
              queue.push({ x: nx, y: ny, z: nz, dist: nextDist });
            }
          }
        }
      }
    }
    return results;
  }

  const dirX = targetPos.x - originPos.x;
  const dirY = targetPos.y - originPos.y;
  const dirZ = tz - oz;
  const dirLen = Math.hypot(dirX, dirY, dirZ) || 1;
  const ux = dirX / dirLen;
  const uy = dirY / dirLen;
  const uz = dirZ / dirLen;

  for (let z = oz - tileRadius; z <= oz + tileRadius; z++) {
    for (let y = originPos.y - tileRadius; y <= originPos.y + tileRadius; y++) {
      for (let x = originPos.x - tileRadius; x <= originPos.x + tileRadius; x++) {
        if (isWallAt(x, y, z)) continue;
        const distFt = measureDnD35Distance3DFt(originPos.x, originPos.y, oz, x, y, z);
        if (distFt > radiusFt) continue;
        if (shape === 'cone') {
          if (x === originPos.x && y === originPos.y && z === oz) continue;
          const vx = x - originPos.x;
          const vy = y - originPos.y;
          const vz = z - oz;
          const vLen = Math.hypot(vx, vy, vz) || 1;
          const dot = (vx * ux + vy * uy + vz * uz) / vLen;
          if (dot < 0.7) continue;
        }
        const cover = evaluateCover3D(originPos, { x, y, z }, isWallAt);
        if (!cover.blocksLineOfEffect) {
          results.push({ x, y, z });
        }
      }
    }
  }

  return results;
}

/**
 * Resolves an 8-Hour Roguelike Rest and Daily Spell Slot Refresh per `/docs/dnd35e/rules/magic/preparing-wizard-spells.md`:
 * - **8-Hour Recent Cast Limit**: Any spell slot expended within the last 8 hours
 *   (`restEndTurn - castTimestampTurn < 4800` rounds) counts against the caster's daily limit
 *   and CANNOT be refreshed during this rest.
 * - Restores `1 HP * characterLevel` and heals `1 pt` of Ability Damage per ability score.
 *
 * @param options Rest parameters and current slots.
 * @returns Refreshed slots, HP healed, and ability damage healed.
 */
export function resolveEightHourRest(options: {
  readonly slots: ReadonlyArray<PreparedSpellSlot>;
  readonly restCompletionTurn: number;
  readonly characterLevel: number;
  readonly isThreatened: boolean;
  readonly hasLongTermCare?: boolean;
}): {
  readonly restSucceeded: boolean;
  readonly refreshedSlots: ReadonlyArray<PreparedSpellSlot>;
  readonly retainedRecentCastCount: number;
  readonly naturalHpHealed: number;
  readonly abilityDamageHealedPerStat: number;
} {
  if (options.isThreatened) {
    return {
      restSucceeded: false,
      refreshedSlots: options.slots,
      retainedRecentCastCount: 0,
      naturalHpHealed: 0,
      abilityDamageHealedPerStat: 0
    };
  }

  let retainedRecentCastCount = 0;
  const refreshedSlots = options.slots.map((slot): PreparedSpellSlot => {
    if (slot.status !== 'expended') {
      return slot;
    }
    const elapsedRounds =
      slot.castTimestampTurn !== undefined
        ? options.restCompletionTurn - slot.castTimestampTurn
        : EIGHT_HOURS_IN_ROUNDS;

    if (elapsedRounds < EIGHT_HOURS_IN_ROUNDS) {
      retainedRecentCastCount++;
      return slot;
    }

    return {
      spellLevel: slot.spellLevel,
      status: 'open'
    };
  });

  const healMultiplier =
    options.hasLongTermCare === true ? LONG_TERM_CARE_HEAL_MULTIPLIER : STANDARD_NATURAL_HEAL_MULTIPLIER;

  return {
    restSucceeded: true,
    refreshedSlots,
    retainedRecentCastCount,
    naturalHpHealed: Math.max(1, dndFloor(options.characterLevel)) * healMultiplier,
    abilityDamageHealedPerStat: healMultiplier
  };
}

/**
 * Prepares a specific spell into an `'open'` Vancian slot by spending 15 minutes (`150` rounds)
 * when unthreatened.
 *
 * @param slot Target `PreparedSpellSlot` (must have `status === 'open'`).
 * @param spellId Spell ID to prepare.
 * @param spellLevel Level of the spell (`<= slot.spellLevel`).
 * @param isThreatened True if hostiles are visible.
 * @returns `{ success: boolean, roundsSpent: number, slot: PreparedSpellSlot }`.
 */
export function prepareOpenSpellSlot(
  slot: PreparedSpellSlot,
  spellId: string,
  spellLevel: number,
  isThreatened = false
): {
  readonly success: boolean;
  readonly roundsSpent: number;
  readonly slot: PreparedSpellSlot;
} {
  if (isThreatened || slot.status !== 'open' || spellLevel > slot.spellLevel) {
    return {
      success: false,
      roundsSpent: 0,
      slot
    };
  }

  return {
    success: true,
    roundsSpent: OPEN_SLOT_PREPARATION_ROUNDS,
    slot: {
      spellLevel: slot.spellLevel,
      status: 'prepared',
      preparedSpellId: spellId
    }
  };
}

/**
 * Resolves 8-hour rest recovery on a `DnD35ClassSpellbookState` by delegating prepared slot refresh
 * to `resolveEightHourRest` (enforcing the 8-hour recent-cast retention rule for both prepared and
 * spontaneous slots) while preserving slot IDs and prepared slot assignments that refreshed cleanly.
 *
 * @param options Spellbook rest resolution parameters.
 * @returns Updated `DnD35ClassSpellbookState`, retained recent-cast count, and natural healing amounts.
 */
export function resolveSpellbookEightHourRest(options: {
  readonly book: DnD35ClassSpellbookState;
  readonly restCompletionTurn: number;
  readonly characterLevel: number;
  readonly isThreatened: boolean;
  readonly hasLongTermCare?: boolean;
}): {
  readonly restSucceeded: boolean;
  readonly updatedBook: DnD35ClassSpellbookState;
  readonly retainedRecentCastCount: number;
  readonly naturalHpHealed: number;
  readonly abilityDamageHealedPerStat: number;
} {
  const { book, restCompletionTurn, characterLevel, isThreatened, hasLongTermCare } = options;
  const sourceSlots = book.preparedSlots ?? [];
  const mappedSlots: PreparedSpellSlot[] = sourceSlots.map((entry) => ({
    spellLevel: entry.spellLevel,
    status: entry.expended ? 'expended' : entry.preparedSpellId !== undefined ? 'prepared' : 'open',
    ...(entry.preparedSpellId !== undefined ? { preparedSpellId: entry.preparedSpellId } : {}),
    ...(entry.castTimestampTurn !== undefined ? { castTimestampTurn: entry.castTimestampTurn } : {})
  }));

  const restRes = resolveEightHourRest({
    slots: mappedSlots,
    restCompletionTurn,
    characterLevel,
    isThreatened,
    ...(hasLongTermCare !== undefined ? { hasLongTermCare } : {})
  });

  if (!restRes.restSucceeded) {
    return {
      restSucceeded: false,
      updatedBook: book,
      retainedRecentCastCount: 0,
      naturalHpHealed: 0,
      abilityDamageHealedPerStat: 0
    };
  }

  let retainedRecentCastCount = restRes.retainedRecentCastCount;
  const refreshedSlots: DnD35PreparedSlotEntry[] = sourceSlots.map((entry, idx) => {
    const postSlot = restRes.refreshedSlots[idx];
    if (!entry.expended) {
      return entry;
    }
    if (postSlot?.status === 'expended') {
      return entry;
    }
    return {
      slotId: entry.slotId,
      spellLevel: entry.spellLevel,
      slotKind: entry.slotKind,
      ...(entry.preparedSpellId !== undefined ? { preparedSpellId: entry.preparedSpellId } : {}),
      expended: false
    };
  });

  const nextSpontUsed: Record<string, number> = {};
  const nextSpontStamps: Record<string, ReadonlyArray<number>> = {};
  const rawStamps = book.spontaneousCastTimestampsByLevel ?? {};

  for (const [lvlKey, stamps] of Object.entries(rawStamps)) {
    const recent = stamps.filter((ts) => restCompletionTurn - ts < EIGHT_HOURS_IN_ROUNDS);
    if (recent.length > 0) {
      nextSpontStamps[lvlKey] = recent;
      nextSpontUsed[lvlKey] = recent.length;
      retainedRecentCastCount += recent.length;
    }
  }

  const preparedSpellIds = refreshedSlots
    .filter((s) => s.preparedSpellId !== undefined && !s.expended)
    .map((s) => s.preparedSpellId!);

  return {
    restSucceeded: true,
    updatedBook: {
      ...book,
      ...(book.preparedSlots !== undefined ? { preparedSlots: refreshedSlots, preparedSpellIds } : {}),
      spontaneousSlotsUsedByLevel: nextSpontUsed,
      spontaneousCastTimestampsByLevel: nextSpontStamps
    },
    retainedRecentCastCount,
    naturalHpHealed: restRes.naturalHpHealed,
    abilityDamageHealedPerStat: restRes.abilityDamageHealedPerStat
  };
}

/**
 * Prepares a spell into an open `DnD35PreparedSlotEntry` using `prepareOpenSpellSlot` (15 minutes = 150 rounds).
 *
 * @param slot Target `DnD35PreparedSlotEntry` (must be open and non-expended).
 * @param spellId Spell ID to memorize.
 * @param spellLevel Spell level (`<= slot.spellLevel`).
 * @param isThreatened True if unsafe/threatened.
 * @returns `{ success, roundsSpent, entry }`.
 */
export function prepareOpenDnD35Slot(
  slot: DnD35PreparedSlotEntry,
  spellId: string,
  spellLevel: number,
  isThreatened = false
): {
  readonly success: boolean;
  readonly roundsSpent: number;
  readonly entry: DnD35PreparedSlotEntry;
} {
  const mapped: PreparedSpellSlot = {
    spellLevel: slot.spellLevel,
    status: slot.expended ? 'expended' : slot.preparedSpellId !== undefined ? 'prepared' : 'open',
    ...(slot.preparedSpellId !== undefined ? { preparedSpellId: slot.preparedSpellId } : {}),
    ...(slot.castTimestampTurn !== undefined ? { castTimestampTurn: slot.castTimestampTurn } : {})
  };
  const res = prepareOpenSpellSlot(mapped, spellId, spellLevel, isThreatened);
  if (!res.success) {
    return { success: false, roundsSpent: 0, entry: slot };
  }
  return {
    success: true,
    roundsSpent: res.roundsSpent,
    entry: {
      slotId: slot.slotId,
      spellLevel: slot.spellLevel,
      slotKind: slot.slotKind,
      preparedSpellId: spellId,
      expended: false
    }
  };
}
