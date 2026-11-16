import { describe, expect, it } from 'bun:test';
import { addComponent, getComponent } from '../src/core/ecs.ts';
import { applyIntentWithCost } from '../src/core/loop/intent_cost_resolver.ts';
import { executeEightHourRest } from '../src/rendering/ui/dnd35e_spellbook_actions.ts';
import { applyCharacterCreationToPlayer } from '../src/rulesets/dnd35e/builder/builder_hydrator_creation.ts';
import {
  canPrepareSpellInDomainSlot,
  collectActorDomainSpellIds,
  computeClassLevelSlotSummaries,
  getSpontaneousConversionTargets,
  isActorDomainSpellAtLevel,
  reconcilePreparedSlots
} from '../src/rulesets/dnd35e/magic/spellbook_slots.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import type { DnD35ClassSpellbookState, DnD35EntityData } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';
import type { DnD35SystemContent } from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { EngineMode } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

describe('D&D 3.5e Spellbook Slot & Spontaneous Casting Engine', () => {
  const mockSystemContent: DnD35SystemContent = {
    classes: {
      cleric: {
        id: 'cleric',
        name: 'Cleric',
        hitDieSides: 8,
        babCurve: 'medium',
        fortCurve: 'good',
        refCurve: 'poor',
        willCurve: 'good',
        skillPointsPerLevel: 2,
        classSkillIds: ['concentration', 'heal'],
        weaponProficiencyIds: ['simple'],
        armorProficiencyIds: ['light', 'medium', 'heavy', 'shield'],
        spellcasting: {
          governingAbility: 'wis',
          castingMode: 'prepared',
          castingTradition: 'divine',
          spellAcquisitionMode: 'prayerbook_full_list'
        },
        progression: [
          {
            level: 1,
            bab: 0,
            fortSave: 2,
            refSave: 0,
            willSave: 2,
            features: ['turn_undead', 'spontaneous_casting'],
            spellsPerDay: { '0': 3, '1': 1 },
            domainSpellSlots: { '1': 1 }
          }
        ]
      },
      wizard: {
        id: 'wizard',
        name: 'Wizard',
        hitDieSides: 4,
        babCurve: 'poor',
        fortCurve: 'poor',
        refCurve: 'poor',
        willCurve: 'good',
        skillPointsPerLevel: 2,
        classSkillIds: ['concentration', 'spellcraft'],
        weaponProficiencyIds: ['simple'],
        armorProficiencyIds: [],
        spellcasting: {
          governingAbility: 'int',
          castingMode: 'prepared',
          castingTradition: 'arcane',
          spellAcquisitionMode: 'spellbook_scribed'
        },
        progression: [
          {
            level: 1,
            bab: 0,
            fortSave: 0,
            refSave: 0,
            willSave: 2,
            features: ['summon_familiar', 'scribe_scroll'],
            spellsPerDay: { '0': 3, '1': 1 }
          }
        ]
      }
    },
    domains: {
      war: {
        id: 'war',
        name: 'War Domain',
        grantedFeatIds: [],
        grantedSpells: { '1': 'magic_weapon' }
      }
    },
    spells: {},
    skills: {},
    feats: {},
    races: {},
    templates: {},
    items: {}
  } as unknown as DnD35SystemContent;

  it('computes Level 0 and 1 slots for a 1st-level Cleric with 14 WIS (+2 mod) and War Domain', () => {
    const book: DnD35ClassSpellbookState = {
      classId: 'cleric',
      castingMode: 'prepared',
      castingTradition: 'divine',
      spellAcquisitionMode: 'prayerbook_full_list',
      governingAbility: 'wis',
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['cure_light_wounds', 'bless', 'guidance'],
      preparedSpellIds: [],
      spellsPerDay: { '0': 3, '1': 1 },
      domainSpellSlots: { '1': 1 }
    };

    const dndData: Partial<DnD35EntityData> = {
      tracks: [
        {
          trackId: 'cleric',
          levels: 1,
          babCurve: 'medium',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'good',
          skillPointsPerLevel: 2
        }
      ],
      domains: ['war']
    };

    const abilities = {
      wis: { base: 14 }
    } as unknown as DnD35EntityData['abilityScores'];

    const summaries = computeClassLevelSlotSummaries(book, dndData, abilities, mockSystemContent);
    const lv0 = summaries.find((s) => s.spellLevel === 0)!;
    const lv1 = summaries.find((s) => s.spellLevel === 1)!;

    // Lv 0: Base 3, 0 bonus slots = 3 slots
    expect(lv0.baseSlots).toBe(3);
    expect(lv0.bonusSlots).toBe(0);
    expect(lv0.generalSlots).toBe(3);
    expect(lv0.domainSlots).toBe(0);
    expect(lv0.totalSlots).toBe(3);

    // Lv 1: Base 1, +1 bonus from 14 WIS, +1 domain slot = 3 slots total
    expect(lv1.baseSlots).toBe(1);
    expect(lv1.bonusSlots).toBe(1);
    expect(lv1.generalSlots).toBe(2);
    expect(lv1.domainSlots).toBe(1);
    expect(lv1.totalSlots).toBe(3);

    const reconciled = reconcilePreparedSlots(book, summaries);
    expect(reconciled.filter((s) => s.spellLevel === 0).length).toBe(3);
    expect(reconciled.filter((s) => s.spellLevel === 1 && s.slotKind === 'general').length).toBe(2);
    expect(reconciled.filter((s) => s.spellLevel === 1 && s.slotKind === 'domain').length).toBe(1);
  });

  it('seeds initial general slots from preparedSpellIds when preparedSlots is uninitialized', () => {
    const book: DnD35ClassSpellbookState = {
      classId: 'cleric',
      castingMode: 'prepared',
      castingTradition: 'divine',
      spellAcquisitionMode: 'prayerbook_full_list',
      governingAbility: 'wis',
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['cure_minor_wounds', 'guidance', 'bless'],
      preparedSpellIds: ['cure_minor_wounds', 'bless'],
      spellsPerDay: { '0': 3, '1': 1 },
      domainSpellSlots: { '1': 1 }
    };

    const dndData: Partial<DnD35EntityData> = {
      tracks: [
        {
          trackId: 'cleric',
          levels: 1,
          babCurve: 'medium',
          fortCurve: 'good',
          refCurve: 'poor',
          willCurve: 'good',
          skillPointsPerLevel: 2
        }
      ],
      domains: ['war']
    };

    const abilities = {
      wis: { base: 14 }
    } as unknown as DnD35EntityData['abilityScores'];

    const summaries = computeClassLevelSlotSummaries(book, dndData, abilities, mockSystemContent);
    const reconciled = reconcilePreparedSlots(book, summaries, {
      cure_minor_wounds: { levelByClass: { cleric: 0 } },
      bless: { levelByClass: { cleric: 1 } }
    });

    const lv0Gen0 = reconciled.find((s) => s.slotId === 'lv0_gen_0');
    const lv1Gen0 = reconciled.find((s) => s.slotId === 'lv1_gen_0');
    const lv1Gen1 = reconciled.find((s) => s.slotId === 'lv1_gen_1');

    expect(lv0Gen0?.preparedSpellId).toBe('cure_minor_wounds');
    expect(lv1Gen0?.preparedSpellId).toBe('bless');
    expect(lv1Gen1?.preparedSpellId).toBeUndefined();
  });

  it('computes Wizard specialist slot for an Evoker with 16 INT', () => {
    const book: DnD35ClassSpellbookState = {
      classId: 'wizard',
      castingMode: 'prepared',
      castingTradition: 'arcane',
      spellAcquisitionMode: 'spellbook_scribed',
      governingAbility: 'int',
      effectiveCasterLevel: 1,
      maxCastableSpellLevel: 1,
      knownSpellIds: ['magic_missile'],
      preparedSpellIds: [],
      spellsPerDay: { '0': 3, '1': 1 }
    };

    const dndData: Partial<DnD35EntityData> = {
      tracks: [
        {
          trackId: 'wizard',
          levels: 1,
          babCurve: 'poor',
          fortCurve: 'poor',
          refCurve: 'poor',
          willCurve: 'good',
          skillPointsPerLevel: 2
        }
      ],
      arcaneSchool: 'evocation'
    };

    const abilities = {
      int: { base: 16 }
    } as unknown as DnD35EntityData['abilityScores'];

    const summaries = computeClassLevelSlotSummaries(book, dndData, abilities, mockSystemContent);
    const lv1 = summaries.find((s) => s.spellLevel === 1)!;

    // Lv 1: Base 1, +1 bonus from 16 INT, +1 specialist slot = 3 slots
    expect(lv1.baseSlots).toBe(1);
    expect(lv1.bonusSlots).toBe(1);
    expect(lv1.generalSlots).toBe(2);
    expect(lv1.specialistSlots).toBe(1);
    expect(lv1.totalSlots).toBe(3);
  });

  it('returns spontaneous conversion options for Cleric (Cure Wounds) and Spontaneous Domain Casting (PHB II p. 37)', () => {
    const dndData: Partial<DnD35EntityData> = {
      alignment: 'LG'
    };

    const targets = getSpontaneousConversionTargets('cleric', 1, dndData, mockSystemContent);
    expect(targets.length).toBe(1);
    expect(targets[0]!.spellId).toBe('cure_light_wounds');

    // Load full system content from disk to test Spontaneous Domain Casting (PHB II p. 37)
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const sys = campaign.systemContent as unknown as DnD35SystemContent;
    const domainCastCleric: Partial<DnD35EntityData> = {
      alignment: 'LG',
      domains: ['good', 'war'],
      spontaneousDomainId: 'war',
      selectedAcfs: ['cleric_domain_spontaneity_1'],
      activeClassFeatures: ['domain_spontaneity']
    };

    // Converts only into the chosen War domain (not Good domain), and includes lower-level War domain spells at L2
    const lv1Targets = getSpontaneousConversionTargets('cleric', 1, domainCastCleric, sys);
    expect(lv1Targets.map((t) => t.spellId)).toEqual(['magic_weapon']);

    const lv2Targets = getSpontaneousConversionTargets('cleric', 2, domainCastCleric, sys);
    expect(lv2Targets.map((t) => t.spellId)).toEqual(['spiritual_weapon', 'magic_weapon']);

    // Allows preparing Cure Wounds spells into domain slots when Spontaneous Domain Casting is active
    expect(canPrepareSpellInDomainSlot('cure_light_wounds', sys.spells?.['cure_light_wounds'], 1, domainCastCleric, sys, 'cleric')).toBe(true);
    expect(canPrepareSpellInDomainSlot('inflict_light_wounds', sys.spells?.['inflict_light_wounds'], 1, domainCastCleric, sys, 'cleric')).toBe(false);

    // Standard LG Cleric with Good + War (neither of which grants Cure Light Wounds at L1) cannot prepare Cure Light Wounds in a domain slot
    const standardCleric: Partial<DnD35EntityData> = {
      alignment: 'LG',
      domains: ['good', 'war'],
      activeClassFeatures: ['spontaneous_casting']
    };
    expect(canPrepareSpellInDomainSlot('cure_light_wounds', sys.spells?.['cure_light_wounds'], 1, standardCleric, sys, 'cleric')).toBe(false);
  });

  it('resolves domain spells across 3+ domains from both domainSpells and levelByDomain', () => {
    const domains = {
      healing: { domainSpells: { '1': 'cure_light_wounds', '2': 'cure_moderate_wounds' } },
      sun: { domainSpells: { '1': 'endure_elements', '2': 'heat_metal' } },
      travel: { domainSpells: { '1': 'longstrider', '2': 'locate_object' } }
    };
    const spells = {
      cure_light_wounds: { id: 'cure_light_wounds', levelByDomain: {} },
      endure_elements: { id: 'endure_elements', levelByDomain: {} },
      longstrider: { id: 'longstrider', levelByDomain: {} },
      searing_light: { id: 'searing_light', levelByDomain: { sun: 3 } }
    };
    const actorDomains = ['healing', 'sun', 'travel'];

    expect(isActorDomainSpellAtLevel('cure_light_wounds', spells.cure_light_wounds, 1, actorDomains, domains)).toBe(true);
    expect(isActorDomainSpellAtLevel('endure_elements', spells.endure_elements, 1, actorDomains, domains)).toBe(true);
    expect(isActorDomainSpellAtLevel('longstrider', spells.longstrider, 1, actorDomains, domains)).toBe(true);
    expect(isActorDomainSpellAtLevel('searing_light', spells.searing_light, 3, actorDomains, domains)).toBe(true);

    const collected = collectActorDomainSpellIds(actorDomains, domains, spells, 3);
    expect(collected).toContain('cure_light_wounds');
    expect(collected).toContain('endure_elements');
    expect(collected).toContain('longstrider');
    expect(collected).toContain('searing_light');
  });

  it('executes Turn Undead pool ability with Standard Action + charge cost and refreshes on 8-hour rest', () => {
    const campaign = loadCampaignFromDisk('dnd35e-crypt');
    const baseState = { ...buildGameState(campaign), engineMode: EngineMode.TurnBased };
    const playerId = baseState.entities.find((id) => getComponent(baseState, id, ComponentType.Player) !== undefined)!;
    let clericState = applyCharacterCreationToPlayer(baseState, playerId, {
      raceId: 'human',
      classId: 'cleric',
      alignment: 'lawful_good',
      abilityMethod: 'point_buy',
      pointBuyBudget: 25,
      baseAbilityScores: { str: 14, dex: 10, con: 14, int: 10, wis: 16, cha: 14 },
      selectedAcfs: [],
      domains: ['healing', 'sun'],
      prohibitedSchools: [],
      skillRanks: { concentration: 4, knowledge_religion: 4 },
      selectedFeats: ['extra_turning'],
      knownSpells: [],
      equipmentPackageId: 'cleric_standard'
    });
    const playerPos = getComponent(clericState, playerId, ComponentType.Position)!;
    // Place an adjacent hostile undead creature within 60 ft LoE
    const undeadId = clericState.entities.find((id) => {
      if (id === playerId) return false;
      const dnd = getDnD35EntityData(clericState, id);
      return dnd.creatureType === 'undead' || dnd.raceId?.includes('skeleton') || dnd.raceId?.includes('zombie');
    });
    if (undeadId !== undefined) {
      clericState = addComponent(clericState, undeadId, {
        type: ComponentType.Position,
        x: playerPos.x + 1,
        y: playerPos.y
      });
    }

    const poolsBefore = getComponent(clericState, playerId, ComponentType.ResourcePool)!;
    expect(poolsBefore.pools.turn_undead?.current).toBe(9);

    const turnOutcome = applyIntentWithCost(clericState, {
      type: IntentType.UseAbility,
      entityId: playerId,
      effectId: 'pool:turn_undead',
      abilityName: 'Turn Undead'
    });
    expect(turnOutcome.success).toBe(true);
    expect(turnOutcome.energyCost).toBe(0); // Move action still remains in the round
    const afterTurn = turnOutcome.state;
    const poolsAfter = getComponent(afterTurn, playerId, ComponentType.ResourcePool)!;
    expect(poolsAfter.pools.turn_undead?.current).toBe(8);
    expect(getDnD35EntityData(afterTurn, playerId).actionBudget?.standardRemaining).toBe(0);
    expect(getDnD35EntityData(afterTurn, playerId).actionBudget?.hasActedThisRound).toBe(true);

    // Calling again in same round without Standard Action returns success: false without burning another charge
    const blockedRetry = applyIntentWithCost(afterTurn, {
      type: IntentType.UseAbility,
      entityId: playerId,
      effectId: 'pool:turn_undead',
      abilityName: 'Turn Undead'
    });
    expect(blockedRetry.success).toBe(false);
    expect(blockedRetry.energyCost).toBe(0);
    expect(getComponent(blockedRetry.state, playerId, ComponentType.ResourcePool)?.pools.turn_undead?.current).toBe(8);

    // Clear budget and verify 8-hour rest refreshes rest_8h pools
    const preRest = setDnD35EntityData(blockedRetry.state, playerId, {
      ...getDnD35EntityData(blockedRetry.state, playerId),
      actionBudget: undefined
    });
    const afterRest = executeEightHourRest(preRest, playerId);
    expect(getComponent(afterRest, playerId, ComponentType.ResourcePool)?.pools.turn_undead?.current).toBe(9);
  });
});
