import { getActiveRuleset } from '../rulesets/registry.ts';
import type { EntityId, GameState } from '../types/game-state.types.ts';
import type {
  InteractionChain,
  InteractionFrame,
  InteractionFrameKind
} from '../types/interaction_provenance.types.ts';

export type { InteractionChain, InteractionFrame, InteractionFrameKind };

/**
 * Creates a new immutable `InteractionChain` rooted at `originatorEntityId`.
 *
 * @param originatorEntityId EntityId that initiated the causal chain.
 * @param initialFrames Optional initial causal frames.
 * @returns Newly constructed `InteractionChain`.
 */
export function createInteractionChain(
  originatorEntityId: EntityId,
  initialFrames: ReadonlyArray<InteractionFrame> | InteractionFrame = []
): InteractionChain {
  const framesArray: ReadonlyArray<InteractionFrame> = Array.isArray(initialFrames)
    ? [...initialFrames]
    : [initialFrames];
  return {
    originatorEntityId,
    frames: framesArray
  };
}

/**
 * Appends a single `InteractionFrame` to an existing `InteractionChain`, returning a new immutable chain.
 *
 * @param chain Existing `InteractionChain`.
 * @param frame Causal frame to append.
 * @returns New `InteractionChain` with `frame` appended.
 */
export function appendInteractionFrame(chain: InteractionChain, frame: InteractionFrame): InteractionChain {
  return {
    originatorEntityId: chain.originatorEntityId,
    frames: [...chain.frames, frame]
  };
}

/**
 * Finds the most recent (innermost) frame in `chain` matching `kind`.
 *
 * @param chain `InteractionChain` to search.
 * @param kind Discriminator kind to match.
 * @returns Matching `InteractionFrame` variant or `undefined`.
 */
export function findLastInteractionFrame<K extends InteractionFrame['kind']>(
  chain: InteractionChain | undefined,
  kind: K
): Extract<InteractionFrame, { kind: K }> | undefined {
  if (!chain) return undefined;
  for (let i = chain.frames.length - 1; i >= 0; i--) {
    const f = chain.frames[i];
    if (f && f.kind === kind) {
      return f as Extract<InteractionFrame, { kind: K }>;
    }
  }
  return undefined;
}

/**
 * Resolves the root `originatorEntityId` responsible for an `InteractionChain`.
 *
 * @param chain `InteractionChain` to inspect.
 * @returns Root `originatorEntityId`.
 */
export function resolveInteractionOriginator(chain: InteractionChain): EntityId {
  return chain.originatorEntityId;
}

/**
 * Evaluates a candidate `InteractionFrame` through `RulesetContract.beforeInteractionFrame` (if implemented
 * by the active ruleset cartridge) and, when not prevented, appends `frame` to `chain`.
 *
 * @param state Current immutable GameState.
 * @param chain Current `InteractionChain`.
 * @param frame Candidate `InteractionFrame` to evaluate and append.
 * @returns `{ state, chain, prevented, reason }`.
 */
export function evaluateInteractionFrameWithHook(
  state: GameState,
  chain: InteractionChain,
  frame: InteractionFrame
): {
  readonly state: GameState;
  readonly chain: InteractionChain;
  readonly prevented: boolean;
  readonly reason?: string | undefined;
} {
  const activeRuleset = getActiveRuleset(state);
  if (activeRuleset.beforeInteractionFrame) {
    const hookRes = activeRuleset.beforeInteractionFrame(state, chain, frame);
    if (hookRes.prevented) {
      return {
        state: hookRes.state,
        chain,
        prevented: true,
        ...(hookRes.reason !== undefined ? { reason: hookRes.reason } : {})
      };
    }
    return {
      state: hookRes.state,
      chain: appendInteractionFrame(chain, frame),
      prevented: false
    };
  }
  return {
    state,
    chain: appendInteractionFrame(chain, frame),
    prevented: false
  };
}
