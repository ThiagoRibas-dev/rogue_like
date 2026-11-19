/**
 * @file Step 6/7 (Starting Equipment Kit Inspector & Custom Gear Shop Host) for D&D 3.5e Character Creation.
 * Allows selecting from all 11 PHB/SRD Class Starting Packages + 4 Classic Adventurer Kits,
 * or switching to the Custom Gear Shop (`dnd35e_char_builder_shop.ui.ts`).
 */

import {
  buildCustomItemsFromPackage,
  type CharacterCreationDraft,
  computeCustomKitCostCp,
  computeKitTotalWeightLbs,
  getStarterOutfitIds,
  resolveClassStartingWealthCp,
  STARTING_EQUIPMENT_PACKAGES,
  type StartingEquipmentPackage
} from '../../rulesets/dnd35e/character_builder.ts';
import type { DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { resolveCurrencyConfig, toBaseUnits } from '../../systems/currency.system.ts';
import type { ItemDefinition } from '../../types/campaign.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import {
  buildEncumbranceBanner,
  makeCharBuilderMiniBtn,
  renderCustomGearShopView,
  resetCustomGearShopUiState,
  type SizeCat
} from './dnd35e_char_builder_shop.ui.ts';

/** Resets Equipment & Custom Gear Shop filter state for a fresh Character Creation session. */
export function resetEquipmentStepUiState(): void {
  resetCustomGearShopUiState();
}

function renderPresetKitsView(
  stage: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void,
  itemsRegistry: Readonly<Record<string, ItemDefinition>>,
  sys: DnD35SystemContent | undefined,
  strScore: number,
  sizeCategory: SizeCat
): void {
  const currencyCfg = resolveCurrencyConfig(state);
  const goldDenomId = currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId;
  const starterOutfitIds = getStarterOutfitIds(itemsRegistry);

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-equip-preset-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-equip-preset-right';

  const sortedPackages = [...STARTING_EQUIPMENT_PACKAGES].sort((a, b) => {
    const aRec = a.recommendedClassIds?.includes(draft.classId) ? 0 : a.recommendedClassIds ? 1 : 2;
    const bRec = b.recommendedClassIds?.includes(draft.classId) ? 0 : b.recommendedClassIds ? 1 : 2;
    return aRec - bRec;
  });

  for (const pkg of sortedPackages) {
    const selected = draft.equipmentPackageId === pkg.id;
    const isRecommended = pkg.recommendedClassIds?.includes(draft.classId) === true;
    const row = document.createElement('div');
    row.className = `dnd35-list-item${selected ? ' selected' : ''}`;
    row.addEventListener('click', () => {
      updateDraft({ ...draft, equipmentMode: 'preset', equipmentPackageId: pkg.id });
    });

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:6px;';
    const title = document.createElement('strong');
    title.textContent = pkg.name;
    header.appendChild(title);
    if (isRecommended) {
      const badge = document.createElement('span');
      badge.className = 'char-builder-pill-badge';
      badge.textContent = '★ CLASS KIT';
      header.appendChild(badge);
    }
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:0.76rem;color:var(--crpg-text-dim,#9da7b3);';
    desc.textContent = pkg.description;
    row.append(header, desc);
    leftPane.appendChild(row);
  }

  const activePkg: StartingEquipmentPackage =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
  const kitItems = activePkg.items ?? [];
  const totalWeight = computeKitTotalWeightLbs(kitItems, itemsRegistry, activePkg.freeOutfitId);

  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;';
  const summaryTitle = document.createElement('h3');
  summaryTitle.style.cssText = 'margin:0;color:var(--crpg-gold, #f1c40f);';
  summaryTitle.textContent = activePkg.name;
  const customizeBtn = makeCharBuilderMiniBtn('✏ Customize This Kit →', () => {
    const cls = sys?.classes[draft.classId];
    const seededItems = buildCustomItemsFromPackage(activePkg);
    const seededCostCp = computeCustomKitCostCp(seededItems, itemsRegistry, currencyCfg);
    const pkgCoinCp = toBaseUnits(activePkg.startingGoldGp, goldDenomId, currencyCfg);
    const classAvgCp = resolveClassStartingWealthCp(cls, currencyCfg);
    updateDraft({
      ...draft,
      equipmentMode: 'custom',
      customEquipmentItems: seededItems,
      customFreeOutfitId: activePkg.freeOutfitId ?? starterOutfitIds[0],
      customStartingBudgetCp: Math.max(classAvgCp, seededCostCp + pkgCoinCp),
      customStartingBudgetRolled: true,
      customStartingBudgetClassId: draft.classId
    });
  });
  titleRow.append(summaryTitle, customizeBtn);
  rightPane.appendChild(titleRow);

  const pkgDesc = document.createElement('p');
  pkgDesc.style.cssText = 'font-size:0.82rem;margin:4px 0 8px 0;color:var(--crpg-text-dim, #9da7b3);';
  pkgDesc.textContent = activePkg.description;
  rightPane.append(pkgDesc, buildEncumbranceBanner(strScore, sizeCategory, totalWeight));

  const metaStrip = document.createElement('div');
  metaStrip.className = 'char-equip-meta-strip';
  const outfitDef = activePkg.freeOutfitId ? itemsRegistry[activePkg.freeOutfitId] : undefined;
  const fallbackOutfitName = starterOutfitIds[0]
    ? (itemsRegistry[starterOutfitIds[0]]?.name ?? 'Starter Outfit')
    : 'Starter Outfit';
  metaStrip.innerHTML = `<span><strong>Weapon:</strong> ${activePkg.weaponDice} ${activePkg.weaponDamageType}</span>
    <span><strong>Armor/Shield:</strong> +${activePkg.armorBonus} / +${activePkg.shieldBonus}</span>
    <span><strong>Free Outfit:</strong> ${outfitDef?.name ?? fallbackOutfitName} (0 lb worn)</span>
    <span><strong>Starting Coin:</strong> ${activePkg.startingGoldGp} gp</span>`;
  rightPane.appendChild(metaStrip);

  for (const entry of kitItems) {
    const def = itemsRegistry[entry.itemId];
    const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
    const row = document.createElement('div');
    row.className = 'char-equip-item-row';
    const leftDiv = document.createElement('div');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = `${def?.name ?? entry.itemId}${qty > 1 ? ` ×${qty}` : ''}`;
    const slotSpan = document.createElement('span');
    slotSpan.style.cssText = 'color:var(--crpg-gold,#f1c40f);font-size:0.74rem;margin-left:4px;';
    slotSpan.textContent = entry.equipSlot ? `[${entry.equipSlot.replace('_', ' ')}]` : '[pack]';
    leftDiv.append(nameStrong, slotSpan);

    const wtDiv = document.createElement('div');
    wtDiv.style.cssText = 'font-size:0.75rem;color:var(--crpg-text-dim,#9da7b3);';
    wtDiv.textContent = `${((def?.weight ?? 0) * qty).toFixed(1)} lb`;
    row.append(leftDiv, wtDiv);
    rightPane.appendChild(row);
  }

  stage.append(leftPane, rightPane);
}

/**
 * Renders the Equipment Step (Preset Starting Kits & Custom Gear Shop) in a 2-pane layout.
 */
export function renderCharBuilderEquipmentStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void,
  sys?: DnD35SystemContent
): void {
  const itemsRegistry: Readonly<Record<string, ItemDefinition>> = {
    ...(sys?.items ?? {}),
    ...state.campaign.items
  };
  const currencyCfg = resolveCurrencyConfig(state);
  const starterOutfitIds = getStarterOutfitIds(itemsRegistry);
  const race = sys?.races[draft.raceId];
  const strScore = Math.max(1, (draft.baseAbilityScores.str ?? 10) + (race?.abilityAdjustments.str ?? 0));
  const sizeCategory: SizeCat = race?.size ?? 'medium';
  const mode = draft.equipmentMode ?? 'preset';

  const modeBar = document.createElement('div');
  modeBar.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;';
  modeBar.append(
    makeCharBuilderMiniBtn(
      `📦 Preset Starting Kits (${STARTING_EQUIPMENT_PACKAGES.length})`,
      () => updateDraft({ ...draft, equipmentMode: 'preset' }),
      mode === 'preset'
    ),
    makeCharBuilderMiniBtn(
      '🛒 Custom Gear Shop',
      () => {
        const activePkg =
          STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
        const cls = sys?.classes[draft.classId];
        updateDraft({
          ...draft,
          equipmentMode: 'custom',
          customEquipmentItems: draft.customEquipmentItems ?? buildCustomItemsFromPackage(activePkg),
          customFreeOutfitId: draft.customFreeOutfitId ?? activePkg.freeOutfitId ?? starterOutfitIds[0],
          customStartingBudgetCp: draft.customStartingBudgetCp ?? resolveClassStartingWealthCp(cls, currencyCfg),
          customStartingBudgetClassId: draft.customStartingBudgetClassId ?? draft.classId
        });
      },
      mode === 'custom'
    )
  );
  container.appendChild(modeBar);

  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';
  if (mode === 'custom') {
    renderCustomGearShopView(stage, state, draft, updateDraft, itemsRegistry, sys, strScore, sizeCategory);
  } else {
    renderPresetKitsView(stage, state, draft, updateDraft, itemsRegistry, sys, strScore, sizeCategory);
  }
  container.appendChild(stage);
}
