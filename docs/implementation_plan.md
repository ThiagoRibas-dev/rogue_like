# Phase 31 (Milestone 131) Implementation Plan — Companion AI, Tactical Stance Packages & Command Directives

## 1. SSOT Ownership & Three-Tier Placement Table

| Responsibility | Tier | Canonical Owner |
| :--- | :--- | :--- |
| `CompanionStance` & `ControllerLinkComponent` tactical directives (`stance`, `commandTargetId`, `followDistance`, `leashRadius`) | Tier 1 (Console) | `src/types/components/actor_components.types.ts` |
| `follow` behavior schema variant | Tier 1 (Console) | `src/types/campaign/entity.ts` |
| `followBehavior` (pathing toward `controllerEntityId` with obstacle-sliding & `hold` check) | Tier 1 (Console) | `src/ai/follow.behavior.ts` |
| `resolveAITarget` & `sanitizeCompanionControllerLink` (leash, stance filter, focus-target priority) | Tier 1 (Console) | `src/ai/companion_targeting.ts` |
| Companion verbs (`command`, `order_attack`, `order_defend`, `order_follow`, `order_hold`, `order_target`), dynamic `__companion_orders__` dialogue tree, & target designation | Tier 1 (Console) | `src/constants/verbs.constants.ts`, `src/systems/companion_commands.system.ts`, `src/systems/apply.system.ts`, `src/systems/dialogue.system.ts`, `src/actions/dialogue.actions.ts`, `src/rendering/ui/dialogue.ui.ts`, `src/systems/targeting.system.ts`, `src/core/input/mouse_input.ts` |
| Declarative dialogue/trigger consequences (`set_companion_stance`, `order_companion_target`) | Tier 1 (Console) | `src/types/trigger.types.ts`, `src/systems/trigger/social_consequences.ts` |
| Friendly companion corridor bump-swap | Tier 1 (Console) | `src/systems/movement.system.ts` |
| Mid-session spawned `Actor` scheduler auto-enrollment (`addActor`) | Tier 1 (Console) | `src/core/game-loop.ts` |
| Inspect tooltip companion stance & focus target projection | Tier 1 (Console) | `src/rendering/inspect_tooltip.ts` |
| D&D 3.5e companion/familiar adjacent tile placement, `AIComponent` attachment, & stance preservation | Tier 2 (Cartridge) | `src/rulesets/dnd35e/companions.ts` |
| `companion_default` AI profile definition | Tier 3 (Content) | `public/data/campaigns/{default,dnd35e-crypt,megacampaign,shroudgarde}/ai.json`, `src/editor/blank_slate_campaign.ts` |

---

## 2. Cascading Effects Matrix (Rule 15)

| Change | Upstream | Downstream | Lateral |
| :--- | :--- | :--- | :--- |
| **`ControllerLinkComponent` (`stance`, `commandTargetId`, `followDistance`, `leashRadius`)** | `upsertLinkedServantActor` (`companions.ts`), `companion_commands.system.ts`, `social_consequences.ts`, `processAITurn` | `followBehavior`, `resolveAITarget` (`hunt`, `ranged`, `spell`), `buildInspectTooltip`, `save_roundtrip.test.ts`, `tests/companion_ai_commands.test.ts` | `src/types/components/actor_components.types.ts`, `src/types/components.types.ts` (re-export `CompanionStance`) |
| **`AIBehaviorEntrySchema` (`follow` variant)** | `ai.json` across all 4 campaigns, `blank_slate_campaign.ts` | `processAITurn` (`BEHAVIOR_REGISTRY`), `campaign_validator.ts` | `public/data/campaigns/*/ai.json` |
| **`Verb` & `VERBS` (`command`, `order_attack`, `order_defend`, `order_follow`, `order_hold`, `order_target`)** | `getValidVerbsForTarget`, `processInteractIntent` (`intent.system.ts`), `mouse_input.ts` (right-click verb menu), `verb_menu.ui.ts` | `processApplyIntent`, `processFireAimedIntent`, `handleCanvasLeftClick`, `resolveDialogueTree` (`dialogue.system.ts`, `dialogue.actions.ts`, `dialogue.ui.ts`), `createToggleTargetingAction` (`game-state.types.ts`, `combat.intents.ts`, `targeting.actions.ts`) | `src/constants/verbs.constants.ts`, `src/systems/companion_commands.system.ts` |
| **`ConsequenceActionSchema` (`set_companion_stance`, `order_companion_target`)** | `__companion_orders__` dialogue tree, campaign `dialogues.json` | `trigger.system.ts` (`consequenceAppliers`), `social_consequences.ts` | `src/types/trigger.types.ts` |
| **Corridor Friendly Bump-Swap (`processMoveIntent`)** | Player `MoveIntent` into a friendly `ControllerLink` companion | `updateSpatialIndex`, `runActorMovementStep`, message log | `src/systems/movement.system.ts` |
| **Mid-Session Scheduler Auto-Enrollment (`updateState` in `game-loop.ts`)** | `applyCharacterCreationToPlayer`, `applyLevelUpToActor`, `spawn_entity` | `ROT.Scheduler.Action` (`addActor`), `processTurn` | `src/core/game-loop.ts` |

---

## 3. Step-by-Step Implementation Plan & Code Snippets

### Step 1: Extend `ControllerLinkComponent` & `AIBehaviorEntrySchema`
- **File**: `src/types/components/actor_components.types.ts`
```ts
/**
 * Tactical stance package governing a controlled companion or minion's AI behavior.
 * - `'aggressive'`: Proactively hunts any hostile within aggroRadius (up to leashRadius from controller).
 * - `'defensive'`: Only engages hostiles within defendRadius of the controller or adjacent to self; otherwise follows.
 * - `'passive'`: Never initiates attacks; only follows the controller.
 * - `'hold'`: Holds current tile without moving; only attacks adjacent hostiles in melee (or ranged if capable).
 */
export type CompanionStance = 'aggressive' | 'defensive' | 'passive' | 'hold';

export interface ControllerLinkComponent {
  readonly type: ComponentType.ControllerLink;
  readonly controllerEntityId: EntityId;
  /** Open relationship tags (e.g. ['animal_companion', 'mount', 'familiar'], ['party_member', 'hireling'], ['summon', 'temporary_ally']). */
  readonly tags: ReadonlyArray<string>;
  readonly shareInitiative?: boolean | undefined;
  readonly expirationTurn?: number | undefined;
  readonly stance?: CompanionStance | undefined;
  readonly commandTargetId?: EntityId | undefined;
  readonly followDistance?: number | undefined;
  readonly leashRadius?: number | undefined;
}
```
- **File**: `src/types/campaign/entity.ts`
  - Add `'follow'` variant to `AIBehaviorEntrySchema`:
```ts
  z.object({
    behaviorId: z.literal('follow'),
    followDistance: z.number().int().positive().optional(),
    leashRadius: z.number().int().positive().optional(),
    weightModifiers: z.record(z.string(), z.number()).optional()
  }),
```
- **File**: `src/types/intents/combat.intents.ts`
  - Allow optional `companionEntityId?: EntityId` on `ToggleTargetingIntent['context']`:
```ts
  readonly context?:
    | {
        readonly verb: string;
        readonly toolEntityId?: EntityId;
        readonly companionEntityId?: EntityId;
      }
    | undefined;
```

---

### Step 2: Implement `companion_targeting.ts`, `follow.behavior.ts`, & Wire AI Behaviors
- **New File**: `src/ai/companion_targeting.ts`
  - Defines named constants:
    - `export const DEFAULT_COMPANION_FOLLOW_DISTANCE = 2;`
    - `export const DEFAULT_COMPANION_LEASH_RADIUS = 8;`
    - `export const DEFAULT_COMPANION_DEFEND_RADIUS = 3;`
    - `export const DEFAULT_COMPANION_SELF_DEFEND_RADIUS = 2;`
  - Exports `sanitizeCompanionControllerLink(state: GameState, entityId: EntityId): GameState` (clears `commandTargetId` if the target entity no longer exists or has `hp <= 0`).
  - Exports `resolveAITarget(state: GameState, entityId: EntityId, maxRange: number, fov?: ReadonlySet<number>): { readonly targetId: EntityId; readonly distance: number; readonly dx: number; readonly dy: number } | null`:
    - If `entityId` has a `ControllerLinkComponent`:
      1. Resolves `stance = link.stance ?? 'defensive'` and `leashRadius = link.leashRadius ?? DEFAULT_COMPANION_LEASH_RADIUS`.
      2. If `stance === 'passive'`, returns `null`.
      3. If `link.commandTargetId !== undefined` and the target is alive, in bounds, hostile (or designated), within `maxRange`, and in `fov` (when `fov` is provided):
         - If `stance === 'hold'` and `!fov` (melee `hunt`), requires `distance === 1`.
         - Returns `commandTargetId` immediately (focus-target override).
      4. Checks distance from `entityId` to `controllerEntityId`: if `stance !== 'hold'` and `distToController > leashRadius`, returns `null` so `hunt`/`ranged`/`spell` yield to `followBehavior` to pull the companion back within leash range.
      5. Scans `state.entities` for the nearest hostile within `maxRange` (and `fov` if provided):
         - If `stance === 'hold'` and `!fov` (melee `hunt`), only accepts targets with `distance === 1`.
         - If `stance === 'defensive'`, only accepts targets within `DEFAULT_COMPANION_DEFEND_RADIUS` (`3`) of the controller OR within `DEFAULT_COMPANION_SELF_DEFEND_RADIUS` (`2`) of the companion.
         - If `stance === 'aggressive'`, accepts any hostile within `maxRange` whose distance from the controller is $\le \text{leashRadius}$.
    - If `entityId` does NOT have a `ControllerLinkComponent`, scans for the nearest hostile within `maxRange` (and `fov` if provided), preserving 100% of existing monster AI behavior.
- **New File**: `src/ai/follow.behavior.ts`
  - Exports `followBehavior(state: GameState, entityId: EntityId, params: Readonly<Record<string, unknown>>): Intent | null`:
    - Reads `ControllerLinkComponent` and `PositionComponent`.
    - Returns `null` if `!link`, `link.stance === 'hold'`, or controller has no `PositionComponent`.
    - Computes Chebyshev distance to controller. If `distance <= followDistance` (`link.followDistance ?? (params.followDistance as number | undefined) ?? DEFAULT_COMPANION_FOLLOW_DISTANCE`), returns `null`.
    - Evaluates candidate step directions ordered by minimum resulting squared distance to controller, picking the first candidate tile that is in-bounds, traversable (`canTraverseTile`), and unoccupied by any `Fighter` or `Actor`, returning a `MoveIntent`.
- **Update**: `src/ai/hunt.behavior.ts`, `src/ai/ranged.behavior.ts`, `src/ai/spell.behavior.ts`, and `src/systems/ai.system.ts`:
  - `huntBehavior`, `rangedBehavior`, and `spellBehavior` call `resolveAITarget(...)`. Additionally, in `huntBehavior`, if `link?.stance === 'hold'` and `minDistance > 1`, returns `null` so a held companion never steps off its tile.
  - `processAITurn` (`src/systems/ai.system.ts`) registers `follow: followBehavior` in `BEHAVIOR_REGISTRY` and calls `sanitizeCompanionControllerLink(state, entityId)` at the start of the AI turn.

---

### Step 3: Companion Command System, Verbs, Dialogue Consequences & Corridor Swap
- **File**: `src/constants/verbs.constants.ts`
  - Add `'command' | 'order_attack' | 'order_defend' | 'order_follow' | 'order_hold' | 'order_target'` to `Verb` and `VERBS`.
- **New File**: `src/systems/companion_commands.system.ts`
  - Exports:
    - `COMPANION_ORDERS_DIALOGUE_ID = '__companion_orders__'`
    - `isPlayerControlledCompanion(state: GameState, controllerId: EntityId, targetId: EntityId): boolean`
    - `getPlayerCompanions(state: GameState, controllerId: EntityId): ReadonlyArray<EntityId>`
    - `setCompanionStance(state: GameState, companionId: EntityId, stance: CompanionStance): GameState` (updates `ControllerLinkComponent.stance`, clears `commandTargetId` if switching to `'passive'`, and logs a clear tactical bark/message e.g. `"Wolf switches to Aggressive stance (Attack Proactively)."`).
    - `assignCompanionCommandTarget(state: GameState, controllerId: EntityId, targetEnemyId: EntityId, specificCompanionId?: EntityId): { readonly state: GameState; readonly success: boolean }` (sets `commandTargetId: targetEnemyId` on `specificCompanionId` or all player companions, upgrades `'passive'` stance to `'defensive'` so they engage, and logs `"You order <Companion> to focus attacks on <Target>!"`).
    - `buildCompanionOrdersDialogueTree(state: GameState, companionId: EntityId): DialogueTree` (synthesizes the branching dialogue tree for `COMPANION_ORDERS_DIALOGUE_ID` showing current stance & focus target, with options to set stance to Aggressive, Defensive, Passive, Hold, or Designate Focus Target).
    - `getValidCompanionVerbsForTarget(state: GameState, sourceEntityId: EntityId, target: ApplyIntentTarget): ReadonlyArray<Verb>`:
      - If `target.type === 'entity'` and `isPlayerControlledCompanion(state, sourceEntityId, target.entityId)`: returns `['command', 'order_attack', 'order_defend', 'order_follow', 'order_hold', 'order_target']`.
      - If `target.type === 'entity'` and `isHostile(state, sourceEntityId, target.entityId)` and `getPlayerCompanions(state, sourceEntityId).length > 0`: returns `['order_target']`.
    - `processCompanionVerbIntent(state: GameState, intent: ApplyIntent): { state: GameState; success: boolean; events?: readonly GameEvent[] } | null`.
- **Update**: `src/systems/apply.system.ts`
  - In `processApplyIntent`: delegate companion verbs (`command`, `order_attack`, `order_defend`, `order_follow`, `order_hold`, `order_target`) to `processCompanionVerbIntent`.
  - In `getValidVerbsForTarget`: include `getValidCompanionVerbsForTarget(state, sourceEntityId, target)`.
- **Update**: `src/systems/dialogue.system.ts`, `src/actions/dialogue.actions.ts`, `src/rendering/ui/dialogue.ui.ts`, and `src/systems/intent.system.ts`:
  - Export `resolveDialogueTree(state: GameState, treeId: string, npcEntityId: EntityId): DialogueTree | undefined` from `src/systems/dialogue.system.ts` (returns `buildCompanionOrdersDialogueTree(state, npcEntityId)` when `treeId === COMPANION_ORDERS_DIALOGUE_ID`, otherwise `state.campaign.dialogues[treeId]`).
  - Use `resolveDialogueTree` in `startDialogue`, `processSelectDialogueOptionIntent`, and `renderDialoguePanel` (also using `resolveEntityDisplayName(state, npcEntityId)` for the dialogue modal title so companions and named NPCs show their true name instead of `'Unknown'`).
  - In `processInteractIntent` (`src/systems/intent.system.ts`), if `targetId` has no `DialogueComponent` but is a player-controlled companion (`ControllerLinkComponent`), open `startDialogue(state, targetId, COMPANION_ORDERS_DIALOGUE_ID)`.
- **Update**: `src/types/trigger.types.ts` & `src/systems/trigger/social_consequences.ts`:
  - Add to `ConsequenceActionSchema`:
    - `z.object({ type: z.literal('set_companion_stance'), stance: z.enum(['aggressive', 'defensive', 'passive', 'hold']), targetId: z.string().optional() })`
    - `z.object({ type: z.literal('order_companion_target'), targetId: z.string().optional() })`
  - Implement both appliers in `socialConsequences`.
- **Update**: `src/systems/targeting.system.ts` & `src/core/input/mouse_input.ts`:
  - When `state.targetingMode.context?.verb === 'order_target'` and the player confirms targeting on a tile (`processFireAimedIntent` or `handleCanvasLeftClick`), find the hostile actor on `(targetX, targetY)` and call `assignCompanionCommandTarget`.
- **Update**: `src/systems/movement.system.ts`:
  - In `processMoveIntent`, when `defenderId === undefined && blockedByEntityId !== undefined`:
    - Check if `blockedByEntityId` is a friendly companion linked to `entityId` (or vice versa when `entityId` is the controller) and lacks a custom `DialogueComponent`.
    - Verify the mover's origin tile `(position.x, position.y)` is traversable by `blockedByEntityId` (`canTraverseTile`).
    - Swap their `PositionComponent`s, run `runActorMovementStep` for both, set `fovNeedsUpdate: true` if player, and log `"You swap places with <Name>."`.
- **Update**: `src/rendering/inspect_tooltip.ts`:
  - In `appendEntityComponentSections`, if the inspected entity has a `ControllerLinkComponent`, display `Stance: <Aggressive | Defensive | Passive | Hold>` and (if `commandTargetId` is set) `Target: <TargetName>`.

---

### Step 4: Scheduler Auto-Enrollment & Tier 2/Tier 3 Companion Wiring
- **File**: `src/core/game-loop.ts`
  - Import `addActor` from `./scheduler.ts`.
  - In `updateState(newState)`: if `prevState === null || prevState.entities !== newState.entities`, loop over `newState.entities` and for any `id` with `getComponent(newState, id, ComponentType.Actor) !== undefined`, call `addActor(id)`.
- **File**: `src/rulesets/dnd35e/companions.ts`
  - In `upsertLinkedServantActor`:
    - When updating an existing companion (`existingId !== undefined`), preserve `existingLink.stance`, `existingLink.commandTargetId`, `existingLink.followDistance`, and `existingLink.leashRadius`, and ensure `ComponentType.AI` (`profileId: 'companion_default'`) is present.
    - When creating a new companion, pick the first unoccupied walkable tile adjacent to `masterPos` (8-direction ring, falling back to `masterPos`), attach `AIComponent` (`{ type: ComponentType.AI, profileId: 'companion_default' }`), set default `stance: tags.includes('familiar') ? 'passive' : 'defensive'`, and initialize `EquipmentComponent` (`buildAnatomyEquipmentSlots`) + `InventoryComponent`.
- **Files**: `public/data/campaigns/{default,dnd35e-crypt,megacampaign,shroudgarde}/ai.json` & `src/editor/blank_slate_campaign.ts`
  - Add `"companion_default"`:
```json
  "companion_default": {
    "id": "companion_default",
    "behaviors": [
      {
        "behaviorId": "hunt",
        "aggroRadius": 6
      },
      {
        "behaviorId": "follow",
        "followDistance": 2,
        "leashRadius": 8
      }
    ]
  }
```
- **SSOT & Tests**:
  - Register `src/ai/follow.behavior.ts`, `src/ai/companion_targeting.ts`, and `src/systems/companion_commands.system.ts` in `docs/ssot/ssot_console.json` and regenerate `docs/SSOT_CONSOLE.md`.
  - Add comprehensive unit & integration tests in `tests/companion_ai_commands.test.ts` covering:
    1. Companion spawning with `AIComponent` on an adjacent walkable tile.
    2. `followBehavior` pathing toward master when out of combat and stopping within `followDistance`.
    3. Stance packages: `'passive'` (never attacks, only follows), `'defensive'` (ignores distant hostiles, attacks hostiles near master), `'aggressive'` (hunts hostiles up to `leashRadius`, leashes back if too far), `'hold'` (stays on tile, only attacks adjacent hostiles).
    4. Focus-target directive (`commandTargetId` via `order_target` verb and targeting mode) overriding nearest-hostile selection and auto-clearing when the target dies.
    5. Corridor bump-swap between player and companion.
    6. Companion command dialogue (`__companion_orders__`) and `set_companion_stance` consequence execution.
