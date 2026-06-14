import type { CampaignData } from '../../types/campaign.types.ts';

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
  if (key === 'eventType') {
    return [
      { value: 'TurnPassed', label: 'Turn Passed' },
      { value: 'PlayerMoved', label: 'Player Moved' },
      { value: 'TileEntered', label: 'Tile Entered' },
      { value: 'EntityDied', label: 'Entity Died' },
      { value: 'TrapTriggered', label: 'Trap Triggered' },
      { value: 'ClueDiscovered', label: 'Clue Discovered' },
      { value: 'DialogueSelected', label: 'Dialogue Selected' }
    ];
  }
  if (key.toLowerCase().includes('tag')) {
    return Object.keys(doc.tagRegistry || {}).map((k) => ({
      value: k,
      label: `${doc.tagRegistry[k]?.category || 'Tag'}: ${k}`
    }));
  }
  return null;
}
