# Milestone 112.7 Implementation Plan: Stage 4 DAG Attack Routine, Inappropriately Sized Weapon Effort Ladder, Two-Handed Grip & Double-Weapon Toggles, Multi-Limb / Natural Demotion & Per-Strike Power Attack Handedness

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16)**:
  - **Tier 1 (Core Console Engine):** `TacticalDoctrineComponent.gripMode` and `EquipmentSlotInstance.limbGroupId` (`src/types/components.types.ts`).
  - **Tier 2 (Ruleset Cartridge):**
    - `equipment_physics.ts`: 3-step SRD weapon size vs. wielder size effort ladder (`evaluateWeaponWieldingProfile`), grip mode resolution, double-weapon splitting, and multi-hand weapon profile resolution (`resolveAllEquippedWeaponProfiles`).
    - `combat/attack_resolver.ts`: `buildFullAttackSequence` across $1..N$ manufactured hands + limb-filtered natural weapons, per-strike Power Attack handedness damage calculation (`computeStrikeDoctrineDamageBonus`), and the Stage 4 DAG Attack Routine synthesizer (`resolveActorAttackRoutine`).
    - `dnd35e_ruleset.ts`: Computes `attackRoutine` as **Stage 4 of `evaluateDnD35eEntityDAG`** (consuming Stage 1 `effectiveSize` and Stage 2 `effectiveAbilityModifiers`), and makes `resolveDnD35eMeleeAttack` a thin consumer of `attackerEval.attackRoutine.strikes`.
  - **Tier 3 (System & Campaign Content):** Semantic weapon tags (`double_weapon`, `cannot_two_hand_str`, `exotic_1h_martial_2h`, `weaponSize:<size>`).
- **Baseline Rules + Declarative Overrides (`AGENTS.md` Rule 17):**
  - Weapon exceptions (Rapier `cannot_two_hand_str`, Double Weapons `double_weapon`, Bastard Sword / Dwarven Waraxe `exotic_1h_martial_2h`) are evaluated declaratively via tags rather than hardcoded item ID branches.
- **Universal Actor Symmetry (`AGENTS.md` Rule 18):**
  - Every actor (PC, NPC, monster with mixed Greataxe + Gore, enlarged barbarian, or 6-armed Marilith) computes its attack routine through the exact same Stage 4 DAG pipeline.
- **TypeScript Strictness (`AGENTS.md` Rules 10–14):**
  - Zero `any`, explicit return types on every function, `exactOptionalPropertyTypes: true` compliance, and named constants for all gameplay numbers.

---

## 2. Canonical Single Source of Truth (SSOT) Dispatch Table

| Domain / Capability | Canonical Single Point of Entry | Call Sites & Consumers | Disallowed Anti-Patterns |
| :--- | :--- | :--- | :--- |
| **Actor Attack Routine Resolution (Stage 4 DAG)** | `resolveActorAttackRoutine` (`src/rulesets/dnd35e/combat/attack_resolver.ts`), called inside `evaluateDnD35eEntityDAG` (`dnd35e_ruleset.ts`) | `resolveDnD35eMeleeAttack`, Character Sheet UI, HUD, AoO reach/threat queries | Never recompute handedness, limb filtering, or Power Attack multipliers ad-hoc inside `resolveDnD35eMeleeAttack`. |
| **Weapon Size vs. Wielder Size Effort Math** | `evaluateWeaponWieldingProfile` (`src/rulesets/dnd35e/equipment_physics.ts`) | `resolveEquippedWeaponProfile` & `resolveAllEquippedWeaponProfiles` | Never hardcode `Math.abs(stepDiff) > 1` or allow `< 0` / `> 2` effort indices. |
| **Multi-Hand & Double-Weapon Profile Resolution** | `resolveAllEquippedWeaponProfiles` (`src/rulesets/dnd35e/equipment_physics.ts`) | `evaluateDnD35eEntityDAG` (passing post-Stage-1 `effectiveSize`) | Never read pre-Stage-1 `dndData.sizeCategory` when resolving wielded weapon effort. |
| **Per-Strike Power Attack Scaling** | `computeStrikeDoctrineDamageBonus` (`src/rulesets/dnd35e/combat/attack_resolver.ts`) | `resolveActorAttackRoutine` | Never bake main-hand Power Attack damage into an actor-wide flat bonus shared by light off-hand weapons. |

---

## 3. Step-by-Step Implementation Tasks & Code Snippets

### Step 1: 3-Step Weapon Size vs. Wielder Size Effort Ladder (`src/rulesets/dnd35e/equipment_physics.ts`)
**Goal**: Fix `evaluateWeaponWieldingProfile` to use the exact 3-step effort ladder `['light', 'one_handed', 'two_handed']` ($\text{Index}_{\text{eff}} = \text{Index}_{\text{base}} + \Delta\text{Size} \in [0, 2]$) and scale weapon dice by `weaponSize` while computing size mismatch attack penalties (`-2` per step) against `effectiveWielderSize`.

```ts
const EFFORT_LADDER: ReadonlyArray<'light' | 'one_handed' | 'two_handed'> = [
  'light',
  'one_handed',
  'two_handed'
];
const SIZE_MISMATCH_PENALTY_PER_STEP = 2;

export function evaluateWeaponWieldingProfile(
  weaponSize: CreatureSizeCategory,
  weaponHandedness: 'light' | 'one_handed' | 'two_handed',
  wielderSize: CreatureSizeCategory
): {
  readonly wieldable: boolean;
  readonly effectiveHandedness?: 'light' | 'one_handed' | 'two_handed' | undefined;
  readonly attackPenalty: number;
  readonly reason?: string | undefined;
} {
  const wSizeRank = SIZE_METRICS[weaponSize].rankIndex;
  const cSizeRank = SIZE_METRICS[wielderSize].rankIndex;
  const stepDiff = wSizeRank - cSizeRank;
  const attackPenalty = -Math.abs(stepDiff) * SIZE_MISMATCH_PENALTY_PER_STEP;

  const baseEffortIndex = EFFORT_LADDER.indexOf(weaponHandedness);
  const effectiveIndex = baseEffortIndex + stepDiff;

  if (effectiveIndex < 0 || effectiveIndex >= EFFORT_LADDER.length) {
    return {
      wieldable: false,
      attackPenalty,
      reason:
        effectiveIndex < 0
          ? 'Weapon is too small to be wielded effectively by this creature.'
          : 'Weapon is too large to be wielded by this creature.'
    };
  }

  return {
    wieldable: true,
    effectiveHandedness: EFFORT_LADDER[effectiveIndex]!,
    attackPenalty
  };
}
```

---

### Step 2: Grip Mode Toggle (`one_handed` / `two_handed` / `double_weapon_twf`), Weapon Exceptions & Multi-Hand Resolution (`src/types/components.types.ts`, `src/rulesets/dnd35e/equipment_physics.ts`)
**Goal**: Add `gripMode` to `TacticalDoctrineComponent` and implement `resolveAllEquippedWeaponProfiles(state, entityId, effectiveWielderSizeOverride?)` to resolve $1..N$ held hand slots, two-handed grip upgrades, double-weapon TWF splitting, Rapier (`cannot_two_hand_str`) and Bastard Sword / Dwarven Waraxe (`exotic_1h_martial_2h`) rules, and `occupiedLimbGroupIds`.

- **`src/types/components.types.ts`**:
  ```ts
  export type WeaponGripMode = 'one_handed' | 'two_handed' | 'double_weapon_twf';

  export interface TacticalDoctrineComponent {
    readonly type: ComponentType.TacticalDoctrine;
    readonly powerAttackAmount?: number | undefined;
    readonly combatExpertiseAmount?: number | undefined;
    readonly fightingDefensively?: boolean | undefined;
    readonly totalDefense?: boolean | undefined;
    readonly gripMode?: WeaponGripMode | undefined;
    readonly settings?: Readonly<Record<string, boolean | number | string>> | undefined;
  }
  ```
- **`src/rulesets/dnd35e/equipment_physics.ts`**:
  ```ts
  export interface EquippedWeaponProfile {
    readonly isArmed: boolean;
    readonly wieldable: boolean;
    readonly weaponItemId?: string | undefined;
    readonly weaponName: string;
    readonly weaponSize: CreatureSizeCategory;
    readonly weaponDice: string;
    readonly weaponDamageType: DnD35DamageType;
    readonly critThreatMin: number;
    readonly critMultiplier: number;
    readonly inherentEffort: 'light' | 'one_handed' | 'two_handed';
    readonly effectiveEffort: 'light' | 'one_handed' | 'two_handed';
    readonly handedness: 'light' | 'one_handed' | 'two_handed';
    readonly isDoubleWeapon?: boolean | undefined;
    readonly cannotTwoHandStr?: boolean | undefined;
    readonly attackBonus: number;
    readonly sizeAttackPenalty: number;
    readonly nonproficiencyPenalty: number;
    readonly damageBonus: number;
    readonly bypassTags: ReadonlyArray<string>;
    readonly slotId?: string | undefined;
    readonly limbGroupId?: string | undefined;
  }

  export interface ResolvedActorWeapons {
    readonly primaryWeapon: EquippedWeaponProfile;
    readonly offHandWeapons: ReadonlyArray<EquippedWeaponProfile>;
    readonly occupiedLimbGroupIds: ReadonlyArray<string>;
    readonly gripMode: WeaponGripMode;
  }
  ```
  - **Grip & Free-Hand Rules**:
    1. Inspects all non-suppressed hand/held slots (`held`, `hand`, `main_hand`, `off_hand`).
    2. Counts unoccupied hand slots (`equippedItem === null && !occupiedBySlotId`).
    3. If the primary weapon has `effectiveEffort === 'one_handed'`, `gripMode === 'two_handed'`, and at least 1 free hand exists:
       - Occupies 1 free hand's `limbGroupId` (`occupiedLimbGroupIds.push(freeSlot.limbGroupId)`).
       - Sets `primaryWeapon.handedness = primaryWeapon.cannotTwoHandStr ? 'one_handed' : 'two_handed'`.
    4. If the primary weapon has `effectiveEffort === 'two_handed'`:
       - Occupies 1 additional hand's `limbGroupId`.
       - If `isDoubleWeapon === true` and `gripMode === 'double_weapon_twf'`:
         - `primaryWeapon.handedness = 'one_handed'`.
         - Synthesizes an off-hand `EquippedWeaponProfile` for the secondary head (`handedness: 'light'`, `weaponDice: secondaryDice`, `weaponName: "${name} (Off-Hand End)"`).
    5. Any additional equipped weapon in `heldSlots[1..N-1]` (when not blocked by a 2H weapon on a 2-armed actor) is pushed to `offHandWeapons` and its `limbGroupId` added to `occupiedLimbGroupIds`.
    6. Any equipped shield in a hand slot adds its `limbGroupId` to `occupiedLimbGroupIds`.

---

### Step 3: Multi-Limb & Natural Demotion in `buildFullAttackSequence` + Per-Strike Power Attack (`src/rulesets/dnd35e/combat/attack_resolver.ts`)
**Goal**:
1. Extend `buildFullAttackSequence` to support multiple off-hand weapons (`offHandWeaponIds?: ReadonlyArray<string | undefined>`) for multi-armed creatures ($3+$ hands).
2. Add `computeStrikeDoctrineDamageBonus` and `resolveActorAttackRoutine` in `attack_resolver.ts` so **Stage 4 of the Stat DAG** produces the complete `DnD35ResolvedAttackRoutine`.

```ts
export interface DnD35ResolvedStrikeProfile {
  readonly index: number;
  readonly label: string;
  readonly attackSource: 'manufactured_primary' | 'manufactured_offhand' | 'natural_primary' | 'natural_secondary';
  readonly handedness: AttackRollParams['handedness'];
  readonly isNaturalOrUnarmed: boolean;
  readonly attackBonus: number;
  readonly weaponDice: string;
  readonly weaponDamageType: DnD35DamageType;
  readonly strDamageBonus: number;
  readonly doctrineDamageBonus: number;
  readonly flatDamageBonus: number;
  readonly critThreatMin: number;
  readonly critMultiplier: number;
  readonly bypassTags: ReadonlyArray<string>;
  readonly weaponId?: string | undefined;
  readonly naturalWeaponId?: string | undefined;
}

export interface DnD35ResolvedAttackRoutine {
  readonly isPureNaturalRoutine: boolean;
  readonly gripMode: WeaponGripMode;
  readonly occupiedLimbGroupIds: ReadonlyArray<string>;
  readonly strikes: ReadonlyArray<DnD35ResolvedStrikeProfile>;
}
```
- **Per-Strike Power Attack Scaling (`computeStrikeDoctrineDamageBonus`)**:
  - Reads active dial (`power_attack`) clamped to `[0, totalBab]`.
  - If `strikeHandedness === 'two_handed'`: returns `+2 * clampedDial`.
  - If `strikeHandedness === 'one_handed'` or `strikeHandedness === 'primary_natural_sole'` or `isNaturalOrUnarmed === true`: returns `+1 * clampedDial` (per PHB p. 98, unarmed strikes and natural weapons gain $1:1$ Power Attack damage).
  - If `strikeHandedness === 'light'` or (`strikeHandedness === 'off_hand'` and `!isNaturalOrUnarmed`): returns `0` (light manufactured weapons and off-hand manufactured weapons gain $+0$ Power Attack damage per PHB p. 98!).

---

### Step 4: Wire `attackRoutine` into Stage 4 of `evaluateDnD35eEntityDAG` & Simplify `resolveDnD35eMeleeAttack` (`src/rulesets/dnd35e/dnd35e_ruleset.ts`)
**Goal**:
1. In `evaluateDnD35eEntityDAG`:
   - First run `evaluateDnD35ActorStatDAG` (Stages 1–4) to obtain `dagResult.effectiveSize`, `dagResult.effectiveAbilityModifiers`, `dagResult.attackBonus`, and `dagResult.damageBonus`.
   - Next, call `resolveAllEquippedWeaponProfiles(state, entityId, dagResult.effectiveSize)` using the post-Stage-1 `effectiveSize`!
   - Call `resolveActorAttackRoutine(...)` to build `attackRoutine: DnD35ResolvedAttackRoutine` and return it on `DnD35EntityDAGResult`.
2. In `resolveDnD35eMeleeAttack`:
   - Read `const strikes = isFullAttack ? attackerEval.attackRoutine.strikes : attackerEval.attackRoutine.strikes.slice(0, 1);`.
   - Loop over `strikes` and call `resolveAttackRoll` using each strike's pre-computed `attackBonus`, `weaponDice`, `handedness`, `flatDamageBonus` (passing `strModifier: 0` and `flatDamageBonus: strike.flatDamageBonus` or passing `strModifier: strMod` and `flatDamageBonus: strike.flatDamageBonus - strike.strDamageBonus` so `resolveAttackRoll` computes `computeHandednessStrDamage(strMod, strike.handedness)` identically).

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Campaigns / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `evaluateWeaponWieldingProfile` 3-Step Ladder (`[0..2]`)** | `resolveEquippedWeaponProfile`, `resolveAllEquippedWeaponProfiles`, items with `weaponSize:<size>`. | Effort category shifts, `-2 * steps` size mismatch attack penalties, unwieldability checks. | Tested in `tests/dnd35e_cartridge.test.ts` & `tests/dnd35e_combat_traversal_wiring.test.ts`. |
| **2. `TacticalDoctrineComponent.gripMode` & Weapon Exceptions** | Player stance toggles (`one_handed`, `two_handed`, `double_weapon_twf`). | `resolveAllEquippedWeaponProfiles`, `occupiedLimbGroupIds`, Rapier (`cannot_two_hand_str`), Quarterstaff (`double_weapon`). | `dnd35e-crypt/items.json` & `tag_registry.json` updated with `double_weapon` on `quarterstaff`. |
| **3. Stage 4 DAG `attackRoutine` (`DnD35EntityDAGResult.attackRoutine`)** | `evaluateDnD35eEntityDAG` consuming Stage 1 `effectiveSize` & Stage 2 `effectiveAbilityModifiers`. | `resolveDnD35eMeleeAttack`, `computeDnD35eEffectiveStats`, HUD / Character Sheet previews. | Reacts automatically to *Enlarge Person*, *Polymorph*, *Bull's Strength*, extra limbs, and natural weapon grants. |
| **4. Multi-Limb & Natural Demotion + Per-Strike Power Attack** | `EquipmentComponent.slots` (`limbGroupId`), `attackerData.naturalWeapons`. | `buildFullAttackSequence` (`naturalWeaponLimbs`, `occupiedLimbGroupIds`, `offHandWeapons`) & `computeStrikeDoctrineDamageBonus`. | Prevents Power Attack damage bleed onto light off-hand weapons; demotes unblocked primary natural weapons when armed. |

---

## 5. Verification & Testing Plan

1. **Inappropriately Sized Weapons Test**:
   - Verify Medium creature + Small Dagger ($\text{Index}_{\text{eff}} = -1$) $\to$ `wieldable: false`.
   - Verify Large Ogre + Small Greatsword ($\text{Index}_{\text{eff}} = 2 - 2 = 0$) $\to$ `wieldable: true, effectiveHandedness: 'light', attackPenalty: -4`.
   - Verify Medium Human + Large Longsword ($\text{Index}_{\text{eff}} = 1 + 1 = 2$) $\to$ `wieldable: true, effectiveHandedness: 'two_handed', attackPenalty: -2, weaponDice: '2d6'`.
2. **Grip Mode Toggle, Rapier & Double Weapon Test**:
   - Verify Medium Fighter with Longsword + empty off-hand toggling `gripMode: 'one_handed'` ($1.0\times \text{STR}$, $1:1$ Power Attack) vs. `gripMode: 'two_handed'` ($1.5\times \text{STR}$, $1:2$ Power Attack, occupying 2nd hand's `limbGroupId`).
   - Verify Rapier (`cannot_two_hand_str`) with `gripMode: 'two_handed'` stays $1.0\times \text{STR}$ and $1:1$ Power Attack.
   - Verify Quarterstaff (`double_weapon`) toggling between `gripMode: 'two_handed'` (single $1.5\times \text{STR}$ strike at $+0$ TWF penalty) and `gripMode: 'double_weapon_twf'` (`one_handed` primary + `light` off-hand at TWF penalties).
3. **Limb Occupation, Armed Natural Demotion & Multi-Arm Test**:
   - Verify creature with `2 Claws` (`arm_group_1`, `arm_group_2`) + `1 Primary Bite` (`head`):
     - Unarmed: `2 Claws` at full BAB ($1.0\times \text{STR}$) + `1 Bite` at full BAB ($1.0\times \text{STR}$).
     - Armed with 1H Longsword in `arm_group_1`: `Longsword` at full iteratives ($1.0\times \text{STR}$, $0$ TWF penalty) + `1 free Claw` (`arm_group_2`) demoted to Secondary (`BAB - 5`, $0.5\times \text{STR}$) + `1 Bite` demoted to Secondary (`BAB - 5`, $0.5\times \text{STR}$), while `arm_group_1` Claw is suppressed!
     - Armed with 1H Longsword gripped in **Two Hands** (`gripMode: 'two_handed'`): both `arm_group_1` and `arm_group_2` Claws are suppressed, leaving `Longsword (2H)` ($1.5\times \text{STR}$) + `1 Bite (Secondary)`!
4. **Per-Strike Power Attack & Dynamic Size Change Test**:
   - Verify dual-wielding Longsword (`one_handed`) + Short Sword (`light`) with Power Attack `3`: Longsword gets $+3$ Power Attack damage, Short Sword gets $+0$ Power Attack damage.
   - Verify applying a Stage 1 `size_step: +1` modifier (*Enlarge Person*) automatically updates `attackRoutine` in `evaluateDnD35eEntityDAG`.
