# Research Notes — Entity Name Resolution (`Name -> id -> icon`), RimWorld Turn Ribbon, Rest & Natural Healing Rules, and Parchment/CRT UI Contrast

## 1. Architectural Rules & Standards Reiteration

Per `AGENTS.md` and `docs/ARCHITECTURE.md`, all four tasks are governed by:
- **Rule 11 & 12 (Strict TypeScript & Zero Magic Values):** No `any` types (`unknown` + narrowing only), explicit return types on all functions, and named constants for all gameplay numbers (e.g., `ROUNDS_PER_HOUR = 600`, `EIGHT_HOURS_IN_ROUNDS = 4800`).
- **Rule 15 (Cascading Effects Matrix):** Every change across call sites, data shapes, and UI projections must be mapped across **Upstream**, **Downstream**, and **Lateral** axes.
- **Rule 16 (Three-Tier Placement Heuristic):**
  - **Tier 1 — Core Console Engine (`src/core/`, `src/systems/`, `src/rendering/`):** Shared entity/item display name resolution (`Name -> id -> icon`), active turn actor exposure in `src/core/scheduler.ts`, RimWorld-style top-right turn indicator in `src/rendering/ui/hud_alerts.ui.ts`, and theme CSS token definitions.
  - **Tier 2 — Ruleset Cartridge (`src/rulesets/dnd35e/`):** D&D 3.5e 8-hour rest & spell preparation rules (`aoe_rest.ts`, `spell_cast_helpers.ts`, `dnd35e_rest_actions.ts`), natural lethal & nonlethal healing rules (`docs/dnd35e/rules/injury-and-death/healing.md`), and D&D 3.5e modal/inspector UI styles.
  - **Tier 3 — System Content (`public/data/`):** JSON templates and registries.
- **Rule 18 (Universal Actor Symmetry):** Rest and natural healing rules must apply symmetrically to the player and active party companions (`getPlayerCompanions`), respecting creature anatomy (`CON === null` non-living immunity to natural healing) and total Hit Dice (`chassis.totalHD`).
- **Rule 21 (Zero Content-ID Branching):** Display name resolution and rest/healing logic must never branch on specific content IDs (`templateId`, `spellId`, `featId`).

---

## 2. Task-by-Task Codebase Research & Root-Cause Analysis

### Task A: Entity, Item & Content Display Name Fallback Chain (`Name -> id -> icon`)

#### Current State & Root Causes
1. **Entity Spawning (`src/core/ecs/ecs_spawner.ts`):**
   - `spawnEntity` attaches `TemplateComponent` (`templateId`), `RenderableComponent` (`glyph`, `color`), and for `'player'` attaches `PlayerComponent`.
   - `IdentityComponent` (`name`) is only attached when an entity is created via the Character Builder, promoted via the Nemesis/Dossier system, or spawned as a named companion.
   - Notably, in `public/data/campaigns/default/entities.json`, the `"player"` template has `glyph: "@"` and no `name` field, so if `IdentityComponent` is absent (or before promotion/builder naming), a naive `glyph` lookup returns `"@"`.
2. **Existing Resolver (`src/rendering/inspect_tooltip.ts`):**
   - `resolveEntityDisplayName(state, entityId, fallback)` (lines 28–50) currently checks:
     1. `IdentityComponent.name`
     2. `TemplateComponent.templateId` -> `state.campaign.entities[templateId]?.name ?? templateId`
     3. `PlayerComponent` -> `'You'` (or `'Adventurer'`)
     4. `RenderableComponent.glyph`
     5. `fallback`
   - However, there is **no equivalent `resolveItemDisplayName(state, itemEntityId, fallback)`** for item entities (`Identity.name` -> `ItemComponent.name` -> `campaign.items[itemId]?.name` -> `ItemComponent.itemId` -> `Renderable.glyph` -> `fallback`).
   - Furthermore, if `templateId === 'player'` and `campaign.entities['player']?.name` is undefined, step 2 falls back to `'player'` before reaching `PlayerComponent` unless handled cleanly (`Identity.name` -> `campaign.entities[templateId]?.name` -> if `PlayerComponent` `'Adventurer'` -> `templateId` -> `Renderable.glyph`).
3. **Audit of All Message & Label Call Sites Bypassing `Name -> id -> icon`:**
   - **Tier 1 Console Systems Reading `Renderable.glyph` Directly:**
     - `src/systems/death.system.ts:57`: `const name = renderable ? renderable.glyph : 'Someone';` -> emits **`"@ dies!"`** or **`"g dies!"`**.
     - `src/systems/death.system.ts:93`: `const killerName = killerRenderable ? killerRenderable.glyph : 'An enemy';`
     - `src/systems/death.system.ts:160`: `${name} drops ${itemDef.name}.` (uses glyph `name` from line 57).
     - `src/systems/death.system.ts:201`: `Mastermind ${entityId} has been slain!` (uses raw `entityId`).
     - `src/rulesets/classic/classic_combat.ts:73-74`: `attackerRenderable.glyph` / `defenderRenderable.glyph` -> emits **`"@ hits g for X damage."`**; line 261 uses `victimIdentity ? victimIdentity.name : 'an enemy'`.
     - `src/systems/status-effect.system.ts:34`: `const name = renderable ? renderable.glyph : 'Someone';` -> emits **`"@ suffers from afflictions."`**
     - `src/systems/effects.system.ts:66, 83, 198, 244`: uses `targetRenderable?.glyph ?? 'target'` and `Renderable?.glyph ?? 'Something'`.
     - `src/systems/effects/spatial_effects.ts:90, 141, 189, 225, 237`: uses `targetRenderable?.glyph ?? 'target'`.
     - `src/systems/shop.system.ts:59`: `const shopName = rend?.glyph ?? 'Merchant';`
     - `src/systems/scheme/scheme_recruitment.ts:100`: `const name = renderable ? renderable.glyph : 'Someone';`
     - `src/systems/trigger/player.ts:207`: `const itemName = getComponent(nextState, eId, ComponentType.Renderable)?.glyph ?? 'The item';` -> emits **`"! is now coated!"`** instead of the weapon/item name.
     - `src/systems/trigger/quest.ts:72`: `const name = renderable ? renderable.glyph : 'Someone';`
     - `src/systems/trigger/systemic.ts:59`: `const targetName = isPlayer ? 'You' : 'Something';`
     - `src/systems/projectile.system.ts:158` & `src/systems/zap.system.ts:56`: uses `'Something'` for non-player actors.
   - **Tier 1 & Tier 2 Systems Checking Only `IdentityComponent.name` (Skipping Template Name -> Template ID -> Glyph):**
     - `src/systems/message.system.ts:69-70` (`executeSay`): `identity ? identity.name : 'Someone'`.
     - `src/systems/movement.system.ts:292-293`: `identity ? identity.name : 'your ally'`.
     - `src/rulesets/dnd35e/cartridge/dnd35e_lifecycle_adapter.ts:147, 153, 159`: `Entity #${occupantId} resists ${spell.name} emanation...`.
     - `src/rulesets/dnd35e/combat/combat_exchange_phases.ts:195-196`: `candIdentity?.name` else `'foe'`.
     - `src/rulesets/dnd35e/combat/bull_rush_resolver.ts:158-161`: `getActorName` only reads `IdentityComponent`.
     - `src/rulesets/dnd35e/combat/retaliation_resolver.ts:151-156`: `getActorName` only reads `IdentityComponent`.
     - `src/rulesets/dnd35e/combat/immediate_reactions.ts:204`: only reads `IdentityComponent`.
     - `src/rulesets/dnd35e/combat/pool_ability_resolver.ts:169`: only reads `IdentityComponent`.
     - `src/rulesets/dnd35e/magic/counterspell_interrupt.ts:217`: only reads `IdentityComponent`.
     - `src/rulesets/dnd35e/spatial/light_exposure.ts:75`: only reads `IdentityComponent`.
   - **UI Panels & Actions Showing Raw IDs or Glyphs:**
     - `src/rendering/ui/investigation.ui.ts:212-218` (`resolveSuspectDetails`): formats `Suspect (${renderable.glyph})` instead of `Name -> id -> icon`.
     - `src/rendering/ui/dossier.ui.ts:104-106` & `src/rendering/ui/dossier_hierarchies.ui.ts:103`: `Unknown Entity #${data.id}` / `Nemesis #${occupantId}` when `Identity.name` is empty.
     - `src/rendering/ui/dnd35e_spellbook_actions.ts:78, 119, 149, 178`: logs raw `spellId` (e.g., `Prepared magic_missile...`, `Cast cure_light_wounds...`) instead of resolving `sys?.spells?.[spellId]?.name ?? spellId`.
     - `src/rendering/ui/factions.ui.ts:64`: displays raw `factionId` instead of `state.campaign.factions[factionId]?.name ?? factionId`.

---

### Task B: Fixed Top-Right (RimWorld-Style) Current Turn Notification

#### Current State & Architecture
1. **Top-Right Alert Stack (`index.html` & `src/rendering/ui/hud_alerts.ui.ts`):**
   - `index.html:142` defines `<div id="hud-alerts-container" class="hud-alerts-stack"></div>` at the top of `#hud-right-stack` (the fixed top-right overlay stack styled in `src/styles/console_prototype.css:359-424` with `.hud-alerts-stack` and `.hud-alert-ribbon`).
   - `renderHudAlerts(state)` in `src/rendering/ui/hud_alerts.ui.ts` is called on every `present(state)` cycle (`src/rendering/presenter.ts:178`).
2. **Turn Scheduler & Game Loop (`src/core/scheduler.ts` & `src/core/game-loop.ts`):**
   - `src/core/scheduler.ts` maintains `currentScheduleActor: SchedulerActor | null` (`id: EntityId`).
   - In `TurnBased` mode (`src/core/game-loop.ts:249-253`), when `entityId === state.playerId` and no intent is queued, the engine locks (`lockEngine()`) and awaits player input (`currentScheduleActor.id === state.playerId`). During sliced AI turn cascades (`TURN_SLICE_BUDGET_MS = 4`), `present(currentState)` is invoked between slices while `currentScheduleActor.id` holds the currently acting AI entity.
   - In `RTwP` mode (`src/core/game-loop.ts:288-333`), actors act as their action timers mature, or the loop pauses (`rtwpPaused`).
3. **Design Integration:**
   - Expose `getActiveTurnActorId(): EntityId | null` from `src/core/scheduler.ts` (falling back to `state.playerId` when null at initialization).
   - Render a pinned RimWorld-style notification ribbon at the top of `#hud-alerts-container` in `src/rendering/ui/hud_alerts.ui.ts` displaying:
     - **Title:** `Current Turn: <Resolved Actor Name>` (using the canonical `Name -> id -> icon` resolver, e.g., `Current Turn: Adventurer (You)` or `Current Turn: Goblin Scout`).
     - **Detail / Subtitle:** Round/Turn counter (`Turn ${state.globalTurn}`) + mode status (e.g., `Awaiting Command`, `Acting...`, or `RTwP Paused / Active`).
     - **Interaction:** Clicking the turn ribbon pans/centers the camera on the active actor's position (`panCameraToTile`).

---

### Task C: Proper Spell & Resource Recovery on Rest, Safety Gating, and Natural Healing Over Time Audit

#### 1. Safety Gating & Rest Accessibility
- **Current State:**
  - `executePlayerEightHourRest` (`src/rendering/ui/dnd35e_rest_actions.ts:185`) checks `isActorThreatenedByVisibleHostiles(state, playerId)` (FOV scan for alive hostiles via `areEntitiesHostile`).
  - **Gap 1 — Non-Spellcasters Cannot Rest:** The `💤 8-Hour Rest` button only exists inside `#dnd35e-spellbook-overlay` (`src/rendering/ui/dnd35e_spellbook.ui.ts:154`). Because `src/rendering/ui/dnd35e_ui_registration.ts:127-130` hides the `Spells [B]` dock button when `Object.keys(dndData.spellbooksByClass ?? {}).length === 0`, martial classes (Fighters, Barbarians, Rogues, Monks) have **no UI button to take an 8-hour rest**!
    - *Fix:* Register a dedicated `Rest` action in the Command Dock (`dnd35e_ui_registration.ts`) and keep the button in the Spellbook header so all characters can rest.
  - **Gap 2 — Environmental / Affliction Safety Checks Before & During Rest:**
    - Resting should also be blocked (or interrupted during `advanceWorldTimeBulkAsync` in `src/systems/world_time_skip.ts`) if:
      1. Visible hostiles are present (`isActorThreatenedByVisibleHostiles`).
      2. The player (or a party companion) is taking active damaging afflictions (`poison`, `bleeding`, `burning`, `acid`) or is actively starving (`hungerComponent.current <= 0`).
      3. The player is standing on a hazardous spatial surface/emanation.
  - **Gap 3 — Unchecked In-Combat Spell Preparation:**
    - `prepareSpellIntoSlot` and `unprepareSpecificSlot` in `src/rendering/ui/dnd35e_spellbook_actions.ts` currently allow preparing/swapping spells instantaneously even in the middle of combat!
    - Per `docs/dnd35e/rules/magic/spellcasting-mechanics.md:107-115, 134-138`, preparing spells requires peace and quiet (cannot be threatened by visible hostiles) and preparing into an open slot outside of an 8-hour rest takes **15 minutes (`150` rounds)** via `prepareOpenSpellSlot` in `src/rulesets/dnd35e/magic/aoe_rest.ts`.

#### 2. Spell & Resource Recovery Rules on 8-Hour Rest
- **Split-Brain Between `aoe_rest.ts` and `dnd35e_rest_actions.ts`:**
  - `src/rulesets/dnd35e/magic/aoe_rest.ts` already implements `resolveEightHourRest(book, restCompletionTurn)`, which enforces the D&D 3.5e Recent Casting Limit (`docs/dnd35e/rules/magic/spellcasting-mechanics.md:113, 128`: spells cast within the last 8 hours = `4800` rounds before rest completion count against daily limits).
  - However, `finalizeEightHourRestRecovery` in `src/rendering/ui/dnd35e_rest_actions.ts:110-124` ignores `resolveEightHourRest` and manually resets all `used = 0` and `expended = false`. Furthermore, `expendCasterSpellSlot` (`src/rulesets/dnd35e/magic/spell_cast_helpers.ts:229`) never sets `castTimestampTurn: state.globalTurn` when a spell is cast during the 8-hour rest window, and when a spell is cast *before* resting begins, slots blown in the 8 hours prior aren't timestamped either (Note: since an 8-hour rest itself advances `worldClock` by `4800` rounds, any spell cast *before* the rest starts is `>= 4800` rounds old by the time the 8-hour rest finishes, whereas any spell cast *during* an interrupted rest is `< 4800` rounds old! Calling `resolveEightHourRest(book, nextState.globalTurn)` after advancing `4800` rounds and stamping `castTimestampTurn: state.globalTurn` on cast unifies both!).
- **Resource Pool Recovery ("restore all resources, etc"):**
  - Currently, `finalizeEightHourRestRecovery` calls `refreshResourcePools(nextState, playerId, 'rest_8h')` (`src/rulesets/dnd35e/progression/ledger_resource_pools.ts:346`), which only restores pools matching `pool.refreshCycle === 'rest_8h' || pool.resetOnRest === true`.
  - Any pool with `refreshCycle === 'encounter'`, `'short_rest'`, or `'round'` is skipped!
  - Furthermore, if ability damage (e.g., CHA damage affecting `turn_undead` max uses) is healed during rest, `syncActorResourcePoolsComponent` must run **after** ability damage is healed so pool `max` capacities reflect the healed ability scores before all pools are restored to `max`.
  - **Action Economy, Conditions & Party Symmetry:**
    - Full 8-hour rest recovery must also:
      1. Reset round action economy (`hydrateEntityRoundActionBudget`) and `TacticalDoctrine.triggeredUsesThisRound = 0`.
      2. Recover fatigue conditions per D&D 3.5e rules (`fatigued` is removed after 8 hours of complete rest; `exhausted` is reduced to `fatigued`).
      3. Apply symmetrically to **the player AND all active party companions** (`getPlayerCompanions(nextState, playerId)`).

#### 3. Natural Healing Over Time — Audit & Confirmation
We audited the entire codebase against `docs/dnd35e/rules/injury-and-death/healing.md`:
- **What IS Already Implemented (`src/rendering/ui/dnd35e_rest_actions.ts:43-87`):**
  1. **Lethal HP Recovery on 8-Hour Rest:** Recovers `1 HP per character level` per 8-hour rest (`Math.max(1, totalClassLevels)`).
  2. **Ability Score Damage Recovery on 8-Hour Rest:** Recovers `1 point of ability damage` per damaged ability score (`STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`) per 8-hour rest.
- **What is Missing or Has Edge-Case Bugs:**
  1. **Nonlethal Damage (`dndData.nonlethalDamage`) Never Heals (Over Time or On Rest):**
     - Per `docs/dnd35e/rules/injury-and-death/healing.md:21-25, 29`: *"You heal nonlethal damage at the rate of 1 hit point per hour per character level."* And magical healing (`cure_*_wounds`, etc.) also removes an equal amount of nonlethal damage.
     - Currently in the codebase, `nonlethalDamage` is added in `src/rulesets/dnd35e/combat/damage_vitality.ts` and `forced_march.ts`, but **never reduced anywhere**!
     - **Fix:**
       - In `src/systems/world_clock.system.ts` (when the hour boundary `ROUNDS_PER_HOUR = 600` is crossed during normal play or bulk time skip), heal `1 * totalHD` points of `nonlethalDamage` per elapsed hour for living actors with `nonlethalDamage > 0`.
       - In `src/rulesets/dnd35e/magic/spell_cast_resolver.ts` (when a healing spell restores HP), also reduce `nonlethalDamage` by up to the healed amount per SRD rules.
  2. **CON Ability Damage Healing & Max HP Recalculation Order:**
     - In `finalizeEightHourRestRecovery`, `fighter.hp` is clamped to `fighter.maxHp` *before* `evaluateDnD35eEntityDAG` recalculates `maxHp` from the newly healed `CON` ability damage. Evaluating the DAG after healing ability damage (and syncing `fighter.maxHp = dag.maxHp`) ensures `CON` damage recovery properly restores lost max HP and allows natural healing up to the true `maxHp`.
  3. **Non-Living Creatures (`CON === null`) & Racial Hit Dice (`chassis.totalHD`):**
     - Per `docs/dnd35e/rules/injury-and-death/healing.md:30`, non-living creatures (`dag.abilityBreakdown.CON.isNonAbility === true`, i.e., Construct/Undead) do not heal lethal or nonlethal HP naturally.
     - Natural healing rate should use `Math.max(1, dndData.chassis.totalHD)` (which includes both class levels and racial HD) rather than only `tracks.reduce(...)`.

---

### Task D: UI Font Color & Contrast Fixes (Screenshots 1 & 2 Audit)

From the two attached screenshots and a full audit of `src/styles/` and `src/rendering/ui/dnd35e_*.ts`, here are the exact root causes of every low-contrast / clashing text element:

1. **Screenshot 1 — Very Light Grayish-Blue Modifier Breakdown Values & Skill Synergy Description (`src/rendering/ui/dnd35e_inspector.ui.ts`):**
   - **Line 166 (`appendBreakdownRow`):**
     ```ts
     v.style.color = highlight ? 'var(--crpg-gold, #f1c40f)' : 'var(--crpg-text, #c9d1d9)';
     ```
   - **Line 209 (Skill Synergy note):**
     ```ts
     note.style.color = 'var(--crpg-text, #c9d1d9)';
     ```
   - **Root Cause:** `--crpg-text` **is not defined anywhere in CSS**! The actual theme variable in `src/styles/console_prototype.css` is `--crpg-text-main` (`#261d14` on Parchment, `#e6edf3` on CRT). Because `--crpg-text` is undefined, CSS falls back to `#c9d1d9` (pale grayish-blue) on top of the light beige parchment panel (`#ebe3d4`), yielding a **1.25:1 contrast ratio** (virtually unreadable)!
   - **Line 159 & 221 (`dnd35e_inspector.ui.ts`) and 5 other builder/level-up files:**
     - Reference `var(--crpg-border-subtle, #333947)`, which is also undefined in `console_prototype.css` (the defined token is `--crpg-border-inner`), causing dark `#333947` borders inside the parchment cards.

2. **Screenshot 1 — Bright Yellow `0/4`, `1/4`, `4/4` Skill Rank Counters & Class Skill Subtitles (`src/styles/modals.css` & `src/rendering/ui/dnd35e_char_builder_skills.ui.ts`):**
   - `src/styles/modals.css:711`: `.dnd35-counter-val` hardcodes `color: #f1c40f;` (bright neon yellow on `#ebe3d4` beige parchment = ~1.5:1 contrast). It should use `color: var(--crpg-text-header, #3b2818)` (or `var(--crpg-gold)` once darkened for parchment).
   - `src/rendering/ui/dnd35e_char_builder_skills.ui.ts:116`: `sub.style.color = isClassSkill ? 'var(--crpg-success, #2ecc71)' : 'var(--crpg-text-dim, #8b949e)';` and `dnd35e_inspector.ui.ts:62, 198, 224` use `--crpg-success`, `--crpg-info`, `--crpg-warning`, `--crpg-gold`.

3. **Screenshot 2 — Pale Neon Green `[ Normal ]` Active Condition Chip & Stance Badges (`src/styles/console_prototype.css`):**
   - **Lines 1725–1743 (`.crpg-condition-chip`):**
     - `.crpg-condition-chip.normal` hardcodes `color: #a6e3a1; background: rgba(166, 227, 161, 0.12);` (pastel mint green on `#ebe3d4` parchment!).
     - `.crpg-condition-chip.debuff` hardcodes `color: #f38ba8;` (pastel pink on parchment!).
     - `.crpg-condition-chip.buff` hardcodes `color: #89b4fa;` (pastel light blue on parchment!).
   - **Lines 1975–1989 (`.crpg-stance-badge`):**
     - `.crpg-stance-badge.aggressive` (`color: #f38ba8`), `.defensive` (`color: #89b4fa`), `.passive` / `.hold` (`color: #f9e2af`) also hardcode pastel dark-theme colors that wash out on parchment.
   - **Fix:** Replace hardcoded pastel hexes with semantic theme tokens (`var(--crpg-success)`, `var(--crpg-danger)`, `var(--crpg-info)`, `var(--crpg-warning)`) and theme-aware tinted backgrounds.

4. **Screenshot 2 — Washed-Out Gold Numbers (`+2`, `5 / 5`) & Nearly Invisible Top-Right `×` Close Button (`src/styles/console_prototype.css` & `src/styles/modals.css`):**
   - In `src/styles/console_prototype.css:51`, `[data-console-theme='parchment']` defines `--crpg-gold: #b88a36;`. Against `--crpg-bg-panel: rgba(235, 227, 212, 0.96)` (`#ebe3d4`), `#b88a36` has only a **2.4:1 contrast ratio**, making small gold values (`+2`, `5 / 5`, `0/4`) look washed out.
     - Darkening `--crpg-gold` in `[data-console-theme='parchment']` to deep burnished bronze (`#7a4f0d`, ~5.4:1 WCAG AA contrast on `#ebe3d4`) while keeping `--crpg-border-gold: #b88a36` for decorative borders makes all gold values crisp and legible across Character Creation, Character Sheet, Level-Up, and Spellbook!
   - Also in `[data-console-theme='parchment']`, tuning semantic text tokens for high readability on warm parchment:
     - `--crpg-success`: `#1b5e20` (deep forest green, ~6.8:1 contrast)
     - `--crpg-info`: `#154360` (deep navy ink, ~8.2:1 contrast)
     - `--crpg-warning`: `#7d3c08` (deep amber/rust, ~6.1:1 contrast)
     - `--crpg-danger`: `#7f1d1d` (deep crimson ink, ~7.5:1 contrast)
     - Aliasing `--crpg-text: var(--crpg-text-main)` and `--crpg-border-subtle: var(--crpg-border-inner)` in both themes guarantees zero fallback leaks.
   - In `src/styles/modals.css:738-747`, `#dnd35e-sheet-overlay .modal-close-btn` and `#dnd35e-spellbook-overlay .modal-close-btn` inherit `color: var(--text-main)` (`#e2d9c8` cream) on the light parchment header (visible in the top-right corner of Screenshot 2 where the `×` is almost invisible). Using `color: var(--crpg-text-header, var(--text-main))` and `border-color: var(--crpg-border-outer, var(--border-brass))` fixes this cleanly.

---

## 3. Cascading Effects Matrix (Rule 15)

| Change | Upstream (Callers / Emitters / Data) | Downstream (Consumers / Renderers / Serializers) | Lateral (Sibling Systems / Docs / Tests) |
| :--- | :--- | :--- | :--- |
| **Canonical Entity & Item Display Name Resolution (`Name -> id -> icon`)** | `ecs_spawner.ts`, `death.system.ts`, `classic_combat.ts`, `status-effect.system.ts`, `effects.system.ts`, `spatial_effects.ts`, `shop.system.ts`, `scheme_recruitment.ts`, `trigger/*.ts`, `projectile.system.ts`, `zap.system.ts`, `message.system.ts`, `movement.system.ts`, D&D 3.5e combat/lifecycle/spellbook loggers | Message log (`state.messages`), HUD message feed (`hud.ui.ts`), Investigation UI (`investigation.ui.ts`), Dossier UI (`dossier.ui.ts`), Faction UI (`factions.ui.ts`) | `inspect_tooltip.ts` re-exports canonical helpers; unit tests asserting combat/death/effect log strings |
| **RimWorld-Style Fixed Top-Right Current Turn Notification** | `scheduler.ts` (`getActiveTurnActorId`), `game-loop.ts` (`processTurn` / `runTurnBasedLoop` / `rtwpLoop`) | `hud_alerts.ui.ts` (`renderHudAlerts`), `#hud-alerts-container` in `index.html`, `console_prototype.css` | Existing tactical alert ribbons in `hud_alerts.ui.ts` (encumbered, low HP, status, unspent level-up) stack directly beneath the pinned turn ribbon |
| **8-Hour Rest Safety Gating, Full Resource/Spell Recovery & Natural Healing** | `dnd35e_ui_registration.ts` (Command Dock `Rest` action), `dnd35e_spellbook.ui.ts`, `dnd35e_rest_actions.ts`, `dnd35e_spellbook_actions.ts`, `spell_cast_helpers.ts`, `world_clock.system.ts`, `world_time_skip.ts` | `aoe_rest.ts` (`resolveEightHourRest`, `prepareOpenSpellSlot`), `ledger_resource_pools.ts` (`refreshAllResourcePoolsOnRest`), `damage_vitality.ts` / `spell_cast_resolver.ts` (`nonlethalDamage` recovery), party companions (`getPlayerCompanions`) | `docs/dnd35e/rules/injury-and-death/healing.md`, `docs/dnd35e/rules/magic/spellcasting-mechanics.md`, SSOT documentation (`ssot_console.json`, `ssot_dnd35e.json`) |
| **Parchment & CRT UI Font Color / Contrast Fixes** | `console_prototype.css` (`[data-console-theme='parchment']` & `'crt'`), `modals.css` | `dnd35e_inspector.ui.ts`, `dnd35e_char_builder_*.ts`, `dnd35e_sheet_*.ts`, `dnd35e_level_up_*.ts`, `dnd35e_spellbook*.ts` | All D&D 3.5e modals (Character Builder, Character Sheet, Level-Up, Spellbook) and HUD elements sharing `--crpg-*` CSS custom properties |

---

## 4. Confirmed User Decisions & RTwP Turn Mechanics

1. **Player Character Name Field in Character Creation + Default Fallback (`Name -> id -> icon`):**
   - Add a `characterName: string` field to `CharacterCreationDraft` (defaulting to `'Adventurer'`), rendered in the Character Creation Wizard header/Step 1 so players can name their character directly during creation.
   - In `applyCharacterCreationToPlayer` (`src/rulesets/dnd35e/builder/builder_hydrator_creation.ts`), attach/update `IdentityComponent` (`{ type: ComponentType.Identity, name: trimmedName, role: classDef.name }`) on the player entity.
   - Add `"name": "Adventurer"` to the `"player"` entity template in `public/data/campaigns/default/entities.json` so classic mode and un-customized players also resolve to `"Adventurer"` via the standard `Name -> id -> icon` chain.

2. **RimWorld Top-Right Turn Ribbon (Perception-Gated in Turn-Based + Action Readiness in RTwP):**
   - **Turn-Based Mode (`EngineMode.TurnBased`):**
     - **Player's Turn (`activeActorId === playerId` and engine awaiting command):**
       - Displays `Your Turn: <Player Name>` with `Round <N> • Std / Move / Swift readiness` (green/ready styling).
     - **Other Creature's Turn (`activeActorId !== playerId` or `isTurnProcessingActive()`):**
       - **Perception Gate:** Check if `activeActorId` has a `PositionComponent` on a tile currently visible to the player (`state.map.tiles[pos.y]?.[pos.x]?.visible === true`) and does not have an unspotted `invisible` status effect.
       - If **perceivable**: Displays `Turn: <Resolved Actor Name>` (`Name -> id -> icon`) and allows clicking to pan the camera to that creature.
       - If **not perceivable** (out of FOV, unseen, or off-map `Scheme` entity): Displays `Turn: ???` (`Round <N> • Unseen activity — please wait...`) and disables click-to-pan so unseen actor positions are never leaked.
   - **Real-Time with Pause Mode (`EngineMode.RTwP`):**
     - In RTwP, `ROT.Scheduler.Action` ticks continuously (`100` energy = `1.0s` at `1x` speed via `RTWP_MS_PER_100_DURATION = 1000`). When the player executes a standard/full-round action (`energyCost = 100`), their actor sits in `scheduler` for `100` energy units while other actors tick; when idle in RTwP, the player polls every `RTWP_IDLE_WAIT_DURATION = 10` energy units.
     - Rather than flickering every AI entity name 30+ times per second, in RTwP the top-right ribbon shows the **Player's Turn Readiness / Recovery Cooldown** via `scheduler.getTimeOf(playerActor)`:
       - **Paused (`state.rtwpState.paused`):** `⏸ Tactical Pause — <Player Name>` (`Command Queued` if `hasPendingIntents()`, else `Ready for command`).
       - **Ready (`remainingEnergy <= RTWP_IDLE_WAIT_DURATION`):** `🟢 Ready to Act — <Player Name>` (`Round <N> • Real-Time ${speed}x`).
       - **Recovering Between Turns (`remainingEnergy > RTWP_IDLE_WAIT_DURATION`):** `⏳ Recovering (<X.Xs>) — <Player Name>` (`Next action queued...` if `hasPendingIntents()`, else `Waiting for next turn...`).

3. **Rest & Natural Healing Rules (Confirmed):**
   - Add a dedicated `Rest` action to the main Command Dock (`dnd35e_ui_registration.ts`) so non-spellcasters can rest, alongside the Spellbook `💤 8-Hour Rest` button.
   - Gate both 8-hour rest and manual spell preparation (`dnd35e_spellbook_actions.ts`) behind safety checks (no visible hostiles in FOV, no active damaging afflictions `poison`/`bleeding`/`burning`/`acid`, not starving), with 15-minute (`150` rounds) time progression for open-slot spell preparation (`prepareOpenSpellSlot`).
   - Restore all spell slots (via `resolveEightHourRest` with `castTimestampTurn`), all resource pools (`rest_8h`, `short_rest`, `encounter`, `round`), round action budgets, fatigue conditions, and party companions on an 8-hour rest.
   - Heal `nonlethalDamage` at `1 * totalHD` per elapsed hour (`600` rounds) on the world clock and when magical healing restores HP, and respect non-living (`CON === null`) natural healing immunity.

