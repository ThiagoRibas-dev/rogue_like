/**
 * Campaign Topology Visualizer (`bun run map:campaign [campaignId] [--write]`)
 *
 * Reads `manifest.json`, `rules.json`, `areas.json`, and `entities.json` from
 * `public/data/campaigns/<id>/` and generates:
 *  1. A color-coded Mermaid topology graph (`graph TD`) with bidirectional vs. one-way links.
 *  2. An ASCII BFS / elevation hierarchy tree starting from `rules.map.startingAreaId`.
 *  3. An area summary breakdown table.
 *
 * Pass `--write` to also write the compiled report to `docs/CAMPAIGN_TOPOLOGIES.md`.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface RawAreaConnection {
  readonly targetAreaId: string;
  readonly direction?: string;
  readonly placementX?: number;
  readonly placementY?: number;
}

interface RawPlacedEntity {
  readonly templateId: string;
  readonly x: number;
  readonly y: number;
  readonly inventory?: ReadonlyArray<string>;
}

interface RawStaticMap {
  readonly layout: ReadonlyArray<string>;
  readonly entityLegend?: Readonly<Record<string, string>>;
}

interface RawAreaDefinition {
  readonly id: string;
  readonly name: string;
  readonly generatorType: string;
  readonly dangerRating: number;
  readonly crBudget?: number;
  readonly environmentType?: string;
  readonly tags?: ReadonlyArray<string>;
  readonly subBiomes?: Readonly<Record<string, number>>;
  readonly connections?: ReadonlyArray<RawAreaConnection>;
  readonly placedEntities?: ReadonlyArray<RawPlacedEntity>;
  readonly staticMap?: RawStaticMap;
}

interface RawCampaignManifest {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly rulesetId?: string;
}

interface RawRules {
  readonly map?: {
    readonly startingAreaId?: string;
  };
}

interface RawEntityTemplate {
  readonly id?: string;
  readonly name?: string;
}

type NodeStyleClass = 'safe' | 'outdoor' | 'dungeon' | 'boss' | 'vault';

function classifyAreaNode(area: RawAreaDefinition): {
  readonly styleClass: NodeStyleClass;
  readonly icon: string;
} {
  const tags = area.tags ?? [];
  if (tags.includes('safe') || area.dangerRating === 0) {
    return { styleClass: 'safe', icon: '🛡️' };
  }
  if (tags.includes('boss')) {
    return { styleClass: 'boss', icon: '👑' };
  }
  if (tags.includes('shrine_vault') || (area.generatorType === 'static' && area.dangerRating >= 4)) {
    return { styleClass: 'vault', icon: '🗝️' };
  }
  if (area.environmentType === 'outdoors' || tags.includes('forest') || tags.includes('swamp')) {
    return { styleClass: 'outdoor', icon: '🌲' };
  }
  return { styleClass: 'dungeon', icon: '⚔️' };
}

function sanitizeMermaidId(areaId: string): string {
  return areaId.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeMermaidText(text: string): string {
  return text.replace(/"/g, "'");
}

function collectAreaEntityNames(
  area: RawAreaDefinition,
  entities: Readonly<Record<string, RawEntityTemplate>>
): ReadonlyArray<string> {
  const counts: Record<string, number> = {};

  for (const placed of area.placedEntities ?? []) {
    const label = entities[placed.templateId]?.name ?? placed.templateId;
    counts[label] = (counts[label] ?? 0) + 1;
  }

  if (area.staticMap?.entityLegend) {
    const legend = area.staticMap.entityLegend;
    for (const row of area.staticMap.layout) {
      for (const ch of row) {
        const templateId = legend[ch];
        if (templateId && templateId !== 'wooden_door' && templateId !== 'heavy_vault_door') {
          const label = entities[templateId]?.name ?? templateId;
          counts[label] = (counts[label] ?? 0) + 1;
        }
      }
    }
  }

  return Object.entries(counts).map(([name, count]) => (count > 1 ? `${name} ×${count}` : name));
}

function formatGeneratorLabel(area: RawAreaDefinition): string {
  if (area.generatorType === 'static' && area.staticMap && area.staticMap.layout.length > 0) {
    const h = area.staticMap.layout.length;
    const w = area.staticMap.layout[0]?.length ?? 0;
    return `Static (${w}×${h})`;
  }
  return area.generatorType.charAt(0).toUpperCase() + area.generatorType.slice(1);
}

function formatEdgeLabel(
  forwardDir: string | undefined,
  reverseDir: string | undefined,
  isBidirectional: boolean
): string {
  const f = forwardDir ?? 'portal';
  if (!isBidirectional) {
    return `One-Way (${f})`;
  }
  const r = reverseDir ?? 'portal';
  if ((f === 'down' && r === 'up') || (f === 'up' && r === 'down')) {
    return 'Stairs Down / Up';
  }
  if (f === r) {
    return f.charAt(0).toUpperCase() + f.slice(1);
  }
  return `${f} / ${r}`;
}

function generateMermaidGraph(
  areas: Readonly<Record<string, RawAreaDefinition>>,
  entities: Readonly<Record<string, RawEntityTemplate>>,
  startingAreaId: string
): string {
  const lines: string[] = [
    '```mermaid',
    'graph TD',
    '    classDef safe fill:#1a3a2a,stroke:#2ecc71,stroke-width:2px,color:#fff;',
    '    classDef outdoor fill:#2c3e50,stroke:#3498db,stroke-width:2px,color:#fff;',
    '    classDef dungeon fill:#3a2010,stroke:#e67e22,stroke-width:2px,color:#fff;',
    '    classDef boss fill:#4a1515,stroke:#e74c3c,stroke-width:2px,color:#fff;',
    '    classDef vault fill:#2d1b4e,stroke:#9b59b6,stroke-width:2px,color:#fff;',
    ''
  ];

  for (const area of Object.values(areas)) {
    const nodeId = sanitizeMermaidId(area.id);
    const { styleClass, icon } = classifyAreaNode(area);
    const startBadge = area.id === startingAreaId ? ' [START]' : '';
    const crText = area.crBudget !== undefined ? ` | CR: ${area.crBudget}` : '';
    const envText = area.environmentType ? ` | ${area.environmentType}` : '';
    const genText = formatGeneratorLabel(area);

    const subBiomeParts = area.subBiomes
      ? Object.entries(area.subBiomes).map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
      : [];
    const subBiomeLine =
      subBiomeParts.length > 0 ? `<br>Sub-biomes: ${escapeMermaidText(subBiomeParts.join(', '))}` : '';

    const entityNames = collectAreaEntityNames(area, entities);
    const entityLine =
      entityNames.length > 0
        ? `<br>Entities: ${escapeMermaidText(entityNames.slice(0, 4).join(', '))}${entityNames.length > 4 ? '…' : ''}`
        : '';

    const label = `${icon} ${escapeMermaidText(area.name)}${startBadge}<br><i>Danger: ${area.dangerRating}${crText}${envText} | ${genText}</i>${subBiomeLine}${entityLine}`;
    lines.push(`    ${nodeId}["${label}"]:::${styleClass}`);
  }

  lines.push('');

  const emittedPairs: Record<string, boolean> = {};
  for (const area of Object.values(areas)) {
    for (const conn of area.connections ?? []) {
      const target = areas[conn.targetAreaId];
      if (!target) continue;

      const pairKey = [area.id, target.id].sort().join('::');
      const reverseConn = (target.connections ?? []).find((c) => c.targetAreaId === area.id);

      if (reverseConn) {
        if (emittedPairs[pairKey]) continue;
        emittedPairs[pairKey] = true;
        const edgeLabel = formatEdgeLabel(conn.direction, reverseConn.direction, true);
        lines.push(
          `    ${sanitizeMermaidId(area.id)} <-->|${edgeLabel}| ${sanitizeMermaidId(target.id)}`
        );
      } else {
        const directedKey = `${area.id}->${target.id}`;
        if (emittedPairs[directedKey]) continue;
        emittedPairs[directedKey] = true;
        const edgeLabel = formatEdgeLabel(conn.direction, undefined, false);
        lines.push(
          `    ${sanitizeMermaidId(area.id)} -->|${edgeLabel}| ${sanitizeMermaidId(target.id)}`
        );
      }
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function generateAsciiTree(
  areas: Readonly<Record<string, RawAreaDefinition>>,
  entities: Readonly<Record<string, RawEntityTemplate>>,
  startingAreaId: string
): string {
  const rootId = areas[startingAreaId] ? startingAreaId : Object.keys(areas)[0];
  if (!rootId) return '(No areas defined)';

  const visited: Record<string, boolean> = {};
  const lines: string[] = [];

  function renderNode(areaId: string, prefix: string, isLast: boolean, viaDir: string | null): void {
    const area = areas[areaId];
    if (!area) return;

    const connector = viaDir === null ? '★ ' : isLast ? '└── ' : '├── ';
    const dirTag = viaDir ? `[${viaDir.toUpperCase()}] ` : '[START] ';
    const { icon } = classifyAreaNode(area);
    const crText = area.crBudget !== undefined ? `, CR:${area.crBudget}` : '';
    const envText = area.environmentType ?? 'unknown';
    const genText = formatGeneratorLabel(area);

    if (visited[areaId]) {
      lines.push(`${prefix}${connector}${dirTag}↺ ${area.name} (${area.id})`);
      return;
    }

    visited[areaId] = true;
    lines.push(
      `${prefix}${connector}${dirTag}${icon} ${area.name} (${area.id}) — D:${area.dangerRating}${crText} | ${envText} | ${genText}`
    );

    const childPrefix = viaDir === null ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
    const entityNames = collectAreaEntityNames(area, entities);
    if (entityNames.length > 0) {
      lines.push(`${childPrefix}    • Entities: ${entityNames.join(', ')}`);
    }

    const connections = area.connections ?? [];
    connections.forEach((conn, idx) => {
      const childIsLast = idx === connections.length - 1;
      renderNode(conn.targetAreaId, childPrefix, childIsLast, conn.direction ?? 'portal');
    });
  }

  renderNode(rootId, '', true, null);

  for (const areaId of Object.keys(areas)) {
    if (!visited[areaId]) {
      lines.push('');
      renderNode(areaId, '', true, 'disconnected');
    }
  }

  return ['```text', ...lines, '```'].join('\n');
}

function renderCampaignMarkdown(campaignDir: string): string {
  const manifestPath = join(campaignDir, 'manifest.json');
  const rulesPath = join(campaignDir, 'rules.json');
  const areasPath = join(campaignDir, 'areas.json');
  const entitiesPath = join(campaignDir, 'entities.json');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawCampaignManifest;
  const rules = existsSync(rulesPath)
    ? (JSON.parse(readFileSync(rulesPath, 'utf-8')) as RawRules)
    : {};
  const areas = JSON.parse(readFileSync(areasPath, 'utf-8')) as Readonly<
    Record<string, RawAreaDefinition>
  >;
  const entities = existsSync(entitiesPath)
    ? (JSON.parse(readFileSync(entitiesPath, 'utf-8')) as Readonly<
        Record<string, RawEntityTemplate>
      >)
    : {};

  const startingAreaId = rules.map?.startingAreaId ?? Object.keys(areas)[0] ?? 'safe_hub';
  const areaList = Object.values(areas);
  const staticCount = areaList.filter((a) => a.generatorType === 'static').length;
  const procCount = areaList.length - staticCount;

  const sections: string[] = [
    `## 🗺️ ${manifest.name} (\`${manifest.id}\`)`,
    '',
    `- **Ruleset**: \`${manifest.rulesetId ?? 'classic'}\``,
    `- **Starting Area**: \`${startingAreaId}\` (${areas[startingAreaId]?.name ?? startingAreaId})`,
    `- **Total Areas**: **${areaList.length}** (${staticCount} Static, ${procCount} Procedural)`,
    `- **Description**: ${manifest.description}`,
    '',
    '### Visual Topology Map (Mermaid)',
    '',
    generateMermaidGraph(areas, entities, startingAreaId),
    '',
    '### ASCII Traversal & Elevation Tree',
    '',
    generateAsciiTree(areas, entities, startingAreaId),
    ''
  ];

  return sections.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const shouldWrite = args.includes('--write');
  const requestedCampaigns = args.filter((a) => !a.startsWith('--'));

  const campaignsRoot = join(process.cwd(), 'public', 'data', 'campaigns');
  const allCampaignIds = readdirSync(campaignsRoot).filter((entry) => {
    const full = join(campaignsRoot, entry);
    return statSync(full).isDirectory() && existsSync(join(full, 'areas.json'));
  });

  const targetIds =
    requestedCampaigns.length > 0
      ? requestedCampaigns.filter((id) => allCampaignIds.includes(id))
      : allCampaignIds;

  if (targetIds.length === 0) {
    console.error(
      `❌ No matching campaigns found. Available campaigns: ${allCampaignIds.join(', ')}`
    );
    process.exit(1);
  }

  const docBlocks: string[] = [
    '# 🗺️ Campaign Topology Maps',
    '',
    '> Auto-generated by `bun run map:campaign --write` (`scripts/visualize-campaign.ts`).',
    ''
  ];

  for (const id of targetIds) {
    const block = renderCampaignMarkdown(join(campaignsRoot, id));
    docBlocks.push(block, '---', '');
    console.log(block);
  }

  if (shouldWrite) {
    const outPath = join(process.cwd(), 'docs', 'CAMPAIGN_TOPOLOGIES.md');
    writeFileSync(outPath, docBlocks.join('\n'), 'utf-8');
    console.log(`\n✅ Wrote campaign topology visualizations to docs/CAMPAIGN_TOPOLOGIES.md`);
  }
}

main();
