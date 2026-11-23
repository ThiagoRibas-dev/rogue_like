/**
 * @file D&D 3.5e Character Sheet Tab 3:
 * Companions, Familiars, Cohorts & Summons roster table.
 */

import type { JSX } from 'preact';
import { getComponent, resolveEntityDisplayName } from '../../../../core/ecs.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getPlayerCompanions } from '../../../../systems/companion_commands.system.ts';
import {
  ComponentType,
  type ControllerLinkComponent,
  type FighterComponent,
  type PositionComponent
} from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { Badge } from '../../primitives/DataDisplay.tsx';

function formatStance(stance?: string): {
  readonly label: string;
  readonly tone: 'danger' | 'info' | 'neutral' | 'warning';
} {
  switch (stance) {
    case 'aggressive':
      return { label: 'Aggressive', tone: 'danger' };
    case 'passive':
      return { label: 'Passive', tone: 'neutral' };
    case 'hold':
      return { label: 'Hold Position', tone: 'warning' };
    case 'defensive':
    default:
      return { label: 'Defensive', tone: 'info' };
  }
}

/** Props for `<DnD35eSheetCompanionsTab />`. */
export interface DnD35eSheetCompanionsTabProps {
  readonly state: GameState;
  readonly playerId: EntityId;
}

/**
 * Tab 3 of the D&D 3.5e Character Sheet: Companions, Familiars, Cohorts & Summons.
 */
export function DnD35eSheetCompanionsTab({ state, playerId }: DnD35eSheetCompanionsTabProps): JSX.Element {
  const companions = getPlayerCompanions(state, playerId);
  const pPos = getComponent(state, playerId, ComponentType.Position) as PositionComponent | undefined;

  return (
    <div className="ui-dnd-col">
      <div className="ui-dnd-subbanner">{`Companions & Summons (${companions.length})`}</div>
      {companions.length === 0 ? (
        <div className="ui-dnd-card__sub">No active animal companions, familiars, cohorts, or summons.</div>
      ) : (
        <div className="ui-dnd-table-scroll ui-dnd-table-scroll--tall">
          <table className="ui-dnd-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type / HD</th>
                <th>HP</th>
                <th>Stance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {companions.map((compId) => {
                const fighter = getComponent(state, compId, ComponentType.Fighter) as FighterComponent | undefined;
                const link = getComponent(state, compId, ComponentType.ControllerLink) as
                  ControllerLinkComponent | undefined;
                const cPos = getComponent(state, compId, ComponentType.Position) as PositionComponent | undefined;
                const dndData = getDnD35EntityData(state, compId);

                const name = resolveEntityDisplayName(state, compId, 'Companion');
                const trackDesc =
                  dndData.tracks.map((t) => `${t.trackId.toUpperCase()} ${t.levels} HD`).join(', ') ||
                  (dndData.raceId ? dndData.raceId.toUpperCase() : 'Ally');

                let distText = 'Present';
                if (pPos && cPos) {
                  const dist = Math.max(Math.abs(pPos.x - cPos.x), Math.abs(pPos.y - cPos.y));
                  distText = dist <= 1 ? 'Following (Adjacent)' : `Following (${dist} tiles)`;
                }

                const stanceInfo = formatStance(link?.stance);

                return (
                  <tr key={compId}>
                    <td>
                      <strong>{name}</strong>
                    </td>
                    <td>{trackDesc}</td>
                    <td className="ui-dnd-mono">{fighter ? `${fighter.hp} / ${fighter.maxHp}` : '—'}</td>
                    <td>
                      <Badge tone={stanceInfo.tone}>{stanceInfo.label}</Badge>
                    </td>
                    <td>{distText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
