/**
 * Campaign Topology & 3D Atlas Visualizer (`bun run map:campaign [campaignId] [--write] [--html]`)
 *
 * Reads `manifest.json`, `rules.json`, `areas.json`, and `entities.json` (plus full campaign/ruleset data)
 * from `public/data/campaigns/<id>/` and generates:
 *  1. A color-coded Mermaid topology graph (`graph TD`) with bidirectional vs. one-way links.
 *  2. An ASCII BFS / elevation hierarchy tree starting from `rules.map.startingAreaId`.
 *  3. A zero-dependency Daggerfall-style interactive 3D HTML atlas (`docs/campaign_atlas_3d.html`).
 *
 * Pass `--write` to write both `docs/CAMPAIGN_TOPOLOGIES.md` and `docs/campaign_atlas_3d.html`.
 * Pass `--html` to emit `docs/campaign_atlas_3d.html` without rewriting Markdown.
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { DEFAULT_ATLAS_PREVIEW_SEED } from '../src/constants/automap3d.constants.ts';
import { buildCampaignHolisticScene3D } from '../src/rendering/automap3d/automap3d_holistic.ts';
import { getRuleset } from '../src/rulesets/registry.ts';
import { CampaignCategorySchemas, CampaignDataSchema, type CampaignData } from '../src/types/campaign.types.ts';
import type { RulesetId } from '../src/types/ruleset.types.ts';
import { buildStandaloneAtlasHtml, type StandaloneAtlasCampaignEntry } from './visualize_campaign_html.ts';

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

const CATEGORY_FILE_OVERRIDES: Readonly<Partial<Record<keyof CampaignData, string>>> = {
  schemeRecipes: 'schemes.json'
};

function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function resolveCategoryFilename(key: keyof CampaignData): string {
  return CATEGORY_FILE_OVERRIDES[key] ?? `${toSnakeCase(key)}.json`;
}

function getFallbackCategoryData(key: keyof CampaignData): unknown {
  const schema = CampaignCategorySchemas[key];
  if (schema instanceof z.ZodArray) {
    if (key === 'advancement') {
      return [{ level: 1, requiredXp: 0, hpGain: 5, attackGain: 1, defenseGain: 1 }];
    }
    return [];
  }
  if (key === 'manifest') {
    return {
      id: 'custom',
      name: 'Custom Campaign',
      description: '',
      version: '1.0.0',
      author: 'Unknown',
      tags: [],
      schemaVersion: 0,
      rulesetId: 'classic'
    };
  }
  if (key === 'factions') {
    return { player: { player: 'friendly' } };
  }
  return {};
}

/**
 * Loads and validates a complete `CampaignData` bundle from disk for headless 3D scene compilation.
 */
export function loadCampaignDataForVisualizer(
  campaignDir: string,
  projectRoot: string = process.cwd()
): CampaignData | null {
  const campaignsRoot = join(projectRoot, 'public', 'data', 'campaigns');
  const raw: Record<string, unknown> = {};
  const keys = Object.keys(CampaignCategorySchemas) as Array<keyof CampaignData>;

  for (const key of keys) {
    if (key === 'triggerBuckets' || key === 'systemContent') continue;
    const filename = resolveCategoryFilename(key);
    let filePath = join(campaignDir, filename);
    if (!existsSync(filePath) && basename(campaignDir) !== 'default') {
      const defaultPath = join(campaignsRoot, 'default', filename);
      if (existsSync(defaultPath)) {
        filePath = defaultPath;
      }
    }
    if (!existsSync(filePath)) {
      raw[key] = getFallbackCategoryData(key);
    } else {
      raw[key] = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    }
  }

  const manifestObj = raw['manifest'] as Record<string, unknown> | undefined;
  const rulesetId =
    typeof manifestObj?.['rulesetId'] === 'string' ? (manifestObj['rulesetId'] as RulesetId) : 'classic';
  const ruleset = getRuleset(rulesetId);
  const rulesetDir = join(projectRoot, 'public', 'data', 'rulesets', ruleset.id);
  const readRulesetJson = (filename: string): Record<string, unknown> => {
    const p = join(rulesetDir, filename);
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf-8')) as Record<string, unknown>) : {};
  };

  for (const desc of ruleset.getBaseContentFiles?.() ?? []) {
    const baseRecord = readRulesetJson(desc.filename);
    if (Object.keys(baseRecord).length > 0) {
      raw[desc.key] = {
        ...baseRecord,
        ...((raw[desc.key] as Record<string, unknown> | undefined) ?? {})
      };
    }
  }

  const rawSystemContent: Record<string, Record<string, unknown>> = {};
  for (const desc of ruleset.getSystemContentFiles?.() ?? []) {
    const incoming = readRulesetJson(desc.filename);
    const normalized =
      typeof incoming['id'] === 'string' && typeof incoming['name'] === 'string'
        ? { [incoming['id']]: incoming }
        : incoming;
    const existing = rawSystemContent[desc.key];
    rawSystemContent[desc.key] = existing !== undefined ? { ...existing, ...normalized } : normalized;
  }
  const parsedSys = ruleset.parseSystemContent ? ruleset.parseSystemContent(rawSystemContent) : rawSystemContent;
  raw['systemContent'] = parsedSys;

  const sysItems = (parsedSys as Record<string, unknown> | undefined)?.['items'] as Record<string, unknown> | undefined;
  if (sysItems && Object.keys(sysItems).length > 0) {
    raw['items'] = {
      ...sysItems,
      ...((raw['items'] as Record<string, unknown> | undefined) ?? {})
    };
  }

  raw['triggerBuckets'] = {};
  const parsed = CampaignDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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
        lines.push(`    ${sanitizeMermaidId(area.id)} <-->|${edgeLabel}| ${sanitizeMermaidId(target.id)}`);
      } else {
        const directedKey = `${area.id}->${target.id}`;
        if (emittedPairs[directedKey]) continue;
        emittedPairs[directedKey] = true;
        const edgeLabel = formatEdgeLabel(conn.direction, undefined, false);
        lines.push(`    ${sanitizeMermaidId(area.id)} -->|${edgeLabel}| ${sanitizeMermaidId(target.id)}`);
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

function renderCampaignMarkdown(
  campaignDir: string,
  atlasSummaryLine: string | undefined
): string {
  const manifestPath = join(campaignDir, 'manifest.json');
  const rulesPath = join(campaignDir, 'rules.json');
  const areasPath = join(campaignDir, 'areas.json');
  const entitiesPath = join(campaignDir, 'entities.json');

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as RawCampaignManifest;
  const rules = existsSync(rulesPath) ? (JSON.parse(readFileSync(rulesPath, 'utf-8')) as RawRules) : {};
  const areas = JSON.parse(readFileSync(areasPath, 'utf-8')) as Readonly<Record<string, RawAreaDefinition>>;
  const entities = existsSync(entitiesPath)
    ? (JSON.parse(readFileSync(entitiesPath, 'utf-8')) as Readonly<Record<string, RawEntityTemplate>>)
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
    ...(atlasSummaryLine ? [atlasSummaryLine] : []),
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
  const shouldWriteHtml = shouldWrite || args.includes('--html');
  const requestedCampaigns = args.filter((a) => !a.startsWith('--'));

  const projectRoot = process.cwd();
  const campaignsRoot = join(projectRoot, 'public', 'data', 'campaigns');
  const allCampaignIds = readdirSync(campaignsRoot)
    .filter((entry) => {
      const full = join(campaignsRoot, entry);
      return statSync(full).isDirectory() && existsSync(join(full, 'areas.json'));
    })
    .sort();

  const targetIds =
    requestedCampaigns.length > 0 ? requestedCampaigns.filter((id) => allCampaignIds.includes(id)) : allCampaignIds;

  if (targetIds.length === 0) {
    console.error(`❌ No matching campaigns found. Available campaigns: ${allCampaignIds.join(', ')}`);
    process.exit(1);
  }

  const atlasEntries: StandaloneAtlasCampaignEntry[] = [];
  const docBlocks: string[] = [
    '# 🗺️ Campaign Topology Maps',
    '',
    '> Auto-generated by `bun run map:campaign --write` (`scripts/visualize-campaign.ts`).',
    '> Interactive zero-dependency 3D multi-Z dungeon atlas: [`docs/campaign_atlas_3d.html`](./campaign_atlas_3d.html) (fixed preview seed `' +
      String(DEFAULT_ATLAS_PREVIEW_SEED) +
      '`).',
    ''
  ];

  for (const id of targetIds) {
    const campaignDir = join(campaignsRoot, id);
    const campaignData = loadCampaignDataForVisualizer(campaignDir, projectRoot);
    let summaryLine: string | undefined;

    if (campaignData) {
      const scene = buildCampaignHolisticScene3D(campaignData, { seed: DEFAULT_ATLAS_PREVIEW_SEED });
      atlasEntries.push({
        campaignId: campaignData.manifest.id,
        campaignName: campaignData.manifest.name,
        rulesetId: campaignData.manifest.rulesetId,
        description: campaignData.manifest.description,
        scene
      });
      summaryLine = `- **3D Voxel Atlas (Seed ${DEFAULT_ATLAS_PREVIEW_SEED})**: **${scene.voxels.length}** voxels, **${scene.beacons.length}** beacons, **${scene.splines.length}** portal splines (Z ${scene.bounds.minWz}..${scene.bounds.maxWz})`;
    }

    const block = renderCampaignMarkdown(campaignDir, summaryLine);
    docBlocks.push(block, '---', '');
    console.log(block);
  }

  if (shouldWrite) {
    const outPath = join(projectRoot, 'docs', 'CAMPAIGN_TOPOLOGIES.md');
    writeFileSync(outPath, docBlocks.join('\n'), 'utf-8');
    console.log(`\n✅ Wrote campaign topology visualizations to docs/CAMPAIGN_TOPOLOGIES.md`);
  }

  if (shouldWriteHtml && atlasEntries.length > 0) {
    const htmlPath = join(projectRoot, 'docs', 'campaign_atlas_3d.html');
    const html = buildStandaloneAtlasHtml(atlasEntries, DEFAULT_ATLAS_PREVIEW_SEED);
    writeFileSync(htmlPath, html, 'utf-8');
    console.log(
      `✅ Wrote interactive 3D Campaign Atlas (${atlasEntries.length} campaign(s)) to docs/campaign_atlas_3d.html`
    );
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && resolve(entryPath) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
