import type { CharacterCreationDraft, DnD35SpellSchool, DnD35SystemContent } from '../../rulesets/registry.ts';
import { validateSpecialistSchoolSelection } from '../../rulesets/registry.ts';

const SPELL_SCHOOLS: ReadonlyArray<DnD35SpellSchool> = [
  'abjuration',
  'conjuration',
  'divination',
  'enchantment',
  'evocation',
  'illusion',
  'necromancy',
  'transmutation',
  'universal'
];

/**
 * Renders Cleric domain selectors (with alignment restriction badges) and War domain deity weapon picker.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderClericOptions(
  parent: HTMLElement,
  sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const domHeader = document.createElement('strong');
  domHeader.style.color = 'var(--crpg-gold, #f1c40f)';
  domHeader.textContent = `Cleric Domains (${draft.domains.length} / 2 selected):`;
  parent.appendChild(domHeader);

  for (const dom of Object.values(sys.domains)) {
    const chosen = draft.domains.includes(dom.id);
    const alignAllowed = !dom.allowedAlignments || dom.allowedAlignments.includes(draft.alignment);
    const dRow = document.createElement('div');
    dRow.className = `dnd35-list-item${chosen ? ' selected' : ''}`;
    if (!alignAllowed) {
      dRow.style.opacity = '0.5';
      dRow.title = `Requires alignment in: ${dom.allowedAlignments?.join(', ')}`;
    }
    const alignNote = !alignAllowed ? ` [Alignment Mismatch: ${dom.allowedAlignments?.join('/')}]` : '';
    dRow.textContent = `${chosen ? '☑' : '☐'} ${dom.name} — ${dom.grantedPowerDescription}${alignNote}`;
    dRow.addEventListener('click', () => {
      if (!alignAllowed && !chosen) return;
      const nextDomains = chosen
        ? draft.domains.filter((d) => d !== dom.id)
        : draft.domains.length < 2
          ? [...draft.domains, dom.id]
          : draft.domains;
      updateDraft({
        ...draft,
        domains: nextDomains,
        deityFavoredWeaponId: nextDomains.includes('war') ? (draft.deityFavoredWeaponId ?? 'longsword') : undefined
      });
    });
    parent.appendChild(dRow);
  }

  if (draft.domains.includes('war')) {
    const warHeader = document.createElement('strong');
    warHeader.style.color = 'var(--crpg-gold, #f1c40f)';
    warHeader.textContent = "War Domain: Deity's Favored Weapon:";
    parent.appendChild(warHeader);

    const weaponWrap = document.createElement('div');
    weaponWrap.style.display = 'flex';
    weaponWrap.style.flexWrap = 'wrap';
    weaponWrap.style.gap = '4px';

    const curWpn = draft.deityFavoredWeaponId ?? 'longsword';
    const weapons = Object.values(sys.items ?? {}).filter((i) => i.weaponStats !== undefined);
    for (const wpn of weapons) {
      const wBtn = document.createElement('button');
      wBtn.type = 'button';
      wBtn.className = 'modal-btn';
      wBtn.style.padding = '4px 8px';
      wBtn.style.fontSize = '0.74rem';
      wBtn.style.borderColor = curWpn === wpn.id ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
      wBtn.textContent = wpn.name;
      wBtn.addEventListener('click', () => {
        updateDraft({ ...draft, deityFavoredWeaponId: wpn.id });
      });
      weaponWrap.appendChild(wBtn);
    }
    parent.appendChild(weaponWrap);
  }
}

/**
 * Renders Wizard specialist arcane school, prohibited school selectors, and Arcane Familiar picker.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
/**
 * Renders Wizard specialist arcane school and prohibited school selectors.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderArcaneSchoolOptions(
  parent: HTMLElement,
  _sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const activeSchool = draft.arcaneSchool ?? 'universal';
  const specCheck = validateSpecialistSchoolSelection(activeSchool, draft.prohibitedSchools);
  const specTitle = document.createElement('strong');
  specTitle.style.color = specCheck.valid ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-warning, #e67e22)';
  specTitle.textContent = `Arcane School (${specCheck.valid ? 'Valid' : (specCheck.reason ?? 'Select prohibited schools')}):`;
  parent.appendChild(specTitle);

  const schoolWrap = document.createElement('div');
  schoolWrap.style.display = 'flex';
  schoolWrap.style.flexWrap = 'wrap';
  schoolWrap.style.gap = '4px';
  for (const school of SPELL_SCHOOLS) {
    const sBtn = document.createElement('button');
    sBtn.type = 'button';
    sBtn.className = 'modal-btn';
    sBtn.style.padding = '4px 8px';
    sBtn.style.fontSize = '0.74rem';
    sBtn.style.borderColor = activeSchool === school ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    sBtn.textContent = school;
    sBtn.addEventListener('click', () => {
      updateDraft({ ...draft, arcaneSchool: school, prohibitedSchools: [] });
    });
    schoolWrap.appendChild(sBtn);
  }
  parent.appendChild(schoolWrap);

  if (activeSchool !== 'universal') {
    const reqCount = activeSchool === 'divination' ? 1 : 2;
    const prohibLabel = document.createElement('strong');
    prohibLabel.textContent = `Prohibited Schools (${draft.prohibitedSchools.length} / ${reqCount}):`;
    parent.appendChild(prohibLabel);

    const prohibWrap = document.createElement('div');
    prohibWrap.style.display = 'flex';
    prohibWrap.style.flexWrap = 'wrap';
    prohibWrap.style.gap = '4px';
    for (const pSchool of SPELL_SCHOOLS) {
      if (pSchool === 'universal' || pSchool === 'divination' || pSchool === activeSchool) continue;
      const isProhib = draft.prohibitedSchools.includes(pSchool);
      const pBtn = document.createElement('button');
      pBtn.type = 'button';
      pBtn.className = 'modal-btn';
      pBtn.style.padding = '4px 8px';
      pBtn.style.fontSize = '0.74rem';
      pBtn.style.borderColor = isProhib ? 'var(--crpg-danger, #e74c3c)' : 'var(--border-color)';
      pBtn.textContent = `${isProhib ? '✖ ' : ''}${pSchool}`;
      pBtn.addEventListener('click', () => {
        const nextProhib = isProhib
          ? draft.prohibitedSchools.filter((s) => s !== pSchool)
          : draft.prohibitedSchools.length < reqCount
            ? [...draft.prohibitedSchools, pSchool]
            : draft.prohibitedSchools;
        updateDraft({ ...draft, prohibitedSchools: nextProhib });
      });
      prohibWrap.appendChild(pBtn);
    }
    parent.appendChild(prohibWrap);
  }
}

/**
 * Renders Summon Familiar picker for any class granting familiar progression.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderFamiliarOptions(
  parent: HTMLElement,
  sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const famHeader = document.createElement('strong');
  famHeader.textContent = 'Summon Familiar:';
  parent.appendChild(famHeader);
  const famWrap = document.createElement('div');
  famWrap.style.display = 'flex';
  famWrap.style.flexWrap = 'wrap';
  famWrap.style.gap = '4px';
  const familiars = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('familiar'));
  for (const fam of familiars) {
    const isCur = draft.familiarId === fam.id;
    const fBtn = document.createElement('button');
    fBtn.type = 'button';
    fBtn.className = 'modal-btn';
    fBtn.style.padding = '4px 8px';
    fBtn.style.fontSize = '0.74rem';
    fBtn.style.borderColor = isCur ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    const bonusDesc = fam.masterEffectBundle?.modifiers?.[0]
      ? `+${fam.masterEffectBundle.modifiers[0].value} ${fam.masterEffectBundle.modifiers[0].target.replace('skill:', '')}`
      : 'Alertness';
    fBtn.textContent = `${fam.name} (${bonusDesc})`;
    fBtn.addEventListener('click', () => {
      updateDraft({ ...draft, familiarId: isCur ? undefined : fam.id });
    });
    famWrap.appendChild(fBtn);
  }
  parent.appendChild(famWrap);
}

/**
 * Backwards-compatible compound renderer for Wizard options (School + Familiar).
 */
export function renderWizardOptions(
  parent: HTMLElement,
  sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  renderArcaneSchoolOptions(parent, sys, draft, updateDraft);
  renderFamiliarOptions(parent, sys, draft, updateDraft);
}

/**
 * Renders 1st-level Druid Animal Companion selector.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderDruidOptions(
  parent: HTMLElement,
  sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const compHeader = document.createElement('strong');
  compHeader.style.color = 'var(--crpg-gold, #f1c40f)';
  compHeader.textContent = '1st-Level Animal Companion:';
  parent.appendChild(compHeader);

  const compWrap = document.createElement('div');
  compWrap.style.display = 'flex';
  compWrap.style.flexWrap = 'wrap';
  compWrap.style.gap = '4px';

  const companions = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('animal_companion'));
  for (const comp of companions) {
    const isCur = draft.animalCompanionId === comp.id;
    const cBtn = document.createElement('button');
    cBtn.type = 'button';
    cBtn.className = 'modal-btn';
    cBtn.style.padding = '4px 8px';
    cBtn.style.fontSize = '0.74rem';
    cBtn.style.borderColor = isCur ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    cBtn.textContent = `${comp.name} (AC +${comp.naturalArmorBonus ?? 0}, Spd ${comp.baseLandSpeedFt}ft)`;
    cBtn.addEventListener('click', () => {
      updateDraft({ ...draft, animalCompanionId: comp.id });
    });
    compWrap.appendChild(cBtn);
  }
  parent.appendChild(compWrap);
}

/**
 * Renders 1st-level Ranger Favored Enemy selector.
 *
 * @param parent Host container element.
 * @param sys Loaded D&D 3.5e system content.
 * @param draft Current character creation draft.
 * @param updateDraft Callback to update the draft.
 */
export function renderRangerOptions(
  parent: HTMLElement,
  sys: DnD35SystemContent,
  draft: CharacterCreationDraft,
  updateDraft: (next: CharacterCreationDraft) => void
): void {
  const feLabel = document.createElement('strong');
  feLabel.textContent = '1st Favored Enemy (+2 Bonus):';
  parent.appendChild(feLabel);
  const feWrap = document.createElement('div');
  feWrap.style.display = 'flex';
  feWrap.style.flexWrap = 'wrap';
  feWrap.style.gap = '4px';
  const curFe = draft.favoredEnemyType ?? 'undead';
  const enemyTypes = Object.keys(sys.creatureTypes ?? {});
  for (const feType of enemyTypes) {
    const feBtn = document.createElement('button');
    feBtn.type = 'button';
    feBtn.className = 'modal-btn';
    feBtn.style.padding = '4px 8px';
    feBtn.style.fontSize = '0.74rem';
    feBtn.style.borderColor = curFe === feType ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
    feBtn.textContent = feType;
    feBtn.addEventListener('click', () => {
      updateDraft({ ...draft, favoredEnemyType: feType });
    });
    feWrap.appendChild(feBtn);
  }
  parent.appendChild(feWrap);
}
