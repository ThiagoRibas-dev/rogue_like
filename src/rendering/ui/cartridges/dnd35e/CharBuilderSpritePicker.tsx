/**
 * @file Multi-tab searchable Sprite Picker with 2D `<GridNav />` keyboard navigation (Milestone 164).
 */

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { CharacterCreationDraft } from '../../../../rulesets/dnd35e/character_builder.ts';
import type { GameState } from '../../../../types/game-state.types.ts';
import {
  collectCatalogSpriteEntries,
  type SpriteCatalogEntry,
  suggestCharacterSprites
} from '../../../../utils/sprite_pack.ts';
import { renderSpriteToDataUrl } from '../../../sprite_atlas.ts';
import { Button } from '../../primitives/Button.tsx';
import { Chip } from '../../primitives/DataDisplay.tsx';
import { TextInput } from '../../primitives/FormControls.tsx';
import { GridNav } from '../../primitives/GridNav.tsx';

const SPRITE_PAGE_BATCH = 96;
const SUGGESTED_SPRITE_LIMIT = 36;
const SPRITE_TILE_PX = 36;
const SPRITE_GRID_COLUMNS = 6;

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

/**
 * Expands D&D 3.5e race and class IDs into primary tokens and secondary synonym keywords
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

/** Props for `<CharBuilderSpritePicker />`. */
export interface CharBuilderSpritePickerProps {
  readonly state: GameState;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Multi-tab searchable Sprite Picker rendered inside the Review & Identity step.
 */
export function CharBuilderSpritePicker({ state, draft, onUpdateDraft }: CharBuilderSpritePickerProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<string>('suggested');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [visibleLimit, setVisibleLimit] = useState<number>(SPRITE_PAGE_BATCH);

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
  const resolvedTab = tabs.some((t) => t.id === activeTab) ? activeTab : 'suggested';

  const query = searchQuery.trim().toLowerCase();
  const basePool: ReadonlyArray<SpriteCatalogEntry> =
    resolvedTab === 'suggested'
      ? suggested
      : allEntries.filter((e) => {
          if (resolvedTab === 'characters') return e.isCharacterSprite;
          if (resolvedTab.startsWith('pack:')) {
            const targetPackId = resolvedTab.slice('pack:'.length);
            return e.packId === targetPackId && e.isCharacterSprite;
          }
          return true;
        });

  const filtered = query
    ? basePool.filter((e) => e.spriteId.toLowerCase().includes(query) || e.label.toLowerCase().includes(query))
    : basePool;
  const visibleSlice = filtered.slice(0, visibleLimit);

  return (
    <div className="ui-dnd-card-list">
      <div className="ui-dnd-subbanner">Hero Sprite</div>

      <div className="ui-dnd-chip-row">
        {tabs.map((tab) => (
          <Chip
            key={tab.id}
            active={resolvedTab === tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setVisibleLimit(SPRITE_PAGE_BATCH);
            }}
          >
            {tab.label}
          </Chip>
        ))}
      </div>

      <TextInput
        type="search"
        ariaLabel="Search character sprites"
        placeholder="Search sprites by name or tag (e.g. dwarf, wizard, knight, dragon)..."
        value={searchQuery}
        onInput={(val) => {
          setSearchQuery(val);
          setVisibleLimit(SPRITE_PAGE_BATCH);
        }}
      />

      <GridNav
        items={visibleSlice}
        columns={SPRITE_GRID_COLUMNS}
        ariaLabel="Character sprite gallery"
        getKey={(entry) => entry.spriteId}
        onActivate={(entry) => onUpdateDraft({ ...draft, spriteId: entry.spriteId, spriteManuallySelected: true })}
        renderItem={(entry) => {
          const dataUrl = renderSpriteToDataUrl(entry.spriteId, SPRITE_TILE_PX);
          const isSelected = draft.spriteId === entry.spriteId;
          return (
            <div
              className={isSelected ? 'ui-dnd-sprite-tile ui-dnd-sprite-tile--selected' : 'ui-dnd-sprite-tile'}
              title={`${entry.spriteId} (${entry.packId}/${entry.sheetId})`}
            >
              {dataUrl ? (
                <img
                  src={dataUrl}
                  alt={entry.spriteId}
                  width={SPRITE_TILE_PX}
                  height={SPRITE_TILE_PX}
                  className="ui-dnd-pixel-img"
                />
              ) : (
                <span>{entry.label.slice(0, 6)}</span>
              )}
            </div>
          );
        }}
      />

      {filtered.length > visibleSlice.length ? (
        <Button size="sm" variant="secondary" onClick={() => setVisibleLimit((prev) => prev + SPRITE_PAGE_BATCH)}>
          {`Show More Sprites (${visibleSlice.length} / ${filtered.length})`}
        </Button>
      ) : null}
    </div>
  );
}
