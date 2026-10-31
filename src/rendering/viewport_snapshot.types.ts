/**
 * @file Pure presentational data transfer objects (DTOs) for viewport rendering and decoupled UI presentation.
 */

/**
 * Visual rendering specification for an entity located on a tile.
 */
export interface EntityRenderDTO {
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  readonly spriteId?: string | undefined;
}

/**
 * Presentational DTO for a single cell in the rendered viewport.
 */
export interface ViewportCellDTO {
  readonly vx: number;
  readonly vy: number;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
  readonly spriteId?: string | undefined;
  readonly entities: ReadonlyArray<EntityRenderDTO>;
  readonly isExplored: boolean;
  readonly isVisible: boolean;
  readonly highlight?:
    | {
        readonly glyph: string;
        readonly fg: string;
        readonly bg: string;
      }
    | undefined;
}

/**
 * Presentational DTO for a floating visual effect element (combat numbers, status text).
 */
export interface VisualEffectDTO {
  readonly id: string;
  readonly content: string;
  readonly color: string;
  readonly vx: number;
  readonly vy: number;
  readonly inViewport: boolean;
}

/**
 * Section type indicator for the inspect tooltip / panel.
 */
export type InspectSectionType = 'header' | 'stat' | 'desc';

/**
 * A formatted line or section in the inspect tooltip / panel.
 */
export interface InspectSectionDTO {
  readonly type: InspectSectionType;
  readonly label?: string | undefined;
  readonly value: string;
  readonly color?: string | undefined;
  readonly isHtml?: boolean | undefined;
}

/**
 * Presentational DTO for the inspect tooltip and sidebar panel.
 */
export interface InspectTooltipDTO {
  readonly active: boolean;
  readonly showFloatingBox?: boolean | undefined;
  readonly vx: number;
  readonly vy: number;
  readonly sections: ReadonlyArray<InspectSectionDTO>;
}

/**
 * Alpha masking definition for a cell in the sprite-mode fog of war canvas overlay.
 */
export interface FogOverlayCellDTO {
  readonly vx: number;
  readonly vy: number;
  readonly alpha: number;
}

/**
 * A cell whose art has no sprite in the campaign's sheets and must be drawn as
 * its ASCII glyph on the overlay canvas instead of the placeholder sprite.
 */
export interface GlyphOverlayDTO {
  readonly vx: number;
  readonly vy: number;
  readonly glyph: string;
  readonly fg: string;
  readonly bg: string;
}

/**
 * Presentational DTO for the 2D fog-of-war canvas overlay.
 */
export interface FogOverlayDTO {
  readonly active: boolean;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly viewportW: number;
  readonly viewportH: number;
  readonly cells: ReadonlyArray<FogOverlayCellDTO>;
}

/**
 * Faction/hostility classification for tactical unit badges and cursor brackets.
 */
export type TacticalAttitude = 'player' | 'hostile' | 'neutral' | 'friendly';

/**
 * Presentational DTO for an in-world unit health bar, attitude pip, and status indicators.
 */
export interface TacticalUnitBadgeDTO {
  readonly vx: number;
  readonly vy: number;
  readonly hpRatio: number;
  readonly attitude: TacticalAttitude;
  readonly statusColors: ReadonlyArray<string>;
}

/**
 * Presentational DTO for a single step along the tactical path preview.
 */
export interface TacticalPathStepDTO {
  readonly vx: number;
  readonly vy: number;
  readonly blocked: boolean;
}

/**
 * Presentational DTO for the animated corner-bracket cursor and path preview.
 */
export interface TacticalCursorDTO {
  readonly vx: number;
  readonly vy: number;
  readonly attitude: TacticalAttitude | 'terrain';
  readonly pathSteps: ReadonlyArray<TacticalPathStepDTO>;
}

/**
 * Presentational DTO for the tactical canvas overlay (torchlight FOV, unit micro-bars, bracket cursor).
 */
export interface TacticalViewportDTO {
  readonly playerVx: number | null;
  readonly playerVy: number | null;
  readonly fovRadius: number;
  readonly visibleCells: ReadonlyArray<{ readonly vx: number; readonly vy: number }>;
  readonly unitBadges: ReadonlyArray<TacticalUnitBadgeDTO>;
  readonly cursor: TacticalCursorDTO | null;
}

/**
 * Complete immutable projection of the visible viewport state for a single frame.
 */
export interface ViewportSnapshot {
  readonly viewportW: number;
  readonly viewportH: number;
  readonly cameraX: number;
  readonly cameraY: number;
  readonly isSpriteMode: boolean;
  readonly is3D: boolean;
  readonly cells: ReadonlyArray<ViewportCellDTO>;
  readonly visualEffects: ReadonlyArray<VisualEffectDTO>;
  readonly inspectTooltip: InspectTooltipDTO;
  readonly fogOverlay: FogOverlayDTO;
  /** ASCII-glyph fallbacks for cells whose art has no resolvable sprite. */
  readonly glyphOverlays: ReadonlyArray<GlyphOverlayDTO>;
  /** RimWorld/DF-style tactical telemetry overlay data. */
  readonly tactical: TacticalViewportDTO;
}

/**
 * Screen pixel metrics for aligning DOM and 2D canvas overlays with ROT.js cells.
 */
export interface CanvasPixelMetrics {
  readonly tileWidthPx: number;
  readonly tileHeightPx: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

