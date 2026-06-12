/**
 * Parses markdown-style wiki links [Text](type:id) into HTML span elements for tooltips.
 * Supported types: entity, item, status
 * Example: `Kill 3 [Goblins](entity:goblin)`
 */
export interface WikiSegment {
  text: string;
  type?: string;
  id?: string;
}

/**
 * Parses markdown-style wiki links [Text](type:id) into an array of segments.
 * Supported types: entity, item, status
 * Example: `Kill 3 [Goblins](entity:goblin)`
 */
export function parseWikiSegments(text: string): Array<WikiSegment> {
  const regex = /\[([^\]]+)\]\(([^:]+):([^)]+)\)/g;
  const segments: WikiSegment[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      segments.push({ text: text.substring(lastIndex, match.index) });
    }
    // Add the matched link
    segments.push({
      text: match[1]!,
      type: match[2]!,
      id: match[3]!
    });
    lastIndex = regex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.substring(lastIndex) });
  }

  return segments;
}
