import type { CampaignData } from '../../types/campaign.types.ts';

interface GraphNode {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isStart: boolean;
  isReachable: boolean;
  radius: number;
}

interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
}

/**
 * Renders an interactive node-link visualization of the areas in the campaign.
 * @param doc The current campaign document.
 * @param container The DOM element to render the canvas into.
 * @param onSelectNode Callback invoked when an area node is clicked.
 */
export function renderWorldGraph(doc: CampaignData, container: HTMLElement, onSelectNode: (id: string) => void): void {
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%;">
      <div class="workspace-header">
        <h2 class="workspace-title">Overworld Topology</h2>
        <p style="color: var(--text-dim); font-size: 0.9rem;">
          Nodes represent areas. Lines represent portal connections. Red nodes are unreachable from the starting area.
        </p>
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

  // Sync canvas internal resolution with display size
  const updateCanvasSize = () => {
    const rect = wrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  };
  updateCanvasSize();

  const areas = doc.areas;
  const startId = doc.rules.map.startingAreaId;

  // 1. Calculate Reachability via BFS
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

  // 2. Initialize Nodes
  const nodes: Record<string, GraphNode> = {};
  Object.keys(areas).forEach((id) => {
    nodes[id] = {
      id,
      name: areas[id]?.name || id,
      x: canvas.width / 2 + (Math.random() - 0.5) * 200,
      y: canvas.height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
      isStart: id === startId,
      isReachable: reachable.has(id),
      radius: 20
    };
  });

  // 3. Initialize Edges
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

  // 4. Force-directed layout simulation
  let animationFrameId: number;
  let isDragging = false;
  let draggedNode: GraphNode | null = null;
  let mouseX = 0;
  let mouseY = 0;

  const k = 0.1; // Spring constant
  const idealLength = 150;
  const repulsion = 5000;
  const damping = 0.8;

  const stepSimulation = () => {
    // Apply repulsion between all node pairs
    const nodeArray = Object.values(nodes);
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const n1 = nodeArray[i];
        const n2 = nodeArray[j];
        if (!n1 || !n2) continue;
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const distSq = dx * dx + dy * dy || 1; // avoid division by zero
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;

        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        n1.vx += fx;
        n1.vy += fy;
        n2.vx -= fx;
        n2.vy -= fy;
      }
    }

    // Apply spring forces along edges
    for (const edge of edges) {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy || 1);

      const displacement = dist - idealLength;
      const force = k * displacement;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      edge.source.vx += fx;
      edge.source.vy += fy;
      edge.target.vx -= fx;
      edge.target.vy -= fy;
    }

    // Central gravity to keep it centered
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    for (const n of nodeArray) {
      n.vx += (centerX - n.x) * 0.01;
      n.vy += (centerY - n.y) * 0.01;

      n.vx *= damping;
      n.vy *= damping;

      n.x += n.vx;
      n.y += n.vy;
    }
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Edges
    ctx.lineWidth = 2;
    for (const edge of edges) {
      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);

      // Calculate angle for arrowhead
      const angle = Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x);
      const targetRadius = edge.target.radius;
      const targetX = edge.target.x - Math.cos(angle) * targetRadius;
      const targetY = edge.target.y - Math.sin(angle) * targetRadius;

      // Create gradient for directed lines
      const grad = ctx.createLinearGradient(edge.source.x, edge.source.y, targetX, targetY);
      grad.addColorStop(0, 'rgba(100, 100, 100, 0.4)');
      grad.addColorStop(1, 'rgba(200, 200, 200, 0.8)');
      ctx.strokeStyle = grad;
      ctx.stroke();

      // Draw Arrowhead
      ctx.beginPath();
      ctx.moveTo(targetX, targetY);
      ctx.lineTo(targetX - 8 * Math.cos(angle - Math.PI / 6), targetY - 8 * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(targetX - 8 * Math.cos(angle + Math.PI / 6), targetY - 8 * Math.sin(angle + Math.PI / 6));
      ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
      ctx.fill();
    }

    // Draw Nodes
    const nodeArray = Object.values(nodes);
    for (const n of nodeArray) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

      if (n.isStart) {
        ctx.fillStyle = '#10b981'; // Green for start
        ctx.strokeStyle = '#059669';
      } else if (!n.isReachable) {
        ctx.fillStyle = '#ef4444'; // Red for unreachable
        ctx.strokeStyle = '#b91c1c';
      } else {
        ctx.fillStyle = '#3b82f6'; // Blue for normal
        ctx.strokeStyle = '#2563eb';
      }

      // Highlight if hovered/dragged
      if (n === hoveredNode || n === draggedNode) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
      } else {
        ctx.lineWidth = 2;
      }

      ctx.fill();
      ctx.stroke();

      // Draw label
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(n.name, n.x, n.y + n.radius + 15);
    }
  };

  let hoveredNode: GraphNode | null = null;

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

  const animate = () => {
    if (!isDragging) {
      stepSimulation();
    } else if (draggedNode) {
      // Pin dragged node to mouse
      draggedNode.x = mouseX;
      draggedNode.y = mouseY;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      stepSimulation(); // Let others react
    }
    draw();
    animationFrameId = requestAnimationFrame(animate);
  };

  // Event Listeners
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
      // Click without drag
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

  // Handle resizing
  const resizeObserver = new ResizeObserver(() => {
    updateCanvasSize();
  });
  resizeObserver.observe(wrapper);

  // Start loop
  animate();

  // Cleanup mechanism attached to container removal
  // A bit hacky but works without React hooks
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
