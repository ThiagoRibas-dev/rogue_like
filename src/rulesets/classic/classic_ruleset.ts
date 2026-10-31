import type { RulesetContract, ViewGroup } from '../../types/ruleset.types.ts';
import { computeClassicEffectiveStats, projectClassicHudVitals } from './classic_stats.ts';
import { grantClassicXp, processClassicDamage, resolveClassicMeleeAttack } from './classic_combat.ts';

/**
 * The canonical `classic` ruleset cartridge encapsulating Milestones 1–81 mechanics.
 */
export const classicRulesetContract: RulesetContract = {
  id: 'classic',
  metadata: {
    id: 'classic',
    name: 'Classic Roguelike',
    shortLabel: 'Classic',
    badgeIcon: '⚔️',
    version: '1.0.0',
    description:
      'Traditional turn-based and RTwP dungeon-crawling ruleset featuring direct ATK vs. DEF combat, satiation survival, elemental field reactions, and emergent nemesis rivalries.',
    features: [
      'Direct ATK vs. DEF Combat & Weapon Coatings',
      'Linear XP & Stat Advancement Table',
      'Satiation & Provisions Survival Clock',
      'Turn-Based & Real-Time with Pause (RTwP)'
    ]
  },
  getEffectiveActorStats: computeClassicEffectiveStats,
  resolveMeleeAttack: resolveClassicMeleeAttack,
  processDamage: processClassicDamage,
  grantActorXp: grantClassicXp,
  projectHudVitals: projectClassicHudVitals,
  getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup> {
    return baseGroups;
  },
  getSystemContentFiles() {
    return [];
  }
};
