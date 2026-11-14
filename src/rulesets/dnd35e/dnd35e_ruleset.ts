import { addComponent, getComponent } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { ComponentType, type FighterComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type {
  HudVitalsDTO,
  RulesetContract,
  RulesetSystemFileDescriptor,
  ViewGroup
} from '../../types/ruleset.types.ts';
import { processDnD35eDamage, resolveDnD35eMeleeAttack } from './cartridge/dnd35e_combat_adapter.ts';
import { computeDnD35eEffectiveStats } from './cartridge/dnd35e_dag_adapter.ts';
import { checkDnD35eRuleset } from './dnd35e_validator.ts';
import { DND35E_BASE_AC } from './modifiers.ts';
import { calculateMulticlassXpMultiplier, computeXpThresholdForLevel } from './progression.ts';
import {
  getDnD35eValidVerbsForTarget,
  projectDnD35eInspectLoreLines,
  resolveDnD35eSkillVerb,
  validateDnD35eWandActivation
} from './skill_verbs.ts';
import { getDnD35EntityData } from './srd_registry.ts';
import { executeDnD35eSpellCast } from './magic/spell_cast_resolver.ts';
import { DND35E_SYSTEM_CONTENT_FILES } from './system_content_files.ts';
import { getDnD35SystemContent, parseDnD35SystemContent } from './types/dnd35e_system.types.ts';

import {
  onDnD35eActorMovementStep,
  onDnD35eActorTurnStart,
  resolveDnD35eActionEnergyCost
} from './cartridge/dnd35e_lifecycle_adapter.ts';

export * from './cartridge/dnd35e_combat_adapter.ts';
export * from './cartridge/dnd35e_dag_adapter.ts';
export * from './cartridge/dnd35e_lifecycle_adapter.ts';

/**
 * Grants XP to an actor under the D&D 3.5e triangular XP progression table
 * ($\text{Threshold}(L+1) = \frac{L(L+1)}{2} \times 1000$).
 *
 * @param state The current GameState.
 * @param entityId The recipient entity ID.
 * @param amount The XP amount to grant.
 * @returns Updated GameState.
 */
function grantDnD35eXp(state: GameState, entityId: EntityId, amount: number): GameState {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter || amount <= 0) return state;

  const dndData = getDnD35EntityData(state, entityId);
  const sysContent = getDnD35SystemContent(state.campaign);
  const xpMultiplier = sysContent
    ? calculateMulticlassXpMultiplier(
        dndData.tracks,
        sysContent.classes,
        dndData.favoredClass ?? 'any',
        dndData.enforceMulticlassXpPenalty ?? true
      )
    : 1.0;
  const adjustedAmount = Math.max(0, Math.floor(amount * xpMultiplier));

  const newXp = fighter.xp + adjustedAmount;
  const nextLevel = fighter.level + 1;
  const nextThreshold = computeXpThresholdForLevel(nextLevel);

  let nextState = addComponent(state, entityId, { ...fighter, xp: newXp });

  if (newXp >= nextThreshold) {
    nextState = addMessage(
      nextState,
      '[D&D 3.5e] Level Up Available! Press [L] or click the ribbon to advance your character.',
      MessageLogCategory.System
    );
  }

  return nextState;
}

/**
 * Projects HUD vitals for the `dnd35e` ruleset cartridge (displaying BAB and Full AC sockets).
 *
 * @param state The current GameState.
 * @param playerEntityId The player entity ID.
 * @returns The projected `HudVitalsDTO`, or `null` if the player lacks combat stats.
 */
function projectDnD35eHudVitals(state: GameState, playerEntityId: EntityId): HudVitalsDTO | null {
  const fighter = getComponent(state, playerEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return null;

  const stats = computeDnD35eEffectiveStats(state, playerEntityId);
  const hpMax = Math.max(0, stats.maxHp);
  const hpCurrent = fighter.hp;
  const rawHpPercent = hpMax > 0 ? Math.round((hpCurrent / hpMax) * 100) : 0;
  const hpPercent = Math.max(0, Math.min(100, Math.max(0, rawHpPercent)));

  const xpNext = Math.max(1, computeXpThresholdForLevel(fighter.level + 1));
  const xpPercent = Math.max(0, Math.min(100, Math.round((fighter.xp / xpNext) * 100)));

  const formattedBab = stats.attack >= 0 ? `+${stats.attack}` : `${stats.attack}`;
  const armorClass = DND35E_BASE_AC + stats.defense;

  return {
    levelLabel: `ECL ${fighter.level}`,
    hpCurrent,
    hpMax,
    hpPercent,
    xpPercent,
    xpText: `${fighter.xp} / ${xpNext}`,
    primaryStat: { label: 'BAB', value: formattedBab },
    secondaryStat: { label: 'AC', value: armorClass.toString() }
  };
}

/**
 * The `dnd35e` (Dungeons & Dragons 3.5e SRD) ruleset cartridge entry point.
 */
export const dnd35eRulesetContract: RulesetContract = {
  id: 'dnd35e',
  metadata: {
    id: 'dnd35e',
    name: 'Dungeons & Dragons 3.5e (SRD)',
    shortLabel: 'D&D 3.5e',
    badgeIcon: '🐉',
    version: '1.0.0',
    description:
      'Tactical d20 open-gaming ruleset featuring 6 Ability Scores, 18-type bonus stacking, 5-ft footprint/reach & cover geometry, 5-tier action economy, Attacks of Opportunity, and Vancian spellcasting.',
    features: [
      '6 Ability Scores & 18-Type Bonus Stacking Engine',
      'Full / Touch / Flat-Footed AC & Saving Throws (Fort/Ref/Will)',
      '5-Foot Grid Reach Rings, Cover & Flanking Geometry',
      '5-Tier Action Economy, Attacks of Opportunity & Vancian Magic'
    ]
  },
  getEffectiveActorStats: computeDnD35eEffectiveStats,
  resolveMeleeAttack: resolveDnD35eMeleeAttack,
  processDamage: processDnD35eDamage,
  grantActorXp: grantDnD35eXp,
  projectHudVitals: projectDnD35eHudVitals,
  getEditorViewGroups(baseGroups: ReadonlyArray<ViewGroup>): ReadonlyArray<ViewGroup> {
    return baseGroups;
  },
  getSystemContentFiles(): ReadonlyArray<RulesetSystemFileDescriptor> {
    return DND35E_SYSTEM_CONTENT_FILES;
  },
  parseSystemContent(raw: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    return parseDnD35SystemContent(raw) as unknown as Readonly<Record<string, unknown>>;
  },
  validateCampaignRuleset: checkDnD35eRuleset,
  resolveSkillVerb: resolveDnD35eSkillVerb,
  getValidRulesetVerbsForTarget: getDnD35eValidVerbsForTarget,
  validateWandActivation: validateDnD35eWandActivation,
  projectInspectLoreLines: projectDnD35eInspectLoreLines,
  onActorTurnStart: onDnD35eActorTurnStart,
  onActorMovementStep: onDnD35eActorMovementStep,
  resolveActionEnergyCost: resolveDnD35eActionEnergyCost,
  resolveAimedAction(state, actorId, targetPos, context) {
    if (context.verb === 'cast_spell' && context.spellId && context.classId) {
      return executeDnD35eSpellCast(state, actorId, targetPos, {
        classId: context.classId,
        spellId: context.spellId,
        slotId: context.slotId,
        spellLevel: context.spellLevel,
        convertedSpellId: context.convertedSpellId,
        metamagicFeatIds: context.metamagicFeatIds
      });
    }
    return { state, success: false };
  }
};
