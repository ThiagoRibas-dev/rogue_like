/**
 * Checks if a Cleave / Great Cleave follow-up attack is granted after dropping a foe to <= 0 HP.
 *
 * @param droppedFoe Whether the target was reduced to 0 HP or killed.
 * @param cleavesUsedThisRound Number of cleave attacks already taken this turn.
 * @param hasGreatCleave Whether the attacker possesses Great Cleave.
 * @returns True if a follow-up attack is allowed.
 */
export function resolveCleaveFollowupEligibility(
  droppedFoe: boolean,
  cleavesUsedThisRound: number,
  hasGreatCleave: boolean
): boolean {
  if (!droppedFoe) return false;
  if (hasGreatCleave) return true;
  return cleavesUsedThisRound === 0;
}

/**
 * Resolves all eligible melee targets within reach for a Whirlwind Attack.
 *
 * @param attackerPos Attacker's position.
 * @param reachFt Attacker's effective melee reach in feet.
 * @param potentialTargets List of potential target entities and their positions.
 * @returns Array of eligible target entity IDs.
 */
export function resolveWhirlwindTargets(
  attackerPos: { readonly x: number; readonly y: number },
  reachFt: number,
  potentialTargets: ReadonlyArray<{
    readonly entityId: number;
    readonly pos: { readonly x: number; readonly y: number };
  }>
): ReadonlyArray<number> {
  const reachTiles = Math.max(1, Math.floor(reachFt / 5));
  const validTargetIds: number[] = [];

  for (const target of potentialTargets) {
    const dx = Math.abs(attackerPos.x - target.pos.x);
    const dy = Math.abs(attackerPos.y - target.pos.y);
    const dist = Math.max(dx, dy);
    if (dist <= reachTiles && (dx > 0 || dy > 0)) {
      validTargetIds.push(target.entityId);
    }
  }

  return validTargetIds;
}
