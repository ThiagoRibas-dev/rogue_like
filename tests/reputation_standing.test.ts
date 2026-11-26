import { describe, expect, test } from 'bun:test';
import { addComponent, getComponent, spawnEntity } from '../src/core/ecs.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { resolveStateStabilization } from '../src/core/state_stabilizer.ts';
import { applyIdentityMask } from '../src/systems/disguise.system.ts';
import { applyReputationCrime } from '../src/systems/reputation.system.ts';
import { processSocialIntent } from '../src/systems/social.system.ts';
import {
  ComponentType,
  type AttitudeComponent,
  type DamageComponent,
  type FactionComponent,
  type FighterComponent,
  type MemoryComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { getEffectiveStandingBetween, isHostile } from '../src/utils/faction.ts';
import { getTradePriceBreakdown } from '../src/utils/trade.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function getPlayerId(state: GameState): EntityId {
  return state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
}

function clearOtherNpcs(state: GameState, playerId: EntityId): GameState {
  const nextEntities = state.entities.filter((id) => {
    if (id === playerId) return true;
    return getComponent(state, id, ComponentType.Actor) === undefined;
  });
  return { ...state, entities: nextEntities };
}

function makeOpenFloorRoom(state: GameState, width = 20, height = 20): GameState {
  const floorId = Object.entries(state.campaign.tiles).find(([, def]) => def.walkable && def.transparent)?.[0] ?? 'stone_floor';
  const tiles = Array.from({ length: width * height }, (_, idx) => {
    const x = idx % width;
    const y = Math.floor(idx / width);
    return {
      x,
      y,
      tileId: floorId,
      explored: true
    };
  });
  return {
    ...state,
    map: {
      width,
      height,
      tiles
    }
  };
}

function spawnFriendlyTownNpc(
  state: GameState,
  x: number,
  y: number,
  hp = 100
): { readonly state: GameState; readonly npcId: EntityId } {
  const shopTplId =
    Object.entries(state.campaign.entities).find(([, tpl]) => tpl.isActor === true && tpl.faction === 'town')?.[0] ??
    'villager';
  let [nextState, npcId] = spawnEntity(state, shopTplId, x, y);
  nextState = addComponent(nextState, npcId, { type: ComponentType.Faction, factionId: 'town' } as FactionComponent);
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.Attitude,
    attitude: 'friendly'
  } as AttitudeComponent);
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.Fighter,
    hp,
    maxHp: hp,
    attack: 5,
    defense: 0,
    level: 1,
    xp: 0,
    xpGiven: 10
  } as FighterComponent);
  nextState = addComponent(nextState, npcId, {
    type: ComponentType.Memory,
    factionStandings: {},
    grudges: [],
    facts: [],
    knowledge: {}
  } as MemoryComponent);
  return { state: nextState, npcId };
}

describe('Unified Tier 1 Faction Reputation & Standing Loop', () => {
  test('Unwitnessed stealth kill of non-hostile town NPC causes zero standing loss and zero witness grudges', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 9101);
    const playerId = getPlayerId(state);
    state = makeOpenFloorRoom(clearOtherNpcs(state, playerId));

    const victimSpawn = spawnFriendlyTownNpc(state, 5, 5, 4);
    state = victimSpawn.state;
    const distantGuardSpawn = spawnFriendlyTownNpc(state, 19, 19, 50);
    state = distantGuardSpawn.state;

    // Put player adjacent to victim, out of distantGuard's 10-tile witness radius
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 4, y: 5 });
    state = addComponent(state, playerId, {
      type: ComponentType.Damage,
      instances: []
    });
    state = addComponent(state, victimSpawn.npcId, {
      type: ComponentType.Damage,
      instances: [{ amount: 50, sourceEntityId: playerId, tags: ['melee'] }]
    } as DamageComponent);

    const resolved = resolveStateStabilization(state);
    const playerMem = getComponent(resolved, playerId, ComponentType.Memory) as MemoryComponent;
    const guardMem = getComponent(resolved, distantGuardSpawn.npcId, ComponentType.Memory) as MemoryComponent;

    expect(playerMem.factionStandings['town'] ?? 0).toBe(0);
    expect(guardMem.grudges).not.toContain(String(playerId));
  });

  test('Witnessed non-lethal Classic & D&D 3.5e attacks penalize standing symmetrically and add witness grudges', () => {
    // 1. Classic ruleset non-lethal attack
    const classicCamp = loadCampaignFromDisk('default');
    let cState = buildGameState(classicCamp, 9102);
    const cPlayer = getPlayerId(cState);
    cState = makeOpenFloorRoom(clearOtherNpcs(cState, cPlayer));
    cState = addComponent(cState, cPlayer, { type: ComponentType.Position, x: 4, y: 5 });
    const cFighter = getComponent(cState, cPlayer, ComponentType.Fighter) as FighterComponent;
    cState = addComponent(cState, cPlayer, { ...cFighter, attack: 10 });

    const cVictim = spawnFriendlyTownNpc(cState, 5, 5, 100);
    cState = cVictim.state;
    const cWitness = spawnFriendlyTownNpc(cState, 7, 5, 100);
    cState = cWitness.state;

    const cAfter = applyIntentWithCost(cState, {
      type: IntentType.MeleeAttack,
      entityId: cPlayer,
      defenderId: cVictim.npcId
    }).state;
    const cPlayerMem = getComponent(cAfter, cPlayer, ComponentType.Memory) as MemoryComponent;
    const cWitnessMem = getComponent(cAfter, cWitness.npcId, ComponentType.Memory) as MemoryComponent;
    expect(cPlayerMem.factionStandings['town']).toBe(-5);
    expect(cWitnessMem.grudges).toContain(String(cPlayer));
    expect(isHostile(cAfter, cWitness.npcId, cPlayer)).toBe(true);

    // 2. D&D 3.5e ruleset non-lethal damage via stabilization (spells/attacks/traps uniformly)
    const dndCamp = loadCampaignFromDisk('dnd35e-crypt');
    let dState = buildGameState(dndCamp, 9103);
    const dPlayer = getPlayerId(dState);
    dState = makeOpenFloorRoom(clearOtherNpcs(dState, dPlayer));
    dState = addComponent(dState, dPlayer, { type: ComponentType.Position, x: 4, y: 5 });

    const dVictim = spawnFriendlyTownNpc(dState, 5, 5, 100);
    dState = dVictim.state;
    const dWitness = spawnFriendlyTownNpc(dState, 8, 5, 100);
    dState = dWitness.state;

    dState = addComponent(dState, dVictim.npcId, {
      type: ComponentType.Damage,
      instances: [{ amount: 6, sourceEntityId: dPlayer, tags: ['melee', 'slashing'] }]
    } as DamageComponent);
    const dAfter = resolveStateStabilization(dState);
    const dPlayerMem = getComponent(dAfter, dPlayer, ComponentType.Memory) as MemoryComponent;
    const dWitnessMem = getComponent(dAfter, dWitness.npcId, ComponentType.Memory) as MemoryComponent;
    expect(dPlayerMem.factionStandings['town']).toBe(-5);
    expect(dWitnessMem.grudges).toContain(String(dPlayer));
  }, 15_000);

  test('Witnessed lethal kill applies kill penalty without attack double-dip and flips unwitnessed guards hostile at <= -50', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 9104);
    const playerId = getPlayerId(state);
    state = makeOpenFloorRoom(clearOtherNpcs(state, playerId));
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 4, y: 5 });

    const v1 = spawnFriendlyTownNpc(state, 5, 5, 10);
    state = v1.state;
    const v2 = spawnFriendlyTownNpc(state, 5, 6, 10);
    state = v2.state;
    const nearWitness = spawnFriendlyTownNpc(state, 7, 5, 100);
    state = nearWitness.state;
    const distantGuard = spawnFriendlyTownNpc(state, 19, 19, 100);
    state = distantGuard.state;

    // First witnessed kill (-25, not -30)
    state = addComponent(state, v1.npcId, {
      type: ComponentType.Damage,
      instances: [
        {
          amount: 40,
          sourceEntityId: playerId,
          tags: ['spell'],
          interaction: {
            originatorEntityId: playerId,
            frames: [{ kind: 'intent', intentType: IntentType.CastSpell, actorId: playerId }]
          }
        }
      ]
    } as DamageComponent);
    state = resolveStateStabilization(state);
    let playerMem = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    expect(playerMem.factionStandings['town']).toBe(-25);
    expect(isHostile(state, distantGuard.npcId, playerId)).toBe(false);

    // Second witnessed kill crosses <= -50 -> distant unwitnessed town guards turn hostile
    state = addComponent(state, v2.npcId, {
      type: ComponentType.Damage,
      instances: [{ amount: 40, sourceEntityId: playerId, tags: ['melee'] }]
    } as DamageComponent);
    state = resolveStateStabilization(state);
    playerMem = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    expect(playerMem.factionStandings['town']).toBe(-50);
    expect(isHostile(state, distantGuard.npcId, playerId)).toBe(true);
    expect(isHostile(state, playerId, distantGuard.npcId)).toBe(true);
  });

  test('Baseline hostile faction targets do not penalize standing unless penalizeHostileFactions is true', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 9105);
    const playerId = getPlayerId(state);
    state = makeOpenFloorRoom(clearOtherNpcs(state, playerId));
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 4, y: 5 });

    const goblinTplId =
      Object.entries(campaign.entities).find(([, tpl]) => tpl.isActor === true && tpl.faction === 'monster')?.[0] ??
      'goblin';
    let [s1, goblinId] = spawnEntity(state, goblinTplId, 5, 5);
    let [s2] = spawnEntity(s1, goblinTplId, 6, 5);
    s2 = addComponent(s2, goblinId, {
      type: ComponentType.Damage,
      instances: [{ amount: 100, sourceEntityId: playerId, tags: ['melee'] }]
    } as DamageComponent);

    const defaultAfter = resolveStateStabilization(s2);
    const defaultMem = getComponent(defaultAfter, playerId, ComponentType.Memory) as MemoryComponent;
    expect(defaultMem.factionStandings['monster'] ?? 0).toBe(0);

    // Opt-in penalizeHostileFactions
    const optCampaign = {
      ...campaign,
      rules: {
        ...campaign.rules,
        reputation: {
          ...campaign.rules.reputation!,
          penalizeHostileFactions: true
        }
      }
    };
    let oState = makeOpenFloorRoom(clearOtherNpcs(buildGameState(optCampaign, 9106), playerId));
    const oPlayerId = getPlayerId(oState);
    oState = addComponent(oState, oPlayerId, { type: ComponentType.Position, x: 4, y: 5 });
    let oG1: EntityId;
    [oState, oG1] = spawnEntity(oState, goblinTplId, 5, 5);
    [oState] = spawnEntity(oState, goblinTplId, 6, 5);
    oState = addComponent(oState, oG1, {
      type: ComponentType.Damage,
      instances: [{ amount: 100, sourceEntityId: oPlayerId, tags: ['melee'] }]
    } as DamageComponent);

    const optAfter = resolveStateStabilization(oState);
    const optMem = getComponent(optAfter, oPlayerId, ComponentType.Memory) as MemoryComponent;
    expect(optMem.factionStandings['monster']).toBe(-25);
  });

  test('Disguised killer builds suspicion before exposing standing, and fresh disguise masks standing hostility without grudge', () => {
    const campaign = loadCampaignFromDisk('default');
    let state = buildGameState(campaign, 9107);
    const playerId = getPlayerId(state);
    state = makeOpenFloorRoom(clearOtherNpcs(state, playerId));
    state = addComponent(state, playerId, { type: ComponentType.Position, x: 4, y: 5 });

    const victim = spawnFriendlyTownNpc(state, 5, 5, 100);
    state = victim.state;
    const bystander = spawnFriendlyTownNpc(state, 7, 5, 100);
    state = bystander.state;
    const distantGuard = spawnFriendlyTownNpc(state, 19, 19, 100);
    state = distantGuard.state;

    // Wanted criminal in Town (-60), wearing fresh Town/neutral disguise
    const mem = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    state = addComponent(state, playerId, {
      ...mem,
      factionStandings: { ...mem.factionStandings, town: -60 }
    });
    expect(isHostile(state, distantGuard.npcId, playerId)).toBe(true);

    state = applyIdentityMask(state, playerId, 'town', 25, 100);
    expect(isHostile(state, distantGuard.npcId, playerId)).toBe(false);

    // Non-lethal witnessed hit increases suspicion to 50/100 without touching real standing
    state = addComponent(state, victim.npcId, {
      type: ComponentType.Damage,
      instances: [{ amount: 5, sourceEntityId: playerId, tags: ['melee'] }]
    } as DamageComponent);
    state = resolveStateStabilization(state);
    expect((getComponent(state, playerId, ComponentType.IdentityMask) as { suspicion: number }).suspicion).toBe(50);
    expect((getComponent(state, playerId, ComponentType.Memory) as MemoryComponent).factionStandings['town']).toBe(-60);

    // Lethal witnessed kill adds +100 suspicion -> blows disguise and deducts kill penalty (-25 => -85)
    state = addComponent(state, victim.npcId, {
      type: ComponentType.Damage,
      instances: [{ amount: 200, sourceEntityId: playerId, tags: ['melee'] }]
    } as DamageComponent);
    state = resolveStateStabilization(state);
    expect((getComponent(state, playerId, ComponentType.IdentityMask) as { suspicion: number }).suspicion).toBe(100);
    expect((getComponent(state, playerId, ComponentType.Memory) as MemoryComponent).factionStandings['town']).toBe(-85);
    expect(isHostile(state, distantGuard.npcId, playerId)).toBe(true);
  });

  test('Trade & Social systems reconcile Layer 2 player standing with NPC faction, and allied ripple + NPC symmetry work', () => {
    const campaign = loadCampaignFromDisk('default');
    const rippleCampaign = {
      ...campaign,
      rules: {
        ...campaign.rules,
        reputation: {
          ...campaign.rules.reputation!,
          alliedFactionRippleRatio: 0.4
        }
      }
    };
    let state = buildGameState(rippleCampaign, 9108);
    const playerId = getPlayerId(state);
    state = makeOpenFloorRoom(clearOtherNpcs(state, playerId));

    const merchant = spawnFriendlyTownNpc(state, 5, 5, 100);
    state = addComponent(merchant.state, merchant.npcId, {
      type: ComponentType.Shop,
      markupMultiplier: 1.0,
      buyTags: [],
      sellTags: [],
      inventory: []
    });

    const baseBreakdown = getTradePriceBreakdown(state, merchant.npcId, playerId, false);
    expect(baseBreakdown.finalBuyMultiplier).toBeCloseTo(1.0, 2);

    // Quest reward adds +50 standing for 'town' on player MemoryComponent -> lowers Town merchant prices
    const playerMem = getComponent(state, playerId, ComponentType.Memory) as MemoryComponent;
    state = addComponent(state, playerId, {
      ...playerMem,
      factionStandings: { ...playerMem.factionStandings, town: 50 }
    });
    expect(getEffectiveStandingBetween(state, merchant.npcId, playerId)).toBe(50);
    const friendlyBreakdown = getTradePriceBreakdown(state, merchant.npcId, playerId, false);
    expect(friendlyBreakdown.finalBuyMultiplier).toBeCloseTo(0.9, 2);
    expect(friendlyBreakdown.annotations.some((a) => a.includes('Standing'))).toBe(true);

    // Social contest works with Layer 2 standing
    const socialRes = processSocialIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'persuade',
      target: { type: 'entity', entityId: merchant.npcId }
    });
    expect(socialRes.success).toBe(true);

    // Universal Actor Symmetry (Rule 18): Non-player NPC in 'player' faction commits witnessed kill on 'town'
    // -> loses standing with 'town' (-25) AND ripples to allied 'neutral' faction (-10 at 0.4 ratio)
    const witnessNpc = spawnFriendlyTownNpc(state, 7, 5, 100);
    state = witnessNpc.state;
    const killerNpc = spawnFriendlyTownNpc(state, 4, 6, 100);
    state = addComponent(killerNpc.state, killerNpc.npcId, {
      type: ComponentType.Faction,
      factionId: 'player'
    } as FactionComponent);
    state = applyReputationCrime(state, killerNpc.npcId, merchant.npcId, true);
    const killerMem = getComponent(state, killerNpc.npcId, ComponentType.Memory) as MemoryComponent;
    expect(killerMem.factionStandings['town']).toBe(-25);
    expect(killerMem.factionStandings['neutral']).toBe(-10);
  });
});
