import {
  DEFAULT_LEGENDS_HISTORY_YEARS,
  DEFAULT_MACRO_SITE_COUNT,
  DEFAULT_MACRO_TICK_INTERVAL_TURNS,
  DEFAULT_MACRO_WORLD_HEIGHT,
  DEFAULT_MACRO_WORLD_WIDTH,
  LEGENDS_ARTIFACT_FORGE_CHANCE,
  LEGENDS_CONFLICT_CHANCE,
  LEGENDS_DEFENDER_CLASH_CHANCE,
  LEGENDS_DEFENDER_SLAIN_CHANCE,
  LEGENDS_ELDER_AGE_YEARS,
  LEGENDS_ELDER_DEATH_CHANCE,
  LEGENDS_FIGURE_SPAWN_CHANCE,
  LEGENDS_LEDGER_CAP,
  LEGENDS_PIS_BASE,
  LEGENDS_PIS_PER_KILL,
  LEGENDS_PIS_PER_SCAR,
  LEGENDS_PROGRESS_YIELD_YEARS,
  LEGENDS_RIVALRY_CHANCE,
  LEGENDS_SITE_DESTROY_CHANCE,
  LEGENDS_SITE_STRIKE_CHANCE,
  MACRO_SEASONS,
  MAX_MACRO_EVENT_ARCHIVE,
  MAX_SEEDED_LIVING_LEGENDS,
  MAX_WORLD_ARTIFACTS,
  MAX_WORLD_HISTORICAL_FIGURES,
  MIN_SITE_PROSPERITY,
  YEARS_PER_LEGENDS_ERA
} from '../../constants/macro_world.constants.ts';
import { generateContinentalMacroWorld } from '../../map/worldgen_continent.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import {
  ComponentType,
  type ChronicleComponent,
  type FactionComponent,
  type FighterComponent,
  type IdentityComponent,
  type MemoryComponent,
  type NemesisComponent,
  type TagsComponent,
  type TemplateComponent
} from '../../types/components.types.ts';
import { GameEventType, type WorldEventFiredEvent } from '../../types/events.types.ts';
import type { EntityId, GameState, PersistentEntityRecord } from '../../types/game-state.types.ts';
import type {
  HistoricalArtifactRecord,
  HistoricalFigureRecord,
  LegendsEraRecord,
  LegendsEventRecord,
  LegendsWorldgenInput,
  MacroSiteRecord,
  MacroWorldState
} from '../../types/macro_world.types.ts';
import type { WorkerProgressPayload } from '../../worker/worker.types.ts';
import { buildMacroSimContext, createMacroRng } from './macro_world.system.ts';

const ARTIFACT_PREFIXES = [
  'Sunforged',
  'Ashborn',
  'Ironbound',
  'Starlit',
  'Stormcarved',
  'Oathkeeper',
  'Frostveil',
  'Dawnwarden'
];
const ARTIFACT_NOUNS = ['Blade', 'Crown', 'Signet', 'Chalice', 'Aegis', 'Scepter', 'Reliquary', 'Diadem'];
const DEFAULT_FIRST_NAMES = [
  'Alden',
  'Brenna',
  'Corin',
  'Daria',
  'Edric',
  'Fiora',
  'Garrick',
  'Helena',
  'Ivor',
  'Kael',
  'Lyra',
  'Merek'
];
const DEFAULT_TITLES = [
  'the Bold',
  'the Scarred',
  'of the Watch',
  'the Builder',
  'the Exile',
  'Ironhand',
  'Ashwalker',
  'the Just'
];
const DYNASTY_NAMES = ['Stonehelm', 'Ashford', 'Ironcrest', 'Ravenspire', 'Goldbranch', 'Duskwatch'];

function pickItem<T>(arr: ReadonlyArray<T>, rngFn: () => number, fallback: T): T {
  if (arr.length === 0) return fallback;
  return arr[Math.floor(rngFn() * arr.length) % arr.length] ?? fallback;
}

function resolveEraTitle(
  eraIndex: number,
  conflictCount: number,
  totalCount: number
): { readonly name: string; readonly theme: string } {
  if (eraIndex === 0) {
    return { name: 'Age of Founding', theme: 'settlement' };
  }
  const ratio = totalCount > 0 ? conflictCount / totalCount : 0;
  if (ratio >= 0.45) {
    return { name: `Age of Ash (${eraIndex + 1})`, theme: 'warfare' };
  }
  if (ratio >= 0.25) {
    return { name: `Age of Strife (${eraIndex + 1})`, theme: 'rivalry' };
  }
  return { name: `Age of Renewal (${eraIndex + 1})`, theme: 'prosperity' };
}

/**
 * Builds deterministic {@link LegendsWorldgenInput} directly from a campaign's `rules.macroWorld`
 * and faction/identity registries.
 *
 * @param campaign Loaded CampaignData document.
 * @param seedFallback Seed supplied by `initRNG()` when `rules.macroWorld.worldSeed` is unset.
 * @returns Pure serializable input for `simulateWorldLegendsAsync` / `legends_worldgen.worker.ts`.
 */
export function buildLegendsInputFromCampaign(
  campaign: Readonly<CampaignData>,
  seedFallback: number
): LegendsWorldgenInput {
  const cfg = campaign.rules.macroWorld;
  const areaSiteBindings: Record<string, string> = { ...(cfg?.areaSiteBindings ?? {}) };
  for (const [areaId, areaDef] of Object.entries(campaign.areas)) {
    if (areaDef.macroSiteId && !areaSiteBindings[areaId]) {
      areaSiteBindings[areaId] = areaDef.macroSiteId;
    }
  }

  return {
    worldSeed: cfg?.worldSeed ?? seedFallback,
    worldName: campaign.manifest.name,
    width: cfg?.worldWidth ?? DEFAULT_MACRO_WORLD_WIDTH,
    height: cfg?.worldHeight ?? DEFAULT_MACRO_WORLD_HEIGHT,
    historyYears: cfg?.historyYears ?? DEFAULT_LEGENDS_HISTORY_YEARS,
    siteCount: cfg?.siteCount ?? DEFAULT_MACRO_SITE_COUNT,
    tickIntervalTurns: cfg?.macroTickIntervalTurns ?? DEFAULT_MACRO_TICK_INTERVAL_TURNS,
    enableWeatherFronts: cfg?.enableWeatherFronts ?? true,
    areaSiteBindings,
    context: buildMacroSimContext(campaign)
  };
}

/**
 * Cooperative generator synthesizing a continent and simulating `input.historyYears` of multi-century
 * history (dynasties, wars, sieges, ruins, duels, scars, and forged artifacts), yielding
 * {@link WorkerProgressPayload} updates per decade for non-blocking UI rendering.
 *
 * @param input Pure serializable continent and history simulation parameters.
 * @returns Completed initial {@link MacroWorldState} carrying `LegendsArchive` for Turn 1.
 */
export function* simulateWorldLegendsAsync(
  input: LegendsWorldgenInput
): Generator<WorkerProgressPayload, MacroWorldState, void> {
  const rngFn = createMacroRng(input.worldSeed, 99173);
  const baseMacro = generateContinentalMacroWorld(input);
  const sites: Record<string, MacroSiteRecord> = { ...baseMacro.sites };
  const figures: Record<string, HistoricalFigureRecord> = {};
  const artifacts: Record<string, HistoricalArtifactRecord> = {};
  const events: LegendsEventRecord[] = [];
  const eras: LegendsEraRecord[] = [];

  const firstNames = input.context.nameFirstPool.length > 0 ? input.context.nameFirstPool : DEFAULT_FIRST_NAMES;
  const titles = input.context.nameTitlePool.length > 0 ? input.context.nameTitlePool : DEFAULT_TITLES;
  const siteIds = Object.keys(sites);
  const factions = input.context.factions.length > 0 ? input.context.factions : ['town'];

  let nextFigureSeq = 1;
  let nextArtifactSeq = 1;
  let nextEventSeq = 1;

  const pushEvent = (evt: Omit<LegendsEventRecord, 'id'>): LegendsEventRecord => {
    const id = `legend_evt_${nextEventSeq++}`;
    const full: LegendsEventRecord = { id, ...evt };
    events.push(full);
    for (const fid of full.figureIds) {
      const fig = figures[fid];
      if (fig) {
        figures[fid] = { ...fig, eventIds: [...fig.eventIds, id] };
      }
    }
    return full;
  };

  // Seed initial Era and founding rulers
  const totalYears = Math.max(10, input.historyYears);
  let currentEraIndex = 0;
  let currentEraId = 'era_1';
  let eraStartYear = 1;
  let eraConflictCount = 0;
  let eraTotalCount = 0;

  pushEvent({
    year: 1,
    season: 'spring',
    eraId: currentEraId,
    kind: 'era_started',
    importance: 'epic',
    summary: `Dawn of the Age of Founding across ${input.worldName}.`,
    figureIds: []
  });

  for (let i = 0; i < siteIds.length; i++) {
    const site = sites[siteIds[i]!]!;
    const figId = `fig_${nextFigureSeq++}`;
    const figName = `${pickItem(firstNames, rngFn, 'Alden')} ${DYNASTY_NAMES[i % DYNASTY_NAMES.length]!}`;
    figures[figId] = {
      id: figId,
      name: figName,
      epithet: pickItem(titles, rngFn, 'the Founder'),
      factionId: site.factionId,
      dynastyId: `dynasty_${(i % DYNASTY_NAMES.length) + 1}`,
      role: i === 0 ? 'ruler' : site.archetype === 'fortress' ? 'commander' : 'champion',
      birthYear: 1,
      isAlive: true,
      kills: 0,
      scars: [],
      homeSiteId: site.id,
      currentSiteId: site.id,
      rivalFigureIds: [],
      eventIds: []
    };
    sites[site.id] = {
      ...site,
      residentFigureIds: [figId]
    };
    pushEvent({
      year: 1,
      season: 'spring',
      eraId: currentEraId,
      kind: 'site_founded',
      importance: site.isCapital ? 'major' : 'minor',
      summary: `${figName} founded ${site.name} under the banner of ${site.factionId}.`,
      siteId: site.id,
      factionId: site.factionId,
      figureIds: [figId]
    });
  }

  for (let year = 2; year <= totalYears; year++) {
    const season = MACRO_SEASONS[(year - 1) % MACRO_SEASONS.length] ?? 'spring';

    // Close completed era every YEARS_PER_LEGENDS_ERA years
    if (year - eraStartYear >= YEARS_PER_LEGENDS_ERA) {
      const resolved = resolveEraTitle(currentEraIndex, eraConflictCount, eraTotalCount);
      eras.push({
        id: currentEraId,
        name: resolved.name,
        startYear: eraStartYear,
        endYear: year - 1,
        theme: resolved.theme,
        summary: `${resolved.name} spanned years ${eraStartYear}–${year - 1} (${eraConflictCount} major conflicts).`
      });
      currentEraIndex += 1;
      currentEraId = `era_${currentEraIndex + 1}`;
      eraStartYear = year;
      eraConflictCount = 0;
      eraTotalCount = 0;
      pushEvent({
        year,
        season: 'spring',
        eraId: currentEraId,
        kind: 'era_started',
        importance: 'epic',
        summary: `Year ${year} ushered in a new historical age.`,
        figureIds: []
      });
    }

    // Replenish figure roster up to cap
    const livingFigs = Object.values(figures).filter((f) => f.isAlive);
    if (
      livingFigs.length < Math.min(siteIds.length + 4, MAX_WORLD_HISTORICAL_FIGURES) &&
      rngFn() < LEGENDS_FIGURE_SPAWN_CHANCE
    ) {
      const home = sites[pickItem(siteIds, rngFn, siteIds[0]!)]!;
      const figId = `fig_${nextFigureSeq++}`;
      const roles: ReadonlyArray<HistoricalFigureRecord['role']> = [
        'champion',
        'commander',
        'artisan',
        'raider',
        'chronicler'
      ];
      const role = pickItem(roles, rngFn, 'champion');
      const name = `${pickItem(firstNames, rngFn, 'Corin')} ${DYNASTY_NAMES[Math.floor(rngFn() * DYNASTY_NAMES.length) % DYNASTY_NAMES.length]!}`;
      figures[figId] = {
        id: figId,
        name,
        epithet: pickItem(titles, rngFn, 'the Bold'),
        factionId: home.factionId,
        dynastyId: `dynasty_${(nextFigureSeq % DYNASTY_NAMES.length) + 1}`,
        role,
        birthYear: Math.max(1, year - 18),
        isAlive: true,
        kills: 0,
        scars: [],
        homeSiteId: home.id,
        currentSiteId: home.id,
        rivalFigureIds: [],
        eventIds: []
      };
      sites[home.id] = {
        ...home,
        residentFigureIds: [...home.residentFigureIds, figId]
      };
      eraTotalCount += 1;
    }

    // Age & natural passing of elders
    for (const fig of livingFigs) {
      if (year - fig.birthYear >= LEGENDS_ELDER_AGE_YEARS && rngFn() < LEGENDS_ELDER_DEATH_CHANCE) {
        figures[fig.id] = {
          ...fig,
          isAlive: false,
          deathYear: year
        };
      }
    }

    // Yearly artifact forging
    if (Object.keys(artifacts).length < MAX_WORLD_ARTIFACTS && rngFn() < LEGENDS_ARTIFACT_FORGE_CHANCE) {
      const candidates = Object.values(figures).filter((f) => f.isAlive);
      const maker = candidates.find((f) => f.role === 'artisan') ?? candidates[Math.floor(rngFn() * candidates.length)];
      if (maker) {
        const aid = `artifact_${nextArtifactSeq++}`;
        const aName = `${pickItem(ARTIFACT_PREFIXES, rngFn, 'Sunforged')} ${pickItem(ARTIFACT_NOUNS, rngFn, 'Blade')}`;
        artifacts[aid] = {
          id: aid,
          name: aName,
          creatorFigureId: maker.id,
          forgedYear: year,
          currentSiteId: maker.currentSiteId,
          ownerHistoryFigureIds: [maker.id],
          description: `Forged in Year ${year} by ${maker.name} at ${sites[maker.currentSiteId]?.name ?? 'an ancient forge'}.`
        };
        const site = sites[maker.currentSiteId];
        if (site) {
          sites[site.id] = { ...site, artifactIds: [...site.artifactIds, aid] };
        }
        pushEvent({
          year,
          season,
          eraId: currentEraId,
          kind: 'artifact_forged',
          importance: 'epic',
          summary: `${maker.name} forged the legendary relic ${aName}!`,
          siteId: maker.currentSiteId,
          factionId: maker.factionId,
          figureIds: [maker.id],
          artifactId: aid
        });
        eraTotalCount += 1;
      }
    }

    // Yearly conflict, duels, scars, and site raids / ruinations
    if (rngFn() < LEGENDS_CONFLICT_CHANCE && siteIds.length >= 2) {
      const targetSite = sites[pickItem(siteIds, rngFn, siteIds[0]!)]!;
      const attackers = input.context.raiderFactionIds.length > 0 ? input.context.raiderFactionIds : factions;
      const attackerFaction = pickItem(attackers, rngFn, 'bandits');
      const defenders = Object.values(figures).filter((f) => f.isAlive && f.currentSiteId === targetSite.id);
      const defender = defenders[0];
      const scar = pickItem(input.context.scarPool, rngFn, 'battle_scar');

      if (defender && rngFn() < LEGENDS_DEFENDER_CLASH_CHANCE) {
        if (rngFn() < LEGENDS_DEFENDER_SLAIN_CHANCE) {
          figures[defender.id] = {
            ...defender,
            isAlive: false,
            deathYear: year
          };
          pushEvent({
            year,
            season,
            eraId: currentEraId,
            kind: 'figure_slain',
            importance: 'major',
            summary: `${defender.name} fell defending ${targetSite.name} against ${attackerFaction} in Year ${year}.`,
            siteId: targetSite.id,
            factionId: attackerFaction,
            secondaryFactionId: defender.factionId,
            figureIds: [defender.id]
          });
        } else {
          const nextScars = defender.scars.includes(scar) ? defender.scars : [...defender.scars, scar];
          const attackerLeader = Object.values(figures).find(
            (f) => f.isAlive && f.id !== defender.id && f.factionId === attackerFaction
          );
          const defenderRivals =
            attackerLeader && rngFn() < LEGENDS_RIVALRY_CHANCE && !defender.rivalFigureIds.includes(attackerLeader.id)
              ? [...defender.rivalFigureIds, attackerLeader.id]
              : defender.rivalFigureIds;
          figures[defender.id] = {
            ...defender,
            kills: defender.kills + 1,
            scars: nextScars,
            rivalFigureIds: defenderRivals
          };
          if (
            attackerLeader &&
            defenderRivals !== defender.rivalFigureIds &&
            !attackerLeader.rivalFigureIds.includes(defender.id)
          ) {
            figures[attackerLeader.id] = {
              ...attackerLeader,
              rivalFigureIds: [...attackerLeader.rivalFigureIds, defender.id]
            };
          }
          pushEvent({
            year,
            season,
            eraId: currentEraId,
            kind: 'figure_scarred',
            importance: 'major',
            summary: `${defender.name} survived a clash with ${attackerFaction} at ${targetSite.name}, bearing the ${scar} scar.`,
            siteId: targetSite.id,
            factionId: defender.factionId,
            secondaryFactionId: attackerFaction,
            figureIds: attackerLeader ? [defender.id, attackerLeader.id] : [defender.id]
          });
        }
      }

      if (targetSite.status === 'intact' && rngFn() < LEGENDS_SITE_STRIKE_CHANCE) {
        const destroyed = rngFn() < LEGENDS_SITE_DESTROY_CHANCE;
        sites[targetSite.id] = {
          ...targetSite,
          status: destroyed ? 'ruined' : 'burned',
          archetype: destroyed ? 'ruin' : targetSite.archetype,
          prosperity: Math.max(MIN_SITE_PROSPERITY, targetSite.prosperity - (destroyed ? 45 : 22)),
          garrison: Math.max(4, Math.floor(targetSite.garrison * 0.4))
        };
        pushEvent({
          year,
          season,
          eraId: currentEraId,
          kind: destroyed ? 'site_ruined' : 'site_burned',
          importance: 'epic',
          summary: destroyed
            ? `${targetSite.name} fell into ancient ruin after a devastating siege by ${attackerFaction}.`
            : `${targetSite.name} was put to the torch by ${attackerFaction} in Year ${year}.`,
          siteId: targetSite.id,
          factionId: attackerFaction,
          secondaryFactionId: targetSite.factionId,
          figureIds: defender ? [defender.id] : []
        });
      }
      eraConflictCount += 1;
      eraTotalCount += 1;
    }

    if (year % LEGENDS_PROGRESS_YIELD_YEARS === 0 || year === totalYears) {
      yield {
        progress: year / totalYears,
        message: `Simulating Legends History: Year ${year} / ${totalYears}...`,
        currentTurn: year,
        maxTurns: totalYears
      };
    }
  }

  // Finalize closing Era
  const closingMeta = resolveEraTitle(currentEraIndex, eraConflictCount, eraTotalCount);
  eras.push({
    id: currentEraId,
    name: closingMeta.name,
    startYear: eraStartYear,
    endYear: totalYears,
    theme: closingMeta.theme,
    summary: `${closingMeta.name} spanned years ${eraStartYear}–${totalYears} (${eraConflictCount} major conflicts).`
  });

  // Guarantee at least 1 ruined tomb with an artifact and 1 intact site for rich Turn-1 materialization
  const finalSiteIds = Object.keys(sites);
  if (finalSiteIds.length >= 2) {
    const hasRuin = finalSiteIds.some((id) => sites[id]!.status === 'ruined' || sites[id]!.archetype === 'ruin');
    if (!hasRuin) {
      const lastSite = sites[finalSiteIds[finalSiteIds.length - 1]!]!;
      sites[lastSite.id] = {
        ...lastSite,
        status: 'ruined',
        archetype: 'ruin',
        prosperity: 10
      };
    }
    if (Object.keys(artifacts).length === 0) {
      const ruinSite =
        Object.values(sites).find((s) => s.status === 'ruined' || s.archetype === 'ruin') ?? sites[finalSiteIds[0]!]!;
      const fallbackMaker = Object.values(figures)[0]?.id ?? 'fig_1';
      artifacts['artifact_1'] = {
        id: 'artifact_1',
        name: 'Sunforged Signet',
        creatorFigureId: fallbackMaker,
        forgedYear: Math.max(1, Math.floor(totalYears / 2)),
        currentSiteId: ruinSite.id,
        ownerHistoryFigureIds: [fallbackMaker],
        description: `Ancient relic resting within ${ruinSite.name}.`
      };
      sites[ruinSite.id] = { ...ruinSite, artifactIds: [...ruinSite.artifactIds, 'artifact_1'] };
    }
  }

  return {
    ...baseMacro,
    sites,
    legends: {
      worldName: input.worldName,
      simulatedYears: totalYears,
      eras,
      figures,
      artifacts,
      events: events.slice(-MAX_MACRO_EVENT_ARCHIVE)
    }
  };
}

/**
 * Synchronous convenience wrapper executing {@link simulateWorldLegendsAsync} to completion
 * (used by headless unit tests and worker main-thread fallbacks).
 *
 * @param input Continent and history worldgen parameters.
 * @returns Completed initial {@link MacroWorldState}.
 */
export function generateLegendsWorldSync(input: LegendsWorldgenInput): MacroWorldState {
  const gen = simulateWorldLegendsAsync(input);
  let step = gen.next();
  while (!step.done) {
    step = gen.next();
  }
  return step.value;
}

/**
 * Seeds a newly started `GameState` with completed offline Legends history:
 * 1. Attaches `macroWorld` onto `GameState`.
 * 2. Seeds surviving living historical figures into `persistentEntities` (and faction nemesis slots if present)
 *    with authentic `ChronicleComponent` scars, core memories, and historical grudges.
 * 3. Appends top epic Legends events into `GameState.historicalLedger` and faction/area chronicles.
 *
 * @param state Fresh initial GameState created in `startNewGame`.
 * @param macroWorld Generated continent + Legends archive.
 * @returns Seeded GameState ready for Turn 1.
 */
export function seedGameStateFromLegends(state: GameState, macroWorld: MacroWorldState): GameState {
  let nextEntityId = state.nextEntityId;
  const nextPersistent = new Map<EntityId, PersistentEntityRecord>(state.persistentEntities);
  const nextFigures: Record<string, HistoricalFigureRecord> = { ...macroWorld.legends.figures };
  const nextNemesisSlots: Record<string, ReadonlyArray<EntityId>> = { ...state.nemesisSlots };

  // Append top high-importance Legends events into historicalLedger
  const epicLegendsEvents = macroWorld.legends.events
    .filter((evt) => evt.importance === 'epic')
    .slice(-LEGENDS_LEDGER_CAP);

  const ledgerEntries: ReadonlyArray<WorldEventFiredEvent> = epicLegendsEvents.map((evt) => ({
    id: evt.id,
    type: GameEventType.WorldEventFired,
    importance: 'high' as const,
    summary: `[Year ${evt.year}] ${evt.summary}`
  }));

  const existingLedgerIds = new Set(state.historicalLedger.map((e) => e.id));
  const mergedLedger = [...state.historicalLedger, ...ledgerEntries.filter((e) => !existingLedgerIds.has(e.id))];

  // Record era summary excerpt on faction persistent entities
  const latestEra = macroWorld.legends.eras[macroWorld.legends.eras.length - 1];
  if (latestEra && ledgerEntries.length > 0) {
    const sampleEvtId = ledgerEntries[ledgerEntries.length - 1]!.id!;
    for (const fEntId of Object.values(state.factionEntityIds)) {
      const rec = nextPersistent.get(fEntId);
      if (!rec) continue;
      const chron = rec.components[ComponentType.Chronicle] as ChronicleComponent | undefined;
      if (!chron) continue;
      if (!chron.eventExcerpts.includes(sampleEvtId)) {
        nextPersistent.set(fEntId, {
          ...rec,
          components: {
            ...rec.components,
            [ComponentType.Chronicle]: {
              ...chron,
              eventExcerpts: [...chron.eventExcerpts, sampleEvtId]
            }
          }
        });
      }
    }
  }

  // Seed surviving living legends into persistentEntities
  const livingFigures = Object.values(nextFigures)
    .filter((f) => f.isAlive)
    .slice(0, MAX_SEEDED_LIVING_LEGENDS);

  for (const fig of livingFigures) {
    const entId = nextEntityId as EntityId;
    nextEntityId += 1;
    const site = macroWorld.sites[fig.currentSiteId];
    const targetAreaId = site?.boundAreaId ?? state.currentAreaId;

    const identityComp: IdentityComponent = {
      type: ComponentType.Identity,
      name: fig.name,
      ...(fig.epithet !== undefined ? { title: fig.epithet } : {}),
      mannerisms: []
    };
    const chronicleComp: ChronicleComponent = {
      type: ComponentType.Chronicle,
      pis: LEGENDS_PIS_BASE + fig.kills * LEGENDS_PIS_PER_KILL + fig.scars.length * LEGENDS_PIS_PER_SCAR,
      scars: [...fig.scars],
      coreMemories: [`Veteran of ${macroWorld.legends.worldName} history (born Year ${fig.birthYear}).`],
      eventExcerpts: fig.eventIds.filter((eid) => epicLegendsEvents.some((e) => e.id === eid))
    };
    const memoryComp: MemoryComponent = {
      type: ComponentType.Memory,
      factionStandings: {},
      grudges: [...fig.rivalFigureIds],
      facts: [`historical_figure:${fig.id}`, `dynasty:${fig.dynastyId}`],
      knowledge: {}
    };
    const tagsComp: TagsComponent = {
      type: ComponentType.Tags,
      tags: ['historical_legend', `role:${fig.role}`, `faction:${fig.factionId}`]
    };
    const factionComp: FactionComponent = {
      type: ComponentType.Faction,
      factionId: fig.factionId
    };

    const components: Record<string, PersistentEntityRecord['components'][string]> = {
      [ComponentType.Identity]: identityComp,
      [ComponentType.Chronicle]: chronicleComp,
      [ComponentType.Memory]: memoryComp,
      [ComponentType.Tags]: tagsComp,
      [ComponentType.Faction]: factionComp
    };

    const combatTemplateEntry = Object.entries(state.campaign.entities).find(
      ([id, tpl]) =>
        id !== 'player' && tpl.isActor === true && tpl.fighter !== undefined && tpl.faction === fig.factionId
    );
    if (combatTemplateEntry) {
      const [templateId, tpl] = combatTemplateEntry;
      const tplFighter = tpl.fighter!;
      const fighterComp: FighterComponent = {
        type: ComponentType.Fighter,
        maxHp: tplFighter.maxHp,
        hp: tplFighter.maxHp,
        attack: tplFighter.attack,
        defense: tplFighter.defense,
        xp: 0,
        level: 1,
        xpGiven: tplFighter.xpGiven ?? 0
      };
      const templateComp: TemplateComponent = {
        type: ComponentType.Template,
        templateId
      };
      components[ComponentType.Fighter] = fighterComp;
      components[ComponentType.Template] = templateComp;

      // Wire combatant legends into matching faction nemesis hierarchy without occupying non-combatant slots
      const matchingHierarchy = Object.entries(state.campaign.nemesisHierarchies ?? {}).find(
        ([, h]) => h.factionId === fig.factionId
      );
      if (matchingHierarchy) {
        const [hierarchyId, hierarchy] = matchingHierarchy;
        const topRank = [...hierarchy.ranks].sort((a, b) => b.tier - a.tier)[0];
        if (topRank) {
          const slotKey = `${hierarchyId}:${topRank.rankId}`;
          const existingSlot = nextNemesisSlots[slotKey] ?? [];
          if (existingSlot.length < topRank.maxSlots) {
            nextNemesisSlots[slotKey] = [...existingSlot, entId];
            const nemComp: NemesisComponent = {
              type: ComponentType.Nemesis,
              hierarchyId,
              rankId: topRank.rankId,
              tier: topRank.tier,
              cheatedDeathCount: 0,
              lastDeathTurn: -9999
            };
            components[ComponentType.Nemesis] = nemComp;
          }
        }
      }
    }

    nextPersistent.set(entId, {
      areaId: targetAreaId,
      components
    });
    nextFigures[fig.id] = {
      ...fig,
      seededEntityId: entId
    };
  }

  return {
    ...state,
    nextEntityId,
    persistentEntities: nextPersistent,
    nemesisSlots: nextNemesisSlots,
    historicalLedger: mergedLedger,
    macroWorld: {
      ...macroWorld,
      legends: {
        ...macroWorld.legends,
        figures: nextFigures
      }
    }
  };
}
