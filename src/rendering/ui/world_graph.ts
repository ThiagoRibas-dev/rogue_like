import type { CampaignData } from '../../types/campaign.types.ts';
import { rng } from '../../core/rng.ts';
import { drawWorldGraph, type GraphEdge, type GraphNode, stepWorldGraphSimulation } from './world_graph_canvas.ts';

export * from './world_graph_canvas.ts';

/**
 * Renders an interactive node-link visualization of the areas in the campaign.
 * @param doc The current campaign document.
 * @param container The DOM element to render the canvas into.
 * @param onSelectNode Callback invoked when an area node is clicked.
 */
export function renderWorldGraph(doc: CampaignData, container: HTMLElement, onSelectNode: (id: string) => void): void {
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%;">
      <div class="workspace-header" style="display: flex; justify-content: space-between; align-items: center; padding-right: 15px;">
        <div>
          <h2 class="workspace-title">Overworld Topology</h2>
          <p style="color: var(--text-dim); font-size: 0.9rem; margin: 0;">
            Nodes represent areas. Lines represent portal connections. Red nodes are unreachable from the starting area.
          </p>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="toggle-social-graph" style="cursor: pointer;" />
          <label for="toggle-social-graph" style="font-size: 0.85rem; color: #fff; cursor: pointer; user-select: none;">Show Social Overlay</label>
        </div>
      </div>
      <div style="flex-grow: 1; position: relative; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; overflow: hidden;" id="world-graph-wrapper">
        <canvas id="world-graph-canvas" style="display: block; width: 100%; height: 100%;"></canvas>
      </div>
    </div>
  `;

  const wrapper = container.querySelector('#world-graph-wrapper') as HTMLElement;
  const canvas = container.querySelector('#world-graph-canvas') as HTMLCanvasElement;
  if (!canvas || !wrapper) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const updateCanvasSize = (): void => {
    const rect = wrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
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
      if (currArea?.connections) {
        for (const conn of currArea.connections) {
          if (!reachable.has(conn.targetAreaId) && areas[conn.targetAreaId]) {
            reachable.add(conn.targetAreaId);
            queue.push(conn.targetAreaId);
          }
        }
      }
    }
  }

  const nodes: Record<string, GraphNode> = {};
  Object.keys(areas).forEach((id) => {
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
  });

  const edges: GraphEdge[] = [];
  Object.keys(areas).forEach((id) => {
    const area = areas[id];
    if (area?.connections) {
      area.connections.forEach((conn) => {
        const sourceNode = nodes[id];
        const targetNode = nodes[conn.targetAreaId];
        if (sourceNode && targetNode) {
          edges.push({
            source: sourceNode,
            target: targetNode
          });
        }
      });
    }
  });

  let animationFrameId: number;
  let isDragging = false;
  let draggedNode: GraphNode | null = null;
  let hoveredNode: GraphNode | null = null;
  let mouseX = 0;
  let mouseY = 0;
  let showSocialGraph = false;

  const toggleCheckbox = container.querySelector('#toggle-social-graph') as HTMLInputElement | null;
  toggleCheckbox?.addEventListener('change', (e) => {
    showSocialGraph = (e.target as HTMLInputElement).checked;
  });

  const getNodeAt = (x: number, y: number): GraphNode | null => {
    const nodeArray = Object.values(nodes);
    for (let i = nodeArray.length - 1; i >= 0; i--) {
      const n = nodeArray[i];
      if (!n) continue;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        return n;
      }
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
    drawWorldGraph(ctx, canvas, doc, nodes, edges, showSocialGraph, hoveredNode, draggedNode);
    animationFrameId = requestAnimationFrame(animate);
  };

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;

    if (isDragging && draggedNode) {
      draggedNode.x = mouseX;
      draggedNode.y = mouseY;
    } else {
      hoveredNode = getNodeAt(mouseX, mouseY);
      canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedNode = getNodeAt(x, y);
    if (draggedNode) {
      isDragging = true;
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (isDragging) {
      isDragging = false;
      draggedNode = null;
    } else {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const clicked = getNodeAt(x, y);
      if (clicked) {
        onSelectNode(clicked.id);
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    isDragging = false;
    draggedNode = null;
    hoveredNode = null;
  });

  const resizeObserver = new ResizeObserver(() => {
    updateCanvasSize();
  });
  resizeObserver.observe(wrapper);

  animate();

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node === container || container.contains(node)) {
          cancelAnimationFrame(animationFrameId);
          resizeObserver.disconnect();
          observer.disconnect();
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
