import {
  addComponent,
  getComponent,
  removeComponent,
  removeEntity,
  resolveEntityDisplayName
} from '../../../core/ecs.ts';
import { queryActiveFieldsAtPosition, spawnField } from '../../../systems/field.system.ts';
import { appendInteractionFrame, createInteractionChain } from '../../../systems/interaction_provenance.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { getEntityMovementModes } from '../../../systems/movement_displacement.ts';
import { applyStatusEffect } from '../../../systems/status-effect.system.ts';
import type { ItemDefinition } from '../../../types/campaign/item.ts';
import {
  ComponentType,
  type CoatingComponent,
  type DamageComponent,
  type EquipmentComponent,
  type InteractionChain,
  type InventoryComponent,
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
const CALTROPS_ATTACK_BONUS = 0;

/** SRD Caltrops pierce damage (`1`). */
const CALTROPS_PIERCE_DAMAGE = 1;

/** SRD Caltrops limping wound duration in turns (`14400` = 24 hours unless cured by DC 15 Heal or 8h rest). */
const CALTROPS_LIMP_DURATION_TURNS = 14400;

/** Default SRD footwear armor bonus (`+2` for shoes or boots). */
const DEFAULT_FOOTWEAR_ARMOR_BONUS = 2;

/** SRD Marbles / Slippery Ice Balance check DC (`10`). */
const MARBLES_BALANCE_DC = 10;

/** SRD Grease Balance / Reflex check DC (`15`). */
const GREASE_BALANCE_DC = 15;

/** SRD Craft (Alchemy) DC to identify an unknown potion (`15`). */
const CRAFT_ALCHEMY_IDENTIFY_POTION_DC = 15;

/** SRD Natural-1 roll threshold (5% mishap chance = `1` on 1d20) when applying poison without `poison_use`. */
const POISON_APPLICATION_MISHAP_NATURAL_ROLL = 1;

/** Default coating duration in turns (`50` turns = 5 minutes). */
const DEFAULT_COATING_DURATION_TURNS = 50;

/** Movement context flags evaluated when stepping onto floor hazards. */
export interface FloorStepHazardContext {
  readonly isHalfSpeedOrSlower?: boolean | undefined;
  readonly isChargingOrRunning?: boolean | undefined;
  readonly interaction?: InteractionChain | undefined;
}

function resolveMergedItemDefinition(state: Readonly<GameState>, itemComp: ItemComponent): ItemDefinition | undefined {
  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  const campaignDef = state.campaign.items[itemComp.itemId];
  const rawSysDef = sysItems?.[itemComp.itemId];
  const sysDef = rawSysDef && sysItems ? resolveEffectiveItemDefinition(rawSysDef, sysItems, itemComp) : undefined;
  if (!campaignDef && !sysDef) return undefined;
  if (campaignDef && sysDef) {
    return {
      ...sysDef,
      ...campaignDef,
      tags: Array.from(new Set([...(sysDef.tags ?? []), ...(campaignDef.tags ?? [])]))
    };
  }
  return campaignDef ?? sysDef;
}

function resolveItemTags(state: Readonly<GameState>, itemEntityId: EntityId): ReadonlyArray<string> {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return [];
  return resolveMergedItemDefinition(state, itemComp)?.tags ?? [];
}

function isTargetCoatableWeaponOrAmmo(
  state: Readonly<GameState>,
  targetItemEntityId: EntityId,
  targetItem: ItemComponent
): boolean {
  const def = resolveMergedItemDefinition(state, targetItem);
  if (!def) return false;
  const tags = def.tags ?? [];
  return (
    def.category === 'weapon' ||
    def.weaponStats !== undefined ||
    tags.includes('weapon') ||
    tags.includes('ammunition') ||
    tags.includes('ammo') ||
    def.equippable?.slot === 'main_hand' ||
    def.equippable?.slot === 'off_hand' ||
    def.equippable?.slot === 'two_handed' ||
    def.equippable?.slot === 'ranged' ||
    def.equippable?.slot === 'hand' ||
    def.equippable?.slot === 'held' ||
    getComponent(state, targetItemEntityId, ComponentType.Coating) !== undefined
  );
}

function consumeOneChargeOrDestroyActorItem(state: GameState, actorId: EntityId, itemEntityId: EntityId): GameState {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return state;

  if (itemComp.charges !== undefined && itemComp.charges > 1) {
    return addComponent(state, itemEntityId, {
      ...itemComp,
      charges: itemComp.charges - 1
    });
  }

  let nextState = state;
  const inv = getComponent(nextState, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  if (inv && inv.items.includes(itemEntityId)) {
    nextState = addComponent(nextState, actorId, {
      ...inv,
      items: inv.items.filter((id) => id !== itemEntityId)
    });
  }

  const equip = getComponent(nextState, actorId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (equip && equip.slots.some((s) => s.equippedItem === itemEntityId)) {
    nextState = addComponent(nextState, actorId, {
      ...equip,
      slots: equip.slots.map((s) => (s.equippedItem === itemEntityId ? { ...s, equippedItem: null } : s))
    });
  }

  return removeEntity(nextState, itemEntityId);
}

function resolveFootwearArmorContribution(state: Readonly<GameState>, entityId: EntityId): number {
  const equip = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  if (!equip) return 0;
  let bonus = 0;
  for (const slot of equip.slots) {
    if (slot.slotType !== 'foot' || slot.equippedItem === null) continue;
    const itemComp = getComponent(state, slot.equippedItem, ComponentType.Item) as ItemComponent | undefined;
    const def = itemComp ? resolveMergedItemDefinition(state, itemComp) : undefined;
    const armorBonus =
      def?.equippable?.defenseBonus !== undefined && def.equippable.defenseBonus > 0
        ? def.equippable.defenseBonus
        : DEFAULT_FOOTWEAR_ARMOR_BONUS;
    bonus = Math.max(bonus, armorBonus);
  }
  return bonus;
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
 * - Moving at half-speed or slower safely avoids caltrops without triggering an attack roll (`PHB p. 126`).
 * - Caltrops make a `BAB +0` attack against the mover's **Foot AC** (`dag.dagResult.acBreakdown.footAC + footwearBonus`,
 *   ignoring armor, shield, and deflection bonuses per SRD, `+2` if wearing shoes/boots).
 * - On hit, deals `1` piercing damage, applies `'limping'` (`50%` movement speed), and immediately halts
 *   charging or running movement (`haltMovement: true`).
 *
 * @param state Current immutable GameState.
 * @param entityId Moving actor EntityId.
 * @param x Destination X coordinate.
 * @param y Destination Y coordinate.
 * @param forcedD20 Optional deterministic `1..20` roll override.
 * @param context Optional movement context (`isHalfSpeedOrSlower`, `isChargingOrRunning`, `interaction`).
 * @returns Updated GameState, whether caltrops attacked, whether they hit, and whether movement must halt.
 */
export function resolveCaltropsStepHazard(
  state: GameState,
  entityId: EntityId,
  x: number,
  y: number,
  forcedD20?: number,
  context?: FloorStepHazardContext
): {
  readonly state: GameState;
  readonly triggered: boolean;
  readonly hit: boolean;
  readonly haltMovement: boolean;
} {
  if (context?.isHalfSpeedOrSlower === true) {
    return { state, triggered: false, hit: false, haltMovement: false };
  }

  const modes = getEntityMovementModes(state, entityId);
  if (modes?.fly !== undefined && modes.fly > 0) {
    return { state, triggered: false, hit: false, haltMovement: false };
  }

  const activeFields = queryActiveFieldsAtPosition(state, x, y);
  const caltropFieldEntry = activeFields.find((f) => f.field.fieldType === 'caltrops');
  const tileEntities = state.spatialIndex.get(`${x},${y}`) ?? [];
  const caltropItemId = tileEntities.find((eid) => resolveItemTags(state, eid).includes('caltrops_hazard'));

  if (!caltropFieldEntry && caltropItemId === undefined) {
    return { state, triggered: false, hit: false, haltMovement: false };
  }

  const dag = evaluateDnD35eEntityDAG(state, entityId);
  const baseFootAc = dag?.dagResult.acBreakdown.footAC ?? 10 + (dag?.dagResult.acBreakdown.sizeContribution ?? 0);
  const footwearBonus = resolveFootwearArmorContribution(state, entityId);
  const targetFootAc = baseFootAc + footwearBonus;

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
      hit: false,
      haltMovement: false
    };
  }

  const sourceEntityId = caltropFieldEntry?.field.sourceEntityId;
  const baseChain =
    caltropFieldEntry?.field.interaction ??
    context?.interaction ??
    (sourceEntityId !== undefined && caltropFieldEntry?.entityId !== undefined
      ? createInteractionChain(sourceEntityId, {
          kind: 'field',
          fieldEntityId: caltropFieldEntry.entityId,
          fieldType: 'caltrops'
        })
      : undefined);

  const existingDmg = getComponent(state, entityId, ComponentType.Damage) as DamageComponent | undefined;
  const instances = existingDmg ? [...existingDmg.instances] : [];
  instances.push({
    amount: CALTROPS_PIERCE_DAMAGE,
    ...(sourceEntityId !== undefined ? { sourceEntityId } : {}),
    tags: ['piercing', 'physical', 'hazard', 'caltrops'],
    ...(baseChain !== undefined ? { interaction: baseChain } : {})
  });
  let nextState = addComponent(state, entityId, {
    type: ComponentType.Damage,
    instances
  });
  nextState = applyStatusEffect(
    nextState,
    entityId,
    'limping',
    CALTROPS_LIMP_DURATION_TURNS,
    sourceEntityId,
    baseChain
  );
  nextState = addMessage(
    nextState,
    `A caltrop pierces ${actorName}'s foot (${roll.total} vs Foot AC ${targetFootAc}) for ${CALTROPS_PIERCE_DAMAGE} damage, causing a half-speed limp!`,
    MessageLogCategory.CombatHit
  );

  let haltMovement = context?.isChargingOrRunning === true;
  const dndData = getDnD35EntityData(nextState, entityId);
  if (dndData.actionBudget) {
    const halvedRemaining = Math.floor(dndData.actionBudget.movementRemainingFt / 2);
    if (dndData.conditions.includes('charging')) {
      haltMovement = true;
    }
    nextState = setDnD35EntityData(nextState, entityId, {
      ...dndData,
      actionBudget: {
        ...dndData.actionBudget,
        movementRemainingFt: haltMovement ? 0 : halvedRemaining,
        ...(haltMovement ? { canMoveFurtherThisRound: false } : {})
      }
    });
  }

  return {
    state: nextState,
    triggered: true,
    hit: true,
    haltMovement
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
export function evaluateActorFloorStepHazards(
  state: GameState,
  entityId: EntityId,
  x: number,
  y: number,
  context?: FloorStepHazardContext
): GameState {
  const caltropRes = resolveCaltropsStepHazard(state, entityId, x, y, undefined, context);
  const slipRes = resolveSlipperyFloorStepHazard(caltropRes.state, entityId, x, y);
  return slipRes.state;
}

/**
 * Resolves dipping or coating a weapon/ammunition item (`targetItemEntityId`) with a liquid or poison
 * (`coatingSourceEntityId`: `oil_flask`, `holy_water`, or an injury poison):
 * - Validates that `targetItemEntityId` is a coatable weapon or ammunition entity.
 * - Resolves coating parameters from declarative `itemDef.coating` metadata or item tags (`poison`, `flammable_oil`, `holy_water`),
 *   never substring-matching `sourceItem.itemId`.
 * - Consumes `1` charge/unit of `coatingSourceEntityId` upon application (and upon a natural-1 self-poisoning mishap).
 * - Attaches `ComponentType.Coating` with `InteractionChain` provenance onto the target weapon.
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
  readonly interaction?: InteractionChain | undefined;
}): {
  readonly state: GameState;
  readonly success: boolean;
  readonly poisonMishap: boolean;
} {
  const { state, actorId, targetItemEntityId, coatingSourceEntityId } = params;
  if (targetItemEntityId === coatingSourceEntityId) {
    return {
      state: addMessage(state, 'Select a distinct weapon and liquid/poison vial to dip.', MessageLogCategory.System),
      success: false,
      poisonMishap: false
    };
  }

  const targetItem = getComponent(state, targetItemEntityId, ComponentType.Item) as ItemComponent | undefined;
  const sourceItem = getComponent(state, coatingSourceEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!targetItem || !sourceItem) {
    return {
      state: addMessage(state, 'Select a valid weapon and liquid/poison vial to dip.', MessageLogCategory.System),
      success: false,
      poisonMishap: false
    };
  }

  const targetName = resolveEntityDisplayName(state, targetItemEntityId, targetItem.itemId);
  if (!isTargetCoatableWeaponOrAmmo(state, targetItemEntityId, targetItem)) {
    return {
      state: addMessage(
        state,
        `${targetName} is not a weapon or ammunition that can be coated.`,
        MessageLogCategory.System
      ),
      success: false,
      poisonMishap: false
    };
  }

  const sourceDef = resolveMergedItemDefinition(state, sourceItem);
  const sourceTags = sourceDef?.tags ?? [];
  const sourceName = resolveEntityDisplayName(state, coatingSourceEntityId, sourceDef?.name ?? sourceItem.itemId);
  const actorName = resolveEntityDisplayName(state, actorId, 'The actor');

  const declarativeCoating = sourceDef?.coating;
  const isPoison =
    declarativeCoating?.isPoison === true || declarativeCoating?.statusId === 'poison' || sourceTags.includes('poison');
  const isOil =
    declarativeCoating?.statusId === 'burning' ||
    sourceTags.includes('flammable_oil') ||
    (sourceTags.includes('fuel') && sourceTags.includes('alchemical'));
  const isHolyWater =
    declarativeCoating?.statusId === 'holy_water_splash' ||
    sourceTags.includes('holy_water') ||
    (sourceTags.includes('holy') && sourceTags.includes('splash_weapon'));

  if (!declarativeCoating && !isPoison && !isOil && !isHolyWater) {
    return {
      state: addMessage(state, `You cannot coat ${targetName} with ${sourceName}.`, MessageLogCategory.System),
      success: false,
      poisonMishap: false
    };
  }

  const dipInteraction = appendInteractionFrame(
    params.interaction ??
      createInteractionChain(actorId, {
        kind: 'action',
        actionId: 'dip',
        actorId
      }),
    {
      kind: 'item',
      itemEntityId: coatingSourceEntityId,
      itemId: sourceItem.itemId,
      role: 'consumable'
    }
  );

  let nextState = state;
  if (isPoison) {
    const dag = evaluateDnD35eEntityDAG(nextState, actorId);
    const hasPoisonUse =
      (dag?.selfTags.includes('feature:poison_use') ?? false) ||
      (dag?.dndData.activeClassFeatures?.includes('poison_use') ?? false);
    if (!hasPoisonUse) {
      const mishapRoll = rollD20('ability_check', 0, params.forcedMishapD20);
      if (mishapRoll.naturalRoll === POISON_APPLICATION_MISHAP_NATURAL_ROLL) {
        nextState = consumeOneChargeOrDestroyActorItem(nextState, actorId, coatingSourceEntityId);
        nextState = applyStatusEffect(nextState, actorId, 'poison', 10, actorId, dipInteraction);
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

  const coating: CoatingComponent = declarativeCoating
    ? {
        type: ComponentType.Coating,
        statusId: declarativeCoating.statusId,
        charges: declarativeCoating.charges,
        duration: declarativeCoating.duration,
        coatingItemId: sourceItem.itemId,
        ...(declarativeCoating.bonusDamageDice !== undefined
          ? { bonusDamageDice: declarativeCoating.bonusDamageDice }
          : {}),
        ...(declarativeCoating.bonusDamageType !== undefined
          ? { bonusDamageType: declarativeCoating.bonusDamageType }
          : {}),
        ...(declarativeCoating.targetConditionTag !== undefined
          ? { targetConditionTag: declarativeCoating.targetConditionTag }
          : {}),
        interaction: dipInteraction
      }
    : isPoison
      ? {
          type: ComponentType.Coating,
          statusId: 'poison',
          charges: 1,
          duration: DEFAULT_COATING_DURATION_TURNS,
          coatingItemId: sourceItem.itemId,
          interaction: dipInteraction
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
            targetConditionTag: 'type:undead',
            interaction: dipInteraction
          }
        : {
            type: ComponentType.Coating,
            statusId: 'burning',
            charges: 2,
            duration: DEFAULT_COATING_DURATION_TURNS,
            coatingItemId: sourceItem.itemId,
            bonusDamageDice: '1d3',
            bonusDamageType: 'fire',
            interaction: dipInteraction
          };

  nextState = consumeOneChargeOrDestroyActorItem(nextState, actorId, coatingSourceEntityId);
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
 * Evaluates and consumes 1 charge from an active `CoatingComponent` on the striking weapon entity
 * when a melee strike hits `defenderId`.
 * - When `strikingWeaponEntityId` is provided (or when the strike is natural/unarmed without a weapon entity),
 *   only that exact weapon entity's coating is inspected and decremented.
 * - For legacy direct callers that omit `strikingWeaponEntityId`, falls back to the first equipped coated item.
 *
 * @param state Current immutable GameState.
 * @param attackerId Attacker EntityId.
 * @param defenderId Defender EntityId.
 * @param defenderSelfTags Defender semantic tags.
 * @param strikingWeaponEntityId Optional EntityId of the specific weapon that delivered the strike.
 * @param interaction Optional InteractionChain for the strike.
 * @returns Updated GameState, extra coating damage dealt, and log suffix.
 */
export function applyAndConsumeWeaponCoatingOnHit(
  state: GameState,
  attackerId: EntityId,
  defenderId: EntityId,
  defenderSelfTags: ReadonlyArray<string>,
  strikingWeaponEntityId?: EntityId | null,
  interaction?: InteractionChain
): {
  readonly state: GameState;
  readonly bonusDamage: number;
  readonly riderText: string;
} {
  let coatedWeaponId: EntityId | undefined;
  let coating: CoatingComponent | undefined;

  if (strikingWeaponEntityId !== undefined) {
    if (strikingWeaponEntityId === null) {
      return { state, bonusDamage: 0, riderText: '' };
    }
    const c = getComponent(state, strikingWeaponEntityId, ComponentType.Coating) as CoatingComponent | undefined;
    if (c && c.charges > 0) {
      coatedWeaponId = strikingWeaponEntityId;
      coating = c;
    }
  } else {
    const equip = getComponent(state, attackerId, ComponentType.Equipment) as EquipmentComponent | undefined;
    if (!equip) return { state, bonusDamage: 0, riderText: '' };
    for (const slot of equip.slots) {
      if (slot.equippedItem === null) continue;
      const c = getComponent(state, slot.equippedItem, ComponentType.Coating) as CoatingComponent | undefined;
      if (c && c.charges > 0) {
        coatedWeaponId = slot.equippedItem;
        coating = c;
        break;
      }
    }
  }

  if (coatedWeaponId === undefined || !coating) {
    return { state, bonusDamage: 0, riderText: '' };
  }

  let nextState = state;
  let bonusDamage = 0;
  let riderText = '';

  const baseChain =
    interaction ??
    coating.interaction ??
    createInteractionChain(attackerId, {
      kind: 'strike',
      attackerId,
      defenderId,
      strikeIndex: 0,
      attackSource: 'manufactured_primary'
    });
  const coatingChain = appendInteractionFrame(baseChain, {
    kind: 'item',
    itemEntityId: coatedWeaponId,
    itemId: coating.coatingItemId ?? 'coated_weapon',
    role: 'weapon'
  });

  const matchesTargetCondition =
    coating.targetConditionTag === undefined || defenderSelfTags.includes(coating.targetConditionTag);

  if (coating.bonusDamageDice && matchesTargetCondition) {
    bonusDamage = Math.max(1, evaluateDiceExpression(coating.bonusDamageDice).total);
    const dmgType = coating.bonusDamageType ?? 'fire';
    const existingDmg = getComponent(nextState, defenderId, ComponentType.Damage) as DamageComponent | undefined;
    const instances = existingDmg ? [...existingDmg.instances] : [];
    instances.push({
      amount: bonusDamage,
      sourceEntityId: attackerId,
      tags: ['coating', dmgType],
      interaction: appendInteractionFrame(coatingChain, {
        kind: 'effect',
        effectId: coating.statusId,
        effectKind: 'coating',
        sourcePath: `item:${coating.coatingItemId ?? 'coating'}`
      })
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
      nextState = applyStatusEffect(nextState, defenderId, 'poison', 11, attackerId, coatingChain);
      riderText += ' [Poisoned]';
    }
  } else if (coating.statusId === 'burning' && nextState.campaign.status['burning']) {
    nextState = applyStatusEffect(nextState, defenderId, 'burning', 2, attackerId, coatingChain);
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
  const itemDef = resolveMergedItemDefinition(state, itemComp);
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
 * Deploys a tactical floor hazard item (`caltrops`, `marbles`, `oil_flask`, `smokestick`) onto `(x, y)` as an active field,
 * consuming 1 charge/unit of the deployed item from `actorId` and recording `InteractionChain` provenance.
 */
export function deployTacticalFloorHazardItem(
  state: GameState,
  actorId: EntityId,
  itemEntityId: EntityId,
  targetX: number,
  targetY: number,
  interaction?: InteractionChain
): { readonly state: GameState; readonly success: boolean } {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
  if (!itemComp) return { state, success: false };

  const mergedDef = resolveMergedItemDefinition(state, itemComp);
  const tags = mergedDef?.tags ?? [];
  let fieldId = mergedDef?.deployment?.fieldId;
  let duration = mergedDef?.deployment?.duration ?? 20;

  if (!fieldId) {
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

  const deployChain = appendInteractionFrame(
    interaction ??
      createInteractionChain(actorId, {
        kind: 'action',
        actionId: 'deploy_hazard',
        actorId
      }),
    {
      kind: 'item',
      itemEntityId,
      itemId: itemComp.itemId,
      role: 'deployed_source'
    }
  );

  const [spawnedState] = spawnField(nextState, fieldId, targetX, targetY, 1, duration, undefined, deployChain);
  const consumedState = consumeOneChargeOrDestroyActorItem(spawnedState, actorId, itemEntityId);
  return {
    state: addMessage(
      consumedState,
      `Deployed ${itemComp.itemId.replace(/_/g, ' ')} at (${targetX}, ${targetY}).`,
      MessageLogCategory.System
    ),
    success: true
  };
}
