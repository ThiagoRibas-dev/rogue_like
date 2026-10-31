# Senses and Perception

Most creatures perceive their surroundings using sight and hearing (governed by the Spot and Listen skills) and can focus active attention using Search. Some creatures possess extraordinary senses that allow them to bypass visual obstacles.

---

## Standard Perception Skills

### [Listen](skill-listen.md) (Wisdom)
*   **Action:** Making a check to hear something in the environment is not an action. Trying to hear something previously failed is a **Move Action**.
*   **Resolution:** Listen is opposed by the target's **Move Silently** check, or made against a static DC reflecting how quiet the noise is.
*   **Beating the DC:**
    *   *Success:* Reveal general location or direction of the sound.
    *   *Beat DC by 10:* Understand the content of the sound (assuming language is known).
    *   *Beat DC by 20:* Pinpoint the exact square the sound is coming from.
*   **DCs and Modifiers:**
    *   *People talking:* DC 0.
    *   *Loud ambient noise:* $+10$ to DC.
    *   *Through a door:* $+5$ to DC.
    *   *Distance:* $+1$ to DC per 10 feet of distance ($+1$ per 30 feet underwater).
    *   *Listener sleeping:* $+10$ to DC (a successful check awakens the listener).

### [Spot](skill-spot.md) (Wisdom)
*   **Action:** Making a check to see something in the environment is not an action. Trying to spot something previously failed is a **Move Action**.
*   **Resolution:** Spot is opposed by the target's **Hide** check, or made against a static DC reflecting how hard something is to see.
*   **Requirement:** A creature must have **Line of Sight** (see [line-of-sight-and-effect.md](./line-of-sight-and-effect.md)) to make a Spot check.
*   **Modifiers:**
    *   *Spotter distracted:* -5 penalty on the check.
    *   *Distance:* -1 penalty per 10 feet of distance.
*   **Other Uses:**
    *   *Read Lips:* Understand general content of a minute of speech. Speaker must be within 30 feet, and the lip reader must have line of sight, move at half speed, and understand the language. Base DC 15 (higher for complex/inarticulate speakers). DM rolls secretly. Failure by 4 or less reveals nothing. Failure by 5 or more leads to incorrect conclusions.
    *   *Disguise detection:* Opposed by a Disguise check.

### [Search](skill-search.md) (Intelligence)
*   **Action:** Active effort. Searching a 5-foot-by-5-foot area (or a 5-foot cube volume of goods) takes a **Full-Round Action** that provokes attacks of opportunity.
*   **Requirement:** A searcher must be within 10 feet of the object or surface being searched.
*   **DCs:**
    *   *Notice a secret door or simple trap:* DC 20.
    *   *Find a magic trap:* DC 25 + level of spell (requires the **Trapfinding** class feature).
    *   *Find a footprint:* Varies (does not allow tracking without the Track feat).

### Other Senses
If it becomes important whether a creature senses something specific when smelling, tasting, or touching (outside of dedicated skills), resolve it with a **Wisdom check** against a DC set by the DM.

---

## Extraordinary Senses

Some creatures possess extraordinary senses that override standard visual or auditory limitations.

### Darkvision
*   **Description:** The ability to see with no light source whatsoever out to a specified range.
*   **Mechanics:** Darkvision is black-and-white only (no colors can be discerned). Light sources do not spoil darkvision. Creatures are still subject to gaze attacks normally. Darkvision does not allow seeing through solid objects.

### Low-Light Vision
*   **Description:** The ability to see twice as far as normal in conditions of dim light (shadowy illumination).
*   **Mechanics:** Low-light vision allows reading even in tiny light sources, and seeing outdoors on a moonlit night as clearly as during the day.
*   **Superior Low-Light Vision:** Allows seeing four times as far as normal in shadowy illumination.

### Blindsight
*   **Description:** The ability to maneuver and fight as well as a sighted creature, even if blind or in absolute darkness.
*   **Mechanics:**
    *   Bypasses invisibility, darkness, and most concealment (miss chances do not apply).
    *   Requires **Line of Effect** (see [line-of-sight-and-effect.md](./line-of-sight-and-effect.md)) to detect creatures or objects.
    *   Spot and Listen checks are not required to notice or locate targets within range.
    *   Gaze attacks do not affect a blindsighted creature.
    *   Does not distinguish color, visual contrast, or allow reading.
    *   Blinding attacks have no effect. Deafening attacks negate blindsight if it is sound-based.
    *   Works underwater, but does not function in a vacuum.
    *   Continuous and automatic (unless noted as needing to be triggered as a free action, in which case it only functions on the creature's turn).

### Blindsense
*   **Description:** The ability to notice the presence and general location of unseen targets, but without the precision of blindsight.
*   **Mechanics:**
    *   Automatically locates creatures within range if there is **Line of Effect**. Spot/Listen checks are not required.
    *   Targets still benefit from **total concealment** (50% miss chance, see [concealment.md](./concealment.md)).
    *   The blindsensing creature is still denied its Dexterity bonus to AC against attacks from creatures it cannot see.
    *   Conditions affecting visibility (such as darkness or fog) still hamper the blindsensing creature's movement.

### Scent
*   **Description:** The ability to detect other creatures and track by sense of smell.
*   **Detecting Creatures:**
    *   *Normal Range:* Usually 30 feet. Range is 60 feet upwind, and 15 feet downwind.
    *   *Strong Scents (smoke, garbage):* Double normal range.
    *   *Overpowering Scents (skunk, troglodyte):* Triple normal range.
*   **Pinpointing:** Detects presence and direction of a scent (move action to note direction). Moving within 5 feet of the source pinpoints its exact location.
*   **Masking:** Overwhelming odors completely spoil detection and tracking.
*   **Tracking:** Follow tracks by smell on a successful Survival check (requires the **Track** feat, DC varies by terrain).

### Tremorsense
*   **Description:** Sensitivity to vibrations in the ground or water.
*   **Mechanics:**
    *   Automatically pinpoints the location of anything within range that is in contact with the ground and is not totally still.
    *   Both the tremorsensing creature and the target must be in contact with the ground (or same body of water for aquatic creatures).
    *   The target must be taking physical actions (including somatic spellcasting, though they do not have to move from square to square).
    *   If no direct path exists through the ground, the range defines the maximum distance of the shortest indirect path.
