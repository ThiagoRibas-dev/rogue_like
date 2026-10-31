# Class Chassis Progression Rules

In D&D 3.5e, a character's class level defines their core statistics progression tracks. These statistics advance at three distinct rates (Full, 3/4, or 1/2) depending on the class's focus.

---

## 1. Progression Tracks (Levels 1–20 Summary)

*   **Good Saves:** Start at +2 at 1st level and advance at a rate of $+0.5$ per level.
    $$\text{Good Save Bonus} = 2 + \left(0.5 \times \text{Level}\right)$$
*   **Poor Saves:** Start at +0 at 1st level and advance at a rate of $+1/3$ per level.
    $$\text{Poor Save Bonus} = \left\lfloor \frac{\text{Level}}{3} \right\rfloor$$

| Progression Type | Hit Die | BAB Progression | Good Save (Lvl 20) | Poor Save (Lvl 20) | Example Classes |
| :--- | :---: | :--- | :---: | :---: | :--- |
| **Full BAB (Martial)** | $d10$–$d12$ | Full (BAB = Level) | +12 | +6 | Fighter, Barbarian, Paladin, Ranger. |
| **3/4 BAB (Mixed)** | $d8$ | 3/4 of Level ($\lfloor 0.75 \times L \rfloor$) | +12 | +6 | Cleric, Rogue, Druid, Monk, Bard. |
| **1/2 BAB (Caster)** | $d4$ | 1/2 of Level ($\lfloor 0.5 \times L \rfloor$) | +12 | +6 | Wizard, Sorcerer. |

---

## 2. Hit Points & Hit Die (HD)
A character's maximum Hit Points are determined by their class Hit Die and Constitution modifier.
*   **1st Level:** Maximize the Hit Die and add the Constitution modifier.
*   **Subsequent Levels:** Roll the class Hit Die (e.g., $d8$ for Cleric) and add the Constitution modifier (minimum +1 HP gained per level).

---

## 3. Multiclassing & Prestige Classes
Characters can take levels in multiple base classes or qualify for specialized **Prestige Classes** (which usually have prerequisites like BAB, skill ranks, or feats).
*   **Caster Level (CL):** Multi-classed characters calculate spell progressions separately per class, unless they enter a Prestige Class that explicitly advances spellcasting (e.g., *Ordained Champion* or *Knight of the Raven*).

---

## 4. Detailed Rules References
For granular mechanical details related to class abilities and entity types, consult the following directories:
*   **[Class Content](../compendium/classes/)**: Specific details, class abilities, and level tables for individual classes.
*   **[Special Abilities](./special-abilities/)**: Rules for supernatural (Su), extraordinary (Ex), and spell-like (Sp) abilities like turning undead or darkvision.
*   **[Creatures](./creatures/)**: General rules concerning creature size, reach, and mounted combat.
*   **Fractional BAB/Saves (Variant):** In standard rules, BAB and saves from different classes are added together directly, which can lead to low BAB or high saving throw anomalies for multiclassed characters due to rounding down. 
