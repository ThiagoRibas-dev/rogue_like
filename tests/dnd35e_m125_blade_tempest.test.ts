import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ComponentType } from '../src/types/components.types.ts';
import type { GameState } from '../src/types/game-state.types.ts';
import { createEntity, addComponent } from '../src/core/ecs.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import {
  toggleConsoleStanceGroup,
  resolveActiveStanceInGroup,
  projectConsoleStanceSelfTags,
  canUseTriggeredReactionThisRound,
  incrementTriggeredReactionUse
} from '../src/systems/stance.system.ts';
import { resolveRetaliationRiders } from '../src/rulesets/dnd35e/combat/retaliation_resolver.ts';
import { resolveIterativeSpellStrike } from '../src/rulesets/dnd35e/magic/spell_strike_resolver.ts';
import {
  evaluateActiveSpellAuraContributions,
  resolveAuraFirstEntrySaveAndSr
} from '../src/rulesets/dnd35e/magic/spell_aura_resolver.ts';
import { resolveEffectiveTileIllumination } from '../src/rulesets/dnd35e/spatial/cover_senses.ts';
import { evaluateDnD35ActorStatDAG } from '../src/rulesets/dnd35e/modifiers.ts';
import { DnD35SpellDefinitionSchema, type DnD35SpellDefinition } from '../src/rulesets/dnd35e/types/system/spell_system.types.ts';
import { buildActorStanceModes } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';

describe('Milestone 125 — Console Stance Groups, Retaliation Riders, Mobile Aura Lifecycles & Iterative Spell Strikes', () => {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  const spellsDir = join(process.cwd(), 'public/data/rulesets/dnd35e/spells');

  test('validates blade_tempest_invocation.json against DnD35SpellDefinitionSchema', () => {
    const raw = JSON.parse(
      readFileSync(join(spellsDir, 'blade_tempest_invocation.json'), 'utf-8')
    ) as Record<string, DnD35SpellDefinition>;
    const spell = raw['blade_tempest_invocation']!;
    expect(spell).toBeDefined();

    const result = DnD35SpellDefinitionSchema.safeParse(spell);
    if (!result.success) {
      throw new Error(`Validation failed: ${JSON.stringify(result.error.issues, null, 2)}`);
    }
    expect(result.success).toBe(true);
    expect(spell.level).toBe(5);
    expect(spell.levelByClass['cleric']).toBe(5);
    expect(spell.effectUnits.length).toBe(6);
  });

  test('1. Tier 1 Console Stance Groups: radio exclusivity and semantic tag projection', () => {
    // 1. Initial toggle
    let doctrine = toggleConsoleStanceGroup(undefined, 'battle_cadence', 'flurry_of_steel');
    expect(doctrine.activeStanceGroups?.['battle_cadence']).toBe('flurry_of_steel');

    // 2. Mutual exclusivity: switching to divine_celerity unseats flurry_of_steel
    doctrine = toggleConsoleStanceGroup(doctrine, 'battle_cadence', 'divine_celerity');
    expect(doctrine.activeStanceGroups?.['battle_cadence']).toBe('divine_celerity');

    // 3. Project semantic tags
    const tags = projectConsoleStanceSelfTags(doctrine, [
      {
        groupId: 'battle_cadence',
        stanceId: 'divine_celerity',
        label: 'Divine Celerity',
        grantsSelfTag: 'stance:battle_cadence:divine_celerity'
      }
    ]);
    expect(tags).toContain('stance:battle_cadence:divine_celerity');
    expect(tags).not.toContain('stance:battle_cadence:flurry_of_steel');

    // 4. Stance mode projection for hotbar
    const modes = buildActorStanceModes(
      {
        feats: ['war_domain']
      },
      7,
      doctrine
    );
    expect(modes.some((m) => m.id === 'total_defense')).toBe(true);
  });

  test('2. Target-Side Retaliation Rider: reacts on adjacent melee hit, respects 1/round quota, deals force damage', () => {
    let doctrine = {
      type: ComponentType.TacticalDoctrine,
      powerAttackAmount: 0
    };

    const activeRiders = [
      {
        spellId: 'blade_tempest_invocation',
        castId: 'cast_bt_1',
        casterLevel: 9,
        unit: {
          type: 'retaliation_rider' as const,
          unitId: 'lesser_divine_retaliation',
          targetRole: 'secondary_ally' as const,
          triggerCondition: 'melee_or_spell_adjacent' as const,
          dice: '1d8',
          damageType: 'force' as const,
          bypassesDr: true,
          maxUsesPerRound: 1
        }
      }
    ];

    // Strike 1: Adjacent (dist = 1) -> triggers retaliation dealing 1d8 (forced 6) force damage
    const res1 = resolveRetaliationRiders({
      activeRiders,
      defenderDoctrine: doctrine,
      triggerType: 'melee',
      chebyshevDistanceTiles: 1,
      attackerName: 'Goblin',
      defenderName: 'Fighter Ally',
      forcedDiceTotal: 6
    });

    expect(res1.totalDamageToAttacker).toBe(6);
    expect(res1.logMessages[0]).toContain('strikes Goblin for 6 force damage!');
    expect(canUseTriggeredReactionThisRound(res1.updatedDefenderDoctrine, 'retaliation:blade_tempest_invocation:cast_bt_1:lesser_divine_retaliation', 1)).toBe(false);

    // Strike 2 in same round: quota exhausted (1/round) -> 0 retaliation damage
    const res2 = resolveRetaliationRiders({
      activeRiders,
      defenderDoctrine: res1.updatedDefenderDoctrine,
      triggerType: 'melee',
      chebyshevDistanceTiles: 1,
      attackerName: 'Goblin',
      defenderName: 'Fighter Ally',
      forcedDiceTotal: 8
    });

    expect(res2.totalDamageToAttacker).toBe(0);
    expect(res2.logMessages.length).toBe(0);
  });

  test('3. Isolated Iterative Spell Strike (Spectral Assault): BAB + WIS iteratives, deity favored weapon crit, force damage', () => {
    const rawSpell = JSON.parse(
      readFileSync(join(spellsDir, 'blade_tempest_invocation.json'), 'utf-8')
    ) as Record<string, DnD35SpellDefinition>;
    const spell = rawSpell['blade_tempest_invocation']!;
    const cadenceUnit = spell.effectUnits.find((u) => u.unitId === 'battle_cadence_stances')!;
    if (cadenceUnit.type !== 'stat_bundle') throw new Error('Expected stat_bundle');

    const spectralAct = cadenceUnit.effectBundle.activatedAbilities.find((a) => a.abilityId === 'spectral_assault')!;
    const desc = spectralAct.spellStrike!;
    expect(desc).toBeDefined();

    // Cleric 9 with BAB +6, WIS 18 (+4) -> 2 iterative attacks (+10 / +5)
    // CL 9 deals 1d8 + min(5, floor(9/3)) = 1d8 + 3 force damage
    const result = resolveIterativeSpellStrike({
      descriptor: desc,
      totalBab: 6,
      castingAbilityModifier: 4,
      casterLevel: 9,
      targetFullAC: 14,
      targetTouchAC: 10,
      targetSpellResistance: 15,
      deityFavoredWeaponId: 'longsword',
      itemsRegistry: campaign.items,
      forcedSrRoll: 10, // CL 9 + 10 = 19 >= 15 SR -> penetrates!
      forcedAttackRolls: [10, 10] // Attack 1: 10 + 10 = 20 vs 14 (Hit); Attack 2: 10 + 5 = 15 vs 14 (Hit)
    });

    expect(result.blockedBySpellResistance).toBe(false);
    expect(result.strikes.length).toBe(2);
    expect(result.strikes[0]?.hit).toBe(true);
    expect(result.strikes[1]?.hit).toBe(true);
    expect(result.critThreatMin).toBe(19); // Deity favored weapon longsword = 19-20/x2
    expect(result.critMultiplier).toBe(2);
  });

  test('4. Mobile Emanation Aura & Save Memory: grants buffs to allies and applies Will negates once to Evil foes', () => {
    let state = buildGameState(campaign);

    // Caster at (5, 5) with Blade Tempest aura field
    let casterId: number;
    let allyId: number;
    let evilEnemyId: number;
    [state, casterId] = createEntity(state);
    [state, allyId] = createEntity(state);
    [state, evilEnemyId] = createEntity(state);

    state = addComponent(state, casterId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, casterId, { type: ComponentType.Faction, factionId: 'heroes' });

    state = addComponent(state, allyId, { type: ComponentType.Position, x: 6, y: 5 });
    state = addComponent(state, allyId, { type: ComponentType.Faction, factionId: 'heroes' });

    state = addComponent(state, evilEnemyId, { type: ComponentType.Position, x: 7, y: 5 });
    state = addComponent(state, evilEnemyId, { type: ComponentType.Faction, factionId: 'monsters' });

    // Spawn 30-ft (6-tile radius) field anchored to caster
    let fieldEntityId: number;
    [state, fieldEntityId] = createEntity(state);
    state = addComponent(state, fieldEntityId, { type: ComponentType.Position, x: 5, y: 5 });
    state = addComponent(state, fieldEntityId, {
      type: ComponentType.Field,
      fieldType: 'dim_illumination_aura',
      intensity: 1,
      duration: 10,
      radiusFt: 30,
      anchorEntityId: casterId,
      sourceEntityId: casterId,
      spellId: 'blade_tempest_invocation',
      castId: 'bt_cast_test',
      casterLevel: 9
    });

    // 1. Ally receives Coordinated Host (+1 sacred AC/attack/ref, +10 speed, 60 ft darkvision, +2 flanking) and Lesser Divine Retaliation
    const allyContrib = evaluateActiveSpellAuraContributions(state, allyId, ['alignment:good']);
    expect(allyContrib.darkvisionRangeFt).toBe(60);
    expect(allyContrib.retaliationRiders.length).toBe(1);
    expect(allyContrib.modifiers.some((m) => m.targetStat === 'ac' && m.value === 1)).toBe(true);
    expect(allyContrib.modifiers.some((m) => m.targetStat === 'speed' && m.value === 10)).toBe(true);
    expect(allyContrib.modifiers.some((m) => m.targetStat === 'flanking_attack_bonus' && m.value === 2)).toBe(true);

    // 2. Evil enemy enters aura: first-entry save resolves
    // Enemy passes Will save (forced 18 + 0 >= DC 15) -> outcome is 'saved'
    let saveOutcome: 'saved' | 'failed' | 'sr_blocked';
    [state, saveOutcome] = resolveAuraFirstEntrySaveAndSr(state, fieldEntityId, evilEnemyId, {
      saveDc: 15,
      occupantSaveModifier: 0,
      casterLevel: 9,
      forcedSaveRoll: 18
    });
    expect(saveOutcome).toBe('saved');

    // Because save outcome is 'saved', enemy is immune to Hindered Malice debuff in this aura!
    const enemyContrib = evaluateActiveSpellAuraContributions(state, evilEnemyId, ['alignment:evil']);
    expect(enemyContrib.modifiers.length).toBe(0);
  });

  test('5. Illumination Precedence: Night\'s Battlefield overrides bright light to shadowy, but yields to Darkness', () => {
    let state = buildGameState(campaign);

    // Tile (10, 10) with Blade Tempest field (Level 5 light override -> 'shadowy', yieldsTo: ['darkness'])
    let fieldId: number;
    [state, fieldId] = createEntity(state);
    state = addComponent(state, fieldId, { type: ComponentType.Position, x: 10, y: 10 });
    state = addComponent(state, fieldId, {
      type: ComponentType.Field,
      fieldType: 'dim_illumination_aura',
      intensity: 1,
      duration: 10,
      radiusFt: 30,
      illuminationOverride: {
        level: 'shadowy',
        spellLevel: 5,
        descriptors: ['good', 'light'],
        yieldsToDescriptors: ['darkness', 'daylight']
      }
    });

    // 1. In ambient bright light, Night's Battlefield overrides to shadowy
    const illum1 = resolveEffectiveTileIllumination(state, 10, 10, 'bright');
    expect(illum1).toBe('shadowy');

    // 2. Overlapping magical Darkness field at (10, 10) -> Night's Battlefield yields to darkness!
    let darknessFieldId: number;
    [state, darknessFieldId] = createEntity(state);
    state = addComponent(state, darknessFieldId, { type: ComponentType.Position, x: 10, y: 10 });
    state = addComponent(state, darknessFieldId, {
      type: ComponentType.Field,
      fieldType: 'darkness',
      intensity: 1,
      duration: 5,
      radiusFt: 20,
      illuminationOverride: {
        level: 'darkness',
        spellLevel: 2,
        descriptors: ['darkness'],
        yieldsToDescriptors: []
      }
    });

    const illum2 = resolveEffectiveTileIllumination(state, 10, 10, 'bright');
    expect(illum2).toBe('darkness');
  });

  test('6. Declarative flanking_attack_bonus modifier in DAG: increases flanking bonus from +2 to +4', () => {
    const baseDag = evaluateDnD35ActorStatDAG({
      baseSize: 'medium',
      rawAbilities: {
        str: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        dex: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        con: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      },
      tracks: [],
      statModifiers: []
    });
    expect(baseDag.flankingBonus).toBe(2);

    const buffedDag = evaluateDnD35ActorStatDAG({
      baseSize: 'medium',
      rawAbilities: {
        str: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        dex: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        con: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
        cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
      },
      tracks: [],
      statModifiers: [
        {
          targetStat: 'flanking_attack_bonus',
          value: 2,
          bonusType: 'untyped',
          sourceId: 'spell:blade_tempest_invocation:coordinated_host_flank',
          sourcePath: 'spell:blade_tempest_invocation/coordinated_host/flank',
          origin: 'spell'
        }
      ]
    });
    expect(buffedDag.flankingBonus).toBe(4);
  });
});
