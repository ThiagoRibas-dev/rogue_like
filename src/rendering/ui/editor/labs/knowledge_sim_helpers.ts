import { rng } from '../../../../core/rng.ts';
import type { CampaignData, RumorPropagationRule } from '../../../../types/campaign.types.ts';
import type { SimEdge, SimNode } from '../../knowledge_sim_canvas.ts';

const NODE_RADIUS = 20;

/**
 * Builds the force-directed NPC node graph and inter-area portal edges for `<KnowledgeSimulator />`.
 */
export function buildKnowledgeGraph(
  doc: CampaignData,
  width: number,
  height: number
): {
  readonly nodes: SimNode[];
  readonly edges: SimEdge[];
} {
  const nodes: SimNode[] = [];
  for (const [areaId, area] of Object.entries(doc.areas)) {
    (area.placedEntities ?? []).forEach((pe, idx) => {
      const template = doc.entities[pe.templateId];
      if (!template?.memory) return;
      nodes.push({
        id: `${areaId}_${pe.templateId}_${idx}`,
        areaId,
        templateId: pe.templateId,
        name: template.name,
        tags: template.tags ?? [],
        faction: template.faction ?? '',
        hasRumor: false,
        x: width / 2 + (rng.getUniform() - 0.5) * 300,
        y: height / 2 + (rng.getUniform() - 0.5) * 300,
        vx: 0,
        vy: 0,
        radius: NODE_RADIUS
      });
    });
  }

  const edges: SimEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i]!.areaId === nodes[j]!.areaId) {
        edges.push({ source: nodes[i]!, target: nodes[j]!, type: 'portal' });
      }
    }
  }
  for (const [areaId, area] of Object.entries(doc.areas)) {
    for (const conn of area.connections ?? []) {
      const src = nodes.filter((n) => n.areaId === areaId);
      const dst = nodes.filter((n) => n.areaId === conn.targetAreaId);
      for (const s of src) {
        for (const d of dst) {
          edges.push({ source: s, target: d, type: 'portal' });
        }
      }
    }
  }
  return { nodes, edges };
}

/**
 * Evaluates whether a target NPC can receive a rumor from `sourceNpc` under `rule`.
 */
export function isNpcEligible(
  doc: CampaignData,
  npc: SimNode,
  rule: RumorPropagationRule,
  sourceNpc: SimNode
): boolean {
  if (rule.eligibleTags?.length) {
    if (!rule.eligibleTags.some((t) => npc.tags.includes(t))) return false;
  }
  if (rule.eligibleFactions?.length) {
    if (!rule.eligibleFactions.includes(npc.faction)) return false;
  }
  if (rule.requireAreaProximity) {
    if (npc.areaId === sourceNpc.areaId) return true;
    const isConn = doc.areas[sourceNpc.areaId]?.connections?.some((c) => c.targetAreaId === npc.areaId);
    if (!isConn) return false;
  }
  return true;
}
