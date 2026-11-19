/**
 * @file Custom Gear Shop sub-view for the D&D 3.5e Character Creation Equipment Step.
 * Supports SRD Goods & Services browsing, proficiency badges, starting wealth rolling,
 * free starter outfit selection, and per-item equip-slot + quantity controls.
 */

import {
  type CharacterCreationDraft,
  COMMON_ADVENTURER_GEAR_ITEMS,
  computeCustomKitCostCp,
  computeKitTotalWeightLbs,
  getStarterOutfitIds,
  resolveClassStartingWealthCp,
  rollClassStartingWealthCp,
  type StartingEquipSlot,
  type StartingPackageItemEntry
} from '../../rulesets/dnd35e/character_builder.ts';
import { collectActorProficiencies } from '../../rulesets/dnd35e/builder/builder_prereq_proficiencies.ts';
import { computeEncumbranceState } from '../../rulesets/dnd35e/combat/tactical_doctrine.ts';
import { buildHitDieTrackFromClass } from '../../rulesets/dnd35e/progression.ts';
import type { DnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import {
  formatCurrency,
  resolveCurrencyConfig,
  resolveItemBaseValueInBaseUnits
} from '../../systems/currency.system.ts';
import type { ItemDefinition } from '../../types/campaign.types.ts';
import type { GameState } from '../../types/game-state.types.ts';

/** Canonical D&D 3.5e creature size category union. */
export type SizeCat =
  'fine' | 'diminutive' | 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan' | 'colossal';

/** Builds a compact SRD carried-weight & encumbrance load tier banner. */
export function buildEncumbranceBanner(strScore: number, sizeCategory: SizeCat, carriedLb: number): HTMLElement {
  const enc = computeEncumbranceState(strScore, sizeCategory, carriedLb);
  const tierColor =
    enc.loadTier === 'light'
      ? 'var(--crpg-success, #2ecc71)'
      : enc.loadTier === 'medium'
        ? 'var(--crpg-gold, #f1c40f)'
        : 'var(--crpg-warning, #e67e22)';
  const banner = document.createElement('div');
  banner.className = 'char-equip-encumbrance-bar';
  banner.style.borderColor = tierColor;
  banner.innerHTML = `<span><strong>Carried Weight:</strong> ${carriedLb.toFixed(1)} lb</span>
    <span style="color:${tierColor};font-weight:700;">Load: ${enc.loadTier.toUpperCase()}</span>
    <span style="color:var(--crpg-text-dim,#9da7b3);">Light ≤${enc.lightMaxLb} | Med ≤${enc.mediumMaxLb} | Heavy ≤${enc.heavyMaxLb} lb (STR ${strScore}, ${sizeCategory})</span>`;
  return banner;
}

/** Creates a compact styled modal button shared across Equipment & Custom Gear Shop views. */
export function makeCharBuilderMiniBtn(
  label: string,
  onClick: () => void,
  active = false,
  disabled = false
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'modal-btn';
  btn.style.cssText = 'padding:3px 8px;font-size:0.74rem;';
  if (active) btn.style.borderColor = 'var(--crpg-border-gold, #b88a36)';
  btn.textContent = label;
  btn.disabled = disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

type ShopCategoryFilter = 'all' | 'weapons' | 'armor' | 'gear' | 'light_ammo' | 'tools' | 'alchemical';

const MAX_STARTING_SHOP_ITEM_CP = 50000;
const FALLBACK_GOLD_DICE_LABEL = '4d4*10';

const SHOP_CATEGORIES: ReadonlyArray<{ readonly id: ShopCategoryFilter; readonly label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'armor', label: 'Armor & Shields' },
  { id: 'gear', label: 'Adventuring Gear' },
  { id: 'light_ammo', label: 'Light & Ammo' },
  { id: 'tools', label: 'Tools & Kits' },
  { id: 'alchemical', label: 'Alchemical' }
];

const TOOLS_AND_KITS_TAGS: ReadonlyArray<string> = [
  'class_tool',
  'skill_kit',
  'divine_focus',
  'spellcasting_focus',
  'spellbook',
  'musical_instrument',
  'writing_gear',
  'thieves_tools'
];

const EQUIP_SLOT_OPTIONS: ReadonlyArray<{ readonly value: '' | StartingEquipSlot; readonly label: string }> = [
  { value: '', label: 'Pack' },
  { value: 'main_hand', label: 'Main Hand' },
  { value: 'off_hand', label: 'Off Hand' },
  { value: 'torso', label: 'Torso' },
  { value: 'back', label: 'Back' }
];

let shopCategoryFilter: ShopCategoryFilter = 'all';
let shopSearchQuery = '';
let shopAffordableOnly = false;

/** Resets Custom Gear Shop filter state for a fresh Character Creation session. */
export function resetCustomGearShopUiState(): void {
  shopCategoryFilter = 'all';
  shopSearchQuery = '';
  shopAffordableOnly = false;
}

function matchesShopCategory(item: ItemDefinition, filter: ShopCategoryFilter): boolean {
  if (filter === 'all') return true;
  const tags = item.tags ?? [];
  if (filter === 'weapons') return item.category === 'weapon';
  if (filter === 'armor') return item.category === 'armor';
  if (filter === 'light_ammo') return tags.includes('light_source') || tags.includes('ammunition');
  if (filter === 'tools') return TOOLS_AND_KITS_TAGS.some((t) => tags.includes(t));
  if (filter === 'alchemical') return tags.includes('alchemical') || item.category === 'consumable';
  return item.category === 'tool';
}

function defaultEquipSlotForItem(item: ItemDefinition): StartingEquipSlot | undefined {
  const slot = item.equippable?.slot;
  if (slot === 'main_hand' || slot === 'two_handed' || slot === 'ranged' || item.category === 'weapon') {
    return 'main_hand';
  }
  if (slot === 'off_hand') return 'off_hand';
  if (slot === 'torso' || slot === 'body' || item.category === 'armor') return 'torso';
  if (slot === 'back') return 'back';
  return undefined;
}

function resolveItemProficiencyBadge(
  item: ItemDefinition,
  profs: ReturnType<typeof collectActorProficiencies> | undefined
): { readonly label: string; readonly proficient: boolean } | undefined {
  if (!profs || (item.category !== 'weapon' && item.category !== 'armor')) return undefined;
  const tags = item.tags ?? [];
  if (item.category === 'weapon') {
    const isProf =
      profs.proficientWeaponIds.includes(item.id) ||
      (tags.includes('simple') && profs.proficientWeaponCategories.includes('simple')) ||
      (tags.includes('martial') && profs.proficientWeaponCategories.includes('martial')) ||
      (tags.includes('exotic') && profs.proficientWeaponCategories.includes('exotic'));
    return { label: isProf ? '✓ Prof' : '⚠ Non-Prof', proficient: isProf };
  }
  const armorStats = item.armorStats as { category?: string } | undefined;
  const armorCat = armorStats?.category;
  const isProf =
    armorCat === 'shield'
      ? profs.proficientShieldCategories.includes('shield')
      : armorCat === 'tower_shield' || tags.includes('tower_shield')
        ? profs.proficientShieldCategories.includes('tower')
        : armorCat === 'light' || armorCat === 'medium' || armorCat === 'heavy'
          ? profs.proficientArmorCategories.includes(armorCat)
          : true;
  return { label: isProf ? '✓ Prof' : '⚠ Non-Prof', proficient: isProf };
}

/**
 * Renders the Custom Gear Shop 2-pane view inside the Character Creation Equipment step.
 */
export function renderCustomGearShopView(
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
  const cls = sys?.classes[draft.classId];
  const budgetCp = draft.customStartingBudgetCp ?? resolveClassStartingWealthCp(cls, currencyCfg);
  const customItems: ReadonlyArray<StartingPackageItemEntry> = draft.customEquipmentItems ?? [];
  const spentCp = computeCustomKitCostCp(customItems, itemsRegistry, currencyCfg);
  const remainingCp = budgetCp - spentCp;
  const starterOutfitIds = getStarterOutfitIds(itemsRegistry);
  const activeFreeOutfitId = draft.customFreeOutfitId ?? starterOutfitIds[0];
  const totalWeight = computeKitTotalWeightLbs(customItems, itemsRegistry, activeFreeOutfitId);

  const profs =
    sys && cls
      ? collectActorProficiencies(
          [buildHitDieTrackFromClass(cls, 1)],
          sys.classes,
          draft.raceId,
          draft.selectedFeats,
          [],
          draft.domains,
          draft.deityFavoredWeaponId,
          sys
        )
      : undefined;

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-equip-shop-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-equip-shop-right';

  const filterBar = document.createElement('div');
  filterBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;';
  for (const cat of SHOP_CATEGORIES) {
    filterBar.appendChild(
      makeCharBuilderMiniBtn(
        cat.label,
        () => {
          shopCategoryFilter = cat.id;
          updateDraft({ ...draft });
        },
        shopCategoryFilter === cat.id
      )
    );
  }
  leftPane.appendChild(filterBar);

  const searchRow = document.createElement('div');
  searchRow.style.cssText = 'display:flex;gap:6px;margin-bottom:6px;';
  const searchInput = document.createElement('input');
  searchInput.id = 'char-equip-shop-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search SRD Goods & Services...';
  searchInput.value = shopSearchQuery;
  searchInput.className = 'char-builder-text-input';
  searchInput.style.flex = '1';
  searchInput.addEventListener('input', () => {
    shopSearchQuery = searchInput.value;
    updateDraft({ ...draft });
  });
  const affordBtn = makeCharBuilderMiniBtn(
    shopAffordableOnly ? '✓ Affordable' : 'Affordable',
    () => {
      shopAffordableOnly = !shopAffordableOnly;
      updateDraft({ ...draft });
    },
    shopAffordableOnly
  );
  searchRow.append(searchInput, affordBtn);
  leftPane.appendChild(searchRow);

  const query = shopSearchQuery.trim().toLowerCase();
  const catalog = Object.values(itemsRegistry)
    .filter((item) => {
      if (item.isArtifact || item.currencyGrant !== undefined) return false;
      if (starterOutfitIds.includes(item.id)) return false;
      const costCp = resolveItemBaseValueInBaseUnits(item, currencyCfg);
      const isFreeClassFocus =
        costCp === 0 && ((item.tags ?? []).includes('class_tool') || (item.tags ?? []).includes('divine_focus'));
      if ((!isFreeClassFocus && costCp <= 0) || costCp > MAX_STARTING_SHOP_ITEM_CP) return false;
      if (shopAffordableOnly && costCp > remainingCp) return false;
      if (!matchesShopCategory(item, shopCategoryFilter)) return false;
      return !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of catalog) {
    const costCp = resolveItemBaseValueInBaseUnits(item, currencyCfg);
    const row = document.createElement('div');
    row.className = 'char-equip-item-row';
    const info = document.createElement('div');
    const headerLine = document.createElement('div');
    const nameStrong = document.createElement('strong');
    nameStrong.textContent = item.name;
    const metaSpan = document.createElement('span');
    metaSpan.style.cssText = 'font-size:0.74rem;color:var(--crpg-text-dim,#9da7b3);margin-left:5px;';
    metaSpan.textContent = `(${costCp === 0 ? 'Free' : formatCurrency(costCp, currencyCfg)} · ${item.weight} lb)`;
    headerLine.append(nameStrong, metaSpan);
    const profBadge = resolveItemProficiencyBadge(item, profs);
    if (profBadge) {
      const badge = document.createElement('span');
      badge.style.cssText = `font-size:0.68rem;font-weight:700;margin-left:6px;color:${profBadge.proficient ? 'var(--crpg-success,#2ecc71)' : 'var(--crpg-warning,#e67e22)'};`;
      badge.textContent = profBadge.label;
      headerLine.appendChild(badge);
    }
    const descLine = document.createElement('div');
    descLine.style.cssText = 'font-size:0.72rem;color:var(--crpg-text-dim,#9da7b3);';
    descLine.textContent = item.description;
    info.append(headerLine, descLine);

    const addBtn = makeCharBuilderMiniBtn(
      '+ Add',
      () => {
        const existingIdx = customItems.findIndex((e) => e.itemId === item.id);
        const nextItems = [...customItems];
        if (existingIdx >= 0) {
          const cur = nextItems[existingIdx]!;
          nextItems[existingIdx] = { ...cur, quantity: (cur.quantity ?? 1) + 1 };
        } else {
          const slot = defaultEquipSlotForItem(item);
          const slotTaken = slot !== undefined && nextItems.some((e) => e.equipSlot === slot);
          nextItems.push({ itemId: item.id, quantity: 1, ...(slot && !slotTaken ? { equipSlot: slot } : {}) });
        }
        updateDraft({ ...draft, customEquipmentItems: nextItems });
      },
      false,
      costCp > remainingCp
    );
    row.append(info, addBtn);
    leftPane.appendChild(row);
  }

  const purseRow = document.createElement('div');
  purseRow.className = 'char-equip-meta-strip';
  const remColor = remainingCp >= 0 ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-warning, #e74c3c)';
  purseRow.innerHTML = `<span><strong>Budget:</strong> ${formatCurrency(budgetCp, currencyCfg)}</span>
    <span><strong>Spent:</strong> ${formatCurrency(spentCp, currencyCfg)}</span>
    <span style="color:${remColor};"><strong>Remaining:</strong> ${formatCurrency(Math.max(0, remainingCp), currencyCfg)}</span>`;
  rightPane.appendChild(purseRow);

  const actionsRow = document.createElement('div');
  actionsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin:6px 0;';
  actionsRow.append(
    makeCharBuilderMiniBtn(`🎲 Roll Starting Gold (${cls?.startingGoldDice ?? FALLBACK_GOLD_DICE_LABEL})`, () => {
      updateDraft({
        ...draft,
        customStartingBudgetCp: rollClassStartingWealthCp(cls, currencyCfg),
        customStartingBudgetRolled: true,
        customStartingBudgetClassId: draft.classId
      });
    }),
    makeCharBuilderMiniBtn('Reset to Average', () => {
      updateDraft({
        ...draft,
        customStartingBudgetCp: resolveClassStartingWealthCp(cls, currencyCfg),
        customStartingBudgetRolled: false,
        customStartingBudgetClassId: draft.classId
      });
    }),
    makeCharBuilderMiniBtn('+ Adventurer Essentials', () => {
      const merged = [...customItems];
      for (const req of COMMON_ADVENTURER_GEAR_ITEMS) {
        if (!merged.some((e) => e.itemId === req.itemId)) merged.push({ ...req });
      }
      updateDraft({ ...draft, customEquipmentItems: merged });
    })
  );
  rightPane.appendChild(actionsRow);

  const outfitRow = document.createElement('div');
  outfitRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:0.78rem;';
  outfitRow.textContent = 'Free Starter Outfit (0 gp / 0 lb worn): ';
  const outfitSelect = document.createElement('select');
  outfitSelect.className = 'settings-select';
  for (const outfitId of starterOutfitIds) {
    const opt = document.createElement('option');
    opt.value = outfitId;
    opt.textContent = itemsRegistry[outfitId]?.name ?? outfitId;
    if (activeFreeOutfitId === outfitId) opt.selected = true;
    outfitSelect.appendChild(opt);
  }
  outfitSelect.addEventListener('change', () => {
    updateDraft({ ...draft, customFreeOutfitId: outfitSelect.value });
  });
  outfitRow.appendChild(outfitSelect);
  rightPane.append(outfitRow, buildEncumbranceBanner(strScore, sizeCategory, totalWeight));

  for (let idx = 0; idx < customItems.length; idx++) {
    const entry = customItems[idx]!;
    const def = itemsRegistry[entry.itemId];
    const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
    const unitCp = def ? resolveItemBaseValueInBaseUnits(def, currencyCfg) : 0;
    const row = document.createElement('div');
    row.className = 'char-equip-item-row';

    const label = document.createElement('div');
    const nameEl = document.createElement('strong');
    nameEl.textContent = `${def?.name ?? entry.itemId} ×${qty}`;
    const costEl = document.createElement('span');
    costEl.style.cssText = 'font-size:0.74rem;color:var(--crpg-text-dim,#9da7b3);margin-left:4px;';
    costEl.textContent = `(${formatCurrency(unitCp * qty, currencyCfg)})`;
    label.append(nameEl, costEl);

    const controls = document.createElement('div');
    controls.style.cssText = 'display:flex;align-items:center;gap:4px;';
    const canEquip =
      def !== undefined && (def.equippable !== undefined || def.category === 'weapon' || def.category === 'armor');
    if (canEquip) {
      const slotSel = document.createElement('select');
      slotSel.className = 'settings-select';
      slotSel.style.cssText = 'font-size:0.7rem;padding:2px 4px;';
      for (const optDef of EQUIP_SLOT_OPTIONS) {
        const opt = document.createElement('option');
        opt.value = optDef.value;
        opt.textContent = optDef.label;
        if ((entry.equipSlot ?? '') === optDef.value) opt.selected = true;
        slotSel.appendChild(opt);
      }
      slotSel.addEventListener('change', () => {
        const chosen = slotSel.value as '' | StartingEquipSlot;
        const next = customItems.map((it, i) => {
          if (i === idx) {
            const { equipSlot: _prev, ...rest } = it;
            return chosen ? { ...rest, equipSlot: chosen } : rest;
          }
          if (chosen && it.equipSlot === chosen) {
            const { equipSlot: _cleared, ...rest } = it;
            return rest;
          }
          return it;
        });
        updateDraft({ ...draft, customEquipmentItems: next });
      });
      controls.appendChild(slotSel);
    }

    controls.append(
      makeCharBuilderMiniBtn('−', () => {
        const next = [...customItems];
        if (qty <= 1) next.splice(idx, 1);
        else next[idx] = { ...entry, quantity: qty - 1 };
        updateDraft({ ...draft, customEquipmentItems: next });
      }),
      makeCharBuilderMiniBtn(
        '+',
        () => {
          const next = [...customItems];
          next[idx] = { ...entry, quantity: qty + 1 };
          updateDraft({ ...draft, customEquipmentItems: next });
        },
        false,
        unitCp > remainingCp
      ),
      makeCharBuilderMiniBtn('×', () => {
        const next = [...customItems];
        next.splice(idx, 1);
        updateDraft({ ...draft, customEquipmentItems: next });
      })
    );
    row.append(label, controls);
    rightPane.appendChild(row);
  }

  stage.append(leftPane, rightPane);
}
