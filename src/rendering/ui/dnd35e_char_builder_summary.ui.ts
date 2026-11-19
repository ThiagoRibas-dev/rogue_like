/**
 * @file Final Wizard Step (`Review & Identity`) for D&D 3.5e Character Creation.
 * Left pane: Hero Portrait Preview, Character Name + Randomize, Title/Epithet, ASCII Glyph Color,
 * Character Traits/Mannerisms (chips + custom input), and multi-tab Sprite Picker.
 * Right pane: Authoritative live Character Sheet Summary evaluated via `applyCharacterCreationToPlayer`
 * + `projectCharacterSheetData` + `DnD35UIAdapter.getInventoryData` (memoized on mechanical draft state).
 */

import {
  applyCharacterCreationToPlayer,
  type CharacterCreationDraft,
  MAX_CHARACTER_MANNERISMS,
  MAX_CHARACTER_NAME_LENGTH,
  MAX_CHARACTER_TITLE_LENGTH,
  resolveClassSpellAcquisitionMode
} from '../../rulesets/dnd35e/character_builder.ts';
import { computeEncumbranceState } from '../../rulesets/dnd35e/combat/tactical_doctrine.ts';
import { getDnD35EntityData } from '../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { DnD35UIAdapter } from '../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { projectCharacterSheetData } from '../../rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UICharacterSheetModel, UIInventoryModel } from '../../types/ui_adapter.types.ts';
import { renderSpriteToDataUrl } from '../sprite_atlas.ts';
import { renderSpritePickerSection, resetSpritePickerUiState } from './dnd35e_char_builder_sprite_picker.ui.ts';

const HERO_PORTRAIT_PX = 56;
const MAX_CUSTOM_TRAIT_LENGTH = 24;

const GLYPH_COLOR_SWATCHES: ReadonlyArray<string> = [
  '#ffffff',
  '#f1c40f',
  '#e67e22',
  '#e74c3c',
  '#9b59b6',
  '#3498db',
  '#1abc9c',
  '#2ecc71',
  '#95a5a6',
  '#ff9ff3'
];

const QUICK_TITLES: ReadonlyArray<string> = [
  'the Bold',
  'Shadowstep',
  'Dawnbringer',
  'Ironhand',
  'the Wise',
  'Oathkeeper'
];

const QUICK_TRAITS: ReadonlyArray<string> = [
  'Stoic',
  'Sharp-eyed',
  'Devout',
  'Reckless',
  'Scholarly',
  'Battle-scarred',
  'Wry humor',
  'Cautious'
];

const FANTASY_NAMES_BY_RACE: Readonly<Record<string, ReadonlyArray<string>>> = {
  human: ['Alden', 'Beren', 'Cassia', 'Darian', 'Elena', 'Garrick', 'Lyra', 'Rowan', 'Seraphina', 'Theron'],
  dwarf: ['Baern', 'Darrak', 'Eberk', 'Harbek', 'Kathra', 'Morgran', 'Rurik', 'Torgga', 'Vistra', 'Thorin'],
  elf: ['Adran', 'Aelar', 'Aramil', 'Caelynn', 'Enialis', 'Felosial', 'Ivellios', 'Leshanna', 'Sariel', 'Thia'],
  gnome: ['Boddynock', 'Dimble', 'Fonkin', 'Gimble', 'Lilli', 'Namfoodle', 'Orryn', 'Shamil', 'Zook', 'Nissa'],
  half_elf: ['Aelric', 'Brynna', 'Corrin', 'Elaria', 'Kaelen', 'Mireille', 'Soren', 'Talia', 'Vaelen', 'Ysolde'],
  half_orc: ['Dench', 'Feng', 'Gell', 'Henk', 'Imsh', 'Keth', 'Ront', 'Shump', 'Thokk', 'Baggi'],
  halfling: ['Alton', 'Cade', 'Eldon', 'Garret', 'Lidda', 'Milo', 'Osborn', 'Roscoe', 'Verna', 'Wellby']
};

interface CachedMechanicalPreview {
  readonly stateRef: GameState;
  readonly playerId: EntityId;
  readonly fingerprint: string;
  readonly previewState: GameState;
  readonly sheet: UICharacterSheetModel;
  readonly inv: UIInventoryModel;
}

let cachedPreview: CachedMechanicalPreview | null = null;
let customTraitInputValue = '';
let nameCycleCursor = 0;

/** Resets Summary step UI state and preview cache for a fresh Character Creation session. */
export function resetSummaryStepUiState(): void {
  cachedPreview = null;
  customTraitInputValue = '';
  nameCycleCursor = 0;
  resetSpritePickerUiState();
}

function buildMechanicalDraftFingerprint(draft: CharacterCreationDraft): string {
  const {
    characterName: _n,
    characterTitle: _t,
    spriteId: _s,
    spriteManuallySelected: _sm,
    glyphColor: _gc,
    mannerisms: _m,
    ...mechanical
  } = draft;
  return JSON.stringify(mechanical);
}

function getOrComputeMechanicalPreview(
  state: GameState,
  playerId: EntityId,
  draft: CharacterCreationDraft
): CachedMechanicalPreview {
  const fingerprint = buildMechanicalDraftFingerprint(draft);
  if (
    cachedPreview &&
    cachedPreview.stateRef === state &&
    cachedPreview.playerId === playerId &&
    cachedPreview.fingerprint === fingerprint
  ) {
    return cachedPreview;
  }
  const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
  const sheet = projectCharacterSheetData({ state: previewState, entityId: playerId });
  const inv = new DnD35UIAdapter().getInventoryData({ state: previewState, entityId: playerId });
  cachedPreview = { stateRef: state, playerId, fingerprint, previewState, sheet, inv };
  return cachedPreview;
}

function pickNextFantasyName(raceId: string, currentName: string): string {
  const pool = FANTASY_NAMES_BY_RACE[raceId] ?? FANTASY_NAMES_BY_RACE['human']!;
  nameCycleCursor = (nameCycleCursor + 1) % pool.length;
  const candidate = pool[nameCycleCursor]!;
  return candidate === currentName ? pool[(nameCycleCursor + 1) % pool.length]! : candidate;
}

function makeLabeledLine(label: string, value: string, topMargin = false): HTMLElement {
  const div = document.createElement('div');
  if (topMargin) div.style.marginTop = '4px';
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  div.append(strong, document.createTextNode(value));
  return div;
}

function renderAuthoritativeSheetSummary(
  rightPane: HTMLElement,
  state: GameState,
  playerId: EntityId,
  draft: CharacterCreationDraft
): void {
  const { previewState, sheet, inv } = getOrComputeMechanicalPreview(state, playerId, draft);
  const previewDnd = getDnD35EntityData(previewState, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const cls = sys?.classes[draft.classId];
  const strScore = sheet.attributes.find((a) => a.id === 'str')?.score ?? 10;
  const sizeCategory = previewDnd.sizeCategory ?? 'medium';
  const enc = computeEncumbranceState(strScore, sizeCategory, inv.currentWeightLbs);

  const displayName = draft.characterTitle?.trim()
    ? `${(draft.characterName ?? '').trim() || 'Adventurer'} ${draft.characterTitle.trim()}`
    : (draft.characterName ?? '').trim() || 'Adventurer';

  const header = document.createElement('h3');
  header.style.cssText = 'margin:0 0 8px 0;color:var(--crpg-gold, #f1c40f);';
  header.textContent = `${displayName} — ${sheet.raceName} ${sheet.levelSummary}`;
  rightPane.appendChild(header);

  const vitalsCard = document.createElement('div');
  vitalsCard.className = 'char-summary-section-card';
  const savesText = sheet.savingThrows.map((s) => `${s.name} ${s.total >= 0 ? `+${s.total}` : s.total}`).join(' · ');
  const babText = sheet.babTotal >= 0 ? `+${sheet.babTotal}` : `${sheet.babTotal}`;
  const grappleVal = sheet.grappleBonus ?? sheet.babTotal;
  const grappleText = grappleVal >= 0 ? `+${grappleVal}` : `${grappleVal}`;
  const initVal = sheet.initiativeBonus ?? 0;
  const initText = initVal >= 0 ? `+${initVal}` : `${initVal}`;
  vitalsCard.innerHTML = `<div class="char-summary-stat-grid">
      <div><strong>HP:</strong> ${sheet.hpCurrent}/${sheet.hpMax}</div>
      <div><strong>AC:</strong> ${sheet.acTotal} (Touch ${sheet.touchAc ?? 10} / Flat ${sheet.flatFootedAc ?? 10})</div>
      <div><strong>BAB / Grapple:</strong> ${babText} / ${grappleText}</div>
      <div><strong>Init / Speed:</strong> ${initText} / ${sheet.speedFt ?? 30} ft</div>
      <div style="grid-column:1 / -1;"><strong>Saving Throws:</strong> ${savesText}</div>
    </div>`;
  rightPane.appendChild(vitalsCard);

  const abilCard = document.createElement('div');
  abilCard.className = 'char-summary-section-card';
  abilCard.innerHTML = `<div class="char-summary-ability-row">${sheet.attributes
    .map(
      (a) =>
        `<div class="char-summary-ability-cell"><strong>${a.id.toUpperCase()}</strong><span>${a.score} (${a.modifier >= 0 ? `+${a.modifier}` : a.modifier})</span></div>`
    )
    .join('')}</div>`;
  rightPane.appendChild(abilCard);

  const attacks = sheet.attackGroups ?? [];
  const atkCard = document.createElement('div');
  atkCard.className = 'char-summary-section-card';
  atkCard.appendChild(
    makeLabeledLine(
      'Attack Routine',
      attacks.map((g) => `${g.label} (${g.attackBonuses} · ${g.damageFormula} · ${g.criticalProfile})`).join(' | ') ||
        'Unarmed Strike'
    )
  );
  rightPane.appendChild(atkCard);

  const feats = (sheet.featureEntries ?? []).filter((f) => f.category === 'feat').map((f) => f.name);
  const classFeatures = (sheet.featureEntries ?? []).filter((f) => f.category !== 'feat').map((f) => f.name);
  const featCard = document.createElement('div');
  featCard.className = 'char-summary-section-card';
  featCard.append(
    makeLabeledLine(`Feats (${feats.length})`, feats.join(', ') || 'None'),
    makeLabeledLine(`Traits & Class Features (${classFeatures.length})`, classFeatures.join(', ') || 'None', true)
  );
  rightPane.appendChild(featCard);

  const spellMode = cls ? resolveClassSpellAcquisitionMode(cls) : 'none';
  const hasArcaneOrDivine =
    spellMode !== 'none' ||
    draft.domains.length > 0 ||
    draft.arcaneSchool !== undefined ||
    draft.familiarId !== undefined ||
    draft.animalCompanionId !== undefined;
  if (hasArcaneOrDivine) {
    const magicCard = document.createElement('div');
    magicCard.className = 'char-summary-section-card';
    if (spellMode === 'prayerbook_full_list') {
      magicCard.appendChild(
        makeLabeledLine('Spellcasting', `Divine Prayerbook (Full ${cls?.name ?? draft.classId} spell list)`)
      );
    } else if (spellMode !== 'none') {
      const spellNames = draft.knownSpells.map((id) => sys?.spells[id]?.name ?? id);
      magicCard.appendChild(makeLabeledLine(`Known Spells (${spellNames.length})`, spellNames.join(', ') || 'None'));
    }
    if (draft.domains.length > 0) {
      const domNames = draft.domains.map((id) => sys?.domains[id]?.name ?? id);
      magicCard.appendChild(makeLabeledLine('Domains', domNames.join(', '), true));
    }
    if (draft.arcaneSchool) {
      const schoolInfo =
        draft.prohibitedSchools.length > 0
          ? `${draft.arcaneSchool} (Prohibited: ${draft.prohibitedSchools.join(', ')})`
          : draft.arcaneSchool;
      magicCard.appendChild(makeLabeledLine('Arcane School', schoolInfo, true));
    }
    if (draft.familiarId) magicCard.appendChild(makeLabeledLine('Familiar', draft.familiarId.replace(/_/g, ' '), true));
    if (draft.animalCompanionId) {
      magicCard.appendChild(makeLabeledLine('Animal Companion', draft.animalCompanionId.replace(/_/g, ' '), true));
    }
    rightPane.appendChild(magicCard);
  }

  const investedSkills = (sheet.skillRows ?? []).filter((s) => s.ranks > 0);
  const skillCard = document.createElement('div');
  skillCard.className = 'char-summary-section-card';
  skillCard.appendChild(
    makeLabeledLine(
      `Invested Skills (${investedSkills.length})`,
      investedSkills
        .map((s) => `${s.name} ${s.totalModifier >= 0 ? `+${s.totalModifier}` : s.totalModifier} (${s.ranks}r)`)
        .join(', ') || 'None'
    )
  );
  rightPane.appendChild(skillCard);

  const equippedList = (inv.anatomicalSlots ?? [])
    .filter((s) => s.equippedItem !== null)
    .map((s) => `${s.equippedItem!.name} [${s.label}]`);
  const packList = inv.stashItems.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name));
  const gearCard = document.createElement('div');
  gearCard.className = 'char-summary-section-card';
  gearCard.append(
    makeLabeledLine(`Equipped (${equippedList.length})`, equippedList.join(', ') || 'None'),
    makeLabeledLine(`Backpack (${packList.length})`, packList.join(', ') || 'Empty', true),
    makeLabeledLine(
      'Encumbrance & Coin',
      `${inv.currentWeightLbs.toFixed(1)} lb (${enc.loadTier.toUpperCase()} load, max ${inv.maxWeightLbs} lb, ${sizeCategory}) · Purse: ${inv.currencyFormatted ?? `${inv.goldCurrency} gp`}`,
      true
    )
  );
  rightPane.appendChild(gearCard);
}

/**
 * Renders the final `Review & Identity` wizard step (`'summary'`).
 */
export function renderCharBuilderSummaryStep(
  container: HTMLElement,
  state: GameState,
  playerId: EntityId,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const stage = document.createElement('div');
  stage.className = 'dnd35-two-pane-stage';

  const leftPane = document.createElement('div');
  leftPane.className = 'dnd35-pane-left';
  leftPane.dataset['scrollId'] = 'char-summary-left';

  const rightPane = document.createElement('div');
  rightPane.className = 'dnd35-pane-right';
  rightPane.dataset['scrollId'] = 'char-summary-right';

  const heroCard = document.createElement('div');
  heroCard.className = 'char-summary-hero-card';
  const portraitBox = document.createElement('div');
  portraitBox.className = 'char-summary-portrait-box';
  const spriteUrl = draft.spriteId ? renderSpriteToDataUrl(draft.spriteId, HERO_PORTRAIT_PX) : undefined;
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.alt = (draft.characterName ?? '').trim() || 'Adventurer';
    img.width = HERO_PORTRAIT_PX;
    img.height = HERO_PORTRAIT_PX;
    img.style.imageRendering = 'pixelated';
    portraitBox.appendChild(img);
  } else {
    portraitBox.textContent = '@';
    portraitBox.style.color = draft.glyphColor ?? '#ffffff';
  }
  const heroMeta = document.createElement('div');
  const fullTitle = draft.characterTitle?.trim()
    ? `${draft.characterName || 'Adventurer'} ${draft.characterTitle.trim()}`
    : draft.characterName || 'Adventurer';
  const heroNameDiv = document.createElement('div');
  heroNameDiv.style.cssText = 'font-size:1.05rem;font-weight:700;color:var(--crpg-gold,#f1c40f);';
  heroNameDiv.textContent = fullTitle;
  const heroSubDiv = document.createElement('div');
  heroSubDiv.style.cssText = 'font-size:0.78rem;color:var(--crpg-text-dim,#9da7b3);';
  heroSubDiv.textContent = `${draft.raceId.toUpperCase()} · ${draft.classId.toUpperCase()} (Lv 1) · ${draft.alignment}`;
  const heroSpriteDiv = document.createElement('div');
  heroSpriteDiv.style.cssText = 'font-size:0.74rem;color:var(--crpg-text-dim,#9da7b3);';
  heroSpriteDiv.textContent = `Sprite: ${draft.spriteId ?? 'Default (@)'}`;
  heroMeta.append(heroNameDiv, heroSubDiv, heroSpriteDiv);
  heroCard.append(portraitBox, heroMeta);
  leftPane.appendChild(heroCard);

  const nameRow = document.createElement('div');
  nameRow.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px;';
  const nameInput = document.createElement('input');
  nameInput.id = 'char-builder-name-input';
  nameInput.type = 'text';
  nameInput.maxLength = MAX_CHARACTER_NAME_LENGTH;
  nameInput.placeholder = 'Character Name (required)';
  nameInput.value = draft.characterName ?? '';
  nameInput.className = 'char-builder-text-input';
  nameInput.style.flex = '1';
  nameInput.addEventListener('input', () => {
    updateDraft({ ...draft, characterName: nameInput.value });
  });
  const randBtn = document.createElement('button');
  randBtn.type = 'button';
  randBtn.className = 'modal-btn';
  randBtn.style.cssText = 'padding:5px 10px;font-size:0.76rem;';
  randBtn.textContent = '🎲 Randomize';
  randBtn.addEventListener('click', () => {
    updateDraft({ ...draft, characterName: pickNextFantasyName(draft.raceId, draft.characterName ?? '') });
  });
  nameRow.append(nameInput, randBtn);
  leftPane.appendChild(nameRow);

  const titleInput = document.createElement('input');
  titleInput.id = 'char-builder-title-input';
  titleInput.type = 'text';
  titleInput.maxLength = MAX_CHARACTER_TITLE_LENGTH;
  titleInput.placeholder = 'Optional Title / Epithet (e.g. the Bold, Shadowstep)';
  titleInput.value = draft.characterTitle ?? '';
  titleInput.className = 'char-builder-text-input';
  titleInput.style.cssText = 'width:100%;margin-bottom:4px;';
  titleInput.addEventListener('input', () => {
    const { characterTitle: _omitted, ...rest } = draft;
    updateDraft(titleInput.value ? { ...rest, characterTitle: titleInput.value } : rest);
  });
  leftPane.appendChild(titleInput);

  const titleChips = document.createElement('div');
  titleChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;';
  for (const preset of QUICK_TITLES) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'modal-btn';
    chip.style.cssText = 'padding:2px 6px;font-size:0.7rem;';
    chip.textContent = preset;
    chip.addEventListener('click', () => updateDraft({ ...draft, characterTitle: preset }));
    titleChips.appendChild(chip);
  }
  const clearTitleBtn = document.createElement('button');
  clearTitleBtn.type = 'button';
  clearTitleBtn.className = 'modal-btn';
  clearTitleBtn.style.cssText = 'padding:2px 6px;font-size:0.7rem;';
  clearTitleBtn.textContent = 'Clear';
  clearTitleBtn.addEventListener('click', () => {
    const { characterTitle: _omitted, ...rest } = draft;
    updateDraft(rest);
  });
  titleChips.appendChild(clearTitleBtn);
  leftPane.appendChild(titleChips);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:8px;';
  const colorLabel = document.createElement('span');
  colorLabel.style.fontSize = '0.76rem';
  colorLabel.textContent = 'ASCII @ Color:';
  colorRow.appendChild(colorLabel);
  for (const hex of GLYPH_COLOR_SWATCHES) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = `char-builder-color-swatch${(draft.glyphColor ?? '#ffffff') === hex ? ' selected' : ''}`;
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => updateDraft({ ...draft, glyphColor: hex }));
    colorRow.appendChild(sw);
  }
  const customColorInput = document.createElement('input');
  customColorInput.id = 'char-builder-color-picker';
  customColorInput.type = 'color';
  customColorInput.value = draft.glyphColor ?? '#ffffff';
  customColorInput.title = 'Custom ASCII @ color';
  customColorInput.style.cssText =
    'width:24px;height:22px;padding:0;border:1px solid #555;background:transparent;cursor:pointer;';
  customColorInput.addEventListener('input', () => updateDraft({ ...draft, glyphColor: customColorInput.value }));
  colorRow.appendChild(customColorInput);
  leftPane.appendChild(colorRow);

  const traitsRow = document.createElement('div');
  traitsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;align-items:center;';
  const traitsLabel = document.createElement('span');
  traitsLabel.style.fontSize = '0.76rem';
  traitsLabel.textContent = `Mannerisms (${(draft.mannerisms ?? []).length}/${MAX_CHARACTER_MANNERISMS}):`;
  traitsRow.appendChild(traitsLabel);
  const activeTraits = draft.mannerisms ?? [];
  const allChipTraits = Array.from(new Set([...QUICK_TRAITS, ...activeTraits]));
  for (const trait of allChipTraits) {
    const has = activeTraits.includes(trait);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'modal-btn';
    chip.style.cssText = 'padding:2px 6px;font-size:0.7rem;';
    if (has) chip.style.borderColor = 'var(--crpg-border-gold, #b88a36)';
    chip.textContent = has ? `✓ ${trait}` : trait;
    chip.addEventListener('click', () => {
      const next = has
        ? activeTraits.filter((t) => t !== trait)
        : [...activeTraits, trait].slice(0, MAX_CHARACTER_MANNERISMS);
      updateDraft({ ...draft, mannerisms: next });
    });
    traitsRow.appendChild(chip);
  }
  leftPane.appendChild(traitsRow);

  const customTraitRow = document.createElement('div');
  customTraitRow.style.cssText = 'display:flex;gap:4px;margin-bottom:8px;';
  const customTraitInput = document.createElement('input');
  customTraitInput.id = 'char-builder-custom-trait-input';
  customTraitInput.type = 'text';
  customTraitInput.maxLength = MAX_CUSTOM_TRAIT_LENGTH;
  customTraitInput.placeholder = 'Add custom mannerism...';
  customTraitInput.value = customTraitInputValue;
  customTraitInput.className = 'char-builder-text-input';
  customTraitInput.style.flex = '1';
  customTraitInput.addEventListener('input', () => {
    customTraitInputValue = customTraitInput.value;
  });
  const addTraitBtn = document.createElement('button');
  addTraitBtn.type = 'button';
  addTraitBtn.className = 'modal-btn';
  addTraitBtn.style.cssText = 'padding:3px 8px;font-size:0.72rem;';
  addTraitBtn.textContent = '+ Trait';
  addTraitBtn.disabled = activeTraits.length >= MAX_CHARACTER_MANNERISMS;
  addTraitBtn.addEventListener('click', () => {
    const trimmed = customTraitInputValue.trim();
    if (!trimmed || activeTraits.includes(trimmed) || activeTraits.length >= MAX_CHARACTER_MANNERISMS) return;
    customTraitInputValue = '';
    updateDraft({ ...draft, mannerisms: [...activeTraits, trimmed] });
  });
  customTraitRow.append(customTraitInput, addTraitBtn);
  leftPane.appendChild(customTraitRow);

  renderSpritePickerSection(leftPane, state, draft, updateDraft);
  renderAuthoritativeSheetSummary(rightPane, state, playerId, draft);

  stage.append(leftPane, rightPane);
  container.appendChild(stage);
}
