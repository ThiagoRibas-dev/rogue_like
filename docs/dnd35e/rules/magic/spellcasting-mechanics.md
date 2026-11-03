# Spellcasting Mechanics

Spellcasting is the primary way spellcasters channel magical energy. Whether casting arcane or divine spells, prepared or spontaneously, the mechanics of casting remain consistent.

---

## The Basics of Spellcasting

### Weaponlike Spells
Any spell that requires an attack roll to hit is considered weaponlike. 
*   **Categories:** 
    *   *Ranged Spells:* Spells requiring a ranged touch attack (e.g., rays) or a ranged attack roll.
    *   *Touch Spells:* Damage-dealing spells with a range of Touch.
*   **Feats:** You can enhance weaponlike spells with combat feats:
    *   *Weapon Finesse:* Apply Dexterity modifier instead of Strength to melee touch attack rolls.
    *   *Point Blank Shot:* $+1$ bonus on attack and damage rolls for ranged spells within 30 feet.
    *   *Precise Shot:* Ignore the -4 penalty for firing a ranged touch spell at an opponent engaged in melee.
    *   *Weapon Focus:* $+1$ bonus on attack rolls with a chosen category (Ranged Spells or Touch Spells).
    *   *Improved Unarmed Strike:* Deliver a touch spell via a regular unarmed strike. If the attack hits, it deals unarmed damage plus the spell's damage (doesn't bypass normal AC; critical hits do not multiply spell damage).

### Concentration
Casting a spell requires focus. If your concentration is threatened (by taking damage, environmental hazards, etc.), you must succeed on a **Concentration check** (Wisdom-based, or Charisma-based if you lack a Constitution score; see [nonabilities.md](./nonabilities.md)) or lose the spell.
*   **Casting Defensively:** You can cast defensively to avoid provoking attacks of opportunity. This requires a Concentration check: **DC 15 + spell level**. If you fail, the spell is lost.
*   **Taking Damage while Casting:** If you take damage while casting (such as from an attack of opportunity or an ongoing effect), you must make a Concentration check: **DC 10 + damage taken + spell level**.
*   **Maintaining a Spell:** Concentrating to maintain an active spell is a **Standard Action** that does not provoke attacks of opportunity. You can cease concentration as a free action.

### Caster Level
A spell's power depends on its caster level (CL), which usually equals your level in the spellcasting class. You can choose to cast a spell at a lower CL than normal, but the CL must be high enough to cast the spell in question.

### Components
To cast a spell, you must be able to perform or provide its components (Verbal, Somatic, Material, Focus, Divine Focus, or XP). If you cannot, the casting fails. 

---

## Spell Descriptions and Schools

Almost every spell belongs to one of eight schools of magic:

### 1. Abjuration
Protective spells that create physical or magical barriers, banish outsiders, or negate magical effects.
*   *Pressure Limit:* If you force an abjuration barrier against a creature it is designed to keep away, you end the spell.
*   *Interference:* If two abjurations are active within 10 feet of each other for 24 hours, they interfere; the Search DC to find them drops by 4.

### 2. Conjuration
Brings materials, energy, or creatures to your location.
*   *Placement:* Conjured creatures/effects cannot appear inside solid objects or floating in mid-air.
*   *Subschools:*
    *   *Calling:* Transports a creature from another plane. If killed, the creature actually dies (duration is instantaneous; cannot be dispelled).
    *   *Creation:* Assembles matter. If duration is not instantaneous, the object disappears when the spell ends.
    *   *Healing:* Restores hit points or revives the dead.
    *   *Summoning:* Instantly summons a creature/object. If killed or HP drops to 0, the summoned creature disappears and re-forms in 24 hours (cannot use its own summoning abilities or XP-costing abilities). When a summoning spell ends, all spells cast by the summoned creature immediately end.
    *   *Teleportation:* One-way travel through the Astral Plane. Blocked by anything that blocks astral travel.

### 3. Divination
Enables learning secrets, finding hidden things, and predicting the future.
*   *Scrying:* Creates an invisible magical sensor (DC 20 Intelligence check to notice for creatures with Int 12+). Lead sheeting or magical protection blocks it.

### 4. Enchantment
Influences or controls the minds of others. All enchantments are **mind-affecting**.
*   *Charm:* Alters how a subject perceives you (typically viewing you as a friend).
*   *Compulsion:* Forces a subject to act in a specific manner.

### 5. Evocation
Manipulates energy or taps raw power to create something out of nothing.

### 6. Illusion
Deceives the senses or minds of others.
*   *Disbelief:* Observers do not get a saving throw to recognize an illusion until they study or interact with it. A successful save reveals it as a translucent outline. Informing allies of a fake gives them a +4 bonus on their saves.
*   *Subschools:*
    *   *Figment:* False sensations (cannot duplicate intelligible speech unless specified; figment AC is 10 + size modifier). Cannot deal damage.
    *   *Glamer:* Alters the sensory qualities of a subject (e.g., making it seem invisible).
    *   *Pattern:* Visual images that affect the minds of viewers (mind-affecting).
    *   *Phantasm:* Personalized mental images perceived only by the caster and target (mind-affecting).
    *   *Shadow:* Partially real illusions. Damage dealt by shadow spells is real.

### 7. Necromancy
Manipulates the power of death, unlife, and life force.

### 8. Transmutation
Changes the properties of a creature, object, or environment.
*   *Polymorph Subschool:* Transforms the target's shape. The target takes on all stats and special abilities of the assumed form, retaining only its alignment, personality, hit points, Hit Dice (for level-dependent effects), and languages. Worn gear melds into the new form and becomes nonfunctional.

### Dual-School Spells
Spells belonging to two schools are treated as belonging to both. Prohibiting one school prohibits casting the spell. Feat bonuses (like Spell Focus) do not stack; if you have both, the save DC increases by only 1.

---

## Spell Resistance (SR)

Spell resistance is the extraordinary ability to avoid being affected by spells.

*   **Resolution:** To affect a target with SR, the caster must make a caster level check: **1d20 + Caster Level** against the target's SR.
*   **Lowering SR:** A creature can voluntarily lower its SR as a **Standard Action** (no AoO). It remains lowered until the start of the creature's next turn.
*   **Spell school interactions:**
    *   *Abjuration, Enchantment, Necromancy, Transmutation:* Usually subject to SR if they target or transform a creature.
    *   *Conjuration:* Usually ignores SR unless they conjure pure energy. Summoned creatures ignore SR.
    *   *Divination:* Almost always ignores SR.
    *   *Evocation:* Subject to SR if they directly affect/damage a creature.
    *   *Illusion:* Almost always ignores SR (except direct attacks).

---

## Spell Preparation

Prepared spellcasters must study or pray daily to ready their spells.

### Arcane Preparation
*   **Requirements:** Must have an Intelligence score of at least **10 + spell level**.
*   **Rest:** Requires **8 hours of rest** (no movement, combat, casting, or conversation). Interruptions add 1 hour to the required rest time. Immediately before preparing, the arcanist must have 1 hour of uninterrupted rest.
*   **Time:** Takes **1 hour** to prepare all spell slots (minimum of 15 minutes to prepare a fraction of slots).
*   **Environment:** Peace, quiet, and sufficient light. Exposure to inclement weather or injury interrupts preparation.
*   **Open Slots:** An arcanist can leave slots open and prepare spells in them later in the day (requires 15 minutes of concentration). You cannot fill a slot that was previously filled and expended.
*   **Recent Casting Limit:** Any spell cast within the last **8 hours** counts against the caster's daily limit of spell slots when preparing.

### Divine Preparation
*   **Requirements:** Must have a Wisdom score of at least **10 + spell level**.
*   **Prayer Time:** Selection occurs through prayer and meditation at a specific time of day associated with their deity.
*   **Environment:** Requires peace and quiet, but **no rest period** is required prior to prayer.
*   **Spellbooks:** Divine spellcasters do not use spellbooks. They select from the entire class spell list available to them. All other mechanics (time, open slots, recent casting limit) match arcane preparation.

---

## Spontaneous Casting

Spontaneous spellcasters (such as Sorcerers and Favored Souls) do not prepare spells.

*   **Requirements:** Key ability score (Charisma or Wisdom) must be at least **10 + spell level**.
*   **Readying:** Must rest for **8 hours** and spend **15 minutes concentrating** each day to ready their mind and regain expended spell slots. Spells cast within the last 8 hours count against their daily slots.
*   **Spontaneous Metamagic:** Spontaneous casters apply metamagic feats on the fly. 
    *   If the spell's normal casting time is 1 standard action, applying metamagic increases it to a **Full-Round Action**.
    *   Spells with longer casting times require an **extra Full-Round Action** to cast.
*   **Spontaneous Conversion:** Certain prepared casters can spontaneously convert spells (e.g., clerics converting prepared spells to *cure* or *inflict* spells; druids converting to *summon nature's ally*).

---

## Magical Writings

Magical notation is universal but highly individualized, requiring deciphering before use.

*   **Deciphering:** Reading a foreign spellbook or a scroll requires a **Spellcraft check (DC 20 + spell level)** or a *read magic* spell.
*   **Borrowed Spellbooks:** To prepare a spell from a borrowed spellbook, you must first decipher it, and then make a **Spellcraft check (DC 15 + spell level)** each time you attempt to prepare it.
*   **Copying Spells:** To copy a spell into your spellbook:
    1.  Decipher the source.
    2.  Spend 1 day studying it.
    3.  Make a **Spellcraft check (DC 15 + spell level)**. Success allows copying the spell. Failure means you cannot attempt to copy that spell again until you gain another rank in Spellcraft.
*   **Writing Costs:** Writing a spell takes **24 hours** and consumes **1 page per spell level** (even 0-level spells take 1 page). Materials cost **100 gp per page**.
*   **Duplicating a Spellbook:** Halves both the time and writing cost (50 gp per page).
