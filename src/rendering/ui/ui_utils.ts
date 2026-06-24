import type { CampaignData } from '../../types/campaign.types.ts';
import { GameEventType } from '../../types/events.types.ts';

/**
 * Resolves drop-down choices from a key identifier matching campaign reference databases.
 */
export function getReferenceOptions(key: string, doc: CampaignData): { value: string; label: string }[] | null {
  if (key === 'faction' || key.toLowerCase().includes('factionid')) {
    return Object.keys(doc.factions).map((k) => ({ value: k, label: k }));
  }
  if (key === 'startingAreaId' || key === 'targetArea' || key === 'targetAreaId') {
    return Object.keys(doc.areas).map((k) => ({ value: k, label: doc.areas[k]?.name || k }));
  }
  if (key === 'effectId') {
    return Object.keys(doc.effects).map((k) => ({ value: k, label: k }));
  }
  if (key === 'profileId') {
    return Object.keys(doc.ai).map((k) => ({ value: k, label: k }));
  }
  if (key === 'statusId') {
    return Object.keys(doc.status).map((k) => ({ value: k, label: k }));
  }
  if (key === 'dialogueId') {
    return Object.keys(doc.dialogues).map((k) => ({ value: k, label: k }));
  }
  if (key === 'encounterProfileId') {
    return Object.keys(doc.encounterProfiles || {}).map((k) => ({
      value: k,
      label: doc.encounterProfiles[k]?.name || k
    }));
  }
  if (key === 'templateId') {
    const ents = Object.keys(doc.entities || {}).map((k) => ({
      value: k,
      label: `Entity: ${doc.entities[k]?.name || k}`
    }));
    const itms = Object.keys(doc.items || {}).map((k) => ({ value: k, label: `Item: ${doc.items[k]?.name || k}` }));
    return [...ents, ...itms];
  }
  if (key === 'promotionSources' || key === 'promotionSource') {
    return Object.keys(doc.entities || {}).map((k) => ({
      value: k,
      label: `Entity: ${doc.entities[k]?.name || k}`
    }));
  }
  if (key === 'eventType') {
    return Object.values(GameEventType).map((val) => {
      // Split PascalCase into Words for the label
      const label = val.replace(/([A-Z])/g, ' $1').trim();
      return { value: val, label };
    });
  }
  if (key.toLowerCase().includes('tag')) {
    return Object.keys(doc.tagRegistry || {}).map((k) => ({
      value: k,
      label: `${doc.tagRegistry[k]?.category || 'Tag'}: ${k}`
    }));
  }
  if (key === 'inventory') {
    return Object.keys(doc.items || {}).map((k) => ({ value: k, label: `Item: ${doc.items[k]?.name || k}` }));
  }
  if (key === 'injectRumorId') {
    return (doc.rumorPropagation || []).map((r) => ({ value: r.id, label: `Rumor: ${r.id}` }));
  }
  return null;
}
