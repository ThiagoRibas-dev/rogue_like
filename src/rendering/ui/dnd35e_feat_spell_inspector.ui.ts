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
  el.style.color = '#f1c40f';
  el.style.fontSize = '0.82rem';
  el.style.textTransform = 'uppercase';
  el.style.letterSpacing = '0.06em';
  el.style.borderBottom = '1px solid #333947';
  el.style.paddingBottom = '3px';
  el.style.marginTop = '6px';
  el.textContent = text;
  return el;
}

/**
 * Creates a pill badge element for D&D 3.5e right-pane inspectors.
 */
export function createInspectorBadge(text: string, color = '#c9d1d9'): HTMLElement {
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
  row.style.color = met ? '#2ecc71' : '#e74c3c';
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
  title.style.color = '#f1c40f';
  title.textContent = feat.name;
  pane.appendChild(title);

  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.gap = '6px';
  badges.appendChild(
    createInspectorBadge(
      feat.isFighterBonusFeat ? 'Fighter Bonus Feat' : 'General Feat',
      feat.isFighterBonusFeat ? '#f39c12' : '#58a6ff'
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
    preBox.style.color = '#2ecc71';
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
  title.style.color = '#f1c40f';
  title.textContent = spell.name;
  pane.appendChild(title);

  const effLvl = getSpellLevelForClass(spell, classId, domainIds) ?? spell.level;
  const badges = document.createElement('div');
  badges.style.display = 'flex';
  badges.style.flexWrap = 'wrap';
  badges.style.gap = '6px';
  badges.appendChild(createInspectorBadge(`School: ${spell.school.toUpperCase()}`, '#58a6ff'));
  badges.appendChild(createInspectorBadge(`Level: ${effLvl}`));
  const comps: string[] = [];
  if (spell.components.verbal) comps.push('V');
  if (spell.components.somatic) comps.push('S');
  if (spell.components.material) comps.push('M');
  badges.appendChild(createInspectorBadge(`Components: ${comps.join(', ') || 'None'}`));
  badges.appendChild(createInspectorBadge(`SR: ${spell.allowsSpellResistance ? 'Yes' : 'No'}`));
  if (spell.savingThrow) {
    badges.appendChild(
      createInspectorBadge(`Save: ${spell.savingThrow.saveType.toUpperCase()} (${spell.savingThrow.effect})`)
    );
  }
  if (spell.damageDice) {
    badges.appendChild(createInspectorBadge(`Effect: ${spell.damageDice} ${spell.damageType ?? ''}`, '#e74c3c'));
  }
  pane.appendChild(badges);

  if (spell.description) {
    const desc = document.createElement('p');
    desc.style.fontSize = '0.88rem';
    desc.style.lineHeight = '1.45';
    desc.textContent = spell.description;
    pane.appendChild(desc);
  }

  pane.appendChild(createInspectorSectionTitle('Class & Domain Availability'));
  const avail = document.createElement('div');
  avail.style.fontSize = '0.82rem';
  const clsEntries = Object.entries(spell.levelByClass).map(([c, l]) => `${c} ${l}`);
  const domEntries = Object.entries(spell.levelByDomain).map(([d, l]) => `${d} domain ${l}`);
  avail.textContent = [...clsEntries, ...domEntries].join(' • ') || `Level ${spell.level}`;
  pane.appendChild(avail);
}
