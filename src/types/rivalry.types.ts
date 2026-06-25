import type { EntityId } from './game-state.types.ts';

/**
 * Structural shape representing brief nemesis status.
 */
export interface NemesisInfo {
  readonly entityId: EntityId;
  readonly hierarchyId: string;
  readonly rankId: string;
  readonly tier: number;
}
