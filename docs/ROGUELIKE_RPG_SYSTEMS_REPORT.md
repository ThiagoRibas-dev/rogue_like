# Systemic Roguelike & Interactive RPG Mechanics Report

> **Scope:** Cross-genre research into classic roguelikes (*NetHack*, *Brogue*, *Dungeon Crawl Stone Soup*, *Incursion*, *Caves of Qud*, *Cataclysm: DDA*) and systemic CRPGs (*Baldur's Gate*, *Divinity: Original Sin*, *Stoneshard*, *Tales of Maj'Eyal*), mapped directly onto this project's **Tier 1 Console Engine** + **Tier 2 Ruleset Cartridge (`dnd35e`)** architecture.

---

## 1. Current Baseline Assessment (What Exists Today)

Before recommending new systems, here is the existing interactive surface observed in the codebase so new proposals snap cleanly onto existing primitives instead of duplicating work:

1. **Polymorphic Verb Pipeline Ready for Deeper Wiring ([`src/constants/verbs.constants.ts`](../src/constants/verbs.constants.ts), [`src/systems/apply.system.ts`](../src/systems/apply.system.ts)):**
   - The engine defines 40 `Verb`s (`apply`, `throw`, `kick`, `open`, `close`, `lock`, `unlock`, `search`, `disarm`, `feint`, `heal`, `dip`, `zap`, `ignite`, `read`, `eat`, `drink`, `impact`, trade, social, and companion verbs).
   - Today, D&D skill verbs (`search`, `unlock`, `disarm`, `heal`, `persuade`, `intimidate`, `feint`) and trade/companion verbs have rich handlers, while `dip`, `ignite`, `kick`, `open`, `close`, `lock`, and `read` fall through to campaign-specific `ReactionDefinition`s without generic Console systems behind them.
2. **Spatial Fields & Anchored Auras ([`src/systems/field.system.ts`](../src/systems/field.system.ts)):**
   - Supports decaying, spreading, and entity-anchored fields with `blocksSight` FOV invalidation (`fovNeedsUpdate`). Does not yet evaluate cross-element/field transmutations (oil + fire, water + cold, water + electricity).
3. **Traps, Locks & Light Exposure ([`world_components.types.ts`](../src/types/components/world_components.types.ts), [`light_exposure.ts`](../src/rulesets/dnd35e/spatial/light_exposure.ts)):**
   - `TrapComponent` already includes `canReset` & `resetByEntityId` (used by `dungeon_skill_verbs.ts` when beating disarm DC by `TRAP_RESET_MARGIN = 5`).
   - `LockComponent` already declares `breakable?: boolean` and `jammed?: boolean`.
   - `evaluateActorLightExposure` already checks `lightReading?.isBright` for `trait:light_blindness`, while 81 SRD adventuring items (`torch`, `hooded_lantern`, `bullseye_lantern`, `caltrops`, `marbles`, `flour_pouch`, `oil_flask`, `acid_flask`, `alchemists_fire`, `smokestick`, `thunderstone`, `iron_spike`, `crowbar`, `portable_ram`, `healers_kit`, `disguise_kit`, `manacles`, `wizards_spellbook`, `bandoleer`, `potion_belt`, etc.) exist in data from Milestone 149 waiting for active systemic mechanics.
4. **World Clock & Macro Cadence ([`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)):**
   - Dual **Turn-Based & RTwP** scheduler, `HungerComponent` (`hunger.system.ts`), `rest.system.ts`, and `Tier 1 / 2 / 3` simulation cadences (`Nemesis`, `Rivalry`, `Schemes`, `World Events`).

---

## 2. Recommended Systems Matrix (Console vs. D&D 3.5e Cartridge)

To preserve **Rule 16 (Three-Tier Placement)** and **Rule 21 (Zero Content-ID Hardcoding)**, every proposed feature is split into **Tier 1 Console primitives** (reusable across `classic`, `dnd35e`, or any future ruleset) and **Tier 2 Cartridge resolvers** (expressing D&D 3.5e skill checks, saves, action costs, and feat/trait modifiers declaratively).

---

### Pillar A — Sensory Stealth, Acoustics & Dynamic Illumination
*Inspirations: Brogue, Thief, Caves of Qud, DCSS, Incursion*

| Layer | Feature & Mechanism | Why It Improves Gameplay |
|---|---|---|
| **Console (Tier 1)** | **Acoustic Sound Ripple System (`emitSoundEvent`):** Flood-fill sound propagation attenuated by walls and closed doors (`tile.soundAttenuation` / `door.closed`). Heavy footsteps, combat hits, `kick`, failed locks, and `thunderstone`s emit `(x, y, dbLevel)`. Nearby AI stores `lastHeardPos` + `alertnessState: 'unaware' \| 'suspicious' \| 'alerted'` and walks to investigate before gaining LOS. | Eliminates "hive-mind omniscient aggro" and makes doors, stealth, distractions (throwing a coin/stone!), and ambushes genuinely tactical. |
| **Console (Tier 1)** | **Dynamic Light Sources & Fuel/Cone System (`LightEmitterComponent`):** Worn/held/dropped entities with `lightSource: { radiusFt, coneAngleDeg?, fuelTurns?, requiresIgnition? }` project radial or directional (`bullseye_lantern` 60-ft cone) illumination onto the map's `lightGrid` and drain fuel over time. `ignite` / `dip` verbs light torches (`flint_and_steel`, `tindertwig`) and refill lanterns (`oil_flask`). | Makes darkness a real tactical resource rather than cosmetic flavor; pairs directly with stealth, ambush, and `oil_flask` throws. |
| **Cartridge (D&D 3.5e)** | **Full Stealth vs. Detection Loop (`Hide` & `Move Silently` vs. `Spot` & `Listen`):** Toggleable *Stealth* mode (`stance`) resolves opposed `Hide` (gated by cover, `light:darkness`, or `light:shadowy` concealment, penalized by size) vs. `Spot`, and `Move Silently` (with Armour Check Penalty; `-5` if moving > half speed, or `-20` if running/charging) vs. `Listen` on every sound pulse. Adds **Darkvision**, **Low-Light Vision**, **Scent** (detects hidden foes within 30 ft regardless of `Hide`), and **Tremorsense** counters. | Directly empowers Rogues, Rangers, Scouts, and Shadowdancers; turns stealth into an active tactical minigame instead of passive stat bloat. |
| **Cartridge (D&D 3.5e)** | **Counter-Invisibility Utility (`flour_pouch` & Dust/Glitter):** Throwing `flour_pouch` spawns a dust burst applying a `dusted` condition/tag that reduces `invisible` / total-concealment miss chance (`50% -> 20%`) and negates `Hide` until cleaned. | Gives martial/non-caster characters smart tactical counters to invisible stalkers or casting enemies using cheap M149 gear. |

---

### Pillar B — Elemental Surface Chemistry & Dungeon Hazard Physics
*Inspirations: Brogue, Divinity: Original Sin, NetHack, Dungeons of Dredmor*

| Layer | Feature & Mechanism | Why It Improves Gameplay |
|---|---|---|
| **Console (Tier 1)** | **Tag-Driven Field & Surface Transmutation Engine:** Extend `field.system.ts` with declarative `FieldInteractionRule`s (`incomingTags` × `existingFieldOrTileTag` → `spawnField / extinguish / chainSpread`):<br>• `oil` + `fire` → **Ignites connected oil slick** into roaring flames.<br>• `water` + `cold` → **Ice patch** (slippery traversal hazard).<br>• `water` + `electricity` → **Conductive shock** across all orthogonally connected water tiles.<br>• `fire` + `water` → **Dense Steam Cloud** (`blocksSight: true`).<br>• **Smoke/Fog Obscurement (`smokestick`, `obscuring_mist`):** Dynamically toggles `blocksSight` on `FieldComponent` so players can block enemy archers/casters. | Turns combat rooms into reactive chemistry sandboxes where positioning and throwables beat raw DPS checks. |
| **Console (Tier 1)** | **`Dip` & Coat Pipeline (`dip` verb):** Generic Console mechanic letting an actor apply a liquid/vial entity (`toolEntityId`) onto a weapon, stack of ammo, or container (consuming 1 charge and attaching a timed/hit-limited `ItemCoatingOverlay` with `onHit` status/damage tags). | Unlocks poisoning arrows, blessing bolts with `holy_water`, coating blades in oil to ignite on hit, and refilling lanterns cleanly through one Console primitive. |
| **Cartridge (D&D 3.5e)** | **SRD `Caltrops`, `Marbles` & `Grease` Field Resolution:**<br>• **Caltrops:** Entering or fighting in a caltrop tile triggers a BAB `+0` attack ignoring armor/shield/deflection (footwear adds `+2` AC); hit deals `1` piercing damage and halves speed until `Heal DC 15` or `1+ HP` magical healing (halted charges cleanly!).<br>• **Marbles / Ice / Grease:** Entering requires `Balance DC 10–15` (or Reflex save) or falls `prone`, provoking AoOs when standing up. | Gives immediate mechanical teeth to M149's `caltrops`, `marbles`, `oil_flask`, and terrain control spells. |
| **Cartridge (D&D 3.5e)** | **Poison Risk & `Craft (Alchemy)` Identification:** Applying injury poison to a weapon triggers a 5% natural-1 mishap check unless the actor has the `poison_use` feature; `Craft (Alchemy)` checks identify potions without drinking (`DC 15`) and brew `antitoxin` / `alchemists_fire` / `acid_flask` at alchemy benches/camps. | Elevates `Craft (Alchemy)` from a dead character-sheet skill into high-utility dungeon survival. |

---

### Pillar C — Destructible Architecture, Break-and-Enter & Traversal Tools
*Inspirations: NetHack, Brogue, Cataclysm: DDA, Baldur's Gate*

| Layer | Feature & Mechanism | Why It Improves Gameplay |
|---|---|---|
| **Console (Tier 1)** | **Structural Integrity & Door/Container Agency (`StructuralComponent`, `open`/`close`/`kick`/`lock`):** Give doors, chests, barricades, altars, and crumbling walls `{ materialTag, hardness, hp, maxHp, breakDc }`. Wire `close` (seal behind you), `kick` (force stuck/locked doors), `lock` (seal with key), and **Wedging/Spiking (`iron_spike` + `hammer`)** to block pursuing hordes. | Doors cease to be decorative tiles and become lifesaving chokepoints, escape valves, and destructible barriers. |
| **Console (Tier 1)** | **Remote Triggering & Grappling Hook Traversal:** Allow `apply` on traps/tiles at range `2` when wielding a `pole_10ft` (safely springing pressure plates or probing mimic chests!), and throwing `grappling_hook` + `rope` across narrow chasms/pits to temporarily stamp a traversable bridge tile. | Rewards carrying physical dungeoneering equipment rather than solving everything with teleport scrolls. |
| **Cartridge (D&D 3.5e)** | **SRD Hardness, Sunder & Material Interactions:** Damage against objects subtracts `hardness`, applies energy multipliers (e.g., sonic/acid vs. wood/stone, fire halved unless flammable), and lets `adamantine` ignore hardness `< 20`. `crowbar` applies `+2 circumstance` to Strength break checks; `portable_ram` adds `+2` (plus `+2` per adjacent aiding ally!) while emitting a loud sound ripple. | Realizes D&D's full *Strike an Object* rules and distinguishes weapon materials beyond monster DR. |
| **Cartridge (D&D 3.5e)** | **Athletics & Trap Engineering (`Climb`, `Jump`, `Swim`, `Disable Device`):**<br>• **Trap Salvage & Re-Arming:** Beating `Disable Device` by `5+` already sets `resetByEntityId` in `dungeon_skill_verbs.ts`; extending it to harvest `trap_parts` or `poison_vials` lets rogues relocate traps.<br>• **Vertical/Liquid Hazards:** Deep water requires `Swim` checks (`2× Armour Check Penalty`!) and tracks Constitution breath rounds before nonlethal drowning; climbing vertical shortcuts uses `Climb` + `climbers_kit` (`+2`) or `Use Rope` + `silk_rope` (`+2`). | Turns Armor Check Penalty from an ignorable penalty into a serious risk/reward trade-off for swimming, jumping, and climbing. |

---

### Pillar D — Camp Logistics, Encumbrance Tension, Corrosion & Quick-Draw Containers
*Inspirations: Darkest Dungeon, Battle Brothers, Stoneshard, NetHack*

| Layer | Feature & Mechanism | Why It Improves Gameplay |
|---|---|---|
| **Console (Tier 1)** | **Active Camp & Rest Risk Resolution (`rest.system.ts` upgrade):** Evaluate camp quality and ambush tension before completing long rests:<br>• Checks for sleeping gear (`bedroll`, `winter_blanket`, `tent`), active light/campfire, and hostile proximity.<br>• **Watch Shifts:** Resting advances world time in chunks (`watches`), rolling an `EncounterDirector` ambush table if camping in unsafe areas; high-Perception watchers prevent the party from waking `Flat-Footed / Surprised`. | Stops "nova-blast -> spam 8-hour rest after every goblin room" without needing artificial resting cooldowns. |
| **Console (Tier 1)** | **Time-as-Resource Tension ("Dungeon Doom / Scheme Clock"):** Explicitly hook `advanceWorldTimeBulk` (rest, crafting, extended lockpicking, town travel) into macro `Schemes` and patrol respawns (`map_wake_respawn.ts`), surfacing a subtle **"World Tension / Villain Scheme Progress"** warning when resting too recklessly. | Creates authentic roguelike urgency by connecting our existing `WorldClock` and `Schemes` systems! |
| **Console (Tier 1)** | **Rust/Acid Corrosion, Equipment Damage & Quick-Draw Belts (`bandoleer`, `potion_belt`):**<br>• **Corroded/Damaged Overlay:** Acid attacks, Rust Monsters, or wet traps inflict `-1`..`-3` condition degradation (repairable via `whetstone` or `artisan_tools`).<br>• **Belt vs. Backpack Action Cost:** Items stored in `bandoleer` / `potion_belt` slots trigger with reduced action cost (Free/Swift), whereas digging inside a `backpack` costs a Move action (and provokes AoOs!). | Gives tangible mechanical value to M149's `bandoleer`, `potion_belt`, `masterwork_*` belts, `whetstone`, and `artisan_tools`. |
| **Cartridge (D&D 3.5e)** | **Live Encumbrance (Milestone 150) + Two-Stage Poison + Subdual Captives:**<br>• **Milestone 150 Weight Penalties:** Enforce Light/Medium/Heavy load speed, Max Dex, and ACP dynamically (keeping free starter outfits at 0 lb!).<br>• **Two-Stage Poison & Long-Term `Heal` Care:** Secondary poison save triggers `10 rounds` (1 min) after Primary save (`antitoxin` grants `+5 alchemical` for 1 hr); `healers_kit` doubles 8h rest HP/ability recovery and cures `caltrops` limp (`Heal DC 15`).<br>• **Nonlethal Captives & `Manacles`:** Bind unconscious enemies with `manacles` (`Escape Artist DC 30/35`, Break DC `26/28`) to interrogate for `Investigation` clues or turn in for `Rivalry`/`Nemesis` bounties! | Ties D&D nonlethal combat, `manacles`, `healers_kit`, and `Survival` directly into your Investigation & Nemesis engines. |

---

### Pillar E — Piety, Deception, Corpse Economy & Spellbook Lore
*Inspirations: Incursion, DCSS, NetHack, Caves of Qud, Baldur's Gate*

| Layer | Feature & Mechanism | Why It Improves Gameplay |
|---|---|---|
| **Console (Tier 1)** | **Patron / Deity Piety & Altar Economy (`ReligionComponent`):** Generic Console favor ledger tracking `{ deityOrPatronId, favorScore, penanceDebt, taboosViolated }`. Praying, sacrificing trophies/gold at shrines, or defeating hated faction foes raises favor to unlock passive boons or emergency miracles; desecrating shrines or breaking conduct triggers curses/retribution. | Classic roguelike religion gives non-clerics dramatic crisis decisions (e.g., praying for emergency salvation at an altar vs. risking divine wrath). |
| **Console (Tier 1)** | **Active Disguise & Suspicion System (`IdentityMaskComponent`):** Allows assuming a faction/race guise (suppressing default hostility from that faction) while running a per-turn `suspicion` accumulation meter when carrying contradictory gear, trespassing restricted zones, or getting close to patrolling guards. | Enables non-combat heist, stealth-social, and assassination runs inside populated fortresses and temples. |
| **Console (Tier 1)** | **Corpse Anatomy, Spoilage & Trophy Harvesting:** Slain actors drop tagged corpses with `decayTurn` timers and harvestable parts (`pelt`, `venom_gland`, `reagent`, `bounty_trophy`, `zombie_husk`). Necromancers, alchemists, cooks/scavengers, and bounty hunters all compete over the same corpses. | Creates rich systemic interplay between combat, crafting, necromancy, hunger, and quests. |
| **Cartridge (D&D 3.5e)** | **Grimoire Looting, `Spellcraft` Transcription, UMD & Auto Monster Lore:**<br>• **Spellbook Copying:** Defeated enemy casters drop `wizards_spellbook` items storing their prepared/known spells. Wizards roll `Spellcraft (DC 15 + Spell Level)` spending `ink_vial`, `inkpen`, and time to scribe spells permanently!<br>• **Use Magic Device:** Non-casters / multiclass hybrids roll `UMD (DC 20)` to `zap` wands or cast off-list scrolls.<br>• **Active `Knowledge` Identification:** Seeing or `inspect`ing a monster automatically triggers `resolveMonsterLoreCheck` (already implemented in `specialized_skill_checks.ts`!), permanently logging discovered **DR bypasses (`silver`, `cold_iron`, `bludgeoning`), immunities, and weaknesses** into the Dossier/Inspect tooltip! | Makes defeating enemy mages genuinely exciting, wires your existing `resolveMonsterLoreCheck` into actual gameplay UX, and justifies carrying `ink_vial` & `wizards_spellbook`. |

---

## 3. Highest-Leverage Roadmap Recommendations

If prioritizing 3–4 initiatives that deliver maximum **player-facing interactivity per unit of engineering effort** by lighting up systems/items you already own:

1. **Priority 1 — Light, Stealth & Sound Loop (Tier 1 Acoustics + Light Grid ↔ Tier 2 `Hide`/`Move Silently`/`Spot`/`Listen`):**
   Unlocks genuine roguelike stealth, darkness gameplay, `torch`/`hooded_lantern`/`bullseye_lantern`/`oil_flask`/`flour_pouch`/`thunderstone`, and smarter AI patrolling instead of omniscient aggro.
2. **Priority 2 — Elemental Field Chemistry + Traps/Doors Agency (`oil`+`fire`, `water`+`cold`/`lightning`, `smokestick`, `caltrops`, `marbles`, `iron_spike`, `crowbar`):**
   Every corridor becomes an interactive puzzle box using the 81 SRD items already added in Milestone 149 plus existing `FieldComponent` / `LockComponent` / `TrapComponent`.
3. **Priority 3 — Risky Camp Rest, Scheme Tension Clock & Quick-Draw Belts (Milestone 150 Encumbrance + Camp Ambush + `bandoleer`/`potion_belt` + `healers_kit`):**
   Solves the classic D&D CRPG "5-minute workday / spam rest" problem while giving `bandoleer`, `bedroll`, `trail_rations`, and `healers_kit` immediate strategic weight.
4. **Priority 4 — Living Spellbooks, Automatic `Knowledge` Lore Reveals & Trap Salvage:**
   Wires existing `resolveMonsterLoreCheck`, `wizards_spellbook`, `ink_vial`, and `TRAP_RESET_MARGIN` into rewarding exploration/combat loops with minimal new schema surface.

---

## 4. Key Architectural & Design Questions for Discussion

1. **Stealth & Turn Flow (TB vs. RTwP):** Should toggling Stealth slow movement automatically (half-speed to avoid `-5` `Move Silently` penalty), and how should Stealth break / re-enter during RTwP?
2. **Rest Pressure / "Doom Clock":** When camping 8 hours in a dungeon, do you want **hard Scheme advancement + respawn patrols** on all dungeons, or configurable per-campaign in `rules.json` (so relaxed sandbox campaigns can opt out of time pressure)?
3. **Equipment Degradation & Curses:** Would item rust/acid damage be fun and tactical in `dnd35e-crypt` / `realms-of-shroudgarde`, or do you prefer keeping durable mundane/magic items crisp and focusing instead on elemental surfaces, stealth, traps, and camp logistics?
4. **Corpse / Loot Philosophy:** Should enemy casters always drop readable `wizards_spellbook` items matching their AI spell list, or roll a subset for Wizard scribe progression balance?
