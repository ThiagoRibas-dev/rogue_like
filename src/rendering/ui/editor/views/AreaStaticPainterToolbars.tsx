import type { JSX } from 'preact';
import { Button } from '../../primitives/Button.tsx';
import { Select } from '../../primitives/FormControls.tsx';

/** Static map brush category mode. */
export type AreaPaintMode = 'tiles' | 'entities' | 'items';

/** Minimal visual display metadata for a tile/entity/item brush swatch. */
export interface AreaPaintDef {
  readonly glyph: string;
  readonly fg?: string | undefined;
  readonly bg?: string | undefined;
  readonly spriteId?: string | undefined;
}

/** Props for `<AreaStaticPainterToolbars />`. */
export interface AreaStaticPainterToolbarsProps {
  readonly zLevelsSorted: ReadonlyArray<number>;
  readonly activeZ: number;
  readonly paintMode: AreaPaintMode;
  readonly paletteEntries: ReadonlyArray<readonly [string, AreaPaintDef]>;
  readonly activePaintId: string | null;
  readonly onSelectZ: (z: number) => void;
  readonly onAddZSlice: (direction: 'above' | 'below') => void;
  readonly onRemoveActiveZ: () => void;
  readonly onChangePaintMode: (mode: AreaPaintMode) => void;
  readonly onSelectPaintId: (id: string) => void;
}

/**
 * Elevation Z-slice switcher and brush palette toolbars for `<AreaStaticPainter />`.
 */
export function AreaStaticPainterToolbars({
  zLevelsSorted,
  activeZ,
  paintMode,
  paletteEntries,
  activePaintId,
  onSelectZ,
  onAddZSlice,
  onRemoveActiveZ,
  onChangePaintMode,
  onSelectPaintId
}: AreaStaticPainterToolbarsProps): JSX.Element {
  const activeDef = paletteEntries.find(([id]) => id === activePaintId)?.[1];

  return (
    <>
      <div className="ui-editor-z-toolbar" role="toolbar" aria-label="Z-Level Slices">
        <span className="ui-editor-muted">Elevation:</span>
        {zLevelsSorted.map((z) => (
          <Button
            key={z}
            size="sm"
            variant={z === activeZ ? 'primary' : 'secondary'}
            ariaPressed={z === activeZ}
            onClick={() => onSelectZ(z)}
          >
            Z{z >= 0 ? `+${z}` : z}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => onAddZSlice('above')}>
          + Z Above
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onAddZSlice('below')}>
          + Z Below
        </Button>
        {activeZ !== 0 ? (
          <Button size="sm" variant="danger" onClick={onRemoveActiveZ}>
            Remove Z
          </Button>
        ) : null}
      </div>

      <div className="ui-editor-palette-toolbar">
        <Select
          value={paintMode}
          ariaLabel="Paint layer"
          options={[
            { value: 'tiles', label: 'Tiles' },
            { value: 'entities', label: 'Entities' },
            { value: 'items', label: 'Items' }
          ]}
          onChange={(val) => onChangePaintMode(val as AreaPaintMode)}
        />
        <div className="ui-editor-palette-swatches" role="listbox" aria-label="Brush palette">
          {paletteEntries.map(([id, def]) => (
            <button
              key={id}
              type="button"
              role="option"
              title={id}
              aria-selected={id === activePaintId}
              className={`ui-editor-swatch-btn ${id === activePaintId ? 'is-active' : ''}`}
              style={{ color: def.fg ?? '#ffffff', backgroundColor: def.bg ?? '#000000' }}
              onClick={() => onSelectPaintId(id)}
            >
              {def.glyph}
            </button>
          ))}
        </div>
        <div className="ui-editor-active-brush" title={activePaintId ?? 'None'}>
          <span
            className="ui-editor-swatch-btn is-active"
            style={{
              color: activeDef?.fg ?? '#ffffff',
              backgroundColor: activeDef?.bg ?? '#000000'
            }}
          >
            {activeDef?.glyph ?? ''}
          </span>
        </div>
      </div>
    </>
  );
}
