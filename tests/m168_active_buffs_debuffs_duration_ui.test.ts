import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import { detectAutoPauseSignals } from '../src/core/auto_pause_signals.ts';
import { DEFAULT_AUTO_PAUSE_SETTINGS } from '../src/constants/autopause.constants.ts';
import { buildInspectTooltip } from '../src/rendering/inspect_tooltip.ts';
import { projectHudAlertsList } from '../src/rendering/ui/hud_alerts.ui.ts';
import { buildTacticalViewportData } from '../src/rendering/tactical_snapshot.ts';
import { projectDnD35eActiveEffects } from '../src/rulesets/dnd35e/cartridge/dnd35e_active_effects.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { applyResolvedSpellEffectsToTarget } from '../src/rulesets/dnd35e/magic/spell_cast_effects.ts';
import {
  classifyEffectPolarity,
  formatSpellModifiersSummary,
  parseSpellDurationTurns,
  type ParsedSpellDuration
} from '../src/rulesets/dnd35e/magic/spell_duration.ts';
import { buildActorFeatureEntries } from '../src/rulesets/dnd35e/ui/dnd35e_ui_projection.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { DND35E_DEFAULT_WORLD_CLOCK_CONFIG } from '../src/rulesets/dnd35e/world_clock.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { getEffectiveWorldClockConfig } from '../src/systems/world_clock.system.ts';
import {
  applyStatusEffect,
  advanceActorStatusEffectsByTurns,
  hasPerTurnStatusActivity,
  processStatusEffectsTick
} from '../src/systems/status-effect.system.ts';
import { advanceWorldTimeBulk } from '../src/systems/world_time_skip.ts';
import {
  ComponentType,
  type PositionComponent,
  type PropertyOverlayComponent,
  type StatusEffectsComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import {
  formatTurnDurationCompact,
  formatTurnDurationVerbose,
  getTurnsPerDay,
  getTurnsPerHour,
  getTurnsPerMinute
} from '../src/utils/duration.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function getPlayerId(state: GameState): EntityId {
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) throw new Error('Player entity missing from test state');
  return playerId;
}

const NO_META = {
  empower: false,
  maximize: false,
  extend: false,
  widen: false,
  silent: false,
  still: false,
  judicious: false,
  projectTouch: false
};

describe('Milestone 168: Active Buffs, Debuffs & Spell Duration Lifecycle, Dispel Sync & UI Observability', () => {
  const sharedCampaign = loadCampaignFromDisk('dnd35e-crypt');

  it('parses all SRD duration formulas including Extend Spell and formats monotonic compact/verbose badges', () => {
    const rPerLevel: ParsedSpellDuration = parseSpellDurationTurns('1 round/level', 5);
    expect(rPerLevel).toEqual({ durationTurns: 5, isPermanent: false, isConcentration: false });
    expect(parseSpellDurationTurns('1_round_per_level', 5).durationTurns).toBe(5);
    expect(parseSpellDurationTurns('1 round/level', 5, { extend: true }).durationTurns).toBe(10);

    expect(parseSpellDurationTurns('1 min/level', 3).durationTurns).toBe(30);
    expect(parseSpellDurationTurns('10 min/level', 2).durationTurns).toBe(200);
    expect(parseSpellDurationTurns('1 hour/level', 1).durationTurns).toBe(600);
    expect(parseSpellDurationTurns('2 hours/level', 1).durationTurns).toBe(1200);
    expect(parseSpellDurationTurns('1 day/level', 1).durationTurns).toBe(14400);
    expect(parseSpellDurationTurns('1 round + 1 round/3 levels', 6).durationTurns).toBe(3);
    expect(parseSpellDurationTurns('concentration', 4)).toEqual({
      durationTurns: 10,
      isPermanent: false,
      isConcentration: true
    });
    expect(parseSpellDurationTurns('concentration, up to 1 min/level', 2)).toEqual({
      durationTurns: 20,
      isPermanent: false,
      isConcentration: true
    });
    expect(parseSpellDurationTurns('permanent')).toEqual({
      durationTurns: 0,
      isPermanent: true,
      isConcentration: false
    });
    expect(parseSpellDurationTurns('instantaneous').durationTurns).toBe(0);
    expect(parseSpellDurationTurns('instantaneous', 1, { fallbackRoundsForCondition: true }).durationTurns).toBe(2);

    // Monotonic compact transitions across d -> h -> m -> r using D&D 3.5e 6s round clock
    expect(formatTurnDurationCompact(28800, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('2d');
    expect(formatTurnDurationCompact(14400, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1d');
    expect(formatTurnDurationCompact(13800, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('23h');
    expect(formatTurnDurationCompact(600, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1h');
    expect(formatTurnDurationCompact(599, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('59m');
    expect(formatTurnDurationCompact(10, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1m');
    expect(formatTurnDurationCompact(9, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('9r');
    expect(formatTurnDurationCompact(1, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1r');
    expect(formatTurnDurationCompact(0, true, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('Perm');

    expect(formatTurnDurationVerbose(10, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1m (10 rounds)');
    expect(formatTurnDurationVerbose(900, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1h 30m (900 rounds)');
    expect(formatTurnDurationVerbose(6, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('6 rounds');
    expect(formatTurnDurationVerbose(1, false, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('1 round');
    expect(formatTurnDurationVerbose(0, true, DND35E_DEFAULT_WORLD_CLOCK_CONFIG)).toBe('Permanent');

    // Tier 1 Console neutral fallback labels ('t' / 'turn' / 'turns')
    expect(formatTurnDurationCompact(9)).toBe('9t');
    expect(formatTurnDurationCompact(1)).toBe('1t');
    expect(formatTurnDurationVerbose(6)).toBe('6 turns');
    expect(formatTurnDurationVerbose(1)).toBe('1 turn');
    expect(formatTurnDurationVerbose(10)).toBe('1m (10 turns)');

    // Multi-system clock scales (1s/turn GURPS, 60s/turn AD&D 1e, custom 20h/day calendar)
    const gurpsScale = { secondsPerGlobalTurn: 1, hoursPerDay: 24 };
    expect(getTurnsPerMinute(gurpsScale)).toBe(60);
    expect(getTurnsPerHour(gurpsScale)).toBe(3600);
    expect(getTurnsPerDay(gurpsScale)).toBe(86400);
    expect(formatTurnDurationCompact(59, false, gurpsScale)).toBe('59t');
    expect(formatTurnDurationCompact(60, false, gurpsScale)).toBe('1m');
    expect(formatTurnDurationCompact(3600, false, gurpsScale)).toBe('1h');

    const odndScale = {
      secondsPerGlobalTurn: 60,
      hoursPerDay: 24,
      turnUnitShort: 'r',
      turnUnitSingular: 'round',
      turnUnitPlural: 'rounds'
    };
    expect(getTurnsPerMinute(odndScale)).toBe(1);
    expect(getTurnsPerHour(odndScale)).toBe(60);
    expect(getTurnsPerDay(odndScale)).toBe(1440);
    expect(formatTurnDurationCompact(1, false, odndScale)).toBe('1m');
    expect(formatTurnDurationCompact(60, false, odndScale)).toBe('1h');
    expect(formatTurnDurationCompact(1440, false, odndScale)).toBe('1d');

    const twentyHourDayScale = { secondsPerGlobalTurn: 6, hoursPerDay: 20 };
    expect(getTurnsPerDay(twentyHourDayScale)).toBe(12000);
    expect(formatTurnDurationCompact(12000, false, twentyHourDayScale)).toBe('1d');
    expect(formatTurnDurationCompact(11400, false, twentyHourDayScale)).toBe('19h');

    // Effective WorldClockConfig resolves campaign override while inheriting ruleset unit labels
    const dndState = buildGameState(sharedCampaign);
    const effectiveClock = getEffectiveWorldClockConfig(dndState);
    expect(effectiveClock.secondsPerGlobalTurn).toBe(6);
    expect(effectiveClock.turnUnitShort).toBe('r');
    expect(effectiveClock.turnUnitSingular).toBe('round');
    expect(effectiveClock.turnUnitPlural).toBe('rounds');
  });

  it('registers timed Divine Favor & Magic Weapon buffs, enforces enhancement competition & weapon:magic DR bypass, and expires cleanly', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const sys = getDnD35SystemContent(state.campaign)!;
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    // Equip a custom +1 Longsword so weapon enhancement competition can be verified
    const plusOneCampaign = {
      ...state.campaign,
      items: {
        ...state.campaign.items,
        test_plus1_longsword: {
          ...state.campaign.items['longsword']!,
          id: 'test_plus1_longsword',
          name: '+1 Longsword',
          category: 'weapon' as const,
          magicalProperties: { enhancementBonus: 1, isMasterwork: true }
        }
      }
    };
    state = { ...state, campaign: plusOneCampaign };
    let swordId: EntityId;
    [state, swordId] = spawnItem(state, 'test_plus1_longsword', pos.x, pos.y);
    const eqComp = getComponent(state, playerId, ComponentType.Equipment);
    expect(eqComp).toBeDefined();
    if (eqComp) {
      let assigned = false;
      const updatedSlots = eqComp.slots.map((slot) => {
        const isHand = slot.slotType === 'hand' || slot.slotType === 'main_hand' || slot.id.startsWith('main_hand');
        if (isHand && !assigned) {
          assigned = true;
          return { ...slot, equippedItem: swordId };
        }
        return isHand ? { ...slot, equippedItem: null } : slot;
      });
      expect(assigned).toBe(true);
      state = addComponent(state, playerId, { ...eqComp, slots: updatedSlots });
    }
    const baseDag = evaluateDnD35eEntityDAG(state, playerId)!;
    const basePrimaryStrike = baseDag.attackRoutine.strikes[0]!;

    // Cast Divine Favor at CL 6 -> +2 luck Attack, +2 luck Damage for 1 minute (10 rounds)
    const divineFavor = sys.spells['divine_favor']!;
    state = applyResolvedSpellEffectsToTarget({
      state,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: divineFavor,
      units: divineFavor.effectUnits,
      casterLevel: 6,
      castId: 'cast_df_1',
      metamagic: NO_META,
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });

    // Cast Magic Weapon at CL 3 -> +1 enhancement Attack/Damage, weapon:magic, 3 min (30 rounds)
    const magicWeapon = sys.spells['magic_weapon']!;
    state = applyResolvedSpellEffectsToTarget({
      state,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: magicWeapon,
      units: magicWeapon.effectUnits,
      casterLevel: 3,
      castId: 'cast_mw_1',
      metamagic: NO_META,
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });

    const statusesAfterCast = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent;
    expect(statusesAfterCast.activeEffects.length).toBeGreaterThanOrEqual(2);
    const dfEff = statusesAfterCast.activeEffects.find((e) => e.effectId === 'spell:divine_favor')!;
    const mwEff = statusesAfterCast.activeEffects.find((e) => e.effectId === 'spell:magic_weapon')!;
    expect(dfEff.duration).toBe(10);
    expect(dfEff.polarity).toBe('buff');
    expect(mwEff.duration).toBe(30);
    expect(mwEff.grantedTags).toContain('weapon:magic');

    const buffedDag = evaluateDnD35eEntityDAG(state, playerId)!;
    const buffedPrimaryStrike = buffedDag.attackRoutine.strikes[0]!;
    // +1 Longsword (+1 enh) competes with Magic Weapon (+1 enh), while Divine Favor (+2 luck) stacks!
    expect(buffedDag.dagResult.attackBonus).toBe(baseDag.dagResult.attackBonus + 2);
    expect(buffedDag.dagResult.damageBonus).toBe(baseDag.dagResult.damageBonus + 2);
    expect(buffedPrimaryStrike.attackBonus).toBe(basePrimaryStrike.attackBonus + 2);
    expect(buffedPrimaryStrike.flatDamageBonus).toBe(basePrimaryStrike.flatDamageBonus + 2);
    expect(buffedDag.selfTags).toContain('weapon:magic');
    expect(buffedPrimaryStrike.bypassTags).toContain('magic');

    // Friendly buffs must NOT trigger detrimental auto-pause or warning AlertsStack ribbons
    const initialCleanState = buildGameState(sharedCampaign);
    const autoPause = detectAutoPauseSignals(initialCleanState, state, DEFAULT_AUTO_PAUSE_SETTINGS);
    expect(autoPause.reason).toBeUndefined();
    const alerts = projectHudAlertsList(state, playerId);
    expect(alerts.some((a) => a.label.includes('Divine Favor') || a.label.includes('Magic Weapon'))).toBe(false);

    // Tick 10 turns -> Divine Favor expires while Magic Weapon remains at 20 rounds
    state = advanceActorStatusEffectsByTurns(state, playerId, 10);
    const midStatuses = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent;
    expect(midStatuses.activeEffects.some((e) => e.effectId === 'spell:divine_favor')).toBe(false);
    expect(midStatuses.activeEffects.find((e) => e.effectId === 'spell:magic_weapon')?.duration).toBe(20);
    expect(state.messages.some((m) => m.text.includes('Divine Favor has worn off.'))).toBe(true);

    const midDag = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(midDag.dagResult.attackBonus).toBe(baseDag.dagResult.attackBonus);
    expect(midDag.dagResult.damageBonus).toBe(baseDag.dagResult.damageBonus);
    expect(midDag.selfTags).toContain('weapon:magic');

    // Tick remaining 20 turns -> Magic Weapon expires & revokes weapon:magic + enhancement bonus
    state = advanceActorStatusEffectsByTurns(state, playerId, 20);
    expect(getComponent(state, playerId, ComponentType.StatusEffects)).toBeUndefined();
    const finalDag = evaluateDnD35eEntityDAG(state, playerId)!;
    expect(finalDag.dagResult.attackBonus).toBe(baseDag.dagResult.attackBonus);
    expect(finalDag.dagResult.damageBonus).toBe(baseDag.dagResult.damageBonus);
    expect(finalDag.selfTags).not.toContain('weapon:magic');
    expect(finalDag.attackRoutine.strikes[0]!.bypassTags).not.toContain('magic');
  });

  it('tracks mixed Enlarge Person polarity & footprint expiry and supports O(1) 8h buff time skipping', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const sys = getDnD35SystemContent(state.campaign)!;
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    const dnd = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...dnd,
      creatureType: 'humanoid'
    });

    const enlarge = sys.spells['enlarge_person']!;
    state = applyResolvedSpellEffectsToTarget({
      state,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: enlarge,
      units: enlarge.effectUnits,
      casterLevel: 1,
      castId: 'cast_ep_1',
      metamagic: { ...NO_META, extend: true }, // Extend Spell -> 2 min = 20 rounds
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });

    const enlargedPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    expect(enlargedPos.footprintWidth).toBe(2);
    const epStatus = (getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent)
      .activeEffects[0]!;
    expect(epStatus.polarity).toBe('mixed');
    expect(epStatus.duration).toBe(20);
    expect(hasPerTurnStatusActivity(state, playerId)).toBe(false);

    // Tick 1 turn via processStatusEffectsTick -> 19 rounds left and DAG remains accurate
    state = processStatusEffectsTick(state, playerId);
    expect(
      (getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent).activeEffects[0]!.duration
    ).toBe(19);
    expect(evaluateDnD35eEntityDAG(state, playerId)!.dndData.statModifiers?.length).toBeGreaterThan(0);

    // Bulk time skip across 59 rounds cleanly expires Enlarge Person & restores 1x1 footprint
    const bulkRes = advanceWorldTimeBulk(state, 59, playerId);
    state = bulkRes.state;
    expect(getComponent(state, playerId, ComponentType.StatusEffects)).toBeUndefined();
    const restoredPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
    expect(restoredPos.footprintWidth ?? 1).toBe(1);
  });

  it('triggers alerts/auto-pause on debuffs, preserves multi-unit same-cast modifiers, and syncs Dispel Magic + UI projections', () => {
    let state = buildGameState(sharedCampaign);
    const playerId = getPlayerId(state);
    const sys = getDnD35SystemContent(state.campaign)!;
    const pos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;

    let enemyId: EntityId;
    [state, enemyId] = spawnEntity(state, 'goblin', pos.x + 1, pos.y);

    // Apply Prayer foe debuff to player -> triggers warning alert + detrimental auto-pause
    const prayer = sys.spells['prayer']!;
    const foeUnit = prayer.effectUnits.filter((u) => u.unitId === 'prayer_enemy_debuff');
    const debuffedPlayerState = applyResolvedSpellEffectsToTarget({
      state,
      casterId: enemyId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: prayer,
      units: foeUnit,
      casterLevel: 5,
      castId: 'cast_prayer_foe',
      metamagic: NO_META,
      casterAbilityMod: 2,
      totalBab: 2,
      saveResultByUnitId: {},
      sysContent: sys
    });

    const autoPause = detectAutoPauseSignals(state, debuffedPlayerState, DEFAULT_AUTO_PAUSE_SETTINGS);
    expect(autoPause.reason).toBe('detrimental_status');
    const alerts = projectHudAlertsList(debuffedPlayerState, playerId);
    expect(alerts.some((a) => a.label === 'Prayer')).toBe(true);

    // Also inspect enemy debuffed by Glitterdust (blinded) -> Inspect Tooltip & Feature Entries reflect it
    const glitterdust = sys.spells['glitterdust']!;
    let debuffedEnemyState = applyResolvedSpellEffectsToTarget({
      state: debuffedPlayerState,
      casterId: playerId,
      targetId: enemyId,
      targetPos: { x: pos.x + 1, y: pos.y },
      spell: glitterdust,
      units: glitterdust.effectUnits,
      casterLevel: 3,
      castId: 'cast_glitter_1',
      metamagic: NO_META,
      casterAbilityMod: 3,
      totalBab: 2,
      saveResultByUnitId: {},
      sysContent: sys
    });

    expect(getDnD35EntityData(debuffedEnemyState, enemyId).conditions).toContain('blinded');
    const enemyEffects = projectDnD35eActiveEffects(debuffedEnemyState, enemyId);
    expect(enemyEffects.some((e) => e.label === 'Glitterdust' && e.polarity === 'debuff' && e.durationTurns === 3)).toBe(
      true
    );

    const inspectState: GameState = {
      ...debuffedEnemyState,
      map: { ...debuffedEnemyState.map, isFullyExplored: true },
      inspectMode: { active: true, x: pos.x + 1, y: pos.y },
      cachedFov: new Set<number>([pos.y * debuffedEnemyState.map.width + (pos.x + 1)])
    };
    const tooltip = buildInspectTooltip(inspectState, 0, 0, 40, 25);
    expect(tooltip.sections.some((s) => s.value.includes('Glitterdust (3r)'))).toBe(true);

    // Same-cast multi-unit modifiers preserve earlier units under identical castId
    const magicWeapon = sys.spells['magic_weapon']!;
    const multiUnitSpell = {
      ...magicWeapon,
      id: 'test_multi_unit',
      name: 'Test Multi Unit',
      duration: '1 min/level',
      effectBundle: undefined,
      effectUnits: [
        {
          type: 'stat_bundle' as const,
          unitId: 'unit_a',
          targetRole: 'caster' as const,
          effectBundle: {
            bundleId: 'b_a',
            name: 'Unit A',
            category: 'trait' as const,
            usageMode: 'passive' as const,
            modifiers: [{ id: 'm_a', target: 'fort', value: 2, type: 'morale' }],
            ruleOverrides: [],
            grantedTags: [],
            immunities: [],
            vulnerabilities: [],
            energyResistances: {},
            activatedAbilities: [],
            classSkillsAdded: [],
            grantedFeats: [],
            virtualFeatGrants: []
          }
        },
        {
          type: 'stat_bundle' as const,
          unitId: 'unit_b',
          targetRole: 'caster' as const,
          effectBundle: {
            bundleId: 'b_b',
            name: 'Unit B',
            category: 'trait' as const,
            usageMode: 'passive' as const,
            modifiers: [{ id: 'm_b', target: 'will', value: 2, type: 'morale' }],
            ruleOverrides: [],
            grantedTags: [],
            immunities: [],
            vulnerabilities: [],
            energyResistances: {},
            activatedAbilities: [],
            classSkillsAdded: [],
            grantedFeats: [],
            virtualFeatGrants: []
          }
        }
      ]
    };
    const multiState = applyResolvedSpellEffectsToTarget({
      state: debuffedEnemyState,
      casterId: playerId,
      targetId: playerId,
      targetPos: { x: pos.x, y: pos.y },
      spell: multiUnitSpell,
      units: multiUnitSpell.effectUnits,
      casterLevel: 2,
      castId: 'cast_multi_1',
      metamagic: NO_META,
      casterAbilityMod: 3,
      totalBab: 3,
      saveResultByUnitId: {},
      sysContent: sys
    });
    const multiMods = getDnD35EntityData(multiState, playerId).statModifiers ?? [];
    expect(multiMods.some((m) => m.sourceId === 'm_a')).toBe(true);
    expect(multiMods.some((m) => m.sourceId === 'm_b')).toBe(true);

    // Greater Dispel Magic at CL 11 guarantees deterministic dispel vs CL 3 Glitterdust (1d20 + 11 >= 14)
    const greaterDispel = sys.spells['greater_dispel_magic']!;
    debuffedEnemyState = applyResolvedSpellEffectsToTarget({
      state: debuffedEnemyState,
      casterId: playerId,
      targetId: enemyId,
      targetPos: { x: pos.x + 1, y: pos.y },
      spell: greaterDispel,
      units: greaterDispel.effectUnits,
      casterLevel: 11,
      castId: 'cast_gdm_1',
      metamagic: NO_META,
      casterAbilityMod: 5,
      totalBab: 6,
      saveResultByUnitId: {},
      sysContent: sys
    });

    expect(getComponent(debuffedEnemyState, enemyId, ComponentType.StatusEffects)).toBeUndefined();
    expect(getDnD35EntityData(debuffedEnemyState, enemyId).conditions).not.toContain('blinded');

    // Add a PropertyOverlay onto player + verify projectActiveEffects & buildActorFeatureEntries
    const overlayState = addComponent(debuffedPlayerState, playerId, {
      type: ComponentType.PropertyOverlay,
      source: 'spell:polymorph:test',
      priority: 110,
      durationTurns: 7,
      grantedTags: ['form:badger', 'animal', 'polymorphed']
    } satisfies PropertyOverlayComponent);

    const playerProjected = projectDnD35eActiveEffects(overlayState, playerId);
    expect(playerProjected.some((e) => e.label === 'Polymorph' && e.durationTurns === 7)).toBe(true);
    expect(playerProjected.some((e) => e.label === 'Prayer' && e.polarity === 'debuff')).toBe(true);

    const features = buildActorFeatureEntries(getDnD35EntityData(overlayState, playerId), sys, overlayState, playerId);
    expect(features.some((f) => f.name.includes('Prayer (5r)'))).toBe(true);

    // Canvas pips carry polarity color metadata
    const pipSnapshot = buildTacticalViewportData(
      applyStatusEffect(overlayState, enemyId, 'spell:bane', 4, playerId, undefined, {
        displayName: 'Bane',
        polarity: 'debuff',
        color: '#ff4757'
      }),
      0,
      0,
      40,
      25,
      new Set<number>([pos.y * overlayState.map.width + (pos.x + 1)])
    );
    expect(pipSnapshot.unitBadges.some((b) => b.statusColors.includes('#ff4757'))).toBe(true);

    // Overlapping spell-linked conditions preserve condition until the last source expires
    let overlapState = buildGameState(sharedCampaign);
    let victimId: EntityId;
    [overlapState, victimId] = spawnEntity(overlapState, 'goblin', pos.x + 1, pos.y);
    overlapState = setDnD35EntityData(overlapState, victimId, {
      ...getDnD35EntityData(overlapState, victimId),
      conditions: ['blinded']
    });
    overlapState = applyStatusEffect(overlapState, victimId, 'spell:glitterdust', 2, playerId, undefined, {
      polarity: 'debuff',
      linkedConditionId: 'blinded'
    });
    overlapState = applyStatusEffect(overlapState, victimId, 'spell:other_blind', 4, playerId, undefined, {
      polarity: 'debuff',
      linkedConditionId: 'blinded'
    });
    overlapState = advanceActorStatusEffectsByTurns(overlapState, victimId, 2);
    expect(getDnD35EntityData(overlapState, victimId).conditions).toContain('blinded');
    overlapState = advanceActorStatusEffectsByTurns(overlapState, victimId, 2);
    expect(getDnD35EntityData(overlapState, victimId).conditions).not.toContain('blinded');

    expect(classifyEffectPolarity([])).toBe('neutral');
    expect(formatSpellModifiersSummary([], { grantedTags: ['weapon:magic'] })).toBe('Magic Weapon');
  });
});
