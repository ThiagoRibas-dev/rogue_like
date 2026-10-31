# Magic & Spellcasting Systems

## 1. Vancian Spellcasting (Standard Magic)
The core of D&D 3.5e magic involves spelling slots of levels 0 to 9th. Spellcasters are divided into Arcane and Divine, and can be prepared or spontaneous.

### Arcane vs. Divine Spellcasting

| Feature | Arcane (Prepared - Wizard) | Arcane (Spontaneous - Sorcerer/Bard) | Divine (Prepared - Cleric/Druid) |
| :--- | :--- | :--- | :--- |
| **Source** | Mental study, formulaic intellect | Innate magical heritage, raw personality | Faith, devotion, divine patron, nature |
| **Key Attribute** | Intelligence | Charisma | Wisdom |
| **Preparation** | Must study spellbook daily to fill specific spell slots. | Casts any known spell spontaneously without daily prep. | Must pray or meditate daily to prepare spells from class list. |
| **Spells Known** | Limited only by spellbook contents. | Knows a strictly limited number of spells from class list. | Knows all spells on their class list. |
| **Armor Penalty** | Arcane Spell Failure (ASF) chance applies if wearing armor/shields. | Arcane Spell Failure (ASF) chance applies if wearing armor/shields. | No ASF penalty (armor-wearer class proficiencies apply). |

### Spell Difficulty Class (DC)
If a spell allows a saving throw, the target number for the save is calculated as:
$$\text{Spell DC} = 10 + \text{Spell Level} + \text{Caster's Relevant Ability Modifier}$$

*   **Wizard:** Intelligence Mod
*   **Sorcerer / Bard:** Charisma Mod
*   **Cleric / Druid / Paladin / Ranger:** Wisdom Mod

---

## 2. Concentration & Casting Defensively
Spells require focus to cast. If a spellcaster takes damage or is distracted during casting, they must succeed on a Concentration check ($d20 + \text{Concentration Modifier}$) or lose the spell.

*   **Injury during casting:**
    $$\text{Concentration DC} = 10 + \text{Damage Taken} + \text{Spell Level}$$
*   **Casting Defensively:** Casting carefully to avoid provoking Attacks of Opportunity from adjacent foes.
    $$\text{Concentration DC} = 15 + \text{Spell Level}$$
    *   *Failure:* The caster fails to cast the spell, the spell slot is expended, and they do not provoke an AoO.

---

## 3. Alternative Magic Systems
Numerous supplements introduce alternative magic-like systems with unique mechanics:

### Psionics (Expanded Psionics Handbook)
Instead of spell slots, psionic characters (Psions, Wilders, Psychic Warriors) use a pool of **Power Points (PP)**. This allows them to spontaneously manifest powers and augment their effects by spending additional points, up to their Manifester Level.

### Invocations (Complete Arcane / Complete Mage)
Used by Warlocks and Dragonadepts. Invocations are Spell-Like abilities that are usable **at-will** (unlimited times per day). Warlocks can also deliver their core attack, the *Eldritch Blast*, at-will.

### Martial Maneuvers & Stances (Tome of Battle)
Used by Crusaders, Swordsages, and Warblades. This system replaces daily slots with tactical maneuvers (Strikes, Counters, Boosts) and Stances. Maneuvers are readied per encounter and refreshed using class-specific recovery actions.

### Binding (Tome of Magic)
Used by Binders who summon and bind supernatural entities called **Vestiges** (remnants of dead gods or lost legends). The Binder makes a pact, gaining a package of thematic abilities for 24 hours.

### Incarnum (Magic of Incarnum)
Uses the raw soul-stuff of the multiverse to shape **Soulmelds** (magical gear templates). Users invest points of **Essentia** into these melds daily to boost their combat stats, skills, or special abilities.

### Shadowcasting (Tome of Magic)
Shadowcasters use **Mysteries**, which begin as standard spells but transition into Spell-Like abilities and eventually Supernatural abilities as the Shadowcaster gains levels.

---

## 4. Detailed Rules References
For granular mechanical details, consult the following directories:
*   **[Magic Mechanics](./magic/)**: Rules for casting spells, concentration, and line of effect.
*   **[Spells](../compendium/spells/)**: Specific spell descriptions and definitions.
