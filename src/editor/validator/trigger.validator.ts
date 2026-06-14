import type { CampaignData } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

export async function validateTriggers(campaign: Readonly<CampaignData>): Promise<ReadonlyArray<ValidationError>> {
  const errors: ValidationError[] = [];

  // 1. Map events to triggers that listen for them
  const eventToTriggers = new Map<string, string[]>();
  for (const [triggerId, trigger] of Object.entries(campaign.triggers)) {
    if (!eventToTriggers.has(trigger.eventType)) {
      eventToTriggers.set(trigger.eventType, []);
    }
    eventToTriggers.get(trigger.eventType)!.push(triggerId);
  }

  // 2. Build dependency graph (Trigger -> triggers it emits events for)
  const graph = new Map<string, Set<string>>();
  for (const [triggerId, trigger] of Object.entries(campaign.triggers)) {
    const dependencies = new Set<string>();
    for (const consequence of trigger.consequences) {
      if (consequence.type !== 'emit_event') continue;

      const emittedEventType = consequence.type === 'emit_event' ? consequence.eventType : undefined;
      if (!emittedEventType) continue;

      const chainedTriggers = eventToTriggers.get(emittedEventType) || [];
      for (const chained of chainedTriggers) {
        dependencies.add(chained);
      }
    }
    graph.set(triggerId, dependencies);
  }

  // 3. Cycle detection (DFS)
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const hasCycle = (node: string, path: string[]): boolean => {
    if (recursionStack.has(node)) {
      reportCycle(node, path, campaign, errors);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const neighbors = graph.get(node) || new Set();
    for (const neighbor of neighbors) {
      hasCycle(neighbor, path);
    }

    path.pop();
    recursionStack.delete(node);
    return false;
  };

  for (const triggerId of Object.keys(campaign.triggers)) {
    if (!visited.has(triggerId)) {
      hasCycle(triggerId, []);
    }
    // Yield outside recursive traversal to keep UI responsive
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return errors;
}

/**
 * Helper to analyze and report a cycle. Only reports errors if the cycle lacks gating conditions.
 */
function reportCycle(
  node: string,
  path: ReadonlyArray<string>,
  campaign: Readonly<CampaignData>,
  errors: ValidationError[]
): void {
  const cycleStartIndex = path.indexOf(node);
  const cycleNodes = path.slice(cycleStartIndex);

  // Check if any trigger in the cycle has conditions (gating)
  const hasGating = cycleNodes.some((cNode) => {
    const trigger = campaign.triggers[cNode];
    return trigger && trigger.conditions.length > 0;
  });

  if (!hasGating) {
    errors.push({
      path: `/triggers`,
      message: `Unconditional trigger recursion loop detected: ${cycleNodes.join(' -> ')} -> ${node}`,
      severity: 'error'
    });
  }
}
