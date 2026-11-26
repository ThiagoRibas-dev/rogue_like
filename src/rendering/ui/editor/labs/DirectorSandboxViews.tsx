import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import { DEFAULT_STREAMING_PREVIEW_SPAN } from '../../../../constants/world_chunk.constants.ts';
import type { runEncounterArena } from '../../../../editor/simulation/ai_arena.ts';
import type { GeneratedArea } from '../../../../map/generator.ts';
import { getTileAt } from '../../../../map/map_accessor.ts';
import type { CampaignData } from '../../../../types/campaign.types.ts';
import type { BudgetAxis, DirectorReceipt } from '../../../../types/encounter.types.ts';
import { Badge } from '../../primitives/DataDisplay.tsx';
import {
  AXIS_COLORS,
  getDispositionLabel,
  getEntityDisplay,
  getTileColor,
  lightenColor,
  MAP_CELL_SIZE
} from '../../director/director_telemetry_view.ts';

const ROOM_LIGHTEN_PERCENT = 10;
const AXES: ReadonlyArray<BudgetAxis> = ['protein', 'appetizer', 'side', 'dessert'];

/** Return type of `runEncounterArena` for sandbox auto-simulation telemetry cards. */
export type EncounterArenaReport = ReturnType<typeof runEncounterArena>;

/**
 * Renders the Encounter Director CR budget receipt broken down by axis and dynamic trait upgrades.
 */
export function DirectorReceiptView({
  doc,
  receipt
}: {
  readonly doc: CampaignData;
  readonly receipt: DirectorReceipt;
}): JSX.Element {
  const totalSpent = Object.values(receipt.axisResults).reduce((sum, axis) => sum + axis.spent, 0);
  const remaining = receipt.effectiveBudget - totalSpent;

  return (
    <div className="ui-editor-receipt">
      <div className="ui-editor-receipt__summary">
        <strong>Budget Summary</strong>
        <div className="ui-editor-muted">
          Total: <code>{receipt.effectiveBudget}</code> CR | Spent: <code>{totalSpent}</code> CR | Pre-allocated:{' '}
          <code>{receipt.preAllocated}</code> CR | Remaining: <code>{remaining}</code> CR
        </div>
      </div>

      {AXES.map((axis) => {
        const res = receipt.axisResults[axis];
        const pct = res.budget > 0 ? Math.round((res.spent / res.budget) * 100) : 0;
        const axisColor = AXIS_COLORS[axis] ?? 'var(--ui-accent-primary)';
        const spawned = res.candidates.filter((c) => c.disposition === 'spawned');
        const rejected = res.candidates.filter((c) => c.disposition !== 'spawned');

        return (
          <div key={axis} className="ui-editor-receipt__axis" style={{ borderLeftColor: axisColor }}>
            <div className="ui-editor-receipt__axis-head">
              <span className="ui-editor-receipt__axis-name">{axis}</span>
              <span style={{ color: axisColor }}>
                {res.spent} / {res.budget} CR ({pct}%)
              </span>
            </div>
            <div className="ui-editor-receipt__bar">
              <div
                className="ui-editor-receipt__bar-fill"
                style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: axisColor }}
              />
            </div>

            {spawned.length > 0 ? (
              <div className="ui-editor-receipt__group">
                <div className="ui-editor-receipt__ok">✓ Spawned ({spawned.length}):</div>
                {spawned.map((c, idx) => (
                  <div key={`${c.templateId}_s_${idx}`} className="ui-editor-receipt__item">
                    • {doc.entities[c.templateId]?.name ?? c.templateId} ({c.cost} CR) {c.reasonDetail ?? ''}
                  </div>
                ))}
              </div>
            ) : null}

            {rejected.length > 0 ? (
              <div className="ui-editor-receipt__group">
                <div className="ui-editor-receipt__fail">✗ Rejected ({rejected.length}):</div>
                {rejected.map((c, idx) => (
                  <div key={`${c.templateId}_r_${idx}`} className="ui-editor-receipt__item">
                    • {doc.entities[c.templateId]?.name ?? c.templateId} ({c.cost} CR) —{' '}
                    <span>{getDispositionLabel(c.disposition)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {receipt.traitUpgrades.length > 0 ? (
        <div className="ui-editor-receipt__summary">
          <strong>✦ Budget Padding — Dynamic Traits</strong>
          {receipt.traitUpgrades.map((trait, idx) => (
            <div key={idx} className="ui-editor-receipt__item">
              • {trait}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders the declarative JSX tile/entity mini-map for a generated Director Sandbox area.
 */
export function DirectorMiniMap({
  doc,
  generated
}: {
  readonly doc: CampaignData;
  readonly generated: GeneratedArea;
}): JSX.Element {
  const miniMapData = useMemo(() => {
    const { map, rooms, portals, placedEntities, startPos } = generated;
    const isStreaming = map.chunkGrid !== undefined;
    const viewW = isStreaming ? DEFAULT_STREAMING_PREVIEW_SPAN : map.width;
    const viewH = isStreaming ? DEFAULT_STREAMING_PREVIEW_SPAN : map.height;
    const originX = isStreaming ? startPos.x - Math.floor(viewW / 2) : 0;
    const originY = isStreaming ? startPos.y - Math.floor(viewH / 2) : 0;

    const entityMap = new Map<
      string,
      { readonly templateId: string; readonly dynamicTraits?: ReadonlyArray<string> | undefined }
    >();
    for (const pe of placedEntities ?? []) {
      entityMap.set(`${pe.x},${pe.y}`, pe);
    }
    const portalKeys = new Set(portals.map((p) => `${p.x},${p.y}`));
    const roomKeys = new Set<string>();
    for (const r of rooms) {
      for (let ry = r.top; ry <= r.bottom; ry++) {
        for (let rx = r.left; rx <= r.right; rx++) {
          roomKeys.add(`${rx},${ry}`);
        }
      }
    }

    const cells: JSX.Element[] = [];
    for (let vy = 0; vy < viewH; vy++) {
      for (let vx = 0; vx < viewW; vx++) {
        const x = originX + vx;
        const y = originY + vy;
        const tile = getTileAt(map, x, y);
        let bg = tile ? getTileColor(doc, tile.tileId) : '#111111';
        const key = `${x},${y}`;
        if (roomKeys.has(key) && !tile?.tileId.includes('wall')) {
          bg = lightenColor(bg, ROOM_LIGHTEN_PERCENT);
        }

        const ent = entityMap.get(key);
        const isPortal = portalKeys.has(key);
        const isStart = x === startPos.x && y === startPos.y;
        const entDisp = ent ? getEntityDisplay(doc, ent.templateId) : null;

        let glyph = '';
        let fg = '#ffffff';
        let title = `${x},${y}`;
        let outline = '';

        if (ent && entDisp) {
          glyph = entDisp.glyph;
          fg = entDisp.fg;
          title = ent.templateId;
          if (ent.dynamicTraits && ent.dynamicTraits.length > 0) {
            outline = '1px solid var(--ui-status-warning)';
            title += ` [${ent.dynamicTraits.join(', ')}]`;
          }
        }
        if (isPortal) {
          glyph = 'O';
          fg = 'var(--ui-accent-primary)';
          title = 'Portal / Transition';
        }
        if (isStart) {
          if (!ent) {
            glyph = '@';
            fg = 'var(--ui-status-success)';
            title = 'Player Start';
          }
          outline = '1px solid var(--ui-status-success)';
        }

        cells.push(
          <div
            key={key}
            title={title}
            style={{
              width: `${MAP_CELL_SIZE}px`,
              height: `${MAP_CELL_SIZE}px`,
              fontSize: `${MAP_CELL_SIZE - 1}px`,
              lineHeight: `${MAP_CELL_SIZE}px`,
              textAlign: 'center',
              backgroundColor: bg,
              color: fg,
              fontWeight: ent ? 'bold' : 'normal',
              ...(outline ? { outline } : {})
            }}
          >
            {glyph}
          </div>
        );
      }
    }

    return { viewW, cells };
  }, [generated, doc]);

  return (
    <div className="ui-editor-lab-section">
      <div className="ui-editor-row--between">
        <strong>Map Preview</strong>
        <Badge tone="info">
          {generated.rooms.length} rooms • {generated.placedEntities?.length ?? 0} entities
        </Badge>
      </div>
      <div
        className="ui-editor-minimap-grid"
        style={{ gridTemplateColumns: `repeat(${miniMapData.viewW}, ${MAP_CELL_SIZE}px)` }}
      >
        {miniMapData.cells}
      </div>
    </div>
  );
}

/**
 * Renders summary metric cards for Encounter Director auto-simulation combat QA runs.
 */
export function DirectorSimReportView({ report }: { readonly report: EncounterArenaReport }): JSX.Element {
  return (
    <div className="ui-editor-lab-section">
      <h4>Auto-Simulation Results ({report.results.length} runs)</h4>
      <div className="ui-editor-metrics-grid">
        <div className="ui-editor-metric-card">
          <div className="ui-editor-muted">Player Wins</div>
          <strong>{report.aggregate.playerWins}</strong>
        </div>
        <div className="ui-editor-metric-card">
          <div className="ui-editor-muted">Enemy Wins</div>
          <strong>{report.aggregate.enemyWins}</strong>
        </div>
        <div className="ui-editor-metric-card">
          <div className="ui-editor-muted">Draws</div>
          <strong>{report.aggregate.draws}</strong>
        </div>
        <div className="ui-editor-metric-card">
          <div className="ui-editor-muted">Avg Turns</div>
          <strong>{report.aggregate.avgTurns.toFixed(1)}</strong>
        </div>
        <div className="ui-editor-metric-card">
          <div className="ui-editor-muted">Avg HP Remaining</div>
          <strong>{report.aggregate.avgPlayerHpRemaining.toFixed(1)}</strong>
        </div>
      </div>
    </div>
  );
}
