import type { RumorPropagationRule } from '../../types/campaign.types.ts';
import type { EditorController } from '../editor_ui.ts';

interface SimNode {
  id: string; // areaId_templateId_index
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

interface SimEdge {
  source: SimNode;
  target: SimNode;
  type: 'portal' | 'propagation';
}

/**
 * Renders the localized Knowledge & Rumor Simulator.
 */
export function renderKnowledgeSimulator(controller: EditorController, container: HTMLElement): void {
  const doc = controller.getDocument();

  container.innerHTML = `
    <div style="display: flex; gap: 20px; height: 100%; width: 100%;">
      <!-- Graph Canvas Pane -->
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

      <!-- Controls Panel -->
      <div style="flex: 1; min-width: 300px; max-width: 400px; border-left: 1px solid #333; padding-left: 20px; display: flex; flex-direction: column; height: 100%; overflow-y: auto;">
        <h3>Simulation Parameters</h3>
        
        <!-- Rule Selection -->
        <div style="margin-top: 15px;">
          <label style="font-size: 0.8rem; color: #888; display: block; margin-bottom: 4px;">Propagation Rule:</label>
          <select id="sim-rule-select" style="width: 100%; background: #111; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px;">
            <option value="">-- Choose a Rule --</option>
          </select>
        </div>

        <!-- Start NPC Selection -->
        <div style="margin-top: 15px;">
          <label style="font-size: 0.8rem; color: #888; display: block; margin-bottom: 4px;">Source NPC (Starts with Rumor):</label>
          <select id="sim-npc-select" style="width: 100%; background: #111; color: #fff; border: 1px solid #333; padding: 6px; border-radius: 4px;">
            <option value="">-- Choose Source NPC --</option>
          </select>
        </div>

        <!-- Action Buttons -->
        <div style="margin-top: 20px; display: flex; gap: 10px;">
          <button class="editor-btn" id="sim-reset-btn" style="flex: 1; padding: 8px;">Reset</button>
          <button class="editor-btn" id="sim-step-btn" style="flex: 2; padding: 8px; font-weight: bold; background: #9b59b6; border-color: #8e44ad;">Step Propagation</button>
        </div>

        <!-- Sim Info / Log -->
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

  const updateCanvasSize = () => {
    const rect = wrapper.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  };
  updateCanvasSize();

  // 1. Populate Dropdowns
  const rules = doc.rumorPropagation || [];
  rules.forEach((rule) => {
    const opt = document.createElement('option');
    opt.value = rule.id;
    opt.textContent = `${rule.id} (Event: ${rule.eventType})`;
    ruleSelect.appendChild(opt);
  });

  // Collect placed NPCs that have memory components
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
          x: canvas.width / 2 + (Math.random() - 0.5) * 300,
          y: canvas.height / 2 + (Math.random() - 0.5) * 300,
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

  // 2. Build Area Portals & Connections for the Physical Topology
  const edges: SimEdge[] = [];

  // Link NPCs in the same area together (short springs)
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

  // Link NPCs in adjacent areas (longer springs)
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

  // Helper for logging
  const log = (msg: string, color = '#2ecc71') => {
    const div = document.createElement('div');
    div.style.color = color;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  };

  // Eligibility matching
  const isEligible = (npc: SimNode, rule: RumorPropagationRule, sourceNpc: SimNode): boolean => {
    // 1. check eligibleTags
    if (rule.eligibleTags && rule.eligibleTags.length > 0) {
      const hasTag = rule.eligibleTags.some((tag: string) => npc.tags.includes(tag));
      if (!hasTag) return false;
    }
    // 2. check eligibleFactions
    if (rule.eligibleFactions && rule.eligibleFactions.length > 0) {
      if (!rule.eligibleFactions.includes(npc.faction)) return false;
    }
    // 3. check requireAreaProximity
    if (rule.requireAreaProximity) {
      if (npc.areaId === sourceNpc.areaId) {
        return true;
      }
      // Check if areas are connected
      const sourceArea = doc.areas[sourceNpc.areaId];
      const isConnected = sourceArea?.connections?.some((conn) => conn.targetAreaId === npc.areaId);
      if (!isConnected) return false;
    }
    return true;
  };

  // Simulation State
  let sourceNodeId: string | null = null;
  let propagationEdges: SimEdge[] = [];

  const resetSimulation = () => {
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

    // Initial step setup
    if (!sourceNodeId) {
      sourceNodeId = selectedNpcId;
      const srcNode = nodes.find((n) => n.id === sourceNodeId);
      if (srcNode) {
        srcNode.hasRumor = true;
        log(`Rumor injected at source: ${srcNode.name} in area [${doc.areas[srcNode.areaId]?.name || srcNode.areaId}]`);
      }
    }

    // Find all NPCs that currently have the rumor
    const currentKnowers = nodes.filter((n) => n.hasRumor);
    const newlyInfected: SimNode[] = [];

    // Propagate from each current knower to eligible neighbors
    nodes.forEach((targetNpc) => {
      if (targetNpc.hasRumor) return;

      // Find if there's any knower that can transmit to this target NPC
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

  // 3. Force-directed physics parameters
  const k = 0.08;
  const idealLengthPortal = 140;
  const idealLengthPropagation = 70;
  const repulsion = 4000;
  const damping = 0.75;

  let isDragging = false;
  let draggedNode: SimNode | null = null;
  let hoveredNode: SimNode | null = null;
  let mouseX = 0;
  let mouseY = 0;

  const stepPhysics = () => {
    // 1. Repulsion between all nodes
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const n1 = nodes[i]!;
        const n2 = nodes[j]!;
        const dx = n1.x - n2.x;
        const dy = n1.y - n2.y;
        const distSq = dx * dx + dy * dy || 1;
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

    // 2. Spring forces along portal/physical topology edges
    edges.forEach((edge) => {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy || 1);
      const ideal = edge.source.areaId === edge.target.areaId ? idealLengthPropagation : idealLengthPortal;
      const displacement = dist - ideal;
      const force = k * displacement;

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      edge.source.vx += fx;
      edge.source.vy += fy;
      edge.target.vx -= fx;
      edge.target.vy -= fy;
    });

    // 3. Spring forces along active rumor propagation edges (pulls rumor network together)
    propagationEdges.forEach((edge) => {
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const dist = Math.sqrt(dx * dx + dy * dy || 1);
      const displacement = dist - idealLengthPropagation;
      const force = k * displacement * 1.5; // Slightly stronger pull

      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;

      edge.source.vx += fx;
      edge.source.vy += fy;
      edge.target.vx -= fx;
      edge.target.vy -= fy;
    });

    // 4. Central gravity and movement updates
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    nodes.forEach((n) => {
      n.vx += (centerX - n.x) * 0.015;
      n.vy += (centerY - n.y) * 0.015;

      n.vx *= damping;
      n.vy *= damping;

      n.x += n.vx;
      n.y += n.vy;
    });
  };

  const draw = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw area clusters (physical bounding circles / labels)
    const areaNpcs = new Map<string, SimNode[]>();
    nodes.forEach((n) => {
      if (!areaNpcs.has(n.areaId)) areaNpcs.set(n.areaId, []);
      areaNpcs.get(n.areaId)!.push(n);
    });

    ctx.save();
    areaNpcs.forEach((npcs, areaId) => {
      if (npcs.length === 0) return;
      // Find bounding box / average center of area cluster
      let cx = 0,
        cy = 0;
      npcs.forEach((n) => {
        cx += n.x;
        cy += n.y;
      });
      cx /= npcs.length;
      cy /= npcs.length;

      // Draw faint cluster background
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw area name label
      ctx.fillStyle = '#666';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText((doc.areas[areaId]?.name || areaId).toUpperCase(), cx, cy - 80);
    });
    ctx.restore();

    // Draw portal/physical edges
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

    // Draw active propagation edges (purple glowing arrows)
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

      // Arrowhead
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

    // Draw Nodes
    nodes.forEach((n) => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);

      if (n.hasRumor) {
        ctx.fillStyle = '#9b59b6'; // Purple for rumor infected
        ctx.strokeStyle = '#8e44ad';
      } else {
        ctx.fillStyle = '#3498db'; // Blue for normal NPCs
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

      // Draw NPC initials or emoji
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

      // Draw full NPC name below
      ctx.fillStyle = n.hasRumor ? '#e0b0ff' : '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.fillText(n.name, n.x, n.y + n.radius + 12);
    });
  };

  const getNodeAt = (x: number, y: number): SimNode | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]!;
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        return n;
      }
    }
    return null;
  };

  let animationFrameId: number;

  const animate = () => {
    if (!isDragging) {
      stepPhysics();
    } else if (draggedNode) {
      draggedNode.x = mouseX;
      draggedNode.y = mouseY;
      draggedNode.vx = 0;
      draggedNode.vy = 0;
      stepPhysics();
    }
    draw();
    animationFrameId = requestAnimationFrame(animate);
  };

  // Canvas Mouse events
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

  // Cleanup
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
