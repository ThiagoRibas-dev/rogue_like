/**
 * Cached reverse-reference indexer over `CampaignData`.
 *
 * Builds an inverted index mapping target ids (entity template, item, dialogue,
 * status, tile, area, node) back to the source paths that reference them.
 *
 * Cached by document identity (`WeakMap`) so the index is rebuilt only when
 * `controller.getDocument()` returns a new object.
 *
 * @see docs/research_notes.md §10.3 — §10.4
 * @see docs/DECISIONS.md — Milestone 76, Decision D1 (global workspace drawer)
 */
import type { CampaignData } from '../types/campaign.types';

/** A single usage reference pointing back to a source location. */
export interface ReferenceUsage {
  readonly targetKind: string;
  readonly targetId: string;
  readonly sourcePath: string;
}

/** The full index for a single campaign document. */
export interface ReferenceIndex {
  readonly usages: ReadonlyMap<string, ReadonlyArray<ReferenceUsage>>;
}

/** Cache keyed by document identity (not value equality). */
const indexCache = new WeakMap<object, ReferenceIndex>();

/**
 * Build (or retrieve from cache) the reverse-reference index for a campaign.
 */
export function buildReferenceIndex(data: CampaignData): ReferenceIndex {
  const cached = indexCache.get(data);
  if (cached) return cached;

  const usages: ReferenceUsage[] = [];

  // Areas (Record<string, AreaDefinition>)
  const areas = data.areas ?? {};
  for (const [areaId, area] of Object.entries(areas)) {
    const safeAreaId = String(areaId);

    // Placed entities
    for (const placedObj of (area.placedEntities || [])) {
      const placed = placedObj as Record<string, unknown>;
      const indexVal = String(placed.index || '');
      const base = `/areas/${safeAreaId}/placedEntities/${indexVal}`;
      const templateId = String((placed as Record<string, unknown>).templateId || '');
      if (templateId) usages.push({ targetKind: 'entity', targetId: templateId, sourcePath: `${base}/templateId` });
      for (const invId of ((placed as Record<string, unknown>).inventory || []) as ReadonlyArray<unknown>) {
        usages.push({ targetKind: 'item', targetId: String(invId), sourcePath: `${base}/inventory` });
      }
    }

    // Connections
    for (const connObj of (area.connections || [])) {
      const conn = connObj as Record<string, unknown>;
      const indexValConn = String(conn.index || '');
      const connBase = `/areas/${safeAreaId}/connections/${indexValConn}`;
      const portalId = String((conn as Record<string, unknown>).portalTemplateId || '');
      if (portalId) usages.push({ targetKind: 'entity', targetId: portalId, sourcePath: `${connBase}/portalTemplateId` });
    }

    // Procedural palette
    const palette = area.proceduralPalette || {};
    for (const [key, val] of Object.entries(palette)) {
      const valStr = String(val || '');
      if (valStr) {
        const kind = (key === 'floor' || key === 'wall' || key === 'door' || key === 'water') ? 'tile' : 'entity';
        usages.push({ targetKind: kind, targetId: valStr, sourcePath: `/areas/${safeAreaId}/proceduralPalette/${key}` });
      }
    }

    // Static map legend
    const legend = area.staticMap?.legend || {};
    for (const [key, val] of Object.entries(legend)) {
      const valStr = String(val || '');
      if (valStr) usages.push({ targetKind: 'tile', targetId: valStr, sourcePath: `/areas/${safeAreaId}/staticMap/legend/${key}` });
    }

    // Encounter profile
    const profileId = String(area.encounterProfileId || '');
    if (profileId) usages.push({ targetKind: 'encounterProfile', targetId: profileId, sourcePath: `/areas/${safeAreaId}/encounterProfileId` });
  }

  // Entities (Record<string, EntityTemplateSchema>) -> dialogues
  for (const [entityId, entity] of Object.entries(data.entities || {})) {
    const dialogueId = String((entity as Record<string, unknown>).dialogueId || '');
    if (dialogueId) usages.push({ targetKind: 'dialogue', targetId: dialogueId, sourcePath: `/entities/${entityId}/dialogueId` });
  }

  // Items (Record<string, ItemDefinitionSchema>) -> status
  for (const [itemId, item] of Object.entries(data.items || {})) {
    const equippable = (item as Record<string, unknown>).equippable as Record<string, unknown> | undefined;
    const onHitObj = equippable ? (equippable.onHit as Record<string, unknown> | undefined) : undefined;
    const statusId = String(onHitObj?.statusId || '');
    if (statusId) usages.push({ targetKind: 'status', targetId: statusId, sourcePath: `/items/${itemId}/equippable/onHit/statusId` });
  }

  // Dialogues (Record<string, DialogueTreeSchema>) -> dialogue nodes (intra-tree)
  for (const [dialogueId, dialogue] of Object.entries(data.dialogues || {})) {
    const safeDialogueId = String(dialogueId);
    const nodes = (dialogue as Record<string, unknown>).nodes || {};
    for (const [nodeId, nodeObj] of Object.entries(nodes)) {
      const safeNodeId = String(nodeId);
      const nodeBase = `/dialogues/${safeDialogueId}/nodes/${safeNodeId}`;
      const node = nodeObj as Record<string, unknown>;
      const options = (node.options || []) as Array<Record<string, unknown>>;
      for (const opt of options) {
        const nextId = String(opt.nextNodeId || '');
        if (nextId) usages.push({ targetKind: 'dialogueNode', targetId: `${safeDialogueId}:${nextId}`, sourcePath: `${nodeBase}/options/${String(opt.index || '')}/nextNodeId` });
      }
      const onKnownId = String(node.onKnownNodeId || '');
      if (onKnownId) usages.push({ targetKind: 'dialogueNode', targetId: `${safeDialogueId}:${onKnownId}`, sourcePath: `${nodeBase}/onKnownNodeId` });
      const onUnknownId = String(node.onUnknownNodeId || '');
      if (onUnknownId) usages.push({ targetKind: 'dialogueNode', targetId: `${safeDialogueId}:${onUnknownId}`, sourcePath: `${nodeBase}/onUnknownNodeId` });
    }
    const startNodeId = String((dialogue as Record<string, unknown>).startNodeId || '');
    if (startNodeId) usages.push({ targetKind: 'dialogueNode', targetId: `${safeDialogueId}:${startNodeId}`, sourcePath: `/dialogues/${safeDialogueId}/startNodeId` });
  }

  const usageMap = new Map<string, ReferenceUsage[]>();
  for (const u of usages) {
    const key = `${u.targetKind}:${u.targetId}`;
    const existing = usageMap.get(key) || [];
    existing.push(u);
    usageMap.set(key, existing);
  }

  const index: ReferenceIndex = { usages: usageMap };
  indexCache.set(data, index);
  return index;
}

/**
 * Query usages for a specific target kind + id.
 */
export function queryUsages(
  index: ReferenceIndex,
  targetKind: string,
  targetId: string
): ReadonlyArray<ReferenceUsage> {
  return index.usages.get(`${targetKind}:${targetId}`) ?? [];
}

/**
 * Check whether a reference to a given target exists anywhere in the campaign.
 */
export function hasUsage(
  index: ReferenceIndex,
  targetKind: string,
  targetId: string
): boolean {
  return queryUsages(index, targetKind, targetId).length > 0;
}
