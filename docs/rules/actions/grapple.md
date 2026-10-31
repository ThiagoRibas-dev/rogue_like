---
title: Grapple
parent: Combat II (Movement, Modifiers, Special Actions)
grand_parent: Rules
---

# Grapple
## Category
Special Attack / Combat Action

## Summary
Grappling represents hand-to-hand wrestling. While grappling, your ability to attack others, move, and defend yourself is severely limited.

## Mechanics

### 1. Grapple Modifier
A grapple check is a melee attack roll modified by your grapple modifier:
$$\text{Grapple Modifier} = \text{Base Attack Bonus} + \text{Strength Modifier} + \text{Special Size Modifier} + \text{Other Modifiers}$$

#### Special Size Modifier Table
| Size | Modifier | Size | Modifier |
| :--- | :--- | :--- | :--- |
| **Colossal** | +16 | **Small** | -4 |
| **Gargantuan** | +12 | **Tiny** | -8 |
| **Huge** | +8 | **Diminutive** | -12 |
| **Large** | +4 | **Fine** | -16 |
| **Medium** | +0 | | |

*Note: This size modifier is used in place of your normal size modifier for attack rolls. For detailed creature size statistics, space, and reach, see [creature-size.md](./creature-size.md).**

### 2. Initiating a Grapple
Starting a grapple is an attack. If you have multiple attacks from a high Base Attack Bonus, you can attempt to start a grapple multiple times as part of a full attack.
*   **Step 1: Attack of Opportunity:** You provoke an attack of opportunity from the target you are trying to grapple. If this attack deals damage, your grapple attempt automatically fails.
    *   *Exceptions:* Creatures with the Improved Grapple feat or the Improved Grab ability do not provoke.
*   **Step 2: Grab:** Make a melee touch attack to grab the target. If you miss, the grapple attempt fails.
*   **Step 3: Hold:** Make an opposed grapple check as a free action.
    *   If you succeed, you and the target are now grappling, and you immediately deal damage to the target as if with an unarmed strike.
    *   If you lose, the grapple fails. You automatically lose if the target is two or more size categories larger than you.
    *   *Ties:* The combatant with the higher grapple modifier wins. If modifiers are identical, roll again to break the tie.
*   **Step 4: Maintain:** To maintain the grapple in later rounds, you must move into the target's space. This movement is free, does not count against your speed, and provokes attacks of opportunity from other threatening creatures (but not your target). If you cannot move into the target's space, the grapple ends immediately.

### 3. General Consequences of Grappling
While you are engaged in a grapple:
*   **No Threatened Squares:** You do not threaten any squares. You cannot make attacks of opportunity.
*   **AC Penalties:** You lose your Dexterity bonus to AC against all opponents you are *not* grappling. You retain your Dexterity bonus to AC against the opponent(s) you are grappling.
*   **No Movement:** You cannot move normally; you must use the *Move* maneuver (see below) to move the grapple.

### 4. Permitted maneuvers while Grappling
When you are grappling (regardless of who started it), you can perform the following maneuvers. If you have a high Base Attack Bonus, you can make a grapple check or attack for each extra attack allowed by your BAB (e.g., 2 checks at BAB +6, 3 at BAB +11, 4 at BAB +16) during a full-round action.
*   **Activate a Magic Item:** You can activate a magic item that is not a spell completion item (scroll). No grapple check is required.
    *   *Wands vs. Staffs:* Wands (light items) can be activated. Staffs (two-handed items) cannot be activated in a grapple. See [magic-items-general.md](./magic-items-general.md).
*   **Attack Your Opponent:** You can attack with an unarmed strike, natural weapon, or light weapon against a creature you are grappling at a **-4 penalty**. You cannot attack with two weapons.
    *   *Natural Weapons Limit:* A creature can attack with only one of its natural weapons per turn while grappling (usually its primary one), unless a special ability or description says otherwise.
*   **Cast a Spell:** You can cast a spell with a casting time of 1 standard action or less, provided it has no somatic component, you have the components in hand, and you succeed on a **Concentration check (DC 20 + spell level)**. See [cast-a-spell.md](./cast-a-spell.md).
*   **Damage Your Opponent:** Make an opposed grapple check in place of an attack. If you win, you deal nonlethal damage equivalent to your unarmed strike. To deal lethal damage, you take a **-4 penalty** on your check. (Monks deal lethal damage normally and can choose to make it nonlethal without penalty).
*   **Draw a Light Weapon:** Make a successful grapple check to draw a light weapon as a move action. See [draw-or-sheathe-a-weapon.md](./draw-or-sheathe-a-weapon.md).
*   **Escape from Grapple:** You can escape by winning an opposed grapple check in place of an attack. Alternatively, you can make an Escape Artist check as a standard action.
    *   *Multiple Opponents:* To escape, your result must beat all opponents' individual check results.
    *   *Resolution:* If you escape, you move into any unoccupied space adjacent to the grapple.
*   **Move:** Make an opposed grapple check as a standard action. If you win (beating all opponents' checks), you can move up to half your speed, bringing all other grapplers with you. You get a +4 bonus on this check if your opponent is pinned and no one else is involved.
*   **Pin Your Opponent:** Win an opposed grapple check in place of an attack to pin an opponent for 1 round.
*   **Break Another's Pin:** Win an opposed grapple check in place of an attack to break an opponent's pin on an ally. The ally remains in the grapple but is no longer pinned.
*   **Retrieve a Spell Component:** Retrieve a component from your pouch as a full-round action (no grapple check required).
*   **Use Opponent's Weapon:** Win an opposed grapple check in place of an attack to attack your opponent with their own light weapon at a **-4 penalty**. This does not grant you possession of the weapon.

### 5. If You're Pinning an Opponent
A pinned opponent is at your mercy, but your actions are restricted:
*   You can only attempt to damage your opponent, use your opponent's weapon, or move the grapple.
*   You can prevent a pinned opponent from speaking (at your option).
*   You can attempt to disarm a secured object worn by the pinned opponent (they get a +4 bonus to resist). See [disarm.md](./disarm.md).
*   You can release the pin as a free action (ending the grapple for both of you), finishing in an unoccupied adjacent space.
*   **Restrictions:** You cannot draw or use a weapon, escape another's grapple, retrieve a spell component, pin another creature, or break another's pin.

### 6. If You're Pinned by an Opponent
A pinned character is held stationary (but not helpless) for 1 round.
*   **No Actions:** You cannot take any actions the pinning creature does not allow, including speaking.
*   **AC Penalty:** You take a -4 penalty to AC against opponents other than the one pinning you.
*   **Dexterity to 0:** You cannot move, so your Dexterity is considered to be 0 for the purpose of determining AC (a **-5 modifier**). You are subject to sneak attacks and other attacks relying on you being denied your Dex bonus to AC.
*   **Escape:** On your turn, you can attempt to escape the pin by winning an opposed grapple check in place of an attack, or by making an Escape Artist check as a standard action. If you succeed, you are still grappling but no longer pinned.

### 7. Attacking Grapplers
*   **Melee Attacks:** Characters outside the grapple can attack grapplers normally. Grapplers take normal AC penalties (loss of Dex bonus to AC against outside attackers).
*   **Ranged Attacks:** If you make a ranged attack against a grappler, you must roll randomly to see which grappler in the struggle your attack strikes.

### 8. Multiple Grapplers
*   Up to four combatants can grapple a single opponent at once.
*   *Size scaling:* Small or smaller creatures count as 0.5, Large count as 2, Huge or larger count as 4.
*   When grappling multiple opponents, you choose one opponent to make opposed checks against (except when attempting to Escape or Move, which require beating all opponents).

## Source
Open Game Content, Open Game License v1.0a. (Derived from the *Rules Compendium*, pages 60–61, and *Player's Handbook*, pages 155–157).