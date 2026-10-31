# Skill: Intimidate
## Category
Skill Rules (E-L)

## Overview
The Intimidate skill represents your ability to force cooperation from others through verbal threats, menacing body language, or a duel of wills before combat.

*   **Key Ability:** Charisma (Cha)
*   **Trained Only:** No
*   **Armor Check Penalty:** No

---

## Mechanics

### DC Calculation
To intimidate an NPC, your check is opposed by the target's **Modified Level Check**:
$$\text{Target's Roll} = \text{1d20} + \text{Character Level or Hit Dice} + \text{Wisdom Modifier} + \text{Fear Save Modifiers}$$

### Size Modifiers
Your size relative to the target modifies your Intimidate check:
*   **Larger:** **+4 bonus** per size category difference.
*   **Smaller:** **-4 penalty** per size category difference.

### Constraints
*   **Fear Immunity:** Creatures immune to fear cannot be intimidated.
*   **Mindless:** Nonintelligent creatures (Int 0 or nonability) cannot be intimidated (see [nonabilities.md](./nonabilities.md)).

---

## Applications

### 1. Influencing Social Attitude
*   **Action:** Requires at least **1 minute** of interaction.
*   **Resolution:** DM rolls the opponent's check secretly.
*   **Success:** The target is coerced into acting as friendly toward you, but only for tasks undertaken while in your presence.
    *   *Duration:* Lasts for the duration of the encounter, and **1d6 $\times$ 10 minutes** after you leave.
    *   *Aftermath:* Once the intimidation wears off, the target's attitude shifts to **unfriendly** (or **hostile** if they were unfriendly beforehand).
*   **Failure by 5 or More:** The target secretly thwarts your efforts, providing false or useless information.

### 2. Demoralize Opponent in Combat
You can shake a foe's resolve in battle.
*   **Action:** **Standard Action**.
*   **Requirements:** Opponent must be threatened by you in melee combat and must be able to see you.
*   **Resolution:** Opposed check: your **Intimidate** vs. target's **Modified Level Check**.
*   **Success:** The target becomes **shaken** for **1 round** (taking a -2 penalty on attack rolls, saving throws, skill checks, and ability checks).

### 3. Duel of Wills
Before initiative is rolled in a combat encounter, you can initiate a duel of wills with a visible opponent within 30 feet.
*   **Action:** **No Action** (must have line of sight).
*   **Requirement:** Both participants must have an Intelligence of 3 or higher.
*   **Resolution:** You fix your gaze on the opponent. The opponent must choose one of three reactions:
    1.  **Submit:** The opponent takes a **-2 penalty** on their initiative check and a **-1 penalty** on attack rolls against you for 1 round.
    2.  **Ignore:** The opponent ignores your gaze. You make a **DC 15 Intimidate check**:
        *   *Success:* You gain a **+1 morale bonus** on attack rolls against that opponent for 1 round.
        *   *Failure:* No effect.
    3.  **Participate:** You make opposed Intimidate checks.
        *   *Winner:* Gains a **+1 morale bonus** on attack and damage rolls against the loser for the duration of the encounter.
        *   *Loser:* Takes a **-1 morale penalty** on attack and damage rolls against the winner for the duration of the encounter.
