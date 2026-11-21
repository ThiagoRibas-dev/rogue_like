# Research Notes — M150–M156 Corrective Remediation

> **Status:** Post-implementation audit consolidated; corrective planning only.
> **Audited baseline:** commit `c83c3830d812c746e88fb850812462be57fd1a66` against its parent.
> **Companion artifact:** `docs/implementation_plan.md` contains the six-phase remediation plan, detailed snippets, ownership table, and approval gate.
> **Scope boundary:** This document supersedes the earlier pre-implementation M150–M156 research for corrective work. It does not reopen the approved milestone feature set, and no production code or content changes are authorized by this artifact.

---

## 1. Governing Requirements and Preserved Decisions

The remediation remains governed by `AGENTS.md`, `docs/ARCHITECTURE.md` §§9.19–9.28, `docs/SSOT_CONSOLE.md`, `docs/SSOT_DND35E.md`, and `docs/ROGUELIKE_RPG_SYSTEMS_REPORT.md` §4.

### Preserved feature decisions

- `6000 ms = 100 energy = one six-second round`; Standard/Move actions remain `50` energy before speed modulation.
- Charge is an explicit, symmetric Full-Round action, not passive distance detection.
- The Tier 1 displacement kernel remains the single owner of atomic position changes and movement lifecycle hooks.
- Rest pressure remains campaign-configurable with partial per-area overrides.
- Structural damage uses repairable `ruined` items and opt-in wear chances defaulting to `0%`.
- Spell rarity remains tag-driven; tactical effects remain data-driven and symmetric across PCs, companions, NPCs, and monsters.

### Non-negotiable corrective constraints

1. **One canonical owner per transition.** Pit entry, door state, status elapsed time, field transmutation, item consumption, and displacement results must not have competing implementations.
2. **Rule 15 cascade coverage.** Every behavior or data-shape change must trace callers, consumers, save/event ledgers, campaigns, generator mirrors, UI projections, tests, and documentation.
3. **Rules 17/19/21 declarative behavior.** New content must not require item/class/condition/deity ID branches in TypeScript. Numeric effects use typed modifiers; qualitative behavior uses generic tags, schemas, reactions, or rule overrides.
4. **Rule 18 actor symmetry.** Fixes must operate through shared actor paths rather than player-only special cases.
5. **Serializable state.** Runtime provenance and all new persisted metadata must be plain JSON-safe records, arrays, strings, numbers, booleans, and branded IDs—not `Map`, `Set`, class instances, or mutable singletons.
6. **Small, gated phases.** Each phase must leave the tree buildable and tested before the next phase begins. No implementation begins until the companion plan is approved.

---

## 2. Verified Baseline

The audit used strict static checks, focused and full tests, caller searches, data/schema validation, and read-only runtime reproductions. No source files were changed during the audit.

| Check                               | Observed result                                                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun x tsc --noEmit`                | **FAIL:** four errors in `terrain_traversal_resolver.ts`                                                                                                  |
| `bun run format:check`              | **FAIL:** `floor_hazard_resolver.ts`, `dungeon_skill_verbs.ts`, `durability.system.ts`                                                                    |
| `bun run lint:check`                | Pass                                                                                                                                                      |
| `bun run lint:arch`                 | Pass                                                                                                                                                      |
| `bun run lint:deadcode`             | Pass                                                                                                                                                      |
| `bun test`                          | **FAIL:** 363 passed, 2 failed; 365 tests and 6,369 assertions                                                                                            |
| `bun run build`                     | **FAIL:** same TypeScript errors                                                                                                                          |
| `bun run scripts/run-validator.ts`  | **FAIL:** four stale AI prompt-kit mirrors; other campaign/ruleset/sprite/SSOT checks passed                                                              |
| `git diff --check c83c383^ c83c383` | **FAIL:** blank lines at EOF in two documentation files                                                                                                   |
| JSON/assets/SSOT                    | 44 changed JSON files parsed without duplicate keys; eight PNGs valid; 500 source files passed SSOT mapping; 862 modular ruleset files passed disk parity |

`verify.sh` was not used for the audit because its format/lint stages write files. Equivalent read-only commands were run instead.

### Disproven or qualified allegations

- `src/core/loader.ts:179-183` correctly merges modular system items; there is no production loader omission.
- Structural door code does not hardcode map tile IDs. The defect is that it does not invoke the existing tag/glyph/intent transition at all.
- Corpse spawning/decay and on-demand inspect lore are wired. The gaps are harvesting, automatic lore recording, religion, and disguise application/scrutiny.
- Current poison also has per-turn damage, so rest safety blocks the straightforward poison-rest exploit. Secondary-stage time advancement is nevertheless broken for bulk wait and future secondary-only content.

---

## 3. New Cross-Cutting Requirement: Complete Interaction Provenance

The user explicitly requires that interactions retain their full causal source chain. For example, when Entity A attacks Entity B with a weapon, downstream logic must be able to identify Entity A, the exact attack/strike, the exact weapon entity, and every effect triggered by that weapon or its coatings. Nested effects must extend the same chain so triggers can act at any point.

### Current-state gap

- `DamageInstance`, `ActiveStatusEffect`, `FieldComponent`, and several events retain only optional `sourceEntityId` or item/spell IDs.
- `DnD35ResolvedStrikeProfile` carries weapon content IDs but not the equipped weapon `EntityId`.
- `combat_exchange_pipeline.ts` therefore cannot identify which item instance owns a coating.
- `BaseGameEvent` has no causal chain, so reactions and delayed effects cannot reliably reconstruct the interaction that produced them.
- Rule 19 `sourcePath` identifies modifier/grant provenance; it does **not** identify the runtime instigator, weapon instance, strike, and triggered-effect ancestry.

### Required semantic distinction

- **Modifier provenance (`sourcePath`)**: which feat, spell, class feature, or nested provider granted a mechanical modifier.
- **Interaction provenance (`InteractionChain`)**: which actor/action/item/effect caused this particular resolution and in what order.

One must not replace the other.

### Proposed canonical contract

Add a Tier 1, append-only, JSON-safe `InteractionChain` and discriminated `InteractionFrame` union. New causal resolvers receive a chain explicitly; legacy optional fields are permitted only for save/backward compatibility boundaries.

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
      readonly targetId?: EntityId;
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
    }
  | {
      readonly kind: 'effect';
      readonly effectId: string;
      readonly effectKind: 'coating' | 'rider' | 'spell' | 'status' | 'reaction' | 'field_interaction';
      readonly sourcePath?: string;
    }
  | { readonly kind: 'field'; readonly fieldEntityId: EntityId; readonly fieldType: string }
  | { readonly kind: 'trigger'; readonly triggerId: string; readonly triggeringEntityId?: EntityId };
```

Required behavior:

- Append frames immutably; never overwrite the originator when a weapon, coating, status, or field becomes the immediate source.
- Offer generic queries such as `findLastInteractionFrame(chain, 'item')` instead of content-ID branches.
- Attach the chain to causal `GameEvent`s, `DamageInstance`, `DeathComponent`, `ActiveStatusEffect`, `FieldComponent`, and in-flight/delayed effect state as applicable.
- Persist the originating chain on delayed fields/statuses; append the later occupant/trigger frame when they fire.
- Invoke an optional generic Ruleset before-frame hook for interception and emit existing domain events with the full chain for after-effect triggers. Frame-specific mathematics stays in its current canonical resolver.
- Require provenance for newly created actor-driven interactions. Optional reads exist solely to deserialize old saves/events; they must not become a silent “unknown source” fallback for new attacks.

Example chain:

```text
A intent:melee_attack
  -> A action:full_attack
  -> strike#0 A vs B
  -> item entity#longsword-37 role:weapon
  -> effect:poison_coating kind:coating
  -> DamageInstance targeting B
  -> EntityDamaged / possible EntityDied events
```

If that coating creates a field, and that field later applies a status, both the field and status extend the same ancestry rather than restarting at an anonymous environmental source.

---

## 4. Remediation Ledger

IDs below are stable references for the implementation plan and completion audit.

### Phase 1 — Restore verification gates

| ID       | Evidence and failure                                                                                                                                    | Required outcome                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.1** | `terrain_traversal_resolver.ts:72,396,462,486` declares one helper and calls a different, undefined name. Typecheck/build fail and pit climbing throws. | Use the existing tag-only inventory helper with semantic `climbing_kit`, `ladder`, and `supple_rope` tags; successful typecheck, build, and pit/rigging runtime tests. |
| **P1.2** | `durability.system.ts:25,364-366` requires `hammer`; `items/hammer.json:14-18` supplies `hammer_tool`. M156 door-spike test fails.                      | One declarative hammer tag shared by runtime and content; real hammer + spike succeeds.                                                                                |
| **P1.3** | Prettier rejects three changed TS files; `git diff --check` rejects EOF blank lines in two docs.                                                        | Formatting and whitespace checks pass without unrelated reformatting.                                                                                                  |
| **P1.4** | Validator reports stale `ai-prompt-kit/default-campaign/{rules,areas,effects,status}.json`.                                                             | Regenerate/review mirrors and pass Stage 8.                                                                                                                            |

### Phase 2 — Repair engine invariants and causal propagation

| ID       | Evidence and failure                                                                                                                                                                                                             | Required outcome                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **P2.1** | Failed Jump applies pit consequences through movement and again in `terrain_traversal_resolver.ts:350-361`; turn start repeats falling damage through `dnd35e_lifecycle_adapter.ts:198-201`. Reproduced `[1,5]`, then `[1,5,1]`. | Exactly one fall per actual pit entry; no recurring entry damage while remaining in the pit.                                 |
| **P2.2** | `movement_displacement.ts:400-404,515-518,587-600` discards same-anchor precomputed placements and equates movement with anchor delta. Valid rotations fail or truncate vectors.                                                 | Commit any valid footprint change; distinguish anchor displacement from footprint/spatial change; aggregate steps correctly. |
| **P2.3** | Direct passability callers omit `state,x,y`, hiding active bridges. Abrupt Jaunt, friendly swap, and Charge reject valid crossings.                                                                                              | All direct and kernel callers use the same context-aware traversal query.                                                    |
| **P2.4** | Abrupt Jaunt validates squeezed dimensions, teleport expands to base dimensions, occupancy is skipped, and `moved` is ignored (`immediate_reactions.ts:56-79,212-230`). Reproduced overlap and consumed false success.           | Validate/execute one footprint; no overlap; failed movement consumes no pool/action and reports failure.                     |
| **P2.5** | Bulk rest/wait skips breath, crossing duration, light fuel, and AI alertness. Eight submerged hours advanced `globalTurn` 0→4800 while breath stayed 28/28.                                                                      | Shared elapsed-time processing for all local timed systems; interruption checks observe updated local state.                 |
| **P2.6** | Bulk status advancement decrements duration but leaves `elapsedTurns=0`, `secondaryResolved=false`, and never triggers secondary effects.                                                                                        | Normal and bulk paths share elapsed-time semantics, including per-turn and secondary-stage ordering.                         |
| **P2.7** | Oil ignition creates incoming fire and transmuted fire on one tile (`field.system.ts:246-348,380-421`).                                                                                                                          | Exactly one resulting fire and one damage application per ignition.                                                          |
| **P2.8** | Effects retain incomplete source metadata; strikes lack weapon entity identity and nested triggers cannot retain ancestry.                                                                                                       | Implement the `InteractionChain` contract in §3 and persist/propagate it through causal events and delayed effects.          |

### Phase 3 — Correct action economy, items, objects, and traversal mechanics

| ID        | Evidence and failure                                                                                                                                                                                         | Required outcome                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P3.1**  | Charge leaves moved distance at zero before melee selection. A non-Pounce level-11 fighter made three iterative attacks.                                                                                     | One Charge strike without Pounce; full attack only with Pounce; actual moved distance recorded before downstream effects.                            |
| **P3.2**  | Charge range uses land speed even for fly-only actors. A legal 75-ft fly charge was rejected against a 40-ft cap.                                                                                            | Range derives from the movement mode actually used along the path.                                                                                   |
| **P3.3**  | Charge uses natural/size reach, ignoring equipped `reachFt` and `strikesAdjacent`.                                                                                                                           | Stop at the closest legal space for the scheduled strike; glaive 5-ft/10-ft cases behave correctly.                                                  |
| **P3.4**  | Interrupted Charge returns before applying `charging`, avoiding the -2 AC penalty.                                                                                                                           | Condition begins with Charge and survives every interruption until next-turn cleanup.                                                                |
| **P3.5**  | Coating hit consumption selects the first coated equipped item, not the striking weapon.                                                                                                                     | Consume only the coating on `strike.weaponEntityId`; natural/unarmed attacks do not consume an unrelated weapon coating.                             |
| **P3.6**  | Dip accepts nonweapons and never consumes the poison/oil/holy-water source.                                                                                                                                  | Generic weapon/ammo eligibility and exactly one source charge/item consumed on success, with the declared mishap policy.                             |
| **P3.7**  | Hazard deployment leaves the original item available and injects hardcoded definitions into `campaign.fields`.                                                                                               | Consume/move one source; use authored field definitions; repeated deployment cannot duplicate the item.                                              |
| **P3.8**  | Caltrops omit half-speed safety and charge/running stops and compute incorrect foot AC; marbles always use DC 10.                                                                                            | Implement SRD movement context, foot AC exclusions/inclusions, halt propagation, and DC 15 charging/running marbles.                                 |
| **P3.9**  | Enhancement-adjusted HP is used for damage but repair clamps to base `maxHp`.                                                                                                                                | One effective maximum across hydration, damage, break thresholds, and repair.                                                                        |
| **P3.10** | Object attack resolver has no production caller; normal items/doors lack Structural hydration; configured wear can silently do nothing.                                                                      | Declarative Structural hydration and real object-target attack/wear integration.                                                                     |
| **P3.11** | Structural open/break updates only component state, bypassing existing door tag/glyph/intent reactions.                                                                                                      | Reuse canonical door transitions; movement, occupancy, FOV, and rendering reflect the resulting state.                                               |
| **P3.12** | Rigging accepts rope **or** anchor as a complete recipe, lacks full target/gear validation, does not consume/detach equipment, and references `ladder_10ft` without a corresponding modular item definition. | Declarative recipe requirements, valid anchors/range, authored ladder content, one crossing per consumed/installed kit, no duplication.              |
| **P3.13** | Spellbook transcription directly increments `globalTurn`.                                                                                                                                                    | Route study time through canonical bulk advancement and preserve partial/interruption behavior.                                                      |
| **P3.14** | Generic `alignment:evil` satisfies every coating target condition, including holy water.                                                                                                                     | Declarative target predicates; evil humanoids do not take undead/evil-outsider holy-water damage.                                                    |
| **P3.15** | Spellbook transcription accepts an arbitrary requested spell ID and adds it to known spells without verifying that it belongs to the book or that the actor may learn that class's spell.                    | Validate the selected spell against the book's stored spells and the actor's eligible spellbook/class tracks.                                        |
| **P3.16** | Spellbook drop assembly can include any known/prepared spells and does not prove the deceased was an eligible spellbook-bearing caster.                                                                      | Build drops only for eligible casters and from their actual class spellbooks; non-casters/divine-only casters do not receive arbitrary arcane books. |
| **P5.11** | `computeActorCarriedWeightLbs` documents multiplying stack quantity, but `ItemComponent` has no `quantity` field. This is stale documentation, not evidence of a live stack-weight bug.                      | Correct the JSDoc to describe the current one-item-entity-per-entry model; do not introduce a stack model in this remediation.                       |

### Phase 4 — Complete production integrations

| ID       | Evidence and failure                                                                                                                                                                             | Required outcome                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **P4.1** | Attitude returns before masks; masks replace both subject and target factions. Shipped Bandit King remains hostile to a matching disguise; a disguised subject can treat a real ally as hostile. | Masks affect only observers’ perception of the target; explicit Attitude precedence; subject allegiances remain unchanged. |
| **P4.2** | Sound alerts sleeping actors without waking or sleeping Listen penalties; movement/general combat/thunderstones do not emit through sound.                                                       | Canonical hearing/sleep handling for all actors and real sound producers wired through `emitSoundEvent`.                   |
| **P4.3** | Direct `ignite` works, but verb discovery offers no torch/flint option.                                                                                                                          | Execution and UI discovery share one generic validity predicate/reaction projection.                                       |
| **P4.4** | Unlit/depleted carried lights reduce camp ambush risk; lit ground lights do not.                                                                                                                 | Camp preparedness queries actual active illumination at the campsite.                                                      |
| **P4.5** | `harvestCorpseTag` has no production caller and yields no item or inventory change/tool requirement.                                                                                             | Production harvest verb plus declarative tag→yield/tool data and real inventory results.                                   |
| **P4.6** | Corporeal checks inspect raw tags only; elemental/incorporeal subtype data can still produce a physical corpse.                                                                                  | Resolve canonical semantic type/subtype data or a Ruleset hook before corpse creation.                                     |
| **P4.7** | Religion favor, taboo, and atonement functions have no production callers.                                                                                                                       | Wire shrine/altar/dialogue/reaction intents to the canonical religion system with end-to-end tests.                        |
| **P4.8** | `applyIdentityMask` and `evaluateDisguiseSuspicion` have no production callers.                                                                                                                  | Add real disguise application and observation/scrutiny paths for PCs and NPCs.                                             |
| **P4.9** | `evaluateAndRecordMonsterLore` has no production caller; inspect still computes lore on demand.                                                                                                  | Persist automatic first-sight/inspect knowledge without duplicating the existing inspect projection.                       |

### Phase 5 — Restore declarative purity, campaign parity, and SSOT truth

| ID        | Evidence and failure                                                                                                                                              | Required outcome                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **P5.1**  | Realms of Shroudgarde loads antitoxin but lacks `antitoxin_dose` and `antitoxin`; the vial is consumed after an unknown-effect message.                           | Complete shared dependency chain or promote it to ruleset-base content; all-campaign consumable reference validation.   |
| **P5.2**  | Fully defaulted area rest schema overwrites campaign values before the runtime spread.                                                                            | Separate full resolved config from partial area override schema; one-field overrides inherit all other campaign values. |
| **P5.3**  | Antitoxin +5 is hardcoded from status membership.                                                                                                                 | Declarative typed Fortitude modifier/effect bundle with provenance and stacking rules.                                  |
| **P5.4**  | Floor hazards infer behavior from item-ID substrings and hardcode coating/field effects and targeting.                                                            | Tier 3 coating/deployment descriptors with generic schema-driven resolution.                                            |
| **P5.5**  | `SPELL_TRIGGER_CLASS_TRACK_IDS` hardcodes class IDs and allows listed classes to activate any wand.                                                               | Class spell-list membership and declarative spell-trigger capability drive activation/UMD.                              |
| **P5.6**  | Charge prevention uses a hardcoded condition-ID set.                                                                                                              | Generic condition capability/effect metadata declares whether movement/Charge is blocked.                               |
| **P5.7**  | Religion defaults missing patrons to `pelor` and grants a hardcoded favor amount.                                                                                 | No implicit deity; values come from actor/altar/deity content or explicit named configuration.                          |
| **P5.8**  | Default campaign cannot actively demonstrate several new light/traversal/structural/ecology features.                                                             | Ruleset-appropriate default content and live smoke scenarios for every new engine feature.                              |
| **P5.9**  | Architecture contains nonexistent component fields and overstates door/harvest/lore integration; implementation plan still describes pre-implementation approval. | Reconcile ARCHITECTURE, MILESTONES, DECISIONS, SSOT registries, and plan status with actual behavior after fixes.       |
| **P5.10** | Eight campaign PNGs duplicate shared `32rogues` binaries and have no local consumer.                                                                              | Remove redundant copies or register/test intentional campaign-local sheets.                                             |

### Phase 6 — Prove real-path integration and close verification

| ID       | Current blind spot                                                                | Required regression coverage                                                                                                             |
| -------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **P6.1** | Tests manually attach Structural and call helpers directly.                       | Spawn real objects/doors/weapons and exercise real attack, wear, repair, open, break, movement, and FOV paths.                           |
| **P6.2** | Charge test uses a one-attack level-4 fighter and omits moved distance.           | Level-11 non-Pounce versus Pounce, actual distance, interrupted Charge, fly, reach, and adjacency cases.                                 |
| **P6.3** | Pit test lacks a real configured pit and damage-count assertion.                  | Real pit entry with exactly one damage instance and no repeat on following turns.                                                        |
| **P6.4** | Disguise test removes Attitude; movement tests use unsqueezed/single-tile actors. | Shipped hostile Attitude plus squeezed multi-tile overlap/wall/false-success cases.                                                      |
| **P6.5** | Validator misses system-consumable→effect→status references across campaigns.     | Cross-campaign deep-reference tests and a New Content Mod fixture requiring no TS edits.                                                 |
| **P6.6** | No normal-versus-bulk equivalence suite.                                          | Breath, light fuel, crossings, alertness, primary/secondary statuses, death/interruption, and spellbook study parity.                    |
| **P6.7** | UI tests bypass verb discovery.                                                   | `getValidVerbsForTarget` and actual UI-enabled option tests for ignite, harvest, disguise, altar, and rigging.                           |
| **P6.8** | No nested causal-chain coverage.                                                  | Assert actor→strike→weapon→coating→damage→status/field→death/reaction ancestry, persistence, and hook interception at multiple frames.   |
| **P6.9** | Milestones are marked complete despite failing required gates.                    | Full eight-stage verification, SSOT parity, manual playtests, and final upstream/downstream/lateral audit before completion is restored. |

---

## 5. Cascading Effects Matrix — Corrective Work Packages

| Change                                              | Upstream                                                                                      | Downstream                                                                           | Lateral                                                                        |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| **P1.1/P1.2 helper and hammer gates**               | Pit/rigging verbs, door-spike intent, item/tag registries                                     | Typecheck/build/tests, inventory consumption, crossing/door state                    | Default/crypt tag registries, M154/M156 tests, architecture terminology        |
| **P1.3/P1.4 hygiene and mirrors**                   | Formatter, validator, default campaign source JSON                                            | CI/build acceptance                                                                  | AI prompt kit, generated docs, EOF-sensitive diffs                             |
| **P2.1 pit entry ownership**                        | Jump, forced push/pull, teleport, crossing collapse, turn start                               | Damage/death/prone/events, movement stop reason                                      | Pit fixtures in all campaigns, M152/M154 tests                                 |
| **P2.2/P2.3 displacement and traversal**            | Walk, swap, Bull Rush, Charge, Jaunt, follow/AI pathing                                       | Position/footprint/spatial index, FOV, movement hooks, steps/events                  | Movement/footprint tests, ARCHITECTURE/SSOT ownership                          |
| **P2.4 Jaunt commit semantics**                     | Target validation, immediate pool/action consumption                                          | Occupancy, pool ledger, success log, reactions                                       | Squeezing tests, reaction policy tests                                         |
| **P2.5/P2.6 elapsed time**                          | Turn start, rest, wait, spellbook study, async overlays                                       | Breath, light, crossings, AI, statuses, hunger, interruption/death                   | Sync/async paths, saves, all campaign clock/rest configs                       |
| **P2.7 field transmutation**                        | `spawnField`, spell impacts, deployment                                                       | Field duration/damage/FOV, chain provenance                                          | Field interaction JSON, oil/fire fixtures, campaign mirrors                    |
| **P2.8 interaction provenance**                     | Intents, actions, strikes, items, coatings, spells, reactions, fields/statuses                | Damage/death/events, triggers, ledger/debug traces, saves, delayed effects           | `sourcePath` docs, ECS types, event fixtures, SSOT, every producer/consumer    |
| **P3.1–P3.4 Charge**                                | Hotbar/AI/Apply targeting, action budget, displacement, attack routine                        | Pounce/strike count, AC condition, reactions, distance accounting                    | M152 tests, charging condition JSON, D&D UI projection                         |
| **P3.5/P3.6 coating identity and dip**              | Equipped weapon profiles, strike construction, dip Apply                                      | Correct item coating consumption, damage/status chain, source depletion              | Classic coating paths, weapon fixtures, item schemas                           |
| **P3.7/P3.8 deployment and floor hazards**          | Apply/deploy, movement mode/speed, Charge                                                     | Fields, Balance/attack/limp/halt, item inventory/position                            | Tier 3 field/item descriptors, M154 fixtures                                   |
| **P3.9–P3.11 objects and doors**                    | Spawn/hydration, attacks/wear, open/close/kick/break/repair                                   | Structural HP/ruined, reactions, tags/glyph/intents, FOV/passability                 | All door/item JSON, default showcase, durability tests, SSOT                   |
| **P3.12 rigging**                                   | Use Rope/ladder intents and inventory kits                                                    | Crossing entities, gear consumption/installation, pathing                            | Crossing recipes/content in default and D&D campaigns                          |
| **P3.13 spellbook time**                            | Transcribe action/UI                                                                          | Rest/wait simulation, status/light/breath timers, interruption                       | Sync/async tests, world clock docs                                             |
| **P3.14–P3.16 declarative coatings and spellbooks** | Item JSON, dip/deploy intents, spellbook drops/transcription                                  | Target filtering, effect bundles, field definitions, learned spells/drop eligibility | All poison/oil/holy-water/caltrops/marbles items, caster fixtures, mod fixture |
| **P5.11 weight JSDoc**                              | `computeActorCarriedWeightLbs` contract and current one-item-entity-per-entry inventory model | Developer expectations and future stack design                                       | M150 architecture notes; no runtime behavior change                            |
| **P4.1/P4.8 disguise**                              | Item/application verbs, observation/AI/faction queries                                        | Attitude/hostility, suspicion, dialogues, events                                     | Shipped bandit content, faction mirrors, M156 tests                            |
| **P4.2–P4.4 sound/light**                           | Movement/combat/thunderstone, ignite/refuel verbs, camp evaluation                            | AI alert/sleep/wake, UI verbs, light grid, rest pressure                             | Light/sound item JSON, stealth tests, default showcase                         |
| **P4.5/P4.6 corpses**                               | Death, semantic type projection, harvest verb/tools                                           | Corpse/yield/inventory/decay/necromancy                                              | Creature subtype data, yield recipes, default content                          |
| **P4.7 religion**                                   | Shrine/altar/dialogue/reaction intents                                                        | Favor/penance/atonement, actor religion state                                        | Deity/altar JSON across campaigns, default showcase                            |
| **P4.9 lore**                                       | First sight/inspect, Knowledge resolver                                                       | Memory knowledge and Inspect/Dossier projection                                      | Existing on-demand lore lines, M156 tests                                      |
| **P5.1/P5.2 data schemas and references**           | Campaign/ruleset loader and Zod parse                                                         | Rest resolution, consumable effects/statuses                                         | All five campaigns, generator kit, validator, mod fixtures                     |
| **P5.3/P5.5–P5.7 declarative providers**            | Statuses, class spell lists, condition registry, deity/altar data                             | Stacking DAG, UMD, Charge validation, religion state                                 | Ruleset JSON schemas/registries and Rule 21 audit table                        |
| **P5.8–P5.11 showcase and docs/assets**             | New engine capabilities and shared sprite packs                                               | Default playability, rendering, documentation/SSOT                                   | Default/crypt content, sprite pack references, milestone claims                |
| **P6 integration and closure**                      | Every changed public entry point                                                              | Regression suite, build/validator/SSOT, manual playtests                             | All campaign mirrors, docs, saved-game compatibility, final cascading audit    |

---

## 6. Research Conclusions and Approval Points

1. The current commit is not verification-clean and M150–M156 completion claims must remain qualified until remediation closes.
2. Phase 2 must precede mechanic-specific fixes; otherwise pit, displacement, time, and provenance defects will be reimplemented in multiple callers.
3. Weapon identity and interaction provenance are prerequisites for the coating fix and for reliable nested trigger behavior; a local “first equipped item” patch is explicitly rejected.
4. Door remediation must reuse the existing reaction/consequence path rather than inventing tile-ID switches.
5. Bulk time must share semantics with normal elapsed time; adding a submerged-rest guard alone is insufficient.
6. Production integration tests must replace the current direct-helper-only confidence for structural, ecology, UI, and delayed-effect systems.
7. The companion implementation plan sequences these findings into six gated phases. **No production changes are authorized until that plan is reviewed and approved.**
