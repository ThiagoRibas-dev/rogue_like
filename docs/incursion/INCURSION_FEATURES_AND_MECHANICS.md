# Incursion Roguelike — Features, Functionalities & Mechanics Reference

*Analyzed from [`temp/incursion-roguelike`](file:///export/DownloadsSSD/Projects/Game%20Dev/rogue-like/temp/incursion-roguelike) (`inc/`, `src/`, `lib/`).*

---

## 1. Core Design Philosophy & Campaign Scope

Incursion (*Halls of the Goblin King*, `VERSION_STRING "0.6.9Y19"`) adapts **d20 / D&D 3.0–3.5e** tabletop rules into a deep tactical roguelike while introducing deliberate structural departures suited to single-hero dungeon crawling:

- **Main Campaign (`The Goblin Caves` / `Halls of the Goblin King`):** A **10-level dungeon** capped at **`MAX_CHAR_LEVEL` 11** (`inc/Defines.h:4330`), featuring bespoke NPCs and setpieces (`Roark Ironbeard`, `goblin family`, `goblin vizier`, `Murgash, the Goblin King`, `iron throne`, `drawbridge`, `guardian runes` in `lib/dungeon.irh`), alongside `The Nine Hells` and `Monster Evaluation Arena` dungeons.
- **Universal Actor Symmetry:** PCs and monsters share the exact same `Creature` simulation (`CalcValues`, `Stati`, `Strike`, `Damage`, `SkillCheck`, `Cast`, `Walk`, `TargetSystem`).
- **Notable Departures from Raw Tabletop D&D 3.5e:**
  1. **Continuous Segment Timeline (`Timeout`)** instead of fixed 6-second turn rounds.
  2. **7 Core Attributes** (`STR, DEX, CON, INT, WIS, CHA, LUC`) with **even/odd modifiers** and **Exercise/Abuse attribute drift**.
  3. **Armour Coverage + Probabilistic Absorption/DR** separating *avoidance* (`vDef`), *exposure bypass* (`A_COV`), and *damage mitigation* (`ArmourTable`/`AbsorbTable`).
  4. **Mana Pool + Metamagic Fatigue** instead of Vancian spell slots.
  5. **Active Dungeon Resting & Equilibrium Respawns** plus **Reincarnation** (up to 10 times under level 5 / depth 5).

---

## 2. Character Creation, Attributes, Alignment & Advancement

### 2.1 Character Creation (`src/Create.cpp`)
- **Configurable Ruleset Options:** Supports `OPT_STATS`, `OPT_ATTR_FIRST`, `OPT_GENDER`, `OPT_SUBRACES`, `OPT_POWER_STATS`, `OPT_REROLL`, `OPT_MAX_HP`, `OPT_MAX_MANA`, and `OPT_FAVOURED_CLASS`.
- **Three Stat Generation Modes (`Player::RollAttributes`):**
  1. **5 Rolled Sets (4d6 drop lowest):** Generates 5 sets toward a `95–100` point target; players pick `a`–`e`, reroll (`x`), or switch to Point Buy (`p`).
  2. **Rolled Sets + Perks (`statMethod == 1`):** Grants weighted starting bonuses (`PERK_ITEM` 30, `PERK_FEAT` 25, `PERK_TALENT` 15, `PERK_ABILITY` 10, `PERK_RESIST` 10, `PERK_SPELL` 5, `PERK_IMMUNE` 5) — 2 base perks, 3 for `MA_HUMAN`, 1 for subraces — validated live against `FeatPrereq()`.
  3. **Point Buy:** Starts all 7 stats at `8` using non-linear `PointCosts[3..18] = { -5,-4,-3,-2,-1, 0, 1, 2, 3, 4, 5, 6, 8, 10, 13, 16 }`.
- **Reincarnation (`ReincarnationInfo RInf`):** Preserves seed/chargen choices and allows restarting/reincarnating up to 10 times while `TotalLevel() < 5` and depth `< 5`.

### 2.2 Attributes, Derived Channels & Bonus Stacking (`inc/Defines.h`, `src/Values.cpp`, `src/Creature.cpp`)
- **7 Base Attributes:** `A_STR`, `A_DEX`, `A_CON`, `A_INT`, `A_WIS`, `A_CHA`, `A_LUC` (NPC alias `A_LOY`).
- **Exercise & Abuse Drift:** In-game actions dynamically train or strain attributes via `Exercise(attr, amt, reason, cap)` / `Abuse(attr, amt)` across specific triggers (`ESTR_DOOR`, `EDEX_TUMBLE`, `ECON_ARMOUR`, `EINT_CASTING`, `EWIS_PRAYER`, `ECHA_FEAR`, `ELUC_RISK`, etc.), capped at `+5` (`+8` for Humans).
- **41+ Derived Stat Channels:** Separate attack/speed/damage channels for **5 combat modes** (`ARCHERY`, `BRAWL`, `MELEE`, `THROWN`, `OFFHAND`), plus `A_ARM` (Armour Rating), `A_MR` (Magic Resistance), `A_SIZ` (`SZ_MINISCULE`..`SZ_COLLOSAL`), `A_MOV` (Movement Speed, 5% per unit), `A_DEF` (Defense Class), `A_SAV_FORT/REF/WILL`, 5 casting channels (`A_ARC`, `A_DIV`, `A_PRI`, `A_BAR`, `A_SOR`), `A_THP`, `A_MAN` ($\times 5$ mana), `A_FAT`, `A_COV` (Armour Coverage), and `A_CDEF`.
- **39 Bonus Stacking Buckets (`BONUS_*`):** `AttrAdj[ATTR][BONUS_TYPE]` implements non-stacking typed bonuses vs. explicitly stacking buckets (`BONUS_ARTI`, `BONUS_DODGE`, etc.). `SK_CONCENT` also forms a `concentTotal` buffer absorbing non-tactic/armour/shield penalties to `A_MAG`.

### 2.3 Alignment, Multiclassing & Leveling (`src/Create.cpp`, `src/Prayer.cpp`, `src/Values.cpp`)
- **Dual Alignment Model:** Tracks continuous hidden axes `alignGE` and `alignLC` on `[-70..+70]` alongside bitmask `ALIGNMENT` stati (`AL_LAWFUL`, `AL_CHAOTIC`, `AL_GOOD`, `AL_EVIL`). Actions call `AlignedAct()`, crossing `-20`/`+20` thresholds and triggering `PaladinFall()` or deity `Forsake()`.
- **Multiclassing (Up to 3 Tracks):** Characters track `ClassID[0..2]` and `Level[0..2]`, gated by `EV_PREREQ` and class flags (`CF_LAWFUL`, `CF_CHAOTIC`, `CF_RELIGIOUS`, `CF_PRESTIGE` capped at 10 levels).
- **BAB by Mode:** `Character::GetBAB` sums `(TCLASS->AttkVal[mode] * Level[i]) / 100` independently per combat mode (`MELEE`, `ARCHERY`, `BRAWL`, `THROWN`, `DUAL`), plus `IntStudy[STUDY_BAB]`.
- **HP, Skill Points & Feats:**
  - `CalcHP` scales class `HitDie` (`+ Mod(CON)` or `Mod(WIS)` with `FT_ONE_BODY_ONE_SOUL`, `+25%` from `FT_TOUGHNESS`) by a size multiplier (`0.5x` Miniscule to `2.0x` Colossal).
  - `CalcSP` awards `max(1, SkillPoints + ((INT-10)/2) * (SkillPoints >= 8 ? 2 : 1))` per level.
  - Characters gain **2 feats at 1st level** and **1 feat every 3rd total level** (`TotalLevel() % 3 == 0`), evaluated *after* `EV_ADVANCE` grants class/domain proficiencies.

---

## 3. Combat Mechanics (`src/Fight.cpp`, `src/Move.cpp`, `inc/ArmourTab.h`)

### 3.1 Segment-Based Action Economy
- Every actor schedules turns via `Timeout` segments (`HOUR_TURNS = 18000L`).
- Standard melee strikes cost **30 segments** at `100%` `A_SPD_MELEE`; movement costs **10 segments** at `100%` `A_MOV`; dual-weapon swings cost `30*slower + (30*faster)/2`; `A_COUP` costs 50 segments.
- **Anti-Exploit Slow Monster Banking (`Move.cpp`):** Slow monsters bank `BANK_AMOUNT = 5` ticks per turn up to `needed_timeout - 10`, enforcing a 12-tick post-move pause so fast characters retain first-strike edges without locking slow monsters out for dozens of turns.

### 3.2 Attack Rolls, Criticals, Fumbles, Miss Chances & Defense
- **To-Hit:** `1d20 + e.vHit >= max(e.vDef, e.vRideCheck)` (`20` auto-hits; threat range does not auto-hit).
- **Critical Confirmation & Fumbles:** A second d20 `e.vtRoll` (`+2` with `FT_MURDEROUS`) confirms crits (`e.vRoll >= e.vThreat && e.vHit + e.vtRoll >= max(vRideCheck, vDef)`) unless blocked by `AD_CRIT` immunity (bypassable on undead via `FT_NECROPHYSIOLOGY` or `SK_KNOW_UNDEAD / 9` threat bonus) or `FORTIFICATION`. Natural `1` that misses and fails `e.vHit + e.vtRoll < e.vDef` fumbles.
- **Pre-Roll Miss & Cover:** Unseen targets (`50%` miss, `25%` with `FT_BLIND_FIGHT`), stunned attackers (`50%`), `MISS_CHANCE` illusions/blink (halved by `isGhostTouch`), tree elevation (`25%`), tower shields (`50%`), and corner ranged cover (`50%`).
- **Active Defenses:**
  - **Parry:** Wielded weapons add `ParryVal(EVictim)` vs. `WT_SLASHING` attacks.
  - **Flawless Dodge:** Daily charges (`CA_FLAWLESS_DODGE + DEX mod`) are consumed *only* to negate an attack that would have hit.
  - **Catching Thrown Weapons:** `SK_PICK_POCKET >= 15` allows catching small thrown missiles (`DC 11 + (vHit + vRoll)/2`).
  - **Surprise Dex-to-Damage:** Rogues/ambushers on `isSurprise && isFlatFoot` substitute `Mod(DEX)` for `Mod(STR)` on small/medium weapons if higher.

### 3.3 Combat Maneuvers, AoOs & Mounted Combat
- **21 Combat Maneuvers (`A_*`):** Swing, Thrust, Fire, Lunge, Great Blow, Called Shot (`WOUNDED`), Sprint, Riposte (`OPT_RIPOSTE_MODE`), Charge (`+2` hit, `FT_POWER_CHARGE`, `FT_MANTIS_LEAP`), Aid Another, Disarm, Trip, Sunder, Spring Attack, Whirlwind Attack, Escape Grapple, Fight Defensively, Avert Eyes, Precision Strike, Bull Rush, Throw Grappled Foe, and Coup de Grace (auto-crit + Fort save vs. `SA_DEATH`).
- **Attacks of Opportunity:** Provoked by movement in threatened squares (mitigated by `SK_TUMBLE`, `FT_MOBILITY`, `FT_RIDE_BY_ATTACK`, or `OrderWithdraw`), non-defensive casting, unarmed attacks without `CA_UNARMED_STRIKE`/`FT_MARTIAL_MASTERY`, grappling, and Coup de Grace.
- **Mounted Combat:** Riders redirect movement to their `MOUNT`; `FT_MOUNTED_COMBAT` uses `1d20 + SK_RIDE` as a minimum Defense floor for the mount; `FT_OVERRUN` trips foes; `FT_SPIRITED_CHARGE` doubles damage (triples with `WT_CHARGE` lances).

### 3.4 Armour Coverage, Probabilistic DR, Incorporeal & Illusions
- **Armour Separation (`Item.cpp`, `inc/ArmourTab.h`):** Armour defines independent `DefVal`, `ArmVal` (S/P/B DR + material bonuses like Adamant `+1/+2/+3`), `CovVal` (Coverage), `PenaltyVal`, and `MaxDexBonus = max(0, 9 + pen)` (clamping both `Mod` and `Mod2`). Mithril reduces weight tier (`WG_HARMOUR -> WG_MARMOUR -> WG_LARMOUR`).
- **Coverage Bypass:** Monster touch/debilitating attacks (`DREX`, `STUN`, `STON`, `BLEE`, etc.) are blocked by `SL_ARMOUR` if `vHit < vDef + (A_COV - 4)`. Weapon hits bypass armour DR when `vHit + roll + vPenetrateBonus >= vDef + A_COV` (crits test `vtRoll`) or `WQ_ENERGY`.
- **Absorption & Proportional DR:** `AbsorbTable[min(vArm,16)][Col]` gives a percentage chance to negate hits $\le 10 + 2 \times vArm$ (halved by `WT_PENETRATING`); otherwise `ArmourTable[min(vArm,32)][Col]` reduces damage proportionally (`aDmg = vDmg * (100 - Percent) / 100`). `CA_TOUGH_AS_HELL` adds CON-based DR and `CA_DEFENSIVE_ROLL` scales down damage when `vDef > vHit + 14`.
- **Incorporeal & Illusions:** Non-magical/non-`isGhostTouch` physical attacks pass through `PHASED`/`M_INCOR` foes, and non-force/non-energy magic has a `50%` miss chance. Shadow illusions split damage into real damage (`shade%`) and `ILLUS_DMG`.

---

## 4. Magic, Metamagic, Psionics & Magic Items (`src/Magic.cpp`, `src/Effects.cpp`, `lib/`)

### 4.1 Mana Economy & Casting Traditions
- **Unified Mana Pool & Held Mana:** Spells cost Mana (`mCost`), with >50% Mana regenerating over time and sustained buffs locking "Held Mana" (`hMana`). Multiclass casters separate **Caster Level** from **Class Spell Access**.
- **Overcasting:** Players with `cMana() >= mCost / 2` may risk casting anyway, paying remaining mana with elevated spell failure.
- **Traditions (`SP_*`):**
  - `SP_ARCANE`: Requires a spellbook containing the spell (or `LUCUBRATION`), with damaged books requiring `SK_DECIPHER` (`DC 10 + hp%/10`).
  - `SP_DIVINE` / `SP_DOMAIN`: Requires an active `GodID`, worthiness (`isWorthyOf`), and a matching holy symbol or `AQ_GRAVEN` gear.
  - `SP_PRIMAL`, `SP_BARDIC`, `SP_SORCERY`, `SP_STAFF` (castable while raging/sprinting, spending fatigue or mana), `SP_INNATE`.
- **Specialist Schools:** `SpecialistTable[9][9]` (`+25` to `-30`) discounts favored schools and penalizes opposed schools (increasing mana cost and fatigue risk).
- **Somatic & Concentration Rules:** Dual-wielding or shield+weapon incurs a stow/cast/draw timeout unless `FT_QUICK_DRAW` or `MM_STILL`. Taking damage during AoO checks subtracts a proportional HP penalty buffered by `SK_CONCENT`.

### 4.2 28 Metamagic Flags (`MM_*`), Counterspelling & Effects
- **Metamagic (`MM_AMPLIFY`..`MM_WARP`):** Toggled per spell in the Spell Manager (`Managers.cpp`), scaling mana cost via `MMFeatLevels`, adding `+10%` failure per effective level bump, and charging fatigue mitigated by `SK_METAMAGIC`. Includes unique roguelike metamagics like `MM_JUDICIOUS` (skips allies), `MM_CONTROL` (choose summon/teleport outcomes), `MM_WARP` (cast through walls), `MM_ANCHOR`, `MM_CONSECRATE`, `MM_DEFENSIVE`, and `MM_PROJECT` (touch -> ray).
- **Reactive Counterspelling:** Casters with `SK_SPELLCRAFT` (`DC 15 + SpellLevel`) can counter matching-school spells or cast `Dispel Magic` at discounted mana (`2/3` at 15, `1/2` at 20, `1/3` at 25 ranks). Bards also disrupt casting with `BARD_SPELLBREAK`.
- **Polymorph & Summoning:** `Creature::Shapeshift` swaps `SS_BODY` stati, drops/merges incompatible equipment slots against `TMonster::HasSlot()`, rescales `cHP`, and purges new body immunities. Summons are boosted by `MM_AUGMENT` and `+5% * Knowledge rank` HP.
- **Psionics & Monk Tattoos (`lib/alchemy.irh`):** 23 `AI_PSIONIC` Wild Talents and 14 `AI_TATTOO` monk tattoos provide alternative progression tracks.
- **Magic Items:**
  - **Potions:** Auto-ID with `SK_ALCHEMY` (`DC 10 + ItemLevel`).
  - **Scrolls:** `SK_DECIPHER` check (`10 + 2*Level - 1`), with `> 20 + Level` granting a 50% chance to preserve the scroll.
  - **Wands:** `SK_USE_MAGIC` (2d20 keep highest; 3d20 with Skill Focus) vs. `10 + Lev/2`; beating DC by `+5/+10/+15/+20` triggers `Supercharge 1..4`.

---

## 5. Skills, Feats, Religion & Social Systems

### 5.1 Skills (`src/Skills.cpp`, `src/Tables.cpp`, `lib/sk_descs.irh`)
- **48 Skills** (`SK_ALCHEMY`..`SK_WILD_LORE`), some governed by `min(attr1, attr2)` (e.g., `SK_CRAFT`, `SK_HANDLE_DEV`, `SK_CONCENT`) and armour penalties (`0`, `1x`, or `2x` for Swimming).
- **Assist & Mastery:** Nearby allies (within 6 tiles) assist on 10 mental/precision skills; `CA_SKILL_MASTERY` sets a roll floor `max(roll, min(15, 7 + INT))`; Knowledge skills against matching monster families grant `+[rank/3]` save DC, `+[rank/9]` crit threat (enabling crits on Undead!), and `+[rank*5]%` summoned HP.
- **Rich Active Skill Verbs:** Disarming/resetting/salvaging traps (`RESET_BY` awards XP when monsters die to player-reset traps), 5-tile Searching, **Mining** with structural instability cave-in risk (`PercentSI`), **Tree Climbing** (`ELEV_TREE` cover/defense/hide bonuses), **Swimming**, context-aware **Hiding** (shadows/ceiling/underwater), **Pickpocketing**, **Disguising** (1h setup creating a disguised surrogate `Monster`), **Library Research** (ID items or summon an undead foe to purge curses), **Alchemy/Poison/Crafting/Forging**, and **Tumble** stance.

### 5.2 Feats (`src/FeatTab.cpp`, `lib/help.irh`)
- **~190 Feats** arranged in `3 x 5` DNF (`OR` of `AND`s) prerequisite matrices across 20+ feat trees (Skill Enhancer, Attribute, Saving Throw, Proficiency, Shield, Metamagic, Item Creation, Divine, Dual Weapon, Mighty, Agile, Tough, Smart, Intuitive, Commanding, Mounted, Ranged, Unarmed, and Weapon Expert).

### 5.3 Religion, Favour & Prayer (`src/Prayer.cpp`, `lib/religion.irh`, `lib/domains.irh`)
- **17 Deities & 43 Active Domains:** Tracks `FavourLev` (1–9 + 10-tier progression), `FavPenalty` (intervention fatigue, bleeding down on level-up), `Anger`, `SacVals` (weighted corpse/item/live sacrifice buckets), and flags (`GS_INVOLVED`, `GS_FORSAKEN`, `GS_CROWNED`, `GS_PENANCE`, `GS_ANATHEMA`).
- **Prayer & Trouble Triage:** `Pray()` rolls `SK_KNOW_THEO`, checks `Anger > TOLERANCE_VAL` (`EV_RETRIBUTION`), enforces `PrayerTimeout`, and evaluates 17 ordered troubles (`worstTrouble`) against `AID_CHART` (healing, curing maladies, granting spellbooks, deflecting lethal crits via `GodDeflect`, or resurrecting at DL1 via `GodRaise`).

### 5.4 Social, Morale & Companion PHD Pools (`src/Social.cpp`, `src/Target.cpp`)
- **12 Social Verbs:** Greet, Barter, Cow, Dismiss, Distract, Enlist, Fast-Talk, Offer Terms, Order, Quell, Request, Surrender, Taunt — governed by `getSocialMod` (racial relations, perceived alignment masked by Bluff/Disguise, charm, and visible allied vs. enemy XCR).
- **5 Cubic Companion Caps (`PHD_PARTY`, `PHD_MAGIC`, `PHD_ANIMAL`, `PHD_COMMAND`, `PHD_UNDEAD`):** Companion cost scales cubically as $XCR(CR) = (CR + 2)^3$, overflowing from specialized pools into `PHD_PARTY`.
- **Friendly-Fire Buffer (`TargetSystem::ItHitMe`):** Tracks cumulative accidental damage (`5/10/15 + 2*CHA`) before neutral/allied NPCs turn hostile.

---

## 6. Encounter Director, Monster AI & Content Inventory

### 6.1 Encounter Director (`src/Encounter.cpp`) & Utility AI (`src/Monster.cpp`)
- **6-Stage Weighted XCR Encounter Generator (`enGenerate`):** Allocates CR/XCR budgets across `EncPart[]` groups (supporting staggered, uniform, aquatic, formation, and vault spawns), layers up to **3 `TTemplate`s** (`TM_CLASS`, `TM_SKILL`, `TM_AGECAT`, `TM_NATURE`, `TM_UNDEAD`, `TM_DESCENT`, `TM_PLANAR`), automatically zombifies/skeletonizes mounts of undead riders, enforces $\le 50\%$ CR deviance, and assigns squad leaders (`EP_LEADER` + `OrderWalkNearMe`).
- **Utility AI (`Monster::ChooseAction`):** Scores candidate actions (`Acts[]`, `Effs[]`) including shapeshifting, phasing, hiding, picking up/equipping superior gear (`betterFor`), trouble-fixing, pre-buffing, summoning, gating, fleeing below $1/3$ HP (`FEAR_HP`) or $1/2$ Mana (`FEAR_MANA`), breath weapons, melee/ranged strikes, and gravity-vector movement avoiding dangerous `Field`s and friendly-fire AoEs (`PredictVictimsOfBallBeamBolt`).

### 6.2 Core Content Inventory (`lib/*.irc`, `lib/*.irh`)

| Category | Active Content Count (Plus WIP/Stubs) | Source File(s) |
| :--- | :--- | :--- |
| **Playable Races & Subraces** | **9** Core Races + **8** Experimental Subraces | `lib/races.irh`, `lib/subraces.irh` |
| **Base & Prestige Classes** | **10** Base Classes (+9 `CF_PSEUDO` specialist wizards) + **11** Active Prestige Classes (+8 WizardMode WIP) | `lib/classes.irh`, `lib/prestige.irh` |
| **Deities & Domains** | **17** Gods + **43** Domains | `lib/religion.irh`, `lib/domains.irh` |
| **Spells (Arcane & Divine/Druid)** | **~300+** Active Arcane Spells (Lv 1–6, 8) + **~211** Active Divine/Druidic Spells (Lv 1–7) + **6** Ability Spells (+27 `EA_NOTIMP` stubs) | `lib/wspells.irh`, `lib/pspells.irh`, `lib/abilities.irh` |
| **Spellbooks, Psionics & Tattoos** | **41** `T_BOOK` Spellbooks, **23** Psionic Wild Talents, **14** Monk Tattoos, **13** Alchemicals | `lib/sp_books.irh`, `lib/alchemy.irh` |
| **Items, Weapons, Armour & Flavours** | Weapons/Bows/Missiles/22 Armours/6 Shields; **38** Armour Qualities; **~200+** Magic Items (`AI_*`); **~500+** Randomization Flavours | `lib/weapons.irh`, `lib/mundane.irh`, `lib/m_items.irh`, `lib/flavors.irh` |
| **Dungeon Regions, Encounters & Traps** | **3** Dungeons, **35** Room Regions, **8** Corridor Regions, **88** Encounters, **54** Traps, **11** Diseases, **24** Poisons | `lib/dungeon.irh`, `lib/enclist.irh`, `lib/threats.irh` |
| **Bestiary & Templates** | Hundreds of creatures across Dragons/Beasts/Animals (`mon1`), Humanoids/Giants/Fae/Nagas/Lycanthropes (`mon2`), Aberrations/Constructs/Undead/Oozes/Vermin (`mon3`), Outsiders/Elementals/Fiends/Celestials (`mon4`) + **40+** layered monster templates | `lib/mon1.irh` – `lib/mon4.irh` |
