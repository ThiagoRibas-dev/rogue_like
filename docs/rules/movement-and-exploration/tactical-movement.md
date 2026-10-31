# Tactical Movement
## Category
Movement

## Summary
Tactical movement occurs during combat on a 5-foot battle grid. It is governed by a character's speed, the terrain, the presence of obstacles, other creatures, and the type of actions spent.

## Mechanics

### 1. Basic Movement on the Grid
*   **The Grid:** 1 square $= 5$ feet.
*   **Diagonal Movement:** The first diagonal moved in a turn counts as 1 square (5 feet), the second diagonal counts as 2 squares (10 feet), the third counts as 1 square, the fourth as 2, and so on.
    *   *Restrictions:* You cannot move diagonally past the corner of a wall or a blocking obstacle. You can move diagonally past a creature (including enemies) or non-blocking obstacles (like pits).
*   **Action Types:**
    *   *Single Move:* Move up to your speed as a Move Action.
    *   *Double Move:* Move up to twice your speed in a round by using both a Move and a Standard action.
    *   *Run:* Move up to 4x your speed (3x in heavy armor) as a Full-Round Action.
    *   *5-Foot Step:* A quick adjustment that does not provoke attacks of opportunity. See [take-5-foot-step.md](./take-5-foot-step.md).

### 2. Moving through Other Creatures' Spaces

#### Friendly Creatures
You can move through a square occupied by an ally, unless you are charging. Allies do not provide you with cover.

#### Opponents
Generally, you cannot move through a square occupied by an opponent. Exceptions include:
*   **Extreme Size Difference:** You can move through the space of an opponent who is three or more size categories larger or smaller than you.
*   **Helpless:** You can move through the space of a helpless opponent. If they are Large or larger, they count as difficult terrain. See [conditions.md](./conditions.md).
*   **Overrun:** You can attempt to plow through an opponent's space. See [overrun.md](./overrun.md).
*   **Tumbling:** A successful Tumble check allows you to move through an opponent's space. See [use-skill.md](./use-skill.md).
*   **Tiny or Smaller:** Tiny, Diminutive, and Fine creatures can freely move through an opponent's space (but provoke AoOs normally in doing so). See [big-and-little-creatures-in-combat.md](./big-and-little-creatures-in-combat.md).

#### Sharing Spaces (Ending Movement)
You cannot end your movement in an occupied square unless the occupant is helpless, you are riding/carrying them, you are grappling them, or you are Tiny or smaller. If you enter an occupied square, you provoke an AoO from the occupant. See [grapple.md](./grapple.md) and [attacks-of-opportunity.md](./attacks-of-opportunity.md).

---

### 3. Hampered Movement
Various factors slow down your movement. When movement is hampered, the speed cost is doubled.

#### Difficult Terrain
Heavy debris, shallow water, steep slopes, or thick undergrowth.
*   **Cost:** Each square of difficult terrain costs **2 squares (10 feet)** of movement. Diagonal movement in difficult terrain costs **3 squares (15 feet)**.
*   **Restrictions:** You cannot run or charge across difficult terrain.
*   **Space Coverage:** If a Large or larger creature occupies a space with different terrain types, it moves at the speed of the most difficult terrain in its space.
*   *Exceptions:* Flying and incorporeal creatures ignore difficult terrain.
*   *Natural Hazards:* For detailed rules on natural hazards (such as quicksand, avalanches, and lava), see [natural-hazards.md](./natural-hazards.md).

#### Obstacles
Obstacles hamper movement but do not completely block it.
*   **Cost:** Each obstructed square costs double (2 squares).
*   **Crossing Barriers:** It costs **2 squares** of movement to cross an obstacle separating two squares (e.g., a low fence), in addition to the cost of entering the square on the other side.
*   *Exceptions:* Flying and incorporeal creatures ignore physical obstacles.

#### Squeezing (Narrow Spaces)
Squeezing occurs when moving through spaces narrower than your normal fighting space (e.g., a Large creature moving through a 5-foot hallway).
*   **Limit:** You can squeeze through a space at least half as wide as your normal space.
*   **Cost:** Squeezing through narrow spaces costs double movement.
*   **Combat Penalties:** While squeezed, you take a **-4 penalty on attack rolls** and a **-4 penalty to AC**.
*   **Squeezing past Opponents:** You can squeeze past opponents, provoking AoOs as normal. You cannot end your turn in an occupied square.
*   **Squeezing into Very Tight Spaces:** To enter a space less than half your space's width, you must make a **DC 30 Escape Artist check**. While inside, you cannot attack, take a -4 penalty to AC, and are denied your Dexterity bonus to AC (flat-footed). See [use-skill.md](./use-skill.md).

#### Stacking Hampered Cost (Multiplication)
If movement is doubled by multiple factors (e.g., squeezing through difficult terrain):
*   Double $\times$ Double = **x4 cost** (each square costs 4 squares of movement, diagonal costs 6).
*   Double $\times$ Double $\times$ Double = **x8 cost** (diagonal costs 12).

---

### 4. Special Movement Situations

*   **Minimum Movement (5-foot Full-Round):** Despite any penalties or hampers, you can take a full-round action to move 5 feet (1 square) in any direction (including diagonal).
    *   *AoO:* This movement provokes attacks of opportunity normally (it is NOT a 5-foot step).
    *   *Restrictions:* You cannot use this to pass through impassable barriers or when movement is prohibited (e.g., when paralyzed).
*   **Ending in an Illegal Space:** If you end your movement in an illegal square (e.g., in an occupied square or mid-fall), you are immediately placed in the last legal position you occupied, or the closest legal position (whichever is closer). For rules on falling, see [natural-hazards.md](./natural-hazards.md).
*   **Chase Rules:** When speeds are equal and one creature pursues another, resolve the chase with **opposed Dexterity checks**. If the quarry wins, they escape; if the pursuer wins, they catch them.

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 90–99 and 3214–3540, and *Player's Handbook*, pages 147–149).