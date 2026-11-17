import { addComponent, getComponent } from '../../../core/ecs.ts';
import type {
  ActorComponent,
  FighterComponent,
  PositionComponent,
  PropertyOverlayComponent,
  StatusEffectsComponent,
  TagsComponent
} from '../../../types/components.types.ts';
import { ComponentType } from '../../../types/components.types.ts';
import type { CardinalFacing } from '../../../types/components/world_components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ActorSpatialProfile } from '../../../types/ruleset.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveEffectiveSizeCategory } from '../modifiers/ac_breakdown.ts';
import { getDnD35EntityData } from '../srd_registry.ts';
import type { CreatureSizeCategory } from '../types/stats.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';
import { FEET_PER_GRID_SQUARE, SIZE_METRICS, measureDnD35DistanceFt } from './grid_geometry.ts';

/** Width and height of an entity's occupied footprint measured in 5-ft grid squares. */
export interface FootprintDimensions {
  readonly width: number;
  readonly height: number;
}

/** SRD tactical armor/encumbrance speed scaling numerator (`2/3`). */
const ARMOR_SPEED_NUMERATOR = 2;

/** SRD tactical armor/encumbrance speed scaling denominator (`2/3`). */
const ARMOR_SPEED_DENOMINATOR = 3;

/** Sub-tile visual scale multipliers by D&D 3.5e size category. */
export const SUB_TILE_SCALE_BY_SIZE: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: 0.45,
  diminutive: 0.55,
  tiny: 0.68,
  small: 1.0,
  medium: 1.0,
  large: 1.0,
  huge: 1.0,
  gargantuan: 1.0,
  colossal: 1.0
};

/** Status effect IDs that render an actor helpless for tile-sharing / pass-through purposes. */
const HELPLESS_EFFECT_IDS = new Set<string>(['unconscious', 'paralyzed', 'asleep', 'sleeping', 'helpless']);

/** Self tags that indicate a creature is helpless. */
const HELPLESS_TAGS = new Set<string>([
  'condition:unconscious',
  'condition:paralyzed',
  'condition:asleep',
  'condition:helpless'
]);

/**
 * Resolves an entity's unsqueezed (width, height) footprint in 5-ft grid squares
 * from its effective size category, optional custom footprint overrides, and movement facing.
 *
 * @param effectiveSize Effective size category from Stage 1 of the Stat DAG.
 * @param customFootprint Optional base rectangular footprint override.
 * @param footprintsBySize Optional size-indexed rectangular footprint table.
 * @param facing Optional cardinal facing used to auto-rotate non-square footprints.
 * @returns Resolved unsqueezed width and height in grid squares.
 */
export function resolveEntityBaseFootprintDimensions(
  effectiveSize: CreatureSizeCategory,
  customFootprint?: FootprintDimensions,
  footprintsBySize?: Readonly<Record<string, FootprintDimensions | undefined>>,
  facing?: CardinalFacing
): FootprintDimensions {
  const bySize = footprintsBySize?.[effectiveSize];
  const baseSpan = SIZE_METRICS[effectiveSize].footprintTiles;
  const raw = bySize ?? customFootprint ?? { width: baseSpan, height: baseSpan };
  if (raw.width === raw.height || !facing) {
    return raw;
  }
  const shortSpan = Math.min(raw.width, raw.height);
  const longSpan = Math.max(raw.width, raw.height);
  return facing === 'east' || facing === 'west'
    ? { width: longSpan, height: shortSpan }
    : { width: shortSpan, height: longSpan };
}

/**
 * Returns every occupied `(x, y)` grid square for a rectangular `width x height` footprint.
 *
 * @param anchorX Top-left X coordinate of the footprint.
 * @param anchorY Top-left Y coordinate of the footprint.
 * @param width Footprint width in squares.
 * @param height Footprint height in squares.
 * @returns Array of occupied grid coordinates.
 */
export function computeRectFootprintSquares(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const squares: Array<{ readonly x: number; readonly y: number }> = [];
  for (let dy = 0; dy < safeH; dy++) {
    for (let dx = 0; dx < safeW; dx++) {
      squares.push({ x: anchorX + dx, y: anchorY + dy });
    }
  }
  return squares;
}

/**
 * Computes minimum D&D 3.5e distance in feet between any square in footprint A and any square in footprint B.
 * Returns `0` when the two footprints overlap (including Tiny+ creatures sharing an opponent's square).
 */
export function measureFootprintToFootprintDistanceFt(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): number {
  const squaresA = computeRectFootprintSquares(ax, ay, aw, ah);
  const squaresB = computeRectFootprintSquares(bx, by, bw, bh);
  let minFt = Infinity;
  for (const sqA of squaresA) {
    for (const sqB of squaresB) {
      const distFt = measureDnD35DistanceFt(sqA.x, sqA.y, sqB.x, sqB.y);
      if (distFt < minFt) {
        minFt = distFt;
      }
      if (minFt === 0) return 0;
    }
  }
  return Number.isFinite(minFt) ? minFt : Infinity;
}

/**
 * Computes minimum D&D 3.5e distance in feet from any occupied square in a footprint to a target square.
 */
export function measureFootprintToTileDistanceFt(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  targetX: number,
  targetY: number
): number {
  return measureFootprintToFootprintDistanceFt(anchorX, anchorY, width, height, targetX, targetY, 1, 1);
}

/**
 * Applies D&D 3.5e tactical speed reduction for Medium/Heavy armor (`2/3` rounded up to nearest `5 ft`)
 * after all speed bonuses/penalties have been accumulated, unless `'trait:unencumbered_speed'` applies.
 *
 * @param unadjustedSpeedFt Total tactical land speed in feet after speed bonuses (`+10 ft` Barbarian, Haste, etc.).
 * @param isMediumOrHeavyArmor Whether the actor is wearing Medium/Heavy armor or carrying Medium/Heavy load.
 * @param hasUnencumberedSpeedTrait Whether the actor retains full speed in Medium/Heavy armor (e.g., Dwarf).
 * @returns Effective tactical land speed in feet, clamped to at least `5 ft`.
 */
export function computeTacticalLandSpeedWithArmor(
  unadjustedSpeedFt: number,
  isMediumOrHeavyArmor: boolean,
  hasUnencumberedSpeedTrait: boolean
): number {
  if (!isMediumOrHeavyArmor || hasUnencumberedSpeedTrait) {
    return Math.max(FEET_PER_GRID_SQUARE, unadjustedSpeedFt);
  }
  const scaledRaw = (unadjustedSpeedFt * ARMOR_SPEED_NUMERATOR) / ARMOR_SPEED_DENOMINATOR;
  const roundedUpToFive = Math.ceil(scaledRaw / FEET_PER_GRID_SQUARE) * FEET_PER_GRID_SQUARE;
  return Math.max(FEET_PER_GRID_SQUARE, roundedUpToFive);
}

/**
 * Resolves the ruleset-agnostic `ActorSpatialProfile` for any entity from live D&D 3.5e state.
 *
 * @param state Current GameState.
 * @param entityId Entity to inspect.
 * @param facingOverride Optional movement facing override for oriented elongated footprints.
 * @returns Resolved `ActorSpatialProfile`.
 */
export function resolveDnD35eActorSpatialProfile(
  state: GameState,
  entityId: EntityId,
  facingOverride?: CardinalFacing
): ActorSpatialProfile {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  const rawTags = (getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  const actorComp = getComponent(state, entityId, ComponentType.Actor) as ActorComponent | undefined;

  const isHelplessByStatus = statusComp?.activeEffects.some((eff) => HELPLESS_EFFECT_IDS.has(eff.effectId)) ?? false;
  const isHelplessByTag = rawTags.some((t) => HELPLESS_TAGS.has(t));
  const isHelplessByHp = fighter !== undefined && fighter.hp < 0;
  const isHelpless = isHelplessByStatus || isHelplessByTag || isHelplessByHp;

  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  const rawData = getDnD35EntityData(state, entityId);
  if (!rawData) {
    const fallbackIncorporeal = rawTags.includes('subtype:incorporeal') || rawTags.includes('trait:incorporeal');
    const fallbackFly = (actorComp?.movementModes?.fly ?? 0) > 0 || rawTags.includes('condition:flying');
    return {
      baseWidth: Math.max(1, pos?.footprintWidth ?? 1),
      baseHeight: Math.max(1, pos?.footprintHeight ?? 1),
      sizeRankIndex: SIZE_METRICS.medium.rankIndex,
      naturalReachTiles: 1,
      canShareTile: false,
      subTileScale: 1.0,
      isHelpless,
      isIncorporeal: fallbackIncorporeal,
      isFlying: fallbackFly,
      isCompletelyFillingSpace: rawTags.includes('trait:fills_space')
    };
  }

  const effectiveData = resolveEffectiveEntityDataWithOverlays(rawData, overlay);
  const baseStatMods = effectiveData.statModifiers ?? [];
  const hasEquipment = getComponent(state, entityId, ComponentType.Equipment) !== undefined;
  const hasFeatModsAlready = baseStatMods.some((m) => (m.sourcePath ?? '').startsWith('feat:'));
  const hasUnhydratedFeats = !hasFeatModsAlready && (effectiveData.feats ?? []).length > 0;
  const evalResult = hasEquipment || hasUnhydratedFeats ? evaluateDnD35eEntityDAG(state, entityId) : undefined;
  const fallbackSize = resolveEffectiveSizeCategory(
    effectiveData.sizeCategory,
    baseStatMods.filter((m) => m.targetStat === 'size')
  ).sizeCategory;
  const effectiveSize: CreatureSizeCategory = evalResult?.dagResult.effectiveSize ?? fallbackSize;
  const sizeMetrics = SIZE_METRICS[effectiveSize];
  const facing = facingOverride ?? pos?.facing;
  const dims = resolveEntityBaseFootprintDimensions(
    effectiveSize,
    effectiveData.footprint,
    effectiveData.footprintsBySize,
    facing
  );

  const combinedTags = new Set<string>([...rawTags, ...(overlay?.grantedTags ?? []), ...(evalResult?.selfTags ?? [])]);
  const isIncorporeal =
    effectiveData.subtypes?.includes('incorporeal') === true ||
    combinedTags.has('subtype:incorporeal') ||
    combinedTags.has('trait:incorporeal');
  const isFlying =
    (effectiveData.movementModes?.fly ?? actorComp?.movementModes?.fly ?? 0) > 0 ||
    combinedTags.has('condition:flying');
  const isCompletelyFillingSpace =
    effectiveData.isCompletelyFillingSpace === true || combinedTags.has('trait:fills_space');

  return {
    baseWidth: dims.width,
    baseHeight: dims.height,
    sizeRankIndex: sizeMetrics.rankIndex,
    naturalReachTiles: Math.floor(sizeMetrics.naturalReachTallFt / FEET_PER_GRID_SQUARE),
    canShareTile: sizeMetrics.canShareTileWithMedium,
    subTileScale: SUB_TILE_SCALE_BY_SIZE[effectiveSize],
    isHelpless,
    isIncorporeal,
    isFlying,
    isCompletelyFillingSpace
  };
}

/**
 * Synchronizes an actor's `PositionComponent` footprint, size rank, sharing flag, and sub-tile visual scale
 * from its current effective size (updating `spatialIndex` automatically).
 *
 * @param state Current GameState.
 * @param entityId Entity to synchronize.
 * @returns Updated GameState.
 */
export function syncDnD35eActorSpatialFootprint(state: GameState, entityId: EntityId): GameState {
  const pos = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  if (!pos) return state;

  const profile = resolveDnD35eActorSpatialProfile(state, entityId, pos.facing);
  const baseWidth = profile.baseWidth;
  const baseHeight = profile.baseHeight;
  const canSqueezeNow = baseWidth >= 2 || baseHeight >= 2;
  const keepSqueezed = pos.isSqueezing === true && canSqueezeNow;

  const nextWidth = keepSqueezed
    ? Math.max(Math.ceil(baseWidth / 2), Math.min(pos.footprintWidth ?? baseWidth, baseWidth))
    : baseWidth;
  const nextHeight = keepSqueezed
    ? Math.max(Math.ceil(baseHeight / 2), Math.min(pos.footprintHeight ?? baseHeight, baseHeight))
    : baseHeight;
  const isSqueezing = keepSqueezed && (nextWidth < baseWidth || nextHeight < baseHeight);

  if (
    (pos.footprintWidth ?? 1) === nextWidth &&
    (pos.footprintHeight ?? 1) === nextHeight &&
    Boolean(pos.isSqueezing) === isSqueezing &&
    (pos.sizeRankIndex ?? 0) === profile.sizeRankIndex &&
    Boolean(pos.canShareTile) === profile.canShareTile &&
    (pos.subTileScale ?? 1) === profile.subTileScale
  ) {
    return state;
  }

  const isMultiTile = nextWidth > 1 || nextHeight > 1;
  const nextPos: PositionComponent = {
    type: ComponentType.Position,
    x: pos.x,
    y: pos.y,
    ...(isMultiTile ? { footprintWidth: nextWidth, footprintHeight: nextHeight } : {}),
    ...(baseWidth !== baseHeight && pos.facing !== undefined ? { facing: pos.facing } : {}),
    ...(isSqueezing ? { isSqueezing: true } : {}),
    ...(profile.sizeRankIndex !== 0 ? { sizeRankIndex: profile.sizeRankIndex } : {}),
    ...(profile.canShareTile ? { canShareTile: true } : {}),
    ...(profile.subTileScale !== 1 ? { subTileScale: profile.subTileScale } : {})
  };

  return addComponent(state, entityId, nextPos);
}
