# Milestone 112.6 Research Notes: Combat Sequence & Inventory Wiring, Declarative Doctrine Descriptors, Level-Up Decoupling & Multi-Mode Floor Traversal

---

## 1. Reiteration of Rules & Standards (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Three-Tier Placement Heuristic (`AGENTS.md` Rule 16 & `docs/DND_35E_PYRAMID_ARCHITECTURE.md`):**
   - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/types/`):** Generic movement validation (`processMoveIntent`), spatial terrain traversal capabilities (`traversableBy`), inventory/equipment slot entity management (`inventory.system.ts`), and intent routing.
   - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** Pure D&D 3.5e mathematical laws: full-round attack sequencing (`buildFullAttackSequence`), equipped weapon damage and critical resolution, interactive level-up threshold gating (`canPlayerLevelUpDnD35e`), and generic doctrine trade-off calculation (`evaluateTacticalDoctrineModifiers`).
   - **Tier 3 — System Content (`public/data/rulesets/dnd35e/`):** Declarative JSON definitions: `feats/power_attack.json` and `combat_expertise.json` with `doctrineDescriptor`, and starting equipment packages in `character_builder.ts`.

2. **Baseline Rules + Declarative Overrides & Modifiers (`AGENTS.md` Rule 17):**
   - Combat resolvers must never hardcode `if (doctrine.settings['power_attack'])`. Tactical stances, dial trade-offs, and defense modes must be driven by declarative **`doctrineDescriptor`** schemas embedded in effect bundles or feat definitions.

3. **Universal Actor Symmetry & Single Source of Truth (`AGENTS.md` Rule 18):**
   - Every actor (PC, NPC, monster) resolves attacks through the same weapon-equipped and natural-weapon pipelines.
   - Character level, BAB, HP, and class progression must derive from a single authoritative source (`levelHistory` for leveled actors, `rhdProgression` for monsters) rather than dual-chassis mutation races.

4. **Hierarchical Provenance (`AGENTS.md` Rule 19):**
   - Tactical doctrine modifiers and equipped weapon enhancements must emit strict hierarchical `sourcePath`s (e.g., `"stance:power_attack/damage"`, `"item:main_hand/enhancement"`) into the 4-Stage Topological DAG.

5. **TypeScript Strictness & Code Hygiene (`AGENTS.md` Rules 10–14):**
   - Zero `any`, explicit function returns, no magic literals, `exactOptionalPropertyTypes: true` compliance, and strict JSON serializability.

---

## 2. Canonical Single Points of Entry (SSOT Dispatch Architecture)

To resolve systemic ambiguity and prevent duplicate or competing implementations across the codebase, the following **Single Source of Truth (SSOT)** dispatch contracts are formalized:

| Domain / Action | Single Canonical Point of Entry | Call Sites & Consumers | Disallowed Anti-Patterns |
| :--- | :--- | :--- | :--- |
| **Melee Combat Resolution** | `dnd35eRulesetContract.resolveMeleeAttack` (`src/rulesets/dnd35e/dnd35e_ruleset.ts`) | `src/systems/combat.system.ts` (`processMeleeAttackIntent`) | Never resolve attack rolls or damage directly inside intent handlers or UI layers. |
| **Attack Sequence Generation** | `buildFullAttackSequence` (`src/rulesets/dnd35e/combat/attack_resolver.ts`) | `resolveDnD35eMeleeAttack` in `dnd35e_ruleset.ts` | Never manually concatenate BAB iteratives in combat loops without accounting for off-hands and secondary natural attacks. |
| **Equipped Item Stats Query** | `resolveEquippedWeaponProfile` (`src/rulesets/dnd35e/equipment_physics.ts`) | `resolveDnD35eMeleeAttack` & `computeDnD35eEffectiveStats` | Never fall back to static `dndData.weaponDice` when physical weapons are equipped in `held` slots. |
| **Level Advancement Mutation** | `applyLevelUpToActor` (`src/rulesets/dnd35e/character_builder.ts`) | `renderDnD35eLevelUpModal` commit handler | Never mutate `tracks` or increment `fighter.level` inside `grantDnD35eXp`. `grantDnD35eXp` only records XP. |
| **Level-Up Eligibility Check** | `canPlayerLevelUpDnD35e` (`src/rendering/ui/dnd35e_level_up.ui.ts`) | `hud_alerts.ui.ts` & input controllers | Never check XP thresholds using unverified ad-hoc math; always compare `fighter.xp >= computeXpThresholdForLevel(ecl + 1)`. |
| **Tactical Doctrine Trade-Offs** | `evaluateTacticalDoctrineModifiers` (`src/rulesets/dnd35e/combat/attack_resolver.ts`) | `evaluateDnD35eEntityDAG` | Never hardcode string keys (`power_attack`, `combat_expertise`) in engine files; evaluate descriptors declaratively. |
| **Tile Traversal Validation** | `canTraverseTile` (`src/systems/movement.system.ts`) | `processMoveIntent` | Never check `tileDef.walkable` in isolation without checking active multi-mode capabilities (`fly`, `swim`). |

---

## 3. Detailed Technical Analysis per Milestone 112.6 Task

### 3.1 Task 1: Full-Round Attack Routine & Equipped Weapon Resolution

#### Problem Statement
Currently, `resolveDnD35eMeleeAttack()` in `dnd35e_ruleset.ts` executes exactly one attack roll using static fallback values on `DnD35EntityData` (`attackerData.weaponDice: '1d8'`, hardcoded `'one_handed'` handedness).
- It ignores `buildFullAttackSequence()` implemented in Milestone 103.
- It ignores the actual weapon item entities equipped in `EquipmentComponent.slots`. If a player equips a Greatsword (`2d6`, `19-20/x2`, two-handed), Dagger (`1d4`, light, finesse), or a monster has claws/bite, `resolveDnD35eMeleeAttack` never reads their damage dice or threat specs.

#### Technical Solution
1. **Helper `resolveEquippedWeaponProfile(state, entityId, slotId)`**:
   - Inspects the entity's `EquipmentComponent.slots` matching `slotId` (or primary `held_1` / `main_hand_1`).
   - If an item entity is equipped, resolves its `ItemComponent.itemId` against `state.campaign.items` and system content definitions.
   - Extracts:
     - `weaponDice`: e.g. `'2d6'`, `'1d8'`, `'1d4'` (scaled by wielder size if non-Medium via `scaleWeaponDamageDice`).
     - `critThreatMin`: e.g. 19 for Longsword, 18 for Rapier, 20 default.
     - `critMultiplier`: e.g. 2 for Longsword, 3 for Battleaxe, 4 for Heavy Pick.
     - `damageType`: `'slashing'`, `'piercing'`, `'bludgeoning'`.
     - `handedness`: `'light'`, `'one_handed'`, `'two_handed'`.
     - `bypassTags`: `['magic']` (if enhancement $> 0$), `['silver']`, `['cold_iron']`, `['adamantine']` from material physics.
   - If no weapon is equipped in the hand:
     - Check for primary natural weapons on `attackerData.naturalWeapons` (e.g. Bite, Claw, Slam).
     - Otherwise, treat as Unarmed Strike (`1d3` nonlethal for Medium, or Monk unarmed dice progression).
2. **Integrating `buildFullAttackSequence` in `resolveDnD35eMeleeAttack`**:
   - Query attacker's action context or action budget:
     - If performing a **Full Attack** (or standard bump when the actor has not moved and has iterative attacks or off-hand/natural attacks):
       - Call `buildFullAttackSequence({ bab, primaryWeaponId, offHandWeaponIds, naturalWeapons, overrides })`.
       - Iterate sequentially through each entry in the sequence:
         - Resolve individual attack roll via `resolveAttackRoll`.
         - Generate corresponding `DamageComponent` instances.
         - Format multi-attack combat log messages (`"Main Hand 1st: hits for 8... Main Hand 2nd: misses... Bite: hits for 5..."`).
     - If performing a **Standard Attack** (after movement $> 5\text{ ft}$):
       - Resolve single primary attack at highest attack bonus.

---

### 3.2 Task 2: Character Creation Starting Equipment Physical Materialization

#### Problem Statement
`commitCharacterCreation()` in `src/rulesets/dnd35e/character_builder.ts` assigns flat numbers (`weaponDice = '1d8'`, `armorBonus = 4`, `shieldBonus = 2`) to `DnD35EntityData`. However:
- Zero item entities are spawned in `state.entities`.
- The player's `InventoryComponent.itemIds` is empty.
- The player's `EquipmentComponent.slots` has all `equippedItem: null`.
- The player opens the inventory or paper doll and sees nothing equipped.

#### Technical Solution
1. In `character_builder.ts`, expand `EQUIPMENT_PACKAGES` to specify concrete item IDs:
   ```ts
   export interface StartingEquipmentPackage {
     readonly id: string;
     readonly name: string;
     readonly items: ReadonlyArray<{
       readonly itemId: string;
       readonly equipSlot?: 'main_hand' | 'off_hand' | 'torso' | 'body' | 'head';
       readonly quantity?: number;
     }>;
   }
   ```
2. In `commitCharacterCreation(state, playerId, draft)`:
   - Read the chosen `StartingEquipmentPackage`.
   - For each item entry:
     - Instantiate the item entity in `GameState` via `createEntity(state)` with `ItemComponent` and `RenderableComponent` populated from `state.campaign.items[itemId]`.
     - Append the new item entity ID to the player's `InventoryComponent.itemIds`.
     - If `equipSlot` is defined, find the corresponding slot in the player's `EquipmentComponent.slots` (e.g., `main_hand_1`, `torso_1`) and set `slot.equippedItem = newItemId`.
3. Re-evaluate `getEquippedItemBonuses` so the 4-Stage Topological DAG immediately projects the equipped armor and weapon stats.

---

### 3.3 Task 3: Decoupled Interactive Level-Up Progression

#### Problem Statement
`grantDnD35eXp()` in `src/rulesets/dnd35e/dnd35e_ruleset.ts` contains legacy auto-leveling logic:
```ts
if (newXp >= nextThreshold) {
  const primaryTrack = dndData.tracks[0];
  const nextTracks = primaryTrack ? [{ ...primaryTrack, levels: nextLevel }, ...] : ...;
  // Automatically increments level and rolls HP!
}
```
This causes a critical desync:
- The player's level is automatically incremented in the background without recording a `DnD35CharacterLevelRecord` in `levelHistory`.
- `canPlayerLevelUpDnD35e()` checks `chassis.ecl + 1` which is now offset by an extra level.
- Interactive level choices (class selection, skill allocation, 4th-HD ability increases, bonus feats) are skipped or applied redundantly.

#### Technical Solution
1. **Refactor `grantDnD35eXp`**:
   - `grantDnD35eXp` strictly updates `fighter.xp = newXp`.
   - It performs **no** mutations on `dndData.tracks`, `fighter.level`, or `fighter.maxHp`.
   - If `newXp >= nextThreshold`, log a message: `"[D&D 3.5e] Level Up Available! Press [L] or click the ribbon to advance your character."`
2. **`canPlayerLevelUpDnD35e(state, playerId)`**:
   - Queries current `ecl` from `levelHistory.length` or `aggregateProgressionChassis(dndData.tracks).ecl`.
   - Checks `fighter.xp >= computeXpThresholdForLevel(ecl + 1)`.
   - Returns `true` if and only if unspent XP qualifies the actor for their next character level.
3. **`applyLevelUpToActor(state, playerId, choice)`**:
   - Remains the **exclusive** mutation authority for level advancement.
   - Appends the new level to `levelHistory`.
   - Calls `rebuildActorStateFromLevelHistory()` to deterministically synchronize `dndData.tracks`, ability scores, base saves, BAB, skill ranks, feats, and spell slots.
   - Updates `fighter.level = newEcl`, `fighter.attack = newBab`, and `fighter.maxHp = newMaxHp`.

---

### 3.4 Task 4: Declarative Doctrine Descriptors

#### Problem Statement
In `src/rulesets/dnd35e/combat/attack_resolver.ts`, `evaluateTacticalDoctrineModifiers()` hardcodes specific strings:
```ts
const paVal = Number(doctrine.settings['power_attack'] ?? 0);
const ceVal = Number(doctrine.settings['combat_expertise'] ?? 0);
const fDef = doctrine.settings['fighting_defensively'] === true;
```
This violates **AGENTS.md Rule 17** (Baseline Rules + Declarative Overrides & Modifiers).

#### Technical Solution
1. **Schema Extension (`dnd35e_system.types.ts`)**:
   Define `DnD35DoctrineDescriptorSchema`:
   ```ts
   export const DnD35DoctrineDescriptorSchema = z.object({
     key: z.string(),
     label: z.string(),
     type: z.enum(['toggle', 'variable_dial']),
     min: z.number().default(0),
     maxFormula: z.enum(['bab', 'min_5_bab', 'constant_1']).default('bab'),
     tradeOff: z.object({
       penalty: z.object({
         targetStat: z.enum(['attack', 'ac']),
         scaling: z.number().default(1.0)
       }),
       benefit: z.object({
         targetStat: z.enum(['damage', 'ac']),
         bonusType: z.enum(['untyped', 'dodge']).default('untyped'),
         scaling: z.number().default(1.0),
         scalingByHandedness: z.record(z.string(), z.number()).optional()
       })
     }).optional(),
     dodgeAcBonus: z.number().optional(),
     attackPenalty: z.number().optional(),
     forbidsAttacking: z.boolean().optional()
   });
   ```
2. **Author in System Content**:
   - Add `doctrineDescriptor` to `public/data/rulesets/dnd35e/feats/power_attack.json` and `combat_expertise.json`.
3. **Generic Evaluator (`attack_resolver.ts`)**:
   - `evaluateTacticalDoctrineModifiers` takes a list of `DnD35DoctrineDescriptor`s (resolved from the actor's active feats/stances).
   - Iterates over active settings, evaluating dial bounds via `maxFormula` (e.g. `bab` for Power Attack, `Math.min(5, bab)` for Combat Expertise).
   - Scales benefits according to weapon handedness (e.g. `scalingByHandedness: { light: 0, one_handed: 1, two_handed: 2 }`).
   - Emits pure `attackPenalty`, `damageBonus`, `dodgeAcBonus`, and `canAttack` outputs with zero feat-name hardcoding.

---

### 3.5 Task 5: Lightweight Multi-Mode Traversal

#### Problem Statement
`src/systems/movement.system.ts` (`processMoveIntent`) verifies tile walkability using a single binary flag:
```ts
const tileDef = state.campaign.tiles[targetTile.tileId];
if (tileDef === undefined || !tileDef.walkable) { ... return blocked; }
```
Creatures with `movementModes.fly > 0` (such as Dragons, Elementals, Wild Shaped Druids) or `movementModes.swim > 0` cannot fly over chasms or swim through water tiles.

#### Technical Solution
1. **Tile Capability Classification (`src/types/campaign/world.ts`)**:
   - `TileDefinitionSchema` already supports `tags?: string[]`.
   - Add standard terrain tags: `'chasm'`, `'pit'`, `'liquid'`, `'water'`.
2. **Actor Traversal Query in `processMoveIntent`**:
   - If `tileDef.walkable === false`:
     - Inspect the moving entity's active `movementModes` (resolving from `ActorComponent.movementModes`, `DnD35EntityData.movementModes`, or active overlays).
     - If the tile is tagged `'chasm'` or `'pit'` and `movementModes.fly !== undefined && movementModes.fly > 0`:
       - Allow movement! Log: `"[Fly] Soars gracefully across the chasm."`
     - If the tile is tagged `'water'` or `'liquid'` and `movementModes.swim !== undefined && movementModes.swim > 0`:
       - Allow movement!
     - If the tile is solid wall/obstacle without bypass traversal, block as normal.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Data Authors) | Downstream (Consumers / Renderers / Validators / Saves) | Lateral (Sibling Campaigns / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. Full Attack Sequence & Equipped Weapon Integration (`resolveDnD35eMeleeAttack`)** | `processMeleeAttackIntent` in `src/systems/combat.system.ts`. | `DamageComponent` consumer (`damage.system.ts`), combat log presenter, health vitals. | `tests/dnd35e_cartridge.test.ts`, `tests/dnd35e_phase21_primitives.test.ts`. Eliminates hardcoded `1d8` weapon damage. |
| **2. Starting Equipment Physical Materialization (`commitCharacterCreation`)** | `renderDnD35eCharBuilderModal` commit button in `dnd35e_char_builder.ui.ts`. | `InventoryComponent.itemIds`, `EquipmentComponent.slots`, paper doll UI, save serializer. | `public/data/campaigns/dnd35e-crypt/items.json` items referenced by starting equipment packages. |
| **3. Level-Up Decoupling (`grantDnD35eXp` & `applyLevelUpToActor`)** | `grantActorXp` calls across monster kills and quest rewards (`death.system.ts`). | `hud_alerts.ui.ts` level-up ribbon, `dnd35e_level_up.ui.ts`, `levelHistory` ledger. | Prevents ghost auto-leveling and preserves exact chronological multiclass audit trail. |
| **4. Declarative `doctrineDescriptor` Schema & Evaluator** | `public/data/rulesets/dnd35e/feats/power_attack.json` & `combat_expertise.json`. | `evaluateTacticalDoctrineModifiers` in `attack_resolver.ts`, `evaluateDnD35eEntityDAG` in `modifiers.ts`. | `dnd35e_validator.ts` validates `doctrineDescriptor` syntax on feat definitions. |
| **5. Multi-Mode Tile Traversal (`processMoveIntent`)** | `MoveIntent` emitters (keyboard, AI system, pathfinder). | Map collision checks, FOV updates, spatial indexing. | Compatible with all rulesets (`classic` and `dnd35e`) by falling back to `walkable` when `movementModes` is undefined. |

---

## 5. Verification & Test Strategy

1. **Equipped Weapon & Full Attack Tests:**
   - Test that an actor wielding a Greatsword deals `2d6 + 1.5x STR` damage.
   - Test that an actor wielding a Dagger deals `1d4 + 1.0x STR` damage.
   - Test that a high-BAB actor (+6/+1) or dual-wielding actor executes all attacks in `buildFullAttackSequence` on a full attack.
2. **Starting Equipment Materialization Tests:**
   - Test that committing character creation with the Fighter package creates physical item entities in `InventoryComponent` and equips the weapon and armor in `EquipmentComponent.slots`.
3. **Level-Up Decoupling Tests:**
   - Test that granting XP over the threshold does NOT change `fighter.level` or `dndData.tracks`.
   - Test that `canPlayerLevelUpDnD35e()` returns `true` and invoking `applyLevelUpToActor()` increments level and appends to `levelHistory`.
4. **Declarative Doctrine Tests:**
   - Test that Power Attack and Combat Expertise evaluate their trade-offs purely via declarative `doctrineDescriptor` data.
5. **Multi-Mode Movement Tests:**
   - Test that a flying actor (`movementModes: { land: 30, fly: 60 }`) can move onto a chasm tile, while a non-flying actor is blocked.
6. **Regression Invariant:**
   - Ensure all 98 existing tests pass with 0 regressions.
