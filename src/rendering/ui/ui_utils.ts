import { AUTHORING_LEVELS } from '../../constants/campaign.constants.ts';
import { type ReferenceTargetKind, resolveFieldReferenceKind } from '../../editor/reference_index.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { GameEventType } from '../../types/events.types.ts';
import { resolveThemeSpriteSheets } from '../../utils/sprite_pack.ts';

/**
 * Type-safe generic wrapper for querying a DOM element within a parent node.
 */
export function querySelectorTyped<T extends HTMLElement = HTMLElement>(
  parent: ParentNode,
  selector: string
): T | null {
  return parent.querySelector<T>(selector);
}

function getBadge(category: keyof CampaignData, id: string, doc: CampaignData): string {
  let level: 'Static' | 'Blueprint' | 'Dynamic' = AUTHORING_LEVELS[category] ?? 'Static';
  if (category === 'areas' && doc.areas[id]?.generatorType && doc.areas[id].generatorType !== 'static') {
    level = 'Blueprint';
  }
  return level === 'Blueprint' ? ' [BP]' : level === 'Dynamic' ? ' [DYN]' : ' [ST]';
}

function mapRecordOptions(
  record: Readonly<Record<string, unknown>> | undefined,
  labelFn: (key: string, val: Record<string, unknown> | undefined) => string
): Array<{ value: string; label: string }> {
  if (!record) return [];
  return Object.keys(record).map((k) => {
    const raw = record[k];
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined;
    return { value: k, label: labelFn(k, obj) };
  });
}

function resolveOptionsByKind(
  kind: ReferenceTargetKind,
  doc: CampaignData,
  jsonPath: string
): Array<{ value: string; label: string }> | null {
  switch (kind) {
    case 'archetype': {
      const archetypes = (doc.systemContent as Record<string, unknown> | undefined)?.archetypes;
      if (archetypes && typeof archetypes === 'object') {
        return Object.keys(archetypes).map((k) => ({ value: k, label: `${k} [ARCHETYPE]` }));
      }
      return null;
    }
    case 'faction':
      return Object.keys(doc.factions || {}).map((k) => ({ value: k, label: `${k} [ST]` }));
    case 'area':
      return Object.keys(doc.areas || {}).map((k) => ({
        value: k,
        label: `${doc.areas[k]?.name || k}${getBadge('areas', k, doc)}`
      }));
    case 'tile':
      return mapRecordOptions(doc.tiles, (k, obj) => `${String(obj?.name ?? k)} [ST]`);
    case 'entity':
      return mapRecordOptions(doc.entities, (k, obj) => `Entity: ${String(obj?.name ?? k)} [ST]`);
    case 'item':
      return mapRecordOptions(doc.items, (k, obj) => `Item: ${String(obj?.name ?? k)} [ST]`);
    case 'effect':
      return Object.keys(doc.effects || {}).map((k) => ({ value: k, label: `${k} [ST]` }));
    case 'status':
      return Object.keys(doc.status || {}).map((k) => ({ value: k, label: `${k} [ST]` }));
    case 'ai':
      return Object.keys(doc.ai || {}).map((k) => ({ value: k, label: `${k} [BP]` }));
    case 'dialogue':
      return Object.keys(doc.dialogues || {}).map((k) => ({ value: k, label: `${k} [ST]` }));
    case 'dialogueNode': {
      const segments = jsonPath.split('/').filter(Boolean);
      const dialogueId = segments[0] === 'dialogues' ? segments[1] : undefined;
      const nodes = dialogueId ? doc.dialogues?.[dialogueId]?.nodes : undefined;
      if (!nodes) return null;
      return Object.keys(nodes).map((nId) => ({ value: nId, label: `Node: ${nId}` }));
    }
    case 'quest':
      return mapRecordOptions(doc.quests, (k, obj) => `Quest: ${String(obj?.title ?? k)} [ST]`);
    case 'questTemplate':
      return Object.keys(doc.questTemplates || {}).map((k) => ({ value: k, label: `Quest Template: ${k} [BP]` }));
    case 'encounterProfile':
      return mapRecordOptions(doc.encounterProfiles, (k, obj) => `${String(obj?.name ?? k)} [BP]`);
    case 'field':
      return mapRecordOptions(doc.fields, (k, obj) => `Field: ${String(obj?.name ?? k)} [DYN]`);
    case 'material': {
      const materials = (doc.rules as { readonly materials?: Record<string, unknown> }).materials;
      return mapRecordOptions(materials, (k, obj) => `Material: ${String(obj?.name ?? k)} [ST]`);
    }
    case 'thought': {
      const thoughts = (doc.rules as { readonly thoughtDefinitions?: Record<string, unknown> }).thoughtDefinitions;
      return mapRecordOptions(thoughts, (k) => `Thought: ${k} [BP]`);
    }
    case 'currency': {
      const units = (
        doc.rules as { readonly currency?: { readonly units?: ReadonlyArray<{ id: string; name?: string }> } }
      ).currency?.units;
      return (units ?? []).map((u) => ({ value: u.id, label: `Currency: ${u.name ?? u.id} [ST]` }));
    }
    case 'entity_or_item': {
      const ents = mapRecordOptions(doc.entities, (k, obj) => `Entity: ${String(obj?.name ?? k)} [ST]`);
      const itms = mapRecordOptions(doc.items, (k, obj) => `Item: ${String(obj?.name ?? k)} [ST]`);
      const qtmps = Object.keys(doc.questTemplates || {}).map((k) => ({
        value: k,
        label: `Quest Template: ${k} [BP]`
      }));
      return [...ents, ...itms, ...qtmps];
    }
    case 'eventType':
      return Object.values(GameEventType).map((val) => ({
        value: val,
        label: `${val.replace(/([A-Z])/g, ' $1').trim()} [DYN]`
      }));
    case 'tag':
      return Object.keys(doc.tagRegistry || {}).map((k) => ({
        value: k,
        label: `${doc.tagRegistry[k]?.category || 'Tag'}: ${k} [DYN]`
      }));
    case 'rumor':
      return (doc.rumorPropagation || []).map((r) => ({ value: r.id, label: `Rumor: ${r.id} [BP]` }));
    case 'sprite': {
      const sheets = resolveThemeSpriteSheets(doc.theme);
      const options = [{ value: '', label: 'None [ASCII]' }];
      if (sheets) {
        for (const sheet of Object.values(sheets)) {
          if (sheet?.tileMap) {
            for (const spriteKey of Object.keys(sheet.tileMap)) {
              options.push({ value: spriteKey, label: `${spriteKey} [SPRITE]` });
            }
          }
        }
      }
      return options;
    }
  }
}

/**
 * Resolves drop-down choices from a field key and optional JSON path using the unified
 * `resolveFieldReferenceKind` resolver in `reference_index.ts`.
 */
export function getReferenceOptions(
  key: string,
  doc: CampaignData,
  jsonPath = ''
): { value: string; label: string }[] | null {
  const kind = resolveFieldReferenceKind(key, jsonPath);
  if (!kind) return null;
  return resolveOptionsByKind(kind, doc, jsonPath);
}
