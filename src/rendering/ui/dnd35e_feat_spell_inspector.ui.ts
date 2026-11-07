import {
  type DnD35FeatDefinition,
  type DnD35SpellDefinition,
  evaluatePrerequisiteAST,
  getSpellLevelForClass,
  type PrerequisiteEvalContext,
  type PrerequisiteNode
} from '../../rulesets/registry.ts';

/**
 * Creates a styled uppercase section header for D&D 3.5e right-pane inspectors.
 */
export function createInspectorSectionTitle(text: string): HTMLElement {
  const el = document.createElement('div');
  el.style.fontWeight = '700';
  el.style.color = 'var(--crpg-gold)';
  el.style.fontSize = '0.82rem';
  el.style.textTransform = 'uppercase';
  el.style.letterSpacing = '0.06em';
  el.style.borderBottom = '1px solid var(--crpg-border-inner)';
  el.style.paddingBottom = '3px';
  el.style.marginTop = '6px';
  el.textContent = text;
  return el;
}

/**
 * Creates a pill badge element for D&D 3.5e right-pane inspectors.
 */
export function createInspectorBadge(text: string, color = 'var(--crpg-text-main)'): HTMLElement {
  const span = document.createElement('span');
  span.className = 'dnd35-badge';
  span.style.color = color;
  span.textContent = text;
  return span;
}

function renderPrerequisiteNodeChecklist(
  node: PrerequisiteNode,
  ctx: PrerequisiteEvalContext,
  container: HTMLElement
): void {
  if (node.type === 'and' || node.type === 'or') {
    for (const child of node.children) {
      renderPrerequisiteNodeChecklist(child, ctx, container);
    }
    return;
  }
  const met = evaluatePrerequisiteAST(node, ctx);
  const row = document.createElement('div');
  row.style.color = met ? 'var(--crpg-success)' : 'var(--crpg-danger)';
  row.style.fontSize = '0.82rem';
  let label: string = node.type;
  if (node.type === 'min_ability') label = `${node.ability.toUpperCase()} ${node.minScore}+`;
  else if (node.type === 'min_bab') label = `Base Attack Bonus +${node.minBab}`;
  else if (node.type === 'has_feat') label = `Feat: ${node.featId}`;
  else if (node.type === 'min_skill_ranks') label = `Skill ${node.skillId}: ${node.minRanks}+ ranks`;
  else if (node.type === 'min_caster_level') label = `Caster Level ${node.minCasterLevel}+`;
  row.textContent = `${met ? '🟢' : '🔴'} Requires ${label}`;
  container.appendChild(row);
}

/**
 * Renders the detailed right-pane inspector for a D&D 3.5e Feat definition.
 */
export function renderFeatInspector(
  pane: HTMLElement,
  feat: DnD35FeatDefinition,
  prereqCtx: PrerequisiteEvalContext
): void {
  pane.replaceChildren();
  const title = document.createElement('h3');
  title.style.margin = '0 0 4px 0';
  title.style.color = 'var(--crpg-gold)';
  title.textContent = feat.name;
  pane.appendChild(title);

  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.gap = '6px';
  badges.appendChild(
    createInspectorBadge(
      feat.isFighterBonusFeat ? 'Fighter Bonus Feat' : 'General Feat',
      feat.isFighterBonusFeat ? 'var(--crpg-warning)' : 'var(--crpg-info)'
    )
  );
  pane.appendChild(badges);

  const desc = document.createElement('p');
  desc.style.fontSize = '0.88rem';
  desc.style.lineHeight = '1.45';
  desc.textContent = feat.description;
  pane.appendChild(desc);

  pane.appendChild(createInspectorSectionTitle('Prerequisites'));
  const preBox = document.createElement('div');
  if (!feat.prerequisites) {
    preBox.style.color = 'var(--crpg-success)';
    preBox.style.fontSize = '0.82rem';
    preBox.textContent = '🟢 None (Available to any eligible character)';
  } else {
    renderPrerequisiteNodeChecklist(feat.prerequisites, prereqCtx, preBox);
  }
  pane.appendChild(preBox);
}

/**
 * Renders the detailed right-pane inspector for a D&D 3.5e Spell definition.
 */
export function renderSpellInspector(
  pane: HTMLElement,
  spell: DnD35SpellDefinition,
  classId: string,
  domainIds: ReadonlyArray<string>
): void {
  pane.replaceChildren();
  const title = document.createElement('h3');
  title.style.margin = '0 0 4px 0';
  title.style.color = 'var(--crpg-gold)';
  title.textContent = spell.name;
  pane.appendChild(title);

  const effLvl = getSpellLevelForClass(spell, classId, domainIds) ?? spell.level;
  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.flexWrap = 'wrap';
  badges.style.gap = '6px';
  const schoolLabel = spell.subschool
    ? `${spell.school.toUpperCase()} (${spell.subschool.toUpperCase()})`
    : spell.school.toUpperCase();
  badges.appendChild(createInspectorBadge(`School: ${schoolLabel}`, 'var(--crpg-info)'));
  for (const descTag of spell.descriptors ?? []) {
    badges.appendChild(createInspectorBadge(`[${descTag.toUpperCase()}]`, 'var(--crpg-info)'));
  }
  badges.appendChild(createInspectorBadge(`Level: ${effLvl}`));
  if (spell.castingTime) {
    badges.appendChild(createInspectorBadge(`Cast: ${spell.castingTime}`));
  }
  if (spell.range) {
    badges.appendChild(createInspectorBadge(`Range: ${spell.range}`));
  }
  if (spell.duration) {
    badges.appendChild(createInspectorBadge(`Duration: ${spell.duration}`));
  }
  const comps: string[] = [];
  if (spell.components.verbal) comps.push('V');
  if (spell.components.somatic) comps.push('S');
  if (spell.components.material) comps.push('M');
  if (spell.components.focus) comps.push('F');
  if (spell.components.divineFocus) comps.push('DF');
  if (spell.components.sacrifice) comps.push('Sacrifice');
  if (spell.components.xpCost) comps.push(`XP (${spell.components.xpCost})`);
  badges.appendChild(createInspectorBadge(`Components: ${comps.join(', ') || 'None'}`));
  badges.appendChild(createInspectorBadge(`SR: ${spell.allowsSpellResistance ? 'Yes' : 'No'}`));
  if (spell.savingThrow && spell.savingThrow.saveType !== 'none') {
    badges.appendChild(
      createInspectorBadge(`Save: ${spell.savingThrow.saveType.toUpperCase()} (${spell.savingThrow.effect})`)
    );
  }
  if (spell.damageDice) {
    badges.appendChild(
      createInspectorBadge(`Effect: ${spell.damageDice} ${spell.damageType ?? ''}`, 'var(--crpg-danger)')
    );
  }
  pane.appendChild(badges);

  if (spell.description) {
    const desc = document.createElement('p');
    desc.style.fontSize = '0.88rem';
    desc.style.lineHeight = '1.45';
    desc.textContent = spell.description;
    pane.appendChild(desc);
  }

  pane.appendChild(createInspectorSectionTitle('Class, Domain & Tag Availability'));
  const avail = document.createElement('div');
  avail.style.fontSize = '0.82rem';
  const clsEntries = Object.entries(spell.levelByClass).map(([c, l]) => `${c} ${l}`);
  const domEntries = Object.entries(spell.levelByDomain).map(([d, l]) => `${d} domain ${l}`);
  const tagEntries = Object.entries(spell.levelByAccessTag ?? {}).map(([t, l]) => `${t} ${l}`);
  avail.textContent = [...clsEntries, ...domEntries, ...tagEntries].join(' • ') || `Level ${spell.level}`;
  pane.appendChild(avail);

  if (spell.effectUnits && spell.effectUnits.length > 0) {
    pane.appendChild(createInspectorSectionTitle('Modular Effect Units'));
    const unitList = document.createElement('div');
    unitList.style.display = 'flex';
    unitList.style.flexDirection = 'column';
    unitList.style.gap = '4px';
    unitList.style.fontSize = '0.82rem';

    for (const u of spell.effectUnits) {
      const row = document.createElement('div');
      row.style.color = 'var(--crpg-text-main)';
      let summary = `${u.unitId} (${u.type} • ${u.targetRole})`;
      if (u.type === 'damage') {
        summary = `⚔ Damage: ${u.dice} ${u.damageType}`;
      } else if (u.type === 'healing') {
        summary = `✚ Healing: ${u.dice}${u.isTemporaryHp ? ' (Temp HP)' : ''}`;
      } else if (u.type === 'ability_harm') {
        summary = `⚡ ${u.harmKind.toUpperCase()}: ${u.dice} ${u.ability.toUpperCase()}`;
      } else if (u.type === 'condition') {
        summary = `⬢ Condition: ${u.conditionId}`;
      } else if (u.type === 'stat_bundle') {
        summary = `✦ Buff: ${u.effectBundle.name}`;
      } else if (u.type === 'spatial_field') {
        summary = `◉ Field: ${u.fieldType} (${u.radiusFt} ft)`;
      } else if (u.type === 'dispel') {
        summary = `✕ Dispel: Max CL +${u.maxCasterLevelBonus}`;
      } else if (u.type === 'quicken_cast_grant') {
        summary = `⏩ Quicken Cast Grant`;
      } else if (u.type === 'energy_drain') {
        summary = `☠ Energy Drain: ${u.dice} negative levels`;
      } else if (u.type === 'save_or_die') {
        summary = `☠ Save or Die: ${u.onFailOutcome.toUpperCase()}`;
      } else if (u.type === 'summon') {
        const pool = u.summonPool.map((p) => (p.templateId ? `${p.templateId} ${p.raceId}` : p.raceId)).join(', ');
        summary = `🐾 Summon: ${pool || 'creatures'}`;
      } else if (u.type === 'form_overlay') {
        summary = `✨ Form Overlay: ${u.overlayMode} (${u.allowedCreatureTypes.join(', ') || 'all'})`;
      }
      row.textContent = summary;
      unitList.appendChild(row);
    }
    pane.appendChild(unitList);
  }
}
