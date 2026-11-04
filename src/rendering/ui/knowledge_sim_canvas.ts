import type { CampaignData } from '../../types/campaign.types.ts';

/** Node in the Knowledge & Rumor Simulator graph. */
export interface SimNode {
  id: string;
  areaId: string;
  templateId: string;
  name: string;
  tags: string[];
  faction: string;
  hasRumor: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color?: string;
}

/** Edge in the Knowledge & Rumor Simulator graph. */
export interface SimEdge {
  source: SimNode;
  target: SimNode;
  type: 'portal' | 'propagation';
}

const SPRING_K = 0.08;
const IDEAL_LENGTH_PORTAL = 140;
const IDEAL_LENGTH_PROPAGATION = 70;
const REPULSION = 4000;
const DAMPING = 0.75;

/**
 * Steps one frame of force-directed physics for the Knowledge Simulator graph.
 */
export function stepKnowledgePhysics(
  nodes: SimNode[],
  edges: ReadonlyArray<SimEdge>,
  propagationEdges: ReadonlyArray<SimEdge>,
  canvasWidth: number,
  canvasHeight: number
): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const n1 = nodes[i]!;
      const n2 = nodes[j]!;
      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const distSq = dx * dx + dy * dy || 1;
      const dist = Math.sqrt(distSq);
      const force = REPULSION / distSq;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      n1.vx += fx;
      n1.vy += fy;
      n2.vx -= fx;
      n2.vy -= fy;
    }
  }

  edges.forEach((edge) => {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy || 1);
    const ideal = edge.source.areaId === edge.target.areaId ? IDEAL_LENGTH_PROPAGATION : IDEAL_LENGTH_PORTAL;
    const displacement = dist - ideal;
    const force = SPRING_K * displacement;

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  });

  propagationEdges.forEach((edge) => {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy || 1);
    const displacement = dist - IDEAL_LENGTH_PROPAGATION;
    const force = SPRING_K * displacement * 1.5;

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  });

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  nodes.forEach((n) => {
    n.vx += (centerX - n.x) * 0.015;
    n.vy += (centerY - n.y) * 0.015;

    n.vx *= DAMPING;
    n.vy *= DAMPING;

    n.x += n.vx;
    n.y += n.vy;
  });
}

/**
 * Renders the Knowledge Simulator force-directed graph onto the 2D canvas context.
 */
export function drawKnowledgeGraph(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  doc: CampaignData,
  nodes: ReadonlyArray<SimNode>,
  edges: ReadonlyArray<SimEdge>,
  propagationEdges: ReadonlyArray<SimEdge>,
  hoveredNode: SimNode | null,
  draggedNode: SimNode | null
): void {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const areaNpcs: Record<string, SimNode[]> = {};
  nodes.forEach((n) => {
    if (!areaNpcs[n.areaId]) areaNpcs[n.areaId] = [];
    areaNpcs[n.areaId]!.push(n);
  });

  ctx.save();
  for (const [areaId, npcs] of Object.entries(areaNpcs)) {
    if (npcs.length === 0) continue;
    let cx = 0;
    let cy = 0;
    npcs.forEach((n) => {
      cx += n.x;
      cy += n.y;
    });
    cx /= npcs.length;
    cy /= npcs.length;

    ctx.beginPath();
    ctx.arc(cx, cy, 70, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#666';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText((doc.areas[areaId]?.name || areaId).toUpperCase(), cx, cy - 80);
  }
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(80, 80, 80, 0.3)';
  edges.forEach((edge) => {
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#9b59b6';
  ctx.shadowColor = '#8e44ad';
  ctx.shadowBlur = 8;
  propagationEdges.forEach((edge) => {
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.stroke();

    const angle = Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x);
    const targetX = edge.target.x - Math.cos(angle) * edge.target.radius;
    const targetY = edge.target.y - Math.sin(angle) * edge.target.radius;

    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(targetX - 10 * Math.cos(angle - Math.PI / 6), targetY - 10 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(targetX - 10 * Math.cos(angle + Math.PI / 6), targetY - 10 * Math.sin(angle + Math.PI / 6));
    ctx.fillStyle = '#9b59b6';
    ctx.fill();
  });
  ctx.restore();

  nodes.forEach((n) => {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

    if (n.hasRumor) {
      ctx.fillStyle = '#9b59b6';
      ctx.strokeStyle = '#8e44ad';
    } else {
      ctx.fillStyle = '#3498db';
      ctx.strokeStyle = '#2980b9';
    }

    if (n === hoveredNode || n === draggedNode) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
    } else {
      ctx.lineWidth = 2;
    }

    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const initials = n.name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .substring(0, 2);
    ctx.fillText(initials, n.x, n.y);

    ctx.fillStyle = n.hasRumor ? '#e0b0ff' : '#ffffff';
    ctx.font = '10px sans-serif';
    ctx.fillText(n.name, n.x, n.y + n.radius + 12);
  });
}

/**
 * Finds the top-most simulation node at canvas coordinates `(x, y)`.
 */
export function getKnowledgeNodeAt(nodes: ReadonlyArray<SimNode>, x: number, y: number): SimNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]!;
    const dx = x - n.x;
    const dy = y - n.y;
    if (dx * dx + dy * dy <= n.radius * n.radius) {
      return n;
    }
  }
  return null;
}
