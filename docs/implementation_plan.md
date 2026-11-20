# Implementation Plan — Phase 43 Pending Roadmap (Milestones 150–156)

> **Status:** Phase 1, Steps 4–5 — Enhanced Implementation Plan (Revised with Confirmed Per-Actor Modulated 3.0s RTwP Move Pacing; Ready for Final Approval)
> **Execution Strategy:** Execute and verify **one milestone at a time sequentially (`M150 -> M151 -> M152 -> M153 -> M154 -> M155 -> M156`)**, running the full 8-stage `./verify.sh` pipeline + `bun scripts/map-codebase.ts` SSOT parity sync after each milestone so every downstream milestone builds on verified live state.
> **Confirmed M151 RTwP Move Pacing:** `6000 ms` = `1` full 6-second round (`100` energy); a single `Move` action occupies `3.0s` (`50` energy) dynamically modulated per actor by their live `tacticalSpeedFt` (incorporating *Haste*, Barbarian *Fast Movement*, Medium/Heavy Armor & Load penalties, Dwarf `trait:unencumbered_speed`, Difficult Terrain, and Stealth half-speed) using zero-drift cumulative rounding.

---

## 1. SSOT Ownership & Old-Brain Eviction Table (M150–M156)

| Milestone | Responsibility | Canonical Owner (After Change) | Evicted / Replaced Old Brain | Tier |
|---|---|---|---|---|
| **M150** | Carried weight sum (equipped + inventory, 1 free `starter_outfit`), STR > 20 & quadruped load tiers | `src/rulesets/dnd35e/combat/tactical_doctrine.ts` (`computeActorCarriedWeightLbs`, `computeEncumbranceState`) | Inline inventory-only weight loop in `dnd35e_ui_adapter.ts`; hardcoded `loadCategory: 'light'` in `semantic_tags_context.ts` | `tier2_cartridge` |
| **M150** | Horizon 3 `armor:*` / `load:*` tag projection & worst-of ACP/Max-Dex DAG enforcement + inventory cache keys | `src/rulesets/dnd35e/semantic_tags.ts`, `dnd35e_dag_adapter.ts`, `dnd35e_turn_budget.ts` | Missing `load:*` emission & stale DAG cache lacking `inventoryRef` | `tier2_cartridge` |
| **M151** | Unified 6-second round clock (`6000 ms` = `100` energy) & cross-mode TB/RTwP action budget | `src/constants/scheduler.constants.ts`, `src/core/scheduler.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts` | `500 ms` RTwP tick & `engineMode !== TurnBased` budget short-circuit | `tier1_console` / `tier2_cartridge` |
| **M152** | 3-tier passability (`evaluateTileTraversal`), single atomic displacement (`displaceEntityStep` / `AlongVector`), mode-aware `runActorMovementStep` | `src/systems/movement_displacement.ts`, `src/systems/movement.system.ts`, `src/systems/lifecycle.system.ts`, `src/types/ruleset.types.ts` | Private `isBlockingTileOrEntity` + raw `PositionComponent` overwrites in `bull_rush_resolver.ts` & `immediate_reactions.ts`; `'dnd35e'` check in `movement.system.ts` | `tier1_console` |
| **M152** | Explicit Triggered Charge action (`+2` atk, `-2` AC condition, straight unobstructed `charge_step`, Pounce/Charging Smite) | `src/rulesets/dnd35e/combat/charge_resolver.ts`, `dnd35e_ruleset.ts` (`verb: 'charge'`) | Passive `distanceMovedFt >= 10` Charge shortcut in `dnd35e_combat_adapter.ts` | `tier2_cartridge` |
| **M153** | Per-area Rest Pressure (`RestPressureConfigSchema`), bulk `processSchemeTurn`, watch-chunk camp ambushes | `src/types/campaign/{rules,world}.ts`, `src/systems/world_time_skip.ts`, `src/systems/rest.system.ts` | Scheme freeze during bulk rest/wait; single-chunk unguarded rest | `tier1_console` |
| **M153** | Quick-draw belt action reduction, two-stage poison, `healers_kit` care, captive `manacles` | `src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts`, `src/systems/status-effect.system.ts`, `src/rulesets/dnd35e/skills/dungeon_skill_verbs.ts` | Flat container action cost; single-stage poison | `tier1_console` / `tier2_cartridge` |
| **M154** | World-owned crossings (`CrossingComponent`), `BreathComponent`, tag-driven `FieldInteractionRule`s, generic `dip` (`CoatingComponent`) | `src/systems/crossing.system.ts`, `src/systems/breath.system.ts`, `src/systems/field.system.ts`, `src/systems/apply.system.ts` | Binary impassable water/pits; inert fields; campaign-only `dip` fallthrough | `tier1_console` |
| **M154** | Water `Swim` (`2×` ACP), Gap `Jump`/`Climb`/`Use Rope`/`Balance`, `caltrops`/`marbles`/`grease`, `Craft (Alchemy)` | `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts`, `src/rulesets/dnd35e/combat/floor_hazard_resolver.ts` | Non-interactive water/pit tiles & unactivated M149 hazard items | `tier2_cartridge` |
| **M155** | Wall-attenuated acoustics (`emitSoundEvent` + AI alertness), `LightEmitterComponent` (fuel/cones), 6s-cadence symmetric Stealth | `src/systems/sound.system.ts`, `src/systems/light_emitter.system.ts`, `src/rulesets/dnd35e/spatial/stealth_resolver.ts` | Omniscient LOS-only AI aggro; static ambient-only `lightGrid` | `tier1_console` / `tier2_cartridge` |
| **M156** | SRD Object/Durability engine (`StructuralComponent`, repairable `ruined`, `0%` opt-in `durabilityConfig`), structural doors, `CorpseComponent`, `ReligionComponent`, `IdentityMaskComponent` | `src/systems/durability.system.ts`, `src/systems/corpse.system.ts`, `src/systems/religion.system.ts`, `src/systems/disguise.system.ts`, `src/rulesets/dnd35e/combat/object_durability_resolver.ts` | Unbreakable doors/objects; missing corpse/piety/disguise primitives | `tier1_console` / `tier2_cartridge` |
| **M156** | Tag-based spell rarity (`rarity:*`), dropped `wizards_spellbook` transcription, live `resolveMonsterLoreCheck`, `UMD` | `src/rulesets/dnd35e/magic/spellbook_loot.ts`, `spellbook_actions.ts`, `src/rulesets/dnd35e/skills/monster_lore_tracker.ts` | Unused `resolveMonsterLoreCheck` on sight; empty mage loot | `tier2_cartridge` |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Milestone & Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
|---|---|---|---|
| **M150:** Free starter outfit weight exclusion & dwarf unencumbered speed | `if (itemId === 'explorers_outfit')` or `if (raceId === 'dwarf')` | `item.tags.includes('starter_outfit')` & `selfTags.includes('trait:unencumbered_speed')` | Yes |
| **M151:** RTwP action round slices | Hardcoding per-spell or per-item ms timers | Derived purely from `DnD35ActionBudget` action tier (`standard`, `move`, `full_round`, `swift`) × `RTWP_MS_PER_100_DURATION` (`6000 ms`) | Yes |
| **M152:** Solid obstacle vs. open hazard & Charge terrain exemptions | `if (tileId === 'stone_wall')` or `if (hasFeat('woodland_stride'))` | Optional `TileDefinitionSchema` flags (`isSolidObstacle`, `hazardKind`, `blocksCharge`, `movementCost`) & declarative `RuleOverride` (`charge_ignores_difficult_terrain`) | Yes |
| **M152:** Charge `-2` AC / `+2` attack & movement modes in Console | Hardcoding `rulesetId === 'dnd35e'` in `movement.system.ts` or ad-hoc `-2` AC branch | `RulesetAdapter.getEntityMovementModes` hook + declarative `charging` condition JSON (`public/data/rulesets/dnd35e/conditions/charging.json`) | Yes |
| **M153:** Rest pressure & quick-draw container speed | Hardcoding dungeon area IDs or `if (itemId === 'bandoleer')` | `RestPressureConfigSchema` on `rules.json` / `AreaDefinition.restPressure`; `tags: ['quick_draw_container']` on belt/bandoleer items | Yes |
| **M154:** Field chemistry, crossings, and breath immunity | Hardcoding `if (field === 'fire' && tile === 'oil')` or `if (race === 'skeleton')` | Declarative `FieldInteractionRuleSchema[]` (`incomingTags`, `targetTags`, `resultAction`); `CrossingComponent`; Layer A tags (`trait:water_breathing`, `type:undead`, `type:construct`) | Yes |
| **M155:** Sound attenuation, light cones, stealth senses | `if (itemId === 'bullseye_lantern')` or `if (race === 'elf')` | `tile.soundAttenuation`; `item.lightSource: { radiusFt, coneAngleDeg?, fuelTurns?, requiresIgnition? }`; Layer A sense tags (`sense:darkvision`, `sense:low_light`, `sense:scent`, `sense:tremorsense`) | Yes |
| **M156:** Object hardness/vulnerability, wear config, spell rarity | `if (spellId === 'wish')` or `switch (itemId)` for hardness | `materialTag` -> material hardness/HP table in JSON; `rules.durabilityConfig` (`0%` defaults); `rarity:uncommon|rare|forbidden` inside `DnD35SpellDefinitionSchema.tags` | Yes |

---

## 3. Detailed Step-by-Step Implementation Plan & Code Snippets (M150–M156)

---

### Milestone 150 — Live Symmetric Weight-Based Encumbrance Enforcement & DAG Inventory Cache Invalidation

#### Step 150.1 — Canonical Carried Weight & STR > 20 / Quadruped Scaling (`src/rulesets/dnd35e/combat/tactical_doctrine.ts`, `src/rulesets/dnd35e/ui/dnd35e_ui_adapter.ts`)
- Extend `computeEncumbranceState` to support `strScore > 20` (SRD `×4` per `+10` STR) and optional `isQuadruped = false` (SRD quadruped size carry multipliers: Fine `×1/4`, Diminutive `×1/2`, Tiny `×3/4`, Small `×1`, Medium `×1.5`, Large `×3`, Huge `×6`, Gargantuan `×12`, Colossal `×24`).
- Add canonical `computeActorCarriedWeightLbs(state: GameState, entityId: EntityId): number`:
```ts
// src/rulesets/dnd35e/combat/tactical_doctrine.ts
export function computeActorCarriedWeightLbs(state: GameState, entityId: EntityId): number {
  const seenItemIds = new Set<EntityId>();
  const inventory = getComponent(state, entityId, ComponentType.Inventory) as InventoryComponent | undefined;
  const equipment = getComponent(state, entityId, ComponentType.Equipment) as EquipmentComponent | undefined;
  for (const id of inventory?.items ?? []) seenItemIds.add(id);
  for (const slot of equipment?.slots ?? []) {
    if (slot.equippedItem !== null) seenItemIds.add(slot.equippedItem);
  }

  let totalLbs = 0;
  let excludedStarterOutfit = false;
  for (const itemEntityId of seenItemIds) {
    const itemComp = getComponent(state, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const rawDef = state.campaign.items[itemComp.itemId] as DnD35ItemDefinition | undefined;
    if (!rawDef) continue;
    const itemDef = resolveEffectiveItemDefinition(rawDef, state.campaign.items, itemComp);
    if (!excludedStarterOutfit && (itemDef.tags ?? []).includes('starter_outfit')) {
      excludedStarterOutfit = true;
      continue;
    }
    const qty = Math.max(1, itemComp.quantity ?? 1);
    totalLbs += (itemDef.weight ?? 0) * qty;
  }
  return totalLbs;
}
```
- Update `dnd35e_ui_adapter.ts` `getInventoryData` to call `computeActorCarriedWeightLbs(state, entityId)` instead of its inline inventory-only loop.

#### Step 150.2 — Horizon 3 `armor:*` & `load:*` Tag Projection Ordering (`semantic_tags_context.ts`, `semantic_tags.ts`)
- Expand `SituationalTagContext.loadCategory` to `'light' | 'medium' | 'heavy' | 'overloaded'`.
- Compute live `loadCategory` inside `resolveEntitySituationalTagContext` from `computeActorCarriedWeightLbs` + `computeEncumbranceState` (passing `dndData.anatomyBodyPlan === 'quadruped'`).
- In `projectDnD35ActorSemanticTags` (`semantic_tags.ts`): move `armor:<category>` emission **above** the `activeClassFeatures` loop (line `182`) and emit `load:<category>` right beside it so `barbarian.json` (`Fast Movement`), `druid.json`, Monk, and Ranger feature `activationCondition` checks see live `armor:*` and `load:*` tags!

#### Step 150.3 — DAG Enforcement, Effective STR Re-Check & Inventory Cache Invalidation (`dnd35e_dag_adapter.ts`, `dnd35e_turn_budget.ts`)
- Add `inventoryRef: InventoryComponent | undefined` and `inventoryItemRefs: ReadonlyArray<ItemComponent | undefined>` to `CachedEntityDAGEntry` (`dnd35e_dag_adapter.ts:87-115`) and compare them in the cache hit check (lines `264-289`).
- In `evaluateDnD35eEntityDAGInternal`: after Stage 1–2 resolves `dagResult.effectiveAbilityScores.str` and `dagResult.effectiveSize`, compute effective `encumbrance = computeEncumbranceState(effectiveStr, effectiveSize, carriedWeightLb, baseSpeedFt, isQuadruped)`.
  - Merge non-stacking SRD constraints:
    - `effectiveMaxDexCap = minDefined(itemContrib.maxDexBonusCap, encumbrance.maxDexBonus)`
    - `effectiveAcp = Math.min(itemContrib.armorCheckPenalty, encumbrance.acp)`
  - If the effective `loadTier` differs from the initial raw-STR `loadCategory` (e.g., *Ray of Enfeeblement* or *Bull's Strength* shifted load tier), update `load:*` tag and re-run DAG Stage 3–4 + skills once.
- In `dnd35e_turn_budget.ts:140-146`: return `5` ft when `selfTags.includes('load:overloaded')`, and keep `load:medium` / `load:heavy` speed reduction respecting `trait:unencumbered_speed`.
- **Verification (M150):** Add unit tests in `tests/dnd35e_encumbrance.test.ts` covering Light/Medium/Heavy/Overloaded tiers, worst-of armor+load ACP/Max-Dex, Dwarf `trait:unencumbered_speed`, Barbarian `Fast Movement` disabled in Heavy Load, *Ray of Enfeeblement* mid-combat overload, STR > 20 & quadruped scaling, and pickup/drop DAG cache invalidation. Run `./verify.sh`.

---

### Milestone 151 — Unified 6-Second Round Clock across TB & RTwP

#### Step 151.1 — 6-Second Real-Time Round Baseline (`src/constants/scheduler.constants.ts`, `src/core/scheduler.ts`)
- Update `RTWP_MS_PER_100_DURATION = 6000` (with named constant `DND_ROUND_DURATION_MS = 6000`, `FULL_ROUND_ENERGY_COST = 100`, `HALF_ROUND_ENERGY_COST = 50`).
- Ensure `MAX_ACCUMULATED_RTWP_TIME` and RTwP speed multipliers (`0.5×`, `1×`, `2×`, `4×`) remain crisp and responsive.

#### Step 151.2 — Cross-Mode Action Budget & Sub-Round Proportional Energy (`src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts`)
- Remove the `if (state.engineMode !== EngineMode.TurnBased)` early exit in `resolveDnD35eActionEnergyCost` and `canDnD35eActorPerformIntent`:
```ts
// src/rulesets/dnd35e/cartridge/dnd35e_turn_budget.ts
export const HALF_ROUND_ENERGY_COST = 50;

function resolveSubRoundRtwpEnergyCost(
  preBudget: DnD35ActionBudget,
  postBudget: DnD35ActionBudget,
  tacticalSpeedFt: number,
  stepCostFt: number
): number {
  const stdSpent = preBudget.standardRemaining - postBudget.standardRemaining;
  const moveSpent = preBudget.moveRemaining - postBudget.moveRemaining;
  if (stdSpent > 0 && moveSpent > 0) return FULL_ROUND_ENERGY_COST; // Full-round action = 6.0s
  if (stdSpent > 0) return HALF_ROUND_ENERGY_COST; // Standard action = 3.0s
  if (stepCostFt > 0) {
    const squaresPerMove = Math.max(1, tacticalSpeedFt / FEET_PER_GRID_SQUARE);
    return Math.max(1, Math.round((HALF_ROUND_ENERGY_COST * (stepCostFt / FEET_PER_GRID_SQUARE)) / squaresPerMove));
  }
  if (moveSpent > 0) return HALF_ROUND_ENERGY_COST;
  return 0; // Swift / Free action
}
```
- When `state.engineMode === EngineMode.TurnBased`: unchanged (`0` while round actions remain, `100` when round ends).
- When `state.engineMode === EngineMode.RTwP`: commit updated `actionBudget` onto the actor (clearing when round actions exhaust) and return `resolveSubRoundRtwpEnergyCost(...)` so the scheduler advances the actor's next turn by the exact sub-round time slice! Switching TB ↔ RTwP mid-round preserves `actionBudget` verbatim.
- **Verification (M151):** Add `tests/unified_round_clock.test.ts` verifying 6-second round duration, proportional Move (`3s` for 30 ft = `50` energy) + Standard (`3s` = `50` energy) = `6s`, speed-scaled movement (`Haste` / Heavy Load), and mid-round TB ↔ RTwP toggle parity. Run `./verify.sh`.

---

### Milestone 152 — Centralized Tier 1 Spatial Displacement Kernel & Explicit Triggered Charge Action

#### Step 152.1 — Declarative Tile Traversal Schema & 3-Tier Passability (`src/types/campaign/world.ts`, `src/systems/movement_displacement.ts`)
- Extend `TileDefinitionSchema` with optional declarative fields (100% backward compatible):
```ts
// src/types/campaign/world.ts (inside TileDefinitionSchema)
isSolidObstacle: z.boolean().optional(),
hazardKind: z.string().optional(),
blocksCharge: z.boolean().optional(),
soundAttenuation: z.number().nonnegative().optional(),
```
- Create `src/systems/movement_displacement.ts` exporting:
```ts
export type TilePassabilityTier = 'unimpeded' | 'difficult' | 'hazardous' | 'solid_obstacle';
export type DisplacementMode = 'voluntary_walk' | 'charge_step' | 'forced_push' | 'forced_pull' | 'teleport' | 'swap';

export interface TileTraversalEvaluation {
  readonly passability: TilePassabilityTier;
  readonly moveCostMultiplier: number;
  readonly triggersSolidCollision: boolean;
  readonly blocksCharge: boolean;
  readonly hazardKind?: string | undefined;
}

export interface DisplacementContext {
  readonly mode: DisplacementMode;
  readonly isForced: boolean;
  readonly provokesAoO: boolean;
  readonly sourceEntityId?: EntityId | undefined;
  readonly ignoresDifficultTerrainForCharge?: boolean | undefined;
}

export interface DisplacementResult {
  readonly state: GameState;
  readonly moved: boolean;
  readonly stepsMoved: number;
  readonly finalPos: { readonly x: number; readonly y: number };
  readonly stopReason: 'completed' | 'solid_obstacle' | 'entity_blocker' | 'hazard_halted' | 'difficult_terrain_blocked' | 'out_of_bounds';
  readonly collidedTileId?: string | undefined;
  readonly collidedEntityId?: EntityId | undefined;
  readonly events: ReadonlyArray<GameEvent>;
}
```
- `evaluateTileTraversal(tileDef, movementModes)` classifies tiles declaratively (using `walkable`, `traversableBy`, `isSolidObstacle`, `hazardKind`, `movementCost`, and legacy `tags` like `pit`/`chasm`/`water`/`liquid` so existing campaigns work unchanged). Keep `canTraverseTile` as a thin wrapper around `evaluateTileTraversal` for backward compatibility while migrating callers.

#### Step 152.2 — Single Atomic Displacement Kernel & Mode-Aware Lifecycle (`src/systems/movement_displacement.ts`, `src/systems/lifecycle.system.ts`, `src/types/ruleset.types.ts`)
- Add optional `getEntityMovementModes?(state: GameState, entityId: EntityId): MovementModes | undefined` to `RulesetAdapter` (implemented in `dnd35e_ruleset.ts`), removing the `'dnd35e'` check in `movement.system.ts:61`.
- Extend `runActorMovementStep` and `RulesetAdapter.onActorMovementStep` with optional `displacementContext?: DisplacementContext`. In `dnd35e_lifecycle_adapter.ts`, skip `evaluateAdjacentEnemyReactionsOnMove` when `displacementContext?.isForced === true && !displacementContext.provokesAoO` or `displacementContext?.mode === 'teleport'`, while **always** running anchored field sync, traps, aura entry saves, flanking graph, light exposure, and `TileEntered`.
- Implement `displaceEntityStep` and `displaceEntityAlongVector` in `src/systems/movement_displacement.ts`:
  - Stage 1: Passability & policy gate (`voluntary_walk`, `charge_step`, `forced_push`/`forced_pull` entering hazards & stopping on `solid_obstacle`, `teleport` checking destination).
  - Stage 2: Multi-tile `resolveMovementFootprintPlacement` + `evaluateFootprintOccupancy` preserving all `PositionComponent` fields via `buildUpdatedPositionComponent`.
  - Stage 3: Atomic `addComponent(Position)` + `fovNeedsUpdate` (if player) + `runActorMovementStep(..., displacementContext)` + `GameEventType.TileEntered` events.

#### Step 152.3 — Migrate Fragmented Callers (`movement.system.ts`, `bull_rush_resolver.ts`, `immediate_reactions.ts`, `follow.behavior.ts`, `companions.ts`)
- Route `processMoveIntent` (normal walk & Friendly Swap), `bull_rush_resolver.ts` (`forced_push` -> Dungeon Crasher triggers strictly on `res.stopReason === 'solid_obstacle'`, follow-up stops safely at `hazard_halted` ledges), and `immediate_reactions.ts` (`teleport` for Abrupt Jaunt) through `displaceEntityStep` / `displaceEntityAlongVector`.
- Update `follow.behavior.ts` and `companions.ts` to query `evaluateTileTraversal`.

#### Step 152.4 — Explicit Triggered Charge Action (`src/rulesets/dnd35e/combat/charge_resolver.ts`, `dnd35e_combat_adapter.ts`, `dnd35e_ruleset.ts`, `public/data/rulesets/dnd35e/conditions/charging.json`)
- Author declarative `public/data/rulesets/dnd35e/conditions/charging.json` (`acPenalty: -2`, expires at start of actor's next turn).
- Remove passive `const isChargeAttack = distanceMovedFt >= CHARGE_MOVEMENT_MIN_FT` from `dnd35e_combat_adapter.ts:137` (replace with explicit `options?.isChargeAttack === true`).
- Implement `validateChargeLine` + `executeDnD35eChargeAction(state, attackerId, defenderId)`:
  - Validates Full-Round Action budget, straight-line distance `>= 10 ft` and `<= 2 × tacticalSpeedFt`, and unobstructed `charge_step` path (respecting declarative `RuleOverride` `charge_ignores_difficult_terrain`).
  - Displaces attacker adjacent via `displaceEntityAlongVector(..., { mode: 'charge_step', isForced: false, provokesAoO: true })`.
  - Applies `charging` condition (`-2` AC until next turn) + `+2` untyped charge attack bonus, executes single strike (or full attack if `hasPounce`) with `isChargeAttack: true` (triggering Charging Smite / Powerful Charge), and consumes Full-Round budget.
- Wire player targeting (`verb: 'charge'` in `dnd35e_ruleset.ts` + hotbar slot in `dnd35e_ui_hotbar.ts`) and AI charge decision in hunt behavior symmetrically.
- **Verification (M152):** Update any existing tests relying on passive 10-ft Pounce/Charging Smite to invoke `executeDnD35eChargeAction`; add tests for Bull Rush preserving 2×2 footprints, pushing into pits vs. slamming walls, Abrupt Jaunt triggering traps/anchored fields, and Charge line blockage + `-2` AC penalty. Sync SSOT JSONs (`bun scripts/map-codebase.ts`) and run `./verify.sh`.

---

### Milestone 153 — Per-Area Rest Pressure ("Doom Clock"), Bulk Scheme Progression, Camp Watch Ambushes & Logistics

#### Step 153.1 — Tier 1 `RestPressureConfigSchema` (`src/types/campaign/rules.ts`, `src/types/campaign/world.ts`)
```ts
export const RestPressureConfigSchema = z.object({
  safeRest: z.boolean().default(false),
  ambushChancePerWatch: z.number().min(0).max(1).default(0.15),
  watchDurationHours: z.number().int().positive().default(2),
  schemeTickMultiplier: z.number().min(0).default(1),
  respawnRateMultiplier: z.number().min(0).default(1),
  alarmDecayTurns: z.number().int().nonnegative().default(50)
});
```
- Attach optional `restPressure: RestPressureConfigSchema.optional()` to both `RulesConfigSchema` (campaign default) and `AreaDefinitionSchema` (per-area override), plus helper `resolveAreaRestPressure(state)`.

#### Step 153.2 — Bulk Scheme Progression & Watch-Shift Camp Ambushes (`world_time_skip.ts`, `rest.system.ts`)
- In `stepBulkMacroCadence` (`world_time_skip.ts:100-118`): scale Scheme intervals by `restPressure.schemeTickMultiplier` and invoke `processSchemeTurn` for active masterminds, appending scheme progress digest entries (`"Villain scheme advanced..."`).
- In `rest.system.ts`: split long rests into `watchDurationHours` chunks when `!restPressure.safeRest`:
  - Evaluate camp gear (`bedroll`/`winter_blanket`/`tent` + active light/campfire) for ambush risk reduction and recovery quality.
  - Roll `ambushChancePerWatch`; on ambush, spawn `EncounterDirector` patrol and run party highest-Perception watch check (success = awake, failure = `Flat-Footed / Surprised` for 1 round), interrupting rest cleanly with partial time elapsed. Mirror sleeping/waking surprise tags for sleeping NPC/monster camps.

#### Step 153.3 — Quick-Draw Belts, Two-Stage Poison, `healers_kit` & Captive `manacles`
- **`dnd35e_turn_budget.ts`:** Items retrieved from an equipped slot carrying `tags: ['quick_draw_container']` (`bandoleer`, `potion_belt`, `masterwork_*`) consume Free/Swift action instead of Move action (no AoO).
- **`status-effect.system.ts` & `dungeon_skill_verbs.ts`:** Support optional `secondaryTriggerAfterTurns: 10` on poison status definitions (granting `+5 alchemical` Fort save when `antitoxin` status is active); wire `healers_kit` long-term rest care (`2×` natural HP/ability recovery) and `Heal DC 15` limp cure; wire `apply` with `manacles` on unconscious/helpless actors applying `bound` condition (`Escape Artist DC 30/35`, Break DC `26/28`).
- **Verification (M153):** Add unit tests for per-area `safeRest` vs. hostile dungeon ambush watches, bulk `processSchemeTurn` advancement, quick-draw belt vs. backpack action costs, two-stage poison + antitoxin, and manacles binding. Run `./verify.sh`.

---

### Milestone 154 — Symmetric Terrain Traversal, Field Transmutations & `dip` (`CoatingComponent`) Hazards

#### Step 154.1 — World-Owned Crossings & `BreathComponent` (`src/types/components/world_components.types.ts`, `src/systems/crossing.system.ts`, `src/systems/breath.system.ts`)
- Add `ComponentType.Crossing` (`crossingKind: 'bridge' | 'rope_line' | 'ladder_span' | 'frozen_surface'`, `requiredSkill?`, `skillDc?`, `maxWeightLbs?`, `anchorTileCoords?`) and `ComponentType.Breath` (`remainingTurns`, `maxTurns`, `isSubmerged`).
- Update `evaluateTileTraversal` (`M152`) to inspect `state.spatialIndex` for live `CrossingComponent` entities at `(x, y)` so placed bridges, anchored ropes, ladders, and frozen ice sheets override underlying `deep_water`/`chasm` hazards symmetrically for players, companions, and AI A* pathfinding — and destroying/melting the crossing immediately drops occupants into the underlying hazard!
- Tick `BreathComponent` in `runActorTurnStart` for submerged breathing actors (exempting `trait:water_breathing`, `type:undead`, `type:construct`).

#### Step 154.2 — Water Depth Tiers & Gap/Pit Resolvers (`src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts`)
- **`shallow_water` / `bog`:** `2×` move cost, `-2` stealth/tumble modifier, extinguishes non-magical fire.
- **`deep_water`:** Native `swim > 0` unimpeded; others roll `Swim` (`DC 10` calm / `DC 15` rough) applying **`2×` live M150 ACP** on entry & per turn; failure sinks and decrements `2 × CON` breath rounds.
- **Gaps/Pits (1–2 tiles):** `Jump` check (`DC 5` per 5-ft gap running, `×2` standing) -> failure rolls Reflex ledge-catch save or falls (`1d6` per 10 ft + `prone`); `Climb` (`DC 10–15`, `+2` `climbers_kit`) to enter/exit pits; `Use Rope` (`DC 10`, `+2` `silk_rope`) with `grappling_hook` or `ladder_10ft` spawns a real `CrossingComponent` entity.

#### Step 154.3 — Tag-Driven Field Transmutations, `dip` (`CoatingComponent`) & SRD Floor Hazards (`field.system.ts`, `apply.system.ts`, `floor_hazard_resolver.ts`)
- Add `FieldInteractionRuleSchema` (`incomingTags`, `targetTags`, `spawnFieldType?`, `spawnCrossingKind?`, `extinguishTarget?`, `chainSpreadOrthogonal?`, `shockDamageDice?`) to `rules.json` / campaign registries and evaluate on `spawnField` and energy spell impacts:
  - `oil` + `fire` -> connected oil ignition; `water` + `cold` -> `frozen_surface` crossing + slippery ice; `water` + `electricity` -> BFS conductive shock; `fire` + `water` -> `steam_cloud` (`blocksSight: true`); `smokestick` -> smoke obscurement.
- Wire generic `dip` verb in `apply.system.ts` to attach `ComponentType.Coating` onto weapons/ammo/lanterns (`oil_flask`, `holy_water`, injury poisons — with 5% natural-1 mishap check unless `feature:poison_use`), and consume `CoatingComponent` charges on hit in `dnd35e` combat (`combat_exchange_pipeline.ts`).
- Wire `caltrops` (BAB `+0` touch-like attack, `1` dmg + half-speed limp halting charges cleanly), `marbles`/`grease`/ice (`Balance DC 10–15` or `prone`), and `Craft (Alchemy)` potion ID (`DC 15`) / brewing.
- **Verification (M154):** Add tests for crossing placement + cutting/melting mid-crossing, `Swim 2× ACP` + drowning + undead immunity, forced Bull Rush into pit/deep water, oil/fire/water/cold/lightning field chemistry, `dip` coating application/consumption, and caltrops/marbles. Sync SSOT JSONs & run `./verify.sh`.

---

### Milestone 155 — Acoustics (`emitSoundEvent` + AI Alertness), Dynamic `LightEmitterComponent` & Symmetric 6s-Cadence Stealth

#### Step 155.1 — Acoustic Sound Ripple System (`src/systems/sound.system.ts`, `AIComponent`)
- Extend `AIComponent` with optional `alertnessState?: 'unaware' | 'suspicious' | 'alerted'`, `lastHeardPos?: { x: number; y: number }`, `alertnessDecayTurns?: number`.
- `emitSoundEvent(state, originX, originY, dbLevel, sourceEntityId)` runs bounded BFS attenuated by `tile.soundAttenuation` (walls/closed doors). Listeners within effective range roll `Listen` vs. `Move Silently` (or auto-hear loud combat/kick/thunderstone events): AI switches `unaware -> suspicious` and investigates `lastHeardPos`; player receives directional sound cues (`"You hear heavy footsteps to the east"`).

#### Step 155.2 — Dynamic `LightEmitterComponent` & Fuel/Cone Grid (`src/systems/light_emitter.system.ts`, `cover_senses.ts`)
- Add `ComponentType.LightEmitter` (`radiusFt`, `coneAngleDeg?`, `facing?`, `fuelTurns?`, `isLit`, `requiresIgnition?`) and declarative `lightSource` config on `ItemDefinitionSchema`.
- Wire `ignite` (`flint_and_steel`, `tindertwig`) and `dip` refueling (`oil_flask`); tick fuel in `runActorTurnStart`; integrate active carried/dropped emitters (including NPC guard lanterns!) into `resolveTileLightReading` (`cover_senses.ts`).

#### Step 155.3 — Symmetric 6s-Cadence Stealth (`src/rulesets/dnd35e/spatial/stealth_resolver.ts`, `stance.system.ts`)
- Add Stealth stance state (`isStealthed`, `fastStealth`, `lastStealthRoll`, `nextStealthCheckRound`, `reStealthCooldownRound`) on `TacticalDoctrineComponent` (or dedicated `StealthComponent`).
- Manual Stealth skill toggle defaults to **half-speed** (avoiding `-5` `Move Silently` penalty); `fastStealth` toggles full-speed at `-5`.
- Opposed `Hide` (gated by cover / `light:darkness` / `light:shadowy`, size mod) vs. `Spot` and `Move Silently` (live M150 ACP) vs. `Listen` execute **once per 6-second round** (M151 cadence), plus immediate re-checks on state transitions (brighter light band, new observer LOS, opening a door, loud noise).
- **Instant break without auto-pause** on attack, failed check, or losing cover/concealment while observed; manual re-stealth requires being unobserved/having concealment (or *Hide in Plain Sight*) + 1-round cooldown.
- Add Darkvision, Low-Light Vision, Scent (30 ft detection), Tremorsense, and `flour_pouch` (`dusted` tag cutting invisibility miss chance `50% -> 20%` and negating `Hide`).
- **Verification (M155):** Add tests for door-attenuated sound ripples + AI investigation, fuel-burning radial/cone lights, 6s-cadence stealth (no death-by-a-thousand-rolls in RTwP), instant break without auto-pause, Scent/Darkvision counters, and `flour_pouch`. Sync SSOT JSONs & run `./verify.sh`.

---

### Milestone 156 — Baseline SRD Object/Durability Engine, Structural Doors, Spellbook Rarity, Auto Monster Lore, Corpse Ecology & Piety/Disguise

#### Step 156.1 — Baseline SRD Object/Durability Engine & Opt-In Console Wear (`src/types/components/world_components.types.ts`, `src/types/campaign/rules.ts`, `src/systems/durability.system.ts`, `src/rulesets/dnd35e/combat/object_durability_resolver.ts`)
- Add `ComponentType.Structural` (`materialTag`, `hardness`, `hp`, `maxHp`, `breakDc`, `objectSize`, `enhancementBonus?`, `ruined?: boolean`, `jammed?: boolean`, `spikedByEntityId?: EntityId`) and opt-in `DurabilityConfigSchema` on `rules.json`:
```ts
export const DurabilityConfigSchema = z.object({
  enableFumbleWearChance: z.number().min(0).max(1).default(0),
  enableHardArmorWearChance: z.number().min(0).max(1).default(0),
  enableCritArmorWearChance: z.number().min(0).max(1).default(0),
  ruinedIsRepairable: z.boolean().default(true)
});
```
- Implement pure SRD *Smashing an Object* math in `object_durability_resolver.ts`:
  - Object AC = `10 + sizeMod - 5 (Dex 0) - 2 (inanimate)` (animated objects use creature AC).
  - Magic bonus `+1` adds `+2` hardness & `+10` HP.
  - Energy multipliers before hardness: Acid/Sonic `1×`, Fire/Electricity `1/2`, Cold `1/4`; Ranged `1/2`; immune to crits & nonlethal; `adamantine` ignores hardness `< 20`; vulnerable materials take `2×` ignoring hardness.
  - Break checks: `1d20 + STR mod + SRD size mod` (`Fine -16` to `Colossal +16`), `-2` DC when `hp <= maxHp / 2`, `+2` with `crowbar`, `+2` (+`2`/ally) with `portable_ram` (emitting sound ripple).
  - Reaching `0 HP` sets `ruined: true` (unusable until repaired via `Craft` + `whetstone`/`artisan_tools`, never silently deleting items).
- Wire `open`/`close`/`kick`/`lock`, door spiking (`iron_spike` + `hammer`), and `pole_10ft` range-2 trap probing symmetrically for all actors.

#### Step 156.2 — Spellbook Rarity Tags, Auto `Knowledge` Monster Lore & UMD (`spellbook_loot.ts`, `spellbook_actions.ts`, `monster_lore_tracker.ts`)
- Read `rarity:uncommon` / `rarity:rare` / `rarity:forbidden` from `DnD35SpellDefinitionSchema.tags` (default `rarity:common`); tag select high-tier/specialty spells in `public/data/rulesets/dnd35e/spells/*.json`.
- On arcane caster death (`death.system.ts` hook), spawn a `wizards_spellbook` item populated with the caster's castable spells + rarity-weighted bonus spell rolls scaled by caster level / boss tier. Add `read`/`transcribe` flow in `spellbook_actions.ts` (`Spellcraft DC 15 + SL`, consuming `ink_vial` + `inkpen` + world hours).
- Auto-invoke `resolveMonsterLoreCheck` (`specialized_skill_checks.ts:107`) on first sighting or `inspect`, persisting discovered monster traits (DR bypasses, immunities, vulnerabilities) onto player knowledge and surfacing them via `projectInspectLoreLines` (`dnd35e_ruleset.ts:171`).
- Complete `UMD DC 20` check inside `validateWandActivation` / scroll casting for off-list items.

#### Step 156.3 — Physical Corpse Economy, Piety (`ReligionComponent`) & Active Disguise (`IdentityMaskComponent`)
- **`CorpseComponent` (`corpse.system.ts`, `death.system.ts`):** Slain living/corporeal actors drop decaying tagged corpses (`decayTurn`, `harvestableTags: ['pelt' | 'venom_gland' | 'reagent' | 'bounty_trophy' | 'zombie_husk']`) usable by harvesters, necromancers, and fire denial symmetrically.
- **`ReligionComponent` (`religion.system.ts`):** Generic `{ deityOrPatronId, favorScore, penanceDebt, taboosViolated }` ledger interacting with shrines/altars.
- **`IdentityMaskComponent` (`disguise.system.ts`):** Generic faction/race disguise suppressing baseline hostility while accumulating `suspicion` when observed closely or contradicting gear (`Spot` vs. `Disguise`, usable by both player and infiltrator NPCs).
- **Verification (M156):** Add tests for SRD Object AC/Hardness/Energy/Break DC + repairable `ruined` state + `0%` default wear config, door spiking/kicking, rarity-weighted spellbook drops + `Spellcraft` scribing, auto `Knowledge` lore reveals, `CorpseComponent` decay/harvesting, `ReligionComponent`, and `IdentityMaskComponent`. Sync SSOT JSONs (`bun scripts/map-codebase.ts`), showcase in `default` & `dnd35e-crypt`, and run `./verify.sh`.

---

## 4. Approval Gate (Per `AGENTS.md` §1)

No production code files have been modified yet. All design decisions (including per-actor modulated `3.0s` RTwP Move pacing across *Haste*, Heavy Armor, Dwarf `trait:unencumbered_speed`, Difficult Terrain, and Stealth) are locked in. Click **Proceed** (or confirm in chat) to begin sequential execution starting with **Milestone 150**, running `./verify.sh` (8/8) + SSOT parity sync after each milestone.
