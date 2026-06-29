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

*   **Tags vs. Traits**:
    *   **Tags**: Pure semantic labels used for matching and filtering. Examples: `["undead", "elemental_fire", "web_trap"]`. They carry no direct mechanical logic but are queried by systems (e.g., a weapon that does +5 damage to entities with the `"undead"` tag).
    *   **Traits**: Active mechanical behaviors that alter gameplay stats or logic. Examples: `Regeneration` (restores HP every turn), `Fragile` (takes double damage).
*   **Intents vs. Events**:
    *   **Intents**: Requests to perform an action (e.g., "Player intends to apply a key to a door"). Intents can be blocked, modified, or redirected.
    *   **Events**: Immutable historical facts emitted to the ledger after an intent has resolved. Examples: `EntityMoved`, `EntityDied`, `ItemPickedUp`. Triggers react to events.
*   **Reactions vs. Triggers**:
    *   **Reactions**: Frame-local, combinatorial interactions matching a specific `verb`, `source`, and `target` tag/trait. Reactions happen synchronously. Example: throwing a `potion_of_fire` (source tag: `elemental_fire`) at a `web_trap` (target tag: `web`) triggers the `ignite_web` reaction.
    *   **Triggers**: Event-driven scripting blocks. They listen for global `GameEventType` events, check a list of `conditions` (Condition Predicates), and execute a list of `consequences` (Consequence Actions).
*   **Static vs. Active vs. Persistent Entities**:
    *   **Static Entities**: Blueprints in `entities.json`.
    *   **Active Entities**: Live ECS entities present on the current active map.
    *   **Persistent Entities**: Entities that survive transition across areas (e.g., companion NPCs, Nemesis villains). They are stored in a campaign-wide persistent pool.
*   **Scheme Recipe vs. Phase Block**:
    *   **Scheme Recipe**: The high-level blueprint for a background villain plot (e.g., "Monster Invasion"), defining goals, villains, and phases.
    *   **Phase Block**: A concrete step in a scheme that mutates area maps (e.g., spawning scouts, blocking a connection, spawning barricades) and scatters clues.

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
  └── villains.json, agreements.json, scheme_recipes.json, phase_blocks.json (depends on entities, factions)
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
*   **Structure**: A complete 2D matrix where every row key must also be a column key.
*   **Values**: `"friendly"`, `"neutral"`, or `"hostile"`.
*   **Default Campaign Example**:
```json
{
  "player": { "player": "friendly", "town": "friendly", "neutral": "neutral", "monster": "hostile", "bandits": "hostile" },
  "town": { "player": "friendly", "town": "friendly", "neutral": "neutral", "monster": "hostile", "bandits": "hostile" },
  "neutral": { "player": "neutral", "town": "neutral", "neutral": "friendly", "monster": "hostile", "bandits": "neutral" },
  "monster": { "player": "hostile", "town": "hostile", "neutral": "hostile", "monster": "friendly", "bandits": "hostile" },
  "bandits": { "player": "hostile", "town": "hostile", "neutral": "neutral", "monster": "hostile", "bandits": "friendly" }
}
```

### 4.2 Entity Templates (`entities.json`)
Blueprints for monsters, NPCs, and interactive props.
*   **Key Fields**:
    *   `id`: Unique identifier (e.g., `"goblin_scout"`).
    *   `name`: Human-readable name.
    *   `faction`: Faction ID (must resolve in `factions.json`).
    *   `ai`: `{ "profileId": "hunt" }` (must resolve in `ai.json`).
    *   `fighter`: `{ "hp": 15, "maxHp": 15, "attack": 4, "defense": 1, "xpValue": 10 }`.
    *   `crCost`: Challenge Rating cost spent by the Encounter Director.
    *   `roleTags`: List of tags for encounter budgeting (e.g., `["appetizer"]` or `["protein"]`).
    *   `tags`: List of semantic matching tags (must be registered in `tag_registry.json`).

### 4.3 Interactive Scripting Conditions & Consequences
Both dialogue options and triggers use a shared set of condition predicates and consequence actions.

#### Condition Predicates (Zod Schema: `ConditionPredicateSchema`)
Used to gate dialogues, triggers, and reactions.
*   `{ "type": "is_player" }`
*   `{ "type": "faction_standing", "target": "town", "operator": ">=", "value": 10 }`
*   `{ "type": "has_fact", "target": "defeated_bandit_king" }`
*   `{ "type": "has_item", "itemId": "camp_sigil", "amount": 1 }`
*   `{ "type": "relationship_axis", "axis": "loyalty", "operator": ">=", "value": 50 }`

#### Consequence Actions (Zod Schema: `ConsequenceActionSchema`)
Mutates game state upon trigger firing, dialogue selection, or reaction resolution.
*   `{ "type": "spawn_entity", "entityTemplateId": "bandit_king", "targetId": "boss_spawn" }`
*   `{ "type": "apply_status", "statusId": "poisoned", "duration": 5 }`
*   `{ "type": "modify_standing", "factionId": "bandits", "amount": -20 }`
*   `{ "type": "grant_quest", "questId": "recover_sigil" }`
*   `{ "type": "set_fact", "target": "bandit_king_dead" }`

---

## 5. Walkthroughs of Default Campaign Features

The default campaign located in `public/data/campaigns/default/` serves as the feature showcase for modders.

### 5.1 Combat & Status Effects Walkthrough
*   **Concept**: Modders define status effects in `status.json` and attach them to items in `items.json`.
*   **Default Campaign Files**:
    *   `status.json`: Defines the `"poisoned"` status effect:
        ```json
        "poisoned": {
          "id": "poisoned",
          "name": "Poisoned",
          "duration": 10,
          "statModifiers": { "defense": -1 },
          "damagePerTurn": 1,
          "color": "#a6e3a1"
        }
        ```
    *   `items.json`: Defines a `"venom_dagger"` item. It features an `onHit` block applying the status:
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
*   **Concept**: Verbs (`apply`, `dip`, `throw`, `zap`) interact combinatorially using matchers in `reactions.json`.
*   **Default Campaign Files**:
    *   `reactions.json`: Defines the `altar_sacrifice` reaction. When an entity with the tag `"remains"` is `apply`ed to an entity with the tag `"altar"`, it consumes the remains and spawns a lightning wand:
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
*   **Concept**: Map areas spend a CR (Challenge Rating) budget based on encounter profile target allocations.
*   **Default Campaign Files**:
    *   `encounter_profiles.json`: Defines budget allocation weight between roles:
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
    *   `areas.json`: Defines Dungeon Level 1 with a total `crBudget` of `15`, using that profile:
        ```json
        "dungeon_1": {
          "id": "dungeon_1",
          "generatorType": "digger",
          "crBudget": 15,
          "encounterProfileId": "standard_dungeon"
        }
        ```
    *   `spawn_pools.json`: Maps candidates to role tags and CR costs. The Director selects candidates matching the role weights until the budget is spent:
        ```json
        "entities": {
          "goblin_scout": { "weight": 10, "crCost": 2, "role": "appetizer" },
          "orc_warrior": { "weight": 5, "crCost": 5, "role": "protein" }
        }
        ```

### 5.4 Narrative Triggers & Quests Walkthrough
*   **Concept**: Quests gate NPC dialogue nodes, and events tick quest objectives.
*   **Default Campaign Files**:
    *   `quests.json`: Defines the main quest `"recover_sigil"`:
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
    *   `triggers.json`: Listens for the Bandit King's death event to update the quest stage:
        ```json
        {
          "id": "king_defeated_trigger",
          "eventType": "EntityDied",
          "conditions": [
            { "type": "has_fact", "target": "killed_bandit_king" }
          ],
          "consequences": [
            { "type": "complete_quest", "questId": "recover_sigil" }
          ]
        }
        ```
