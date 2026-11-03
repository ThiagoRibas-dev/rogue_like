# Skill: Climb
## Category
Skill Rules (A-D)

## Overview
The Climb skill is used to ascend, descend, or move across slopes, walls, ropes, and other steep inclines.

*   **Key Ability:** Strength (Str)
*   **Trained Only:** No
*   **Armor Check Penalty:** Yes (applied directly to Climb checks)

---

## Mechanics

### Action and Speed
*   **Quarter Speed:** A successful Climb check allows you to climb at one-quarter of your land speed as a **Move Action**.
*   **Accelerated Climb:** You can climb faster by taking a penalty on your check:
    *   *Half Speed:* **+5 to DC**.
    *   *Normal Speed:* **+20 to DC**.

### Surface DCs

| Incline / Surface Type | DC | Example |
| :--- | :---: | :--- |
| **Slope** (angle < 60°) | 0 | Steep, rugged hill, gentle incline |
| **Braced Rope / Knotted Rope** | 5 | Rope braced against a wall, knotted rope |
| **Rough Tree / Unknotted Rope** | 15 | Tree with branches, unknotted rope, pulling yourself up from dangling |
| **Rough Wall** | 25 | Natural rock wall, brick wall |
| **Ceiling / Overhang** | 25 | Ceiling with handholds but no footholds |
| **Smooth Vertical Surface** | — | Perfectly smooth wall (impossible without magic) |

### DC Modifiers (Stacking)

| Condition / Action | DC Modifier |
| :--- | :---: |
| **Slippery** (wet, icy, slimy) | +5 |
| **Bracing Corner** (perpendicular walls) | -5 |
| **Climb while retaining Dex bonus to AC** | +20 |

---

## Outcomes

*   **Success:** You climb the designated distance.
*   **Failure by 4 or Less:** You make no progress but hold on.
*   **Failure by 5 or More:** You lose your grip and fall (see [natural-hazards.md](./natural-hazards.md) for falling damage).

---

## Combat and Hazard Actions

### Defenses while Climbing
*   **No Dex to AC:** You are denied your Dexterity bonus to AC while climbing, and you cannot use a shield.
*   **Taking Damage:** Any time you take damage while climbing, you must immediately succeed on a Climb check against the surface's DC or fall.

### Hands Free
*   Climbing requires both hands. You can cling to a wall with one hand (using a standard or free action) to cast a one-handed spell or perform a single-handed action.

### Catching Yourself while Falling
*   If you fall, you can attempt to catch yourself on a surface with a Climb check:
    *   *Wall:* **DC = Wall's DC + 20**
    *   *Slope:* **DC = Slope's DC + 10**
    *   *Rappelling:* **DC = Rappel DC + 10**

### Catching a Falling Ally
*   If an ally adjacent to or above you falls, you can attempt to catch them as they pass:
    1.  Make a successful melee touch attack to grab them (the ally can waive their Dex bonus to AC).
    2.  Make a Climb check: **DC = Wall's DC + 10**.
    *   *Weight Limit:* The ally's weight plus equipment cannot exceed your **Maximum Load** or you both fall automatically.
    *   *Failure by 4 or less:* You do not catch the ally, but you hold onto the wall.
    *   *Failure by 5 or more:* You fail to catch the ally and fall with them.

### Rappelling
If you have a climber's kit, rope, and at least 1 rank in Climb:
*   **Standard Descent:** Move at your base land speed down any wall with a **DC 10 Climb check** (standard action).
*   **Double Speed:** Descend at double speed as a **Full-Round Action** (DC 10).
*   **Rapid Descent (4x Speed):** Descend at four times speed as a **Full-Round Action** with a **DC 20 Climb check**.
    *   *Failures:* Failing a check deals $1d6$ points of damage from a rough descent. Failing by 5 or more means you fall.

---

## Extraordinary Climb Capabilities

### Natural Climb Speed
Creatures with a natural climb speed gain the following benefits:
*   **Racial Bonus:** A **+8 racial bonus** on all Climb checks.
*   **Take 10:** Can always choose to take 10 on Climb checks, even if distracted, rushed, or threatened.
*   **Retain Dex to AC:** They retain their Dexterity bonus to AC while climbing, and opponents gain no special attack bonuses against them.
*   **Accelerated Natural Climb:** Can move at double their climb speed (or land speed, whichever is lower) by taking a **-5 penalty** on the check.
*   *Restriction:* They cannot run while climbing.
