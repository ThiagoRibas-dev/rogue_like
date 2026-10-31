/**
 * Identifiers for different types of UI tooltips.
 */
export const enum UITooltipType {
  Item = 'item',
  Status = 'status',
  Stat = 'stat',
  Entity = 'entity',
  Reaction = 'reaction',
  Tag = 'tag',
  Field = 'field'
}

/**
 * Identifiers for specific player stats displayed in the HUD.
 */
export const enum UIStatId {
  HP = 'hp',
  Attack = 'atk',
  Defense = 'def'
}

/**
 * Filter categories for the floating Message Log card.
 */
export type LogFilterCategory = 'all' | 'combat' | 'speech' | 'world';

/**
 * Ordered descriptor list for message log filter tabs.
 */
export const LOG_FILTER_TABS: ReadonlyArray<{ readonly id: LogFilterCategory; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'combat', label: 'Combat' },
  { id: 'speech', label: 'Speech' },
  { id: 'world', label: 'World' }
];

/** Maximum number of quick-use consumable/wand belt slots in the HUD. */
export const QUICK_BELT_SLOT_COUNT = 5;

/** Maximum number of status effect pips drawn per unit on the tactical canvas. */
export const MAX_UNIT_STATUS_PIPS = 3;

/** Health ratio below which the HUD displays a Critical Wounds alert ribbon. */
export const ALERT_CRITICAL_HP_RATIO = 0.35;

/** Health ratio below which the HUD displays a Wounded alert ribbon. */
export const ALERT_LOW_HP_RATIO = 0.65;

/** Tactical overlay color palette and geometry constants. */
export const TACTICAL_COLORS = {
  hostile: '#ff4757',
  friendly: '#2ed573',
  neutral: '#ffa502',
  player: '#00d2d3',
  terrain: '#70a1ff',
  hpHigh: '#2ed573',
  hpMid: '#ffa502',
  hpLow: '#ff4757',
  hpBg: 'rgba(6, 7, 9, 0.85)',
  torchInner: 'rgba(255, 185, 95, 0.11)',
  torchMid: 'rgba(255, 145, 55, 0.04)',
  vignetteOuter: 'rgba(2, 4, 8, 0.42)',
  pathDot: 'rgba(0, 210, 211, 0.55)',
  pathBlocked: 'rgba(255, 71, 87, 0.55)'
} as const;
