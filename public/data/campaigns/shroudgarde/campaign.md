# 📖 MASTER CAMPAIGN SPECIFICATION: The Shroudgarde Borderlands

> **Status:** Active Master Specification File (Version 2.2)  
> **Master Purpose:** This document serves as the authoritative blueprint, state ledger, and engineering roadmap for the entire campaign. It details the structural design of our open-world sandbox, and guides incremental development as we iteratively enhance each module track.
>
> ⚠️ **Development Context:** All five parallel tracks—**Keep on the Borderlands (B2)**, **Against the Cult of the Reptile God (N1)**, **The Ghost Tower of Inverness (C2)**, **The Water Temple (Zelda / ADOM)**, and **The Temple of Elemental Evil (ToEE)**—are fully implemented, integrated, and validated in the campaign database! The Shroudgarde Borderlands is now complete.

---

## 🗺️ Part 1: Master Campaign Architecture & World Design

The Shroudgarde Borderlands is a multi-track sandbox that weaves five classic modules together. The world design links them into a cohesive narrative where all roads lead back to **Shroudgarde Keep**.

### 📍 The Master Connection Graph (22 Connected Regions)

This visual layout illustrates how our static hubs, transition zones, and procedurally generated dungeons link together. 

```mermaid
graph TD
    %% Safe Hub Keep
    subgraph Shroudgarde Keep [Shroudgarde Keep & Town]
        shroudgarde_keep[Shroudgarde Governor Keep <br> Danger: 0 | Static]
        shroudgarde_courtyard[Shroudgarde Outer Bailey <br> Danger: 0 | Static | START]
        shroudgarde_gate[Shroudgarde Gatehouse <br> Danger: 0 | Static]
        
        shroudgarde_keep -->|Portal| shroudgarde_courtyard
        shroudgarde_courtyard -->|Portal| shroudgarde_gate
    end

    %% Wilderness Paths
    shroudgarde_gate -->|Northeast| forest_haunted[La Forêt Hantée <br> Danger: 1 | Cellular]
    shroudgarde_gate -->|Southeast| marsh_mirrored[The Mirrored Marsh <br> Danger: 2 | Cellular]
    shroudgarde_courtyard -->|East Portal| orlane_east[Orlane East Farms <br> Danger: 0 | Procedural Digger | FARMS]
    shroudgarde_gate -->|North Portal| road_to_nulb[The Road to Nulb <br> Danger: 1 | Cellular]

    %% Northeast Track (B2)
    subgraph Track 1: Keep on the Borderlands
        forest_haunted -->|Stairs Down| ravine_chaos[The Ravine of Chaos <br> Danger: 1 | Static Canyon]
        
        ravine_chaos -->|Cave A| cave_kobolds[The Kobold Warrens <br> Danger: 1 | Cellular]
        ravine_chaos -->|Cave B| cave_norkers[The Norker Lair <br> Danger: 2 | Digger]
        ravine_chaos -->|Cave C| cave_bugbears[The Bugbear Stronghold <br> Danger: 3 | Digger]
        ravine_chaos -->|Cave D| cave_scro[The Scro Outpost <br> Danger: 3 | Cellular]
        ravine_chaos -->|Cave E| cave_ogre[The Ogre's Den <br> Danger: 3 | Static Boss]
    end

    %% Southeast Track (N1)
    subgraph Track 2: Cult of the Reptile God
        marsh_mirrored -->|Portal| golden_grain_inn[The Golden Grain Inn <br> Danger: 2 | Static Ambush]
        golden_grain_inn -->|Stairs Down| shroudgarde_inn_cellar[The Inn Cellar <br> Danger: 2 | Static Key Room]
        shroudgarde_inn_cellar -->|Stairs Down| wet_caverns[The Wet Caverns <br> Danger: 3 | Cellular]
        wet_caverns -->|Serpent Gate Portal| reptile_temple[Temple of the Reptile God <br> Danger: 4 | Static Boss]
    end

    %% Ghost Tower of Inverness Track & Shortcuts
    subgraph Track 3: The Ghost Tower of Inverness
        marsh_mirrored -->|Portal| spire_level_air[Level of Air <br> Danger: 2 | Digger]
        spire_level_air -->|Stairs Down| spire_level_earth[Level of Earth <br> Danger: 3 | Digger]
        spire_level_earth -->|Stairs Down| spire_level_fire[Level of Fire <br> Danger: 3 | Static Lava]
        spire_level_fire -->|Stairs Down| spire_level_water[Level of Water <br> Danger: 3 | Digger Flooded]
        spire_level_water -->|Stairs Down| spire_gem_chamber[The Soul Gem Chamber <br> Danger: 4 | Static Boss]
    end

    %% Track 4: The Water Temple (Zelda / ADOM)
    subgraph Track 4: The Water Temple
        marsh_mirrored -->|Portal| water_temple_upper[Sluice Halls <br> Danger: 2 | Digger Flooded]
        water_temple_upper -->|Stairs Down| water_temple_lower[Submerged Caverns <br> Danger: 3 | Cellular Flooded]
        water_temple_lower -->|Portal| water_temple_core[Hydro-Core <br> Danger: 3 | Static Boss]
        water_temple_core -->|Portal| water_temple_valve_room[Sluice Valve <br> Danger: 3 | Static Valve]
    end

    %% Track 5: The Temple of Elemental Evil (ToEE)
    subgraph Track 5: The Temple of Elemental Evil
        road_to_nulb -->|Portal| moathouse_surface[The Ruined Moathouse <br> Danger: 1 | Static]
        moathouse_surface -->|Stairs Down| moathouse_dungeons[Moathouse Dungeons <br> Danger: 2 | Digger]
        moathouse_dungeons -->|Stairs Down| toee_level_1[ToEE Level 1: Earth <br> Danger: 2 | Digger]
        toee_level_1 -->|Stairs Down| toee_level_2[ToEE Level 2: Air <br> Danger: 3 | Digger]
        toee_level_2 -->|Stairs Down| toee_level_3[ToEE Level 3: Fire <br> Danger: 3 | Digger]
        toee_level_3 -->|Stairs Down| toee_level_4[ToEE Level 4: Water <br> Danger: 3 | Digger Flooded]
        toee_level_4 -->|Stairs Down| toee_zuggtmoy_fane[Fane of Zuggtmoy <br> Danger: 4 | Static Boss]
    end

    %% Shortcuts & Lateral portals
    cave_scro ==>|Secret Tunnel| spire_level_earth
    reptile_temple -.->|Direct Portal| wet_caverns
```

---

## 🎯 Part 2: Active Development Tracks & Sprints

### 🟢 SPRINT 1: Keep on the Borderlands (B2) — [COMPLETED]
We expanded the Caves of Chaos into **five discrete subterranean biomes** branching under a custom-mapped transition canyon:
*   **The Ravine of Chaos (`ravine_chaos`)**: Features an open static canyon layout placing five distinct cave entrances.
*   **The Kobold Warrens (`cave_kobolds`)**: High-evasion cellular combat featuring swift **Kobold Trap-Shifters**.
*   **The Norker Lair (`cave_norkers`)**: A structured fortress inhabited by armored, primitive **Norker Scouts**.
*   **The Bugbear Stronghold (`cave_bugbears`)**: A heavy fortress held by heavy-hitting **Bugbear Thugs**.
*   **The Scro Outpost (`cave_scro`)**: High-danger caverns populated by Spelljammer's militaristic **Scro Raiders**.
*   **The Ogre's Cave (`cave_ogre`)**: Handcrafted static cavern housing a rare chest guarded by the **Ogre Chieftain**.

### 🟢 SPRINT 2: Against the Cult of the Reptile God (N1) — [COMPLETED]
We implemented the psychological horror and subversion mystery of Orlane, adding a unique procedural spin to make the investigation highly replayable:
*   **Procedural Cottage Generators**: Set **Orlane East Farms** (`orlane_east`) to use your engine's `digger` generator with `grass_floor` and `dense_trees` palettes. It procedurally compiles a different village layout on every run—scattering random cottages connected by grassy pathways in the woods!
*   **The \"Who is the Cultist?\" Roulette**: Programmed the farms to dynamically spawn a mix of **Terrified Peasants** (who give you food/potions) and **Dazed Farmhands** (subverted spies). Their locations, numbers, and house contents are fully randomized on every playthrough!
*   **The Gaslighting Authority**: Placed **Constable Derek** in Shroudgarde's Outer Bailey. He lies about the swamp, but confronting him with evidence breaks his trance and transforms him into an aggressive **Umbragen Zealot**!
*   **The Spiced Mead Ambush**: Placed **Barkeep Bertram** in the Golden Grain Inn. Taking his free "Frontier Spiced Mead" and drinking it applies a custom `stun` status, slams the front doors locked (`set_lock_state`), and spawns an **Umbragen Zealot** ambush!
*   **The Serpent Medallion progression**: Locked the final Temple behind the pick-proof **Serpent Gate** (`difficulty: 999`). Players must survive the Inn ambush, slip into **The Inn Cellar**, and recover the **Serpent Medallion** (`serpent_medallion`) from a locked chest to open the gate.

### 🟢 SPRINT 3: The Ghost Tower of Inverness (C2) — [COMPLETED]
We fully implemented the elemental crawl and gothic sci-fantasy climb of Inverness:
*   **The Four Elemental Wards**: Created four distinct vertical dungeons branching from the marsh, each representing an elemental sphere:
    *   *Level of Air*: High-speed, windy vaults populated by flying **Gargoyles of Air**.
    *   *Level of Earth*: Stonewall halls held by lumbering **Clay Golems** and clockwork sentinels.
    *   *Level of Fire*: Handcrafted fire-chambers covered in **Fire Fields** and defended by lava-born **Fire Salamanders**.
    *   *Level of Water*: Submerged procedural passages utilizing the `flooded` sub-biome tag and deep water tiles.
*   **The Sentinel of Imues**: The final **Soul Gem Chamber** is a static boss arena containing the ultimate clockwork boss **Sentinel of Imues**, guarding the chest holding the legendary **Soul Gem of Inverness**!
*   **The Subterranean Fissure**: Connected the deep Scro Outpost directly into the **Level of Earth** via the Secret Tunnel portal, representing an underground breach into the tower's foundations!

### 🟢 SPRINT 4: The Water Temple (Zelda / ADOM) — [COMPLETED]
We implemented the hydrology-manipulating, frog-demon infested crawl of the Water Temple:
*   **Deep Water Hydrology**: Created the Sluice Halls and the Submerged Caverns—cellular and digger zones containing up to **80% water tiles** (`subBiomes: flooded`), restricting player movements in heavy physical fights.
*   **The Vodyanoi Tribe**: Populated the chambers with amphibious, fey frog-demons: the stealthy **Vodyanoi Raiders** (carrying trident spears) and the mutated giant boss **Vodyanoi Lurker**.
*   **The Drainage Valve Puzzle**: Locked behind a heavy mechanical **Leaking Drainage Valve** entity inside the valve chamber. Players must defeat the Lurker to retrieve the Sluice Key, bypass the gate, and open the valve—triggering a systemic reaction that sets the global state fact `"temple_drained"` and yields the legendary **Trident of the Tides**!

### 🟢 SPRINT 5: The Temple of Elemental Evil (ToEE) — [COMPLETED]
We implemented the massive, crawling mega-dungeon of Hommlet and Nulb:
*   **The Ruined Moathouse Outpost**: Built a two-tier static surface and procedural dungeon holding the cult's outpost. It is led by the charismatic boss **Lareth the Beautiful**, who wields the **Staff of Lareth**.
*   **The Four Elemental Temples**: Replicated the core layout of ToEE with four vertically descending levels representing Romag's Earth Temple, Alrrem's Air Temple, Hedrack's Fire Temple, and Belsornig's Water Cult—each populated by their respective elemental forces and cultists.
*   **Banishment of Zuggtmoy**: The final **Fane of Zuggtmoy** is a handcrafted boss room housing the ultimate boss **Zuggtmoy**, guarding the vault where players must reclaim the **Fungal Spore Potions** and seal her back to the Abyss!

---

## 📁 Region Directory Map

| Area ID | Area Name | Generator | Danger Rating | Tags / Sub-Biomes | Core Entities & Role |
|:---|:---|:---|:---:|:---|:---|
| `shroudgarde_inner_keep` | Shroudgarde Governor Keep | `static` | 0 | `hub`, `safe` | Gold Dwarf Laurent (Mayor). The heavily guarded throne room of the Keep. |
| `shroudgarde_courtyard` | Shroudgarde Outer Bailey | `static` | 0 | `hub`, `safe` | Luc's Smithy, Isabelle's Chapel (healing fountain), Constable Derek, Elan Villagers. [START AREA] |
| `orlane_east` | Orlane East Farms | `digger` | 0 | `farms`, `safe` | Procedural Farms! cottage 'rooms' randomly scattered in the woods. Roaming terrified/dazed peasants. |
| `shroudgarde_gate` | Shroudgarde Gatehouse | `static` | 0 | `hub`, `safe` | Fortified entrance barbican connecting Shroudgarde to the outer wildernesses. |
| `forest_haunted` | La Forêt Hantée | `cellular` | 1 | `forest`, `early_game` | Worghests, Grippli Hunters. The spooky forest buffer region. |
| `ravine_chaos` | The Ravine of Chaos | `static` | 1 | `canyon`, `early_game` | Visual vertical ravine with 5 cave portal entrances branching to different tribes. |
| `cave_kobolds` | The Kobold Warrens | `cellular` | 1 | `cave`, `early_game` | Kobold Trap-Shifters, hidden pressure plates. High-evasion battles. |
| `cave_norkers` | The Norker Lair | `digger` | 2 | `cave`, `early_game` | Norker Scouts/Slingers (Goblins). Heavily fortified cavern fortress. |
| `cave_bugbears` | The Bugbear Stronghold | `digger` | 3 | `cave`, `mid_game` | Bugbear Thugs. Dense physical traps and aggressive monster patrols. |
| `cave_scro` | The Scro Outpost | `cellular` | 3 | `cave`, `mid_game` | Scro Raiders, Scro Warmages (Orcs). Militaristic army camp with a secret shortcut. |
| `cave_ogre` | The Ogre's Den | `static` | 3 | `cave`, `mid_game` | Boss: Ogre Brute. Static cavern protecting heavy loot chests. |
| `marsh_mirrored` | The Mirrored Marsh | `cellular` | 2 | `swamp`, `mid_game` | Saurian Shifters, swamp vipers. Slow, restrictive swamp tiles. |
| `golden_grain_inn`| The Golden Grain Inn | `static` | 2 | `swamp`, `mid_game` | Ambush tavern, Barkeep Bertram, locking gates, Umbragen Zealots. |
| `shroudgarde_inn_cellar`| The Inn Cellar | `static` | 2 | `cave`, `mid_game` | Static cellar room protecting the locked chest with the Serpent Medallion. |
| `wet_caverns` | The Wet Caverns | `cellular` | 3 | `cave`, `flooded` | Submerged caverns leading to the temple backway, guarded by the Serpent Gate. |
| `reptile_temple` | Temple of the Reptile God| `static` | 4 | `boss` | Boss: Duthka'gith High Priest, Umbragen Zealots, altar. |
| `spire_level_air` | Level of Air | `digger` | 2 | `air`, `early_game` | Gargoyles of Air. Breezy, high-speed procedural pits. |
| `spire_level_earth` | Level of Earth | `digger` | 3 | `earth`, `mid_game` | Clay Golems, Exiled Modrons. Solid, heavy stone procedural vaults. Connects to Scro Outpost. |
| `spire_level_fire` | Level of Fire | `static` | 3 | `fire_level`, `mid_game` | Fire Salamanders, fire fields, intense lava heat static map. |
| `spire_level_water` | Level of Water | `digger` | 3 | `dungeon`, `flooded` | Exiled Modrons, saurian shifters. Deeply flooded procedural dungeons. |
| `spire_gem_chamber` | The Soul Gem Chamber | `static` | 4 | `dungeon`, `boss` | Boss: Sentinel of Imues, golden chest containing the Soul Gem of Inverness. |
| `water_temple_upper` | Sluice Halls | `digger` | 2 | `vodyanoi_domain`, `early_game` | Vodyanoi Raiders, water hazards. Flooded hallways. |
| `water_temple_lower` | Submerged Caverns | `cellular` | 3 | `vodyanoi_domain`, `mid_game` | Vodyanoi Raiders, swamp vipers. Deeply flooded caverns with heavy movement costs. |
| `water_temple_core` | Hydro-Core | `static` | 3 | `vodyanoi_domain`, `mid_game` | Boss: Vodyanoi Lurker. Flooded boss chamber blocking access to the drainage room. |
| `water_temple_valve_room`| Sluice Valve | `static` | 3 | `vodyanoi_domain`, `mid_game` | Drainage Valve, Gilded chest containing the Trident of the Tides. |
| `road_to_nulb` | The Road to Nulb | `cellular` | 1 | `forest`, `early_game` | Bandits, giant frogs. The wilderness highway to Nulb. |
| `moathouse_surface` | The Ruined Moathouse | `static` | 1 | `moathouse`, `early_game` | Ruined stone moathouse barbican. |
| `moathouse_dungeons` | Moathouse Dungeons | `digger` | 2 | `moathouse`, `early_game` | Boss: Lareth the Beautiful. Cult outpost hiding treasure chest. |
| `toee_level_1` | ToEE: Earth Temple | `digger` | 2 | `toee_earth`, `mid_game` | Romag's Earth Cult. Solid subterranean vaults. |
| `toee_level_2` | ToEE: Air Temple | `digger` | 3 | `air`, `mid_game` | Alrrem's Air Cult. Breezy chambers and gargoyles. |
| `toee_level_3` | ToEE: Fire Temple | `digger` | 3 | `toee_fire`, `mid_game` | Hedrack's Fire Cult. Burning stone halls and salamanders. |
| `toee_level_4` | ToEE: Water Temple | `digger` | 3 | `vodyanoi_domain`, `mid_game` | Belsornig's Water Cult. Deeply flooded procedural dungeons. |
| `toee_zuggtmoy_fane` | Fane of Zuggtmoy | `static` | 4 | `toee`, `boss` | Boss: Zuggtmoy, Demon Queen of Fungi. Sealed static fane. |

---

## 🎭 Factions & Hostility Matrix (`factions.json`)

To represent the iconic faction infighting of B2 and ToEE, we configured a complete, symmetric 7-way hostility matrix:

1.  **`player`**: Allied with `citizens`. Hostile to beasts, goblins (Norkers), orcs (Scro), cultists, and bugbears.
2.  **`citizens`**: Allied with `player`. Hostile to all monsters, cultists, and bugbears.
3.  **`beasts`**: Hostile to **all** other factions.
4.  **`goblins` (Norker Tribe)**: Hostile to players, citizens, beasts, cultists, and **mutually hostile to Orcs (`orcs`) and Bugbears (`bugbears`)**.
5.  **`orcs` (Scro Empire)**: Hostile to players, citizens, beasts, cultists, and **mutually hostile to Goblins (`goblins`) and Bugbears (`bugbears`)**.
6.  **`bugbears` (Bugbear Stronghold)**: Hostile to players, citizens, beasts, cultists, and **mutually hostile to Goblins (`goblins`) and Orcs (`orcs`)**.
7.  **`cultists`**: Hostile to all factions outside their temple. Attempting to subvert the frontier.

---

## 🎒 Specialized Loot Table (`items.json`)

Exotic items sourced directly from TTRPG rulesets have been added to the progression:

*   **Owlbear Feather-Mail (`owlbear_feather_mail`)**: Heavy armor sown from the razor-sharp quills of the Owlbear. Equipped in the `torso` slot (+3 Defense, +10 Max HP).
*   **Thri-Kreen Gythka (`thri_kreen_gythka`)**: Double-bladed polearm. Equipped in `hand` (+5 Attack, +3 Weight load).
*   **Modron Gear-Shield (`modron_gear_shield`)**: Interlocking mechanical shield. Equipped in `hand` (+3 Defense, +3 Carry Capacity).
*   **Saurian Venom-Spear (`saurian_venom_spear`)**: Lizardfolk spear. Equipped in `hand` (+3 Attack, applies `poison` status for 5 turns on hit).
*   **Alchemist's Frost-Flask (`frost_flask`)**: Throwable splash potion that deals area damage and inflicts the `stun` (frozen) status.
*   **Serpent Medallion (`serpent_medallion`)**: The coiled copper amulet required to bypass the Serpent Gate protecting the boss temple.
*   **Frontier Spiced Mead (`frontier_mead`)**: Spiced tavern draft. Inflicts the `stun` (poisoned stupor) status on players, launching the Inn ambush.
*   **Trident of the Tides (`trident_of_tides`)**: Ornate, pearl-inlaid polearm. Yields +4 Attack, +1 Defense, +10 Max HP, and applies poison status on hit.
*   **Hydrology Sluice Key (`sluice_key`)**: Heavy iron key bearing water drop engravings. Required to unlock the Temple's main Sluice Valve.
*   **Staff of Lareth (`lareth_staff`)**: Platinum-headed mace-staff. Yields +3 Attack, +2 Defense, +5 Max HP, and applies haste on hit.
*   **Fungal Spore Potion (`fungal_potion`)**: Throwable chemical grenade that releases a choking cloud of poison gas.

---

## 📜 Part 3: Comparative Alignment Reports

### 1. Keep on the Borderlands (B2)
We represented Gygax's legendary frontier keep in a highly detailed multi-zone format:
*   **Three Keep Sectors**: Mapped Shroudgarde as three static sectors: **The Barbican Gate**, **The Outer Bailey** (smithy, chapel, tavern), and **The Governor Keep**.
*   **Caves of Chaos**: Mapped five distinct cave openings branching from the static **Ravine of Chaos** canyon. Populated them with **Norkers**, **Scro**, **Bugbears**, and a static **Ogre's Den**.
*   **Three-Way Cave Wars**: Set up mutually hostile parameters between goblins, orcs, and bugbears inside the caves to encourage systemic, emergent monster combat.

### 2. Against the Cult of the Reptile God (N1)
We translated Orlane’s creeping horror and subversion mystery into reactive, trigger-based mechanics:
*   **Procedural Village & Roulette**: Set **Orlane East Farms** to use a procedural `digger` generator utilizing grass/dense-trees palettes. It randomly scatters cottage clearings inhabited by a randomized roulette of **Terrified Peasants** (loyal allies) and **Dazed Farmhands** (undercover spies).
*   **The Gaslight Constable**: Placed **Constable Derek** in town. Questioning him gates his lies, but confronting him with evidence breaks his trance, causing him to instantly transform into a hostile **Umbragen Zealot** in real-time.
*   **The Spiced Mead Tavern Ambush**: Bertram offers you poisoned spiced mead. Drinking it triggers a custom priority reaction (`drink_toxic_mead` | `priority: 150`) that stuns you, locks the doors, and spawns a zealot ambush.

### 3. The Ghost Tower of Inverness (C2)
*   **Modular Tower Stacking**: Built as a soaring, 5-level tower stack representing five distinct elemental/puzzle floors.
*   **The Elemental Wards**: Standard dungeon crawls are converted into thematic, physical chambers (Air, Earth, Fire, Water, and the Soul Gem Core), culminating in the **Sentinel of Imues** boss.

### 4. The Water Temple (Zelda / ADOM)
*   **Deep Water Sluices**: Created heavily flooded cellular and digger zones (up to 80% water tiles) that restrict movement.
*   **Amphibious Vodyanoi**: Inhabited by **Vodyanoi Raiders** and the giant boss **Vodyanoi Lurker**, who drop the **Sluice Key** to unlock the **Sluice Valve** and reclaim the **Trident of the Tides**.

### 5. The Temple of Elemental Evil (ToEE)
*   **The Moathouse Outpost**: Mapped as a two-tier static watchtower surface and a procedural dungeon. It is guarded by **Lareth the Beautiful**, who wields the **Staff of Lareth**.
*   **Four Elemental Temple Levels**: Features four vertically descending procedural levels representing Romag's Earth Temple, Alrrem's Air Temple, Hedrack's Fire Temple, and Belsornig's Water Temple.
*   **The Prison of Zuggtmoy**: Holds the final fane of the Abyssal Demon Queen, statically placing her at her altar guarding her fungal treasure vaults.

---

## 🔍 Part 4: Representational Limits & Gaps

We encountered several hard operational limits inside the core engine:
1.  **No-Economy Town**: The hub has no functioning trade or barter. Gear must be given away via dialogues rather than commercial merchant screens.
2.  **No Direct Inventory Dialogue Gating**: Dialogues cannot directly scan player inventory IDs, requiring quests to act as intermediate verifiers.
3.  **No Static Coordinate Step Triggers**: We cannot easily execute a script simply by stepping on a coordinate; we had to link these events to the item-use reaction of the spiced mead.
4.  **No Floor Tile Reactions**: Basic floor tiles do not support standard reaction verbs like `dip` or `ignite`.
5.  **Sequential Quest Chains**: Quests are strictly linear with no option for branching or OR-gate resolutions.

---

## 🛠️ Part 5: Next-Gen Engine Roadmap (TypeScript Specifications)

The following development tickets define the exact TypeScript and Zod schema extensions needed to upgrade the engine in future iterations:

### 🎫 Ticket #1: Merchant Barter & Currency System
*   **Zod Schema Extension**:
    ```typescript
    export const ShopComponentSchema = z.object({
      buyMultiplier: z.number().default(1.5),
      sellMultiplier: z.number().default(0.5),
      itemInventory: z.array(z.string())
    });
    ```
*   **Engine Update**: Implement `ShopIntent` processing. Query the player's bag for `tags: ["currency:gold"]` to deduct funds.

### 🎫 Ticket #2: Direct Inventory Predicates — [RESOLVED]
*   **Trigger Condition Extension**:
    ```typescript
    z.object({ type: z.literal('has_item'), itemId: z.string(), amount: z.number().default(1) })
    ```
*   **Engine Update**: Update `evaluateCondition()` to scan the player's active inventory component for the specified item ID.

### 🎫 Ticket #3: Environmental Tile-Based Reactions
*   **Reaction Matcher Extension**:
    ```typescript
    export const ReactionTargetMatcherSchema = z.object({
      targetType: z.enum(['entity', 'tile']),
      tags: z.array(z.string()).optional()
    });
    ```
*   **Engine Update**: Resolve actions targeting coordinates, fetch the tile definition from `tiles.json`, and run reactions against tile tags (e.g., throwing a torch on an `'oil'` tile spawns a fire field).

### 🎫 Ticket #4: Quest Objective Logical Gates (OR-Gates)
*   **Quest Structure Extension**:
    ```typescript
    export const QuestSchema = z.object({
      id: z.string(),
      logicalOperator: z.enum(['AND', 'OR']).default('AND'),
      objectives: z.array(QuestObjectiveSchema)
    });
    ```
*   **Engine Update**: If `logicalOperator` is `'OR'`, evaluate the quest as completed as soon as *any single* objective in the array is fulfilled.

### 🎫 Ticket #5: Tile Step Coordinate Event & triggers — [RESOLVED]
*   **Event Pattern Extension**: Add `TileEntered` to `GameEventType`.
*   **Engine Update**: When the player steps on a grid coordinate, fire a `TileEntered` trigger. If the coordinates match a registered trap trigger in `triggers.json`, run the associated consequence (such as setting adjacent door locks to true).

### 🎫 Ticket #6: Hidden NPC States & "Faction Swapping" Consequence — [RESOLVED]
*   **Consequence Action Extension**:
    ```typescript
    z.object({
      type: z.literal('change_faction'),
      targetId: z.string().optional(),
      factionId: z.string()
    })
    ```
*   **Engine Update**: Implement `change_faction` to instantly swap an entity's `faction` string (e.g. swapping Constable Derek from `"citizens"` to `"cultists"` in real-time, instantly making him hostile to the player).

### 🎫 Ticket #7: Dialogue Option Fact-Injectors — [RESOLVED]
*   **Consequence Action Extension**:
    ```typescript
    z.object({
      type: z.literal('set_fact'),
      target: z.string()
    })
    ```
*   **Engine Update**: Avoids needing a custom `run_script` code string like `state.addFact('took_mead')` by making fact-setting a first-class, declarative consequence in the schema.


### 🎫 Ticket #8: Decoupled Quest Loot & Static Chest Inventories
*   **The Issue**: The engine's `wooden_chest` templates spawn randomized loot, but do not support a static `placedInventory` array inside `areas.json` to lock a specific quest item (like the `soul_gem`) inside a specific coordinates chest.
*   **Engine Update**: Update the chest spawner in `map.system.ts`. If an entity has an `inventory` block in `placedEntities` within `areas.json`, load those specific item IDs directly into its container instead of rolling on the global loot table.

### 🎫 Ticket #9: Procedural Portal & Glyph Auto-Placement (Flat-Level Transitions) — [RESOLVED]
*   **The Issue**: Currently, procedural generators only support auto-placing transitions for `"direction": "up"` (spawns stairs up `<`) and `"direction": "down"` (spawns stairs down `>`). If a procedural area is on the same flat level as its connection (e.g. Orlane East Farms), spawning stair glyphs breaks immersion. The engine does not support auto-placing lateral `"portal"` connections in procedural rooms.
*   **Engine Update**: Update `AreaConnectionSchema` and the generator in `builder.ts` to support auto-placing portals in procedural maps. 
    1.  Allow `"direction": "portal"` inside procedural connections.
    2.  Add an optional `portalTemplateId` (e.g., `"wooden_door"` or `"gate"`) to `AreaConnectionSchema`.
    3.  During map generation, if a connection uses `"direction": "portal"`, the builder selects a random edge or room wall tile, spawns the entity specified by `portalTemplateId`, and attaches a `PortalComponent` pointing to the target area.
