# Throw Splash Weapon
## Category
Special Attack / Combat Action

## Summary
A splash weapon is a ranged weapon that breaks on impact, splashing or scattering its contents over its target and all creatures in the immediate vicinity (e.g., alchemist's fire, acid, or holy water).

## Mechanics

### 1. Attacking a Target Creature
*   **Action Type:** Ranged attack.
*   **The Attack:** Make a ranged touch attack against the target's Touch AC. See [armor-class.md](./armor-class.md).
*   **Proficiency:** Thrown weapons require no weapon proficiency; you **do not** take the -4 nonproficiency penalty.
*   **Success (Hit):** Deals direct hit damage to the target creature. It also deals splash damage to all creatures occupying squares within 5 feet (adjacent squares) of the target.
*   **Critical Hits:** Splash weapons can score critical hits, but only the **direct hit damage** is multiplied. The splash damage remains normal.

### 2. Attacking a Grid Intersection
You can choose to aim at a specific point on the ground (a grid intersection) rather than a specific creature.
*   **The Attack:** Make a ranged attack against AC 5.
*   **Success (Hit):** Deals **only splash damage** to all creatures in squares adjacent to the target intersection. No creature receives direct hit damage.
*   **Restriction:** You cannot target a grid intersection if it is occupied by a Large or larger creature. In that case, you must target the creature itself. See [big-and-little-creatures-in-combat.md](./big-and-little-creatures-in-combat.md).

### 3. Missing the Target (Scatter Mechanics)
If your attack roll fails (whether aiming at a creature or an intersection), the weapon scatters in a random direction and lands a distance away proportional to the range of your throw.
1.  **Direction:** Roll $1d8$ and consult the **Thrown Weapon Misdirection Diagram** below.
2.  **Distance:** Count a number of squares in the rolled direction equal to the **number of range increments** of the throw. (E.g., if throwing a weapon with a 10-foot range increment at a target 20 feet away, a miss means it scatters 2 squares in the rolled direction).
3.  **Splash Damage:** Wherever the weapon lands, it deals splash damage to all creatures within 5 feet (adjacent squares). No direct hit damage is dealt.

---

## Thrown Weapon Misdirection Diagram

When an attack misses, roll $1d8$ to determine the direction the weapon scatters relative to the thrower's line of fire:

```text
       Line of Fire
            |
            v
     [4]   [5]   [6]
       \    |    /
     [3]--[ T ]--[7]
       /    |    \
     [2]   [1]   [8]
            |
         Thrower
```

*   **[ T ]** = Target (intended square/intersection)
*   **[ 1 ]** = Straight back (short throw, toward thrower)
*   **[ 2 ]** = Diagonal back-left (Southwest)
*   **[ 3 ]** = Left (West)
*   **[ 4 ]** = Diagonal forward-left (Northwest)
*   **[ 5 ]** = Straight forward (overshot, North)
*   **[ 6 ]** = Diagonal forward-right (Northeast)
*   **[ 7 ]** = Right (East)
*   **[ 8 ]** = Diagonal back-right (Southeast)

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, page 5284–5296, and *Player's Handbook*, page 158).