import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { rng } from '../../../../core/rng.ts';
import type { CampaignData } from '../../../../types/campaign.types.ts';
import { Checkbox } from '../../primitives/FormControls.tsx';
import { drawWorldGraph, type GraphEdge, type GraphNode, stepWorldGraphSimulation } from '../../world_graph_canvas.ts';

const DRAG_CLICK_THRESHOLD_PX = 4;

/** Props for `<WorldGraph />`. */
export interface WorldGraphProps {
  readonly doc: CampaignData;
  readonly onSelectNode: (id: string) => void;
}

/**
 * Interactive force-directed World Graph previewing Area portal topology and Social Overlays.
 */
export function WorldGraph({ doc, onSelectNode }: WorldGraphProps): JSX.Element {
  const [showSocialGraph, setShowSocialGraph] = useState<boolean>(false);
  const showSocialRef = useRef<boolean>(false);
  showSocialRef.current = showSocialGraph;

  const onSelectRef = useRef(onSelectNode);
  onSelectRef.current = onSelectNode;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateCanvasSize = (): void => {
      const rect = wrapper.getBoundingClientRect();
      canvas.width = Math.max(300, rect.width);
      canvas.height = Math.max(240, rect.height);
    };
    updateCanvasSize();

    const areas = doc.areas;
    const startId = doc.rules.map.startingAreaId;

    const reachable = new Set<string>();
    if (areas[startId]) {
      const queue = [startId];
      reachable.add(startId);
      while (queue.length > 0) {
        const currId = queue.shift()!;
        const currArea = areas[currId];
        for (const conn of currArea?.connections ?? []) {
          if (!reachable.has(conn.targetAreaId) && areas[conn.targetAreaId]) {
            reachable.add(conn.targetAreaId);
            queue.push(conn.targetAreaId);
          }
        }
      }
    }

    const nodes: Record<string, GraphNode> = {};
    for (const id of Object.keys(areas)) {
      nodes[id] = {
        id,
        name: areas[id]?.name || id,
        x: canvas.width / 2 + (rng.getUniform() - 0.5) * 200,
        y: canvas.height / 2 + (rng.getUniform() - 0.5) * 200,
        vx: 0,
        vy: 0,
        isStart: id === startId,
        isReachable: reachable.has(id),
        radius: 20
      };
    }

    const edges: GraphEdge[] = [];
    for (const id of Object.keys(areas)) {
      for (const conn of areas[id]?.connections ?? []) {
        const source = nodes[id];
        const target = nodes[conn.targetAreaId];
        if (source && target) {
          edges.push({ source, target });
        }
      }
    }

    let animationFrameId = 0;
    let isDragging = false;
    let didDrag = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let draggedNode: GraphNode | null = null;
    let hoveredNode: GraphNode | null = null;
    let mouseX = 0;
    let mouseY = 0;

    const getNodeAt = (x: number, y: number): GraphNode | null => {
      const arr = Object.values(nodes);
      for (let i = arr.length - 1; i >= 0; i--) {
        const n = arr[i];
        if (!n) continue;
        const dx = x - n.x;
        const dy = y - n.y;
        if (dx * dx + dy * dy <= n.radius * n.radius) return n;
      }
      return null;
    };

    const animate = (): void => {
      if (!isDragging) {
        stepWorldGraphSimulation(nodes, edges, canvas.width, canvas.height);
      } else if (draggedNode) {
        draggedNode.x = mouseX;
        draggedNode.y = mouseY;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        stepWorldGraphSimulation(nodes, edges, canvas.width, canvas.height);
      }
      drawWorldGraph(ctx, canvas, doc, nodes, edges, showSocialRef.current, hoveredNode, draggedNode);
      animationFrameId = requestAnimationFrame(animate);
    };

    const onMouseMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
      if (isDragging && draggedNode) {
        if (Math.hypot(mouseX - dragStartX, mouseY - dragStartY) > DRAG_CLICK_THRESHOLD_PX) {
          didDrag = true;
        }
        draggedNode.x = mouseX;
        draggedNode.y = mouseY;
      } else {
        hoveredNode = getNodeAt(mouseX, mouseY);
        canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
      }
    };

    const onMouseDown = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      draggedNode = getNodeAt(x, y);
      if (draggedNode) {
        isDragging = true;
        didDrag = false;
        dragStartX = x;
        dragStartY = y;
        mouseX = x;
        mouseY = y;
      }
    };

    const onMouseUp = (e: MouseEvent): void => {
      const targetNode = draggedNode;
      const wasDrag = didDrag;
      isDragging = false;
      didDrag = false;
      draggedNode = null;

      if (!wasDrag) {
        const rect = canvas.getBoundingClientRect();
        const clicked = targetNode ?? getNodeAt(e.clientX - rect.left, e.clientY - rect.top);
        if (clicked) onSelectRef.current(clicked.id);
      }
    };

    const onMouseLeave = (): void => {
      isDragging = false;
      didDrag = false;
      draggedNode = null;
      hoveredNode = null;
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const resizeObserver = new ResizeObserver(updateCanvasSize);
    resizeObserver.observe(wrapper);

    animationFrameId = requestAnimationFrame(animate);

    return (): void => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [doc]);

  return (
    <div className="ui-editor-world-graph">
      <div className="ui-editor-world-graph__header">
        <div>
          <h3>Overworld Topology</h3>
          <p className="ui-editor-muted">
            Nodes represent areas. Lines represent portal connections. Red nodes are unreachable from spawn.
          </p>
        </div>
        <Checkbox label="Show Social Overlay" checked={showSocialGraph} onChange={setShowSocialGraph} />
      </div>
      <div ref={wrapperRef} className="ui-editor-canvas-stage ui-editor-stage--tall">
        <canvas ref={canvasRef} className="ui-editor-stage__canvas" />
      </div>
    </div>
  );
}
