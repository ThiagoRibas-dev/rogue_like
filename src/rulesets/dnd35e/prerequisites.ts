import { dndFloor } from './math/multipliers.ts';
import type { AbilityId, CreatureSizeCategory } from './types/dnd35e.types.ts';

/**
 * Recursive AST node representing a declarative D&D 3.5e prerequisite requirement
 * (used by Feats, Prestige Classes, Special Actions, and Campaign Editor validators).
 */
export type PrerequisiteNode =
  | { readonly type: 'and'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'or'; readonly children: ReadonlyArray<PrerequisiteNode> }
  | { readonly type: 'not'; readonly child: PrerequisiteNode }
  | { readonly type: 'min_ability'; readonly ability: AbilityId; readonly minScore: number }
  | { readonly type: 'min_bab'; readonly minBab: number }
  | { readonly type: 'min_skill_ranks'; readonly skillId: string; readonly minRanks: number }
  | { readonly type: 'has_feat'; readonly featId: string }
  | { readonly type: 'has_tag'; readonly tag: string }
  | { readonly type: 'min_caster_level'; readonly minCasterLevel: number }
  | {
      readonly type: 'size_in';
      readonly allowedSizes: ReadonlyArray<CreatureSizeCategory>;
    };

/** Snapshot of an entity's stats used to evaluate a `PrerequisiteNode` AST. */
export interface PrerequisiteEvalContext {
  readonly abilityScores: Readonly<Record<AbilityId, number | null>>;
  readonly totalBab: number;
  readonly skillRanks: Readonly<Record<string, number>>;
  readonly feats: ReadonlyArray<string>;
  readonly tags: ReadonlyArray<string>;
  readonly casterLevel: number;
  readonly sizeCategory: CreatureSizeCategory;
}

/**
 * Evaluates a recursive `PrerequisiteNode` AST against an entity's `PrerequisiteEvalContext`.
 * Note: Nonability scores (`null`) never satisfy a positive `min_ability` requirement.
 *
 * @param node The root `PrerequisiteNode` to evaluate.
 * @param context The entity's `PrerequisiteEvalContext`.
 * @returns True if all requirements in the AST are satisfied.
 */
export function evaluatePrerequisiteAST(node: PrerequisiteNode, context: PrerequisiteEvalContext): boolean {
  switch (node.type) {
    case 'and':
      return node.children.every((child) => evaluatePrerequisiteAST(child, context));
    case 'or':
      return node.children.some((child) => evaluatePrerequisiteAST(child, context));
    case 'not':
      return !evaluatePrerequisiteAST(node.child, context);
    case 'min_ability': {
      const score = context.abilityScores[node.ability];
      return score !== null && score >= node.minScore;
    }
    case 'min_bab':
      return context.totalBab >= node.minBab;
    case 'min_skill_ranks': {
      const wholeRanks = dndFloor(context.skillRanks[node.skillId] ?? 0);
      return wholeRanks >= node.minRanks;
    }
    case 'has_feat':
      return context.feats.includes(node.featId);
    case 'has_tag':
      return context.tags.includes(node.tag);
    case 'min_caster_level':
      return context.casterLevel >= node.minCasterLevel;
    case 'size_in':
      return node.allowedSizes.includes(context.sizeCategory);
  }
}
