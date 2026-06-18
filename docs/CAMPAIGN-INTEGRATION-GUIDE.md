# Campaign Integration Guide

> **Purpose:** How to use the new trigger system features (`has_item`, `set_fact`, `change_faction`, `TileEntered`) in campaign JSON files to close the representational gaps identified in Phase 7.

---

## 1. `has_item` Condition Predicate

**Schema:** [`ConditionPredicateSchema`](src/types/trigger.types.ts:6)  
**Handler:** [`evaluateCondition()`](src/systems/trigger.system.ts:79)

### Purpose
Gates dialogue options, trigger reactions, and quest availability based on whether the player (or any entity) has a specific item in their inventory.

### JSON Shape
```json
{
  "type": "has_item",
  "itemId": "serpent_medallion",
  "amount": 1
}
```

### Fields
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `"has_item"` | — | The condition discriminator |
| `itemId` | `string` | — | The item ID from `items.json` to check for |
| `amount` | `number` | `1` | Minimum quantity required |

### Example: Gate a dialogue option behind having an item
```json
{
  "id": "give_constable_evidence",
  "text": "I found this journal — it proves you're compromised!",
  "conditions": [
    { "type": "has_item", "itemId": "cultist_journal", "amount": 1 }
  ],
  "consequences": [
    { "type": "consume_item", "targetId": "cultist_journal" },
    { "type": "set_fact", "target": "confronted_derek" }
  ],
  "nextNodeId": "constable_revealed"
}
```

### Example: Trigger something only when player has a quest item
```json
{
  "id": "enter_temple_with_chalice",
  "eventType": "TileEntered",
  "conditions": [
    { "type": "is_player" },
    { "type": "has_item", "itemId": "sacred_chalice", "amount": 1 }
  ],
  "consequences": [
    { "type": "emit_message", "text": "The chalice glows as you approach the altar..." },
    { "type": "set_fact", "target": "chalice_at_altar" }
  ]
}
```

---

## 2. `set_fact` Consequence

**Schema:** [`ConsequenceActionSchema`](src/types/trigger.types.ts:43)  
**Handler:** [`applyConsequence()`](src/systems/trigger.system.ts:170)

### Purpose
Sets a boolean fact on an NPC's `MemoryComponent.facts` array. This is the declarative replacement for `run_script` when you just need to record that something happened.

### JSON Shape
```json
{
  "type": "set_fact",
  "target": "took_mead"
}
```

### Fields
| Field | Type | Description |
|-------|------|-------------|
| `type` | `"set_fact"` | The consequence discriminator |
| `target` | `string` | The fact string to add to the memory's facts array |

### How It Works
The fact is set on the NPC whose memory is being evaluated (resolved via `_npcEntityId` or `entityId` from InjectedContext). In dialogue contexts, this is the NPC being talked to. In trigger contexts, it's the entity the trigger is running against.

### Example: Track player actions across the campaign
```json
{
  "id": "chalice_restored",
  "eventType": "ApplyResolved",
  "conditions": [
    { "type": "is_player" },
    { "type": "has_item", "itemId": "sacred_chalice" }
  ],
  "consequences": [
    { "type": "set_fact", "target": "chalice_returned_to_keep" },
    { "type": "complete_quest", "targetId": "chalice_quest" }
  ]
}
```

### Example: Flag a dialogue path as visited
```json
{
  "id": "asked_about_orlane",
  "text": "Have you heard anything strange from Orlane?",
  "consequences": [
    { "type": "set_fact", "target": "asked_about_orlane" }
  ],
  "nextNodeId": "barkeep_rumors"
}
```

Then later:
```json
{
  "id": "ask_again",
  "text": "Anything else about Orlane?",
  "conditions": [
    { "type": "has_fact", "target": "asked_about_orlane" }
  ],
  "consequences": [
    { "type": "set_fact", "target": "pressed_for_details" }
  ]
}
```

---

## 3. `change_faction` Consequence

**Schema:** [`ConsequenceActionSchema`](src/types/trigger.types.ts:43)  
**Handler:** [`applyConsequence()`](src/systems/trigger.system.ts:170)

### Purpose
Instantly swaps an entity's faction ID at runtime. This makes the hostility matrix re-evaluate the entity's stance — allies become enemies, neutrals become hostile, etc.

### JSON Shape
```json
{
  "type": "change_faction",
  "targetId": "constable_derek",
  "factionId": "cultists"
}
```

### Fields
| Field | Type | Description |
|-------|------|-------------|
| `type` | `"change_faction"` | The consequence discriminator |
| `targetId` | `string` (optional) | Entity ID to change. Omit to use the reaction target. |
| `factionId` | `string` | The target faction ID from `factions.json` |

### Example: Constable Derek faction swap
```json
{
  "id": "constable_revealed",
  "eventType": "DialogueSelected",
  "conditions": [
    { "type": "has_fact", "target": "confronted_derek" }
  ],
  "consequences": [
    {
      "type": "change_faction",
      "targetId": "constable_derek",
      "factionId": "cultists"
    },
    {
      "type": "spawn_entity",
      "entityTemplateId": "umbragen_zealot"
    },
    {
      "type": "emit_event",
      "eventType": "DebugTriggerTrace",
      "payload": { "message": "Derek betrays the player!" }
    }
  ]
}
```

### Example: Mercenary betrays the player
```json
{
  "id": "mercenary_betrayal",
  "eventType": "EntityDamaged",
  "conditions": [
    { "type": "has_fact", "target": "hired_orc_mercenary" }
  ],
  "consequences": [
    { "type": "change_faction", "targetId": "orc_mercenary_1", "factionId": "orcs" },
    { "type": "emit_message", "text": "The orc mercenary turns on you!" }
  ]
}
```

---

## 4. `TileEntered` Event (Already Implemented)

**Event Type:** [`GameEventType.TileEntered`](src/types/events.types.ts:17)  
**Emitted by:** [`movement.system.ts:149-156`](src/systems/movement.system.ts:149)  
**Trigger bucket routing:** [`trigger.system.ts:657`](src/systems/trigger.system.ts:657)

### Purpose
Fires a trigger when any entity steps onto a tile. The event carries `entityId`, `x`, `y`, and `tileTag` — the latter being each tag from the tile's definition in `tiles.json`.

### JSON Shape
```json
{
  "id": "step_on_altar",
  "eventType": "TileEntered",
  "conditions": [
    { "type": "is_player" }
  ],
  "consequences": [
    { "type": "emit_message", "text": "The altar hums with energy..." }
  ]
}
```

### Key Pattern: Filter by tile tag in conditions
Since `TileEntered` fires for each tag on a tile, you can react to specific tile types:

```json
{
  "id": "step_on_shallow_water",
  "eventType": "TileEntered",
  "conditions": [
    { "type": "is_player" }
  ],
  "consequences": [
    { "type": "apply_status", "statusId": "wet", "duration": 5, "targetId": "event.entityId" },
    { "type": "emit_message", "text": "You splash through the shallow water." }
  ]
}
```

### Example: Lock doors behind the player (Inn ambush)
```json
{
  "id": "inn_door_lock",
  "eventType": "TileEntered",
  "conditions": [
    { "type": "is_player" },
    { "type": "has_fact", "target": "took_mead" }
  ],
  "consequences": [
    { "type": "set_lock_state", "locked": true, "targetId": "inn_front_door" },
    { "type": "set_lock_state", "locked": true, "targetId": "inn_back_door" },
    { "type": "emit_message", "text": "The doors slam shut!" }
  ]
}
```

### Example: Detect when player enters a specific zone
```json
{
  "id": "enter_serpent_temple",
  "eventType": "TileEntered",
  "conditions": [
    { "type": "is_player" }
  ],
  "consequences": [
    { "type": "set_fact", "target": "entered_serpent_temple" },
    { "type": "grant_quest", "targetId": "explore_reptile_temple" }
  ]
}
```

---

## 5. Recommended Campaign Updates for Shroudgarde

### A) Replace `run_script` hacks with `set_fact`
Find any trigger that uses `run_script` just to set a fact like `state.addFact('took_mead')`. Replace it with:
```json
{ "type": "set_fact", "target": "took_mead" }
```

### B) Replace dialogue `run_script` with `has_item` condition
Find dialogue options that manually check for items. Replace with:
```json
"conditions": [{ "type": "has_item", "itemId": "cultist_journal" }]
```

### C) Add `change_faction` for Constable Derek betrayal
After the player confronts Constable Derek, fire a trigger that swaps his faction from `"citizens"` to `"cultists"`, making him immediately hostile.

### D) Add `TileEntered` triggers for the Inn ambush
Replace the current mead-drinking reaction lock with a `TileEntered` trigger that locks the inn doors when the player steps away from the bar (after having the `took_mead` fact).

---

## 6. Validation

After making any changes, run the campaign validator:
```bash
bun scripts/run-validator.ts --campaign-dir "public/data/campaigns/shroudgarde"
bun scripts/run-validator.ts --campaign-dir "public/data/campaigns/default"
```

Engine changes compile check:
```bash
bun x tsc --noEmit
```
