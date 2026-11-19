import { addComponent, getComponent, removeComponent, spawnItem } from '../../../core/ecs.ts';
import { DEFAULT_ACTOR_INVENTORY_CAPACITY } from '../../../core/ecs/ecs_spawner_equipment.ts';
import { resolveCurrencyConfig, toBaseUnits } from '../../../systems/currency.system.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type InventoryComponent,
  type RenderableComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { computeAbilityModifier, computeEffectiveAbilityScore } from '../abilities.ts';
import { FAVORED_ENEMY_BONUS_STEP, syncActorCompanionsAndFamiliars } from '../companions.ts';
import {
  buildClassAndDomainEffectModifiers,
  collectActiveGrantedAndVirtualFeats,
  rebuildActorStateFromLevelHistory,
  syncActorResourcePoolsComponent
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
import {
  type CharacterCreationDraft,
  INVENTORY_CAPACITY_HEADROOM,
  STARTING_EQUIPMENT_PACKAGES,
  type StartingPackageItemEntry,
  computeCustomKitCostCp,
  resolveClassStartingWealthCp
} from './builder_core.ts';

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

  const withBaseAbilities: DnD35EntityData = {
    ...currentData,
    abilityScores: rawBaseScores,
    tracks: [],
    feats: []
  };
  const creatureTypeEngine = sysContent.creatureTypes[raceDef.creatureType];
  const withRaceResult = applyRaceToActorChassis(withBaseAbilities, raceDef, creatureTypeEngine);
  const withRace = withRaceResult.entityData;
  const levelOneTrack = buildHitDieTrackFromClass(classDef, 1);
  const nextTracks: ReadonlyArray<HitDieTrack> = [...withRace.tracks, levelOneTrack];
  const suppressedIds = currentData.suppressedBundleIds ?? [];
  const activeTags = projectDnD35ActorSemanticTags(
    withRace,
    [],
    undefined,
    sysContent.classes,
    sysContent.skills,
    sysContent.domains
  );
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
    companions: [
      ...(draft.animalCompanionId
        ? [
            {
              id: `comp_${draft.animalCompanionId}`,
              raceId: draft.animalCompanionId,
              tags: ['animal_companion']
            }
          ]
        : []),
      ...(draft.familiarId
        ? [
            {
              id: `fam_${draft.familiarId}`,
              raceId: draft.familiarId,
              tags: ['familiar']
            }
          ]
        : [])
    ],
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
    weaponDice: draft.equipmentMode === 'custom' ? '1d3' : equipPkg.weaponDice,
    weaponDamageType: draft.equipmentMode === 'custom' ? 'bludgeoning' : equipPkg.weaponDamageType,
    armorBonus: draft.equipmentMode === 'custom' ? 0 : equipPkg.armorBonus,
    shieldBonus: draft.equipmentMode === 'custom' ? 0 : equipPkg.shieldBonus,
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
  const resolvedCharName = (draft.characterName ?? '').trim() || 'Adventurer';
  const resolvedTitle = draft.characterTitle?.trim();
  const existingIdentity = getComponent(runningState, entityId, ComponentType.Identity);
  const { title: _oldTitle, colorOverride: _oldColor, ...preservedIdentity } = existingIdentity ?? {};
  const nextColorOverride = draft.glyphColor ?? existingIdentity?.colorOverride;
  runningState = addComponent(runningState, entityId, {
    ...preservedIdentity,
    type: ComponentType.Identity,
    name: resolvedCharName,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    mannerisms: draft.mannerisms !== undefined ? [...draft.mannerisms] : (existingIdentity?.mannerisms ?? []),
    ...(nextColorOverride !== undefined ? { colorOverride: nextColorOverride } : {})
  });
  const existingRenderable = getComponent(runningState, entityId, ComponentType.Renderable) as
    RenderableComponent | undefined;
  if (existingRenderable && (draft.spriteId !== undefined || draft.glyphColor !== undefined)) {
    const nextSpriteId = draft.spriteId ?? existingRenderable.spriteId;
    runningState = addComponent(runningState, entityId, {
      ...existingRenderable,
      fg: draft.glyphColor ?? existingRenderable.fg,
      ...(nextSpriteId !== undefined ? { spriteId: nextSpriteId } : {})
    });
  }
  runningState = syncActorResourcePoolsComponent(runningState, entityId, updatedData, sysContent);

  const inventory = getComponent(runningState, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(runningState, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const currencyCfg = resolveCurrencyConfig(runningState);
  const goldDenomId = currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId;

  const isCustomEquipment = draft.equipmentMode === 'custom';
  const baseItemsToSpawn: ReadonlyArray<StartingPackageItemEntry> = isCustomEquipment
    ? (draft.customEquipmentItems ?? [])
    : (equipPkg.items ?? []);
  const freeOutfitId = isCustomEquipment ? draft.customFreeOutfitId : equipPkg.freeOutfitId;
  const itemsToSpawn: StartingPackageItemEntry[] =
    freeOutfitId &&
    runningState.campaign.items[freeOutfitId] &&
    !baseItemsToSpawn.some((entry) => entry.itemId === freeOutfitId)
      ? [{ itemId: freeOutfitId }, ...baseItemsToSpawn]
      : [...baseItemsToSpawn];
  const startingCp = isCustomEquipment
    ? Math.max(
        0,
        (draft.customStartingBudgetCp ?? resolveClassStartingWealthCp(classDef, currencyCfg)) -
          computeCustomKitCostCp(baseItemsToSpawn, runningState.campaign.items, currencyCfg)
      )
    : Math.max(0, toBaseUnits(equipPkg.startingGoldGp, goldDenomId, currencyCfg));

  if (inventory && itemsToSpawn.length > 0) {
    const spawnedItemIds: EntityId[] = [];
    const updatedSlots = equipment ? equipment.slots.map((s) => ({ ...s })) : [];

    for (const itemEntry of itemsToSpawn) {
      if (!runningState.campaign.items[itemEntry.itemId]) continue;
      const qty = Math.max(1, Math.floor(itemEntry.quantity ?? 1));
      for (let copyIdx = 0; copyIdx < qty; copyIdx++) {
        let itemEntityId: EntityId;
        [runningState, itemEntityId] = spawnItem(runningState, itemEntry.itemId, 0, 0);
        runningState = removeComponent(runningState, itemEntityId, ComponentType.Position);
        spawnedItemIds.push(itemEntityId);

        if (copyIdx === 0 && itemEntry.equipSlot && updatedSlots.length > 0) {
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
    }

    const latestInventory = getComponent(runningState, entityId, ComponentType.Inventory) as
      InventoryComponent | undefined;
    const baseBalance = latestInventory?.currencyBalance ?? 0;
    if (latestInventory) {
      runningState = addComponent(runningState, entityId, {
        ...latestInventory,
        baseCapacity: Math.max(
          latestInventory.baseCapacity,
          DEFAULT_ACTOR_INVENTORY_CAPACITY,
          latestInventory.items.length + spawnedItemIds.length + INVENTORY_CAPACITY_HEADROOM
        ),
        items: spawnedItemIds.length > 0 ? [...latestInventory.items, ...spawnedItemIds] : latestInventory.items,
        currencyBalance: baseBalance + startingCp
      });
    }
    if (equipment && updatedSlots.length > 0) {
      runningState = addComponent(runningState, entityId, { ...equipment, slots: updatedSlots });
    }
  } else if (inventory) {
    runningState = addComponent(runningState, entityId, {
      ...inventory,
      baseCapacity: Math.max(inventory.baseCapacity, DEFAULT_ACTOR_INVENTORY_CAPACITY),
      currencyBalance: (inventory.currencyBalance ?? 0) + startingCp
    });
  }

  runningState = syncActorCompanionsAndFamiliars(runningState, entityId);

  const fighter = getComponent(runningState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return runningState;

  const customDefenseBonus = isCustomEquipment
    ? baseItemsToSpawn.reduce((sum, entry) => {
        if (!entry.equipSlot) return sum;
        const def = runningState.campaign.items[entry.itemId];
        return sum + (def?.equippable?.defenseBonus ?? 0);
      }, 0)
    : equipPkg.armorBonus + equipPkg.shieldBonus;

  return addComponent(runningState, entityId, {
    ...fighter,
    level: chassis.ecl,
    hp: chassis.maxHp,
    maxHp: chassis.maxHp,
    attack: chassis.totalBab,
    defense: customDefenseBonus
  });
}
