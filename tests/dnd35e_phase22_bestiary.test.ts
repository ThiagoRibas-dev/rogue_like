import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyRaceToActorChassis } from '../src/rulesets/dnd35e/races.ts';
import { applyCreatureTemplate } from '../src/rulesets/dnd35e/templates.ts';
import { advanceMonsterByHitDice } from '../src/rulesets/dnd35e/creature_advancement.ts';
import {
  evaluateGolemMagicInteraction,
  synthesizeElementalArchetype,
  synthesizeTrueDragonArchetype
} from '../src/rulesets/dnd35e/family_synthesizer.ts';
import {
  getDnD35Archetype,
  getDnD35CreatureTypeEngine,
  getDnD35Race,
  getDnD35Subtype,
  getDnD35Template,
  hydrateArchetypeData
} from '../src/rulesets/dnd35e/srd_registry.ts';
import {
  DnD35CreatureTypeEngineSchema,
  DnD35RaceDefinitionSchema,
  DnD35SubtypeDefinitionSchema,
  DnD35TemplateSchema
} from '../src/rulesets/dnd35e/types/dnd35e_system.types.ts';
import {
  buildSizeEffectProviderModifiers,
  classifyModifierOriginLayer,
  computeEffectiveAC,
  evaluateDnD35ActorStatDAG,
  resolveEffectiveSizeCategory,
  resolveTypedModifiers,
  resolveTypedModifiersWithBreakdown
} from '../src/rulesets/dnd35e/modifiers.ts';
import type { StatModifier } from '../src/rulesets/dnd35e/types/dnd35e.types.ts';

function loadModularRulesetRegistry(category: string): Record<string, unknown> {
  const baseDir = resolve(process.cwd(), 'public/data/rulesets/dnd35e');
  const rootJson = JSON.parse(readFileSync(resolve(baseDir, `${category}.json`), 'utf-8')) as Record<string, unknown>;
  const subDir = resolve(baseDir, category);
  const merged: Record<string, unknown> = { ...rootJson };
  for (const file of readdirSync(subDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const entry = JSON.parse(readFileSync(resolve(subDir, file), 'utf-8')) as Record<string, unknown>;
    Object.assign(merged, entry);
  }
  return merged;
}

describe('Phase 22: D&D 3.5e System Content Pillar 1 (Milestones 106-109)', () => {
  // Load modular JSON registries
  const racesRaw = loadModularRulesetRegistry('races');
  const templatesRaw = loadModularRulesetRegistry('templates');
  const creatureTypesRaw = loadModularRulesetRegistry('creature_types');
  const subtypesRaw = loadModularRulesetRegistry('subtypes');

  const mockSystemContent = {
    races: racesRaw,
    templates: templatesRaw,
    creatureTypes: creatureTypesRaw,
    subtypes: subtypesRaw
  };

  describe('Milestone 106: Unified Playable & Monster Races (races/ & races.ts)', () => {
    it('validates all 75 unified SRD races (17 playable, 44 bestiary monsters, 10 True Dragons, 4 Elementals) against DnD35RaceDefinitionSchema', () => {
      const raceIds = Object.keys(racesRaw);
      expect(raceIds.length).toBeGreaterThanOrEqual(75);
      for (const [, race] of Object.entries(racesRaw)) {
        const parsed = DnD35RaceDefinitionSchema.safeParse(race);
        expect(parsed.success).toBe(true);
      }
    });

    it('applies Dwarf racial traits accurately (unencumbered in heavy armor, +2 Con/-2 Cha, +4 dodge vs Giants, +1 atk vs Orcs/Goblins)', () => {
      const dwarfDef = getDnD35Race(mockSystemContent, 'dwarf')!;
      expect(dwarfDef).toBeDefined();

      const basePlayerArchetype = getDnD35Archetype(mockSystemContent, 'player')!;
      const baseEntityData = hydrateArchetypeData(basePlayerArchetype);

      const result = applyRaceToActorChassis(baseEntityData, dwarfDef);
      expect(result.entityData.abilityScores.con.base).toBe(16); // 14 + 2
      expect(result.entityData.abilityScores.cha.base).toBe(8);  // 10 - 2
      expect(result.entityData.movementModes?.land).toBe(20);
      expect(result.entityData.senses?.darkvisionRangeFt).toBe(60);

      // Verify conditional modifiers (+4 dodge vs Giants, +1 atk vs Orcs/Goblinoids) and sourcePath provenance
      const dodgeVsGiants = result.statModifiers.find((m) => m.sourceId.includes('dodge_vs_giants'));
      expect(dodgeVsGiants).toBeDefined();
      expect(dodgeVsGiants?.value).toBe(4);
      expect(dodgeVsGiants?.bonusType).toBe('dodge');
      expect(dodgeVsGiants?.sourcePath).toBe('race:dwarf/trait:dodge_vs_giants');

      const atkVsOrcs = result.statModifiers.find((m) => m.sourceId.includes('attack_vs_orcs'));
      expect(atkVsOrcs).toBeDefined();
      expect(atkVsOrcs?.value).toBe(1);
      expect(atkVsOrcs?.sourcePath).toBe('race:dwarf/trait:attack_vs_orcs_goblinoids');
      expect(result.entityData.subtypes).toContain('trait:unencumbered_speed');
      expect(result.entityData.statModifiers?.length).toBeGreaterThanOrEqual(3);
    });

    it('computes Drow SR (11 + HD) and Bugbear racial HD (3d8) + LA +1 (ECL 4)', () => {
      const drowDef = getDnD35Race(mockSystemContent, 'drow')!;
      const bugbearDef = getDnD35Race(mockSystemContent, 'bugbear')!;

      const basePlayerArchetype = getDnD35Archetype(mockSystemContent, 'player')!;
      const baseEntityData = hydrateArchetypeData(basePlayerArchetype);

      const drowResult = applyRaceToActorChassis(baseEntityData, drowDef);
      expect(drowResult.entityData.spellResistance).toBe(12); // 11 + 1 HD = 12 SR
      expect(drowResult.ecl).toBe(3); // 1 HD + 2 LA = 3 ECL

      const humanoidEngine = getDnD35CreatureTypeEngine(mockSystemContent, 'humanoid');
      const bugbearResult = applyRaceToActorChassis(baseEntityData, bugbearDef, humanoidEngine);
      expect(bugbearResult.entityData.tracks[0]?.levels).toBe(3);
      // basePlayer has 1 fighter HD + 3 Bugbear RHD + 1 LA = 5 ECL
      expect(bugbearResult.ecl).toBe(5);
      expect(bugbearResult.entityData.naturalArmorBonus).toBe(3);
    });
  });

  describe('Milestone 107: Inherited & Acquired Creature Templates (templates/ & templates.ts)', () => {
    it('validates all 13 SRD templates against DnD35TemplateSchema', () => {
      const templateIds = Object.keys(templatesRaw);
      expect(templateIds.length).toBe(13);
      for (const [, t] of Object.entries(templatesRaw)) {
        const parsed = DnD35TemplateSchema.safeParse(t);
        expect(parsed.success).toBe(true);
      }
    });

    it('transforms an Animal into a Magical Beast with Celestial/Fiendish HD-tiered scaling', () => {
      const fiendishTemplate = getDnD35Template(mockSystemContent, 'fiendish')!;
      const direRatArchetype = getDnD35Archetype(mockSystemContent, 'dire_rat')!;
      const direRatData = hydrateArchetypeData(direRatArchetype);

      const fiendishDireRat = applyCreatureTemplate(direRatData, fiendishTemplate);
      expect(fiendishDireRat.creatureType).toBe('magical_beast'); // convertTypeMap animal -> magical_beast
      expect(fiendishDireRat.abilityScores.int.base).toBe(3);      // minimumIntelligence 3
      expect(fiendishDireRat.energyResistance['cold']).toBe(5);
      expect(fiendishDireRat.energyResistance['fire']).toBe(5);
      expect(fiendishDireRat.spellResistance).toBe(6);            // min(25, 5 + 1 HD) = 6
    });

    it('applies the Zombie template accurately (doubled racial HD, strips PC/NPC class HD while keeping racial HD, single actions only)', () => {
      const zombieTemplate = getDnD35Template(mockSystemContent, 'zombie')!;
      const ogreArchetype = getDnD35Archetype(mockSystemContent, 'ogre')!;
      const ogreData = hydrateArchetypeData(ogreArchetype);

      const zombieOgre = applyCreatureTemplate(ogreData, zombieTemplate);
      expect(zombieOgre.creatureType).toBe('undead');
      expect(zombieOgre.tracks[0]?.levels).toBe(8); // Ogre 4 racial HD -> Zombie doubles to 8 HD
      expect(zombieOgre.abilityScores.con.base).toBeNull(); // Undead CON: null
      expect(zombieOgre.abilityScores.int.base).toBeNull(); // Mindless INT: null
      expect(zombieOgre.singleActionsOnly).toBe(true);
      expect(zombieOgre.naturalArmorBonus).toBe(3); // sizeTieredNaturalArmor Large -> 3
      expect(zombieOgre.damageReduction?.amount).toBe(5);
      expect(zombieOgre.damageReduction?.bypassTags).toEqual(['slashing']);
      expect(zombieOgre.naturalWeapons?.some((w) => w.naturalType === 'slam')).toBe(true);

      // Verify Ogre with 4 Giant RHD + 2 Warrior NPC class levels strips Warrior levels and doubles only the 4 Giant RHD -> 8 Zombie HD
      const ogreWarriorData = {
        ...ogreData,
        tracks: [
          ...ogreData.tracks,
          {
            trackId: 'warrior',
            trackCategory: 'npc' as const,
            levels: 2,
            hitDieSides: 8 as const,
            babCurve: 'full' as const,
            fortCurve: 'good' as const,
            refCurve: 'poor' as const,
            willCurve: 'poor' as const,
            skillPointsPerLevel: 2
          }
        ]
      };
      const zombieOgreWarrior = applyCreatureTemplate(ogreWarriorData, zombieTemplate);
      expect(zombieOgreWarrior.tracks.length).toBe(1);
      expect(zombieOgreWarrior.tracks[0]?.levels).toBe(8);

      // Verify class-HD creature (5th-level Fighter with no racial HD) drops class levels to 1 base HD -> 2 Zombie HD
      const fighter5Data = hydrateArchetypeData(getDnD35Archetype(mockSystemContent, 'player')!, 5);
      const zombieFighter = applyCreatureTemplate(fighter5Data, zombieTemplate);
      expect(zombieFighter.tracks[0]?.levels).toBe(2);
    });

    it('applies the Ghost template and emits subtype:incorporeal deflection AC with hierarchical sourcePath', () => {
      const ghostTemplate = getDnD35Template(mockSystemContent, 'ghost')!;
      const playerArchetype = getDnD35Archetype(mockSystemContent, 'player')!;
      const playerData = hydrateArchetypeData(playerArchetype);

      const ghostPlayer = applyCreatureTemplate(playerData, ghostTemplate);
      expect(ghostPlayer.creatureType).toBe('undead');
      expect(ghostPlayer.subtypes).toContain('incorporeal');
      // Base CHA 10 + 4 (Ghost template) = 14 (+2 modifier)
      const deflectionMod = ghostPlayer.statModifiers?.find(
        (m) => m.sourcePath === 'template:ghost/subtype:incorporeal/deflection_ac'
      );
      expect(deflectionMod).toBeDefined();
      expect(deflectionMod?.bonusType).toBe('deflection');
      expect(deflectionMod?.value).toBe(2);
    });

    it('applies the Half-Dragon (Red) template (Dragon type, STR +8, CON +2, NA +4, Claws/Bite, Fire immunity)', () => {
      const halfDragonTemplate = getDnD35Template(mockSystemContent, 'half_dragon_red')!;
      const minotaurArchetype = getDnD35Archetype(mockSystemContent, 'minotaur')!;
      const minotaurData = hydrateArchetypeData(minotaurArchetype);

      const halfDragonMinotaur = applyCreatureTemplate(minotaurData, halfDragonTemplate);
      expect(halfDragonMinotaur.creatureType).toBe('dragon');
      expect(halfDragonMinotaur.abilityScores.str.base).toBe(27); // 19 + 8
      expect(halfDragonMinotaur.abilityScores.con.base).toBe(17); // 15 + 2
      expect(halfDragonMinotaur.naturalArmorBonus).toBe(9);      // 5 + 4
      expect(halfDragonMinotaur.immunities).toContain('fire');
      expect(halfDragonMinotaur.naturalWeapons?.some((w) => w.id === 'claw')).toBe(true);
      expect(halfDragonMinotaur.naturalWeapons?.some((w) => w.id === 'bite')).toBe(true);
      expect(halfDragonMinotaur.levelAdjustment).toBe(3);
    });
  });

  describe('Milestone 108: Creature Family Progression Engines, Subtypes & Unified Effect Providers', () => {
    it('validates all 15 SRD creature type engines, 20 SRD subtypes, and Construct size bonus HP Effect Provider', () => {
      const parsedTypes = DnD35CreatureTypeEngineSchema.array().safeParse(Object.values(creatureTypesRaw));
      expect(parsedTypes.success).toBe(true);
      expect(Object.keys(creatureTypesRaw).length).toBe(15);

      const parsedSubtypes = DnD35SubtypeDefinitionSchema.array().safeParse(Object.values(subtypesRaw));
      expect(parsedSubtypes.success).toBe(true);
      expect(Object.keys(subtypesRaw).length).toBe(20);

      const fireSub = getDnD35Subtype(mockSystemContent, 'fire')!;
      expect(fireSub.immunities).toContain('fire');
      expect(fireSub.vulnerabilities).toContain('cold');
      expect(fireSub.traitBundles[0]?.immunities).toContain('fire');

      const construct = getDnD35CreatureTypeEngine(mockSystemContent, 'construct')!;
      expect(construct.constructBonusHpBySize?.['medium']).toBe(20);
      expect(construct.constructBonusHpBySize?.['large']).toBe(30);
      expect(construct.constructBonusHpBySize?.['huge']).toBe(40);

      // Hydrate Iron Golem (Large Construct) and verify Construct Effect Provider modifiers
      const ironGolemData = hydrateArchetypeData(getDnD35Archetype(mockSystemContent, 'iron_golem')!);
      const largeHpMod = ironGolemData.statModifiers?.find(
        (m) => m.sourceId === 'type:construct:bonus_hp:large'
      );
      expect(largeHpMod).toBeDefined();
      expect(largeHpMod?.value).toBe(30);
      expect(largeHpMod?.sourcePath).toBe('archetype:iron_golem/type:construct/trait:construct_bonus_hp');
      expect(largeHpMod?.condition?.selfTagsAll).toEqual(['type:construct', 'size:large']);
    });

    it('indexes hierarchical sourcePath provenance and revokes subtrees via revokeModifiersByPathPrefix', async () => {
      const { appendSourcePath, buildEffectProvenanceIndex, revokeModifiersByPathPrefix, resolveTypedModifiers } =
        await import('../src/rulesets/dnd35e/modifiers.ts');
      const { buildCreatureTypeAndSubtypeModifiers, projectDnD35ActorSemanticTags } =
        await import('../src/rulesets/dnd35e/srd_registry.ts');

      // Simulate a temporary Shapechange -> Iron Golem bundle + permanent Dwarf racial modifiers
      const shapechangePath = appendSourcePath('spell:shapechange', 'form:iron_golem');
      const constructMods = buildCreatureTypeAndSubtypeModifiers('construct', [], 0, shapechangePath);
      const dwarfDef = getDnD35Race(mockSystemContent, 'dwarf')!;
      const dwarfApplied = applyRaceToActorChassis(
        hydrateArchetypeData(getDnD35Archetype(mockSystemContent, 'player')!),
        dwarfDef
      );

      const allMods = [...dwarfApplied.statModifiers, ...constructMods];
      const index = buildEffectProvenanceIndex(allMods);

      expect(index.byPathPrefix['spell:shapechange']?.length).toBe(6);
      expect(index.byPathPrefix['spell:shapechange/form:iron_golem/type:construct']?.length).toBe(6);
      expect(index.byPathPrefix['race:dwarf']?.length).toBeGreaterThanOrEqual(3);
      expect(index.byTargetStat['max_hp']?.length).toBe(6);

      // While Large Construct tags are active, resolves +30 bonus HP; if resized to Huge, resolves +40 bonus HP!
      const largeConstructTags = projectDnD35ActorSemanticTags({
        ...dwarfApplied.entityData,
        creatureType: 'construct',
        sizeCategory: 'large'
      });
      expect(resolveTypedModifiers(index.byTargetStat['max_hp'] ?? [], { selfTags: largeConstructTags })).toBe(30);

      const hugeConstructTags = projectDnD35ActorSemanticTags({
        ...dwarfApplied.entityData,
        creatureType: 'construct',
        sizeCategory: 'huge'
      });
      expect(resolveTypedModifiers(index.byTargetStat['max_hp'] ?? [], { selfTags: hugeConstructTags })).toBe(40);

      // Revoking root "spell:shapechange" cleanly removes all 6 nested construct HP modifiers while preserving "race:dwarf"
      const afterRevoke = revokeModifiersByPathPrefix(allMods, 'spell:shapechange');
      expect(afterRevoke.length).toBe(dwarfApplied.statModifiers.length);
    });

    it('advances a Wolf from 2 HD Medium to 4 HD Large with size deltas and +1 4th-HD ability increase', () => {
      const wolfArchetype = getDnD35Archetype(mockSystemContent, 'wolf')!;
      const advancedWolf = advanceMonsterByHitDice(wolfArchetype, 4);

      expect(advancedWolf.sizeCategory).toBe('large');
      expect(advancedWolf.tracks[0]?.levels).toBe(4);
      // STR: 13 + 8 (Large size) + 1 (4th HD milestone applied to highest stat STR) = 22
      expect(advancedWolf.abilityScores.str).toBe(22);
      expect(advancedWolf.abilityScores.dex).toBe(13); // 15 - 2
      expect(advancedWolf.abilityScores.con).toBe(19); // 15 + 4
      expect(advancedWolf.naturalArmorBonus).toBe(4);  // 2 + 2
      expect(advancedWolf.weaponDice).toBe('1d8');     // scaled 1d6 -> 1d8
      expect(advancedWolf.cr).toBeGreaterThanOrEqual(2);
    });

    it('synthesizes Red Dragon Wyrmling, Adult, and Great Wyrm from unified races/dragon_red.json rhdProgression.tiers with creature-specific unlockedNaturalWeapons', () => {
      const wyrmling = synthesizeTrueDragonArchetype(mockSystemContent, 'red', 'wyrmling');
      expect(wyrmling.archetypeId).toBe('dragon_red_wyrmling');
      expect(wyrmling.sizeCategory).toBe('medium');
      expect(wyrmling.tracks[0]?.levels).toBe(7);
      expect(wyrmling.abilityScores.str).toBe(17);
      // Medium dragon has bite, claw, wings (no tail_slap, crush, or tail_sweep)
      expect(wyrmling.naturalWeapons.map((w) => w.id)).toEqual(['bite', 'claw', 'wings']);
      expect(wyrmling.senses?.blindsenseRangeFt).toBe(60);
      expect(wyrmling.movementModes?.fly).toBe(150);

      const adult = synthesizeTrueDragonArchetype(mockSystemContent, 'red', 'adult');
      expect(adult.archetypeId).toBe('dragon_red_adult');
      expect(adult.sizeCategory).toBe('huge');
      expect(adult.tracks[0]?.levels).toBe(22); // 7 + 15
      expect(adult.abilityScores.str).toBe(31);  // 17 + 14
      expect(adult.naturalArmorBonus).toBe(21); // 6 + 15
      expect(adult.spellResistance).toBe(21);
      // Huge dragon unlocks tail_slap and crush via tier unlockedNaturalWeapons
      expect(adult.naturalWeapons.map((w) => w.id)).toEqual(['bite', 'claw', 'wings', 'tail_slap', 'crush']);

      const greatWyrm = synthesizeTrueDragonArchetype(mockSystemContent, 'red', 'great_wyrm');
      expect(greatWyrm.sizeCategory).toBe('colossal');
      // Colossal dragon unlocks tail_sweep as well
      expect(greatWyrm.naturalWeapons.map((w) => w.id)).toContain('tail_sweep');
    });

    it('synthesizes 6-step Elementals from unified races/elemental_*.json with saveCurveOverrides and evaluates Golem Magic interactions', () => {
      const elderFire = synthesizeElementalArchetype(mockSystemContent, 'fire', 'elder');
      expect(elderFire.archetypeId).toBe('elemental_fire_elder');
      expect(elderFire.tracks[0]?.levels).toBe(24);
      expect(elderFire.tracks[0]?.refCurve).toBe('good');
      expect(elderFire.tracks[0]?.fortCurve).toBe('poor');
      expect(elderFire.abilityScores.dex).toBe(29); // 13 + 16
      expect(elderFire.damageReduction?.amount).toBe(10); // DR 10/- at Greater/Elder
      expect(elderFire.naturalWeapons[0]?.count).toBe(2); // 2 slams at Large+

      const hugeEarth = synthesizeElementalArchetype(mockSystemContent, 'earth', 'huge');
      expect(hugeEarth.tracks[0]?.fortCurve).toBe('good');
      expect(hugeEarth.tracks[0]?.refCurve).toBe('poor');
      expect(hugeEarth.abilityScores.str).toBe(29); // 17 + 12

      // Declarative Golem magic immunity exceptions (from races/*_golem.json)
      const fleshGolemCold = evaluateGolemMagicInteraction('flesh_golem', ['cold'], 30, mockSystemContent);
      expect(fleshGolemCold.isImmune).toBe(true);
      expect(fleshGolemCold.slowsRounds).toBe(3);

      const fleshGolemElec = evaluateGolemMagicInteraction(
        getDnD35Race(mockSystemContent, 'flesh_golem')!,
        ['electricity'],
        30
      );
      expect(fleshGolemElec.isImmune).toBe(true);
      expect(fleshGolemElec.healsHpAmount).toBe(10); // 30 / 3

      const ironGolemFire = evaluateGolemMagicInteraction('iron_golem', ['fire'], 45, mockSystemContent);
      expect(ironGolemFire.isImmune).toBe(true);
      expect(ironGolemFire.healsHpAmount).toBe(15); // 45 / 3

      const clayGolemDisintegrate = evaluateGolemMagicInteraction(
        'clay_golem',
        ['disintegrate'],
        40,
        mockSystemContent
      );
      expect(clayGolemDisintegrate.isImmune).toBe(false);

      const stoneGolemTransmute = evaluateGolemMagicInteraction(
        getDnD35Race(mockSystemContent, 'stone_golem')!,
        ['stone_to_flesh'],
        0
      );
      expect(stoneGolemTransmute.isImmune).toBe(false);
    });
  });

  describe('Milestone 109: Bestiary Expansion & Dynamic Registry Lookup', () => {
    it('hydrates all Bestiary races via getDnD35Archetype including 6-armed Marilith, Beholder, and Giants', () => {
      const marilith = getDnD35Archetype(mockSystemContent, 'marilith')!;
      expect(marilith.archetypeId).toBe('marilith');
      expect(marilith.sizeCategory).toBe('large');
      expect(marilith.anatomyBodyPlan).toBe('marilith_6arm');
      expect(marilith.abilityScores.str).toBe(29);
      expect(marilith.damageReduction?.amount).toBe(10);
      expect(marilith.damageReduction?.bypassTags).toEqual(['good', 'cold_iron']);
      expect(marilith.spellResistance).toBe(25);
      expect(marilith.feats).toContain('multiweapon_fighting');

      expect(getDnD35Archetype(mockSystemContent, 'beholder')).toBeDefined();
      expect(getDnD35Archetype(mockSystemContent, 'gelatinous_cube')).toBeDefined();
      expect(getDnD35Archetype(mockSystemContent, 'fire_giant')).toBeDefined();
    });

    it('dynamically synthesizes dragons and elementals when queried via getDnD35Archetype', () => {
      const synthesizedDragon = getDnD35Archetype(mockSystemContent, 'dragon_gold_ancient');
      expect(synthesizedDragon).toBeDefined();
      expect(synthesizedDragon?.archetypeId).toBe('dragon_gold_ancient');
      expect(synthesizedDragon?.creatureType).toBe('dragon');
      expect(synthesizedDragon?.tracks[0]?.levels).toBe(35); // 8 + 27

      const synthesizedElemental = getDnD35Archetype(mockSystemContent, 'elemental_air_large');
      expect(synthesizedElemental).toBeDefined();
      expect(synthesizedElemental?.archetypeId).toBe('elemental_air_large');
      expect(synthesizedElemental?.sizeCategory).toBe('large');
      expect(synthesizedElemental?.tracks[0]?.levels).toBe(8);
    });
  });

  describe('Phase 22+: 4-Stage Sub-Stat DAG, Size Effect Provider & Provenance Breakdown', () => {
    it('resolves Stage 3 Natural Armor sub-stat and excludes it completely on Touch AC', () => {
      // Lizardfolk (+5 base NA) + Dragon Disciple (+1 untyped) + Amulet (+2 enhancement) + Barkskin (+3 enhancement)
      const input = {
        baseSize: 'medium' as const,
        rawAbilities: {
          str: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 12, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          con: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [
          {
            trackId: 'monstrous_humanoid',
            levels: 2,
            hitDieSides: 8,
            babCurve: 'full' as const,
            fortCurve: 'poor' as const,
            refCurve: 'good' as const,
            willCurve: 'good' as const,
            skillPointsPerLevel: 2
          }
        ],
        baseNaturalArmor: 5,
        naturalArmorDelta: 1,
        statModifiers: [
          {
            targetStat: 'natural_armor',
            value: 2,
            bonusType: 'enhancement' as const,
            sourceId: 'amulet_of_natural_armor',
            sourcePath: 'item:neck/natural_armor_enhancement',
            origin: 'magical' as const
          },
          {
            targetStat: 'natural_armor',
            value: 3,
            bonusType: 'enhancement' as const,
            sourceId: 'barkskin',
            sourcePath: 'spell:barkskin/natural_armor_enhancement',
            origin: 'spell' as const
          }
        ]
      };

      const result = evaluateDnD35ActorStatDAG(input);

      // Natural armor breakdown: base 5 + untyped 1 + max(2, 3) = +9
      expect(result.naturalArmorBreakdown.total).toBe(9);
      expect(result.naturalArmorBreakdown.activeModifiers.length).toBe(3); // base (5), untyped (1), barkskin (3)
      expect(result.naturalArmorBreakdown.shadowedModifiers.length).toBe(1);
      expect(result.naturalArmorBreakdown.shadowedModifiers[0]?.modifier.sourceId).toBe('amulet_of_natural_armor');
      expect(result.naturalArmorBreakdown.shadowedModifiers[0]?.shadowedBySourcePath).toContain('spell:barkskin');

      // AC Triplet: Base 10 + Dex 1 + Natural Armor 9 = Full AC 20
      expect(result.acBreakdown.fullAC).toBe(20);
      expect(result.acBreakdown.flatFootedAC).toBe(19); // 10 + 9 (loses Dex)
      // Touch AC excludes all natural armor: Base 10 + Dex 1 = Touch AC 11
      expect(result.acBreakdown.touchAC).toBe(11);
    });

    it('correctly folds compound mundane armor + enhancement vs standalone spell armor', () => {
      // Padded Armor (+1 base, +2 enhancement = +3) vs Mage Armor (+4 armor)
      const paddedVsMageArmor: StatModifier[] = [
        {
          targetStat: 'ac',
          value: 1,
          bonusType: 'armor',
          sourceId: 'padded_armor',
          sourcePath: 'item:armor/padded_armor',
          origin: 'mundane'
        },
        {
          targetStat: 'ac',
          value: 2,
          bonusType: 'armor_enhancement',
          sourceId: 'magic_vestment',
          sourcePath: 'spell:magic_vestment/armor_enhancement',
          origin: 'spell'
        },
        {
          targetStat: 'ac',
          value: 4,
          bonusType: 'armor',
          sourceId: 'mage_armor',
          sourcePath: 'spell:mage_armor',
          origin: 'spell'
        }
      ];

      // Mage Armor (+4) beats Padded Armor compound (1 + 2 = 3)
      const breakdown = resolveTypedModifiersWithBreakdown(paddedVsMageArmor);
      expect(breakdown.total).toBe(4);
      expect(breakdown.activeModifiers.map((m) => m.sourceId)).toEqual(['mage_armor']);
      expect(breakdown.shadowedModifiers.map((s) => s.modifier.sourceId).sort()).toEqual([
        'magic_vestment',
        'padded_armor'
      ]);
      expect(resolveTypedModifiers(paddedVsMageArmor)).toBe(4);

      // In contrast, Chain Shirt (+4 base, +2 enhancement = +6) beats Mage Armor (+4)
      const chainShirtVsMageArmor: StatModifier[] = [
        {
          targetStat: 'ac',
          value: 4,
          bonusType: 'armor',
          sourceId: 'chain_shirt',
          sourcePath: 'item:armor/chain_shirt',
          origin: 'mundane'
        },
        {
          targetStat: 'ac',
          value: 2,
          bonusType: 'armor_enhancement',
          sourceId: 'magic_vestment',
          sourcePath: 'spell:magic_vestment/armor_enhancement',
          origin: 'spell'
        },
        {
          targetStat: 'ac',
          value: 4,
          bonusType: 'armor',
          sourceId: 'mage_armor',
          sourcePath: 'spell:mage_armor',
          origin: 'spell'
        }
      ];

      const chainBreakdown = resolveTypedModifiersWithBreakdown(chainShirtVsMageArmor);
      expect(chainBreakdown.total).toBe(6);
      expect(chainBreakdown.activeModifiers.map((m) => m.sourceId).sort()).toEqual(['chain_shirt', 'magic_vestment']);
      expect(chainBreakdown.shadowedModifiers.map((s) => s.modifier.sourceId)).toEqual(['mage_armor']);
    });

    it('exempts [Force] armor effects against Incorporeal Touch attacks', () => {
      const modifiers: StatModifier[] = [
        {
          targetStat: 'ac',
          value: 8,
          bonusType: 'armor',
          sourceId: 'full_plate',
          sourcePath: 'item:armor/full_plate',
          origin: 'mundane'
        },
        {
          targetStat: 'ac',
          value: 4,
          bonusType: 'armor',
          sourceId: 'mage_armor',
          sourcePath: 'spell:mage_armor',
          origin: 'spell',
          effectTags: ['force']
        }
      ];

      // Standard Touch Attack strips both Full Plate and Mage Armor
      const standardTouch = resolveTypedModifiersWithBreakdown(modifiers, {
        ignoreArmorAndNatural: true
      });
      expect(standardTouch.total).toBe(0);
      expect(standardTouch.suppressedModifiers.length).toBe(2);
      expect(standardTouch.suppressedModifiers.every((s) => s.reason === 'touch_attack')).toBe(true);

      // Incorporeal Touch Attack retains [Force] Mage Armor!
      const incorporealTouch = resolveTypedModifiersWithBreakdown(modifiers, {
        ignoreArmorAndNatural: true,
        againstIncorporealTouch: true
      });
      expect(incorporealTouch.total).toBe(4);
      expect(incorporealTouch.activeModifiers.map((m) => m.sourceId)).toEqual(['mage_armor']);
      expect(incorporealTouch.suppressedModifiers.map((s) => s.modifier.sourceId)).toEqual(['full_plate']);
    });

    it('resolves Stage 1 Size category and emits declarative Size Effect Provider modifiers', () => {
      // Base medium actor with Enlarge Person (+1 size_step) and Righteous Might (+1 size_step)
      const sizeModifiers: StatModifier[] = [
        {
          targetStat: 'size',
          value: 1,
          bonusType: 'size_step',
          sourceId: 'enlarge_person',
          sourcePath: 'spell:enlarge_person/size_step',
          origin: 'spell'
        },
        {
          targetStat: 'size',
          value: 1,
          bonusType: 'size_step',
          sourceId: 'righteous_might',
          sourcePath: 'spell:righteous_might/size_step',
          origin: 'spell'
        }
      ];

      // Non-stacking size_step takes max(1, 1) = +1 step -> Large
      const effectiveSize = resolveEffectiveSizeCategory('medium', sizeModifiers);
      expect(effectiveSize.sizeCategory).toBe('large');
      expect(effectiveSize.rankIndex).toBe(1);

      // Size Effect Provider emits modifiers with hierarchical sourcePath
      const emitted = buildSizeEffectProviderModifiers(effectiveSize.sizeCategory, effectiveSize.winningSourcePath);
      expect(emitted.length).toBe(4);

      const acSizeMod = emitted.find((m) => m.targetStat === 'ac');
      const atkSizeMod = emitted.find((m) => m.targetStat === 'attack');
      const grappleSizeMod = emitted.find((m) => m.targetStat === 'grapple');
      const hideSizeMod = emitted.find((m) => m.targetStat === 'hide');

      expect(acSizeMod?.value).toBe(-1);
      expect(acSizeMod?.sourcePath).toContain('size:large/ac_size_mod');
      expect(atkSizeMod?.value).toBe(-1);
      expect(grappleSizeMod?.value).toBe(4);
      expect(hideSizeMod?.value).toBe(-4);
    });

    it('cascades Stage 2 Ability Score modifiers into attack, damage, and AC', () => {
      // Actor with Belt of Giant Strength +4 (+4 enhancement) and Bull's Strength (+4 enhancement)
      const input = {
        baseSize: 'medium' as const,
        rawAbilities: {
          str: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          con: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [
          {
            trackId: 'fighter',
            levels: 5,
            hitDieSides: 10,
            babCurve: 'full' as const,
            fortCurve: 'good' as const,
            refCurve: 'poor' as const,
            willCurve: 'poor' as const,
            skillPointsPerLevel: 2
          }
        ],
        statModifiers: [
          {
            targetStat: 'str',
            value: 4,
            bonusType: 'enhancement' as const,
            sourceId: 'belt_of_giant_strength',
            sourcePath: 'item:waist/str_enhancement',
            origin: 'magical' as const
          },
          {
            targetStat: 'str',
            value: 4,
            bonusType: 'enhancement' as const,
            sourceId: 'bulls_strength',
            sourcePath: 'spell:bulls_strength/str_enhancement',
            origin: 'spell' as const
          }
        ]
      };

      const result = evaluateDnD35ActorStatDAG(input);

      // Non-stacking enhancement takes +4: base 14 + 4 = 18 STR (+4 mod, was +2)
      expect(result.effectiveAbilities.str.base).toBe(18);
      expect(result.effectiveAbilityModifiers.str).toBe(4);
      // Attack bonus: BAB 5 + STR 4 = 9
      expect(result.attackBonus).toBe(9);
      // Damage bonus: STR 4 = 4
      expect(result.damageBonus).toBe(4);
    });

    it('preserves multi-layer OriginLayer breakdown across Stage 3 compound defenses into Stage 4 AC and enforces maxDexBonus', () => {
      // Actor with +5 racial natural armor, +1 template delta, +3 Barkskin, +8 Full Plate (maxDexBonus: 1), +2 Magic Vestment, and 18 DEX (+4 mod)
      const result = evaluateDnD35ActorStatDAG({
        baseSize: 'medium',
        rawAbilities: {
          str: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 18, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          con: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          int: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          wis: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [],
        baseNaturalArmor: 5,
        naturalArmorDelta: 1,
        armorBonus: 8,
        maxDexBonus: 1,
        statModifiers: [
          {
            targetStat: 'natural_armor',
            value: 3,
            bonusType: 'enhancement',
            sourceId: 'barkskin',
            sourcePath: 'spell:barkskin/natural_armor_enhancement',
            origin: 'spell'
          },
          {
            targetStat: 'worn_armor_bonus',
            value: 2,
            bonusType: 'enhancement',
            sourceId: 'magic_vestment',
            sourcePath: 'spell:magic_vestment/armor_enhancement',
            origin: 'spell'
          }
        ]
      });

      // DEX contribution capped at +1 by Full Plate maxDexBonus:
      // Base 10 + Dex 1 (capped from +4) + Natural Armor 9 (5+1+3) + Worn Armor 10 (8+2) = 30
      expect(result.acBreakdown.dexContribution).toBe(1);
      expect(result.acBreakdown.fullAC).toBe(30);

      // Stage 4 acResolution.byOriginLayer accurately reflects Stage 3 constituent layers:
      // racial: +5 (base NA), progression: +1 (template delta NA), equipment: +8 (base armor), temporary: +5 (+3 barkskin + +2 magic vestment)
      expect(result.acResolution.byOriginLayer.racial).toBe(5);
      expect(result.acResolution.byOriginLayer.progression).toBe(1);
      expect(result.acResolution.byOriginLayer.equipment).toBe(8);
      expect(result.acResolution.byOriginLayer.temporary).toBe(5);
    });

    it('dynamically scales Construct Bonus HP when Stage 1 changes size and recalculates Incorporeal Deflection on CHA penalty', async () => {
      const { buildCreatureTypeAndSubtypeModifiers } = await import('../src/rulesets/dnd35e/srd_registry.ts');
      const { resolveEffectiveEntityDataWithOverlays } = await import('../src/rulesets/dnd35e/wild_shape.ts');
      const { ComponentType } = await import('../src/types/components.types.ts');

      // 1. Medium Construct resized to Large in Stage 1 via Righteous Might / Expansion (+1 size_step)
      const constructMods = buildCreatureTypeAndSubtypeModifiers('construct', [], 0, 'archetype:clockwork');
      const resizedConstruct = evaluateDnD35ActorStatDAG({
        baseSize: 'medium',
        rawAbilities: {
          str: { base: 18, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 10, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          con: { base: null, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          int: { base: null, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          wis: { base: 11, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 1, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 }
        },
        tracks: [
          {
            trackId: 'construct',
            levels: 4,
            hitDieSides: 10,
            babCurve: 'three_quarters',
            fortCurve: 'poor',
            refCurve: 'poor',
            willCurve: 'poor',
            skillPointsPerLevel: 2
          }
        ],
        baseMaxHp: 22,
        statModifiers: [
          ...constructMods,
          {
            targetStat: 'size',
            value: 1,
            bonusType: 'size_step',
            sourceId: 'enlarge_construct',
            sourcePath: 'spell:enlarge_construct/size_step',
            origin: 'spell'
          }
        ],
        context: {
          selfTags: ['type:construct', 'size:medium']
        }
      });

      // Stage 1 updates size:medium -> size:large in stageContext.selfTags, awarding +30 Construct Bonus HP instead of +20!
      expect(resizedConstruct.effectiveSize).toBe('large');
      expect(resizedConstruct.maxHp).toBe(22 + 30);

      // 2. Incorporeal Ghost hydrated at CHA 18 (+4 deflection), then hit with a -6 CHA penalty in Stage 2 (CHA 12 -> +1 deflection)
      const ghostMods = buildCreatureTypeAndSubtypeModifiers('undead', ['incorporeal'], 4, 'template:ghost');
      const penalizedGhost = evaluateDnD35ActorStatDAG({
        baseSize: 'medium',
        rawAbilities: {
          str: { base: null, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          dex: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          con: { base: null, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          int: { base: 12, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          wis: { base: 14, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 },
          cha: { base: 18, inherentBonus: 0, damage: 6, drain: 0, tempPenalty: 0 }
        },
        tracks: [],
        isIncorporeal: true,
        statModifiers: ghostMods,
        context: {
          selfTags: ['type:undead', 'subtype:incorporeal', 'size:medium']
        }
      });

      // CHA 18 - 6 damage = 12 (+1 mod). Deflection AC dynamically lowers to +1 instead of being shadowed by static +4!
      expect(penalizedGhost.effectiveAbilityModifiers.cha).toBe(1);
      expect(penalizedGhost.acBreakdown.touchAC).toBe(10 + 2 + 1); // Base 10 + Dex 2 + Deflection 1 = 13

      // 3. Wild Shape overlay emits form_override for size and natural_armor with 'form' OriginLayer provenance
      const baseDruid = hydrateArchetypeData(getDnD35Archetype(mockSystemContent, 'player')!);
      const wildShapedDruid = resolveEffectiveEntityDataWithOverlays(baseDruid, {
        type: ComponentType.PropertyOverlay,
        source: 'wild_shape:dire_bear',
        priority: 100,
        sizeCategoryOverride: 'large',
        statOverrides: {
          str: 27,
          dex: 13,
          con: 19,
          naturalArmorBonus: 7
        }
      });
      const wildDag = evaluateDnD35ActorStatDAG({
        baseSize: baseDruid.sizeCategory,
        rawAbilities: wildShapedDruid.abilityScores,
        tracks: wildShapedDruid.tracks,
        baseNaturalArmor: 2, // Suppose base race had +2 natural armor
        statModifiers: wildShapedDruid.statModifiers
      });
      expect(wildDag.effectiveSize).toBe('large');
      expect(wildDag.sizeWinningSourcePath).toBe('wild_shape:dire_bear/size:large');
      expect(wildDag.naturalArmorBreakdown.total).toBe(7);
      expect(wildDag.naturalArmorBreakdown.byOriginLayer.form).toBe(7);
      expect(wildDag.naturalArmorBreakdown.shadowedModifiers[0]?.modifier.sourceId).toBe('race_natural_armor');
    });

    it('classifies modifiers by OriginLayer and supports bulk layer suppression', () => {
      const modifiers: StatModifier[] = [
        {
          targetStat: 'saves',
          value: 2,
          bonusType: 'racial',
          sourceId: 'dwarven_resilience',
          sourcePath: 'race:dwarf/racial_saves'
        },
        {
          targetStat: 'saves',
          value: 2,
          bonusType: 'untyped',
          sourceId: 'great_fortitude',
          sourcePath: 'feat:great_fortitude/save_boost'
        },
        {
          targetStat: 'saves',
          value: 2,
          bonusType: 'resistance',
          sourceId: 'cloak_of_resistance',
          sourcePath: 'item:shoulders/cloak_of_resistance',
          origin: 'magical'
        },
        {
          targetStat: 'saves',
          value: 1,
          bonusType: 'morale',
          sourceId: 'bless',
          sourcePath: 'spell:bless/morale_save',
          origin: 'spell'
        }
      ];

      expect(classifyModifierOriginLayer(modifiers[0]!)).toBe('racial');
      expect(classifyModifierOriginLayer(modifiers[1]!)).toBe('progression');
      expect(classifyModifierOriginLayer(modifiers[2]!)).toBe('equipment');
      expect(classifyModifierOriginLayer(modifiers[3]!)).toBe('temporary');

      // Unsuppressed breakdown: 2 racial + 2 progression + 2 equipment + 1 temporary = 7
      const breakdown = resolveTypedModifiersWithBreakdown(modifiers);
      expect(breakdown.total).toBe(7);
      expect(breakdown.byOriginLayer.racial).toBe(2);
      expect(breakdown.byOriginLayer.progression).toBe(2);
      expect(breakdown.byOriginLayer.equipment).toBe(2);
      expect(breakdown.byOriginLayer.temporary).toBe(1);

      // Suppress 'equipment' (e.g., Wild Shape gear melding)
      const suppressedBreakdown = resolveTypedModifiersWithBreakdown(modifiers, {
        suppressedOriginLayers: ['equipment']
      });
      expect(suppressedBreakdown.total).toBe(5);
      expect(suppressedBreakdown.byOriginLayer.equipment).toBe(0);
      expect(suppressedBreakdown.suppressedModifiers.length).toBe(1);
      expect(suppressedBreakdown.suppressedModifiers[0]?.reason).toBe('origin_suppressed');
      expect(suppressedBreakdown.suppressedModifiers[0]?.modifier.sourceId).toBe('cloak_of_resistance');
    });
  });
});
