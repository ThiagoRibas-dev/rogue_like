# Research Notes — Quest & Narrative System Wiring (Milestone 122)

## 1. Rules & Standards Reiteration (`AGENTS.md` & `docs/ARCHITECTURE.md`)

1. **Zero `any` & Strict TypeScript (`exactOptionalPropertyTypes: true`):** Every function signature must have explicit parameter and return types. Optional properties cannot be assigned `undefined`.
2. **Exhaustive Dispatch Over Branching Chains (`DECISIONS.md` — Data-Driven Polymorphism):** Discriminated unions (`QuestReward`, `ConsequenceAction`, `QuestObjective`) must use either a mapped handler dictionary (`{ [K in Union['type']]: ... }` with `satisfies`) or an exhaustive `switch` with `assertNever(x)`—never open-ended `for-if` chains that silently ignore unhandled variants.
3. **Pure ECS & Immutability:** All quest state lives in `QuestLogComponent` (`src/types/components.types.ts`) and `GameState.dynamicQuests`. No `Map` or `Set` inside ECS components; all state transitions return a new `GameState`.
4. **Tier 1 Console Ownership (`docs/SSOT_CONSOLE.md`):** Quests, triggers, dialogues, and procedural bounties are Tier 1 Console engine systems (`src/systems/quest.system.ts`, `src/systems/trigger.system.ts`, `src/systems/procedural-quest.system.ts`) and delegate ruleset-specific math (like XP leveling) through `getActiveRuleset(state).grantActorXp(...)`.
5. **Default Campaign as Feature Showcase:** Any newly wired objective types, reward types, or consequences must be validated against `src/editor/validator/quest.validator.ts` and showcased in `public/data/campaigns/default/quests.json`.

---

## 2. Deep-Dive Architectural Comparison: `QuestRewardApplierMap` (Option 2C) vs. `ConsequenceAction` Unification (Option 2B)

### Why the Original `for-if` Failed
In `src/systems/quest.system.ts:54–61`, `completeQuest()` currently iterates `questDef.rewards` using a partial `if (reward.type === 'xp')` guard:

```ts
if (questDef.rewards) {
  for (const reward of questDef.rewards) {
    if (reward.type === 'xp' && reward.amount) {
      nextState = grantXp(nextState, playerId, reward.amount);
    }
    // Future: handle item/standing rewards here
  }
}
```
Because an `if` guard does not enforce exhaustiveness over the `QuestReward` union (`'xp' | 'item' | 'standing' | 'event'`), TypeScript allowed 3 of the 4 schema variants to go unimplemented without a compiler error.

---

### Side-by-Side Evaluation Across 3 Architectural Lenses

#### Lens 1: General Software Engineering Principles

| Dimension | Option 2C: `QuestRewardApplierMap` + Shared Domain Mutators | Option 2B: Unifying `QuestReward` into `ConsequenceAction` |
| :--- | :--- | :--- |
| **Bounded Context & Domain Semantics (DDD)** | **Strong Fit:** A `QuestReward` is a **declarative payout manifest** ("What does the player earn for finishing this quest?"), whereas a `ConsequenceAction` is an **imperative world reaction** ("teleport entity, corrupt item, advance villain scheme, mutate NPC memory"). Keeping the schemas distinct preserves clear domain semantics. | **Leaky Abstraction:** If `Quest.rewards` accepts any `ConsequenceAction` (23 variants), a quest's "reward" could be `damage_entity`, `betray_player`, or `spawn_clue`, blurring the line between a quest payout and a post-completion trigger script. |
| **UI Introspection & Previewability** | **Strong Fit:** Because `QuestReward` has 4 well-defined payout shapes (`xp`, `item`, `standing`, `event`), `renderQuestJournal()` (`src/rendering/ui/quest.ui.ts`) can easily render a **"Rewards: 50 XP, 2× Health Potion, +10 Guard Standing"** preview badge on active quests *before* completion. | **Poor Fit:** You cannot cleanly render an arbitrary 23-variant imperative `ConsequenceAction` array (e.g., `mutate_memory`, `modify_terrain`, `advance_scheme`) as a player-facing reward summary in the Quest Journal UI. |
| **Open/Closed Principle & Type Exhaustiveness** | **100% Compile-Time Exhaustive:** Using `type QuestRewardApplierMap = { readonly [K in QuestReward['type']]: QuestRewardApplier<K> }`, adding a new reward variant to `QuestRewardSchema` immediately triggers a TS compile error until its applier is added—with zero `if/else` or `switch` blocks. | **Exhaustive but Over-Broad:** Forces `QuestReward` to share a 23-key dispatch table where ~18 keys have nothing to do with quest rewards. |
| **DRY / Code Reuse** | **Zero Duplication:** Individual appliers in `QUEST_REWARD_APPLIERS` call shared pure ECS helper functions (`grantXp`, `grantItemToActor`, `modifyActorFactionStanding`). If `ConsequenceAction` also wants `grant_xp` or `grant_item`, both dispatch maps call the exact same 10-line helper function. | **High Schema Churn:** Requires either migrating all existing `quests.json` files across all 4 campaigns (`type: 'standing'` $\rightarrow$ `type: 'modify_standing'`, `factionId` $\rightarrow$ `target`, `amount` $\rightarrow$ `value`) or maintaining an adapter layer anyway. |

#### Lens 2: ECS Best Practices

| Dimension | Option 2C: `QuestRewardApplierMap` + Shared Domain Mutators | Option 2B: Unifying `QuestReward` into `ConsequenceAction` |
| :--- | :--- | :--- |
| **Execution Context: Entity-Targeted vs. Event-Relative** | **Pure Entity-Targeted Signature:** `(state: GameState, recipientId: EntityId, reward: Extract<QuestReward, { type: K }>, questId: string) => GameState`. Every reward explicitly knows the `recipientId` (`playerId`) whose `InventoryComponent`, `MemoryComponent`, or XP pool is being updated. | **Event-Relative Impedance Mismatch:** `ConsequenceApplierMap` in `trigger.system.ts` has signature `(state: GameState, event: GameEvent, consequence: ConsequenceAction) => GameState`. Many consequence handlers (`player.ts`, `social_consequences.ts`) implicitly extract their target from `event.actorId`, `event.targetId`, or `event.victimId`. Because `completeQuest(state, questId)` does not take a `GameEvent`, calling `applyConsequence` would require fabricating a synthetic `GameEvent` just to pass `playerId`. |
| **Module Dependency DAG (No Cyclic System Imports)** | **Acyclic DAG:** `trigger.system.ts` $\rightarrow$ `trigger/quest.ts` $\rightarrow$ `quest.system.ts`. `quest.system.ts` never imports `trigger.system.ts`. | **Creates a Runtime Circular Dependency:** `trigger.system.ts` imports `trigger/quest.ts`, which imports `completeQuest` from `quest.system.ts`. If `completeQuest` imports `applyConsequence` from `trigger.system.ts`, we create a runtime cycle (`trigger.system.ts` $\leftrightarrow$ `quest.system.ts`). |
| **Component Mutation Locality** | **Clean Component Boundaries:** Reward appliers operate purely on `InventoryComponent` + `PositionComponent` (for item rewards), `MemoryComponent.factionStandings` (for standing), `getActiveRuleset(state).grantActorXp` (for XP), and `state.events` (for custom events). | Mixes quest state transitions with global trigger recursion (`MAX_RECURSION_DEPTH` guard in `trigger.system.ts`). |

#### Lens 3: Alignment with Our Project's Architecture (`AGENTS.md` & `DECISIONS.md`)

1. **Matches `trigger.system.ts`'s Proven Pattern Without Coupling the Two Domains:**
   - In `src/systems/trigger.system.ts:26–48`, `ConsequenceApplierMap` uses a mapped type `{ [K in ConsequenceAction['type']]: ... }` to achieve O(1) dictionary dispatch and compile-time exhaustiveness.
   - Implementing `QuestRewardApplierMap` (`{ readonly [K in QuestReward['type']]: QuestRewardApplier<K> }`) applies the **exact same Inversion of Responsibility pattern** to `QuestReward` while keeping `quest.system.ts` acyclic and independent of `trigger.system.ts`.
2. **Preserves Existing Multi-Step Narrative Triggers via `GameEventType.QuestCompleted`:**
   - Note that `completeQuest()` **already** emits `{ type: GameEventType.QuestCompleted, actorId: playerId, questId }` into `state.events` (`src/systems/quest.system.ts:88`)!
   - That means whenever a quest needs arbitrary world consequences upon completion (e.g., teleporting an NPC, unlocking a boss door, advancing a scheme, or granting a follow-up quest), the campaign author can **already** attach a `QuestCompleted` trigger in `triggers.json` that runs any `ConsequenceAction`!
   - Even better: if we also add an optional `nextQuestId?: string` (or `onCompleteConsequences?: ReadonlyArray<ConsequenceAction>` / `'event'` reward emission) on `QuestSchema`, multi-stage quest chaining works seamlessly alongside declarative rewards.
3. **Campaign Editor & Validator Precision (`src/editor/validator/quest.validator.ts`):**
   - In `zod_form_renderer.ts` (Campaign Editor), keeping `QuestRewardSchema` focused on the 4 reward types gives quest authors a clean 4-option dropdown (`item`, `xp`, `standing`, `event`) instead of a 23-option trigger consequence dropdown.
   - In `quest.validator.ts`, we can exhaustively validate `quest.rewards` with `switch (reward.type)` + `assertNever(reward)` (`item` $\rightarrow$ exists in `campaign.items`; `standing` $\rightarrow$ exists in `campaign.factions`).

### Architectural Verdict for Gap 2
**Option 2C (`QuestRewardApplierMap` + Shared Pure ECS Mutators)** is the clear winner across Software Engineering, ECS purity, and our codebase conventions:
- It eliminates the `for-if` loop in `completeQuest()` in favor of O(1) dictionary lookup (`QUEST_REWARD_APPLIERS[reward.type]`) with strict compile-time exhaustiveness.
- It avoids creating a circular dependency between `quest.system.ts` and `trigger.system.ts`.
- It keeps `QuestRewardSchema` previewable in the Quest Journal UI and statically checkable in `quest.validator.ts`.

---

## 3. Comprehensive Scope Across All 5 Documented Gaps (Confirmed: "Everything")

Per your confirmation, we will address **all 5 documented quest gaps** in a unified milestone (**Milestone 122: End-to-End Quest & Narrative Lifecycle Wiring** in `docs/MILESTONES.md`):

### Gap 1: Wire All 5 Objective Types + Retroactive `'gather'` / `'explore'` Evaluation
1. **`'gather'` Objective Emission & Retroactive Check:**
   - **On Pickup (`src/systems/inventory.system.ts`):** In `processPickUpIntent`, when the picking-up entity has `ComponentType.Player`, call `processQuestEvent(nextState, 'gather', itemComp.itemId, 1)`.
   - **On Reward/Direct Item Grant (`src/systems/quest.system.ts`):** When an item is granted directly to the player's inventory, also emit `processQuestEvent(nextState, 'gather', itemId, amount)`.
   - **Retroactive Check on `grantQuest()` (`src/systems/quest.system.ts`):** Confirmed! When `grantQuest(state, questId)` initializes `objectiveProgress`, for any `'gather'` objective on the quest, count how many items in the player's `InventoryComponent.items` currently have `ItemComponent.itemId === obj.targetId` and seed `objectiveProgress[obj.id]` with that count.
2. **`'explore'` Objective Emission & Retroactive Check:**
   - **On Area Transition (`src/systems/map.system.ts`):** In `processChangeAreaIntent`, when the transitioning entity has `ComponentType.Player`, call `processQuestEvent(nextState, 'explore', targetAreaId, 1)`.
   - **Retroactive Check on `grantQuest()`:** If a newly granted quest has an `'explore'` objective whose `targetId === state.currentAreaId`, seed its progress to `1`.
   - **Immediate Auto-Complete Check in `grantQuest()`:** If retroactive `'gather'` or `'explore'` progress already satisfies the quest's `AND`/`OR` threshold and `questDef.autoComplete === true`, immediately call `completeQuest(nextState, questId)`.
3. **`'interact'` Objective Emission:**
   - **On Prop/Entity Apply (`src/systems/apply.system.ts`):** In `processApplyIntent`, when a player (`ComponentType.Player`) successfully applies a verb (`open`, `unlock`, `kick`, `pull`, `use`, etc.) to a target entity that has a `TemplateComponent`, call `processQuestEvent(nextState, 'interact', templateComp.templateId, 1)`.

### Gap 2: `QuestRewardApplierMap` (Inversion of Responsibility) & Reward Validation
1. **Exhaustive `QUEST_REWARD_APPLIERS` Dictionary (`src/systems/quest.system.ts`):**
   - Implement `QuestRewardApplierMap` covering all 4 variants of `QuestReward`:
     - `'xp'`: delegates to `grantXp(state, recipientId, reward.amount)` and logs `"+X XP"`.
     - `'item'`: spawns `reward.amount ?? 1` instances of `reward.itemId` via `spawnItem`. For each instance, if `InventoryComponent.items.length < inventory.capacity`, removes `PositionComponent` and appends to `inventory.items`; otherwise leaves `PositionComponent` at the player's feet and logs that the overflow item dropped at their feet.
     - `'standing'`: updates `MemoryComponent.factionStandings[reward.factionId]` on `recipientId` by `reward.amount ?? 0` and logs the standing change.
     - `'event'`: emits `{ type: GameEventType.CustomEvent, eventType: reward.eventType, actorId: recipientId, questId }` (or triggers matching custom event listeners).
2. **Quest Validator Exhaustiveness (`src/editor/validator/quest.validator.ts`):**
   - Validate `'explore'` objectives against `campaign.areas[obj.targetId]` and `'interact'` / `'talk'` objectives against `campaign.entities[obj.targetId]`.
   - Validate `quest.rewards` exhaustively (`switch (reward.type)` + `assertNever(reward)`): verify `'item'` rewards exist in `campaign.items` and `'standing'` rewards exist in `campaign.factions`.

### Gap 3: Procedural Quests (`targetTags` Fix, Notice Board / Consequence Integration & Shop Restock Granting)
1. **Fix `targetTags` Entity Filter (`src/systems/procedural-quest.system.ts:24–34`):**
   - Replace the hardcoded `return false;` inside `if (template.targetTags && template.targetTags.length > 0)` with tag matching against `e.tags`, `e.roleTags`, and `e.encounterTags` so templates like `"bounty_kill"` (`targetTags: ["monster"]`) match monster templates.
   - Support `'gather'` procedural quest templates by matching `state.campaign.items` by `item.tags` when `template.objectiveType === 'gather'`.
2. **Wire Procedural Quest Generation & Shop Restock Contracts into Gameplay:**
   - Add a `generate_procedural_quest` consequence action (`{ type: 'generate_procedural_quest', templateId: string }`) to `ConsequenceActionSchema` (`src/types/trigger.types.ts`) and `questConsequences` (`src/systems/trigger/quest.ts`), which calls `generateProceduralQuest(state, templateId)` and immediately grants the generated quest to the player via `grantQuest()`.
   - In `restockShop()` (`src/systems/shop.system.ts`), when a merchant generates a `dyn_restock_*` supply-run quest, automatically grant it to the player's `QuestLogComponent` via `grantQuest()` (with a message from the merchant requesting restock supplies) so dynamic merchant quests are immediately playable and completable.

### Gap 4: Quest Failure Lifecycle (`failQuest`, `fail_quest` Consequence) & Quest Journal UI Polish
1. **`failQuest(state, questId)` (`src/systems/quest.system.ts`):**
   - Transitions an `'active'` quest to `'failed'`, calls `rebuildQuestTriggers()` to evict its active objective triggers from the O(1) lookup table, logs `"Quest Failed: <title>!"`, and emits `GameEventType.QuestFailed`.
2. **`fail_quest` Consequence (`src/types/trigger.types.ts` & `src/systems/trigger/quest.ts`):**
   - Add `{ type: 'fail_quest', questId: string }` to `ConsequenceActionSchema` and `questConsequences` so dialogues and triggers (e.g., killing a friendly quest-giver or running out of time) can fail a quest.
3. **Quest Journal UI (`src/rendering/ui/quest.ui.ts`):**
   - Filter out hidden quests (`if (questDef.isHidden) continue;`).
   - Render `'failed'` quests with a distinct red title/status badge (`#e74c3c`) vs. `'completed'` (`#2ecc71`) and `'active'` (`#f1c40f`).
   - Render a **Rewards Preview** row on quests so players can see XP, item, and faction standing rewards in their journal.

### Gap 5: Multi-Stage Quest Chaining (`nextQuestId` on `QuestSchema`)
- Add optional `nextQuestId: z.string().optional()` to `QuestSchema` (`src/types/quests.types.ts`).
- When `completeQuest(state, questId)` finishes paying out rewards and emitting `QuestCompleted`, if `questDef.nextQuestId` is defined, automatically call `grantQuest(nextState, questDef.nextQuestId)` to advance the player to the next stage of the quest chain, and validate `nextQuestId` in `quest.validator.ts`.

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Authors) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `QUEST_REWARD_APPLIERS` (`QuestRewardApplierMap`) in `quest.system.ts`** | Invoked by `completeQuest()` for every reward in `questDef.rewards`. | Mutates `InventoryComponent` / `PositionComponent` (via `spawnItem`), `MemoryComponent.factionStandings`, ruleset XP (`grantXp`), `state.events`, and `state.messages`. | `public/data/campaigns/default/quests.json` (`tutorial_quest`'s 2x `health_potion` item reward now pays out), `quest.validator.ts` (validates reward item/faction IDs). |
| **2. Emit `'gather'`, `'explore'`, `'interact'` + Retroactive `grantQuest()` check** | `processPickUpIntent` (`inventory.system.ts`), `processChangeAreaIntent` (`map.system.ts`), `processApplyIntent` (`apply.system.ts`), `grantQuest()` (`quest.system.ts`). | `processQuestEvent` (`quest.system.ts`) -> O(1) `activeTriggers` lookup -> updates `objectiveProgress` -> emits `QuestStageChanged` -> `completeQuest()` if threshold met. | `quest.validator.ts` (validates `'explore'` area IDs and `'interact'`/`'talk'` entity IDs), `default/quests.json`. |
| **3. Fix `procedural-quest.system.ts` `targetTags` + `generate_procedural_quest` consequence + `shop.system.ts` grant** | `generateProceduralQuest()`, `questConsequences` (`trigger/quest.ts`), `restockShop()` (`shop.system.ts`). | Registers `dyn_*` quest in `state.dynamicQuests` and grants it via `grantQuest()` into `QuestLogComponent`. | `src/types/trigger.types.ts`, `src/rendering/ui/trigger_composer.ui.ts`, `public/data/campaigns/*/quest_templates.json`. |
| **4. `failQuest()` + `fail_quest` consequence + `quest.ui.ts` (`isHidden`, `'failed'` styling, reward preview)** | `failQuest()` (`quest.system.ts`), `questConsequences` (`trigger/quest.ts`). | `rebuildQuestTriggers()` evicts failed quest triggers; `renderQuestJournal()` (`quest.ui.ts`) hides `isHidden` quests, styles `'failed'` in red, and displays rewards. | `src/types/events.types.ts` (`QuestFailed`), `src/rendering/ui/trigger_composer.ui.ts`, `tests/`. |
| **5. Multi-stage `nextQuestId` on `QuestSchema`** | Authored in `quests.json`; triggered at the end of `completeQuest()`. | Calls `grantQuest(nextState, questDef.nextQuestId)` automatically; validated by `quest.validator.ts`. | `src/types/quests.types.ts`, `public/data/campaigns/default/quests.json`, `docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`, `docs/MILESTONES.md`. |
