/**
 * @file D&D 3.5e Character Sheet Modal (Milestone 163).
 * Composes 3-tab accessible Preact modal (`Character`, `Progression & Features`, `Companions`)
 * reusing Tier 1 Console `PaperDollWidget`, `CompactStashWidget`, and `ItemInspectPopover`.
 */

import type { JSX } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import { createApplyAction } from '../../../../actions/interaction.actions.ts';
import {
  createDropAction,
  createEquipItemAction,
  createUnequipItemAction
} from '../../../../actions/inventory.actions.ts';
import { getComponent } from '../../../../core/ecs.ts';
import { getGameState, queuePlayerIntent, setGameState } from '../../../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../../../core/presentation_queue.ts';
import { evaluateDnD35eEntityDAG } from '../../../../rulesets/dnd35e/cartridge/dnd35e_dag_adapter.ts';
import { DnD35UIAdapter } from '../../../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { ComponentType } from '../../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import type { UIInventoryItem } from '../../../../types/ui_adapter.types.ts';
import { closeCartridgeModal } from '../../cartridge_ui_registry.ts';
import { CompactStashWidget } from '../../modals/CompactStashWidget.tsx';
import { type ItemInspectAnchor, ItemInspectPopover } from '../../modals/ItemInspectPopover.tsx';
import { PaperDollWidget } from '../../modals/PaperDollWidget.tsx';
import { ModalShell } from '../../primitives/ModalShell.tsx';
import { type TabItem, Tabs } from '../../primitives/Tabs.tsx';
import { DnD35eSheetAttacksCol } from './DnD35eSheetAttacksCol.tsx';
import { DnD35eSheetCompanionsTab } from './DnD35eSheetCompanionsTab.tsx';
import { DnD35eSheetOverviewCol } from './DnD35eSheetOverviewCol.tsx';
import { DnD35eSheetProgressionTab } from './DnD35eSheetProgressionTab.tsx';

type SheetTabId = 'character' | 'progression' | 'companions';

const SHEET_TABS: ReadonlyArray<TabItem> = [
  { id: 'character', label: 'Character & Gear', icon: '📜' },
  { id: 'progression', label: 'Progression & Features', icon: '⭐' },
  { id: 'companions', label: 'Companions', icon: '🐾' }
];

const dndAdapter = new DnD35UIAdapter();

/** Props for `<DnD35eSheetModal />`. */
export interface DnD35eSheetModalProps {
  readonly state: GameState;
}

/**
 * Complete Preact D&D 3.5e Character Sheet & Anatomical Inventory modal.
 */
export function DnD35eSheetModal({ state }: DnD35eSheetModalProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<SheetTabId>('character');
  const [activeWeaponSet, setActiveWeaponSet] = useState<number>(1);
  const [inspectAnchor, setInspectAnchor] = useState<ItemInspectAnchor | null>(null);

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);

  const handleClose = useCallback((): void => {
    setInspectAnchor(null);
    const live = getGameState() ?? state;
    setGameState(closeCartridgeModal(live));
    markAllDomainsDirty();
  }, [state]);

  const handleInspectItem = useCallback((item: UIInventoryItem | null, clientX: number, clientY: number): void => {
    if (!item?.inspectData) {
      setInspectAnchor(null);
      return;
    }
    setInspectAnchor({ data: item.inspectData, clientX, clientY });
  }, []);

  if (playerId === undefined) {
    return (
      <ModalShell title="Character Sheet" size="xl" showHelpHint onClose={handleClose}>
        <div className="ui-dnd-card__sub">No player entity found.</div>
      </ModalShell>
    );
  }

  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const sheetModel = dndAdapter.getCharacterSheetData({ state, entityId: playerId, evalResult });
  const invData = {
    ...dndAdapter.getInventoryData({ state, entityId: playerId }),
    activeWeaponSetIndex: activeWeaponSet
  };

  const handleEquip = (_itemId: string, _slotId: string, item?: UIInventoryItem): void => {
    if (item?.inventoryIndex === undefined) return;
    queuePlayerIntent(createEquipItemAction(playerId, item.inventoryIndex));
    markAllDomainsDirty();
  };

  const handleUnequip = (slotId: string): void => {
    queuePlayerIntent(createUnequipItemAction(playerId, slotId));
    markAllDomainsDirty();
  };

  const handleUse = (_itemId: string, item?: UIInventoryItem): void => {
    if (item?.entityId === undefined) return;
    queuePlayerIntent(createApplyAction(playerId, 'apply', { type: 'item', itemEntityId: item.entityId as EntityId }));
    markAllDomainsDirty();
  };

  const handleDrop = (_itemId: string, item?: UIInventoryItem): void => {
    if (item?.inventoryIndex === undefined) return;
    queuePlayerIntent(createDropAction(playerId, item.inventoryIndex));
    markAllDomainsDirty();
  };

  return (
    <ModalShell
      title={sheetModel.name || 'Character Sheet'}
      subtitle={`${sheetModel.raceName} • ${sheetModel.levelSummary}`}
      size="xl"
      showHelpHint
      onClose={handleClose}
    >
      <div className="ui-dnd-sheet-body">
        <Tabs
          tabs={SHEET_TABS}
          activeTabId={activeTab}
          ariaLabel="Character sheet sections"
          onSelectTab={(id) => {
            setInspectAnchor(null);
            setActiveTab(id as SheetTabId);
          }}
        />

        {activeTab === 'character' ? (
          <div className="ui-dnd-sheet-3col">
            <DnD35eSheetOverviewCol state={state} playerId={playerId} evalResult={evalResult} sheetModel={sheetModel} />
            <DnD35eSheetAttacksCol state={state} playerId={playerId} evalResult={evalResult} sheetModel={sheetModel} />
            <div className="ui-dnd-col">
              <div className="ui-dnd-subbanner">Equipment</div>
              <PaperDollWidget
                data={invData}
                onUnequipItem={handleUnequip}
                onSelectWeaponSet={setActiveWeaponSet}
                onInspectItem={handleInspectItem}
              />
              <div className="ui-dnd-subbanner">Backpack</div>
              <CompactStashWidget
                data={invData}
                onEquipItem={handleEquip}
                onUseItem={handleUse}
                onDropItem={handleDrop}
                onInspectItem={handleInspectItem}
              />
            </div>
          </div>
        ) : activeTab === 'progression' ? (
          <DnD35eSheetProgressionTab state={state} playerId={playerId} />
        ) : (
          <DnD35eSheetCompanionsTab state={state} playerId={playerId} />
        )}
      </div>
      <ItemInspectPopover anchor={inspectAnchor} />
    </ModalShell>
  );
}
