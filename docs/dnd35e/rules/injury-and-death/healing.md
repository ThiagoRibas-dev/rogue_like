# Healing
## Category
Injury and Death

## Summary
After taking damage, creatures can recover hit points through natural healing, magical healing, or specialized traits like Fast Healing or Regeneration.

## Mechanics

### 1. Natural Healing
Creatures recover from injury naturally through rest.
*   **Standard Rest:** If a creature gets 8 hours of sleep or equivalent rest in a 24-hour period, it recovers:
    $$\text{HP Recovered} = 1\text{ HP per character level or Hit Die (whichever is higher)}$$
    *   *Interruption:* Any significant interruption during the rest (such as combat) prevents natural healing for that period.
*   **Complete Bed Rest:** If a creature undergoes complete bed rest (doing nothing but resting) for a full 24-hour period, it recovers:
    $$\text{HP Recovered} = 2\text{ HP per character level or Hit Die (whichever is higher)}$$
*   **Long-Term Care (Heal Skill):** An ally can tend to your wounds to double your natural healing rate. The healer must make a **DC 15 Heal check** (tending up to six patients; counts as light activity). You cannot provide long-term care to yourself. See [use-skill.md](./use-skill.md).
    *   *Standard Rest + Care:* 2 HP per character level or HD.
    *   *Bed Rest + Care:* 4 HP per character level or HD.

### 2. Healing Nonlethal Damage
Nonlethal damage heals much faster than lethal damage.
*   **Rate:** Nonlethal damage heals at a rate of:
    $$\text{Nonlethal Recovered} = 1\text{ point per hour per character level or Hit Die (whichever is higher)}$$
*   See [nonlethal-damage.md](./nonlethal-damage.md).

### 3. Magical Healing
*   **Hit Point Recovery:** Spells (like *cure light wounds*) or magic items can instantaneously restore hit points. Magical healing cannot raise your hit points above your maximum normal total.
*   **Nonlethal Damage Recovery:** Whenever a spell or effect cures hit point damage, it **also removes an equal amount of nonlethal damage**.
*   **Non-Living Creatures:** Constructs, undead, and deathless do not heal naturally.
    *   *Undead/Deathless:* Undead are healed by negative energy (e.g., *inflict* spells) and harmed by positive energy (*cure* spells). Deathless are the opposite (healed by positive, harmed by negative).
    *   *Constructs:* Cannot be healed by standard cure spells. They must be repaired via spells (like *repair light damage*) or appropriate Craft skills.

### 4. Healing Ability Score Damage
Ability score damage heals naturally over time. See [ability-scores.md](./ability-scores.md).
*   **Rate:** Recover **1 ability point per damaged ability score** per 24-hour period (requiring 8 hours of sleep/rest).
*   **Bed Rest:** Complete bed rest doubles this rate (2 points per damaged ability score).
*   **Long-Term Care:** A successful DC 15 Heal check doubles these rates (2 points for standard rest, 4 points for complete bed rest).

---

## Fast Healing and Regeneration (Special Traits)
*   **Fast Healing (Ex):** A creature with fast healing recovers hit points at an exceptionally fast rate (e.g., Fast Healing 3 restores 3 HP per round) at the start of its turn. It does not restore lost body parts. Fast healing does not work if the creature is dead.
*   **Regeneration (Ex):** A creature with regeneration heals damage at a fixed rate. All damage dealt to a creature with regeneration is treated as nonlethal damage (which heals at the regeneration rate each round), except for specific damage types that bypass its regeneration (e.g., fire or acid, which deal normal lethal damage). Regenerating creatures can regrow or reattach lost limbs.

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 2695–2700, and *Player's Handbook*, page 146).