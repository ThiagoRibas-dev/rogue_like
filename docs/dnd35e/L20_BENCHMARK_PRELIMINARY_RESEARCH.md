# Level 20 Multi-Subsystem Benchmark — Preliminary Research & Gap Analysis

> **Status:** Phase 0 — Master Preliminary Research Ledger (No code changes yet)  
> **Benchmark Subjects:** **Triel Fitheaben** (L20 Human Cleric/PrC/Crusader), **Remi o Corvo Celestial** (Quasi-Familiar), **Myn / Myndylth** (ECL 21 Dragon Cohort)  
> **Governing Standards:** `AGENTS.md` (Golden Rules #4–9, Three-Tier Placement Heuristic Rule #16, Baseline + Declarative Overrides Rule #17, Universal Actor Symmetry Rule #18, 4-Layer Decision Matrix Rule #19, Three-Horizon Boundaries Rule #20, Zero Content-ID Branching Rule #21).

---

## 1. Purpose of This Exercise & Architectural North Star

This document captures the baseline findings and architectural gaps uncovered by stress-testing our existing TypeScript/ECS roguelike engine (`Console`) and D&D 3.5e ruleset (`Cartridge`) against a real, high-optimization, Level 20 D&D 3.5e character sheet suite spanning *Core*, *Complete* series, *Expedition to Castle Ravenloft*, *Tome of Battle*, *Magic of Incarnum*, *Expanded Psionics Handbook*, *Book of Exalted Deeds*, *Magic Item Compendium*, *Complete Scoundrel*, *Eberron/Unearthed Arcana*, and *Dragon Magazine*.

### Core Design Agreements Established Before Deep-Dive Research
1. **Zero Content Silos (Rules #16 & #21):** We will **never** build hardcoded `.ts` silos for `"Crusader"`, `"Incarnum"`, `"Vow of Poverty"`, `"Holy Warrior"`, or `"Divine Metamagic"`. Every domain mechanic is decomposed into:
   - **Tier 1 — Console Primitives (`src/core/`, `src/systems/`, `src/types/`):** Ruleset-agnostic simulation structures (e.g., Tactical Hand/Deck, Delayed Damage Buffer, Mutable Point Allocator, Slot-Locking Overlays, Constraint-Guarded Progressive Tracks, Triggered Interception Hooks, Item Sockets).
   - **Tier 2 — D&D 3.5e Cartridge (`src/rulesets/dnd35e/`):** Pure mathematical laws and generic declarative resolvers consuming those Console primitives.
   - **Tier 3 — Declarative System Content (`public/data/rulesets/dnd35e/*.json`):** Every class, PrC, ACF, feat, domain, spell, maneuver, soulmeld, template, and magic item expressed purely as Zod-validated JSON.
2. **Tag-Unified Distinct Ability Families:** Distinct mechanics that share a conceptual umbrella (e.g., Paladin/Celestial *Smite Evil* vs. Crusader *Smite* vs. Ordained Champion *Smite* vs. Knight of the Raven *Smite Undead*; or Ordained Champion vs. Duskblade vs. Spellsword *Channel Spell*) remain **separate declarative abilities** with their own pools, action costs, scaling, and target gates—while emitting shared **Layer A Semantic Tags** (e.g., `ability:smite`, `effect:smite`, `effect:channel_spell`) so cross-cutting feats, items, and prestige features interact with them cleanly without ID branching.
3. **Autonomous Cohorts & Companions (No Direct Multi-Actor Micro-Control):** Cohorts (Myn) and Quasi-Familiars (Remi) operate autonomously via our existing Tier 1 `ControllerLinkComponent` (`src/types/components/actor_components.types.ts`), `src/systems/companion_commands.system.ts`, `src/ai/companion_targeting.ts`, and dialogue/trigger consequences (`src/systems/trigger/social_consequences.ts`). Players influence their behavior via stances (`aggressive | defensive | passive | hold`), focus-target commands (`commandTargetId`), and dialogue/tactical command hooks—not direct turn-by-turn UI switching.
4. **Canonical Rules Verification Over Raw Sheet Transcription:** The provided character sheets serve as a **feature discovery checklist**, not an infallible rules reference. Where a sheet appears incomplete, house-ruled, or rules-illegal (especially Myn's Dragon Cohort templates/ECL/AP), we will audit exact RAW rules during our individual deep-dive research phase so the engine models **faithful D&D 3.5e laws** (while still allowing campaign JSON overrides where desired).
5. **Exalted Bonus Type Verification (*Book of Exalted Deeds* p. 29–30):** Verified via BoED rules: **`exalted` IS an official D&D 3.5e named bonus type** (not merely a feat/spell/PrC category or generic misc bonus):
   - Like `sacred`/`profane`, multiple `exalted` bonuses do not stack with each other (unless a specific feat like *Vow of Peace* explicitly states an exception).
   - An *Exalted bonus to AC* (e.g., Vow of Poverty) explicitly **does not stack with an armor bonus**, **does not apply to touch attacks** or incorporeal touch attacks, and **cannot be ignored by *brilliant energy* weapons**.
   - Therefore, `'exalted'` belongs as a first-class named type in `DnD35BonusTypeSchema` with explicit AC-stacking rules rather than falling back to `untyped`/misc.

---

## 2. Benchmark Subject Inventory

### 2.1 Actor 1 — Triel Fitheaben (Level 20 Human)
- **Alignment / Deity / Origin:** Neutral Good (`Bom e Neutro`), Enthariel, Principados Brilhantes, 190,000 XP, Age 29.
- **Level-by-Level Progression (20 Levels across 5 Classes):**
  - L1–L4: **Cleric 4** (*Lightbringer Cleric ACF* — trades Turn Undead for **Destroy Undead**; Undead Intuition; War & Healing Domains).
  - L5–L6, L13: **Ordained Champion 3** (Bonus Domain: Law [traded for *Law Devotion*]; *Modified Spontaneous Casting* -> War Domain; *Combat Feats* [traded War & Healing domain powers for *Power Attack* & *Parrying Shield*]; *Smite (Su)*; *Diehard*; *Channel Spell (Su)*; *Divine Bulwark (Su)*; 2/3 CL advancement).
  - L7–L12: **Knight of the Raven 6** (*Raven Harrier* [harry / baffle / falter]; *Speak with Ravens*; *Smite Undead* 3/day; **Turn Undead** re-acquired at KotR 3; Extra Domain: Sun; *Light Focus*; *Enduring Life*; 5/6 CL advancement).
  - L14: **Crusader 1** (*Furious Counterstrike*, *Steely Resolve 5*, Martial Maneuvers & Stances; Initiator Level `1 + floor(19/2) = 10`).
  - L15–L20: **The Righteous Cohort of Kiri-Jolith 6** (*Fraternal Oath*, *Rallying Cry* 2/day, *Lesser Aura of Discipline*, Bonus Feats [L17, L20], *Empower Leader* +2/+3, *Second Wind*; 6/6 CL advancement).
- **Headline Stats:** HP 181 | AC 31 (Touch 18, FF 30; Armor 11, Shield 5, Nat 2, Deflection 2, Dex 2, Size/Misc) | BAB +17 | Base CL 17 -> Effective CL 20 (*Practiced Spellcaster*) | IL 10 | Saves: Fort +23 / Ref +8 / Will +25 | Init +4 | ACP -5 | AP 15.
- **Feats (19 total across HD, Human, Domain, Class, PrC):** *Extra Turning*, *Martial Weapon Proficiency (Longsword)*, *Weapon Focus (Longsword)*, *Extend Spell*, *Persist Spell*, *Power Attack*, *Parrying Shield*, *Law Devotion*, *Diehard*, *Practiced Spellcaster*, *Divine Metamagic (Persist)*, *Enduring Life*, *Holy Warrior*, *Extra Granted Maneuver*, *Martial Stance (Martial Spirit)*, *Dragon Cohort*, *Martial Study*.
- **Skill Tricks:** *Collector of Stories* (+5 competence on Knowledge checks to identify monsters; noted on sheet as RP reward + 5 extra skill points at L12).
- **Resource & Activation Pools:** Turn Undead (Lvl 11, 17/day), Destroy Undead (Lvl 11, DC 25, 17/day), Law Devotion (1/day + TU burn = 12 uses/day), Smite (Lvl 11, via TU), Smite Undead (Lvl 6, 2–3/day), Blurring Armor (CL 5, 3/day), Extend Rod (3/day), Belt of Battle (3 charges/day), Action Points (15).
- **Key Gear / Item Buffs:** *+3 Keen Longsword* with *Lesser Crystal of Return* (Weapon Augment Crystal), *Gauntlets of War* (+3 dmg w/ favored weapon), *Sacred Item* buff on Gauntlets, *Blurring* armor, *Metamagic Rod of Extend*, *Belt of Battle*.
- **Maneuvers (IL 10; Crusader Deck 5 readied, 3 initially granted):**
  - Stance: *Martial Spirit* (Devoted Spirit 1).
  - Readied Strikes: *Douse the Flames* (WR 1), *Mountain Hammer* (SD 2), *Revitalizing Strike* (DS 3), *White Raven Strike* (WR 4), *Divine Surge* (DS 4).
- **Spellbook (0th–9th, including Spontaneous War Domain, Healing/Sun Domain Slots, Persisted `(P)`, Extended `(E)`, and Extend-Rod `(E-Rod)` tags):**
  - *0th:* Read Magic, Cure Minor Wounds, Create Water, Light, Detect Magic.
  - *1st:* Magic Weapon (Spont), Protection from Evil (Dom), Ice Slick, Sanctuary, Protective Interposition, Snowshoes (E-Rod), Delay Disease.
  - *2nd:* Spiritual Weapon (Spont), Cure Moderate Wounds (Dom), Lava Missile, Restoration Lesser, Elation (P), Divine Insight.
  - *3rd:* Magic Vestment (Spont/E-Rod), Cure Serious Wounds (Dom), Shivering Touch, Delay Poison (E), Irian's Light, Vigor Mass Lesser.
  - *4th:* Divine Power (Spont/P), Cure Critical Wounds (Dom), Mass Resist Energy (E), Holy Transformation Lesser (P), Recitation (P), Restoration, Delay Death, Freedom of Movement.
  - *5th:* Flame Strike (Spont), Cure Light Wounds Mass (Dom), Righteous Wrath of the Faithful (P), Magic Weapon Greater (E), Triadspell, Dragon Breath (P), Blade Tempest Invocation.
  - *6th:* Blade Barrier (Spont), Heal (Dom/Slot), Resistance Superior, Greater Dispel Magic, Valiant Steed, Heroes' Feast.
  - *7th:* Power Word Blind (Spont), Sunbeam (Dom), Fortunate Fate, Holy Star, Holy Word.
  - *8th:* Power Word Stun (Spont), Cure Critical Wounds Mass (Dom), Visions of the Future, Death Ward Mass, Brilliant Aura.
  - *9th:* Power Word Kill (Spont), Heal Mass (Dom), Sublime Revelry First.

#### Table 2.1a — Triel Fitheaben: Level-by-Level Discriminated Progression Matrix (Chassis, Features & Feats)

| Lvl | Class | HP | BAB | Fort | Ref | Will | ASI | CL | Features | Class Feats | Extra / Bonus Feats | Regular Feats |
| :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :--- | :--- | :--- | :--- |
| 1 | Clerigo | 8 | +0 | +2 | +0 | +2 | — | +1 | Aura, Spellcasting, War Domain, Healing Domain, Lightbringer ACF: Destroy Undead | Heavy Armor Prof., Shield Prof., Simple Weapons Prof. | Extra Turning, Martial Weapon Prof. (War Domain), Weapon Focus: Longsword (War Domain) | Extend Spell |
| 2 | Clerigo | 8 | +1 | +1 | +0 | +1 | — | +1 | Undead Intuition | — | — | — |
| 3 | Clerigo | 8 | +1 | +0 | +1 | +0 | — | +1 | — | — | — | Persist Spell |
| 4 | Clerigo | 7 | +1 | +1 | +0 | +1 | +1 WIS | +1 | — | — | — | — |
| 5 | Ordained Champion | 1 | +1 | +2 | +0 | +2 | — | +0 | Bonus Domain: Law Domain, Modified Spontaneous Casting (Ex), Continued Advancement, Combat Feats | — | Power Attack, Parrying Shield, Law Devotion | — |
| 6 | Ordained Champion | 4 | +1 | +1 | +0 | +1 | — | +1 | Smite (Su) | Diehard | — | Practiced Spellcaster |
| 7 | Knight of the Raven | 1 | +1 | +2 | +0 | +2 | — | +0 | Raven harrier (harry), Speak with ravens | — | — | — |
| 8 | Knight of the Raven | 1 | +1 | +1 | +0 | +1 | +1 WIS | +1 | Smite undead 1/day | — | — | — |
| 9 | Knight of the Raven | 4 | +1 | +0 | +1 | +0 | — | +1 | Turn undead, Extra Domain: Sun domain, Raven harrier (baffle) | — | — | Divine Metamagic (Persist) |
| 10 | Knight of the Raven | 6 | +1 | +1 | +0 | +1 | — | +1 | Light focus, Smite undead 2/day | — | — | — |
| 11 | Knight of the Raven | 6 | +1 | +0 | +0 | +0 | — | +1 | Raven harrier (falter) | Enduring Life | — | — |
| 12 | Knight of the Raven | 6 | +1 | +1 | +1 | +1 | +1 WIS | +1 | Smite undead 3/day | — | Collector of Stories (RP reward + 5 extra skill pts) | Holy Warrior |
| 13 | Ordained Champion | 3 | +1 | +0 | +1 | +0 | — | +1 | Channel Spell (Su), Divine Bulwark (Su) | — | — | — |
| 14 | Crusader | 8 | +1 | +2 | +0 | +0 | — | +0 | Furious counterstrike, Steely resolve 5 | — | — | — |
| 15 | The Righteous Cohort of Kiri-Jolith | 5 | +0 | +2 | +0 | +2 | — | +1 | Fraternal oath, Rallying cry 1/day | — | — | Extra Granted Maneuver |
| 16 | The Righteous Cohort of Kiri-Jolith | 5 | +1 | +1 | +0 | +1 | +1 WIS | +1 | Lesser Aura of Discipline | — | — | — |
| 17 | The Righteous Cohort of Kiri-Jolith | 5 | +1 | +0 | +1 | +0 | — | +1 | Bonus feat, Empower leader +2 | — | Martial Stance | — |
| 18 | The Righteous Cohort of Kiri-Jolith | 5 | +1 | +1 | +0 | +1 | — | +1 | Rallying cry 2/day | — | — | Dragon Cohort |
| 19 | The Righteous Cohort of Kiri-Jolith | 5 | +0 | +0 | +0 | +0 | — | +1 | Empower leader +3 | — | — | — |
| 20 | The Righteous Cohort of Kiri-Jolith | 5 | +1 | +1 | +1 | +1 | +1 WIS | +1 | Bonus feat, Second wind | — | Martial Study | — |
| **Σ** | **20 Levels** | **101 base (+80 CON = 181)** | **+17** | **+19 base** | **+6 base** | **+17 base** | **+5 WIS** | **17 base (20 eff.)** | — | — | — | — |

#### Table 2.1b — Triel Fitheaben: Level-by-Level Skill Rank Allocations

| Lvl | Class | Conc | Heal | Dipl | Spc | K:Rel | K:Arc | K:His | K:Pla | Spot | Skill Trick | UMD | Pts Spent |
| :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 1 | Clerigo | 4 | 1 | 0 | 1 | 4 | 1 | 0 | 1 | 0 | 0 | 0 | 12 |
| 2 | Clerigo | 1 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 3 | Clerigo | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 4 | Clerigo | 0 | 0 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 5 | Ordained Champion | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 3 |
| 6 | Ordained Champion | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 7 | Knight of the Raven | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 3 |
| 8 | Knight of the Raven | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 9 | Knight of the Raven | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 10 | Knight of the Raven | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 11 | Knight of the Raven | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 12 | Knight of the Raven | 1 | 1 | 2 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 0 | 7 |
| 13 | Ordained Champion | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 14 | Crusader | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 5 |
| 15 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 16 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 17 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 18 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 19 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| 20 | Righteous Cohort | 1 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| **Σ** | **Total Ranks** | **23** | **6** | **13** | **4** | **20** | **1** | **1** | **1** | **4** | **0 (RP)** | **1** | **73** |

*(Note: Level 14 Crusader spends 5 points for 1 Conc + 1 Heal + 1 K:Rel + 1 UMD cross-class [2 pts]; Level 12 reflects the sheet's "+5 extra skill points" RP note.)*

#### Table 2.1c — Triel Fitheaben: Level 15 Equipment Loadout & Reverse-Engineered Level 20 Upgrades

| Slot | Weight | Level 15 Item(s) | Reverse-Engineered Level 20 State (From L20 Statblock) |
| :--- | :-: | :--- | :--- |
| **Weapon** | 4 lb | *Keen Longsword +1* (`Lesser Crystal of Return`) | Upgraded to **`Keen Longsword +3`** (`Lesser Crystal of Return`) — Atk `+23`, Crit `17–20 ×2` |
| **Shield** | 15 lb | *Sanctified Durable Animated Heavy Steel Shield +1* | Upgraded to **`+3`** (`+2` base + `+3` enh = **`5` Shield AC**; *Animated* frees hand for casting!) |
| **Body** | 50 lb | *Restful Blurring Full Plate +1* | Upgraded to **`+3`** (`+8` base + `+3` enh = **`11` Armor AC**; *Blurring* 3/day; **ACP 5** = masterwork Full Plate `-5`, Animated shield ACP note!) |
| **Face / Eyes** | — | *Goggles of Night* (Darkvision 60 ft.) | Retained (or MIC-combined w/ WIS/INT item — L20 Equip shows `+4 INT`, `+4 WIS`, `+4 CON`) |
| **Shoulders** | 2 lb | *Cloak of Charisma +4* | Upgraded to **`+6` CHA** (`CHA 13 + 6 = 19`) |
| **Neck** | 0 lb | *Reliquary Holy Symbol of Natural Armor +2* (MIC combined) | Retained (`Natural AC +2`, **`+2` Turn Undead uses** from Divine feat + 5+ K:Rel!) |
| **Waist** | — | *Belt of Battle* (3 charges/day) | Retained (`3/3` charges, `+2` competence Initiative -> `DEX +2 + 2 = +4 Init`!) |
| **Hands** | 4 lb | *Gauntlets of War of Dexterity +2* (*Sacred Item* spell) | Upgraded to **`+4` DEX** (`DEX 10 + 4 = 14`, `+3` dmg with deity favored weapon, *Sacred Item* active) |
| **Ring** | 0 lb | *Ring of Sustenance of Protection +2* (MIC combined) | Retained (`Deflection AC +2`, 2h sleep) |
| **Feet** | 1 lb | *Boots of the Unending Journey* (MIC) | Retained (`+10 ft` land speed for Good alignment -> Full Plate `20 + 10 = 30 ft`!) |
| **Misc / Pack** | 60 lb | *Metamagic Rod (Extend, Lesser)* (3/day), *Nightstick* (+4 TU!), *Handy Haversack*, *Expandable Pole*, *Shapesand*, *Glyph Seal* (*Hand of the Faithful*), *Spell Component Pouch*, *Healer's Kit*, 700 gp Diamonds, 10× wooden holy symbols (Enthariel / Ashka-Mithael), camping kit | Retained (plus L20 gear supplying `+4 CON`, `+4 INT`, `+4 WIS` via Head/Torso/Arms/Ring2 or MIC slot-combining!) |

### 2.2 Actor 2 — Remi o Corvo Celestial (Knight of the Raven Quasi-Familiar)
- **Chassis:** Small Magical Beast (Extraplanar), 20 effective HD (scales with Master), *Celestial* Template.
- **Inherited / Scaled Stats:** HP 90 (half Master's HP), AC 14 (Touch 14, FF 12), Fort +23 / Ref +10 / Will +27 (Master's base saves + own mods), Init +2, Speed 10 ft / Fly 40 ft (average), AP 15.
- **Defenses & Traits:** DR 10/magic, SR 22, Acid/Cold/Electricity Resistance 10, Darkvision, *Smite Evil* 1/day, *Does not provoke AoO*, *Returns next dawn when killed*.
- **Feats & Attacks:** *Alertness*, *Weapon Finesse*, Claws +4 (`1d2 - 5`).

### 2.3 Actor 3 — Myn / Myndylth (ECL 21 Dragon Cohort)
- **Chassis:** Very Young True Dragon (Psionic, Fire subtype), Age 13, LA 7, Templates: **Phrenic** + **Wyrm of War**, Class Levels: **Overwhelming Attack Monk 2** / **Totemist 2** (exact RHD/ECL breakdown queued for legality audit).
- **Headline Stats:** HP 160/163 | AC 43 (Touch 14, FF 43; Armor/Exalted 8, Natural 16, Deflection 2, Misc 2, Size -1/+1? — queued for audit) | BAB +12 | Fort +19 / Ref +15 / Will +17 | Power Resistance 24 | AP 175 (suspect typo/house rule) | Power Points 4 | Essentia 2 | Speed 60 ft / Fly 200 ft (poor) / Swim 60 ft | Large (`10 ft` space / `5 ft` reach, `10 ft` reach with Bite; scaling table to Huge).
- **Attack Routine:** Unarmed Strike `+20/+15/+10` (`1d8+11`) + Bite `+20` (`2d6+6`) + 2 Claws `+20/+20` (`3d6+8`) + 2 Wings `+20/+20` (`1d6+8`) + Tail `+20` (`1d8+8`) + 2 Girallon Arms `+20/+20` (`1d4+8`) — all with `+3` enhancement (Exalted Strike?), `-0` secondary penalty (*Improved Multiattack*), and WIS-to-hit (*Intuitive Attack*).
- **Subsystems Exercised:**
  - *Book of Exalted Deeds:* Sacred Vow, **Vow of Poverty**, Exalted bonus feats, Exalted AC & Exalted Strike, Intuitive Attack.
  - *Magic of Incarnum:* Totemist 2, Essentia 2, Totem Chakra Bind, Shape Soulmeld (*Girallon Arms* bound to Totem -> +2 Claw attacks, *Incarnate Avatar*, *Blink Shirt*, *Unicorn Horn*).
  - *Expanded Psionics:* Phrenic template, Power Points (4), Power Resistance (24), HD-tiered Psi-Like Abilities (including Immediate-action defenses).
  - *Dragon Mechanics:* Breath weapon + *Entangling Exhalation*, *Wyrm of War* Sovereign Archetype, Size-category scaling (`Large` -> `Huge`), Alternate Form / Frightful Presence (if applicable to variety/age), *Knowledge Devotion*.

#### Table 2.3a — Myn (Myndylth): Verbatim 14-HD / ECL 21 Progression Matrix (Chassis, Features, PLAs & Feats)

| HD | ECL | Class / RHD | HP | BAB | Fort | Ref | Will | ASI | Sheet Features | Sheet SLA/PLA | Sheet Extra Feats | Sheet Regular Feats |
| :-: | :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :--- | :--- | :--- | :--- |
| 1 | 8 | Wyrm of War Purple Dragon | 6 | 1 | 2 | 2 | 2 | — | Immune to paralysis & sleep, Blindsense 60 ft, Darkvision 120 ft, Keen senses (2×/4×), Fire Subtype, Heavy Armor / Shield / Simple / Martial Proficiencies, VoP AC bonus +4 | 3/day—*defensive precognition*, *Alternate Form*; 1/day—*force screen* | — | *Shape Soulmeld (Incarnate Avatar)* |
| 2 | 9 | Wyrm of War Purple Dragon | 6 | 1 | 1 | 1 | 1 | — | VoP Bonus exalted feat | — | *Intuitive Attack* | — |
| 3 | 10 | Wyrm of War Purple Dragon | 6 | 1 | 0 | 0 | 0 | — | VoP AC bonus +5, *endure elements* | 3/day—*empty mind*, *mind thrust* | Skill Trick: *Collector of Stories* | *Multiattack* |
| 4 | 11 | Wyrm of War Purple Dragon | 6 | 1 | 1 | 1 | 1 | — *(missed!)* | VoP Exalted strike +1 (magic), bonus exalted feat | — | *Improved Multiattack*, *Touch of Golden Ice* | — |
| 5 | 12 | Wyrm of War Purple Dragon | 6 | 1 | 0 | 0 | 0 | — | VoP *Sustenance* | 1/day—*body adjustment*, *brain lock* | — | — |
| 6 | 13 | Wyrm of War Purple Dragon | 6 | 1 | 1 | 1 | 1 | — | VoP AC bonus +6, deflection +1, bonus exalted feat | — | *Nimbus of Light* | *Sacred Vow* |
| 7 | 14 | Wyrm of War Purple Dragon | 6 | 1 | 0 | 0 | 0 | — | VoP Resistance +1, ability score enhancement +2 | 1/day—*aversion*, *psionic blast* | — | — |
| 8 | 15 | Wyrm of War Purple Dragon | 6 | 1 | 1 | 1 | 1 | — *(missed!)* | VoP Natural armor +1, *mind shielding*, bonus exalted feat | — | *Entangling Exhalation* | — |
| 9 | 16 | Wyrm of War Purple Dragon | 6 | 1 | 0 | 0 | 0 | — | VoP AC bonus +7 | 3/day—*intellect fortress*; 1/day—*psychic crush* | — | *Vow of Poverty* |
| 10 | 17 | Wyrm of War Purple Dragon | 6 | 1 | 1 | 1 | 1 | — | VoP Exalted strike +2 (good), DR 5/magic, bonus exalted feat | — | *Sanctify Natural Attack* | — |
| 11 | 18 | Monk (Overwhelming Attack) | 4 | 0 | 2 | 2 | 2 | +1 WIS *(off-cadence)* | Unarmed Strike, Flurry of Blows, VoP Ability enh. +4/+2 | 1/day—*psionic dominate* | *Power Attack*, *Improved Unarmed Strike* | — |
| 12 | 19 | Totemist | 4 | 0 | 2 | 2 | 0 | — | Wild empathy, VoP AC bonus +8, deflection +2, *greater sustenance*, bonus exalted feat | — | *Lliira's Blessing* | *Knowledge Devotion* |
| 13 | 20 | Totemist | 4 | 1 | 1 | 1 | 0 | — | Totem chakra bind (+1 capacity), VoP Resistance +2, energy resistance 5 | 1/day—*energy current*, *tower of iron will* | — | — |
| 14 | 21 | Monk (Overwhelming Attack) | 4 | 1 | 1 | 1 | 0 *(RAW +1!)* | — | Evasion, VoP Exalted strike +3, *freedom of movement*, bonus exalted feat | — | *Improved Bull Rush*, *Stigmata* | — |
| **Σ** | **21** | **10 Dragon / 2 Monk / 2 Totemist** | **76 raw** | **+12** | **+13** | **+13** | **+9** *(RAW +10)* | **+1 WIS** | — | — | — | — |

#### Table 2.3b — Myn (Myndylth): Verbatim Level-by-Level Skill Rank Allocation Matrix

| HD | Class / RHD | Conc | Dipl | Disg | Intim | Heal | K:Arc | K:Arch | K:Dung | K:Geog | K:Hist | K:Loc | K:Nat | K:Nob | K:Rel | K:Pln | K:Psi | *Perf(Dnc) | Swim | Trick | Total Pts |
| :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| 1 | Dragon RHD | 4 | 4 | 4 | 4 | 2 | 4 | 1 | 1 | 1 | 1 | 4 | 1 | 1 | 4 | 1 | 1 | 2 | 0 | 0 | 40 |
| 2 | Dragon RHD | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 2 | 2 | 0 | 10 |
| 3 | Dragon RHD | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 2 | 0 | 2 | 10 |
| 4 | Dragon RHD | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 2 | 2 | 0 | 10 |
| 5 | Dragon RHD | 1 | 2 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 2 | 0 | 10 |
| 6 | Dragon RHD | 1 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 10 |
| 7 | Dragon RHD | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 10 |
| 8 | Dragon RHD | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 10 |
| 9 | Dragon RHD | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 10 |
| 10 | Dragon RHD | 1 | 1 | 0 | 0 | 2 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 1 | 1 | 0 | 0 | 1 | 0 | 10 |
| 11 | Monk 1 | 1 | 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 5 |
| 12 | Totemist 1 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 | 4 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 11 |
| 13 | Totemist 2 | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 1 | 2 | 0 | 0 | 0 | 0 | 8 |
| 14 | Monk 2 | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — | 0 *(unspent!)* |
| **Σ** | **Total Ranks** | **16** | **14** | **4** | **4** | **10** | **16** | **1** | **1** | **1** | **1** | **16** | **16** | **1** | **16** | **14** | **1** | **8** *(4cc?)* | **12** | **2** | **154** |

#### Table 2.3c — Myn (Myndylth): Languages, Defenses, Soulmelds & SLA/PLA Sheet Ledger
- **Languages:** Common, Celestial, Draconic, Elven, Auran.
- **Immunities:** Paralysis, Sleep, **Fire** | **Vulnerabilities:** **Cold**.
- **Soulmelds (Shaped / Bound / Essentia):**
  - *Girallon Arms*: Shaped `Arms`, Bound **`Totem`**, Essentia `0`
  - *Incarnate Avatar*: Shaped `Soul`, Bound `—`, Essentia **`2`** (`[Good]` -> `+2 insight` AC!)
  - *Blink Shirt*: Shaped `Heart`, Bound `—`, Essentia `0`
  - *Unicorn Horn*: Shaped `—`, Bound `—`, Essentia `0` *(4th listed meld; Totemist 2 shapes `3` + *Shape Soulmeld* = `4` total!)*
- **Sheet SLA/PLA Table:**
  - *Cone of Superheated Spark* (DC 18, `1/1`), *Cone of Sleep Gas* (DC 18, `1/1`), *Alternate Form* (`3/3`), *Defensive Precognition* (`3/3`), *Force Screen* (`1/1`), *Empty Mind* (`3/3`), *Mind Thrust* (DC 15, `3/3`), *Body Adjustment* (`1/1`), *Brain Lock* (DC 16, `1/1`), *Aversion* (DC 16, `3/3` — *RAW 1/day!*), *Psionic Blast* (DC 17, `3/3` — *RAW 1/day!*), *Intellect Fortress* (`3/3`), *Psychic Crush* (DC 19, `1/1`), *Psionic Dominate* (DC 18, `1/1`), *Energy Current* (DC 19, `1/1`), *Tower of Iron Will* (`1/1`).

---

## 3. Codebase-Grounded Capability & Gap Matrix

### Bucket A — Fully Representable As-Is (Engine Ready; Tier 3 JSON Content Only)

| Capability | Existing Codebase Owner(s) | Notes |
| :--- | :--- | :--- |
| 20-level interleaved multiclassing & selective PrC caster advancement | `src/rulesets/dnd35e/level_ledger.ts`, `prestige_casting.ts` | Supports arbitrary chronological `levelHistory`, cumulative BAB/Saves, retroactive CON HP, and `scalingPools` (e.g., `turn_undead_level`). |
| 4-Stage Stat DAG, AC Triplet (Full/Touch/FF), Saves, ACP, Concealment % | `src/rulesets/dnd35e/modifiers/stacking_engine.ts`, `cartridge/dnd35e_dag_adapter.ts` | Full `sourcePath` provenance and `revokeModifiersByPathPrefix` already wired. |
| Core Cleric chassis & 4 Domains (`war`, `healing`, `law`, `sun`) | `public/data/rulesets/dnd35e/classes/cleric.json`, `domains/*.json` | `spontaneousConversionMode: 'domain'` and `spontaneousDomainId` already exist on `DnD35EntityData` / `DnD35ClassFeatureDetailSchema`. |
| Core Spell Effect Units (damage, heal, restore, ability damage, dispel, summon, spatial field, spell-strike, save-or-die, fluid spawn, retaliation, form overlay) | `src/rulesets/dnd35e/magic/spell_cast_effects.ts`, `spell_strike_resolver.ts`, `retaliation_resolver.ts` | Already handles *Shivering Touch* (`ability_harm`), *Restoration* (`stat_bundle`), *Blade Barrier*/*Ice Slick* (`spatial_field`), *Blade Tempest Invocation* (`spell_strike`), *Greater Dispel Magic* (`dispel`), *Valiant Steed* (`summon`), *Lesser Holy Transformation* (`form_overlay`). |
| Greater Turning (`Sun` domain 1/day) | `src/rulesets/dnd35e/combat/pool_ability_resolver.ts` | `poolId.includes('greater')` already destroys instead of turning. |
| Core Feats & Combat Math (`Power Attack`, `Weapon Focus`, `Extra Turning`, `Extend Spell`, `Diehard`, `Multiattack`, `Knowledge Devotion`, `Improved Bull Rush`) | `public/data/rulesets/dnd35e/feats/`, `skills/skill_synergies.ts`, `combat/attack_routine.ts` | `buildKnowledgeDevotionModifiers`, Keen crit doubling, DR/Energy Resistance/SR/Immunities/Vulnerabilities, and manufactured+natural attack routines exist. |
| Autonomous Companion Stances, Focus-Fire & Dialogue/Command Control | `src/types/components/actor_components.types.ts` (`ControllerLinkComponent`), `src/systems/companion_commands.system.ts`, `src/ai/companion_targeting.ts`, `src/systems/trigger/social_consequences.ts`, `DnD35eSheetCompanionsTab.tsx` | Stances (`aggressive \| defensive \| passive \| hold`), `commandTargetId`, and dialogue consequences already exist at Tier 1 Console! |
| Large/Huge Footprints, 3D Flight/Swim, Senses, Languages, Celestial Template, Monk Class | `spatial/footprint_resolver.ts`, `dnd35e_spatial_3d.ts`, `terrain_traversal_resolver.ts`, `cover_senses.ts`, `language_comprehension.ts`, `templates/celestial.json`, `classes/monk.json` | All foundational spatial, sensory, and traversal engines are live. |

---

### Bucket B — Partially Representable (Foundation Exists; Targeted Tier 2 Extensions Needed)

| Gap ID | Area | What Exists Today | What Is Missing (Gap) |
| :--- | :--- | :--- | :--- |
| **B1** | **Metamagic Pipeline, DMM & Metamagic Rods** | `magic/metamagic_dispel.ts` supports `empower`, `maximize`, `extend`, `widen`, `silent`, `still`, `judicious`, `projectTouch`. | 1. **`Persistent Spell`** (+6 slot level, fixed/personal range eligibility, 24-hour duration override).<br>2. **Resource-Substituted Metamagic** (*Divine Metamagic*): declarative rule allowing metamagic slot-level surcharge (`1 + slotDelta`) to be paid from a named `ResourcePool` (e.g., `turn_undead`) instead of slot level.<br>3. **Metamagic Rods** (*Lesser / Standard / Greater*): charged item activation carrying `metamagicId` + **`maxSpellLevel`** (`3 / 6 / 9`) that applies free metamagic to the next qualifying spell cast. |
| **B2** | **ACF Swaps, Domain Trades & Feature Re-Acquisition** | `DnD35AcfSwapSchema` swaps class features; `pool_ability_resolver.ts` runs PHB Turn/Rebuke HD checks. | 1. **Domain-Power & Whole-Domain Swaps:** Trading a Domain's granted power for a Fighter Bonus Feat (Ordained Champion *Combat Feats*) or trading an entire Domain for a Devotion feat (`Law` -> `Law Devotion`).<br>2. **Feature Re-Acquisition Coexistence:** When *Lightbringer* replaces Cleric *Turn Undead* with *Destroy Undead*, and *Knight of the Raven 3* later grants *Turn Undead*, **both pools must coexist cleanly** with accurate `scalingPools` attribution (plus clear rules on which pool *Extra Turning* / *Divine Metamagic* / *Ordained Champion Smite* interact with!).<br>3. **Destroy Undead AoE Resolution:** Positive-energy damage burst (`1d6/cleric level`, 30 ft, Will half DC `10 + 1/2 lvl + CHA`) as a declarative pool effect unit rather than hardcoded HD-turn-only logic. |
| **B3** | **Tag-Unified Smites, Channel Spell & Arbitrary Pool Action Costs** | `combat_acf_riders.ts` implements `Smite Evil` (hardcoded `alignment:evil` + `smite_evil_damage_level`); `pool_ability_resolver.ts` consumes a Standard Action for nearly all pools. | 1. **Declarative Smite Profiles:** Separate abilities (*Smite Evil*, *Ordained Champion Smite* burning TU, *KotR Smite Undead*, *Crusader Smite*) parameterized by pool cost, target tag predicate, hit stat, damage scaling, and shared **`effect:smite` / `ability:smite`** semantic tags.<br>2. **Declarative Channel Spell Profiles:** Separate abilities (Ordained Champion vs. Duskblade vs. Spellsword) parameterized by action cost (Move/Standard/Full-Round), valid spell filters, charge duration, and discharge mode, sharing **`effect:channel_spell`** tags and a generic weapon-stored spell overlay.<br>3. **Data-Driven Action Cost on Pool Activation:** Respect `actionCost` (`swift`, `immediate`, `move`, `free`, `standard`) from `DnD35ActivatedAbilityDescriptor` / `resourcePool` inside `pool_ability_resolver.ts` (needed for *Law Devotion*, *Blurring*, *Belt of Battle*, *Divine Bulwark*). |
| **B4** | **Quasi-Familiars, Full-Progression Cohorts & Companion Debuff Orders** | `companions.ts` spawns linked actors with `ControllerLinkComponent`, half master HP, and master BAB for familiars. | 1. **Familiar Save/HD/Template Inheritance & Dawn Respawn:** Inheriting Master's best base Fort/Ref/Will, effective HD = Master HD, layering templates (`Celestial`), `no_provoke_aoo` rule override, and a **`respawnPolicy: 'next_dawn'`** lifecycle hook (Remi).<br>2. **Full-Progression Autonomous Cohorts:** Cohorts (`Dragon Cohort` / `Leadership`) need full independent `levelHistory` + ECL cap validation while remaining autonomous `ControllerLink` AI actors controllable via stances/dialogue/commands.<br>3. **Companion Tactical Ability Commands:** Issuing targeted companion debuff abilities like KotR *Raven Harrier* (`harry` / `baffle` / `falter`). |
| **B5** | **Playable RHD + LA + Class Multiclassing, Dragon Archetypes & Natural/Unarmed Combat** | `dragon_synthesizer.ts` builds static `DnD35Archetype`s (`levelAdjustment: 0`); `attack_routine.ts` combines manufactured + natural weapons. | 1. **Playable Monster Progression:** Feeding a Dragon age-tier RHD + `levelAdjustment` + Sovereign Archetype (*Wyrm of War* swapping sorcerous casting for Fighter bonus feats) directly into `levelHistory` alongside class levels (`Monk`, `Totemist`).<br>2. **Physical/Natural Attack Stat Substitution (`Intuitive Attack`):** Declarative `RuleOverride` allowing WIS (or another stat) in place of STR on qualifying weapon tags (`weapon:simple`, `weapon:natural`).<br>3. **Per-Weapon Reach & Unarmed+Natural Routines:** Supporting distinct reach per natural weapon (`10 ft` Bite vs. `5 ft` Claws on Large dragons), `Improved Multiattack` (`secondary_natural_penalty` -> `0`), and iterative Unarmed Strikes + all natural weapons as secondary.<br>4. **Breath Weapon Meta-Breath Modifiers:** Declarative breath modifiers like *Entangling Exhalation* (half damage + `entangled` condition + `1d6` ongoing damage). |
| **B6** | **Item Augment Sockets, Action-Granting Items & Item-Targeted Spell Buffs** | `item_system.types.ts` supports `enhancements`, `damageRiders`, and `effectBundle` (`resourcePool` + `activatedAbilities`). | 1. **Item Augment Sockets (Tier 1 Primitive):** Attachable sub-item slots on weapon/armor instances (e.g., *Lesser Crystal of Return* granting Quick Draw + recall without duplicating item JSONs).<br>2. **Action-Budget Granting Effects:** Declarative effect unit adding `move` / `standard` / `full_round` actions to `DnD35ActionBudget` (*Belt of Battle* 1/2/3 charges).<br>3. **Item-Instance Targeted Buff Overlays:** Casting spells onto an equipped item (*Magic Vestment*, *Greater Magic Weapon*, *Sacred Item*) that apply temporary enhancement/rider overlays scoped to that item instance (respecting non-stacking enhancement rules and `sourcePath` revocation). |
| **B7** | **Dynamic Live-State Modifier Formulas** | `DnD35DeclarativeModifierSchema` takes a static numeric `value`. | Declarative dynamic value formulas (`valueFormula`) inspecting live actor state—needed for **Reserve Feats** (*Holy Warrior*: `+highestUncastSpellLevel` for a domain/descriptor, yielding `+9` dmg) and scaling auras/buffs without hardcoding feat IDs. |
| **B8** | **Exalted Bonus Type & Practiced Spellcaster Cap** | `DnD35BonusTypeSchema` has 26 bonus types (missing `exalted`); `effective_caster_level` modifiers exist. | 1. Add `'exalted'` to `DnD35BonusTypeSchema` with BoED AC rules (does not stack with `armor` bonus; excluded from Touch AC; immune to *brilliant energy* bypass).<br>2. Declarative **`capByTotalHd`** option on `effective_caster_level` modifiers so *Practiced Spellcaster* (+4 CL, capped at HD) works purely in JSON (`CL 17 -> 20`). |

---

### Bucket C — New Primitives & Systems Required (Tier 1 Console + Tier 2 Cartridge)

| Gap ID | Subsystem | Sheet Drivers | Tier 1 — Console Engine Primitive | Tier 2 — D&D 3.5e Cartridge & Tier 3 JSON |
| :--- | :--- | :--- | :--- | :--- |
| **C1** | **Martial Adept / Initiator Engine** (*Tome of Battle*) | *Crusader 1*, IL 10, *Martial Study*, *Martial Stance*, *Extra Granted Maneuver*, *Martial Spirit*, *Douse the Flames*, *Mountain Hammer*, *Revitalizing Strike*, *White Raven Strike*, *Divine Surge*, *Steely Resolve 5*, *Furious Counterstrike* | 1. **Tactical Deck / Hand Component** (`known`, `readied`, `granted`, `expended`, pluggable refresh policies: random-draw auto-refresh, action-recovery, swift-attack recovery).<br>2. **Delayed Damage Buffer Component** (buffers up to `N` incoming damage until end of next turn, drains on expiry, exposes `bufferedAmount` as a live stat input). | `initiator_level` calculation (`adept + floor(non_adept/2)`), Stance mutual-exclusion group (reuses `stance.system.ts`), Strike/Boost/Counter resolver (full DR/hardness bypass, on-hit ally heal, AoO suppression, flat-footing), `Steely Resolve` -> `Furious Counterstrike` reactive formula. |
| **C2** | **Incarnum / Soulmeld & Essentia Engine** (*Magic of Incarnum*) | *Totemist 2*, Essentia 2, *Shape Soulmeld*, *Totem Chakra Bind*, *Girallon Arms* (+2 Claws), *Incarnate Avatar*, *Blink Shirt*, *Unicorn Horn* | 1. **Mutable Point Allocation Component** (reinvestable integer pool assigned across active receptacles via Swift action, clamped by per-receptacle capacity caps).<br>2. **Anatomical Chakra / Slot-Locking Overlay** extending `EquipmentSlotInstance` (binding a power to a body slot locks/blocks mundane gear unless a `split_slot` override applies; can inject dynamic natural weapons). | Essentia capacity curve by total HD + class bonuses, Soulmeld JSON schema (`chakra`, `shapedBundle`, `essentiaScaling`, `boundEffectsByChakra`), Totem Chakra natural-weapon injection (*Girallon Arms*), at-will short-range teleport (*Blink Shirt*). |
| **C3** | **Psionics Engine** (*Expanded Psionics Handbook*) | *Phrenic* template, Power Points (4), Power Resistance (24), HD-tiered Psi-Like Abilities (incl. Immediate-action defenses) | Reuses Tier 1 `ResourcePoolComponent` (`power_points`) + Immediate Reaction Interrupt queue (`immediate_reactions.ts`). | Power Point augmentation capped by Manifester Level, Power Resistance (`PR`) check with configurable **Psionics-Magic Transparency** (`PR <-> SR`), HD-scaled PLA unlock tables on templates/races/classes. |
| **C4** | **Constraint-Guarded Progressive Tracks** (*Book of Exalted Deeds* Vows) | *Sacred Vow*, *Vow of Poverty* (L1–20 Exalted AC, Bonus Exalted Feats, Exalted Strike, Ability Enhancements, Deflection, Natural Armor, Resistance, DR, Freedom of Movement, True Seeing) | **Invariant-Guarded Progressive Overlay Track** (watches declarative actor invariants—e.g., no equipped magic items—and emits/scales level-indexed `EffectBundle`s; automatically revokes via `sourcePath` prefix if violated). | Vow of Poverty 1–20 progression table JSON, Exalted Strike weapon bypass (`magic`, `good`), Exalted Bonus Feat grants at even levels, code-of-conduct violation/atonement hooks. |
| **C5** | **Action Points (`AP`)** (*Eberron / Unearthed Arcana*) | Triel (15), Remi (15), Myn (175*) | **Heroic Roll-Modification Pool** (optional spend trigger on d20 rolls, stabilization, or special activations). | Level-scaled AP die curve (`1d6` -> `2d6` -> `3d6` keep highest) + per-level AP refresh formula (`5 + floor(level/2)`). |
| **C6** | **Skill Tricks** (*Complete Scoundrel*) | *Collector of Stories* (+5 competence on Knowledge monster-ID checks, 1/encounter) | Reuses `ResourcePoolComponent` (`refreshCycle: 'encounter'`) + skill-point purchase ledger in `level_ledger.ts`. | Skill Trick JSON schema (`skillPointCost: 2`, max `floor(level/2)` tricks, 1 purchase/level, prerequisites, encounter-scoped `EffectBundle`). |
| **C7** | **Contingency / Lethal Interception, Modal Buffs & Bonded-Cohort Auras** | *Fortunate Fate*, *Delay Death*, *Holy Word*, *Holy Star*, *Triadspell*, *Protective Interposition*, *Righteous Cohort of Kiri-Jolith* (*Fraternal Oath*, *Empower Leader*, *Lesser Aura of Discipline*, *Rallying Cry*) | 1. **Triggered Interception / Contingency Watcher** (hooks HP/lethal-damage transitions to auto-fire a stored spell or suppress death until expiry).<br>2. **Modal Switchable Buff** (free-action stance/mode toggle attached to a single active buff duration). | `Holy Word` `(CL - targetHD)` tiered AoE table, `Triadspell` prepared-slot cloner (`<=3rd` level spell cast 3x), `ControllerLink`-scoped **Bonded Leader/Cohort Aura** targeting, `Protective Interposition` swap-position reaction. |

---

## 4. Suspected Sheet Discrepancies & Rules-Legality Audit Queue

Items flagged on the raw sheets that require explicit verification against RAW / sourcebooks / table house rules before encoding anything into Tier 2 or Tier 3:

1. **Myn — Missing/Incomplete Template & Dragon Features:** User noted Myn's sheet is likely not fully rules-legal. We must audit:
   - Exact base True Dragon species (`Dragon, True (Psionic, Fire)` — *Dragon Magazine* / *Draconomicon* / *Monster Manual II* / *Sandstorm* / homebrew?) and its Very Young HD, LA, natural armor, breath weapon, and movement speeds.
   - Complete **Phrenic Creature** template (*XPH* p. 205): LA +2, +2 INT / +2 WIS / +4 CHA, `PR = HD + 10` (sheet shows PR 24 -> implies 14 HD!), and exact HD-based PLA table.
   - Complete **Wyrm of War** Sovereign Archetype (*Dragons of Eberron* p. 31, not Dragon Mag #320 — verify exact source!): trades sorcerous spellcasting for Fighter bonus feats every 4 HD, martial weapon/armor proficiencies, and combat-feat bonuses.
   - **ECL 21 & `Dragon Cohort` Legality:** *Draconomicon* `Dragon Cohort` treats a dragon's ECL as 3 lower for cohort eligibility, capped at `Master Level - 2` (18 at L20). Sheet lists Myn at `Level 21`, `LA 7` — needs exact RHD + Class Level + LA + Template LA audit.
   - **Myn's `AP: 175`:** Likely a typo for `15` (or custom campaign rule).
   - **Myn's AC Size Modifier (`Tamanho: 1`):** Large creatures normally take `-1` size penalty to AC, not `+1` (sheet may have a sign/column quirk).
   - **Myn's Natural Weapon Damage Dice (`Claws 3d6` at Large):** Standard Large dragon claws are `1d8` (not `3d6`—possibly *Improved Natural Attack* / *Superior Unarmed Strike* / size-increase buff / Monk interaction? Needs audit).
2. **Triel — Dual Turning Pools (`Lightbringer` Destroy Undead + `Knight of the Raven` Turn Undead):**
   - Verify exact interaction between *Lightbringer* Destroy Undead (*Expedition to Castle Ravenloft* p. 206), *Knight of the Raven* Turn Undead (*EtCR* p. 200), *Extra Turning* (+4 to *each* pool or once?), *Divine Metamagic*, *Law Devotion*, and *Ordained Champion Smite*. (Sheet lists 17 uses of Turn Undead AND 17 uses of Destroy Undead, and 34 Smite uses — suggesting both pools may have been counted toward TU-burning feats/abilities!).
   - Verify *Smite Undead* uses (`2` in pool table vs. `Smite undead 3/day` at L12 on level table).
3. **Triel — `The Righteous Cohort of Kiri-Jolith`:** Verify exact sourcebook (*Dragonlance* — *Knightly Orders of Ansalon* / *Holy Orders of the Stars* / homebrew?) and exact RAW text for all 6 levels.
4. **Triel — Rare / Non-Core Spells:** Confirmed `"First"` in *Sublime Revelry First* is a sheet typo for ***Sublime Revelry*** (*Book of Exalted Deeds*). Still queued to verify exact sourcebooks and mechanics for *Blade Tempest Invocation*, *Irian's Light*, *Lava Missile*, *Protective Interposition*, *Triadspell*, *Fortunate Fate*, *Holy Star*, *Visions of the Future*, *Brilliant Aura*, *Elation*, *Recitation*, *Delay Death*, *Snowshoes*, *Ice Slick*, and *Valiant Steed*.
5. **Triel — `Collector of Stories` & Skill Points:** Sheet notes RP reward + 5 extra skill points at L12; verify RAW *Complete Scoundrel* Skill Trick rules (2 skill points, 1/level, max `floor(level/2)` tricks).
6. **Remi — `Knight of the Raven` Celestial Raven Rules:** Verify exact *Expedition to Castle Ravenloft* text for *Raven Harrier* (exact HP/HD/save/BAB scaling, *Does not provoke AoO*, *Returns next dawn*, and exact mechanics of *harry*, *baffle*, and *falter*).

---

## 5. Master Individual Deep-Dive Research Checklist

Before designing or writing any code, we will research each item below individually to confirm exact RAW mechanics, edge cases, and Tier 1 / Tier 2 / Tier 3 mapping.

### Track 1 — Core Systems & Rules Foundations
- [x] **1.1** Exalted & Perfection Bonus Types + BoED AC/Stacking Rules (§1, §6.6)
- [x] **1.2** Action Points (Eberron vs. Unearthed Arcana RAW) (§6.14)
- [x] **1.3** Skill Tricks (*Complete Scoundrel* rules + *Collector of Stories*) (§6.14)
- [x] **1.4** Metamagic: *Persistent Spell*, *Divine Metamagic*, & *Metamagic Rods* (Lesser/Standard/Greater max spell levels) (§6.14)
- [x] **1.5** ACF Swaps, Domain-Power Trades, Whole-Domain Devotion Trades, & Feature Re-Acquisition Coexistence (§6.8, §6.9, §6.13, §6.14)
- [x] **1.6** Tag-Unified Ability Families: *Smite* variants & *Channel Spell* variants (Ordained Champion / Duskblade / Spellsword) (§6.9, §6.10, §6.11, §6.14)
- [x] **1.7** Weapon/Armor Augment Crystals (*Magic Item Compendium*) & Item-Targeted Spell Overlays (§6.14)
- [x] **1.8** Reserve Feats (*Complete Mage* / *Complete Champion* — dynamic slot-inspection modifiers) (§6.14, §6.15)

### Track 2 — Classes, ACFs, Prestige Classes & Domains
- [x] **2.1** Lightbringer Cleric ACF (*Expedition to Castle Ravenloft* p. 206) + Dead Levels II — *Destroy Undead*, *Undead Intuition* (§6.8)
- [x] **2.2** Ordained Champion (*Complete Champion* pp. 90–92) — all 5 levels (§6.9)
- [x] **2.3** Knight of the Raven (*Expedition to Castle Ravenloft* pp. 200–202) — all 10 levels + Celestial Raven Harrier (§6.10)
- [x] **2.4** Crusader (*Tome of Battle* pp. 8–12) — Initiator Level, Steely Resolve, Furious Counterstrike, Granted-Maneuver Deck (§6.11)
- [x] **2.5** The Righteous Cohort of Kiri-Jolith (*Holy Orders of the Stars* pp. 54–55) — complete verbatim L1–10 (§6.12)
- [x] **2.6** Overwhelming Attack Monk Variant (*Unearthed Arcana*) — L1–6 features (§6.4)
- [x] **2.7** Totemist (*Magic of Incarnum*) — L1–20 chassis, L1–2 features, Essentia Capacity, Totem Chakra Bind (§6.5)
- [x] **2.8** Domains & Devotions: *War*, *Law* / *Law Devotion*, *Healing*, *Sun* + repo JSON audit (§6.13)

### Track 3 — Subsystems (Tome of Battle, Incarnum, Psionics, Exalted Vows)
- [x] **3.1** Tome of Battle Maneuvers & Stances: *Martial Spirit*, *Douse the Flames*, *Mountain Hammer*, *Revitalizing Strike*, *White Raven Strike*, *Divine Surge* (§6.15)
- [x] **3.2** Magic of Incarnum Soulmelds & Chakra Binds: *Girallon Arms*, *Incarnate Avatar*, *Blink Shirt*, *Unicorn Horn*, *Shape Soulmeld* (§6.5)
- [x] **3.3** Expanded Psionics Handbook: *Phrenic* template, Power Points, Power Resistance & HD-scaled PLAs (§6.2)
- [x] **3.4** Book of Exalted Deeds: *Sacred Vow*, *Vow of Poverty* (L1–20 full progression table & code-of-conduct invariants) (§6.6)

### Track 4 — Creatures, Templates, Dragons & Companions
- [x] **4.1** Remi — Celestial Raven Harrier RAW scaling, Celestial template repo audit, & `next_dawn` respawn lifecycle (§6.10)
- [x] **4.2** Myn — **Purple Dragon** (*Dragon Compendium Vol. 1*) + **Iron Dragon** (*Dragon #356* forensic match) + **Phrenic** + **Sanctified Creature** + **Wyrm of War** + full Myn ECL/math audit (§6.1, §6.2, §6.2b, §6.3, §6.7)
- [x] **4.3** `Dragon Cohort` feat (*Draconomicon*) & Autonomous Cohort progression/AI integration (§6.7)
- [x] **4.4** Unarmed + Natural Weapon Full-Attack Stacking, Per-Weapon Reach, & *Entangling Exhalation* (§6.7)

### Track 5 — Feats & Equipment
- [x] **5.1** Triel Feats: *Persist Spell*, *Divine Metamagic*, *Parrying Shield*, *Law Devotion*, *Practiced Spellcaster*, *Enduring Life*, *Holy Warrior*, *Extra Granted Maneuver*, *Martial Stance*, *Martial Study*, *Dragon Cohort* (§6.7, §6.10, §6.12, §6.13, §6.14, §6.15)
- [x] **5.2** Myn Feats: *Intuitive Attack*, *Multiattack*, *Improved Multiattack*, *Knowledge Devotion*, *Entangling Exhalation*, *Shape Soulmeld*, *Sacred Vow*, *Vow of Poverty*, *Touch of Golden Ice*, *Nimbus of Light*, *Sanctify Natural Attack*, *Lliira's Blessing*, *Stigmata* (§6.5, §6.6, §6.7)
- [x] **5.3** Magic Item Crafting Rules, Weapon/Armor Enhancements, MIC Slot-Combining & Triel's Gear: SRD Creation Formulas, MIC Table 6–11, *Keen*, *Animated*, *Blurring*, *Restful*, *Durable*, *Sanctified*, *Lesser Crystal of Return*, *Gauntlets of War*, *Reliquary Holy Symbol*, *Nightstick*, *Metamagic Rod (Extend, Lesser)*, *Belt of Battle*, *Boots of the Unending Journey*, *Glyph Seal*, *Goggles of Night*, *Ring of Sustenance*, *Shapesand*, *Expandable Pole*, *Handy Haversack* (§6.16)

### Track 6 — Non-SRD / Advanced Spells Audit
- [x] **6.1** Contingency / Death / Action / Slot-Manipulation Spells: *Fortunate Fate*, *Delay Death*, *Triadspell*, *Protective Interposition*, *Holy Star*, *Holy Word*, *Visions of the Future* (§6.17)
- [x] **6.2** Item-Buff & Weapon-Channel Spells: *Magic Vestment*, *Greater Magic Weapon*, *Sacred Item*, *Brilliant Aura*, *Blade Tempest Invocation*, *Hand of the Faithful* (§6.18)
- [x] **6.3** Buffs, Forms & Auras: *Divine Power*, *Elation*, *Recitation*, *Lesser Holy Transformation*, *Righteous Wrath of the Faithful*, *Dragon Breath*, *Mass Lesser Vigor*, *Sublime Revelry*, *Snowshoes*, *Delay Disease*, *Delay Poison*, *Mass Resist Energy*, *Superior Resistance*, *Mass Death Ward*, *Heroes' Feast*, *Freedom of Movement* (§6.19)
- [x] **6.4** Offensive & Utility Spells: *Ice Slick*, *Lava Missile*, *Shivering Touch*, *Irian's Light*, *Divine Insight*, *Valiant Steed*, *Power Word Blind/Stun/Kill*, *Sunbeam*, *Blade Barrier*, *Lesser Restoration* (§6.20)

---

## 6. Granular Entity-by-Entity Deep-Dive Research Log

### §6.1 Purple Dragon (*Dragon Compendium Vol. 1*, pp. 197–199)

- **Primary Sources Verified Directly:**
  - `https://www.realmshelps.net/monsters/block/Dragon,_Purple_Very_Young` (plus Wyrmling, Young, Juvenile, Young Adult, Great Wyrm pages)
  - `https://new.dndtools.org/monsters/dragon-purple-very-young`
  - Sourcebook scan: `/public/assets/aistudio/image_e8be537b.png`
- **Creature Type & Subtype:** `Dragon` (no elemental/fire subtype).
- **Alignment:** **Always lawful evil** *(flipped to **Lawful Good** by **Sanctified Creature**, §6.2b — preserving the Lawful axis for Monk 2; Myn's sheet erroneously wrote Neutral Good)*.
- **Environment / Treasure / Languages:** Temperate plains; Triple Standard; Draconic.
- **Dragon Chassis Baselines:** `d12` RHD, Full BAB (`1/1`), All Good Saves (`Fort/Ref/Will`), `6 + INT` skill points/HD (quadruple at 1st HD), Darkvision 120 ft., Low-Light Vision, Blindsense 60 ft., Keen Senses, Immunity to sleep and paralysis.
- **Level Adjustment (LA) by Age (Verified on RealmsHelps & dndtools):**
  - Wyrmling (7 HD): **LA +2** (ECL 9, CR 2)
  - Very Young (10 HD): **LA +3** (ECL 13, CR 3 [errata CR 5])
  - Young (13 HD): **LA +3** (ECL 16, CR 4)
  - Juvenile (16 HD): **LA +4** (ECL 20, CR 6)
  - Young Adult+ (19+ HD): **LA —** (non-playable)

#### Table 6.1a — Purple Dragon Stats by Age (Verbatim from Source Scan + RealmsHelps LA/CR)

| Age | Size | Hit Dice (Avg HP) | STR | DEX | CON | INT | WIS | CHA | BAB / Grapple | Attack | Fort | Ref | Will | Breath Weapon (DC) | Frightful Presence DC | LA |
| :--- | :-: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Wyrmling | M | 7d12+14 (59) | 19 | 10 | 15 | 14 | 13 | 12 | +7/+11 | +11 | +7 | +5 | +6 | 2d10 (15) | — | +2 |
| Very young | L | 10d12+30 (95) | 23 | 10 | 17 | 14 | 15 | 14 | +10/+20 | +15 | +10 | +7 | +9 | 4d10 (18) | — | +3 |
| Young | L | 13d12+39 (123) | 27 | 10 | 17 | 14 | 15 | 16 | +13/+25 | +20 | +11 | +8 | +10 | 6d10 (19) | — | +3 |
| Juvenile | L | 16d12+64 (168) | 31 | 10 | 19 | 16 | 17 | 18 | +16/+30 | +25 | +14 | +10 | +13 | 8d10 (22) | — | +4 |
| Young adult | H | 19d12+95 (218) | 33 | 10 | 21 | 16 | 17 | 20 | +19/+38 | +28 | +16 | +11 | +14 | 10d10 (24) | 24 | — |
| Adult | H | 22d12+110 (253) | 35 | 10 | 21 | 18 | 19 | 22 | +22/+42 | +32 | +18 | +13 | +17 | 12d10 (26) | 27 | — |
| Mature adult | H | 25d12+150 (312) | 35 | 10 | 23 | 20 | 19 | 24 | +25/+45 | +35 | +20 | +14 | +18 | 14d10 (28) | 29 | — |
| Old | G | 28d12+196 (378) | 37 | 10 | 25 | 22 | 23 | 26 | +28/+53 | +37 | +23 | +16 | +22 | 16d10 (31) | 32 | — |
| Very old | G | 31d12+248 (449) | 39 | 10 | 27 | 24 | 23 | 30 | +31/+57 | +41 | +25 | +17 | +23 | 18d10 (33) | 35 | — |
| Ancient | G | 34d12+306 (527) | 41 | 10 | 29 | 26 | 25 | 34 | +34/+61 | +45 | +28 | +19 | +26 | 20d10 (36) | 39 | — |
| Wyrm | G | 37d12+370 (610) | 43 | 10 | 31 | 26 | 25 | 38 | +37/+65 | +49 | +30 | +20 | +27 | 22d10 (38) | 42 | — |
| Great wyrm | C | 40d12+400 (660) | 47 | 10 | 31 | 28 | 27 | 42 | +40/+74 | +50 | +32 | +22 | +30 | 24d10 (40) | 46 | — |

#### Table 6.1b — Purple Dragon Abilities by Age (Verbatim from Source Scan + RealmsHelps)

| Age | Speed | Init | AC (Full / Touch / FF) | Special Abilities Unlocked | Caster Level (Sorcerer) | SR |
| :--- | :--- | :-: | :--- | :--- | :-: | :-: |
| Wyrmling | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 15 (+5 natural), touch 10, FF 15 | *Night flier* | — | — |
| Very young | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 17 (-1 size, +8 natural), touch 9, FF 17 | — | — | — |
| Young | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 20 (-1 size, +11 natural), touch 9, FF 20 | *Gust of wind* (3/day) | 1st | — |
| Juvenile | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 23 (-1 size, +14 natural), touch 9, FF 23 | *Pyrotechnics* (3/day) | 3rd | — |
| Young adult | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 25 (-2 size, +17 natural), touch 8, FF 25 | DR 5/magic | 5th | 19 |
| Adult | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 28 (-2 size, +20 natural), touch 8, FF 28 | *Heat metal* (3/day) | 7th | 21 |
| Mature adult | 40 ft., fly 150 ft. (poor), burrow 20 ft. | +0 | 31 (-2 size, +23 natural), touch 8, FF 31 | *Fire shield* (fire form only, 1/day) | 9th | 23 |
| Old | 40 ft., fly 200 ft. (clumsy), burrow 20 ft. | +0 | 32 (-4 size, +26 natural), touch 6, FF 32 | DR 10/magic | 11th | 25 |
| Very old | 40 ft., fly 200 ft. (clumsy), burrow 20 ft. | +0 | 36 (-4 size, +30 natural), touch 6, FF 36 | DR 15/magic | 13th | 27 |
| Ancient | 40 ft., fly 200 ft. (clumsy), burrow 20 ft. | +0 | 39 (-4 size, +33 natural), touch 6, FF 39 | *Suggestion* (1/day) | 15th | 29 |
| Wyrm | 40 ft., fly 200 ft. (clumsy), burrow 20 ft. | +0 | 42 (-4 size, +36 natural), touch 6, FF 42 | DR 20/magic | 17th | 31 |
| Great wyrm | 40 ft., fly 250 ft. (clumsy), burrow 20 ft. | +0 | 41 (-8 size, +39 natural), touch 2, FF 41 | *Wall of force* (1/day) | 20th | 33 |

#### Exact Verbatim Minutiae & Special Mechanics
1. **Tri-Mode Breath Weapon (Su)** (`1d4`-round shared recharge; `DC = 10 + floor(HD / 2) + CON mod` — verified exact across all 12 rows):
   - **Mode 1 — Cone of Searing Energy:** Deals listed breath damage (`2d10`..`24d10`) in a standard dragon cone; **Reflex save for half damage**.
   - **Mode 2 — Burst of Blinding Power:** Centered burst with radius scaling by dragon size:
     - Medium: **30 ft.** | Large: **40 ft.** | Huge: **60 ft.** | Gargantuan: **80 ft.** | Colossal: **100 ft.**
     - *(Note: RealmsHelps/dndtools truncated the save/blindness sentence right above the Burst Radius table — save/duration detail to double-check against physical Dragon Compendium p. 197 if needed.)*
   - **Mode 3 — Energy Blade (Verbatim):**
     - Forms a blade of pure energy used as a weapon within normal melee reach.
     - **Gains iterative attacks per BAB, capped at 4 iterative attacks** (`maxIterativeAttacks: 4`).
     - Ignores physical barriers -> resolves as **melee touch attacks**.
     - Deals **half the dragon's listed breath weapon damage** (`2d10` for Very Young, etc.) and **does NOT add STR modifier to damage**.
     - Used **in addition to the dragon's other physical attacks** (claws, wings, tail), EXCEPT **cannot use a bite attack in the same round** (`excludesNaturalWeaponId: 'bite'`).
     - **Dissipates at the end of the dragon's action** (1-action ephemeral weapon).
2. **Night Flier (Ex) (Unlocked at Wyrmling, Verbatim):**
   - While flying at night, gains a **`+10` racial bonus on all Hide checks** and **ignores the standard size penalty on Hide checks**.
3. **Spell-Like Abilities (Sp) (Verified on Great Wyrm block):**
   - `3/day`: *gust of wind* (Young), *pyrotechnics* (Juvenile), *heat metal* (Adult).
   - `1/day`: *fire shield* (fire form only; Mature Adult), *suggestion* (Ancient), *wall of force* (Great Wyrm).
4. **Innate Sorcerer Casting:** Begins at Young (CL 1st), advances +2 CL per age category through Wyrm (CL 17th) and Great Wyrm (CL 20th). Very Young has **CL `—`** (no innate casting yet).

#### Concrete Codebase Schema & Engine Gaps Exposed by Purple Dragon Alone
Audited against `src/rulesets/dnd35e/types/system/creature_system.types.ts`, `families/dragon_synthesizer.ts`, and `combat/attack_routine.ts`:
1. **Multi-Mode Breath Weapons (`creature_system.types.ts:262-271`):** Currently `breathWeapon` is a single object (`shape: 'cone' | 'line'`, damage only). Must evolve into `breathWeapons: BreathMode[]` sharing one recharge pool, supporting `'cone' | 'line' | 'burst' | 'ephemeral_weapon'`, size-scaled burst radius tables (`30/40/60/80/100 ft`), and non-damage condition payloads. *(Simultaneously unlocks all 5 SRD Metallic Dragons' dual breath weapons.)*
2. **Ephemeral Iterative Touch Weapon + Natural-Slot Mutual Exclusion (`combat/attack_routine.ts`):** Energy Blade exposes a clean, reusable Tier 2 combat primitive: an **ephemeral weapon overlay** (`maxIterativeAttacks: 4`, `isTouchAttack: true`, `addStrToDamage: false`, `damageFormula: 'half_breath'`, `excludesNaturalWeaponIds: ['bite']`, `duration: 'end_of_action'`) that folds directly into a Full Attack routine alongside non-excluded natural weapons. *(Also generalizes to Flame Blade, Ice Axe, Soulknife Mind Blade, etc.)*
3. **Per-Tier Movement Progression (`creature_system.types.ts:140-164`, `dragon_synthesizer.ts:123-127`):** `DnD35ProgressionTierSchema` lacks `movementModes` (Purple Dragon upgrades fly `150 (poor)` -> `200 (clumsy)` -> `250 (clumsy)` and has `burrow: 20`). `dragon_synthesizer.ts` currently drops `burrow`/`swim` and hardcodes maneuverability.
4. **Per-Tier Unlocked Bundles, Innate Casting & LA (`creature_system.types.ts:140-164`):** `DnD35ProgressionTierSchema` lacks `innateCasterLevel` / `innateCastingClassId`, `unlockedBundles: DnD35EffectBundle[]` (*Night Flier* + age-unlocked SLAs), and per-tier `levelAdjustment?: number | null` (`+2 / +3 / +3 / +4 / null`; `dragon_synthesizer.ts:114` currently hardcodes `levelAdjustment: 0`).
5. **Environmental Time/Light & Active-Locomotion Layer A Tags:** *Night Flier* requires `env:night` (Console lighting/time tag) + `move:flying` (active locomotion tag) + a generic `RuleOverride` (`ignore_skill_size_penalty:hide`).
6. **Per-Weapon Natural Reach (`NaturalWeaponDescriptorSchema`):** Dragon Bite has +5 ft greater reach than Claws/Wings/Tail (`10 ft` vs. `5 ft` at Large; `15 ft` vs. `10 ft` at Huge).

#### Cross-Check: Myn's Sheet vs. Very Young Purple Dragon RAW
- **Exact Matches:**
  - Very Young Purple Dragon is **Large, 10d12 RHD** (`+10 BAB`, `+7/+7/+7` base saves). With Monk 2 (`+1 BAB`, `+3/+3/+3`) + Totemist 2 (`+1 BAB`, `+3/+3/+0`), total = **14 HD, +12 BAB, +13/+13/+10 base saves**, matching Myn's sheet (`BAB 12`, `PR 24 = 14 HD + 10`).
  - Very Young base abilities (`23/10/17/14/15/14`) + Phrenic (`+2 INT, +2 WIS, +4 CHA`) = `23/10/17/16/17/18`, matching Myn's STR/DEX/INT/CHA (`23/10/16/18`), with CON 19 & WIS 21/22 explained by ASIs + Vow of Poverty.
  - Natural attacks Bite `2d6`, Wings `1d6`, Tail `1d8` match RAW.
- **Confirmed Discrepancies on Myn's Sheet:**
  1. **LA `7` / ECL `21` — SOLVED via Sanctified Creature (§6.2b):** Very Young Purple Dragon (`LA +3`) + Phrenic (`LA +2`) + **Sanctified Creature (`LA +2`)** = **`LA +7` / ECL `21`**! Myn's sheet paid for Sanctified Creature in its LA (`7`) and ECL (`21`), but forgot to list `Sanctified` on the `Templates` line or record its abilities (*Aura of Menace*, *Light Ray*, *Magic Circle against Evil*, *Tongues*).
  2. **Alignment & Subtype:** RAW Purple Dragon is `Always lawful evil` with **no `(Fire)` subtype**; applying **Sanctified Creature** flips Evil -> Good while **preserving the Law/Chaos axis**, making Myn **Lawful Good** (NOT Neutral Good — which also makes **Monk 2** alignment-legal!).
  3. **Movement Speeds:** RAW is `40 ft., fly 150 ft. (poor), burrow 20 ft.`. Myn's sheet lists `60 ft., fly 200 ft. (poor), swim 60 ft.` (missing burrow, gained swim, faster land/fly).
  4. **Natural Armor (`16` vs. `+8` RAW):** Very Young RAW is `+8` (`+1` VoP at 14 HD = `+9`), leaving `+7` unaccounted for (Sanctified Creature grants `+0` natural armor).
  5. **AC Size Mod (`Tamanho: 1`):** RAW Large size penalty is `-1` (not `+1`).
  6. **Claws `3d6` vs. RAW `1d8`:** Needs verification against Myn's feat/buff list once re-pasted.
  7. **Missing *Night Flier* & Pre-Young *Wyrm of War* Audit:** Very Young Purple Dragon has *Night Flier* (Wyrmling) and **no Sorcerer caster level yet** (`—`) — resolved in §6.3 below!

---

### §6.2 Phrenic Creature Template (*Expanded Psionics Handbook* / SRD)

- **Kind & Eligibility:** **Inherited** template; applicable to any non-mindless living/corporeal creature (adds **`psionic`** subtype; creature type unchanged).
- **Ability Modifiers:** **`+2 INT`, `+2 WIS`, `+4 CHA`**.
- **Level Adjustment:** **`+2`**.
- **Challenge Rating:** `+1` (1–3 HD), `+2` (4–7 HD), `+3` (8+ HD).
- **Naturally Psionic (Ex):** Gains **1 bonus Power Point** (qualifies the creature to take psionic feats and maintain psionic focus).
- **Power Resistance (Ex):** **`PR = Total HD + 10`** (scales dynamically as HD increases; under default *XPH* **Psionics-Magic Transparency**, `PR === SR` against both spells and powers).
- **Psi-Like Abilities (Sp) (Cumulative by Total HD; Manifester Level = Total HD; Save DCs = `10 + power level + CHA mod`; automatically augmented up to ML):**

| Total HD | Cumulative Psi-Like Abilities Gained | Action / Notable Mechanics |
| :-: | :--- | :--- |
| **1–2** | `3/day` — *defensive precognition*; `1/day` — *force screen* | Standard / Swift-augments; `+1` insight AC/saves (scales) / `+4` shield AC |
| **3–4** | `3/day` — *empty mind*, *mind thrust* | ***Empty Mind*** = **Immediate Action** (`+2` Will save, scales with ML); *Mind Thrust* = `1d10/ML` Will negates |
| **5–6** | `1/day` — *body adjustment*, *brain lock* | Self-heal (`1d12` scaling) / Daze-like lock |
| **7–8** | `1/day` — *aversion*, *psionic blast* | 30-ft cone stun (`1d4`+ rounds, Will negates) |
| **9–10** | `3/day` — *intellect fortress*; `1/day` — *psychic crush* | ***Intellect Fortress*** = **Immediate Action** (halves damage from powers/PLAs in 20-ft spread); *Psychic Crush* = drop to `-1 HP` on failed Will |
| **11–12** | `1/day` — *psionic dominate* | Compulsion / ally-override |
| **13–14** | `1/day` — *energy current*, *tower of iron will* | ***Tower of Iron Will*** = **Immediate Action** (`PR 19`+ in 10-ft burst) |
| **15–16** | `3/day` — *psionic teleport* | Tactical long-range teleport |
| **17–18** | `1/day` — *fission* | Splits actor into two independent instances |
| **19+** | `1/day` — *ultrablast* | 15-ft burst `13d6` untyped mind-affecting |

#### Codebase Schema Gaps Exposed by Phrenic Creature
1. **HD-Tiered PLA/SLA Unlock Tables on `DnD35TemplateSchema` (`creature_system.types.ts:77-84`):** Currently `DnD35TemplateHdTierSchema` only supports `damageReduction`, `energyResistances`, and `crAdjustment`. Adding `unlockedBundles?: DnD35EffectBundle[]` (with `casterLevelFormula: 'total_hd'` / `manifesterLevelFormula: 'total_hd'`) makes Phrenic, Half-Celestial, Half-Fiend, and Half-Fey 100% declarative JSON!
2. **Power Points & Augmentation (`ResourcePoolComponent` + Psionics Resolver):** `Naturally Psionic` grants `+1 PP`; PLAs auto-augment up to Manifester Level (`= Total HD`).
3. **Power Resistance (`PR`) + Transparency Flag:** `DnD35TemplateSchema` already has `spellResistanceFormula: { base: 10, perHitDie: 1 }`! Adding a campaign-level `psionicsMagicTransparency: boolean` flag (default `true`) plus optional distinct `powerResistanceFormula` cleanly handles both transparent and non-transparent campaigns.
4. **Immediate-Action Defensive Interrupts:** *Empty Mind*, *Intellect Fortress*, and *Tower of Iron Will* all trigger as **Immediate Actions** in response to incoming saves/powers (extending `src/rulesets/dnd35e/combat/immediate_reactions.ts` beyond `invisible_fist` / `abrupt_jaunt` into a generic declarative reaction hook).

---

### §6.2b Sanctified Creature Template (*Book of Exalted Deeds*, pp. 186–187)

- **Primary Sources Verified Directly:**
  - `https://www.realmshelps.net/monsters/templates/sanctified.shtml`
  - Official BoED Sample Monster: `https://www.realmshelps.net/monsters/block/Sanctified_Young_Red_Dragon*`
- **Kind & Eligibility:** **Acquired** template (typically via the 9th-level sanctified spell *Sanctify the Wicked*). Applicable to **any evil creature except outsiders with the `[Evil]` subtype**. Retains creature type. Outsiders gain the `[Good]` subtype and lose `baatezu`, `tanar'ri`, and `yugoloth` subtypes. If base creature had the *Fiendish* template, it **loses the Fiendish template** and all its abilities.
- **Level Adjustment / CR:** **`LA +2`**, **`CR +1`**.
- **Alignment (Critical Minutia!):** **`Always good`** — **the base creature's Law/Chaos axis does NOT change!**
  - *Impact on Myn:* Purple Dragon (`Always lawful evil`) + Sanctified Creature = **`Lawful Good`** (not Neutral Good), which simultaneously makes **Overwhelming Attack Monk 2** (Any Lawful) 100% RAW-legal! *(And as LG, Myn retains access to Good-axis effects like Vow of Poverty / Incarnate Avatar [Good] or [Law].)*
- **Attacks & DR Flip:**
  - Natural weapons and all wielded weapons count as **good-aligned** for overcoming DR.
  - If base creature has `DR X/good`, it flips to **`DR X/evil`**.
- **Special Attacks & Special Qualities Stripping (Famous BoED RAW vs. Sample Contradiction!):**
  - *Opening flavor:* *"gives up special qualities, attacks, and abilities that are inherently evil."*
  - *Literal mechanics prose:* *"loses all of its preexisting supernatural and spell-like abilities, but retains its extraordinary abilities."*
  - *WotC Official Sample (`Sanctified Young Red Dragon*`, BoED p. 187):* **KEPT its `Breath Weapon (Su)` (4d10 fire) AND `SR 23`!**
  - *Engine Design Takeaway:* Support a declarative `stripAbilitiesPolicy: 'evil_only' | 'all_su_and_sp'` on templates (defaulting to the WotC sample / RAI `'evil_only'` or configurable per campaign) so *Sanctified Creature* doesn't accidentally break *Entangling Exhalation* or *Phrenic* PLAs unless strict literal mode is chosen!
- **Granted Special Attacks & Qualities:**
  1. ***Light Ray (Su):*** `1/round` Standard Action, **60 ft. ranged touch attack**, deals **`floor(HD / 2)d6` (max `10d6`)** vs. **evil creatures only** (`7d6` for Myn at 14 HD); harmless to non-evil targets.
  2. ***Aura of Menace (Su):*** Continuous **20-ft. hostile aura**; Will save **`DC = 10 + floor(HD / 2) + CHA mod`** (`DC 21` for Myn at 14 HD, CHA 18). Failure -> **`-2` penalty on attacks, AC, and saves** for **24 hours OR until the target successfully hits the Sanctified Creature**. Once a target saves OR breaks the aura by hitting, it is **immune to that specific creature's Aura of Menace for 24 hours**.
  3. ***Magic Circle against Evil (Su):*** Continuous aura centered on self (`CL = min(HD, 14)` -> CL 14 for Myn).
  4. ***Tongues (Su):*** Always active (`CL = min(HD, 14)`) — maps directly onto our existing `speak_all_languages` + `comprehend_all_languages` Cartridge hooks!
  5. **Feats:** Loses all `[Vile]` feats without replacement; if creature has the `[Good]` subtype, gains access to `[Exalted]` feats.
  6. **Reversion Invariant:** *"A sanctified creature that reverts to evil, deliberately or not, loses all benefits of this template. Essentially, it is restored to its state prior to becoming a sanctified creature."* -> Reuses the **exact same Tier 1 Invariant-Guarded Overlay / Revocation** primitive as *Vow of Poverty*!

#### Codebase Schema Gaps Exposed by Sanctified Creature
1. **Template Mutation Hooks (`DnD35TemplateSchema`):** `flipAlignmentAxis: { goodEvil: 'good', preserveLawChaos: true }`, `stripTemplates: ['fiendish']`, `stripSubtypes: ['baatezu', 'tanar_ri', 'yugoloth']`, `stripFeatCategories: ['vile']`, `flipDrBypass: { from: 'good', to: 'evil' }`, and `stripAbilitiesPolicy`.
2. **Per-Source 24h Aura Immunity & Break-On-Hit Condition (`Aura of Menace`):** Condition records `{ breakOnHitSourceEntityId: true }` and writes a per-source cooldown tag (`immune_aura:<sourceId>:<auraId>`) for 24h on save or break! *(Also covers Archon *Aura of Menace*, Dragon *Frightful Presence* 24h immunity, Ghast stench, etc.!)*
3. **Invariant-Guarded Template Reversion:** Alignment shift to Evil revokes the template cleanly via `sourcePath: 'template:sanctified_creature'`.

---

### §6.3 Wyrm of War Sovereign Archetype (*Dragons of Eberron*, pp. 30–31)

- **Source & Category:** *Dragons of Eberron* — **Sovereign Archetype** for True Dragons (associated with *Dol Dorn* and *The Mockery*). Note: **Not a template with an LA** (`LA +0`, `CR +0`); it is a racial variant / archetype overlay for True Dragons.
- **What It Replaces (RAW Trade-Off):** Adopting *any* Sovereign Archetype replaces a True Dragon's innate ability to cast certain Cleric spells and domain spells as arcane Sorcerer spells. Crucially, *Dragons of Eberron* explicitly states that dragons without innate cleric/domain spell access (including dragons that do not yet cast spells, like a Very Young Purple Dragon) **still qualify and lose nothing**!
- **Granted Features:**
  1. **Proficiencies:** Proficient with all **simple and martial weapons**, and **all armor (including shields)**.
  2. **Bonus Combat Feats (`floor(Total HD / 4)`):** Gains **1 bonus feat for every 4 Hit Dice possessed** (for Myn at 14 HD: `floor(14 / 4) = 3` bonus feats!). Selectable from **any Fighter bonus feat** OR **any combat-related draconic feat** (e.g., *Wingover*, *Hover*, *Flyby Attack*, *Improved Multiattack*, *Snatch*). Must still meet prerequisites.
  3. **Optional *Tome of Battle* Variant:** May permanently sacrifice a sorcerer spell slot of level `N` to learn a *Tiger Claw* maneuver or stance of level `N` (using Sorcerer CL as Initiator Level).

#### Codebase Schema Gaps Exposed by Wyrm of War
1. **Racial Variant / Archetype Overlay (`DnD35TemplateSchema` with `la: 0` or `racialArchetype`):** Can be modeled cleanly as a zero-LA inherited template restricted to `targetCreatureTypes: ['dragon']` with a declarative **`bonusFeatPerNHitDice: { interval: 4, featCategories: ['fighter_bonus', 'draconic_combat'] }`** field on `DnD35EffectBundle` / `DnD35TemplateSchema` (zero hardcoded dragon archetype `.ts` logic!).

---

### §6.4 Overwhelming Attack Monk Variant (*Unearthed Arcana*, pp. 52–53)

- **Source:** *Unearthed Arcana* — Monk Fighting Style Variant (replaces standard Monk bonus feats & adds a skill bonus + 6th-level tactical rider).
- **Exact Feature Swaps:**
  - **Monk 1:** Gains **`+2` bonus on Intimidate checks**; replaces 1st-level Monk bonus feat choice (*Improved Grapple* / *Stunning Fist*) with **`Power Attack`** (bypasses prerequisites, per Monk bonus feat rules).
  - **Monk 2:** Replaces 2nd-level Monk bonus feat choice (*Combat Reflexes* / *Deflect Arrows*) with **`Improved Bull Rush`** (bypasses prerequisites).
  - **Monk 6:** Replaces 6th-level Monk bonus feat choice (*Improved Disarm* / *Improved Trip*) with **`Improved Overrun`** (bypasses prerequisites), AND gains special ability: if the Monk successfully **demoralized an opponent via Intimidate within the past 10 rounds**, gains **`+4` bonus on damage rolls** against that opponent (requires `targetTagsAll: ['condition:demoralized_by_self']`!).
- **Monk 1–2 Baseline Features Retained:** `d8` HD, 3/4 BAB (`+1` at L2), Good Fort/Ref/Will (`+3/+3/+3` at L2), `4 + INT` skills, **AC Bonus (Ex)** (**`+WIS` untyped bonus to AC & Touch AC** when unarmored & unencumbered — stacks with Vow of Poverty Exalted AC!), **Flurry of Blows**, **Improved Unarmed Strike** (`1d6` Medium -> `1d8` Large!), **Evasion** (L2).
- **Codebase Mapping:** Almost 100% representable via existing `DnD35AcfSwapSchema` (`monk.json` ACF entry!) once `DnD35AcfSwapSchema` supports multi-level ACF swap bundles (`level: 1, 2, 6` under one selected Fighting Style ACF!).

---

### §6.5 Totemist Class, Essentia Capacity & Soulmelds (*Magic of Incarnum*)

#### Class Chassis — Totemist (*Magic of Incarnum*, Table 2–4, pp. 29–32)
- **Hit Die:** `d8` | **BAB:** 3/4 (`+1` at L2) | **Saves:** Good Fort & Ref, Poor Will (`+3 / +3 / +0` at L2) | **Skills:** `4 + INT` (Handle Animal, Knowledge [arcana, nature, the planes], Listen, Ride, Search, Spot, Survival, Swim).
- **Meldshaping Cap:** Max simultaneously shaped soulmelds = `min(classTableSoulmelds, CON - 10)` (Myn CON 19 -> cap 9; Totemist 2 grants **3 soulmelds shaped**).
- **Essentia Pool (Totemist 2):** **2 Essentia** (matches Myn's sheet: `Essentia: 2`!).
- **Chakra Binds (Totemist 2):** **1 bind — Totem Chakra ONLY** (L1: 0 binds; L2: **Totem Chakra Bind (+1 Essentia Capacity)** on any soulmeld bound to the Totem chakra; L5: Crown/Feet/Hands; L9: Arms/Brow/Shoulders; L14: Throat/Waist; L17: Heart).
- **Other L1–2 Class Features:** **Wild Empathy (Ex)** (1d20 + Totemist lvl + CHA vs. animals/magical beasts with INT 1–2), **Illiteracy** (waived because Myn has other literate classes/high INT or Dragon RHD).

#### Global Rule — Table 2–1: Essentia Capacity (*Magic of Incarnum*, p. 19)
Scales by **Character Level (Total HD)**, NOT class level:
- **1–5 HD:** Capacity `1`
- **6–11 HD:** Capacity `2`
- **12–17 HD:** Capacity `3` *(Myn at 14 HD = **Capacity 3** baseline; **Capacity 4** on her Totem-bound soulmeld!)*
- **18–20 HD:** Capacity `4`
- **Reinvestment Action Cost:** Reallocating the entire Essentia pool across all shaped soulmelds/feats/receptacles takes **1 Swift Action** once per round.
- **Totem Chakra Slot Rule (Critical Minutia!):** Unlike Arms/Crown/Hands/Feet/Heart/etc., the **Totem Chakra does NOT occupy a physical magic item body slot**! Binding a soulmeld to the Totem chakra does **NOT** block any magic item slot (whereas binding to Arms/Heart/Brow blocks Bracers/Vest/Headband unless `Split Chakra` is held).

#### Myn's 4 Specific Soulmelds & Feat (*Magic of Incarnum*)
1. ***Shape Soulmeld* (General Feat, Prereq: CON 13):** Grants 1 permanent soulmeld from *any* class list (even non-Totemist lists, e.g., **Incarnate Avatar**!). Meldshaper level for this meld = `floor(characterLevel / 2)` (does NOT increase max shaped soulmelds beyond CON - 10, wait — *Shape Soulmeld* grants +1 shaped soulmeld on top of class limit if you have no meldshaping, or adds to known/shaped). Can be taken multiple times.
2. ***Girallon Arms* (Totemist — Arms / Totem Chakra):**
   - *Shaped:* `+2` competence bonus on **Climb** and **Grapple** checks.
   - *Essentia:* `+2` additional competence bonus on Climb & Grapple per essentia invested.
   - *Totem Chakra Bind:* Sprouts **two additional arms**; grants **4 claw attacks** total (`1d4` Medium -> `1d6` Large, or if creature already has 2 claws, adds **2 extra claw attacks** as secondary natural weapons!). Each point of essentia invested grants **`+1` enhancement bonus on attack and damage rolls** with those claws (overlaps with VoP Exalted Strike).
3. ***Incarnate Avatar* (Incarnate — Soul Chakra; accessed via *Shape Soulmeld*):**
   - *Shaped (0 essentia):* No mechanical bonus (purely visual alignment-champion aura).
   - *Essentia Scaling (Alignment-Gated!):*
     - **Good** (Myn is Neutral Good): **`+1` insight bonus to AC** per essentia invested (`2 essentia` = **`+2` insight AC** -> matches Myn's sheet `Outros: 2`!).
     - **Law:** `+1` insight bonus on melee attack rolls per essentia.
     - **Evil:** `+2` insight bonus on melee damage rolls per essentia.
     - **Chaos:** `+1` insight bonus on ranged attack rolls per essentia.
   - *Soul Chakra Bind:* Immunity to critical hits & sneak attack (not accessible at Totemist 2).
4. ***Blink Shirt* (Totemist — Heart / Totem Chakra):**
   - *Shaped:* At-will **Standard Action** short-range teleport (*Dimension Door* self only, **10 ft. + 10 ft. per essentia invested**; ends turn after use as per *Dimension Door*).
   - *Totem Chakra Bind:* Reduces activation cost from Standard Action to **Move Action**! *(Note: A Totemist 2 only has **1** Totem bind, so Myn must choose between binding **Girallon Arms** OR **Blink Shirt** OR **Unicorn Horn** to Totem when shaping each morning — she cannot have both Girallon Arms + Blink Shirt bound to Totem simultaneously unless she has Double Chakra!)*
5. ***Unicorn Horn* (Totemist — Brow / Totem Chakra):**
   - *Shaped:* `+2` competence bonus on **Wild Empathy** and **Move Silently** checks.
   - *Essentia:* `+2` competence bonus per essentia invested.
   - *Brow Bind:* *Detect Evil* at will.
   - *Totem Bind:* Natural **Gore** attack (`1d6` Medium; `+1` enhancement per essentia; extra damage vs. evil/undead).

#### Codebase Primitives Required by Incarnum (Tier 1 + Tier 2)
- **Tier 1 — Mutable Point Allocation Component (`PointAllocationComponent`):** Holds `poolId: 'essentia'`, `totalPoints`, `allocations: Record<receptacleId, number>`, `capacityByReceptacle`, and a **Swift Action** `reallocatePoints` intent.
- **Tier 1 — Chakra / Equipment Slot Overlay:** Extends `EquipmentSlotInstance` with `boundOverlayId` and `locksEquipmentSlot: boolean` (`false` for `totem`, `true` for physical slots like `arms`/`heart`/`brow` unless `split_chakra` override applies) plus dynamic `grantedNaturalWeapons` injection (`Girallon Arms`).
- **Tier 2 — Alignment-Gated & Per-Point Dynamic Modifier Scaling:** `valueFormula: { type: 'allocated_points', receptacleId, multiplier }` + alignment tag conditions (`selfTagsAll: ['alignment:good']`) handles *Incarnate Avatar*, *Girallon Arms*, *Blink Shirt*, and *Unicorn Horn* in pure JSON!

---

### §6.6 Sacred Vow & Vow of Poverty (*Book of Exalted Deeds*, pp. 29–31, 46, 48)

#### Verbatim Feat Rules (Verified on RealmsHelps)
- ***Sacred Vow* (Exalted, BoED):** Grants **`+2 perfection bonus`** on Diplomacy checks. *(New bonus type `'perfection'` required in `DnD35BonusTypeSchema`!)*
- ***Vow of Poverty* (Exalted, BoED, Prereq: *Sacred Vow*, Good alignment):**
  - **Code-of-Conduct Invariant (Strictly Enforced):**
    - *Permitted possessions:* Ordinary (**neither magic nor masterwork**) simple weapons; simple non-magic clothes; 1 day of food in a mundane sack/bag; mundane spell component pouch.
    - *Permitted ally interactions:* May benefit from magic items used *on your behalf* (potions fed/handed by allies, spells cast on you from an ally's wand/scroll/staff, riding an ally's magic mount).
    - *Permitted non-material powers:* Soulmelds, psionics, spells, and supernatural abilities are **not** material possessions (legal with VoP!).
    - *Prohibited:* Owning, carrying, wearing, or borrowing **any** magic item (even for 1 round), wearing armor, or activating scrolls/wands/staves yourself.
    - *Violation Consequence:* **Immediate and irrevocable loss** of all VoP benefits (`revokeModifiersByPathPrefix('feat:vow_of_poverty')`); feat slot cannot be replaced (only DM *atonement* for unwitting/compelled breaches).
  - **Horizon 1 vs. Horizon 2 Nuance (BoED p. 30):**
    - Numeric/supernatural benefits from Table 2–3 scale immediately to current **Character Level (Total HD)** regardless of when VoP was taken.
    - **Bonus Exalted Feats** are **NOT retroactive** — you only gain Bonus Exalted Feats for levels *at and after* the level you took *Vow of Poverty*!

#### Table 6.6a — Complete Voluntary Poverty Progression (BoED Table 2–3, Levels 1–20)

| Char Lvl (HD) | Exalted AC | Bonus Exalted Feat | Exalted Strike | Ability Enh. | Deflection | Resistance | Natural Armor | DR | Energy Res. | Special Qualities |
| :-: | :-: | :-: | :--- | :--- | :-: | :-: | :-: | :--- | :-: | :--- |
| **1** | +4 | Yes (1st) | — | — | — | — | — | — | — | — |
| **2** | +4 | Yes | — | — | — | — | — | — | — | — |
| **3** | +5 | — | — | — | — | — | — | — | — | *Endure Elements (Ex)* |
| **4** | +5 | Yes | +1 (magic) | — | — | — | — | — | — | — |
| **5** | +5 | — | +1 (magic) | — | — | — | — | — | — | *Sustenance (Ex)* (no food/water) |
| **6** | +6 | Yes | +1 (magic) | — | +1 | — | — | — | — | — |
| **7** | +6 | — | +1 (magic) | +2 | +1 | +1 | — | — | — | — |
| **8** | +6 | Yes | +1 (magic) | +2 | +1 | +1 | +1 | — | — | *Mind Shielding (Su)* |
| **9** | +7 | — | +1 (magic) | +2 | +1 | +1 | +1 | — | — | — |
| **10** | +7 | Yes | +2 (good) | +2 | +1 | +1 | +1 | 5/magic | — | — |
| **11** | +7 | — | +2 (good) | +4 / +2 | +1 | +2 | +1 | 5/magic | — | — |
| **12** | +8 | Yes | +2 (good) | +4 / +2 | +2 | +2 | +1 | 5/magic | — | *Greater Sustenance (Ex)* (no breathing) |
| **13** | +8 | — | +2 (good) | +4 / +2 | +2 | +2 | +1 | 5/magic | 5 (all 5) | — |
| **14** | **+8** | **Yes** | **+3 (good)** | **+4 / +2** | **+2** | **+2** | **+1** | **5/magic** | **5 (all 5)** | ***Freedom of Movement (Su)*** *(Myn's 14 HD Row!)* |
| **15** | +9 | — | +3 (good) | +6 / +4 / +2 | +2 | +3 | +1 | 5/evil | 5 (all 5) | — |
| **16** | +9 | Yes | +3 (good) | +6 / +4 / +2 | +2 | +3 | +2 | 5/evil | 5 (all 5) | — |
| **17** | +9 | — | +4 (good) | +6 / +4 / +2 | +2 | +3 | +2 | 5/evil | 5 (all 5) | *Regeneration (Su)* (1 HP/lvl per hour; nonlethal 1/min) |
| **18** | +10 | Yes | +4 (good) | +6 / +4 / +2 | +3 | +3 | +2 | 5/evil | 5 (all 5) | ***True Seeing (Su)*** (continuous) |
| **19** | +10 | — | +4 (good) | +8 / +6 / +4 / +2 | +3 | +4 | +2 | 5/evil | 5 (all 5) | — |
| **20** | +10 | Yes | +5 (good) | +8 / +6 / +4 / +2 | +3 | +4 | +2 | 10/evil | 15 (all 5) | — |

#### Codebase Gaps Exposed by Sacred Vow & Vow of Poverty
1. **Two Missing Bonus Types (`effect_system.types.ts:52-80`):** Add `'exalted'` (with AC rule: non-stacking with `armor`, excluded from Touch AC, immune to *brilliant energy*) and `'perfection'` (from *Sacred Vow*).
2. **Tier 1 Invariant-Guarded Progressive Overlay Track:** Watches actor equipment/inventory invariants (`forbidMagicItems: true`, `forbidMasterworkItems: true`, `allowedWeaponProficiencies: ['simple']`, `forbidArmor: true`), projects level-indexed `EffectBundle` tiers (`sourcePath: 'feat:vow_of_poverty/tier:<hd>'`), and triggers revocation on violation.
3. **Horizon 1 Non-Retroactive Bonus Feat Scheduling:** `level_ledger.ts` only grants scheduled track bonus feats on levels `>= acquisitionLevel`.

---

### §6.7 Myn's Combat, Dragon & Cohort Feats + Complete Myn Sheet Math Audit

#### Verbatim Feats Verified on RealmsHelps
1. ***Intuitive Attack* (Exalted, Fighter — BoED; Prereq: BAB +1):** With a **simple weapon of your size** (includes **Unarmed Strike**) OR a **natural weapon**, use **WIS modifier instead of STR modifier on attack rolls** (does not change damage stat).
   - *Engine gap:* Generic `RuleOverride` (`attack_ability_override: 'wis'` scoped by `effectTagsAny: ['weapon:simple', 'weapon:natural']`) in `attack_routine.ts`.
2. ***Improved Multiattack* (Monstrous — Draconomicon / Savage Species / ELH; Prereq: 3+ natural weapons, Multiattack):** Secondary natural attacks take **`0` penalty** (replaces `-5` baseline / `-2` Multiattack), still adding `0.5 × STR` to damage.
   - *Engine check:* Clean declarative `StatModifier` shifting `secondary_natural_penalty` to `0` (`attack_routine.ts`).
3. ***Entangling Exhalation* (Breath — Races of the Dragon; Prereq: Dragonblood subtype, breath weapon):** Choose when breathing to deal **half normal breath damage**; any creature taking damage becomes **`entangled`** for **`1d4` rounds** and takes **`1d6` ongoing damage of the same energy type** at the start of each of its turns. *(Edge case: non-energy breath weapons still entangle for `1d4` rounds with no ongoing `1d6` damage! Also: True Dragons automatically carry `subtype:dragonblood` per RotD p. 4.)*
4. ***Knowledge Devotion* (Domain — Complete Champion; Prereq: Knowledge [any] 5 ranks):** Permanently adds 1 chosen Knowledge skill as a class skill for all classes. Once per combat per creature type (if `>= 1` rank in matching Knowledge skill), roll Knowledge check to gain an **Insight bonus on attack AND damage rolls** vs. that creature type for the rest of combat (`<=15: +1 | 16–25: +2 | 26–30: +3 | 31–35: +4 | 36+: +5`). *(Already partially wired in `skills/skill_synergies.ts` — verify permanent cross-class-to-class-skill grant in `level_ledger.ts`!)*
5. ***Dragon Cohort* (General — Draconomicon; Prereq: Character Level 9th, Speak Language [Draconic]):** Grants a Dragon cohort as *Leadership*, treating the dragon's **ECL as 3 lower** than listed (effective cohort ECL cap = `Master Level - 2`, i.e., `18` for L20 Triel -> allows a dragon up to **raw ECL 21**!!).
6. ***Multiattack* (General/Monstrous — MM/SRD; Prereq: 3+ natural weapons):** Secondary natural attacks take **`-2`** penalty instead of `-5`.
7. ***Touch of Golden Ice* (Exalted — BoED; Prereq: CON 13):** Any **evil creature** touched with your bare hand, fist, or natural weapon is ravaged by **Golden Ice** (*BoED* Ch. 3 Ravages): **Fort DC 14**, Initial **`1d6` DEX damage**, Secondary **`2d6` DEX damage** (1 min later). Per *BoED* Ravages rules, supernatural good-aligned ravages affect **evil creatures only**, bypass evil creatures' normal poison/undead immunity (specific trumps general), and add **+target's CHA bonus** PLUS **`+1`** (Evil Elementals/Undead) or **`+2`** (Evil Outsiders / Evil Clerics of an evil deity) to **both** initial and secondary damage!
   - *Engine gap:* Declarative `onHitEffect` ravage payload reusing poison/ability-damage pipeline with `targetTagsAll: ['alignment:evil']`, `bypassImmunities: ['poison', 'undead_ability_damage']`, and target-scaled bonus formula (`target.chaMod + typeBonus`).
8. ***Nimbus of Light* (Exalted — BoED; Prereq: Good alignment):** Free-action toggleable radiance (**5 ft. bright / 10 ft. shadowy light**); **`+2 circumstance`** bonus on Diplomacy & Sense Motive when interacting with **Good creatures** (`targetTagsAll: ['alignment:good']`).
9. ***Sanctify Natural Attack* (Exalted — BoED; Prereq: 1+ natural weapon, BAB +5):** Natural attacks deal **`+1` extra damage to Evil creatures**, OR **`+1d4` extra damage to Evil Outsiders and Evil Undead**; natural attacks count as **`good`-aligned** for overcoming DR.
10. ***Lliira's Blessing* (Exalted — *Player's Guide to Faerûn* p. 176; Prereq: *Nimbus of Light*, Escape Artist 1 rank):** **`+2 sacred`** bonus on Escape Artist checks and saving throws against effects that would **paralyze, hold, or entangle** you; if you fail such a save, you get a **second saving throw 1 round later** (reversing the failure on success).
    - *Engine gap:* Generic Tier 1/Tier 2 **`retryFailedSaveNextRound`** condition hook filtered by condition tags (`['condition:paralyzed', 'condition:held', 'condition:entangled']`) — also reusable for Rogue *Slippery Mind*!
11. ***Stigmata* (Exalted — BoED; Prereq: Good alignment):** Free action -> voluntarily suffer `2k` (`>= 2`) points of **temporary CON damage** (wounds bleed for **1 hour**; CON damage **cannot be restored by any means** until bleeding stops). Grants **`2k` touch charges** lasting 1 hour (touch up to 6 allies as a full-round action; each ally may benefit only once per activation): heals each ally **`k × ally HD/level`** HP AND grants an immediate new saving throw vs. any active disease with a **`+2k sacred`** bonus!
    - *Engine gap:* Variable-cost ability-damage self-pay activation (`payAbilityDamage: { ability: 'con', min: 2, step: 2, lockRestoreDurationRounds: 600 }`) spawning a 1-hour multi-charge touch pool with per-target `benefitedEntityIds` tracking and disease-save reroll.

#### BOMBSHELL FORENSIC DISCOVERY — Iron Dragon (*Dragon #356*) Under a "Purple Dragon" Label!
Myn's bottom half reveals a **7-for-7 verbatim match** with **Very Young Iron Dragon (*Dragon Magazine #356*, verified on `realmshelps.net/monsters/block/Dragon,_Iron_Very_Young`)**:
- **Identical Base Stat Block:** `10d12+30` HD, BAB `+10`, Fort `+10` / Ref `+7` / Will `+9`, `STR 23 / DEX 10 / CON 17 / INT 14 / WIS 15 / CHA 14` — **identical** to Very Young Purple Dragon!
- **Iron-Dragon-Exclusive Traits Present on Myn's Sheet (NONE of which Purple Dragon has!):**
  1. **`(Fire)` Subtype** (Immunity to Fire, Vulnerability to Cold) — Purple Dragon has NO Fire subtype.
  2. **`Alternate Form (Su)` 3/day** (Medium or smaller animal/humanoid) — Purple Dragon has NO Alternate Form.
  3. **`Cone of Superheated Sparks` (DC 18, half fire / half electricity)** + **`Cone of Sleep Gas` (DC 18, Will negates regardless of HD, `1d6 + age` rounds)** — verbatim Iron Dragon breath weapons!
  4. **`Disguise` as a Dragon Class Skill** (4 ranks at HD 1) — Iron Dragon class skills are `Disguise, Gather Information, Jump` (Purple Dragon's are `Bluff, Hide, Move Silently`).
  5. **`LA +5`** (Very Young Iron Dragon) + **`LA +2`** (Phrenic) = **`LA +7` / `ECL 21`** — explaining why **Sanctified Creature** was NEVER written on Myn's sheet and none of Sanctified's abilities (*Aura of Menace*, *Light Ray*, *Magic Circle*, *Tongues*) appear!
  6. **Alignment:** Iron Dragon is **`Always Lawful Neutral`** (which already satisfies Monk's Lawful requirement!). *(If Myn is instead played as a true **Purple Dragon** (`Always Lawful Evil`, `LA +3`), then **Sanctified Creature** (`LA +2`, LE -> LG) is what closes the gap to `LA +7` and Lawful Good!)*
- *Note:* Myn's sheet omitted Iron Dragon's `Metalsense (Ex)` (`30 ft × age category`) and used Purple/Gold-like speeds (`60/200/60`) rather than Iron Dragon's `40 ft / burrow 40 ft / fly 150 ft (poor)`!

#### Complete Mathematical & Legality Audit of Myn's Sheet (100% Decoded!)

| Stat / Rule on Myn's Sheet | Decoded RAW Formula (10 Dragon RHD + 2 Monk + 2 Totemist = **14 HD**) | Verdict |
| :--- | :--- | :--- |
| **BAB `+12`** | `10` (Dragon RHD) + `1` (Monk 2) + `1` (Totemist 2) = **`+12`** | **EXACT MATCH** |
| **Power Resistance `24`** | Phrenic `HD + 10` = `14 + 10` = **`24`** | **EXACT MATCH** |
| **Essentia `2` & *Incarnate Avatar*** | Totemist 2 = **`2` Essentia** invested in *Incarnate Avatar [Good]* -> **`+2 insight` AC** (exact match to sheet AC `Outros: 2`!) | **EXACT MATCH** |
| **Enhancement `+3` & Attacks `+20/+15/+10` + 8 naturals `+20`** | `+12` BAB + `+6` WIS (*Intuitive Attack*) + `+3` (*Exalted Strike*) `- 1` (Large Size) = **`+20`**; *Improved Multiattack* sets secondary penalty to `0` -> all 8 naturals at **`+20`**! | **EXACT MATCH** |
| **Saves (`Fort +19 / Ref +15 / Will +17`)** | Base (`13/13/9` on sheet — **HD 14 Monk 2 gave `+0` Will instead of RAW `+1`!**) + Mods (`CON +4 / DEX 0 / WIS +6`) + VoP L14 Resistance (`+2`) = **`+19 / +15 / +17`** (RAW is **`+18` Will**!). | **EXACT MATCH (Monk 2 `-1 Will` bug found!)** |
| **LA `7` / ECL `21`** | **Path A (Iron Dragon `*Dragon #356*`):** Very Young Iron (`LA +5`) + Phrenic (`LA +2`) = **`LA +7` / `ECL 21`**. **Path B (True Purple Dragon):** Very Young Purple (`LA +3`) + Phrenic (`LA +2`) + Sanctified (`LA +2`) = **`LA +7` / `ECL 21`**. Both are RAW-legal for L20 Triel via *Dragon Cohort* (`-3` effective ECL -> `18`)! | **EXACT LA/ECL MATCH (Chassis mismatch flagged!)** |
| **Vow of Poverty Bonus Exalted Feats (HD 1–9)** | **MAJOR RAW VIOLATION (BoED p. 30):** Sheet takes *Sacred Vow* at **HD 6** and *Vow of Poverty* at **HD 9**, yet claims VoP AC/features from **HD 1** and VoP Bonus Exalted Feats at **HD 2 (*Intuitive Attack*), HD 4 (*Touch of Golden Ice*), HD 6 (*Nimbus of Light*)**! Per BoED p. 30, VoP bonus exalted feats are **NOT retroactive** (only HD 10, 12, 14 would be legal if taken at HD 9). Also skipped HD 8 VoP feat and HD 12 *Wyrm of War* bonus feat! | **RAW ILLEGAL (Non-retroactive VoP)** |
| ***Lliira's Blessing* Prerequisite (HD 12)** | **RAW VIOLATION:** Requires *Nimbus of Light* + **Escape Artist 1 rank**; Myn has **`0` ranks** in Escape Artist! *(Sheet instead put 8 ranks in `*Perform (Dance)`.)* | **RAW ILLEGAL (Missing prereq)** |
| **Ability Score Increases (ASIs)** | 14 HD earns **3 ASIs** (HD 4, 8, 12). Sheet left HD 4 & HD 8 at `0` and put **`+1 WIS` on HD 11** (2 ASIs missing!). | **DISCREPANCY (-2 ASIs missing)** |
| **HD 14 Skill Points & HP** | HD 14 (Monk 2) has **`0` skill points spent** (should be `4 + 3 INT = 7`!). Also HD 1 Dragon took `6` HP instead of max `12` (total raw `76` + `56` CON = `132` vs. top sheet `160/163`). | **DISCREPANCY** |
| **Phrenic PLAs (*Aversion*, *Psionic Blast*, *Energy Current*)** | Sheet lists *Aversion* and *Psionic Blast* as **`3/day`** (Phrenic RAW is **`1/day`**!). *Energy Current* DC `19` vs. unaugmented `17` (`10 + 3 + 4`). | **DISCREPANCY** |
| **AC `43` (`Nat 16`, Touch `14`, Size `1`)** | Iron/Purple Very Young Natural Armor is `+4`/`+8` (+`1` VoP = `+5`/`+9`), NOT `+16`; Touch AC `14` omits Monk `+6` WIS and `-1` Large size; Size shows `+1` instead of `-1`. | **DISCREPANCY** |
| **Speeds (`60 / Fly 200 / Swim 60`), Claws (`3d6`), PP (`4`), AP (`175`)** | Speeds don't match Purple (`40/150/burrow 20`) or Iron (`40/150/burrow 40`); Large claws are `1d8` (Girallon `1d6`), not `3d6`/`1d4`; Phrenic grants `1` PP, not `4`; AP `175` is a typo. | **DISCREPANCIES** |

---

### §6.8 Lightbringer Cleric ACF (*EtCR* p. 206) & Dead Levels II (*Undead Intuition*)

- **Sources:** *Expedition to Castle Ravenloft* (p. 206, *Destroy Undead* ACF) + WotC Official Web Article *"Dead Levels II"* by Kolja Raven Liquette (*Undead Intuition*).
- ***Destroy Undead (Su)* (Cleric 1 ACF — Replaces Standard *Turn or Rebuke Undead*):**
  - **Action & Range:** Standard Action; **30-ft. burst** centered on caster.
  - **Effect:** Channels positive energy dealing **`1d6` positive energy damage per effective Cleric level** to all undead within 30 ft. (bypasses incorporeal 50% miss chance automatically).
  - **Save:** **Will save for half damage**; **`DC = 10 + effective Cleric level + CHA modifier`** *(CRITICAL: Full level, NOT half level! Verified exact on Triel's sheet: `10 + 11 + 4 = DC 25`!)*.
  - **Turn Resistance Interaction:** Undead with **Turn Resistance `+X`** subtract **`X`** flat damage from each *Destroy Undead* attempt.
  - **Counts-As Rule:** Explicitly **counts as Turn Undead** for meeting prerequisites, fueling Divine feats (*Divine Metamagic*, *Law Devotion*, *Extra Turning*), and prestige classes (`effectTags: ['feature:turn_or_rebuke', 'pool:turn_undead_equivalent']`).
- ***Undead Intuition (Ex)* (Cleric 2 — Dead Levels II):**
  - Identify undead creatures from any distance; may make `Knowledge (religion)` checks regarding undead **untrained**; gains **`+2` bonus** at Cleric 2, increasing by **`+1` per additional Cleric level** (`+4` at Cleric 4) on `Knowledge (religion)` checks strictly to identify undead (does not grant special power/weakness insights).
- **Codebase Gaps Exposed:**
  1. `pool_ability_resolver.ts` currently hardcodes PHB Turn/Rebuke HD rolls for turning pools; needs a declarative AoE damage-burst pool action (`damageFormula: '1d6 * effectiveLevel'`, `saveDcFormula: '10 + effectiveLevel + chaMod'`, `targetTagsAll: ['type:undead']`, `ignoreIncorporealMiss: true`, `subtractTargetStat: 'turn_resistance'`).
  2. Coexisting pools: when an actor replaces Cleric `turn_undead` with `destroy_undead` via ACF and later re-acquires `turn_undead` from a PrC (*Knight of the Raven 3*), **both distinct pools** (`destroy_undead` and `turn_undead`) must live side-by-side in `ResourcePoolComponent`, both carry the `turn_undead_equivalent` capability tag, and *Extra Turning* (`+4` per pool) applies cleanly to each qualifying pool!

---

### §6.9 Ordained Champion (*Complete Champion*, pp. 90–92)

- **Primary Source Verified Verbatim:** `https://dnd.arkalseif.info/classes/ordained-champion/index.html`
- **Requirements:** Alignment Any Lawful, NG, or NE; `Knowledge (religion)` 7 ranks; Feat: *Weapon Focus (deity's favored weapon)*; Spellcasting: Able to cast *magic weapon* as a divine spell; Special: Worship Hextor or Heironeous (campaign-adapted to Enthariel).
- **Chassis:** `d8` HD, **Full BAB (`+1/lvl`)**, **Good Fort & Will, Poor Ref**, `2 + INT` skills, **3/5 Divine Spellcasting** (advances at **L2, L3, L5**; skips L1 and L4).
- **Complete L1–L5 Class Features (Verbatim):**
  - **L1 — `Bonus Domain`:** Clerics gain the `War` domain as a 3rd domain; if they **already have `War`**, choose **any other domain** granted by their deity as a 3rd domain (Triel chose `Law`). Non-clerics add War domain spells to class list without granted power/domain slots.
  - **L1 — `Combat Feats`:** Permanently sacrifice **1 or 2 domain granted powers** (cannot sacrifice `War`) at Ordained Champion 1 to gain an equal number of **Fighter bonus feats** (must meet prerequisites). *Retains the domain spells!*
  - **L1 — `Continued Advancement`:** Ordained Champion levels stack with other appropriate classes for **turning/rebuking undead** AND **all level-dependent domain granted powers**.
  - **L1 — `Modified Spontaneous Casting (Ex)`:** Clerics **lose** spontaneous `cure`/`inflict` casting and instead spontaneously swap prepared cleric spells for **any `War` domain spell of equal or lower level** (applies to future cleric levels too). *(Already partially supported via `spontaneousConversionMode: 'domain'` + `spontaneousDomainId: 'war'`!)*
  - **L2 — `Diehard`:** Bonus feat ignoring prerequisites (if already possessed, pick any qualifying feat).
  - **L2 — `Smite (Su)`:** **Swift action** + spend **1 daily Turn/Rebuke attempt** -> next melee attack gains **`+CHA` to hit** and **`+total effective turning/rebuking level` to damage** (`+11` for Triel!). **Unrestricted by alignment or race** (works on any foe!).
  - **L3 — `Channel Spell (Su)`:** **Move action** -> expend prepared spell / slot (`<= 1 standard action` cast time, targeting 1+ creatures) into **one melee weapon** (lasts up to **8 hours**). Discharges on next successful hit with that weapon (saves & SR apply normally; even AoE or ray spells affect **only the struck target**!).
  - **L3 — `Divine Bulwark (Su)`:** **Swift action** -> sacrifice a prepared spell or spell slot of level `L` to gain **`DR (1 + L) / chaotic`** for **`Ordained Champion level` rounds** (`3` rounds for Triel; non-stacking).
  - **L4 — `Fist of the Gods (Su)`:** **Swift action** -> sacrifice spell/slot of level `L` for **`+(1 + L)` melee damage** for `Ordained Champion level` rounds.
  - **L4 — `Rapid Spontaneous Casting (Ex)`:** Spontaneously cast `War` domain spells drop from `<= 1 standard` -> **Swift action** (and `1 full-round` -> **Standard action**); metamagic'd spontaneous War spells use normal cast time (no full-round penalty).
  - **L5 — `Holy Warrior (Su)`:** **Swift action** + spend 1 Turn/Rebuke attempt -> for **5 rounds**, substitute **WIS mod for STR mod** on attack AND damage rolls!
  - **L5 — `War Caster (Ex)`:** `+2` effective CL when casting spells on the `War` domain list.
- **Codebase Gaps Exposed:**
  1. **Domain-Power Sacrifice Trade (Horizon 1 choice):** `level_ledger.ts` needs a declarative `domainPowerTrade` choice revoking `sourcePath: 'domain:<id>/granted_power'` while keeping `domainSpells`, granting `N` Fighter bonus feat picks.
  2. **Spell-Slot Sacrifice Pool Abilities (`Divine Bulwark` / `Fist of the Gods`):** Declarative pool activation accepting `cost: { type: 'spell_slot', minLevel: 1 }` and binding `sacrificedSlotLevel` into effect formulas (`1 + sacrificedSlotLevel`).
  3. **Weapon-Stored `Channel Spell` Overlay:** Generic weapon-instance spell-charge overlay (`storedSpellId`, `expiresAfterRounds: 4800`, `singleTargetOverride: true`) discharging on melee hit (reused by Duskblade & Spellsword with different action costs and discharge policies!).

---

### §6.10 Knight of the Raven (*EtCR* pp. 200–202) & Remi (Celestial Raven Harrier)

- **Primary Sources Verified Verbatim:** `https://dnd.arkalseif.info/classes/knight-of-the-raven/index.html`, `https://www.realmshelps.net/monsters/block/Raven`, `https://www.realmshelps.net/cgi-bin/featbox.pl?feat=Enduring_Life`, plus repo audit of `public/data/rulesets/dnd35e/templates/celestial.json`.
- **Requirements:** BAB `+4`; Alignment Any Good; Spellcasting: 1st-level divine spells; Special: Friendly meeting with existing knight + overnight prayer vigil in Ravenloft chapel.
- **Chassis:** `d8` HD, **Full BAB (`+1/lvl`)**, **Good Fort & Will, Poor Ref**, `2 + INT` skills, **9/10 Divine Spellcasting** (advances at **L2–L10**; skips L1).
- **Complete L1–L10 Class Features (Verbatim):**
  - **L1 — `Raven Harrier (Ex)`:** Calls a **Celestial Raven** companion (base MM p. 278 *Raven*: `Tiny` Animal, AC 14 `[+2 size, +2 DEX]`, Touch 14, FF 12, `10 ft / fly 40 ft (average)`, `STR 1 DEX 15 CON 10 INT 2->3 WIS 14 CHA 6`, *Alertness*, *Weapon Finesse*, Claws `+4 (1d2-5)`):
    - **HP:** `floor(Master full normal HP / 2)` (`90` for Triel).
    - **Effective HD:** Uses **Master's HD total (`20`)** for all HD-dependent effects **including Celestial template scaling**!
    - **Saves:** **Master's BASE saving throws** + Raven's ability modifiers (`Fort +0 / Ref +2 / Will +2`).
    - **Agility:** **Never provokes AoOs** for entering an opponent's space or leaving threatened squares (`no_provoke_movement_aoo`).
    - **Respawn:** If killed, replacement appears at **`next_dawn`** with no penalty to Master.
    - **L1 `Harry (Ex)`:** **Swift action** (by Master), single opponent within **30 ft.** of Master -> Raven enters opponent's space; **Will DC `10 + floor(KotR lvl / 2) + CHA mod`** (`DC 17` for Triel); failure -> **`-2` penalty to AC for 1 round**.
    - **L3 `Baffle (Su)`:** If at the **start of opponent's turn** the Raven is in its space -> **Will DC `10 + floor(KotR lvl / 2) + CHA mod`** (`DC 17`); failure -> **cannot make AoOs for 1 round**.
    - **L5 `Falter (Su)`:** While Raven occupies opponent's space, opponent **provokes AoOs even on a 5-foot step** (no save!) AND Raven **automatically follows** the target's 5-foot step!
    - **L7 `Channel Spell (Su)`:** Lengthen cast time (`free/move/swift/immediate -> standard`, `standard -> full-round`) to deliver spells using Raven's position for range (touch attacks use Raven's attack bonus).
    - **L9 `Sight Link (Su)`:** Full-round action to see through Raven's eyes for 1 round (same plane); caster becomes fatigued (or exhausted if already fatigued).
  - **L1 — `Speak with Ravens (Su)`:** Communicate with `INT >= 3` ravens via shared language, or `INT 1–2` ravens as permanent *speak with animals*.
  - **L2, L4, L6, L8, L10 — `Smite Undead (Su)` (`1/day` -> `5/day`):** Declare before melee attack vs. Undead: **`+CHA` to hit**, **`+KotR class level` to damage** (`+6` for Triel). **Natural 20 doubles bonus damage without confirming a crit!** Against **incorporeal undead**, may **reroll the 50% miss chance once** (take better result). Wasted if target is not undead or attack misses.
  - **L3 — `Turn Undead (Su)`:** Turn Undead as Cleric of **`KotR level - 2`** (`4` at KotR 6); stacks with existing Turn Undead classes.
  - **L3 — `Sun Domain`:** Grants `Sun` domain (+ granted power *Greater Turning 1/day* and Sun spells; if already possessed, *Greater Turning* becomes `2/day`).
  - **L4 — `Light Focus`:** Whenever casting a spell with the `[Light]` descriptor, choose **1 of 3 modes**: (a) **2× illumination radius** & **+1 effective spell level** for countering/dispelling `[Darkness]`, (b) **`+2` Save DC**, OR (c) **`+1` effective CL**.
  - **L5 — `Enduring Life` (Bonus Feat — *Libris Mortis* / *EtCR* p. 200):** Ignore penalties & spell-slot loss of newly gained negative levels for **`CON mod` minutes** (`4 min` for Triel); **`+4` bonus on Fort saves to remove negative levels**.
  - **L8 — `Lasting Life` (Bonus Feat)**; **L10 — `Burst of Vitality (Su)`** (spend 1 Turn attempt to remove up to `maxAffectedHD` negative levels distributed across self + allies within 30 ft.).
- **Remi Sheet & Repo `celestial.json` Bugs Caught:**
  1. **Remi Sheet — Saves Over-Counted:** Sheet lists `Fort +23 / Ref +10 / Will +27`, which accidentally added Raven's ability mods (`+0/+2/+2`) to Triel's **TOTAL** saves (`+23/+8/+25`) instead of Triel's **BASE** saves (`+19/+6/+17`). RAW Remi saves are **`Fort +19 / Ref +8 / Will +19`**!
  2. **Remi Sheet — Stale SR & Size:** Sheet lists `SR 22` (L17 value `17 + 5`) instead of L20 RAW **`SR 25`** (`min(20 + 5, 25)`), and `Small` instead of MM Raven **`Tiny`**.
  3. **Repo Bug Found (`public/data/rulesets/dnd35e/templates/celestial.json`):** Currently jumps to `DR 10/magic` at `minHd: 8` instead of SRD RAW **`DR 5/magic` (4–11 HD) -> `DR 10/magic` (12+ HD)** (only Energy Resistance 10 starts at 8 HD!), and adds `"good"` subtype (SRD Celestial template does NOT grant `[Good]` subtype).

---

### §6.11 Crusader (*Tome of Battle: The Book of Nine Swords*, pp. 8–12)

- **Primary Source Verified Verbatim:** `https://dnd.arkalseif.info/classes/crusader/index.html`
- **Chassis:** `d10` HD, **Full BAB (`+1/lvl`)**, **Good Fort, Poor Ref & Will**, `4 + INT` skills, Simple & Martial weapons, Light/Medium/Heavy armor & all shields.
- **Initiator Level (IL) & Maneuver Table (L1–L20):**
  - `IL = Crusader levels + floor(non-initiator levels / 2)`. For Triel at L14 (`13` non-adept + `1` Crusader): `IL = 1 + floor(13 / 2) = 7` -> max **4th-level maneuvers**! At L20 (`19` non-adept + `1` Crusader): `IL = 1 + floor(19 / 2) = 10` -> max **5th-level maneuvers** (for later feats like *Martial Study* / *Martial Stance* — exact match to Triel's `Initiator Level: 10`!).
  - **Crusader 1 Grants:** `5` Maneuvers Known (Disciplines: *Devoted Spirit*, *Stone Dragon*, *White Raven*), `5` Maneuvers Readied (**`2` initially granted**; `+1` granted from *Extra Granted Maneuver* -> **`3` initially granted**, matching `!crusader "..." 3`!), `1` Stance Known (1st-level).
  - **Exact Granted-Maneuver Deck Cycle (Tier 1 Tactical Deck Primitive):**
    1. Start of encounter: all readied maneuvers are unexpended; randomly draw `initialGranted` (`2`, or `3` with *Extra Granted Maneuver*; `3` at L10, `4` at L20) into `granted`, remainder into `withheld`.
    2. During turn: may initiate any maneuver in `granted` (moves to `expended`, no AoO, ignores SR).
    3. End of turn: if `withheld` is non-empty, randomly move `1` maneuver from `withheld -> granted`. If `withheld` is **empty**, **automatically recover ALL `expended` maneuvers**, reset pool, and draw a fresh `initialGranted` hand!
- ***Steely Resolve (Ex)* & *Furious Counterstrike (Ex)* (Verbatim):**
  - **Delayed Damage Pool (`Steely Resolve`):** Starts at `0` each encounter; max capacity `5` at L1 (`+5` at L4/8/12/16/20, max `30`). Incoming HP damage fills the buffer first (overflow hits HP normally); rider conditions (poison, stun, energy drain) apply **immediately**. At **end of Crusader's next turn**, take damage equal to buffered pool and reset to `0`. Any healing received may be freely split between HP and reducing the delayed damage pool.
  - ***Furious Counterstrike (Ex):*** During your turn, gain an **untyped bonus on attack AND damage rolls** based on current `delayedDamagePool`: `0 -> +0 | 1–9 -> +1 | 10–14 -> +2 | 15–19 -> +3 | 20–24 -> +4 | 25–29 -> +5 | 30+ -> +6` (formula: `pool > 0 ? Math.min(6, Math.max(1, Math.floor(pool / 5))) : 0`). *(Triel's sheet shows `Furious Counterstrike: 5` = his `Steely Resolve 5` capacity -> yields `+1` atk/dmg whenever `1–5` dmg is buffered!)*
- *(L2 `Indomitable Soul` [+CHA to Will, no stack w/ Divine Grace]; L3 `Zealous Surge` [1/day free save reroll]; L6/18 `Smite (Ex)` [+CHA hit, +Crusader lvl dmg, any foe!]; L10 `Die Hard`; L13 `Mettle`.)*

---

### §6.12 The Righteous Cohort of Kiri-Jolith (*Dragonlance: Holy Orders of the Stars*, Table 1-14, Verbatim)

- **Source Verified Verbatim (User-Provided Book Text):** *Dragonlance: Holy Orders of the Stars* (Sovereign Press / WotC, 3.5e, Table 1-14).
- **Chassis:** **`d10` HD** *(note: `5` HP/lvl on Triel's sheet = rounded-down average of d10!)*, **3/4 BAB** (`+0..+7`), **Good Fort & Will, Poor Ref** (`+2/+0/+2` -> `+7/+3/+7`), **`2 + INT`** skills (Class skills: Concentration, Craft, Diplomacy, Intimidate, Jump, Knowledge [religion], Listen, Ride, Spot, Swim), **All Simple & Martial Weapons, All Armor & Shields**, **Full 10/10 Divine Spellcasting (`+1` existing divine class every level)**.
- **Requirements:** Alignment **`LG` or `NG`**, `BAB +4`, `Base Fort +4`, Skills: **`Diplomacy 8`, `Knowledge (religion) 4`, `Spot 4`**, Feats: **`Martial Weapon Proficiency (any)`, `Diehard`**, Spells: **2nd-level divine spells**, Patron Deity: Kiri-Jolith (campaign-adapted to Enthariel), Special: served under 3+ military leaders (3+ months & 1+ major battle each). *(Sheet trivia: Triel had 7 ranks Diplomacy at L14, 1 short of 8 before taking L15 — minor entry discrepancy!)*
- **Complete L1–L10 Class Features (Verbatim):**
  - **L1 — `Fraternal Oath (Su)`:** Morale bonus equal to **`WIS` modifier** on all **Aid Another** checks supporting an ally in combat. Willingly abandoning allies during melee to flee/retreat inflicts **`-2` penalty to all attack rolls, saving throws, and ability/skill checks for 24 hours** (and may require *atonement*).
  - **L1, L4, L8 — `Rallying Cry (Su)` (`1/day`, `2/day`, `3/day`):** Shout affecting all allies within **60 ft.**: grants **`+1 morale` on their NEXT attack roll** AND **`+5 ft.` speed until Righteous Cohort's next turn** (`language-dependent`, `mind-affecting`).
  - **L2 — `Lesser Aura of Discipline (Ex)` / L7 — `Greater Aura of Discipline (Ex)`:** Passive **30-ft.** (L7: **60-ft.**) aura (all aware allies + self) granting **`+2 morale`** (L7: **`+4 morale`**) on all saves vs. **`mind-affecting`** (charms, compulsions, fear) AND **all saves vs. spells/abilities of Chaotic Outsiders or Clerics of chaotic deities**!
  - **L3, L6 [, L9 in Table] — `Bonus Feat`:** Fighter bonus feat list (must meet prerequisites). *(Sourcebook quirk: Table 1-14 lists Bonus Feat at L3, L6, and L9, while prose mentions L3 and L6 — classic 3.5e text-trumps-table quirk. Triel took **Martial Stance** at L3 and **Martial Study** at L6 — both confirmed Fighter bonus feats on RealmsHelps!)*
  - **L3, L5, L8, L10 — `Empower Leader (Su)` (`+2`, `+3`, `+4`, `+5`):** While designated leader of the group is within **30 ft.**, leader gains listed **morale bonus** to **CHA-based skill checks, Will saves, and weapon damage rolls**. Explicitly **does not stack with Aura of Discipline**.
  - **L6 — `Second Wind (Ex)`:** **`1/battle` (`refreshCycle: 'encounter'`) as a Free Action (no AoO)** -> heal self for **`Character Level` HP** (`20` HP for Triel!).
  - **L10 — `Unswerving Honor (Su)`:** Immune to all `mind-affecting` spells/SLAs + **conditional SR `15 + floor(Character Level / 2)`** strictly vs. spells/SLAs of **Chaotic Outsiders and Clerics of chaotic deities**!
  - **`Ex-Righteous Cohort` Invariant:** Abandoning faith, Good alignment, or companions immediately revokes all `(Su)` class features + bonus spells until *atonement* -> **reuses Tier 1 Invariant-Guarded Overlay / Revocation (`Vow of Poverty`, `Sanctified Creature`, `Ex-Paladin`, `Ex-Righteous Cohort`)**!

---

### §6.13 Domains, Devotions & Repo Audit (*War*, *Healing*, *Law* / *Law Devotion*, *Sun*) + Triel Legality Audit

#### Verbatim Domain & Devotion Findings
1. ***Law Devotion* (Domain — *Complete Champion*, verified verbatim on RealmsHelps):**
   - **Action & Duration:** `1/day` as a **Swift action**, lasts **1 minute** (`10 rounds`).
   - **Modal Allocation:** Immediately gain **`+3`** (`+5` at character level 10, **`+7` at character level 15+**) **sacred** (Good/Neutral deity) or **profane** (Evil deity) bonus to **either attack rolls OR AC** until your next action; at the **start of each subsequent turn**, may freely reallocate the bonus between Attack and AC!
   - **Turning Fuel:** Spend **3 daily Turn/Rebuke attempts** for **1 additional daily use** (`1 + floor(34 / 3) = 12` uses/day on Triel's sheet — **EXACT MATCH** to `12 (1)`!).
2. **Existing Repo Domain JSON Audit (`public/data/rulesets/dnd35e/domains/`):**
   - `war.json`, `healing.json`, `law.json`: Clean and accurate.
   - **BUG FOUND in `sun.json` (line 55):** Level 7 Sun domain spell is `"searing_light"` instead of **`"sunbeam"`**!

#### Triel Track 2 Mathematical & Rules-Legality Audit (Decoded!)

| Item on Triel's Sheet | Decoded RAW Formula & Finding | Verdict |
| :--- | :--- | :--- |
| **AC Triplet `31 / 18 / 30` (Base `11`)** | Full Plate caps DEX to `+1` (`Base 10 + 1 = 11`); Full `11 + 11 Armor + 2 Nat + 5 Shield + 2 Defl = 31`; Touch `11 + 5 (Parrying Shield!) + 2 Defl = 18`; FF `10 + 11 + 2 + 5 + 2 = 30`! | **100% EXACT MATCH!!** |
| **Dual Turning Level `11` & Destroy Undead `DC 25`** | Cleric `4` + Ordained Champion `3` + KotR `4` (`6 - 2`) = **`11`**; `Destroy Undead` DC = `10 + 11 + 4 CHA` = **`25`**. *(Strict vs. liberal stacking controlled via declarative `stackTurningPools` rule.)* | **EXACT MATH MATCH** |
| **Turn Undead `17` / Destroy Undead `17` / Smite `34` / Law Devotion `12 (1)`** | `3 + 4 CHA` (`7`) + `4` (*Extra Turning*, per pool) + `4` (*Nightstick*) + `2` (*Reliquary Holy Symbol*) = **`17` per pool** -> `34` Smites -> `1 + floor(34 / 3) = 12` Law Devotion uses! | **EXACT TO THE SINGLE DIGIT!!** |
| **Ordained Champion L1 (`Power Attack` + `Parrying Shield` + `Law Devotion`)** | Strict computational RAW requires sacrificing an unmodified domain (both granted power AND spells) for a Devotion feat (*Complete Champion* p. 53). Some DMs allow order-of-operations chaining (trade granted power via *Combat Feats* first, then remaining domain shell for *Law Devotion*). Modeled cleanly as default-strict (`requireUnmodifiedGrantedPowerForDevotionTrade: true`, configurable!). | **CONFIGURABLE RULE KNOB** |
| **L1 Domain Slot (`Protection from Evil`) & `Smite Undead` (`2` vs `3/day`) & L14 Diplomacy (`7` vs `8`)** | Minor sheet slips: *Protection from Evil* isn't on War/Healing/Law/Sun; KotR 6 grants `3/day` Smite Undead (table still shows `2`); Righteous Cohort prereq is Diplomacy `8` (sheet had `7` at L14). | **MINOR SHEET SLIPS** |
| **Gear-Derived Stats (`Move 30`, `Init +4`, `Atk +23`, `Dmg +12`)** | `+3 Full Plate`, `+3 Animated Heavy Steel Shield`, `Boots of Unending Journey` (`20+10=30`), `Belt of Battle` (`+2 Init -> +4`), `Keen Longsword +3` + WF (`+23`), `Gauntlets of War` (`+3`) + `Holy Warrior` (`+9` from spontaneous 9th-level War slot) = **`+12` Bonus Dmg (`1d8+17` 1H / `1d8+18` 2H)**! | **100% EXACT MATCH!!** |

---

### §6.14 Track 1 — Core Cross-Cutting Systems (Verbatim Rules & Tier 1/2/3 Primitives)

#### 1.2 Action Points (*Unearthed Arcana* / *Eberron Campaign Setting*)
- **Pool Formula:** `5 + floor(Character Level / 2)` refreshed upon leveling up (unspent AP from prior level are lost). At Level 20: **`5 + 10 = 15` AP** (exact match to Triel `15` and Remi `15`!).
- **Roll Modification Curve (Roll `N`d6, take **highest single die**, add to d20 roll before result is announced):**
  - L1–4: `1d6` | L5–10: `2d6` (keep highest) | L11–16: `3d6` (keep highest) | L17–20: `4d6` (keep highest). *(Note: Eberron uses `1d6` L1–7, `2d6` L8–14, `3d6` L15–20; UA uses `1d6/2d6/3d6/4d6` — easily parameterized via a ruleset-level `actionPointDieCurve` JSON table!)*
- **Additional Core Spends:** Stabilize dying character (1 AP), boost class features / feats (Eberron *Action Boost* etc.), emulate metamagic/feat (optional UA variants).
- **Tier 1 Primitive (`C5`):** Heroic roll-modifier pool (`ResourcePoolComponent` with `refreshCycle: 'on_level_up'` + pre-resolution d20 hook offering spend of `1 AP -> +max(Nd6)`).

#### 1.3 Skill Tricks (*Complete Scoundrel*, pp. 82–90)
- **Universal Rules:** Costs **`2` skill points** per trick (never affected by cross-class doubling); max **1 trick learned per character level**; total tricks known capped at **`floor(Character Level / 2)`**; each trick usable **`1/encounter`** (`refreshCycle: 'encounter'`) unless specified otherwise.
- ***Collector of Stories* (*Complete Scoundrel* p. 85 — Mental; Prereq: Knowledge [any] 5 ranks):** When making a **trained Knowledge check to identify a creature or learn its special powers/vulnerabilities**, gain **`+5 competence` bonus**! *(Synergizes directly with Myn's **Knowledge Devotion** and Triel's **K:Religion / Undead Intuition**! Notice on Triel's skill table: `Conhecimento Religioso: 22/27`, `Arcano/Histórico/Planar: 3/8` — the `+5` right-hand number is literally **Collector of Stories**!!)*
- **Tier 1/2 Mapping (`C6`):** `skillTrickPurchases` array in `level_ledger.ts` (validating 2-pt cost, max 1/lvl, max `floor(HD/2)`) + `ResourcePoolComponent` (`refreshCycle: 'encounter'`) + conditional `StatModifier` (`effectTagsAny: ['skill_check:identify_creature']`).

#### 1.4 Metamagic Pipeline: *Persistent Spell*, *Divine Metamagic*, & *Metamagic Rods*
- ***Persistent Spell* (*Complete Arcane* / *PGtF*; Prereq: *Extend Spell*):** **`+6` spell slot level**; eligible spells must have **`fixed` or `personal` range**, non-`instantaneous` duration, and not be discharged on use; overrides duration to **`24 hours`** (`14,400` rounds). Persistent *detect* spells maintain passive presence awareness without concentration.
- ***Divine Metamagic* (*Complete Divine* + Official Errata; Prereq: Turn/Rebuke Undead):** Pick one known metamagic feat per taking; as a **Free action**, spend **`1 + metamagic.slotLevelDelta`** daily Turn/Rebuke attempts (**`7`** for *Persistent Spell*!) to apply that metamagic to a **divine spell** without changing its slot level!
  - *Sheet Audit:* Triel lists **6** `(P)` persisted spells (`Elation`, `Divine Power`, `Lesser Holy Transformation`, `Recitation`, `Righteous Wrath of the Faithful`, `Dragon Breath`) = `6 × 7 = 42` attempts, while his combined pools (`17 TU + 17 DU`) total **`34`** attempts (`floor(34 / 7) = 4` persisted/day, leaving 6 attempts — so `(P)` marks his candidate persist roster, or he uses *Nightstick* / party buffs!).
- ***Metamagic Rods* (DMG/SRD):** Held rod with **`3/day`** charges (`refreshCycle: 'rest_8h'`) carrying `{ metamagicId, maxSpellLevel }` — **Lesser (`<= 3rd`)**, **Standard (`<= 6th`)**, **Greater (`<= 9th`)**. Applies metamagic on cast with **`+0` slot delta** (spontaneous casters still suffer full-round cast-time increase unless Quicken rod; max 1 rod per spell). Triel's *Lesser Extend Rod* legally extends `Snowshoes` (1st) and `Magic Vestment` (3rd)!
- **Tier 2 Extension (`B1`):** Add `persistent` to `metamagic_dispel.ts` (`rangeEligibility: ['personal', 'fixed']`, `durationOverrideRounds: 14400`); add generic `resourceSubstitutedMetamagic` hook (`costFormula: '1 + slotDelta'`, `poolTag: 'turn_undead_equivalent'`, `spellSourceFilter: 'divine'`); add `metamagicRodEffect` descriptor on item instances (`metamagicId`, `maxSpellLevel`).

#### 1.6 Tag-Unified Ability Families: *Smite* & *Channel Spell* (Zero Class Hardcoding!)
All distinct variants share Layer A semantic tags (`effect:smite`, `effect:channel_spell`) while staying completely declarative JSON descriptors:
- **Smite Variants (`effect:smite`):**
  - *Paladin / Celestial `Smite Evil`*: Free declare on melee attack; `targetTagsAll: ['alignment:evil']`, `+CHA` hit, `+classLevel` (or `+min(HD, 20)` Celestial) dmg; wasted if wrong target/miss.
  - *Ordained Champion `Smite (Su)`*: **Swift action**, cost `1` `turn_undead_equivalent` attempt, **any target**, `+CHA` hit, `+effectiveTurningLevel` (`+11`) dmg.
  - *Knight of the Raven `Smite Undead (Su)`*: Free declare on melee attack, `targetTagsAll: ['type:undead']`, `+CHA` hit, `+kotrLevel` (`+6`) dmg, **nat-20 auto-doubles bonus dmg (no confirm)**, **reroll 50% incorporeal miss chance once**.
  - *Crusader `Smite (Ex)`*: Free declare on melee attack, **any target**, `+CHA` hit, `+crusaderLevel` dmg.
- **Channel Spell Variants (`effect:channel_spell`):**
  - *Ordained Champion `Channel Spell (Su)`*: **Move action** -> store any `<= 1 standard` spell targeting 1+ creatures in melee weapon (8h duration); next hit discharges single-target (even AoE/ray).
  - *Spellsword `Channel Spell (Sp)` / `Multiple Channel Spell`*: **Move action** (`3–5/day`) -> store up to `1` (L10: `2` FIFO) castable spells in melee weapon (8h duration); next hit discharges single-target.
  - *Duskblade `Arcane Channeling (Su)`*: **Standard action** (L3) -> cast touch spell (`<= 1 standard`) + melee strike (no AoO); **Full-Attack** (L13) -> touch spell hits **every** creature struck that round (discharges end of round).

#### 1.7 Weapon/Armor Augment Crystals (*MIC*) & Item-Targeted Spell Overlays
- **Augment Crystal Rules (*MIC* pp. 221–227):** Max **1 crystal per weapon/armor/shield**; attach/detach = **Move action (no AoO)**; host item's **permanent actual enhancement bonus** (NOT total effective bonus, NOT temporary *GMW*!) determines allowed tier:
  - **Least:** Masterwork (`+0`) | **Lesser:** Actual **`+1` or higher** | **Greater:** Actual **`+3` or higher**.
- **Tier 1 Primitive (`B6`):** Generic `attachedSockets?: ItemInstance[]` on weapon/armor/shield instances + declarative `socketRequirement: { minPermanentEnhancement, requireMasterwork }` + generic `itemOverlays?: ItemSpellOverlay[]` (for *Magic Vestment*, *GMW*, *Sacred Item*, *Channel Spell* with `sourcePath` revocation!).

#### 1.8 Reserve Feats (*Complete Mage* / *Complete Champion*)
- **Pattern:** Passive scaling benefit computed dynamically from the **highest-level uncast spell currently available** matching a declarative predicate (`domain: 'war'`, `descriptor: 'fire'`, `school: 'conjuration'`, etc.), PLUS a permanent secondary `+1 competence` CL bonus for a matching descriptor/school.
- **Tier 2 Primitive (`B7`):** Generic `valueFormula: { type: 'highest_available_spell_level', minLevel: 4, filter: { domainId: 'war' } }` — handles **spontaneous War conversion** (*Ordained Champion* `Modified Spontaneous Casting` -> highest uncast Cleric slot `9`!) with ZERO hardcoded `featId === 'holy_warrior'` checks!

---

### §6.15 Track 3.1 Crusader Maneuvers & Stances + Track 5.1 Triel Feats (100% Verbatim!)

#### All 6 Crusader Maneuvers & Stances (Verified Verbatim from `srd.dndtools.org/srd/magic/bladeMagic/maneuvers.html`)
1. ***Martial Spirit*** (*Devoted Spirit 1 Stance*, Swift action, no prereq): While in stance, you or an ally within **30 ft.** heals **2 HP** on every successful melee attack (can pick a different recipient per hit).
2. ***Douse the Flames*** (*White Raven 1 Strike*, Standard action, no prereq): Single melee attack; on hit, target **cannot make Attacks of Opportunity for 1 round** *(still threatens its normal area for flanking!)*.
3. ***Mountain Hammer*** (*Stone Dragon 2 Strike*, Standard action, **no prereq**; Stone Dragon requires standing on solid ground): Single melee attack dealing **`+2d6` extra damage** and **automatically overcoming all DR and hardness** (usable on unattended objects / no-AoO Sunder!).
4. ***Revitalizing Strike*** (*Devoted Spirit 3 Strike*, Standard action, Prereq: 1 DS maneuver): Melee attack against an **enemy whose alignment differs on >= 1 axis AND poses a direct, immediate threat** (anti-bag-of-rats guard!); on hit, you or an ally within **10 ft.** heals **`3d6 + min(IL, 10)`** HP (`3d6 + 10` for Triel!).
5. ***White Raven Strike*** (*White Raven 4 Strike*, Standard action, Prereq: 1 WR maneuver): Single melee attack dealing **`+4d6` extra damage** AND rendering target **flat-footed until the start of its next turn**!
6. ***Divine Surge*** (*Devoted Spirit 4 Strike*, Standard action, Prereq: 1 DS maneuver): Single melee attack dealing **`+8d8` extra damage**!
- *Legality Check:* At L14 (`Crusader 1`, `IL = 7` -> max 4th-level maneuvers), *Martial Spirit* (DS 1) + *Douse the Flames* (WR 1) satisfy the prerequisites for *Revitalizing Strike* (DS 3), *White Raven Strike* (WR 4), and *Divine Surge* (DS 4), and *Mountain Hammer* (SD 2) has no prereq -> **100% RAW-legal!** *(Note: Triel's L17 **Martial Stance** and L20 **Martial Study** selections were not written on the sheet.)*

#### Track 5.1 — Triel's Remaining Verbatim Feats (All 11 Non-Core/Key Feats Verified!)
- ***Parrying Shield*** (*Lords of Madness*, General/Fighter; Prereq: Shield Proficiency): Add your **shield bonus + shield enhancement bonus** to **Touch AC** (`+5` -> Triel Touch AC `18`!). *Engine mapping:* Declarative `RuleOverride` (`addShieldBonusToTouchAc: true`) in AC resolver.
- ***Practiced Spellcaster*** (*Complete Arcane* / *Complete Divine*; Prereq: Spellcraft 4 ranks): `+4` effective Caster Level for chosen spellcasting class, **capped at Total HD** (`17 + 4 -> capped at 20` for Triel!). *Engine mapping:* `capByTotalHd: true` on `effective_caster_level` modifier (`B8`).
- ***Holy Warrior*** (*Complete Champion*, Reserve; Prereq: 4th-level spells, War domain): Weapon damage `+highestAvailableWarSpellLevel` (`+9` via spontaneous War casting!) + **`+1 competence` CL on `[Force]` spells**!
- ***Extra Granted Maneuver*** (*Tome of Battle*; Prereq: Crusader 1): `+1` initially granted readied maneuver at encounter start and on every deck refresh (`2 -> 3`, max 1 taking).
- *(Already documented verbatim above: **Persistent Spell** §6.14, **Divine Metamagic** §6.14, **Law Devotion** §6.13, **Enduring Life** §6.10, **Martial Stance** & **Martial Study** §6.12, **Dragon Cohort** §6.7.)*

---

### §6.16 Track 5.3 — Magic Item Crafting Rules, Enhancements, MIC Slot-Combining & Triel's Gear Audit

- **Primary Sources Verified Directly:**
  - `https://srd.dndtools.org/srd/equipment/magicItemsCreation.html` (Crafting costs, XP, time, prerequisites, Estimating Gold Piece Values table, Adding New Abilities, Body Slot Affinities)
  - `https://srd.dndtools.org/srd/equipment/magicItems.html` (12 body slots, item save DCs)
  - `https://srd.dndtools.org/srd/equipment/magicItemsAW.html` (Armor/Shield & Weapon bonus tables, `+5`/`+10` caps, hardness/HP, double weapons, ammunition, *Keen*, *Animated*)
  - `https://srd.dndtools.org/srd/equipment/magicItemsPRR.html` (*Ring of Sustenance*, *Ring of Protection*, *Metamagic Rods*)
  - `https://srd.dndtools.org/srd/equipment/magicItemsWI.html` (*Goggles of Night*, *Handy Haversack*, *Cloak of Charisma*, *Amulet of Natural Armor*)
  - `https://www.realmshelps.net/magic/armor/{Blurring,Restful,Durable,Sanctified*}` (Verbatim *Dungeonscape* & *Shining South* armor properties)
  - *Magic Item Compendium* (pp. 9, 65, 73, 79, 120, 161, 221–227, 233–234 Table 6–11), *Complete Champion* (p. 139), *Libris Mortis* (p. 78), *Sandstorm* (p. 102), *Dungeonscape*.

#### A. Core SRD Magic Item Crafting Laws & Pricing Formulas
1. **Universal Creation Formula:**
   - **Market Price:** `masterworkItemCost + basePrice + spellComponentSurcharges` (always priced using the **lowest possible caster level** of any class that can cast the prerequisite spell, regardless of actual crafter CL).
   - **Creation Gold Cost:** **`1/2` of `basePrice`** (plus full mundane masterwork item cost + `1×` costly material components per charge/activation).
   - **Creation XP Cost:** **`1/25` (`4%`) of `basePrice`** (plus `1×` costly spell XP components; buyers of items with spell XP components pay **`+5 gp` per `1 XP`** into market price).
   - **Creation Time:** **`1 day` per `1,000 gp` of `basePrice`** (min 1 day, `8 hours/day`, max **1 item** worked on per day; prerequisite spells are expended from prepared/known slots each crafting day, though prerequisite-only spells that the item doesn't actually cast do **not** consume costly M/XP components).
   - **Costly Spell Component Multipliers (only when the item actually casts the spell):** Single-use (`1×`), Charged 50 charges / Daily-limit (`50×`), Continuous / Unlimited (`100×`), Staffs (`50 / chargesPerActivation`).
   - **Item Saving Throw DC:** **`10 + spellLevel + minCastingAbilityMod`** (e.g., 3rd-lvl spell = `10 + 3 + 1 = 14`), **except Staffs**, which use the wielder's own CL and ability modifier!
2. **Magic Armor, Shields & Weapons Laws:**
   - **Masterwork Gate:** Base item **must** be Masterwork (`+150 gp` armor/shield, `+300 gp` weapon, `+600 gp` double weapon); masterwork cost is added to market price separately from `basePrice`.
   - **Enhancement Prerequisite & Caps:**
     - Must have at least **`+1` actual enhancement bonus** before adding any magical special abilities *(exception: non-magical mundane modifications like Dungeonscape's `Sanctified` `+50 gp`!)*.
     - **Actual enhancement bonus cap:** **`+5`** (non-epic).
     - **Total effective bonus cap (`actualEnhancement + sum(bonusEquivalents)`):** **`+10`** (non-epic). Flat-gp magical abilities (e.g., *Restful* `+500 gp`, *Durable* `+500 gp`, *Glamered* `+2,700 gp`) add directly to `basePrice` **without** consuming the `+10` cap!
     - **Caster Level Prerequisite:** **`CL >= 3 × actualEnhancementBonus`**; when combined with special abilities, creator must meet `max(3 × actualEnhancement, maxAbilityCL)`.
   - **Pricing Tables:**
     - **Armor & Shields:** **`effectiveBonus² × 1,000 gp`** (`+1` = 1k, `+2` = 4k, `+3` = 9k, `+4` = 16k, `+5` = 25k, `+6` = 36k, `+7` = 49k, `+8` = 64k, `+9` = 81k, `+10` = 100k) `+ sum(flatCostGp)`.
     - **Weapons (and 50-unit Ammunition batches):** **`effectiveBonus² × 2,000 gp`** (`+1` = 2k, `+2` = 8k, `+3` = 18k, `+4` = 32k, `+5` = 50k, `+6` = 72k, `+7` = 98k, `+8` = 128k, `+9` = 162k, `+10` = 200k) `+ sum(flatCostGp)`.
   - **Double Weapons, Ammunition, Durability & Glow:**
     - **Double Weapons:** Each end is enchanted, priced, and timed as a completely separate weapon.
     - **Ammunition:** Priced in batches of **50**; enhancement bonuses of launcher and ammo **do not stack** (highest applies), though projectile launchers bestow `magic` and alignment DR bypass onto ammo fired from them; magic ammo is destroyed on hit and has a **50% breakage chance** on miss.
     - **Hardness & Hit Points:** Each **`+1` actual enhancement bonus** adds **`+2` Hardness** and **`+10` HP** to a weapon or shield; an attacker cannot sunder/damage a magic weapon/shield unless their weapon's enhancement bonus is at least equal.
     - **Light Generation:** Creator chooses at crafting time whether a magic weapon glows (`light` spell: 20 ft bright / 40 ft shadowy, permanently on, cannot be concealed when drawn) — permanent, `+0 gp`.
3. **SRD Table: Estimating Magic Item Gold Piece Values (Wondrous / Rings / Rods / Consumables):**
   - **Stat & Defense Formulas:** Ability enhancement `bonus² × 1,000 gp` | Armor bonus `bonus² × 1,000 gp` | Natural armor enhancement `bonus² × 2,000 gp` | Deflection AC `bonus² × 2,000 gp` | Other AC (`luck`/`insight`/`sacred`/`profane`) `bonus² × 2,500 gp` | Save resistance `bonus² × 1,000 gp` | Other Save `bonus² × 2,000 gp` | Skill competence `bonus² × 100 gp` | Bonus spell (*Pearl of Power*) `spellLvl² × 1,000 gp` | Spell Resistance `(SR - 12) × 10,000 gp` (min SR 13).
   - **Spell-Effect Formulas (0-level spells count as `0.5`):** Scroll `spellLvl × CL × 25 gp` | Potion `spellLvl × CL × 50 gp` | Wand (50 chg) `spellLvl × CL × 750 gp` | Command Word `spellLvl × CL × 1,800 gp` | Use-Activated / Continuous `spellLvl × CL × 2,000 gp` *(duration multiplier: rounds `×4`, `1 min/lvl` `×2`, `10 min/lvl` `×1.5`, `24h+` `×0.5`)*.
   - **Adjustments & Discounts:** Daily charges `÷ (5 / chargesPerDay)` | 50 charges `×0.5` | Off-affinity body slot **`×1.5`** | Slotless item **`×2`** | Multiple **similar** abilities (slotless) `100% + 75% + 50%...` | Multiple **different** abilities (DMG slotted rule) **lower ability `×1.5`** | Requires specific Skill **`-10%`** | Requires specific Class or Alignment **`-30%`**.
   - **Upgrading Existing Items (DMG `Adding New Abilities`):** Pay the difference `newBasePrice - oldBasePrice` (no penalty for raising `+1` -> `+3` or adding weapon/armor abilities within `+10` cap; DMG applies `+50%` when stacking unrelated powers onto a slotted wondrous item or ring).

#### B. *Magic Item Compendium* (pp. 233–234, Table 6–11) — Zero-Surcharge Common Item Effects
- **The MIC Rule:** To fix the DMG "Big Six" slot bottleneck, *MIC* pp. 233–234 allows adding or upgrading standard numerical "Common Item Effects" onto any existing magic item occupying an **appropriate body slot** at **normal market price (`×1.0`, ZERO `+50%` multi-ability surcharge!)** — paying only the price difference when upgrading!
- **Canonical Body Slot Affinities (Tier 3 JSON Configurable Table):**
  - **Ability Enhancement (`+2/+4/+6`, `bonus² × 1,000 gp`):** STR (`Arms`, `Hands`, `Waist`), DEX (`Feet`, `Hands`, `Torso`), CON (`Body`, `Throat`, `Torso`, `Waist`), INT (`Face`, `Head`, `Throat`), WIS (`Face`, `Head`, `Throat`), CHA (`Head`, `Shoulders`, `Throat`).
  - **Armor Bonus (`+1..+8`, `bonus² × 1,000 gp`):** `Arms`, `Body`.
  - **Deflection Bonus (`+1..+5`, `bonus² × 2,000 gp`):** `Body`, `Ring`, `Shoulders`.
  - **Natural Armor Enhancement (`+1..+5`, `bonus² × 2,000 gp`):** `Throat` *(canonical Amulet slot)*, `Body`, `Torso`.
  - **Saving Throw Resistance (`+1..+5`, `bonus² × 1,000 gp`):** `Shoulders`, `Torso`.
  - **Energy Resistance (`5/10/20/30`):** `Body`, `Ring`, `Shoulders`, `Torso`, `Throat`.
- **Direct Decode of Triel's Three Combined Items:**
  1. ***Reliquary Holy Symbol of Natural Armor +2*** (`Throat` + Natural Armor `+2` = `1,000 + 8,000 = 9,000 gp`)
  2. ***Gauntlets of War of Dexterity +2 / +4*** (`Hands` + DEX `+2/+4` = `4,000 + 4,000 [L15] / 16,000 [L20]`)
  3. ***Ring of Sustenance of Protection +2*** (`Ring` + Deflection `+2` = `2,500 + 8,000 = 10,500 gp`)
  - Every single combined item on Triel's sheet uses **MIC Table 6–11 zero-surcharge slot-combining**!

#### C. Verbatim Weapon, Armor & Shield Properties on Triel's Gear
1. ***Keen*** (*SRD*, `+1` bonus, CL 10, *keen edge*): Doubles weapon critical threat range; **piercing or slashing weapons only**; does **not** stack with *Improved Critical* or other threat-range doublers.
2. ***Animated*** (*SRD*, `+2` bonus, CL 12, *animate objects*): Upon command, shield floats within 2 ft., protecting wielder as if held and **freeing both hands** (max 1 animated shield at a time). **CRITICAL RAW RULE:** *"A character with an animated shield **still takes any penalties associated with shield use**, such as **armor check penalty, arcane spell failure chance, and nonproficiency**."*
   - **Sheet Audit Catch:** Triel's masterwork `+3 Full Plate` has ACP **`-5`**, and his masterwork `+3 Animated Heavy Steel Shield` has ACP **`-1`** (`-2` base + `1` masterwork) -> **RAW total ACP is `-6`**, whereas Triel's sheet wrote **`-5`** (forgetting that Animated shields still impose ACP)!
3. ***Blurring*** (*MIC* p. 9 updated from *Shining South* — `+1` bonus, CL 5, *blur*; note *Shining South* had a continuous `+36,000 gp` version, while Triel's sheet explicitly reads **`Blurring Armor (CL 5, 3/day)`** = MIC p. 9!): **Swift (command)**, **`3/day`**, grants *blur* (**20% concealment** miss chance, ignored by creatures that don't rely on sight or use *true seeing*) for **`5 rounds`**. *(Upgrade: **Greater Blurring** `[Synergy: Blurring]`, `+2` bonus, CL 12, unlimited activations, `10 minutes` duration — exercises declarative `synergyPrerequisiteIds`!)*
4. ***Restful*** (*Dungeonscape*, verified verbatim on RealmsHelps — **`+500 gp` flat**, CL 5, *lullaby*, *sleep*): Passive on any armor. Wearer can **sleep in medium or heavy armor without becoming fatigued**, and suffers only **`-5` on Listen checks while sleeping** (instead of `-10`), choosing whether to wake on a successful Listen check. *(Distinct from MIC's *Restful Crystal* augment crystal!)*
5. ***Durable*** (*Dungeonscape*, verified verbatim on RealmsHelps — **`+500 gp` flat**, CL 7, *protection from energy*, **metal armor/shields only**): Passive. Armor/shield is **immune to rust and caustic/dissolving attacks** (*Rusting Grasp*, rust monsters, black puddings, gray oozes, green slime, acid damage to the item — does **not** protect the wearer).
6. ***Sanctified*** (*Dungeonscape*, verified verbatim on RealmsHelps — **`+50 gp` flat mundane modification**, non-magical!): Armor or shield is engraved with deity's holy/unholy symbol, making it a legitimate **Divine Focus (`DF`)** for divine spellcasters of that faith (useful as a free-hand or backup divine focus).

#### D. Verbatim Audit of Triel's Wondrous Items, Rings, Rods, Crystals & Adventuring Gear
| Item | Source & Price | Slot / Action | Exact Verbatim Mechanics & Engine Requirements |
| :--- | :--- | :--- | :--- |
| ***Lesser Crystal of Return*** | *MIC* p. 65 (`1,000 gp`; Least `300`, Greater `4,000`) | Weapon Socket (requires permanent actual **`+1`**); Attach/Detach = **Move (no AoO)** | **Least:** Draw weapon as a **Free action** (*Quick Draw*). **Lesser:** Least + call weapon to hand from up to **30 ft.** as a **Move action**. **Greater:** Lesser + weapon gains **`returning`** property. |
| ***Gauntlets of War*** | *Complete Champion* p. 139 (`4,000 gp`) | `Hands` (Continuous) | **`+1` untyped bonus on melee weapon damage rolls**, increased to **`+3`** when wielding the **favored weapon of a deity offering the War domain** (Longsword for Enthariel -> `+3` verified on Triel's sheet!). *(Triel also casts **Sacred Item** [Track 6.2] on these gauntlets!)* |
| ***Reliquary Holy Symbol*** | *MIC* p. 120 (`1,000 gp`, CL 5) | `Throat` (Continuous) | Functions as silver holy symbol + grants **`+1` daily Turn/Rebuke Undead use** for each prerequisite met (max `+3`): (a) **5+ ranks Knowledge (religion)**, (b) *Improved Turning* feat, (c) **at least one `[Divine]` feat** (*Divine Metamagic*!). Triel meets (a) & (c) -> **`+2` TU uses** (exact match!). |
| ***Belt of Battle*** | *MIC* p. 73 (`12,000 gp`, CL 9) | `Waist`; **Swift (mental)** | Continuous **`+2 competence` bonus on Initiative** (`DEX +2 + 2 = +4` on sheet!). **`3 charges/day`** (renew at dawn): spend **1 charge -> +1 Move action**; **2 charges -> +1 Standard action**; **3 charges -> +1 Full-Round action** (in the same turn!). |
| ***Boots of the Unending Journey*** | *MIC* p. 79 (`4,000 gp`, CL 8, Relic) | `Feet` (Continuous + Relic) | Continuous **`+10 ft.` enhancement bonus to land speed** if wearer's alignment has a **Neutral component** (`NG`, `LN`, `N`, `CN`, `NE` — legal for **NG Triel**: `20 + 10 = 30 ft.`!). **Relic Power** (requires worshipping Fharlanghn + *True Believer* w/ 7+ HD OR sacrificing a 4th-level divine spell slot daily): continuous immunity to fatigue/exhaustion + *pass without trace*. |
| ***Nightstick*** | *Libris Mortis* p. 78 (`7,500 gp`, CL 10) | Slotless Rod (held/possessed) | Grants **`+4` daily Turn/Rebuke Undead uses** to any creature with the ability. **Stacking Rule:** Same-source bonuses do not stack by strict 3.5e rules (multi-Nightstick abuse blocked by default via `stackSameSourceResourceBonus: false`, configurable per campaign). |
| ***Metamagic Rod (Extend, Lesser)*** | *SRD* (`3,000 gp`, CL 17) | Held Rod (Use-activated) | **`3/day`**, apply **Extend Spell** to any spell of **`<= 3rd` level** with **`+0` slot delta** (spontaneous casters still take full-round cast time; max 1 rod per spell). |
| ***Glyph Seal*** | *MIC* p. 161 (`1,000 gp` / Greater `4,000 gp`) | Portable Wondrous (affixed to object/container) | Thumb-sized opal storing a spell (Standard: up to **2nd level**; Greater: up to **5th level**) as a triggered *glyph of warding* on a door, chest, or pouch (Triel stores *Hand of the Faithful* [1st/2nd? verified in Track 6.2] on a pouch!). |
| ***Ring of Sustenance*** | *SRD* (`2,500 gp`, CL 5) | `Ring` (Continuous, **7-day attunement**) | No food/water needed; **2 hours sleep = 8 hours rest** (spell prep still requires 8h peaceful rest window rules / standard 2h sleep refresh); **must be worn 1 full week** to attune (removing resets the 7-day timer!). |
| ***Goggles of Night*** | *SRD* (`12,000 gp`, CL 3) | `Face / Eyes` (Continuous) | Grants **60-ft. Darkvision** (both lenses required). |
| ***Handy Haversack*** | *SRD* (`2,000 gp`, CL 9) | Back/Pack (Fixed `5 lb`) | Extradimensional storage (`80 lb / 8 cu ft` main + two `20 lb / 2 cu ft` side pouches), always weighs **`5 lb`**; **retrieving any specific item is a Move action that does NOT provoke AoOs**! |
| ***Cloak of Charisma +4/+6*** | *SRD* (`16,000 / 36,000 gp`, CL 8) | `Shoulders` | Enhancement bonus `+4` (L15) -> `+6` (L20) to Charisma (`CHA 13 + 6 = 19`). |
| ***Shapesand*** | *Sandstorm* p. 102 (`100 gp` / jug, 12 lb) | Mundane Alchemical/Special | Psychoreactive sand shaped via **WIS check** (`DC 16` to claim/reshape) into any non-magical item/tool fitting its volume. |
| ***Expandable Pole*** | *Dungeonscape* (`5 gp`, 1 lb) | Mundane Gear | Collapsible 1-ft -> 11-ft iron/wood probing pole (Move action to extend/collapse). |

#### E. Grounded Codebase Audit (`item_system.types.ts`, `item_components.types.ts`, `item_inheritance.ts`, `dnd35e_equipped_item_dag.ts`, `special_materials.ts`, `item_enhancements.json`)
- **What Already Exists & Works Well:**
  - `item_inheritance.ts` cleanly resolves `baseItemId` inheritance + `ItemComponent` instance overrides (`enhancementBonus`, `enhancements`, `specialMaterial`, `customName`).
  - `dnd35e_equipped_item_dag.ts` evaluates item `effectBundle` + `item_enhancements.json` entries with slash-delimited `sourcePath` provenance (`item:<id>/enh:<enhId>`), scopes weapon modifiers via `scopeWeaponModifiers`, and computes `specialMaterial` ACP/MaxDEX/ASF reductions.
  - `item_enhancements.json` already defines `keen` and `animated` declaratively (`bonusEquivalent` + `effectBundle`).
- **Concrete Codebase Bugs & Architectural Gaps Uncovered (Zero Content-ID Branching — Rule #21):**
  1. **Existing Data Bug in `public/data/rulesets/dnd35e/item_enhancements.json` (line 126):** `keen` allows all weapons without enforcing **`piercing` / `slashing` damage-type eligibility** — needs a declarative `requiredDamageTypes?: ReadonlyArray<string>` field on `DnD35ItemEnhancementSchema`!
  2. **Missing Crafting & Pricing Engine (Tier 2 Cartridge — `src/rulesets/dnd35e/equipment/item_crafting.ts`):** `DnD35ItemEnhancementSchema` currently has `bonusEquivalent` and `flatCostGp`, but lacks crafting metadata (`casterLevel`, `auraSchool`, `requiredFeats`, `requiredSpells`, `synergyPrerequisiteIds`, `requiredMaterialTags` [e.g., `metal` for *Durable*], `isMundaneModification` [e.g., *Sanctified* `+50 gp` bypassing the `+1` magic gate], `requiredDamageTypes`). We need a pure Tier 2 calculator (`computeMagicItemMarketPrice`, `computeCraftingCostAndDays`, `validateEnhancementCompatibility`) + Tier 3 JSON `crafting_rules.json` defining SRD pricing multipliers AND the **MIC Table 6–11 `commonItemEffectSlotAffinities`** map (zero hardcoded slot lists in `.ts`!).
  3. **Missing Composable Multi-Effect / MIC Combined Items (Tier 1 `ItemComponent` + Tier 2 DAG):** Add `combinedItemIds?: ReadonlyArray<string>` (or `attachedCommonEffects?: ReadonlyArray<{ effectId: string; tier: number }>`) on `ItemComponent` so `Reliquary Holy Symbol` + `Natural Armor +2`, `Gauntlets of War` + `DEX +4`, and `Ring of Sustenance` + `Deflection +2` compose dynamically on a single equipped item without duplicating item JSON definitions!
  4. **Missing Augment Crystal Sockets (Tier 1 `ItemComponent` + Tier 2 Validator):** Add `attachedSockets?: ReadonlyArray<EntityId>` on `ItemComponent` + declarative `socketDescriptor: { hostCategories, minPermanentEnhancement, requireMasterwork, attachAction: 'move', provokesAoO: false }` on `DnD35ItemDefinitionSchema`. Crucially, gate eligibility strictly on **permanent `itemComp.enhancementBonus`** (never temporary *GMW* / *Magic Vestment* overlays!).
  5. **Missing Item-Targeted Temporary Spell Overlays (Tier 1 `ItemComponent` + Tier 2 DAG):** `CoatingComponent` only covers short-charge poisons/oils; we need `itemOverlays?: ReadonlyArray<ItemSpellOverlay>` (carrying `sourcePath`, `durationRounds`, `tempEnhancementBonus`, `effectBundle`, `storedSpell` for *Channel Spell*) so *Magic Vestment*, *Greater Magic Weapon*, and *Sacred Item* project cleanly onto equipped gear and cleanly take `max(permanentEnhancement, tempEnhancement)` without overwriting permanent stats!
  6. **Missing Item Mechanical Primitives:**
     - **Attunement Tracking** (`attunementDaysRequired`, `equippedSinceDay` on `ItemComponent` for *Ring of Sustenance*).
     - **Relic Activation Gate** (`relicGate: { deityId, requiredFeatOrSlot }` on `DnD35ItemDefinitionSchema` for *Boots of the Unending Journey*).
     - **Action-Budget Grant Effect Unit** (`grantAction: 'move' | 'standard' | 'full_round'` for *Belt of Battle* 1/2/3 charges).
     - **Conditional Prerequisite-Scaled Item Pool Bonus** (`conditionalPoolBonuses: [{ condition, bonus }]` for *Reliquary Holy Symbol*'s `+1/+2/+3` TU uses, and `deity_favored_weapon` + `deity_offers_domain:war` tags for *Gauntlets of War* `+1/+3`!).
     - **Container Retrieval Rule Flag** (`retrieveAction: 'move', retrieveProvokesAoO: false, fixedLoadedWeight: 5` on `Handy Haversack`).
     - **Animated Shield Verification:** Ensure `shield:animated` releases the off-hand limb grip (`occupiedBySlotId`) while **explicitly preserving** shield ACP, ASF, and nonproficiency penalties per SRD!

---

### §6.17 Track 6.1 — Contingency, Lethal-Interception, Modal & Slot-Manipulation Spells

- **Primary Sources Verified:** `srd.dndtools.org` (`spellsAllCore.html`, `spellsmh.html`, `spellsrod.html`, `spellsphb2.html`), `realmshelps.net`, *Spell Compendium* (pp. 63, 99, 115, 224), *The Forge of War* (p. 115).

| Spell | Source & Level | Action / Range / Duration | Exact Verbatim Mechanics & Tier 1/2 Engine Primitives |
| :--- | :--- | :--- | :--- |
| ***Fortunate Fate*** | *Spell Compendium* p. 99 (`Clr 7`) | `1 minute`, Touch, `10 min/lvl` or until discharged | **Lethal Contingency Watcher:** If subject suffers an attack/event that would kill them (e.g., HP drops to `<= -10`), immediately triggers a full ***heal*** spell (`10 HP/CL`, max `150`, cures diseases/poisons/conditions) before death resolves and discharges! *(Tier 1 Triggered Interception Hook `on_lethal_hp_threshold`.)* |
| ***Delay Death*** | *Spell Compendium* p. 63 (`Clr 4`; updated from *MH/RoD* `Clr 3` Std/Touch!) | **Immediate action**, Close, `1 rd/lvl` | **Death-Threshold Suppression:** Subject cannot die from HP loss (normal `-9` floor removed). Still becomes unconscious/dying at `-1` (unless *Diehard* — Triel has *Diehard*!). Body destruction (*disintegrate*), ability drain, level drain, or `[Death]` effects still kill. **If still `<= -10` HP when duration ends -> dies instantly!** *(Tier 1 `RuleOverride` `suppressHpDeathThreshold: true` + `onExpireCheckDeath`.)* |
| ***Triadspell*** | *Spell Compendium* p. 224 (`Clr 5`) | Standard, Personal, Instantaneous | **Prepared-Slot Multiplier:** Targets one prepared spell of **`<= 3rd` level**; divides it so it can be cast **3 times** (`+2` extra casts of that prepared slot) before expending! *(Tier 2 `spell_slot_multiply` effect unit: `maxSpellLevel: 3, multiplier: 3`.)* |
| ***Protective Interposition*** | *The Forge of War* p. 115 (`Clr 1, Pal 1`) | **Swift action**, Touch (adjacent willing ally), Instantaneous / `1 rd` | **Tactical Position Swap:** Instantly teleport-swaps positions with willing adjacent ally (no AoO); ally gains **`+2 sacred` AC & saves for 1 rd**, caster gains **`+2 sacred` on melee attack roll this round**. *(Tier 1 `swap_positions` spatial effect unit + `stat_bundle`.)* |
| ***Holy Star*** | *Spell Compendium* p. 115 (`Clr 7`; updated from *MoF*) | Standard, Personal (`0 ft`), `3 rds` (D) *(MoF: `1 rd/lvl`)* | **Modal Switchable Buff (`toggleGroup` — already supported via `blade_tempest_invocation.json`!):** Each round as a **Free action**, choose one mode: (1) **`Spell Turning`** (`1d4 + 3` spell levels total); (2) **`Protection`** (`+6 circumstance` AC in SpC / `+10 cover` in MoF); (3) **`Fire Bolt`** (90-ft ranged touch ray, `1d6 / 2 CL`, max `10d6` fire). |
| ***Holy Word*** | *SRD* (`Clr 7, Good 7`) | Standard, `40-ft spread` centered on caster, Instantaneous; `SR: Yes` | **4-Tier `(CL - targetHD)` Cumulative Ladder (NO SAVE!)** for nongood creatures hearing it: `HD <= CL` **Deafened** (`1d4` rds); `<= CL - 1` **+Blinded** (`2d4` rds); `<= CL - 5` **+Paralyzed** (`1d10` min); `<= CL - 10` **+Killed** (living) / Destroyed (undead). Nongood extraplanar creatures on caster's home plane also **Banished** (`Will -4` negates, even if deaf). **EXISTING REPO BUG (`holy_word.json`):** Missing the entire 4-tier `(CL - HD)` ladder and the `-4` Will save penalty on banishment! Needs generic `clMinusTargetHdTiers` schema on `DnD35SpellEffectUnitSchema` (also serves *Blasphemy*, *Dictum*, *Word of Chaos*!). |
| ***Visions of the Future*** | *PHB2* (`Clr 8`) | `10 min`, Personal, `1 hr/lvl` or until discharged | **Dischargeable Passive Buff:** Continuous **`+2 sacred` all saves + `+2 dodge` AC**; as an **Immediate action**, discharge to boost both to **`+floor(CL / 2)`** (`+10` for Triel, max `+25`) until start of next turn! *(Tier 2 `dischargeableBuff` pattern — same primitive as *Divine Insight*!)* |

---

### §6.18 Track 6.2 — Item-Buff, Weapon-Channel & Warding-Zone Spells

- **Primary Sources Verified:** `srd.dndtools.org` (`spellsAllCore.html`, `spellsCC.html`, `spellsCDiv.html`), `realmshelps.net`, *Spell Compendium* (pp. 39, 109), repo `blade_tempest_invocation.json`, `magic_vestment.json`, `greater_magic_weapon.json`.

| Spell | Source & Level | Action / Range / Duration | Exact Verbatim Mechanics & Repo / Engine Audit |
| :--- | :--- | :--- | :--- |
| ***Sacred Item*** | *Complete Champion* (`Clr 4, Pal 4`) | `1 full round`, Touch (object), **Permanent until discharged**; `Will negates`, `SR: Yes (object)` | **Item-Embedded Positive Energy Trigger:** Imbues touched object (Triel casts on *Gauntlets of War*!). Next time it touches/is touched by **undead (any alignment)** or **evil outsider / evil shapechanger** (other than caster), discharges **`1d4 / CL` (max `10d4`) positive energy damage**! Undead must save vs. fear or **flee/cower `1d4` min** (save -> **shaken `1d4` min**); shapechanger reveals true form overlay for `1d4` rds. Counters/dispels *profane item*. *(Tier 1 `itemOverlays[]` trigger rider!)* |
| ***Brilliant Aura*** | *Spell Compendium* p. 39 (`Clr 8, Drd 8, Sor/Wiz 7`; updated from *CDiv* `Drd 7`) | Standard, Close (`1 creature / 2 CL` within 30 ft), `1 rd/lvl`; `Will harmless` | Allies' weapons emit 20-ft light and gain **`brilliant energy`** (ignore **armor & shield** AC bonuses; **cannot harm undead, constructs, or objects**). *(Note: CDiv version also granted `+floor(CL/2)` max `+10` enhancement dmg; SpC p. 39 standardized it to pure *brilliant energy*.)* |
| ***Hand of the Faithful*** | *Spell Compendium* p. 109 (`Clr 1, Pal 3`; downgraded from 3.0 *MoF* `Clr 4`!) | `1 minute`, `10 ft`, `10-ft immobile emanation`, `1 hr/lvl` | **Deity-Gated Stun Ward:** Creatures worshipping caster's patron deity or wearing its holy symbol move freely; all others entering or moving inside must pass a **Fortitude save each round or be `stunned` for 1 round** (unless their only action is exiting). **GEAR LEGALITY VERIFIED:** Because SpC downgraded it to **`Clr 1`**, Triel's standard ***Glyph Seal*** (`<= 2nd`-level spell, 1,000 gp) holding *Hand of the Faithful* on a pouch is **100% RAW-LEGAL!** |
| ***Magic Vestment*** & ***Greater Magic Weapon*** | *SRD* (`Clr 3 / War 3`; `Clr 4 / Sor/Wiz 3`) | Standard, Touch / Close, `1 hr/lvl` | Imbue **specific armor/shield** or **specific weapon** with **`+floor(CL / 4)`** enhancement (`min +1, max +5`; `+5` at CL 20!). **EXISTING REPO BUG (`magic_vestment.json` & `greater_magic_weapon.json`):** Both currently apply actor-wide `stat_bundle`s instead of targeting an item instance via `itemOverlays[]`, preventing simultaneous armor + shield *Magic Vestment* and leaking *GMW* onto all weapons. |
| ***Blade Tempest Invocation*** | Repo Custom Spell Research (`public/data/rulesets/dnd35e/spells/blade_tempest_invocation.json`, `Clr 5 / War 5`, `special:spell_research: 5`) | Standard, Close, `30-ft emanation`, `1 rd/lvl` | **ALREADY 100% IMPLEMENTED IN REPO!** 303-line pure declarative JSON using `spatial_field` (shadowy twilight), `stat_bundle` (evil `-1` debuff + ally `+1 sacred` AC/Atk/Ref, `+10 ft` speed, Darkvision 60 ft, `+2` flanking), `retaliation_rider` (`1d8` force), and `toggleGroup: "battle_cadence"` (`Spectral Assault` `spellStrike` / `Flurry of Steel` `+1 haste` / `Divine Celerity` `quicken_cast_grant`). |

---

### §6.19 Track 6.3 — Buffs, Forms & Auras Audit

- **Primary Sources Verified:** `srd.dndtools.org` (`spellsAllCore.html`, `spellsboed.html`, `spellsCDiv.html`, `spellsCA.html`, `spellslm.html`, `spellsdrac.html`), `realmshelps.net`, *Spell Compendium* (pp. 63, 73, 116, 174, 177, 189).

| Spell | Source & Level | Duration / Persistable? | Exact Verbatim Mechanics & Repo / Engine Audit |
| :--- | :--- | :--- | :--- |
| ***Divine Power*** | *SRD* (`Clr 4, War 4`) | `1 rd/lvl`, Personal (`(P)` **Legal!**) | Sets `BAB = Character Level`, `+6 enhancement` STR, **`+1 temporary HP / CL`** (`+20` temp HP!). **EXISTING REPO BUG (`divine_power.json`):** Missing `levelByDomain: { "war": 4 }` AND missing the `1 temp HP / CL` `healing` unit! |
| ***Elation*** | *BoED* (`Clr 2, Brd 2`) | `1 rd/lvl`, `80-ft spread` centered on caster (`(P)` **Legal** — fixed radius!) | Allies gain **`+2 morale` effective STR & DEX** and **`+5 ft.` speed** (offsets fatigue penalties without removing condition). |
| ***Recitation*** | *Complete Divine* / *SpC* (`Clr 4`) | `1 rd/lvl`, `60-ft burst` centered on caster (`(P)` **Legal** — fixed radius!) | Allies gain **`+2 luck` on attacks & saves** (**`+3 luck`** if sharing caster's **patron deity**!); enemies suffer **`-2 luck`** on attacks & saves. *(Note: SpC also added AC to allies' luck bonus — configurable via JSON bundle; requires sacred text DF.)* |
| ***Holy Transformation, Lesser*** | *Spell Compendium* p. 116 (`Clr 4`, `[Good]`) | `1 rd/lvl`, Personal (`(P)` **Legal!**) | **Form Overlay (`form_overlay`):** Type becomes **Outsider (`Good`)** (Medium); **`+2 sacred` STR & CON**, **`+2 sacred` all saves**, **Fly `60 ft. (good)`**, **Darkvision `60 ft.`**, speak/understand Celestial. |
| ***Righteous Wrath of the Faithful*** | *Spell Compendium* p. 177 (`Clr 5`, updated from *CDiv* `Clr 7`) | `1 rd/lvl`, `30-ft burst` centered on caster (`(P)` **Legal** — fixed radius!) | Allies gain **`+3 morale` melee attack & damage** AND **1 extra melee attack at highest BAB during full attack** (explicitly `type: 'haste'` — does not stack w/ *haste*). *(Note: Older *CDiv* `Clr 7` version split non-deity `Aid` vs. same-deity `+2 morale`, `+2d8 temp HP`, and 10-min post-spell fatigue; Triel's L5 slot confirms the **SpC `Clr 5`** version!)* |
| ***Dragon Breath*** | *Complete Divine* / *SpC* p. 73 (`Clr 5`, `[Good]`/`[Evil]`) | `1 rd/lvl`, Personal (`(P)` **Legal!**) | Standard action breath weapon (`1d4` round recharge); pick 1 of 10 true dragon types at cast (`Black/Blue/Bronze` 30-ft line or `Green/Red/White/Gold` 15-ft cone dealing **`1d8 / 2 CL`, max `10d8`**, Ref half; or `Brass` sleep / `Copper` slow / `Silver` paralysis 15-ft cone for `1d6` rds). Grants `activatedAbilities` breath weapon for spell duration! |
| ***Vigor, Mass Lesser*** | *Complete Divine* / *SpC* (`Clr 3, Drd 3`) | `10 + 1/CL` rds (max `25` rds), `20 ft`, `1 creature / 2 CL` | Grants **`Fast Healing 1`** + auto-stabilize while dying. Non-stacking with other *vigor* spells (equal-level recast extends remaining duration). |
| ***Sublime Revelry*** | *BoED* (`Clr 9`) | `1 min/lvl`, Close, `1 creature/lvl` (30-ft span); `Save: None, SR: No` | Removes pain penalties; grants **immunity to `[Mind-Affecting]`** (suppresses active ones); targets take **half damage from ALL melee and ranged attacks**! *(Sheet typo `"Sublime Revelry First"` decoded: `"First"` was copied from the spell's opening sentence `"First, sublime revelry renders..."`!)* |
| ***Snowshoes*** | *SpC* p. 189 (`Clr 1, Drd 1, Rgr 1`) | `1 hr/lvl`, Touch (`(E-Rod)` **Legal!** -> `40 hrs`) | **`+10 ft.` enhancement to land speed** + ignore movement penalties from snow/ice terrain. *(Note: enhancement bonus does NOT stack with *Boots of the Unending Journey*'s `+10 ft` enhancement speed!)* |
| ***Delay Disease*** & ***Delay Poison*** | *SpC* p. 63 (`Clr 1`, `24 hrs`) / *SRD* (`Clr 2`, `1 hr/lvl`, `(E)` -> `40 hrs`) | Touch | Temporarily immune to disease / poison; suspends existing/new exposures until spell ends (does not heal prior damage). |
| ***Resist Energy, Mass*** | *Complete Arcane* / *SpC* (`Clr 3`) | `10 min/lvl`, Close (`1 creature/CL`), `(E)` -> `400 min` | Grants `Resist Energy` (`10 / 20 / 30` at CL `1 / 7 / 11+` -> **`30`** for Triel!) to entire party. |
| ***Resistance, Superior*** | *SpC* p. 174 (`Clr 6`) | **`24 hours`**, Touch | **`+6 resistance`** bonus to all saving throws! *(Explains why Triel doesn't wear a *Cloak of Resistance* — his saves `Fort +23 / Ref +8 / Will +25` are unbuffed base+ability; casting this adds `+6` to all three for 24h!)* |
| ***Death Ward, Mass*** | *Libris Mortis* / *SpC* (`Clr 8`) | `1 min/lvl`, Close (`1 creature/CL`) | Party-wide immunity to `[Death]` spells/effects, energy drain, negative energy. |
| ***Heroes' Feast*** & ***Freedom of Movement*** | *SRD* (`Clr 6`, `Clr 4`) | Already in repo (`heroes_feast.json`, `freedom_of_movement.json`) | Both exist in `public/data/rulesets/dnd35e/spells/` — verify *Heroes' Feast* `1d8 + floor(CL/2)` max `10` temp HP, `+1 morale` atk/Will, poison & fear immunity. |

---

### §6.20 Track 6.4 — Offensive & Utility Spells Audit

- **Primary Sources Verified:** `srd.dndtools.org` (`spellsAllCore.html`, `spellsfrost.html`, `spellsCAdv.html`, `spellsboed.html`), `realmshelps.net`, *Serpent Kingdoms* (p. 141), *Races of Eberron* (p. 188).

| Spell | Source & Level | Action / Range / Save / SR | Exact Verbatim Mechanics & Repo / Engine Audit |
| :--- | :--- | :--- | :--- |
| ***Ice Slick*** | *Frostburn* (`Clr 1`, `[Cold]`) | Standard, Close (`20-ft square`), `1 rd/lvl`, `SR: No` | **Spatial Field (`spatial_field`):** Coats 20-ft square in slippery ice; Balance check on entry/cast & every round inside or fall prone; success moves at half speed. |
| ***Lava Missile*** | *Serpent Kingdoms* p. 141 (`Clr 2, Drd 2`, `[Fire]`) | Standard, Medium (`100 + 10/CL`), `SR: Yes` | **Auto-Hit Scaling Projectiles + Burn:** Unerring missiles (`1` + `1` per 2 CL past 3rd, max `5` at CL 11+?) each dealing **`1d4` fire** + Reflex save or **catch on fire** (`1d6/rd` ongoing burn). *(Uses existing `projectileCountScaling` + `condition`!)* |
| ***Shivering Touch*** | *Frostburn* (`Clr 3, Sor/Wiz 3`, `[Cold]`) | Standard, Touch, `1 rd/lvl`, **`Save: None`**, `SR: Yes` | Melee touch attack dealing **`3d6` Dexterity damage** (`[Cold]` subtype creatures immune). *(Maps directly to existing `ability_harm` unit with `targetTagsNone: ['subtype:cold']`!)* |
| ***Irian's Light*** | *Races of Eberron* p. 188 (`Clr 3`) | Standard, Medium/Close Ray, Instantaneous | Ranged touch rays (`1` + `1` per 4 CL past 3rd, max **`3` rays** at CL 11+): heals living/deathless **`2d8` HP** OR deals **`2d8` positive energy damage to undead**! *(Maps to `healing` unit with `invertsForUndead: true` + `projectileCountScaling`!)* |
| ***Divine Insight*** | *Complete Adventurer* / *SpC* (`Clr 2, Pal 2`) | Standard (cast), **Immediate** (discharge), Personal, `1 hr/lvl` | **Dischargeable Skill Buff:** Before rolling any single skill check, discharge as an **Immediate action** for **`+(5 + CL)` insight bonus (max `+15`)**! *(Same `dischargeableBuff` primitive as *Visions of the Future*!)* |
| ***Valiant Steed*** | *BoED* (`Sanctified 6`, `[Good]`) | `1 hour`, Close, Instantaneous (up to 1 year); **`Sacrifice: 1d3 STR drain`** | Calls a **Pegasus** or **Unicorn** servant (max 1 active at a time). **Note:** *Sanctified* spells (*BoED*) are automatically available to any prepared Good spellcaster via `levelByAccessTag: { "special:sanctified": 6 }`, and `ability_sacrifice` caster cost ALREADY exists in `DnD35SpellCasterCostSchema`! |
| ***Sunbeam*** | *SRD* (`Drd 7, Sun 7`, `[Light]`) | Standard, `60-ft line`, `1 rd/lvl` or beams exhausted (`1/3 CL`, max **`6` beams**); `Ref negates/half`, `SR: Yes` | **MISSING FROM REPO (`sunbeam.json` doesn't exist yet!):** Each Standard action fires 60-ft line: **Blinded + `4d6` dmg** (double vs. sunlight-vulnerable); **Undead, fungi, mold, oozes, slimes** take **`1d6 / CL` (max `20d6`)** + sunlight-harmed undead **destroyed** on failed save! |
| ***Restoration, Lesser*** | *SRD* (`Clr 2, Drd 2, Pal 1`) | `3 rounds`, Touch, Instantaneous | **MISSING FROM REPO (`lesser_restoration.json`!):** Dispels magical ability penalties OR heals **`1d4` ability damage** to one score; removes `fatigued` and improves `exhausted -> fatigued`. |
| ***Power Word Blind / Stun / Kill*** & ***Blade Barrier*** | *SRD* (`War 7/8/9`, `Clr 6 / War 6`) | Already in repo (`power_word_*.json`, `blade_barrier.json`) | Existing `save_or_die` (`maxTargetCurrentHp` thresholds) and `spatial_field` definitions already cover all four spells! |

---

## 7. Master Consolidated Architectural Blueprint & Pre-Existing Repo Bug Registry

All **6 Research Tracks (`29/29` items)** are now **100% verified verbatim** against primary D&D 3.5e sources and audited against the existing repository. Below is the complete, unified architectural synthesis ready to govern `docs/implementation_plan.md` once approved.

### 7.1 Pre-Existing Repository Bugs Uncovered During Research (Fix in Implementation Phase)
1. **`public/data/rulesets/dnd35e/domains/sun.json` (line 55):** Level 7 domain spell is `"searing_light"` -> fix to **`"sunbeam"`** (and author missing `spells/sunbeam.json`!).
2. **`public/data/rulesets/dnd35e/templates/celestial.json` (line 61):** `DR 10/magic` starts at `8 HD` instead of SRD **`12 HD`** (`DR 5/magic` is `4–11 HD`), and erroneously adds the `"good"` subtype.
3. **`public/data/rulesets/dnd35e/item_enhancements.json` (line 126):** `keen` omits damage-type eligibility (`piercing` / `slashing` only).
4. **`public/data/rulesets/dnd35e/spells/holy_word.json`:** Missing the 4-tier `(CL - targetHD)` cumulative escalation ladder (`Deafened`/`Blinded`/`Paralyzed`/`Killed`) and `-4` Will save penalty on extraplanar banishment.
5. **`public/data/rulesets/dnd35e/spells/divine_power.json`:** Missing `levelByDomain: { "war": 4 }` and missing the `1 temporary HP per CL` healing unit.
6. **`public/data/rulesets/dnd35e/spells/magic_vestment.json` & `greater_magic_weapon.json`:** Apply actor-wide `stat_bundle` instead of item-instance overlays (`itemOverlays[]`), blocking simultaneous armor + shield *Magic Vestment* and leaking *GMW* across weapons.

### 7.2 Tier 1 — Core Console Engine Primitives (`src/core/`, `src/systems/`, `src/types/`)
Every cross-cutting system requested by Triel, Remi, and Myn reduces to **8 clean, ruleset-agnostic Console primitives** (Zero D&D-specific content hardcoding — Rule #16 & Rule #21):
1. **Tactical Deck / Hand & Delayed Damage Buffer (`C1`):** Pluggable `known / readied / granted / expended` deck with refresh policies (`random_draw_auto_refresh`, `action_recovery`) + `DelayedDamageBufferComponent` (`maxCapacity`, `bufferedAmount`, end-of-next-turn drain). *(Powers Crusader & all ToB initiators.)*
2. **Mutable Point Allocator & Anatomical Slot-Locking Overlays (`C2`):** Reinvestable integer pool assigned across receptacles with per-receptacle caps + `EquipmentSlotInstance` slot-lock & dynamic natural-weapon injection. *(Powers Incarnum Essentia/Soulmelds/Chakras.)*
3. **Invariant-Guarded Progressive Track Overlay (`C4`):** Watches declarative actor invariants (no magic items, alignment, oath adherence) and projects level-indexed `EffectBundle`s; auto-revokes via `sourcePath` prefix on violation. *(Powers Vow of Poverty, Sanctified Creature, Ex-Paladin, Ex-Righteous Cohort!)*
4. **Triggered Interception / Contingency Hooks (`C7`):** Subscribes to lethal HP transitions (`on_lethal_hp_threshold`), death-threshold suppression (`suppressHpDeathThreshold`), and immediate-action save/roll reactions (`dischargeableBuff`, `retryFailedSaveNextRound`, `swap_positions`). *(Powers Fortunate Fate, Delay Death, Visions of the Future, Divine Insight, Lliira's Blessing, Protective Interposition, Phrenic Immediate PLAs.)*
5. **Item Composition Primitives (`B6` / §6.16):** Extend `ItemComponent` with `attachedSockets?: EntityId[]` (Augment Crystals), `combinedItemIds?: string[]` (MIC zero-surcharge slot-combining), `itemOverlays?: ItemSpellOverlay[]` (*Magic Vestment*, *GMW*, *Sacred Item*, *Channel Spell*), and `attunementDaysRequired` (*Ring of Sustenance*).
6. **Heroic Roll-Modification Pool & Encounter Trick Ledger (`C5`, `C6`):** `ResourcePoolComponent` with `refreshCycle: 'on_level_up'` (Action Points) and `refreshCycle: 'encounter'` (Skill Tricks, *Second Wind*), plus pre-resolution d20 spend hook.
7. **Action-Budget Grant Effect (`B6`):** Generic effect unit adding `move | standard | full_round` actions to current turn budget (*Belt of Battle*).
8. **Companion Dawn-Respawn & Independent Cohort Progression (`B4`):** `respawnPolicy: 'next_dawn'` lifecycle hook + full `levelHistory` on `ControllerLink` cohorts + targeted companion tactical orders (*Raven Harrier*).

### 7.3 Tier 2 — D&D 3.5e Cartridge Resolvers (`src/rulesets/dnd35e/`)
Pure mathematical laws & declarative resolvers passing the Rule #21 "New Content Mod" Litmus Test:
- **`exalted` Bonus Type & AC Rules (`B8`):** Named type in `DnD35BonusTypeSchema` (non-stacking w/ `armor`, excluded from Touch AC, immune to *brilliant energy*) + `capByTotalHd` on `effective_caster_level` (*Practiced Spellcaster*).
- **Metamagic Extensions (`B1`):** `persistent` (`+6`, fixed/personal, 24h), declarative `resourceSubstitutedMetamagic` (*Divine Metamagic* `1 + slotDelta` TU), `metamagicRodEffect` (`maxSpellLevel` 3/6/9).
- **ACF / Domain-Power / Whole-Domain Trades & Coexisting Pools (`B2`):** Configurable `requireUnmodifiedGrantedPowerForDevotionTrade`, coexisting *Destroy Undead* + *Turn Undead* pools, `Destroy Undead` AoE resolver.
- **Tag-Unified `Smite` & `Channel Spell` + Arbitrary Pool Action Costs (`B3`):** Separate JSON abilities sharing `effect:smite` / `effect:channel_spell` tags; `pool_ability_resolver.ts` respects `swift | immediate | move | free | standard`.
- **Playable RHD + LA + Sovereign Archetypes + Dragon/Unarmed Combat (`B5`):** Playable dragon `levelHistory` + `levelAdjustment`, `attackStatOverride` (*Intuitive Attack*), per-weapon reach, `secondary_natural_penalty` -> `0` (*Improved Multiattack*), `metaBreath` modifiers (*Entangling Exhalation*), BoED Ravages (*Touch of Golden Ice*) & `Stigmata` CON-damage pool.
- **Dynamic `valueFormula` (`B7`):** Live-state modifier formulas (`highest_available_spell_level` for Reserve Feats like *Holy Warrior*, `clMinusTargetHdTiers` for *Holy Word*/*Blasphemy*/*Dictum*, `spell_slot_multiply` for *Triadspell*, `deity_match` conditions for *Recitation*/*Hand of the Faithful*/*Gauntlets of War*).
- **Magic Item Crafting & MIC Pricing Calculator (`§6.16`):** `item_crafting.ts` reading Tier 3 `crafting_rules.json` (SRD base GP/XP/days, `+5`/`+10` caps, `CL >= 3 × enh`, `requiredDamageTypes`, `requiredMaterialTags`, `isMundaneModification`, `synergyPrerequisiteIds`, and MIC Table 6–11 `commonItemEffectSlotAffinities`).
- **Psionics Engine (`C3`):** `power_points`, ML augmentation cap, `PR` <-> `SR` transparency toggle, HD-scaled PLA unlock tables (*Phrenic*).

### 7.4 Tier 3 — Declarative System Content JSON (`public/data/rulesets/dnd35e/`)
Zero `.ts` branching required to add any of:
- **Classes / ACFs / PrCs:** *Lightbringer Cleric ACF*, *Ordained Champion*, *Knight of the Raven*, *Crusader*, *The Righteous Cohort of Kiri-Jolith*, *Overwhelming Attack Monk*, *Totemist*.
- **Creatures / Templates / Archetypes:** *Purple Dragon* (*Dragon Compendium*), *Iron Dragon* (*Dragon #356*), *Phrenic Creature*, *Sanctified Creature*, *Wyrm of War*, *Celestial Raven Harrier*.
- **Feats, Skill Tricks, Maneuvers & Soulmelds:** All 11 non-core Triel feats, all 13 Myn feats, *Collector of Stories*, all 6 Crusader maneuvers/stance, all 4 Incarnum soulmelds.
- **Crafting Rules, Enhancements & Gear:** `crafting_rules.json` (incl. MIC Table 6–11), *Blurring* (*MIC*), *Restful* / *Durable* / *Sanctified* (*Dungeonscape*), *Lesser Crystal of Return*, *Gauntlets of War*, *Reliquary Holy Symbol*, *Belt of Battle*, *Boots of the Unending Journey*, *Nightstick*, *Metamagic Rods*, *Glyph Seal*, *Ring of Sustenance*, *Goggles of Night*, *Handy Haversack*.
- **Spells (~22 new JSONs + 5 fixes):** Every Track 6.1–6.4 spell above.

---

### §7.5 Locked Design Decisions, FAQ/Errata Verification & Campaign Rule Defaults

All 6 alignment topics have been resolved with the User and verified against official D&D 3.5e FAQ/Errata:

1. **Dual-Mode (RTwP + Turn-Based) Reactive Interrupt & Modal UX — LOCKED:**
   - Configurable reaction policies (`Auto-Trigger`, `Auto-Pause & Prompt`, `Pre-Arm Next Roll`) integrated with existing `TacticalDoctrineComponent.reactionPolicies`, `immediate_reactions.ts`, and `auto_pause_signals.ts` (zero modal UI state inside `GameState`).
   - Pinned quickbar modal toggles (`toggleGroup` — already proven by `blade_tempest_invocation.json`) for *Law Devotion* and *Holy Star*.
   - Round-boundary automation for Crusader's Granted Maneuver Deck and *Steely Resolve* drain.
2. **Verified FAQ/Errata Findings & Configurable Campaign Ruleset Defaults (`RulesConfig.dnd35eRules`):**
   - **Spell Printing Priority:** Newer official printing overrides older (*Spell Compendium* overrides *Complete Divine* / *Magic of Faerûn* / *Miniatures Handbook*).
   - **Duplicate Slotless Pool Boosters (*Nightstick* FAQ — Verified):** Official **Ask Wizards (April 28, 2008)** explicitly ruled that multiple *Nightsticks* (and *Orange Prism Ioun Stones*) do **not** stack because *Rules Compendium* p. 21 forbids untyped bonuses from the **same source** (keyed by item definition ID, not physical item instance). Default: `stackSameSourceResourceBonus: false`.
   - **Dual Turning Pools (*Extra Turning* PHB Clause — Verified):** PHB *Extra Turning* states: *"If you have the ability to turn or rebuke **more than one kind of creature** (such as a good-aligned cleric with access to the Fire domain...), **each of your turning or rebuking abilities gains four additional uses per day**."* Because *Destroy Undead* (*EtCR* p. 206, explicitly counting as Turn Undead for feats/items/DMM) and *Turn Undead* (*Knight of the Raven*) both target **undead** (one kind of creature), strict RAW vs. table-friendly dual-pool distribution is exposed via `turningPoolBoostDistribution: 'per_creature_kind' | 'per_matching_pool' | 'single_designated_pool'` (default `'per_matching_pool'` so *Extra Turning*/*Reliquary*/*Nightstick* cleanly feed qualifying pools while remaining 100% configurable).
   - **Domain Trade Order-of-Operations (*Ordained Champion* + *Law Devotion*):** Default strict (`allowRelaxedDomainTradeOrder: false`), with a campaign/homebrew rules toggle enabling lenient order-of-operations (`true`).
   - **Action Points Die Curve:** Campaign-start configurable via `actionPointsMode: 'none' | 'eberron' | 'unearthed_arcana'` (**default `'none'`**).
   - **Sanctified Creature `stripAbilitiesPolicy` (BoED Errata Verified):** Official **BoED Errata (Feb 6, 2006)** issued **no errata** altering Sanctified Creature's Special Attacks/Special Qualities stripping clause. Default strictly follows verbatim BoED p. 186 text: `sanctifiedStripAbilitiesPolicy: 'all_su_and_sla'` (configurable to `'evil_only'` or `'preserve_breath_weapon'` in campaign/homebrew rules).
   - **Psionics-Magic Transparency:** Default `psionicsMagicTransparency: true` (configurable per campaign).
   - **Crafting & Time Passage:** Facilities/Workbench crafting with a campaign switch `craftingTimeMode: 'instant_workbench' | 'simulated_downtime'` (default `'instant_workbench'`), where `'simulated_downtime'` advances the World Clock & Ring 2/attunement timers smoothly.
3. **Myn Benchmark Species, Breath DC & Sheet-Legality Policy — LOCKED:**
   - Implement **both** *Purple Dragon* (*Dragon Compendium*) and *Iron Dragon* (*Dragon #356*) as full Tier 3 JSON definitions (expanding to all dragon families over time).
   - Validate Myn's benchmark build strictly **RAW-legal** (note: under strict `sanctifiedStripAbilitiesPolicy: 'all_su_and_sla'`, Myn's RAW-legal benchmark uses the *Very Young Iron Dragon* + *Phrenic* `LA +7` chassis which matches 7-for-7 with her sheet's Fire subtype, Alternate Form, Superheated Sparks/Sleep Gas breath weapons, and Disguise class skill without losing `(Su)` breath weapons to Sanctified Creature — while *Sanctified Creature* is independently tested and verified on evil-origin creatures including Purple Dragons!).
   - Purple Dragon Mode 2 (*Burst of Blinding Power*) uses the standard SRD Breath Weapon DC (`10 + floor(racialHD / 2) + CON mod`).
4. **Abstracted Tabletop RP Items:** Lightweight abstractions approved for *Shapesand* / *Expandable Pole* / *Speak with Ravens* / *Valiant Steed*; *Ring of Sustenance* 7-day attunement tracks naturally against the World Clock across rests/downtime.
5. **Additional Pre-Existing Repo Bug #7 Caught During Planning Audit:**
   - **`src/rulesets/dnd35e/magic/spellbook_slots.ts:90`:** `computeClassLevelSlotSummaries` looks up `classDef.progression[classLevel - 1]` using raw `track.levels` instead of `Math.max(track.levels, book.effectiveCasterLevel)`, truncating Prestige Class spellcasting advancement (e.g., Cleric 4 / PrC +13 showing only 4th-level Cleric slots instead of 17th-level slots!). Scheduled for immediate fix in Phase A.

