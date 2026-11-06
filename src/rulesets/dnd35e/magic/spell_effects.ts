import { matchesEntityTagCondition } from '../../../systems/reaction.system.ts';
import { appendSourcePath } from '../modifiers/provenance.ts';
import type { BonusType, StatModifier } from '../types/dnd35e.types.ts';
import type {
  DnD35SpellDefinition,
  DnD35SpellEffectUnit,
  DnD35SpellScalingRule
} from '../types/system/spell_system.types.ts';
import type { MetamagicSpellModifiers } from './metamagic_dispel.ts';

/**
 * Projects semantic effect tags from a spell definition and active metamagic modifiers:
 * - `school:<school>`, `<school>`, `subschool:<subschool>`, `<subschool>`, `descriptor:<descriptor>`, `<descriptor>`.
 * - `classification:<classification>`.
 * - `component:verbal` (omitted if Silent Spell is applied).
 * - `component:somatic` (omitted if Still Spell is applied).
 * - `component:material`, `component:focus`, `component:divine_focus`, `component:sacrifice`, `component:corrupt`, `component:xp`.
 * - All tags declared in `spell.tags`.
 *
 * @param spell The spell definition.
 * @param metamagic Optional active metamagic modifiers.
 * @returns Array of distinct projected semantic effect tags.
 */
export function projectSpellEffectTags(
  spell: DnD35SpellDefinition,
  metamagic?: MetamagicSpellModifiers
): ReadonlyArray<string> {
  const tags = new Set<string>();

  tags.add(`school:${spell.school}`);
  tags.add(spell.school);
  if (spell.subschool) {
    tags.add(`subschool:${spell.subschool}`);
    tags.add(spell.subschool);
  }
  for (const descriptor of spell.descriptors) {
    tags.add(`descriptor:${descriptor}`);
    tags.add(descriptor);
  }
  tags.add(`classification:${spell.classification}`);

  if (spell.components.verbal && !metamagic?.silent) {
    tags.add('component:verbal');
  }
  if (spell.components.somatic && !metamagic?.still) {
    tags.add('component:somatic');
  }
  if (spell.components.material) {
    tags.add('component:material');
  }
  if (spell.components.focus) {
    tags.add('component:focus');
  }
  if (spell.components.divineFocus) {
    tags.add('component:divine_focus');
  }
  if (spell.components.sacrifice) {
    tags.add('component:sacrifice');
  }
  if (spell.components.corrupt) {
    tags.add('component:corrupt');
  }
  if (spell.components.xpCost !== undefined && spell.components.xpCost > 0) {
    tags.add('component:xp');
  }

  for (const tag of spell.tags) {
    tags.add(tag);
  }

  return Array.from(tags);
}

/**
 * Evaluates a declarative `DnD35SpellScalingRule` for a given Caster Level:
 * $$\text{value} = \text{baseValue} + \left\lfloor \frac{\max(0, \text{CL} - \text{startAboveCL})}{\text{clStepInterval}} \right\rfloor \times \text{perCL}$$
 * Clamped within `[minCap, maxCap]`.
 *
 * @param rule Optional scaling rule definition.
 * @param casterLevel Effective caster level.
 * @returns Computed numeric value.
 */
export function evaluateSpellScalingRule(rule: DnD35SpellScalingRule | undefined, casterLevel: number): number {
  if (!rule) return 0;
  const effectiveCl = Math.max(0, casterLevel - rule.startAboveCL);
  const steps = rule.clStepInterval > 0 ? Math.floor(effectiveCl / rule.clStepInterval) : 0;
  let val = rule.baseValue + steps * rule.perCL;
  if (rule.minCap !== undefined) {
    val = Math.max(rule.minCap, val);
  }
  if (rule.maxCap !== undefined) {
    val = Math.min(rule.maxCap, val);
  }
  return val;
}

/**
 * Filters and selects active `DnD35SpellEffectUnit` entries for a given target entity
 * using tag-based matching against the caster's self-tags, the target's tags, and projected effect tags,
 * as well as target Current HP and Hit Dice threshold brackets.
 *
 * @param spell The spell definition.
 * @param context Context containing caster selfTags, target tags, active metamagic, targetCurrentHp, and targetHitDice.
 * @returns Array of active effect units for the target.
 */
export function evaluateSpellEffectUnitsForTarget(
  spell: DnD35SpellDefinition,
  context: {
    readonly casterSelfTags?: ReadonlyArray<string>;
    readonly targetTags?: ReadonlyArray<string>;
    readonly metamagic?: MetamagicSpellModifiers;
    readonly targetCurrentHp?: number;
    readonly targetHitDice?: number;
  }
): ReadonlyArray<DnD35SpellEffectUnit> {
  const effectTags = projectSpellEffectTags(spell, context.metamagic);
  return spell.effectUnits.filter((unit) => {
    if (unit.condition) {
      const tagMatch = matchesEntityTagCondition(
        unit.condition,
        context.targetTags,
        effectTags,
        context.casterSelfTags
      );
      if (!tagMatch) return false;
    }

    if (unit.type === 'save_or_die') {
      if (context.targetCurrentHp !== undefined) {
        if (unit.minTargetCurrentHp !== undefined && context.targetCurrentHp < unit.minTargetCurrentHp) {
          return false;
        }
        if (unit.maxTargetCurrentHp !== undefined && context.targetCurrentHp > unit.maxTargetCurrentHp) {
          return false;
        }
      }
      if (context.targetHitDice !== undefined) {
        if (unit.minTargetHitDice !== undefined && context.targetHitDice < unit.minTargetHitDice) {
          return false;
        }
        if (unit.maxTargetHitDice !== undefined && context.targetHitDice > unit.maxTargetHitDice) {
          return false;
        }
      }
    } else if (unit.type === 'condition') {
      if (
        context.targetHitDice !== undefined &&
        unit.maxTargetHitDice !== undefined &&
        context.targetHitDice > unit.maxTargetHitDice
      ) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Materializes active `StatModifier` entries from a `stat_bundle` effect unit (or top-level `effectBundle`),
 * applying any Caster Level scaling rules (`statScalingRules`) and tagging all emitted modifiers with
 * hierarchical `sourcePath` provenance (`"spell:<spellId>:<castId>/unit:<unitId>/<modId>"`).
 *
 * @param spell The parent spell definition.
 * @param unit The `stat_bundle` effect unit.
 * @param casterLevel Effective caster level of the cast.
 * @param castId Unique cast session instance ID.
 * @returns Array of instantiated `StatModifier`s.
 */
export function materializeSpellUnitModifiers(
  spell: DnD35SpellDefinition,
  unit: DnD35SpellEffectUnit,
  casterLevel: number,
  castId: string
): ReadonlyArray<StatModifier> {
  if (unit.type !== 'stat_bundle') {
    return [];
  }

  const basePath = appendSourcePath(`spell:${spell.id}:${castId}`, `unit:${unit.unitId}`);
  const modifiers: StatModifier[] = [];

  for (const declMod of unit.effectBundle.modifiers) {
    let finalValue = declMod.value;
    const scalingRule = unit.statScalingRules?.[declMod.target];
    if (scalingRule) {
      finalValue = evaluateSpellScalingRule(scalingRule, casterLevel);
    }

    modifiers.push({
      sourceId: declMod.id,
      sourcePath: appendSourcePath(basePath, declMod.id),
      targetStat: declMod.target,
      bonusType: declMod.type as BonusType,
      value: finalValue,
      origin: 'spell',
      effectTags: declMod.effectTags ? [...declMod.effectTags] : undefined,
      condition: declMod.condition
    });
  }

  return modifiers;
}

/**
 * Materializes `StatModifier` entries from a top-level `spell.effectBundle` (used by simple buffs like *Mage Armor*, *Shield*, *Expeditious Retreat*).
 *
 * @param spell The parent spell definition.
 * @param castId Unique cast session instance ID.
 * @returns Array of instantiated `StatModifier`s.
 */
export function materializeTopLevelSpellModifiers(
  spell: DnD35SpellDefinition,
  castId: string
): ReadonlyArray<StatModifier> {
  if (!spell.effectBundle) {
    return [];
  }

  const basePath = `spell:${spell.id}:${castId}`;
  const modifiers: StatModifier[] = [];

  for (const declMod of spell.effectBundle.modifiers) {
    modifiers.push({
      sourceId: declMod.id,
      sourcePath: appendSourcePath(basePath, declMod.id),
      targetStat: declMod.target,
      bonusType: declMod.type as BonusType,
      value: declMod.value,
      origin: 'spell',
      effectTags: declMod.effectTags ? [...declMod.effectTags] : undefined,
      condition: declMod.condition
    });
  }

  return modifiers;
}

/**
 * Inspects all active target modifiers in the world for a specific `castId` and projects active tether tags onto the caster.
 * If at least one active modifier exists under `spell:<spellId>:<castId>/unit:<unitId>`, emits the unit's `emitsTetherTagToCaster`.
 * If all targets are dispelled, suppressed, or dead, the tether tag is omitted, automatically deactivating tethered caster buffs.
 *
 * @param spell The spell definition.
 * @param castId Unique cast session instance ID.
 * @param activeWorldModifiers All active `StatModifier` entries across all affected entities.
 * @returns Array of active tether tags (e.g. `['tether:battletide:enemy_affected']`).
 */
export function projectActiveSpellTetherTags(
  spell: DnD35SpellDefinition,
  castId: string,
  activeWorldModifiers: ReadonlyArray<StatModifier>
): ReadonlyArray<string> {
  const tetherTags = new Set<string>();

  for (const unit of spell.effectUnits) {
    if (!unit.emitsTetherTagToCaster) continue;
    const unitPrefix = `spell:${spell.id}:${castId}/unit:${unit.unitId}`;
    const hasActiveOccupant = activeWorldModifiers.some((mod) => {
      const path = mod.sourcePath ?? mod.sourceId;
      return path.startsWith(unitPrefix);
    });

    if (hasActiveOccupant) {
      tetherTags.add(unit.emitsTetherTagToCaster);
    }
  }

  return Array.from(tetherTags);
}
