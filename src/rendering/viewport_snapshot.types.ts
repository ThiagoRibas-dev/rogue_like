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
