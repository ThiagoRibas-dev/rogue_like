/**
 * Nemesis System Facade
 *
 * Coordinates nemesis hierarchy progression, player interaction tracking (PIS),
 * cheat-death evaluations, scar adaptations, and behavioral barks.
 */

export { getEntityBarks } from './nemesis/nemesis_presentation.ts';
export { processNemesisSystem } from './nemesis/nemesis_tracker.ts';
export { applyScar, evaluateCheatDeath } from './nemesis/nemesis_adaptation.ts';
export { promoteNemesis, fillVacancy } from './nemesis/nemesis_hierarchy.ts';
