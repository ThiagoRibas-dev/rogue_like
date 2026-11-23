/**
 * @file Custom Gear Shop sub-view for the D&D 3.5e Character Creation Equipment Step (Milestone 164).
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { collectActorProficiencies } from '../../../../rulesets/dnd35e/builder/builder_prereq_proficiencies.ts';
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
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { buildHitDieTrackFromClass } from '../../../../rulesets/dnd35e/progression.ts';
import type { DnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import {
  formatCurrency,
  resolveCurrencyConfig,
  resolveItemBaseValueInBaseUnits
} from '../../../../systems/currency.system.ts';
import type { ItemDefinition } from '../../../../types/campaign.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { Select, TextInput } from '../../primitives/FormControls.tsx';
import { EncumbranceBanner, type SizeCat } from './CharBuilderEquipmentStep.tsx';

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

/** Props for `<CharBuilderGearShop />`. */
export interface CharBuilderGearShopProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly itemsRegistry: Readonly<Record<string, ItemDefinition>>;
  readonly sys: DnD35SystemContent | undefined;
  readonly strScore: number;
  readonly sizeCategory: SizeCat;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Custom Gear Shop 2-pane browser & cart for Level 1 starting wealth shopping.
 */
export function CharBuilderGearShop({
  state,
  draft,
  itemsRegistry,
  sys,
  strScore,
  sizeCategory,
  onUpdateDraft
}: CharBuilderGearShopProps): JSX.Element {
  const [categoryFilter, setCategoryFilter] = useState<ShopCategoryFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [affordableOnly, setAffordableOnly] = useState<boolean>(false);

  const currencyCfg = resolveCurrencyConfig(state);
  const cls = sys?.classes[draft.classId];
  const budgetCp = draft.customStartingBudgetCp ?? resolveClassStartingWealthCp(cls, currencyCfg);
  const customItems: ReadonlyArray<StartingPackageItemEntry> = draft.customEquipmentItems ?? [];
  const spentCp = computeCustomKitCostCp(customItems, itemsRegistry, currencyCfg);
  const remainingCp = budgetCp - spentCp;
  const starterOutfitIds = getStarterOutfitIds(itemsRegistry);
  const activeFreeOutfitId = draft.customFreeOutfitId ?? starterOutfitIds[0] ?? '';
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

  const query = searchQuery.trim().toLowerCase();
  const catalog = Object.values(itemsRegistry)
    .filter((item) => {
      if (item.isArtifact || item.currencyGrant !== undefined) return false;
      if (starterOutfitIds.includes(item.id)) return false;
      const costCp = resolveItemBaseValueInBaseUnits(item, currencyCfg);
      const isFreeClassFocus =
        costCp === 0 && ((item.tags ?? []).includes('class_tool') || (item.tags ?? []).includes('divine_focus'));
      if ((!isFreeClassFocus && costCp <= 0) || costCp > MAX_STARTING_SHOP_ITEM_CP) return false;
      if (affordableOnly && costCp > remainingCp) return false;
      if (!matchesShopCategory(item, categoryFilter)) return false;
      return !query || item.name.toLowerCase().includes(query) || item.id.toLowerCase().includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-chip-row">
          {SHOP_CATEGORIES.map((cat) => (
            <Chip key={cat.id} active={categoryFilter === cat.id} onClick={() => setCategoryFilter(cat.id)}>
              {cat.label}
            </Chip>
          ))}
        </div>

        <div className="ui-dnd-card__row">
          <div style={{ flex: 1 }}>
            <TextInput
              type="search"
              ariaLabel="Search SRD Goods and Services"
              placeholder="Search SRD Goods & Services..."
              value={searchQuery}
              onInput={setSearchQuery}
            />
          </div>
          <Chip active={affordableOnly} onClick={() => setAffordableOnly((prev) => !prev)}>
            {affordableOnly ? '✓ Affordable' : 'Affordable'}
          </Chip>
        </div>

        <div className="ui-dnd-card-list">
          {catalog.map((item) => {
            const costCp = resolveItemBaseValueInBaseUnits(item, currencyCfg);
            const profBadge = resolveItemProficiencyBadge(item, profs);
            return (
              <div key={item.id} className="ui-dnd-card">
                <div className="ui-dnd-card__row">
                  <div className="ui-dnd-list-row__main">
                    <div className="ui-dnd-chip-row">
                      <strong className="ui-dnd-card__title">{item.name}</strong>
                      <span className="ui-dnd-card__sub">
                        {`(${costCp === 0 ? 'Free' : formatCurrency(costCp, currencyCfg)} · ${item.weight} lb)`}
                      </span>
                      {profBadge ? (
                        <Badge tone={profBadge.proficient ? 'success' : 'warning'}>{profBadge.label}</Badge>
                      ) : null}
                    </div>
                    <span className="ui-dnd-card__sub">{item.description}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={costCp > remainingCp}
                    onClick={() => {
                      const existingIdx = customItems.findIndex((e) => e.itemId === item.id);
                      const nextItems = [...customItems];
                      if (existingIdx >= 0) {
                        const cur = nextItems[existingIdx]!;
                        nextItems[existingIdx] = { ...cur, quantity: (cur.quantity ?? 1) + 1 };
                      } else {
                        const slot = defaultEquipSlotForItem(item);
                        const slotTaken = slot !== undefined && nextItems.some((e) => e.equipSlot === slot);
                        nextItems.push({
                          itemId: item.id,
                          quantity: 1,
                          ...(slot && !slotTaken ? { equipSlot: slot } : {})
                        });
                      }
                      onUpdateDraft({ ...draft, customEquipmentItems: nextItems });
                    }}
                  >
                    + Add
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-meta-strip">
          <span>
            <strong>Budget:</strong> {formatCurrency(budgetCp, currencyCfg)}
          </span>
          <span>
            <strong>Spent:</strong> {formatCurrency(spentCp, currencyCfg)}
          </span>
          <Badge tone={remainingCp >= 0 ? 'success' : 'danger'}>
            {`Remaining: ${formatCurrency(Math.max(0, remainingCp), currencyCfg)}`}
          </Badge>
        </div>

        <div className="ui-dnd-chip-row">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onUpdateDraft({
                ...draft,
                customStartingBudgetCp: rollClassStartingWealthCp(cls, currencyCfg),
                customStartingBudgetRolled: true,
                customStartingBudgetClassId: draft.classId
              })
            }
          >
            {`🎲 Roll Starting Gold (${cls?.startingGoldDice ?? FALLBACK_GOLD_DICE_LABEL})`}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              onUpdateDraft({
                ...draft,
                customStartingBudgetCp: resolveClassStartingWealthCp(cls, currencyCfg),
                customStartingBudgetRolled: false,
                customStartingBudgetClassId: draft.classId
              })
            }
          >
            Reset to Average
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const merged = [...customItems];
              for (const req of COMMON_ADVENTURER_GEAR_ITEMS) {
                if (!merged.some((e) => e.itemId === req.itemId)) merged.push({ ...req });
              }
              onUpdateDraft({ ...draft, customEquipmentItems: merged });
            }}
          >
            + Adventurer Essentials
          </Button>
        </div>

        <div className="ui-dnd-card__row">
          <span className="ui-dnd-card__sub">Free Starter Outfit (0 gp / 0 lb worn):</span>
          <Select
            ariaLabel="Free starter outfit"
            value={activeFreeOutfitId}
            options={starterOutfitIds.map((id) => ({ value: id, label: itemsRegistry[id]?.name ?? id }))}
            onChange={(val) => onUpdateDraft({ ...draft, customFreeOutfitId: val })}
          />
        </div>

        <EncumbranceBanner strScore={strScore} sizeCategory={sizeCategory} carriedLb={totalWeight} />

        <div className="ui-dnd-card-list">
          {customItems.map((entry, idx) => {
            const def = itemsRegistry[entry.itemId];
            const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
            const unitCp = def ? resolveItemBaseValueInBaseUnits(def, currencyCfg) : 0;
            const canEquip =
              def !== undefined &&
              (def.equippable !== undefined || def.category === 'weapon' || def.category === 'armor');

            return (
              <div key={`${entry.itemId}-${idx}`} className="ui-dnd-card">
                <div className="ui-dnd-card__row">
                  <span>
                    <strong className="ui-dnd-card__title">{`${def?.name ?? entry.itemId} ×${qty}`}</strong>{' '}
                    <span className="ui-dnd-card__sub">{`(${formatCurrency(unitCp * qty, currencyCfg)})`}</span>
                  </span>

                  <div className="ui-dnd-list-row__actions">
                    {canEquip ? (
                      <Select
                        ariaLabel={`Equip slot for ${def?.name ?? entry.itemId}`}
                        value={entry.equipSlot ?? ''}
                        options={EQUIP_SLOT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                        onChange={(rawVal) => {
                          const chosen = rawVal as '' | StartingEquipSlot;
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
                          onUpdateDraft({ ...draft, customEquipmentItems: next });
                        }}
                      />
                    ) : null}

                    <Button
                      size="sm"
                      variant="secondary"
                      title="Decrease quantity"
                      onClick={() => {
                        const next = [...customItems];
                        if (qty <= 1) next.splice(idx, 1);
                        else next[idx] = { ...entry, quantity: qty - 1 };
                        onUpdateDraft({ ...draft, customEquipmentItems: next });
                      }}
                    >
                      −
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      title="Increase quantity"
                      disabled={unitCp > remainingCp}
                      onClick={() => {
                        const next = [...customItems];
                        next[idx] = { ...entry, quantity: qty + 1 };
                        onUpdateDraft({ ...draft, customEquipmentItems: next });
                      }}
                    >
                      +
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      title="Remove item"
                      onClick={() => {
                        const next = [...customItems];
                        next.splice(idx, 1);
                        onUpdateDraft({ ...draft, customEquipmentItems: next });
                      }}
                    >
                      ×
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
