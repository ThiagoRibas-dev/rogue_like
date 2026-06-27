/**
 * AI Prompt Kit Generator
 *
 * Reads the engine's Zod schemas, the default campaign data, and the
 * cross-reference surface, then outputs a structured "prompt kit"
 * that an LLM can consume to generate valid campaigns.
 *
 * Usage:
 *   bun scripts/generate-ai-prompt-kit.ts [--out-dir ./ai-prompt-kit]
 *
 * Output (in out-dir):
 *   schema-contract.md        — All Zod schemas as documented TypeScript interfaces
 *   cross-reference-map.md    — Field-by-field cross-reference table
 *   valid-values.json         — All enum/literal values extracted from schemas
 *   generation-rules.md       — Ordering, constraints, and "gotchas"
 *   default-campaign/         — Copy of default campaign for reference
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ──────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = join(__dirname, '..');
const SRC_TYPES = join(ROOT, 'src', 'types');
const SRC_CONSTANTS = join(ROOT, 'src', 'constants');
const DEFAULT_CAMPAIGN = join(ROOT, 'public', 'data', 'campaigns', 'default');
const OUT_DIR = process.argv[2] === '--out-dir' && process.argv[3]
    ? join(ROOT, process.argv[3])
    : join(ROOT, 'ai-prompt-kit');

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function readSource(filePath: string): string {
    try {
        return readFileSync(filePath, 'utf-8');
    } catch {
        return '';
    }
}

/**
 * Extract all Zod schema definitions from a source file.
 * Returns map of schema name → source code text.
 */
function extractZodSchemas(source: string): Map<string, string> {
    const schemas = new Map<string, string>();

    // Match: export const SchemaName = z.object({ ... })
    // or export const SchemaName = z.discriminatedUnion('type', [ ... ])
    // or export const SchemaName = z.enum([ ... ])
    // or export const SchemaName = z.record(z.string(), ...)
    // We capture the beginning and try to find balanced braces

    const lines = source.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;
        // Match export const <Name>Schema = z....
        const match = line.match(/^export const (\w+Schema)\s*=\s*z\./);
        if (match) {
            const schemaName = match[1]!;
            // Collect the schema definition - it may span multiple lines
            // Find the balanced brace/end
            let depth = 0;
            let started = false;
            let schemaText = '';
            let j = i;

            while (j < lines.length) {
                const l = lines[j]!;
                schemaText += l + '\n';

                for (const ch of l) {
                    if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; }
                    if (ch === '}' || ch === ']' || ch === ')') { depth--; }
                }

                // For z.enum, z.literal, z.record, etc., the closing paren/brace may appear
                // Check if we've reached the end of the statement (semicolon)
                if (started && depth <= 0 && l.trim().endsWith(');')) {
                    // But make sure this isn't something like .optional()
                    if (!l.trimEnd().endsWith('.') && !l.trimEnd().endsWith(',')) {
                        break;
                    }
                }

                // Also handle simple one-liners: export const X = z.enum([...]);
                if (!started && l.trim().endsWith(');')) {
                    break;
                }

                j++;
            }

            schemas.set(schemaName, schemaText.trim());
            i = j + 1;
        } else {
            i++;
        }
    }

    return schemas;
}

/**
 * Extract TypeScript type/interface/enum definitions from source.
 */
function extractTypeDefinitions(source: string): Map<string, string> {
    const types = new Map<string, string>();

    // Match: export interface Name { ... }
    // Match: export type Name = ...;
    // Match: export enum Name { ... }
    // Match: export const enum Name { ... }

    const lines = source.split('\n');
    let i = 0;
    while (i < lines.length) {
        const line = lines[i]!;

        // export interface Name
        let match = line.match(/^export (interface|type|enum|const enum)\s+(\w+)/);
        if (!match) {
            // Also match lines like:   type Component = DiscriminatedUnion
            match = line.match(/^\s*(type)\s+(\w+)\s*=/);
        }

        if (match) {
            const kind = match[1]!;
            const name = match[2]!;

            // Don't capture Zod schemas here
            if (name.endsWith('Schema')) { i++; continue; }

            let depth = 0;
            let started = false;
            let text = '';
            let j = i;

            while (j < lines.length) {
                const l = lines[j]!;
                text += l + '\n';

                for (const ch of l) {
                    if (ch === '{' || ch === '[' || ch === '(') { depth++; started = true; }
                    if (ch === '}' || ch === ']' || ch === ')') { depth--; }
                }

                // For type aliases, check for semicolon
                if (kind === 'type' && !started && l.trim().endsWith(';')) {
                    break;
                }
                if (started && depth <= 0 && (l.trim().endsWith(';') || l.trim().endsWith('}') || l.trim().endsWith('};'))) {
                    // Check it's not continuation
                    const trimmed = l.trimEnd();
                    if (!trimmed.endsWith('.') && !trimmed.endsWith(',') && trimmed !== '}') {
                        break;
                    }
                    if (trimmed.endsWith('};') || trimmed.endsWith('}') && !l.includes('{')) {
                        break;
                    }
                }

                j++;
            }

            types.set(name, text.trim());
            i = j + 1;
        } else {
            i++;
        }
    }

    return types;
}

/**
 * Extract named Zod enum definitions and their values.
 * Matches patterns like:
 *   export const NameEnum = z.enum(['a', 'b', 'c']);
 * Returns Map<enumName, values[]>
 */
function extractNamedEnumValues(source: string): Map<string, string[]> {
    const enums = new Map<string, string[]>();
    const pattern = /export\s+const\s+(\w+Enum)\s*=\s*z\.enum\(\[([^\]]+)\]\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
        const enumName = match[1]!;
        const body = match[2]!;
        const values: string[] = [];
        const items = body.match(/['"`]([^'"`]+)['"`]/g);
        if (items) {
            for (const item of items) {
                values.push(item.replace(/['"`]/g, ''));
            }
        }
        enums.set(enumName, values);
    }
    return enums;
}

/**
 * Extract enum members from a zod enum definition like:
 *   z.enum(['a', 'b', 'c'])
 */
function extractEnumValues(source: string): string[] {
    const matches = source.matchAll(/z\.enum\(\[\s*((['"`][^'"`]+['"`]\s*,?\s*)+)\]\)/g);
    const values: string[] = [];
    for (const m of matches) {
        const inner = m[1]!;
        const items = inner.match(/['"`]([^'"`]+)['"`]/g);
        if (items) {
            for (const item of items) {
                values.push(item.replace(/['"`]/g, ''));
            }
        }
    }
    return [...new Set(values)];
}

/**
 * Extract literal union members from discriminatedUnion or z.literal patterns.
 */
function extractLiteralValues(source: string): string[] {
    const values: string[] = [];
    // Match z.literal('xxx')
    const matches = source.matchAll(/z\.literal\(['"`]([^'"`]+)['"`]\)/g);
    for (const m of matches) {
        values.push(m[1]!);
    }
    return [...new Set(values)];
}

/**
 * Extract TypeScript enum members (from `export enum X { a = 'a', ... }`)
 */
function extractTSEnumValues(source: string): Map<string, string[]> {
    const enums = new Map<string, string[]>();

    // Match: export enum Name { ... } or export const enum Name { ... }
    const enumBlocks = source.matchAll(/export\s+(const\s+)?enum\s+(\w+)\s*\{([^}]+)\}/g);
    for (const block of enumBlocks) {
        const name = block[2]!;
        const body = block[3]!;
        const members: string[] = [];
        const memberMatches = body.matchAll(/(\w+)\s*=\s*['"`]([^'"`]+)['"`]/g);
        for (const m of memberMatches) {
            members.push(m[2]!);
        }
        // Also handle numeric enums or string enums without explicit values
        const simpleMembers = body.matchAll(/(\w+)\s*[=,]/g);
        if (members.length === 0) {
            for (const m of simpleMembers) {
                members.push(m[1]!);
            }
        }
        if (members.length > 0) {
            enums.set(name, members);
        }
    }

    return enums;
}

/**
 * Extract all JSDoc comments from a source file.
 */
function extractJSDocs(source: string): Map<string, string> {
    const docs = new Map<string, string>();
    // Match JSDoc followed by export
    const matches = source.matchAll(/\/\*\*\s*\n([^*]+\*\/)\s*\n?export\s+(const|type|interface|function|enum)\s+(\w+)/g);
    for (const m of matches) {
        docs.set(m[3]!, m[1]!.trim());
    }
    return docs;
}

/**
 * Extract the schema-to-registry mapping from source code.
 * E.g., campaign.types.ts CampaignDataSchema has shape keys that map to sub-schemas.
 */
function extractCampaignCategoryKeys(source: string): string[] {
    const keys: string[] = [];
    // Match the CampaignCategorySchemas object literal keys
    const objMatch = source.match(/CampaignCategorySchemas[^=]*=\s*\{([^}]+)\}/s);
    if (objMatch) {
        const body = objMatch[1]!;
        const keyMatches = body.matchAll(/^\s*(\w+):/gm);
        for (const m of keyMatches) {
            keys.push(m[1]!);
        }
    }
    return keys;
}

// ──────────────────────────────────────────────
// Main Generator
// ──────────────────────────────────────────────

function main() {
    console.log(`📦 Generating AI Prompt Kit in: ${OUT_DIR}`);

    // Ensure output directory
    mkdirSync(OUT_DIR, { recursive: true });
    mkdirSync(join(OUT_DIR, 'default-campaign'), { recursive: true });

    // ─── 1. Read all source files ───
    const campaignTypes = readSource(join(SRC_TYPES, 'campaign.types.ts'));
    const triggerTypes = readSource(join(SRC_TYPES, 'trigger.types.ts'));
    const dialogueTypes = readSource(join(SRC_TYPES, 'dialogue.types.ts'));
    const questTypes = readSource(join(SRC_TYPES, 'quests.types.ts'));
    const eventsTypes = readSource(join(SRC_TYPES, 'events.types.ts'));
    const verbsConstants = readSource(join(SRC_CONSTANTS, 'verbs.constants.ts'));
    const triggerConstants = readSource(join(SRC_CONSTANTS, 'trigger.constants.ts'));

    const allSource = [
        ['campaign.types.ts', campaignTypes],
        ['trigger.types.ts', triggerTypes],
        ['dialogue.types.ts', dialogueTypes],
        ['quests.types.ts', questTypes],
        ['events.types.ts', eventsTypes],
        ['verbs.constants.ts', verbsConstants],
        ['trigger.constants.ts', triggerConstants]
    ] as const;

    // ─── 2. Extract all schemas, types, enums ───
    const allSchemas = new Map<string, string>();
    const allTypes = new Map<string, string>();
    const allJSDocs = new Map<string, string>();
    const allTSEnums = new Map<string, string[]>();

    for (const [, source] of allSource) {
        const schemas = extractZodSchemas(source);
        for (const [k, v] of schemas) allSchemas.set(k, v);

        const types = extractTypeDefinitions(source);
        for (const [k, v] of types) allTypes.set(k, v);

        const docs = extractJSDocs(source);
        for (const [k, v] of docs) allJSDocs.set(k, v);

        const tsenums = extractTSEnumValues(source);
        for (const [k, v] of tsenums) allTSEnums.set(k, v);
    }

    // ─── 3. Extract all valid values ───

    // TS enums
    const gameEventEnum = allTSEnums.get('GameEventType') ?? [];
    // If Verb is a type alias, extract from the constants file
    const verbTypeMatch = verbsConstants.match(/(['"`]\w+['"`])/g);
    const verbStrings = verbTypeMatch
        ? verbTypeMatch.map(m => m.replace(/['"`]/g, ''))
        : [];

    // ─── 4. Extract per-schema enum values ───
    const namedEnums = extractNamedEnumValues(campaignTypes);

    const itemCategoryValues = namedEnums.get('ItemCategoryEnum') ?? ['consumable', 'weapon', 'armor', 'tool'];
    const equipmentSlotValues = namedEnums.get('EquipmentSlotEnum') ?? ['head', 'neck', 'torso', 'back', 'arm', 'hand', 'finger', 'leg', 'foot'];
    const factionRelationValues = namedEnums.get('FactionRelationEnum') ?? ['hostile', 'neutral', 'friendly'];
    const itemEffectTypeValues = namedEnums.get('ItemEffectTypeEnum') ?? ['heal', 'damage', 'damage_nearest', 'damage_area', 'apply_status', 'identify', 'satiate'];
    const areaGeneratorTypeValues = namedEnums.get('AreaGeneratorTypeEnum') ?? ['digger', 'cellular', 'static'];
    const leverageTypeValues = namedEnums.get('LeverageTypeEnum') ?? ['money', 'ideology', 'coercion', 'ego'];

    // Prune Verb duplicates from the regex extraction
    const uniqueVerbStrings = [...new Set(verbStrings)];
    const verbFallback = ['apply', 'throw', 'kick', 'open', 'close', 'lock', 'unlock', 'dip', 'zap', 'ignite', 'read', 'eat', 'drink', 'impact'];

    // AI behavior IDs are from discriminatedUnion literals
    const aiBehaviorValues = (() => {
        const raw = extractLiteralValues(campaignTypes);
        const valid = ['hunt', 'flee', 'ranged', 'wander'];
        return raw.filter(v => valid.includes(v)).length > 0
            ? raw.filter(v => valid.includes(v))
            : valid;
    })();

    // Quest objective types come from questTypes
    const questObjectiveValues = (() => {
        const raw = extractEnumValues(questTypes);
        const valid = ['kill', 'gather', 'explore', 'interact', 'talk'];
        return raw.filter(v => valid.includes(v)).length > 0
            ? raw.filter(v => valid.includes(v))
            : valid;
    })();

    const triggerPlaceholders: string[] = [];
    const phMatch = triggerConstants.match(/['"`]\$[A-Z_]+['"`]/g);
    if (phMatch) {
        for (const m of phMatch) {
            triggerPlaceholders.push(m.replace(/['"`]/g, ''));
        }
    }

    // ─── 5. Build valid-values.json ───
    const validValues: Record<string, string[]> = {
        GameEventType: gameEventEnum,
        Verbs: uniqueVerbStrings.length > 0 ? uniqueVerbStrings : verbFallback,
        ItemCategory: itemCategoryValues,
        EquipmentSlot: equipmentSlotValues,
        FactionRelation: factionRelationValues,
        ItemEffectType: itemEffectTypeValues,
        AreaGeneratorType: areaGeneratorTypeValues,
        LeverageType: leverageTypeValues,
        QuestObjectiveType: questObjectiveValues,
        QuestRewardType: extractLiteralValues(questTypes),
        ConditionPredicateType: extractLiteralValues(triggerTypes).filter(v =>
            ['is_player', 'has_agreement', 'faction_standing', 'has_fact', 'not_has_fact', 'quest_status'].includes(v)
        ),
        ConsequenceActionType: extractLiteralValues(triggerTypes).filter(v =>
            !['is_player', 'has_agreement', 'faction_standing', 'has_fact', 'not_has_fact', 'quest_status'].includes(v)
        ),
        ZapPattern: ['beam', 'bolt', 'cone'],
        AIBehaviorId: aiBehaviorValues,
        AreaConnectionDirection: areaGeneratorTypeValues.includes('up') ? ['up', 'down', 'edge', 'portal'] : [],
        TriggerComposerPlaceholders: triggerPlaceholders,
    };
    // Remove undefined entries
    for (const key of Object.keys(validValues)) {
        if (validValues[key] === undefined) delete validValues[key];
    }

    writeFileSync(
        join(OUT_DIR, 'valid-values.json'),
        JSON.stringify(validValues, null, 2)
    );
    console.log(`  ✅ valid-values.json (${Object.values(validValues).flat().length} values)`);

    // ─── 5. Build schema-contract.md ───
    let schemaMd = '# Campaign Schema Contract\n\n';
    schemaMd += '> **Source of Truth:** [`src/types/campaign.types.ts`](src/types/campaign.types.ts),  \n';
    schemaMd += '> [`src/types/trigger.types.ts`](src/types/trigger.types.ts),  \n';
    schemaMd += '> [`src/types/quests.types.ts`](src/types/quests.types.ts),  \n';
    schemaMd += '> [`src/types/dialogue.types.ts`](src/types/dialogue.types.ts),  \n';
    schemaMd += '> [`src/types/events.types.ts`](src/types/events.types.ts)\n\n';
    schemaMd += 'Every field, type, and constraint the engine validates against. Generated automatically from Zod schemas.\n\n';
    schemaMd += '---\n\n';

    // Top-level CampaignData structure
    schemaMd += '## Top-Level CampaignData Structure\n\n';
    schemaMd += '```typescript\n';
    schemaMd += 'interface CampaignData {\n';
    const categoryKeys = extractCampaignCategoryKeys(campaignTypes);
    for (const key of categoryKeys) {
        const schemaName = key.charAt(0).toUpperCase() + key.slice(1);
        const fullSchemaName = schemaName.endsWith('s') && !schemaName.endsWith('ss')
            ? schemaName.slice(0, -1)
            : schemaName;
        schemaMd += `  ${key}: ${fullSchemaName}Definition | Record<string, ...> | ...;\n`;
    }
    schemaMd += '}\n';
    schemaMd += '```\n\n';
    schemaMd += '---\n\n';

    // Write all Zod schemas as documented blocks
    schemaMd += '## Zod Schemas (as TypeScript Interfaces)\n\n';
    schemaMd += 'Each schema block shows the inferred TypeScript interface with JSDoc descriptions.\n\n';

    for (const [schemaName, schemaSrc] of allSchemas) {
        // Skip internal schemas
        if (schemaName === 'CampaignDataSchema' || schemaName === 'CampaignCategorySchemas') continue;
        if (schemaName === 'ReactionEntityMatcherSchema' || schemaName === 'ReactionTileMatcherSchema') continue;
        if (schemaName === 'ReactionTargetMatcherSchema' || schemaName === 'ReactionContextMatcherSchema') continue;
        if (schemaName === 'ConditionPredicateSchema') continue;
        if (schemaName === 'ConsequenceActionSchema') continue;
        if (schemaName === 'DialogueOptionSchema' || schemaName === 'DialogueNodeSchema') continue;

        const jsdoc = allJSDocs.get(schemaName.replace(/Schema$/, '')) ?? '';
        const interfaceName = schemaName.replace(/Schema$/, '');
        const iname = interfaceName.toLowerCase().includes('enum')
            ? interfaceName.replace(/Enum$/, '')
            : interfaceName;

        schemaMd += `### \`${iname}\`\n\n`;
        if (jsdoc) {
            schemaMd += `${jsdoc.replace(/\*\/$/, '').replace(/^\s*\*\s?/gm, '').trim()}\n\n`;
        }
        schemaMd += '```typescript\n';
        schemaMd += schemaSrc + '\n';
        schemaMd += '```\n\n';
    }

    // Also include the discriminated unions for conditions and consequences
    schemaMd += '### ConditionPredicate (from trigger.types.ts)\n\n';
    schemaMd += 'Used in: Dialogues, Triggers\n\n';
    schemaMd += '```typescript\n';
    const condSrc = extractZodSchemas(triggerTypes).get('ConditionPredicateSchema') ?? '';
    schemaMd += condSrc + '\n';
    schemaMd += '```\n\n';

    schemaMd += '### ConsequenceAction (from trigger.types.ts)\n\n';
    schemaMd += 'Used in: Dialogues, Triggers, Reactions\n\n';
    schemaMd += '```typescript\n';
    const consSrc = extractZodSchemas(triggerTypes).get('ConsequenceActionSchema') ?? '';
    schemaMd += consSrc + '\n';
    schemaMd += '```\n\n';

    // Event types
    schemaMd += '### GameEventType (from events.types.ts)\n\n';
    schemaMd += 'Valid values for `TriggerDefinition.eventType`:\n\n';
    schemaMd += '```typescript\n';
    schemaMd += `type GameEventType = ${gameEventEnum.map(e => `'${e}'`).join(' | ')};\n`;
    schemaMd += '```\n\n';

    // Verbs
    schemaMd += '### Verb (from verbs.constants.ts)\n\n';
    schemaMd += 'Canonical interaction verbs for the ApplyIntent pipeline and Reaction system:\n\n';
    schemaMd += '```typescript\n';
    const cleanedVerbs = verbStrings.length > 0 ? verbStrings : ['apply', 'throw', 'kick', 'open', 'close', 'lock', 'unlock', 'dip', 'zap', 'ignite', 'read', 'eat', 'drink', 'impact'];
    schemaMd += `type Verb = ${cleanedVerbs.map(v => `'${v}'`).join(' | ')};\n`;
    schemaMd += '```\n\n';

    writeFileSync(join(OUT_DIR, 'schema-contract.md'), schemaMd);
    console.log('  ✅ schema-contract.md');

    // ─── 6. Build cross-reference-map.md ───
    let xrefMd = '# Campaign Data Cross-Reference Map\n\n';
    xrefMd += '> Every arrow is a place an AI can hallucinate a non-existent ID.\n';
    xrefMd += '> Generated automatically from Zod schema analysis.\n\n';
    xrefMd += '---\n\n';

    // Entity templates cross-refs
    xrefMd += '## 1. Entity Templates (`entities.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `faction` | Must be a key in `factions.json` | Any registered faction ID |\n';
    xrefMd += '| `ai.profileId` | Must be a key in `ai.json` | Any AI profile ID |\n';
    xrefMd += '| `equipmentSlots[]` | Enum `EquipmentSlot` | ' + (validValues.EquipmentSlot?.join(', ') || 'head, neck, torso, back, arm, hand, finger, leg, foot') + ' |\n';
    xrefMd += '| `tags[]` | Must be registered in `tag_registry.json` | Any registered tag |\n';
    xrefMd += '| `traits[]` | Must be a key in `trait_registry.json` | Any registered trait |\n';
    xrefMd += '| `dialogueId` | Must be a key in `dialogues.json` | Any dialogue tree ID |\n';
    xrefMd += '| `trap.triggerId` | Must be a key in `triggers.json` | Any trigger ID |\n';
    xrefMd += '| `lock.keyTag` | Should be registered in `tag_registry.json` | e.g., `"key:bronze"` |\n';
    xrefMd += '| `crCost` | Used by spawn pools and Encounter Director | Positive integer |\n';
    xrefMd += '| `roleTags[]` | Used by spawn pool `roleTags` filter | e.g., `protein`, `appetizer`, `side`, `dessert` |\n\n';

    // Items
    xrefMd += '## 2. Items (`items.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `category` | Enum `ItemCategory` | ' + (validValues.ItemCategory?.join(', ') || 'consumable, weapon, armor, tool') + ' |\n';
    xrefMd += '| `tags[]` | Must be registered in `tag_registry.json` | Any registered tag |\n';
    xrefMd += '| `consumable.effectId` | Must be a key in `effects.json` | Any effect ID |\n';
    xrefMd += '| `equippable.slot` | Enum `EquipmentSlot` | ' + (validValues.EquipmentSlot?.join(', ') || '') + ' |\n';
    xrefMd += '| `equippable.onHit.statusId` | Must be a key in `status.json` | Any status effect ID |\n';
    xrefMd += '| `throwable` | Optional block — no cross-refs out | |\n';
    xrefMd += '| `zappable.effectId` | Must be a key in `effects.json` | Any effect ID |\n';
    xrefMd += '| `zappable.pattern` | Enum | `beam`, `bolt`, `cone` |\n\n';

    // Effects
    xrefMd += '## 3. Item Effects (`effects.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `type` | Enum `ItemEffectType` | ' + (validValues.ItemEffectType?.join(', ') || 'heal, damage, damage_nearest, damage_area, apply_status, identify, satiate') + ' |\n';
    xrefMd += '| `statusId` | Must be a key in `status.json` | Required when `type: "apply_status"` |\n';
    xrefMd += '| `targetFilters.factions[]` | Enum `FactionRelation` | ' + (validValues.FactionRelation?.join(', ') || 'hostile, neutral, friendly') + ' |\n';
    xrefMd += '| `targetFilters.requireTags[]` | Must be registered in `tag_registry.json` | Any registered tag |\n';
    xrefMd += '| `targetFilters.excludeTags[]` | Must be registered in `tag_registry.json` | Any registered tag |\n\n';

    // Status Effects
    xrefMd += '## 4. Status Effects (`status.json`)\n\n';
    xrefMd += 'Standalone (no cross-refs out). Referenced BY:\n';
    xrefMd += '- `items.json` (onHit.statusId, coating.statusId)\n';
    xrefMd += '- `effects.json` (apply_status.statusId)\n';
    xrefMd += '- `fields.json` (statusEffectId)\n';
    xrefMd += '- Trigger consequences (`apply_status.statusId`)\n\n';

    // Tiles
    xrefMd += '## 5. Tiles (`tiles.json`)\n\n';
    xrefMd += 'Standalone. Referenced BY:\n';
    xrefMd += '- `areas.json` (staticMap.legend values, proceduralPalette)\n';
    xrefMd += '- `rules.json` (indirectly through map config)\n\n';

    // Factions
    xrefMd += '## 6. Factions (`factions.json`)\n\n';
    xrefMd += 'A 2D matrix: every row key must also be a column key. Each cell is `hostile`, `neutral`, or `friendly`.\n\n';
    xrefMd += 'Referenced BY:\n';
    xrefMd += '- `entities.json` (faction field)\n';
    xrefMd += '- `effects.json` (targetFilters.factions)\n';
    xrefMd += '- Trigger conditions (`faction_standing.target`)\n';
    xrefMd += '- Dialogue conditions\n';
    xrefMd += '- Reaction contextMatcher\n\n';

    // AI Profiles
    xrefMd += '## 7. AI Profiles (`ai.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `behaviors[].behaviorId` | Enum | ' + (validValues.AIBehaviorId?.join(', ') || 'hunt, flee, ranged, wander') + ' |\n';
    xrefMd += '| `behaviors[].spellId` | Must be a key in `effects.json` | Required when `behaviorId: "ranged"` |\n';
    xrefMd += '| `behaviors[].hpThreshold` | Number 0-1 | Used by `flee` behavior |\n\n';

    // Areas
    xrefMd += '## 8. Areas (`areas.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `generatorType` | Enum `AreaGeneratorType` | ' + (validValues.AreaGeneratorType?.join(', ') || 'digger, cellular, static') + ' |\n';
    xrefMd += '| `tags[]` | Must be registered in `tag_registry.json` | Area-level tags |\n';
    xrefMd += '| `connections[].targetAreaId` | Must be a key in `areas.json` | Graph must be connected |\n';
    xrefMd += '| `staticMap.legend` values | Must be keys in `tiles.json` | Tile IDs |\n';
    xrefMd += '| `staticMap.entityLegend` values | Must be keys in `entities.json` | Entity template IDs |\n';
    xrefMd += '| `placedEntities[].templateId` | Must be keys in `entities.json` | Entity template IDs |\n';
    xrefMd += '| `proceduralPalette.{floor,wall,water}` | Must be keys in `tiles.json` | Tile IDs |\n';
    xrefMd += '| `proceduralPalette.door` | Must be a key in `entities.json` | Door entity ID |\n';
    xrefMd += '| `encounterProfileId` | Must be a key in `encounter_profiles.json` | Profile ID |\n';
    xrefMd += '| `subBiomes` keys | Must be registered in `tag_registry.json` (category: biome) | e.g., `spider_nest`, `flooded` |\n';
    xrefMd += '| `crBudget` | Used by Encounter Director | Positive integer |\n\n';

    // Dialogues
    xrefMd += '## 9. Dialogues (`dialogues.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `options[].conditions[]` | Same as `ConditionPredicate` — references quests, factions, facts |\n';
    xrefMd += '| `options[].consequences[]` | Same as `ConsequenceAction` — references entities, items, effects, areas, quests |\n';
    xrefMd += '| `options[].nextNodeId` | Must be a key in the same dialogue tree\'s `nodes` |\n\n';

    // Triggers
    xrefMd += '## 10. Triggers (`triggers.json` and `trigger_templates.json`)\n\n';
    xrefMd += '| Field | Cross-References | Valid Values |\n';
    xrefMd += '|-------|-----------------|--------------|\n';
    xrefMd += '| `eventType` | Enum `GameEventType` | ' + (validValues.GameEventType?.join(', ') || 'see valid-values.json') + ' |\n';
    xrefMd += '| `conditions[]` | Same as `ConditionPredicate` | |\n';
    xrefMd += '| `consequences[]` | Same as `ConsequenceAction` | |\n';
    xrefMd += '\n**Trigger Templates / Composer**:\n';
    xrefMd += 'When generating `trigger_templates.json`, you can use the following placeholders in conditions and consequences for late-binding:\n';
    xrefMd += '`' + triggerPlaceholders.join('`, `') + '`\n\n';

    // Quests
    xrefMd += '## 11. Quests (`quests.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `objectives[].targetId` | Depends on type: `entities.json` (kill/talk), `items.json` (gather), `areas.json` (explore) |\n';
    xrefMd += '| `rewards[].itemId` | Must be a key in `items.json` (when type: "item") |\n';
    xrefMd += '| `rewards[].factionId` | Must be a key in `factions.json` (when type: "standing") |\n\n';

    // Reactions
    xrefMd += '## 12. Reactions (`reactions.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `verb` | Literal string — see `Verb` type |\n';
    xrefMd += '| `sourceMatcher.tags[]` | Must be registered in `tag_registry.json` |\n';
    xrefMd += '| `sourceMatcher.traits[]` | Must be keys in `trait_registry.json` |\n';
    xrefMd += '| `sourceMatcher.categories[]` | Must be valid `ItemCategory` |\n';
    xrefMd += '| `sourceMatcher.entityId` | Must be a key in `entities.json` |\n';
    xrefMd += '| `targetMatcher.tags[]` | Must be registered in `tag_registry.json` |\n';
    xrefMd += '| `targetMatcher.tileId` | Must be a key in `tiles.json` |\n';
    xrefMd += '| `targetMatcher.fieldTypes[]` | Must be keys in `fields.json` |\n';
    xrefMd += '| `contextMatcher.factionStanding.factionId` | Must be a key in `factions.json` |\n';
    xrefMd += '| `consequences[]` | Same as `ConsequenceAction` |\n';
    xrefMd += '| `toolMatcher` (in dip reactions) | Same structure as sourceMatcher |\n\n';

    // Spawn Pools
    xrefMd += '## 13. Spawn Pools (`spawn_pools.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `conditions.areaTags[]` | Must be registered in `tag_registry.json` |\n';
    xrefMd += '| `conditions.biomeTags[]` | Must be registered in `tag_registry.json` (category: biome) |\n';
    xrefMd += '| `conditions.factionTags[]` | Must be keys in `factions.json` |\n';
    xrefMd += '| `conditions.roleTags[]` | Must match entity `roleTags` values |\n';
    xrefMd += '| `entities` keys | Must be keys in `entities.json` |\n\n';

    // Encounter Profiles
    xrefMd += '## 14. Encounter Profiles (`encounter_profiles.json`)\n\n';
    xrefMd += 'Standalone (no cross-refs out), but **`budgetAllocation.{protein, appetizer, side, dessert}` MUST sum to exactly 1.0**.\n\n';

    // Trait Registry
    xrefMd += '## 15. Trait Registry (`trait_registry.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `tagsAdded[]` | Should also exist in `tag_registry.json` |\n\n';

    // Tag Registry
    xrefMd += '## 16. Tag Registry (`tag_registry.json`)\n\n';
    xrefMd += 'The central namespace. **Every tag used in any other file MUST be registered here.**\n';
    xrefMd += 'Categories: `item`, `entity`, `terrain`, `physical`, `elemental`, `field`, `biome`, `trait`, etc.\n\n';

    // 17. Fields
    xrefMd += '## 17. Fields (`fields.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `statusEffectId` | Must be a key in `status.json` |\n\n';

    // 18. Villain Archetypes
    xrefMd += '## 18. Villain Archetypes (`villains.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `factionId` | Must be a key in `factions.json` |\n';
    xrefMd += '| `identityGenerationTable` | Must be a key in `identity_generation.json` |\n';
    xrefMd += '| `personalityGenerationTable` | Must be a key in `personality_generation.json` |\n\n';

    // 19. Schemes
    xrefMd += '## 19. Schemes (`scheme_recipes.json` / `schemes.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `villainArchetypeId` | Must be a key in `villains.json` |\n\n';

    // 19b. Phase Blocks
    xrefMd += '## 19b. Phase Blocks (`phase_blocks.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `mutations[].targetAreaId` | Must be a key in `areas.json` |\n\n';

    // 20. Agreements
    xrefMd += '## 20. Agreements (`agreements.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `targetArchetype` | Must be a key in `entities.json` or role tags |\n\n';

    // 21. Quest Templates
    xrefMd += '## 21. Quest Templates (`quest_templates.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `baseTemplate` | Same as `QuestSchema` structure |\n\n';

    // 22. Identity Generation
    xrefMd += '## 22. Identity Generation (`identity_generation.json`)\n\n';
    xrefMd += 'Standalone generation tables for names and titles.\n\n';

    // 23. Personality Generation
    xrefMd += '## 23. Personality Generation (`personality_generation.json`)\n\n';
    xrefMd += 'Standalone generation tables for MICE leverage and facets.\n\n';

    // 24. Nemesis Hierarchies
    xrefMd += '## 24. Nemesis Hierarchies (`nemesis_hierarchies.json`)\n\n';
    xrefMd += '| Field | Cross-References |\n';
    xrefMd += '|-------|-----------------|\n';
    xrefMd += '| `factionId` | Must be a key in `factions.json` |\n\n';

    // 25. Knowledge Propagation
    xrefMd += '## 25. Knowledge Propagation (`knowledge_propagation.json`)\n\n';
    xrefMd += 'Standalone rules array for knowledge spreading.\n\n';

    // 26. Rumor Propagation
    xrefMd += '## 26. Rumor Propagation (`rumor_propagation.json`)\n\n';
    xrefMd += 'Standalone rules array for rumors.\n\n';

    // 27. Relationship Thresholds
    xrefMd += '## 27. Relationship Thresholds (`relationship_thresholds.json`)\n\n';
    xrefMd += 'Standalone thresholds for axes like fear, loyalty, etc.\n\n';

    // --- Heuristic Synchronization Check ---
    const expectedXrefFiles = categoryKeys
        .filter(k => k !== 'triggerBuckets') // Runtime generated
        .map(k => k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`) + '.json');
        
    const missingDocs = expectedXrefFiles.filter(file => !xrefMd.includes(`\`${file}\``));
    
    // Ignore meta files that don't need cross references
    const ignorableDocs = ['manifest.json', 'rules.json', 'theme.json', 'advancement.json'];
    const trulyMissing = missingDocs.filter(f => !ignorableDocs.includes(f));

    if (trulyMissing.length > 0) {
        console.error(`\n❌ SYNCHRONIZATION ERROR: The following CampaignData files are undocumented in the AI Prompt Kit cross-reference map:\n  ${trulyMissing.join(', ')}`);
        console.error('Please update scripts/generate-ai-prompt-kit.ts to include them as headers in the xrefMd generator.');
        process.exit(1);
    }

    writeFileSync(join(OUT_DIR, 'cross-reference-map.md'), xrefMd);
    console.log('  ✅ cross-reference-map.md');

    // ─── 7. Build generation-rules.md ───
    let rulesMd = '# Campaign Generation Rules\n\n';
    rulesMd += '## Ordering: Generate Files in Dependency Order\n\n';
    rulesMd += '```\n';
    rulesMd += 'Phase 0 (no dependencies):\n';
    rulesMd += '  manifest.json, theme.json, advancement.json\n';
    rulesMd += '  tiles.json, factions.json, status.json\n';
    rulesMd += '  tag_registry.json, fields.json\n';
    rulesMd += '  trait_registry.json, encounter_profiles.json\n';
    rulesMd += '  rules.json (depends on tiles for palette indirectly)\n\n';
    rulesMd += 'Phase 1 (depends on Phase 0):\n';
    rulesMd += '  effects.json (depends on status.json)\n';
    rulesMd += '  ai.json\n';
    rulesMd += '  entities.json (depends on factions, ai, tag_registry, trait_registry, dialogues)\n\n';
    rulesMd += 'Phase 2 (depends on Phase 0+1):\n';
    rulesMd += '  items.json (depends on effects, status, tag_registry)\n';
    rulesMd += '  areas.json (depends on tiles, entities, encounter_profiles, tag_registry)\n';
    rulesMd += '  scheme_recipes.json, phase_blocks.json, villains.json, agreements.json (depends on entities, factions)\n';
    rulesMd += '  spawn_pools.json (depends on entities, tag_registry, factions)\n\n';
    rulesMd += 'Phase 3 (depends on everything above):\n';
    rulesMd += '  dialogues.json (depends on conditions/consequences, quests, factions, entities)\n';
    rulesMd += '  quests.json (depends on entities, items, areas)\n';
    rulesMd += '  triggers.json (depends on conditions/consequences, entities, areas, quests)\n';
    rulesMd += '  reactions.json (depends on entities, items, tiles, tag_registry, trait_registry, fields)\n';
    rulesMd += '  trigger_templates.json (depends on triggers)\n\n';
    rulesMd += 'Phase 4 (depends on everything above):\n';
    rulesMd += '  identity_generation.json, personality_generation.json, nemesis_hierarchies.json\n';
    rulesMd += '  knowledge_propagation.json, rumor_propagation.json, relationship_thresholds.json\n';
    rulesMd += '```\n\n';

    rulesMd += '## Critical Constraints\n\n';
    rulesMd += '1. **budgetAllocation must sum to 1.0**: `protein + appetizer + side + dessert === 1.0`\n\n';
    rulesMd += '2. **Faction matrix must be complete**: Every faction ID must appear as both a row AND column key. If A→B is "hostile", B→A must also exist.\n\n';
    rulesMd += '3. **Areas must form a connected graph**: The starting area must be reachable from all other areas through connection links.\n\n';
    rulesMd += '4. **Trigger eventType must be valid**: Only 19 valid `GameEventType` values are accepted.\n\n';
    rulesMd += '5. **Every tag must be registered**: Any tag used in entities, items, reactions, spawn pools, areas, or any other file must have an entry in `tag_registry.json`.\n\n';
    rulesMd += '6. **Every cross-reference must resolve**: If an entity references `faction: "goblins"`, then `"goblins"` must exist as a key in `factions.json`.\n\n';
    rulesMd += '7. **Dialogue tree nodes must be internally consistent**: `nextNodeId` values must point to existing node IDs within the same tree.\n\n';
    rulesMd += '8. **Quest objective targetId must match type**: `kill` → entity ID, `gather` → item ID, `explore` → area ID.\n\n';
    rulesMd += '9. **Trigger Templates**: `trigger_templates.json` files can use placeholder strings. These are valid strings during generation, even for numeric properties (which will be automatically unquoted by the engine at runtime): `' + triggerPlaceholders.join('`, `') + '`.\n\n';

    rulesMd += '## Common Pitfalls\n\n';
    rulesMd += '| Pitfall | Example | Resolution |\n';
    rulesMd += '|---------|---------|------------|\n';
    rulesMd += '| Unregistered tag | `"undead"` used in reaction but not in `tag_registry.json` | Add `"undead"` to `tag_registry.json` |\n';
    rulesMd += '| Missing faction entry | Entity has `faction: "goblin_tribe"` but no such key in `factions.json` | Add the faction to `factions.json` |\n';
    rulesMd += '| Broken area connection | Area `"dungeon_5"` connects to `"dungeon_6"` but that area doesn\'t exist | Remove or fix the connection |\n';
    rulesMd += '| Invalid event type | Trigger uses eventType `"FullMoon"` which isn\'t a `GameEventType` | Use a valid event type |\n';
    rulesMd += '| Budget math error | Encounter profile `budgetAllocation` doesn\'t sum to 1.0 | Adjust values to sum exactly to 1.0 |\n';
    rulesMd += '| Orphaned quest target | Quest objective type `kill` references entity `"dragon"` but no such entity template exists | Create the entity or fix the targetId |\n';
    rulesMd += '| Missing dialogue node | Dialogue option `nextNodeId` points to `"node_5"` but no node with that ID exists | Fix the reference or create the node |\n';
    rulesMd += '| Incomplete faction matrix | Faction `"beast"` only has a row but no columns | Add all columns for completeness |\n\n';

    writeFileSync(join(OUT_DIR, 'generation-rules.md'), rulesMd);
    console.log('  ✅ generation-rules.md');

    // ─── 8. Copy default campaign ───
    const defaultOut = join(OUT_DIR, 'default-campaign');
    try {
        // Read and write each file individually (more portable than cpSync -r)
        const defaultFiles = categoryKeys
            .filter(k => k !== 'triggerBuckets')
            .map(k => k.replace(/[A-Z]/g, l => `_${l.toLowerCase()}`) + '.json');
        defaultFiles.push('keybinds.json'); // Editor specific

        mkdirSync(defaultOut, { recursive: true });
        for (const file of defaultFiles) {
            const src = join(DEFAULT_CAMPAIGN, file);
            const dest = join(defaultOut, file);
            try {
                const content = readFileSync(src);
                writeFileSync(dest, content);
            } catch {
                // File may not exist
            }
        }
        console.log('  ✅ default-campaign/ (reference)');
    } catch (err) {
        console.warn('  ⚠ Could not copy default campaign:', err);
    }

    // ─── 9. Write a README ───
    let readme = '# AI Prompt Kit\n\n';
    readme += 'This directory contains everything an LLM needs to generate a valid campaign JSON for this engine.\n\n';
    readme += '## Contents\n\n';
    readme += '| File | Purpose |\n';
    readme += '|------|---------|\n';
    readme += '| [`schema-contract.md`](./schema-contract.md) | Complete Zod schemas as documented TypeScript interfaces — every field, type, and constraint |\n';
    readme += '| [`cross-reference-map.md`](./cross-reference-map.md) | Field-by-field cross-reference table showing which files reference which registries |\n';
    readme += '| [`valid-values.json`](./valid-values.json) | All enum values, literal unions, and valid string constants |\n';
    readme += '| [`generation-rules.md`](./generation-rules.md) | Generation ordering, constraints, and common pitfalls |\n';
    readme += '| [`default-campaign/`](./default-campaign/) | The complete default campaign as an annotated reference implementation |\n\n';
    readme += '## How to Use\n\n';
    readme += '1. Read `schema-contract.md` first — it\'s the complete type contract.\n';
    readme += '2. Read `cross-reference-map.md` — understand every link between files.\n';
    readme += '3. Read `generation-rules.md` — know the ordering and constraints.\n';
    readme += '4. Examine `default-campaign/` — study how the default implements each concept.\n';
    readme += '5. Generate your campaign files in the dependency order specified in `generation-rules.md`.\n';
    readme += '6. Validate with the script: `bun scripts/run-validator.ts --campaign-dir ./my-campaign`.\n';
    readme += '7. Fix any errors reported by the validator and repeat until clean.\n';

    writeFileSync(join(OUT_DIR, 'README.md'), readme);
    console.log('  ✅ README.md');

    console.log(`\n📦 Prompt Kit generated at: ${OUT_DIR}`);
    console.log('\nNext steps:');
    console.log('  Feed these files to an LLM along with your campaign theme.');
    console.log('  The LLM generates all JSON files → validate → fix loop.');
}

main();
