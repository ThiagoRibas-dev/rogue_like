import { ComponentType, type KnowledgeItem } from '../types/components.types.ts';

/**
 * Identifier for an investigation board filter chip.
 */
export type InvestigationFilterId = 'all' | 'scheme' | 'faction' | 'nemesis' | 'area';

/**
 * Declarative definition of a filter chip and the predicates it applies.
 *
 * Filtering is purely declarative so no magic strings or per-chip `if` chains
 * are needed in the view layer.
 */
export interface InvestigationFilterDefinition {
  readonly id: InvestigationFilterId;
  /** Label rendered on the chip. */
  readonly label: string;
  /** KnowledgeItem tags that match this filter. */
  readonly knowledgeTags: ReadonlyArray<string>;
  /** KnowledgeItem types that match this filter. */
  readonly knowledgeTypes: ReadonlyArray<KnowledgeItem['type']>;
  /** Suspect matches when it carries this component; undefined matches all suspects. */
  readonly suspectComponent?: ComponentType;
  /** Whether this chip narrows the suspects pane. */
  readonly filtersSuspects: boolean;
  /** Whether this chip narrows the clues pane. */
  readonly filtersClues: boolean;
}

/**
 * Ordered chip definitions rendered in the investigation board toolbar.
 * `All` is always first and matches everything.
 */
export const INVESTIGATION_FILTERS: ReadonlyArray<InvestigationFilterDefinition> = [
  {
    id: 'all',
    label: 'All',
    knowledgeTags: [],
    knowledgeTypes: [],
    filtersSuspects: false,
    filtersClues: false
  },
  {
    id: 'scheme',
    label: 'Scheme',
    knowledgeTags: ['scheme'],
    knowledgeTypes: [],
    filtersSuspects: false,
    filtersClues: true
  },
  {
    id: 'faction',
    label: 'Faction',
    knowledgeTags: ['faction'],
    knowledgeTypes: [],
    suspectComponent: ComponentType.Faction,
    filtersSuspects: true,
    filtersClues: true
  },
  {
    id: 'nemesis',
    label: 'Nemesis',
    knowledgeTags: ['nemesis'],
    knowledgeTypes: [],
    suspectComponent: ComponentType.Nemesis,
    filtersSuspects: true,
    filtersClues: true
  },
  {
    id: 'area',
    label: 'Area',
    knowledgeTags: ['area'],
    knowledgeTypes: ['location'],
    filtersSuspects: false,
    filtersClues: true
  }
];

/**
 * Returns the filter definition matching an id.
 *
 * @param id The filter id to resolve.
 * @returns The matching definition, falling back to the first (All) chip.
 */
export function getInvestigationFilter(id: InvestigationFilterId): InvestigationFilterDefinition {
  const match = INVESTIGATION_FILTERS.find((filter) => filter.id === id);
  const fallback = INVESTIGATION_FILTERS[0];
  if (match !== undefined) return match;
  if (fallback !== undefined) return fallback;
  // Unreachable: INVESTIGATION_FILTERS is a non-empty literal array.
  throw new Error('INVESTIGATION_FILTERS must define at least one filter.');
}

/** Empty-state message shown when no clues have been discovered at all. */
export const INVESTIGATION_EMPTY_CLUES = 'No clues found yet.';

/** Empty-state message shown when clues exist but none match the active filter. */
export const INVESTIGATION_EMPTY_CLUES_FILTERED = 'No clues match this filter.';

/** Empty-state message shown when no suspects are known at all. */
export const INVESTIGATION_EMPTY_SUSPECTS = 'No suspects identified yet.';

/** Empty-state message shown when suspects exist but none match the active filter. */
export const INVESTIGATION_EMPTY_SUSPECTS_FILTERED = 'No suspects match this filter.';
