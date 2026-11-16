/**
 * @file Druid Shapeshift Alternate Class Feature runtime form resolver (PHB II p. 39).
 * Grants at-will swift-action transformations into Predator, Aerial, and Ferocious Slayer forms
 * via PropertyOverlayComponent and TacticalDoctrineComponent stance groups.
 */

import { addComponent, getComponent, removeComponent } from '../../core/ecs.ts';
import { addMessage, MessageLogCategory } from '../../systems/message.system.ts';
import { toggleConsoleStanceGroup } from '../../systems/stance.system.ts';
import {
  ComponentType,
  type PropertyOverlayComponent,
  type TacticalDoctrineComponent
} from '../../types/components.types.ts';
import { EngineMode, type EntityId, type GameState } from '../../types/game-state.types.ts';
import { createRoundActionBudget } from './action_economy.ts';
import { getDnD35EntityData, setDnD35EntityData } from './srd_registry.ts';
import type { NaturalWeaponDescriptor, StatModifier } from './types/dnd35e.types.ts';

/** Canonical identifier for Druid Shapeshift overlay in PropertyOverlayComponent. */
export const SHAPESHIFT_OVERLAY_SOURCE = 'acf:shapeshift';

/** Priority for Druid Shapeshift form overlay (`120`). */
export const SHAPESHIFT_OVERLAY_PRIORITY = 120;

/** Mutually exclusive stance group ID for Druid Shapeshift forms. */
export const SHAPESHIFT_STANCE_GROUP_ID = 'druid_shapeshift_form';

/** Available Shapeshift forms. */
export type DnD35ShapeshiftFormId = 'predator' | 'aerial' | 'ferocious_slayer' | 'normal';

/** Minimum Druid level required to assume each Shapeshift form. */
export const SHAPESHIFT_FORM_MIN_LEVELS: Readonly<Record<Exclude<DnD35ShapeshiftFormId, 'normal'>, number>> = {
  predator: 1,
  aerial: 5,
  ferocious_slayer: 8
};

/**
 * Validates whether a Druid of the given level is eligible to assume `formId`.
 *
 * @param druidLevel Current Druid level.
 * @param formId Target Shapeshift form.
 * @returns True if eligible.
 */
export function isDruidShapeshiftEligible(druidLevel: number, formId: DnD35ShapeshiftFormId): boolean {
  if (formId === 'normal') return true;
  return druidLevel >= SHAPESHIFT_FORM_MIN_LEVELS[formId];
}

/** Natural weapons granted by Predator Form (Primary 1d6 Bite). */
const PREDATOR_NATURAL_WEAPONS: ReadonlyArray<NaturalWeaponDescriptor> = [
  {
    id: 'shapeshift_predator_bite',
    name: 'Bite',
    naturalType: 'bite',
    isPrimary: true,
    count: 1,
    damageDice: '1d6',
    damageType: 'piercing',
    critThreatMin: 20,
    critMultiplier: 2
  }
];

/** Natural weapons granted by Aerial Form (Primary 1d6 Talon). */
const AERIAL_NATURAL_WEAPONS: ReadonlyArray<NaturalWeaponDescriptor> = [
  {
    id: 'shapeshift_aerial_talon',
    name: 'Talon',
    naturalType: 'talon',
    isPrimary: true,
    count: 1,
    damageDice: '1d6',
    damageType: 'slashing',
    critThreatMin: 20,
    critMultiplier: 2
  }
];

/** Natural weapons granted by Ferocious Slayer Form (Primary 1d8 Bite + 2x Secondary 1d6 Claws). */
const FEROCIOUS_SLAYER_NATURAL_WEAPONS: ReadonlyArray<NaturalWeaponDescriptor> = [
  {
    id: 'shapeshift_ferocious_bite',
    name: 'Bite',
    naturalType: 'bite',
    isPrimary: true,
    count: 1,
    damageDice: '1d8',
    damageType: 'piercing',
    critThreatMin: 20,
    critMultiplier: 2
  },
  {
    id: 'shapeshift_ferocious_claw',
    name: 'Claw',
    naturalType: 'claw',
    isPrimary: false,
    count: 2,
    damageDice: '1d6',
    damageType: 'slashing',
    critThreatMin: 20,
    critMultiplier: 2
  }
];

const PREDATOR_STAT_MODIFIERS: ReadonlyArray<StatModifier> = [
  {
    targetStat: 'str',
    value: 4,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:predator:str',
    sourcePath: 'acf:shapeshift/form:predator/str',
    origin: 'su'
  },
  {
    targetStat: 'natural_armor',
    value: 4,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:predator:natural_armor',
    sourcePath: 'acf:shapeshift/form:predator/natural_armor',
    origin: 'su'
  }
];

const AERIAL_STAT_MODIFIERS: ReadonlyArray<StatModifier> = [
  {
    targetStat: 'str',
    value: 2,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:aerial:str',
    sourcePath: 'acf:shapeshift/form:aerial/str',
    origin: 'su'
  },
  {
    targetStat: 'natural_armor',
    value: 2,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:aerial:natural_armor',
    sourcePath: 'acf:shapeshift/form:aerial/natural_armor',
    origin: 'su'
  },
  {
    targetStat: 'ref',
    value: 2,
    bonusType: 'competence',
    sourceId: 'shapeshift:aerial:ref',
    sourcePath: 'acf:shapeshift/form:aerial/ref',
    origin: 'su'
  }
];

const FEROCIOUS_SLAYER_STAT_MODIFIERS: ReadonlyArray<StatModifier> = [
  {
    targetStat: 'str',
    value: 8,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:ferocious_slayer:str',
    sourcePath: 'acf:shapeshift/form:ferocious_slayer/str',
    origin: 'su'
  },
  {
    targetStat: 'natural_armor',
    value: 8,
    bonusType: 'enhancement',
    sourceId: 'shapeshift:ferocious_slayer:natural_armor',
    sourcePath: 'acf:shapeshift/form:ferocious_slayer/natural_armor',
    origin: 'su'
  }
];

function buildShapeshiftOverlay(formId: Exclude<DnD35ShapeshiftFormId, 'normal'>): PropertyOverlayComponent {
  switch (formId) {
    case 'predator':
      return {
        type: ComponentType.PropertyOverlay,
        source: SHAPESHIFT_OVERLAY_SOURCE,
        priority: SHAPESHIFT_OVERLAY_PRIORITY,
        statModifiers: PREDATOR_STAT_MODIFIERS,
        movementModesOverride: {
          land: 50
        },
        naturalWeaponsOverride: PREDATOR_NATURAL_WEAPONS,
        grantedTags: ['trait:shapeshift_active', 'form:shapeshift_predator']
      };

    case 'aerial':
      return {
        type: ComponentType.PropertyOverlay,
        source: SHAPESHIFT_OVERLAY_SOURCE,
        priority: SHAPESHIFT_OVERLAY_PRIORITY,
        statModifiers: AERIAL_STAT_MODIFIERS,
        movementModesOverride: {
          land: 30,
          fly: 40
        },
        naturalWeaponsOverride: AERIAL_NATURAL_WEAPONS,
        grantedTags: ['trait:shapeshift_active', 'form:shapeshift_aerial', 'movement:fly']
      };

    case 'ferocious_slayer':
      return {
        type: ComponentType.PropertyOverlay,
        source: SHAPESHIFT_OVERLAY_SOURCE,
        priority: SHAPESHIFT_OVERLAY_PRIORITY,
        sizeCategoryOverride: 'large',
        statModifiers: FEROCIOUS_SLAYER_STAT_MODIFIERS,
        movementModesOverride: {
          land: 40
        },
        naturalWeaponsOverride: FEROCIOUS_SLAYER_NATURAL_WEAPONS,
        grantedTags: ['trait:shapeshift_active', 'form:shapeshift_ferocious_slayer']
      };
  }
}

/**
 * Transforms a Druid into a chosen Shapeshift form (or back to normal form) as an at-will swift action.
 *
 * @param state Current immutable GameState.
 * @param actorId Entity performing the shapeshift.
 * @param formId Target form ID (`'predator' | 'aerial' | 'ferocious_slayer' | 'normal'`).
 * @returns `{ state, success }`.
 */
export function executeDruidShapeshift(
  state: GameState,
  actorId: EntityId,
  formId: DnD35ShapeshiftFormId
): { readonly state: GameState; readonly success: boolean } {
  const dndData = getDnD35EntityData(state, actorId);
  const hasShapeshiftTrait =
    (dndData.activeClassFeatures ?? []).includes('shapeshift') ||
    (dndData.selectedAcfs ?? []).some((a) => a.includes('shapeshift'));

  if (!hasShapeshiftTrait) {
    return {
      state: addMessage(state, 'You do not possess the Shapeshift ability.', MessageLogCategory.System),
      success: false
    };
  }

  const druidTrack = dndData.tracks.find((t) => t.trackId === 'druid');
  const druidLevel = Math.max(1, druidTrack?.levels ?? dndData.tracks.reduce((sum, t) => sum + t.levels, 0));

  if (!isDruidShapeshiftEligible(druidLevel, formId)) {
    const requiredLevel = formId === 'normal' ? 1 : SHAPESHIFT_FORM_MIN_LEVELS[formId];
    return {
      state: addMessage(
        state,
        `Cannot assume ${formId} form (requires Druid level ${requiredLevel}, current level ${druidLevel}).`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  let nextBudget = dndData.actionBudget;
  if (state.engineMode === EngineMode.TurnBased) {
    const dexMod = Math.floor(((dndData.abilityScores?.dex?.base ?? 10) - 10) / 2);
    const activeBudget =
      nextBudget ??
      createRoundActionBudget({
        dexModifier: dexMod,
        hasCombatReflexes: dndData.feats?.includes('combat_reflexes') ?? false,
        isFlatFooted: dndData.conditions?.includes('flat_footed') ?? false,
        singleActionOnly: dndData.singleActionsOnly === true || (dndData.conditions?.includes('staggered') ?? false),
        isNauseated: dndData.conditions?.includes('nauseated') ?? false
      });
    if (activeBudget.swiftRemaining < 1) {
      return {
        state: addMessage(state, 'No Swift Action remaining this round to Shapeshift.', MessageLogCategory.System),
        success: false
      };
    }
    nextBudget = {
      ...activeBudget,
      swiftRemaining: activeBudget.swiftRemaining - 1,
      hasActedThisRound: true
    };
  }

  let nextState = state;
  if (nextBudget !== undefined && nextBudget !== dndData.actionBudget) {
    nextState = setDnD35EntityData(nextState, actorId, {
      ...dndData,
      actionBudget: nextBudget
    });
  }

  // Update or clear PropertyOverlayComponent
  const existingOverlay = getComponent(nextState, actorId, ComponentType.PropertyOverlay) as
    PropertyOverlayComponent | undefined;

  if (formId === 'normal') {
    if (existingOverlay && existingOverlay.source === SHAPESHIFT_OVERLAY_SOURCE) {
      nextState = removeComponent(nextState, actorId, ComponentType.PropertyOverlay);
    }
  } else {
    const newOverlay = buildShapeshiftOverlay(formId);
    nextState = addComponent(nextState, actorId, newOverlay);
  }

  // Update TacticalDoctrineComponent activeStanceGroups
  const existingDoctrine = getComponent(nextState, actorId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const updatedDoctrine = toggleConsoleStanceGroup(
    existingDoctrine,
    SHAPESHIFT_STANCE_GROUP_ID,
    formId === 'normal' ? '' : formId,
    formId === 'normal'
  );
  nextState = addComponent(nextState, actorId, updatedDoctrine);

  const formLabel =
    formId === 'normal'
      ? 'Normal Form'
      : formId === 'predator'
        ? 'Predator Form'
        : formId === 'aerial'
          ? 'Aerial Form'
          : 'Ferocious Slayer Form';

  return {
    state: addMessage(nextState, `Assumed ${formLabel}!`, MessageLogCategory.System),
    success: true
  };
}
