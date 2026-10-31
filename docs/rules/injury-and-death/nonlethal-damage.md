# Nonlethal Damage
## Category
Injury and Death

## Summary
Nonlethal damage represents trauma, fatigue, or subdual that can stun or knock a creature unconscious but does not directly threaten their life. It is tracked as a running total rather than subtracted from hit points.

## Mechanics

### 1. Tracking and Effects
Do not deduct nonlethal damage from your current hit points. Instead, keep a running total of accumulated nonlethal damage.
*   **Staggered:** When your nonlethal damage **equals** your current hit points, you become staggered. You can take only a single standard action or move action each round. You cease being staggered when your current hit points exceed your nonlethal damage. See [conditions.md](./conditions.md).
*   **Unconscious:** When your nonlethal damage **exceeds** your current hit points, you fall unconscious and are helpless. See [conditions.md](./conditions.md) and [armor-class.md](./armor-class.md).
*   **Overflow to Lethal:** If a creature's accumulated nonlethal damage exceeds its **maximum hit points**, any excess nonlethal damage is dealt as **lethal damage** instead, reducing its current hit points.

### 2. Weapons and Nonlethal Damage
*   **Lethal Weapon for Nonlethal Damage:** You can use a melee weapon that normally deals lethal damage (such as a longsword) to deal nonlethal damage, but you take a **-4 penalty** on your attack roll.
*   **Nonlethal Weapon for Lethal Damage:** You can use a weapon that normally deals nonlethal damage (such as a sap, whip, or unarmed strike) to deal lethal damage, but you take a **-4 penalty** on your attack roll.
*   *Note: Spellcasters who fall unconscious from nonlethal damage retain any prepared spells in their mind when they wake up.*

### 3. Nonlethal Damage Immunity
The following creature types and subtypes are completely immune to nonlethal damage:
*   Constructs, Undead, and Deathless.
*   Oozes and Plants.
*   Incorporeal creatures.
*   *Effect:* Any attack or spell that deals *only* nonlethal damage (such as a *merciful* weapon) has no effect on creatures immune to nonlethal damage.

### 4. Environmental & Other Sources
Nonlethal damage can be accumulated from sources other than attacks:
*   **Forced March:** Travel beyond 8 hours a day deals cumulative nonlethal damage. See [tactical-movement.md](./tactical-movement.md).
*   **Starvation and Thirst:** Going without food or water deals nonlethal damage that cannot be healed until the creature eats or drinks.
*   **Extreme Heat and Cold:** Prolonged exposure to extreme temperatures deals nonlethal damage.
*   **Suffocation:** Failing to breathe deals nonlethal damage before leading to death.

### 5. Healing Nonlethal Damage
*   **Natural Healing:** Nonlethal damage heals at a rate of:
    $$\text{Nonlethal Recovered} = 1\text{ point per hour per character level or Hit Die (whichever is higher)}$$
*   **Magical Healing:** Any spell or effect that restores hit points (such as *cure light wounds*) **also removes an equal amount of nonlethal damage**.
*   *Note: Non-living creatures do not heal naturally. See [healing.md](./healing.md).*

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 2632–2645 and 2699, and *Player's Handbook*, page 146).