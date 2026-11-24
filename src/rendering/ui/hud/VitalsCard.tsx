import type { JSX } from 'preact';
import { getComponent } from '../../../core/ecs.ts';
import { getActiveRuleset } from '../../../rulesets/registry.ts';
import { getEffectiveWorldClockConfig } from '../../../systems/world_clock.system.ts';
import {
  ComponentType,
  type StatusEffectsComponent,
  type StatusEffectPolarity
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import type { ActiveEffectDisplayDTO } from '../../../types/ruleset.types.ts';
import { formatTurnDurationCompact, formatTurnDurationVerbose } from '../../../utils/duration.ts';
import { uiStore, useUiSelector } from '../core/ui_store.ts';
import { IconButton } from '../primitives/Button.tsx';
import { Badge, type BadgeTone, StatChip } from '../primitives/DataDisplay.tsx';

function polarityToBadgeTone(polarity: StatusEffectPolarity): BadgeTone {
  switch (polarity) {
    case 'buff':
      return 'success';
    case 'debuff':
      return 'danger';
    case 'mixed':
      return 'info';
    case 'neutral':
      return 'warning';
  }
}

function buildEffectBadgeTooltip(
  eff: ActiveEffectDisplayDTO,
  clock: ReturnType<typeof getEffectiveWorldClockConfig>
): string {
  const parts: string[] = [eff.label];
  if (eff.summary) parts.push(eff.summary);
  if (eff.durationTurns !== undefined || eff.isPermanent === true) {
    parts.push(formatTurnDurationVerbose(eff.durationTurns ?? 0, eff.isPermanent, clock));
  }
  return parts.join(' • ');
}

function buildFallbackStatusDTOs(state: GameState, playerId: EntityId): ReadonlyArray<ActiveEffectDisplayDTO> {
  const statuses = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  return (statuses?.activeEffects ?? []).map((eff) => {
    const def = state.campaign.status[eff.effectId];
    const polarity: StatusEffectPolarity = eff.polarity ?? (def?.detrimental ? 'debuff' : 'neutral');
    const summary = eff.summary ?? def?.description;
    return {
      id: eff.effectId,
      label: eff.displayName ?? def?.name ?? eff.effectId,
      polarity,
      durationTurns: eff.duration,
      ...(eff.isPermanent === true ? { isPermanent: true } : {}),
      ...(summary ? { summary } : {})
    };
  });
}

/** Props for `<VitalsCard />`. */
export interface VitalsCardProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly isHudFocused: boolean;
}

/**
 * Top-left Vitals & Status Effects HUD card.
 * Driven strictly by `getActiveRuleset(state).projectHudVitals(state, playerId)` with zero raw Fighter HP overwrites.
 */
export function VitalsCard({ state, playerId, isHudFocused }: VitalsCardProps): JSX.Element | null {
  const folded = useUiSelector((s) => Boolean(s.hudFolded['vitals']));
  const activeRuleset = getActiveRuleset(state);
  const vitals = activeRuleset.projectHudVitals(state, playerId);
  if (!vitals) return null;

  const clock = getEffectiveWorldClockConfig(state);
  const activeEffects = activeRuleset.projectActiveEffects
    ? activeRuleset.projectActiveEffects(state, playerId)
    : buildFallbackStatusDTOs(state, playerId);
  const hpPercent = Math.max(0, Math.min(100, vitals.hpPercent));
  const xpPercent = Math.max(0, Math.min(100, vitals.xpPercent));

  return (
    <section
      className="ui-hud-card ui-hud-zone"
      data-hud-zone="1"
      data-hud-focused={isHudFocused ? 'true' : undefined}
      aria-label="Player Vitals and Status"
    >
      <div className="ui-hud-card__header">
        <h3 className="ui-hud-card__title">Vitals &amp; Status</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Badge tone={hpPercent <= 25 ? 'danger' : hpPercent <= 50 ? 'warning' : 'success'}>
            {`${Math.round(hpPercent)}% HP`}
          </Badge>
          <IconButton
            ariaLabel={folded ? 'Expand Vitals panel' : 'Fold Vitals panel'}
            onClick={(): void => uiStore.toggleHudFolded('vitals')}
          >
            {folded ? '▸' : '▾'}
          </IconButton>
        </div>
      </div>

      {!folded ? (
        <div className="ui-hud-card__body">
          <div
            className="ui-meter-track"
            role="progressbar"
            aria-label="Hit Points"
            aria-valuemin={0}
            aria-valuemax={vitals.hpMax}
            aria-valuenow={vitals.hpCurrent}
          >
            <div className="ui-meter-fill--hp" style={{ width: `${hpPercent}%` }} />
            <div className="ui-meter-label">
              <span>HP</span>
              <span>{`${vitals.hpCurrent} / ${vitals.hpMax}`}</span>
            </div>
          </div>

          <div
            className="ui-meter-track"
            role="progressbar"
            aria-label="Experience"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(xpPercent)}
          >
            <div className="ui-meter-fill--xp" style={{ width: `${xpPercent}%` }} />
            <div className="ui-meter-label">
              <span>XP</span>
              <span>{vitals.xpText}</span>
            </div>
          </div>

          <div className="ui-vitals-grid">
            <StatChip label="LVL" value={vitals.levelLabel.replace(/^ECL\s+/i, '')} />
            <StatChip label={vitals.primaryStat.label} value={vitals.primaryStat.value} />
            <StatChip label={vitals.secondaryStat.label} value={vitals.secondaryStat.value} />
          </div>

          {activeEffects.length > 0 ? (
            <div className="ui-status-list" role="list" aria-label="Active status effects">
              {activeEffects.map((eff) => {
                const durSuffix =
                  eff.durationTurns !== undefined || eff.isPermanent === true
                    ? ` (${formatTurnDurationCompact(eff.durationTurns ?? 0, eff.isPermanent, clock)})`
                    : '';
                return (
                  <Badge
                    key={`${eff.id}_${eff.durationTurns ?? 'perm'}`}
                    tone={polarityToBadgeTone(eff.polarity)}
                    title={buildEffectBadgeTooltip(eff, clock)}
                  >
                    {`${eff.label}${durSuffix}`}
                  </Badge>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
