import { getComponent } from '../../core/ecs.ts';
import {
  applyCharacterCreationToPlayer,
  buildPrerequisiteContextForActor,
  type CharacterCreationDraft,
  computeFirstLevelFeatSlotBudget,
  type DnD35FeatDefinition,
  type DnD35SystemContent,
  evaluatePrerequisiteAST,
  type FeatSlotDescriptor,
  getDnD35EntityData,
  getDnD35SystemContent,
  isFeatAllowedInSlot,
  type PrerequisiteEvalContext
} from '../../rulesets/registry.ts';
import { ComponentType } from '../../types/components.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import { renderFeatInspector } from './dnd35e_inspector.ui.ts';

const TARGETED_WEAPONS: ReadonlyArray<string> = [
  'longsword',
  'greatsword',
  'battleaxe',
  'greataxe',
  'shortbow',
  'longbow',
  'dagger',
  'shortsword',
  'warhammer',
  'rapier',
  'scimitar',
  'unarmed_strike'
];
const TARGETED_SCHOOLS: ReadonlyArray<string> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation'
];

let inspectedFeatId = 'power_attack';
let featFilterMode: 'all' | 'eligible' | 'fighter' | 'combat' | 'magic' = 'all';

function classifyFeatCategory(feat: DnD35FeatDefinition): {
  readonly isFighterBonus: boolean;
  readonly isCombat: boolean;
  readonly isMagic: boolean;
} {
  const isFighterBonus = feat.isFighterBonusFeat === true;
  const prereqJson = feat.prerequisites ? JSON.stringify(feat.prerequisites) : '';
  const descLower = feat.description.toLowerCase();

  const isMagic =
    feat.metamagicDescriptor !== undefined ||
    (feat.modifiers !== undefined &&
      feat.modifiers.some((m) =>
        ['caster_level', 'spell_resistance', 'spell_penetration', 'spells_per_day', 'turn_undead'].some((target) =>
          m.target.includes(target)
        )
      )) ||
    prereqJson.includes('caster_level') ||
    prereqJson.includes('spells') ||
    descLower.includes('metamagic') ||
    descLower.includes('caster level') ||
    descLower.includes('turn undead') ||
    descLower.includes('spell');

  const isCombat =
    isFighterBonus ||
    (feat.ruleOverrides !== undefined && feat.ruleOverrides.length > 0) ||
    (feat.activatedAbilities !== undefined && feat.activatedAbilities.length > 0) ||
    (feat.modifiers !== undefined &&
      feat.modifiers.some((m) =>
        ['attack', 'damage', 'crit_threat_doubling', 'ac', 'initiative', 'grapple', 'trip', 'disarm'].some((target) =>
          m.target.includes(target)
        )
      )) ||
    prereqJson.includes('min_bab');

  return { isFighterBonus, isCombat, isMagic };
}

/** Configuration for the shared Feats step renderer (Character Creation & Level-Up). */
export interface SharedFeatsStepConfig {
  readonly scrollPrefix: string;
  readonly slotSummaryLabel: string;
  readonly totalSlots: number;
  readonly slots?: ReadonlyArray<FeatSlotDescriptor> | undefined;
  readonly alreadyOwnedFeatIds: ReadonlyArray<string>;
  readonly selectedFeatIds: ReadonlyArray<string>;
  readonly prereqCtx: PrerequisiteEvalContext;
  readonly onUpdateSelectedFeats: (nextFeats: string[]) => void;
  readonly onRefresh: () => void;
}

/**
 * Renders the shared 2-pane Feat Selection step with category filter chips (`All`, `Eligible`, `Fighter Bonus`, `Combat`, `Metamagic / Magic`).
 *
 * @param container Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param config Shared feats step configuration.
 */
export function renderSharedFeatsStep(
  container: HTMLElement,
  sys: DnD35SystemContent,
  config: SharedFeatsStepConfig
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = `${config.scrollPrefix}-feats-left`;

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = `${config.scrollPrefix}-feats-right`;

  const filterBar = document.createElement('div');
  filterBar.className = 'dnd35-filter-bar';
  const summaryStrong = document.createElement('strong');
  summaryStrong.style.color =
    config.selectedFeatIds.length >= config.totalSlots ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-gold, #f1c40f)';
  summaryStrong.textContent = config.slotSummaryLabel;
  filterBar.appendChild(summaryStrong);

  const chipRow = document.createElement('div');
  chipRow.style.display = 'flex';
  chipRow.style.flexWrap = 'wrap';
  chipRow.style.gap = '4px';
  const featModes: ReadonlyArray<{ readonly id: typeof featFilterMode; readonly label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'eligible', label: 'Eligible' },
    { id: 'fighter', label: 'Fighter Bonus' },
    { id: 'combat', label: 'Combat' },
    { id: 'magic', label: 'Metamagic / Magic' }
  ];
  for (const fm of featModes) {
    const fBtn = document.createElement('button');
    fBtn.type = 'button';
    fBtn.className = 'modal-btn';
    fBtn.style.padding = '3px 7px';
    fBtn.style.fontSize = '0.72rem';
    fBtn.style.borderColor = featFilterMode === fm.id ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    fBtn.textContent = fm.label;
    fBtn.addEventListener('click', () => {
      featFilterMode = fm.id;
      config.onRefresh();
    });
    chipRow.appendChild(fBtn);
  }
  filterBar.appendChild(chipRow);
  leftPane.appendChild(filterBar);

  const allFeats = Object.values(sys.feats);
  if (!sys.feats[inspectedFeatId] && allFeats.length > 0) {
    inspectedFeatId = allFeats[0]!.id;
  }

  const activeSlot = config.slots?.[config.selectedFeatIds.length];
  const chainedFeats = Array.from(new Set([...config.prereqCtx.feats, ...config.selectedFeatIds]));

  for (const feat of allFeats) {
    const matchingSelected = config.selectedFeatIds.filter((f) => f === feat.id || f.startsWith(`${feat.id}:`));
    const isSelected = matchingSelected.length > 0;
    const isTargeted = feat.repeatable?.mode === 'targeted';

    let targetSelect: HTMLSelectElement | undefined;
    if (isTargeted) {
      targetSelect = document.createElement('select');
      targetSelect.style.cssText =
        'padding: 2px 4px; font-size: 0.72rem; margin-right: 4px; background: var(--crpg-bg-card, #222); color: inherit; border: 1px solid var(--border-color);';
      const tCat = feat.repeatable?.targetCategory;
      const opts =
        tCat === 'weapon' ? TARGETED_WEAPONS : tCat === 'school' ? TARGETED_SCHOOLS : Object.keys(sys.skills ?? {});
      for (const opt of opts) {
        const oEl = document.createElement('option');
        oEl.value = opt;
        oEl.textContent = opt.replace(/_/g, ' ');
        targetSelect.appendChild(oEl);
      }
      targetSelect.addEventListener('click', (e) => e.stopPropagation());
    }

    const curTarget = targetSelect?.value;
    const evalCtx: PrerequisiteEvalContext = {
      ...config.prereqCtx,
      feats: chainedFeats,
      ...(curTarget ? { targetId: curTarget } : {})
    };
    const alreadyOwned = config.alreadyOwnedFeatIds.includes(feat.id);
    const allowedInSlot = activeSlot ? isFeatAllowedInSlot(feat, activeSlot) : true;
    const meets = activeSlot?.ignorePrerequisites
      ? true
      : feat.prerequisites
        ? evaluatePrerequisiteAST(feat.prerequisites, evalCtx)
        : true;
    const cat = classifyFeatCategory(feat);

    if (featFilterMode === 'eligible' && (!meets || alreadyOwned || !allowedInSlot)) continue;
    if (featFilterMode === 'fighter' && !cat.isFighterBonus) continue;
    if (featFilterMode === 'combat' && !cat.isCombat) continue;
    if (featFilterMode === 'magic' && !cat.isMagic) continue;

    const canToggle =
      isSelected || (!alreadyOwned && allowedInSlot && meets && config.selectedFeatIds.length < config.totalSlots);

    const row = document.createElement('div');
    row.className = `dnd35-list-item${isSelected ? ' selected' : ''}${inspectedFeatId === feat.id ? ' inspected' : ''}`;
    row.addEventListener('click', () => {
      inspectedFeatId = feat.id;
      renderFeatInspector(rightPane, feat, evalCtx);
    });

    const label = document.createElement('div');
    const fighterTag = cat.isFighterBonus ? ' [Fighter]' : '';
    const targetBadge =
      matchingSelected.length > 0
        ? ` (${matchingSelected
            .map((m) => (m.includes(':') ? m.split(':')[1] : ''))
            .filter(Boolean)
            .join(', ')})`
        : '';
    label.textContent = `${alreadyOwned ? '✔ [Owned]' : isSelected ? '☑' : meets && allowedInSlot ? '🟢' : '🔴'} ${feat.name}${targetBadge}${fighterTag}`;

    const actionWrap = document.createElement('div');
    actionWrap.style.display = 'flex';
    actionWrap.style.alignItems = 'center';

    if (!isSelected && targetSelect) {
      actionWrap.appendChild(targetSelect);
    }

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'modal-btn';
    toggleBtn.style.padding = '3px 8px';
    toggleBtn.style.fontSize = '0.74rem';
    toggleBtn.textContent = isSelected ? 'Remove' : 'Select';
    toggleBtn.disabled = !canToggle;
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      inspectedFeatId = feat.id;
      const finalFeatId = isTargeted && targetSelect ? `${feat.id}:${targetSelect.value}` : feat.id;
      const nextFeats = isSelected
        ? config.selectedFeatIds.filter((id) => id !== feat.id && !id.startsWith(`${feat.id}:`))
        : [...config.selectedFeatIds, finalFeatId];
      config.onUpdateSelectedFeats(nextFeats);
    });

    actionWrap.appendChild(toggleBtn);
    row.appendChild(label);
    row.appendChild(actionWrap);
    leftPane.appendChild(row);
  }

  const activeFeat = sys.feats[inspectedFeatId] ?? allFeats[0];
  if (activeFeat) {
    renderFeatInspector(rightPane, activeFeat, { ...config.prereqCtx, feats: chainedFeats });
  }

  stage.appendChild(leftPane);
  stage.appendChild(rightPane);
  container.appendChild(stage);
}

/**
 * Renders Step 5 (Feat Selection) in the Level 1 Character Creation Wizard via `renderSharedFeatsStep`.
 *
 * @param container Host container element.
 * @param state Current GameState.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderCharBuilderFeatsStep(
  container: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const sys = getDnD35SystemContent(state.campaign);
  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined);
  if (!sys || playerId === undefined) return;

  const race = sys.races[draft.raceId];
  const cls = sys.classes[draft.classId];
  const budget = computeFirstLevelFeatSlotBudget(race, cls, draft.selectedAcfs);
  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const dndData = getDnD35EntityData(previewState, playerId);
  const prereqCtx = buildPrerequisiteContextForActor(dndData, sys.classes);

  const parts = budget.slots.map((s) => s.label);

  renderSharedFeatsStep(container, sys, {
    scrollPrefix: 'char',
    slotSummaryLabel: `Feats Selected: ${draft.selectedFeats.length} / ${budget.totalSlots} (${parts.join(' + ')})`,
    totalSlots: budget.totalSlots,
    slots: budget.slots,
    alreadyOwnedFeatIds: [],
    selectedFeatIds: draft.selectedFeats,
    prereqCtx,
    onUpdateSelectedFeats: (nextFeats) => updateDraft({ ...draft, selectedFeats: nextFeats }),
    onRefresh: () => updateDraft(draft)
  });
}
