/**
 * @file Character Creation Equipment Step (Preset Starting Kits & Encumbrance Banner) (Milestone 164).
 */

import type { JSX } from 'preact';
import {
  buildCustomItemsFromPackage,
  type CharacterCreationDraft,
  computeCustomKitCostCp,
  computeKitTotalWeightLbs,
  getStarterOutfitIds,
  resolveClassStartingWealthCp,
  STARTING_EQUIPMENT_PACKAGES,
  type StartingEquipmentPackage
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { computeEncumbranceState } from '../../../../rulesets/dnd35e/combat/tactical_doctrine.ts';
import type { DnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { resolveCurrencyConfig, toBaseUnits } from '../../../../systems/currency.system.ts';
import type { ItemDefinition } from '../../../../types/campaign.types.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import { Button } from '../../primitives/Button.tsx';
import { Badge, Chip } from '../../primitives/DataDisplay.tsx';
import { CharBuilderGearShop } from './CharBuilderGearShop.tsx';

/** Canonical D&D 3.5e creature size category union. */
export type SizeCat =
  'fine' | 'diminutive' | 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan' | 'colossal';

/** Props for `<EncumbranceBanner />`. */
export interface EncumbranceBannerProps {
  readonly strScore: number;
  readonly sizeCategory: SizeCat;
  readonly carriedLb: number;
}

/**
 * Compact SRD carried-weight & encumbrance load tier banner.
 */
export function EncumbranceBanner({ strScore, sizeCategory, carriedLb }: EncumbranceBannerProps): JSX.Element {
  const enc = computeEncumbranceState(strScore, sizeCategory, carriedLb);
  const tierMod =
    enc.loadTier === 'light'
      ? 'ui-dnd-encumbrance--light'
      : enc.loadTier === 'medium'
        ? 'ui-dnd-encumbrance--medium'
        : 'ui-dnd-encumbrance--heavy';
  const badgeTone = enc.loadTier === 'light' ? 'success' : enc.loadTier === 'medium' ? 'warning' : 'danger';

  return (
    <div className={`ui-dnd-encumbrance ${tierMod}`}>
      <span>
        <strong>Carried Weight:</strong> {`${carriedLb.toFixed(1)} lb`}
      </span>
      <Badge tone={badgeTone}>{`Load: ${enc.loadTier.toUpperCase()}`}</Badge>
      <span className="ui-dnd-card__sub">
        {`Light ≤${enc.lightMaxLb} | Med ≤${enc.mediumMaxLb} | Heavy ≤${enc.heavyMaxLb} lb (STR ${strScore}, ${sizeCategory})`}
      </span>
    </div>
  );
}

/** Props for `<CharBuilderEquipmentStep />`. */
export interface CharBuilderEquipmentStepProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly sys: DnD35SystemContent | undefined;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Equipment Step hosting Preset Starting Kits and the Custom Gear Shop.
 */
export function CharBuilderEquipmentStep({
  state,
  draft,
  sys,
  onUpdateDraft
}: CharBuilderEquipmentStepProps): JSX.Element {
  const itemsRegistry: Readonly<Record<string, ItemDefinition>> = {
    ...(sys?.items ?? {}),
    ...state.campaign.items
  };
  const currencyCfg = resolveCurrencyConfig(state);
  const goldDenomId = currencyCfg.defaultValueDenominationId ?? currencyCfg.baseUnitId;
  const starterOutfitIds = getStarterOutfitIds(itemsRegistry);
  const race = sys?.races[draft.raceId];
  const strScore = Math.max(1, (draft.baseAbilityScores.str ?? 10) + (race?.abilityAdjustments.str ?? 0));
  const sizeCategory: SizeCat = race?.size ?? 'medium';
  const mode = draft.equipmentMode ?? 'preset';

  const sortedPackages = [...STARTING_EQUIPMENT_PACKAGES].sort((a, b) => {
    const aRec = a.recommendedClassIds?.includes(draft.classId) ? 0 : a.recommendedClassIds ? 1 : 2;
    const bRec = b.recommendedClassIds?.includes(draft.classId) ? 0 : b.recommendedClassIds ? 1 : 2;
    return aRec - bRec;
  });

  const activePkg: StartingEquipmentPackage =
    STARTING_EQUIPMENT_PACKAGES.find((p) => p.id === draft.equipmentPackageId) ?? STARTING_EQUIPMENT_PACKAGES[0]!;
  const kitItems = activePkg.items ?? [];
  const totalWeight = computeKitTotalWeightLbs(kitItems, itemsRegistry, activePkg.freeOutfitId);
  const outfitDef = activePkg.freeOutfitId ? itemsRegistry[activePkg.freeOutfitId] : undefined;
  const fallbackOutfitName = starterOutfitIds[0]
    ? (itemsRegistry[starterOutfitIds[0]]?.name ?? 'Starter Outfit')
    : 'Starter Outfit';

  return (
    <div className="ui-dnd-sheet-body">
      <div className="ui-dnd-chip-row">
        <Chip active={mode === 'preset'} onClick={() => onUpdateDraft({ ...draft, equipmentMode: 'preset' })}>
          {`📦 Preset Starting Kits (${STARTING_EQUIPMENT_PACKAGES.length})`}
        </Chip>
        <Chip
          active={mode === 'custom'}
          onClick={() => {
            const cls = sys?.classes[draft.classId];
            onUpdateDraft({
              ...draft,
              equipmentMode: 'custom',
              customEquipmentItems: draft.customEquipmentItems ?? buildCustomItemsFromPackage(activePkg),
              customFreeOutfitId: draft.customFreeOutfitId ?? activePkg.freeOutfitId ?? starterOutfitIds[0],
              customStartingBudgetCp: draft.customStartingBudgetCp ?? resolveClassStartingWealthCp(cls, currencyCfg),
              customStartingBudgetClassId: draft.customStartingBudgetClassId ?? draft.classId
            });
          }}
        >
          🛒 Custom Gear Shop
        </Chip>
      </div>

      {mode === 'custom' ? (
        <CharBuilderGearShop
          state={state}
          draft={draft}
          itemsRegistry={itemsRegistry}
          sys={sys}
          strScore={strScore}
          sizeCategory={sizeCategory}
          onUpdateDraft={onUpdateDraft}
        />
      ) : (
        <div className="ui-dnd-wizard-stage">
          <div className="ui-dnd-wizard-pane">
            <div className="ui-dnd-card-list">
              {sortedPackages.map((pkg) => {
                const selected = draft.equipmentPackageId === pkg.id;
                const isRecommended = pkg.recommendedClassIds?.includes(draft.classId) === true;
                return (
                  <button
                    key={pkg.id}
                    type="button"
                    className={selected ? 'ui-dnd-list-row ui-dnd-list-row--selected' : 'ui-dnd-list-row'}
                    onClick={() => onUpdateDraft({ ...draft, equipmentMode: 'preset', equipmentPackageId: pkg.id })}
                  >
                    <div className="ui-dnd-list-row__main">
                      <div className="ui-dnd-card__row">
                        <strong className="ui-dnd-card__title">{pkg.name}</strong>
                        {isRecommended ? <Badge tone="warning">★ CLASS KIT</Badge> : null}
                      </div>
                      <span className="ui-dnd-card__sub">{pkg.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ui-dnd-wizard-pane">
            <div className="ui-dnd-card__row">
              <h3 className="ui-dnd-inspector__title">{activePkg.name}</h3>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const cls = sys?.classes[draft.classId];
                  const seededItems = buildCustomItemsFromPackage(activePkg);
                  const seededCostCp = computeCustomKitCostCp(seededItems, itemsRegistry, currencyCfg);
                  const pkgCoinCp = toBaseUnits(activePkg.startingGoldGp, goldDenomId, currencyCfg);
                  const classAvgCp = resolveClassStartingWealthCp(cls, currencyCfg);
                  onUpdateDraft({
                    ...draft,
                    equipmentMode: 'custom',
                    customEquipmentItems: seededItems,
                    customFreeOutfitId: activePkg.freeOutfitId ?? starterOutfitIds[0],
                    customStartingBudgetCp: Math.max(classAvgCp, seededCostCp + pkgCoinCp),
                    customStartingBudgetRolled: true,
                    customStartingBudgetClassId: draft.classId
                  });
                }}
              >
                ✏ Customize This Kit →
              </Button>
            </div>

            <p className="ui-dnd-card__sub">{activePkg.description}</p>
            <EncumbranceBanner strScore={strScore} sizeCategory={sizeCategory} carriedLb={totalWeight} />

            <div className="ui-dnd-meta-strip">
              <span>
                <strong>Weapon:</strong> {`${activePkg.weaponDice} ${activePkg.weaponDamageType}`}
              </span>
              <span>
                <strong>Armor/Shield:</strong> {`+${activePkg.armorBonus} / +${activePkg.shieldBonus}`}
              </span>
              <span>
                <strong>Free Outfit:</strong> {`${outfitDef?.name ?? fallbackOutfitName} (0 lb worn)`}
              </span>
              <span>
                <strong>Starting Coin:</strong> {`${activePkg.startingGoldGp} gp`}
              </span>
            </div>

            <div className="ui-dnd-card-list">
              {kitItems.map((entry, idx) => {
                const def = itemsRegistry[entry.itemId];
                const qty = Math.max(1, Math.floor(entry.quantity ?? 1));
                return (
                  <div key={`${entry.itemId}-${idx}`} className="ui-dnd-card">
                    <div className="ui-dnd-card__row">
                      <span>
                        <strong className="ui-dnd-card__title">
                          {`${def?.name ?? entry.itemId}${qty > 1 ? ` ×${qty}` : ''}`}
                        </strong>{' '}
                        <Badge>{entry.equipSlot ? entry.equipSlot.replace('_', ' ') : 'pack'}</Badge>
                      </span>
                      <span className="ui-dnd-card__sub ui-dnd-mono">{`${((def?.weight ?? 0) * qty).toFixed(1)} lb`}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
