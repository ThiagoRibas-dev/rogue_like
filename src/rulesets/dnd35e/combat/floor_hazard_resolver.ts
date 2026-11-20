import { addComponent, getComponent, removeComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import { queryActiveFieldsAtPosition, spawnField } from '../../../systems/field.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { getEntityMovementModes } from '../../../systems/movement_displacement.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import {
  ComponentType,
  type CoatingComponent,
  type DamageComponent,
  type EquipmentComponent,
  type ItemComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { resolveEffectiveItemDefinition } from '../equipment/item_inheritance.ts';
import { evaluateDiceExpression, rollD20 } from '../math/dice.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import type { DnD35ConditionId } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** SRD Caltrops base attack bonus (`+0`). */
export const CALTROPS_ATTACK_BONUS = 0;

/** SRD Caltrops pierce damage (`1`). */
export const CALTROPS_PIERCE_DAMAGE = 1;

/** SRD Caltrops limping wound duration in turns (`14400` = 24 hours unless cured by DC 15 Heal or 8h rest). */
export const CALTROPS_LIMP_DURATION_TURNS = 14400;

/** SRD Marbles / Slippery Ice Balance check DC (`10`). */
export const MARBLES_BALANCE_DC = 10;

/** SRD Grease Balance / Reflex check DC (`15`). */
export const GREASE_BALANCE_DC = 15;

/** SRD Craft (Alchemy) DC to identify an unknown potion (`15`). */
export const CRAFT_ALCHEMY_IDENTIFY_POTION_DC = 15;

/** SRD Natural-1 roll threshold (5% mishap chance = `1` on 1d20) when applying poison without `poison_use`. */
export const POISON_APPLICATION_MISHAP_NATURAL_ROLL = 1;

/** Default coating duration in turns (`50` turns = 5 minutes). */
export const DEFAULT_COATING_DURATION_TURNS = 50;

function resolveItemTags(state: Readonly<GameState>, itemEntityId: EntityId): ReadonlyArray<string> {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return [];
  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  const campaignDef = state.campaign.items[itemComp.itemId];
  const rawSysDef = sysItems?.[itemComp.itemId];
  const sysDef = rawSysDef && sysItems ? resolveEffectiveItemDefinition(rawSysDef, sysItems, itemComp) : undefined;
  return [...(campaignDef?.tags ?? []), ...(sysDef?.tags ?? [])];
}

function addProneCondition(state: GameState, entityId: EntityId): GameState {
  const dndData = getDnD35EntityData(state, entityId);
  const current = dndData.conditions ?? [];
  if (current.includes('prone')) return state;
  return setDnD35EntityData(state, entityId, {
    ...dndData,
    conditions: [...current, 'prone' as DnD35ConditionId]
  });
}

/**
 * Resolves stepping onto a square containing `caltrops` (either as a floor field or a dropped `caltrops_hazard` item):
 * - Caltrops make a `BAB +0` attack against the mover's **flat-footed / unarmored foot AC**
 *   (`10 + sizeMod + deflectionMod`, ignoring armor, shield, and natural armor per SRD, `+2` if wearing shoes/boots).
 * - On hit, deals `1` piercing damage and applies `'limping'` (`50%` movement speed, halting charge routines).
 *
 * @param state Current immutable GameState.
 * @param entityId Moving actor EntityId.
 * @param x Destination X coordinate.
 * @param y Destination Y coordinate.
 * @param forcedD20 Optional deterministic `1..20` roll override.
 * @returns Updated GameState and whether the caltrops wounded the mover.
 */
export function resolveCaltropsStepHazard(
  state: GameState,
  entityId: EntityId,
  x: number,
  y: number,
  forcedD20?: number
): { readonly state: GameState; readonly triggered: boolean; readonly hit: boolean } {
  const modes = getEntityMovementModes(state, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return { state, triggered: false, hit: false };
  }

  const activeFields = queryActiveFieldsAtPosition(state, x, y);
  const hasCaltropField = activeFields.some((f) => f.field.fieldType === 'caltrops');
  const tileEntities = state.spatialIndex.get(`${x},${y}`) ?? [];
  const hasCaltropItem = tileEntities.some((eid) => resolveItemTags(state, eid).includes('caltrops_hazard'));

  if (!hasCaltropField && !hasCaltropItem) {
    return { state, triggered: false, hit: false };
  }

  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const sizeMod = dag?.dagResult.acBreakdown.sizeContribution ?? 0;
  const deflectionMod =
    dag?.dagResult.acResolution.activeModifiers.find((m) => m.bonusType === 'deflection')?.value ?? 0;
  const equip = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const wearingFootwear = equip?.slots.some((s) => s.slotType === 'foot' && s.equippedItem !== null) ?? false;
  const footwearBonus = wearingFootwear ? 2 : 0;
  const targetFootAc = 10 + sizeMod + deflectionMod + footwearBonus;

  const roll = rollD20('attack', CALTROPS_ATTACK_BONUS, forcedD20);
  const actorName = resolveEntityDisplayName(state, entityId, 'The mover');
  const hit = roll.naturalRoll === 20 || (roll.naturalRoll !== 1 && roll.total >= targetFootAc);

  if (!hit) {
    return {
      state: addMessage(
        state,
        `Caltrops clatter underfoot (${roll.total} vs Foot AC ${targetFootAc}) without piercing ${actorName}.`,
        MessageLogCategory.CombatMiss
      ),
      triggered: true,
      hit: false
    };
  }

  const existingDmg = getComponent(state, entityId, ComponentType.Damage) as DamageComponent | undefined;
  const instances = existingDmg ? [...existingDmg.instances] : [];
  instances.push({
    amount: CALTROPS_PIERCE_DAMAGE,
    tags: ['piercing', 'physical', 'hazard', 'caltrops']
  });
  let nextState = addComponent(state, entityId, {
    type: ComponentType.Damage,
    instances
  });
  nextState = applyStatusEffect(nextState, entityId, 'limping', CALTROPS_LIMP_DURATION_TURNS);
  nextState = addMessage(
    nextState,
    `A caltrop pierces ${actorName}'s foot (${roll.total} vs Foot AC ${targetFootAc}) for ${CALTROPS_PIERCE_DAMAGE} damage, causing a half-speed limp!`,
    MessageLogCategory.CombatHit
  );
  return {
    state: nextState,
    triggered: true,
    hit: true
  };
}

/**
 * Resolves stepping onto a slippery surface (`marbles`, `grease`, `ice_sheet`, or `frozen_surface` crossing):
 * - Rolls a `Balance` skill check (`DC 10` for marbles/ice, `DC 15` for grease).
 * - On failure, knocks the mover `'prone'`.
 *
 * @param state Current immutable GameState.
 * @param entityId Moving actor EntityId.
 * @param x Destination X coordinate.
 * @param y Destination Y coordinate.
 * @param forcedD20 Optional deterministic `1..20` roll override.
 * @returns Updated GameState and whether the actor slipped prone.
 */
export function resolveSlipperyFloorStepHazard(
  state: GameState,
  entityId: EntityId,
  x: number,
  y: number,
  forcedD20?: number
): { readonly state: GameState; readonly triggered: boolean; readonly fellProne: boolean } {
  const modes = getEntityMovementModes(state, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return { state, triggered: false, fellProne: false };
  }

  const activeFields = queryActiveFieldsAtPosition(state, x, y);
  const hasGrease = activeFields.some((f) => f.field.fieldType === 'grease');
  const hasMarblesField = activeFields.some(
    (f) => f.field.fieldType === 'marbles' || f.field.fieldType === 'ice' || f.field.fieldType === 'frozen_surface'
  );
  const tileEntities = state.spatialIndex.get(`${x},${y}`) ?? [];
  const hasMarblesItem = tileEntities.some((eid) => resolveItemTags(state, eid).includes('marbles_hazard'));

  if (!hasGrease && !hasMarblesField && !hasMarblesItem) {
    return { state, triggered: false, fellProne: false };
  }

  const dc = hasGrease ? GREASE_BALANCE_DC : MARBLES_BALANCE_DC;
  const hazardLabel = hasGrease ? 'grease slick' : 'marbles';
  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const balanceMod = dag?.resolvedSkills['balance']?.totalModifier ?? dag?.dagResult.effectiveAbilityModifiers.dex ?? 0;
  const roll = rollD20('skill_check', balanceMod, forcedD20);
  const actorName = resolveEntityDisplayName(state, entityId, 'The mover');

  if (roll.total >= dc) {
    return {
      state: addMessage(
        state,
        `${actorName} keeps their footing across the ${hazardLabel} (Balance ${roll.total} vs DC ${dc}).`,
        MessageLogCategory.System
      ),
      triggered: true,
      fellProne: false
    };
  }

  let nextState = addProneCondition(state, entityId);
  nextState = addMessage(
    nextState,
    `${actorName} slips on the ${hazardLabel} (Balance ${roll.total} vs DC ${dc}) and falls prone!`,
    MessageLogCategory.CombatHit
  );
  return {
    state: nextState,
    triggered: true,
    fellProne: true
  };
}

/**
 * Evaluates all floor step hazards (`caltrops`, `marbles`, `grease`, `ice`) when an actor steps onto `(x, y)`.
 */
export function evaluateActorFloorStepHazards(state: GameState, entityId: EntityId, x: number, y: number): GameState {
  const caltropRes = resolveCaltropsStepHazard(state, entityId, x, y);
  const slipRes = resolveSlipperyFloorStepHazard(caltropRes.state, entityId, x, y);
  return slipRes.state;
}

/**
 * Resolves dipping or coating a weapon/ammunition item (`targetWeaponEntityId`) with a liquid or poison
 * (`coatingSourceEntityId`: `oil_flask`, `holy_water`, or an injury poison):
 * - Attaches `ComponentType.Coating` onto the weapon.
 * - If the source is an injury poison (`tags` includes `'poison'`) and the actor lacks `feature:poison_use`
 *   (or `poison_use` in `activeClassFeatures`), rolls a `1d20` mishap check (`1` = `5%` self-poisoning mishap per SRD).
 *
 * @param params Coating application parameters.
 * @returns Updated GameState, success flag, and whether a poison mishap occurred.
 */
export function resolveDipWeaponCoating(params: {
  readonly state: GameState;
  readonly actorId: EntityId;
  readonly targetItemEntityId: EntityId;
  readonly coatingSourceEntityId: EntityId;
  readonly forcedMishapD20?: number | undefined;
}): {
  readonly state: GameState;
  readonly success: boolean;
  readonly poisonMishap: boolean;
} {
  const { state, actorId, targetItemEntityId, coatingSourceEntityId } = params;
  const targetItem = getComponent(state, targetItemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const sourceItem = getComponent(state, coatingSourceEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!targetItem || !sourceItem) {
    return {
      state: addMessage(state, 'Select a valid weapon and liquid/poison vial to dip.', MessageLogCategory.System),
      success: false,
      poisonMishap: false
    };
  }

  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  const sourceCampaignDef = state.campaign.items[sourceItem.itemId];
  const rawSourceSysDef = sysItems?.[sourceItem.itemId];
  const sourceSysDef =
    rawSourceSysDef && sysItems ? resolveEffectiveItemDefinition(rawSourceSysDef, sysItems, sourceItem) : undefined;
  const sourceTags = [...(sourceCampaignDef?.tags ?? []), ...(sourceSysDef?.tags ?? [])];
  const sourceName = resolveEntityDisplayName(
    state,
    coatingSourceEntityId,
    sourceCampaignDef?.name ?? sourceSysDef?.name ?? sourceItem.itemId
  );
  const targetName = resolveEntityDisplayName(state, targetItemEntityId, targetItem.itemId);
  const actorName = resolveEntityDisplayName(state, actorId, 'The actor');

  const isPoison =
    sourceTags.includes('poison') || sourceItem.itemId.includes('poison') || sourceItem.itemId.includes('venom');
  const isOil = sourceTags.includes('flammable_oil') || sourceTags.includes('fuel');
  const isHolyWater = sourceTags.includes('holy_water') || (sourceTags.includes('holy') && sourceTags.includes('splash_weapon'));

  if (!isPoison && !isOil && !isHolyWater) {
    return {
      state: addMessage(state, `You cannot coat ${targetName} with ${sourceName}.`, MessageLogCategory.System),
      success: false,
      poisonMishap: false
    };
  }

  let nextState = state;
  if (isPoison) {
    const dag = evaluateDnD35eEntityDAG(nextState, actorId);
    const hasPoisonUse =
      (dag?.selfTags.includes('feature:poison_use') ?? false) ||
      (dag?.dndData.activeClassFeatures?.includes('poison_use') ?? false);
    if (!hasPoisonUse) {
      const mishapRoll = rollD20('ability_check', 0, params.forcedMishapD20);
      if (mishapRoll.naturalRoll === POISON_APPLICATION_MISHAP_NATURAL_ROLL) {
        nextState = applyStatusEffect(nextState, actorId, 'poison', 10, actorId);
        nextState = addMessage(
          nextState,
          `${actorName} fumbles while applying ${sourceName} (Natural 1 without Poison Use) and accidentally poisons themselves!`,
          MessageLogCategory.CombatHit
        );
        return {
          state: nextState,
          success: false,
          poisonMishap: true
        };
      }
    }
  }

  const coating: CoatingComponent = isPoison
    ? {
        type: ComponentType.Coating,
        statusId: 'poison',
        charges: 1,
        duration: DEFAULT_COATING_DURATION_TURNS,
        coatingItemId: sourceItem.itemId
      }
    : isHolyWater
      ? {
          type: ComponentType.Coating,
          statusId: 'holy_water_splash',
          charges: 1,
          duration: DEFAULT_COATING_DURATION_TURNS,
          coatingItemId: sourceItem.itemId,
          bonusDamageDice: '2d4',
          bonusDamageType: 'positive',
          targetConditionTag: 'type:undead'
        }
      : {
          type: ComponentType.Coating,
          statusId: 'burning',
          charges: 2,
          duration: DEFAULT_COATING_DURATION_TURNS,
          coatingItemId: sourceItem.itemId,
          bonusDamageDice: '1d3',
          bonusDamageType: 'fire'
        };

  nextState = addComponent(nextState, targetItemEntityId, coating);
  nextState = addMessage(
    nextState,
    `${actorName} coats ${targetName} with ${sourceName} (${coating.charges} strike charge(s)).`,
    MessageLogCategory.System
  );

  return {
    state: nextState,
    success: true,
    poisonMishap: false
  };
}

/**
 * Evaluates and consumes 1 charge from an active `CoatingComponent` on the attacker's equipped primary weapon
 * when a melee strike hits `defenderId`.
 *
 * @param state Current immutable GameState.
 * @param attackerId Attacker EntityId.
 * @param defenderId Defender EntityId.
 * @param defenderSelfTags Defender semantic tags.
 * @returns Updated GameState, extra coating damage dealt, and log suffix.
 */
export function applyAndConsumeWeaponCoatingOnHit(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId,
  defenderSelfTags: ReadonlyArray<string>
): {
  readonly state: GameState;
  readonly bonusDamage: number;
  readonly riderText: string;
} {
  const equip = getComponent(state, attackerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equip) return { state, bonusDamage: 0, riderText: '' };

  let coatedWeaponId: EntityId | undefined;
  let coating: CoatingComponent | undefined;
  for (const slot of equip.slots) {
    if (slot.equippedItem === null) continue;
    const c = getComponent(state, slot.equippedItem, ComponentType.Coating) as CoatingComponent | undefined;
    if (c && c.charges > 0) {
      coatedWeaponId = slot.equippedItem;
      coating = c;
      break;
    }
  }

  if (coatedWeaponId === undefined || !coating) {
    return { state, bonusDamage: 0, riderText: '' };
  }

  let nextState = state;
  let bonusDamage = 0;
  let riderText = '';

  const matchesTargetCondition =
    coating.targetConditionTag === undefined ||
    defenderSelfTags.includes(coating.targetConditionTag) ||
    defenderSelfTags.includes('alignment:evil');

  if (coating.bonusDamageDice && matchesTargetCondition) {
    bonusDamage = Math.max(1, evaluateDiceExpression(coating.bonusDamageDice).total);
    const dmgType = coating.bonusDamageType ?? 'fire';
    const existingDmg = getComponent(nextState, defenderId, ComponentType.Damage) as DamageComponent | undefined;
    const instances = existingDmg ? [...existingDmg.instances] : [];
    instances.push({
      amount: bonusDamage,
      sourceEntityId: attackerId,
      tags: ['coating', dmgType]
    });
    nextState = addComponent(nextState, defenderId, {
      type: ComponentType.Damage,
      instances
    });
    riderText = ` + ${bonusDamage} ${dmgType} (coating)`;
  }

  if (coating.statusId === 'poison') {
    const immunities = getDnD35EntityData(nextState, defenderId).immunities ?? [];
    const isPoisonImmune =
      immunities.includes('poison') ||
      defenderSelfTags.includes('type:undead') ||
      defenderSelfTags.includes('type:construct') ||
      defenderSelfTags.includes('type:elemental');
    if (!isPoisonImmune) {
      nextState = applyStatusEffect(nextState, defenderId, 'poison', 11, attackerId);
      riderText += ' [Poisoned]';
    }
  } else if (coating.statusId === 'burning' && nextState.campaign.status['burning']) {
    nextState = applyStatusEffect(nextState, defenderId, 'burning', 2, attackerId);
  }

  const remainingCharges = coating.charges - 1;
  if (remainingCharges <= 0) {
    nextState = removeComponent(nextState, coatedWeaponId, ComponentType.Coating);
  } else {
    nextState = addComponent(nextState, coatedWeaponId, {
      ...coating,
      charges: remainingCharges
    });
  }

  return {
    state: nextState,
    bonusDamage,
    riderText
  };
}

/**
 * Resolves a D&D 3.5e `Craft (Alchemy)` check (`DC 15`) to identify an unknown potion or alchemical substance.
 *
 * @param state Current immutable GameState.
 * @param actorId Investigator EntityId.
 * @param itemEntityId Target potion/alchemical item EntityId.
 * @param forcedD20 Optional deterministic `1..20` roll override.
 * @returns Updated GameState, success flag, and roll total.
 */
export function resolveCraftAlchemyPotionIdentification(
  state: GameState,
  actorId: EntityId,
  itemEntityId: EntityId,
  forcedD20?: number
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly totalRoll: number;
  readonly dc: number;
} {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) {
    return {
      state: addMessage(state, 'Select a potion or alchemical vial to analyze.', MessageLogCategory.System),
      success: false,
      totalRoll: 0,
      dc: CRAFT_ALCHEMY_IDENTIFY_POTION_DC
    };
  }

  const dag = evaluateDnD35eEntityDAG(state, actorId);
  const alchemySnap = dag?.resolvedSkills['craft_alchemy'] ?? dag?.resolvedSkills['craft'];
  const intMod = dag?.dagResult.effectiveAbilityModifiers.int ?? 0;
  const mod = alchemySnap?.totalModifier ?? intMod;
  const roll = rollD20('skill_check', mod, forcedD20);

  if (roll.total < CRAFT_ALCHEMY_IDENTIFY_POTION_DC) {
    return {
      state: addMessage(
        state,
        `You test a drop of the liquid (Craft [Alchemy] ${roll.total} vs DC ${CRAFT_ALCHEMY_IDENTIFY_POTION_DC}) but cannot determine its formula.`,
        MessageLogCategory.System
      ),
      success: false,
      totalRoll: roll.total,
      dc: CRAFT_ALCHEMY_IDENTIFY_POTION_DC
    };
  }

  const nextIdentified = new Set(state.identifiedItems);
  nextIdentified.add(itemComp.itemId);
  const itemDef = state.campaign.items[itemComp.itemId];
  const trueName = itemDef?.name ?? itemComp.itemId;
  let nextState: GameState = { ...state, identifiedItems: nextIdentified };
  nextState = addMessage(
    nextState,
    `You identify the alchemical mixture as ${trueName} (Craft [Alchemy] ${roll.total} vs DC ${CRAFT_ALCHEMY_IDENTIFY_POTION_DC})!`,
    MessageLogCategory.System
  );
  return {
    state: nextState,
    success: true,
    totalRoll: roll.total,
    dc: CRAFT_ALCHEMY_IDENTIFY_POTION_DC
  };
}

/**
 * Deploys a tactical floor hazard item (`caltrops`, `marbles`, `oil_flask`, `smokestick`) onto `(x, y)` as an active field.
 */
export function deployTacticalFloorHazardItem(
  state: GameState,
  _actorId: EntityId,
  itemEntityId: EntityId,
  targetX: number,
  targetY: number
): { readonly state: GameState; readonly success: boolean } {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { state, success: false };

  const tags = resolveItemTags(state, itemEntityId);
  let fieldId: string | undefined;
  let duration = 20;
  if (tags.includes('caltrops_hazard')) {
    fieldId = 'caltrops';
    duration = 100;
  } else if (tags.includes('marbles_hazard')) {
    fieldId = 'marbles';
    duration = 100;
  } else if (tags.includes('flammable_oil')) {
    fieldId = 'oil';
    duration = 50;
  } else if (tags.includes('smoke_emitter')) {
    fieldId = 'smoke';
    duration = 10;
  }

  if (!fieldId) return { state, success: false };

  let nextState = state;
  if (!nextState.campaign.fields[fieldId]) {
    nextState = {
      ...nextState,
      campaign: {
        ...nextState.campaign,
        fields: {
          ...nextState.campaign.fields,
          [fieldId]: {
            id: fieldId,
            name: fieldId.replace(/_/g, ' '),
            glyph: fieldId === 'caltrops' ? '^' : fieldId === 'marbles' ? ':' : '~',
            fg: fieldId === 'caltrops' ? '#95a5a6' : fieldId === 'smoke' ? '#bdc3c7' : '#d35400',
            bg: 'transparent',
            blocksSight: fieldId === 'smoke'
          }
        }
      }
    };
  }

  const [spawnedState] = spawnField(nextState, fieldId, targetX, targetY, 1, duration);
  return {
    state: addMessage(
      spawnedState,
      `Deployed ${itemComp.itemId.replace(/_/g, ' ')} at (${targetX}, ${targetY}).`,
      MessageLogCategory.System
    ),
    success: true
  };
}
