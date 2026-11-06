/**
 * @file D&D 3.5e Character Sheet Column 2 (Center Column):
 * Multi-Weapon/Natural Attack Routine Ledger, Feats/Features/Conditions & Level-by-Level Matrix.
 */

import { getComponent } from '../../core/ecs.ts';
import {
  type DnD35ResolvedStrikeProfile,
  evaluateDnD35eEntityDAG,
  getDnD35EntityData,
  getDnD35SystemContent
} from '../../rulesets/registry.ts';
import { ComponentType, type StatusEffectsComponent } from '../../types/components.types.ts';
import type { EntityId, GameState } from '../../types/game-state.types.ts';
import type { UIAttackGroupModel } from '../../types/ui_adapter.types.ts';
import { getSheetMorphologyMode } from './dnd35e_sheet_overview_tab.ui.ts';

const NATURAL_20 = 20;

function formatSigned(val: number): string {
  return val >= 0 ? `+${val}` : `${val}`;
}

function groupLiveStrikesIntoAttackGroups(
  strikes: ReadonlyArray<DnD35ResolvedStrikeProfile>
): ReadonlyArray<UIAttackGroupModel> {
  const mode = getSheetMorphologyMode();
  if (mode === 'marilith_6arm') {
    return [
      {
        id: 'marilith_primary',
        label: 'Primary Arm 1: Abyssal Longsword',
        subtitle: 'Primary Hand • 4 Iterative Strikes',
        category: 'manufactured',
        attackBonuses: '+22 / +17 / +12 / +7',
        damageFormula: '2d6 + 9',
        criticalProfile: '19-20 / x2',
        riderNotes: 'Multiweapon Mastery (0 Penalty) • Chaotic / Evil'
      },
      {
        id: 'marilith_offhands',
        label: 'Arms 2–6: 5× Abyssal Longswords',
        subtitle: '5 Off-Hand Limbs • Multiweapon Fighting',
        category: 'extra_limb',
        attackBonuses: '5× (+22)',
        damageFormula: '2d6 + 4 each',
        criticalProfile: '19-20 / x2',
        riderNotes: '5 Simultaneous Off-Hand Strikes'
      },
      {
        id: 'marilith_tail',
        label: 'Serpent Tail Slap',
        subtitle: 'Natural Secondary (-5 Demoted)',
        category: 'natural_secondary',
        attackBonuses: '+17',
        damageFormula: '4d6 + 4',
        criticalProfile: '20 / x2',
        riderNotes: 'Improved Grab • Constrict 4d6+13'
      }
    ];
  }

  if (mode === 'quadruped_wolf') {
    return [
      {
        id: 'wolf_bite',
        label: 'Dire Wolf Bite (Primary Natural)',
        subtitle: 'Head / Jaws • Primary 1.5× STR',
        category: 'natural_primary',
        attackBonuses: '+11',
        damageFormula: '1d8 + 7',
        criticalProfile: '20 / x2',
        riderNotes: 'Free Trip Attempt On Hit (Ex) • Manufactured Gear Melded'
      },
      {
        id: 'wolf_claws',
        label: '2× Forelimb Rake Claws',
        subtitle: 'Forelimbs • Secondary (-5)',
        category: 'natural_secondary',
        attackBonuses: '+6 / +6',
        damageFormula: '1d4 + 2',
        criticalProfile: '20 / x2',
        riderNotes: 'Piercing & Slashing'
      }
    ];
  }

  const map = new Map<string, { bonuses: string[]; first: DnD35ResolvedStrikeProfile }>();
  for (const s of strikes) {
    const key = `${s.attackSource}::${s.weaponId ?? s.naturalWeaponId ?? s.label}`;
    const existing = map.get(key);
    if (existing) {
      existing.bonuses.push(formatSigned(s.attackBonus));
    } else {
      map.set(key, { bonuses: [formatSigned(s.attackBonus)], first: s });
    }
  }

  const groups: UIAttackGroupModel[] = [];
  for (const [key, entry] of map.entries()) {
    const s = entry.first;
    const dmgBonus = s.strDamageBonus + s.doctrineDamageBonus + s.flatDamageBonus;
    const critStr =
      s.critThreatMin < NATURAL_20
        ? `${s.critThreatMin}-${NATURAL_20} / x${s.critMultiplier}`
        : `20 / x${s.critMultiplier}`;
    const subtitle =
      s.attackSource === 'manufactured_primary'
        ? `Primary Hand (${s.handedness.replace(/_/g, ' ')})`
        : s.attackSource === 'manufactured_offhand'
          ? 'Off-Hand (TWF)'
          : s.attackSource === 'natural_primary'
            ? 'Natural Primary'
            : 'Natural Secondary (-5)';

    const category: UIAttackGroupModel['category'] =
      s.attackSource === 'manufactured_primary'
        ? 'manufactured'
        : s.attackSource === 'manufactured_offhand'
          ? 'off_hand'
          : s.attackSource === 'natural_primary'
            ? 'natural_primary'
            : 'natural_secondary';

    groups.push({
      id: key,
      label: s.label.replace(/\s+#\d+$/, ''),
      subtitle,
      category,
      attackBonuses: entry.bonuses.join(' / '),
      damageFormula: `${s.weaponDice} ${formatSigned(dmgBonus)}`,
      criticalProfile: critStr,
      riderNotes: [s.weaponDamageType.toUpperCase(), ...s.bypassTags].join(' • ')
    });
  }

  return groups;
}

/**
 * Renders Column 2 (Center Column): Attack Routine Ledger, Feats/Features/Conditions & Level-by-Level Matrix.
 */
export function renderSheetFeatsAndFeaturesTab(container: HTMLElement, state: GameState, playerId: EntityId): void {
  const col = document.createElement('div');
  col.className = 'crpg-col-pane';

  const dndData = getDnD35EntityData(state, playerId);
  const evalResult = evaluateDnD35eEntityDAG(state, playerId);
  const sys = getDnD35SystemContent(state.campaign);
  const featRegistry = sys?.feats ?? {};

  // SECTION 1: Multi-Weapon, Iterative & Natural Weapon Attack Routine Ledger
  const atkHeading = document.createElement('h3');
  atkHeading.className = 'crpg-section-heading';
  atkHeading.textContent = 'Full-Attack & Natural Weapon Routine';
  col.appendChild(atkHeading);

  const strikes = evalResult?.attackRoutine.strikes ?? [];
  const attackGroups = groupLiveStrikesIntoAttackGroups(strikes);

  const routineList = document.createElement('div');
  routineList.className = 'crpg-attack-routine-list';

  for (const grp of attackGroups) {
    const row = document.createElement('div');
    row.className = 'crpg-attack-routine-row';

    const hdr = document.createElement('div');
    hdr.className = 'crpg-attack-group-header';
    const titleSpan = document.createElement('span');
    titleSpan.className = 'crpg-attack-group-title';
    titleSpan.textContent = grp.label;
    const subSpan = document.createElement('span');
    subSpan.className = 'crpg-attack-group-sub';
    subSpan.textContent = grp.subtitle;
    hdr.append(titleSpan, subSpan);

    const metrics = document.createElement('div');
    metrics.className = 'crpg-attack-group-metrics';
    const atkChain = document.createElement('span');
    atkChain.className = 'crpg-attack-bonus-chain';
    atkChain.textContent = `ATK ${grp.attackBonuses}`;
    const dmgCrit = document.createElement('span');
    dmgCrit.className = 'crpg-attack-dmg-crit';
    dmgCrit.textContent = `${grp.damageFormula} (${grp.criticalProfile})`;
    metrics.append(atkChain, dmgCrit);

    row.append(hdr, metrics);
    if (grp.riderNotes) {
      const note = document.createElement('div');
      note.className = 'crpg-attack-rider-note';
      note.textContent = grp.riderNotes;
      row.appendChild(note);
    }
    routineList.appendChild(row);
  }
  col.appendChild(routineList);

  // SECTION 2: Feats, Class Features, Domains & Active Conditions
  const featBanner = document.createElement('div');
  featBanner.className = 'crpg-subbanner';
  featBanner.textContent = `Feats (${dndData.feats.length}), Class Features & Active Conditions`;
  col.appendChild(featBanner);

  const badgeGrid = document.createElement('div');
  badgeGrid.className = 'crpg-features-grid';

  const appendFeatureChip = (
    catClass: 'feat' | 'class_feature' | 'domain' | 'condition',
    icon: string,
    name: string,
    badge: string
  ): void => {
    const chip = document.createElement('div');
    chip.className = `crpg-feature-chip ${catClass}`;
    const ic = document.createElement('span');
    ic.className = 'crpg-feature-chip-icon';
    ic.textContent = icon;
    const nm = document.createElement('span');
    nm.className = 'crpg-feature-chip-title';
    nm.textContent = name;
    const bd = document.createElement('span');
    bd.className = 'crpg-feature-chip-badge';
    bd.textContent = badge;
    chip.append(ic, nm, bd);
    badgeGrid.appendChild(chip);
  };

  for (const featId of dndData.feats) {
    const def = featRegistry[featId];
    appendFeatureChip('feat', '⭐', def?.name ?? featId.replace(/_/g, ' '), 'Feat');
  }
  for (const cfId of dndData.activeClassFeatures ?? []) {
    appendFeatureChip('class_feature', '🛡️', cfId.replace(/_/g, ' '), 'Class');
  }
  for (const domId of dndData.domains ?? []) {
    appendFeatureChip('domain', '☀️', `${domId.toUpperCase()} Domain`, 'Domain');
  }
  for (const cond of dndData.conditions) {
    appendFeatureChip('condition', '⚠️', cond.toUpperCase(), 'Cond');
  }
  const statusComp = getComponent(state, playerId, ComponentType.StatusEffects) as StatusEffectsComponent | undefined;
  for (const eff of statusComp?.activeEffects ?? []) {
    appendFeatureChip('condition', '✨', eff.effectId, `${eff.duration}t`);
  }
  if (badgeGrid.childElementCount === 0) {
    appendFeatureChip('class_feature', '🛡️', 'Martial & Simple Proficiency', 'Base');
  }
  col.appendChild(badgeGrid);

  // SECTION 3: Horizon 1 Level-by-Level Progression Matrix
  const matrixBanner = document.createElement('div');
  matrixBanner.className = 'crpg-subbanner';
  matrixBanner.textContent = 'Level-by-Level Progression Matrix (Horizon 1 Ledger)';
  col.appendChild(matrixBanner);

  const matrixWrap = document.createElement('div');
  matrixWrap.className = 'crpg-level-matrix-wrap';
  const tbl = document.createElement('table');
  tbl.className = 'crpg-level-matrix-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const h of ['Lvl', 'Class / RHD', 'HP', 'Skills', 'Feats & Features']) {
    const th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  }
  thead.appendChild(htr);
  tbl.appendChild(thead);

  const tbody = document.createElement('tbody');
  const history = dndData.levelHistory ?? [];
  if (history.length > 0) {
    for (const entry of history) {
      const tr = document.createElement('tr');
      const skPts = Object.values(entry.addedSkillRanks ?? {}).reduce((a: number, b: number) => a + b, 0);
      const gains =
        [...entry.selectedFeats, ...entry.selectedAcfs].map((g) => g.replace(/_/g, ' ')).join(', ') || 'Base Chassis';
      for (const txt of [
        `${entry.characterLevel}`,
        `${entry.classId} ${entry.classLevel}`,
        `+${entry.hpRolled}`,
        `${skPts} pts`,
        gains
      ]) {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  } else {
    let runningLvl = 1;
    for (const trk of dndData.tracks) {
      const tr = document.createElement('tr');
      for (const txt of [
        `${runningLvl}–${runningLvl + trk.levels - 1}`,
        trk.trackId.toUpperCase(),
        `d${trk.hitDieSides}`,
        `${Object.keys(dndData.skillRanks).length} trn`,
        (dndData.feats ?? []).join(', ') || 'Baseline'
      ]) {
        const td = document.createElement('td');
        td.textContent = txt;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
      runningLvl += trk.levels;
    }
  }
  tbl.appendChild(tbody);
  matrixWrap.appendChild(tbl);
  col.appendChild(matrixWrap);

  container.appendChild(col);
}
