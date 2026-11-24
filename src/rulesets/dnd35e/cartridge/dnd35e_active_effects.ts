import { getComponent } from '../../../core/ecs.ts';
import {
  ComponentType,
  type ActiveStatusEffect,
  type PropertyOverlayComponent,
  type StatusEffectsComponent,
  type StatusEffectPolarity
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ActiveEffectDisplayDTO } from '../../../types/ruleset.types.ts';
import { summarizeConditionEffects } from '../combat/maneuvers_conditions.ts';
import { evaluateActiveSpellAuraContributions } from '../magic/spell_aura_resolver.ts';
import { POLARITY_COLORS } from '../magic/spell_duration.ts';
import { revokeModifiersByPathPrefix } from '../modifiers/provenance.ts';
import { syncDnD35eActorSpatialFootprint } from '../spatial/footprint_resolver.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../srd_registry.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';
import { evaluateDnD35eEntityDAG } from './dnd35e_dag_adapter.ts';

function resolveStatusPolarity(
  eff: ActiveStatusEffect,
  def: { readonly detrimental?: boolean } | undefined
): StatusEffectPolarity {
  if (eff.polarity !== undefined) return eff.polarity;
  if (def !== undefined) return def.detrimental === true ? 'debuff' : 'buff';
  return 'neutral';
}

function formatOverlayLabel(source: string): string {
  const parts = source.split(':');
  const rawName = parts[1] ?? source;
  return rawName
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildConditionSummaryTooltip(cond: string, condSummary: ReturnType<typeof summarizeConditionEffects>): string {
  const parts: string[] = [];
  if (condSummary.meleeAttackPenalty < 0) parts.push(`${condSummary.meleeAttackPenalty} Attack`);
  if (condSummary.acPenalty < 0) parts.push(`${condSummary.acPenalty} AC`);
  if (condSummary.strPenalty > 0) parts.push(`-${condSummary.strPenalty} STR`);
  if (condSummary.dexPenalty > 0) parts.push(`-${condSummary.dexPenalty} DEX`);
  if (condSummary.losesDexToAC) parts.push('Loses DEX to AC');
  if (!condSummary.canTakeActions) parts.push('Incapacitated');
  return parts.length > 0 ? `${cond.toUpperCase()}: ${parts.join(', ')}` : cond.toUpperCase();
}

/**
 * Revokes D&D 3.5e spell `StatModifier`s, spell-linked `dndData.conditions` (unless still sustained
 * by another active effect), and synchronizes spatial footprints when a timed `ActiveStatusEffect` expires.
 *
 * @param state Current immutable GameState (after status expiry update).
 * @param entityId Entity whose status expired.
 * @param expiredEffect The expired `ActiveStatusEffect` entry.
 * @returns Updated GameState.
 */
export function onDnD35eStatusEffectExpired(
  state: GameState,
  entityId: EntityId,
  expiredEffect: ActiveStatusEffect
): GameState {
  if (!expiredEffect.sourcePath && !expiredEffect.linkedConditionId) {
    return state;
  }

  let nextState = state;
  const dndData = getDnD35EntityData(nextState, entityId);
  let nextModifiers = dndData.statModifiers ?? [];
  let changed = false;

  if (expiredEffect.sourcePath) {
    const cleaned = revokeModifiersByPathPrefix(nextModifiers, expiredEffect.sourcePath);
    if (cleaned.length !== nextModifiers.length) {
      nextModifiers = cleaned;
      changed = true;
    }
  }

  let nextConditions = dndData.conditions ?? [];
  if (expiredEffect.linkedConditionId) {
    const remainingStatuses = getComponent(nextState, entityId, ComponentType.StatusEffects) as
      StatusEffectsComponent | undefined;
    const stillSustained =
      remainingStatuses?.activeEffects.some((eff) => eff.linkedConditionId === expiredEffect.linkedConditionId) ??
      false;
    if (!stillSustained && nextConditions.includes(expiredEffect.linkedConditionId as never)) {
      nextConditions = nextConditions.filter((c) => c !== expiredEffect.linkedConditionId);
      changed = true;
    }
  }

  if (changed) {
    nextState = setDnD35EntityData(nextState, entityId, {
      ...dndData,
      statModifiers: nextModifiers,
      conditions: nextConditions
    });
    nextState = syncDnD35eActorSpatialFootprint(nextState, entityId);
  }

  return nextState;
}

/**
 * Projects unified active buffs, debuffs, conditions, form overlays, and spatial emanation auras
 * affecting `entityId` for Tier 1 HUD Vitals, Inspect Tooltips, and D&D 3.5e Character Sheet displays.
 *
 * @param state Current immutable GameState.
 * @param entityId Target actor EntityId.
 * @returns Array of `ActiveEffectDisplayDTO` sorted cleanly for UI presentation.
 */
export function projectDnD35eActiveEffects(
  state: Readonly<GameState>,
  entityId: EntityId
): ReadonlyArray<ActiveEffectDisplayDTO> {
  const results: ActiveEffectDisplayDTO[] = [];
  const dndData = getDnD35EntityData(state, entityId);
  const statuses = getComponent(state, entityId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  const sysContent = getDnD35SystemContent(state.campaign);
  const linkedConditionIds = new Set<string>();

  for (const eff of statuses?.activeEffects ?? []) {
    if (eff.linkedConditionId) {
      linkedConditionIds.add(eff.linkedConditionId);
    }
    const def = state.campaign.status[eff.effectId];
    const polarity = resolveStatusPolarity(eff, def);
    const label = eff.displayName ?? def?.name ?? eff.effectId.replace(/_/g, ' ');
    const summary = eff.summary ?? def?.description;
    results.push({
      id: eff.effectId,
      label,
      polarity,
      durationTurns: eff.duration,
      ...(eff.isPermanent === true ? { isPermanent: true } : {}),
      ...(summary ? { summary } : {}),
      sourceLabel: eff.sourcePath?.startsWith('spell:') ? 'Spell' : 'Status',
      color: eff.color ?? def?.color ?? POLARITY_COLORS[polarity]
    });
  }

  const unlinkedConditions = (dndData.conditions ?? []).filter((c) => !linkedConditionIds.has(c));
  if (unlinkedConditions.length > 0) {
    const condSummary = summarizeConditionEffects(unlinkedConditions, sysContent?.conditionEffects);
    for (const cond of unlinkedConditions) {
      results.push({
        id: `cond:${cond}`,
        label: cond.toUpperCase().replace(/_/g, ' '),
        polarity: 'debuff',
        summary: buildConditionSummaryTooltip(cond, condSummary),
        sourceLabel: 'Condition',
        color: POLARITY_COLORS.debuff
      });
    }
  }

  const overlay = getComponent(state, entityId, ComponentType.PropertyOverlay) as PropertyOverlayComponent | undefined;
  if (overlay) {
    const formTag = overlay.grantedTags?.find((t) => t.startsWith('form:'))?.slice('form:'.length);
    const isPerm = overlay.durationTurns === undefined;
    results.push({
      id: `overlay:${overlay.source}`,
      label: formatOverlayLabel(overlay.source),
      polarity: 'mixed',
      ...(overlay.durationTurns !== undefined ? { durationTurns: overlay.durationTurns } : {}),
      ...(isPerm ? { isPermanent: true } : {}),
      summary: formTag ? `Form: ${formTag.replace(/_/g, ' ')}` : 'Active form transformation',
      sourceLabel: 'Form',
      color: POLARITY_COLORS.mixed
    });
  }

  const dag = evaluateDnD35eEntityDAG(state as GameState, entityId);
  const auraContrib = evaluateActiveSpellAuraContributions(state as GameState, entityId, dag?.selfTags ?? []);
  for (const aura of auraContrib.activeAuras) {
    if (results.some((r) => r.id === `spell:${aura.spellId}`)) continue;
    results.push({
      id: `aura:${aura.spellId}:${aura.fieldEntityId}`,
      label: aura.spellName,
      polarity: aura.polarity,
      durationTurns: aura.remainingTurns,
      isAura: true,
      summary: `${aura.summary} (Aura)`,
      sourceLabel: 'Aura',
      color: aura.color
    });
  }

  return results;
}
