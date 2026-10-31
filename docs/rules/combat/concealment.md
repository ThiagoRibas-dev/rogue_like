# Concealment
## Category
Combat Mechanics

## Summary
Concealment occurs when something interferes with an attacker's accuracy without physically blocking the blow (e.g., fog, shadows, foliage, or magic). It introduces a miss chance for attacks and allows characters to hide.

## Mechanics

### 1. Determining Concealment
To determine if a target has concealment:
*   **Ranged Attack (and Non-Adjacent Melee/Reach):** Choose any corner of your square. Trace lines from this corner to all four corners of the target's square. If any of these lines pass through a square or border that provides concealment (such as a leafy bush or shadowy illumination; see [light-and-darkness.md](./light-and-darkness.md)), the target has concealment.
*   **Melee Attack (Adjacent Target):** The target has concealment only if its space is entirely within an effect that grants concealment (such as a cloud of smoke).
*   **Magical Effects:** Certain magical effects (like a *blur* spell) grant concealment regardless of intervening terrain or distance.

### 2. Standard Concealment (20% Miss Chance)
*   **Miss Chance:** A successful attack roll against a concealed target has a **20% miss chance**. The attacker rolls their attack normally; if they hit, the defender rolls percentile dice ($d\%$) to see if the attack misses due to concealment (1–20 on $d\%$ is a miss).
*   **Hide Checks:** You can use concealment to make a Hide check. Without concealment, you usually need cover to hide. See [use-skill.md](./use-skill.md).

### 3. Total Concealment (50% Miss Chance)
If you have line of effect to a target but lack line of sight (due to absolute darkness, thick fog, or invisibility), the target has **total concealment** from you.
*   **Miss Chance:** Successful attacks directed into a square occupied by an enemy with total concealment have a **50% miss chance**.
*   **No Attacks of Opportunity:** You cannot make attacks of opportunity against an opponent with total concealment, even if you know what square they occupy. See [attacks-of-opportunity.md](./attacks-of-opportunity.md).
*   **Targeting:** You cannot target a creature with total concealment directly (such as with sight-based spells). Instead, you must target the 5-foot square where you think the opponent is located.
    *   *Incorrect Square:* If you attack an unoccupied square, the DM rolls the miss chance in secret and reports that you missed, preventing you from immediately knowing if the target was actually there.

### 4. Non-Stacking of Concealment
Concealment miss chances **do not stack**. If a target has multiple sources of concealment (e.g., they are inside a cloud of fog and are incorporeal), you only apply the highest miss chance (e.g., 50% for total concealment, or 50% for incorporeality).

---

## Special Interactions

### 1. Invisibility
Invisibility grants total concealment (50% miss chance) against sighted creatures.
*   **Locating an Invisible Creature:** Opponents can locate or pinpoint an invisible creature using the following checks:
    *   **Spot Check:** DC = invisible creature's Hide check +20 (+30 if holding still, +40 if inanimate/unliving). Succeeding by 20 or more pinpoints the target's square (though they still have total concealment).
    *   **Listen Check:** Opponents can detect sounds as a free action each round. DC = invisible creature's Move Silently check (or -20 if the invisible creature is running/charging). Succeeding by 20 or more pinpoints the target's square.
    *   **Touch (Feeling Around):** As a standard action, you can feel around in two adjacent 5-foot squares. Make a touch attack roll against the target's Touch AC. If the target is there, the attack must also beat the 50% miss chance. If it hits, you deal no damage but pinpoint their square. See [armor-class.md](./armor-class.md).
*   **Offensive Benefits:** An invisible attacker gains a **+2 bonus** on attack rolls against opponents who cannot see them, and those opponents are denied their Dexterity bonus to AC. See [armor-class.md](./armor-class.md).

### 2. Senses and Feats that Bypass Concealment
*   **Blindsight:** A creature with blindsight interacts with invisible or concealed targets as if they were visible, completely ignoring concealment and total concealment from invisibility, fog, darkness, etc. (Note: Blindsight does not work against ethereal creatures).
*   **Scent / Blindsense:** Can detect the presence and direction of concealed or invisible targets, but the targets still benefit from concealment or total concealment unless pinpointed.
*   **Darkvision / Low-Light Vision:** Completely bypasses concealment caused by darkness or dim light within their respective ranges. See [light-and-darkness.md](./light-and-darkness.md) for light source ranges.
*   **Blind-Fight Feat:** Allows you to re-roll your percentile check for miss chance once when you miss due to concealment (including total concealment). You also do not lose your Dex bonus to AC against invisible attackers in melee.

### 3. Fog and Weather Effects
Thick fog, heavy snow, or torrential rain blocks line of sight. When line of sight is completely blocked by an environmental effect that does not physically block line of effect (like a *fog cloud* spell or natural fog), any creature inside is treated as having total concealment (invisible). See [tactical-movement.md](./tactical-movement.md).

---

## Play Aid: Rolling Miss Chance First
To speed up combat, players can roll their concealment miss chance *before* rolling their attack roll. This prevents the anticlimactic feeling of rolling a natural 20 only to miss on the percentile check. 
*Note: Any abilities that must be declared before an attack roll (e.g., a Paladin's Smite Evil) must still be declared before the miss chance is rolled.*

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 32, 76, 115, and 1372–1373).