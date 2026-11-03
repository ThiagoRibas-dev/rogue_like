# Armor Class
## Category
Combat Statistics

## Summary
Your Armor Class (AC) represents how hard it is for opponents to land a solid, damaging blow on you. It is the target number that an opponent must meet or exceed with an attack roll to hit you.

## Mechanics

### 1. Armor Class Formula
Your Armor Class is calculated as follows:
$$\text{AC} = 10 + \text{Size Modifier} + \text{Dexterity Modifier} + \text{Armor Bonus} + \text{Shield Bonus} + \text{Deflection Bonus} + \text{Insight Bonus} + \text{Natural Armor Bonus} + \text{Dodge Bonuses} + \text{Other Modifiers}$$

*   **Size Modifier:** Smaller creatures are harder to hit and gain a size bonus to AC; larger creatures are easier to hit and take a size penalty. See [big-and-little-creatures-in-combat.md](./big-and-little-creatures-in-combat.md).
*   **Dexterity Modifier:** Represents your agility and ability to dodge. Armor limits your maximum Dexterity bonus to AC (as shown in the armor's statistics). If you are denied your Dexterity bonus to AC, you lose any positive Dex modifier (but still apply any negative modifier).
*   **Armor & Shield Bonuses:** Provided by your equipped armor and shield, representing physical protection.
*   **Enhancement Bonuses:** Enhancement bonuses stack directly with the armor, shield, or natural armor bonus to which they are applied (e.g., $+1\ \textit{chainmail}$ provides a $+6$ armor bonus instead of $+5$).
*   **Deflection Bonus:** Created by magical effects (like a *protection from evil* spell or *ring of protection*) that ward off attacks.
*   **Insight Bonus:** Created by uncanny foresight or martial premonition (e.g., foresight spells or class features).
*   **Natural Armor Bonus:** Represents thick skin, scales, hide, or magical hardening.
*   **Dodge Bonuses:** Represent active evasion.
    *   *Denial:* Any situation that denies you your Dexterity bonus to AC also denies you all dodge bonuses.
    *   *Stacking:* Dodge bonuses stack with all other dodge bonuses (unlike other bonus types).
    *   *Armor:* Wearing armor does not limit your dodge bonuses.

### 2. Bonus Stacking Rules
*   **Different Types:** Bonuses of different types (e.g., a deflection bonus and an armor bonus) always stack.
*   **Same Types:** Bonuses of the same type do not stack. Only the highest bonus applies (e.g., two rings of protection providing deflection bonuses do not stack).
    *   *Exceptions:* Dodge bonuses and some circumstance bonuses stack with each other.
*   **Untyped Bonuses:** Untyped bonuses stack with all other bonuses, including other untyped bonuses, unless they come from the same source or effect.

---

## Alternative Armor Classes

### 1. Touch AC
Used against attacks that bypass physical armor, shields, and natural armor (such as ray spells, touch spells, and alchemist's fire).
$$\text{Touch AC} = \text{AC} - \text{Armor Bonus} - \text{Shield Bonus} - \text{Natural Armor Bonus}$$
*   *Retained Modifiers:* Size modifier, Dexterity modifier, deflection bonus, dodge bonuses, and insight bonuses all apply to Touch AC. Force effects (like *bracers of armor* or a *shield* spell) do not apply to Touch AC against standard touch attacks.

### 2. Incorporeal Touch AC
Used against attacks made by incorporeal creatures (like ghosts, wraiths, or shadows).
*   **Ignored Modifiers:** Incorporeal attacks ignore armor, shields, and natural armor (including their enhancement bonuses).
*   **Retained Modifiers:** Deflection bonuses, size modifier, Dexterity modifier, dodge bonuses, and insight bonuses apply normally.
*   **Force Effects:** Unlike normal touch attacks, **force effects** (such as *bracers of armor*, *mage armor*, or the *shield* spell) apply normally to Incorporeal Touch AC.
*   **Ghost Touch:** Armor and shields with the *ghost touch* property function normally against incorporeal touch attacks.

### 3. Flat-Footed AC
Used when you are caught off-guard or unable to react to an attack (such as at the start of combat before you have acted, or when attacked by an unseen opponent).
$$\text{Flat-Footed AC} = \text{AC} - \text{Dexterity Bonus} - \text{Dodge Bonuses}$$
*   *Retained Modifiers:* Size modifier, armor bonus, shield bonus, natural armor bonus, deflection bonus, and insight bonuses apply normally. Any Dexterity penalties (negative Dex modifier) still apply. See [surprise.md](./surprise.md).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, page 15 & 232, and *Player's Handbook*, page 134).