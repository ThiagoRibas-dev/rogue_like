import { MAX_PENDING_KNOWLEDGE_QUEUE } from '../../constants/knowledge.constants.ts';
import {
  ARMY_ATTACK_ROLL_RANGE,
  ARMY_BASE_STRENGTH,
  ARMY_DEFENSE_ROLL_RANGE,
  ARMY_ORIGIN_MIN_GARRISON,
  ARMY_SEVERE_BURN_MARGIN,
  ARMY_SPAWN_CHANCE,
  ARMY_STRENGTH_RANGE,
  CARAVAN_BASE_ESCORT_STRENGTH,
  CARAVAN_BASE_GOODS_VALUE,
  CARAVAN_DELIVERY_FOOD_GAIN,
  CARAVAN_DELIVERY_PROSPERITY_GAIN,
  CARAVAN_ESCORT_PROSPERITY_DIVISOR,
  CARAVAN_GOODS_PROSPERITY_MULT,
  CARAVAN_SPAWN_CHANCE,
  DAYS_PER_SEASON,
  DEFAULT_MACRO_HOURS_PER_DAY,
  DEFAULT_MACRO_SECONDS_PER_TURN,
  MACRO_SEASONS,
  MACRO_WORLD_RUMOR_DELAY_TURNS,
  MACRO_WORLD_RUMOR_RULE_ID,
  MAX_MACRO_ARMIES,
  MAX_MACRO_CARAVANS,
  MAX_MACRO_EVENT_ARCHIVE,
  MAX_PENDING_SITE_DELTAS,
  MAX_SITE_PROSPERITY,
  MAX_WEATHER_FRONTS,
  MIN_SITE_PROSPERITY,
  SEASONS_PER_YEAR,
  SITE_BURN_PROSPERITY_LOSS,
  SITE_FOOD_GROWTH_THRESHOLD,
  SITE_GARRISON_REGEN_CHANCE,
  SITE_MAX_FOOD_STOCK,
  SITE_MAX_GARRISON,
  SITE_MILD_FOOD_DELTA,
  SITE_MIN_FOOD_STOCK,
  SITE_RAID_AREA_BUDGET_MODIFIER,
  SITE_RAID_GARRISON_RATIO,
  SITE_RAID_MIN_GARRISON,
  SITE_RAID_MIN_POP,
  SITE_RAID_POP_RATIO,
  SITE_RAID_PROSPERITY_LOSS,
  SITE_REBUILD_CHANCE,
  SITE_REBUILD_GARRISON_BONUS,
  SITE_REBUILD_MIN_GARRISON,
  SITE_REBUILD_MIN_PROSPERITY,
  SITE_WINTER_FOOD_DELTA,
  WEATHER_FRONT_BASE_RADIUS_CELLS,
  WEATHER_FRONT_EXTRA_RADIUS,
  WEATHER_FRONT_EXTRA_TICKS,
  WEATHER_FRONT_MIN_TICKS,
  WEATHER_FRONT_SPAWN_CHANCE,
  WEATHER_TEMP_DELTA_BY_KIND
} from '../../constants/macro_world.constants.ts';
import { CHUNK_DIRTY_TEMP, CHUNK_FLAG_OUTDOOR, DEFAULT_CHUNK_SIZE } from '../../constants/world_chunk.constants.ts';
import { MINUTES_PER_HOUR, SECONDS_PER_MINUTE } from '../../constants/world_clock.constants.ts';
import { addComponent, getComponent } from '../../core/ecs/ecs_core.ts';
import { markMapPhysicsDirtyAt } from '../../map/map_accessor.ts';
import { createMacroRng, mapWorldCoordToContinentCell } from '../../map/worldgen_continent.ts';
import type { CampaignData } from '../../types/campaign.types.ts';
import { ComponentType, type DirectorBudgetComponent, type TagsComponent } from '../../types/components.types.ts';
import { GameEventType, type MacroWorldTickSyncedEvent } from '../../types/events.types.ts';
import type { GameState } from '../../types/game-state.types.ts';
import type { PendingRumorPropagation } from '../../types/knowledge.types.ts';
import type {
  LegendsEventRecord,
  MacroArmyRecord,
  MacroCaravanRecord,
  MacroRumorPayload,
  MacroSeason,
  MacroSimCampaignContext,
  MacroSiteDelta,
  MacroSiteRecord,
  MacroTickDeltaBatch,
  MacroWeatherFront,
  MacroWeatherKind,
  MacroWorldState
} from '../../types/macro_world.types.ts';

export { createMacroRng };

/**
 * Extracts a pure JSON-serializable `MacroSimCampaignContext` from `CampaignData`
 * so Ring 2 workers run with zero direct dependency on campaign ECS loaders or rulesets.
 *
 * @param campaign Loaded campaign data document.
 * @returns Serializable simulation context for Ring 2 workers and Legends worldgen.
 */
export function buildMacroSimContext(campaign: Readonly<CampaignData>): MacroSimCampaignContext {
  const factionIds = Object.keys(campaign.factions);
  const factions = factionIds.length > 0 ? factionIds : ['town'];
  const hostilePairs: Array<readonly [string, string]> = [];
  const raiderFactionSet = new Set<string>();
  const configuredRaiderTags = campaign.rules.macroWorld?.raiderFactionTags ?? [];

  for (const a of factions) {
    const row = campaign.factions[a];
    let hostileCount = 0;
    for (const b of factions) {
      if (a === b) continue;
      if (row?.[b] === 'hostile') {
        hostileCount += 1;
        if (a < b) {
          hostilePairs.push([a, b]);
        }
      }
    }
    const nonPlayerEnemies = factions.filter((b) => b !== a && b !== 'player' && row?.[b] === 'hostile').length;
    const matchesTag =
      configuredRaiderTags.includes(a) ||
      Object.values(campaign.entities).some(
        (tpl) => tpl.faction === a && Boolean(tpl.tags?.some((t) => configuredRaiderTags.includes(t)))
      );
    if (matchesTag || nonPlayerEnemies >= 1 || hostileCount >= Math.max(1, Math.floor(factions.length / 2))) {
      raiderFactionSet.add(a);
    }
  }
  const raiderFactionIds = Array.from(raiderFactionSet);

  const scarSet = new Set<string>();
  for (const hierarchy of Object.values(campaign.nemesisHierarchies ?? {})) {
    for (const scar of hierarchy.scarPool ?? []) {
      scarSet.add(scar.id ?? scar.description);
    }
  }
  if (scarSet.size === 0) {
    scarSet.add('burned_cheek');
    scarSet.add('raider_slash');
    scarSet.add('siege_limp');
  }

  const firstNames = new Set<string>();
  const titles = new Set<string>();
  for (const table of Object.values(campaign.identityGeneration ?? {})) {
    for (const fn of table.firstNames) firstNames.add(fn);
    for (const t of table.titles) titles.add(t);
  }

  return {
    factions,
    hostilePairs,
    raiderFactionIds,
    enableWeatherFronts: campaign.rules.macroWorld?.enableWeatherFronts ?? true,
    secondsPerGlobalTurn: campaign.rules.worldClock?.secondsPerGlobalTurn ?? DEFAULT_MACRO_SECONDS_PER_TURN,
    hoursPerDay: campaign.rules.worldClock?.hoursPerDay ?? DEFAULT_MACRO_HOURS_PER_DAY,
    cargoTagPools: [['valuable', 'haulable'], ['material:stone', 'haulable'], ['consumable'], ['weapon']],
    scarPool: Array.from(scarSet),
    nameFirstPool: Array.from(firstNames),
    nameTitlePool: Array.from(titles)
  };
}

function areFactionsHostile(context: MacroSimCampaignContext, a: string, b: string): boolean {
  if (a === b) return false;
  const min = a < b ? a : b;
  const max = a < b ? b : a;
  return context.hostilePairs.some(([u, v]) => u === min && v === max);
}

function resolveCalendarForMacroTick(
  tick: number,
  tickIntervalTurns: number,
  simulatedYears: number,
  context: MacroSimCampaignContext
): { readonly season: MacroSeason; readonly currentYear: number } {
  const secondsPerTurn = Math.max(1, context.secondsPerGlobalTurn ?? DEFAULT_MACRO_SECONDS_PER_TURN);
  const hoursPerDay = Math.max(1, context.hoursPerDay ?? DEFAULT_MACRO_HOURS_PER_DAY);
  const turnsPerDay = Math.max(1, Math.floor((hoursPerDay * MINUTES_PER_HOUR * SECONDS_PER_MINUTE) / secondsPerTurn));
  const elapsedDays = Math.floor((Math.max(0, tick) * Math.max(1, tickIntervalTurns)) / turnsPerDay);
  const seasonIdx = Math.floor(elapsedDays / DAYS_PER_SEASON) % SEASONS_PER_YEAR;
  const season = MACRO_SEASONS[seasonIdx] ?? 'spring';
  const currentYear = simulatedYears + Math.floor(elapsedDays / (DAYS_PER_SEASON * SEASONS_PER_YEAR)) + 1;
  return { season, currentYear };
}

function pickSeasonalWeatherKind(season: MacroSeason, rngFn: () => number): MacroWeatherKind {
  const roll = rngFn();
  if (season === 'winter') {
    if (roll < 0.45) return 'blizzard';
    if (roll < 0.7) return 'fog';
    return 'clear';
  }
  if (season === 'summer') {
    if (roll < 0.35) return 'heatwave';
    if (roll < 0.6) return 'drought';
    if (roll < 0.8) return 'storm';
    return 'clear';
  }
  if (roll < 0.45) return 'rain';
  if (roll < 0.65) return 'storm';
  if (roll < 0.8) return 'fog';
  return 'clear';
}

function stepTowards(cur: number, target: number): number {
  if (cur < target) return cur + 1;
  if (cur > target) return cur - 1;
  return cur;
}

/**
 * Pure deterministic Ring 2 simulation kernel advancing settlements, caravans,
 * faction warbands/armies, off-screen rumors, and seasonal weather fronts through `targetTick`.
 *
 * @param macroWorld Current immutable MacroWorldState.
 * @param targetTick Target Ring 2 tick index to advance up to.
 * @param context Pure serializable campaign context.
 * @returns Ordered {@link MacroTickDeltaBatch} ready to merge at turn boundaries.
 */
export function advanceMacroWorldTicks(
  macroWorld: MacroWorldState,
  targetTick: number,
  context: MacroSimCampaignContext
): MacroTickDeltaBatch {
  const safeTarget = Math.max(macroWorld.currentTick, Math.floor(targetTick));
  if (safeTarget <= macroWorld.currentTick) {
    return {
      fromTick: macroWorld.currentTick,
      toTick: macroWorld.currentTick,
      nextMacroWorld: macroWorld,
      newSiteDeltas: [],
      newLegendsEvents: [],
      newRumors: [],
      areaMutations: []
    };
  }

  const sites: Record<string, MacroSiteRecord> = { ...macroWorld.sites };
  const caravans: Record<string, MacroCaravanRecord> = { ...macroWorld.caravans };
  const armies: Record<string, MacroArmyRecord> = { ...macroWorld.armies };
  let weatherFronts: MacroWeatherFront[] = [...macroWorld.weatherFronts];

  const newSiteDeltas: MacroSiteDelta[] = [];
  const newLegendsEvents: LegendsEventRecord[] = [];
  const newRumors: MacroRumorPayload[] = [];
  const areaMutations: Array<{
    readonly areaId: string;
    readonly addedTags: ReadonlyArray<string>;
    readonly budgetModifier: number;
  }> = [];

  const latestEraId = macroWorld.legends.eras[macroWorld.legends.eras.length - 1]?.id ?? 'era_present';
  const width = macroWorld.continent.width;
  const height = macroWorld.continent.height;
  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  for (let tick = macroWorld.currentTick + 1; tick <= safeTarget; tick++) {
    const rngFn = createMacroRng(macroWorld.worldSeed, tick * 7919 + 13);
    const { season, currentYear } = resolveCalendarForMacroTick(
      tick,
      macroWorld.tickIntervalTurns,
      macroWorld.legends.simulatedYears,
      context
    );
    const siteValues = Object.values(sites);

    // 1. Settlement economy & recovery dynamics
    for (const site of siteValues) {
      if (site.status === 'intact') {
        const prosDelta = site.foodStock >= SITE_FOOD_GROWTH_THRESHOLD ? 1 : -1;
        sites[site.id] = {
          ...site,
          prosperity: Math.max(MIN_SITE_PROSPERITY, Math.min(MAX_SITE_PROSPERITY, site.prosperity + prosDelta)),
          foodStock: Math.max(
            SITE_MIN_FOOD_STOCK,
            Math.min(
              SITE_MAX_FOOD_STOCK,
              site.foodStock + (season === 'winter' ? SITE_WINTER_FOOD_DELTA : SITE_MILD_FOOD_DELTA)
            )
          ),
          garrison: Math.min(SITE_MAX_GARRISON, site.garrison + (rngFn() < SITE_GARRISON_REGEN_CHANCE ? 1 : 0))
        };
      } else if ((site.status === 'raided' || site.status === 'burned') && rngFn() < SITE_REBUILD_CHANCE) {
        sites[site.id] = {
          ...site,
          status: 'intact',
          prosperity: Math.max(SITE_REBUILD_MIN_PROSPERITY, site.prosperity),
          garrison: Math.max(SITE_REBUILD_MIN_GARRISON, site.garrison + SITE_REBUILD_GARRISON_BONUS)
        };
        newSiteDeltas.push({
          id: `delta_${tick}_rebuilt_${site.id}`,
          tick,
          siteId: site.id,
          kind: 'site_rebuilt',
          factionId: site.factionId,
          actorTemplateTags: ['guard'],
          summary: `${site.name} has been rebuilt and fortified by ${site.factionId}.`
        });
      }
    }

    // 2. Spawn & advance trade caravans
    const intactSites = Object.values(sites).filter((s) => s.status === 'intact' && s.connectedSiteIds.length > 0);
    if (
      Object.keys(caravans).length < MAX_MACRO_CARAVANS &&
      intactSites.length >= 2 &&
      rngFn() < CARAVAN_SPAWN_CHANCE
    ) {
      const origin = intactSites[Math.floor(rngFn() * intactSites.length) % intactSites.length]!;
      const friendlyTargets = origin.connectedSiteIds
        .map((id) => sites[id])
        .filter(
          (t): t is MacroSiteRecord =>
            t !== undefined && t.status === 'intact' && !areFactionsHostile(context, origin.factionId, t.factionId)
        );
      const target =
        friendlyTargets[Math.floor(rngFn() * friendlyTargets.length)] ?? intactSites.find((s) => s.id !== origin.id);
      if (target && target.id !== origin.id) {
        const cargoPool = context.cargoTagPools[
          Math.floor(rngFn() * context.cargoTagPools.length) % context.cargoTagPools.length
        ] ?? ['valuable'];
        const cid = `caravan_${tick}_${origin.id}`;
        caravans[cid] = {
          id: cid,
          factionId: origin.factionId,
          originSiteId: origin.id,
          targetSiteId: target.id,
          x: origin.x,
          y: origin.y,
          chunkX: origin.chunkX,
          chunkY: origin.chunkY,
          cargoTags: cargoPool,
          escortStrength:
            CARAVAN_BASE_ESCORT_STRENGTH + Math.floor(origin.prosperity / CARAVAN_ESCORT_PROSPERITY_DIVISOR),
          goodsValue: CARAVAN_BASE_GOODS_VALUE + Math.floor(origin.prosperity * CARAVAN_GOODS_PROSPERITY_MULT),
          progressTurns: 0
        };
      }
    }

    for (const caravan of Object.values(caravans)) {
      const target = sites[caravan.targetSiteId];
      if (!target) {
        delete caravans[caravan.id];
        continue;
      }
      const nextX = stepTowards(caravan.x, target.x);
      const nextY = stepTowards(caravan.y, target.y);
      const nextCx = nextX - centerX;
      const nextCy = nextY - centerY;

      // Check hostile army interception at same cell
      const ambusher = Object.values(armies).find(
        (army) =>
          Math.max(Math.abs(army.x - nextX), Math.abs(army.y - nextY)) <= 1 &&
          areFactionsHostile(context, army.factionId, caravan.factionId)
      );
      if (ambusher && ambusher.strength > caravan.escortStrength) {
        delete caravans[caravan.id];
        const summary = `A ${caravan.factionId} caravan bound for ${target.name} was ambushed by ${ambusher.factionId} raiders!`;
        newLegendsEvents.push({
          id: `evt_macro_${tick}_${caravan.id}`,
          year: currentYear,
          season,
          eraId: latestEraId,
          kind: 'caravan_ambushed',
          importance: 'minor',
          summary,
          siteId: target.id,
          factionId: ambusher.factionId,
          secondaryFactionId: caravan.factionId,
          figureIds: []
        });
        newRumors.push({
          id: `rumor_${tick}_${caravan.id}`,
          factSummary: summary,
          siteId: target.id,
          factionId: caravan.factionId,
          originTick: tick
        });
        continue;
      }

      if (nextX === target.x && nextY === target.y) {
        delete caravans[caravan.id];
        sites[target.id] = {
          ...target,
          prosperity: Math.min(MAX_SITE_PROSPERITY, target.prosperity + CARAVAN_DELIVERY_PROSPERITY_GAIN),
          foodStock: Math.min(SITE_MAX_FOOD_STOCK, target.foodStock + CARAVAN_DELIVERY_FOOD_GAIN)
        };
        const summary = `A ${caravan.factionId} trade caravan arrived safely in ${target.name}.`;
        newSiteDeltas.push({
          id: `delta_${tick}_caravan_${target.id}`,
          tick,
          siteId: target.id,
          kind: 'caravan_arrived',
          factionId: caravan.factionId,
          actorTemplateTags: ['merchant', 'guard'],
          itemTemplateTags: caravan.cargoTags,
          summary
        });
        newLegendsEvents.push({
          id: `evt_macro_${tick}_${caravan.id}`,
          year: currentYear,
          season,
          eraId: latestEraId,
          kind: 'caravan_completed',
          importance: 'minor',
          summary,
          siteId: target.id,
          factionId: caravan.factionId,
          figureIds: []
        });
      } else {
        caravans[caravan.id] = {
          ...caravan,
          x: nextX,
          y: nextY,
          chunkX: nextCx,
          chunkY: nextCy,
          progressTurns: caravan.progressTurns + 1
        };
      }
    }

    // 3. Spawn & advance faction armies / warband raids
    if (Object.keys(armies).length < MAX_MACRO_ARMIES && siteValues.length >= 2 && rngFn() < ARMY_SPAWN_CHANCE) {
      const candidates = siteValues.filter((s) => s.garrison >= ARMY_ORIGIN_MIN_GARRISON && s.status !== 'ruined');
      const origin = candidates[Math.floor(rngFn() * candidates.length)] ?? siteValues[0];
      const raiderPool = context.raiderFactionIds.length > 0 ? context.raiderFactionIds : context.factions;
      const attackerFaction =
        raiderPool[Math.floor(rngFn() * raiderPool.length) % raiderPool.length] ?? origin?.factionId ?? 'bandits';
      const targets = siteValues.filter(
        (s) =>
          s.status === 'intact' &&
          (areFactionsHostile(context, attackerFaction, s.factionId) || s.factionId !== attackerFaction)
      );
      const target = targets[Math.floor(rngFn() * targets.length)];
      if (origin && target && origin.id !== target.id) {
        const aid = `army_${tick}_${attackerFaction}`;
        armies[aid] = {
          id: aid,
          factionId: attackerFaction,
          originSiteId: origin.id,
          targetSiteId: target.id,
          x: origin.x,
          y: origin.y,
          chunkX: origin.chunkX,
          chunkY: origin.chunkY,
          strength: ARMY_BASE_STRENGTH + Math.floor(rngFn() * ARMY_STRENGTH_RANGE),
          mission: areFactionsHostile(context, attackerFaction, target.factionId) ? 'raid' : 'patrol'
        };
      }
    }

    for (const army of Object.values(armies)) {
      const target = sites[army.targetSiteId];
      if (!target) {
        delete armies[army.id];
        continue;
      }
      const nextX = stepTowards(army.x, target.x);
      const nextY = stepTowards(army.y, target.y);
      const nextCx = nextX - centerX;
      const nextCy = nextY - centerY;

      if (nextX === target.x && nextY === target.y) {
        delete armies[army.id];
        if (army.mission === 'patrol' || !areFactionsHostile(context, army.factionId, target.factionId)) {
          sites[target.id] = {
            ...target,
            garrison: Math.min(SITE_MAX_GARRISON, target.garrison + Math.floor(army.strength / 4))
          };
          continue;
        }

        const attackRoll = army.strength + Math.floor(rngFn() * ARMY_ATTACK_ROLL_RANGE);
        const defenseRoll = target.garrison + Math.floor(rngFn() * ARMY_DEFENSE_ROLL_RANGE);
        if (attackRoll > defenseRoll) {
          const isSevereBurn = attackRoll - defenseRoll >= ARMY_SEVERE_BURN_MARGIN;
          const nextStatus = isSevereBurn ? 'burned' : 'raided';
          const scar =
            context.scarPool[Math.floor(rngFn() * context.scarPool.length) % Math.max(1, context.scarPool.length)] ??
            'burned_cheek';
          sites[target.id] = {
            ...target,
            status: nextStatus,
            prosperity: Math.max(
              MIN_SITE_PROSPERITY,
              target.prosperity - (isSevereBurn ? SITE_BURN_PROSPERITY_LOSS : SITE_RAID_PROSPERITY_LOSS)
            ),
            garrison: Math.max(SITE_RAID_MIN_GARRISON, Math.floor(target.garrison * SITE_RAID_GARRISON_RATIO)),
            population: Math.max(SITE_RAID_MIN_POP, Math.floor(target.population * SITE_RAID_POP_RATIO))
          };
          const summary = isSevereBurn
            ? `${army.factionId} forces torched ${target.name}, leaving smoldering ruins and scarred survivors!`
            : `${army.factionId} raiders struck ${target.name}, plundering supplies.`;
          newSiteDeltas.push({
            id: `delta_${tick}_${nextStatus}_${target.id}`,
            tick,
            siteId: target.id,
            kind: isSevereBurn ? 'site_burned' : 'site_raided',
            factionId: army.factionId,
            actorTemplateTags: ['survivor', 'raider'],
            scarText: scar,
            summary
          });
          newLegendsEvents.push({
            id: `evt_macro_${tick}_${army.id}`,
            year: currentYear,
            season,
            eraId: latestEraId,
            kind: isSevereBurn ? 'site_burned' : 'site_raided',
            importance: isSevereBurn ? 'epic' : 'major',
            summary,
            siteId: target.id,
            factionId: army.factionId,
            secondaryFactionId: target.factionId,
            figureIds: []
          });
          newRumors.push({
            id: `rumor_${tick}_${army.id}`,
            factSummary: summary,
            siteId: target.id,
            factionId: army.factionId,
            originTick: tick
          });
          if (target.boundAreaId) {
            areaMutations.push({
              areaId: target.boundAreaId,
              addedTags: [isSevereBurn ? 'raided_burnt' : 'raided'],
              budgetModifier: SITE_RAID_AREA_BUDGET_MODIFIER
            });
          }
        } else {
          const summary = `Garrison forces in ${target.name} repelled an attack by ${army.factionId}.`;
          newLegendsEvents.push({
            id: `evt_macro_${tick}_def_${army.id}`,
            year: currentYear,
            season,
            eraId: latestEraId,
            kind: 'battle_fought',
            importance: 'minor',
            summary,
            siteId: target.id,
            factionId: target.factionId,
            secondaryFactionId: army.factionId,
            figureIds: []
          });
        }
      } else {
        armies[army.id] = {
          ...army,
          x: nextX,
          y: nextY,
          chunkX: nextCx,
          chunkY: nextCy
        };
      }
    }

    // 4. Advance seasonal weather fronts
    if (context.enableWeatherFronts) {
      weatherFronts = weatherFronts
        .map((front) => {
          const nx = (((front.x + front.dx) % width) + width) % width;
          const ny = (((front.y + front.dy) % height) + height) % height;
          return {
            ...front,
            x: nx,
            y: ny,
            remainingTicks: front.remainingTicks - 1
          };
        })
        .filter((front) => front.remainingTicks > 0);

      if (weatherFronts.length < MAX_WEATHER_FRONTS && rngFn() < WEATHER_FRONT_SPAWN_CHANCE) {
        const kind = pickSeasonalWeatherKind(season, rngFn);
        if (kind !== 'clear') {
          weatherFronts.push({
            id: `weather_${tick}_${weatherFronts.length + 1}`,
            kind,
            x: Math.floor(rngFn() * width),
            y: Math.floor(rngFn() * height),
            radiusCells: WEATHER_FRONT_BASE_RADIUS_CELLS + Math.floor(rngFn() * WEATHER_FRONT_EXTRA_RADIUS),
            dx: rngFn() < 0.7 ? 1 : -1,
            dy: rngFn() < 0.5 ? 0 : rngFn() < 0.5 ? 1 : -1,
            remainingTicks: WEATHER_FRONT_MIN_TICKS + Math.floor(rngFn() * WEATHER_FRONT_EXTRA_TICKS)
          });
        }
      }
    }
  }

  const combinedDeltas = [...macroWorld.pendingSiteDeltas, ...newSiteDeltas].slice(-MAX_PENDING_SITE_DELTAS);
  const combinedEvents = [...macroWorld.legends.events, ...newLegendsEvents].slice(-MAX_MACRO_EVENT_ARCHIVE);

  const nextMacroWorld: MacroWorldState = {
    ...macroWorld,
    currentTick: safeTarget,
    lastDispatchedTick: Math.max(macroWorld.lastDispatchedTick, safeTarget),
    sites,
    caravans,
    armies,
    weatherFronts,
    pendingSiteDeltas: combinedDeltas,
    legends: {
      ...macroWorld.legends,
      events: combinedEvents
    }
  };

  return {
    fromTick: macroWorld.currentTick,
    toTick: safeTarget,
    nextMacroWorld,
    newSiteDeltas,
    newLegendsEvents,
    newRumors,
    areaMutations
  };
}

/**
 * Evaluates active Ring 2 seasonal weather front coverage and ambient temperature delta
 * for outdoor world coordinates `(wx, wy)`.
 *
 * @param state Current immutable GameState.
 * @param wx World X coordinate.
 * @param wy World Y coordinate.
 * @returns Active weather kind and ambient Celsius delta, or `undefined` when clear/unconfigured.
 */
export function getActiveOutdoorWeatherAt(
  state: Readonly<GameState>,
  wx: number,
  wy: number
): { readonly kind: MacroWeatherKind; readonly tempDeltaC: number } | undefined {
  const macroWorld = state.macroWorld;
  if (!macroWorld || macroWorld.weatherFronts.length === 0) return undefined;

  const chunkSize = state.map.chunkGrid?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const cell = mapWorldCoordToContinentCell(macroWorld.continent, wx, wy, chunkSize);
  if (!cell) return undefined;

  for (const front of macroWorld.weatherFronts) {
    const dist = Math.hypot(cell.x - front.x, cell.y - front.y);
    if (dist <= front.radiusCells) {
      return {
        kind: front.kind,
        tempDeltaC: WEATHER_TEMP_DELTA_BY_KIND[front.kind] ?? 0
      };
    }
  }

  return undefined;
}

function markOutdoorRegionsTempDirtyForWeather(
  state: GameState,
  prevFronts: ReadonlyArray<MacroWeatherFront>,
  nextFronts: ReadonlyArray<MacroWeatherFront>
): GameState {
  if (prevFronts.length === 0 && nextFronts.length === 0) return state;

  const isOutdoorArea = state.campaign.areas[state.currentAreaId]?.environmentType === 'outdoors';
  const grid = state.map.chunkGrid;
  if (grid !== undefined) {
    const nextChunks = new Map(grid.chunks);
    const nextDirtyKeys = new Set(grid.dirtyChunkKeys);
    let touched = false;

    for (const [packed, chunk] of grid.chunks.entries()) {
      if (chunk.cz < 0) continue;
      const isOutdoorChunk = isOutdoorArea || chunk.flags.some((f) => (f & CHUNK_FLAG_OUTDOOR) !== 0);
      if (!isOutdoorChunk) continue;
      if ((chunk.dirtyFlags & CHUNK_DIRTY_TEMP) === 0 || !nextDirtyKeys.has(packed)) {
        nextChunks.set(packed, {
          ...chunk,
          dirtyFlags: chunk.dirtyFlags | CHUNK_DIRTY_TEMP
        });
        nextDirtyKeys.add(packed);
        touched = true;
      }
    }

    if (!touched) return state;
    return {
      ...state,
      map: {
        ...state.map,
        chunkGrid: {
          ...grid,
          chunks: nextChunks,
          dirtyChunkKeys: nextDirtyKeys
        }
      }
    };
  }

  if (isOutdoorArea && state.map.width > 0 && state.map.height > 0) {
    return {
      ...state,
      map: markMapPhysicsDirtyAt(state.map, 0, 0, 0, CHUNK_DIRTY_TEMP, state.globalTurn)
    };
  }
  return state;
}

/**
 * Deterministically merges an ordered Ring 2 {@link MacroTickDeltaBatch} onto `GameState`,
 * ignoring stale or duplicate batches (`batch.toTick <= state.macroWorld.currentTick`).
 *
 * @param state Current immutable GameState.
 * @param batch Ordered delta batch produced by Ring 2 simulation.
 * @returns Updated GameState with macro-world state, ledger entries, rumors, and area mutations applied.
 */
export function applyMacroTickBatchToGameState(state: GameState, batch: MacroTickDeltaBatch): GameState {
  if (!state.macroWorld) return state;
  if (batch.toTick <= state.macroWorld.currentTick) return state;

  const prevFronts = state.macroWorld.weatherFronts;
  let nextState: GameState = {
    ...state,
    macroWorld: {
      ...batch.nextMacroWorld,
      // Preserve local consumption receipts accumulated since worker dispatch
      materializedDeltaIds: state.macroWorld.materializedDeltaIds
    }
  };

  nextState = markOutdoorRegionsTempDirtyForWeather(nextState, prevFronts, batch.nextMacroWorld.weatherFronts);

  // Append major/epic Ring 2 events to the player-facing historicalLedger
  const ledgerAdditions: ReadonlyArray<MacroWorldTickSyncedEvent> = batch.newLegendsEvents
    .filter((evt) => evt.importance !== 'minor')
    .map((evt) => ({
      id: evt.id,
      type: GameEventType.MacroWorldTickSynced,
      importance: (evt.importance === 'epic' ? 'high' : 'normal') as 'high' | 'normal',
      summary: evt.summary,
      fromTick: batch.fromTick,
      toTick: batch.toTick,
      deltaCount: batch.newSiteDeltas.length
    }));

  if (ledgerAdditions.length > 0) {
    nextState = {
      ...nextState,
      historicalLedger: [...nextState.historicalLedger, ...ledgerAdditions]
    };
  }

  // Feed Ring 2 rumors directly into pendingRumors (bounded by MAX_PENDING_KNOWLEDGE_QUEUE)
  if (batch.newRumors.length > 0) {
    const existingIds = new Set(nextState.pendingRumors.map((r) => r.rumorItem.id));
    const addedRumors: PendingRumorPropagation[] = [];
    for (const r of batch.newRumors) {
      if (existingIds.has(r.id)) continue;
      addedRumors.push({
        ruleId: MACRO_WORLD_RUMOR_RULE_ID,
        rumorItem: {
          id: r.id,
          text: r.factSummary,
          persistent: false,
          sourceEventId: r.id
        },
        sourceAreaId: nextState.currentAreaId,
        remainingDelay: MACRO_WORLD_RUMOR_DELAY_TURNS,
        deliveredAreas: []
      });
    }
    if (addedRumors.length > 0) {
      nextState = {
        ...nextState,
        pendingRumors: [...nextState.pendingRumors, ...addedRumors].slice(-MAX_PENDING_KNOWLEDGE_QUEUE)
      };
    }
  }

  // Propagate Ring 2 area mutations to registered ECS area entities
  for (const mut of batch.areaMutations) {
    const areaEntId = nextState.areaEntityIds[mut.areaId];
    if (areaEntId === undefined) continue;
    const budget = getComponent(nextState, areaEntId, ComponentType.DirectorBudget) as
      DirectorBudgetComponent | undefined;
    if (budget) {
      nextState = addComponent(nextState, areaEntId, {
        ...budget,
        budgetModifier: budget.budgetModifier + mut.budgetModifier
      });
    }
    const tags = getComponent(nextState, areaEntId, ComponentType.Tags) as TagsComponent | undefined;
    if (tags && mut.addedTags.length > 0) {
      nextState = addComponent(nextState, areaEntId, {
        ...tags,
        tags: Array.from(new Set([...tags.tags, ...mut.addedTags]))
      });
    }
  }

  return nextState;
}
