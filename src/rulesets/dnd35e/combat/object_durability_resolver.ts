import { addComponent, getComponent, resolveEntityDisplayName } from '../../../core/ecs.ts';
import {
  applyStructuralDamage,
  DEFAULT_DURABILITY_CONFIG,
  resolveDurabilityConfig,
  syncStructuralDoorState
} from '../../../systems/durability.system.ts';
import { addMessage, MessageLogCategory } from '../../../systems/message.system.ts';
import { emitSoundEvent, SOUND_DB_DOOR_KICK } from '../../../systems/sound.system.ts';
import {
  ComponentType,
  type InventoryComponent,
  type ItemComponent,
  type LockComponent,
  type PositionComponent,
  type StructuralComponent,
  type StructuralObjectSize,
  type TagsComponent
} from '../../../types/components.types.ts';
import type { EntityId, GameState } from '../../../types/game-state.types.ts';
import { evaluateDnD35eEntityDAG } from '../cartridge/dnd35e_dag_adapter.ts';
import { rollD20 } from '../math/dice.ts';
import { resolveEntityDnD35Data } from '../skills/skill_verb_helpers.ts';
import type { CreatureSizeCategory, DnD35DamageType } from '../types/dnd35e.types.ts';
import { getDnD35SystemContent } from '../types/dnd35e_system.types.ts';

/** Base AC of an object before size, Dex 0 (`-5`), and inanimate (`-2`) adjustments (`10`). */
export const SRD_OBJECT_BASE_AC = 10;

/** Dexterity 0 modifier applied to inanimate objects (`-5` per SRD Smashing an Object). */
export const SRD_OBJECT_DEX_ZERO_MOD = -5;

/** Additional inanimate object penalty to AC (`-2` per SRD Smashing an Object). */
export const SRD_OBJECT_INANIMATE_AC_MOD = -2;

/** Hardness bonus granted per `+1` magical enhancement bonus on a weapon/shield/armor (`+2` per SRD). */
export const SRD_MAGIC_ENHANCEMENT_HARDNESS_PER_PLUS = 2;

/** Hit point bonus granted per `+1` magical enhancement bonus on a weapon/shield/armor (`+10` per SRD). */
export const SRD_MAGIC_ENHANCEMENT_HP_PER_PLUS = 10;

/** Adamantine weapons bypass object hardness completely when the object's effective hardness is `< 20`. */
export const SRD_ADAMANTINE_BYPASS_HARDNESS_THRESHOLD = 20;

/** Break DC reduction when an object or door is already at or below half of its maximum HP (`-2`). */
export const SRD_HALF_HP_BREAK_DC_MOD = -2;

/** Circumstance bonus to Strength Break checks granted by a crowbar (`+2` per PHB p. 126). */
export const SRD_CROWBAR_BREAK_BONUS = 2;

/** Base circumstance bonus to Strength Break checks granted by a portable ram (`+2` per PHB p. 127). */
export const SRD_PORTABLE_RAM_BASE_BONUS = 2;

/** Additional circumstance bonus granted when an ally assists with a portable ram (`+2` per PHB p. 127). */
export const SRD_PORTABLE_RAM_ALLY_BONUS = 2;

/** SRD Object AC size modifier table (PHB p. 165). */
export const SRD_OBJECT_AC_SIZE_MODIFIERS: Readonly<Record<StructuralObjectSize, number>> = {
  fine: 8,
  diminutive: 4,
  tiny: 2,
  small: 1,
  medium: 0,
  large: -1,
  huge: -2,
  gargantuan: -4,
  colossal: -8
};

/** SRD Strength check size modifier table for breaking or bursting objects (PHB p. 165 / DMG p. 60). */
export const SRD_BREAK_CHECK_SIZE_MODIFIERS: Readonly<Record<CreatureSizeCategory, number>> = {
  fine: -16,
  diminutive: -12,
  tiny: -8,
  small: -4,
  medium: 0,
  large: 4,
  huge: 8,
  gargantuan: 12,
  colossal: 16
};

/** Canonical SRD Substance Hardness baseline table (PHB p. 166). */
export const SRD_MATERIAL_HARDNESS_TABLE: Readonly<Record<string, number>> = {
  paper: 0,
  cloth: 0,
  rope: 0,
  glass: 1,
  ice: 0,
  leather: 2,
  hide: 2,
  wood: 5,
  darkwood: 5,
  stone: 8,
  iron: 10,
  steel: 10,
  cold_iron: 10,
  alchemical_silver: 8,
  silver: 8,
  mithral: 15,
  adamantine: 20
};

/** Input descriptor for resolving an attack's damage against a structural object. */
export interface ObjectDamageEvaluationInput {
  readonly rawDamage: number;
  readonly damageType: DnD35DamageType;
  readonly isRangedWeapon?: boolean | undefined;
  readonly isCriticalExtraDamage?: boolean | undefined;
  readonly isNonlethal?: boolean | undefined;
  readonly weaponMaterialTag?: string | undefined;
  readonly isIneffectiveWeaponType?: boolean | undefined;
  readonly isMaterialVulnerableToAttack?: boolean | undefined;
}

/** Result of evaluating SRD *Smashing an Object* damage against a `StructuralComponent`. */
export interface ObjectDamageEvaluationResult {
  readonly effectiveHardness: number;
  readonly effectiveMaxHp: number;
  readonly preHardnessDamage: number;
  readonly netDamage: number;
}

/**
 * Computes the SRD Armor Class of an object (`10 + sizeMod - 5 [Dex 0] - 2 [inanimate]`, or `10 + sizeMod + dexMod` if animated).
 *
 * @param objectSize Canonical size category of the object.
 * @param options Optional flags (`isAnimated`, `animatedDexMod`, `isHeldOrAttendeeDexMod`).
 * @returns Effective Object AC.
 */
export function computeSrdObjectArmorClass(
  objectSize: StructuralObjectSize,
  options?: {
    readonly isAnimated?: boolean | undefined;
    readonly animatedDexMod?: number | undefined;
  }
): number {
  const sizeMod = SRD_OBJECT_AC_SIZE_MODIFIERS[objectSize] ?? 0;
  if (options?.isAnimated === true) {
    return SRD_OBJECT_BASE_AC + sizeMod + (options.animatedDexMod ?? 0);
  }
  return SRD_OBJECT_BASE_AC + sizeMod + SRD_OBJECT_DEX_ZERO_MOD + SRD_OBJECT_INANIMATE_AC_MOD;
}

/**
 * Computes an object's effective Hardness and Max HP after applying its magical `+1..+5` enhancement bonus
 * (`+2` hardness and `+10` HP per `+1` enhancement bonus per SRD *Magic Armor, Shields, and Weapons*).
 *
 * @param structural StructuralComponent on the object or item.
 * @returns `{ effectiveHardness, effectiveMaxHp }`.
 */
export function resolveEffectiveStructuralStats(structural: StructuralComponent): {
  readonly effectiveHardness: number;
  readonly effectiveMaxHp: number;
} {
  const plus = Math.max(0, structural.enhancementBonus ?? 0);
  const baseHardness =
    structural.hardness >= 0 ? structural.hardness : (SRD_MATERIAL_HARDNESS_TABLE[structural.materialTag] ?? 5);
  return {
    effectiveHardness: baseHardness + plus * SRD_MAGIC_ENHANCEMENT_HARDNESS_PER_PLUS,
    effectiveMaxHp: structural.maxHp + plus * SRD_MAGIC_ENHANCEMENT_HP_PER_PLUS
  };
}

/**
 * Evaluates raw incoming damage against a structural object using pure SRD 3.5e *Smashing an Object* laws:
 * - Objects are immune to nonlethal damage and critical hit extra damage.
 * - Ineffective weapons returns `0` damage.
 * - Vulnerability (`isMaterialVulnerableToAttack`, e.g., sonic vs crystalline/glass or fire vs dry paper/web) deals `2×` damage and ignores hardness.
 * - Energy attacks before hardness: Acid & Sonic deal full (`1×`) damage; Fire & Electricity are divided by `2`; Cold is divided by `4`.
 * - Ranged weapon attacks (non-energy) are divided by `2` before hardness.
 * - `adamantine` weapons ignore hardness completely if `effectiveHardness < 20`.
 *
 * @param structural Target `StructuralComponent`.
 * @param input Attack damage parameters.
 * @returns `ObjectDamageEvaluationResult` containing `preHardnessDamage` and `netDamage`.
 */
export function evaluateSrdObjectDamage(
  structural: StructuralComponent,
  input: ObjectDamageEvaluationInput
): ObjectDamageEvaluationResult {
  const { effectiveHardness, effectiveMaxHp } = resolveEffectiveStructuralStats(structural);

  if (
    input.rawDamage <= 0 ||
    input.isNonlethal === true ||
    input.isCriticalExtraDamage === true ||
    input.isIneffectiveWeaponType === true
  ) {
    return {
      effectiveHardness,
      effectiveMaxHp,
      preHardnessDamage: 0,
      netDamage: 0
    };
  }

  if (input.isMaterialVulnerableToAttack === true) {
    const doubled = Math.floor(input.rawDamage * 2);
    return {
      effectiveHardness: 0,
      effectiveMaxHp,
      preHardnessDamage: doubled,
      netDamage: doubled
    };
  }

  let scaledDamage = input.rawDamage;
  switch (input.damageType) {
    case 'acid':
    case 'sonic':
    case 'force':
      // Full damage before hardness
      break;
    case 'fire':
    case 'electricity':
      scaledDamage = Math.floor(scaledDamage / 2);
      break;
    case 'cold':
      scaledDamage = Math.floor(scaledDamage / 4);
      break;
    default:
      if (input.isRangedWeapon === true) {
        scaledDamage = Math.floor(scaledDamage / 2);
      }
      break;
  }

  const bypassesHardness =
    input.weaponMaterialTag === 'adamantine' && effectiveHardness < SRD_ADAMANTINE_BYPASS_HARDNESS_THRESHOLD;
  const appliedHardness = bypassesHardness ? 0 : effectiveHardness;
  const netDamage = Math.max(0, scaledDamage - appliedHardness);

  return {
    effectiveHardness: appliedHardness,
    effectiveMaxHp,
    preHardnessDamage: scaledDamage,
    netDamage
  };
}

/**
 * Applies an SRD *Smashing an Object* / Sunder damage hit against `targetEntityId`, updating its
 * `StructuralComponent` (`ruined: true` at `0 HP`).
 *
 * @param state Current immutable GameState.
 * @param targetEntityId Object, door, or item EntityId.
 * @param input Damage parameters.
 * @returns Updated GameState and evaluation details.
 */
export function applySrdObjectAttackDamage(
  state: GameState,
  targetEntityId: EntityId,
  input: ObjectDamageEvaluationInput
): {
  readonly state: GameState;
  readonly evaluation: ObjectDamageEvaluationResult;
  readonly remainingHp: number;
  readonly becameRuined: boolean;
} {
  const structural = getComponent(state, targetEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return {
      state,
      evaluation: {
        effectiveHardness: 0,
        effectiveMaxHp: 0,
        preHardnessDamage: 0,
        netDamage: 0
      },
      remainingHp: 0,
      becameRuined: false
    };
  }

  const evaluation = evaluateSrdObjectDamage(structural, input);
  const applied = applyStructuralDamage(state, targetEntityId, evaluation.netDamage);
  return {
    state: applied.state,
    evaluation,
    remainingHp: applied.remainingHp,
    becameRuined: applied.becameRuined
  };
}

const PRY_TOOL_ITEM_TAG = 'pry_tool';
const BATTERING_RAM_ITEM_TAG = 'battering_ram';

function actorCarriesToolWithDeclarativeTag(state: Readonly<GameState>, actorId: EntityId, tag: string): boolean {
  const inv = getComponent(state, actorId, ComponentType.Inventory) as InventoryComponent | undefined;
  const sysItems = getDnD35SystemContent(state.campaign)?.items;
  for (const itemId of inv?.items ?? []) {
    const itemComp = getComponent(state, itemId, ComponentType.Item) as ItemComponent | undefined;
    if (!itemComp) continue;
    const itemDef = state.campaign.items[itemComp.itemId];
    if (itemDef?.tags.includes(tag)) return true;
    const sysDef = sysItems?.[itemComp.itemId];
    if (sysDef?.tags?.includes(tag)) return true;
    const tagsComp = getComponent(state, itemId, ComponentType.Tags) as TagsComponent | undefined;
    if (tagsComp?.tags.includes(tag)) return true;
  }
  return false;
}

/**
 * Resolves a D&D 3.5e Strength Break / Kick check against a structural door or container (`targetEntityId`):
 * - Roll = `1d20 + STR mod + SRD Break Size Modifier` (`Fine -16` .. `Colossal +16`)
 * - Circumstance bonuses: `+2` with a carried `crowbar`, `+2` with a `portable_ram` (`+2` extra if an ally assists).
 * - Target DC = `structural.breakDc` (`-2` when `structural.hp <= effectiveMaxHp / 2`).
 * - Emits a loud `SOUND_DB_DOOR_KICK` (`65` dB) acoustic sound ripple via `emitSoundEvent`.
 * - On success, forces the door open (`isOpen: true`, `jammed: false`, `locked: false`).
 *
 * @param state Current immutable GameState.
 * @param actorId Actor attempting to kick or burst the object.
 * @param targetEntityId Door or container carrying `ComponentType.Structural`.
 * @param options Optional `allyAssistingWithRam` flag and deterministic `forcedD20` roll.
 * @returns Updated GameState, roll breakdown, and success boolean.
 */
export function resolveSrdBreakObjectCheck(
  state: GameState,
  actorId: EntityId,
  targetEntityId: EntityId,
  options?: {
    readonly allyAssistingWithRam?: boolean | undefined;
    readonly forcedD20?: number | undefined;
  }
): {
  readonly state: GameState;
  readonly success: boolean;
  readonly totalRoll: number;
  readonly effectiveDc: number;
} {
  const structural = getComponent(state, targetEntityId, ComponentType.Structural) as StructuralComponent | undefined;
  if (!structural) {
    return {
      state: addMessage(state, 'There is nothing structural there to break open.', MessageLogCategory.System),
      success: false,
      totalRoll: 0,
      effectiveDc: 0
    };
  }

  const dndData = resolveEntityDnD35Data(state, actorId);
  const dag = evaluateDnD35eEntityDAG(state, actorId);
  const strMod =
    dag?.dagResult.effectiveAbilityModifiers.str ?? Math.floor(((dndData.abilityScores?.str?.base ?? 10) - 10) / 2);
  const sizeCategory: CreatureSizeCategory = dndData.sizeCategory ?? 'medium';
  const sizeMod = SRD_BREAK_CHECK_SIZE_MODIFIERS[sizeCategory] ?? 0;

  const hasCrowbar = actorCarriesToolWithDeclarativeTag(state, actorId, PRY_TOOL_ITEM_TAG);
  const hasPortableRam = actorCarriesToolWithDeclarativeTag(state, actorId, BATTERING_RAM_ITEM_TAG);

  let toolBonus = 0;
  if (hasCrowbar) {
    toolBonus += SRD_CROWBAR_BREAK_BONUS;
  }
  if (hasPortableRam) {
    toolBonus += SRD_PORTABLE_RAM_BASE_BONUS;
    if (options?.allyAssistingWithRam === true) {
      toolBonus += SRD_PORTABLE_RAM_ALLY_BONUS;
    }
  }

  const { effectiveMaxHp } = resolveEffectiveStructuralStats(structural);
  const isHalfHpOrLess = structural.hp <= Math.floor(effectiveMaxHp / 2);
  const effectiveDc = Math.max(1, structural.breakDc + (isHalfHpOrLess ? SRD_HALF_HP_BREAK_DC_MOD : 0));

  const d20 = rollD20('ability_check', strMod + sizeMod + toolBonus, options?.forcedD20);
  const totalRoll = d20.total;
  const success = totalRoll >= effectiveDc;

  let nextState = state;
  const targetPos =
    (getComponent(nextState, targetEntityId, ComponentType.Position) as PositionComponent | undefined) ??
    (getComponent(nextState, actorId, ComponentType.Position) as PositionComponent | undefined);
  if (targetPos) {
    nextState = emitSoundEvent(nextState, targetPos.x, targetPos.y, SOUND_DB_DOOR_KICK, actorId, {
      cueLabel: 'a heavy crashing blow against a door'
    }).state;
  }

  const actorName = resolveEntityDisplayName(nextState, actorId, 'Someone');
  const targetName = resolveEntityDisplayName(nextState, targetEntityId, 'the door');

  if (!success) {
    nextState = addMessage(
      nextState,
      `${actorName} slams into ${targetName} (Break check ${totalRoll} vs DC ${effectiveDc}), but it holds firm!`,
      MessageLogCategory.System
    );
    return { state: nextState, success: false, totalRoll, effectiveDc };
  }

  const { spikedByEntityId: _clearedSpike, jammed: _clearedJammed, ...restStructural } = structural;
  const updatedStructural: StructuralComponent = {
    ...restStructural,
    isOpen: true
  };
  nextState = addComponent(nextState, targetEntityId, updatedStructural);
  nextState = syncStructuralDoorState(nextState, targetEntityId, updatedStructural);

  const lock = getComponent(nextState, targetEntityId, ComponentType.Lock) as LockComponent | undefined;
  if (lock?.locked === true) {
    nextState = addComponent(nextState, targetEntityId, {
      ...lock,
      locked: false
    });
  }

  nextState = addMessage(
    nextState,
    `${actorName} bursts ${targetName} open (Break check ${totalRoll} vs DC ${effectiveDc})!`,
    MessageLogCategory.System
  );
  return { state: nextState, success: true, totalRoll, effectiveDc };
}

// Re-export Tier 1 helpers used by Cartridge callers for convenience
export { DEFAULT_DURABILITY_CONFIG, resolveDurabilityConfig };
