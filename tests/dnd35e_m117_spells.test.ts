import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { SPELL_IDS } from "../src/rulesets/dnd35e/system_content_spell_ids.ts";
import {
  DnD35SpellDefinitionSchema,
  type DnD35SpellDefinition,
  type StatModifier
} from "../src/rulesets/dnd35e/types/system/spell_system.types.ts";
import {
  evaluateSpellEffectUnitsForTarget
} from "../src/rulesets/dnd35e/magic/spell_effects.ts";
import {
  materializeSummonedCreatureModifiers,
  resolveSpellEffectiveCasterLevel
} from "../src/rulesets/dnd35e/magic/spell_modifiers.ts";
import { checkDnD35eRuleset } from "../src/rulesets/dnd35e/dnd35e_validator.ts";
import { loadCampaignFromDisk } from "./helpers.ts";

describe("Milestone 117 — Mid- & High-Level Spells and 22-Domain Grimoire Coverage", () => {
  const spellsDir = join(process.cwd(), "public/data/rulesets/dnd35e/spells");
  const domainsDir = join(process.cwd(), "public/data/rulesets/dnd35e/domains");

  test("all spell JSON files exist and conform to DnD35SpellDefinitionSchema", () => {
    const files = readdirSync(spellsDir).filter((f) => f.endsWith(".json"));
    expect(SPELL_IDS.length).toBe(files.length);
    expect(files.length).toBeGreaterThanOrEqual(250);

    for (const spellId of SPELL_IDS) {
      const filePath = join(spellsDir, `${spellId}.json`);
      const raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      expect(raw[spellId]).toBeDefined();
      const parseResult = DnD35SpellDefinitionSchema.safeParse(raw[spellId]);
      if (!parseResult.success) {
        throw new Error(
          `Spell ${spellId} failed validation: ${JSON.stringify(parseResult.error.issues, null, 2)}`
        );
      }
      expect(parseResult.success).toBe(true);
    }
  });

  test("all 22 Cleric Domains resolve all 9 domainSpells with 100% referential coverage", () => {
    const domainFiles = readdirSync(domainsDir).filter((f) => f.endsWith(".json"));
    expect(domainFiles.length).toBe(22);

    const spellIdSet = new Set<string>(SPELL_IDS);

    for (const f of domainFiles) {
      const raw = JSON.parse(readFileSync(join(domainsDir, f), "utf-8")) as Record<
        string,
        { readonly domainSpells?: Record<string, string> }
      >;
      const firstEntry = Object.values(raw)[0];
      expect(firstEntry?.domainSpells).toBeDefined();

      for (let lvl = 1; lvl <= 9; lvl++) {
        const spellId = firstEntry?.domainSpells?.[String(lvl)];
        expect(spellId).toBeDefined();
        expect(spellIdSet.has(spellId ?? "")).toBe(true);
      }
    }
  });

  test("HP and HD bracket filtering in evaluateSpellEffectUnitsForTarget (Power Word & Cloudkill)", () => {
    const pwKillRaw = JSON.parse(readFileSync(join(spellsDir, "power_word_kill.json"), "utf-8")) as Record<
      string,
      DnD35SpellDefinition
    >;
    const pwKill = pwKillRaw.power_word_kill!;

    // Power Word Kill targets <= 100 HP
    const unitsLowHp = evaluateSpellEffectUnitsForTarget(pwKill, {
      targetCurrentHp: 80
    });
    expect(unitsLowHp.length).toBe(1);
    expect(unitsLowHp[0]?.type).toBe("save_or_die");

    const unitsHighHp = evaluateSpellEffectUnitsForTarget(pwKill, {
      targetCurrentHp: 150
    });
    expect(unitsHighHp.length).toBe(0);

    // Cloudkill targets by Hit Dice brackets
    const cloudkillRaw = JSON.parse(readFileSync(join(spellsDir, "cloudkill.json"), "utf-8")) as Record<
      string,
      DnD35SpellDefinition
    >;
    const cloudkill = cloudkillRaw.cloudkill!;

    const unitsWeakHd = evaluateSpellEffectUnitsForTarget(cloudkill, {
      targetHitDice: 3
    });
    expect(unitsWeakHd.some((u) => u.type === "save_or_die")).toBe(true);
  });

  test("declarative Augment Summoning projection via materializeSummonedCreatureModifiers", () => {
    const smRaw = JSON.parse(readFileSync(join(spellsDir, "summon_monster_iii.json"), "utf-8")) as Record<
      string,
      DnD35SpellDefinition
    >;
    const sm3 = smRaw.summon_monster_iii!;
    const summonUnit = sm3.effectUnits?.find((u) => u.type === "summon");
    expect(summonUnit).toBeDefined();

    // Augment Summoning modifiers from feat JSON
    const casterMods: StatModifier[] = [
      {
        id: "augment_summoning_str",
        sourceId: "feat:augment_summoning",
        sourcePath: "feat:augment_summoning",
        targetStat: "summoned_creature:str",
        value: 4,
        type: "enhancement",
        condition: {
          effectTagsAny: ["subschool:summoning", "summoning"]
        }
      },
      {
        id: "augment_summoning_con",
        sourceId: "feat:augment_summoning",
        sourcePath: "feat:augment_summoning",
        targetStat: "summoned_creature:con",
        value: 4,
        type: "enhancement",
        condition: {
          effectTagsAny: ["subschool:summoning", "summoning"]
        }
      },
      {
        id: "unrelated_caster_mod",
        sourceId: "feat:iron_will",
        sourcePath: "feat:iron_will",
        targetStat: "save_will",
        value: 2,
        type: "untyped"
      }
    ];

    const projected = materializeSummonedCreatureModifiers(sm3, summonUnit!, casterMods, "cast_123");
    expect(projected.length).toBe(2);

    const strMod = projected.find((m) => m.targetStat === "str");
    expect(strMod).toBeDefined();
    expect(strMod?.value).toBe(4);
    expect(strMod?.type).toBe("enhancement");
    expect(strMod?.sourcePath).toBe(
      `spell:summon_monster_iii:cast_123/unit:${summonUnit!.unitId}/feat:augment_summoning`
    );

    const conMod = projected.find((m) => m.targetStat === "con");
    expect(conMod).toBeDefined();
    expect(conMod?.value).toBe(4);
    expect(conMod?.type).toBe("enhancement");
  });

  test("domain Caster Level bonus evaluation via resolveSpellEffectiveCasterLevel", () => {
    const cureCritRaw = JSON.parse(
      readFileSync(join(spellsDir, "cure_critical_wounds.json"), "utf-8")
    ) as Record<string, DnD35SpellDefinition>;
    const cureCrit = cureCritRaw.cure_critical_wounds!;

    const healingDomainMod: StatModifier = {
      id: "domain_healing_cl",
      sourceId: "domain:healing",
      sourcePath: "domain:healing",
      targetStat: "caster_level",
      value: 1,
      type: "untyped",
      condition: {
        effectTagsAny: ["healing"]
      }
    };

    const fireballRaw = JSON.parse(readFileSync(join(spellsDir, "fireball.json"), "utf-8")) as Record<
      string,
      DnD35SpellDefinition
    >;
    const fireball = fireballRaw.fireball!;

    // Healing domain grants +1 CL to healing spells
    const clHealing = resolveSpellEffectiveCasterLevel(cureCrit, 7, [healingDomainMod]);
    expect(clHealing).toBe(8);

    // Healing domain does not grant +1 CL to non-healing spells
    const clFireball = resolveSpellEffectiveCasterLevel(fireball, 7, [healingDomainMod]);
    expect(clFireball).toBe(7);
  });

  test("full checkDnD35eRuleset passes validation with 0 errors across entire ruleset", () => {
    const campaign = loadCampaignFromDisk("dnd35e-crypt");
    const errors = checkDnD35eRuleset(campaign);
    expect(errors).toEqual([]);
  });
});
