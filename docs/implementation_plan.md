# Milestone 112.6 Implementation Plan: Combat Sequence & Inventory Wiring, Declarative Doctrine Descriptors, Level-Up Decoupling & Multi-Mode Floor Traversal

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

- **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16):**
  - **Tier 1 (Core Console Engine):** Movement traversal validation (`canTraverseTile` in `src/systems/movement.system.ts`), inventory/equipment item entity creation, and intent plumbing.
  - **Tier 2 (Ruleset Cartridge):** D&D 3.5e attack sequence execution (`buildFullAttackSequence`), equipped weapon profile resolution (`resolveEquippedWeaponProfile`), level-up decoupling (`grantDnD35eXp`), and generic doctrine trade-off math (`evaluateTacticalDoctrineModifiers`).
  - **Tier 3 (System Content):** Declarative `doctrineDescriptor` schemas in `feats/power_attack.json` and `feats/combat_expertise.json`.
- **Baseline Rules + Declarative Overrides (`AGENTS.md` Rule 17):**
  - Zero hardcoded `if (doctrine.settings['power_attack'])` branches. Doctrine trade-offs are parameterized by declarative `variableDial` and `tradeOff` configurations.
- **Universal Actor Symmetry (`AGENTS.md` Rule 18):**
  - Both players and monsters wield weapons through the same `EquipmentSlotInstance[]` structure and execute full attacks via `buildFullAttackSequence`.
- **Hierarchical Provenance (`AGENTS.md` Rule 19):**
  - Equipped weapon bonuses and tactical doctrine trade-offs emit strict `sourcePath`s (e.g. `"item:main_hand/weapon"`, `"stance:doctrine/attack_penalty"`).
- **TypeScript Strictness (`AGENTS.md` Rules 10–14):**
  - Zero `any`, explicit return types on every function, no magic numbers/strings, and exhaustive checks.

---

## 2. Canonical Single Source of Truth (SSOT) Dispatch Table

| Domain / Capability | Canonical Single Point of Entry | Call Sites & Consumers | Disallowed Anti-Patterns |
| :--- | :--- | :--- | :--- |
| **Melee Combat Resolution** | `dnd35eRulesetContract.resolveMeleeAttack` (`src/rulesets/dnd35e/dnd35e_ruleset.ts`) | `src/systems/combat.system.ts` (`processMeleeAttackIntent`) | Never resolve attack rolls or damage directly in UI or intent handlers. |
| **Attack Sequencing** | `buildFullAttackSequence` (`src/rulesets/dnd35e/combat/attack_resolver.ts`) | `resolveDnD35eMeleeAttack` in `dnd35e_ruleset.ts` | Never manually iterate BAB sequences without off-hand and natural attack sequencing. |
| **Equipped Weapon Profile** | `resolveEquippedWeaponProfile` (`src/rulesets/dnd35e/equipment_physics.ts`) | `resolveDnD35eMeleeAttack` & `computeDnD35eEffectiveStats` | Never fall back to static `dndData.weaponDice` when weapons are equipped in `held` slots. |
| **Level Advancement Authority** | `applyLevelUpToActor` (`src/rulesets/dnd35e/character_builder.ts`) | `renderDnD35eLevelUpModal` commit handler | Never mutate `tracks` or increment `fighter.level` inside `grantDnD35eXp`. |
| **Level-Up Eligibility Check** | `canPlayerLevelUpDnD35e` (`src/rendering/ui/dnd35e_level_up.ui.ts`) | `hud_alerts.ui.ts` & keybindings | Never compare XP against unverified ad-hoc thresholds. |
| **Tactical Doctrine Trade-Offs** | `evaluateTacticalDoctrineModifiers` (`src/rulesets/dnd35e/combat/attack_resolver.ts`) | `evaluateDnD35eEntityDAG` in `dnd35e_ruleset.ts` | Never hardcode feat names as string keys in engine calculation loops. |
| **Tile Traversal Validation** | `canTraverseTile` (`src/systems/movement.system.ts`) | `processMoveIntent` | Never check `tileDef.walkable` in isolation without checking multi-mode movement (`fly`, `swim`). |

---

## 3. Step-by-Step Implementation Tasks

### Step 1: Equipped Weapon Profile Resolver (`equipment_physics.ts`)
**Goal**: Create a canonical helper that inspects an actor's equipped `held` hand slots and derives complete weapon stats (dice, threat range, crit multiplier, damage type, handedness, bypass tags, and material properties).

- **Location**: `src/rulesets/dnd35e/equipment_physics.ts`
- **Specification**:
  ```ts
  export interface EquippedWeaponProfile {
    readonly isArmed: boolean;
    readonly weaponItemId?: string | undefined;
    readonly weaponName: string;
    readonly weaponDice: string;
    readonly weaponDamageType: DnD35DamageType;
    readonly critThreatMin: number;
    readonly critMultiplier: number;
    readonly handedness: 'light' | 'one_handed' | 'two_handed';
    readonly attackBonus: number;
    readonly damageBonus: number;
    readonly bypassTags: ReadonlyArray<string>;
  }

  export function resolveEquippedWeaponProfile(
    state: GameState,
    entityId: EntityId,
    slotType: 'main_hand' | 'off_hand' = 'main_hand'
  ): EquippedWeaponProfile
  ```
- **Logic**:
  1. Inspects `EquipmentComponent.slots` on `entityId`.
  2. Finds slot matching `slotType` (e.g. `main_hand_1` or `held` with `arm_group_1`).
  3. If equipped with an item entity, resolves `ItemComponent.itemId` against `state.campaign.items`.
  4. Pulls `weaponDice`, `critThreatMin`, `critMultiplier`, `attackBonus` from the item or defaults based on category.
  5. Applies material physics if crafted from Special Materials (Mithral/Adamantine/Silver/Cold Iron).
  6. Scales weapon damage dice by wielder size using `scaleWeaponDamageDice`.
  7. If unequipped, falls back to `attackerData.weaponDice` / natural weapons / unarmed strike (`1d3` nonlethal).

---

### Step 2: Full-Round Attack Sequence Execution (`dnd35e_ruleset.ts`)
**Goal**: Wire `buildFullAttackSequence` and `resolveEquippedWeaponProfile` into `resolveDnD35eMeleeAttack`.

- **Location**: `src/rulesets/dnd35e/dnd35e_ruleset.ts`
- **Logic**:
  1. In `resolveDnD35eMeleeAttack(state, intent)`:
     - Check if the attacker is eligible to perform a **Full Attack**:
       - In accordance with D&D 3.5e rules (PHB p. 144), an actor may take a Full Attack if they have **not moved this round** (`distanceMovedThisRoundFt === 0`), **OR** if their only movement was a single **5-foot step** (`distanceMovedThisRoundFt <= 5` with no actual Move action spent).
       - If the actor has moved $> 5\text{ ft}$ (2+ squares), they are restricted to a **Standard Attack** (a single primary attack).
     - Resolve primary weapon profile via `resolveEquippedWeaponProfile(state, attackerId, 'main_hand')`.
     - Resolve off-hand weapon profile (if equipped) via `resolveEquippedWeaponProfile(state, attackerId, 'off_hand')`.
     - Call `buildFullAttackSequence({ totalBab: rawChassis.totalBab, baseAttackModifier: attackerEval.dagResult.attackBonus, ... })`.
     - If executing a Full Attack:
       - Iterate sequentially through each strike in the sequence (iteratives, extra off-hand weapon strikes, and unblocked secondary natural attacks).
       - For each strike, execute `resolveAttackRoll` using that strike's specific weapon dice, handedness, threat range, and attack bonus.
       - If hit, push a `DamageComponent` instance with matching damage type and bypass tags.
       - Format itemized combat log message:
         `"[d20: X + Y = Z vs AC A] Main Hand (Iterative 1): Deals 8 slashing damage!"`
     - If executing a Standard Attack:
       - Execute only the first primary attack strike at the highest BAB.
  2. If the defender drops to $\le 0\text{ HP}$ mid-sequence, cease remaining attacks and evaluate Cleave via `resolveCleaveFollowupEligibility`.

---

### Step 3: Starting Equipment Physical Materialization (`character_builder.ts`)
**Goal**: When completing Character Creation, instantiate actual item entities in `InventoryComponent` and equip weapons and armor in `EquipmentComponent.slots`.

- **Location**: `src/rulesets/dnd35e/character_builder.ts`
- **Logic**:
  1. Update `StartingEquipmentPackage` in `character_builder.ts`:
     ```ts
     export interface StartingEquipmentPackage {
       readonly id: string;
       readonly name: string;
       readonly description: string;
       readonly items: ReadonlyArray<{
         readonly itemId: string;
         readonly equipSlot?: 'main_hand_1' | 'off_hand_1' | 'torso_1' | 'body_1';
       }>;
       readonly weaponDice: string;
       readonly weaponDamageType: 'slashing' | 'piercing' | 'bludgeoning';
       readonly armorBonus: number;
       readonly shieldBonus: number;
     }
     ```
  2. Map starter kits to campaign items (e.g. `short_sword`, `leather_armor`, `backpack`, `health_potion`).
  3. In `applyCharacterCreationToPlayer`:
     - For each item in `equipPkg.items`:
       - If `state.campaign.items[item.itemId]` exists:
         - Create entity with `ItemComponent` and `RenderableComponent`.
         - Append entity ID to player's `InventoryComponent.items`.
         - If `item.equipSlot` is specified, find matching slot in player's `EquipmentComponent.slots` and set `slot.equippedItem = newItemId`.
  4. Ensure paper doll and inventory immediately reflect starting gear upon entering the dungeon.

---

### Step 4: Level-Up Decoupling (`dnd35e_ruleset.ts` & `dnd35e_level_up.ui.ts`)
**Goal**: Decouple XP acquisition from automatic level mutations, ensuring `applyLevelUpToActor` is the exclusive authority for level advancement.

- **Location**: `src/rulesets/dnd35e/dnd35e_ruleset.ts`, `src/rendering/ui/dnd35e_level_up.ui.ts`
- **Logic**:
  1. In `grantDnD35eXp(state, entityId, amount)`:
     - Compute multiclass XP penalty multiplier and calculate `newXp = fighter.xp + adjustedAmount`.
     - **Remove** all code mutating `dndData.tracks`, `fighter.level`, and `fighter.maxHp`.
     - Check if `newXp >= computeXpThresholdForLevel(fighter.level + 1)`:
       - If so, log: `"[D&D 3.5e] Level Up Available! Press [L] or click the ribbon to advance your character."`
     - Return `addComponent(state, entityId, { ...fighter, xp: newXp })`.
  2. In `canPlayerLevelUpDnD35e(state, playerId)`:
     - Query `chassis = aggregateProgressionChassis(dndData.tracks, 0, dndData.levelAdjustment ?? 0)`.
     - Compare `fighter.xp >= computeXpThresholdForLevel(chassis.ecl + 1)`.
  3. In `applyLevelUpToActor(state, entityId, choice)`:
     - Validates eligibility, appends `DnD35CharacterLevelRecord` to `levelHistory`, calls `rebuildActorStateFromLevelHistory()`, and updates `fighter.level`, `fighter.attack`, and `fighter.maxHp`.

---

### Step 5: Declarative Doctrine Descriptors (`dnd35e_system.types.ts`, `feats/*.json`, `attack_resolver.ts`)
**Goal**: Make tactical doctrine trade-offs fully data-driven.

- **Location**:
  - `src/rulesets/dnd35e/types/dnd35e_system.types.ts`: Define `DnD35DoctrineDescriptorSchema`.
  - `public/data/rulesets/dnd35e/feats/power_attack.json` & `combat_expertise.json`: Embed `doctrineDescriptor`.
  - `src/rulesets/dnd35e/combat/attack_resolver.ts`: Refactor `evaluateTacticalDoctrineModifiers`.
- **Logic**:
  1. `DnD35DoctrineDescriptor` specifies dial parameters (`min`, `maxFormula: 'bab' | 'min_5_bab'`, `tradeOff: { penalty, benefit }`).
  2. `evaluateTacticalDoctrineModifiers` accepts `ReadonlyArray<DnD35DoctrineDescriptor>` (or resolves from entity active effect bundles).
  3. Evaluates dial bounds dynamically:
     - If `maxFormula === 'bab'`, cap is `bab`.
     - If `maxFormula === 'min_5_bab'`, cap is `Math.min(5, bab)`.
  4. Applies benefit scaling based on handedness (e.g. Power Attack 1:0 light, 1:1 one-handed, 1:2 two-handed).
  5. Completely removes hardcoded `'power_attack'` and `'combat_expertise'` strings from Cartridge math.

---

### Step 6: Lightweight Multi-Mode Traversal (`world.ts`, `movement.system.ts`)
**Goal**: Allow actors with `fly` or `swim` capabilities to traverse chasms and liquid without a full 3D Z-axis overhaul.

- **Location**: `src/types/campaign/world.ts`, `src/systems/movement.system.ts`
- **Logic**:
  1. Add optional `traversableBy?: ReadonlyArray<'fly' | 'swim' | 'burrow' | 'climb'>` to `TileDefinitionSchema` (or inspect `tags: ['chasm', 'liquid']`).
  2. In `src/systems/movement.system.ts`, extract helper:
     ```ts
     export function canTraverseTile(
       tileDef: TileDefinition,
       movementModes?: MovementModes
     ): boolean
     ```
  3. If `tileDef.walkable === false`:
     - If tile is tagged `'chasm'` or `'pit'` (or has `traversableBy: ['fly']`) and `movementModes?.fly !== undefined && movementModes.fly > 0`: return `true`.
     - If tile is tagged `'water'` or `'liquid'` (or has `traversableBy: ['swim']`) and `movementModes?.swim !== undefined && movementModes.swim > 0`: return `true`.
     - Otherwise, return `false`.
  4. In `processMoveIntent`:
     - Resolve entity `movementModes` (from `ActorComponent`, `DnD35EntityData`, or overlays).
     - Check `canTraverseTile(tileDef, movementModes)`. If permitted, allow move!

---

## 4. Testing Strategy per Step

1. **Step 1 & 2 Tests (`tests/dnd35e_cartridge.test.ts` or `tests/dnd35e_combat_sequence.test.ts`)**:
   - Verify `resolveEquippedWeaponProfile` returns `2d6` slashing for Greatsword, `1d4` piercing for Dagger, and `1d3` nonlethal for bare hands.
   - Verify `resolveDnD35eMeleeAttack` executes 2 attacks for a BAB +6 character on full attack.
2. **Step 3 Tests (`tests/dnd35e_classes_builder.test.ts`)**:
   - Verify `applyCharacterCreationToPlayer` spawns item entities in `InventoryComponent` and equips weapon/armor into `EquipmentComponent.slots`.
3. **Step 4 Tests (`tests/dnd35e_classes_builder.test.ts`)**:
   - Verify `grantDnD35eXp` does not change `dndData.tracks` or `fighter.level`.
   - Verify `canPlayerLevelUpDnD35e` returns `true` when XP reaches threshold, and `applyLevelUpToActor` advances level and appends to `levelHistory`.
4. **Step 5 Tests (`tests/dnd35e_phase21_primitives.test.ts`)**:
   - Verify declarative `doctrineDescriptor` correctly scales Power Attack damage across light (0), one-handed (1x), and two-handed (2x).
5. **Step 6 Tests (`tests/movement_traversal.test.ts`)**:
   - Verify a flying creature can move onto a chasm tile, while a non-flying creature bumps.
6. **Full Suite Regression**:
   - Run `npm test` to ensure all 98 existing tests pass with 0 regressions.

---

## 5. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Campaigns / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Equipped Weapon Profile & Full Attack Sequence** | `combat.system.ts` (`processMeleeAttackIntent`). | `DamageComponent` consumers, combat log UI, health vitals. | Replaces static `weaponDice` fallback; tested in `tests/dnd35e_cartridge.test.ts`. |
| **2. Starting Equipment Physical Materialization** | `dnd35e_char_builder.ui.ts` commit handler. | `InventoryComponent.items`, `EquipmentComponent.slots`, paper doll view, save manager. | Populates physical items in `dnd35e-crypt` save files. |
| **3. Level-Up Decoupling** | `death.system.ts` (`grantXp`), quest rewards. | `hud_alerts.ui.ts` level-up alert ribbon, `dnd35e_level_up.ui.ts`. | Eliminates ghost level-ups; preserves 100% fidelity in `levelHistory`. |
| **4. Declarative Doctrine Descriptors** | `feats/power_attack.json`, `combat_expertise.json`. | `evaluateTacticalDoctrineModifiers`, `evaluateDnD35eEntityDAG`. | Validated by `dnd35e_validator.ts` schema tests. |
| **5. Multi-Mode Tile Traversal** | `MoveIntent` from keyboard, AI, and pathfinding. | Collision detection in `movement.system.ts`. | Universal across all campaigns (`classic` and `dnd35e`). |

---

## 6. Resolved Considerations

1. **Full Attack Trigger in Roguelike Turn Loop & 5-Foot Step Invariant**:
   - In accordance with D&D 3.5e rules (PHB p. 144: *"Take 5-Foot Step"* / *"Full Attack"*), taking a 5-foot step (`distanceMovedThisRoundFt <= 5` without spending an action) does **not** count as movement for preventing a full attack.
   - Therefore, if `distanceMovedThisRoundFt <= 5`, bumping executes a **Full-Round Attack** (consuming the actor's Standard and Move allocations and delivering all iteratives, off-hand strikes, and secondary natural attacks).
   - If `distanceMovedThisRoundFt > 5` (moved 2 or more squares), the actor has expended movement and bumping resolves as a **Standard Attack** (a single strike).
2. **Starting Equipment Item Definitions**:
   - `dnd35e-crypt/items.json` currently contains `short_sword`, `leather_armor`, `backpack`, and potions. For packages needing weapons like `longsword` or `heavy_wooden_shield`, we can define them in `dnd35e-crypt/items.json` or fallback cleanly until Phase 24 Milestone 115 introduces the full SRD item registry.

---

## 7. Documentation Updates Plan

Upon successful implementation:
- Update `docs/ARCHITECTURE.md` with §9.7 detailing the SSOT Combat and Movement dispatch architecture.
- Update `docs/DECISIONS.md` recording Decision 17 (Decoupled Interactive Level-Up Progression & Declarative Doctrine Descriptors).
- Mark Milestone 112.6 checklist items complete in `docs/MILESTONES.md`.
