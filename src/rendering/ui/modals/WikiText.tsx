import type { JSX } from 'preact';
import { parseWikiSegments } from '../../../utils/text.ts';

/** Props for `<WikiText />`. */
export interface WikiTextProps {
  readonly text: string;
}

/**
 * Declarative JSX renderer for inline `[[type:id|label]]` wiki tooltip links,
 * replacing imperative DOM text-node construction with zero `.innerHTML`.
 */
export function WikiText({ text }: WikiTextProps): JSX.Element {
  const segments = parseWikiSegments(text);
  return (
    <>
      {segments.map((seg, idx) =>
        seg.type ? (
          <span
            key={`${seg.type}_${seg.id ?? idx}_${idx}`}
            className="wiki-link ui-wiki-link"
            data-tooltip-type={seg.type}
            data-tooltip-id={seg.id}
          >
            {seg.text}
          </span>
        ) : (
          <span key={`txt_${idx}`}>{seg.text}</span>
        )
      )}
    </>
  );
}
