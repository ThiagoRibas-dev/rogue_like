/**
 * @file Sprite Picker sub-component & D&D 3.5e race/class sprite hint expansion
 * for the Character Creation Wizard Review & Identity step.
 */

import type { CharacterCreationDraft } from '../../rulesets/dnd35e/character_builder.ts';
import type { GameState } from '../../types/game-state.types.ts';
import {
  collectCatalogSpriteEntries,
  type SpriteCatalogEntry,
  suggestCharacterSprites
} from '../../utils/sprite_pack.ts';
import { renderSpriteToDataUrl } from '../sprite_atlas.ts';

const SPRITE_PAGE_BATCH = 96;
const SUGGESTED_SPRITE_LIMIT = 36;
const SPRITE_TILE_PX = 36;

/** D&D 3.5e race & class synonym keywords passed into Tier 1 `suggestCharacterSprites`. */
const DND35_SPRITE_SYNONYMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  human: ['human', 'knight', 'fighter', 'swordsman', 'fencer', 'rogue', 'templar', 'scholar'],
  elf: ['elf', 'deep_elf', 'ranger', 'archer', 'fencer', 'wizard', 'druid'],
  dwarf: ['dwarf', 'deep_dwarf', 'blacksmith', 'knight', 'fighter', 'dwarf_mage'],
  halfling: ['halfling', 'spriggan', 'rogue', 'bandit', 'ranger'],
  gnome: ['gnome', 'deep_dwarf', 'scholar', 'wizard', 'dwarf_mage'],
  half_elf: ['elf', 'human', 'ranger', 'bard', 'druid', 'swordsman'],
  half_orc: ['orc', 'lorc', 'barbarian', 'fighter'],
  orc: ['orc', 'lorc', 'barbarian'],
  kobold: ['kobold', 'draconian'],
  goblin: ['goblin', 'kobold', 'bandit'],
  drow: ['deep_elf', 'elf', 'warlock', 'rogue'],
  duergar: ['deep_dwarf', 'dwarf'],
  barbarian: ['barbarian', 'winter_barbarian', 'berserker', 'orc', 'lorc'],
  bard: ['fencer', 'swordsman', 'scholar', 'rogue', 'elf'],
  cleric: ['priest', 'war_cleric', 'templar', 'shield_knight', 'knight'],
  druid: ['druid', 'desert_sage', 'ranger', 'elf'],
  fighter: ['fighter', 'knight', 'shield_knight', 'swordsman', 'fencer'],
  monk: ['monk', 'schema_monk', 'elder_schema_monk'],
  paladin: ['templar', 'knight', 'shield_knight', 'war_cleric'],
  ranger: ['ranger', 'elf', 'swordsman'],
  rogue: ['rogue', 'bandit', 'fencer'],
  sorcerer: ['warlock', 'wizard', 'desert_sage', 'draconian', 'demonspawn'],
  wizard: ['wizard', 'dwarf_mage', 'scholar', 'desert_sage', 'deep_elf']
};

let activeSpriteTab = 'suggested';
let spriteSearchQuery = '';
let spriteVisibleLimit = SPRITE_PAGE_BATCH;

/** Resets sprite picker filter & pagination state for a fresh Character Creation session. */
export function resetSpritePickerUiState(): void {
  activeSpriteTab = 'suggested';
  spriteSearchQuery = '';
  spriteVisibleLimit = SPRITE_PAGE_BATCH;
}

/**
 * Expands D&D 3.5e race and class IDs into primary tokens + secondary synonym keywords
 * for Tier 1 `suggestCharacterSprites`.
 */
export function expandDnD35SpriteHints(
  raceId: string,
  classId: string
): { readonly primary: ReadonlyArray<string>; readonly secondary: ReadonlyArray<string> } {
  const primary = [raceId, classId].filter((t) => t.trim().length > 0);
  const secondary: string[] = [];
  for (const token of primary) {
    const key = token.toLowerCase().trim();
    for (const syn of DND35_SPRITE_SYNONYMS[key] ?? []) {
      if (!secondary.includes(syn)) secondary.push(syn);
    }
  }
  return { primary, secondary };
}

/**
 * Renders the multi-tab searchable Sprite Picker section inside the Review & Identity left pane.
 */
export function renderSpritePickerSection(
  leftPane: HTMLElement,
  state: GameState,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const allEntries = collectCatalogSpriteEntries(state.campaign.theme);
  const hints = expandDnD35SpriteHints(draft.raceId, draft.classId);
  const suggested = suggestCharacterSprites(allEntries, hints.primary, hints.secondary).slice(
    0,
    SUGGESTED_SPRITE_LIMIT
  );

  const loadedPacks = state.campaign.theme.loadedSpritePacks ?? {};
  const dynamicPackTabs: ReadonlyArray<{ readonly id: string; readonly label: string }> = Object.entries(loadedPacks)
    .filter(([packId]) => allEntries.some((e) => e.packId === packId && e.isCharacterSprite))
    .map(([packId, pack]) => ({
      id: `pack:${packId}`,
      label: pack.name ? `${pack.name.split(' ')[0]} Heroes` : `${packId} Heroes`
    }));

  const tabs: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
    { id: 'suggested', label: `★ Suggested (${suggested.length})` },
    { id: 'characters', label: 'Characters' },
    ...dynamicPackTabs,
    { id: 'all', label: `All (${allEntries.length})` }
  ];
  if (!tabs.some((t) => t.id === activeSpriteTab)) {
    activeSpriteTab = 'suggested';
  }

  const tabsRow = document.createElement('div');
  tabsRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:8px 0 6px 0;';
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn';
    btn.style.cssText = 'padding:3px 7px;font-size:0.72rem;';
    if (activeSpriteTab === tab.id) btn.style.borderColor = 'var(--crpg-border-gold, #b88a36)';
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      activeSpriteTab = tab.id;
      spriteVisibleLimit = SPRITE_PAGE_BATCH;
      updateDraft({ ...draft });
    });
    tabsRow.appendChild(btn);
  }

  const searchInput = document.createElement('input');
  searchInput.id = 'char-builder-sprite-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search sprites by name or tag (e.g. dwarf, wizard, knight, dragon)...';
  searchInput.value = spriteSearchQuery;
  searchInput.className = 'char-builder-text-input';
  searchInput.style.cssText = 'width:100%;margin-bottom:6px;';
  searchInput.addEventListener('input', () => {
    spriteSearchQuery = searchInput.value;
    spriteVisibleLimit = SPRITE_PAGE_BATCH;
    updateDraft({ ...draft });
  });
  leftPane.append(tabsRow, searchInput);

  const query = spriteSearchQuery.trim().toLowerCase();
  const basePool: ReadonlyArray<SpriteCatalogEntry> =
    activeSpriteTab === 'suggested'
      ? suggested
      : allEntries.filter((e) => {
          if (activeSpriteTab === 'characters') return e.isCharacterSprite;
          if (activeSpriteTab.startsWith('pack:')) {
            const targetPackId = activeSpriteTab.slice('pack:'.length);
            return e.packId === targetPackId && e.isCharacterSprite;
          }
          return true;
        });

  const filtered = query
    ? basePool.filter((e) => e.spriteId.toLowerCase().includes(query) || e.label.toLowerCase().includes(query))
    : basePool;
  const grid = document.createElement('div');
  grid.className = 'char-builder-sprite-grid';
  const visibleSlice = filtered.slice(0, spriteVisibleLimit);

  for (const entry of visibleSlice) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = `char-builder-sprite-tile${draft.spriteId === entry.spriteId ? ' selected' : ''}`;
    tile.title = `${entry.spriteId} (${entry.packId}/${entry.sheetId})`;
    const dataUrl = renderSpriteToDataUrl(entry.spriteId, SPRITE_TILE_PX);
    if (dataUrl) {
      const img = document.createElement('img');
      img.src = dataUrl;
      img.alt = entry.spriteId;
      img.width = SPRITE_TILE_PX;
      img.height = SPRITE_TILE_PX;
      img.style.imageRendering = 'pixelated';
      tile.appendChild(img);
    } else {
      tile.textContent = entry.label.slice(0, 6);
    }
    tile.addEventListener('click', () => {
      updateDraft({ ...draft, spriteId: entry.spriteId, spriteManuallySelected: true });
    });
    grid.appendChild(tile);
  }
  leftPane.appendChild(grid);

  if (filtered.length > visibleSlice.length) {
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'modal-btn';
    moreBtn.style.cssText = 'width:100%;margin-top:6px;padding:4px 8px;font-size:0.74rem;';
    moreBtn.textContent = `Show More Sprites (${visibleSlice.length} / ${filtered.length})`;
    moreBtn.addEventListener('click', () => {
      spriteVisibleLimit += SPRITE_PAGE_BATCH;
      updateDraft({ ...draft });
    });
    leftPane.appendChild(moreBtn);
  }
}
