# Implementation Plan — Entity Name Fallback Chain (`Name -> id -> icon`), RimWorld Turn Ribbon, Rest & Natural Healing Rules, and UI Contrast Fixes

## 1. Architectural Rules & Standards Reiteration

Per `AGENTS.md` and `docs/ARCHITECTURE.md`:
- **Zero `any` & Strict TypeScript (`exactOptionalPropertyTypes: true`):** All functions have explicit return types and JSDoc annotations.
- **Zero Magic Values (Rule 12):** Named constants for all gameplay numbers (`ROUNDS_PER_HOUR = 600`, `EIGHT_HOURS_IN_ROUNDS = 4800`, `OPEN_SLOT_PREPARATION_ROUNDS = 150`, `RTWP_IDLE_WAIT_DURATION = 10`).
- **Three-Tier Placement Heuristic (Rule 16):**
  - **Tier 1 (`src/core/`, `src/systems/`, `src/rendering/`):** Canonical `resolveEntityDisplayName` (`Name -> id -> icon`) in `src/core/ecs/ecs_core.ts`, scheduler turn/cooldown queries in `src/core/scheduler.ts`, RimWorld-style top-right turn ribbon in `src/rendering/ui/hud_alerts.ui.ts`, and Parchment/CRT CSS custom properties in `src/styles/console_prototype.css` & `src/styles/modals.css`.
  - **Tier 2 (`src/rulesets/dnd35e/`, `src/rendering/ui/dnd35e_*.ts`):** Character Creation `characterName` field & `IdentityComponent` hydration, D&D 3.5e 8-hour rest & spell preparation safety/recovery rules, hourly `nonlethalDamage` natural healing & magical healing coupling, and D&D 3.5e combat/lifecycle log message resolution.
  - **Tier 3 (`public/data/campaigns/default/entities.json`):** Add `"name": "Adventurer"` to the `"player"` entity template.
- **Universal Actor Symmetry (Rule 18):** 8-hour rest and natural healing apply symmetrically to the player and active party companions (`getPlayerCompanions`), honoring creature anatomy (`CON === null` non-living immunity) and total Hit Dice (`chassis.totalHD`).
- **Zero Content-ID Branching (Rule 21):** No hardcoded `templateId`, `spellId`, or `featId` checks in `.ts` logic.

---

## 2. SSOT Ownership & Old-Brain Eviction Table

| Responsibility | Legacy / Split-Brain Location | Canonical SSOT Owner | Action |
| :--- | :--- | :--- | :--- |
| **Entity & Item Display Name Resolution (`Name -> id -> icon`)** | Ad-hoc `renderable.glyph` or `identity?.name` lookups scattered across `death.system.ts`, `classic_combat.ts`, `status-effect.system.ts`, `effects.system.ts`, `spatial_effects.ts`, `trigger/*.ts`, `bull_rush_resolver.ts`, `retaliation_resolver.ts`, etc. | `src/core/ecs/ecs_core.ts` (`resolveEntityDisplayName`, re-exported via `src/core/ecs.ts` and `src/rendering/inspect_tooltip.ts`) | Evict all inline glyph/identity-only name lookups and delegate to `resolveEntityDisplayName(state, entityId, fallback)`. |
| **8-Hour Spell Slot Recovery & Recent Casting Limit** | Duplicate manual loop in `src/rendering/ui/dnd35e_rest_actions.ts` resetting `used = 0` & `expended = false` while ignoring `src/rulesets/dnd35e/magic/aoe_rest.ts` (`resolveEightHourRest`) | `src/rulesets/dnd35e/magic/aoe_rest.ts` (`resolveEightHourRest` + `prepareOpenSpellSlot`) | Stamp `castTimestampTurn: state.globalTurn` in `expendCasterSpellSlot` (`spell_cast_helpers.ts`) and delegate spellbook rest recovery in `dnd35e_rest_actions.ts` to `resolveEightHourRest`. |
| **Full Resource Pool Recovery on 8-Hour Rest** | `refreshResourcePools(state, id, 'rest_8h')` only resetting pools with `refreshCycle === 'rest_8h'` | `src/core/ecs/ecs_lifecycle.ts` (`refreshResourcePools` — `'rest_8h'` resets all rest/short_rest/encounter/round pools) + `syncActorResourcePoolsComponent` after ability damage heals | Ensure `'rest_8h'` refreshes all pool cycles (`'rest_8h'`, `'short_rest'`, `'encounter'`, `'round'`) after syncing ability-dependent pool maximums. |

---

## 3. Declarative Purity & Anti-Hardcoding Audit Table (Rule 21)

| Behavior | Rejected Imperative Shortcut | Chosen Declarative Schema / JSON Mechanism | Passes "New Content Mod" Litmus Test? |
| :--- | :--- | :--- | :--- |
| **Player Default Display Name** | `if (templateId === 'player') return 'Adventurer'` | Add `"name": "Adventurer"` to `"player"` in `public/data/campaigns/default/entities.json` + hydrate `IdentityComponent` from `CharacterCreationDraft.characterName` | **Yes** — Any campaign JSON can rename the player template or define custom actor names without editing `.ts`. |
| **Entity / Item Name Resolution (`Name -> id -> icon`)** | Checking hardcoded template IDs or ad-hoc glyph strings per system | Generic component cascade: `Identity.name` -> `campaign.entities[templateId]?.name` / `campaign.items[itemId]?.name` -> `templateId` / `itemId` -> `Renderable.glyph` | **Yes** — Works automatically for any new creature, item, field, or feature added in JSON. |
| **Non-Living Natural Healing Immunity** | `if (raceId === 'skeleton' \|\| raceId === 'iron_golem')` | Check `dag.dagResult.abilityBreakdowns?.con?.effectiveScore === null` (`CON === null` from creature type / racial schema) | **Yes** — Any new Undead or Construct race/template with `CON: null` automatically skips natural healing. |

---

## 4. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Serializers) | Lateral (Sibling Systems / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **1. `resolveEntityDisplayName` (`Name -> id -> icon`) & Character Creation `characterName`** | `ecs_core.ts`, `ecs.ts`, `builder_core.ts`, `builder_hydrator_creation.ts` (preserves `mannerisms` on `IdentityComponent`), `dnd35e_char_builder.ui.ts`, `entities.json` | `death.system.ts`, `classic_combat.ts`, `status-effect.system.ts`, `effects.system.ts`, `spatial_effects.ts`, `shop.system.ts`, `scheme_recruitment.ts`, `trigger/*.ts`, `projectile.system.ts`, `zap.system.ts`, `message.system.ts`, `movement.system.ts`, `personality.system.ts`, `dnd35e_lifecycle_adapter.ts`, D&D 3.5e combat/reaction/light resolvers, `investigation.ui.ts`, `dossier.ui.ts`, `dossier_hierarchies.ui.ts`, `factions.ui.ts`, `dnd35e_spellbook_actions.ts`, `dnd35e_sheet_companions_tab.ui.ts`, `dnd35e_ui_char_sheet.ts`, `classic_ui_adapter.ts` | `inspect_tooltip.ts` re-exports `resolveEntityDisplayName`; `tests/hud_rest_and_display_name.test.ts` |
| **2. RimWorld Top-Right Current Turn / Action Readiness Ribbon** | `scheduler.ts` (`getActiveTurnActorId`, `getActorRemainingScheduleTime`, `isTurnProcessingActive`), `scheduler.constants.ts` (`RTWP_IDLE_WAIT_DURATION`), `game-loop.ts` | `hud_alerts.ui.ts` (`isActorPerceivedByPlayer`, `buildTurnStatusRibbon`, `renderHudAlerts`), `hud.css` (`.hud-alert-ribbon.alert-turn-ready`) | Perception check via `state.cachedFov` / `isFullyExplored` and stealth (`invisible` status/condition); `setHoveredTile` click focus; `tests/hud_rest_and_display_name.test.ts` |
| **3. 8-Hour Rest Safety Gating, Full Resource/Spell Recovery, Open-Slot Prep & Hourly Nonlethal Healing** | `cartridge_ui_registry.ts` (`onTrigger`), `modal_input.ts`, `shortcut_input.ts`, `hud_dock.ui.ts`, `dnd35e_ui_registration.ts` (`Rest (8h)` hotkey `t`), `dnd35e_rest_recovery.ts` (`evaluateActorRestSafety`, `applyEightHourRestToActor`), `dnd35e_rest_actions.ts`, `dnd35e_spellbook_actions.ts`, `dnd35e_spellbook_known.ui.ts`, `spell_cast_helpers.ts`, `world_clock.system.ts`, `world_time_skip.ts`, `world_clock.constants.ts`, `ruleset.types.ts` (`onWorldHourElapsed`) | `aoe_rest.ts` (`resolveSpellbookEightHourRest`, `prepareOpenDnD35Slot`), `ecs_lifecycle.ts` (`refreshResourcePools`), `dnd35e_lifecycle_adapter.ts` (`onDnD35eWorldHourElapsed`, checking `con.effectiveScore === null`), `spell_cast_effects.ts` (magical healing reduces `nonlethalDamage`), `companions.ts` (`getPlayerCompanions`) | `tests/dnd35e_spell_casting.test.ts`, `tests/hud_rest_and_display_name.test.ts`, `docs/ssot/ssot_console.json`, `docs/ssot/ssot_dnd35e.json` |
| **4. Parchment & CRT UI Font Color / Contrast Fixes** | `console_prototype.css` (both `[data-console-theme='parchment']` and `[data-console-theme='retro-crt']` + semantic chip tokens), `modals.css` | `dnd35e_inspector.ui.ts`, `dnd35e_char_builder_skills.ui.ts`, `.dnd35-counter-val`, `.dnd35-fullscreen-modal .modal-close-btn`, `.crpg-condition-chip.*`, `.crpg-stance-badge.*`, `.crpg-pool-use-btn` | `tests/hud_rest_and_display_name.test.ts` CSS regression assertions |

---

## 5. Step-by-Step Implementation Plan & Code Diffs

### Step 1: Canonical `resolveEntityDisplayName` (`Name -> id -> icon`) & Character Creation Name Field

#### 1A. `public/data/campaigns/default/entities.json`
Add `"name": "Adventurer"` to the `"player"` template:
```json
  "player": {
    "id": "player",
    "name": "Adventurer",
    "glyph": "@",
    "color": "#ffffff",
```

#### 1B. `src/core/ecs/ecs_core.ts` & `src/core/ecs.ts` & `src/rendering/inspect_tooltip.ts`
Add `resolveEntityDisplayName(state: GameState, entityId: EntityId, fallback?: string): string` to `src/core/ecs/ecs_core.ts` and re-export it from `src/core/ecs.ts` and `src/rendering/inspect_tooltip.ts`:
```ts
/**
 * Resolves the human-readable display name for any entity or item reactively from its ECS components
 * using the strict fallback hierarchy: Name -> ID -> Icon (glyph) -> fallback.
 *
 * @param state The current GameState.
 * @param entityId The target entity ID.
 * @param fallback Optional fallback label if the entity has no name, ID, or glyph.
 * @returns The resolved display name string.
 */
export function resolveEntityDisplayName(state: GameState, entityId: EntityId, fallback?: string): string {
  const identity = getComponent(state, entityId, ComponentType.Identity);
  if (identity && identity.name.trim().length > 0) {
    return `${identity.name} ${identity.title ?? ''}`.trim();
  }

  const item = getComponent(state, entityId, ComponentType.Item);
  if (item) {
    const itemDef = state.campaign.items[item.itemId];
    const isIdentified = state.identifiedItems.has(item.itemId);
    const resolvedItemName = isIdentified
      ? itemDef?.name
      : (state.itemUnidentifiedNames.get(item.itemId) ?? itemDef?.unidentifiedName);
    if (resolvedItemName && resolvedItemName.trim().length > 0) {
      return resolvedItemName;
    }
    if (item.itemId.trim().length > 0) {
      return item.itemId;
    }
  }

  const field = getComponent(state, entityId, ComponentType.Field);
  if (field) {
    return state.campaign.fields[field.fieldType]?.name ?? field.fieldType;
  }

  const template = getComponent(state, entityId, ComponentType.Template);
  if (template) {
    const templateDef = state.campaign.entities[template.templateId];
    if (templateDef?.name && templateDef.name.trim().length > 0) {
      return templateDef.name;
    }
    if (template.templateId.trim().length > 0) {
      return template.templateId;
    }
  }

  if (getComponent(state, entityId, ComponentType.Player) !== undefined) {
    return 'Adventurer';
  }

  const portal = getComponent(state, entityId, ComponentType.Portal);
  if (portal) {
    const targetAreaName = state.campaign.areas[portal.targetAreaId]?.name ?? portal.targetAreaId;
    return `Passage (${targetAreaName})`;
  }

  const renderable = getComponent(state, entityId, ComponentType.Renderable);
  if (renderable && renderable.glyph.trim().length > 0) {
    return renderable.glyph;
  }

  if (fallback !== undefined) {
    return fallback;
  }
  return getComponent(state, entityId, ComponentType.Actor) !== undefined ? 'Actor' : 'Feature';
}
```

#### 1C. Character Name Field in Character Creation (`src/rulesets/dnd35e/builder/builder_core.ts`, `src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`, `src/rendering/ui/dnd35e_char_builder.ui.ts`)
- Add `readonly characterName?: string | undefined;` to `CharacterCreationDraft` in `builder_core.ts` (defaulting to `'Adventurer'` in `createDefaultDraft()`).
- In `applyCharacterCreationToPlayer` (`builder_hydrator_creation.ts`), attach/update `IdentityComponent` preserving existing `mannerisms` and optional fields:
  ```ts
  const resolvedName = (draft.characterName ?? '').trim() || 'Adventurer';
  const existingIdentity = getComponent(runningState, entityId, ComponentType.Identity);
  runningState = addComponent(runningState, entityId, {
    ...(existingIdentity ?? {}),
    type: ComponentType.Identity,
    name: resolvedName,
    mannerisms: existingIdentity?.mannerisms ?? []
  });
  ```
- In `renderDnD35eCharBuilderModal` (`src/rendering/ui/dnd35e_char_builder.ui.ts`), render a clean Character Name input bar right above/alongside the wizard step tabs so the player can enter their character's name at any step of character creation without losing focus.

#### 1D. Wire All Message & UI Label Call Sites to `resolveEntityDisplayName`
Update all identified call sites to use `resolveEntityDisplayName(state, entityId, fallback)`:
- **Tier 1 Systems:**
  - `src/systems/death.system.ts` (lines 57, 93, 160, 201 — fixes `"@ dies!"`, killer name, item drops, and mastermind death log)
  - `src/rulesets/classic/classic_combat.ts` (lines 73–74, 261 — fixes `"@ hits g"` and cleave victim name)
  - `src/systems/status-effect.system.ts` (line 34 — fixes `"@ suffers from afflictions."`)
  - `src/systems/effects.system.ts` (lines 66, 83, 198, 244)
  - `src/systems/effects/spatial_effects.ts` (lines 90, 141, 189, 225, 237)
  - `src/systems/shop.system.ts` (line 59)
  - `src/systems/scheme/scheme_recruitment.ts` (line 100)
  - `src/systems/trigger/player.ts` (line 207 — resolves coated item entity name via `resolveEntityDisplayName`)
  - `src/systems/trigger/quest.ts` (line 72)
  - `src/systems/trigger/systemic.ts` (line 59)
  - `src/systems/projectile.system.ts` (line 158) & `src/systems/zap.system.ts` (line 56)
  - `src/systems/message.system.ts` (lines 69–70) & `src/systems/movement.system.ts` (lines 292–293)
- **Tier 2 D&D 3.5e Resolvers:**
  - `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (lines 147, 153, 159)
  - `src/rulesets/dnd35e/combat/combat_exchange_phases.ts` (lines 195–196)
  - `src/rulesets/dnd35e/combat/bull_rush_resolver.ts` (`getActorName`)
  - `src/rulesets/dnd35e/combat/retaliation_resolver.ts` (`getActorName`)
  - `src/rulesets/dnd35e/combat/immediate_reactions.ts` (line 204)
  - `src/rulesets/dnd35e/combat/pool_ability_resolver.ts` (line 169)
  - `src/rulesets/dnd35e/magic/counterspell_interrupt.ts` (line 217)
  - `src/rulesets/dnd35e/spatial/light_exposure.ts` (line 75)
- **UI Panels & Spellbook Logs:**
  - `src/rendering/ui/investigation.ui.ts` (`resolveSuspectDetails`: `Name -> id -> icon`)
  - `src/rendering/ui/dossier.ui.ts` & `src/rendering/ui/dossier_hierarchies.ui.ts`
  - `src/rendering/ui/dnd35e_spellbook_actions.ts` (resolve `sys?.spells?.[spellId]?.name ?? spellId` in log messages)
  - `src/rendering/ui/factions.ui.ts` (resolve `state.campaign.factions[factionId]?.name ?? factionId`)

---

### Step 2: Fixed Top-Right (RimWorld-Style) Current Turn & RTwP Readiness Notification

#### 2A. `src/core/scheduler.ts`
Expose read-only query helpers on `scheduler.ts` and notify the HUD when turn processing starts/stops across yielded slices:
```ts
/**
 * Returns the EntityId of the actor currently executing a turn in the scheduler, if any.
 */
export function getActiveTurnActorId(): EntityId | null {
  return currentScheduleActor?.id ?? null;
}

/**
 * Returns the remaining scheduled energy/cooldown ticks until `entityId`'s next turn in `ROT.Scheduler.Action`.
 * Returns `0` if the actor is currently acting or not waiting in the queue.
 */
export function getActorRemainingScheduleTime(entityId: EntityId): number {
  if (currentScheduleActor?.id === entityId) return 0;
  const actor = actors.get(entityId);
  if (!actor) return 0;
  const scheduledAt = scheduler.getTimeOf(actor);
  if (scheduledAt === undefined) return 0;
  return Math.max(0, scheduledAt - scheduler.getTime());
}
```
Also in `runTurnBasedLoop` (`src/core/scheduler.ts`), when yielding a slice (`setTimeout`) or finishing a multi-slice turn cascade, mark the HUD domain dirty (`markDomainsDirty(['hud'])`) so the top-right turn ribbon updates live while waiting for AI turns.

#### 2B. `src/rendering/ui/hud_alerts.ui.ts` & `src/styles/console_prototype.css`
At the top of `renderHudAlerts(state: GameState)` in `src/rendering/ui/hud_alerts.ui.ts`, prepend the pinned RimWorld-style Current Turn / Action Readiness ribbon before the tactical alert ribbons:
- **Perception Gate Helper (`isActorPerceivedByPlayer`):**
  ```ts
  function isActorPerceivedByPlayer(state: GameState, actorId: EntityId, playerId: EntityId): boolean {
    if (actorId === playerId) return true;
    const pos = getComponent(state, actorId, ComponentType.Position);
    if (!pos) return false;
    const idx = coordToIndex(pos.x, pos.y, state.map.width);
    const tile = state.map.tiles[idx];
    if (!tile || (!tile.visible && !state.map.isFullyExplored)) return false;
    if (hasStatusEffect(state, actorId, 'invisible')) return false;
    return true;
  }
  ```
- **Turn-Based Mode (`state.engineMode === EngineMode.TurnBased`):**
  - If `(activeActorId === null || activeActorId === playerId) && !isTurnProcessingActive()`:
    - **Severity / Style:** `turn-ready` (green left accent)
    - **Title:** `Your Turn: ${playerName}`
    - **Detail:** `Round ${state.globalTurn} • Ready for command`
    - **Click:** Centers camera on player.
  - Else (another creature is acting or AI turn cascade is in progress):
    - If `activeActorId !== null && isActorPerceivedByPlayer(state, activeActorId, playerId)`:
      - **Severity / Style:** `warning` (amber left accent)
      - **Title:** `Turn: ${resolveEntityDisplayName(state, activeActorId)}`
      - **Detail:** `Round ${state.globalTurn} • Acting — please wait...`
      - **Click:** Pans camera to that visible creature's tile.
    - Else (unperceived actor or off-map `Scheme`):
      - **Severity / Style:** `warning` (amber left accent)
      - **Title:** `Turn: ???`
      - **Detail:** `Round ${state.globalTurn} • Unseen activity — please wait...`
      - **Click:** Disabled (does not pan camera to unseen entity).
- **RTwP Mode (`state.engineMode === EngineMode.RTwP`):**
  - Compute `remainingEnergy = getActorRemainingScheduleTime(playerId)` and `queued = hasPendingIntents()`.
  - If `state.rtwpState.paused`:
    - **Severity / Style:** `info` (blue/gold tactical pause accent)
    - **Title:** `⏸ Tactical Pause (${playerName})`
    - **Detail:** `Round ${state.globalTurn} • ${queued ? 'Action Queued (Unpause to act)' : 'Issue command or unpause'}`
  - Else if `remainingEnergy > RTWP_IDLE_WAIT_DURATION`:
    - `const remainingSec = ((remainingEnergy / DEFAULT_ACTOR_TURN_DURATION) / Math.max(0.1, state.rtwpState.speedMultiplier)).toFixed(1);`
    - **Severity / Style:** `warning` (amber cooldown accent)
    - **Title:** `⏳ Recovering: ${remainingSec}s`
    - **Detail:** `Round ${state.globalTurn} • ${queued ? 'Next action queued...' : 'Waiting for next turn...'}`
  - Else:
    - **Severity / Style:** `turn-ready` (green ready accent)
    - **Title:** `🟢 Ready: ${playerName}`
    - **Detail:** `Round ${state.globalTurn} • Real-Time (${state.rtwpState.speedMultiplier}x)`

---

### Step 3: Proper Spell & Resource Recovery on Rest, Safety Gating, and Natural Healing Over Time

#### 3A. Command Dock `Rest` Button for All Characters (`src/rendering/ui/dnd35e_ui_registration.ts`)
Register a `Rest (8h)` dock item in `dnd35eUIDefinition` (`onTrigger` wired through `cartridge_ui_registry.ts`, `hud_dock.ui.ts`, `shortcut_input.ts`, and `modal_input.ts`) so non-spellcasters (and spellcasters without opening the Spellbook) can trigger an 8-hour rest directly from the HUD Command Dock or hotkey `t`:
```ts
    {
      id: 'dnd35e_rest_8h',
      label: 'Rest (8h)',
      icon: '💤',
      defaultKey: 't',
      onTrigger: (state: GameState, playerId: EntityId): void => {
        void applyRestActionAsync(state, playerId);
      }
    }
```

#### 3B. Safety Gating for 8-Hour Rest & Spell Preparation (`src/rendering/ui/dnd35e_rest_actions.ts` & `src/rendering/ui/dnd35e_spellbook_actions.ts`)
1. **Comprehensive Rest Safety Check (`evaluateActorRestSafety` in `dnd35e_rest_actions.ts`):**
   - Checks:
     1. `isActorThreatenedByVisibleHostiles(state, playerId)` -> `"Cannot rest or prepare spells while hostile creatures are in sight!"`
     2. Damaging status effects on player or companions (`poison`, `bleeding`, `burning`, `acid`) -> `"Cannot rest while suffering from active damaging afflictions!"`
     3. Starvation (`hunger && hunger.current <= 0`) -> `"Cannot rest while starving! Eat food before resting."`
     4. Hazardous spatial field on the player's tile (`fieldDef?.damagePerTurn > 0`) -> `"Cannot rest while standing in a hazardous area!"`
   - Also pass this safety check into `advanceWorldTimeBulkAsync` (`src/systems/world_time_skip.ts`) so if an affliction or hazard triggers mid-rest, the rest aborts immediately.
2. **Safety Gating & 15-Minute Open-Slot Preparation in `src/rendering/ui/dnd35e_spellbook_actions.ts`:**
   - In `prepareSpellIntoSlot` and `unprepareSpecificSlot`, check `evaluateActorRestSafety(state, playerId)`. If unsafe (e.g., in combat with visible hostiles), block the action and log the warning message.
    - When `prepareSpellIntoSlot` / `prepareSpellIntoSpecificSlot` fills an open unexpended slot (`!oldSlot.preparedSpellId && !oldSlot.expended`) outside of rest, advance world time by `OPEN_SLOT_PREPARATION_ROUNDS` (`150` rounds = 15 minutes) via `advanceWorldTimeBulk` with mid-prep safety interruption BEFORE saving the prepared slot via `prepareOpenDnD35Slot`.

#### 3C. Stamp `castTimestampTurn` on Cast & Unify `resolveSpellbookEightHourRest` + Full Resource Recovery
1. **Stamp `castTimestampTurn` (`src/rulesets/dnd35e/magic/spell_cast_helpers.ts`):**
   - In `expendCasterSpellSlot`, record `castTimestampTurn: currentTurn` on expended `DnD35PreparedSlotEntry` slots and `spontaneousCastTimestampsByLevel` on spontaneous castings.
2. **Full Recovery for Player & Party Companions (`src/rendering/ui/dnd35e_rest_actions.ts` & `src/core/ecs/ecs_lifecycle.ts`):**
   - In `src/core/ecs/ecs_lifecycle.ts`, update `refreshResourcePools` so when `cycle === 'rest_8h'`, it restores **all** pools (`pool.refreshCycle === 'rest_8h' || pool.refreshCycle === 'short_rest' || pool.refreshCycle === 'encounter' || pool.refreshCycle === 'round' || pool.resetOnRest === true`).
   - Extract `applyEightHourRestToActor(state: GameState, actorId: EntityId)` in `dnd35e_rest_actions.ts` and run it for `[playerId, ...getPlayerCompanions(nextState, playerId)]`:
     1. **Ability Score Damage Recovery:** Heal `1` point per damaged ability score (`ALL_ABILITY_IDS`).
     2. **Re-evaluate DAG (`evaluateDnD35eEntityDAG`):** Compute updated `dagResult.maxHp` and `con.effectiveScore === null` *after* ability damage is healed.
     3. **Lethal & Nonlethal HP Recovery (Living Creatures Only):**
        - If `con.effectiveScore !== null`, recover `Math.max(1, effectiveHd)` lethal HP (clamped to `Math.max(fighter.maxHp, dag.maxHp)`) and clear `nonlethalDamage` (`8 * effectiveHd` healed over 8 hours).
     4. **Spellbook Recovery via `resolveSpellbookEightHourRest`:**
        - For each class spellbook in `dndData.spellbooksByClass`, call `resolveSpellbookEightHourRest(...)` from `src/rulesets/dnd35e/magic/aoe_rest.ts`.
     5. **Resource Pools & Action Economy & Fatigue Recovery:**
        - If ability damage healed, merge `buildActorResourcePoolsComponent` with existing pools (preserving custom/campaign pools) and call `refreshResourcePools(nextState, actorId, 'rest_8h')`.
        - Call `hydrateEntityRoundActionBudget(nextState, actorId)` and reset `tacticalDoctrine.triggeredUsesThisRound = 0` + `resetTriggeredReactionsForNewRound`.
        - Remove `fatigued` status effect (or downgrade `exhausted` to `fatigued`).

#### 3D. Natural Nonlethal Healing Over Time (`src/systems/world_clock.system.ts` & `src/rulesets/dnd35e/magic/spell_cast_effects.ts`)
1. **Hourly Nonlethal Damage Healing on the World Clock:**
   - Per `docs/dnd35e/rules/injury-and-death/healing.md:21-25`, nonlethal damage heals at **`1 * level` per hour (`ROUNDS_PER_HOUR = 600` rounds)**.
   - Add an optional cartridge hook `onWorldHourElapsed?: (state: GameState, hoursElapsed: number) => GameState` on `RulesetContract` (`src/types/ruleset.types.ts`), invoked via `applyElapsedWorldHours` (`src/systems/world_clock.system.ts`) during `world_time_skip.ts` and `lifecycle.system.ts` whenever `Math.floor(nextTurn / ROUNDS_PER_HOUR) > Math.floor(prevTurn / ROUNDS_PER_HOUR)`.
   - Implement `onDnD35eWorldHourElapsed` in `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts` (wired in `dnd35e_ruleset.ts`): for every living entity (`con.effectiveScore !== null`) with `dndData.nonlethalDamage > 0`, reduce `nonlethalDamage` by `Math.min(nonlethalDamage, totalHd * hoursElapsed)`.
2. **Magical Healing Also Reduces Nonlethal Damage (`src/rulesets/dnd35e/magic/spell_cast_effects.ts`):**
   - Per `docs/dnd35e/rules/injury-and-death/healing.md:29`, when a healing spell restores `healedAmount` HP to a target, also reduce `targetDndData.nonlethalDamage` by `Math.min(targetDndData.nonlethalDamage, healedAmount)`.

---

### Step 4: Parchment & CRT Theme Contrast Fixes (Screenshots 1 & 2)

#### 4A. `src/styles/console_prototype.css`
1. **Define Missing Alias Tokens & High-Contrast Parchment Semantic Tokens (`[data-console-theme='parchment']` & `[data-console-theme='retro-crt']`):**
   ```css
   .console-root[data-console-theme='parchment'] {
     --crpg-bg-deep: #1b1612;
     --crpg-bg-panel: rgba(235, 227, 212, 0.96);
     --crpg-bg-card: rgba(222, 211, 191, 0.88);
     --crpg-bg-card-hover: rgba(208, 194, 170, 0.95);
     --crpg-border-outer: #6e5536;
     --crpg-border-inner: rgba(110, 85, 54, 0.35);
     --crpg-border-subtle: rgba(110, 85, 54, 0.35);
     --crpg-border-gold: #9a6c1e;
     --crpg-text-main: #261d14;
     --crpg-text: #261d14;
     --crpg-text-muted: #5a4938;
     --crpg-text-dim: #4d3f31;
     --crpg-text-header: #3b2818;
     --crpg-gold: #7a4f0d;
     --crpg-success: #145a28;
     --crpg-info: #154360;
     --crpg-warning: #7d3c08;
     --crpg-danger: #7f1d1d;
   ```
   And in `[data-console-theme='retro-crt']`:
   ```css
     --crpg-text: #78d8ff;
     --crpg-border-subtle: rgba(23, 107, 90, 0.55);
     --crpg-success: #2ecc71;
     --crpg-info: #00e5ff;
     --crpg-warning: #ffb000;
     --crpg-danger: #ff4d4d;
   ```
2. **Fix `.crpg-condition-chip` (`normal`, `debuff`, `buff`) & `.crpg-stance-badge` (`aggressive`, `defensive`, `passive`, `hold`) in `src/styles/console_prototype.css`:**
   Replace hardcoded pastel Catppuccin hexes (`#a6e3a1`, `#f38ba8`, `#89b4fa`, `#f9e2af`) with `var(--crpg-success)`, `var(--crpg-danger)`, `var(--crpg-info)`, `var(--crpg-warning)`, and semantic `--crpg-chip-*` tokens so `[ Normal ]` on the Character Sheet renders in crisp deep forest green (`#145a28`) on Parchment and bright emerald (`#2ecc71`) on Retro CRT.

#### 4B. `src/styles/modals.css` & `src/rendering/ui/dnd35e_inspector.ui.ts`
1. **Fix `.dnd35-counter-val` (`0/4`, `1/4`, `4/4` in Screenshot 1):**
   In `src/styles/modals.css:711`, change `color: #f1c40f;` to `color: var(--crpg-gold, #7a4f0d); font-weight: 700;`.
2. **Fix Character Sheet & Spellbook Close Button (`×` in top-right of Screenshot 2):**
   In `src/styles/modals.css:738-747`, add:
   ```css
   #dnd35e-sheet-overlay .modal-close-btn,
   #dnd35e-spellbook-overlay .modal-close-btn {
     color: var(--crpg-text-header, var(--text-main));
     border-color: var(--crpg-border-outer, var(--border-brass));
     background: var(--crpg-bg-card, rgba(0, 0, 0, 0.2));
   }
   ```
3. **Fix `src/rendering/ui/dnd35e_inspector.ui.ts`:**
   - Replace `var(--crpg-text, #c9d1d9)` on lines 166 and 209 with `var(--crpg-text-main, #261d14)`.
   - Replace `var(--crpg-border-subtle, #333947)` on lines 159 and 221 with `var(--crpg-border-inner, rgba(110, 85, 54, 0.35))`.

---

## 6. Verification Plan (8-Stage Pipeline)

After implementation, we will execute `./verify.sh` covering all 8 stages:
1. `[1/8]` `bun x tsc --noEmit`
2. `[2/8]` `bun run format`
3. `[3/8]` `bun run lint --fix`
4. `[4/8]` `bun run lint:arch`
5. `[5/8]` `bun run lint:deadcode`
6. `[6/8]` `bun test` (including new/updated unit tests for `resolveEntityDisplayName`, 8-hour rest + open-slot preparation + hourly nonlethal healing)
7. `[7/8]` `bun run build`
8. `[8/8]` `bun run scripts/run-validator.ts`
