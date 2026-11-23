/**
 * @file D&D 3.5e Character Sheet Tab 2:
 * Feats, Class/Domain/Racial Traits, and Horizon 1 Level-by-Level Progression Matrix.
 */

import type { JSX } from 'preact';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { Badge } from '../../primitives/DataDisplay.tsx';
import { classifyDnD35eFeatCategory } from './DnD35eInspector.tsx';

/** Props for `<DnD35eSheetProgressionTab />`. */
export interface DnD35eSheetProgressionTabProps {
  readonly state: GameState;
  readonly playerId: EntityId;
}

/**
 * Tab 2 of the D&D 3.5e Character Sheet: Feats, Traits, and Level Progression Matrix.
 */
export function DnD35eSheetProgressionTab({ state, playerId }: DnD35eSheetProgressionTabProps): JSX.Element {
  const dndData = getDnD35EntityData(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const featRegistry = sys?.feats ?? {};
  const history = dndData.levelHistory ?? [];

  let runningLevel = 1;
  const fallbackTrackRows = dndData.tracks.map((trk) => {
    const start = runningLevel;
    const end = runningLevel + trk.levels - 1;
    runningLevel += trk.levels;
    return {
      key: `${trk.trackId}_${start}`,
      levelRange: `${start}–${end}`,
      trackLabel: trk.trackId.toUpperCase(),
      hpLabel: `d${trk.hitDieSides}`,
      skillsLabel: `${Object.keys(dndData.skillRanks).length} trn`,
      gainsLabel: (dndData.feats ?? []).join(', ') || 'Baseline'
    };
  });

  return (
    <div className="ui-dnd-sheet-2col">
      <div className="ui-dnd-col">
        <div className="ui-dnd-subbanner">{`Feats (${dndData.feats.length})`}</div>
        <div className="ui-dnd-card-list">
          {dndData.feats.length === 0 ? (
            <div className="ui-dnd-card__sub">No feats selected.</div>
          ) : (
            dndData.feats.map((featId) => {
              const def = featRegistry[featId];
              let badgeLabel = 'FEAT';
              let badgeTone: 'neutral' | 'info' | 'warning' = 'neutral';
              if (def) {
                const cat = classifyDnD35eFeatCategory(def);
                if (cat.isMagic) {
                  badgeLabel = 'MAGIC';
                  badgeTone = 'info';
                } else if (cat.isFighterBonus || cat.isCombat) {
                  badgeLabel = 'COMBAT';
                  badgeTone = 'warning';
                }
              }
              return (
                <div key={featId} className="ui-dnd-card" title={def?.description}>
                  <div className="ui-dnd-card__row">
                    <span className="ui-dnd-card__title">{`⭐ ${def?.name ?? featId.replace(/_/g, ' ')}`}</span>
                    <Badge tone={badgeTone}>{badgeLabel}</Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="ui-dnd-subbanner">Class, Domain &amp; Racial Traits</div>
        <div className="ui-dnd-card-list">
          {(dndData.activeClassFeatures ?? []).map((cfId) => (
            <div key={cfId} className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span className="ui-dnd-card__title">{`🛡️ ${cfId.replace(/_/g, ' ')}`}</span>
                <Badge tone="accent">CLASS</Badge>
              </div>
            </div>
          ))}
          {(dndData.domains ?? []).map((domId) => (
            <div key={domId} className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span className="ui-dnd-card__title">{`☀️ ${domId.toUpperCase()} Domain`}</span>
                <Badge tone="warning">DOMAIN</Badge>
              </div>
            </div>
          ))}
          {dndData.raceId ? (
            <div className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span className="ui-dnd-card__title">{`⚥ ${dndData.raceId.toUpperCase()} Heritage`}</span>
                <Badge tone="info">RACE</Badge>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ui-dnd-col">
        <div className="ui-dnd-subbanner">Level Progression</div>
        <div className="ui-dnd-table-scroll ui-dnd-table-scroll--tall">
          <table className="ui-dnd-table">
            <thead>
              <tr>
                <th>Lvl</th>
                <th>Class / HD</th>
                <th>HP</th>
                <th>Skills</th>
                <th>Feats &amp; Gained</th>
              </tr>
            </thead>
            <tbody>
              {history.length > 0
                ? history.map((entry) => {
                    const skPts = Object.values(entry.addedSkillRanks ?? {}).reduce((a, b) => a + b, 0);
                    const gains =
                      [...entry.selectedFeats, ...entry.selectedAcfs].map((g) => g.replace(/_/g, ' ')).join(', ') ||
                      'Base Chassis';
                    return (
                      <tr key={`${entry.characterLevel}_${entry.classId}`}>
                        <td className="ui-dnd-mono">{entry.characterLevel}</td>
                        <td>{`${entry.classId} ${entry.classLevel}`}</td>
                        <td className="ui-dnd-mono">{`+${entry.hpRolled}`}</td>
                        <td className="ui-dnd-mono">{`${skPts} pts`}</td>
                        <td>{gains}</td>
                      </tr>
                    );
                  })
                : fallbackTrackRows.map((row) => (
                    <tr key={row.key}>
                      <td className="ui-dnd-mono">{row.levelRange}</td>
                      <td>{row.trackLabel}</td>
                      <td className="ui-dnd-mono">{row.hpLabel}</td>
                      <td className="ui-dnd-mono">{row.skillsLabel}</td>
                      <td>{row.gainsLabel}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
