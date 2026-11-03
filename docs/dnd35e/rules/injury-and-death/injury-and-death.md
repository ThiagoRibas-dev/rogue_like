# Injury and Death
## Category
Core Mechanics

## Summary
Injury represents the loss of hit points due to damage. In D&D 3.5e, your character is not mechanically slowed down or hindered by wounds until their hit points drop to 0 or lower. Below 0 hit points, a character enters a critical state that can lead to death.

## Mechanics

### 1. Hit Points (HP)
Hit points represent physical durability, combat stamina, and the ability to turn a lethal blow into a glancing scratch.
*   **Constitution Modifier Changes:** If your Constitution score permanently or temporarily changes, you gain or lose 1 hit point per Hit Die for every $+1$ or $-1$ change in your Constitution modifier.
    *   *Limit:* Withered or reduced Constitution can never reduce your maximum hit points below 1 HP per Hit Die.
    *   *Death:* If your Constitution score is reduced to 0, you die instantly regardless of your current hit points. See [ability-scores.md](./ability-scores.md).
*   **Temporary Hit Points:** Extra hit points that act as a buffer. They are lost first to damage and cannot be healed.
    *   *Stacking:* Temporary HP from the same source do not stack (the highest applies). Temporary HP from different sources stack; damage is subtracted from the oldest source first. See [temporary-hit-points.md](./temporary-hit-points.md).

### 2. Massive Damage Rule
If a single attack deals **50 points of damage or more** and does not kill you outright:
*   You must immediately attempt a **DC 15 Fortitude save**. See [saving-throws.md](./saving-throws.md).
*   **Failure:** You die instantly, regardless of your current hit point total.
*   *Note:* Taking 50+ points of damage cumulatively from multiple small attacks in a single round does not trigger this rule.

---

## The States of Health and Injury

### 1. Healthy / Wounded (1 HP or Higher)
You are fully functional. Wounds do not impose penalties to your actions, AC, or movement.

### 2. Disabled (Exactly 0 HP)
You are conscious but severely weakened.
*   **Action Restriction:** You are limited to a single **Move Action** or **Standard Action** each round. You cannot take full-round actions.
*   **Movement:** You move at half speed.
*   **Strenuous Activity:** Taking a standard action (or any other strenuous act) deals **1 point of damage** to you *after* the action is resolved. Unless this action healed you, you now have negative hit points and are dying.
*   *Non-Living Exception:* Constructs, undead, and deathless are destroyed instantly when reduced to 0 HP.
*   See [disabled-0-hit-points.md](./disabled-0-hit-points.md).

### 3. Dying (-1 to -9 HP)
You are unconscious and at death's door.
*   **Unconscious:** You are helpless and can take no actions.
*   **Bleeding Out:** On your initiative count each round, you must roll $d\%$. You have a **10% chance to stabilize**.
    *   *Failure:* You lose 1 hit point.
    *   *Success:* You stabilize. You stop losing hit points but remain unconscious.
*   See [dying-negative-1-to-negative-9-hit-points.md](./dying-negative-1-to-negative-9-hit-points.md).

### 4. Stable (Stable and conscious/unconscious at negative HP)
You are no longer actively dying, but you are still in danger.
*   **Natural Recovery (Unaided):** If you stabilized without help, you have a 10% chance each hour to wake up (disabled). If you fail this roll, you lose 1 HP. Once awake, you have a 10% chance each day to begin healing naturally; if you fail, you lose 1 HP.
*   **Assisted Recovery:** If stabilized by a DC 15 Heal check or magical healing, you automatically begin healing naturally and have a 10% chance each hour to wake up. See [stable-characters-and-recovery.md](./stable-characters-and-recovery.md) and [healing.md](./healing.md).

### 5. Dead (-10 HP or Lower)
You are dead.
*   **Soul Departed:** Your soul leaves your body. You cannot benefit from normal or magical healing.
*   **Spell Loss:** When you die, all prepared spells in your mind are permanently lost.
*   **AC/Condition:** A dead creature's hit points are fixed at -10.
*   **Revival:** You can be restored to life only by powerful spells like *raise dead*, *resurrection*, or *reincarnate*.
*   See [dead-negative-10-hit-points-or-lower.md](./dead-negative-10-hit-points-or-lower.md).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 72–75 and 2611–2690, and *Player's Handbook*, pages 145–146).