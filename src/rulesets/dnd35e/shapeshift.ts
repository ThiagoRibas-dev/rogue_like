/**
 * @file Druid Shapeshift Alternate Class Feature runtime form resolver (PHB II p. 39).
 * Grants at-will swift-action transformations into declarative `formOverlay` combat forms
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
import { syncDnD35eActorSpatialFootprint } from './spatial/footprint_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from './srd_registry.ts';
import type { DnD35EntityData, StatModifier } from './types/dnd35e.types.ts';
import {
  type DnD35ActivatedAbilityDescriptor,
  type DnD35ClassDefinition,
  type DnD35FormOverlayDescriptor,
  getDnD35SystemContent,
  getLastLoadedDnD35SystemContent
} from './types/dnd35e_system.types.ts';

/** Canonical identifier for Druid Shapeshift overlay in PropertyOverlayComponent. */
export const SHAPESHIFT_OVERLAY_SOURCE = 'acf:shapeshift';

/** Priority for Druid Shapeshift form overlay (`120`). */
export const SHAPESHIFT_OVERLAY_PRIORITY = 120;

/** Mutually exclusive stance group ID for Druid Shapeshift forms. */
export const SHAPESHIFT_STANCE_GROUP_ID = 'druid_shapeshift_form';

/** Available Shapeshift form identifiers (open string-compatible for custom JSON forms). */
export type DnD35ShapeshiftFormId =
  'predator' | 'aerial' | 'ferocious_slayer' | 'normal' | (string & Record<never, never>);

function normalizeShapeshiftFormKey(formId: string): string {
  return formId.startsWith('shapeshift_') ? formId.slice('shapeshift_'.length) : formId;
}

function findShapeshiftAbilityDescriptor(
  formId: string,
  classDefs?: ReadonlyArray<DnD35ClassDefinition>
): { readonly ability: DnD35ActivatedAbilityDescriptor; readonly classDef?: DnD35ClassDefinition } | undefined {
  const formKey = normalizeShapeshiftFormKey(formId);
  const targetAbilityId = `shapeshift_${formKey}`;
  const candidates =
    classDefs && classDefs.length > 0 ? classDefs : Object.values(getLastLoadedDnD35SystemContent()?.classes ?? {});

  for (const cls of candidates) {
    for (const detail of Object.values(cls.featureDetails ?? {})) {
      for (const act of detail.activatedAbilities ?? []) {
        if (act.toggleGroup !== SHAPESHIFT_STANCE_GROUP_ID && act.formOverlay === undefined) continue;
        if (act.abilityId === formId || act.abilityId === targetAbilityId) {
          return { ability: act, classDef: cls };
        }
      }
    }
  }
  return undefined;
}

function resolveActorShapeshiftClassContext(
  dndData: DnD35EntityData,
  formId: string,
  classesRegistry?: Readonly<Record<string, DnD35ClassDefinition>>
): {
  readonly classLevel: number;
  readonly ability: DnD35ActivatedAbilityDescriptor | undefined;
  readonly classDef: DnD35ClassDefinition | undefined;
} {
  const effectiveClasses = classesRegistry ?? getLastLoadedDnD35SystemContent()?.classes ?? {};
  const actorClassDefs: DnD35ClassDefinition[] = [];
  for (const track of dndData.tracks) {
    const cls = effectiveClasses[track.trackId];
    if (cls) actorClassDefs.push(cls);
  }
  const match =
    findShapeshiftAbilityDescriptor(formId, actorClassDefs) ??
    findShapeshiftAbilityDescriptor(formId, Object.values(effectiveClasses));
  const matchedTrack = match?.classDef ? dndData.tracks.find((t) => t.trackId === match.classDef!.id) : undefined;
  const totalLevels = dndData.tracks.reduce((sum, t) => sum + t.levels, 0);
  const classLevel = Math.max(1, matchedTrack?.levels ?? totalLevels);
  return {
    classLevel,
    ability: match?.ability,
    classDef: match?.classDef
  };
}

/**
 * Validates whether a Druid of the given level is eligible to assume `formId`
 * based on the declarative `minClassLevel` defined in class system JSON.
 *
 * @param druidLevel Current Druid class level.
 * @param formId Target Shapeshift form or ability ID.
 * @param druidClassDef Optional explicit class definition containing the `shapeshift` feature.
 * @returns True if eligible.
 */
export function isDruidShapeshiftEligible(
  druidLevel: number,
  formId: DnD35ShapeshiftFormId,
  druidClassDef?: DnD35ClassDefinition
): boolean {
  const formKey = normalizeShapeshiftFormKey(formId);
  if (formKey === 'normal') return true;
  const match = findShapeshiftAbilityDescriptor(formKey, druidClassDef ? [druidClassDef] : undefined);
  if (!match) return false;
  return druidLevel >= (match.ability.minClassLevel ?? 1);
}

function buildShapeshiftOverlayFromDescriptor(
  formKey: string,
  abilityId: string,
  formOverlay: DnD35FormOverlayDescriptor
): PropertyOverlayComponent {
  const statModifiers: StatModifier[] = formOverlay.modifiers.map((m) => ({
    targetStat: m.target as StatModifier['targetStat'],
    value: m.value,
    bonusType: m.type,
    sourceId: `${abilityId}:${m.id}`,
    sourcePath: `${SHAPESHIFT_OVERLAY_SOURCE}/form:${formKey}/${m.id}`,
    origin: 'su',
    ...(m.effectTags !== undefined ? { effectTags: m.effectTags } : {}),
    ...(m.condition !== undefined ? { condition: m.condition } : {})
  }));

  return {
    type: ComponentType.PropertyOverlay,
    source: SHAPESHIFT_OVERLAY_SOURCE,
    priority: SHAPESHIFT_OVERLAY_PRIORITY,
    ...(formOverlay.sizeCategory !== undefined ? { sizeCategoryOverride: formOverlay.sizeCategory } : {}),
    ...(formOverlay.footprint !== undefined ? { footprintOverride: formOverlay.footprint } : {}),
    ...(formOverlay.footprintsBySize !== undefined ? { footprintsBySizeOverride: formOverlay.footprintsBySize } : {}),
    ...(statModifiers.length > 0 ? { statModifiers } : {}),
    ...(formOverlay.movementModes !== undefined ? { movementModesOverride: formOverlay.movementModes } : {}),
    ...(formOverlay.naturalWeapons.length > 0 ? { naturalWeaponsOverride: formOverlay.naturalWeapons } : {}),
    ...(formOverlay.grantedTags.length > 0 ? { grantedTags: formOverlay.grantedTags } : {})
  };
}

/**
 * Transforms a Druid into a chosen Shapeshift form (or back to normal form) as an at-will swift action,
 * reading form modifiers, natural weapons, movement modes, and level gates from declarative class JSON.
 *
 * @param state Current immutable GameState.
 * @param actorId Entity performing the shapeshift.
 * @param formId Target form ID or ability ID (e.g. `'predator'`, `'shapeshift_aerial'`, `'normal'`).
 * @returns `{ state, success }`.
 */
export function executeDruidShapeshift(
  state: GameState,
  actorId: EntityId,
  formId: DnD35ShapeshiftFormId
): { readonly state: GameState; readonly success: boolean } {
  const dndData = getDnD35EntityData(state, actorId);
  const sysContent = getDnD35SystemContent(state.campaign) ?? getLastLoadedDnD35SystemContent();
  const hasShapeshiftTrait = (dndData.activeClassFeatures ?? []).some((featId) => {
    for (const track of dndData.tracks) {
      const abilities = sysContent?.classes[track.trackId]?.featureDetails?.[featId]?.activatedAbilities ?? [];
      if (abilities.some((a) => a.toggleGroup === SHAPESHIFT_STANCE_GROUP_ID || a.formOverlay !== undefined)) {
        return true;
      }
    }
    return false;
  });

  if (!hasShapeshiftTrait) {
    return {
      state: addMessage(state, 'You do not possess the Shapeshift ability.', MessageLogCategory.System),
      success: false
    };
  }

  const formKey = normalizeShapeshiftFormKey(formId);
  const { classLevel, ability, classDef } = resolveActorShapeshiftClassContext(dndData, formKey, sysContent?.classes);

  if (!isDruidShapeshiftEligible(classLevel, formKey, classDef)) {
    const requiredLevel = ability?.minClassLevel ?? 1;
    return {
      state: addMessage(
        state,
        `Cannot assume ${formKey} form (requires class level ${requiredLevel}, current level ${classLevel}).`,
        MessageLogCategory.System
      ),
      success: false
    };
  }

  if (formKey !== 'normal' && !ability?.formOverlay) {
    return {
      state: addMessage(state, `Unknown Shapeshift form "${formKey}".`, MessageLogCategory.System),
      success: false
    };
  }

  let nextBudget = dndData.actionBudget;
  if (state.engineMode === EngineMode.TurnBased || nextBudget !== undefined) {
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

  if (formKey === 'normal') {
    if (existingOverlay && existingOverlay.source === SHAPESHIFT_OVERLAY_SOURCE) {
      nextState = removeComponent(nextState, actorId, ComponentType.PropertyOverlay);
    }
  } else if (ability?.formOverlay) {
    const newOverlay = buildShapeshiftOverlayFromDescriptor(formKey, ability.abilityId, ability.formOverlay);
    nextState = addComponent(nextState, actorId, newOverlay);
  }
  nextState = syncDnD35eActorSpatialFootprint(nextState, actorId);

  // Update TacticalDoctrineComponent activeStanceGroups
  const existingDoctrine = getComponent(nextState, actorId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;
  const updatedDoctrine = toggleConsoleStanceGroup(
    existingDoctrine,
    SHAPESHIFT_STANCE_GROUP_ID,
    formKey === 'normal' ? '' : formKey,
    formKey === 'normal'
  );
  nextState = addComponent(nextState, actorId, updatedDoctrine);

  const formLabel =
    formKey === 'normal'
      ? (ability?.shortLabel ?? 'Normal Form')
      : (ability?.shortLabel ?? ability?.name ?? `${formKey} Form`);

  return {
    state: addMessage(nextState, `Assumed ${formLabel}!`, MessageLogCategory.System),
    success: true
  };
}
