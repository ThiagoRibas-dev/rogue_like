import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { EditorController } from '../../../../editor/campaign_editor.ts';
import { Tabs } from '../../primitives/Tabs.tsx';
import { AiArena } from './AiArena.tsx';
import { BalanceLab } from './BalanceLab.tsx';
import { DirectorSandbox } from './DirectorSandbox.tsx';
import { KnowledgeSimulator } from './KnowledgeSimulator.tsx';
import { NarrativeFuzzer } from './NarrativeFuzzer.tsx';

type SimulationSubTabId = 'arena' | 'director' | 'knowledge' | 'fuzzer' | 'balance';

/** Props for `<SimulationLab />`. */
export interface SimulationLabProps {
  readonly controller: EditorController;
}

/**
 * Container panel unifying all 5 Simulation Labs behind an accessible `<Tabs />` bar.
 */
export function SimulationLab({ controller }: SimulationLabProps): JSX.Element {
  const [activeSubTab, setActiveSubTab] = useState<SimulationSubTabId>('arena');

  return (
    <div className="ui-editor-simulation-lab">
      <Tabs
        ariaLabel="Simulation Lab Suites"
        activeTabId={activeSubTab}
        tabs={[
          { id: 'arena', label: 'AI Arena', icon: '⚔️' },
          { id: 'director', label: 'Director Sandbox', icon: '🎲' },
          { id: 'knowledge', label: 'Knowledge Simulator', icon: '🗣️' },
          { id: 'fuzzer', label: 'Narrative Fuzzer', icon: '🪲' },
          { id: 'balance', label: 'Balance QA', icon: '⚖️' }
        ]}
        onSelectTab={(id) => setActiveSubTab(id as SimulationSubTabId)}
      />

      <div className="ui-editor-simulation-lab__body">
        {activeSubTab === 'arena' ? <AiArena controller={controller} /> : null}
        {activeSubTab === 'director' ? <DirectorSandbox controller={controller} /> : null}
        {activeSubTab === 'knowledge' ? <KnowledgeSimulator controller={controller} /> : null}
        {activeSubTab === 'fuzzer' ? <NarrativeFuzzer controller={controller} /> : null}
        {activeSubTab === 'balance' ? <BalanceLab controller={controller} /> : null}
      </div>
    </div>
  );
}
