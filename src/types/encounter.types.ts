import type { EntityId } from './game-state.types.ts';

/**
 * Spend allocation categories used by the Encounter Director.
 */
export type BudgetAxis = 'protein' | 'appetizer' | 'side' | 'dessert';

/**
 * Indicates the outcome of evaluating a candidate entity for spawning.
 */
export type CandidateDisposition = 'spawned' | 'too_expensive' | 'token_exhausted' | 'no_space' | 'pool_filtered';

/**
 * Evaluation record tracking a candidate template ID and why it was spawned or rejected.
 */
export interface CandidateRecord {
  readonly templateId: string;
  readonly cost: number;
  readonly disposition: CandidateDisposition;
  readonly reasonDetail?: string;
}

/**
 * Detailed breakdown of allocated budgets, spent points, and spawned candidates per axis.
 */
export interface DirectorReceipt {
  readonly areaId: string;
  readonly effectiveBudget: number;
  readonly preAllocated: number;
  readonly axisResults: Record<
    BudgetAxis,
    {
      readonly budget: number;
      readonly spent: number;
      readonly spawned: ReadonlyArray<string>;
      readonly rejected: ReadonlyArray<string>;
      readonly candidates: ReadonlyArray<CandidateRecord>;
    }
  >;
  readonly traitUpgrades: string[];
  readonly pathingFailures: number;
}

/**
 * Complete generation result of running the Encounter Director.
 */
export interface DirectorResult {
  readonly newEntities: ReadonlyArray<{
    readonly templateId: string;
    readonly x: number;
    readonly y: number;
    readonly dynamicTraits?: ReadonlyArray<string>;
    readonly preExistingEntityId?: EntityId;
  }>;
  readonly traitOverrides: ReadonlyArray<{ readonly templateId: string; readonly traits: ReadonlyArray<string> }>;
  readonly receipt: DirectorReceipt;
}

/**
 * Defines rectangular area grid limits for generated dungeon chambers.
 * exactTiles is stored as ReadonlyArray<string> to guarantee pure JSON serialization compliance.
 */
export interface RoomBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly isSafe?: boolean;
  readonly tags?: ReadonlyArray<string>;
  readonly exactTiles?: ReadonlyArray<string>;
}

/**
 * External context variables driving encounter scaling rules.
 */
export interface DirectorContext {
  readonly playerLevel: number;
  readonly tokenPool: ReadonlySet<string>;
  readonly areaMutation?: { readonly addedTags: ReadonlyArray<string>; readonly budgetModifier: number } | undefined;
  readonly reservedTokens?: ReadonlyArray<{ readonly templateId: string; readonly minionId: EntityId }> | undefined;
  readonly hotPathCoords?: ReadonlySet<string> | undefined;
}
