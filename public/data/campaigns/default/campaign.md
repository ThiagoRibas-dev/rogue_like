# 📖 MASTER CAMPAIGN SPECIFICATION: The Default Vertical Slice

> **Status:** Active Master Specification File (Version 1.0)  
> **Master Purpose:** This document serves as the authoritative blueprint, state ledger, and engineering roadmap for the Default Campaign. It details the structural design of the tutorial sandbox, and showcases all major engine features including quests, factions, triggers, hierarchy, and schemes.

---

## 🗺️ Part 1: Master Campaign Architecture & World Design

The Default Campaign is a compact, feature-rich sandbox designed to introduce players to the core mechanics of the engine, from movement and combat to advanced systemic interactions like factional infighting, environmental reactions, and procedural hierarchies.

### 📍 The Master Connection Graph

```mermaid
graph TD
    %% Safe Hub
    subgraph Town [The Safe Hub]
        safe_hub[Safe Hub <br> Danger: 0 | Static | START]
    end

    %% Wilderness
    safe_hub -->|Stairs Down| wilderness[Wilderness <br> Danger: 1 | Cellular]
    
    %% Dungeons
    subgraph Dungeon Crawl
        wilderness -->|Stairs Down| dungeon_1[Dungeon Level 1 <br> Danger: 1 | Digger]
        dungeon_1 -->|Stairs Down| dungeon_2[Dungeon Level 2 <br> Danger: 2 | DLA]
        dungeon_2 -->|Stairs Down| dungeon_3[Dungeon Level 3 <br> Danger: 3 | Cellular]
    end

    %% Bandit Stronghold (Boss)
    dungeon_2 -->|Portal| bandit_stronghold[Bandit Stronghold <br> Danger: 3 | Static Boss Arena]
```

---

## 🎯 Part 2: Active Development Tracks & Sprints

### 🟢 The Safe Hub
The player starts in the Safe Hub, a static town environment inhabited by friendly NPCs:
*   **The Merchant**: Runs a shop where players can buy and sell items.
*   **The Scholar**: A fount of knowledge about the Shrine Vault and altar mechanics.
*   **The Barkeeper**: A rumor-monger who can provide leads about the Bandit King.
*   **The Scout**: Explores the area and provides tips about the wilderness.
*   **Fail-Safe Triggers**: If key NPCs like the Barkeeper or Scholar are killed, the trigger system dynamically spawns a `barkeeper_note` or `scholar_journal` so the player can still discover critical quest information.

### 🟢 The Dungeon Crawl & Tutorials
The descent features three procedural levels using different generation algorithms (`digger`, `dla`, `cellular`):
*   **Environmental Reactions**: Players learn to throw explosive `potion_of_fire` flasks at flammable `web_trap` entities, triggering the `ignite_web` systemic reaction to clear a path.
*   **The Shrine Altar**: Players can interact with a divine `altar` entity, sacrificing `bones` (Monster Remains) to trigger the `altar_sacrifice` reaction, which spawns a powerful `wand_of_lightning`.

### 🟢 The Bandit King's Stronghold
A static boss arena branching off from Dungeon Level 2.
*   **The Boss Fight**: The heavily guarded keep is ruled by the **Bandit King**.
*   **The Camp Sigil**: Players must defeat the King, unlock his `wooden_chest`, and recover the stolen `camp_sigil` to complete the main quest.

---

## 🎭 Factions & Hostility Matrix (`factions.json`)

To showcase the faction system and systemic combat, the default campaign features 5 distinct factions:

1.  **`player`**: The protagonist's faction.
2.  **`town`**: Allied with `player`. Hostile to monsters and bandits.
3.  **`neutral`**: Non-combatants or untamed beasts.
4.  **`monster`**: Hostile to players, town, and bandits. (Includes orcs, goblins, trolls, spiders).
5.  **`bandits`**: Hostile to players, town, and monsters. (Includes bandits and the Bandit King).

The mutual hostility between `monster` and `bandits` means players can kite factions into each other to start massive emergent battles!

---

## ⚔️ The Nemesis Command Hierarchy (`nemesis_hierarchies.json`)

We showcase two distinct procedural nemesis hierarchies:
1.  **Monster Hierarchy**: Supports Orks and Goblins. Ranks scale from Grunt to War Chief, with promotion paths for regular monsters that slay the player.
2.  **Bandit Hierarchy**: Supports standard bandits. When bandits gain kills, they promote into Champions and Lieutenants, gaining unique titles (e.g. "the Cutthroat") and permanent physical scars (e.g. "slashed_face").

---

## 🕵️ Gossip & Knowledge (`rumor_propagation.json` & `dialogues.json`)

The campaign includes a fully functional rumor and knowledge brokering engine:
*   NPCs will dynamically gossip about the Bandit Stronghold and the Shrine Vault based on facts injected into the world state.
*   Players can use the `ask_about` dialogue engine to learn contextual lore from the Scholar and Barkeeper.
*   Interactions modify relationship axes (e.g., loyalty, respect) allowing players to befriend or anger NPCs.

---

## 🎒 Specialized Item & Loot Mechanics (`items.json`)

The default campaign acts as a vertical slice of all item capabilities:
*   **Melee & Ranged**: `short_sword`, `venom_dagger` (applies poison status on hit), `throwing_knife`.
*   **Armor & Containers**: `leather_armor`, `backpack` (increases carrying capacity).
*   **Consumables**: `potion_haste`, `scroll_fireball`, `food_ration`.
*   **Tools & Throwables**: `lockpick`, `potion_of_fire` (destroys on impact), wands (`wand_of_lightning`, `wand_of_fire`, `wand_of_cold` with cone and beam patterns).
*   **Quest Items**: `camp_sigil`, `bones`, lore notes, and journals.

---

## 🧩 Mastermind Schemes (`schemes.json` & `phase_blocks.json`)

The campaign incorporates the Scheme Compiler to drive background plots:
*   **Bandit Uprising**: The Bandit King enacts a plot scaling from `bandit_scout` to `bandit_raid`, scattering evidence like stolen goods and maps.
*   **Monster Invasion**: The monster horde expands from establishing outposts to full sieges.

---

## 🚀 Status

The Default Campaign Vertical Slice is **COMPLETE**. It successfully demonstrates every major subsystem in the engine declaratively through data files, serving as the ultimate template and testing ground for future modular campaigns.
