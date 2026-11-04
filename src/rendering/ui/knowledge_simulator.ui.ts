import { rng } from '../../core/rng.ts';
import type { RumorPropagationRule } from '../../types/campaign.types.ts';
import type { EditorController } from '../editor_ui.ts';
import {
  drawKnowledgeGraph,
  getKnowledgeNodeAt,
  type SimEdge,
  type SimNode,
  stepKnowledgePhysics
} from './knowledge_sim_canvas.ts';

export * from './knowledge_sim_canvas.ts';

/**
 * Renders the localized Knowledge & Rumor Simulator.
 */
export function renderKnowledgeSimulator(controller: EditorController, container: HTMLElement): void {
  const doc = controller.getDocument();

  container.innerHTML = `
    <div style="display: flex; gap: 20px; height: 100%; width: 100%;">
      <div style="flex: 2; display: flex; flex-direction: column; height: 100%;">
        <div class="workspace-header" style="margin-bottom: 10px;">
          <h2 class="workspace-title">Knowledge & Rumor Simulator</h2>
          <p style="color: var(--text-dim); font-size: 0.85rem; margin: 0;">
            Visualize how rumors spread across NPCs based on propagation rules. Blue nodes are NPCs. Purple nodes have received the rumor.
          </p>
        </div>
        <div style="flex-grow: 1; position: relative; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; overflow: hidden;" id="sim-graph-wrapper">
          <canvas id="sim-graph-canvas" style="display: block; width: 100%; height: 100%;"></canvas>
        </div>
      </div>

      <div style="flex: 1; min-width: 300px; max-width: 400px; border-left: 1px solid #333; padding-left: 20px; display: flex; flex-direction: column; height: 100%; overflow-y: auto;">
        <h3>Simulation Parameters</h3>
        
        <div style="margin-top: 15px;">
          <label style="font-size: 0.8rem; color: #888; display: block; margin-bottom: 4px;">Propagation Rule:</label>
          <select id="sim-rule-select" style="width: 100%; background: #111; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px;">
            <option value="">-- Choose a Rule --</option>
          </select>
        </div>

        <div style="margin-top: 15px;">
          <label style="font-size: 0.8rem; color: #888; display: block; margin-bottom: 4px;">Source NPC (Starts with Rumor):</label>
          <select id="sim-npc-select" style="width: 100%; background: #111; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px;">
            <option value="">-- Choose Source NPC --</option>
          </select>
        </div>

        <div style="margin-top: 20px; display: flex; gap: 10px;">
          <button class="editor-btn" id="sim-reset-btn" style="flex: 1; padding: 8px;">Reset</button>
          <button class="editor-btn" id="sim-step-btn" style="flex: 2; padding: 8px; font-weight: bold; background: #9b59b6; border-color: #8e44ad;">Step Propagation</button>
        </div>

        <div style="margin-top: 25px; flex-grow: 1; display: flex; flex-direction: column;">
          <h4 style="margin: 0 0 10px 0; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #aaa;">Simulation Log</h4>
          <div id="sim-log" style="flex-grow: 1; background: #111; border: 1px solid #222; border-radius: 4px; padding: 10px; font-family: monospace; font-size: 0.8rem; color: #2ecc71; overflow-y: auto; max-height: 250px;">
            <div>Simulator initialized. Choose a rule and source NPC to begin.</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const wrapper = container.querySelector('#sim-graph-wrapper') as HTMLElement;
  const canvas = container.querySelector('#sim-graph-canvas') as HTMLCanvasElement;
  const ruleSelect = container.querySelector('#sim-rule-select') as HTMLSelectElement;
  const npcSelect = container.querySelector('#sim-npc-select') as HTMLSelectElement;
  const resetBtn = container.querySelector('#sim-reset-btn') as HTMLButtonElement;
  const stepBtn = container.querySelector('#sim-step-btn') as HTMLButtonElement;
  const logEl = container.querySelector('#sim-log') as HTMLElement;

  if (!canvas || !wrapper) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const updateCanvasSize = (): void => {
    const rect = wrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  };
  updateCanvasSize();

  const rules = doc.rumorPropagation || [];
  rules.forEach((rule) => {
    const opt = document.createElement('option');
    opt.value = rule.id;
    opt.textContent = `${rule.id} (Event: ${rule.eventType})`;
    ruleSelect.appendChild(opt);
  });

  const nodes: SimNode[] = [];
  Object.entries(doc.areas).forEach(([areaId, area]) => {
    (area.placedEntities || []).forEach((pe, idx) => {
      const template = doc.entities[pe.templateId];
      if (template && template.memory) {
        nodes.push({
          id: `${areaId}_${pe.templateId}_${idx}`,
          areaId,
          templateId: pe.templateId,
          name: `${template.name}`,
          tags: template.tags || [],
          faction: template.faction || '',
          hasRumor: false,
          x: canvas.width / 2 + (rng.getUniform() - 0.5) * 300,
          y: canvas.height / 2 + (rng.getUniform() - 0.5) * 300,
          vx: 0,
          vy: 0,
          radius: 20
        });
      }
    });
  });

  nodes.forEach((node) => {
    const opt = document.createElement('option');
    opt.value = node.id;
    opt.textContent = `${node.name} [${doc.areas[node.areaId]?.name || node.areaId}]`;
    npcSelect.appendChild(opt);
  });

  const edges: SimEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i]!.areaId === nodes[j]!.areaId) {
        edges.push({
          source: nodes[i]!,
          target: nodes[j]!,
          type: 'portal'
        });
      }
    }
  }

  Object.entries(doc.areas).forEach(([areaId, area]) => {
    (area.connections || []).forEach((conn) => {
      const sourceNPCs = nodes.filter((n) => n.areaId === areaId);
      const targetNPCs = nodes.filter((n) => n.areaId === conn.targetAreaId);
      sourceNPCs.forEach((sn) => {
        targetNPCs.forEach((tn) => {
          edges.push({
            source: sn,
            target: tn,
            type: 'portal'
          });
        });
      });
    });
  });

  const log = (msg: string, color = '#2ecc71'): void => {
    const div = document.createElement('div');
    div.style.color = color;
    div.textContent = `[Step] ${msg}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  };

  const isEligible = (npc: SimNode, rule: RumorPropagationRule, sourceNpc: SimNode): boolean => {
    if (rule.eligibleTags && rule.eligibleTags.length > 0) {
      const hasTag = rule.eligibleTags.some((tag: string) => npc.tags.includes(tag));
      if (!hasTag) return false;
    }
    if (rule.eligibleFactions && rule.eligibleFactions.length > 0) {
      if (!rule.eligibleFactions.includes(npc.faction)) return false;
    }
    if (rule.requireAreaProximity) {
      if (npc.areaId === sourceNpc.areaId) {
        return true;
      }
      const sourceArea = doc.areas[sourceNpc.areaId];
      const isConnected = sourceArea?.connections?.some((conn) => conn.targetAreaId === npc.areaId);
      if (!isConnected) return false;
    }
    return true;
  };

  let sourceNodeId: string | null = null;
  let propagationEdges: SimEdge[] = [];

  const resetSimulation = (): void => {
    nodes.forEach((n) => {
      n.hasRumor = false;
    });
    propagationEdges = [];
    sourceNodeId = null;
    npcSelect.value = '';
    log('Simulation reset. Select a rule and source NPC to begin.');
  };

  resetBtn.addEventListener('click', resetSimulation);

  stepBtn.addEventListener('click', () => {
    const selectedRuleId = ruleSelect.value;
    const selectedNpcId = npcSelect.value;

    if (!selectedRuleId) {
      log('Error: Please select a propagation rule.', '#e74c3c');
      return;
    }
    if (!selectedNpcId) {
      log('Error: Please select a source NPC.', '#e74c3c');
      return;
    }

    const rule = rules.find((r) => r.id === selectedRuleId);
    if (!rule) return;

    if (!sourceNodeId) {
      sourceNodeId = selectedNpcId;
      const srcNode = nodes.find((n) => n.id === sourceNodeId);
      if (srcNode) {
        srcNode.hasRumor = true;
        log(`Rumor injected at source: ${srcNode.name} in area [${doc.areas[srcNode.areaId]?.name || srcNode.areaId}]`);
      }
    }

    const currentKnowers = nodes.filter((n) => n.hasRumor);
    const newlyInfected: SimNode[] = [];

    nodes.forEach((targetNpc) => {
      if (targetNpc.hasRumor) return;
      const transmitter = currentKnowers.find((knower) => isEligible(targetNpc, rule, knower));
      if (transmitter) {
        newlyInfected.push(targetNpc);
        propagationEdges.push({
          source: transmitter,
          target: targetNpc,
          type: 'propagation'
        });
      }
    });

    if (newlyInfected.length === 0) {
      log('Propagation complete. No more eligible NPCs found.', '#f1c40f');
    } else {
      newlyInfected.forEach((npc) => {
        npc.hasRumor = true;
        log(`Rumor spread to: ${npc.name} in area [${doc.areas[npc.areaId]?.name || npc.areaId}]`);
      });
    }
  });

  let isDragging = false;
  let draggedNode: SimNode | null = null;
  let hoveredNode: SimNode | null = null;
  let mouseX = 0;
  let mouseY = 0;
  let animationFrameId: number;

  const animate = (): void => {
    if (!isDragging) {
      stepKnowledgePhysics(nodes, edges, propagationEdges, canvas.width, canvas.height);
    } else if (draggedNode) {
      draggedNode.x = mouseX;
      draggedNode.y = mouseY;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      stepKnowledgePhysics(nodes, edges, propagationEdges, canvas.width, canvas.height);
    }
    drawKnowledgeGraph(ctx, canvas.width, canvas.height, doc, nodes, edges, propagationEdges, hoveredNode, draggedNode);
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
      hoveredNode = getKnowledgeNodeAt(nodes, mouseX, mouseY);
      canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggedNode = getKnowledgeNodeAt(nodes, x, y);
    if (draggedNode) {
      isDragging = true;
    }
  });

  canvas.addEventListener('mouseup', () => {
    isDragging = false;
    draggedNode = null;
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
