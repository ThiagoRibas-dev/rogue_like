import type { EntityId } from './game-state.types.ts';

/** Canonical seasonal phases of the macro calendar. */
export type MacroSeason = 'spring' | 'summer' | 'autumn' | 'winter';

/** Continental cell biome classifications produced by worldgen. */
export type MacroBiomeKind =
  'ocean' | 'coast' | 'plains' | 'forest' | 'hills' | 'mountain' | 'desert' | 'tundra' | 'swamp';

/** Site architectural/functional categories on the macro map. */
export type MacroSiteArchetype = 'capital' | 'town' | 'hamlet' | 'fortress' | 'shrine' | 'ruin';

/** Macro-world lifecycle state of a settlement or landmark site. */
export type MacroSiteStatus = 'intact' | 'besieged' | 'raided' | 'burned' | 'ruined' | 'abandoned';

/** Regional meteorological condition carried by moving weather fronts. */
export type MacroWeatherKind = 'clear' | 'rain' | 'storm' | 'blizzard' | 'drought' | 'heatwave' | 'fog';

/** Kinds of deterministic Ring 2 site mutations queued for chunk/area materialization. */
export type MacroSiteDeltaKind =
  | 'site_founded'
  | 'site_prospered'
  | 'site_raided'
  | 'site_burned'
  | 'site_ruined'
  | 'site_rebuilt'
  | 'caravan_arrived'
  | 'army_camped'
  | 'artifact_relocated';

/** Event categories archived in the multi-century Legends Chronicle. */
export type LegendsEventKind =
  | 'era_started'
  | 'site_founded'
  | 'war_declared'
  | 'treaty_signed'
  | 'battle_fought'
  | 'site_raided'
  | 'site_burned'
  | 'site_ruined'
  | 'figure_born'
  | 'figure_ascended'
  | 'figure_slain'
  | 'figure_scarred'
  | 'artifact_forged'
  | 'caravan_completed'
  | 'caravan_ambushed';

/** Single cell of the coarse continental macro map. */
export interface MacroContinentCell {
  readonly x: number;
  readonly y: number;
  readonly elevation: number;
  readonly rainfall: number;
  readonly baseTempC: number;
  readonly biome: MacroBiomeKind;
  readonly hasRiver: boolean;
  readonly hasRoad: boolean;
  readonly ownerFactionId?: string | undefined;
  readonly siteId?: string | undefined;
}

/** Flat JSON-serializable grid representing a continent. */
export interface MacroContinentGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: ReadonlyArray<MacroContinentCell>;
  readonly seaLevel: number;
}

/** Persistent settlement, fortress, shrine, or ruin tracked in Ring 2. */
export interface MacroSiteRecord {
  readonly id: string;
  readonly name: string;
  readonly archetype: MacroSiteArchetype;
  readonly status: MacroSiteStatus;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly factionId: string;
  readonly population: number;
  readonly prosperity: number;
  readonly foodStock: number;
  readonly garrison: number;
  readonly isCapital: boolean;
  readonly foundedYear: number;
  readonly connectedSiteIds: ReadonlyArray<string>;
  readonly residentFigureIds: ReadonlyArray<string>;
  readonly artifactIds: ReadonlyArray<string>;
  readonly boundAreaId?: string | undefined;
}

/** Active merchant caravan traveling between connected macro sites. */
export interface MacroCaravanRecord {
  readonly id: string;
  readonly factionId: string;
  readonly originSiteId: string;
  readonly targetSiteId: string;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly cargoTags: ReadonlyArray<string>;
  readonly escortStrength: number;
  readonly goodsValue: number;
  readonly progressTurns: number;
}

/** Active faction army or warband marching across the continent. */
export interface MacroArmyRecord {
  readonly id: string;
  readonly factionId: string;
  readonly commanderFigureId?: string | undefined;
  readonly originSiteId: string;
  readonly targetSiteId: string;
  readonly x: number;
  readonly y: number;
  readonly chunkX: number;
  readonly chunkY: number;
  readonly strength: number;
  readonly mission: 'patrol' | 'raid' | 'siege' | 'escort';
}

/** Traveling regional weather front modulating local outdoor climate. */
export interface MacroWeatherFront {
  readonly id: string;
  readonly kind: MacroWeatherKind;
  readonly x: number;
  readonly y: number;
  readonly radiusCells: number;
  readonly dx: number;
  readonly dy: number;
  readonly remainingTicks: number;
}

/** Ordered Ring 2 mutation waiting to be materialized on chunk or area wake. */
export interface MacroSiteDelta {
  readonly id: string;
  readonly tick: number;
  readonly siteId: string;
  readonly kind: MacroSiteDeltaKind;
  readonly factionId?: string | undefined;
  readonly actorTemplateTags?: ReadonlyArray<string> | undefined;
  readonly itemTemplateTags?: ReadonlyArray<string> | undefined;
  readonly scarText?: string | undefined;
  readonly summary: string;
}

/** Ring 2 rumor dispatched into Tier 2/3 gossip propagation queues. */
export interface MacroRumorPayload {
  readonly id: string;
  readonly factSummary: string;
  readonly siteId?: string | undefined;
  readonly factionId?: string | undefined;
  readonly originTick: number;
}

/** Historical figure forged during offline Legends worldgen or elevated in Ring 2. */
export interface HistoricalFigureRecord {
  readonly id: string;
  readonly name: string;
  readonly epithet?: string | undefined;
  readonly factionId: string;
  readonly dynastyId: string;
  readonly role: 'ruler' | 'champion' | 'commander' | 'artisan' | 'raider' | 'chronicler';
  readonly birthYear: number;
  readonly deathYear?: number | undefined;
  readonly isAlive: boolean;
  readonly kills: number;
  readonly scars: ReadonlyArray<string>;
  readonly homeSiteId: string;
  readonly currentSiteId: string;
  readonly rivalFigureIds: ReadonlyArray<string>;
  readonly eventIds: ReadonlyArray<string>;
  readonly seededEntityId?: EntityId | undefined;
}

/** Legendary forged artifact with historical ownership provenance. */
export interface HistoricalArtifactRecord {
  readonly id: string;
  readonly name: string;
  readonly baseItemId?: string | undefined;
  readonly creatorFigureId: string;
  readonly forgedYear: number;
  readonly currentSiteId: string;
  readonly ownerHistoryFigureIds: ReadonlyArray<string>;
  readonly description: string;
  readonly materializedEntityId?: EntityId | undefined;
}

/** Named historical era grouping multi-century chronicle events. */
export interface LegendsEraRecord {
  readonly id: string;
  readonly name: string;
  readonly startYear: number;
  readonly endYear: number;
  readonly theme: string;
  readonly summary: string;
}

/** Single historical event stored in the Legends archive. */
export interface LegendsEventRecord {
  readonly id: string;
  readonly year: number;
  readonly season: MacroSeason;
  readonly eraId: string;
  readonly kind: LegendsEventKind;
  readonly importance: 'minor' | 'major' | 'epic';
  readonly summary: string;
  readonly siteId?: string | undefined;
  readonly factionId?: string | undefined;
  readonly secondaryFactionId?: string | undefined;
  readonly figureIds: ReadonlyArray<string>;
  readonly artifactId?: string | undefined;
}

/** Complete multi-century historical archive attached to a campaign save. */
export interface LegendsArchive {
  readonly worldName: string;
  readonly simulatedYears: number;
  readonly eras: ReadonlyArray<LegendsEraRecord>;
  readonly figures: Readonly<Record<string, HistoricalFigureRecord>>;
  readonly artifacts: Readonly<Record<string, HistoricalArtifactRecord>>;
  readonly events: ReadonlyArray<LegendsEventRecord>;
}

/** Pure JSON-serializable Ring 2 macro-world simulation state. */
export interface MacroWorldState {
  readonly worldSeed: number;
  readonly currentTick: number;
  readonly lastDispatchedTick: number;
  readonly tickIntervalTurns: number;
  readonly continent: MacroContinentGrid;
  readonly sites: Readonly<Record<string, MacroSiteRecord>>;
  readonly caravans: Readonly<Record<string, MacroCaravanRecord>>;
  readonly armies: Readonly<Record<string, MacroArmyRecord>>;
  readonly weatherFronts: ReadonlyArray<MacroWeatherFront>;
  readonly pendingSiteDeltas: ReadonlyArray<MacroSiteDelta>;
  readonly materializedDeltaIds: ReadonlyArray<string>;
  readonly legends: LegendsArchive;
}

/** Serializable campaign metadata passed into pure Ring 2 workers without GameState coupling. */
export interface MacroSimCampaignContext {
  readonly factions: ReadonlyArray<string>;
  readonly hostilePairs: ReadonlyArray<readonly [string, string]>;
  readonly raiderFactionIds: ReadonlyArray<string>;
  readonly enableWeatherFronts: boolean;
  readonly secondsPerGlobalTurn?: number | undefined;
  readonly hoursPerDay?: number | undefined;
  readonly cargoTagPools: ReadonlyArray<ReadonlyArray<string>>;
  readonly scarPool: ReadonlyArray<string>;
  readonly nameFirstPool: ReadonlyArray<string>;
  readonly nameTitlePool: ReadonlyArray<string>;
}

/** Ordered delta batch emitted by `advanceMacroWorldTicks` and Ring 2 worker threads. */
export interface MacroTickDeltaBatch {
  readonly fromTick: number;
  readonly toTick: number;
  readonly nextMacroWorld: MacroWorldState;
  readonly newSiteDeltas: ReadonlyArray<MacroSiteDelta>;
  readonly newLegendsEvents: ReadonlyArray<LegendsEventRecord>;
  readonly newRumors: ReadonlyArray<MacroRumorPayload>;
  readonly areaMutations: ReadonlyArray<{
    readonly areaId: string;
    readonly addedTags: ReadonlyArray<string>;
    readonly budgetModifier: number;
  }>;
}

/** Input configuration for generating a continent and simulating multi-century Legends history. */
export interface LegendsWorldgenInput {
  readonly worldSeed: number;
  readonly worldName: string;
  readonly width: number;
  readonly height: number;
  readonly historyYears: number;
  readonly siteCount: number;
  readonly tickIntervalTurns: number;
  readonly enableWeatherFronts: boolean;
  readonly areaSiteBindings: Readonly<Record<string, string>>;
  readonly context: MacroSimCampaignContext;
}
