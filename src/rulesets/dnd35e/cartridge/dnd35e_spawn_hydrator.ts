import { addComponent, getComponent } from '../../../core/ecs.ts';
import { ComponentType, type FighterComponent, type RulesetDataComponent } from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import {
  buildAbilityScoresRecord,
  getDnD35Archetype,
  hydrateArchetypeData,
  hydrateRaceAsArchetype
} from '../archetype_resolver.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';
import { DND35E_BASE_AC } from '../modifiers.ts';
import { aggregateProgressionChassis } from '../progression.ts';
import { computeDnD35eCrXp } from '../progression/cr_xp_table.ts';
import { syncDnD35eActorSpatialFootprint } from '../spatial/footprint_resolver.ts';
import { getDnD35Race, getDnD35Template, setDnD35EntityData } from '../srd_registry.ts';
import { applyCreatureTemplate } from '../templates.ts';
import type { AbilityScoresRecord, DnD35EntityData } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

interface RawClassLevelSpec {
  readonly classId: string;
  readonly levels: number;
}

interface RawAbilityScoresInput {
  readonly str: number | null;
  readonly dex: number | null;
  readonly con: number | null;
  readonly int: number | null;
  readonly wis: number | null;
  readonly cha: number | null;
}

function isSimpleAbilityScoresInput(raw: unknown): raw is RawAbilityScoresInput {
  if (typeof raw !== 'object' || raw === null) return false;
  const rec = raw as Record<string, unknown>;
  return 'str' in rec && (typeof rec['str'] === 'number' || rec['str'] === null);
}

function normalizeTemplateRulesetOverrides(raw: Record<string, unknown>): Partial<DnD35EntityData> {
  const { classLevels: _cl, templates: _tpls, abilityScores: rawAbilities, ...rest } = raw;

  const out: Record<string, unknown> = { ...rest };
  if (isSimpleAbilityScoresInput(rawAbilities)) {
    out['abilityScores'] = buildAbilityScoresRecord(rawAbilities);
  } else if (rawAbilities !== undefined) {
    out['abilityScores'] = rawAbilities as AbilityScoresRecord;
  }
  return out as Partial<DnD35EntityData>;
}

/**
 * Hydrates a newly spawned entity's `RulesetDataComponent` (`DnD35EntityData`) and syncs its
 * `FighterComponent` combat stats (`maxHp`, `hp`, `level`, `attack`, `defense`, `xpGiven`)
 * directly from its D&D 3.5e race/class tracks, creature templates, ability scores, feats, and gear.
 *
 * Implements `RulesetContract.onEntitySpawned`.
 */
export function onDnD35eEntitySpawned(state: GameState, entityId: EntityId): GameState {
  // Player creation is hydrated via builder_hydrator_creation.ts
  if (getComponent(state, entityId, ComponentType.Player) !== undefined) {
    return state;
  }

  const templateComp = getComponent(state, entityId, ComponentType.Template);
  const template = templateComp ? state.campaign.entities[templateComp.templateId] : undefined;
  if (!template) return state;

  const existingRuleset = getComponent(state, entityId, ComponentType.RulesetData) as RulesetDataComponent | undefined;
  const hasExplicitArchetype = template.archetypeId !== undefined || template.rulesetData !== undefined;
  if (!hasExplicitArchetype && !existingRuleset) {
    return state;
  }

  const sysContent = state.campaign.systemContent;
  const archetypeKey = template.archetypeId ?? template.id;
  const rawRulesetData = template.rulesetData;
  const classLevels = Array.isArray(rawRulesetData?.['classLevels'])
    ? (rawRulesetData['classLevels'] as ReadonlyArray<RawClassLevelSpec>)
    : undefined;

  let baseData: DnD35EntityData | undefined;
  let resolvedCr: number | undefined;

  const raceDef = getDnD35Race(sysContent, archetypeKey);
  if (raceDef && classLevels && classLevels.length > 0) {
    const hydratedArch = hydrateRaceAsArchetype(sysContent, raceDef, { classLevels });
    resolvedCr = hydratedArch.cr;
    baseData = hydrateArchetypeData(hydratedArch, undefined, sysContent);
  } else {
    const arch = getDnD35Archetype(sysContent, archetypeKey) ?? getDnD35Archetype(sysContent, 'default_creature');
    if (arch) {
      resolvedCr = arch.cr;
      baseData = hydrateArchetypeData(arch, undefined, sysContent);
    }
  }

  if (!baseData) return state;

  let dndData: DnD35EntityData = {
    ...baseData,
    archetypeId: template.archetypeId ?? baseData.archetypeId,
    ...(resolvedCr !== undefined ? { cr: resolvedCr } : {})
  };

  if (rawRulesetData) {
    const overrides = normalizeTemplateRulesetOverrides(rawRulesetData);
    dndData = {
      ...dndData,
      ...overrides
    };
  }

  const parsedSysContent = getDnD35SystemContent(state.campaign);
  const templateIds = Array.isArray(rawRulesetData?.['templates'])
    ? (rawRulesetData['templates'] as ReadonlyArray<string>)
    : undefined;
  if (templateIds && templateIds.length > 0) {
    for (const tplId of templateIds) {
      const tplDef = getDnD35Template(sysContent, tplId);
      if (tplDef) {
        dndData = applyCreatureTemplate(
          dndData,
          tplDef,
          parsedSysContent ? { sysContent: parsedSysContent } : undefined
        );
      }
    }
  }

  const finalCr = typeof rawRulesetData?.['cr'] === 'number' ? rawRulesetData['cr'] : dndData.cr;
  if (finalCr !== undefined) {
    dndData = { ...dndData, cr: finalCr };
  }

  let nextState = setDnD35EntityData(state, entityId, dndData);

  const fighter = getComponent(nextState, entityId, ComponentType.Fighter) as FighterComponent | undefined;
  if (fighter) {
    // Evaluate DAG with baseMaxHp = 0 so HD + Con + Improved Toughness / Construct bonus HP drives maxHp
    const scratchState = addComponent(nextState, entityId, {
      ...fighter,
      maxHp: 0,
      hp: 0
    });
    const evaluated = evaluateDnD35eEntityDAG(scratchState, entityId);
    const chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0);
    const ecl = Math.max(1, chassis.ecl);
    const effectiveCr = finalCr ?? ecl;

    const syncedMaxHp = evaluated ? Math.max(1, evaluated.dagResult.maxHp) : Math.max(1, fighter.maxHp);
    const syncedAttack = evaluated ? evaluated.dagResult.attackBonus : fighter.attack;
    const syncedDefense = evaluated ? evaluated.dagResult.acBreakdown.fullAC - DND35E_BASE_AC : fighter.defense;
    const syncedXpGiven =
      template.fighter?.xpGiven !== undefined && template.fighter.xpGiven > 0
        ? template.fighter.xpGiven
        : computeDnD35eCrXp(effectiveCr, Math.max(1, Math.round(effectiveCr)));

    nextState = addComponent(nextState, entityId, {
      ...fighter,
      maxHp: syncedMaxHp,
      hp: syncedMaxHp,
      level: ecl,
      attack: syncedAttack,
      defense: syncedDefense,
      xpGiven: syncedXpGiven
    });
  }

  nextState = syncDnD35eActorSpatialFootprint(nextState, entityId);
  return nextState;
}
