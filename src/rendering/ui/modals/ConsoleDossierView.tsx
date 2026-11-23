import type { JSX } from 'preact';
import { useCallback, useState } from 'preact/hooks';
import type { UICharacterSheetModel, UIInventoryItem, UIInventoryModel } from '../../../types/ui_adapter.types.ts';
import { renderSpriteToDataUrl } from '../../sprite_atlas.ts';
import { Button } from '../primitives/Button.tsx';
import { Badge, Chip } from '../primitives/DataDisplay.tsx';
import { CompactStashWidget } from './CompactStashWidget.tsx';
import { type ItemInspectAnchor, ItemInspectPopover } from './ItemInspectPopover.tsx';
import { PaperDollWidget } from './PaperDollWidget.tsx';

const PERCENT_SCALE = 100;
const PORTRAIT_PX = 64;

/** Optional cartridge-contributed action button rendered in the Master Dossier header. */
export interface ConsoleDossierExtraAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly onClick: () => void;
}

/** Props for `<ConsoleDossierView />`. */
export interface ConsoleDossierViewProps {
  readonly sheet: UICharacterSheetModel;
  readonly inv: UIInventoryModel;
  readonly onEquipItem?: ((itemId: string, slotId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onUnequipItem?: ((slotId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onUseItem?: ((itemId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onDropItem?: ((itemId: string, item?: UIInventoryItem) => void) | undefined;
  readonly onSelectWeaponSet?: ((setIndex: number) => void) | undefined;
  readonly onUseSkill?: ((skillId: string) => void) | undefined;
  readonly onClose?: (() => void) | undefined;
  readonly extraActions?: ReadonlyArray<ConsoleDossierExtraAction> | undefined;
}

/**
 * Reusable Tier 1 Console 3-Column Master Dossier component consolidating Character Sheet,
 * Anatomical Paper Doll, Attack Ledger, Progression History, Skills, and 2D Keyboard Stash
 * with zero `.innerHTML` and 100% `--ui-*` semantic tokens.
 */
export function ConsoleDossierView({
  sheet,
  inv,
  onEquipItem,
  onUnequipItem,
  onUseItem,
  onDropItem,
  onSelectWeaponSet,
  onUseSkill,
  onClose,
  extraActions
}: ConsoleDossierViewProps): JSX.Element {
  const [trainedOnly, setTrainedOnly] = useState<boolean>(false);
  const [inspectAnchor, setInspectAnchor] = useState<ItemInspectAnchor | null>(null);

  const handleInspectItem = useCallback((item: UIInventoryItem | null, clientX: number, clientY: number): void => {
    if (!item?.inspectData) {
      setInspectAnchor(null);
      return;
    }
    setInspectAnchor({ data: item.inspectData, clientX, clientY });
  }, []);

  const portraitUrl =
    sheet.portraitUrl ??
    (sheet.spriteId !== undefined ? renderSpriteToDataUrl(sheet.spriteId, PORTRAIT_PX) : undefined);

  const fortSave = sheet.savingThrows.find((s) => s.id === 'fortitude')?.total ?? 0;
  const refSave = sheet.savingThrows.find((s) => s.id === 'reflex')?.total ?? 0;
  const willSave = sheet.savingThrows.find((s) => s.id === 'will')?.total ?? 0;
  const formatSigned = (val: number): string => (val >= 0 ? `+${val}` : `${val}`);

  const defStats: ReadonlyArray<{ readonly label: string; readonly value: string }> = [
    { label: 'AC', value: `${sheet.acTotal}` },
    { label: 'Touch', value: `${sheet.touchAc ?? sheet.acTotal}` },
    { label: 'Flat-Footed', value: `${sheet.flatFootedAc ?? sheet.acTotal}` },
    { label: 'Fortitude', value: formatSigned(fortSave) },
    { label: 'Reflex', value: formatSigned(refSave) },
    { label: 'Will', value: formatSigned(willSave) }
  ];

  const xpPct =
    sheet.xpCurrent !== undefined && sheet.xpNextLevel && sheet.xpNextLevel > 0
      ? Math.min(PERCENT_SCALE, Math.round((sheet.xpCurrent / sheet.xpNextLevel) * PERCENT_SCALE))
      : null;

  const skillRows = (sheet.skillRows ?? []).filter((row) => (trainedOnly ? row.ranks > 0 : true));

  return (
    <div className="ui-dossier-shell">
      <div className="ui-dossier-topbar">
        <div className="ui-dossier-identity">
          <h2 className="ui-dossier-name">{sheet.name}</h2>
          <div className="ui-dossier-sub">
            {`${sheet.raceName} • ${sheet.levelSummary}${sheet.alignmentName ? ` • ${sheet.alignmentName}` : ''}`}
          </div>
        </div>

        {xpPct !== null && sheet.xpCurrent !== undefined && sheet.xpNextLevel !== undefined ? (
          <div className="ui-dossier-xp">
            <span style={{ fontSize: 'var(--ui-font-xs)', fontFamily: 'var(--ui-font-mono)' }}>
              {`${sheet.xpCurrent.toLocaleString()} / ${sheet.xpNextLevel.toLocaleString()} XP`}
            </span>
            <div className="ui-meter-track">
              <div className="ui-meter-fill ui-meter-fill--xp" style={{ width: `${xpPct}%` }} />
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--ui-space-2)' }}>
          {(extraActions ?? []).map((act) => (
            <Button key={act.id} variant="secondary" size="sm" onClick={act.onClick}>
              {act.label}
            </Button>
          ))}
          {onClose ? (
            <Button variant="ghost" size="sm" onClick={onClose}>
              ✕ Close
            </Button>
          ) : null}
        </div>
      </div>

      <div className="ui-dossier-grid">
        {/* Column 1: Identity, Attributes, Paper Doll, Defenses */}
        <div className="ui-dossier-col">
          <div className="ui-dossier-section">
            <div className="ui-portrait-row">
              <div
                className="ui-portrait-frame"
                style={
                  portraitUrl !== undefined
                    ? { backgroundImage: `url(${portraitUrl})` }
                    : sheet.glyphColor !== undefined
                      ? { color: sheet.glyphColor }
                      : undefined
                }
              >
                {portraitUrl === undefined ? (sheet.glyph ?? '👤') : null}
              </div>
              <Badge tone="danger">{`♥ ${sheet.hpCurrent} / ${sheet.hpMax} HP`}</Badge>
            </div>

            <div className="ui-attr-grid">
              {sheet.attributes.map((attr) => (
                <div key={attr.id} className="ui-attr-chip">
                  <span className="ui-attr-id">{attr.id.toUpperCase()}</span>
                  <span className="ui-attr-val">{attr.score}</span>
                  <span className="ui-attr-mod">{formatSigned(attr.modifier)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="ui-dossier-section">
            <div className="ui-dossier-section-head">
              <h3 className="ui-dossier-section-title">Equipment & Anatomy</h3>
            </div>
            <PaperDollWidget
              data={inv}
              onUnequipItem={onUnequipItem}
              onSelectWeaponSet={onSelectWeaponSet}
              onInspectItem={handleInspectItem}
            />
          </div>

          <div className="ui-dossier-section">
            <div className="ui-defenses-grid">
              {defStats.map((stat) => (
                <div key={stat.label} className="ui-defense-cell">
                  <span className="ui-defense-label">{stat.label}</span>
                  <span className="ui-defense-val">{stat.value}</span>
                </div>
              ))}
            </div>
            <div className="ui-vitals-strip">
              {`Speed: ${sheet.speedFt ?? 30}ft • BAB: ${formatSigned(sheet.babTotal)} • Grapple: ${formatSigned(sheet.grappleBonus ?? sheet.babTotal)} • Init: ${formatSigned(sheet.initiativeBonus ?? 0)}`}
            </div>
          </div>
        </div>

        {/* Column 2: Attack Routines, Features & Progression History */}
        <div className="ui-dossier-col">
          <div className="ui-dossier-section">
            <div className="ui-dossier-section-head">
              <h3 className="ui-dossier-section-title">Attack Routines & Maneuvers</h3>
            </div>
            <div className="ui-attack-list">
              {sheet.attackGroups && sheet.attackGroups.length > 0
                ? sheet.attackGroups.map((group, idx) => (
                    <div key={`${group.label}_${idx}`} className="ui-attack-card">
                      <div className="ui-attack-card__head">
                        <strong>{group.label}</strong>
                        <Badge tone="neutral">{group.subtitle}</Badge>
                      </div>
                      <div className="ui-attack-card__body">
                        {`${group.attackBonuses} • ${group.damageFormula} (${group.criticalProfile})`}
                      </div>
                      {group.riderNotes ? (
                        <div style={{ marginTop: '3px', color: 'var(--ui-text-muted)' }}>{group.riderNotes}</div>
                      ) : null}
                    </div>
                  ))
                : sheet.combatSummary.map((item, idx) => (
                    <div key={`${item.title}_${idx}`} className="ui-attack-card">
                      <div className="ui-attack-card__head">
                        <strong>{item.title}</strong>
                      </div>
                      <div className="ui-attack-card__body">
                        {`${item.attackBonus} • ${item.damage} (${item.critRange})`}
                      </div>
                    </div>
                  ))}
            </div>
          </div>

          <div className="ui-dossier-section">
            <div className="ui-dossier-section-head">
              <h3 className="ui-dossier-section-title">Feats, Traits & Conditions</h3>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
              {sheet.featureEntries && sheet.featureEntries.length > 0
                ? sheet.featureEntries.map((feat, idx) => {
                    const icon =
                      feat.category === 'feat'
                        ? '⭐'
                        : feat.category === 'domain'
                          ? '☀️'
                          : feat.category === 'condition'
                            ? '⚠️'
                            : '🛡️';
                    return (
                      <span key={`${feat.name}_${idx}`} title={feat.description ?? feat.name}>
                        <Badge tone={feat.category === 'condition' ? 'warning' : 'accent'}>
                          {`${icon} ${feat.name}`}
                        </Badge>
                      </span>
                    );
                  })
                : sheet.feats.map((feat, idx) => (
                    <span key={`${feat.name}_${idx}`} title={feat.description}>
                      <Badge tone="accent">{`⭐ ${feat.name}`}</Badge>
                    </span>
                  ))}
            </div>
          </div>

          {sheet.levelHistory && sheet.levelHistory.length > 0 ? (
            <div className="ui-dossier-section">
              <div className="ui-dossier-section-head">
                <h3 className="ui-dossier-section-title">Progression History</h3>
              </div>
              <table className="ui-level-table">
                <thead>
                  <tr>
                    <th>Lv</th>
                    <th>Track</th>
                    <th>HP</th>
                    <th>Skills</th>
                    <th>Grants</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.levelHistory.map((row) => (
                    <tr key={`${row.level}_${row.classAndLevel}`}>
                      <td>{row.level}</td>
                      <td>{row.classAndLevel}</td>
                      <td>{`d${row.hitDieRoll}`}</td>
                      <td>{row.skillPointsSpent}</td>
                      <td>{row.featsAndFeatures || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>

        {/* Column 3: Skills & Compact Keyboard Stash */}
        <div className="ui-dossier-col">
          <div className="ui-dossier-section">
            <div className="ui-dossier-section-head">
              <h3 className="ui-dossier-section-title">Skills</h3>
              <Chip active={trainedOnly} onClick={(): void => setTrainedOnly((v) => !v)}>
                {trainedOnly ? 'Trained Only' : 'All Skills'}
              </Chip>
            </div>
            <div className="ui-skills-list">
              {skillRows.map((skill) => (
                <div key={skill.id} className="ui-skill-row">
                  <span>{skill.isClassSkill ? '■' : '□'}</span>
                  <span className="ui-skill-row__name">{`${skill.name} (${skill.keyAbility.toUpperCase()})`}</span>
                  <span className="ui-skill-row__total">{formatSigned(skill.totalModifier)}</span>
                  <span className="ui-skill-row__ranks">{`${skill.ranks} rk`}</span>
                  {skill.isUsableActive && onUseSkill ? (
                    <Button size="sm" variant="secondary" onClick={(): void => onUseSkill(skill.id)}>
                      Use
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="ui-dossier-section">
            <div className="ui-dossier-section-head">
              <h3 className="ui-dossier-section-title">Backpack & Stash</h3>
            </div>
            <CompactStashWidget
              data={inv}
              onEquipItem={onEquipItem}
              onUseItem={onUseItem}
              onDropItem={onDropItem}
              onInspectItem={handleInspectItem}
            />
          </div>
        </div>
      </div>

      <ItemInspectPopover anchor={inspectAnchor} />
    </div>
  );
}
