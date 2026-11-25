# Campaign Modding Reference & Architectural Walkthrough

Welcome to the Roguelike Engine Campaign Modding Reference. This document details how to extend and author new campaigns for this engine. The engine is entirely data-driven, validating campaign definitions using **Zod Schemas** and verifying cross-references using the in-editor validator and CLI validator runner.

---

## 1. Engine Architecture & Authoring Continuum

The engine is built around a pure **Entity-Component-System (ECS)** pattern.

### Levels of Authoring

Modders author campaigns at three levels:

1. **Static Data**: High-level config files (`manifest.json`, `rules.json`, `theme.json`, `advancement.json`).
2. **Blueprints (Templates)**: Blueprint definitions (`entities.json`, `items.json`, `dialogues.json`, `quests.json`, `triggers.json`, `reactions.json`). These define the types of objects, enemies, and interactive triggers that can exist in the world.
3. **Dynamic Entities**: Generated at runtime by the procedural generation systems (e.g., Encounter Director, Scheme Compiler, Nemesis Hierarchy).

---

## 2. Designer Glossary

Here are the canonical engine concepts every campaign author must understand:

- **Tags vs. Traits**:
  - **Tags**: Pure semantic labels used for matching and filtering. Examples: `["undead", "elemental_fire", "web_trap"]`. They carry no direct mechanical logic but are queried by systems (e.g., a weapon that does +5 damage to entities with the `"undead"` tag).
  - **Traits**: Active mechanical behaviors that alter gameplay stats or logic. Examples: `Regeneration` (restores HP every turn), `Fragile` (takes double damage).
- **Intents vs. Events**:
  - **Intents**: Requests to perform an action (e.g., "Player intends to apply a key to a door"). Intents can be blocked, modified, or redirected.
  - **Events**: Immutable historical facts emitted to the ledger after an intent has resolved. Examples: `EntityMoved`, `EntityDied`, `ItemPickedUp`. Triggers react to events.
- **Reactions vs. Triggers**:
  - **Reactions**: Frame-local, combinatorial interactions matching a specific `verb`, `source`, and `target` tag/trait. Reactions happen synchronously. Example: throwing a `potion_of_fire` (source tag: `elemental_fire`) at a `web_trap` (target tag: `web`) triggers the `ignite_web` reaction.
  - **Triggers**: Event-driven scripting blocks. They listen for global `GameEventType` events, check a list of `conditions` (Condition Predicates), and execute a list of `consequences` (Consequence Actions).
- **Static vs. Active vs. Persistent Entities**:
  - **Static Entities**: Blueprints in `entities.json`.
  - **Active Entities**: Live ECS entities present on the current active map.
  - **Persistent Entities**: Entities that survive transition across areas (e.g., companion NPCs, Nemesis villains). They are stored in a campaign-wide persistent pool.
- **Scheme Recipe vs. Phase Block**:
  - **Scheme Recipe**: The high-level blueprint for a background villain plot (e.g., "Monster Invasion"), defining goals, villains, and phases.
  - **Phase Block**: A concrete step in a scheme that mutates area maps (e.g., spawning scouts, blocking a connection, spawning barricades) and scatters clues.

---

## 3. Campaign File Dependency Graph

Campaign files must be authored or generated in a specific sequence because downstream files reference IDs defined in upstream files. The engine validator checks these dependencies.

```
[Phase 0: Base Registries]
  ├── manifest.json, theme.json, advancement.json
  ├── tiles.json, factions.json, status.json, tag_registry.json, fields.json
  ├── trait_registry.json, encounter_profiles.json
  └── rules.json
       │
[Phase 1: Behaviors & Blueprints]
  ├── effects.json (depends on status.json)
  ├── ai.json (depends on effects.json)
  └── entities.json (depends on factions, ai, tag_registry, trait_registry, dialogues)
       │
[Phase 2: World, Items & Adversary]
  ├── items.json (depends on effects, status, tag_registry)
  ├── areas.json (depends on tiles, entities, encounter_profiles, tag_registry)
  ├── spawn_pools.json (depends on entities, tag_registry, factions)
  └── villains.json, agreements.json, schemes.json, phase_blocks.json (depends on entities, factions)
       │
[Phase 3: Interactive Scripting]
  ├── dialogues.json (depends on conditions/consequences, quests, factions, entities)
  ├── quests.json (depends on entities, items, areas)
  ├── triggers.json, trigger_templates.json (depends on conditions/consequences, entities, areas, quests)
  └── reactions.json (depends on entities, items, tiles, tag_registry, trait_registry, fields)
       │
[Phase 4: Social & Generation Rules]
  └── identity_generation.json, personality_generation.json, nemesis_hierarchies.json
```

---

## 4. Key Registries & Schema Contracts

Below are the most critical campaign files, their fields, and references.

### 4.1 Factions Matrix (`factions.json`)

Defines the relationships between factions.

- **Structure**: A complete 2D matrix where every row key must also be a column key.
- **Values**: `"friendly"`, `"neutral"`, or `"hostile"`.
- **Default Campaign Example**:

```json
{
  "player": {
    "player": "friendly",
    "town": "friendly",
    "neutral": "neutral",
    "monster": "hostile",
    "bandits": "hostile"
  },
  "town": {
    "player": "friendly",
    "town": "friendly",
    "neutral": "neutral",
    "monster": "hostile",
    "bandits": "hostile"
  },
  "neutral": {
    "player": "neutral",
    "town": "neutral",
    "neutral": "friendly",
    "monster": "hostile",
    "bandits": "neutral"
  },
  "monster": {
    "player": "hostile",
    "town": "hostile",
    "neutral": "hostile",
    "monster": "friendly",
    "bandits": "hostile"
  },
  "bandits": {
    "player": "hostile",
    "town": "hostile",
    "neutral": "neutral",
    "monster": "hostile",
    "bandits": "friendly"
  }
}
```

### 4.2 Entity Templates (`entities.json`)

Blueprints for monsters, NPCs, and interactive props.

- **Key Fields**:
  - `id`: Unique identifier (e.g., `"goblin_scout"`).
  - `archetypeId`: (Optional / Ruleset-specific) References a system race/archetype in `public/data/rulesets/<rulesetId>/races/*.json` (e.g., `"player"`, `"skeleton"`, `"wolf"`, `"gelatinous_cube"`, `"giant_centipede"`). Required for D&D 3.5e campaigns (`rulesetId: "dnd35e"`). Multi-tile races can also declare `footprint: { width, height }`, `footprintsBySize`, or `isCompletelyFillingSpace: true`.
  - `name`: Human-readable name.
  - `faction`: Faction ID (must resolve in `factions.json`).
  - `ai`: `{ "profileId": "hunt" }` (must resolve in `ai.json`).
  - `fighter`: `{ "hp": 15, "maxHp": 15, "attack": 4, "defense": 1, "xpValue": 10 }`.
  - `crCost`: Challenge Rating cost spent by the Encounter Director.
  - `roleTags`: List of tags for encounter budgeting (e.g., `["appetizer"]` or `["protein"]`).
  - `tags`: List of semantic matching tags (must be registered in `tag_registry.json`).

### 4.2.1 World Clock, Area Environment & Respawn Escalation (`rules.json`, `areas.json`)

- **`rules.json` (`worldClock` & `hunger`)**:
  - `worldClock` (optional): Configures `secondsPerGlobalTurn` (default `6`), `startHour`, `hoursPerDay`, `waitTargets` (e.g. `["dawn", "night"]`), and `phases` (`id`, `label`, `startHour`, `skyIllumination`, `isNaturalSunlight`).
  - `hunger.satiationLossPerStandardTurn` (optional): Controls per-turn satiation decay (`0.035` default = ~1 daily ration of `500` satiation per 24h; e.g. `apple` = `125`).
- **`areas.json` (`environmentType`, Lighting & Respawn Escalation)**:
  - `environmentType` (optional): `"outdoors" | "indoors" | "underground"`. Outdoors tracks diurnal `skyIllumination` and `isNaturalSunlight` (triggering *Light Blindness* / *Light Sensitivity*); underground defaults to `"darkness"`; omitting defaults to `"indoors"`/`"bright"`.
  - `ambientIllumination` (optional): Explicit override (`"bright" | "shadowy" | "darkness"`).
  - `respawnEscalationPerCycle` / `maxRespawnEscalation` (optional): Increment CR budget on lazy area respawn across elapsed cycles (`lastSpawnTurn`).

### 4.2.2 Declarative D&D 3.5e Conditions (`conditions/*.json`)

For `rulesetId: "dnd35e"`, canonical conditions live in `public/data/rulesets/dnd35e/conditions/<id>.json` (`DnD35ConditionDefinitionSchema`), supplying `grantedTags`, `modifiers`, `ruleOverrides`, and non-stacking `abilityPenalties` without TypeScript hardcoding.

### 4.2.3 Multi-Z Maps, Streaming Overworld, Physics & Terrain Sculpting (`tiles.json`, `areas.json`, `rules.json`, `fields.json`)

- **Tile Physical & Vertical Properties (`tiles.json`)**:
  - **Multi-Z & Traversal**: `isOpenAir`, `blocksVerticalLoS`, `hasFloorSupport`, `verticalLink` (`"ramp" | "stairs_up" | "stairs_down" | "stairs_both" | "ladder"`), `isClimbable`, `isSolidObstacle`.
  - **Sculpting & Structural Support**: `mineable`, `minedTileId`, `mineYieldItemId`, `mineYieldCount`, `mineWorkCost`, `requiredToolTag`, `isLoadBearing`, `collapseDropItemId`.
  - **Cellular Heat & Burning**: `thermalConductivity` (`0..1`), `ignitionTempC`, and `burnedTileId` (applied both by local fire and Ring 2 burnt site materialization).
- **Stacked Static Maps & `streaming_overworld` (`areas.json`)**:
  - `staticMap.zLevels`: Optional record keyed by Z-stratum string (e.g., `"-1"`, `"1"`) alongside base Z=`0` `layout`. `placedEntities[]` supports optional `z`, and `connections[]` supports `targetZ`, `placementZ`, and `preserveCoords`.
  - `generatorType: "streaming_overworld"` + `streamingConfig`: Configures `chunkSize` (default `16`, range `8..64`), `activeRadiusChunks`, `prefetchRadiusChunks`, `evictRadiusChunks`, `minZ`, `maxZ`, `activeRadiusZ`, `worldSeed`, `spawnClearingRadius`, and `biomePalette` (`water`, `shore`, `plains`, `forest`, `ridge`, `road`, `openAir`, `underground`, `ramp`).
  - `macroSiteId` (optional): Binds a finite area directly to a Ring 2 site ID for idempotent ruin/raid/caravan/relic materialization upon entry.
- **Materials & Construction (`rules.json`)**:
  - `map.feetPerZLevel` (optional, defaults to ruleset elevation spacing).
  - `materials` (optional): Map of material definitions (`hardness`, `thermalConductivity`, `meltTempC`, `flammable`, `boulderItemId`, `obsidianTileId`).
  - `blueprints` (optional): Constructible tile recipes (`targetTileId`, `materialId`, `requiredInputs`, `workUnits`, `requiredToolTag`, `allowOverOpenAir`).
- **Smoke Field Convention (`fields.json`)**:
  - Give ambient smoke fields `"tags": ["smoke"]` (and register `"smoke"` / `"burnt"` in `tag_registry.json`) so burnt macro-world sites resolve smoke fields declaratively without hardcoded field IDs.

### 4.2.4 Colony Labor, Psychology & Ring 2 Macro-World (`rules.json`, `entities.json`)

- **Entity Psychology & Labor (`entities.json`)**:
  - `enablePsychology` (boolean): Enables 6-need decay (`nourishment`, `rest`, `shelter`, `comfort`, `social`, `safety`) and `Thought` memories driving mood thresholds and mental breaks.
  - `needs` (optional record `0..100`): Overrides starting need values (e.g., `{ "rest": 85, "comfort": 80 }`).
  - `laborPriorities` (optional `{ mining, chopping, hauling, building, harvesting, crafting }` `0..4`): Controls autonomous `laborBehavior` task selection (paired with furniture/workshop tags like `"furniture:bed"` or `"workshop:masonry"`).
- **Crafting & Psychology Rules (`rules.json`)**:
  - `craftingRecipes` (optional): Multi-step bills bound to `workshopTag`, consuming `requiredInputs`, taking `workUnits`, and producing `outputs`.
  - `psychology` (optional): Tune `needDecayMultipliers`, `moodBreakingThreshold`, and `moodInspirationThreshold`.
- **Macro-World & Offline Legends (`rules.json` → `macroWorld`)**:
  - Opt into Ring 2 continental simulation & multi-century pre-play Legends worldgen via `macroWorld`:
    ```json
    "macroWorld": {
      "enabled": true,
      "worldWidth": 24,
      "worldHeight": 24,
      "historyYears": 120,
      "siteCount": 10,
      "macroTickIntervalTurns": 100,
      "enableWeatherFronts": true,
      "areaSiteBindings": {
        "watchtower_overlook": "site_2"
      }
    }
    ```
  - Optional fields: `worldSeed` (defaults to run seed) and `raiderFactionTags` (semantic faction tags eligible to spawn Ring 2 raids).

### 4.3 Interactive Scripting Conditions & Consequences

Both dialogue options and triggers use a shared set of condition predicates and consequence actions.

#### Condition Predicates (Zod Schema: `ConditionPredicateSchema`)

Used to gate dialogues, triggers, and reactions.

- `{ "type": "is_player" }`
- `{ "type": "faction_standing", "target": "town", "operator": ">=", "value": 10 }`
- `{ "type": "has_fact", "target": "defeated_bandit_king" }`
- `{ "type": "has_item", "itemId": "camp_sigil", "amount": 1 }`
- `{ "type": "relationship_axis", "axis": "loyalty", "operator": ">=", "value": 50 }`

#### Consequence Actions (Zod Schema: `ConsequenceActionSchema`)

Mutates game state upon trigger firing, dialogue selection, or reaction resolution.

- `{ "type": "spawn_entity", "entityTemplateId": "bandit_king", "targetId": "boss_spawn" }`
- `{ "type": "apply_status", "statusId": "poisoned", "duration": 5 }`
- `{ "type": "modify_standing", "factionId": "bandits", "amount": -20 }`
- `{ "type": "grant_quest", "questId": "recover_sigil" }`
- `{ "type": "set_fact", "target": "bandit_king_dead" }`

---

## 5. Walkthroughs of Default Campaign Features

The default campaign located in `public/data/campaigns/default/` serves as the feature showcase for modders.

### 5.1 Combat & Status Effects Walkthrough

- **Concept**: Modders define status effects in `status.json` and attach them to items in `items.json`.
- **Default Campaign Files**:
  - `status.json`: Defines the `"poison"` status effect:
    ```json
    "poison": {
      "id": "poison",
      "name": "Poisoned",
      "description": "Takes 2 damage at the start of each turn.",
      "color": "#00d2d3",
      "detrimental": true,
      "perTurnDamage": 2
    }
    ```
  - **`detrimental` (default `false`)**: Marks an effect as hostile to the entity carrying it. It is **not** inferred from `perTurnDamage` — debuffs like a weakening attack penalty or a skipped turn deal no damage but are still detrimental. The flag drives RTwP auto-pause and lets UI surfaces distinguish buffs from debuffs, so set it explicitly on every status you author.
    ```json
    "weakness": {
      "id": "weakness",
      "name": "Weakened",
      "description": "Physical attacks deal 5 less damage.",
      "color": "#ff9f43",
      "detrimental": true,
      "statModifiers": { "attack": -5 }
    }
    ```
  - `items.json`: Defines a `"venom_dagger"` item. It features an `onHit` block applying the status:
    ```json
    "venom_dagger": {
      "id": "venom_dagger",
      "category": "weapon",
      "name": "Venom Dagger",
      "equippable": {
        "slot": "hand",
        "statModifiers": { "attack": 3 },
        "onHit": { "statusId": "poisoned", "chance": 0.5 }
      }
    }
    ```

### 5.2 Interaction Combinatorics & Reactions Walkthrough

- **Concept**: Verbs (`apply`, `dip`, `throw`, `zap`) interact combinatorially using matchers in `reactions.json`.
- **Default Campaign Files**:
  - `reactions.json`: Defines the `altar_sacrifice` reaction. When an entity with the tag `"remains"` is `apply`ed to an entity with the tag `"altar"`, it consumes the remains and spawns a lightning wand:
    ```json
    {
      "verb": "apply",
      "sourceMatcher": { "tags": ["remains"] },
      "targetMatcher": { "tags": ["altar"] },
      "consequences": [
        { "type": "consume_item" },
        { "type": "spawn_entity", "entityTemplateId": "wand_of_lightning" },
        { "type": "force_say", "message": "The altar glows! A lightning wand appears." }
      ]
    }
    ```

### 5.3 Procedural Encounter Director Walkthrough

- **Concept**: Map areas spend a CR (Challenge Rating) budget based on encounter profile target allocations.
- **Default Campaign Files**:
  - `encounter_profiles.json`: Defines budget allocation weight between roles:
    ```json
    "standard_dungeon": {
      "id": "standard_dungeon",
      "budgetAllocation": {
        "protein": 0.2,
        "appetizer": 0.5,
        "side": 0.2,
        "dessert": 0.1
      }
    }
    ```
  - `areas.json`: Defines Dungeon Level 1 with a total `crBudget` of `15`, explicit `environmentType`, and lazy respawn escalation:
    ```json
    "dungeon_1": {
      "id": "dungeon_1",
      "generatorType": "digger",
      "dangerRating": 1,
      "crBudget": 15,
      "encounterProfileId": "standard_dungeon",
      "environmentType": "underground",
      "respawnTimerTurns": 10,
      "respawnEscalationPerCycle": 3,
      "maxRespawnEscalation": 15
    }
    ```
  - `spawn_pools.json`: Maps candidates to role tags and CR costs. The Director selects candidates matching the role weights until the budget is spent:
    ```json
    "entities": {
      "goblin_scout": { "weight": 10, "crCost": 2, "role": "appetizer" },
      "orc_warrior": { "weight": 5, "crCost": 5, "role": "protein" }
    }
    ```

### 5.4 Narrative Triggers & Quests Walkthrough

- **Concept**: Quests gate NPC dialogue nodes, and events tick quest objectives.
- **Default Campaign Files**:
  - `quests.json`: Defines the main quest `"recover_sigil"`:
    ```json
    "recover_sigil": {
      "id": "recover_sigil",
      "title": "Recover the Camp Sigil",
      "description": "Recover the stolen Camp Sigil from the Bandit King's strongbox.",
      "objectives": [
        {
          "id": "kill_king",
          "description": "Defeat the Bandit King",
          "type": "kill",
          "targetId": "bandit_king"
        }
      ]
    }
    ```
  - `triggers.json`: Listens for the Bandit King's death event to update the quest stage:
    ```json
    {
      "id": "king_defeated_trigger",
      "eventType": "EntityDied",
      "conditions": [{ "type": "has_fact", "target": "killed_bandit_king" }],
      "consequences": [{ "type": "complete_quest", "questId": "recover_sigil" }]
    }
    ```
