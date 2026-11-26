/**
 * Cached reverse-reference indexer & unified field-reference resolver over `CampaignData`.
 *
 * Shared by `<WhereUsedDrawer />`, campaign validation navigation, and `<ZodFormRenderer />`
 * dropdown projection (`getReferenceOptions`) so adding a new schema field resolves cleanly
 * in both directions from a single mapping table.
 */
import type { CampaignData } from '../types/campaign.types.ts';

/** Canonical reference target kind identifier. */
export type ReferenceTargetKind =
  | 'tile'
  | 'entity'
  | 'item'
  | 'entity_or_item'
  | 'area'
  | 'status'
  | 'effect'
  | 'field'
  | 'material'
  | 'thought'
  | 'currency'
  | 'faction'
  | 'ai'
  | 'dialogue'
  | 'dialogueNode'
  | 'quest'
  | 'questTemplate'
  | 'encounterProfile'
  | 'rumor'
  | 'tag'
  | 'sprite'
  | 'archetype'
  | 'eventType';

/** A single usage reference pointing back to a source location. */
export interface ReferenceUsage {
  readonly targetKind: string;
  readonly targetId: string;
  readonly sourcePath: string;
}

/** The full inverted reference index for a single campaign document. */
export interface ReferenceIndex {
  readonly usages: ReadonlyMap<string, ReadonlyArray<ReferenceUsage>>;
}

/** Cache keyed by document identity (not value equality). */
const indexCache = new WeakMap<object, ReferenceIndex>();

const PROCEDURAL_TILE_KEYS = new Set<string>(['floor', 'wall', 'door', 'water']);
const PROCEDURAL_ENTITY_KEYS = new Set<string>(['player', 'stairsDown', 'stairsUp', 'portal', 'chest']);

/**
 * Resolves the canonical `ReferenceTargetKind` for a schema field name and canonical JSON path.
 * Shared single source of truth between reverse-reference indexing and dropdown option projection.
 *
 * @param fieldKey The leaf field key (or parent array key when indexing array elements).
 * @param jsonPath Canonical slash-leading JSON pointer path (e.g. `/areas/crypt/placedEntities/0/templateId`).
 * @returns The canonical target kind, or `null` if the field is not a foreign-key reference.
 */
export function resolveFieldReferenceKind(fieldKey: string, jsonPath: string): ReferenceTargetKind | null {
  const lower = fieldKey.toLowerCase();

  // Path-specific compound rules
  if (jsonPath.includes('/staticMap/legend/')) return 'tile';
  if (jsonPath.includes('/staticMap/entityLegend/')) return 'entity';
  if (jsonPath.includes('/proceduralPalette/')) {
    if (PROCEDURAL_TILE_KEYS.has(fieldKey) || lower.includes('tile')) return 'tile';
    if (PROCEDURAL_ENTITY_KEYS.has(fieldKey) || lower.includes('entity')) return 'entity';
    return 'entity';
  }
  if (jsonPath.includes('/biomePalette/')) {
    if (lower.includes('tile') || PROCEDURAL_TILE_KEYS.has(fieldKey)) return 'tile';
  }
  if (jsonPath.includes('/lootTable/') || lower === 'inventory' || lower === 'startinginventory') {
    return 'item';
  }

  // Exact & suffix/pattern field rules
  if (fieldKey === 'archetypeId') return 'archetype';
  if (fieldKey === 'faction' || lower.includes('factionid') || fieldKey === 'factionA' || fieldKey === 'factionB') {
    return 'faction';
  }
  if (
    fieldKey === 'startingAreaId' ||
    fieldKey === 'targetArea' ||
    fieldKey === 'targetAreaId' ||
    fieldKey === 'areaId' ||
    fieldKey === 'connectedAreaId'
  ) {
    return 'area';
  }
  if (fieldKey === 'effectId' || fieldKey === 'effectIds') return 'effect';
  if (fieldKey === 'profileId' || fieldKey === 'aiProfileId') return 'ai';
  if (fieldKey === 'statusId' || fieldKey === 'immuneStatuses') return 'status';
  if (fieldKey === 'dialogueId') return 'dialogue';
  if (
    fieldKey === 'nextNodeId' ||
    fieldKey === 'onKnownNodeId' ||
    fieldKey === 'onUnknownNodeId' ||
    fieldKey === 'startNodeId'
  ) {
    return 'dialogueNode';
  }
  if (fieldKey === 'questId' || fieldKey === 'nextQuestId') return 'quest';
  if (fieldKey === 'questTemplateId') return 'questTemplate';
  if (fieldKey === 'itemId' || fieldKey === 'boulderItemId') return 'item';
  if (fieldKey === 'encounterProfileId') return 'encounterProfile';
  if (
    fieldKey === 'portalTemplateId' ||
    fieldKey === 'entityTemplateId' ||
    fieldKey === 'promotionSources' ||
    fieldKey === 'promotionSource' ||
    fieldKey === 'bossTemplateId' ||
    fieldKey === 'villainTemplateId'
  ) {
    return 'entity';
  }
  if (fieldKey === 'templateId') {
    if (jsonPath.startsWith('/areas/') || jsonPath.startsWith('/spawnPools/')) {
      return 'entity';
    }
    return 'entity_or_item';
  }
  if (
    fieldKey === 'minedTileId' ||
    fieldKey === 'obsidianTileId' ||
    fieldKey === 'burnedTileId' ||
    fieldKey === 'tileId'
  ) {
    return 'tile';
  }
  if (fieldKey === 'fieldId' || fieldKey === 'spawnFieldType' || fieldKey === 'fieldType') {
    return 'field';
  }
  if (fieldKey === 'materialId') return 'material';
  if (fieldKey === 'thoughtOverride' || fieldKey === 'thoughtId') return 'thought';
  if (fieldKey === 'baseUnitId' || fieldKey === 'defaultValueDenominationId' || fieldKey === 'currencyUnitId') {
    return 'currency';
  }
  if (fieldKey === 'injectRumorId' || fieldKey === 'rumorId') return 'rumor';
  if (fieldKey === 'spriteId') return 'sprite';
  if (fieldKey === 'eventType') return 'eventType';
  if (lower.includes('tag') && fieldKey !== 'tagRegistry') return 'tag';

  return null;
}

function recordUsage(usages: ReferenceUsage[], targetKind: string, targetId: string, sourcePath: string): void {
  if (!targetId) return;
  usages.push({ targetKind, targetId, sourcePath });
}

function walkCampaignReferences(node: unknown, currentPath: string, leafKey: string, usages: ReferenceUsage[]): void {
  if (node === null || node === undefined) return;

  // Special multi-kind cases that depend on sibling discriminator fields
  if (typeof node === 'object' && !Array.isArray(node)) {
    const rec = node as Record<string, unknown>;

    // Quest objective: targetId depends on objective.type
    if (
      currentPath.startsWith('/quests/') &&
      currentPath.includes('/objectives/') &&
      typeof rec.targetId === 'string'
    ) {
      const objType = rec.type;
      const targetKind = objType === 'gather' ? 'item' : objType === 'explore' ? 'area' : 'entity';
      recordUsage(usages, targetKind, rec.targetId, `${currentPath}/targetId`);
    }

    // Quest reward: itemId when type === 'item'
    if (
      currentPath.startsWith('/quests/') &&
      currentPath.includes('/rewards/') &&
      rec.type === 'item' &&
      typeof rec.itemId === 'string'
    ) {
      recordUsage(usages, 'item', rec.itemId, `${currentPath}/itemId`);
    }

    for (const [k, val] of Object.entries(rec)) {
      if (k === 'loadedSpritePacks' || k === 'srcBasePath') continue;
      // Skip objective targetId / reward itemId since we handled their discriminated kind above
      if (
        (currentPath.startsWith('/quests/') && currentPath.includes('/objectives/') && k === 'targetId') ||
        (currentPath.startsWith('/quests/') && currentPath.includes('/rewards/') && k === 'itemId')
      ) {
        continue;
      }

      const childPath = `${currentPath}/${k}`;
      walkCampaignReferences(val, childPath, k, usages);
    }
    return;
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const el = node[i];
      const childPath = `${currentPath}/${i}`;
      if (typeof el === 'string') {
        const refKind = resolveFieldReferenceKind(leafKey, currentPath);
        if (refKind) {
          emitStringRef(usages, refKind, el, currentPath, childPath);
        }
      } else {
        walkCampaignReferences(el, childPath, leafKey, usages);
      }
    }
    return;
  }

  if (typeof node === 'string') {
    // Do not index dictionary primary definition IDs (e.g. /items/sword/id === 'sword')
    const segments = currentPath.split('/').filter(Boolean);
    if (segments.length === 3 && leafKey === 'id') {
      return;
    }
    const refKind = resolveFieldReferenceKind(leafKey, currentPath);
    if (refKind) {
      emitStringRef(usages, refKind, node, currentPath, currentPath);
    }
  }
}

function emitStringRef(
  usages: ReferenceUsage[],
  refKind: ReferenceTargetKind,
  value: string,
  parentPath: string,
  sourcePath: string
): void {
  if (!value) return;

  if (refKind === 'dialogueNode') {
    const segments = sourcePath.split('/').filter(Boolean);
    const dialogueId = segments[0] === 'dialogues' ? segments[1] : undefined;
    if (dialogueId) {
      recordUsage(usages, 'dialogueNode', `${dialogueId}:${value}`, sourcePath);
    }
    return;
  }

  if (refKind === 'entity_or_item') {
    recordUsage(usages, 'entity', value, sourcePath);
    recordUsage(usages, 'item', value, sourcePath);
    return;
  }

  // Area placedEntities & connections historically report paths anchored by object `.index` when present,
  // or array index cleanly from walker. Both resolve identically in `navigateToPath`.
  void parentPath;
  recordUsage(usages, refKind, value, sourcePath);
}

/**
 * Builds (or retrieves from `WeakMap` cache) the reverse-reference index for a campaign document.
 *
 * @param data The campaign document to index.
 * @returns Cached or newly constructed `ReferenceIndex`.
 */
export function buildReferenceIndex(data: CampaignData): ReferenceIndex {
  const cached = indexCache.get(data);
  if (cached) return cached;

  const usages: ReferenceUsage[] = [];
  walkCampaignReferences(data, '', '', usages);

  const usageMap = new Map<string, ReferenceUsage[]>();
  for (const u of usages) {
    const key = `${u.targetKind}:${u.targetId}`;
    const existing = usageMap.get(key) ?? [];
    existing.push(u);
    usageMap.set(key, existing);
  }

  const index: ReferenceIndex = { usages: usageMap };
  indexCache.set(data, index);
  return index;
}

/**
 * Queries all source paths referencing a target entity/item/area/status/etc.
 */
export function queryUsages(
  index: ReferenceIndex,
  targetKind: string,
  targetId: string
): ReadonlyArray<ReferenceUsage> {
  return index.usages.get(`${targetKind}:${targetId}`) ?? [];
}

/**
 * Checks whether at least one reference points to a given target.
 */
export function hasUsage(index: ReferenceIndex, targetKind: string, targetId: string): boolean {
  return queryUsages(index, targetKind, targetId).length > 0;
}
