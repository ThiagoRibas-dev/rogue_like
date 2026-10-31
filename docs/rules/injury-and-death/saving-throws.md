# Saving Throws
## Category
Combat Statistics

## Summary
When you are subjected to an unusual or magical attack, you make a saving throw (or save) to avoid or reduce the effect. Like an attack roll, a saving throw is a $1d20$ roll plus bonuses from your class, level, ability score, and other modifiers.

## Mechanics

### 1. Saving Throw Formula
Your saving throw modifier is calculated as follows:
$$\text{Saving Throw Bonus} = \text{Base Save Bonus} + \text{Ability Modifier} + \text{Racial Bonus} + \text{Resistance Bonus} + \text{Other Modifiers}$$

#### Saving Throw Types
The three different kinds of saving throws are:
*   **Fortitude:** Reflects physical toughness, stamina, and health. Used against poison, disease, paralysis, petrification, energy drain, and physical transformations.
    *   *Key Ability Modifier:* Constitution.
*   **Reflex:** Reflects physical agility, nimbleness, and reaction time. Used against area-of-effect damage, traps, and falling hazards.
    *   *Key Ability Modifier:* Dexterity.
    *   *Dexterity alterations:* Situations that deny you your Dex modifier to AC (or make you helpless) also impair your Reflex saves. See [conditions.md](./conditions.md).
*   **Will:** Reflects inner strength, mental stability, and willpower. Used against charms, compulsions, illusions, and mental influence.
    *   *Key Ability Modifier:* Wisdom.

### 2. Difficulty Class (DC)
If your saving throw result meets or exceeds the Difficulty Class (DC), the save is successful.
*   **Spells:** $\text{Spell Save DC} = 10 + \text{Spell Level} + \text{Caster's Spellcasting Ability Modifier}$. See [cast-a-spell.md](./cast-a-spell.md).
*   **Special Abilities:** $\text{Special Ability DC} = 10 + 1/2\ \text{Creature's HD} + \text{Creature's relevant Ability Modifier}$. See [use-special-ability.md](./use-special-ability.md).
    *   *Spell-Like Abilities:* $\text{Spell-Like Ability DC} = 10 + \text{Spell Level equivalent} + \text{Creature's Charisma Modifier}$.
*   **Magic Items:** $\text{Magic Item DC} = 10 + (1.5 \times \text{level of spell or effect})$.
    *   *Staffs & Runestaffs:* Exception to this rule. They use the wielder's own casting level, ability modifiers, and caster level. See [activate-magic-item.md](./activate-magic-item.md).

### 3. Automatic Success and Failure
*   **Natural 20:** Always succeeds, regardless of the DC.
*   **Natural 1:** Always fails. A natural 1 can also cause damage to your exposed items (see below).
*   **Voluntarily Failing:** A creature can voluntarily choose to forego a saving throw and willingly accept the attack's consequences.

### 4. Special Save Terms
*   **Negates:** A successful save completely negates the effect.
*   **Partial:** A successful save reduces the severity of the effect (defined in the attack description).
*   **Half:** A successful save reduces damage taken by half (rounded down).
*   **Disbelief:** A successful save allows you to completely ignore the effect (typically used against illusions).
*   **(harmless):** The spell/effect is typically beneficial. A target can still choose to resist it and make a save.
*   **(object):** The effect can target objects.
    *   *Attended Objects:* Use the attending creature's saving throw (unless the object's own bonus is higher).
    *   *Unattended Magic Items:* Gain their own saving throw. A magic item's saving throw bonus is:
        $$\text{Magic Item Save Bonus} = 2 + 1/2\ \text{Item's Caster Level}$$
    *   *Unattended Nonmagical Objects:* Do not receive a saving throw; they automatically fail saves and take full damage.

---

## Item Survival on a Natural 1
If a character rolls a **natural 1** on a saving throw against an attack that can damage objects (such as a *fireball* or *acid fog*), one of their carried or worn items is exposed to damage.
1.  **Select Candidates:** Identify the four carried or worn items most likely to be affected.
2.  **Determine Order:** Roll randomly among the four candidate items based on the priority order below.
3.  **Resolve Save:** The chosen item must make a saving throw against the attack's DC (using the character's save bonus, or the magic item's own bonus if higher). If it fails, the item takes damage.

#### Priority Order of Items Affected
1.  **1st:** Shield
2.  **2nd:** Armor
3.  **3rd:** Magic helmet
4.  **4th:** Item in hand (weapon, wand, etc.)
5.  **5th:** Magic cloak
6.  **6th:** Stowed or sheathed weapon
7.  **7th:** Magic goggles or lenses
8.  **8th:** Magic clothing (robe, suit, etc.)
9.  **9th:** Magic bracers or bracelets
10. **10th:** Magic ring
11. **11th:** Magic boots or shoes
12. **12th:** Anything else

---

## Special Save Abilities
*   **Evasion:** If an attack allows a Reflex save for half damage, you take no damage on a successful save. You cannot use evasion if you are bound, helpless, or squeezing. See [tactical-movement.md](./tactical-movement.md).
*   **Improved Evasion:** Like evasion, but you take only half damage even on a failed saving throw.
*   **Mettle:** If an attack allows a Will or Fortitude save for a partial/half effect (e.g., Will partial, Fortitude half), a successful save negates the effect entirely. You cannot use mettle if you are sleeping or unconscious. See [conditions.md](./conditions.md).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 112–113, and *Player's Handbook*, pages 176–177).