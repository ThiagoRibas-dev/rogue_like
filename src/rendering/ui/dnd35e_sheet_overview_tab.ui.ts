/**
 * @file D&D 3.5e Character Sheet Column 1: Consolidated Identity, Reactive Paper Doll & Defenses.
 */

import { createUnequipItemAction } from '../../actions/inventory.actions.ts';
import { getComponent } from '../../core/ecs.ts';
import { queuePlayerIntent } from '../../core/game-loop.ts';
import { markAllDomainsDirty } from '../../core/presentation_queue.ts';
import {
  aggregateProgressionChassis,
  ALL_ABILITY_IDS,
  computeXpThresholdForLevel,
  DnD35UIAdapter,
  evaluateDnD35eEntityDAG,
  getDnD35EntityData
} from '../../rulesets/registry.ts';
import {
  ComponentType,
  type EquipmentComponent,
  type FighterComponent,
  type IdentityComponent
} from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UIAnatomicalSlotDescriptor, UIInventoryItem } from '../../types/ui_adapter.types.ts';
import { hideConsoleItemInspectCard, showConsoleItemInspectCard } from './console_inspect_card.ui.ts';
import { renderReactivePaperDollWidget } from './console_inventory.ui.ts';

const DEFAULT_ABILITY_SCORE = 10;
const LIGHT_LOAD_PER_STR = 15;
const DEFAULT_GOLD_CURRENCY = 250;
const DEFAULT_ITEM_PRICE_GP = 25;
const DEFAULT_ITEM_WEIGHT_LBS = 1.0;
const DEFAULT_CARRIED_WEIGHT_LBS = 18.5;
const dndAdapter = new DnD35UIAdapter();

export type SheetMorphologyMode = 'live' | 'marilith_6arm' | 'quadruped_wolf';

let activeWeaponSet = 1;
let activeMorphologyMode: SheetMorphologyMode = 'live';

export function getSheetMorphologyMode(): SheetMorphologyMode {
  return activeMorphologyMode;
}

export function setSheetMorphologyMode(mode: SheetMorphologyMode): void {
  activeMorphologyMode = mode;
}

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

const SLOT_VISUAL_MAP: Readonly<Record<string, { label: string; glyph: string; rail: 'left' | 'right' }>> = {
  head: { label: 'Head', glyph: '🪖', rail: 'left' },
  cloak: { label: 'Cloak', glyph: '🧥', rail: 'left' },
  shoulders: { label: 'Cloak', glyph: '🧥', rail: 'left' },
  ring_1: { label: 'Ring 1', glyph: '💍', rail: 'left' },
  ring_left: { label: 'Ring L', glyph: '💍', rail: 'left' },
  hands: { label: 'Gloves', glyph: '🧤', rail: 'left' },
  hand: { label: 'Gloves', glyph: '🧤', rail: 'left' },
  main_hand: { label: 'Main Hand', glyph: '⚔️', rail: 'left' },
  ammo: { label: 'Ammo', glyph: '🏹', rail: 'left' },
  ranged: { label: 'Ammo', glyph: '🏹', rail: 'left' },
  neck: { label: 'Neck', glyph: '📿', rail: 'right' },
  torso: { label: 'Armor', glyph: '🛡️', rail: 'right' },
  body: { label: 'Armor', glyph: '🛡️', rail: 'right' },
  waist: { label: 'Belt', glyph: '🎗️', rail: 'right' },
  ring_2: { label: 'Ring 2', glyph: '💍', rail: 'right' },
  ring_right: { label: 'Ring R', glyph: '💍', rail: 'right' },
  feet: { label: 'Boots', glyph: '🥾', rail: 'right' },
  foot: { label: 'Boots', glyph: '🥾', rail: 'right' },
  off_hand: { label: 'Off Hand', glyph: '🗡️', rail: 'right' }
};

function mapLiveEntityItemToUI(state: GameState, itemEntityId: EntityId): UIInventoryItem | null {
  const itemComp = getComponent(state, itemEntityId, ComponentType.Item);
  if (!itemComp) return null;
  const def = state.campaign.items[itemComp.itemId];
  const name = def?.name ?? itemComp.itemId.replace(/_/g, ' ');
  const renderable = getComponent(state, itemEntityId, ComponentType.Renderable);
  const slot = def?.equippable?.slot ?? 'held';
  const isWeapon = def?.category === 'weapon' || slot === 'main_hand' || slot === 'off_hand' || slot === 'two_handed';
  const isArmor = def?.category === 'armor' || slot === 'torso' || slot === 'body';
  const isConsumable = def?.category === 'consumable' || def?.consumable !== undefined;

  return {
    id: itemComp.itemId,
    entityId: itemEntityId,
    name,
    iconUrl: isWeapon ? '⚔️' : isArmor ? '🛡️' : isConsumable ? '🧪' : (renderable?.glyph ?? '📦'),
    category: isWeapon ? 'weapon' : isArmor ? 'armor' : isConsumable ? 'consumable' : 'accessory',
    quantity: itemComp.charges ?? 1,
    priceGp: def?.baseValue ?? DEFAULT_ITEM_PRICE_GP,
    weightLbs: def?.weight ?? DEFAULT_ITEM_WEIGHT_LBS,
    isEquipped: true,
    inspectData: {
      title: name,
      loreText: def?.description ?? 'Adventuring gear.',
      baseMetrics: [
        ...(def?.equippable?.attackBonus ? [{ label: 'Attack Mod', value: `+${def.equippable.attackBonus}` }] : []),
        ...(def?.equippable?.defenseBonus ? [{ label: 'Armor Mod', value: `+${def.equippable.defenseBonus} AC` }] : []),
        { label: 'Slot', value: String(slot).toUpperCase() }
      ],
      specialProperties: (def?.tags ?? []).map((t) => ({ text: `Tag: ${t}`, colorHint: 'green' as const }))
    }
  };
}

function buildLiveAnatomicalSlots(state: GameState, playerId: EntityId): ReadonlyArray<UIAnatomicalSlotDescriptor> {
  if (activeMorphologyMode !== 'live') {
    return dndAdapter.buildAnatomicalSlotsForPreset(activeMorphologyMode);
  }

  const equipment = getComponent(state, playerId, ComponentType.Equipment) as EquipmentComponent | undefined;
  const fallbackData = dndAdapter.getInventoryData({});
  if (!equipment || equipment.slots.length === 0) {
    return fallbackData.anatomicalSlots ?? [];
  }

  const seenSlotIds = new Set<string>();
  const descriptors: UIAnatomicalSlotDescriptor[] = [];

  for (const slot of equipment.slots) {
    const visual = SLOT_VISUAL_MAP[slot.id] ?? SLOT_VISUAL_MAP[slot.slotType];
    const isDuplicate = seenSlotIds.has(slot.id);
    seenSlotIds.add(slot.id);

    const rail: 'left' | 'right' | 'extra' = !visual || isDuplicate ? 'extra' : visual.rail;
    const liveEquipped = slot.equippedItem !== null ? mapLiveEntityItemToUI(state, slot.equippedItem) : null;
    const fallbackEquipped = fallbackData.equippedSlots[slot.id] ?? null;

    descriptors.push({
      slotId: slot.id,
      slotType: slot.slotType,
      label: visual?.label ?? slot.id.replace(/_/g, ' '),
      emptyGlyph: visual?.glyph ?? '🦾',
      rail,
      suppressed: slot.suppressed === true,
      ...(slot.occupiedBySlotId ? { occupiedBySlotId: slot.occupiedBySlotId } : {}),
      isExtraLimb: rail === 'extra',
      equippedItem: liveEquipped ?? fallbackEquipped
    });
  }

  if (descriptors.length < 12 && fallbackData.anatomicalSlots) {
    const existingIds = new Set(descriptors.map((d) => d.slotId));
    for (const fb of fallbackData.anatomicalSlots) {
      if (!existingIds.has(fb.slotId)) {
        descriptors.push(fb);
      }
    }
  }

  return descriptors;
}

/**
 * Renders Column 1 (Left Column): Identity, Attributes, Reactive Paper Doll & Defenses into `container`.
 */
export function renderSheetOverviewTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const dndData = getDnD35EntityData(state, playerId);
  const identity = getComponent(state, playerId, ComponentType.Identity) as IdentityComponent | undefined;
  const fighter = getComponent(state, playerId, ComponentType.Fighter) as FighterComponent | undefined;

  const conMod = evalResult?.dagResult.effectiveAbilityModifiers.con ?? 0;
  const chassis = aggregateProgressionChassis(dndData.tracks, conMod, dndData.levelAdjustment ?? 0);
  const xpCurr = fighter?.xp ?? 0;
  const xpNext = computeXpThresholdForLevel(chassis.ecl + 1);
  const trackSummary = dndData.tracks.map((t) => `${t.trackId} ${t.levels}`).join(' / ') || 'Adventurer 1';

  const nameHeading = document.createElement('h3');
  nameHeading.className = 'crpg-section-heading';
  nameHeading.textContent = identity?.name ?? 'Jestan Millown';
  col.appendChild(nameHeading);

  const xpRow = document.createElement('div');
  xpRow.className = 'crpg-xp-row';
  for (const txt of [
    `ECL ${chassis.ecl}`,
    trackSummary,
    `${xpCurr.toLocaleString()} / ${xpNext.toLocaleString()} XP`
  ]) {
    const sp = document.createElement('span');
    sp.textContent = txt;
    xpRow.appendChild(sp);
  }
  col.appendChild(xpRow);

  const split = document.createElement('div');
  split.className = 'crpg-identity-split';

  const portraitFrame = document.createElement('div');
  portraitFrame.className = 'crpg-portrait-frame';
  const avatarGlyph = document.createElement('div');
  avatarGlyph.className = 'crpg-portrait-avatar';
  avatarGlyph.textContent =
    activeMorphologyMode === 'marilith_6arm' ? '🐍' : activeMorphologyMode === 'quadruped_wolf' ? '🐺' : '🧙‍♂️';

  const hpPill = document.createElement('div');
  hpPill.className = 'crpg-portrait-hp-pill';
  const heart = document.createElement('span');
  heart.className = 'crpg-hp-heart';
  heart.textContent = '♥';
  const hpText = document.createElement('span');
  hpText.textContent = `${fighter?.hp ?? chassis.maxHp}/${fighter?.maxHp ?? chassis.maxHp}`;
  hpPill.append(heart, hpText);
  portraitFrame.append(avatarGlyph, hpPill);

  const rightIdentity = document.createElement('div');
  rightIdentity.className = 'crpg-identity-right';

  const alignPill = document.createElement('div');
  alignPill.className = 'crpg-alignment-pill';
  alignPill.textContent = (dndData.alignment ?? 'neutral_good').toUpperCase().replace(/_/g, ' ');
  rightIdentity.appendChild(alignPill);

  const raceLine = document.createElement('div');
  raceLine.className = 'crpg-race-line';
  raceLine.textContent = `⚥ ${(dndData.raceId ?? 'human').toUpperCase()}`;
  rightIdentity.appendChild(raceLine);

  const attrTable = document.createElement('div');
  attrTable.className = 'crpg-attr-table';
  for (const ab of ALL_ABILITY_IDS) {
    const scoreVal = evalResult?.dagResult.effectiveAbilities[ab]?.base ?? DEFAULT_ABILITY_SCORE;
    const modVal = evalResult?.dagResult.effectiveAbilityModifiers[ab] ?? 0;
    const row = document.createElement('div');
    row.className = 'crpg-attr-row';
    const lbl = document.createElement('span');
    lbl.className = 'crpg-attr-label';
    lbl.textContent = ab.toUpperCase();
    const sc = document.createElement('span');
    sc.className = 'crpg-attr-score';
    sc.textContent = `${scoreVal}`;
    const md = document.createElement('span');
    md.className = 'crpg-attr-mod';
    md.textContent = formatSigned(modVal);
    row.append(lbl, sc, md);
    attrTable.appendChild(row);
  }
  rightIdentity.appendChild(attrTable);
  split.append(portraitFrame, rightIdentity);
  col.appendChild(split);

  // Reactive Anatomical Paper Doll
  const pdHost = document.createElement('div');
  const strScore = evalResult?.dagResult.effectiveAbilities.str?.base ?? DEFAULT_ABILITY_SCORE;
  const anatomicalSlots = buildLiveAnatomicalSlots(state, playerId);
  renderReactivePaperDollWidget(
    pdHost,
    {
      equippedSlots: {},
      anatomicalSlots,
      morphologyLabel: activeMorphologyMode,
      activeWeaponSetIndex: activeWeaponSet,
      stashItems: [],
      currentWeightLbs: DEFAULT_CARRIED_WEIGHT_LBS,
      maxWeightLbs: strScore * LIGHT_LOAD_PER_STR,
      goldCurrency: DEFAULT_GOLD_CURRENCY
    },
    {
      onHoverItem: (item, event) => {
        if (item?.inspectData) showConsoleItemInspectCard(item.inspectData, event);
        else hideConsoleItemInspectCard();
      },
      onUnequipItem: (slotId) => {
        if (activeMorphologyMode === 'live') {
          queuePlayerIntent(createUnequipItemAction(playerId, slotId));
          markAllDomainsDirty();
        }
      },
      onSelectWeaponSet: (idx) => {
        activeWeaponSet = idx;
      }
    }
  );
  col.appendChild(pdHost);

  // Armor Class & Saving Throws Strip
  const defHeader = document.createElement('div');
  defHeader.className = 'crpg-subbanner';
  defHeader.textContent = 'Armor Class & Saving Throws';
  col.appendChild(defHeader);

  const acBreakdown = evalResult?.dagResult.acBreakdown;
  const saves = evalResult?.dagResult.saves;
  const defGrid = document.createElement('div');
  defGrid.className = 'crpg-ac-saves-grid';
  for (const c of [
    { label: 'Armor Class', value: `${acBreakdown?.fullAC ?? 12}` },
    { label: 'Flat-footed', value: `${acBreakdown?.flatFootedAC ?? 10}` },
    { label: 'Touch', value: `${acBreakdown?.touchAC ?? 12}` },
    { label: 'Fortitude', value: formatSigned(saves?.fort ?? chassis.baseSaves.fort) },
    { label: 'Reflex', value: formatSigned(saves?.ref ?? chassis.baseSaves.ref) },
    { label: 'Will', value: formatSigned(saves?.will ?? chassis.baseSaves.will) }
  ]) {
    const cell = document.createElement('div');
    cell.className = 'crpg-defense-cell';
    const lbl = document.createElement('span');
    lbl.className = 'crpg-defense-cell-label';
    lbl.textContent = c.label;
    const val = document.createElement('span');
    val.className = 'crpg-defense-cell-val';
    val.textContent = c.value;
    cell.append(lbl, val);
    defGrid.appendChild(cell);
  }
  col.appendChild(defGrid);

  const dexMod = evalResult?.dagResult.effectiveAbilityModifiers.dex ?? 0;
  const strMod = evalResult?.dagResult.effectiveAbilityModifiers.str ?? 0;
  const speedFooter = document.createElement('div');
  speedFooter.className = 'crpg-speed-footer';
  speedFooter.textContent = `BAB ${formatSigned(chassis.totalBab)} • Grapple ${formatSigned(chassis.totalBab + strMod)} • Init ${formatSigned(dexMod)} • Speed 30 ft.`;
  col.appendChild(speedFooter);

  container.appendChild(col);
}
