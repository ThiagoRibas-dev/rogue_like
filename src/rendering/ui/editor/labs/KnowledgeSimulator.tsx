import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { Button } from '../../primitives/Button.tsx';
import { FormField, Select } from '../../primitives/FormControls.tsx';
import {
  drawKnowledgeGraph,
  getKnowledgeNodeAt,
  type SimEdge,
  type SimNode,
  stepKnowledgePhysics
} from '../../knowledge_sim_canvas.ts';
import { buildKnowledgeGraph, isNpcEligible } from './knowledge_sim_helpers.ts';

interface LogEntry {
  readonly text: string;
  readonly tone: 'info' | 'warn' | 'error';
}

/** Props for `<KnowledgeSimulator />`. */
export interface KnowledgeSimulatorProps {
  readonly controller: EditorController;
}

/**
 * Interactive Knowledge & Rumor Simulator rendering force-directed NPC rumor spread on canvas.
 */
export function KnowledgeSimulator({ controller }: KnowledgeSimulatorProps): JSX.Element {
  const doc = controller.getDocument();
  const rules = doc.rumorPropagation ?? [];

  const [selectedRuleId, setSelectedRuleId] = useState<string>(() => rules[0]?.id ?? '');
  const [selectedNpcId, setSelectedNpcId] = useState<string>('');
  const [logs, setLogs] = useState<ReadonlyArray<LogEntry>>([
    { text: 'Simulator initialized. Choose a rule and source NPC to begin.', tone: 'info' }
  ]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simStateRef = useRef<{
    nodes: SimNode[];
    edges: SimEdge[];
    propagationEdges: SimEdge[];
    sourceNodeId: string | null;
  }>({ nodes: [], edges: [], propagationEdges: [], sourceNodeId: null });

  const [npcOptions, setNpcOptions] = useState<ReadonlyArray<{ readonly value: string; readonly label: string }>>([]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrapper || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const updateSize = (): void => {
      const rect = wrapper.getBoundingClientRect();
      canvas.width = Math.max(320, rect.width);
      canvas.height = Math.max(260, rect.height);
    };
    updateSize();

    const { nodes, edges } = buildKnowledgeGraph(doc, canvas.width, canvas.height);
    simStateRef.current = { nodes, edges, propagationEdges: [], sourceNodeId: null };
    setNpcOptions(
      nodes.map((n) => ({
        value: n.id,
        label: `${n.name} [${doc.areas[n.areaId]?.name ?? n.areaId}]`
      }))
    );

    let animId = 0;
    let isDragging = false;
    let draggedNode: SimNode | null = null;
    let hoveredNode: SimNode | null = null;
    let mouseX = 0;
    let mouseY = 0;

    const animate = (): void => {
      const st = simStateRef.current;
      if (!isDragging) {
        stepKnowledgePhysics(st.nodes, st.edges, st.propagationEdges, canvas.width, canvas.height);
      } else if (draggedNode) {
        draggedNode.x = mouseX;
        draggedNode.y = mouseY;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
        stepKnowledgePhysics(st.nodes, st.edges, st.propagationEdges, canvas.width, canvas.height);
      }
      drawKnowledgeGraph(
        ctx,
        canvas.width,
        canvas.height,
        doc,
        st.nodes,
        st.edges,
        st.propagationEdges,
        hoveredNode,
        draggedNode
      );
      animId = requestAnimationFrame(animate);
    };

    const onMouseMove = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
      if (isDragging && draggedNode) {
        draggedNode.x = mouseX;
        draggedNode.y = mouseY;
      } else {
        hoveredNode = getKnowledgeNodeAt(simStateRef.current.nodes, mouseX, mouseY);
        canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
      }
    };

    const onMouseDown = (e: MouseEvent): void => {
      const rect = canvas.getBoundingClientRect();
      draggedNode = getKnowledgeNodeAt(simStateRef.current.nodes, e.clientX - rect.left, e.clientY - rect.top);
      if (draggedNode) isDragging = true;
    };

    const onMouseUp = (): void => {
      isDragging = false;
      draggedNode = null;
    };

    const onMouseLeave = (): void => {
      isDragging = false;
      draggedNode = null;
      hoveredNode = null;
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(wrapper);

    animId = requestAnimationFrame(animate);

    return (): void => {
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [doc]);

  const appendLog = (text: string, tone: LogEntry['tone'] = 'info'): void => {
    setLogs((prev) => [...prev, { text, tone }]);
  };

  const handleReset = (): void => {
    const st = simStateRef.current;
    st.nodes.forEach((n) => {
      n.hasRumor = false;
    });
    st.propagationEdges = [];
    st.sourceNodeId = null;
    setSelectedNpcId('');
    appendLog('Simulation reset. Select a rule and source NPC to begin.', 'info');
  };

  const handleStep = (): void => {
    if (!selectedRuleId) {
      appendLog('Error: Please select a propagation rule.', 'error');
      return;
    }
    if (!selectedNpcId) {
      appendLog('Error: Please select a source NPC.', 'error');
      return;
    }
    const rule = rules.find((r) => r.id === selectedRuleId);
    if (!rule) return;

    const st = simStateRef.current;
    if (!st.sourceNodeId) {
      st.sourceNodeId = selectedNpcId;
      const srcNode = st.nodes.find((n) => n.id === st.sourceNodeId);
      if (srcNode) {
        srcNode.hasRumor = true;
        appendLog(
          `Rumor injected at source: ${srcNode.name} in area [${doc.areas[srcNode.areaId]?.name ?? srcNode.areaId}]`
        );
      }
    }

    const currentKnowers = st.nodes.filter((n) => n.hasRumor);
    const newlyInfected: SimNode[] = [];
    for (const targetNpc of st.nodes) {
      if (targetNpc.hasRumor) continue;
      const transmitter = currentKnowers.find((knower) => isNpcEligible(doc, targetNpc, rule, knower));
      if (transmitter) {
        newlyInfected.push(targetNpc);
        st.propagationEdges.push({ source: transmitter, target: targetNpc, type: 'propagation' });
      }
    }

    if (newlyInfected.length === 0) {
      appendLog('Propagation complete. No more eligible NPCs found.', 'warn');
    } else {
      for (const npc of newlyInfected) {
        npc.hasRumor = true;
        appendLog(`Rumor spread to: ${npc.name} in area [${doc.areas[npc.areaId]?.name ?? npc.areaId}]`);
      }
    }
  };

  return (
    <div className="ui-editor-split">
      <div className="ui-editor-split__left">
        <h3>Knowledge &amp; Rumor Simulator</h3>
        <p className="ui-editor-muted">
          Blue nodes are NPCs. Purple nodes have received the rumor according to propagation rules.
        </p>
        <div ref={wrapperRef} className="ui-editor-canvas-stage ui-editor-stage--tall">
          <canvas ref={canvasRef} className="ui-editor-stage__canvas" />
        </div>
      </div>

      <div className="ui-editor-split__right">
        <h4>Simulation Parameters</h4>
        <FormField label="Propagation Rule">
          <Select
            value={selectedRuleId}
            ariaLabel="Propagation Rule"
            options={[
              { value: '', label: '-- Choose a Rule --' },
              ...rules.map((r) => ({ value: r.id, label: `${r.id} (Event: ${r.eventType})` }))
            ]}
            onChange={setSelectedRuleId}
          />
        </FormField>

        <FormField label="Source NPC">
          <Select
            value={selectedNpcId}
            ariaLabel="Source NPC"
            options={[{ value: '', label: '-- Choose Source NPC --' }, ...npcOptions]}
            onChange={setSelectedNpcId}
          />
        </FormField>

        <div className="ui-editor-lab-actions">
          <Button onClick={handleReset}>Reset</Button>
          <Button variant="primary" onClick={handleStep}>
            Step Propagation
          </Button>
        </div>

        <h4>Simulation Log</h4>
        <div className="ui-editor-log ui-editor-log--sim">
          {logs.map((entry, idx) => (
            <div key={idx} className={`ui-editor-sim-log-row is-${entry.tone}`}>
              [Step] {entry.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
