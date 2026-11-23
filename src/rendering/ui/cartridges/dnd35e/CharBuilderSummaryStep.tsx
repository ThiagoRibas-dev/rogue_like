/**
 * @file Final Wizard Step (`Review & Identity`) for D&D 3.5e Character Creation (Milestone 164).
 */

import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import {
  applyCharacterCreationToPlayer,
  type CharacterCreationDraft,
  MAX_CHARACTER_MANNERISMS,
  MAX_CHARACTER_NAME_LENGTH,
  MAX_CHARACTER_TITLE_LENGTH,
  resolveClassSpellAcquisitionMode
} from '../../../../rulesets/dnd35e/character_builder.ts';
import { computeEncumbranceState } from '../../../../rulesets/dnd35e/combat/tactical_doctrine.ts';
import { getDnD35EntityData } from '../../../../rulesets/dnd35e/srd_registry.ts';
import { getDnD35SystemContent } from '../../../../rulesets/dnd35e/types/dnd35e_system.types.ts';
import { DnD35UIAdapter } from '../../../../rulesets/dnd35e/ui/dnd35e_ui_adapter.ts';
import { projectCharacterSheetData } from '../../../../rulesets/dnd35e/ui/dnd35e_ui_char_sheet.ts';
import type { EntityId, GameState } from '../../../../types/game-state.types.ts';
import { renderSpriteToDataUrl } from '../../../sprite_atlas.ts';
import { Button } from '../../primitives/Button.tsx';
import { Chip } from '../../primitives/DataDisplay.tsx';
import { TextInput } from '../../primitives/FormControls.tsx';
import { CharBuilderSpritePicker } from './CharBuilderSpritePicker.tsx';

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

function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
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

/** Props for `<CharBuilderSummaryStep />`. */
export interface CharBuilderSummaryStepProps {
  readonly state: GameState;
  readonly playerId: EntityId;
  readonly draft: CharacterCreationDraft;
  readonly onUpdateDraft: (next: CharacterCreationDraft) => void;
}

/**
 * Final Review & Identity step: hero portrait, name/title/traits/color, sprite picker,
 * and memoized authoritative Character Sheet summary.
 */
export function CharBuilderSummaryStep({
  state,
  playerId,
  draft,
  onUpdateDraft
}: CharBuilderSummaryStepProps): JSX.Element {
  const [customTrait, setCustomTrait] = useState<string>('');
  const nameCursorRef = useRef<number>(0);

  const mechanicalFingerprint = buildMechanicalDraftFingerprint(draft);
  const preview = useMemo(() => {
    const previewState = applyCharacterCreationToPlayer(state, playerId, draft);
    const sheet = projectCharacterSheetData({ state: previewState, entityId: playerId });
    const inv = new DnD35UIAdapter().getInventoryData({ state: previewState, entityId: playerId });
    return { previewState, sheet, inv };
  }, [state, playerId, mechanicalFingerprint]);

  const { previewState, sheet, inv } = preview;
  const previewDnd = getDnD35EntityData(previewState, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const cls = sys?.classes[draft.classId];
  const strScore = sheet.attributes.find((a) => a.id === 'str')?.score ?? 10;
  const sizeCategory = previewDnd.sizeCategory ?? 'medium';
  const enc = computeEncumbranceState(strScore, sizeCategory, inv.currentWeightLbs);

  const baseName = (draft.characterName ?? '').trim() || 'Adventurer';
  const displayName = draft.characterTitle?.trim() ? `${baseName} ${draft.characterTitle.trim()}` : baseName;
  const spriteUrl = draft.spriteId ? renderSpriteToDataUrl(draft.spriteId, HERO_PORTRAIT_PX) : undefined;
  const activeTraits = draft.mannerisms ?? [];
  const allChipTraits = Array.from(new Set([...QUICK_TRAITS, ...activeTraits]));

  const savesText = sheet.savingThrows.map((s) => `${s.name} ${formatSigned(s.total)}`).join(' · ');
  const attacks = sheet.attackGroups ?? [];
  const feats = (sheet.featureEntries ?? []).filter((f) => f.category === 'feat').map((f) => f.name);
  const classFeatures = (sheet.featureEntries ?? []).filter((f) => f.category !== 'feat').map((f) => f.name);
  const spellMode = cls ? resolveClassSpellAcquisitionMode(cls) : 'none';
  const hasArcaneOrDivine =
    spellMode !== 'none' ||
    draft.domains.length > 0 ||
    draft.arcaneSchool !== undefined ||
    draft.familiarId !== undefined ||
    draft.animalCompanionId !== undefined;
  const investedSkills = (sheet.skillRows ?? []).filter((s) => s.ranks > 0);
  const equippedList = (inv.anatomicalSlots ?? [])
    .filter((s) => s.equippedItem !== null)
    .map((s) => `${s.equippedItem!.name} [${s.label}]`);
  const packList = inv.stashItems.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name));

  return (
    <div className="ui-dnd-wizard-stage">
      <div className="ui-dnd-wizard-pane">
        <div className="ui-dnd-card">
          <div className="ui-dnd-id-row">
            <div className="ui-dnd-portrait" style={{ color: draft.glyphColor ?? '#ffffff' }}>
              {spriteUrl ? (
                <img
                  src={spriteUrl}
                  alt={baseName}
                  width={HERO_PORTRAIT_PX}
                  height={HERO_PORTRAIT_PX}
                  className="ui-dnd-pixel-img"
                />
              ) : (
                '@'
              )}
            </div>
            <div className="ui-dnd-id-meta">
              <h3 className="ui-dnd-id-name">{displayName}</h3>
              <div className="ui-dnd-id-sub">
                {`${draft.raceId.toUpperCase()} · ${draft.classId.toUpperCase()} (Lv 1) · ${draft.alignment}`}
              </div>
              <div className="ui-dnd-id-traits">{`Sprite: ${draft.spriteId ?? 'Default (@)'}`}</div>
            </div>
          </div>
        </div>

        <div className="ui-dnd-card__row">
          <div style={{ flex: 1 }}>
            <TextInput
              ariaLabel="Character name"
              placeholder="Character Name (required)"
              value={draft.characterName ?? ''}
              onInput={(val) => onUpdateDraft({ ...draft, characterName: val.slice(0, MAX_CHARACTER_NAME_LENGTH) })}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const pool = FANTASY_NAMES_BY_RACE[draft.raceId] ?? FANTASY_NAMES_BY_RACE['human']!;
              nameCursorRef.current = (nameCursorRef.current + 1) % pool.length;
              const cand = pool[nameCursorRef.current]!;
              const picked = cand === draft.characterName ? pool[(nameCursorRef.current + 1) % pool.length]! : cand;
              onUpdateDraft({ ...draft, characterName: picked });
            }}
          >
            🎲 Randomize
          </Button>
        </div>

        <TextInput
          ariaLabel="Character title or epithet"
          placeholder="Optional Title / Epithet (e.g. the Bold, Shadowstep)"
          value={draft.characterTitle ?? ''}
          onInput={(val) => {
            const trimmedVal = val.slice(0, MAX_CHARACTER_TITLE_LENGTH);
            const { characterTitle: _omitted, ...rest } = draft;
            onUpdateDraft(trimmedVal ? { ...rest, characterTitle: trimmedVal } : rest);
          }}
        />

        <div className="ui-dnd-chip-row">
          {QUICK_TITLES.map((preset) => (
            <Chip
              key={preset}
              active={draft.characterTitle === preset}
              onClick={() => onUpdateDraft({ ...draft, characterTitle: preset })}
            >
              {preset}
            </Chip>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const { characterTitle: _omitted, ...rest } = draft;
              onUpdateDraft(rest);
            }}
          >
            Clear
          </Button>
        </div>

        <div className="ui-dnd-chip-row">
          <span className="ui-dnd-card__sub">ASCII @ Color:</span>
          {GLYPH_COLOR_SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              title={hex}
              aria-label={`Select glyph color ${hex}`}
              className={
                (draft.glyphColor ?? '#ffffff') === hex
                  ? 'ui-dnd-color-swatch ui-dnd-color-swatch--selected'
                  : 'ui-dnd-color-swatch'
              }
              style={{ backgroundColor: hex }}
              onClick={() => onUpdateDraft({ ...draft, glyphColor: hex })}
            />
          ))}
          <input
            type="color"
            aria-label="Custom ASCII color"
            className="ui-dnd-color-picker"
            value={draft.glyphColor ?? '#ffffff'}
            onInput={(e) => onUpdateDraft({ ...draft, glyphColor: (e.target as HTMLInputElement).value })}
          />
        </div>

        <div className="ui-dnd-subbanner">{`Mannerisms (${activeTraits.length}/${MAX_CHARACTER_MANNERISMS})`}</div>
        <div className="ui-dnd-chip-row">
          {allChipTraits.map((trait) => {
            const has = activeTraits.includes(trait);
            return (
              <Chip
                key={trait}
                active={has}
                onClick={() => {
                  const next = has
                    ? activeTraits.filter((t) => t !== trait)
                    : [...activeTraits, trait].slice(0, MAX_CHARACTER_MANNERISMS);
                  onUpdateDraft({ ...draft, mannerisms: next });
                }}
              >
                {has ? `✓ ${trait}` : trait}
              </Chip>
            );
          })}
        </div>

        <div className="ui-dnd-card__row">
          <div style={{ flex: 1 }}>
            <TextInput
              ariaLabel="Custom mannerism"
              placeholder="Add custom mannerism..."
              value={customTrait}
              onInput={(val) => setCustomTrait(val.slice(0, MAX_CUSTOM_TRAIT_LENGTH))}
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            disabled={activeTraits.length >= MAX_CHARACTER_MANNERISMS}
            onClick={() => {
              const trimmed = customTrait.trim();
              if (!trimmed || activeTraits.includes(trimmed) || activeTraits.length >= MAX_CHARACTER_MANNERISMS) return;
              setCustomTrait('');
              onUpdateDraft({ ...draft, mannerisms: [...activeTraits, trimmed] });
            }}
          >
            + Trait
          </Button>
        </div>

        <CharBuilderSpritePicker state={state} draft={draft} onUpdateDraft={onUpdateDraft} />
      </div>

      <div className="ui-dnd-wizard-pane">
        <h3 className="ui-dnd-inspector__title">{`${displayName} — ${sheet.raceName} ${sheet.levelSummary}`}</h3>

        <div className="ui-dnd-stat-grid">
          <div className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">HP</span>
            <span className="ui-dnd-stat-box__val">{`${sheet.hpCurrent}/${sheet.hpMax}`}</span>
          </div>
          <div className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">AC (Touch / Flat)</span>
            <span className="ui-dnd-stat-box__val">{`${sheet.acTotal} (${sheet.touchAc ?? 10} / ${sheet.flatFootedAc ?? 10})`}</span>
          </div>
          <div className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">BAB / Grapple</span>
            <span className="ui-dnd-stat-box__val">
              {`${formatSigned(sheet.babTotal)} / ${formatSigned(sheet.grappleBonus ?? sheet.babTotal)}`}
            </span>
          </div>
          <div className="ui-dnd-stat-box">
            <span className="ui-dnd-stat-box__label">Init / Speed</span>
            <span className="ui-dnd-stat-box__val">{`${formatSigned(sheet.initiativeBonus ?? 0)} / ${sheet.speedFt ?? 30} ft`}</span>
          </div>
        </div>

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            <strong>Saving Throws:</strong> {savesText}
          </div>
        </div>

        <div className="ui-dnd-stat-grid">
          {sheet.attributes.map((a) => (
            <div key={a.id} className="ui-dnd-attr-cell">
              <span className="ui-dnd-attr-cell__name">{a.id.toUpperCase()}</span>
              <span className="ui-dnd-attr-cell__mod">{`${a.score} (${formatSigned(a.modifier)})`}</span>
            </div>
          ))}
        </div>

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            <strong>Attack Routine:</strong>{' '}
            {attacks
              .map((g) => `${g.label} (${g.attackBonuses} · ${g.damageFormula} · ${g.criticalProfile})`)
              .join(' | ') || 'Unarmed Strike'}
          </div>
        </div>

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            <strong>{`Feats (${feats.length}):`}</strong> {feats.join(', ') || 'None'}
          </div>
          <div className="ui-dnd-card__sub">
            <strong>{`Traits & Class Features (${classFeatures.length}):`}</strong> {classFeatures.join(', ') || 'None'}
          </div>
        </div>

        {hasArcaneOrDivine ? (
          <div className="ui-dnd-card">
            {spellMode === 'prayerbook_full_list' ? (
              <div className="ui-dnd-card__sub">
                <strong>Spellcasting:</strong> {`Divine Prayerbook (Full ${cls?.name ?? draft.classId} spell list)`}
              </div>
            ) : spellMode !== 'none' ? (
              <div className="ui-dnd-card__sub">
                <strong>{`Known Spells (${draft.knownSpells.length}):`}</strong>{' '}
                {draft.knownSpells.map((id) => sys?.spells[id]?.name ?? id).join(', ') || 'None'}
              </div>
            ) : null}
            {draft.domains.length > 0 ? (
              <div className="ui-dnd-card__sub">
                <strong>Domains:</strong> {draft.domains.map((id) => sys?.domains[id]?.name ?? id).join(', ')}
              </div>
            ) : null}
            {draft.arcaneSchool ? (
              <div className="ui-dnd-card__sub">
                <strong>Arcane School:</strong>{' '}
                {draft.prohibitedSchools.length > 0
                  ? `${draft.arcaneSchool} (Prohibited: ${draft.prohibitedSchools.join(', ')})`
                  : draft.arcaneSchool}
              </div>
            ) : null}
            {draft.familiarId ? (
              <div className="ui-dnd-card__sub">
                <strong>Familiar:</strong> {draft.familiarId.replace(/_/g, ' ')}
              </div>
            ) : null}
            {draft.animalCompanionId ? (
              <div className="ui-dnd-card__sub">
                <strong>Animal Companion:</strong> {draft.animalCompanionId.replace(/_/g, ' ')}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            <strong>{`Invested Skills (${investedSkills.length}):`}</strong>{' '}
            {investedSkills.map((s) => `${s.name} ${formatSigned(s.totalModifier)} (${s.ranks}r)`).join(', ') || 'None'}
          </div>
        </div>

        <div className="ui-dnd-card">
          <div className="ui-dnd-card__sub">
            <strong>{`Equipped (${equippedList.length}):`}</strong> {equippedList.join(', ') || 'None'}
          </div>
          <div className="ui-dnd-card__sub">
            <strong>{`Backpack (${packList.length}):`}</strong> {packList.join(', ') || 'Empty'}
          </div>
          <div className="ui-dnd-card__sub">
            <strong>Encumbrance &amp; Coin:</strong>{' '}
            {`${inv.currentWeightLbs.toFixed(1)} lb (${enc.loadTier.toUpperCase()} load, max ${inv.maxWeightLbs} lb, ${sizeCategory}) · Purse: ${inv.currencyFormatted ?? `${inv.goldCurrency} gp`}`}
          </div>
        </div>
      </div>
    </div>
  );
}
