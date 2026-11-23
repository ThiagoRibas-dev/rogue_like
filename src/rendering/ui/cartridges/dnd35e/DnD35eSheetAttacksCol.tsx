/**
 * @file D&D 3.5e Character Sheet Column 2:
 * Attacks & Weapons, Combat Maneuvers, Abilities & Resource Pools, and Tactical Stances.
 */

import type { JSX } from 'preact';
import { getComponent } from '../../../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import type { evaluateDnD35eEntityDAG } from '../../../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import {
  getNextCounterspellReactionTrigger,
  getNextReactionTrigger
} from '../../../../rulesets/dnd35e/combat/immediate_reactions.ts';
import { aggregateProgressionChassis } from '../../../../rulesets/dnd35e/progression.ts';
import { resolveResourcePoolActionCost } from '../../../../rulesets/dnd35e/progression/ledger_resource_pools.ts';
import { SIZE_METRICS } from '../../../../rulesets/dnd35e/spatial/grid_geometry.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { DnD35UIAdapter } from '../../../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import {
  ComponentType,
  type ImmediateReactionTrigger,
  type ResourcePoolComponent,
  type TacticalDoctrineComponent
} from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { IntentType } from '../../../../types/intents/intent.enum.ts';
import type { UICharacterSheetModel } from '../../../../types/ui_adapter.types.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { applyDoctrineUpdate, toggleDnD35eActorStance } from '../../dnd35e_doctrine_actions.ts';
import { Button } from '../../primitives/Button.tsx';
import { Chip } from '../../primitives/DataDisplay.tsx';

const MAX_QUICK_POWER_ATTACK = 5;

const REACTION_TRIGGER_LABELS: Readonly<Record<ImmediateReactionTrigger, string>> = {
  off: 'React: Off',
  before_melee_attack: 'React: Melee',
  before_any_attack: 'React: Any Atk',
  on_enemy_adjacent_move: 'React: Adj Move',
  on_enemy_spell_cast: 'React: Spell Cast'
};

const BASELINE_STANCE_IDS: ReadonlySet<string> = new Set([
  'power_attack',
  'combat_expertise',
  'fighting_defensively',
  'total_defense',
  'two_handed_grip'
]);

const dndAdapter = new DnD35UIAdapter();

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

/** Props for `<DnD35eSheetAttacksCol />`. */
export interface DnD35eSheetAttacksColProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly evalResult: ReturnType<typeof evaluateDnD35eEntityDAG>;
  readonly sheetModel: UICharacterSheetModel;
}

/**
 * Column 2 of the D&D 3.5e Character Sheet: Attacks, Maneuvers, Pools & Stances.
 */
export function DnD35eSheetAttacksCol({
  state,
  playerId,
  evalResult,
  sheetModel
}: DnD35eSheetAttacksColProps): JSX.Element {
  const dndData = getDnD35EntityData(state, playerId);
  const sysContent = getDnD35SystemContent(state.campaign);
  const poolComp = getComponent(state, playerId, ComponentType.ResourcePool) as ResourcePoolComponent | undefined;
  const doctrine = getComponent(state, playerId, ComponentType.TacticalDoctrine) as
    TacticalDoctrineComponent | undefined;

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const strMod = evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const specialSizeMod = SIZE_METRICS[dndData.sizeCategory ?? 'medium']?.specialSizeModifier ?? 0;

  const attackGroups = sheetModel.attackGroups ?? [];
  const maneuvers: ReadonlyArray<{ readonly name: string; readonly mod: number; readonly note: string }> = [
    { name: 'Trip', mod: strMod + specialSizeMod, note: 'provokes' },
    { name: 'Disarm', mod: chassis.totalBab + strMod, note: 'vs ATK' },
    { name: 'Sunder', mod: chassis.totalBab + strMod, note: '2x vs obj' },
    { name: 'Bull Rush', mod: strMod + specialSizeMod, note: 'push 5ft+' },
    { name: 'Grapple', mod: chassis.totalBab + strMod + specialSizeMod, note: 'hold/pin' }
  ];

  const pools = poolComp?.pools ?? {};
  const activePoolKeys = Object.keys(pools).filter((k) => (pools[k]?.max ?? 0) > 0);
  const hasSpellbook = Object.keys(dndData.spellbooksByClass ?? {}).length > 0;
  const csPolicy = doctrine?.reactionPolicies?.['counterspell'];
  const curCsTrigger: ImmediateReactionTrigger = csPolicy?.enabled ? csPolicy.trigger : 'off';

  const isFightingDefensively = doctrine?.fightingDefensively ?? false;
  const isTotalDefense = doctrine?.totalDefense ?? false;
  const powerAttackVal = doctrine?.powerAttackAmount ?? 0;
  const hotbarModel = dndAdapter.getHotbarData({ state, entityId: playerId });
  const extraStances = hotbarModel.stanceModes.filter((m) => !BASELINE_STANCE_IDS.has(m.id));

  const handleUsePool = (poolId: string, abilityName: string): void => {
    const live = getGameState() ?? state;
    setGameState(closeCartridgeModal(live));
    queuePlayerIntent({
      type: IntentType.UseAbility,
      entityId: playerId,
      effectId: `pool:${poolId}`,
      abilityName
    });
    markAllDomainsDirty();
  };

  const handleCyclePoolReaction = (poolId: string, curTrigger: ImmediateReactionTrigger): void => {
    const live = getGameState() ?? state;
    const liveDoc = getComponent(live, playerId, ComponentType.TacticalDoctrine) as
      TacticalDoctrineComponent | undefined;
    const nextTrigger = getNextReactionTrigger(curTrigger);
    applyDoctrineUpdate(live, playerId, {
      reactionPolicies: {
        ...(liveDoc?.reactionPolicies ?? {}),
        [poolId]: { enabled: nextTrigger !== 'off', trigger: nextTrigger }
      }
    });
    markAllDomainsDirty();
  };

  const handleCycleCounterspell = (): void => {
    const live = getGameState() ?? state;
    const liveDoc = getComponent(live, playerId, ComponentType.TacticalDoctrine) as
      TacticalDoctrineComponent | undefined;
    const nextTrigger = getNextCounterspellReactionTrigger(curCsTrigger);
    applyDoctrineUpdate(live, playerId, {
      reactionPolicies: {
        ...(liveDoc?.reactionPolicies ?? {}),
        counterspell: { enabled: nextTrigger !== 'off', trigger: nextTrigger }
      }
    });
    markAllDomainsDirty();
  };

  return (
    <div className="ui-dnd-col">
      <div className="ui-dnd-subbanner">Attacks</div>
      <div className="ui-dnd-card-list">
        {attackGroups.length === 0 ? (
          <div className="ui-dnd-card__sub">No active weapons equipped or natural attacks present.</div>
        ) : (
          attackGroups.map((grp, idx) => (
            <div key={`${grp.label}_${idx}`} className="ui-dnd-card">
              <div className="ui-dnd-card__row">
                <span className="ui-dnd-card__title">{grp.label}</span>
                <span className="ui-dnd-card__sub">{grp.subtitle}</span>
              </div>
              <div className="ui-dnd-card__row">
                <span className="ui-dnd-card__metric">{`ATK ${grp.attackBonuses}`}</span>
                <span className="ui-dnd-mono">{`${grp.damageFormula} (${grp.criticalProfile})`}</span>
              </div>
              {grp.riderNotes ? <div className="ui-dnd-card__sub">{grp.riderNotes}</div> : null}
            </div>
          ))
        )}
      </div>

      <div className="ui-dnd-subbanner">Maneuvers</div>
      <div className="ui-dnd-card-list">
        {maneuvers.map((m) => (
          <div key={m.name} className="ui-dnd-maneuver-row">
            <strong>{m.name}</strong>
            <span className="ui-dnd-card__metric">{formatSigned(m.mod)}</span>
            <span className="ui-dnd-card__sub">{`[${m.note}]`}</span>
          </div>
        ))}
      </div>

      <div className="ui-dnd-subbanner">Abilities &amp; Pools</div>
      <div className="ui-dnd-card-list">
        {activePoolKeys.length === 0 && !hasSpellbook ? (
          <div className="ui-dnd-card__sub">No daily pools or activated class abilities.</div>
        ) : (
          <>
            {activePoolKeys.map((poolId) => {
              const entry = pools[poolId];
              if (!entry) return null;
              const isImmediate = resolveResourcePoolActionCost(poolId, entry, sysContent) === 'immediate';
              const policy = doctrine?.reactionPolicies?.[poolId];
              const curTrigger: ImmediateReactionTrigger = policy?.enabled ? policy.trigger : 'off';
              return (
                <div key={poolId} className="ui-dnd-card">
                  <div className="ui-dnd-card__row">
                    <span className="ui-dnd-card__title">{entry.label ?? poolId.replace(/_/g, ' ')}</span>
                    <span className="ui-dnd-mono">{`${entry.current} / ${entry.max}`}</span>
                    <div className="ui-dnd-chip-row">
                      <Button
                        size="sm"
                        disabled={entry.current <= 0}
                        onClick={() => handleUsePool(poolId, entry.label ?? poolId)}
                      >
                        Use
                      </Button>
                      {isImmediate ? (
                        <Chip active={curTrigger !== 'off'} onClick={() => handleCyclePoolReaction(poolId, curTrigger)}>
                          {REACTION_TRIGGER_LABELS[curTrigger]}
                        </Chip>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
            {hasSpellbook ? (
              <div className="ui-dnd-card">
                <div className="ui-dnd-card__row">
                  <span className="ui-dnd-card__title">Counterspell (Immediate)</span>
                  <Chip
                    active={curCsTrigger === 'on_enemy_spell_cast'}
                    title="Automatically counter hostile spells via Immediate Action + Spellcraft (DC 15 + spell level)."
                    onClick={handleCycleCounterspell}
                  >
                    {REACTION_TRIGGER_LABELS[curCsTrigger]}
                  </Chip>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="ui-dnd-subbanner">Tactical Stances</div>
      <div className="ui-dnd-chip-row">
        <Chip
          active={powerAttackVal > 0}
          onClick={() => {
            const live = getGameState() ?? state;
            const nextVal = powerAttackVal >= MAX_QUICK_POWER_ATTACK ? 0 : powerAttackVal + 1;
            applyDoctrineUpdate(live, playerId, { powerAttackAmount: nextVal });
            markAllDomainsDirty();
          }}
        >
          {`Power Attack (${powerAttackVal > 0 ? `-${powerAttackVal}/+${powerAttackVal}` : '0'})`}
        </Chip>
        <Chip
          active={isFightingDefensively}
          onClick={() => {
            const live = getGameState() ?? state;
            applyDoctrineUpdate(live, playerId, { fightingDefensively: !isFightingDefensively });
            markAllDomainsDirty();
          }}
        >
          {`Fight Defensive (${isFightingDefensively ? 'ON' : '-4/+2'})`}
        </Chip>
        <Chip
          active={isTotalDefense}
          onClick={() => {
            const live = getGameState() ?? state;
            applyDoctrineUpdate(live, playerId, { totalDefense: !isTotalDefense });
            markAllDomainsDirty();
          }}
        >
          {`Total Defense (${isTotalDefense ? 'ON' : '+4 AC'})`}
        </Chip>
        {extraStances.map((mode) => (
          <Chip
            key={mode.id}
            active={mode.isActive}
            title={mode.tooltipText}
            onClick={() => {
              const live = getGameState() ?? state;
              toggleDnD35eActorStance(live, playerId, mode.id, hotbarModel.stanceModes);
              markAllDomainsDirty();
            }}
          >
            {`${mode.label}${mode.isActive ? ' (ON)' : ''}`}
          </Chip>
        ))}
      </div>
    </div>
  );
}
