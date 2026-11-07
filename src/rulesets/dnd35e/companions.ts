import { addComponent, createEntity, getComponent } from '../../core/ecs.ts';
import {
  ComponentType,
  type ControllerLinkComponent,
  type FighterComponent,
  type PositionComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { hydrateArchetypeData } from './archetype_resolver.ts';
import { evaluateDnD35ActorStatDAG } from './modifiers/dag_resolver.ts';
import { getDnD35EntityData, getDnD35Race, setDnD35EntityData } from './srd_registry.ts';
import type { AbilityScoresRecord, DnD35CompanionEntry, DnD35EntityData } from './types/dnd35e.types.ts';
import { getDnD35SystemContent, type DnD35RaceDefinition } from './types/dnd35e_system.types.ts';

/** Initial and incremental bonus for Ranger Favored Enemy (`+2`). */
export const FAVORED_ENEMY_BONUS_STEP = 2;

/** Effective level interval for animal companion progression tiers (`3`). */
const COMPANION_PROGRESSION_LEVEL_DIVISOR = 3;

/** Bonus HD and Natural Armor gained per animal companion progression tier (`2`). */
const COMPANION_BONUS_HD_PER_TIER = 2;

/** Effective companion levels unlocking Evasion, Devotion, Multiattack, and Improved Evasion. */
const COMPANION_EVASION_LEVEL = 3;
const COMPANION_DEVOTION_LEVEL = 6;
const COMPANION_MULTIATTACK_LEVEL = 9;
const COMPANION_IMPROVED_EVASION_LEVEL = 15;

/** Base Intelligence score for a 1st-level Arcane Familiar (`6`). */
const FAMILIAR_BASE_INT = 6;

function makeAbilityEntry(base: number): AbilityScoresRecord['str'] {
  return { base, inherentBonus: 0, damage: 0, drain: 0, tempPenalty: 0 };
}

/**
 * Calculates animal companion progression tier by effective class level (PHB p. 36).
 *
 * @param effectiveLevel Effective druid level (`druid_level + floor(ranger_level / 2)`).
 * @returns Bonus HD, natural armor bonus, STR/DEX bonus, bonus tricks, and special abilities.
 */
export function computeAnimalCompanionAdvancement(effectiveLevel: number): {
  readonly bonusHd: number;
  readonly naturalArmorBonus: number;
  readonly strDexBonus: number;
  readonly bonusTricks: number;
  readonly specialAbilities: ReadonlyArray<string>;
} {
  const tier = Math.max(0, Math.floor(effectiveLevel / COMPANION_PROGRESSION_LEVEL_DIVISOR));
  const abilities = ['link', 'share_spells'];
  if (effectiveLevel >= COMPANION_EVASION_LEVEL) abilities.push('evasion');
  if (effectiveLevel >= COMPANION_DEVOTION_LEVEL) abilities.push('devotion');
  if (effectiveLevel >= COMPANION_MULTIATTACK_LEVEL) abilities.push('multiattack');
  if (effectiveLevel >= COMPANION_IMPROVED_EVASION_LEVEL) abilities.push('improved_evasion');

  return {
    bonusHd: tier * COMPANION_BONUS_HD_PER_TIER,
    naturalArmorBonus: tier * COMPANION_BONUS_HD_PER_TIER,
    strDexBonus: tier,
    bonusTricks: tier + 1,
    specialAbilities: abilities
  };
}

/**
 * Calculates Arcane Familiar progression by master arcane caster level (PHB p. 52).
 *
 * @param masterArcaneLevel Master's total arcane class level (Wizard + Sorcerer).
 * @returns Natural armor bonus, Intelligence score, and special abilities.
 */
export function computeFamiliarAdvancement(masterArcaneLevel: number): {
  readonly naturalArmorBonus: number;
  readonly intScore: number;
  readonly specialAbilities: ReadonlyArray<string>;
} {
  const tier = Math.max(1, Math.ceil(masterArcaneLevel / COMPANION_BONUS_HD_PER_TIER));
  const abilities = ['alertness', 'improved_evasion', 'share_spells', 'empathic_link'];
  if (masterArcaneLevel >= 3) abilities.push('deliver_touch_spells');
  if (masterArcaneLevel >= 5) abilities.push('speak_with_master');
  if (masterArcaneLevel >= 7) abilities.push('speak_with_animals_of_its_kind');
  return {
    naturalArmorBonus: tier,
    intScore: FAMILIAR_BASE_INT + (tier - 1),
    specialAbilities: abilities
  };
}

/**
 * Synchronizes and spawns companion or familiar entities linked to a master actor.
 * Preserves Universal Actor Symmetry (`RulesetDataComponent` + `FighterComponent` + `ControllerLinkComponent`).
 *
 * @param state Current GameState.
 * @param masterEntityId EntityId of the master actor.
 * @returns Updated GameState with synchronized companion/familiar entities.
 */
export function syncActorCompanionsAndFamiliars(state: GameState, masterEntityId: EntityId): GameState {
  const dndData = getDnD35EntityData(state, masterEntityId);
  const masterPos = getComponent(state, masterEntityId, ComponentType.Position) as PositionComponent | undefined;
  if (!masterPos) return state;

  const entries: DnD35CompanionEntry[] = [...(dndData.companions ?? [])];
  if (dndData.animalCompanionId && !entries.some((e) => e.tags.includes('animal_companion'))) {
    entries.push({
      id: `comp_${dndData.animalCompanionId}`,
      raceId: dndData.animalCompanionId,
      tags: ['animal_companion']
    });
  }
  if (dndData.familiarId && !entries.some((e) => e.tags.includes('familiar'))) {
    entries.push({ id: `fam_${dndData.familiarId}`, raceId: dndData.familiarId, tags: ['familiar'] });
  }

  let nextState = state;
  const sysContent = (getDnD35SystemContent(nextState.campaign) ?? undefined) as Record<string, unknown> | undefined;

  for (const entry of entries) {
    const raceDef = getDnD35Race(sysContent, entry.raceId);
    if (!raceDef) continue;
    nextState = syncSingleCompanionEntry(nextState, masterEntityId, masterPos, dndData, entry, raceDef, sysContent);
  }

  return nextState;
}

function syncSingleCompanionEntry(
  state: GameState,
  masterEntityId: EntityId,
  masterPos: PositionComponent,
  masterData: DnD35EntityData,
  entry: DnD35CompanionEntry,
  raceDef: DnD35RaceDefinition,
  sysContent?: Record<string, unknown>
): GameState {
  const baseData = hydrateArchetypeData(raceDef, undefined, sysContent);
  const isCompanion = entry.tags.includes('animal_companion');
  const isFamiliar = entry.tags.includes('familiar');

  const effCompLevel = masterData.scalingPools?.['animal_companion_effective_level'] ?? 1;
  const compAdv = isCompanion ? computeAnimalCompanionAdvancement(effCompLevel) : undefined;

  const effFamLevel =
    masterData.scalingPools?.['familiar_master_effective_level'] ??
    Math.max(
      1,
      masterData.tracks.reduce((sum, t) => sum + t.levels, 0)
    );
  const famAdv = isFamiliar ? computeFamiliarAdvancement(effFamLevel) : undefined;

  const masterFighter = getComponent(state, masterEntityId, ComponentType.Fighter) as FighterComponent | undefined;
  const masterMaxHp = masterFighter?.maxHp ?? 6;
  const masterBab = masterFighter?.attack ?? 0;

  const bonusHd = compAdv?.bonusHd ?? 0;
  const advancedTracks = baseData.tracks.map((t) => ({ ...t, levels: t.levels + bonusHd }));
  const totalNatArmor =
    baseData.naturalArmorBonus + (compAdv?.naturalArmorBonus ?? 0) + (famAdv?.naturalArmorBonus ?? 0);

  const abilities: string[] = [
    ...(baseData.activeClassFeatures ?? []),
    ...(compAdv?.specialAbilities ?? []),
    ...(famAdv?.specialAbilities ?? [])
  ];

  const scaledData: DnD35EntityData = {
    ...baseData,
    tracks: advancedTracks,
    naturalArmorBonus: totalNatArmor,
    abilityScores: {
      str: makeAbilityEntry((baseData.abilityScores.str?.base ?? 10) + (compAdv?.strDexBonus ?? 0)),
      dex: makeAbilityEntry((baseData.abilityScores.dex?.base ?? 10) + (compAdv?.strDexBonus ?? 0)),
      con: baseData.abilityScores.con ?? makeAbilityEntry(10),
      int: makeAbilityEntry(Math.max(baseData.abilityScores.int?.base ?? 2, famAdv?.intScore ?? 2)),
      wis: baseData.abilityScores.wis ?? makeAbilityEntry(12),
      cha: baseData.abilityScores.cha ?? makeAbilityEntry(6)
    },
    activeClassFeatures: Array.from(new Set(abilities)),
    feats: Array.from(
      new Set([...baseData.feats, ...(compAdv?.specialAbilities.includes('multiattack') ? ['multiattack'] : [])])
    )
  };

  const dagStats = evaluateDnD35ActorStatDAG({
    baseSize: raceDef.size ?? 'medium',
    rawAbilities: scaledData.abilityScores,
    tracks: scaledData.tracks,
    baseNaturalArmor: totalNatArmor,
    statModifiers: scaledData.statModifiers ?? []
  });

  const totalHp = isFamiliar ? Math.max(dagStats.maxHp, Math.max(1, Math.floor(masterMaxHp / 2))) : dagStats.maxHp;
  const totalAttack = isFamiliar
    ? Math.max(dagStats.attackBonus, masterBab + dagStats.effectiveAbilityModifiers.dex)
    : dagStats.attackBonus;
  const totalAc = dagStats.acBreakdown.fullAC;
  const totalHd = Math.max(
    1,
    scaledData.tracks.reduce((sum, t) => sum + t.levels, 0)
  );

  const renderChar = raceDef.name.charAt(0).toLowerCase();
  const renderColor = isFamiliar ? '#deb887' : '#c0a080';

  return upsertLinkedServantActor(state, masterEntityId, masterPos, entry.tags, {
    name: entry.name ?? `${raceDef.name}${isFamiliar ? ' Familiar' : ''}`,
    renderChar,
    renderColor,
    hp: totalHp,
    attack: totalAttack,
    ac: totalAc,
    hd: totalHd,
    dndData: scaledData
  });
}

function upsertLinkedServantActor(
  state: GameState,
  masterEntityId: EntityId,
  masterPos: PositionComponent,
  tags: ReadonlyArray<string>,
  spec: {
    readonly name: string;
    readonly renderChar: string;
    readonly renderColor: string;
    readonly hp: number;
    readonly attack: number;
    readonly ac: number;
    readonly hd: number;
    readonly dndData: DnD35EntityData;
  }
): GameState {
  let nextState = state;
  let existingId: EntityId | undefined;

  for (const id of nextState.entities) {
    const link = getComponent(nextState, id, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
    if (link && link.controllerEntityId === masterEntityId && tags.some((t) => link.tags.includes(t))) {
      existingId = id;
      break;
    }
  }

  if (existingId !== undefined) {
    nextState = addComponent(nextState, existingId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: masterEntityId,
      tags,
      shareInitiative: true
    });
    const fighter = getComponent(nextState, existingId, ComponentType.Fighter) as FighterComponent | undefined;
    if (fighter) {
      nextState = addComponent(nextState, existingId, {
        ...fighter,
        level: spec.hd,
        maxHp: spec.hp,
        hp: Math.min(fighter.hp, spec.hp),
        attack: spec.attack,
        defense: spec.ac
      });
    }
    return setDnD35EntityData(nextState, existingId, spec.dndData);
  }

  const [createdState, entId] = createEntity(nextState);
  nextState = createdState;
  nextState = addComponent(nextState, entId, { type: ComponentType.Actor, speed: 100 });
  nextState = addComponent(nextState, entId, { type: ComponentType.Position, x: masterPos.x, y: masterPos.y });
  nextState = addComponent(nextState, entId, {
    type: ComponentType.Renderable,
    glyph: spec.renderChar,
    fg: spec.renderColor,
    bg: '#000000'
  });
  nextState = addComponent(nextState, entId, {
    type: ComponentType.ControllerLink,
    controllerEntityId: masterEntityId,
    tags,
    shareInitiative: true
  });
  nextState = addComponent(nextState, entId, { type: ComponentType.Faction, factionId: 'player' });
  nextState = addComponent(nextState, entId, { type: ComponentType.Attitude, attitude: 'helpful' });
  nextState = addComponent(nextState, entId, {
    type: ComponentType.Identity,
    name: spec.name,
    mannerisms: ['loyal']
  });
  nextState = addComponent(nextState, entId, {
    type: ComponentType.Fighter,
    hp: spec.hp,
    maxHp: spec.hp,
    attack: spec.attack,
    defense: spec.ac,
    level: spec.hd,
    xp: 0,
    xpGiven: 0
  });
  return setDnD35EntityData(nextState, entId, spec.dndData);
}
