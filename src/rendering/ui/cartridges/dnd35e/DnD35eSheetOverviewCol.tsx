/**
 * @file D&D 3.5e Character Sheet Column 1:
 * Identity, Vitals, Defenses & Saves, Active Conditions, Ability Scores, and Skills.
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { getComponent } from '../../../../core/ecs.ts';
import type { evaluateDnD35eEntityDAG } from '../../../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { summarizeConditionEffects } from '../../../../rulesets/dnd35e/combat/maneuvers_conditions.ts';
import { aggregateProgressionChassis, computeXpThresholdForLevel } from '../../../../rulesets/dnd35e/progression.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { ALL_ABILITY_IDS } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import {
  ComponentType,
  type FighterComponent,
  type IdentityComponent,
  type StatusEffectsComponent
} from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import type { UICharacterSheetModel } from '../../../../types/ui_adapter.types.ts';
import { renderSpriteToDataUrl } from '../../../sprite_atlas.ts';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';

const DEFAULT_ABILITY_SCORE = 10;
const PORTRAIT_SIZE_PX = 48;

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

function buildConditionTooltip(cond: string, condSummary: ReturnType<typeof summarizeConditionEffects>): string {
  const parts: string[] = [];
  if (condSummary.meleeAttackPenalty < 0) parts.push(`${condSummary.meleeAttackPenalty} Attack`);
  if (condSummary.acPenalty < 0) parts.push(`${condSummary.acPenalty} AC`);
  if (condSummary.strPenalty > 0) parts.push(`-${condSummary.strPenalty} STR`);
  if (condSummary.dexPenalty > 0) parts.push(`-${condSummary.dexPenalty} DEX`);
  if (condSummary.losesDexToAC) parts.push('Loses DEX to AC');
  if (!condSummary.canTakeActions) parts.push('Incapacitated');
  return parts.length > 0 ? `${cond.toUpperCase()}: ${parts.join(', ')}` : cond.toUpperCase();
}

/** Props for `<DnD35eSheetOverviewCol />`. */
export interface DnD35eSheetOverviewColProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly evalResult: ReturnType<typeof evaluateDnD35eEntityDAG>;
  readonly sheetModel: UICharacterSheetModel;
}

/**
 * Column 1 of the D&D 3.5e Character Sheet: Identity, Defenses, Conditions, Abilities & Skills.
 */
export function DnD35eSheetOverviewCol({
  state,
  playerId,
  evalResult,
  sheetModel
}: DnD35eSheetOverviewColProps): JSX.Element {
  const [showTrainedOnly, setShowTrainedOnly] = useState<boolean>(false);

  const dndData = getDnD35EntityData(state, playerId);
  const identity = getComponent(state, playerId, ComponentType.Identity) as IdentityComponent | undefined;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;
  const statusComp = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const xpCurr = fighter?.xp ?? 0;
  const xpNext = computeXpThresholdForLevel(chassis.ecl + 1);
  const trackSummary = dndData.tracks.map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Adventurer 1';

  const portraitUrl =
    sheetModel.portraitUrl ??
    (sheetModel.spriteId !== undefined ? renderSpriteToDataUrl(sheetModel.spriteId, PORTRAIT_SIZE_PX) : undefined);

  const vitals: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: 'HP', value: `${fighter?.hp ?? chassis.maxHp} / ${fighter?.maxHp ?? chassis.maxHp}` },
    { label: 'XP', value: `${xpCurr.toLocaleString()} / ${xpNext.toLocaleString()}` },
    { label: 'INIT', value: formatSigned(evalResult?.dagResult.effectiveAbilityModifiers.dex ?? 0) },
    { label: 'SPEED', value: '30 ft' }
  ];

  const acBreakdown = evalResult?.dagResult.acBreakdown;
  const saves = evalResult?.dagResult.saves;
  const defenses: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: 'AC', value: `${acBreakdown?.fullAC ?? 10}` },
    { label: 'Touch', value: `${acBreakdown?.touchAC ?? 10}` },
    { label: 'Flat', value: `${acBreakdown?.flatFootedAC ?? 10}` },
    { label: 'Fort', value: formatSigned(saves?.fort ?? chassis.baseSaves.fort) },
    { label: 'Ref', value: formatSigned(saves?.ref ?? chassis.baseSaves.ref) },
    { label: 'Will', value: formatSigned(saves?.will ?? chassis.baseSaves.will) },
    { label: 'BAB', value: formatSigned(chassis.totalBab) },
    {
      label: 'Grapple',
      value: formatSigned(chassis.totalBab + (evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0))
    }
  ];

  const conditions = dndData.conditions ?? [];
  const activeEffects = statusComp?.activeEffects ?? [];
  const condSummary = conditions.length > 0 ? summarizeConditionEffects(conditions) : undefined;
  const skills = (sheetModel.skillRows ?? []).filter((s) => (showTrainedOnly ? s.ranks > 0 : true));

  return (
    <div className="ui-dnd-col">
      <div className="ui-dnd-id-row">
        <div
          className="ui-dnd-portrait"
          style={
            portraitUrl
              ? { backgroundImage: `url(${portraitUrl})` }
              : sheetModel.glyphColor
                ? { color: sheetModel.glyphColor }
                : undefined
          }
          aria-hidden="true"
        >
          {portraitUrl ? '' : (sheetModel.glyph ?? '👤')}
        </div>
        <div className="ui-dnd-id-meta">
          <h3 className="ui-dnd-id-name">{sheetModel.name || identity?.name || 'Adventurer'}</h3>
          <div className="ui-dnd-id-sub">
            {`${(dndData.alignment ?? 'NG').toUpperCase().replace(/_/g, ' ')} ${(dndData.raceId ?? 'human').toUpperCase()} • ${trackSummary} (ECL ${chassis.ecl})`}
          </div>
          {identity?.mannerisms && identity.mannerisms.length > 0 ? (
            <div className="ui-dnd-id-traits">{`Traits: ${identity.mannerisms.join(' • ')}`}</div>
          ) : null}
        </div>
      </div>

      <div className="ui-dnd-stat-grid">
        {vitals.map((v) => (
          <div key={v.label} className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">{v.label}</span>
            <span className="ui-dnd-stat-box__val">{v.value}</span>
          </div>
        ))}
      </div>

      <div className="ui-dnd-subbanner">Defenses &amp; Saves</div>
      <div className="ui-dnd-stat-grid ui-dnd-stat-grid--4">
        {defenses.map((d) => (
          <div key={d.label} className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">{d.label}</span>
            <span className="ui-dnd-stat-box__val">{d.value}</span>
          </div>
        ))}
      </div>

      <div className="ui-dnd-subbanner">Active Conditions</div>
      <div className="ui-dnd-chip-row">
        {conditions.length === 0 && activeEffects.length === 0 ? (
          <Badge tone="neutral">Normal</Badge>
        ) : (
          <>
            {conditions.map((cond) => (
              <span key={cond} title={condSummary ? buildConditionTooltip(cond, condSummary) : cond.toUpperCase()}>
                <Badge tone="danger">{cond.toUpperCase()}</Badge>
              </span>
            ))}
            {activeEffects.map((eff) => (
              <Badge key={`${eff.effectId}_${eff.duration}`} tone="info">
                {`${eff.effectId} (${eff.duration}t)`}
              </Badge>
            ))}
          </>
        )}
      </div>

      <div className="ui-dnd-subbanner">Ability Scores</div>
      <div className="ui-dnd-stat-grid">
        {ALL_ABILITY_IDS.map((ab) => {
          const scoreVal = evalResult?.dagResult.effectiveAbilities[ab]?.base ?? DEFAULT_ABILITY_SCORE;
          const modVal = evalResult?.dagResult.effectiveAbilityModifiers[ab] ?? 0;
          return (
            <div key={ab} className="ui-dnd-attr-cell">
              <span className="ui-dnd-attr-cell__name">{ab.toUpperCase()}</span>
              <span>{scoreVal}</span>
              <span className="ui-dnd-attr-cell__mod">{`(${formatSigned(modVal)})`}</span>
            </div>
          );
        })}
      </div>

      <div className="ui-dnd-subbanner">
        <span>Skills</span>
        <Chip active={showTrainedOnly} onClick={() => setShowTrainedOnly((prev) => !prev)}>
          {showTrainedOnly ? 'Trained Only' : 'All Skills'}
        </Chip>
      </div>
      <div className="ui-dnd-table-scroll">
        <table className="ui-dnd-table">
          <thead>
            <tr>
              <th title="Class Skill">CS</th>
              <th>Skill</th>
              <th>Key</th>
              <th>Tot</th>
              <th>Rnks</th>
            </tr>
          </thead>
          <tbody>
            {skills.map((skill) => (
              <tr key={skill.id}>
                <td title={skill.isClassSkill ? 'Class Skill' : 'Cross-Class'}>{skill.isClassSkill ? '■' : '□'}</td>
                <td>{skill.name}</td>
                <td className="ui-dnd-mono">{skill.keyAbility.toUpperCase()}</td>
                <td className="ui-dnd-mono">{formatSigned(skill.totalModifier)}</td>
                <td className="ui-dnd-mono">{skill.ranks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
