import type { CampaignData } from '../../types/campaign.types.ts';

/** Node in the Overworld Topology force-directed graph. */
export interface GraphNode {
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

/** Directed edge between two Overworld Topology nodes. */
export interface GraphEdge {
  source: GraphNode;
  target: GraphNode;
}

const SPRING_CONSTANT = 0.1;
const IDEAL_EDGE_LENGTH = 150;
const REPULSION_STRENGTH = 5000;
const VELOCITY_DAMPING = 0.8;

/**
 * Advances one tick of the force-directed layout simulation.
 */
export function stepWorldGraphSimulation(
  nodes: Record<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  canvasWidth: number,
  canvasHeight: number
): void {
  const nodeArray = Object.values(nodes);
  for (let i = 0; i < nodeArray.length; i++) {
    for (let j = i + 1; j < nodeArray.length; j++) {
      const n1 = nodeArray[i];
      const n2 = nodeArray[j];
      if (!n1 || !n2) continue;
      const dx = n1.x - n2.x;
      const dy = n1.y - n2.y;
      const distSq = dx * dx + dy * dy || 1;
      const dist = Math.sqrt(distSq);
      const force = REPULSION_STRENGTH / distSq;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      n1.vx += fx;
      n1.vy += fy;
      n2.vx -= fx;
      n2.vy -= fy;
    }
  }

  for (const edge of edges) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy || 1);

    const displacement = dist - IDEAL_EDGE_LENGTH;
    const force = SPRING_CONSTANT * displacement;

    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;

    edge.source.vx += fx;
    edge.source.vy += fy;
    edge.target.vx -= fx;
    edge.target.vy -= fy;
  }

  const centerX = canvasWidth / 2;
  const centerY = canvasHeight / 2;
  for (const n of nodeArray) {
    n.vx += (centerX - n.x) * 0.01;
    n.vy += (centerY - n.y) * 0.01;

    n.vx *= VELOCITY_DAMPING;
    n.vy *= VELOCITY_DAMPING;

    n.x += n.vx;
    n.y += n.vy;
  }
}

/**
 * Renders the Overworld Topology edges, optional social overlay, and area nodes onto the canvas.
 */
export function drawWorldGraph(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  doc: CampaignData,
  nodes: Record<string, GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  showSocialGraph: boolean,
  hoveredNode: GraphNode | null,
  draggedNode: GraphNode | null
): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 2;
  for (const edge of edges) {
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);

    const angle = Math.atan2(edge.target.y - edge.source.y, edge.target.x - edge.source.x);
    const targetRadius = edge.target.radius;
    const targetX = edge.target.x - Math.cos(angle) * targetRadius;
    const targetY = edge.target.y - Math.sin(angle) * targetRadius;

    const grad = ctx.createLinearGradient(edge.source.x, edge.source.y, targetX, targetY);
    grad.addColorStop(0, 'rgba(100, 100, 100, 0.4)');
    grad.addColorStop(1, 'rgba(200, 200, 200, 0.8)');
    ctx.strokeStyle = grad;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(targetX, targetY);
    ctx.lineTo(targetX - 8 * Math.cos(angle - Math.PI / 6), targetY - 8 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(targetX - 8 * Math.cos(angle + Math.PI / 6), targetY - 8 * Math.sin(angle + Math.PI / 6));
    ctx.fillStyle = 'rgba(200, 200, 200, 0.8)';
    ctx.fill();
  }

  if (showSocialGraph) {
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(155, 89, 182, 0.75)';
    ctx.lineWidth = 2;

    const nodeArray = Object.values(nodes);
    for (let i = 0; i < nodeArray.length; i++) {
      for (let j = i + 1; j < nodeArray.length; j++) {
        const n1 = nodeArray[i]!;
        const n2 = nodeArray[j]!;
        const area1 = doc.areas[n1.id];
        const area2 = doc.areas[n2.id];
        if (!area1 || !area2) continue;

        const hasMerchant1 = area1.placedEntities?.some((pe) => doc.entities[pe.templateId]?.shop) ?? false;
        const hasMerchant2 = area2.placedEntities?.some((pe) => doc.entities[pe.templateId]?.shop) ?? false;
        const hasNpc1 = area1.placedEntities?.some((pe) => doc.entities[pe.templateId]?.memory) ?? false;
        const hasNpc2 = area2.placedEntities?.some((pe) => doc.entities[pe.templateId]?.memory) ?? false;

        let shouldDraw = false;
        if ((hasMerchant1 && hasNpc2) || (hasMerchant2 && hasNpc1)) {
          const connected =
            area1.connections?.some((c) => c.targetAreaId === n2.id) ||
            area2.connections?.some((c) => c.targetAreaId === n1.id);
          if (connected) shouldDraw = true;
        }

        const rules = doc.rumorPropagation || [];
        for (const rule of rules) {
          const p1Matches =
            area1.placedEntities?.some((pe) => {
              const ent = doc.entities[pe.templateId];
              if (!ent || !ent.memory) return false;
              if (rule.eligibleFactions?.length > 0 && !rule.eligibleFactions.includes(ent.faction || '')) return false;
              if (rule.eligibleTags?.length > 0 && !rule.eligibleTags.some((t) => ent.tags?.includes(t))) return false;
              return true;
            }) ?? false;

          const p2Matches =
            area2.placedEntities?.some((pe) => {
              const ent = doc.entities[pe.templateId];
              if (!ent || !ent.memory) return false;
              if (rule.eligibleFactions?.length > 0 && !rule.eligibleFactions.includes(ent.faction || '')) return false;
              if (rule.eligibleTags?.length > 0 && !rule.eligibleTags.some((t) => ent.tags?.includes(t))) return false;
              return true;
            }) ?? false;

          if (p1Matches && p2Matches) {
            if (!rule.requireAreaProximity) {
              shouldDraw = true;
              break;
            } else {
              const connected =
                area1.connections?.some((c) => c.targetAreaId === n2.id) ||
                area2.connections?.some((c) => c.targetAreaId === n1.id);
              if (connected) {
                shouldDraw = true;
                break;
              }
            }
          }
        }

        if (shouldDraw) {
          ctx.beginPath();
          const midX = (n1.x + n2.x) / 2;
          const midY = (n1.y + n2.y) / 2;
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const len = Math.sqrt(dx * dx + dy * dy || 1);
          const offsetX = (-dy / len) * 25;
          const offsetY = (dx / len) * 25;
          ctx.moveTo(n1.x, n1.y);
          ctx.quadraticCurveTo(midX + offsetX, midY + offsetY, n2.x, n2.y);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  const nodeArray = Object.values(nodes);
  for (const n of nodeArray) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

    if (n.isStart) {
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#059669';
    } else if (!n.isReachable) {
      ctx.fillStyle = '#ef4444';
      ctx.strokeStyle = '#b91c1c';
    } else {
      ctx.fillStyle = '#3b82f6';
      ctx.strokeStyle = '#2563eb';
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
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(n.name, n.x, n.y + n.radius + 15);
  }
}
