# Line of Sight and Line of Effect

Understanding the difference between Line of Sight (seeing a target) and Line of Effect (reaching a target) is crucial for tactical positioning, spellcasting, and resolving ranged attacks.

---

## Line of Effect (LoE)

Line of effect is a straight, unblocked path that determines whether an effect—such as a ranged attack, spell, or explosion—can reach a particular target.

### Rules of Line of Effect
*   **Solid Barriers:** A solid barrier (like a stone wall) blocks and cancels line of effect.
*   **Visual Impairment:** Fog, darkness, invisibility, and other factors that limit normal sight do **not** block line of effect. (You can cast a fireball into pitch darkness; it still explodes and reaches everything in its area).
*   **Spell Targeting:** You must have line of effect to any target you cast a targeted spell on, or to the space where you wish to create a magical effect.
*   **Area Spells:** You must have line of effect to the point of origin of any spell you cast (e.g., the center of a *fireball*). A burst, cone, cylinder, or emanation spell affects only areas, creatures, or objects to which it has line of effect from its point of origin.
*   **Holes in Barriers:** An otherwise solid barrier with a hole of at least 1 square foot does not block a spell's line of effect. The 5-foot section of wall containing the hole is no longer considered a barrier for this purpose.

### Determining Point of Origin
*   **Creature-Originated Effects:** For ranged attacks, rays, or spells originating from a creature, the point of origin is **any corner of any square** that the creature occupies.
*   **Area-Originated Effects:** For area effects (like a *fireball* burst), the line of effect to targets is traced from the spell's point of origin (the grid intersection chosen by the caster), not from the caster. This allows casting spells around corners or over low walls if the point of origin has line of effect to the target.

---

## Line of Sight (LoS)

Line of sight establishes whether a creature can see something else on the battle grid. 

### Determining Line of Sight
*   **Tracing the Line:** Presupposing you can see, determine line of sight by drawing an imaginary line between your space and the target's space. If any such line is unblocked, you have line of sight.
*   **Unblocked Definition:** A line is unblocked if it does not intersect or touch any squares or borders that block line of sight.
*   **Large Creatures:** If you can see even a single portion (one square) of a large creature that occupies multiple squares, you have line of sight to it and can target it.
*   **Sensory Blockage:** If you cannot see the target (due to being blinded, or the target being invisible), you do **not** have line of sight to it, even if the physical path between your squares is completely unblocked.

### Blocked or Partially Blocked Line of Sight
*   **Completely Blocked:** You cannot cast targeted spells or use abilities that require you to see the target.
*   **Visual Blockage Only (e.g., Fog, Darkness):** If line of sight is blocked by something that does not physically block attacks (like fog or magical darkness), you can still attack the square. The target is treated as having **total concealment** (50% miss chance, see [concealment.md](concealment.md)).
*   **Physical Partial Blockage (e.g., Corner of a Building):** Attacks work normally, but the target gains the benefits of **cover** (see [cover.md](cover.md)).

---

## The Interplay between LoS and LoE

While Line of Sight and Line of Effect overlap in most situations, they can be blocked independently:

| Barrier Type | Blocks Line of Sight (LoS)? | Blocks Line of Effect (LoE)? | Tactical Impact |
| :--- | :--- | :--- | :--- |
| **Solid Opaque Wall** (e.g., Stone Wall) | **Yes** | **Yes** | No attacks, spells, or sight possible. Total cover and total concealment. |
| **Solid Transparent Wall** (e.g., *Wall of Force*, Glass Window) | **No** | **Yes** | Can see and target with gaze attacks, but cannot shoot, throw, or cast spells through it. |
| **Opaque Visual Obstacle** (e.g., Dense Fog, Darkness) | **Yes** | **No** | Cannot see target (total concealment, 50% miss chance), but area spells (*fireball*) and physical attacks can pass through and affect the target normally. |
| **1 Square Foot Hole in Opaque Wall** | **No** (partial) | **No** | Allows both line of sight and line of effect through that section of the wall. |
