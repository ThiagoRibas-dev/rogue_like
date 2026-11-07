import { addComponent, getComponent, removeComponent, spawnItem } from '../../../core/ecs.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type InventoryComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { FAVORED_ENEMY_BONUS_STEP } from '../companion_data.ts';
import { syncActorCompanionsAndFamiliars } from '../companions.ts';
import {
  buildClassAndDomainEffectModifiers,
  collectActiveGrantedAndVirtualFeats,
  rebuildActorStateFromLevelHistory
} from '../level_ledger.ts';
import {
  aggregateProgressionChassis,
  buildHitDieTrackFromClass,
  collectClassFeaturesUpToLevel
} from '../progression.ts';
import { applyRaceToActorChassis } from '../races.ts';
import { projectDnD35ActorSemanticTags } from '../semantic_tags.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type {
  AbilityScoresRecord,
  DnD35CharacterLevelRecord,
  DnD35EntityData,
  HitDieTrack
} from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { type CharacterCreationDraft, STARTING_EQUIPMENT_PACKAGES } from './builder_core.ts';

/**
 * Applies a completed 7-Step `CharacterCreationDraft` to an entity in `GameState`.
 */
export function applyCharacterCreationToPlayer(
  state: GameState,
  entityId: EntityId,
  draft: CharacterCreationDraft
): GameState {
  const sysContent = getDnD35SystemContent(state.campaign);
  if (!sysContent) return state;

  const raceDef = sysContent.races[draft.raceId];
  const classDef = sysContent.classes[draft.classId];
  if (!raceDef || !classDef) return state;

  const currentData = getDnD35EntityData(state, entityId);
  const makeAb = (base: number): AbilityScoresRecord['str'] => ({
    base,
    inherentBonus: 0,
    damage: 0,
    drain: 0,
    tempPenalty: 0
  });
  const rawBaseScores: AbilityScoresRecord = {
    str: makeAb(draft.baseAbilityScores.str),
    dex: makeAb(draft.baseAbilityScores.dex),
    con: makeAb(draft.baseAbilityScores.con),
    int: makeAb(draft.baseAbilityScores.int),
    wis: makeAb(draft.baseAbilityScores.wis),
    cha: makeAb(draft.baseAbilityScores.cha)
  };

  const withBaseAbilities: DnD35EntityData = { ...currentData, abilityScores: rawBaseScores, tracks: [] };
  const creatureTypeEngine = sysContent.creatureTypes[raceDef.creatureType];
  const withRaceResult = applyRaceToActorChassis(withBaseAbilities, raceDef, creatureTypeEngine);
  const withRace = withRaceResult.entityData;
  const levelOneTrack = buildHitDieTrackFromClass(classDef, 1);
  const nextTracks: ReadonlyArray<HitDieTrack> = [...withRace.tracks, levelOneTrack];
  const suppressedIds = currentData.suppressedBundleIds ?? [];
  const activeTags = projectDnD35ActorSemanticTags(withRace);
  const classAndDomainMods = buildClassAndDomainEffectModifiers(
    nextTracks,
    draft.selectedAcfs,
    draft.domains,
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );

  const equipPkg =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
  const activeFeatures = collectClassFeaturesUpToLevel(classDef, 1, draft.selectedAcfs);
  const hasPounce = activeFeatures.includes('pounce') || withRace.hasPounce === true;
  const grantedFeats = collectActiveGrantedAndVirtualFeats(
    nextTracks,
    draft.selectedAcfs,
    draft.domains,
    sysContent.classes,
    sysContent.domains,
    suppressedIds,
    activeTags
  );
  const mergedFeats = Array.from(new Set([...withRace.feats, ...draft.selectedFeats, ...grantedFeats]));

  const levelOneRecord: DnD35CharacterLevelRecord = {
    characterLevel: 1,
    classId: classDef.id,
    classLevel: 1,
    hpRolled: classDef.hitDieSides,
    addedSkillRanks: draft.skillRanks,
    selectedFeats: draft.selectedFeats,
    selectedAcfs: draft.selectedAcfs,
    learnedSpells: draft.knownSpells,
    learnedSpellsByClass: { [classDef.id]: draft.knownSpells },
    ...(draft.deityFavoredWeaponId !== undefined ? { deityFavoredWeaponId: draft.deityFavoredWeaponId } : {}),
    ...(draft.combatStyle !== undefined ? { combatStyle: draft.combatStyle } : {}),
    ...(draft.favoredEnemyType !== undefined ? { favoredEnemyAdded: draft.favoredEnemyType } : {}),
    ...(draft.familiarId !== undefined ? { familiarId: draft.familiarId } : {}),
    ...(draft.animalCompanionId !== undefined ? { animalCompanionId: draft.animalCompanionId } : {})
  };

  const basePreRebuildData: DnD35EntityData = {
    ...withRace,
    raceId: raceDef.id,
    alignment: draft.alignment,
    favoredClass: raceDef.favoredClass,
    tracks: nextTracks,
    selectedAcfs: draft.selectedAcfs,
    domains: draft.domains,
    ...(draft.deityFavoredWeaponId !== undefined ? { deityFavoredWeaponId: draft.deityFavoredWeaponId } : {}),
    ...(draft.familiarId !== undefined ? { familiarId: draft.familiarId } : {}),
    ...(draft.animalCompanionId !== undefined ? { animalCompanionId: draft.animalCompanionId } : {}),
    ...(draft.arcaneSchool !== undefined ? { arcaneSchool: draft.arcaneSchool } : {}),
    prohibitedSchools: draft.prohibitedSchools,
    ...(draft.favoredEnemyType !== undefined
      ? { favoredEnemies: [{ creatureType: draft.favoredEnemyType, bonus: FAVORED_ENEMY_BONUS_STEP }] }
      : {}),
    ...(draft.combatStyle !== undefined ? { combatStyle: draft.combatStyle } : {}),
    skillRanks: draft.skillRanks,
    feats: mergedFeats,
    knownSpells: draft.knownSpells,
    preparedSpells: draft.knownSpells,
    weaponDice: equipPkg.weaponDice,
    weaponDamageType: equipPkg.weaponDamageType,
    armorBonus: equipPkg.armorBonus,
    shieldBonus: equipPkg.shieldBonus,
    hasPounce,
    levelHistory: [levelOneRecord],
    statModifiers: [...withRaceResult.statModifiers, ...classAndDomainMods]
  };

  const rebuiltData = rebuildActorStateFromLevelHistory(basePreRebuildData, [levelOneRecord], sysContent);
  const updatedData: DnD35EntityData = {
    ...rebuiltData,
    feats: Array.from(new Set([...withRace.feats, ...rebuiltData.feats])),
    preparedSpells: rebuiltData.knownSpells
  };

  const conMod = computeAbilityModifier(computeEffectiveAbilityScore(updatedData.abilityScores.con));
  const chassis = aggregateProgressionChassis(updatedData.tracks, conMod, updatedData.levelAdjustment ?? 0);
  let runningState = setDnD35EntityData(state, entityId, updatedData);

  const inventory = getComponent(runningState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(runningState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;

  if (inventory && equipPkg.items) {
    const spawnedItemIds: EntityId[] = [];
    const updatedSlots = equipment ? equipment.slots.map((s) => ({ ...s })) : [];

    for (const itemEntry of equipPkg.items) {
      if (!runningState.campaign.items[itemEntry.itemId]) continue;
      let itemEntityId: EntityId;
      [runningState, itemEntityId] = spawnItem(runningState, itemEntry.itemId, 0, 0);
      runningState = removeComponent(runningState, itemEntityId, ComponentType.Position);
      spawnedItemIds.push(itemEntityId);

      if (itemEntry.equipSlot && updatedSlots.length > 0) {
        const targetSlotType = itemEntry.equipSlot;
        const slot = updatedSlots.find((s) => {
          if (s.equippedItem !== null) return false;
          if (targetSlotType === 'main_hand' || targetSlotType === 'off_hand') {
            return s.slotType === targetSlotType || s.slotType === 'hand' || s.slotType === 'held';
          }
          return targetSlotType === 'torso'
            ? s.slotType === 'torso' || s.slotType === 'body'
            : s.slotType === targetSlotType;
        });
        if (slot) (slot as { equippedItem: EntityId | null }).equippedItem = itemEntityId;
      }
    }

    if (spawnedItemIds.length > 0) {
      runningState = addComponent(runningState, entityId, {
        ...inventory,
        items: [...inventory.items, ...spawnedItemIds]
      });
    }
    if (equipment && updatedSlots.length > 0) {
      runningState = addComponent(runningState, entityId, { ...equipment, slots: updatedSlots });
    }
  }

  runningState = syncActorCompanionsAndFamiliars(runningState, entityId);

  const fighter = getComponent(runningState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return runningState;

  return addComponent(runningState, entityId, {
    ...fighter,
    level: chassis.ecl,
    hp: chassis.maxHp,
    maxHp: chassis.maxHp,
    attack: chassis.totalBab,
    defense: equipPkg.armorBonus + equipPkg.shieldBonus
  });
}
