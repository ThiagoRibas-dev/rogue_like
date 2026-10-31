# Sunder
## Category
Special Attack / Combat Action

## Summary
Sunder is a combat maneuver that allows you to strike at a weapon, shield, or other object held, carried, or worn by a defender, with the goal of damaging or destroying it.

## Mechanics

### 1. Sundering a Held Object
To sunder an object currently held by an opponent:
*   **Action Type:** Melee attack with a slashing or bludgeoning weapon.
*   **Step 1: Attack of Opportunity:** You provoke an attack of opportunity from the defender. If the defender is unable to make attacks of opportunity, or if you have the **Improved Sunder** feat, you do not provoke.
*   **Step 2: Opposed Roll:** You and the defender make opposed attack rolls with your respective held objects.
    *   **Size Modifiers:** The larger combatant receives a **+4 bonus** on the roll per size category difference. See [big-and-little-creatures-in-combat.md](./big-and-little-creatures-in-combat.md).
    *   **Weapon Size Modifiers:**
        *   Wielding a two-handed weapon: **+4 bonus** on the roll.
        *   Wielding a light weapon: **-4 penalty** on the roll.
    *   **Non-Weapon Held Objects:** If the defender's held object is not a weapon (e.g., a shield, wand, or goblet), the defender takes a **-4 penalty** on the opposed attack roll.
*   **Step 3: Damage Resolution:**
    *   *Success:* If your attack roll exceeds the defender's, you deal damage to the held object normally. Roll your weapon's damage and subtract the object's Hardness; any remaining damage reduces the object's Hit Points.
    *   *Failure:* If you fail the opposed roll, you deal no damage.

### 2. Sundering a Carried or Worn Object
If you attack an object that is being carried or worn (such as a backpack, scroll case, or belt pouch), you do not make opposed rolls.
*   **The Attack:** Make a normal attack roll against the object's AC.
    *   **AC Formula:** $\text{Object AC} = 10 + \text{Object Size Modifier} + \text{Wielder's Dexterity Modifier}$.
*   **Attacks of Opportunity:** Attacking a carried or worn object provokes an AoO, unless you have the Improved Sunder feat.
*   **Armor Restriction:** You **cannot** sunder armor that is currently being worn by a creature.
*   **Snatching Items:** To snatch away an item instead of damaging it, see [disarm.md](./disarm.md).

### 3. Attacking Carried Creatures
A Small or larger creature can carry a Tiny or smaller creature (which then shares the carrier's space).
*   If the carried creature is visible, you can attack it as if it were a carried object.
*   **Benefits:** You gain the benefit of the Improved Sunder feat (no AoO provoked) if you possess it.
*   **AC:** The carried creature uses the higher of its own Dexterity modifier or its carrier's Dexterity modifier to determine its AC.

---

## Object Hardness and Hit Points (Medium Size)
When an object takes damage, subtract its Hardness from the damage dealt. Apply the remaining damage to its HP. Once an object's HP is reduced to 0, it is destroyed. (An object at half HP or less is "broken"). For complete rules on object size, material hardness, saving throws, and Strength checks to break objects, see [objects.md](./objects.md).

| Weapon / Shield / Armor | Hardness | Hit Points (HP) |
| :--- | :--- | :--- |
| **Light Blade** (e.g., dagger, short sword) | 10 | 2 |
| **One-Handed Blade** (e.g., longsword) | 10 | 5 |
| **Two-Handed Blade** (e.g., greatsword) | 10 | 10 |
| **Light Metal-Hafted Weapon** | 10 | 10 |
| **One-Handed Metal-Hafted Weapon** (e.g., mace) | 10 | 20 |
| **Light Wooden-Hafted Weapon** (e.g., handaxe) | 5 | 2 |
| **One-Handed Wooden-Hafted Weapon** (e.g., battleaxe)| 5 | 5 |
| **Two-Handed Wooden-Hafted Weapon** (e.g., greataxe) | 5 | 10 |
| **Projectile Weapon** (e.g., bow) | 5 | 5 |
| **Armor (Worn)** | *By Material* | Armor Bonus $\times 5$ |
| **Buckler** | 10 | 5 |
| **Light Wooden Shield** | 5 | 7 |
| **Heavy Wooden Shield** | 5 | 15 |
| **Light Steel Shield** | 10 | 10 |
| **Heavy Steel Shield** | 10 | 20 |
| **Tower Shield** | 5 | 20 |

*Note: For items of sizes other than Medium, divide HP by 2 for each size category smaller than Medium, or multiply by 2 for each size category larger.*

### Magical Reinforcement
Magic weapons, shields, and armor are much sturdier (see [objects.md](./objects.md) for details):
*   Each $+1$ of enhancement bonus adds **+2 Hardness** and **+10 Hit Points** to the item.
*   E.g., a $+2\ \textit{longsword}$ has a Hardness of 14 and 25 HP (instead of Hardness 10 and 5 HP).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 107 and 5260–5274, and *Player's Handbook*, pages 158 and 165).