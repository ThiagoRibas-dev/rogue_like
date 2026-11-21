# Implementation Plan — M150–M156 Corrective Remediation

> **Status:** Phase 1, Steps 4–5 — Enhanced corrective implementation plan; awaiting explicit approval.
> **Audited baseline:** commit `c83c3830d812c746e88fb850812462be57fd1a66` against its parent.
> **Research source:** `docs/research_notes.md` contains the verified evidence, stable remediation IDs, provenance design, and audit baseline.
> **Execution strategy:** Execute the six corrective phases sequentially. Complete every task and regression test in a phase, run the full eight-stage verification pipeline, and restore a clean verification baseline before beginning the next phase.
> **Current authorization:** Planning artifacts only. No production source, test, data, asset, or documentation implementation is authorized until this plan is explicitly approved.

---

## 0. Scope, Order, and Completion Criteria

### Six-phase scope

| Phase                                             | Goal                                                                                                                     | Remediation IDs |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------- |
| **1 — Verification Gates**                        | Restore typecheck, format, tests, build, validator, and diff hygiene                                                     | P1.1–P1.4       |
| **2 — Engine Invariants & Provenance**            | Repair pit/displacement/time/field semantics and introduce complete causal chains                                        | P2.1–P2.8       |
| **3 — Action Economy, Items, Objects, Traversal** | Correct Charge, coating/weapon identity, consumables, hazards, structural objects/doors, rigging, and spellbook behavior | P3.1–P3.16      |
| **4 — Production Integrations**                   | Wire disguise, sound/light, corpse, religion, and lore into live paths                                                   | P4.1–P4.9       |
| **5 — Declarative/Data/SSOT Parity**              | Restore partial overrides, campaign dependencies, Rule 21 compliance, showcase content, docs, and assets                 | P5.1–P5.11      |
| **6 — Integration Proof & Closure**               | Replace helper-only confidence with real-path tests, complete verification, and final cascading audit                    | P6.1–P6.9       |

### Rules for every implementation task

1. Use the existing canonical utility or schema owner before creating anything new.
2. Keep each code change small enough to understand, test, and review independently.
3. Do not branch on Tier 3 content IDs or infer generic behavior from bespoke properties.
4. Do not use `any`, untyped magic gameplay values, `Math.random`, `Date.now`, or non-serializable ECS state.
5. Preserve actor symmetry and backward compatibility for existing campaign/save data unless a migration is explicitly documented.
6. Update the upstream/downstream/lateral matrix when implementation reveals additional impact.
7. Run focused tests during development and the complete `./verify.sh` pipeline at the phase boundary.
8. Do not commit or push unless the user separately requests and approves the exact commit.

### Phase completion criteria

A phase is complete only when:

- Its focused regression tests pass.
- `bun x tsc --noEmit` passes.
- Formatting, lint, architecture, and dead-code checks pass.
- The full `bun test` suite passes.
- `bun run build` passes.
- `bun run scripts/run-validator.ts` passes.
- `bun scripts/map-codebase.ts --check` passes when SSOT ownership changes.
- `git diff --check` passes.
- The phase's cascading-effects rows and test evidence are updated.

---

## 1. SSOT Ownership & Old-Brain Eviction Table

| Responsibility                                               | Canonical owner after remediation                                                                                    | Old brain replaced or constrained                                                     | Tier             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------- |
| Runtime interaction-chain types and append/query helpers     | `src/types/interaction_provenance.types.ts`, `src/systems/interaction_provenance.system.ts`                          | Ad-hoc `sourceEntityId`, item/spell IDs, and mutable “current source” assumptions     | Tier 1 Console   |
| Causal chain on emitted events                               | `src/types/events.types.ts` (`BaseGameEvent`) and event producers                                                    | Events with no causal ancestry                                                        | Tier 1 Console   |
| Causal chain on delayed/persisted outcomes                   | `DamageInstance`, `DeathComponent`, `ActiveStatusEffect`, `FieldComponent`, projectile/in-flight state as applicable | Delayed effects losing their origin after the initiating action                       | Tier 1 Console   |
| Static modifier/grant provenance                             | Existing `StatModifier.sourcePath` and effect-bundle index                                                           | Runtime chain being mistaken for modifier provenance                                  | Tier 2 Cartridge |
| Equipped weapon instance identity                            | `weapon_profile_parser.ts` (`EquippedWeaponProfile.itemEntityId`, slot/limb identity) and `attack_routine.ts`        | Content-only `weaponId` used to locate a coating                                      | Tier 2 Cartridge |
| Displacement result and footprint commit                     | `src/systems/movement_displacement.ts`                                                                               | Anchor-delta-only `moved`; discarded precomputed placement                            | Tier 1 Console   |
| Context-aware tile traversal                                 | `evaluateTileTraversal` and all context-aware callers                                                                | Caller-side traversal that omits state/coordinates and misses crossings               | Tier 1 Console   |
| Pit-entry fall consequence                                   | Terrain traversal resolver, invoked once on a confirmed hazard entry                                                 | Duplicate explicit fall call plus recurring turn-start fall                           | Tier 2 Cartridge |
| Jaunt validation and commit                                  | Immediate-reaction resolver using the displacement kernel                                                            | Squeezed validation versus expanded execution; skipped occupancy; ignored move result | Tier 2 Cartridge |
| Normal and bulk elapsed-time semantics                       | Domain-owned elapsed resolvers orchestrated by `world_time_skip.ts`                                                  | Bulk duration subtraction that skips breath, light, crossings, AI, and status stages  | Tier 1 Console   |
| Secondary status timing                                      | `status-effect.system.ts` shared elapsed resolver                                                                    | Bulk-only duration decrement without elapsed/secondary state                          | Tier 1 Console   |
| Field transmutation commit                                   | `field.system.ts` interaction transaction                                                                            | Incoming field plus separately transmuted duplicate field                             | Tier 1 Console   |
| Charge validation, movement, condition, and strike selection | `charge_resolver.ts` plus `dnd35e_combat_adapter.ts`                                                                 | Distance inferred after strike selection; condition applied only on success           | Tier 2 Cartridge |
| Coating application and per-strike consumption               | Generic coating descriptor/resolver with D&D effect data; `combat_exchange_pipeline.ts`                              | First-coated-item search and item-ID heuristics                                       | Tier 1 + Tier 2  |
| Consumable charge/item depletion                             | Canonical inventory consumption helper                                                                               | Scattered manual charge/removal implementations                                       | Tier 1 Console   |
| Hazard deployment                                            | Generic deployment descriptor plus authored field definition                                                         | Runtime field-registry injection and reusable source item                             | Tier 1 + Tier 3  |
| Floor-hazard movement behavior                               | `floor_hazard_resolver.ts` using movement context                                                                    | Context-free caltrops/marbles logic                                                   | Tier 2 Cartridge |
| Structural data hydration                                    | Generic entity/item schema plus ECS spawn/promotion paths                                                            | Tests manually attaching `StructuralComponent`                                        | Tier 1 + Tier 3  |
| Structural durability math                                   | `object_durability_resolver.ts`                                                                                      | Unreachable resolver and base-vs-enhanced HP maxima                                   | Tier 2 Cartridge |
| Door presentation/passability                                | Existing reaction/consequence engine, invoked by structural door resolver                                            | Component-only open/break state bypassing tag/glyph/intent/FOV transition             | Tier 1 Console   |
| Crossing installation recipes                                | Tier 3 recipe descriptor plus crossing system                                                                        | Rope-or-anchor shortcut and missing ladder content                                    | Tier 1 + Tier 3  |
| Spellbook study time                                         | Canonical bulk/world-time advancement                                                                                | Direct `globalTurn += hours`                                                          | Tier 2 Cartridge |
| Disguise perception and faction relation                     | `utils/faction.ts` with explicit mask precedence                                                                     | Mutating both observer and target allegiances; unconditional Attitude early return    | Tier 1 Console   |
| Sound perception and sleeping awareness                      | `sound.system.ts` using canonical sleeping awareness                                                                 | Alerted-but-asleep actors and disconnected producers                                  | Tier 1 Console   |
| Camp illumination                                            | `light_emitter.system.ts` active-emitter query                                                                       | Tag-only light-source check                                                           | Tier 1 Console   |
| Corpse creation and harvest                                  | `corpse.system.ts`, semantic type projection, declarative yield recipes                                              | Test-only marking with no yield/tool effect                                           | Tier 1 + Tier 3  |
| Religion ledger and altar integration                        | `religion.system.ts` plus authored altar/reaction data                                                               | Test-only helpers and implicit Pelor default                                          | Tier 1 + Tier 3  |
| Automatic monster lore persistence                           | `monster_lore_tracker.ts` invoked from sight/inspect integration                                                     | Test-only persistence helper                                                          | Tier 2 Cartridge |
| Rest-pressure shape                                          | Separate full config and partial override schemas                                                                    | Zod defaults erasing campaign values before inheritance                               | Tier 1 + Tier 3  |
| Campaign/system consumable dependency validation             | Loader/validator reference pass                                                                                      | Validator accepting an item whose effect/status is absent                             | Tier 1 tooling   |
| Default feature showcase                                     | `public/data/campaigns/default/` plus smoke scenarios                                                                | Unused schemas and non-functional default content                                     | Tier 3           |

---

## 2. Declarative Purity & Anti-Hardcoding Audit Table

| Behavior                           | Rejected imperative shortcut                           | Chosen declarative mechanism                                                                | New Content Mod litmus |
| ---------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------- |
| Inventory climbing/rigging gear    | `itemId === 'climbers_kit'` or `'ladder_10ft'`         | Semantic tags `climbing_kit`, `ladder`, `supple_rope` on authored items                     | **Pass**               |
| Charge movement capability         | Hardcoded condition-ID `Set`                           | Generic condition `ruleOverrides`/tags such as `blocks_charge`                              | **Pass**               |
| Charge speed                       | Land-speed-only calculation                            | Movement mode selected from the actual traversal path                                       | **Pass**               |
| Charge attack reach                | Size/natural-reach-only calculation                    | Scheduled strike's authored `reachFt` and `strikesAdjacent`                                 | **Pass**               |
| Coating eligibility                | “Any item with `ItemComponent` is a weapon”            | Generic `weapon`/`ammunition` capability tags or item category profile                      | **Pass**               |
| Coating damage/status/targets      | Item-ID substring and `alignment:evil` fallback        | Authored coating descriptor, target predicates, status/effect references                    | **Pass**               |
| Hazard deployment                  | TypeScript-created field registry entries              | Item deployment descriptor referencing an authored field definition                         | **Pass**               |
| Caltrops/marbles behavior          | Context-free fixed checks                              | Movement-mode/speed context plus authored hazard parameters                                 | **Pass**               |
| Structural hardness/HP             | Per-item TypeScript branches                           | Authored material/object profile and typed effect data                                      | **Pass**               |
| Door open/close/break presentation | Hardcoded tile IDs, glyphs, or tag arrays              | Existing declarative reaction consequences                                                  | **Pass**               |
| Crossing installation              | Rope-or-anchor shortcut                                | Tier 3 recipe with required capabilities, anchor/range rules, and consumed/installed source | **Pass**               |
| Antitoxin resistance               | `hasResistanceStatus ? 5 : 0`                          | Status-authored save modifier with typed bonus and effect tags                              | **Pass**               |
| Wand Spell Trigger                 | Hardcoded class-track ID array                         | Wand `spellId` plus spell `levelByClass`/domain/access capability metadata                  | **Pass**               |
| Religion patron                    | Default missing patron to `pelor`                      | Explicit actor/altar/deity data; no implicit patron                                         | **Pass**               |
| Rest area override                 | Fully defaulted partial object                         | Separate partial override schema over a complete resolved config                            | **Pass**               |
| Corpse harvest yield               | Hardcoded tag-to-item switch                           | Declarative harvest recipe mapping tags to item/tool requirements                           | **Pass**               |
| Corporeal eligibility              | Raw tag-only check                                     | Canonical semantic type/subtype projection or Ruleset hook                                  | **Pass**               |
| Interaction provenance             | Global mutable source or content-specific frame unions | Generic append-only `InteractionChain` frames and queries                                   | **Pass**               |
| Modifier provenance                | Runtime chain reused as `sourcePath`                   | Keep static `sourcePath` and runtime chain as separate contracts                            | **Pass**               |

---

## 3. Cascading Effects Matrix — Corrective Implementation Tasks

| Task                                           | Upstream                                                              | Downstream                                                                   | Lateral                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| P1.1 semantic gear tags                        | Pit climb/rigging verbs and item registries                           | Typecheck/build, skill bonuses, crossing creation                            | Item fixtures, M154 tests, docs                                      |
| P1.2 hammer tag                                | Door spike intent and tag registries                                  | Spike success, item consumption                                              | Default/crypt registries, M156 test                                  |
| P1.3 formatting/EOF                            | Formatter and diff checks                                             | CI acceptance                                                                | Documentation mirrors                                                |
| P1.4 prompt-kit mirrors                        | Default campaign sources                                              | Validator Stage 8                                                            | AI prompt kit and generated artifacts                                |
| P2.1 pit entry                                 | Jump, forced displacement, crossing collapse                          | Damage/death/prone/events                                                    | Pit fixtures and M152/M154 tests                                     |
| P2.2 displacement commit                       | Walk, swap, Bull Rush, Charge, Jaunt, AI pathing                      | Footprint, spatial index, FOV, movement hooks, steps                         | Movement SSOT and tests                                              |
| P2.3 context-aware traversal                   | All tile/bridge callers                                               | Pathing, Charge, Jaunt, swap                                                 | Crossing fixtures                                                    |
| P2.4 Jaunt transaction                         | Target selection and pool budget                                      | Occupancy, resources, success/reaction state                                 | Squeezing and reaction tests                                         |
| P2.5 elapsed local time                        | Turn start, rest, wait, spellbook study                               | Breath, light fuel, crossings, AI, hunger, death                             | Sync/async paths and saves                                           |
| P2.6 status elapsed time                       | Normal and bulk status processing                                     | Secondary saves/damage, expiry, logs                                         | Poison/antitoxin fixtures                                            |
| P2.7 field transmutation                       | Field spawn, spell impact, deployment                                 | Field count/damage/FOV/provenance                                            | Field rules and oil/fire fixtures                                    |
| P2.8 interaction provenance                    | Intents, strikes, items, coatings, spells, reactions, statuses/fields | Damage/death/events/triggers/ledger/saves                                    | `sourcePath`, event fixtures, ECS/SSOT/docs                          |
| P3.1, P3.2, P3.3, P3.4 Charge                  | Hotbar/AI/Apply, budget, displacement, attack routine                 | Attack count, AC, Pounce, moved distance, reactions                          | Charge condition and M152 tests                                      |
| P3.5/P3.6 coating identity                     | Weapon profiles, strike construction, dip                             | Correct coating consumption, damage/status chain, source depletion           | Classic coating path and item fixtures                               |
| P3.7/P3.8 deployment/floor hazards             | Apply, movement mode/speed, Charge                                    | Fields, Balance/attack/limp/halt, inventory                                  | Hazard descriptors and M154 tests                                    |
| P3.9, P3.10, P3.11 objects/doors               | Spawn, hydration, attack/wear, open/break/repair                      | HP/ruined, tags/glyph/intents, FOV/passability                               | Door/item JSON, default showcase, durability tests                   |
| P3.12 rigging                                  | Use Rope/ladder intents, inventory, recipes                           | Crossing entities, gear consumption, pathing                                 | Ladder item and crossing recipes                                     |
| P3.13 study time                               | Transcribe action/UI                                                  | Rest/wait simulation and interruption                                        | World-clock docs/tests                                               |
| P3.14–P3.16/P5.4 coating and spellbook content | Item descriptors, dip/deploy, spellbook drops/transcription           | Target/effect resolution, field definitions, learned spells/drop eligibility | Poison/oil/holy-water/caltrops content, caster fixtures, mod fixture |
| P4.1/P4.8 disguise                             | Mask application, observation, faction queries                        | Hostility, ally relations, suspicion, dialogue                               | Shipped bandit/faction data and M156 tests                           |
| P4.2, P4.3, P4.4 sound/light                   | Movement/combat/thunderstone, ignite/refuel, camp                     | AI alert/sleep/wake, verb UI, light grid, rest                               | Sound/light items and stealth/rest tests                             |
| P4.5/P4.6 corpse                               | Death, semantic type, harvest                                         | Corpse, yield, inventory, decay, necromancy                                  | Subtype data, recipes, default content                               |
| P4.7 religion                                  | Shrine/altar/dialogue/reaction intents                                | Favor/penance/atonement and actor state                                      | Deity/altar JSON and showcase                                        |
| P4.9 lore                                      | Sight/inspect and Knowledge resolver                                  | Memory persistence and inspection projection                                 | Existing on-demand lore and tests                                    |
| P5.1/P5.2 schemas/references                   | Loader/Zod and runtime resolution                                     | Consumables/statuses/rest config                                             | All campaigns, generator kit, validator                              |
| P5.3/P5.5–P5.7 declarative providers           | Status/class/condition/religion content                               | Stacking, UMD, Charge, religion                                              | Rule registries and Rule 21 audit                                    |
| P5.8–P5.11 showcase/docs/assets                | New systems and shared sprite packs                                   | Default playability, rendering, SSOT truth                                   | Default/crypt content, sprite references, milestones                 |
| P6 integration/closure                         | Every public path                                                     | Regression/build/validator/manual evidence                                   | All mirrors, docs, saves, final matrix audit                         |

## 4. Detailed Corrective Implementation Plan

---

## Phase 1 — Restore Verification Gates

### Step 1.1 — Correct the semantic inventory-gear helper calls (P1.1)

**Files:** `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts`, relevant M154 fixtures.

- Keep the existing tag-only helper `actorInventoryHasItemTag`; do not recreate the undefined ID-aware helper.
- Replace the three invalid calls with semantic capability tags already authored on content:
  - `climbers_kit` → `climbing_kit`
  - `ladder_10ft` → `ladder`
  - `silk_rope` → `supple_rope`
- Do not special-case item IDs. The authored ladder item is added with the complete rigging recipe in Phase 3.

```ts
const hasClimbersKit = actorInventoryHasItemTag(state, entityId, 'climbing_kit');
const hasLadder = actorInventoryHasItemTag(state, entityId, 'ladder');
const hasSilkRope = actorInventoryHasItemTag(state, entityId, 'supple_rope');
```

**Focused proof:**

- Typecheck and build succeed.
- M154 pit-climb test passes with the authored climber's kit.
- A new modded climbing tool carrying `climbing_kit` works without TypeScript changes.

### Step 1.2 — Canonicalize the hammer capability tag (P1.2)

**Files:** `src/systems/durability.system.ts`, item/tag registry fixtures.

- Change `HAMMER_TOOL_ITEM_TAG` from `hammer` to the authored `hammer_tool`.
- Remove the duplicate `'hammer'` fallback.
- Keep the behavior tag-based so a new hammer item with `hammer_tool` works unchanged.

**Focused proof:** the existing M156 spike-door test succeeds; a no-hammer actor still receives the authored failure message.

### Step 1.3 — Restore formatting and whitespace hygiene (P1.3)

**Files:** the three Prettier failures plus the two EOF-only documentation files.

- Run Prettier on only:
  - `src/rulesets/dnd35e/combat/floor_hazard_resolver.ts`
  - `src/rulesets/dnd35e/skills/dungeon_skill_verbs.ts`
  - `src/systems/durability.system.ts`
- Remove only the extra EOF blank lines from:
  - `docs/ARCHITECTURE.md`
  - `docs/ROGUELIKE_RPG_SYSTEMS_REPORT.md`
- Do not run whole-repository auto-formatting.

### Step 1.4 — Regenerate and review AI prompt-kit mirrors (P1.4)

**Files:** `ai-prompt-kit/default-campaign/{rules,areas,effects,status}.json`.

- Run the canonical generator:

```bash
bun scripts/generate-ai-prompt-kit.ts
```

- Review the generated diff to confirm it mirrors the current default campaign and introduces no schema drift.
- Re-run `bun run scripts/run-validator.ts`.

### Phase 1 gate

```bash
bun x tsc --noEmit
bun run format:check
bun run lint:check
bun run lint:arch
bun run lint:deadcode
bun test
bun run build
bun run scripts/run-validator.ts
git diff --check
```

Expected result: all checks pass before Phase 2 begins.

---

## Phase 2 — Repair Engine Invariants and Establish Causal Propagation

### Step 2.1 — Add the canonical interaction-chain contract (P2.8)

**New files:** `src/types/interaction_provenance.types.ts`, `src/systems/interaction_provenance.system.ts`.

**Modified contract files:** `src/types/events.types.ts`, `src/types/components/{actor,world,item}_components.types.ts`, `src/types/ruleset.types.ts`.

Use a generic Tier 1 contract; Tier 2 may supply semantic frame values but must not define the chain's shape.

```ts
export interface InteractionChain {
  readonly originatorEntityId: EntityId;
  readonly frames: ReadonlyArray<InteractionFrame>;
}

export type InteractionFrame =
  | {
      readonly kind: 'intent';
      readonly intentType: IntentType;
      readonly actorId: EntityId;
      readonly targetId?: EntityId | undefined;
    }
  | { readonly kind: 'action'; readonly actionId: string; readonly actorId: EntityId }
  | {
      readonly kind: 'strike';
      readonly attackerId: EntityId;
      readonly defenderId: EntityId;
      readonly strikeIndex: number;
      readonly attackSource: string;
    }
  | {
      readonly kind: 'item';
      readonly itemEntityId: EntityId;
      readonly itemId: string;
      readonly role: 'weapon' | 'tool' | 'consumable' | 'deployed_source';
      readonly slotId?: string | undefined;
    }
  | {
      readonly kind: 'effect';
      readonly effectId: string;
      readonly effectKind: 'coating' | 'rider' | 'spell' | 'status' | 'reaction' | 'field_interaction';
      readonly sourcePath?: string | undefined;
    }
  | { readonly kind: 'field'; readonly fieldEntityId: EntityId; readonly fieldType: string }
  | {
      readonly kind: 'trigger';
      readonly triggerId: string;
      readonly triggeringEntityId?: EntityId | undefined;
    };
```

Canonical helpers:

```ts
export function createInteractionChain(originatorEntityId: EntityId): InteractionChain;
export function appendInteractionFrame(chain: InteractionChain, frame: InteractionFrame): InteractionChain;
export function findLastInteractionFrame<K extends InteractionFrame['kind']>(
  chain: InteractionChain,
  kind: K
): Extract<InteractionFrame, { kind: K }> | undefined;
export function resolveInteractionOriginator(chain: InteractionChain): EntityId;
```

Add `interaction?: InteractionChain | undefined` to `BaseGameEvent` and to persisted outcome types that can outlive their initiating action:

- `DamageInstance`
- `DeathComponent`
- `ActiveStatusEffect`
- `FieldComponent`
- projectile/in-flight state where a delayed impact must retain its origin

The optional fields exist only for legacy save/event compatibility. New actor-driven causal effects must receive a chain explicitly; they must not fall back to an invented source.

Add a generic before-frame interception point to `RulesetContract`:

```ts
beforeInteractionFrame?(
  state: GameState,
  chain: InteractionChain,
  frame: InteractionFrame
): { readonly state: GameState; readonly prevented: boolean; readonly reason?: string | undefined };
```

After-effect behavior continues through existing domain events, now carrying the complete chain. The hook may modify state or veto the frame; it cannot mutate the immutable chain.

**Migration order:**

1. Add types/helpers with no behavior change.
2. Add weapon instance identity to strike profiles.
3. Construct root intent/action chains at Apply/combat entry points.
4. Append strike/item/effect frames through combat and item resolvers.
5. Persist chains on damage, death, status, field, and projectile state.
6. Make reactions/trigger consumers read the chain rather than reconstruct source from unrelated IDs.
7. Add a generic Ruleset frame hook and after-event assertions.
8. Remove redundant source reconstruction once all producers use the chain.

**Required invariant:** there is no mutable global “current attacker/source.” Each resolver receives and returns immutable context.

### Step 2.2 — Commit every valid footprint placement and report it accurately (P2.2)

**Files:** `src/systems/movement_displacement.ts`, `src/systems/movement.system.ts`, `src/types/ruleset.types.ts` if result types are shared.

Extend `DisplacementResult` so callers can distinguish anchor travel from a valid in-place placement:

```ts
export interface DisplacementResult {
  readonly state: GameState;
  readonly moved: boolean;
  readonly anchorMoved: boolean;
  readonly stepsMoved: number;
  readonly finalPos: { readonly x: number; readonly y: number };
  readonly stopReason: DisplacementStopReason;
  readonly collidedTileId?: string | undefined;
  readonly collidedEntityId?: EntityId | undefined;
  readonly events: ReadonlyArray<GameEvent>;
}
```

- `moved` means a valid spatial/footprint change was committed.
- `anchorMoved` means the anchor coordinate changed.
- A rotation, squeeze change, or facing change at the same anchor is a successful move.
- Apply a supplied `precomputedPlacement` before the teleport/non-adjacent branch, rather than discarding it.
- Compare the committed placement with the previous footprint (width, height, facing, squeezing), not only `x/y`.
- Vector displacement must count a committed same-anchor placement as one completed step and continue to the next bounded step.
- Preserve full `PositionComponent` fields and update `spatialIndex`/`fovNeedsUpdate` exactly once per committed placement.

**Focused proof:** reproduce the 2×1 east-facing Large actor rotating to 1×2 at the same anchor; movement succeeds, the footprint changes, and vector displacement continues.

### Step 2.3 — Use one context-aware traversal query everywhere (P2.3)

**Files:** `src/systems/movement_displacement.ts`, `src/systems/movement.system.ts`, `src/rulesets/dnd35e/combat/{immediate_reactions,charge_resolver}.ts`, AI pathing callers.

- Every traversal check that can occur over a crossing must pass `state`, `x`, and `y` to `evaluateTileTraversal`.
- Remove local `canTraverse` wrappers that reconstruct only tile metadata.
- The kernel and direct callers must agree on bridge, rope, ladder, ice, difficult, hazard, and solid classification.
- Charge validation and execution must use the same movement-mode/crossing context.

**Focused proof:** Abrupt Jaunt, friendly swap, Charge, voluntary walk, and AI pathing all accept the same active bridge destination.

### Step 2.4 — Make Abrupt Jaunt transactional and footprint-consistent (P2.4)

**Files:** `src/rulesets/dnd35e/combat/immediate_reactions.ts`, displacement kernel.

Use this order:

1. Read the actor and pool availability.
2. Validate the destination against the exact footprint that will execute.
3. Attempt displacement on the pre-consumption state.
4. If the kernel reports failure, return the pre-action state plus a failure message; consume no pool/action.
5. If displacement succeeds, commit the pool/action charge on the returned state.
6. Emit the Jaunt event with the interaction chain.

Remove `skipOccupancyCheck: true` from this path. Teleport must validate and execute the same base/squeezed dimensions and must not overlap an actor or occupy a wall.

### Step 2.5 — Assign exactly one pit-entry fall (P2.1)

**Files:** `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts`, movement lifecycle hooks.

- Remove the explicit post-displacement `applyPitFallConsequences` call from the failed-Jump path.
- The movement-entry hook owns pit-entry consequences and compares the prior tile with the entered tile.
- Turn start must not reapply initial fall damage merely because the actor remains in a pit.
- Ongoing field/caltrop occupation effects remain valid and are not removed.
- Falling into a pit from Jump, forced push, crossing collapse, or other displacement uses the same entry transition.

**Focused proof:** one failed Jump creates one fall-damage instance; the following turn creates none unless a new fall occurs.

### Step 2.6 — Share local elapsed-time semantics between normal and bulk time (P2.5)

**Files:** `src/systems/world_time_skip.ts`, `src/systems/lifecycle.system.ts`, `src/systems/{breath,light_emitter,crossing,ai,status-effect}.system.ts`.

Each domain owns its elapsed-time resolver. The bulk orchestrator calls those same resolvers rather than subtracting unrelated durations itself.

```ts
export interface ActorElapsedTimeResult {
  readonly state: GameState;
  readonly turnsAdvanced: number;
  readonly interruptedReason?: string | undefined;
}
```

Required domain resolvers:

- breath/submersion countdown
- light-emitter fuel and ignition/expiry
- crossing duration/collapse
- AI alertness decay
- status primary/secondary elapsed stages
- purely passive overlays/links that have no per-turn side effect

Normal turn start calls the relevant resolver with one turn. Bulk rest/wait calls the same resolver with elapsed turns and preserves event/death boundaries. `shouldInterrupt` must observe the state after local timers for the elapsed chunk, not only after the entire wait.

Replace the current blanket `fastForwardEntityDurations` behavior for statuses and fields with domain-owned advancement. Retain an optimized helper only for genuinely passive state with no per-turn consequences.

### Step 2.7 — Use one canonical status elapsed resolver (P2.6)

**Files:** `src/systems/status-effect.system.ts`, `src/systems/world_time_skip.ts`.

- Extract the elapsed-stage logic from the current one-turn status tick into a shared resolver.
- The resolver increments `elapsedTurns`, evaluates `secondaryTriggerAfterTurns`, resolves the secondary save/effect once, applies per-turn damage/heal in the same ordering as normal turns, and expires the effect at the correct boundary.
- Normal turn start and bulk advancement call the same resolver.
- The interaction chain from the status application is retained and extended by the secondary-effect frame.

**Focused proof:** a 20-turn secondary-only status triggered at turn 10 resolves during bulk advancement exactly as it does over ten normal turns.

### Step 2.8 — Commit field transmutation as one transaction (P2.7)

**Files:** `src/systems/field.system.ts`, field interaction descriptors.

- Detect interactions before committing an incoming field.
- For oil plus fire, commit one fire field representing the transmutation; do not spawn incoming fire and then spawn a second fire.
- Preserve the interaction chain on the resulting field and append the field-interaction/effect frame.
- Ensure one incoming fire produces one damage application per occupant/tick.

### Phase 2 gate

- Focused displacement, bridge, Jaunt, pit, elapsed-time, status, field, and provenance tests pass.
- Full `bun test` passes.
- Existing save fixtures remain loadable; legacy events without chains remain readable.
- A new actor-driven attack always emits causal events with a non-empty chain.
- Run the full eight-stage verification pipeline and update the SSOT map if new source files/owners were added.

## Phase 3 — Correct Action Economy, Items, Objects, and Traversal Mechanics

### Step 3.1 — Repair Charge strike selection, movement accounting, and condition timing (P3.1, P3.2, P3.3, P3.4)

**Files:** `src/rulesets/dnd35e/combat/charge_resolver.ts`, `src/rulesets/dnd35e/cartridge/dnd35e_combat_adapter.ts`, `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`, `src/rulesets/dnd35e/combat/attack_routine.ts`.

#### Strike selection

A Charge is a Full-Round action. Without Pounce it permits one strike; Pounce permits the attacker's full routine. Distance must not be used to infer a full attack after Charge movement.

```ts
const isFullAttack = isChargeAttack
  ? hasPounce
  : distanceMovedFt <= FIVE_FOOT_STEP_MAX_DISTANCE_FT && actionBudget.moveRemaining >= 1;
```

- Record actual Charge distance before `resolveDnD35eMeleeAttack` selects strikes.
- Preserve `distanceMovedThisRoundFt` when `consumeFullRoundChargeBudget` clears the action budget.
- Compute actual feet travelled from committed displacement steps, not only the originally validated path.

#### Condition timing

- Apply the authored `charging` condition immediately after Charge validation succeeds and before displacement.
- Retain it on every displacement/interruption path.
- Remove it at the charger's next turn through the existing condition lifecycle.
- A Charge that never begins validation must not leave the condition behind.

#### Movement mode and range

- Compute range from the movement mode actually capable of traversing the validated path.
- A fly-only actor uses fly speed; a land actor cannot borrow an unrelated swim/fly speed merely to extend Charge range.
- The targeting cursor and validation must use the same range resolver.

#### Equipped-weapon reach

- Carry `reachFt` and `strikesAdjacent` into `DnD35ResolvedStrikeProfile`.
- Resolve the closest legal attacking position along the straight path using the scheduled strike's authored reach profile.
- A reach weapon that cannot strike adjacent must stop at its legal distance; a 10-foot reach may remain at 10 feet.
- After a defensive reaction moves the target, re-evaluate the legal distance before striking.

**Focused proof:**

- Level-11 non-Pounce fighter: one Charge strike, 15 feet recorded.
- Pounce fighter: full iterative routine.
- Interrupted Charge: -2 AC remains until next turn.
- Fly-only Charge uses fly range.
- Glaive: no adjacent strike and legal 10-foot strike succeeds.

### Step 3.2 — Carry the exact weapon instance through strikes and coating effects (P3.5, P3.6, P2.8)

**Files:** `src/rulesets/dnd35e/equipment/weapon_profile_parser.ts`, `src/rulesets/dnd35e/equipment_physics.ts`, `src/rulesets/dnd35e/combat/attack_routine.ts`, `src/rulesets/dnd35e/combat/combat_exchange_pipeline.ts`, `src/rulesets/dnd35e/combat/floor_hazard_resolver.ts`.

Extend weapon profiles and strikes with instance identity:

```ts
export interface EquippedWeaponProfile {
  // existing fields...
  readonly itemEntityId?: EntityId | undefined;
  readonly slotId?: string | undefined;
  readonly limbGroupId?: string | undefined;
}

export interface DnD35ResolvedStrikeProfile {
  // existing fields...
  readonly weaponEntityId?: EntityId | undefined;
  readonly weaponSlotId?: string | undefined;
}
```

- `parseEquippedItem` assigns `slot.equippedItem` as `itemEntityId`.
- Synthesized off-hand/double-weapon profiles retain the same entity identity but carry a distinct slot/limb identity.
- The exchange pipeline passes `strike.weaponEntityId` to coating resolution.
- Natural and unarmed strikes carry no weapon entity and never consume an unrelated equipped weapon's coating.
- The coating frame records the exact item entity, content ID, slot, and application source.
- Coating consumption removes/decrements only that item's coating.

### Step 3.3 — Make dip and hazard deployment declarative and consumptive (P3.6, P3.7, P5.4)

**Files:** base item/campaign schemas, D&D item schemas, `src/systems/apply.system.ts`, `src/rulesets/dnd35e/combat/floor_hazard_resolver.ts`, `src/systems/inventory.system.ts`.

Add generic authored descriptors rather than D&D-specific ID checks:

```ts
export const CoatingDefinitionSchema = z.object({
  effectId: z.string().optional(),
  statusId: z.string().optional(),
  bonusDamage: z.object({ dice: z.string(), damageType: z.string() }).optional(),
  charges: z.number().int().positive().default(1),
  durationTurns: z.number().int().positive(),
  targetCondition: EntityTagConditionSchema.optional(),
  allowedTargetTags: z.array(z.string()).optional()
});

export const DeploymentDefinitionSchema = z.object({
  fieldId: z.string(),
  placement: z.enum(['target_tile', 'adjacent_tile']),
  consumeMode: z.enum(['item', 'charge']),
  radiusTiles: z.number().int().positive().optional()
});
```

- Reuse/extract the canonical `EntityTagConditionSchema`; do not create a second target-condition language.
- Dip requires a generic weapon/ammunition capability. Authored item profiles decide eligibility.
- On success, consume exactly one source charge/item according to the descriptor. The canonical helper searches the actor's inventory and equipment, decrements charges, and removes the entity when exhausted.
- On an authored mishap, apply the descriptor's declared outcome; do not silently consume or preserve by accident.
- Deployment requires the referenced field definition to exist in the loaded registry. Missing definitions fail validation/load rather than being created at runtime.
- A deployed source is consumed or transferred exactly once. Repeating the same deployment cannot leave the original bag/item available.
- Remove `itemId.includes('poison'/'venom')`, the generic `alignment:evil` fallback, and hardcoded field IDs/durations/glyphs/colors.

### Step 3.4 — Give floor hazards movement context and correct SRD parameters (P3.8)

**Files:** `src/rulesets/dnd35e/combat/floor_hazard_resolver.ts`, displacement context/mode definitions, DAG projection.

- Pass movement mode, effective speed, and running/charging state into hazard resolution.
- Caltrops:
  - half-speed or slower movement is safe;
  - charging/running movement that is hit halts the actor;
  - foot attack AC excludes equipment armor, shield, and deflection but includes Dexterity and natural armor;
  - footwear retains its authored armor contribution.
- Marbles:
  - normal Balance DC from authored content;
  - charging/running DC from authored content;
  - movement context reaches the Balance resolver.
- Add a canonical DAG query for the foot-attack AC rather than reconstructing it from unrelated AC fields.
- Propagate a hazard-halt result through displacement so a charging actor stops immediately.

### Step 3.5 — Hydrate and integrate real structural objects and doors (P3.9, P3.10, P3.11)

**Files:** entity/item schemas, `src/core/ecs/ecs_spawner.ts`, `src/core/ecs/ecs_item_promoter.ts`, `src/systems/durability.system.ts`, `src/rulesets/dnd35e/combat/object_durability_resolver.ts`, D&D melee/projectile adapters, campaign door reactions.

#### Hydration

- Add authored `structural` data to generic entity/item definitions: material/hardness/HP/break DC/object size/door flag/spell storage as applicable.
- Spawner and item promoter hydrate `StructuralComponent` from that data.
- Enhancement bonuses use the canonical effective-stat resolver.

#### Object attacks and wear

- Route attacks against a Structural target through `applySrdObjectAttackDamage` before the Fighter-only living-target guard.
- Apply the authored energy/ranged multipliers, hardness bypasses, wear chance, damage, and break/ruined transition.
- Cover melee and projectile/energy object targets symmetrically.

#### One effective maximum

- `resolveEffectiveStructuralStats` becomes the single source for effective maximum HP, hardness, and break threshold.
- Damage, repair, ruin, and break tests use that effective maximum. Repair cannot clamp a +2 item back to its base maximum.

#### Door presentation

- Structural open/close performs its lock/spike/jam guards, updates `StructuralComponent`, then invokes the existing declarative reaction/consequence path.
- Add an authored broken-door reaction using the existing `impact` verb; its consequences remove solid/opaque, set the broken glyph/tags/intents, and invalidate FOV.
- Do not hardcode glyphs, tile IDs, or tag arrays in TypeScript.
- Open, close, break, and repair all leave movement/FOV/render state consistent with the authored door state.

### Step 3.6 — Replace the rigging shortcut with complete recipes (P3.12)

**Files:** crossing schemas/rules, `src/rulesets/dnd35e/spatial/terrain_traversal_resolver.ts`, `src/rulesets/dnd35e/skills/dungeon_skill_verbs.ts`, modular item content.

Add a Tier 3 crossing recipe descriptor:

```ts
export const CrossingRecipeSchema = z.object({
  crossingKind: z.string(),
  requiredTagsAll: z.array(z.string()),
  requiredTagsAny: z.array(z.string()).optional(),
  anchorRule: z.object({ maxRangeTiles: z.number().int().positive(), requiresClearAnchor: z.boolean() }),
  consumeMode: z.enum(['install_item', 'consume_item', 'consume_charge']),
  skillCheck: z.object({ skillId: z.string(), dc: z.number().int().positive() }).optional()
});
```

- A rope crossing requires the authored rope plus grappling-hook capabilities.
- A ladder crossing requires an authored ladder item; add the missing modular ladder content with semantic tags.
- Validate the gap/anchor, range, line, and recipe requirements before creating a crossing.
- Consume or transfer each required item exactly as the recipe declares. Installed gear belongs to the world crossing and cannot be reused.
- Prevent duplicate crossing creation for the same tile/recipe.
- Append item, recipe, and crossing frames to the interaction chain.

### Step 3.7 — Validate and route spellbook study/drop behavior (P3.13, P3.15, P3.16)

**Files:** `src/rulesets/dnd35e/magic/spellbook_loot.ts`, death/drop assembly, spellbook UI/intents.

#### Study time

- Replace direct `globalTurn += studyHours * ...` with the canonical bulk/world-time advancement helper.
- Use the existing hour/round conversion constant; do not duplicate the conversion.
- Run all Phase 2 local elapsed systems for the study duration.
- Preserve interruption/partial-study behavior.

#### Transcription selection

- Validate the requested `spellId` against the source book's `storedSpells`.
- Validate that the actor has an eligible spellbook/class track and that the spell is available to that class (using spell `levelByClass`, domain, or access metadata).
- Only then add the spell to the actor's class spellbook/known-spell state.
- Record the source book item and learned spell in the interaction chain.

#### Drop assembly

- Build a spellbook drop only for a deceased actor with an eligible spellbook-bearing caster track.
- Populate spells from that actor's actual class spellbook/prepared state.
- Do not treat every known/prepared spell as an arcane book and do not give divine-only casters arbitrary arcane spellbooks.
- Use authored rarity/bonus rules for the generated book.

### Phase 3 gate

- Charge, coating, deployment, floor-hazard, structural object/door, rigging, and spellbook focused suites pass.
- Real spawned objects—not manually attached components—take damage, wear, repair, open, break, and affect movement/FOV.
- Coating consumption targets the exact striking weapon instance.
- Every consumed/deployed/installed item is present exactly once in its intended location.
- Every new actor-driven effect carries the complete interaction chain.
- Run the full eight-stage verification pipeline.

---

## Phase 4 — Complete Production Integrations

### Step 4.1 — Wire and correct disguise perception (P4.1, P4.8)

**Files:** `src/utils/faction.ts`, `src/systems/disguise.system.ts`, Apply/skill verb resolvers, observation/AI paths, faction/mask content.

Production paths:

- Apply a disguise through a generic item/apply descriptor, not a test-only helper.
- Evaluate suspicion when an observer performs Spot/observation or otherwise scrutinizes the disguised actor.
- Both PCs and NPCs use the same mask application and scrutiny services.

Faction precedence:

1. The subject's own faction/attitude remains its actual state.
2. Resolve the target's perceived faction from a valid target mask.
3. Personal knowledge/grudges that identify the target may override the mask.
4. A valid mask suppresses baseline faction/attitude hostility toward the target.
5. If the mask is absent, blown, or invalid, use the actual faction/attitude relationship.

Do not mutate the observer's faction and do not treat the observer as disguised merely because the target is.

**Focused proof:** shipped Bandit King hostility is suppressed by a matching bandits mask; the disguised actor remains friendly to its real ally; personal recognition still defeats the mask.

### Step 4.2 — Connect sound, sleeping awareness, and light interactions (P4.2, P4.3, P4.4)

**Files:** `src/systems/sound.system.ts`, `src/systems/rest.system.ts`, movement/combat/thunderstone producers, `src/systems/apply.system.ts`, `src/rendering/ui/verb_menu.ui.ts`, `src/systems/light_emitter.system.ts`, `src/systems/rest.system.ts`.

#### Sound and sleep

- Route hearing through the canonical sleeping-awareness service.
- A detected sound wakes a sleeping actor and applies the authored sleeping Listen penalty before the perception check.
- Wire voluntary movement, stealth movement, combat attempts/hits, thunderstones, and existing door/object sounds through `emitSoundEvent`.
- Pass the interaction chain into sound events.

#### Ignite/refuel verb discovery

- `getValidVerbsForTarget` and `processApplyIntent` must call the same generic fire-start/light predicate.
- Project `ignite` when a valid light source and fire-start capability are present.
- Keep lantern refueling reachable through the existing generic dip path.

#### Camp illumination

- Add a canonical active-illumination query in `light_emitter.system.ts`.
- A camp light must be lit, retain fuel, and illuminate the camp position.
- Include carried and ground emitters; exclude unlit/depleted emitters.
- Use that query for camp preparedness and ambush-risk reduction.

### Step 4.3 — Make corpse creation and harvesting real (P4.5, P4.6)

**Files:** `src/systems/corpse.system.ts`, `src/systems/death.system.ts`, semantic type projection/Ruleset hook, Apply/verb UI, harvest recipes and item content.

- Resolve corporeality from canonical semantic type/subtype data. Incorporeal elemental subtypes do not create physical corpses.
- Add a user-visible `harvest` verb to the central `Verb`/`VERBS` contract and project it for eligible corpses.
- Add a declarative harvest recipe: corpse tag → item template, quantity, required tool tag, destructive/non-destructive behavior, and source corpse.
- A successful harvest spawns the yield and transfers it to the actor's inventory or the corpse tile.
- A required tool must be present and is consumed only when the recipe says so.
- Mark a non-destructive tag as harvested so it cannot yield twice; a destructive recipe removes the corpse.
- Record corpse, tool, recipe, yield, and source entity in the interaction chain.

### Step 4.4 — Wire religion and automatic lore persistence (P4.7, P4.9)

**Files:** `src/systems/religion.system.ts`, altar/shrine content and Apply reactions, `src/rulesets/dnd35e/skills/monster_lore_tracker.ts`, sight/inspect paths.

#### Religion

- Add a user-visible `pray` verb/reaction path for altars and shrines.
- The altar/shrine content supplies the deity/patron, accepted offerings, taboo data, favor adjustments, penance amount, and atonement result.
- `recordDeityFavorDelta` and taboo recording require an explicit deity/patron. Do not silently create `pelor`.
- An actor without an established patron cannot accrue favor/penance against an unrelated altar.
- Wire prayer/offering/taboo actions to the canonical religion component.

#### Lore

- Invoke `evaluateAndRecordMonsterLore` on the first player sighting and on explicit inspection.
- Retain the existing on-demand Inspect/Dossier lore projection; persistence must not duplicate it.
- Store the observer's learned knowledge in the canonical Knowledge/Memory components.
- Use the observer/target interaction chain for the learned-lore event.

### Phase 4 gate

- Every newly integrated mechanic is reachable through a production intent/verb or authored event, not only direct test calls.
- UI verb discovery and execution use the same validity predicates.
- PC and NPC paths use the same service implementations where the mechanic applies to both.
- Full `bun test`, build, and validator pass.

## Phase 5 — Restore Declarative Purity, Campaign Parity, and SSOT Truth

### Step 5.1 — Separate full rest configuration from partial area overrides (P5.2)

**Files:** `src/types/campaign/world.ts`, `src/systems/world_clock.system.ts`, area JSON fixtures.

Define shared field shapes once, then create two schemas:

```ts
const RestPressureFields = {
  safeRest: z.boolean(),
  ambushChancePerWatch: z.number().min(0).max(1),
  watchDurationHours: z.number().positive(),
  schemeTickMultiplier: z.number().positive(),
  respawnRateMultiplier: z.number().min(0),
  alarmDecayTurns: z.number().int().nonnegative()
};

export const RestPressureConfigSchema = z.object({
  safeRest: RestPressureFields.safeRest.default(false),
  ambushChancePerWatch: RestPressureFields.ambushChancePerWatch.default(0.15),
  watchDurationHours: RestPressureFields.watchDurationHours.default(2),
  schemeTickMultiplier: RestPressureFields.schemeTickMultiplier.default(1),
  respawnRateMultiplier: RestPressureFields.respawnRateMultiplier.default(1),
  alarmDecayTurns: RestPressureFields.alarmDecayTurns.default(50)
});

export const RestPressureOverrideSchema = z.object(RestPressureFields).partial();
```

- `rules.json` uses the complete config schema.
- `AreaDefinition.restPressure` uses the partial override schema.
- Runtime resolves `{ ...campaignConfig, ...areaOverride }` only after parsing the area as a true partial object.

**Focused proof:** an area specifying only `safeRest` inherits the campaign's watch duration, ambush chance, scheme multiplier, respawn multiplier, and alarm decay.

### Step 5.2 — Promote shared antitoxin dependencies and validate every campaign (P5.1)

**Files:** `public/data/rulesets/dnd35e/effects.json`, `public/data/rulesets/dnd35e/status.json`, D&D campaign status/effect mirrors, loader/validator.

- Add `antitoxin_dose` and `antitoxin` to D&D ruleset base content, which the loader already merges before campaign overrides.
- Remove redundant D&D campaign copies after the shared base is verified.
- Every D&D campaign that can load the antitoxin item must resolve the effect and status.
- Extend validator/reference checks to cover:
  - system/campaign item consumable → effect;
  - effect/status → status;
  - field/deployment descriptor → field definition;
  - crossing recipe → required item/tag capability;
  - wand → spell;
  - spellbook drop → stored spell.

**Focused proof:** loading Realms of Shroudgarde resolves antitoxin item/effect/status together; drinking it consumes the vial and applies the authored effect.

### Step 5.3 — Model antitoxin as a typed save modifier (P5.3)

**Files:** status schema, D&D status JSON, DAG/save resolver, `dnd35e_ruleset.ts`.

Add generic status metadata and modifiers:

```ts
export const StatusSaveModifierSchema = z.object({
  saveType: z.enum(['fort', 'dex', 'con', 'wis', 'int', 'cha']),
  bonusType: z.string(),
  value: z.number(),
  effectTagsAll: z.array(z.string()).optional()
});
```

- Add `tags` and `saveModifiers` to `StatusEffectDefinitionSchema`.
- Author poison with `tags: ['poison']`.
- Author antitoxin with a Fortitude/alchemical/+5 modifier scoped to `effectTagsAll: ['poison']`.
- Project status modifiers into the typed modifier/DAG pipeline with `sourcePath: 'status:<id>'`.
- Resolve the secondary poison save through the normal save total; remove the manual `hasResistanceStatus ? 5 : 0` branch.
- Preserve generic `resistedByStatusIds` only if another consumer still uses it; do not use it to carry numeric bonuses.

### Step 5.4 — Make wand activation class-list driven (P5.5)

**Files:** item schema, wand JSON, `src/rulesets/dnd35e/skill_verbs.ts`, `src/systems/zap.system.ts`, `RulesetContract`.

- Add a generic `spellId` to the zappable/wand descriptor and author it on both wands.
- Change the Ruleset hook to receive the wand item entity ID, or pass the resolved spell ID explicitly.
- Add a generic class capability such as `spellTrigger: { enabled: true }` to class definitions rather than maintaining a class-ID array in TypeScript.
- A Spell Trigger actor may activate a wand only when the wand's spell is available to that actor's class/track through authored `levelByClass`, domain, or access metadata.
- Otherwise use the existing UMD check.

### Step 5.5 — Make Charge-blocking conditions declarative (P5.6)

**Files:** condition schema/content, Charge resolver, condition effect/rule-override resolver.

- Add authored qualitative rule overrides to immobilizing conditions, for example `ruleKey: 'blocks_charge', value: true`.
- Remove `CHARGE_BLOCKING_CONDITIONS` from `charge_resolver.ts`.
- Charge validation reads the actor's active condition rule overrides through the canonical condition resolver.
- A newly authored immobilizing condition can block Charge without TypeScript changes.

### Step 5.6 — Remove implicit religion identities and values (P5.7)

**Files:** `src/systems/religion.system.ts`, deity/altar/shrine content.

- `recordDeityFavorDelta` requires an explicit deity/patron when no religion component exists; it returns failure instead of defaulting to Pelor.
- Taboo IDs, penalties, and favor values come from authored deity/patron/altar data.
- `atonePenanceAtAltar` receives the altar's declared favor/penance values rather than relying on a TypeScript default.
- The generic `apply`/`pray` reaction path supplies the target's authored deity/patron.

### Step 5.7 — Turn the default campaign into a live feature showcase (P5.8)

**Files:** `public/data/campaigns/default/` content and smoke tests.

Add classic-ruleset-appropriate, actively usable content for every new engine feature:

- light source and fire-start capability for real ignition;
- structural door with passability/FOV behavior;
- corpse and a harvestable target/tool/yield;
- shrine/altar and religious interaction;
- disguise item/capability and an observer path;
- rope/hook/ladder crossing content;
- coating/hazard content using generic descriptors;
- authored Structural/spellbook-adjacent showcase where the classic ruleset supports it.

Each feature must be reachable from the default campaign's starting content, not merely represented by an unused schema.

### Step 5.8 — Reconcile documentation, milestones, decisions, and SSOT (P5.9, P5.11)

**Files:** `docs/ARCHITECTURE.md`, `docs/MILESTONES.md`, `docs/DECISIONS.md`, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, SSOT JSON registries, `docs/research_notes.md`, this plan.

- Correct current component names to the canonical code contract:
  - `spikedByEntityId`, not `spikedCount`;
  - `decayTurn`, not `freshnessTurns`;
  - `deityOrPatronId`, `favorScore`, `penanceDebt`, `taboosViolated`;
  - `disguiseCheckTotal`, not `disguiseCheckResult`.
- Document the interaction-chain contract separately from Rule 19 `sourcePath`.
- Update ARCHITECTURE only after the implemented behavior matches it.
- Keep M150–M156 completion status qualified until Phase 6 passes.
- Add a DECISIONS entry explaining causal-chain ownership, persistence, and generic frame interception.
- Regenerate SSOT maps after adding or moving source files:
  - `bun scripts/map-codebase.ts`
- Correct the `computeActorCarriedWeightLbs` JSDoc to match the current one-item-entity-per-entry model; do not add an unapproved stack model.

### Step 5.9 — Remove or register duplicate campaign sprite sheets (P5.10)

**Files:** the eight added campaign PNG copies and theme/sprite references.

- Confirm that both campaigns reference the shared `32rogues` pack and have no campaign-local sheet consumer.
- Remove the byte-identical unreferenced copies.
- If a campaign-local override is intended instead, register it in theme data and add rendering/load tests. Do not retain both unused and active copies.

### Phase 5 gate

- All five campaigns load with valid schemas and complete references.
- The New Content Mod fixture proves the new declarative paths require no TypeScript edits.
- Default-campaign smoke scenarios exercise every new feature.
- Documentation and SSOT describe implemented behavior, not intended behavior.
- Full eight-stage verification and SSOT parity pass.

---

## Phase 6 — Integration Proof and Completion Closure

### Step 6.1 — Replace helper-only confidence with real-path regression suites (P6.1, P6.2, P6.3, P6.4, P6.5, P6.6, P6.7)

| Regression suite                                   | Required proof                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tests/m152_displacement_charge.test.ts`           | Same-anchor rotation, bridge pathing, squeezed Jaunt, level-11 Charge, Pounce, fly range, reach/adjacency, interruption and -2 AC                                  |
| `tests/m154_terrain_fields_hazards.test.ts`        | Real pit entry with one damage instance, field transmutation with one fire, caltrops/marbles movement contexts, complete crossing recipes and consumption          |
| `tests/m156_durability_spellbooks_ecology.test.ts` | Real spawned door/weapon durability, door movement/FOV, valid spellbook transcription/drop eligibility, corpse yield/tool, religion/disguise/lore production paths |
| `tests/m153_rest_pressure_logistics.test.ts`       | Partial area overrides, submerged rest interruption, local timers, status secondary stages, active camp illumination                                               |
| `tests/m151_*` provenance suite                    | Actor→action→strike→weapon→effect→outcome ancestry, delayed persistence, hook interception, save/load                                                              |
| UI/verb tests                                      | Ignite, harvest, pray, disguise, rigging discoverability and execution                                                                                             |
| Campaign/validator tests                           | Cross-campaign item/effect/status references and New Content Mod fixture                                                                                           |

Do not satisfy an integration requirement by directly invoking a private helper with a manually constructed component. The test must begin from a real spawn/content/apply/attack path.

### Step 6.2 — Verify complete causal-chain behavior (P6.8)

Required scenarios:

1. **Basic attack:** Entity A attacks Entity B with longsword entity L.
   - Chain contains A's intent/action, the strike, item entity L, damage, and death if applicable.
2. **Coating:** L is coated; only L's coating is consumed and the coating frame identifies L and the application source.
3. **Natural attack:** no weapon frame exists and no unrelated coating is consumed.
4. **Nested effect:** a coating/rider creates a field or status; the delayed entity retains A's ancestry and appends its own effect frame.
5. **Delayed trigger:** B enters a field originally deployed by A; the chain retains A as responsible originator and records B as triggering entity.
6. **Reaction:** a reaction triggered by the attack can inspect the full chain before resolving.
7. **Interception:** the generic before-frame hook can veto one frame without corrupting later chains.
8. **Persistence:** save/load retains delayed-effect chains; legacy saves without chains still load.
9. **Separation:** modifier `sourcePath` and runtime interaction chain remain distinct and both remain available.

### Step 6.3 — Prove normal/bulk elapsed-time equivalence (P6.6)

Compare N normal turns with one bulk advance of N turns for:

- breath/submersion and drowning;
- light fuel and expiry;
- crossing duration/collapse;
- AI alertness decay;
- primary and secondary status stages;
- death/interruption boundaries;
- hunger and world-clock display;
- spellbook study hours.

The resulting components, deaths, messages summarized, and clock value must match except for explicitly summarized log volume.

### Step 6.4 — Extend validation for the repaired data graph (P6.5)

- Validate every loadable campaign's consumables against effect and status registries.
- Validate deployment and field references.
- Validate crossing recipe requirements against item/tag capabilities.
- Validate wand spell references and spell-level metadata.
- Validate stored spellbook spell references.
- Validate Structural/harvest recipe item references.
- Add a temporary New Content Mod fixture containing a new poison/coating, blocking condition, crossing kit, and spell-trigger class capability; remove it after proving the validator and runtime require no TypeScript changes.

### Step 6.5 — Run the complete verification pipeline (P6.9)

Run:

```bash
./verify.sh
```

Then explicitly confirm each stage:

1. Strict TypeScript check.
2. Format check.
3. Lint check.
4. Architectural dependency check.
5. Dead-code/unused-export check.
6. Full regression suite.
7. Production build.
8. Campaign/ruleset/SSOT parity validation.

Also run:

```bash
bun scripts/map-codebase.ts --check
git diff --check
```

Any failure returns work to the owning phase; do not carry a red gate into the next phase.

### Step 6.6 — Manual play-test scenarios (P6.9)

1. **Charge:** A level-11 fighter Charges a fleeing NPC; one attack occurs without Pounce, distance is recorded, and -2 AC remains until the next turn.
2. **Pit:** A failed Jump over a real pit applies one fall; standing in the pit next turn does not repeat it.
3. **Provenance:** A poisoned longsword hit creates a damage/status chain that the debug/event inspector displays in order.
4. **Coatings:** A coated off-hand dagger remains coated when an uncoated primary weapon hits.
5. **Objects:** A real door can be spiked, opened, broken, repaired, and blocks/unblocks movement and FOV consistently.
6. **Bulk time:** A submerged eight-hour rest interrupts and drowns correctly; a lit torch burns down during elapsed time.
7. **Disguise:** A matching disguise suppresses the Bandit King's baseline hostility without changing the disguised actor's relation to its real ally.
8. **Campaign parity:** Antitoxin works in default-appropriate D&D campaigns and Realms of Shroudgarde.
9. **Default showcase:** Every new engine feature is reachable and demonstrable from the default campaign.

### Step 6.7 — Final documentation and cascading audit

- Re-read the research ledger and confirm every P1.1–P6.9 ID is closed with evidence.
- Update both cascading matrices with implementation-discovered effects.
- Reconcile ARCHITECTURE, DECISIONS, MILESTONES, SSOT maps, and prompt-kit mirrors with the final implementation.
- Restore M150–M156 completion wording only after all verification and manual scenarios pass.
- Run the final full pipeline and report its exact results.

---

## 5. Verification and Reporting Contract

For each phase, report:

- files changed and behavior changed;
- upstream/downstream/lateral effects discovered;
- focused tests added and their assertions;
- exact full-pipeline result;
- remaining known limitations, if any;
- any plan deviation and its rationale.

No phase may be described as complete based only on compilation or direct helper tests.

---

## 6. Approval Gate

This update changes planning artifacts only. The original M150–M156 implementation is already committed in `c83c383`; this plan defines the corrective work required before those milestones are accurately considered complete.

**No production code, tests, campaign data, assets, architecture claims, or milestone status may be changed until the user explicitly approves this implementation plan.**

Recommended approval scope:

- **Option A — Gate-first (recommended):** approve Phase 1 only, restore a green verification baseline, then review Phase 2's interaction-chain and elapsed-time design before implementation.
- **Option B — Phases 1–2:** approve the verification gates and engine/provenance foundation, then review before mechanics.
- **Option C — All six:** approve the complete sequential plan with a mandatory verification gate and rollback to the owning phase after any failure.

After approval, execution begins with **Phase 1, Step 1.1** and proceeds one bounded task at a time.
