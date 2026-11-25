import { afterEach, describe, expect, it } from 'bun:test';
import { addComponent, createEntity, getComponent, removeEntity, spawnItem } from '../src/core/ecs.ts';
import { loadRulesetBaseContent } from '../src/core/loader/system_content_loader.ts';
import { deserializeGameState, serializeGameState } from '../src/core/save.ts';
import { initEngine } from '../src/core/scheduler.ts';
import { classicRulesetContract } from '../src/rulesets/classic/classic_ruleset.ts';
import { dnd35eRulesetContract } from '../src/rulesets/dnd35e/dnd35e_ruleset.ts';
import { spawnField } from '../src/systems/field.system.ts';
import { processChangeAreaIntent } from '../src/systems/map.system.ts';
import { ComponentType, type ItemComponent, type PortalComponent, type PositionComponent } from '../src/types/components.types.ts';
import { GameEventType } from '../src/types/events.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

const HEAVY_INTEGRATION_TIMEOUT_MS = 15000;

describe('Floor Transition Entity ID Integrity & Ruleset Base Content Loading', () => {
  afterEach(() => {
    initEngine();
  });

  const realmsCampaign = loadCampaignFromDisk('realms-of-shroudgarde');
  const cryptCampaign = loadCampaignFromDisk('dnd35e-crypt');
  const defaultCampaign = loadCampaignFromDisk('default');

  it(
    'advances nextEntityId past all generated portals and doors on Floor 2 so actor-turn spawns never overwrite stairs_up or iron gates',
    () => {
      let state = buildGameState(realmsCampaign);
      const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
      expect(playerId).toBeDefined();

      // Transition from Floor 1 (shroudgarde_courtyard) to Floor 2 (shroudgarde_inn_cellar)
      const transition = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: playerId!,
        targetAreaId: 'shroudgarde_inn_cellar'
      });
      expect(transition.success).toBe(true);
      state = transition.state;
      expect(state.currentAreaId).toBe('shroudgarde_inn_cellar');

      const maxActiveId = Math.max(...state.entities);
      expect(state.nextEntityId).toBeGreaterThan(maxActiveId);

      // Snapshot all Portal entities (stairs_up / stairs_down) and doors (structural or 'door'-tagged) on Floor 2
      const floor2Portals = state.entities.filter((id) => getComponent(state, id, ComponentType.Portal) !== undefined);
      const floor2Doors = state.entities.filter(
        (id) =>
          getComponent(state, id, ComponentType.Structural)?.isDoor === true ||
          getComponent(state, id, ComponentType.Tags)?.tags.includes('door') === true
      );
      expect(floor2Portals.length).toBeGreaterThanOrEqual(2);
      expect(
        floor2Portals.some(
          (id) =>
            (getComponent(state, id, ComponentType.Portal) as PortalComponent).targetAreaId === 'shroudgarde_courtyard'
        )
      ).toBe(true);
      expect(floor2Doors.length).toBeGreaterThan(0);

      // Simulate dozens of entities/fields/items allocated & removed during Floor 2 exploration/combat
      const fieldKey = Object.keys(realmsCampaign.fields)[0]!;
      expect(fieldKey).toBeDefined();
      const transientIds: EntityId[] = [];
      for (let i = 0; i < 15; i++) {
        let createdId: EntityId;
        [state, createdId] = createEntity(state);
        transientIds.push(createdId);
        const pos = getComponent(state, playerId!, ComponentType.Position) as PositionComponent;
        const [afterField, fieldId] = spawnField(state, fieldKey, pos.x, pos.y, 2, playerId);
        transientIds.push(fieldId);
        state = afterField;
        const [afterItem] = spawnItem(state, 'copper_coin', pos.x, pos.y);
        state = afterItem;
      }
      for (const id of transientIds) {
        state = removeEntity(state, id);
      }

      // Verify zero Floor 2 portals or doors were overwritten or evicted from spatialIndex
      for (const portalId of floor2Portals) {
        expect(state.entities).toContain(portalId);
        const portal = getComponent(state, portalId, ComponentType.Portal) as PortalComponent | undefined;
        const pos = getComponent(state, portalId, ComponentType.Position) as PositionComponent | undefined;
        expect(portal).toBeDefined();
        expect(pos).toBeDefined();
        expect(state.spatialIndex.get(`${pos!.x},${pos!.y},${pos!.z ?? 0}`)).toContain(portalId);
      }
      for (const doorId of floor2Doors) {
        expect(state.entities).toContain(doorId);
        const tags = getComponent(state, doorId, ComponentType.Tags)?.tags ?? [];
        const isDoor =
          getComponent(state, doorId, ComponentType.Structural)?.isDoor === true || tags.includes('door');
        const pos = getComponent(state, doorId, ComponentType.Position) as PositionComponent | undefined;
        expect(isDoor).toBe(true);
        expect(pos).toBeDefined();
        expect(state.spatialIndex.get(`${pos!.x},${pos!.y},${pos!.z ?? 0}`)).toContain(doorId);
      }
    },
    HEAVY_INTEGRATION_TIMEOUT_MS
  );

  it(
    'propagates nextEntityId when wakeSavedAreaFloor respawns entities on revisit',
    () => {
      let state = buildGameState(cryptCampaign);
      const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

      // Visit dungeon_1 once (crBudget: 15, respawnTimerTurns: 10), clear enemies to open CR headroom, then leave to safe_hub
      state = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: playerId,
        targetAreaId: 'dungeon_1'
      }).state;
      for (const id of [...state.entities]) {
        if (id !== playerId && getComponent(state, id, ComponentType.Fighter) !== undefined) {
          state = removeEntity(state, id);
        }
      }
      state = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: playerId,
        targetAreaId: 'safe_hub'
      }).state;

      // Advance globalTurn past respawnTimerTurns (10) and re-enter dungeon_1 to trigger wakeSavedAreaFloor
      const beforeRevisitNextEntityId = state.nextEntityId;
      state = { ...state, globalTurn: state.globalTurn + 50, events: [] };
      const revisit = processChangeAreaIntent(state, {
        type: IntentType.ChangeArea,
        entityId: playerId,
        targetAreaId: 'dungeon_1'
      });
      expect(revisit.success).toBe(true);
      expect(revisit.state.events.some((e) => e.type === GameEventType.AreaRespawned)).toBe(true);
      expect(revisit.state.nextEntityId).toBeGreaterThan(beforeRevisitNextEntityId);
      const maxEntityId = Math.max(...revisit.state.entities);
      expect(revisit.state.nextEntityId).toBeGreaterThan(maxEntityId);
    },
    HEAVY_INTEGRATION_TIMEOUT_MS
  );

  it('guards createEntity against occupied IDs and clamps stale nextEntityId/nextItemInstanceId on deserializeGameState', () => {
    let state = buildGameState(defaultCampaign);
    const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;

    state = processChangeAreaIntent(state, {
      type: IntentType.ChangeArea,
      entityId: playerId,
      targetAreaId: 'dungeon_1'
    }).state;

    // Ensure at least one item entity with a monotonic instanceId exists before serializing
    const playerPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    const itemId = Object.keys(defaultCampaign.items)[0]!;
    let spawnedItemEntityId: EntityId;
    [state, spawnedItemEntityId] = spawnItem(state, itemId, playerPos.x, playerPos.y);
    const itemComp = getComponent(state, spawnedItemEntityId, ComponentType.Item) as ItemComponent;
    const itemSeq = Number.parseInt(itemComp.instanceId.split('_').pop() ?? '0', 10);
    expect(itemSeq).toBeGreaterThan(0);

    const existingId = state.entities.find((id) => id !== playerId);
    expect(existingId).toBeDefined();
    const originalComps = state.components.get(existingId!);

    // Poison nextEntityId to collide directly with an active entity ID
    const poisonedState: GameState = { ...state, nextEntityId: existingId! };
    const [guardedState, allocatedId] = createEntity(poisonedState);
    expect(allocatedId).not.toBe(existingId!);
    expect(guardedState.components.get(existingId!)).toEqual(originalComps);
    expect(guardedState.nextEntityId).toBeGreaterThan(existingId!);

    // Poison serialized save's nextEntityId and nextItemInstanceId and confirm deserializeGameState heals both
    const serialized = serializeGameState(state);
    const poisonedSerialized = { ...serialized, nextEntityId: 1, nextItemInstanceId: 1 };
    const rehydrated = deserializeGameState(poisonedSerialized, defaultCampaign);
    const maxKnownId = Math.max(
      ...rehydrated.entities,
      ...Array.from(rehydrated.areas.values()).flatMap((a) => [...a.entities])
    );
    expect(rehydrated.nextEntityId).toBeGreaterThan(maxKnownId);
    expect(rehydrated.nextItemInstanceId).toBeGreaterThan(itemSeq);

    // Verify addComponent on freshly allocated entity does not clobber existing portal/door
    const [postLoadState, freshId] = createEntity(rehydrated);
    const afterTagged = addComponent(postLoadState, freshId, { type: ComponentType.Tags, tags: ['safe_fresh'] });
    expect(getComponent(afterTagged, existingId!, ComponentType.Position)).toEqual(
      originalComps?.[ComponentType.Position]
    );
  });

  it('loads only ruleset-declared base content files with zero speculative 404 fetches', async () => {
    expect(classicRulesetContract.getBaseContentFiles?.() ?? []).toEqual([]);
    expect(dnd35eRulesetContract.getBaseContentFiles?.()).toEqual([
      { key: 'status', filename: 'status.json' },
      { key: 'effects', filename: 'effects.json' }
    ]);

    const fetchedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      fetchedUrls.push(String(input));
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;

    try {
      await loadRulesetBaseContent('classic');
      expect(fetchedUrls).toEqual([]);

      await loadRulesetBaseContent('dnd35e');
      expect(fetchedUrls.length).toBe(2);
      expect(fetchedUrls.every((u) => u.endsWith('/status.json') || u.endsWith('/effects.json'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
