import { describe, expect, test } from 'bun:test';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';
import { addComponent, createEntity, getComponent, queryEntities, removeComponent } from '../src/core/ecs.ts';
import { getAllRulesets } from '../src/rulesets/registry.ts';
import { ComponentType } from '../src/types/components.types.ts';
import { VIEW_GROUPS } from '../src/rendering/editor/editor_config.ts';

describe('Universal RulesetContract Property & Edge-Case Invariants', () => {
  test('all registered ruleset cartridges obey HUD vitals clamping, stat purity, and lethal damage invariants', () => {
    const rulesets = getAllRulesets();
    expect(rulesets.length).toBeGreaterThanOrEqual(2);

    const baseCampaign = loadCampaignFromDisk('default');

    for (const ruleset of rulesets) {
      const campaignForRuleset = {
        ...baseCampaign,
        manifest: {
          ...baseCampaign.manifest,
          rulesetId: ruleset.id
        }
      };
      const state = buildGameState(campaignForRuleset);
      const playerId = queryEntities(state, [ComponentType.Player])[0]!;

      // 1. projectHudVitals clamping under normal, zero maxHp, negative hp, and missing FighterComponent states
      const normalVitals = ruleset.projectHudVitals(state, playerId);
      expect(normalVitals).not.toBeNull();
      expect(normalVitals!.hpPercent).toBeGreaterThanOrEqual(0);
      expect(normalVitals!.hpPercent).toBeLessThanOrEqual(100);
      expect(Number.isFinite(normalVitals!.hpPercent)).toBe(true);
      expect(normalVitals!.primaryStat.label.length).toBeGreaterThan(0);
      expect(normalVitals!.secondaryStat.label.length).toBeGreaterThan(0);

      const fighter = getComponent(state, playerId, ComponentType.Fighter)!;
      const zeroMaxHpState = addComponent(state, playerId, { ...fighter, hp: 0, maxHp: 0 });
      const zeroVitals = ruleset.projectHudVitals(zeroMaxHpState, playerId);
      expect(zeroVitals).not.toBeNull();
      expect(Number.isNaN(zeroVitals!.hpPercent)).toBe(false);
      expect(zeroVitals!.hpPercent).toBeGreaterThanOrEqual(0);
      expect(zeroVitals!.hpPercent).toBeLessThanOrEqual(100);

      const negHpState = addComponent(state, playerId, { ...fighter, hp: -50, maxHp: 20 });
      const negVitals = ruleset.projectHudVitals(negHpState, playerId);
      expect(negVitals).not.toBeNull();
      expect(negVitals!.hpPercent).toBe(0);

      const noFighterState = removeComponent(state, playerId, ComponentType.Fighter);
      const emptyVitals = ruleset.projectHudVitals(noFighterState, playerId);
      expect(emptyVitals).toBeNull();

      // 2. getEffectiveActorStats on a bare entity with zero components returns finite numbers
      const [withBareEntity, bareId] = createEntity(state);
      const bareStats = ruleset.getEffectiveActorStats(withBareEntity, bareId);
      expect(Number.isFinite(bareStats.attack)).toBe(true);
      expect(Number.isFinite(bareStats.defense)).toBe(true);
      expect(Number.isFinite(bareStats.maxHp)).toBe(true);
      expect(Number.isFinite(bareStats.speed)).toBe(true);

      // 3. processDamage handles lethal damage cleanly
      const lethalDamageState = addComponent(state, playerId, {
        type: ComponentType.Damage,
        instances: [{ amount: 9999, sourceEntityId: bareId, tags: ['physical'] }]
      });
      const afterLethal = ruleset.processDamage(lethalDamageState);
      const fighterAfterLethal = getComponent(afterLethal, playerId, ComponentType.Fighter);
      if (fighterAfterLethal !== undefined) {
        expect(fighterAfterLethal.hp).toBeLessThanOrEqual(0);
      }

      // 4. Editor view groups are non-empty and well-formed
      const groups = ruleset.getEditorViewGroups(VIEW_GROUPS);
      expect(groups.length).toBeGreaterThan(0);
    }
  });
});
