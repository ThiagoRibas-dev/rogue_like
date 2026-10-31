import { describe, expect, test } from 'bun:test';
import { buildGameState, deepFreezeGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, getComponent, queryEntities, spawnEntity } from '../src/core/ecs.ts';
import { applyIntentWithCost } from '../src/core/game-loop.ts';
import { processMeleeAttackIntent } from '../src/systems/combat.system.ts';
import { processDamageSystem } from '../src/systems/damage.system.ts';
import { grantXp } from '../src/systems/death.system.ts';
import { updateExploredTiles } from '../src/systems/map.system.ts';
import { getEffectiveStats } from '../src/utils/stats.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';

describe('GameState Immutability Audit Across Core Systems & Cartridges', () => {
  test('systems and ruleset cartridges never mutate a deep-frozen input GameState in place', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign);

    const playerId = queryEntities(state, [ComponentType.Player, ComponentType.Position])[0]!;
    const playerPos = getComponent(state, playerId, ComponentType.Position)!;

    const enemyTemplateId =
      Object.keys(campaign.entities).find((id) => id !== 'player' && campaign.entities[id]?.fighter !== undefined) ??
      'player';
    let enemyId;
    [state, enemyId] = spawnEntity(state, enemyTemplateId, playerPos.x + 1, playerPos.y);

    // 1. updateExploredTiles
    const frozenForFov = deepFreezeGameState(structuredClone(state));
    const afterFov = updateExploredTiles(frozenForFov);
    expect(afterFov).not.toBe(frozenForFov);

    // 2. getEffectiveStats
    const frozenForStats = deepFreezeGameState(structuredClone(afterFov));
    const stats = getEffectiveStats(frozenForStats, playerId);
    expect(Number.isFinite(stats.attack)).toBe(true);

    // 3. processMeleeAttackIntent
    const frozenForCombat = deepFreezeGameState(structuredClone(afterFov));
    const combatRes = processMeleeAttackIntent(frozenForCombat, {
      type: IntentType.MeleeAttack,
      entityId: playerId,
      defenderId: enemyId
    });
    expect(combatRes.success).toBe(true);

    // 4. processDamageSystem
    const stateWithPendingDamage = addComponent(structuredClone(afterFov), enemyId, {
      type: ComponentType.Damage,
      instances: [{ amount: 2, sourceEntityId: playerId, tags: ['physical'] }]
    });
    const frozenForDamage = deepFreezeGameState(stateWithPendingDamage);
    const afterDamage = processDamageSystem(frozenForDamage);
    expect(afterDamage).not.toBe(frozenForDamage);

    // 5. grantXp
    const frozenForXp = deepFreezeGameState(structuredClone(afterFov));
    const afterXp = grantXp(frozenForXp, playerId, 250);
    expect(afterXp).not.toBe(frozenForXp);

    // 6. applyIntentWithCost (Wait)
    const frozenForTurn = deepFreezeGameState(structuredClone(afterFov));
    const turnRes = applyIntentWithCost(frozenForTurn, {
      type: IntentType.Wait,
      entityId: playerId
    });
    expect(turnRes.state).not.toBe(frozenForTurn);
  });
});
