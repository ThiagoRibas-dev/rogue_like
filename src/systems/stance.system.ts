import { ComponentType, type TacticalDoctrineComponent } from '../types/components.types.ts';

/**
 * Descriptor for a mutually exclusive stance option in a Tier 1 Console Stance Group.
 */
export interface ConsoleStanceGroupOption {
  readonly groupId: string;
  readonly stanceId: string;
  readonly label: string;
  readonly grantsSelfTag?: string | undefined;
  readonly isDefaultInGroup?: boolean | undefined;
  readonly tooltipText?: string | undefined;
}

/**
 * Toggles a stance within a mutually exclusive `groupId` on `TacticalDoctrineComponent`.
 * If `stanceId` is already active and `allowDeselect` is true, clears the group; otherwise sets
 * `activeStanceGroups[groupId] = stanceId` while deactivating any sibling stance in that group.
 *
 * @param doctrine Existing `TacticalDoctrineComponent` (or undefined).
 * @param groupId Mutually exclusive stance group identifier.
 * @param stanceId Selected stance option identifier.
 * @param allowDeselect Whether clicking an already-active stance clears the group selection.
 * @returns Updated `TacticalDoctrineComponent`.
 */
export function toggleConsoleStanceGroup(
  doctrine: TacticalDoctrineComponent | undefined,
  groupId: string,
  stanceId: string,
  allowDeselect = false
): TacticalDoctrineComponent {
  const currentGroups = doctrine?.activeStanceGroups ?? {};
  const isAlreadyActive = currentGroups[groupId] === stanceId;
  const nextGroups: Record<string, string> = { ...currentGroups };

  if (isAlreadyActive && allowDeselect) {
    delete nextGroups[groupId];
  } else {
    nextGroups[groupId] = stanceId;
  }

  return {
    type: ComponentType.TacticalDoctrine,
    ...(doctrine ?? {}),
    activeStanceGroups: nextGroups
  };
}

/**
 * Resolves the currently active stance ID for a given `groupId` from `TacticalDoctrineComponent`,
 * falling back to the option marked `isDefaultInGroup: true` (or the first option in `options` if
 * `fallbackToFirst` is true).
 *
 * @param doctrine Actor's `TacticalDoctrineComponent`.
 * @param groupId Stance group identifier.
 * @param options Available options in that stance group.
 * @param fallbackToFirst Whether to default to the first option when no explicit selection exists.
 * @returns Active stance ID or undefined.
 */
export function resolveActiveStanceInGroup(
  doctrine: TacticalDoctrineComponent | undefined,
  groupId: string,
  options: ReadonlyArray<ConsoleStanceGroupOption> = [],
  fallbackToFirst = false
): string | undefined {
  const explicit = doctrine?.activeStanceGroups?.[groupId];
  if (explicit !== undefined) {
    return explicit;
  }
  const defaultOpt = options.find((o) => o.groupId === groupId && o.isDefaultInGroup === true);
  if (defaultOpt) {
    return defaultOpt.stanceId;
  }
  if (fallbackToFirst) {
    return options.find((o) => o.groupId === groupId)?.stanceId;
  }
  return undefined;
}

/**
 * Projects canonical semantic self-tags (`stance:<groupId>:<stanceId>` plus any explicit `grantsSelfTag`
 * on the active option) from an actor's `TacticalDoctrineComponent` and available `ConsoleStanceGroupOption`s.
 *
 * @param doctrine Actor's `TacticalDoctrineComponent`.
 * @param availableOptions Optional list of available stance group options to resolve `grantsSelfTag` and defaults.
 * @returns Deduplicated array of projected stance semantic self-tags.
 */
export function projectConsoleStanceSelfTags(
  doctrine: TacticalDoctrineComponent | undefined,
  availableOptions: ReadonlyArray<ConsoleStanceGroupOption> = []
): ReadonlyArray<string> {
  const tags = new Set<string>();
  const explicitGroups = doctrine?.activeStanceGroups ?? {};

  for (const [groupId, stanceId] of Object.entries(explicitGroups)) {
    tags.add(`stance:${groupId}:${stanceId}`);
    const matchingOpt = availableOptions.find((o) => o.groupId === groupId && o.stanceId === stanceId);
    if (matchingOpt?.grantsSelfTag) {
      tags.add(matchingOpt.grantsSelfTag);
    }
  }

  for (const opt of availableOptions) {
    if (explicitGroups[opt.groupId] === undefined && opt.isDefaultInGroup === true) {
      tags.add(`stance:${opt.groupId}:${opt.stanceId}`);
      if (opt.grantsSelfTag) {
        tags.add(opt.grantsSelfTag);
      }
    }
  }

  return Array.from(tags);
}

/**
 * Checks whether a triggered or retaliatory reaction (`triggerKey`) has remaining uses this round.
 *
 * @param doctrine Actor's `TacticalDoctrineComponent`.
 * @param triggerKey Unique identifier for the triggered reaction unit.
 * @param maxUsesPerRound Maximum allowed triggers per round.
 * @returns True if current uses this round are strictly less than `maxUsesPerRound`.
 */
export function canUseTriggeredReactionThisRound(
  doctrine: TacticalDoctrineComponent | undefined,
  triggerKey: string,
  maxUsesPerRound: number
): boolean {
  const used = doctrine?.triggeredUsesThisRound?.[triggerKey] ?? 0;
  return used < maxUsesPerRound;
}

/**
 * Increments the per-round usage counter for a triggered or retaliatory reaction (`triggerKey`).
 *
 * @param doctrine Actor's `TacticalDoctrineComponent`.
 * @param triggerKey Unique identifier for the triggered reaction unit.
 * @returns Updated `TacticalDoctrineComponent` with incremented usage count.
 */
export function incrementTriggeredReactionUse(
  doctrine: TacticalDoctrineComponent | undefined,
  triggerKey: string
): TacticalDoctrineComponent {
  const currentMap = doctrine?.triggeredUsesThisRound ?? {};
  const nextCount = (currentMap[triggerKey] ?? 0) + 1;
  return {
    type: ComponentType.TacticalDoctrine,
    ...(doctrine ?? {}),
    triggeredUsesThisRound: {
      ...currentMap,
      [triggerKey]: nextCount
    }
  };
}

/**
 * Resets all per-round triggered reaction counters on `TacticalDoctrineComponent` at the start of a new round.
 *
 * @param doctrine Actor's `TacticalDoctrineComponent`.
 * @returns Updated `TacticalDoctrineComponent` with cleared `triggeredUsesThisRound`.
 */
export function resetTriggeredReactionsForNewRound(
  doctrine: TacticalDoctrineComponent | undefined
): TacticalDoctrineComponent {
  return {
    type: ComponentType.TacticalDoctrine,
    ...(doctrine ?? {}),
    triggeredUsesThisRound: {}
  };
}
