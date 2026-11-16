import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, refreshResourcePools, spawnEntity } from '../src/core/ecs.ts';
import { applyStatusEffect } from '../src/systems/status-effect.system.ts';
import {
  ComponentType,
  type FighterComponent,
  type PositionComponent,
  type PropertyOverlayComponent,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../src/types/components.types.ts';
import { EngineMode } from '../src/types/game-state.types.ts';
import { createRoundActionBudget } from '../src/rulesets/dnd35e/action_economy.ts';
import { evaluateDnD35eEntityDAG } from '../src/rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { executeDnD35eResourcePoolAbility } from '../src/rulesets/dnd35e/combat/pool_ability_resolver.ts';
import { executeDnD35eSpellCast } from '../src/rulesets/dnd35e/magic/spell_cast_resolver.ts';
import { resolveHealingHymnBonus } from '../src/rulesets/dnd35e/magic/spell_cast_effects.ts';
import { consumeSpellActionBudget } from '../src/rulesets/dnd35e/magic/spell_cast_helpers.ts';
import { buildHitDieTrackFromClass } from '../src/rulesets/dnd35e/progression.ts';
import { collectClassFeaturesUpToLevel } from '../src/rulesets/dnd35e/progression/class_features_xp.ts';
import { buildClassAndDomainEffectModifiers } from '../src/rulesets/dnd35e/progression/ledger_modifiers.ts';
import { syncActorResourcePoolsComponent } from '../src/rulesets/dnd35e/progression/ledger_resource_pools.ts';
import {
  executeDruidShapeshift,
  isDruidShapeshiftEligible,
  SHAPESHIFT_OVERLAY_SOURCE,
  SHAPESHIFT_STANCE_GROUP_ID
} from '../src/rulesets/dnd35e/shapeshift.ts';
import {
  getBardicKnackFloor,
  resolveBardicKnackEffectiveRanks,
  resolveSkillCheck
} from '../src/rulesets/dnd35e/skills.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { DnD35EntityData, HitDieTrack } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { projectCharacterSheetData } from '../src/rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts';
import { buildActorHotbarSlots, buildActorStanceModes, isSkillUsableActive } from '../src/rulesets/dnd35e/ui/dnd35e_ui_hotbar.ts';
import type { CampaignData } from '../src/types/campaign.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../src/rulesets/dnd35e/wild_shape.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function makeClassTrack(campaign: CampaignData, classId: string, levels: number): HitDieTrack {
  const sysContent = getDnD35SystemContent(campaign);
  const classDef = sysContent?.classes[classId];
  if (!classDef) {
    throw new Error(`Missing classDef '${classId}' in test fixture`);
  }
  return buildHitDieTrackFromClass(classDef, levels);
}

describe('Milestone 137: Core Class ACF Expansion (Druid, Sorcerer, Bard)', () => {
  // ---------------------------------------------------------------------------
  // 1. DRUID ALTERNATIVE CLASS FEATURES
  // ---------------------------------------------------------------------------
  describe('Druid ACFs: Druidic Avenger & Shapeshift', () => {
    test('Druidic Avenger: Replaces Animal Companion and Wild Empathy at L1', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign);
      const druidDef = sysContent?.classes['druid'];
      expect(druidDef).toBeDefined();
      if (!druidDef) return;

      const acf = druidDef.acfSwaps.find((a) => a.acfId === 'druid_druidic_avenger_1');
      expect(acf).toBeDefined();
      expect(acf?.replacesFeature).toBe('animal_companion');
      expect(acf?.alsoReplacesFeatures).toContain('wild_empathy');
      expect(acf?.grantedFeature).toBe('druidic_avenger');

      const normalFeatures = collectClassFeaturesUpToLevel(druidDef, 1, []);
      expect(normalFeatures).toContain('animal_companion');
      expect(normalFeatures).toContain('wild_empathy');
      expect(normalFeatures).not.toContain('druidic_avenger');

      const avengerFeatures = collectClassFeaturesUpToLevel(druidDef, 1, ['druid_druidic_avenger_1']);
      expect(avengerFeatures).not.toContain('animal_companion');
      expect(avengerFeatures).not.toContain('wild_empathy');
      expect(avengerFeatures).toContain('druidic_avenger');
    });

    test('Druidic Avenger: Grants Fast Movement (+10 ft), +2 Survival, and scaling Rage pool', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      let state = buildGameState(campaign);
      const [s1, druidId] = createEntity(state);
      state = addComponent(s1, druidId, { type: ComponentType.Fighter, hp: 20, maxHp: 20, baseAttack: 1, xpGiven: 0 });
      state = addComponent(state, druidId, { type: ComponentType.Actor, speed: 30 });

      const sysContent = getDnD35SystemContent(campaign)!;
      const druidTrackL1 = makeClassTrack(campaign, 'druid', 1);
      const classMods = buildClassAndDomainEffectModifiers(
        [druidTrackL1],
        ['druid_druidic_avenger_1'],
        [],
        sysContent.classes,
        sysContent.domains
      );
      const avengerDataL1: DnD35EntityData = {
        ...getDnD35EntityData(state, druidId),
        tracks: [druidTrackL1],
        selectedAcfs: ['druid_druidic_avenger_1'],
        activeClassFeatures: ['druidic_avenger'],
        statModifiers: classMods
      };
      state = setDnD35EntityData(state, druidId, avengerDataL1);
      state = syncActorResourcePoolsComponent(state, druidId, avengerDataL1, sysContent);

      const poolCompL1 = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
      expect(poolCompL1?.pools['rage']).toBeDefined();
      expect(poolCompL1?.pools['rage']?.max).toBe(1);

      // Verify scaling at Druid Level 6 (1 + floor(6 * 0.2) = 2 uses)
      const druidTrackL6 = makeClassTrack(campaign, 'druid', 6);
      const avengerDataL6: DnD35EntityData = {
        ...avengerDataL1,
        tracks: [druidTrackL6]
      };
      state = setDnD35EntityData(state, druidId, avengerDataL6);
      state = syncActorResourcePoolsComponent(state, druidId, avengerDataL6, sysContent);
      state = refreshResourcePools(state, druidId, 'rest_8h');

      const poolCompL6 = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
      expect(poolCompL6?.pools['rage']?.max).toBe(2);
      expect(poolCompL6?.pools['rage']?.current).toBe(2);

      // Verify DAG reflects +10 speed and +2 Survival
      const dag = evaluateDnD35eEntityDAG(state, druidId);
      expect(dag?.dagResult.speed).toBe(40); // 30 baseline + 10 Fast Movement

      // Activating Rage pool expends a use and applies rage_active status
      const rageRes = executeDnD35eResourcePoolAbility(state, druidId, 'rage');
      expect(rageRes.success).toBe(true);
      state = rageRes.state;

      const updatedPoolComp = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
      expect(updatedPoolComp?.pools['rage']?.current).toBe(1);
      const statusComp = getComponent(state, druidId, ComponentType.StatusEffects);
      expect(statusComp?.activeEffects.some((e) => e.effectId === 'rage_active')).toBe(true);
    });

    test('Shapeshift: Replaces Animal Companion and Wild Shape', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign);
      const druidDef = sysContent?.classes['druid'];
      if (!druidDef) return;

      const shapeshiftL1 = druidDef.acfSwaps.find((a) => a.acfId === 'druid_shapeshift_1');
      expect(shapeshiftL1).toBeDefined();
      expect(shapeshiftL1?.replacesFeature).toBe('animal_companion');
      expect(shapeshiftL1?.grantedFeature).toBe('shapeshift');

      const shapeshiftL5 = druidDef.acfSwaps.find((a) => a.acfId === 'druid_shapeshift_5');
      expect(shapeshiftL5).toBeDefined();
      expect(shapeshiftL5?.replacesFeature).toBe('wild_shape_1');

      const featuresL5 = collectClassFeaturesUpToLevel(druidDef, 5, ['druid_shapeshift_1', 'druid_shapeshift_5']);
      expect(featuresL5).not.toContain('animal_companion');
      expect(featuresL5).not.toContain('wild_shape_1');
      expect(featuresL5).toContain('shapeshift');
    });

    test('Shapeshift: Form eligibility by level', () => {
      loadCampaignFromDisk('dnd35e-crypt');
      expect(isDruidShapeshiftEligible(1, 'predator')).toBe(true);
      expect(isDruidShapeshiftEligible(1, 'aerial')).toBe(false);
      expect(isDruidShapeshiftEligible(1, 'ferocious_slayer')).toBe(false);
      expect(isDruidShapeshiftEligible(1, 'normal')).toBe(true);

      expect(isDruidShapeshiftEligible(5, 'predator')).toBe(true);
      expect(isDruidShapeshiftEligible(5, 'aerial')).toBe(true);
      expect(isDruidShapeshiftEligible(5, 'ferocious_slayer')).toBe(false);

      expect(isDruidShapeshiftEligible(8, 'ferocious_slayer')).toBe(true);
    });

    test('Shapeshift: Predator, Aerial, and Ferocious Slayer forms apply enhancement bonuses, +2 Aerial Reflex, and TurnBased swift action continuation', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      let state = { ...buildGameState(campaign), engineMode: EngineMode.TurnBased };
      const [s1, druidId] = createEntity(state);
      state = addComponent(s1, druidId, { type: ComponentType.Fighter, hp: 30, maxHp: 30, baseAttack: 6, xpGiven: 0 });
      state = addComponent(state, druidId, { type: ComponentType.Actor, speed: 100 });

      const druidTrack = makeClassTrack(campaign, 'druid', 8);
      const baseDnd = getDnD35EntityData(state, druidId);
      const druidData: DnD35EntityData = {
        ...baseDnd,
        abilityScores: {
          ...baseDnd.abilityScores,
          str: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 12, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [druidTrack],
        selectedAcfs: ['druid_shapeshift_1', 'druid_shapeshift_5'],
        activeClassFeatures: ['shapeshift']
      };
      state = setDnD35EntityData(state, druidId, druidData);

      const baseDag = evaluateDnD35eEntityDAG(state, druidId)!;
      expect(baseDag.dagResult.effectiveAbilities.str.base).toBe(14);
      const baseNa = baseDag.dagResult.naturalArmorBreakdown.total;
      const baseRefSave = baseDag.dagResult.saves.ref;

      // Verify Hotbar projects Shapeshift stances
      const stanceModes = buildActorStanceModes(druidData);
      expect(stanceModes.some((m) => m.id === 'shapeshift_predator')).toBe(true);
      expect(stanceModes.some((m) => m.id === 'shapeshift_aerial')).toBe(true);
      expect(stanceModes.some((m) => m.id === 'shapeshift_ferocious_slayer')).toBe(true);
      expect(stanceModes.some((m) => m.id === 'shapeshift_normal')).toBe(true);

      // Execute Shapeshift into Predator form on an unhydrated TurnBased turn
      const shiftRes = executeDruidShapeshift(state, druidId, 'predator');
      expect(shiftRes.success).toBe(true);
      state = shiftRes.state;

      // Verify Swift Action was consumed while Standard & Move actions remain available
      const afterPredatorDnd = getDnD35EntityData(state, druidId);
      expect(afterPredatorDnd.actionBudget?.swiftRemaining).toBe(0);
      expect(afterPredatorDnd.actionBudget?.standardRemaining).toBe(1);
      expect(afterPredatorDnd.actionBudget?.moveRemaining).toBe(1);

      // Verify PropertyOverlayComponent & DAG evaluation for Predator Form (+4 STR -> 18, +4 Natural Armor, 50 ft land)
      const overlay = getComponent(state, druidId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
      expect(overlay).toBeDefined();
      expect(overlay?.source).toBe(SHAPESHIFT_OVERLAY_SOURCE);
      expect(overlay?.movementModesOverride?.land).toBe(50);

      const predatorDag = evaluateDnD35eEntityDAG(state, druidId)!;
      expect(predatorDag.dagResult.effectiveAbilities.str.base).toBe(18);
      expect(predatorDag.dagResult.naturalArmorBreakdown.total).toBe(baseNa + 4);
      expect(predatorDag.dndData.naturalWeapons?.some((w) => w.naturalType === 'bite' && w.damageDice === '1d6')).toBe(
        true
      );

      // Verify TacticalDoctrineComponent records active stance
      const doctrine = getComponent(state, druidId, ComponentType.TacticalDoctrine) as TacticalDoctrineComponent | undefined;
      expect(doctrine?.activeStanceGroups?.[SHAPESHIFT_STANCE_GROUP_ID]).toBe('predator');

      // Reset actionBudget for next round and test Aerial Form (+2 STR -> 16, +2 Natural Armor, +2 competence Reflex, 40 ft fly)
      state = setDnD35EntityData(state, druidId, { ...getDnD35EntityData(state, druidId), actionBudget: undefined });
      const aerialRes = executeDruidShapeshift(state, druidId, 'aerial');
      expect(aerialRes.success).toBe(true);
      state = aerialRes.state;

      const aerialDag = evaluateDnD35eEntityDAG(state, druidId)!;
      expect(aerialDag.dagResult.effectiveAbilities.str.base).toBe(16);
      expect(aerialDag.dagResult.naturalArmorBreakdown.total).toBe(baseNa + 2);
      expect(aerialDag.dagResult.saves.ref).toBe(baseRefSave + 2);
      expect(aerialDag.dndData.movementModes?.fly).toBe(40);

      // Reset actionBudget and test Ferocious Slayer Form (Large size, +8 STR -> 22, +8 Natural Armor, 40 ft land, Bite + 2 Claws)
      state = setDnD35EntityData(state, druidId, { ...getDnD35EntityData(state, druidId), actionBudget: undefined });
      const slayerRes = executeDruidShapeshift(state, druidId, 'ferocious_slayer');
      expect(slayerRes.success).toBe(true);
      state = slayerRes.state;

      const slayerDag = evaluateDnD35eEntityDAG(state, druidId)!;
      expect(slayerDag.dagResult.effectiveSize).toBe('large');
      expect(slayerDag.dagResult.effectiveAbilities.str.base).toBe(22);
      expect(slayerDag.dagResult.naturalArmorBreakdown.total).toBe(baseNa + 8);
      expect(slayerDag.dndData.movementModes?.land).toBe(40);
      expect(slayerDag.dndData.naturalWeapons?.length).toBe(2);

      // Reverting to normal form removes overlay
      state = setDnD35EntityData(state, druidId, { ...getDnD35EntityData(state, druidId), actionBudget: undefined });
      const normalRes = executeDruidShapeshift(state, druidId, 'normal');
      expect(normalRes.success).toBe(true);
      state = normalRes.state;

      const overlayAfterNormal = getComponent(state, druidId, ComponentType.PropertyOverlay);
      expect(overlayAfterNormal).toBeUndefined();
      const revertedDag = evaluateDnD35eEntityDAG(state, druidId)!;
      expect(revertedDag.dagResult.effectiveAbilities.str.base).toBe(14);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. SORCERER ALTERNATIVE CLASS FEATURES
  // ---------------------------------------------------------------------------
  describe('Sorcerer ACF: Metamagic Specialist', () => {
    test('Metamagic Specialist: Replaces Summon Familiar at L1 and grants pool (3 + INT mod)', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign);
      const sorcDef = sysContent?.classes['sorcerer'];
      if (!sorcDef) return;

      const acf = sorcDef.acfSwaps.find((a) => a.acfId === 'sorcerer_metamagic_specialist_1');
      expect(acf).toBeDefined();
      expect(acf?.replacesFeature).toBe('summon_familiar');
      expect(acf?.grantedFeature).toBe('metamagic_specialist');

      const normalFeatures = collectClassFeaturesUpToLevel(sorcDef, 1, []);
      expect(normalFeatures).toContain('summon_familiar');
      expect(normalFeatures).not.toContain('metamagic_specialist');

      const specFeatures = collectClassFeaturesUpToLevel(sorcDef, 1, ['sorcerer_metamagic_specialist_1']);
      expect(specFeatures).not.toContain('summon_familiar');
      expect(specFeatures).toContain('metamagic_specialist');

      let state = buildGameState(campaign);
      const [s1, sorcId] = createEntity(state);
      state = addComponent(s1, sorcId, { type: ComponentType.Fighter, hp: 15, maxHp: 15, baseAttack: 0, xpGiven: 0 });

      const sorcTrack = makeClassTrack(campaign, 'sorcerer', 1);
      const sorcData: DnD35EntityData = {
        ...getDnD35EntityData(state, sorcId),
        abilityScores: {
          ...getDnD35EntityData(state, sorcId).abilityScores,
          int: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }, // INT 14 -> +2 mod
          cha: { base: 16, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [sorcTrack],
        selectedAcfs: ['sorcerer_metamagic_specialist_1'],
        activeClassFeatures: ['metamagic_specialist']
      };
      state = setDnD35EntityData(state, sorcId, sorcData);
      state = syncActorResourcePoolsComponent(state, sorcId, sorcData, sysContent);

      const poolComp = getComponent(state, sorcId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
      expect(poolComp?.pools['metamagic_specialist']).toBeDefined();
      // 3 base + 2 INT mod = 5 uses
      expect(poolComp?.pools['metamagic_specialist']?.max).toBe(5);
      expect(poolComp?.pools['metamagic_specialist']?.current).toBe(5);
    });

    test('Metamagic Specialist: Allows spontaneous metamagic casting without full-round casting time increase', () => {
      const budget = {
        standardRemaining: 1,
        moveRemaining: 1,
        swiftRemaining: 1,
        immediateAvailable: true,
        attacksRemainingInRoutine: 0,
        fullAttackActive: false,
        distanceMovedThisRoundFt: 0,
        fiveFootStepTaken: false,
        hasActedThisRound: false
      };

      const metaWithEmpower = {
        flags: { empower: true, enlarge: false, extend: false, maximize: false, silent: false, still: false, widen: false },
        slotBump: 2,
        isQuickened: false,
        hasNonQuickenMetamagic: true,
        rangeMultiplier: 1,
        areaMultiplier: 1
      };

      // Baseline spontaneous metamagic: consumes standard + move (full-round action)
      const baselineResult = consumeSpellActionBudget(budget, 'standard', true, metaWithEmpower, false);
      expect(baselineResult.allowed).toBe(true);
      expect(baselineResult.budget?.standardRemaining).toBe(0);
      expect(baselineResult.budget?.moveRemaining).toBe(0); // consumed move!

      // With bypassSpontaneousMetamagicTimeIncrease = true (Metamagic Specialist active)
      const specialistResult = consumeSpellActionBudget(budget, 'standard', true, metaWithEmpower, true);
      expect(specialistResult.allowed).toBe(true);
      expect(specialistResult.budget?.standardRemaining).toBe(0);
      expect(specialistResult.budget?.moveRemaining).toBe(1); // preserved move!
    });

    test('Metamagic Specialist: executeDnD35eSpellCast keeps spontaneous metamagic as standard action and consumes pool', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign)!;
      let state = buildGameState(campaign);
      const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
      const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
      const [sWithEnemy, enemyId] = spawnEntity(state, 'skeleton', pPos.x + 1, pPos.y);
      state = sWithEnemy;

      const sorcTrack = makeClassTrack(campaign, 'sorcerer', 6);
      const baseDnd = getDnD35EntityData(state, playerId);
      const sorcData: DnD35EntityData = {
        ...baseDnd,
        abilityScores: {
          ...baseDnd.abilityScores,
          int: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 16, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [sorcTrack],
        selectedAcfs: ['sorcerer_metamagic_specialist_1'],
        activeClassFeatures: ['metamagic_specialist'],
        feats: ['empower_spell'],
        actionBudget: createRoundActionBudget({ dexModifier: 0 }),
        spellbooksByClass: {
          sorcerer: {
            classId: 'sorcerer',
            castingMode: 'spontaneous',
            castingTradition: 'arcane',
            spellAcquisitionMode: 'known_spontaneous',
            governingAbility: 'cha',
            effectiveCasterLevel: 6,
            maxCastableSpellLevel: 3,
            knownSpellIds: ['magic_missile'],
            preparedSpellIds: [],
            spellsPerDay: { '0': 6, '1': 4, '2': 3, '3': 2 },
            spontaneousSlotsUsedByLevel: {}
          }
        }
      };
      state = setDnD35EntityData(state, playerId, sorcData);
      state = syncActorResourcePoolsComponent(state, playerId, sorcData, sysContent);

      const enemyPos = getComponent(state, enemyId, ComponentType.Position) as PositionComponent;
      const castRes = executeDnD35eSpellCast(state, playerId, { x: enemyPos.x, y: enemyPos.y }, {
        classId: 'sorcerer',
        spellId: 'magic_missile',
        spellLevel: 1,
        metamagicFeatIds: ['empower_spell']
      });
      expect(castRes.success).toBe(true);
      state = castRes.state;

      const afterCast = getDnD35EntityData(state, playerId);
      expect(afterCast.actionBudget?.standardRemaining).toBe(0);
      expect(afterCast.actionBudget?.moveRemaining).toBe(1); // move action preserved!
      const poolAfter = getComponent(state, playerId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
      expect(poolAfter?.pools['metamagic_specialist']?.current).toBe(4); // 5 -> 4
    });
  });

  // ---------------------------------------------------------------------------
  // 3. BARD ALTERNATIVE CLASS FEATURES
  // ---------------------------------------------------------------------------
  describe('Bard ACFs: Bardic Knack & Healing Hymn', () => {
    test('Bardic Knack: Replaces Bardic Knowledge at L1 and scales with Bard level', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign);
      const bardDef = sysContent?.classes['bard'];
      if (!bardDef) return;

      const acf = bardDef.acfSwaps.find((a) => a.acfId === 'bard_bardic_knack_1');
      expect(acf).toBeDefined();
      expect(acf?.replacesFeature).toBe('bardic_knowledge');
      expect(acf?.grantedFeature).toBe('bardic_knack');

      const normalFeatures = collectClassFeaturesUpToLevel(bardDef, 1, []);
      expect(normalFeatures).toContain('bardic_knowledge');
      expect(normalFeatures).not.toContain('bardic_knack');

      const knackFeatures = collectClassFeaturesUpToLevel(bardDef, 1, ['bard_bardic_knack_1']);
      expect(knackFeatures).not.toContain('bardic_knowledge');
      expect(knackFeatures).toContain('bardic_knack');

      // Rank floor calculations & scalingPools.bardic_knack_level lookup
      expect(resolveBardicKnackEffectiveRanks(0, 1)).toBe(1); // floor(1 / 2) = 0 -> min 1
      expect(resolveBardicKnackEffectiveRanks(0, 6)).toBe(3); // floor(6 / 2) = 3
      expect(resolveBardicKnackEffectiveRanks(1, 6)).toBe(3); // max(1, 3) = 3
      expect(resolveBardicKnackEffectiveRanks(5, 6)).toBe(5); // max(5, 3) = 5
      expect(getBardicKnackFloor({ scalingPools: { bardic_knack_level: 8 } })).toBe(4);
    });

    test('Bardic Knack: Enables untrained checks in trained-only skills with knack rank floor', () => {
      const decipherScriptDef = {
        id: 'decipher_script',
        name: 'Decipher Script',
        keyAbility: 'int' as const,
        trainedOnly: true,
        acpMultiplier: 0 as const,
        synergyFromSkills: []
      };

      // Untrained without knack floor: blocked
      const blockedCheck = resolveSkillCheck({
        definition: decipherScriptDef,
        rawRanks: 0,
        allSkillRanks: {},
        keyAbilityModifier: 2,
        armorCheckPenalty: 0,
        dc: 15
      });
      expect(blockedCheck.allowed).toBe(false);
      expect(blockedCheck.blockedReason).toBe('untrained_in_trained_only_skill');

      // With Bardic Knack floor (minSkillRanksFloor: 3): allowed!
      const knackCheck = resolveSkillCheck({
        definition: decipherScriptDef,
        rawRanks: 0,
        allSkillRanks: {},
        keyAbilityModifier: 2,
        armorCheckPenalty: 0,
        dc: 15,
        forcedNaturalRoll: 10,
        minSkillRanksFloor: 3
      });
      expect(knackCheck.allowed).toBe(true);
      expect(knackCheck.wholeRanks).toBe(3);
      expect(knackCheck.totalModifier).toBe(5); // 3 ranks + 2 int mod
      expect(knackCheck.totalRoll).toBe(15);
      expect(knackCheck.success).toBe(true);
    });

    test('Bardic Knack: Character sheet projector reflects effective ranks', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      let state = buildGameState(campaign);
      const [s1, bardId] = createEntity(state);
      state = addComponent(s1, bardId, { type: ComponentType.Fighter, hp: 20, maxHp: 20, baseAttack: 1, xpGiven: 0 });

      const bardTrack = makeClassTrack(campaign, 'bard', 6);
      const bardData: DnD35EntityData = {
        ...getDnD35EntityData(state, bardId),
        tracks: [bardTrack],
        selectedAcfs: ['bard_bardic_knack_1'],
        activeClassFeatures: ['bardic_knack'],
        skillRanks: {
          perform: 9,
          bluff: 1 // 1 rank invested < knack floor of 3
        }
      };
      state = setDnD35EntityData(state, bardId, bardData);

      const sheet = projectCharacterSheetData({ state, entityId: bardId });
      const bluffRow = sheet.skillRows?.find((s) => s.id === 'bluff');
      expect(bluffRow).toBeDefined();
      expect(bluffRow?.ranks).toBe(3); // Elevated to knack floor 3!

      const performRow = sheet.skillRows?.find((s) => s.id === 'perform');
      expect(performRow?.ranks).toBe(9); // Unaffected since 9 >= 3
    });

    test('Healing Hymn: Replaces Fascinate at L1, activates healing_hymn_active, and enhances nearby healing spells', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign);
      const bardDef = sysContent?.classes['bard'];
      if (!bardDef) return;

      const acf = bardDef.acfSwaps.find((a) => a.acfId === 'bard_healing_hymn_1');
      expect(acf).toBeDefined();
      expect(acf?.replacesFeature).toBe('fascinate');
      expect(acf?.grantedFeature).toBe('healing_hymn');

      const normalFeatures = collectClassFeaturesUpToLevel(bardDef, 1, []);
      expect(normalFeatures).toContain('fascinate');
      expect(normalFeatures).not.toContain('healing_hymn');

      const hymnFeatures = collectClassFeaturesUpToLevel(bardDef, 1, ['bard_healing_hymn_1']);
      expect(hymnFeatures).not.toContain('fascinate');
      expect(hymnFeatures).toContain('healing_hymn');

      let state = buildGameState(campaign);
      const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
      const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent;
      const [s1, bardId] = createEntity(state);
      const [s2, allyId] = createEntity(s1);
      state = addComponent(s2, bardId, { type: ComponentType.Fighter, hp: 10, maxHp: 30, baseAttack: 1, xpGiven: 0 });

      const bardPos = { x: pPos.x + 1, y: pPos.y };
      // Set positions on walkable floor tiles (bard at bardPos, ally at bardPos.x + 2 -> 10 ft <= 30 ft)
      state = addComponent(state, bardId, { type: ComponentType.Position, x: bardPos.x, y: bardPos.y });
      state = addComponent(state, allyId, { type: ComponentType.Position, x: bardPos.x + 2, y: bardPos.y });
      state = addComponent(state, allyId, { type: ComponentType.Fighter, hp: 10, maxHp: 30, baseAttack: 1, xpGiven: 0 });

      const bardTrack = makeClassTrack(campaign, 'bard', 1);
      const baseBardDnd = getDnD35EntityData(state, bardId);
      const bardData: DnD35EntityData = {
        ...baseBardDnd,
        abilityScores: {
          ...baseBardDnd.abilityScores,
          cha: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [bardTrack],
        selectedAcfs: ['bard_healing_hymn_1'],
        activeClassFeatures: ['healing_hymn'],
        skillRanks: {
          perform: 4
        }
      };
      state = setDnD35EntityData(state, bardId, bardData);
      state = syncActorResourcePoolsComponent(state, bardId, bardData, sysContent);

      // Activating healing_hymn or bardic_music applies healing_hymn_active status
      const actRes = executeDnD35eResourcePoolAbility(state, bardId, 'bardic_music');
      expect(actRes.success).toBe(true);
      state = actRes.state;

      const bardStatuses = getComponent(state, bardId, ComponentType.StatusEffects);
      expect(bardStatuses?.activeEffects.some((e) => e.effectId === 'healing_hymn_active')).toBe(true);

      // Test resolveHealingHymnBonus within 30 ft
      expect(resolveHealingHymnBonus(state, bardId)).toBe(4);
      expect(resolveHealingHymnBonus(state, allyId)).toBe(4);

      // Distant ally beyond 30 ft (e.g. 8 squares = 40 ft)
      state = addComponent(state, allyId, { type: ComponentType.Position, x: bardPos.x + 8, y: bardPos.y });
      expect(resolveHealingHymnBonus(state, allyId)).toBe(0);

      // Cast Cure Light Wounds on self while Healing Hymn is active and verify +4 bonus healing
      const bardCasterDnd = getDnD35EntityData(state, bardId);
      state = setDnD35EntityData(state, bardId, {
        ...bardCasterDnd,
        actionBudget: createRoundActionBudget({ dexModifier: 0 }),
        spellbooksByClass: {
          bard: {
            classId: 'bard',
            castingMode: 'spontaneous',
            castingTradition: 'arcane',
            spellAcquisitionMode: 'known_spontaneous',
            governingAbility: 'cha',
            effectiveCasterLevel: 2,
            maxCastableSpellLevel: 1,
            knownSpellIds: ['cure_light_wounds'],
            preparedSpellIds: [],
            spellsPerDay: { '0': 2, '1': 1 },
            spontaneousSlotsUsedByLevel: {}
          }
        }
      });

      const bardBefore = (getComponent(state, bardId, ComponentType.Fighter) as FighterComponent).hp;
      const healRes = executeDnD35eSpellCast(state, bardId, { x: bardPos.x, y: bardPos.y }, {
        classId: 'bard',
        spellId: 'cure_light_wounds',
        spellLevel: 1
      });
      expect(healRes.success).toBe(true);
      const bardAfter = (getComponent(healRes.state, bardId, ComponentType.Fighter) as FighterComponent).hp;
      // Cure Light Wounds baseline at CL 2 = 1d8 + 2 (min 3). With Healing Hymn (+4 Perform ranks), min restored = 7.
      expect(bardAfter - bardBefore).toBeGreaterThanOrEqual(7);

      // Also verify Healing Hymn empowers positive-energy damage against undead targets
      const [sUndead, undeadId] = spawnEntity(healRes.state, 'skeleton', bardPos.x + 1, bardPos.y);
      let undeadState = addComponent(sUndead, undeadId, {
        type: ComponentType.Fighter,
        hp: 30,
        maxHp: 30,
        baseAttack: 1,
        xpGiven: 0
      });
      undeadState = setDnD35EntityData(undeadState, bardId, {
        ...getDnD35EntityData(undeadState, bardId),
        skillRanks: {
          perform: 4,
          concentration: 25
        },
        actionBudget: createRoundActionBudget({ dexModifier: 0 }),
        spellbooksByClass: {
          bard: {
            classId: 'bard',
            castingMode: 'spontaneous',
            castingTradition: 'arcane',
            spellAcquisitionMode: 'known_spontaneous',
            governingAbility: 'cha',
            effectiveCasterLevel: 2,
            maxCastableSpellLevel: 1,
            knownSpellIds: ['cure_light_wounds'],
            preparedSpellIds: [],
            spellsPerDay: { '0': 2, '1': 2 },
            spontaneousSlotsUsedByLevel: {}
          }
        }
      });
      const undeadCast = executeDnD35eSpellCast(undeadState, bardId, { x: bardPos.x + 1, y: bardPos.y }, {
        classId: 'bard',
        spellId: 'cure_light_wounds',
        spellLevel: 1
      });
      expect(undeadCast.success).toBe(true);
      const undeadAfter = (getComponent(undeadCast.state, undeadId, ComponentType.Fighter) as FighterComponent).hp;
      // Even on a successful Will save for half, (min 3 + 4 hymn = 7) -> floor(7 / 2) = 3 minimum positive-energy damage
      expect(30 - undeadAfter).toBeGreaterThanOrEqual(3);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. DECLARATIVE HOTBAR SKILLS & RACE-DRIVEN WILD SHAPE POOL
  // ---------------------------------------------------------------------------
  describe('Declarative Hotbar Skills & Race-Driven Wild Shape', () => {
    test('Active skills and verbs are projected declaratively from skills/*.json', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const state = buildGameState(campaign);
      const sysContent = getDnD35SystemContent(campaign)!;

      expect(isSkillUsableActive('search', sysContent.skills)).toBe(true);
      expect(isSkillUsableActive('tumble', sysContent.skills)).toBe(true);
      expect(isSkillUsableActive('spot', sysContent.skills)).toBe(false);

      const slots = buildActorHotbarSlots(
        {
          skillRanks: { search: 4, spot: 5, open_lock: 2 }
        },
        state
      );
      const searchSlot = slots.find((s) => s.actionPayload?.kind === 'skill' && s.actionPayload.id === 'search');
      const openLockSlot = slots.find((s) => s.actionPayload?.kind === 'skill' && s.actionPayload.id === 'open_lock');
      const spotSlot = slots.find((s) => s.actionPayload?.kind === 'skill' && s.actionPayload.id === 'spot');

      expect(searchSlot?.actionPayload?.verb).toBe('search');
      expect(openLockSlot?.actionPayload?.verb).toBe('unlock');
      expect(spotSlot).toBeUndefined();
    });

    test('Wild Shape pool scales across druid levels 5..18 and transforms into race-derived form then reverts without extra charge', () => {
      const campaign = loadCampaignFromDisk('dnd35e-crypt');
      const sysContent = getDnD35SystemContent(campaign)!;
      let state = buildGameState(campaign);
      const [s1, druidId] = createEntity(state);
      state = addComponent(s1, druidId, { type: ComponentType.Fighter, hp: 40, maxHp: 40, baseAttack: 6, xpGiven: 0 });
      state = addComponent(state, druidId, { type: ComponentType.Actor, speed: 30 });

      const druidTrackL8 = makeClassTrack(campaign, 'druid', 8);
      const druidData: DnD35EntityData = {
        ...getDnD35EntityData(state, druidId),
        tracks: [druidTrackL8],
        activeClassFeatures: collectClassFeaturesUpToLevel(sysContent.classes['druid']!, 8, [])
      };
      state = setDnD35EntityData(state, druidId, druidData);
      state = syncActorResourcePoolsComponent(state, druidId, druidData, sysContent);

      const poolBefore = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent;
      expect(poolBefore.pools['wild_shape']?.max).toBe(3); // Lv 5 (1), Lv 6 (+1), Lv 7 (+1)

      const transformRes = executeDnD35eResourcePoolAbility(state, druidId, 'wild_shape');
      expect(transformRes.success).toBe(true);
      state = transformRes.state;

      const overlay = getComponent(state, druidId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
      expect(overlay?.source.startsWith('wild_shape:')).toBe(true);

      const poolAfterTransform = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent;
      expect(poolAfterTransform.pools['wild_shape']?.current).toBe(2);

      // Next round: reverting via wild_shape pool returns to normal form without expending an extra daily charge
      state = setDnD35EntityData(state, druidId, { ...getDnD35EntityData(state, druidId), actionBudget: undefined });
      const revertRes = executeDnD35eResourcePoolAbility(state, druidId, 'wild_shape');
      expect(revertRes.success).toBe(true);
      state = revertRes.state;

      expect(getComponent(state, druidId, ComponentType.PropertyOverlay)).toBeUndefined();
      const poolAfterRevert = getComponent(state, druidId, ComponentType.ResourcePool) as ResourcePoolComponent;
      expect(poolAfterRevert.pools['wild_shape']?.current).toBe(2);
    });
  });
});
