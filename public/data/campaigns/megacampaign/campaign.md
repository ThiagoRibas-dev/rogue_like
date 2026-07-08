# The Megadungeon

Welcome to **The Megadungeon**, a massive showcase campaign built to test the limits of our data-driven Engine.

## The Concept
The core idea behind this campaign was two-fold:
1. **Organic Stress Test:** We wanted to ensure our Entity-Component-System (ECS) and JSON data schemas were robust enough to handle thousands of entities, massive spawn pools, and complex cross-references without buckling.
2. **Feature Showcase:** We wanted to prove that the engine is truly data-driven by importing massive amounts of content from classic roguelikes without writing a single line of new engine code.

## How It Was Created
This campaign was generated entirely procedurally via a custom **Data Ingestion Pipeline** (`scripts/data_importers/run_pipeline.ts`). 

Instead of hand-writing JSON files, we wrote parser scripts that read the original C header files (`.h`) and raw data files (`.irh`) from two legendary open-source roguelikes:
* **NetHack (3.6.x):** Parsed via regex from `monsters.h` and `objects.h`.
* **Incursion:** Parsed via block extraction from `mon1-4.irh`, `weapons.irh`, and `dungeon.irh`.

The intermediate raw data was then fed into a central Compiler script. If both games featured the same entity (for example, a "Giant Ant" or a "Short Sword"), the compiler seamlessly deduplicated them, utilizing Incursion's more detailed records as the definitive source of truth.

## What is Represented
The compiler successfully translated thousands of records into our strict Zod schemas:

* **Over 1,000 Monsters:** Translated classic stats like NetHack's AC (Armor Class) into our Engine's Defense stat, and mapped Challenge Ratings (CR) into standardized attack profiles.
* **Smart AI Assignment:** The pipeline automatically flagged spellcasters, archers, and breath-weapon users (like Dragons) and assigned them our engine's `ranged_attacker` AI profile.
* **Hundreds of Items:** Standardized weapon damage, automatically generated consumable effects for potions and scrolls, and integrated everything into the tag registry.
* **Dungeon Generation:** Features a safe central Hub area that branches down into two massive 10-floor dungeons: a procedurally generated *Dungeons of Doom* (NetHack) using Cellular Automata and Digger algorithms, and static imported map layouts from *Incursion*.

## What Was Abstracted (For Now)
Because this was an MVP (Minimum Viable Product) import pass, some of the extreme complexities of the source games were standardized:
* **Complex Attack Routines:** Incursion's multi-line melee routines (e.g., *Bite 2d8, Claw 1d6, Tail Sweep 1d8*) were abstracted into a single, standardized melee `attack` integer based on the monster's Challenge Rating.
* **Conditional Logic:** Complex spawn conditions, highly specific magical item triggers, and esoteric immunities were skipped in favor of a stable, balanced baseline.

Enjoy the plunge into roguelike history!
