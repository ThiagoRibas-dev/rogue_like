import { addComponent, createEntity, getComponent } from '../../core/ecs.ts';
import { canTraverseTile } from '../../systems/movement.system.ts';
import { buildAnatomyEquipmentSlots } from '../../systems/inventory.system.ts';
import type { AnatomyBodyPlan } from '../../systems/inventory/equipment_slots.ts';
import {
  ComponentType,
  type ControllerLinkComponent,
  type FighterComponent,
  type PositionComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import { coordToIndex, isInBounds } from '../../utils/grid.ts';
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
const FAMILIAR_TOUCH_SPELL_LEVEL = 3;
const FAMILIAR_SPEAK_MASTER_LEVEL = 5;
const FAMILIAR_SPEAK_KIND_LEVEL = 7;

/** Base Intelligence score for a 1st-level Arcane Familiar (`6`). */
const FAMILIAR_BASE_INT = 6;

const COMPANION_DEFAULT_AI_PROFILE_ID = 'companion_default';
const COMPANION_INVENTORY_BASE_CAPACITY = 10;
const ADJACENT_SPAWN_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1]
];

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
  const specialAbilities = ['link', 'share_spells'];
  if (effectiveLevel >= COMPANION_EVASION_LEVEL) specialAbilities.push('evasion');
  if (effectiveLevel >= COMPANION_DEVOTION_LEVEL) specialAbilities.push('devotion');
  if (effectiveLevel >= COMPANION_MULTIATTACK_LEVEL) specialAbilities.push('multiattack');
  if (effectiveLevel >= COMPANION_IMPROVED_EVASION_LEVEL) specialAbilities.push('improved_evasion');

  return {
    bonusHd: tier * COMPANION_BONUS_HD_PER_TIER,
    naturalArmorBonus: tier * COMPANION_BONUS_HD_PER_TIER,
    strDexBonus: tier,
    bonusTricks: tier + 1,
    specialAbilities
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
  const specialAbilities = ['alertness', 'improved_evasion', 'share_spells', 'empathic_link'];
  if (masterArcaneLevel >= FAMILIAR_TOUCH_SPELL_LEVEL) specialAbilities.push('deliver_touch_spells');
  if (masterArcaneLevel >= FAMILIAR_SPEAK_MASTER_LEVEL) specialAbilities.push('speak_with_master');
  if (masterArcaneLevel >= FAMILIAR_SPEAK_KIND_LEVEL) specialAbilities.push('speak_with_animals_of_its_kind');
  return { naturalArmorBonus: tier, intScore: FAMILIAR_BASE_INT + (tier - 1), specialAbilities };
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
    if (raceDef)
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
  const compAdv = isCompanion
    ? computeAnimalCompanionAdvancement(masterData.scalingPools?.['animal_companion_effective_level'] ?? 1)
    : undefined;
  const effFamLevel =
    masterData.scalingPools?.['familiar_master_effective_level'] ??
    Math.max(
      1,
      masterData.tracks.reduce((sum, t) => sum + t.levels, 0)
    );
  const famAdv = isFamiliar ? computeFamiliarAdvancement(effFamLevel) : undefined;
  const masterFighter = getComponent(state, masterEntityId, ComponentType.Fighter) as FighterComponent | undefined;

  const bonusHd = compAdv?.bonusHd ?? 0;
  const totalNatArmor =
    baseData.naturalArmorBonus + (compAdv?.naturalArmorBonus ?? 0) + (famAdv?.naturalArmorBonus ?? 0);
  const scaledData: DnD35EntityData = {
    ...baseData,
    tracks: baseData.tracks.map((t) => ({ ...t, levels: t.levels + bonusHd })),
    naturalArmorBonus: totalNatArmor,
    abilityScores: {
      str: makeAbilityEntry((baseData.abilityScores.str?.base ?? 10) + (compAdv?.strDexBonus ?? 0)),
      dex: makeAbilityEntry((baseData.abilityScores.dex?.base ?? 10) + (compAdv?.strDexBonus ?? 0)),
      con: baseData.abilityScores.con ?? makeAbilityEntry(10),
      int: makeAbilityEntry(Math.max(baseData.abilityScores.int?.base ?? 2, famAdv?.intScore ?? 2)),
      wis: baseData.abilityScores.wis ?? makeAbilityEntry(12),
      cha: baseData.abilityScores.cha ?? makeAbilityEntry(6)
    },
    activeClassFeatures: Array.from(
      new Set([
        ...(baseData.activeClassFeatures ?? []),
        ...(compAdv?.specialAbilities ?? []),
        ...(famAdv?.specialAbilities ?? [])
      ])
    ),
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

  const masterMaxHp = masterFighter?.maxHp ?? 6;
  const masterBab = masterFighter?.attack ?? 0;
  return upsertLinkedServantActor(state, masterEntityId, masterPos, entry.tags, {
    name: entry.name ?? `${raceDef.name}${isFamiliar ? ' Familiar' : ''}`,
    renderChar: raceDef.name.charAt(0).toLowerCase(),
    renderColor: isFamiliar ? '#deb887' : '#c0a080',
    hp: isFamiliar ? Math.max(dagStats.maxHp, Math.max(1, Math.floor(masterMaxHp / 2))) : dagStats.maxHp,
    attack: isFamiliar
      ? Math.max(dagStats.attackBonus, masterBab + dagStats.effectiveAbilityModifiers.dex)
      : dagStats.attackBonus,
    ac: dagStats.acBreakdown.fullAC,
    hd: Math.max(
      1,
      scaledData.tracks.reduce((sum, t) => sum + t.levels, 0)
    ),
    bodyPlan: raceDef.anatomyBodyPlan ?? (isCompanion ? 'quadruped' : 'humanoid_biped'),
    dndData: scaledData
  });
}

function findAdjacentCompanionSpawnTile(
  state: GameState,
  masterPos: PositionComponent,
  dndData: DnD35EntityData
): { readonly x: number; readonly y: number } {
  for (const [dx, dy] of ADJACENT_SPAWN_OFFSETS) {
    const cx = masterPos.x + dx;
    const cy = masterPos.y + dy;
    if (!isInBounds(cx, cy, state.map.width, state.map.height)) continue;
    const tile = state.map.tiles[coordToIndex(cx, cy, state.map.width)];
    if (!tile || !canTraverseTile(state.campaign.tiles[tile.tileId], dndData.movementModes)) continue;
    const occupants = state.spatialIndex.get(`${cx},${cy}`) ?? [];
    const blocked = occupants.some(
      (id) =>
        getComponent(state, id, ComponentType.Fighter) !== undefined ||
        getComponent(state, id, ComponentType.Actor) !== undefined
    );
    if (!blocked) return { x: cx, y: cy };
  }
  return { x: masterPos.x, y: masterPos.y };
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
    readonly bodyPlan: AnatomyBodyPlan;
    readonly dndData: DnD35EntityData;
  }
): GameState {
  let nextState = state;
  const existingId = nextState.entities.find((id) => {
    const link = getComponent(nextState, id, ComponentType.ControllerLink) as ControllerLinkComponent | undefined;
    return link !== undefined && link.controllerEntityId === masterEntityId && tags.some((t) => link.tags.includes(t));
  });

  if (existingId !== undefined) {
    const prevLink = getComponent(nextState, existingId, ComponentType.ControllerLink) as
      ControllerLinkComponent | undefined;
    nextState = addComponent(nextState, existingId, {
      type: ComponentType.ControllerLink,
      controllerEntityId: masterEntityId,
      tags,
      shareInitiative: true,
      ...(prevLink?.expirationTurn !== undefined ? { expirationTurn: prevLink.expirationTurn } : {}),
      ...(prevLink?.stance !== undefined ? { stance: prevLink.stance } : {}),
      ...(prevLink?.commandTargetId !== undefined ? { commandTargetId: prevLink.commandTargetId } : {}),
      ...(prevLink?.followDistance !== undefined ? { followDistance: prevLink.followDistance } : {}),
      ...(prevLink?.leashRadius !== undefined ? { leashRadius: prevLink.leashRadius } : {})
    });
    if (!getComponent(nextState, existingId, ComponentType.AI)) {
      nextState = addComponent(nextState, existingId, {
        type: ComponentType.AI,
        profileId: COMPANION_DEFAULT_AI_PROFILE_ID
      });
    }
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

  const spawnPos = findAdjacentCompanionSpawnTile(nextState, masterPos, spec.dndData);
  const [createdState, entId] = createEntity(nextState);
  nextState = createdState;
  const initialComponents = [
    {
      type: ComponentType.Actor,
      speed: 100,
      ...(spec.dndData.movementModes !== undefined ? { movementModes: spec.dndData.movementModes } : {})
    },
    { type: ComponentType.Position, x: spawnPos.x, y: spawnPos.y },
    { type: ComponentType.Renderable, glyph: spec.renderChar, fg: spec.renderColor, bg: '#000000' },
    {
      type: ComponentType.ControllerLink,
      controllerEntityId: masterEntityId,
      tags,
      shareInitiative: true,
      stance: tags.includes('familiar') ? ('passive' as const) : ('defensive' as const)
    },
    { type: ComponentType.AI, profileId: COMPANION_DEFAULT_AI_PROFILE_ID },
    { type: ComponentType.Faction, factionId: 'player' },
    { type: ComponentType.Attitude, attitude: 'helpful' as const },
    { type: ComponentType.Identity, name: spec.name, mannerisms: ['loyal'] },
    {
      type: ComponentType.Fighter,
      hp: spec.hp,
      maxHp: spec.hp,
      attack: spec.attack,
      defense: spec.ac,
      level: spec.hd,
      xp: 0,
      xpGiven: 0
    },
    { type: ComponentType.Inventory, items: [], baseCapacity: COMPANION_INVENTORY_BASE_CAPACITY },
    { type: ComponentType.Equipment, slots: buildAnatomyEquipmentSlots(spec.bodyPlan) }
  ] as const;
  for (const comp of initialComponents) {
    nextState = addComponent(nextState, entId, comp);
  }
  return setDnD35EntityData(nextState, entId, spec.dndData);
}
