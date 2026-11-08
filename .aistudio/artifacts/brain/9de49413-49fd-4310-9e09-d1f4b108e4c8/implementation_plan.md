# Implementation Plan — Milestone 122: End-to-End Quest & Narrative Lifecycle Wiring

## 1. Architectural Alignment & Ground Rules
- **No `any` & Strictest TypeScript:** `exactOptionalPropertyTypes: true`, explicit returns, and typed params.
- **Inversion of Responsibility (Option 2C):** Replace the open-ended `for-if` in `completeQuest()` with an exhaustive `QuestRewardApplierMap` dictionary (`satisfies QuestRewardApplierMap`) delegating to pure ECS domain mutators (`grantXp`, `grantItemToActor`, `modifyActorFactionStanding`, custom events).
- **Universal Objective Emission & Retroactive Verification:**
  - `'kill'` $\rightarrow$ `death.system.ts` (existing)
  - `'talk'` $\rightarrow$ `dialogue.system.ts` (existing)
  - `'gather'` $\rightarrow$ `inventory.system.ts` (`processPickUpIntent`) & `grantQuest` retroactive inventory count
  - `'explore'` $\rightarrow$ `map.system.ts` (`processChangeAreaIntent`) & `grantQuest` retroactive current area check
  - `'interact'` $\rightarrow$ `apply.system.ts` (`processApplyIntent`)
- **Complete Quest State Machine:** Add `failQuest()`, `fail_quest` trigger consequence, `GameEventType.QuestFailed`, and journal UI updates.
- **Procedural Bounties & Shop Restock:** Fix `targetTags` filter bug in `procedural-quest.system.ts`, add `generate_procedural_quest` consequence, and auto-grant dynamic restock quests in `shop.system.ts`.
- **Multi-Stage Quests:** Add optional `nextQuestId` to `QuestSchema` and auto-grant next stage on quest completion.
- **Validation & Documentation:** Upgrade `quest.validator.ts` and sync `MILESTONES.md`, `QUEST_AND_NARRATIVE_ARCHITECTURE.md`, and `ARCHITECTURE.md`.

---

## 2. Step-by-Step Implementation Sequence

### Step 1: Extend Schemas & Events (`src/types/quests.types.ts`, `src/types/events.types.ts`, `src/types/events/interaction_events.types.ts`, `src/types/trigger.types.ts`)
- **`src/types/quests.types.ts`:**
  - Add optional `nextQuestId: z.string().optional()` to `QuestSchema`.
- **`src/types/events.types.ts` & `src/types/events/interaction_events.types.ts`:**
  - Add `QuestFailed = 'QuestFailed'` to `GameEventType` enum.
  - Define `export interface QuestFailedEvent extends BaseGameEvent { readonly type: GameEventType.QuestFailed; readonly questId: string; }`.
  - Re-export `QuestFailedEvent` in `src/types/events.types.ts`.
- **`src/types/trigger.types.ts`:**
  - Add `{ type: z.literal('fail_quest'), targetId: z.string().optional(), questId: z.string().optional() }` to `ConsequenceActionSchema`.
  - Add `{ type: z.literal('generate_procedural_quest'), templateId: z.string() }` to `ConsequenceActionSchema`.

### Step 2: Implement `QuestRewardApplierMap`, Retroactive Objective Checks, `failQuest`, and Multi-Stage Chaining (`src/systems/quest.system.ts`)
- Define `QuestRewardApplier<K>` and `QuestRewardApplierMap`:
  ```ts
  export type QuestRewardApplier<K extends QuestReward['type']> = (
    state: GameState,
    recipientId: EntityId,
    reward: Extract<QuestReward, { type: K }>,
    questId: string
  ) => GameState;
  ```
- Implement `QUEST_REWARD_APPLIERS`:
  - `'xp'`: Calls `grantXp(state, recipientId, reward.amount ?? 0)` and logs `"+X XP"`.
  - `'item'`: Spawns `amount ?? 1` items via `spawnItem(state, reward.itemId, pos.x, pos.y)`. If inventory has room, removes `PositionComponent` and adds to `InventoryComponent.items`. If full, leaves on ground at player's feet and informs the player via message log. Emits `processQuestEvent(state, 'gather', reward.itemId, amount)`.
  - `'standing'`: Adjusts `MemoryComponent.factionStandings[reward.factionId]` by `reward.amount ?? 0` and logs message.
  - `'event'`: Emits `{ type: GameEventType.WorldEventFired, eventId: reward.eventType }` (or appends custom event to `state.events`).
- Replace `for-if` in `completeQuest`:
  - Iterate `questDef.rewards` using `QUEST_REWARD_APPLIERS[reward.type](nextState, playerId, reward, questId)`.
  - If `questDef.nextQuestId`, call `grantQuest(nextState, playerId, questDef.nextQuestId)`.
- Implement `failQuest(state: GameState, playerId: EntityId, questId: string): GameState`:
  - Sets `status: 'failed'`, logs `Quest Failed: ${questDef.title}`, emits `GameEventType.QuestFailed`, rebuilds triggers.
- Update `grantQuest`:
  - Calculate retroactive progress for `'gather'` objectives: inspect player's `InventoryComponent.items` and count items with matching `itemComp.itemId === obj.targetId`.
  - Calculate retroactive progress for `'explore'` objectives: if `state.currentAreaId === obj.targetId`, set progress to `1`.
  - If retroactive progress satisfies completion criteria and `questDef.autoComplete !== false`, immediately call `completeQuest`.

### Step 3: Wire Missing Objective Emitters across Systems
- **`'gather'` in `src/systems/inventory.system.ts`:**
  - In `processPickUpIntent`, after adding item to inventory and checking if player:
    ```ts
    const itemComp = getComponent(nextState, itemEntityId, ComponentType.Item) as ItemComponent | undefined;
    if (itemComp && getComponent(nextState, entityId, ComponentType.Player)) {
      nextState = processQuestEvent(nextState, 'gather', itemComp.itemId, 1);
    }
    ```
- **`'explore'` in `src/systems/map.system.ts`:**
  - In `processChangeAreaIntent`, when `entityId` is player:
    ```ts
    if (getComponent(nextState, entityId, ComponentType.Player)) {
      nextState = processQuestEvent(nextState, 'explore', targetAreaId, 1);
    }
    ```
- **`'interact'` in `src/systems/apply.system.ts`:**
  - In `processApplyIntent`, when `result.success` and acting entity is player:
    - If `intent.target.type === 'entity'`, lookup target entity's `TemplateComponent`. If found, call `processQuestEvent(result.state, 'interact', templateComp.templateId, 1)`.

### Step 4: Fix Procedural Quest Tag Filtering, Notice Board Consequence & Merchant Supply Restock
- **`src/systems/procedural-quest.system.ts`:**
  - Fix lines 24–34:
    ```ts
    if (template.targetTags && template.targetTags.length > 0) {
      const entityTags = entityDef.tags ?? [];
      const roleTags = entityDef.roleTags ?? [];
      const allTags = [...entityTags, ...roleTags];
      const hasMatchingTag = template.targetTags.some((tag) => allTags.includes(tag));
      if (!hasMatchingTag) return false;
    }
    ```
- **`src/systems/trigger/quest.ts`:**
  - Implement `fail_quest` consequence calling `failQuest(state, playerId, questId)`.
  - Implement `generate_procedural_quest` consequence calling `generateProceduralQuest(state, templateId)` and granting the generated quest to `playerId`.
- **`src/systems/shop.system.ts`:**
  - When posting a dynamic restock quest in `restockShop`, find player entity ID and call `grantQuest(nextState, playerId, questId)` so the supply contract is actively given to the player.

### Step 5: Quest Journal UI & Validator Polish (`src/rendering/ui/quest.ui.ts`, `src/editor/validator/quest.validator.ts`)
- **`src/rendering/ui/quest.ui.ts`:**
  - Skip hidden quests: `if (questDef.isHidden) continue;`.
  - Style status header:
    - `'completed'` $\rightarrow$ `#2ecc71` (green)
    - `'failed'` $\rightarrow$ `#e74c3c` (red)
    - `'active'` $\rightarrow$ `#f1c40f` (gold)
  - Display status badge: `[Active]`, `[Completed]`, `[Failed]`.
  - Add Rewards preview section:
    - Lists XP, item rewards (with quantity and name), and faction standing.
- **`src/editor/validator/quest.validator.ts`:**
  - Validate `'explore'` target ID against `campaign.areas[targetId]`.
  - Validate `'interact'` and `'talk'` target IDs against `campaign.entities[targetId]`.
  - Exhaustively validate `quest.rewards` (`switch (reward.type)` + `assertNever(reward)`):
    - Check `'item'` reward `itemId` exists in `campaign.items`.
    - Check `'standing'` reward `factionId` exists in `campaign.factions`.
  - If `quest.nextQuestId`, validate that `campaign.quests[quest.nextQuestId]` exists.

### Step 6: Documentation, SSOT & Milestones Update
- Update `docs/MILESTONES.md`: Add **Milestone 122: End-to-End Quest & Narrative Lifecycle Wiring**.
- Update `docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`: Mark all 5 gaps resolved and detail the `QuestRewardApplierMap` and objective lifecycle.
- Update `docs/ARCHITECTURE.md` (Section 7.3): Summarize the reactive quest engine.
- Run `./verify.sh` to ensure all 8 stages pass with 0 errors.

---

## 3. Precise Code Diffs

### Diff 1: `src/types/quests.types.ts`
```diff
--- a/src/types/quests.types.ts
+++ b/src/types/quests.types.ts
@@ -33,7 +33,8 @@ export const QuestSchema = z.object({
   rewards: z.array(QuestRewardSchema).optional(),
   isHidden: z.boolean().optional(), // If true, doesn't show in the main journal initially
-  autoComplete: z.boolean().optional() // If true, finishes instantly when objectives are met
+  autoComplete: z.boolean().optional(), // If true, finishes instantly when objectives are met
+  nextQuestId: z.string().optional() // Optional follow-up quest to grant upon completion
 });
```

### Diff 2: `src/types/events.types.ts` & `src/types/events/interaction_events.types.ts`
```diff
--- a/src/types/events/interaction_events.types.ts
+++ b/src/types/events/interaction_events.types.ts
@@ -94,6 +94,12 @@ export interface QuestCompletedEvent extends BaseGameEvent {
   readonly questId: string;
 }
 
+/** Fired when a quest fails. */
+export interface QuestFailedEvent extends BaseGameEvent {
+  readonly type: GameEventType.QuestFailed;
+  readonly questId: string;
+}
+
--- a/src/types/events.types.ts
+++ b/src/types/events.types.ts
@@ -32,6 +32,7 @@ import type {
   ItemUsedEvent,
   QuestCompletedEvent,
+  QuestFailedEvent,
   QuestStageChangedEvent,
@@ -74,6 +75,7 @@ export type {
   QuestStageChangedEvent,
   QuestCompletedEvent,
+  QuestFailedEvent,
   DebugTriggerTraceEvent,
@@ -109,6 +111,7 @@ export enum GameEventType {
   TrapTriggered = 'TrapTriggered',
   QuestStageChanged = 'QuestStageChanged',
   QuestCompleted = 'QuestCompleted',
+  QuestFailed = 'QuestFailed',
   DebugTriggerTrace = 'DebugTriggerTrace',
```

### Diff 3: `src/types/trigger.types.ts`
```diff
--- a/src/types/trigger.types.ts
+++ b/src/types/trigger.types.ts
@@ -128,6 +128,8 @@ export const ConsequenceActionSchema = z.discriminatedUnion('type', [
   z.object({ type: z.literal('grant_quest'), targetId: z.string().optional(), questId: z.string().optional() }),
   z.object({ type: z.literal('complete_quest'), targetId: z.string().optional(), questId: z.string().optional() }),
+  z.object({ type: z.literal('fail_quest'), targetId: z.string().optional(), questId: z.string().optional() }),
+  z.object({ type: z.literal('generate_procedural_quest'), templateId: z.string() }),
   z.object({ type: z.literal('modify_standing'), factionId: z.string(), amount: z.number() }),
```

### Diff 4: `src/systems/quest.system.ts`
```diff
--- a/src/systems/quest.system.ts
+++ b/src/systems/quest.system.ts
@@ -1,9 +1,10 @@
 import type { GameState } from '../types/game-state.types.ts';
-import { getComponent, addComponent } from '../core/ecs.ts';
-import { ComponentType, type QuestLogComponent } from '../types/components.types.ts';
-import type { Quest } from '../types/quests.types.ts';
+import { getComponent, addComponent, spawnItem, removeComponent } from '../core/ecs.ts';
+import { ComponentType, type QuestLogComponent, type InventoryComponent, type PositionComponent, type MemoryComponent, type ItemComponent } from '../types/components.types.ts';
+import type { Quest, QuestReward } from '../types/quests.types.ts';
 import { addMessage, MessageLogCategory } from './message.system.ts';
 import { grantXp } from './death.system.ts';
-import { GameEventType, type QuestCompletedEvent, type QuestStageChangedEvent } from '../types/events.types.ts';
+import { GameEventType, type QuestCompletedEvent, type QuestFailedEvent, type QuestStageChangedEvent } from '../types/events.types.ts';
 import type { QuestState } from '../types/components.types.ts';
 import type { EntityId } from '../types/game-state.types.ts';
 
+/** Mapped reward applier contract enforcing compile-time exhaustiveness. */
+export type QuestRewardApplier<K extends QuestReward['type']> = (
+  state: GameState,
+  recipientId: EntityId,
+  reward: Extract<QuestReward, { type: K }>,
+  questId: string
+) => GameState;
+
+export type QuestRewardApplierMap = {
+  readonly [K in QuestReward['type']]: QuestRewardApplier<K>;
+};
+
+export const QUEST_REWARD_APPLIERS: QuestRewardApplierMap = {
+  xp: (state, recipientId, reward) => {
+    const amount = reward.amount ?? 0;
+    if (amount <= 0) return state;
+    const nextState = grantXp(state, recipientId, amount);
+    return addMessage(nextState, `Gained ${amount} XP.`, MessageLogCategory.System);
+  },
+  item: (state, recipientId, reward) => {
+    const count = reward.amount ?? 1;
+    if (count <= 0) return state;
+    let nextState = state;
+    const inventory = getComponent(nextState, recipientId, ComponentType.Inventory) as InventoryComponent | undefined;
+    const pos = getComponent(nextState, recipientId, ComponentType.Position) as PositionComponent | undefined;
+    const px = pos?.x ?? 0;
+    const py = pos?.y ?? 0;
+
+    let currentInventoryItems = inventory ? [...inventory.items] : [];
+    const capacity = inventory?.capacity ?? 20;
+    let droppedOnGround = false;
+
+    for (let i = 0; i < count; i++) {
+      let itemEntityId: EntityId;
+      [nextState, itemEntityId] = spawnItem(nextState, reward.itemId, px, py);
+      if (currentInventoryItems.length < capacity) {
+        nextState = removeComponent(nextState, itemEntityId, ComponentType.Position);
+        currentInventoryItems.push(itemEntityId);
+      } else {
+        droppedOnGround = true;
+      }
+    }
+
+    if (inventory) {
+      nextState = addComponent(nextState, recipientId, { ...inventory, items: currentInventoryItems });
+    }
+
+    const itemName = nextState.campaign.items[reward.itemId]?.name ?? reward.itemId;
+    nextState = addMessage(nextState, `Received reward: ${count}x ${itemName}.`, MessageLogCategory.System);
+    if (droppedOnGround) {
+      nextState = addMessage(nextState, `Inventory full! Some items dropped at your feet.`, MessageLogCategory.System);
+    }
+    return processQuestEvent(nextState, 'gather', reward.itemId, count);
+  },
+  standing: (state, recipientId, reward) => {
+    const amount = reward.amount ?? 0;
+    const memory = getComponent(state, recipientId, ComponentType.Memory) as MemoryComponent | undefined;
+    if (!memory) return state;
+    const currentStandings = memory.factionStandings ?? {};
+    const newStanding = (currentStandings[reward.factionId] ?? 0) + amount;
+    const nextMemory: MemoryComponent = {
+      ...memory,
+      factionStandings: { ...currentStandings, [reward.factionId]: newStanding }
+    };
+    let nextState = addComponent(state, recipientId, nextMemory);
+    const sign = amount >= 0 ? `+${amount}` : `${amount}`;
+    return addMessage(nextState, `Faction standing with ${reward.factionId} changed by ${sign} (${newStanding}).`, MessageLogCategory.System);
+  },
+  event: (state, recipientId, reward) => {
+    return {
+      ...state,
+      events: [
+        ...state.events,
+        {
+          type: GameEventType.WorldEventFired,
+          eventId: reward.eventType
+        }
+      ]
+    };
+  }
+};
```

---

## 4. Cascading Effects Matrix (`AGENTS.md` Rule 15)

| Change | Upstream (Callers / Emitters / Authors) | Downstream (Consumers / Renderers / Validators) | Lateral (Sibling JSONs / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `QUEST_REWARD_APPLIERS` in `quest.system.ts`** | Invoked by `completeQuest()` for every reward in `questDef.rewards`. | Mutates `InventoryComponent` / `PositionComponent` via `spawnItem`, `MemoryComponent.factionStandings`, `grantXp`, and `state.events`. | `default/quests.json` (grants 2x health potion on tutorial quest completion), `quest.validator.ts`. |
| **2. Objective emitters (`gather`, `explore`, `interact`) & retroactive checks** | `processPickUpIntent` (`inventory.system.ts`), `processChangeAreaIntent` (`map.system.ts`), `processApplyIntent` (`apply.system.ts`), `grantQuest` (`quest.system.ts`). | `processQuestEvent` updates `objectiveProgress` $\rightarrow$ auto-completes quests upon meeting thresholds. | `quest.validator.ts` (checks explore area IDs and interact entity IDs), `tests/quest.test.ts`. |
| **3. `failQuest` and `fail_quest` consequence** | Triggers, dialogues, timeout checks. | Evicts active triggers, marks status `'failed'`, emits `QuestFailedEvent`, styles red in `quest.ui.ts`. | `src/types/trigger.types.ts`, `src/types/events.types.ts`, `docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`. |
| **4. Fix `targetTags` in `procedural-quest.system.ts` & shop restock grant** | Notice board consequence (`generate_procedural_quest`), `restockShop` in `shop.system.ts`. | Correctly queries entity tags, creates dynamic quest, and adds to `QuestLogComponent`. | `default/quest_templates.json`, `docs/MILESTONES.md`. |
| **5. Multi-stage chaining (`nextQuestId`)** | `completeQuest` reads `questDef.nextQuestId`. | Automatically grants next quest in chain via `grantQuest`. | `src/types/quests.types.ts`, `docs/QUEST_AND_NARRATIVE_ARCHITECTURE.md`. |

---

## 5. Verification Plan
- **Verification Pipeline:** Run `./verify.sh` covering:
  - TypeScript strict compile (`bun x tsc --noEmit`)
  - Formatting & linting (`bun run format:check && bun run lint`)
  - Architectural dependency check (`bun run lint:arch`)
  - Dead code check (`bun run lint:deadcode`)
  - Full test suite (`bun test`)
  - SSOT & Campaign Validation (`bun run scripts/run-validator.ts`)
- **Unit/Integration Test:** Add a comprehensive test suite in `tests/quest_lifecycle.test.ts` verifying:
  - Retroactive gather and explore progress on `grantQuest`.
  - All 4 reward types paid out via `QUEST_REWARD_APPLIERS`.
  - Objective emission for `gather`, `explore`, and `interact`.
  - Multi-stage chaining via `nextQuestId`.
  - `failQuest` lifecycle and event emission.
