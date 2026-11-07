import {
  RANGER_ANIMAL_COMPANION_MIN_LEVEL,
  RANGER_COMBAT_STYLE_LEVEL,
  RANGER_FAVORED_ENEMY_UPGRADE_LEVELS,
  ROGUE_SPECIAL_ABILITY_LEVELS
} from '../../rulesets/dnd35e/companions.ts';
import type {
  DnD35ClassDefinition,
  DnD35EntityData,
  DnD35SystemContent,
  LevelUpChoice
} from '../../rulesets/registry.ts';

const ROGUE_SPECIAL_ABILITIES: ReadonlyArray<{ readonly id: string; readonly name: string }> = [
  { id: 'crippling_strike', name: 'Crippling Strike' },
  { id: 'defensive_roll', name: 'Defensive Roll' },
  { id: 'improved_evasion', name: 'Improved Evasion' },
  { id: 'opportunist', name: 'Opportunist' },
  { id: 'skill_mastery', name: 'Skill Mastery' },
  { id: 'slippery_mind', name: 'Slippery Mind' }
];

/**
 * Renders mid-level class choices (ACFs, Ranger Combat Style, Ranger Favored Enemy additions & boosts,
 * Ranger Animal Companion, and Rogue Special Abilities) in Stage 1 of the Level-Up modal.
 *
 * @param rightPane Host pane element.
 * @param dndData Actor's current `DnD35EntityData`.
 * @param activeCls Advancing class definition.
 * @param nextClassLevel New level in the advancing class.
 * @param levelUpDraft Current `LevelUpChoice` draft.
 * @param sys Loaded D&D 3.5e system content.
 * @param onUpdateDraft Callback to update the level-up draft.
 */
export function renderLevelUpClassOptions(
  rightPane: HTMLElement,
  dndData: DnD35EntityData,
  activeCls: DnD35ClassDefinition,
  nextClassLevel: number,
  levelUpDraft: LevelUpChoice,
  sys: DnD35SystemContent,
  onUpdateDraft: (next: LevelUpChoice) => void
): void {
  const eligibleAcfs = activeCls.acfSwaps.filter((a) => a.level === nextClassLevel);
  for (const acf of eligibleAcfs) {
    const isChecked = (levelUpDraft.selectedAcfs ?? []).includes(acf.acfId);
    const acfBtn = document.createElement('button');
    acfBtn.type = 'button';
    acfBtn.className = 'modal-btn';
    acfBtn.style.fontSize = '0.78rem';
    acfBtn.style.borderColor = isChecked ? 'var(--crpg-success, #2ecc71)' : 'var(--border-color)';
    acfBtn.textContent = `${isChecked ? '☑' : '☐'} [ACF] ${acf.name} (Replaces ${acf.replacesFeature} → ${acf.grantedFeature})`;
    acfBtn.addEventListener('click', () => {
      const cur = levelUpDraft.selectedAcfs ?? [];
      const nextAcfs = isChecked ? cur.filter((id) => id !== acf.acfId) : [...cur, acf.acfId];
      onUpdateDraft({ ...levelUpDraft, selectedAcfs: nextAcfs });
    });
    rightPane.appendChild(acfBtn);
  }

  if (activeCls.id === 'ranger') {
    if (nextClassLevel === RANGER_COMBAT_STYLE_LEVEL) {
      const csTitle = document.createElement('strong');
      csTitle.textContent = 'Ranger Combat Style:';
      rightPane.appendChild(csTitle);
      const csWrap = document.createElement('div');
      csWrap.style.display = 'flex';
      csWrap.style.gap = '6px';
      const styles = [
        { id: 'archery', label: 'Archery (Rapid Shot)' },
        { id: 'two_weapon', label: 'Two-Weapon (Two-Weapon Fighting)' }
      ] as const;
      for (const st of styles) {
        const sBtn = document.createElement('button');
        sBtn.type = 'button';
        sBtn.className = 'modal-btn';
        sBtn.style.padding = '4px 8px';
        sBtn.style.borderColor =
          levelUpDraft.combatStyle === st.id ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
        sBtn.textContent = st.label;
        sBtn.addEventListener('click', () => {
          onUpdateDraft({ ...levelUpDraft, combatStyle: st.id });
        });
        csWrap.appendChild(sBtn);
      }
      rightPane.appendChild(csWrap);
    }
    if (RANGER_FAVORED_ENEMY_UPGRADE_LEVELS.includes(nextClassLevel)) {
      const feAddTitle = document.createElement('strong');
      feAddTitle.textContent = 'New Favored Enemy (+2 bonus):';
      rightPane.appendChild(feAddTitle);
      const feAddWrap = document.createElement('div');
      feAddWrap.style.display = 'flex';
      feAddWrap.style.flexWrap = 'wrap';
      feAddWrap.style.gap = '4px';
      const existingEnemies = (dndData.favoredEnemies ?? []).map((e) => e.creatureType);
      const enemyCandidates = Object.keys(sys.creatureTypes ?? {});
      for (const cand of enemyCandidates) {
        if (existingEnemies.includes(cand)) continue;
        const feBtn = document.createElement('button');
        feBtn.type = 'button';
        feBtn.className = 'modal-btn';
        feBtn.style.padding = '3px 6px';
        feBtn.style.fontSize = '0.74rem';
        feBtn.style.borderColor =
          levelUpDraft.favoredEnemyAdded === cand ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
        feBtn.textContent = cand;
        feBtn.addEventListener('click', () => {
          onUpdateDraft({ ...levelUpDraft, favoredEnemyAdded: cand });
        });
        feAddWrap.appendChild(feBtn);
      }
      rightPane.appendChild(feAddWrap);

      const feBoostTitle = document.createElement('strong');
      feBoostTitle.textContent = 'Boost Existing Favored Enemy (+2 bonus):';
      rightPane.appendChild(feBoostTitle);
      const feBoostWrap = document.createElement('div');
      feBoostWrap.style.display = 'flex';
      feBoostWrap.style.flexWrap = 'wrap';
      feBoostWrap.style.gap = '4px';
      const boostCandidates = Array.from(
        new Set([...existingEnemies, ...(levelUpDraft.favoredEnemyAdded ? [levelUpDraft.favoredEnemyAdded] : [])])
      );
      for (const cand of boostCandidates) {
        const bBtn = document.createElement('button');
        bBtn.type = 'button';
        bBtn.className = 'modal-btn';
        bBtn.style.padding = '3px 6px';
        bBtn.style.fontSize = '0.74rem';
        bBtn.style.borderColor =
          levelUpDraft.favoredEnemyBoosted === cand ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
        bBtn.textContent = `+2 vs ${cand}`;
        bBtn.addEventListener('click', () => {
          onUpdateDraft({ ...levelUpDraft, favoredEnemyBoosted: cand });
        });
        feBoostWrap.appendChild(bBtn);
      }
      rightPane.appendChild(feBoostWrap);
    }
    if (nextClassLevel === RANGER_ANIMAL_COMPANION_MIN_LEVEL && !dndData.animalCompanionId) {
      const compHeader = document.createElement('strong');
      compHeader.textContent = 'Ranger Animal Companion:';
      rightPane.appendChild(compHeader);
      const compWrap = document.createElement('div');
      compWrap.style.display = 'flex';
      compWrap.style.flexWrap = 'wrap';
      compWrap.style.gap = '4px';
      const companions = Object.values(sys.races ?? {}).filter((r) => r.companionTags?.includes('animal_companion'));
      for (const comp of companions) {
        const isCur = levelUpDraft.animalCompanionId === comp.id;
        const cBtn = document.createElement('button');
        cBtn.type = 'button';
        cBtn.className = 'modal-btn';
        cBtn.style.padding = '3px 6px';
        cBtn.style.fontSize = '0.74rem';
        cBtn.style.borderColor = isCur ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
        cBtn.textContent = comp.name;
        cBtn.addEventListener('click', () => {
          onUpdateDraft({ ...levelUpDraft, animalCompanionId: comp.id });
        });
        compWrap.appendChild(cBtn);
      }
      rightPane.appendChild(compWrap);
    }
  }

  if (activeCls.id === 'rogue' && ROGUE_SPECIAL_ABILITY_LEVELS.includes(nextClassLevel)) {
    const rogTitle = document.createElement('strong');
    rogTitle.textContent = 'Rogue Special Ability:';
    rightPane.appendChild(rogTitle);
    const rogWrap = document.createElement('div');
    rogWrap.style.display = 'flex';
    rogWrap.style.flexWrap = 'wrap';
    rogWrap.style.gap = '4px';
    for (const sa of ROGUE_SPECIAL_ABILITIES) {
      const isCur = levelUpDraft.rogueSpecialAbility === sa.id;
      const sBtn = document.createElement('button');
      sBtn.type = 'button';
      sBtn.className = 'modal-btn';
      sBtn.style.padding = '4px 8px';
      sBtn.style.fontSize = '0.74rem';
      sBtn.style.borderColor = isCur ? 'var(--crpg-gold, #f1c40f)' : 'var(--border-color)';
      sBtn.textContent = sa.name;
      sBtn.addEventListener('click', () => {
        onUpdateDraft({ ...levelUpDraft, rogueSpecialAbility: sa.id });
      });
      rogWrap.appendChild(sBtn);
    }
    rightPane.appendChild(rogWrap);
  }
}
