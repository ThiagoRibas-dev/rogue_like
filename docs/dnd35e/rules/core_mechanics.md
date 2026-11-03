# Core Rules & System Mechanics

## 1. The Core Mechanic
When attempting an action that has a chance of failure, resolve it by rolling a 20-sided die ($d20$), adding all relevant modifiers (ability scores, skills, feats, etc.), and comparing it to a target number (Difficulty Class, or DC, or an opponent's Armor Class, or AC).

$$\text{d20 Roll} + \text{Modifiers} \geq \text{Target Number (DC / AC)} \implies \text{Success}$$

*   **Natural 20:** Auto-hits on attacks and auto-succeeds on saving throws.
*   **Natural 1:** Auto-misses on attacks and auto-fails on saving throws.

---

## 2. Mathematical Standards

*   **Rounding:** Always round fractions down, unless a rule explicitly specifies a minimum of 1 (such as for Hit Points or damage).
*   **Multiplying Abstract Values:** When multiple multipliers apply to abstract values (such as damage dice multipliers or crit modifiers), combine them rather than multiplying them sequentially. The first multiplier works normally, and each additional multiplier adds $1$ less than its value.
    $$\text{Multiplier Total} = 1 + \sum (M_i - 1)$$
    *   *Example:* Two separate $\times 2$ multipliers result in a $\times 3$ multiplier ($2 + (2-1) = 3$). Three separate $\times 2$ multipliers result in a $\times 4$ multiplier ($2 + 1 + 1 = 4$).
*   **Multiplying Real-World Values:** For physical constants (distance, weight, carrying capacity), use standard multiplication.
    *   *Example:* If a character's weight is doubled ($\times 2$) and then they are turned to stone ($\times 3$), their final weight is $\times 6$ the original.

---

## 3. Ability Scores & Modifiers

An ability score's modifier is calculated as:
$$\text{Modifier} = \left\lfloor \frac{\text{Score} - 10}{2} \right\rfloor$$

| Score | Modifier | Score | Modifier | Score | Modifier |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | -5 | **12–13** | +1 | **24–25** | +7 |
| **2–3** | -4 | **14–15** | +2 | **26–27** | +8 |
| **4–5** | -3 | **16–17** | +3 | **28–29** | +9 |
| **6–7** | -2 | **18–19** | +4 | **30–31** | +10 |
| **8–9** | -1 | **20–21** | +5 | **32–33** | +11 |
| **10–11** | +0 | **22–23** | +6 | *etc.* | *...* |

### Ability Overviews

*   **Strength (Str):** Innate physical power. Applies to melee attack rolls, melee/thrown weapon damage rolls (1.5$\times$ for two-handed weapons, 0.5$\times$ for off-hand), Strength checks, and Strength-based skills (*Climb, Jump, Swim*).
*   **Dexterity (Dex):** Agility, coordination, and reflexes. Applies to ranged attack rolls, Armor Class (AC), Reflex saves, and Dexterity-based skills (*Balance, Escape Artist, Hide, Move Silently, Open Lock, Ride, Sleight of Hand, Tumble, Use Rope*).
*   **Constitution (Con):** Health, endurance, and stamina. Applies to Hit Points per Hit Die (minimum 1/level), Fortitude saves, and Concentration checks.
*   **Intelligence (Int):** Reasoning, logic, and learning. Determines starting languages, skill points gained per level, and Arcane spellcasting modifiers for Wizards (bonus slots, maximum spell level, and spell DC).
*   **Wisdom (Wis):** Willpower, perception, and intuition. Applies to Will saves, perception skills (*Heal, Listen, Profession, Sense Motive, Spot, Survival*), and Divine spellcasting modifiers for Clerics/Druids/Paladins.
*   **Charisma (Cha):** Force of personality, magnetism, and leadership. Applies to social checks, Turning/Rebuking undead attempts, and spontaneous Arcane spellcasting modifiers for Sorcerers and Bards.

---

## 4. Saving Throws

Saves are rolled when resisting spells, traps, environmental hazards, poison, or special abilities.
$$\text{Saving Throw} = d20 + \text{Base Save} + \text{Ability Modifier} + \text{Misc Modifiers}$$

| Save Type | Key Ability | Resists |
| :--- | :--- | :--- |
| **Fortitude** | Constitution | Poison, disease, paralysis, petrification, death effects, disintegration. |
| **Reflex** | Dexterity | Area-of-effect spells (fireball), traps, falling debris, sudden hazards. |
| **Will** | Wisdom | Mind control, charms, compulsions, illusions, fear. |

---

## 5. Detailed Rules References
For granular mechanical details, consult the following directories:
*   **[Basics](./basics/)**: Ability scores, dice mechanics, and vital statistics.
*   **[Movement & Exploration](./movement-and-exploration/)**: Tactical movement, vision, and special movement rules.
*   **[Environment](./environment/)**: Hazards, weather, and breaking objects.
*   **[Equipment](./equipment/)**: Wealth, gear, and activating magic items.

## 6. Compendium (Game Content)
Rules define the mechanics, whereas the **[Compendium](../compendium/)** contains the actual game content entities. For character classes, monsters, and spells, please refer to the Compendium directories (`compendium/classes/`, `compendium/monsters/`, `compendium/spells/`).
