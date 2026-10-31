import { describe, expect, test } from 'bun:test';
import { getAllRulesets, getRuleset, getActiveRuleset } from '../src/rulesets/registry.ts';
import { getEffectiveStats } from '../src/utils/stats.ts';
import { processMeleeAttackIntent } from '../src/systems/combat.system.ts';
import { processDamageSystem } from '../src/systems/damage.system.ts';
import { grantXp } from '../src/systems/death.system.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { getComponent, spawnEntity } from '../src/core/ecs.ts';
import { loadCampaignFromDisk, buildGameState } from './helpers.ts';

describe('Pluggable Ruleset Cartridge Registry & Classic Delegation', () => {
  test('registers both classic and dnd35e cartridges', () => {
    const all = getAllRulesets();
    const ids = all.map((r) => r.metadata.id);
    expect(ids).toContain('classic');
    expect(ids).toContain('dnd35e');

    expect(getRuleset('classic').metadata.id).toBe('classic');
    expect(getRuleset('dnd35e').metadata.id).toBe('dnd35e');
    expect(getRuleset(undefined).metadata.id).toBe('classic');
  });

  test('resolves active ruleset from campaign.manifest.rulesetId and projects HUD vitals', () => {
    const campaign = loadCampaignFromDisk('default');
    const state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    expect(playerId).toBeDefined();

    const active = getActiveRuleset(state);
    expect(active.metadata.id).toBe('classic');

    const classicVitals = active.projectHudVitals(state, playerId);
    expect(classicVitals).not.toBeNull();
    expect(classicVitals!.primaryStat.label).toBe('ATK');
    expect(classicVitals!.secondaryStat.label).toBe('DEF');

    const dndState = {
      ...state,
      campaign: {
        ...state.campaign,
        manifest: {
          ...state.campaign.manifest,
          rulesetId: 'dnd35e' as const
        }
      }
    };
    const dndActive = getActiveRuleset(dndState);
    expect(dndActive.metadata.id).toBe('dnd35e');

    const dndVitals = dndActive.projectHudVitals(dndState, playerId);
    expect(dndVitals).not.toBeNull();
    expect(dndVitals!.primaryStat.label).toBe('BAB');
    expect(dndVitals!.secondaryStat.label).toBe('AC');
  });

  test('delegates getEffectiveStats, processMeleeAttackIntent, processDamageSystem, and grantXp through classic cartridge', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    const stats = getEffectiveStats(state, playerId);
    expect(stats.maxHp).toBeGreaterThan(0);
    expect(stats.attack).toBeGreaterThan(0);

    // Spawn an enemy next to the player and resolve a melee attack + damage + XP
    const [withGoblin, goblinId] = spawnEntity(state, 'goblin', playerPos.x + 1, playerPos.y);
    state = withGoblin;

    const initialGoblinHp = getComponent(state, goblinId, ComponentType.Fighter)!.hp;
    const attackResult = processMeleeAttackIntent(state, {
      type: IntentType.MeleeAttack,
      entityId: playerId,
      defenderId: goblinId
    });
    expect(attackResult.success).toBe(true);
    state = processDamageSystem(attackResult.state);

    const afterGoblinHp = getComponent(state, goblinId, ComponentType.Fighter)!.hp;
    expect(afterGoblinHp).toBeLessThan(initialGoblinHp);

    const beforeXp = getComponent(state, playerId, ComponentType.Fighter)!.xp;
    state = grantXp(state, playerId, 25);
    const afterXp = getComponent(state, playerId, ComponentType.Fighter)!.xp;
    expect(afterXp).toBe(beforeXp + 25);
  });
});
