import { MOOD_BREAKING_MORALE_PENALTY, MOOD_ECSTATIC_MORALE_BONUS } from '../../../constants/personality.constants.ts';
import { getComponent } from '../../../core/ecs.ts';
import { resolveAreaEnvironmentProfile } from '../../../systems/world_clock.system.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FactionComponent,
  type FieldComponent,
  type FighterComponent,
  type IdentityComponent,
  type InventoryComponent,
  type ItemComponent,
  type MemoryComponent,
  type PositionComponent,
  type PropertyOverlayComponent,
  type RulesetDataComponent,
  type StatusEffectsComponent,
  type TacticalDoctrineComponent,
  type TagsComponent,
  type TemplateComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { EffectiveStats } from '../../../types/ruleset.types.ts';
import {
  type DnD35ResolvedAttackRoutine,
  evaluateTacticalDoctrineModifiers,
  extractActorTacticalDials,
  resolveActorAttackRoutine
} from '../combat/attack_resolver.ts';
import { collectRageAndFrenzyModifiers } from '../combat/combat_acf_riders.ts';
import { computeActorCarriedWeightLbs, computeEncumbranceState } from '../combat/tactical_doctrine.ts';
import { evaluateActiveSpellAuraContributions } from '../magic/spell_aura_resolver.ts';
import { summarizeConditionEffects } from '../combat/maneuvers_conditions.ts';
import {
  type ResolvedActorWeapons,
  resolveAllEquippedWeaponProfiles,
  resolveEquippedWeaponProfile
} from '../equipment_physics.ts';
import {
  buildCombatRuleOverridesFromActiveRules,
  buildFeatEffectModifiers,
  collectActiveFeatRuleOverrides
} from '../level_ledger.ts';
import { DND35E_BASE_AC, evaluateDnD35ActorStatDAG } from '../modifiers.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { projectDnD35ActorSemanticTags, resolveEntitySituationalTagContext } from '../semantic_tags.ts';
import { getBardicKnackFloor } from '../skills.ts';
import {
  buildKnowledgeDevotionModifiers,
  buildSkillRankThresholdModifiers,
  resolveActorSkillsSnapshot
} from '../skills/skill_synergies.ts';
import { getDnD35EntityData, getEquippedItemBonuses } from '../srd_registry.ts';
import type {
  DnD35EntityData,
  DnD35ResolvedActorStats,
  DnD35SkillResolution,
  StatModifier,
  StatQueryContext
} from '../types/dnd35e.types.ts';
import { type DnD35RuleOverrideEntry, getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { resolveEffectiveEntityDataWithOverlays } from '../wild_shape.ts';
import { buildActorNaturalWeaponLimbs, collectEquippedItemDAGContributions } from './dnd35e_equipped_item_dag.ts';

/** Default movement speed for uninitialized entities. */
const DND35E_DEFAULT_SPEED = 100;

/** Full entity DAG evaluation result including hydrated `DnD35EntityData` and tactical doctrine attack eligibility. */
export interface DnD35EntityDAGResult {
  readonly dndData: DnD35EntityData;
  readonly dagResult: DnD35ResolvedActorStats;
  readonly selfTags: ReadonlyArray<string>;
  readonly canAttack: boolean;
  readonly canCharge: boolean;
  readonly resolvedWeapons: ResolvedActorWeapons;
  readonly attackRoutine: DnD35ResolvedAttackRoutine;
  readonly resolvedSkills: Readonly<Record<string, DnD35SkillResolution>>;
  readonly armorCheckPenalty: number;
  readonly hasBlindFight: boolean;
  readonly hasCleave: boolean;
  readonly hasGreatCleave: boolean;
  readonly chargeIgnoresDifficultTerrain?: boolean | undefined;
  readonly statModifiers?: ReadonlyArray<StatModifier> | undefined;
  readonly ruleOverrides?: ReadonlyArray<DnD35RuleOverrideEntry> | undefined;
}

interface ActiveFieldSnapshotEntry {
  readonly entityId: EntityId;
  readonly field: FieldComponent;
  readonly pos: PositionComponent | undefined;
  readonly sourceFactionId: string | undefined;
}

interface CachedEntityDAGEntry {
  readonly rawDndData: DnD35EntityData | undefined;
  readonly isPlayer: boolean;
  readonly fighterLevel: number;
  readonly fighterAttack: number;
  readonly fighterDefense: number;
  readonly fighterMaxHp: number;
  readonly actorSpeed: number | undefined;
  readonly overlayRef: PropertyOverlayComponent | undefined;
  readonly tagsRef: TagsComponent | undefined;
  readonly doctrineRef: TacticalDoctrineComponent | undefined;
  readonly statusRef: StatusEffectsComponent | undefined;
  readonly equipmentRef: EquipmentComponent | undefined;
  readonly equippedItemRefs: ReadonlyArray<ItemComponent | undefined>;
  readonly inventoryRef: InventoryComponent | undefined;
  readonly inventoryItemRefs: ReadonlyArray<ItemComponent | undefined>;
  readonly templateRef: TemplateComponent | undefined;
  readonly identityName: string | undefined;
  readonly factionRef: FactionComponent | undefined;
  readonly isSqueezing: boolean;
  readonly posX: number | undefined;
  readonly posY: number | undefined;
  readonly areaId: string;
  readonly envType: string;
  readonly envIllum: string;
  readonly envSun: boolean;
  readonly envPhase: string;
  readonly moodTier: MemoryComponent['moodTier'];
  readonly fieldEntries: ReadonlyArray<ActiveFieldSnapshotEntry>;
  readonly result: DnD35EntityDAGResult | undefined;
}

const activeFieldsByComponentsCache = new WeakMap<object, ReadonlyArray<ActiveFieldSnapshotEntry>>();
const campaignEntityDagCache = new WeakMap<object, Map<EntityId, CachedEntityDAGEntry>>();

function getActiveFieldsForComponents(state: GameState): ReadonlyArray<ActiveFieldSnapshotEntry> {
  const cached = activeFieldsByComponentsCache.get(state.components);
  if (cached !== undefined) return cached;

  const entries: ActiveFieldSnapshotEntry[] = [];
  for (const id of state.entities) {
    const field = getComponent(state, id, ComponentType.Field) as FieldComponent | undefined;
    if (!field) continue;
    const pos = getComponent(state, id, ComponentType.Position) as PositionComponent | undefined;
    const sourceFactionId =
      field.sourceEntityId !== undefined
        ? (getComponent(state, field.sourceEntityId, ComponentType.Faction) as FactionComponent | undefined)?.factionId
        : undefined;
    entries.push({ entityId: id, field, pos, sourceFactionId });
  }
  activeFieldsByComponentsCache.set(state.components, entries);
  return entries;
}

function isSameStructuralDndData(a: DnD35EntityData | undefined, b: DnD35EntityData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const aRec = a as unknown as Record<string, unknown>;
  const bRec = b as unknown as Record<string, unknown>;
  const keysA = Object.keys(aRec);
  const keysB = Object.keys(bRec);
  for (const key of keysA) {
    if (key === 'actionBudget' || key === 'flankingRelations') continue;
    if (aRec[key] !== bRec[key]) return false;
  }
  for (const key of keysB) {
    if (key === 'actionBudget' || key === 'flankingRelations') continue;
    if (aRec[key] !== bRec[key]) return false;
  }
  return true;
}

function areFieldSnapshotsEqual(
  a: ReadonlyArray<ActiveFieldSnapshotEntry>,
  b: ReadonlyArray<ActiveFieldSnapshotEntry>
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ea = a[i]!;
    const eb = b[i]!;
    if (
      ea.entityId !== eb.entityId ||
      ea.field !== eb.field ||
      ea.pos !== eb.pos ||
      ea.sourceFactionId !== eb.sourceFactionId
    ) {
      return false;
    }
  }
  return true;
}

function areEquippedItemsEqual(
  a: ReadonlyArray<ItemComponent | undefined>,
  b: ReadonlyArray<ItemComponent | undefined>
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areStatusEffectsStructurallyEqual(
  a: StatusEffectsComponent | undefined,
  b: StatusEffectsComponent | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const listA = a.activeEffects;
  const listB = b.activeEffects;
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const ea = listA[i]!;
    const eb = listB[i]!;
    const activeA = ea.duration > 0 || ea.isPermanent === true;
    const activeB = eb.duration > 0 || eb.isPermanent === true;
    if (
      ea.effectId !== eb.effectId ||
      activeA !== activeB ||
      ea.sourcePath !== eb.sourcePath ||
      ea.polarity !== eb.polarity ||
      ea.isPermanent !== eb.isPermanent ||
      ea.linkedConditionId !== eb.linkedConditionId
    ) {
      return false;
    }
    const tagsA = ea.grantedTags ?? [];
    const tagsB = eb.grantedTags ?? [];
    if (tagsA.length !== tagsB.length) return false;
    for (let j = 0; j < tagsA.length; j++) {
      if (tagsA[j] !== tagsB[j]) return false;
    }
  }
  return true;
}

function collectEquippedItemRefs(
  state: GameState,
  equipment: EquipmentComponent | undefined
): ReadonlyArray<ItemComponent | undefined> {
  if (!equipment || !Array.isArray(equipment.slots) || equipment.slots.length === 0) return [];
  const refs: Array<ItemComponent | undefined> = [];
  for (const slot of equipment.slots) {
    if (slot.equippedItem === null) continue;
    refs.push(getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined);
  }
  return refs;
}

function collectInventoryItemRefs(
  state: GameState,
  inventory: InventoryComponent | undefined
): ReadonlyArray<ItemComponent | undefined> {
  if (!inventory || !Array.isArray(inventory.items) || inventory.items.length === 0) return [];
  return inventory.items.map((itemId) => getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined);
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function mergeTransientDndData(base: DnD35EntityData, fresh: DnD35EntityData | undefined): DnD35EntityData {
  if (!fresh || fresh === base) return base;
  const next: Record<string, unknown> = { ...base };
  if (fresh.actionBudget !== undefined) {
    next['actionBudget'] = fresh.actionBudget;
  } else {
    delete next['actionBudget'];
  }
  if (fresh.flankingRelations !== undefined) {
    next['flankingRelations'] = fresh.flankingRelations;
  } else {
    delete next['flankingRelations'];
  }
  return next as unknown as DnD35EntityData;
}

/**
 * Evaluates the full 4-Stage Topological Sub-Stat DAG for an entity in `GameState`,
 * incorporating active `PropertyOverlayComponent`s, equipped item bonuses, `TacticalDoctrineComponent`,
 * condition penalties, and optional contextual query flags (e.g. `targetTags` during combat).
 */
export function evaluateDnD35eEntityDAG(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext,
  prehydrated?: { readonly dndData: DnD35EntityData; readonly selfTags: ReadonlyArray<string> }
): DnD35EntityDAGResult | undefined {
  const canUseCache = contextOverride === undefined && prehydrated === undefined;
  if (!canUseCache) {
    return evaluateDnD35eEntityDAGInternal(state, entityId, contextOverride, prehydrated);
  }

  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return undefined;

  const actor = getComponent(state, entityId, ComponentType.Actor);
  const rulesetComp = getComponent(state, entityId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  const rawDndData =
    rulesetComp && rulesetComp.rulesetId === 'dnd35e' && rulesetComp.payload['archetypeId'] !== undefined
      ? (rulesetComp.payload as unknown as DnD35EntityData)
      : undefined;
  const isPlayer = getComponent(state, entityId, ComponentType.Player) !== undefined;
  const overlayRef = getComponent(state, entityId, ComponentType.PropertyOverlay) as
    PropertyOverlayComponent | undefined;
  const tagsRef = getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined;
  const doctrineRef = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const statusRef = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const equipmentRef = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const equippedItemRefs = collectEquippedItemRefs(state, equipmentRef);
  const inventoryRef = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const inventoryItemRefs = collectInventoryItemRefs(state, inventoryRef);
  const templateRef = getComponent(state, entityId, ComponentType.Template) as TemplateComponent | undefined;
  const identityRef = getComponent(state, entityId, ComponentType.Identity) as IdentityComponent | undefined;
  const factionRef = getComponent(state, entityId, ComponentType.Faction) as FactionComponent | undefined;
  const posRef = getComponent(state, entityId, ComponentType.Position) as PositionComponent | undefined;
  const moodTier = (getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined)?.moodTier;
  const isSqueezing = posRef?.isSqueezing === true;
  const envProfile = resolveAreaEnvironmentProfile(state);
  const fieldEntries = getActiveFieldsForComponents(state);
  const hasAnyFields = fieldEntries.length > 0;
  const posX = hasAnyFields ? posRef?.x : undefined;
  const posY = hasAnyFields ? posRef?.y : undefined;

  const stateCache = campaignEntityDagCache.get(state.campaign);
  const cached = stateCache?.get(entityId);
  if (
    cached !== undefined &&
    cached.isPlayer === isPlayer &&
    cached.fighterLevel === fighter.level &&
    cached.fighterAttack === fighter.attack &&
    cached.fighterDefense === fighter.defense &&
    cached.fighterMaxHp === fighter.maxHp &&
    cached.actorSpeed === actor?.speed &&
    cached.overlayRef === overlayRef &&
    cached.tagsRef === tagsRef &&
    cached.doctrineRef === doctrineRef &&
    areStatusEffectsStructurallyEqual(cached.statusRef, statusRef) &&
    cached.equipmentRef === equipmentRef &&
    cached.inventoryRef === inventoryRef &&
    cached.templateRef === templateRef &&
    cached.identityName === identityRef?.name &&
    cached.isSqueezing === isSqueezing &&
    cached.areaId === state.currentAreaId &&
    cached.envType === envProfile.environmentType &&
    cached.envIllum === envProfile.illumination &&
    cached.envSun === envProfile.isNaturalSunlight &&
    cached.envPhase === envProfile.clock.phaseId &&
    cached.moodTier === moodTier &&
    (!hasAnyFields || (cached.factionRef === factionRef && cached.posX === posX && cached.posY === posY)) &&
    areFieldSnapshotsEqual(cached.fieldEntries, fieldEntries) &&
    areEquippedItemsEqual(cached.equippedItemRefs, equippedItemRefs) &&
    areEquippedItemsEqual(cached.inventoryItemRefs, inventoryItemRefs) &&
    isSameStructuralDndData(cached.rawDndData, rawDndData)
  ) {
    if (!cached.result || cached.rawDndData === rawDndData) {
      return cached.result;
    }
    return {
      ...cached.result,
      dndData: mergeTransientDndData(cached.result.dndData, rawDndData)
    };
  }

  const result = evaluateDnD35eEntityDAGInternal(state, entityId, contextOverride, prehydrated);
  let targetCache = stateCache;
  if (!targetCache) {
    targetCache = new Map<EntityId, CachedEntityDAGEntry>();
    campaignEntityDagCache.set(state.campaign, targetCache);
  }
  targetCache.set(entityId, {
    rawDndData,
    isPlayer,
    fighterLevel: fighter.level,
    fighterAttack: fighter.attack,
    fighterDefense: fighter.defense,
    fighterMaxHp: fighter.maxHp,
    actorSpeed: actor?.speed,
    overlayRef,
    tagsRef,
    doctrineRef,
    statusRef,
    equipmentRef,
    equippedItemRefs,
    inventoryRef,
    inventoryItemRefs,
    templateRef,
    identityName: identityRef?.name,
    factionRef,
    isSqueezing,
    posX,
    posY,
    areaId: state.currentAreaId,
    envType: envProfile.environmentType,
    envIllum: envProfile.illumination,
    envSun: envProfile.isNaturalSunlight,
    envPhase: envProfile.clock.phaseId,
    moodTier,
    fieldEntries,
    result
  });
  return result;
}

function evaluateDnD35eEntityDAGInternal(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext,
  prehydrated?: { readonly dndData: DnD35EntityData; readonly selfTags: ReadonlyArray<string> }
): DnD35EntityDAGResult | undefined {
  const fighter = getComponent(state, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (!fighter) return undefined;
  const actor = getComponent(state, entityId, ComponentType.Actor);

  const dndData =
    prehydrated?.dndData ??
    resolveEffectiveEntityDataWithOverlays(
      getDnD35EntityData(state, entityId),
      getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined
    );
  const existingTags = (getComponent(state, entityId, ComponentType.Tags) as TagsComponent | undefined)?.tags ?? [];
  const situationalContext = resolveEntitySituationalTagContext(state, entityId, dndData);
  const sysContent = getDnD35SystemContent(state.campaign);
  const selfTags =
    prehydrated?.selfTags ??
    projectDnD35ActorSemanticTags(
      dndData,
      existingTags,
      situationalContext,
      sysContent?.classes,
      sysContent?.skills,
      sysContent?.domains,
      sysContent?.feats,
      sysContent?.conditionEffects
    );
  const condSummary = summarizeConditionEffects(dndData.conditions, sysContent?.conditionEffects);

  const rawChassis = aggregateProgressionChassis(dndData.tracks, 0);
  const { equipAttackBonus, equipArmorBonus, equipDamageBonus } = getEquippedItemBonuses(state, entityId);
  const doctrine = getComponent(state, entityId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const suppressedIds = dndData.suppressedBundleIds ?? [];
  const activeDials = extractActorTacticalDials(dndData.feats ?? [], sysContent?.feats, suppressedIds);
  const mainHandProfile = resolveEquippedWeaponProfile(state, entityId, 'main_hand');
  const doctrineMod = doctrine
    ? evaluateTacticalDoctrineModifiers(doctrine, rawChassis.totalBab, mainHandProfile.handedness, 0, activeDials)
    : { attackPenalty: 0, damageBonus: 0, dodgeAcBonus: 0, canAttack: true };

  const itemContrib = collectEquippedItemDAGContributions(state, entityId, suppressedIds, selfTags);
  const auraContrib = evaluateActiveSpellAuraContributions(state, entityId, selfTags);
  const baseStatMods = (dndData.statModifiers ?? []).filter(
    (m) => !((m.sourcePath ?? '').startsWith('feat:') && (m.sourcePath ?? '').includes('/skill:'))
  );
  const extraModifiers: StatModifier[] = [...baseStatMods, ...itemContrib.modifiers, ...auraContrib.modifiers];

  const statusComp = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  for (const activeEffect of statusComp?.activeEffects ?? []) {
    const statusDef = state.campaign.status[activeEffect.effectId];
    if (!statusDef?.saveModifiers) continue;
    for (const saveMod of statusDef.saveModifiers) {
      const targetStat: StatModifier['targetStat'] = saveMod.saveType === 'all' ? 'saves' : saveMod.saveType;
      extraModifiers.push({
        targetStat,
        value: saveMod.value,
        bonusType: saveMod.bonusType as StatModifier['bonusType'],
        sourceId: `status:${activeEffect.effectId}`,
        sourcePath: `status:${activeEffect.effectId}/save:${saveMod.saveType}`,
        origin: 'mundane',
        ...(saveMod.effectTagsAll !== undefined && saveMod.effectTagsAll.length > 0
          ? { condition: { effectTagsAny: saveMod.effectTagsAll } }
          : {})
      });
    }
  }

  const hasFeatModsAlready = baseStatMods.some((m) => (m.sourcePath ?? '').startsWith('feat:'));
  if (!hasFeatModsAlready && (dndData.feats ?? []).length > 0 && sysContent?.feats) {
    extraModifiers.push(...buildFeatEffectModifiers(dndData.feats ?? [], sysContent.feats, suppressedIds, selfTags));
  }
  const hasSkillModsAlready = baseStatMods.some((m) => (m.sourcePath ?? '').startsWith('skill:'));
  if (!hasSkillModsAlready && sysContent?.skills) {
    extraModifiers.push(...buildSkillRankThresholdModifiers(dndData.skillRanks ?? {}, sysContent.skills));
  }

  const pushMod = (
    targetStat: StatModifier['targetStat'],
    value: number,
    bonusType: StatModifier['bonusType'],
    sourceId: string,
    sourcePath: string,
    origin: StatModifier['origin']
  ): void => {
    if (value !== 0) extraModifiers.push({ targetStat, value, bonusType, sourceId, sourcePath, origin });
  };
  pushMod('attack', equipAttackBonus, 'enhancement', 'equipment_attack', 'item:weapon/enhancement', 'mundane');
  pushMod('damage', equipDamageBonus, 'enhancement', 'equipment_damage', 'item:weapon/damage_enhancement', 'mundane');
  if (doctrineMod.dodgeAcBonus > 0) {
    pushMod('ac', doctrineMod.dodgeAcBonus, 'dodge', 'tactical_doctrine', 'stance:doctrine/dodge_ac', 'ex');
  }
  pushMod('attack', doctrineMod.attackPenalty, 'untyped', 'tactical_doctrine', 'stance:doctrine/attack_penalty', 'ex');
  pushMod('damage', doctrineMod.damageBonus, 'untyped', 'tactical_doctrine', 'stance:doctrine/damage_bonus', 'ex');
  pushMod('ac', condSummary.acPenalty, 'untyped', 'conditions', 'condition:status/ac_penalty', 'ex');
  pushMod('attack', condSummary.meleeAttackPenalty, 'untyped', 'conditions', 'condition:status/attack_penalty', 'ex');

  const isIncorporeal = dndData.subtypes?.includes('incorporeal') === true;
  const stanceTags: string[] = [];
  if (doctrine?.totalDefense === true) stanceTags.push('stance:total_defense');
  else if (doctrine?.fightingDefensively === true) stanceTags.push('stance:fighting_defensively');

  const resolvedWeapons = resolveAllEquippedWeaponProfiles(state, entityId, dndData.sizeCategory);
  if (resolvedWeapons.offHandWeapons.length > 0) {
    stanceTags.push('wielding:two_weapons');
  }
  let mergedSelfTags = Array.from(
    new Set([
      ...selfTags,
      ...itemContrib.grantedTags,
      ...auraContrib.grantedTags,
      ...stanceTags,
      ...(contextOverride?.selfTags ?? [])
    ])
  );
  extraModifiers.push(...collectRageAndFrenzyModifiers(mergedSelfTags, doctrine));

  const memoryComp = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
  if (memoryComp?.moodTier === 'ecstatic') {
    pushMod('attack', MOOD_ECSTATIC_MORALE_BONUS, 'morale', 'psychology_mood', 'psychology:mood/ecstatic', 'mundane');
    pushMod('saves', MOOD_ECSTATIC_MORALE_BONUS, 'morale', 'psychology_mood', 'psychology:mood/ecstatic', 'mundane');
    pushMod('skills', MOOD_ECSTATIC_MORALE_BONUS, 'morale', 'psychology_mood', 'psychology:mood/ecstatic', 'mundane');
  } else if (memoryComp?.moodTier === 'breaking' || memoryComp?.moodTier === 'catatonic') {
    pushMod('attack', MOOD_BREAKING_MORALE_PENALTY, 'morale', 'psychology_mood', 'psychology:mood/breaking', 'mundane');
    pushMod('saves', MOOD_BREAKING_MORALE_PENALTY, 'morale', 'psychology_mood', 'psychology:mood/breaking', 'mundane');
    pushMod('skills', MOOD_BREAKING_MORALE_PENALTY, 'morale', 'psychology_mood', 'psychology:mood/breaking', 'mundane');
  }

  let dagContext: StatQueryContext = {
    ...contextOverride,
    selfTags: mergedSelfTags
  };
  const buildDagInput = (
    mods: ReadonlyArray<StatModifier>,
    ctx: StatQueryContext,
    maxDexCap: number | undefined
  ): Parameters<typeof evaluateDnD35ActorStatDAG>[0] => ({
    baseSize: dndData.sizeCategory,
    rawAbilities: {
      str: {
        ...dndData.abilityScores.str,
        tempPenalty: dndData.abilityScores.str.tempPenalty + condSummary.strPenalty
      },
      dex: {
        ...dndData.abilityScores.dex,
        tempPenalty: dndData.abilityScores.dex.tempPenalty + condSummary.dexPenalty
      },
      con: dndData.abilityScores.con,
      int: dndData.abilityScores.int,
      wis: dndData.abilityScores.wis,
      cha: dndData.abilityScores.cha
    },
    tracks: dndData.tracks,
    baseNaturalArmor: dndData.naturalArmorBonus,
    armorBonus: itemContrib.hasStructuredArmorOrShield
      ? dndData.armorBonus
      : Math.max(dndData.armorBonus, equipArmorBonus),
    shieldBonus: dndData.shieldBonus,
    maxDexBonus: maxDexCap,
    baseMaxHp: fighter.maxHp > 0 ? fighter.maxHp : undefined,
    baseSpeed: actor?.speed ?? DND35E_DEFAULT_SPEED,
    isIncorporeal,
    hasUncannyDodge:
      (!condSummary.losesDexToAC &&
        (!mergedSelfTags.includes('self:balancing') || mergedSelfTags.includes('trait:balance_uncanny_flat_footed'))) ||
      mergedSelfTags.includes('feature:uncanny_dodge'),
    statModifiers: mods,
    context: ctx
  });

  let dagResult = evaluateDnD35ActorStatDAG(buildDagInput(extraModifiers, dagContext, itemContrib.maxDexBonusCap));

  const carriedWeightLb = computeActorCarriedWeightLbs(state, entityId);
  const effectiveStrScore = dagResult.effectiveAbilities.str.base ?? 10;
  const effectiveEncumbrance = computeEncumbranceState(
    effectiveStrScore,
    dagResult.effectiveSize,
    carriedWeightLb,
    undefined,
    dndData.anatomyBodyPlan === 'quadruped'
  );
  const effectiveMaxDexCap = minDefined(itemContrib.maxDexBonusCap, effectiveEncumbrance.maxDexBonus);
  const effectiveAcp = Math.min(itemContrib.armorCheckPenalty, effectiveEncumbrance.acp);
  const effectiveLoadTag = `load:${effectiveEncumbrance.loadTier}`;
  const loadTierChanged = !mergedSelfTags.includes(effectiveLoadTag);

  if (loadTierChanged || effectiveMaxDexCap !== itemContrib.maxDexBonusCap) {
    if (loadTierChanged) {
      mergedSelfTags = [...mergedSelfTags.filter((t) => !t.startsWith('load:')), effectiveLoadTag];
      dagContext = {
        ...contextOverride,
        selfTags: mergedSelfTags
      };
    }
    dagResult = evaluateDnD35ActorStatDAG(buildDagInput(extraModifiers, dagContext, effectiveMaxDexCap));
  }

  const resolvedSkills = resolveActorSkillsSnapshot({
    skillRanks: dndData.skillRanks ?? {},
    effectiveAbilityModifiers: dagResult.effectiveAbilityModifiers,
    isConNonability: dndData.abilityScores.con.base === null,
    statModifiers: extraModifiers,
    conditions: dndData.conditions,
    armorCheckPenalty: effectiveAcp,
    minSkillRanksFloor: getBardicKnackFloor(dndData),
    skillRegistry: sysContent?.skills,
    conditionRegistry: sysContent?.conditionEffects,
    context: dagContext
  });

  if ((dndData.feats ?? []).length > 0 && sysContent?.feats && sysContent?.skills) {
    const kdMods = buildKnowledgeDevotionModifiers(
      dndData.feats ?? [],
      dndData.skillRanks ?? {},
      dndData.abilityScores,
      sysContent.feats,
      sysContent.skills,
      suppressedIds,
      resolvedSkills,
      extraModifiers
    );
    if (kdMods.length > 0) {
      extraModifiers.push(...kdMods);
      dagResult = evaluateDnD35ActorStatDAG(buildDagInput(extraModifiers, dagContext, effectiveMaxDexCap));
    }
  }

  const finalWeapons =
    dagResult.effectiveSize === dndData.sizeCategory
      ? resolvedWeapons
      : resolveAllEquippedWeaponProfiles(state, entityId, dagResult.effectiveSize);
  const naturalLimbs = buildActorNaturalWeaponLimbs(state, entityId, dndData, dagResult.effectiveSize, extraModifiers);

  const strMod = dagResult.effectiveAbilityModifiers.str;
  const dexMod = dagResult.effectiveAbilityModifiers.dex;
  const baseActorAttackBonus = dagResult.attackBonus - equipAttackBonus - doctrineMod.attackPenalty;
  const nonStrNonDoctrineFlatDamage = dagResult.damageBonus - strMod - equipDamageBonus - doctrineMod.damageBonus;

  const featRuleOverrides = collectActiveFeatRuleOverrides(
    dndData.feats ?? [],
    sysContent?.feats,
    suppressedIds,
    mergedSelfTags
  );
  const statusSpellRuleOverrides: DnD35RuleOverrideEntry[] = [];
  for (const activeEffect of statusComp?.activeEffects ?? []) {
    if (activeEffect.duration <= 0 && activeEffect.isPermanent !== true) continue;
    const spellDef = sysContent?.spells?.[activeEffect.effectId];
    if (spellDef?.effectBundle?.ruleOverrides) {
      statusSpellRuleOverrides.push(...spellDef.effectBundle.ruleOverrides);
    }
    for (const unit of spellDef?.effectUnits ?? []) {
      if (unit.type === 'stat_bundle' && unit.effectBundle.ruleOverrides) {
        statusSpellRuleOverrides.push(...unit.effectBundle.ruleOverrides);
      }
    }
  }
  const combinedRuleOverrides: ReadonlyArray<DnD35RuleOverrideEntry> = [
    ...featRuleOverrides,
    ...itemContrib.ruleOverrides,
    ...statusSpellRuleOverrides
  ];
  const offHandIsLight =
    finalWeapons.offHandWeapons.length > 0 && finalWeapons.offHandWeapons.every((w) => w.handedness === 'light');
  const activeCombatRules = buildCombatRuleOverridesFromActiveRules(combinedRuleOverrides, offHandIsLight);

  const attackRoutine = resolveActorAttackRoutine({
    resolvedWeapons: finalWeapons,
    naturalWeapons: naturalLimbs,
    totalBab: rawChassis.totalBab,
    baseAttackModifier: baseActorAttackBonus,
    strModifier: strMod,
    dexModifier: dexMod,
    hasWeaponFinesse: activeCombatRules.hasWeaponFinesse,
    doctrine,
    flatDamageBonus: nonStrNonDoctrineFlatDamage,
    hasTwoWeaponFightingFeat: activeCombatRules.combatOverrides.twfPrimaryPenalty !== undefined,
    hasMultiattackFeat: activeCombatRules.combatOverrides.secondaryNaturalPenalty !== undefined,
    overrides: activeCombatRules.combatOverrides,
    statModifiers: extraModifiers,
    selfTags: mergedSelfTags,
    targetTags: contextOverride?.targetTags
  });

  return {
    dndData,
    dagResult,
    selfTags: mergedSelfTags,
    canAttack: doctrineMod.canAttack,
    canCharge: condSummary.canCharge,
    resolvedWeapons: finalWeapons,
    attackRoutine,
    resolvedSkills,
    armorCheckPenalty: effectiveAcp,
    hasBlindFight: activeCombatRules.hasBlindFight,
    hasCleave: activeCombatRules.hasCleave,
    hasGreatCleave: activeCombatRules.hasGreatCleave,
    chargeIgnoresDifficultTerrain: activeCombatRules.chargeIgnoresDifficultTerrain,
    statModifiers: extraModifiers,
    ruleOverrides: combinedRuleOverrides
  };
}

/**
 * Computes effective actor stats (`attack`, `defense`, `maxHp`, `speed`) for the `dnd35e`
 * ruleset cartridge using the 4-Stage Topological Sub-Stat DAG.
 */
export function computeDnD35eEffectiveStats(
  state: GameState,
  entityId: EntityId,
  contextOverride?: StatQueryContext
): EffectiveStats {
  const evaluated = evaluateDnD35eEntityDAG(state, entityId, contextOverride);
  if (!evaluated) {
    const actor = getComponent(state, entityId, ComponentType.Actor);
    return {
      attack: 0,
      defense: 0,
      maxHp: 0,
      speed: actor?.speed ?? DND35E_DEFAULT_SPEED
    };
  }

  const { dagResult } = evaluated;
  return {
    attack: dagResult.attackBonus,
    defense: dagResult.acBreakdown.fullAC - DND35E_BASE_AC,
    maxHp: dagResult.maxHp,
    speed: dagResult.speed
  };
}
