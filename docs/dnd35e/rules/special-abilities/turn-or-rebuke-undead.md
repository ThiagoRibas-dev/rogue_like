---
title: Turn or Rebuke Undead
parent: Combat II (Movement, Modifiers, Special Actions)
grand_parent: Rules
---

# Turn or Rebuke Undead
## Category
Special Ability / Supernatural Ability

## Summary
Good clerics and paladins can channel positive energy to turn (drive away) or destroy undead. Evil clerics can channel negative energy to rebuke (awe), command (control), or bolster undead. Neutral clerics must choose whether they channel positive or negative energy. Some classes can also turn or rebuke deathless or other creature types.

## Mechanics

### 1. General Rules
*   **Action Type:** Supernatural ability performed as a standard action. It does not provoke attacks of opportunity. See [actions-in-combat.md](./actions-in-combat.md).
*   **Holy Symbol:** You must present a holy symbol to turn or rebuke.
*   **Turning is an Attack:** Turning is considered an attack for the purpose of adjudicating other effects (such as ending an invisibility spell).
*   **Times per Day:** You can attempt to turn or rebuke a number of times per day equal to:
    $$\text{Daily Uses} = 3 + \text{Charisma Modifier} + \text{Extra Turning Uses (from feats/abilities)}$$
*   **Range & Targeting:**
    *   **Range:** 60 feet.
    *   **Order:** Affects the closest turnable creature first.
    *   **Line of Effect:** You must have line of effect to the targets, but you do not need line of sight.
    *   **Skipping:** You can skip over creatures that have already been turned or rebuked on a previous round, so you do not waste your turning capacity on them.

### 2. The Turning Check (Maximum HD Affected)
To determine the maximum Hit Dice of the most powerful creature you can affect on this attempt, roll a turning check.
*   **The Check:** Roll $1d20 + \text{Charisma Modifier}$.
*   Compare the result to the table below to find the maximum HD of a single creature you can affect, based on your **Turning Level** (e.g., Cleric level, or Paladin level -3).

#### Table: Turning Undead
| Turning Check Result | Most Powerful Creature Affected (Maximum Hit Dice) |
| :--- | :--- |
| **0 or lower** | Turning Level - 4 |
| **1–3** | Turning Level - 3 |
| **4–6** | Turning Level - 2 |
| **7–9** | Turning Level - 1 |
| **10–12** | Turning Level |
| **13–15** | Turning Level + 1 |
| **16–18** | Turning Level + 2 |
| **19–21** | Turning Level + 3 |
| **22 or higher** | Turning Level + 4 |

### 3. Turning Damage (Total HD Affected)
If your turning check allows you to affect at least some targets in range, roll turning damage to see how many total Hit Dice of creatures you can affect.
*   **Turning Damage Roll:** Roll $2d6 + \text{Turning Level} + \text{Charisma Modifier}$.
*   You allocate this damage to the closest eligible creatures first. If a creature's HD exceeds your turning damage or your turning check limit, it is unaffected, and you proceed to the next closest creature.

### 4. Turn Resistance
Turn resistance is an extraordinary ability possessed by some creatures. Add the creature's turn resistance bonus to its Hit Dice for all checks and damage calculations related to turning.

### 5. Turning Swarms
When attempting to turn or rebuke a swarm, treat the swarm as having **half its normal Hit Dice** for both the turning check (maximum HD affected) and turning damage.

---

## Turning Results (Positive Energy vs. Undead / Negative Energy vs. Deathless)

### Turned
Turned creatures flee from you by the best and fastest means available for 10 rounds (1 minute).
*   **Cowering:** If they cannot flee, they cower (opponents gain a +2 bonus on attack rolls against them). See [conditions.md](./conditions.md).
*   **Approaching:** If you approach within 10 feet of a turned creature, it overcomes the effect and acts normally. You may stand within 10 feet without breaking the effect, but you cannot actively move closer.
*   **Attacks:** You can attack turned creatures with ranged attacks from at least 10 feet away, and your allies can attack them in any fashion, without breaking the turning effect.

### Destroyed
If your Turning Level is twice the target creature's Hit Dice (or more), any creature you would normally turn is instead destroyed (disintegrated).

---

## Rebuking Results (Negative Energy vs. Undead / Positive Energy vs. Deathless)

### Rebuked
Rebuked creatures cower in awe for 10 rounds (opponents gain a +2 bonus on attack rolls against them).

### Commanded
If your Turning Level is twice the target creature's Hit Dice (or more), any creature you would normally rebuke is instead commanded.
*   **Control:** A commanded creature is under your mental control. Giving orders is a standard action.
*   **Command Limit:** You can command any number of creatures whose combined Hit Dice do not exceed your Turning Level. You can voluntarily release commanded creatures to command new ones. Otherwise, command is permanent.

### Dispelling Turning
If you channel the opposing energy type (e.g., negative energy to counter positive), you can spend a turning attempt to dispel another character's turning effect.
*   **The Check:** Make a turning check. If it equals or exceeds the original turning check result that established the turning effect, the effect is dispelled.
*   **The Damage:** Roll turning damage to determine the maximum Hit Dice of creatures you can free from the turning effect.

### Bolstering
You can spend a turning attempt to bolster creatures of your aligned energy type against turning in advance (e.g., an evil cleric bolstering undead).
*   **The Check:** Make a turning check. The resulting maximum HD from the Turning Table becomes the targets' effective Hit Dice against turning for 10 rounds (if higher than their actual HD).
*   You can bolster yourself if you are of the same type as the targets (e.g., an undead cleric bolstering themselves).

---

## Alternative Turning: "Frightened without Fleeing"
At the DM's option (or to simplify combat tracking), the following variant rule can be used:
*   Instead of running away, turned creatures take a **-4 penalty** on attack rolls, saving throws, skill checks, and ability checks for 10 rounds.
*   The turner can approach the turned creatures without breaking this effect.
*   Turned creatures cannot attack the turner unless the turner attacks them first (and even then, only the attacked creature can retaliate).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 146–147, and *Player's Handbook*, pages 159–160).