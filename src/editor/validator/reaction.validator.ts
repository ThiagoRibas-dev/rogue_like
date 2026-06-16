import type { CampaignData, ReactionDefinition } from '../../types/campaign.types.ts';
import type { ValidationError } from './validator.types.ts';

/**
 * Validates the Reaction System definitions in the campaign.
 * Checks for missing tag references and detects potentially ambiguous
 * priority overlaps for identical matchers.
 */
export async function validateReactions(campaign: Readonly<CampaignData>): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  const validTags = new Set(Object.keys(campaign.tagRegistry));

  // 1. Validate Tag References
  for (const reaction of campaign.reactions) {
    const checkTags = (tags: string[] | undefined, matcherName: string) => {
      if (!tags) return;
      for (const tag of tags) {
        if (!validTags.has(tag)) {
          errors.push({
            severity: 'error',
            message: `Reaction "${reaction.id}" references unknown tag "${tag}" in ${matcherName}.`,
            path: `reactions.${reaction.id}.${matcherName}.tags`
          });
        }
      }
    };

    if (reaction.sourceMatcher.targetType === 'entity') {
      checkTags(reaction.sourceMatcher.tags, 'sourceMatcher');
    }
    if (reaction.targetMatcher.targetType === 'entity' || reaction.targetMatcher.targetType === 'tile') {
      checkTags(reaction.targetMatcher.tags, 'targetMatcher');
    }
  }

  // 2. Detect Ambiguous Priority Overlaps
  // We hash the exact matchers (verb + sourceMatcher + targetMatcher + contextMatcher)
  // If two reactions have the identical hash and the SAME priority, it's a warning.
  const signatureMap = new Map<string, ReactionDefinition[]>();

  for (const reaction of campaign.reactions) {
    // A simplified deterministic hash representation of the matchers
    const signature = JSON.stringify({
      verb: reaction.verb,
      source: reaction.sourceMatcher,
      target: reaction.targetMatcher,
      context: reaction.contextMatcher
    });

    const bucket = signatureMap.get(signature) ?? [];
    bucket.push(reaction);
    signatureMap.set(signature, bucket);
  }

  for (const [_signature, bucket] of signatureMap.entries()) {
    if (bucket.length > 1) {
      // Group by priority
      const priorityGroups = new Map<number, string[]>();
      for (const rx of bucket) {
        const pBucket = priorityGroups.get(rx.priority) ?? [];
        pBucket.push(rx.id);
        priorityGroups.set(rx.priority, pBucket);
      }

      for (const [priority, rxIds] of priorityGroups.entries()) {
        if (rxIds.length > 1) {
          errors.push({
            severity: 'warning',
            message: `Ambiguous reactions detected. The following reactions have identical matchers and priority (${priority}), meaning the tie-break will fall back to arbitrary ID sorting: ${rxIds.join(', ')}.`,
            path: `reactions`
          });
        }
      }
    }
  }

  return errors;
}
