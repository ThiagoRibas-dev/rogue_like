import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { createToggleQuestsAction } from '../../../actions/core.actions.ts';
import { getComponent } from '../../../core/ecs.ts';
import { queuePlayerIntent } from '../../../core/game-loop.ts';
import { PresentationDomain } from '../../../core/presentation_queue.ts';
import { getQuestDef } from '../../../systems/quest.system.ts';
import { ComponentType, type QuestLogComponent } from '../../../types/components.types.ts';
import { UIMode } from '../../../types/game-state.types.ts';
import { assertNever } from '../../../utils/assert.ts';
import { useUiSelector } from '../core/ui_store.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, type BadgeTone } from '../primitives/DataDisplay.tsx';
import { ModalShell } from '../primitives/ModalShell.tsx';
import { type TabItem, Tabs } from '../primitives/Tabs.tsx';
import { WikiText } from './WikiText.tsx';

type QuestFilterTab = 'all' | 'active' | 'completed' | 'failed';

const QUEST_TABS: ReadonlyArray<TabItem> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' }
];

/**
 * Filterable Quest Journal modal displaying Active, Completed, and Failed quests,
 * declarative `<WikiText />` links, objective counters, and reward summaries.
 */
export function QuestsModal(): JSX.Element | null {
  const state = useUiSelector((s) => s.gameState);
  const modalsVer = useUiSelector((s) => s.domainVersions[PresentationDomain.Modals]);
  const [activeTab, setActiveTab] = useState<QuestFilterTab>('all');
  void modalsVer;

  if (!state || state.uiMode !== UIMode.Quests) {
    return null;
  }

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (playerId === undefined) return null;

  const questLog = getComponent(state, playerId, ComponentType.QuestLog) as QuestLogComponent | undefined;
  const entries = questLog ? Object.entries(questLog.quests) : [];

  const visibleEntries = entries.filter(([questId, qState]) => {
    const questDef = getQuestDef(state, questId);
    if (!questDef) return false;
    if (questDef.isHidden && qState.status !== 'completed') return false;
    if (activeTab === 'all') return true;
    return qState.status === activeTab;
  });

  const handleClose = (): void => {
    queuePlayerIntent(createToggleQuestsAction(playerId));
  };

  return (
    <ModalShell
      title="Quest Journal"
      subtitle="Active leads, tasks, and completed deeds"
      size="lg"
      onClose={handleClose}
      footer={
        <Button variant="primary" size="sm" onClick={handleClose}>
          Close
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--ui-space-3)' }}>
        <Tabs
          tabs={QUEST_TABS}
          activeTabId={activeTab}
          ariaLabel="Filter quests by status"
          onSelectTab={(id): void => setActiveTab(id as QuestFilterTab)}
        />

        <div className="ui-card-stack">
          {visibleEntries.length === 0 ? (
            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--ui-text-muted)', fontStyle: 'italic' }}>
              {entries.length === 0 ? 'No quests in your journal.' : 'No quests match this filter.'}
            </div>
          ) : (
            visibleEntries.map(([questId, qState]) => {
              const questDef = getQuestDef(state, questId);
              if (!questDef) return null;

              const statusTone: BadgeTone =
                qState.status === 'completed' ? 'success' : qState.status === 'failed' ? 'danger' : 'warning';
              const statusLabel =
                qState.status === 'completed' ? 'Completed' : qState.status === 'failed' ? 'Failed' : 'Active';

              const rewardLabels: string[] = [];
              for (const rew of questDef.rewards ?? []) {
                switch (rew.type) {
                  case 'xp':
                    rewardLabels.push(`${rew.amount ?? 0} XP`);
                    break;
                  case 'item': {
                    const itemDef = state.campaign.items[rew.itemId];
                    rewardLabels.push(`${rew.amount ?? 1}x ${itemDef?.name ?? rew.itemId}`);
                    break;
                  }
                  case 'standing':
                    rewardLabels.push(
                      `${rew.amount && rew.amount >= 0 ? '+' : ''}${rew.amount ?? 0} ${rew.factionId} Rep`
                    );
                    break;
                  case 'event':
                    break;
                  default:
                    return assertNever(rew);
                }
              }

              return (
                <article key={questId} className="ui-quest-card">
                  <div className="ui-quest-card__head">
                    <h3 className="ui-quest-card__title">{questDef.title}</h3>
                    <Badge tone={statusTone}>{statusLabel}</Badge>
                  </div>
                  <p style={{ margin: 0, color: 'var(--ui-text-secondary)', fontSize: 'var(--ui-font-sm)' }}>
                    <WikiText text={questDef.description} />
                  </p>
                  <div
                    style={{
                      fontSize: 'var(--ui-font-xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--ui-text-muted)'
                    }}
                  >
                    {questDef.logicalOperator === 'OR' ? 'Objectives (Complete Any):' : 'Objectives:'}
                  </div>
                  {questDef.objectives.map((obj) => {
                    const progress = qState.objectiveProgress[obj.id] ?? 0;
                    const isDone = progress >= obj.requiredAmount;
                    return (
                      <div key={obj.id} className="ui-quest-objective" data-complete={isDone ? 'true' : undefined}>
                        <span>
                          <WikiText text={obj.description} />
                        </span>
                        <span style={{ fontFamily: 'var(--ui-font-mono)' }}>
                          {`${progress} / ${obj.requiredAmount}`}
                        </span>
                      </div>
                    );
                  })}
                  {rewardLabels.length > 0 ? (
                    <div
                      style={{
                        paddingTop: '6px',
                        borderTop: '1px dashed var(--ui-border-subtle)',
                        fontSize: 'var(--ui-font-xs)',
                        color: 'var(--ui-accent-primary)'
                      }}
                    >
                      {`Rewards: ${rewardLabels.join(', ')}`}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </div>
    </ModalShell>
  );
}
