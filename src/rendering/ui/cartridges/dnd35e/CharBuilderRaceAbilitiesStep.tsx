/**
 * @file Character Creation Steps 1 (Race) & 3 (Ability Scores) for D&D 3.5e (Milestone 164).
 */

import type { JSX } from 'preact';
import { computeAbilityModifier } from '../../../../rulesets/dnd35e/abilities.ts';
import {
  calculateLevelSkillPointBudget,
  calculatePointBuyCost,
  type CharacterCreationDraft,
  ELITE_ABILITY_ARRAY,
  POINT_BUY_MAX_SCORE,
  POINT_BUY_MIN_SCORE,
  POINT_BUY_PRESETS,
  rollAbilityScores4d6DropLowest
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { ALL_ABILITY_IDS } from '../../../../rulesets/dnd35e/types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { Stepper } from '../../primitives/Stepper.tsx';
import { DnD35eRaceInspector } from './DnD35eInspector.tsx';

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Props for `<CharBuilderRaceStep />`. */
export interface CharBuilderRaceStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly showMonstrousRaces: boolean;
  readonly onToggleMonstrousRaces: () => void;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Step 1 (Race Selection) of the D&D 3.5e Character Creation Wizard.
 */
export function CharBuilderRaceStep({
  state,
  draft,
  showMonstrousRaces,
  onToggleMonstrousRaces,
  onUpdateDraft
}: CharBuilderRaceStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return null;

  const allRaces = Object.values(sys.races);
  const playableCount = allRaces.filter((r) => r.isPlayableRace).length;
  const visibleRaces = showMonstrousRaces ? allRaces : allRaces.filter((r) => r.isPlayableRace);
  const activeRace = sys.races[draft.raceId] ?? visibleRaces[0];

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-filter-bar">
          <span>
            {showMonstrousRaces ? `Showing All Races (${allRaces.length})` : `Playable Races (${playableCount})`}
          </span>
          <Chip active={showMonstrousRaces} onClick={onToggleMonstrousRaces}>
            {showMonstrousRaces ? 'Hide Monstrous Races' : 'Show Monstrous Races'}
          </Chip>
        </div>

        <div className="ui-dnd-card-list">
          {visibleRaces.map((race) => {
            const isSelected = draft.raceId === race.id;
            const laText = race.levelAdjustment > 0 ? ` • LA +${race.levelAdjustment}` : '';
            return (
              <button
                key={race.id}
                type="button"
                className={isSelected ? 'ui-dnd-list-row ui-dnd-list-row--selected' : 'ui-dnd-list-row'}
                onClick={() => onUpdateDraft({ ...draft, raceId: race.id })}
              >
                <strong className="ui-dnd-card__title">{race.name}</strong>
                <span className="ui-dnd-card__sub">{`${race.size.toUpperCase()} • ${race.baseLandSpeedFt}ft${laText}`}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">{activeRace ? <DnD35eRaceInspector race={activeRace} /> : null}</div>
    </div>
  );
}

/** Props for `<CharBuilderAbilitiesStep />`. */
export interface CharBuilderAbilitiesStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Step 3 (Ability Scores) of the D&D 3.5e Character Creation Wizard.
 */
export function CharBuilderAbilitiesStep({
  state,
  draft,
  onUpdateDraft
}: CharBuilderAbilitiesStepProps): JSX.Element | null {
  const sys = getDnD35SystemContent(state.campaign);
  if (!sys) return null;
  const race = sys.races[draft.raceId];
  const cls = sys.classes[draft.classId];

  const spent = calculatePointBuyCost(draft.baseAbilityScores);

  let modeTone: 'success' | 'danger' | 'info' | 'warning' = 'info';
  let modeLabel = '';
  if (draft.abilityMethod === 'point_buy') {
    modeTone = spent <= draft.pointBuyBudget ? 'success' : 'danger';
    modeLabel = `Mode: Point-Buy (${draft.pointBuyBudget} Budget) — Spent: ${spent} / ${draft.pointBuyBudget} pts`;
  } else if (draft.abilityMethod === 'elite_array') {
    modeTone = 'info';
    modeLabel = 'Mode: Elite Array (15, 14, 13, 12, 10, 8) — Use ⇅ to swap scores';
  } else {
    modeTone = 'warning';
    modeLabel = 'Mode: Rolled 4d6 Drop Lowest — Click Roll 4d6kh3 to reroll or ⇅ to arrange';
  }

  const conMod = computeAbilityModifier(draft.baseAbilityScores.con + (race?.abilityAdjustments.con ?? 0));
  const dexMod = computeAbilityModifier(draft.baseAbilityScores.dex + (race?.abilityAdjustments.dex ?? 0));
  const intMod = computeAbilityModifier(draft.baseAbilityScores.int + (race?.abilityAdjustments.int ?? 0));
  const lv1Hp = cls ? Math.max(1, cls.hitDieSides + conMod) : 1;
  const lv1Skills =
    cls && race
      ? calculateLevelSkillPointBudget(
          cls.skillPointsPerLevel,
          intMod,
          true,
          race.extraSkillPointsFirstLevel,
          race.extraSkillPointsPerLevel
        )
      : 0;

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-chip-row">
          {POINT_BUY_PRESETS.map((pts) => (
            <Chip
              key={pts}
              active={draft.abilityMethod === 'point_buy' && draft.pointBuyBudget === pts}
              onClick={() => {
                const clampedScores = { ...draft.baseAbilityScores };
                for (const k of ALL_ABILITY_IDS) {
                  clampedScores[k] = Math.max(POINT_BUY_MIN_SCORE, Math.min(POINT_BUY_MAX_SCORE, clampedScores[k]));
                }
                onUpdateDraft({
                  ...draft,
                  abilityMethod: 'point_buy',
                  pointBuyBudget: pts,
                  baseAbilityScores: clampedScores
                });
              }}
            >
              {`Point Buy (${pts})`}
            </Chip>
          ))}
          <Chip
            active={draft.abilityMethod === 'elite_array'}
            onClick={() =>
              onUpdateDraft({
                ...draft,
                abilityMethod: 'elite_array',
                baseAbilityScores: {
                  str: ELITE_ABILITY_ARRAY[0] ?? 15,
                  dex: ELITE_ABILITY_ARRAY[1] ?? 14,
                  con: ELITE_ABILITY_ARRAY[2] ?? 13,
                  int: ELITE_ABILITY_ARRAY[3] ?? 12,
                  wis: ELITE_ABILITY_ARRAY[4] ?? 10,
                  cha: ELITE_ABILITY_ARRAY[5] ?? 8
                }
              })
            }
          >
            Elite Array
          </Chip>
          <Chip
            active={draft.abilityMethod === 'rolled_4d6kh3'}
            onClick={() =>
              onUpdateDraft({
                ...draft,
                abilityMethod: 'rolled_4d6kh3',
                baseAbilityScores: rollAbilityScores4d6DropLowest()
              })
            }
          >
            🎲 Roll 4d6kh3
          </Chip>
        </div>

        <div className={`ui-dnd-banner ui-dnd-banner--${modeTone}`}>{modeLabel}</div>

        <div className="ui-dnd-card-list">
          {ALL_ABILITY_IDS.map((key, idx) => {
            const val = draft.baseAbilityScores[key];
            const racialAdj = race?.abilityAdjustments[key] ?? 0;
            const effective = val + racialAdj;
            const mod = computeAbilityModifier(effective);
            const adjStr = racialAdj !== 0 ? ` (${formatSigned(racialAdj)} race = ${effective})` : '';
            const nextKey = ALL_ABILITY_IDS[(idx + 1) % ALL_ABILITY_IDS.length]!;

            return (
              <div key={key} className="ui-dnd-card">
                <div className="ui-dnd-card__row">
                  <strong className="ui-dnd-card__title ui-dnd-mono">
                    {`${key.toUpperCase()}: ${val}${adjStr} [Mod ${formatSigned(mod)}]`}
                  </strong>
                  <div className="ui-dnd-list-row__actions">
                    {draft.abilityMethod === 'point_buy' ? (
                      <Stepper
                        label={`${key.toUpperCase()} score`}
                        value={val}
                        min={POINT_BUY_MIN_SCORE}
                        max={POINT_BUY_MAX_SCORE}
                        onChange={(nextVal) =>
                          onUpdateDraft({
                            ...draft,
                            baseAbilityScores: { ...draft.baseAbilityScores, [key]: nextVal }
                          })
                        }
                      />
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const nextVal = draft.baseAbilityScores[nextKey];
                        onUpdateDraft({
                          ...draft,
                          baseAbilityScores: { ...draft.baseAbilityScores, [key]: nextVal, [nextKey]: val }
                        });
                      }}
                    >
                      {`⇅ ${nextKey.toUpperCase()}`}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        <h3 className="ui-dnd-inspector__title">Live Combat &amp; Skill Preview (Level 1)</h3>
        {race && cls ? (
          <div className="ui-dnd-card-list">
            <div className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span>Level 1 Hit Points</span>
                <Badge tone="success">{`${lv1Hp} HP (d${cls.hitDieSides} max + ${formatSigned(conMod)} CON)`}</Badge>
              </div>
            </div>
            <div className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span>Unarmored AC / Initiative</span>
                <Badge tone="info">{`AC ${10 + dexMod} | Init ${formatSigned(dexMod)}`}</Badge>
              </div>
            </div>
            <div className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span>Level 1 Skill Points Budget</span>
                <Badge tone="warning">{`${lv1Skills} pts`}</Badge>
              </div>
            </div>
            <div className="ui-dnd-card">
              <div className="ui-dnd-card__title">{`Racial Ability Adjustments (${race.name})`}</div>
              <div className="ui-dnd-chip-row">
                {ALL_ABILITY_IDS.map((k) => {
                  const adj = race.abilityAdjustments[k] ?? 0;
                  return (
                    <Badge key={k} tone={adj > 0 ? 'success' : adj < 0 ? 'danger' : 'neutral'}>
                      {`${k.toUpperCase()} ${formatSigned(adj)}`}
                    </Badge>
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
