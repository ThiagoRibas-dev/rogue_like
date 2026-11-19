import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUNDS_PER_HOUR } from '../src/constants/world_clock.constants.ts';
import {
  addComponent,
  createEntity,
  getComponent,
  resolveEntityDisplayName,
  spawnEntity,
  spawnItem
} from '../src/core/ecs.ts';
import { initRNG } from '../src/core/rng.ts';
import { executeEightHourRest } from '../src/rulesets/dnd35e/magic/rest_recovery.ts';
import { prepareSpellIntoSlot } from '../src/rulesets/dnd35e/magic/spellbook_actions.ts';
import { evaluateActorRestSafety } from '../src/systems/rest.system.ts';
import { buildTurnStatusRibbon, isActorPerceivedByPlayer } from '../src/rendering/ui/hud_alerts.ui.ts';
import { applyCharacterCreationToPlayer, type CharacterCreationDraft } from '../src/rulesets/dnd35e/character_builder.ts';
import { EIGHT_HOURS_IN_ROUNDS, OPEN_SLOT_PREPARATION_ROUNDS } from '../src/rulesets/dnd35e/magic/aoe_rest.ts';
import { executeDnD35eSpellCast } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { applyElapsedWorldHours } from '../src/systems/world_clock.system.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type ResourcePoolComponent
} from '../src/types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../src/types/game-state.types.ts';
import { coordToIndex } from '../src/utils/grid.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildSafeDndPlayerState(characterName?: string): { state: GameState; playerId: EntityId } {
  initRNG(42);
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const sys = getDnD35SystemContent(campaign)!;
  let state = buildGameState(campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
  const draft: CharacterCreationDraft = {
    ...(characterName !== undefined ? { characterName } : {}),
    raceId: 'human',
    classId: 'cleric',
    alignment: 'NG',
    selectedAcfs: [],
    domains: ['healing', 'good'],
    prohibitedSchools: [],
    abilityMethod: 'point_buy',
    pointBuyBudget: 28,
    baseAbilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 14 },
    skillRanks: { concentration: 4, heal: 4 },
    selectedFeats: ['combat_casting', 'toughness'],
    knownSpells: [],
    equipmentPackageId: 'divine_crusader'
  };
  state = applyCharacterCreationToPlayer(state, playerId, draft, sys);
  return { state, playerId };
}

describe('Display Name Resolution, Top-Right Turn Ribbon, Rest Rules & Contrast Tokens', () => {
  it('resolves entity display names via strict Name -> id -> icon cascade and hydrates Character Creation name', () => {
    let { state, playerId } = buildSafeDndPlayerState('Valerius');
    expect(resolveEntityDisplayName(state, playerId)).toBe('Valerius');

    const { state: defaultState, playerId: defaultPlayerId } = buildSafeDndPlayerState('   ');
    expect(resolveEntityDisplayName(defaultState, defaultPlayerId)).toBe('Adventurer');

    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    let goblinId: EntityId;
    [state, goblinId] = spawnEntity(state, 'goblin', pos.x + 1, pos.y);
    expect(resolveEntityDisplayName(state, goblinId)).toBe(state.campaign.entities['goblin']?.name ?? 'goblin');

    const sampleItemId = Object.keys(state.campaign.items)[0]!;
    let itemId: EntityId;
    [state, itemId] = spawnItem(state, sampleItemId, pos.x, pos.y);
    const nextIdentified = new Set(state.identifiedItems);
    nextIdentified.add(sampleItemId);
    state = { ...state, identifiedItems: nextIdentified };
    expect(resolveEntityDisplayName(state, itemId)).toBe(
      state.campaign.items[sampleItemId]?.name ?? sampleItemId
    );

    let bareId: EntityId;
    [state, bareId] = createEntity(state);
    state = addComponent(state, bareId, { type: ComponentType.Renderable, glyph: '?', fg: '#fff', bg: '#000' });
    expect(resolveEntityDisplayName(state, bareId)).toBe('?');

    let unknownTemplateId: EntityId;
    [state, unknownTemplateId] = createEntity(state);
    state = addComponent(state, unknownTemplateId, {
      type: ComponentType.Template,
      templateId: 'custom_mod_beast'
    });
    expect(resolveEntityDisplayName(state, unknownTemplateId)).toBe('custom_mod_beast');
  });

  it('gates top-right turn ribbon by player perception and shows RTwP pause/readiness states', () => {
    let { state, playerId } = buildSafeDndPlayerState('Lyra');
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    const tbPlayerRibbon = buildTurnStatusRibbon(state, playerId);
    expect(tbPlayerRibbon.label).toBe('Your Turn: Lyra');
    expect(tbPlayerRibbon.severity).toBe('turn-ready');

    let enemyId: EntityId;
    [state, enemyId] = spawnEntity(state, 'goblin', pPos.x + 1, pPos.y);
    const enemyIdx = coordToIndex(pPos.x + 1, pPos.y, state.map.width);

    const inSightState: GameState = { ...state, cachedFov: new Set<number>([enemyIdx]) };
    expect(isActorPerceivedByPlayer(inSightState, enemyId, playerId)).toBe(true);

    const outOfSightState: GameState = { ...state, cachedFov: new Set<number>() };
    expect(isActorPerceivedByPlayer(outOfSightState, enemyId, playerId)).toBe(false);

    const invisibleState = addComponent(inSightState, enemyId, {
      type: ComponentType.StatusEffects,
      activeEffects: [{ effectId: 'invisible', duration: 5 }]
    });
    expect(isActorPerceivedByPlayer(invisibleState, enemyId, playerId)).toBe(false);

    const rtwpPaused: GameState = {
      ...state,
      engineMode: EngineMode.RTwP,
      rtwpState: { ...state.rtwpState, paused: true }
    };
    expect(buildTurnStatusRibbon(rtwpPaused, playerId).label).toContain('Tactical Pause (Lyra)');

    const rtwpReady: GameState = {
      ...state,
      engineMode: EngineMode.RTwP,
      rtwpState: { ...state.rtwpState, paused: false }
    };
    expect(buildTurnStatusRibbon(rtwpReady, playerId).label).toContain('Ready: Lyra');
  });

  it('blocks rest/prep on DoT afflictions, starvation, or hazards and aborts mid-rest cleanly without recovery', () => {
    let { state, playerId } = buildSafeDndPlayerState('Caelen');
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // 1. Declarative DoT status effect (modded or campaign status with perTurnDamage > 0) blocks rest
    const dotCampaign = {
      ...state.campaign,
      status: {
        ...state.campaign.status,
        mod_acid_burn: {
          id: 'mod_acid_burn',
          name: 'Acid Burn',
          description: 'Ongoing acid damage.',
          defaultDuration: 3,
          perTurnDamage: 2
        }
      }
    };
    const dotState = addComponent({ ...state, campaign: dotCampaign }, playerId, {
      type: ComponentType.StatusEffects,
      activeEffects: [{ effectId: 'mod_acid_burn', duration: 3 }]
    });
    expect(evaluateActorRestSafety(dotState, playerId).safe).toBe(false);
    expect(executeEightHourRest(dotState, playerId).globalTurn).toBe(dotState.globalTurn);
    expect(prepareSpellIntoSlot(dotState, playerId, 'cleric', 'bless', 'general', 1).globalTurn).toBe(
      dotState.globalTurn
    );

    // 2. Starving blocks rest
    const starvingState = addComponent(state, playerId, { type: ComponentType.Hunger, satiation: 0 });
    expect(evaluateActorRestSafety(starvingState, playerId).safe).toBe(false);

    // 3. Hazardous floor field blocks rest
    let hazardState: GameState;
    let fireId: EntityId;
    [hazardState, fireId] = createEntity(state);
    hazardState = addComponent(hazardState, fireId, { type: ComponentType.Position, x: pPos.x, y: pPos.y });
    hazardState = addComponent(hazardState, fireId, {
      type: ComponentType.Field,
      fieldType: 'fire',
      duration: 5
    });
    expect(evaluateActorRestSafety(hazardState, playerId).safe).toBe(false);

    // 4. Mid-rest interruption aborts without recovering HP
    const f = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent;
    const damagedState = addComponent(state, playerId, { ...f, hp: Math.max(1, f.hp - 5) });
    const bulkInterrupted = advanceWorldTimeBulk(
      damagedState,
      EIGHT_HOURS_IN_ROUNDS,
      playerId,
      (cur) => (cur.globalTurn >= damagedState.globalTurn + 10 ? 'Hostile patrol interrupted camp!' : undefined)
    );
    expect(bulkInterrupted.interruptedReason).toBe('Hostile patrol interrupted camp!');
    expect(bulkInterrupted.turnsAdvanced).toBeLessThan(EIGHT_HOURS_IN_ROUNDS);
  });

  it('enforces 15-min open slot prep, 8h recent-cast slot retention, all-cycle pool & companion recovery, and nonlethal healing', () => {
    let { state, playerId } = buildSafeDndPlayerState('Seraphina');
    const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // 1. Open-slot preparation advances 150 rounds (15 min) and logs display name
    const prePrepTurn = state.globalTurn;
    state = prepareSpellIntoSlot(state, playerId, 'cleric', 'bless', 'general', 1);
    expect(state.globalTurn).toBe(prePrepTurn + OPEN_SLOT_PREPARATION_ROUNDS);
    expect(state.messages[state.messages.length - 1]?.text).toContain('Bless');

    // 2. Expended slot cast at turn T remains expended across an 8h rest starting right after T if recast/kept < 4800 turns ago
    const preparedSlot = getDnD35EntityData(state, playerId).spellbooksByClass?.['cleric']?.preparedSlots?.find(
      (s) => s.preparedSpellId === 'bless' && !s.expended
    )!;
    const oldCastState = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      spellbooksByClass: {
        ...getDnD35EntityData(state, playerId).spellbooksByClass,
        cleric: {
          ...getDnD35EntityData(state, playerId).spellbooksByClass!['cleric']!,
          preparedSlots: [
            { ...preparedSlot, expended: true, castTimestampTurn: state.globalTurn },
            {
              slotId: 'recent_cast_slot',
              spellLevel: 1,
              slotKind: 'general',
              preparedSpellId: 'shield_of_faith',
              expended: true,
              // Cast 10 turns in the future relative to start -> < 4800 turns elapsed at rest completion
              castTimestampTurn: state.globalTurn + 10
            }
          ]
        }
      }
    });

    // Add companion + short_rest/round pools + fatigued condition + nonlethal damage
    let compId: EntityId;
    [state, compId] = createEntity(oldCastState);
    state = addComponent(state, compId, { type: ComponentType.Actor, speed: 100 });
    state = addComponent(state, compId, { type: ComponentType.Position, x: pPos.x, y: pPos.y + 1 });
    state = addComponent(state, compId, {
      type: ComponentType.Fighter,
      hp: 4,
      maxHp: 12,
      attack: 2,
      defense: 12,
      level: 2,
      xp: 0,
      xpGiven: 0
    });
    state = addComponent(state, compId, { type: ComponentType.Faction, factionId: 'player' });
    state = addComponent(state, compId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: playerId,
      linkKind: 'ally',
      stance: 'defensive',
      tags: []
    });
    state = setDnD35EntityData(state, compId, {
      ...getDnD35EntityData(state, compId),
      conditions: ['fatigued'],
      nonlethalDamage: 10
    });

    const multiPools: ResourcePoolComponent = {
      type: ComponentType.ResourcePool,
      pools: {
        turn_undead: { poolId: 'turn_undead', label: 'Turn Undead', current: 1, max: 5, refreshCycle: 'rest_8h', resetOnRest: true },
        ki_strike: { poolId: 'ki_strike', label: 'Ki', current: 0, max: 2, refreshCycle: 'encounter', resetOnRest: false }
      }
    };
    state = addComponent(state, playerId, multiPools);

    const afterRest = executeEightHourRest(state, playerId);
    const postSlots = getDnD35EntityData(afterRest, playerId).spellbooksByClass?.['cleric']?.preparedSlots ?? [];
    expect(postSlots.find((s) => s.slotId === preparedSlot.slotId)?.expended).toBe(false);
    expect(postSlots.find((s) => s.slotId === 'recent_cast_slot')?.expended).toBe(true);

    const postPools = getComponent(afterRest, playerId, ComponentType.ResourcePool);
    expect(postPools?.pools['turn_undead']?.current).toBe(5);
    expect(postPools?.pools['ki_strike']?.current).toBe(2);

    const compFighter = getComponent(afterRest, compId, ComponentType.Fighter) as FighterComponent;
    expect(compFighter.hp).toBe(6); // +2 HP (1 HP/HD)
    const compDnd = getDnD35EntityData(afterRest, compId);
    expect(compDnd.conditions).not.toContain('fatigued');
    expect(compDnd.nonlethalDamage).toBe(0); // 8 hours * 2 HD = 16 >= 10

    // 3. Hourly nonlethal healing and non-living CON:null immunity + Cure Light Wounds nonlethal reduction
    const playerDndBefore = getDnD35EntityData(afterRest, playerId);
    const bruisedState = setDnD35EntityData(afterRest, playerId, { ...playerDndBefore, nonlethalDamage: 6 });
    const afterOneHour = applyElapsedWorldHours(bruisedState, 0, ROUNDS_PER_HOUR);
    expect(getDnD35EntityData(afterOneHour, playerId).nonlethalDamage).toBe(5);

    const nonLivingState = setDnD35EntityData(bruisedState, playerId, {
      ...playerDndBefore,
      nonlethalDamage: 6,
      abilityScores: { ...playerDndBefore.abilityScores, con: { ...playerDndBefore.abilityScores.con, base: null } }
    });
    expect(getDnD35EntityData(applyElapsedWorldHours(nonLivingState, 0, ROUNDS_PER_HOUR), playerId).nonlethalDamage).toBe(6);

    // Magical healing reduces both lethal & nonlethal damage
    const woundedP = addComponent(bruisedState, playerId, {
      ...(getComponent(bruisedState, playerId, ComponentType.Fighter) as FighterComponent),
      hp: 4
    });
    const castRes = executeDnD35eSpellCast(woundedP, playerId, { x: pPos.x, y: pPos.y }, {
      classId: 'cleric',
      spellId: 'bless',
      slotId: preparedSlot.slotId,
      convertedSpellId: 'cure_light_wounds'
    });
    expect(castRes.success).toBe(true);
    expect(getDnD35EntityData(castRes.state, playerId).nonlethalDamage).toBeLessThan(6);
  });

  it('defines complete Parchment contrast CSS tokens and dark close button overrides', () => {
    const consoleCss = readFileSync(join(process.cwd(), 'src/styles/console_prototype.css'), 'utf-8');
    const modalsCss = readFileSync(join(process.cwd(), 'src/styles/modals.css'), 'utf-8');
    expect(consoleCss).toContain('--crpg-text: #261d14');
    expect(consoleCss).toContain('--crpg-border-subtle:');
    expect(consoleCss).toContain('--crpg-chip-normal-bg:');
    expect(consoleCss).not.toContain('color: #a6e3a1');
    expect(modalsCss).toContain('.dnd35-fullscreen-modal .modal-close-btn');
    expect(modalsCss).toContain('color: var(--crpg-gold, #7a4f0d)');
  });
});
