import { describe, expect, test } from 'bun:test';
import { addComponent, createEntity, getComponent, removeComponent, spawnEntity, spawnItem } from '../src/core/ecs.ts';
import {
  applySrdObjectAttackDamage,
  computeSrdObjectArmorClass,
  evaluateSrdObjectDamage,
  resolveEffectiveStructuralStats,
  resolveSrdBreakObjectCheck
} from '../src/rulesets/dnd35e/combat/object_durability_resolver.ts';
import {
  getSpellRarityTier,
  getStoredSpellsOnSpellbook,
  spawnArcaneCasterSpellbookLoot,
  transcribeSpellFromBook
} from '../src/rulesets/dnd35e/magic/spellbook_loot.ts';
import {
  projectDnD35eInspectLoreLines,
  validateDnD35eWandActivation
} from '../src/rulesets/dnd35e/skill_verbs.ts';
import { evaluateAndRecordMonsterLore } from '../src/rulesets/dnd35e/skills/monster_lore_tracker.ts';
import { getDnD35EntityData, setDnD35EntityData } from '../src/rulesets/dnd35e/srd_registry.ts';
import { getValidVerbsForTarget, processApplyIntent } from '../src/systems/apply.system.ts';
import { harvestCorpseTag, spawnCorpseForSlainEntity, tickCorpseDecay } from '../src/systems/corpse.system.ts';
import { processDeathSystem } from '../src/systems/death.system.ts';
import {
  applyIdentityMask,
  evaluateDisguiseSuspicion,
  isDisguiseSuppressingHostility
} from '../src/systems/disguise.system.ts';
import {
  closeStructuralDoor,
  evaluateOptInCombatWear,
  openStructuralDoor,
  probeTrapWithReachTool,
  repairRuinedItem,
  resolveDurabilityConfig,
  spikeDoorWithWedge
} from '../src/systems/durability.system.ts';
import {
  atonePenanceAtAltar,
  recordDeityFavorDelta,
  recordTabooViolation
} from '../src/systems/religion.system.ts';
import {
  ComponentType,
  type CorpseComponent,
  type InventoryComponent,
  type ReligionComponent,
  type RenderableComponent,
  type StructuralComponent,
  type TrapComponent
} from '../src/types/components.types.ts';
import type { EntityId, GameState } from '../src/types/game-state.types.ts';
import { IntentType } from '../src/types/intents/intent.enum.ts';
import { isHostile } from '../src/utils/faction.ts';
import { buildGameState, loadCampaignFromDisk } from './helpers.ts';

function buildTestDnd35eState(): {
  state: GameState;
  playerId: EntityId;
  rivalId: EntityId;
} {
  const campaign = loadCampaignFromDisk('dnd35e-crypt');
  let state = buildGameState(campaign);

  const playerId = state.entities.find((id) => getComponent(state, id, ComponentType.Player) !== undefined)!;
  state = addComponent(state, playerId, {
    type: ComponentType.Position,
    x: 5,
    y: 5
  });

  const nonPlayerTemplateId =
    Object.entries(campaign.entities).find(([id, t]) => id !== 'player' && t.faction !== 'player')?.[0] ??
    Object.keys(campaign.entities)[0]!;
  const [withRival, rivalId] = spawnEntity(state, nonPlayerTemplateId, 6, 5);
  state = removeComponent(withRival, rivalId, ComponentType.Player);

  return { state, playerId, rivalId };
}

describe('Milestone 156: SRD Object/Durability Engine, Structural Doors, Spellbooks, Lore & Corpse/Religion/Disguise', () => {
  test('1. SRD Smashing an Object: Object AC, magic +1 (+2 hardness / +10 HP), Energy/Ranged multipliers, Adamantine bypass, 0 HP repairable ruined state, and 0% default combat wear', () => {
    const { state: initialState, playerId } = buildTestDnd35eState();
    let state = initialState;

    // 1. Object AC: Medium object = 10 + 0 (Medium) - 5 (Dex 0) - 2 (inanimate) = 3; Animated (+2 Dex) = 12
    expect(computeSrdObjectArmorClass('medium')).toBe(3);
    expect(computeSrdObjectArmorClass('small')).toBe(4);
    expect(computeSrdObjectArmorClass('medium', { isAnimated: true, animatedDexMod: 2 })).toBe(12);

    // 2. Magic +2 steel longsword: base hardness 10 -> 14 (+2/plus), base maxHp 5 -> 25 (+10/plus)
    const magicSwordStructural: StructuralComponent = {
      type: ComponentType.Structural,
      materialTag: 'steel',
      hardness: 10,
      hp: 25,
      maxHp: 5,
      breakDc: 20,
      objectSize: 'small',
      enhancementBonus: 2
    };
    const effective = resolveEffectiveStructuralStats(magicSwordStructural);
    expect(effective.effectiveHardness).toBe(14);
    expect(effective.effectiveMaxHp).toBe(25);

    // 3. Energy & Ranged multipliers before hardness (on hardness 5 wood shield):
    const woodShield: StructuralComponent = {
      type: ComponentType.Structural,
      materialTag: 'wood',
      hardness: 5,
      hp: 10,
      maxHp: 10,
      breakDc: 16,
      objectSize: 'small'
    };
    // Acid 1x: 12 -> 12 - 5 = 7
    expect(evaluateSrdObjectDamage(woodShield, { rawDamage: 12, damageType: 'acid' }).netDamage).toBe(7);
    // Fire 1/2: 16 -> 8 - 5 = 3
    expect(evaluateSrdObjectDamage(woodShield, { rawDamage: 16, damageType: 'fire' }).netDamage).toBe(3);
    // Cold 1/4: 24 -> 6 - 5 = 1
    expect(evaluateSrdObjectDamage(woodShield, { rawDamage: 24, damageType: 'cold' }).netDamage).toBe(1);
    // Ranged piercing 1/2: 14 -> 7 - 5 = 2
    expect(
      evaluateSrdObjectDamage(woodShield, { rawDamage: 14, damageType: 'piercing', isRangedWeapon: true }).netDamage
    ).toBe(2);
    // Nonlethal & Critical extra damage -> 0
    expect(
      evaluateSrdObjectDamage(woodShield, { rawDamage: 20, damageType: 'slashing', isNonlethal: true }).netDamage
    ).toBe(0);
    expect(
      evaluateSrdObjectDamage(woodShield, { rawDamage: 20, damageType: 'slashing', isCriticalExtraDamage: true })
        .netDamage
    ).toBe(0);
    // Adamantine ignores hardness < 20: 12 slashing -> 12 net damage
    expect(
      evaluateSrdObjectDamage(woodShield, {
        rawDamage: 12,
        damageType: 'slashing',
        weaponMaterialTag: 'adamantine'
      }).netDamage
    ).toBe(12);
    // Vulnerable material takes 2x ignoring hardness: 10 -> 20 net damage
    expect(
      evaluateSrdObjectDamage(woodShield, {
        rawDamage: 10,
        damageType: 'sonic',
        isMaterialVulnerableToAttack: true
      }).netDamage
    ).toBe(20);

    // 4. Reaching 0 HP sets ruined: true (never deleting the item) and is repairable with whetstone/artisan_tools
    const [withSword, swordId] = spawnItem(state, 'longsword', 5, 5);
    state = addComponent(withSword, swordId, woodShield);

    const hitRes = applySrdObjectAttackDamage(state, swordId, {
      rawDamage: 20,
      damageType: 'slashing',
      weaponMaterialTag: 'adamantine'
    });
    state = hitRes.state;
    expect(hitRes.becameRuined).toBe(true);
    expect(hitRes.remainingHp).toBe(0);
    const ruinedComp = getComponent(state, swordId, ComponentType.Structural) as StructuralComponent | undefined;
    expect(ruinedComp?.ruined).toBe(true);
    expect(state.entities.includes(swordId)).toBe(true);

    // Repair via whetstone
    const [withWhetstone, whetstoneId] = spawnItem(state, 'whetstone', 5, 5);
    state = withWhetstone;
    const repairIntentRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'apply',
      target: { type: 'item', itemEntityId: swordId },
      toolEntityId: whetstoneId
    });
    expect(repairIntentRes.success).toBe(true);
    state = repairIntentRes.state;
    const repairedComp = getComponent(state, swordId, ComponentType.Structural) as StructuralComponent | undefined;
    expect(repairedComp?.ruined).toBeUndefined();
    expect(repairedComp?.hp).toBe(10);

    // 5. Campaign durabilityConfig defaults to 0% wear
    const defaultCfg = resolveDurabilityConfig(state);
    expect(defaultCfg.enableFumbleWearChance).toBe(0);
    expect(defaultCfg.enableHardArmorWearChance).toBe(0);
    expect(defaultCfg.enableCritArmorWearChance).toBe(0);
    const wearRes = evaluateOptInCombatWear(state, swordId, 'fumble', 0.001);
    expect(wearRes.triggered).toBe(false);
  });

  test('2. Structural Doors: open/close, iron_spike + hammer wedging (+2 Break DC), kick/break with crowbar/portable_ram & <=50% HP -2 DC, and pole_10ft range-2 trap probing', () => {
    const { state: initialState, playerId } = buildTestDnd35eState();
    let state = initialState;

    // Create a closed structural door at (6, 5)
    const [withDoor, doorId] = createEntity(state);
    state = addComponent(withDoor, doorId, {
      type: ComponentType.Position,
      x: 6,
      y: 5
    });
    state = addComponent(state, doorId, {
      type: ComponentType.Structural,
      materialTag: 'wood',
      hardness: 5,
      hp: 15,
      maxHp: 15,
      breakDc: 18,
      objectSize: 'medium',
      isDoor: true,
      isOpen: false
    });

    // Open and close normally
    const openRes = openStructuralDoor(state, playerId, doorId);
    expect(openRes.success).toBe(true);
    state = openRes.state;
    expect((getComponent(state, doorId, ComponentType.Structural) as StructuralComponent).isOpen).toBe(true);

    const closeRes = closeStructuralDoor(state, playerId, doorId);
    expect(closeRes.success).toBe(true);
    state = closeRes.state;
    expect((getComponent(state, doorId, ComponentType.Structural) as StructuralComponent).isOpen).toBe(false);

    // Give player iron_spike + hammer and wedge the door shut (+2 Break DC -> 20)
    const [s1, spikeId] = spawnItem(state, 'iron_spike', 5, 5);
    const [s2, hammerId] = spawnItem(s1, 'hammer', 5, 5);
    const [s3, crowbarId] = spawnItem(s2, 'crowbar', 5, 5);
    const [s4, ramId] = spawnItem(s3, 'portable_ram', 5, 5);
    const [s5, poleId] = spawnItem(s4, 'pole_10ft', 5, 5);
    state = s5;
    const inv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
    state = addComponent(state, playerId, {
      type: ComponentType.Inventory,
      items: [...(inv?.items ?? []), spikeId, hammerId, crowbarId, ramId, poleId],
      baseCapacity: 30
    });

    const spikeRes = spikeDoorWithWedge(state, playerId, doorId, spikeId);
    expect(spikeRes.success).toBe(true);
    state = spikeRes.state;

    const spikedDoor = getComponent(state, doorId, ComponentType.Structural) as StructuralComponent;
    expect(spikedDoor.jammed).toBe(true);
    expect(spikedDoor.breakDc).toBe(20);
    expect(openStructuralDoor(state, playerId, doorId).success).toBe(false);

    // Damage door to <= 50% HP (7/15) -> Break DC drops by -2 (from 20 to 18)
    state = addComponent(state, doorId, {
      ...spikedDoor,
      hp: 7
    });

    // Break check with crowbar (+2) and portable_ram (+2 + 2 ally = +4) -> +6 tool bonus
    const breakRes = resolveSrdBreakObjectCheck(state, playerId, doorId, {
      allyAssistingWithRam: true,
      forcedD20: 12
    });
    expect(breakRes.effectiveDc).toBe(18);
    expect(breakRes.success).toBe(true);
    state = breakRes.state;
    expect((getComponent(state, doorId, ComponentType.Structural) as StructuralComponent).isOpen).toBe(true);

    // Place a hidden trap 2 tiles away at (7, 5) and probe it safely with pole_10ft
    const [withTrap, trapId] = createEntity(state);
    state = addComponent(withTrap, trapId, {
      type: ComponentType.Position,
      x: 7,
      y: 5,
      canShareTile: true
    });
    state = addComponent(state, trapId, {
      type: ComponentType.Trap,
      triggerId: 'pit_trap',
      triggered: false
    });

    const probeRes = probeTrapWithReachTool(state, playerId, 7, 5);
    expect(probeRes.success).toBe(true);
    expect(probeRes.triggeredTrapCount).toBe(1);
    state = probeRes.state;
    expect((getComponent(state, trapId, ComponentType.Trap) as TrapComponent).triggered).toBe(true);
  });

  test('3. Spellbook Rarity Tags, Enemy Wizard Spellbook Drops, Spellcraft Transcription, Auto Monster Lore & UMD DC 20', () => {
    const { state: initialState, playerId, rivalId } = buildTestDnd35eState();
    let state = initialState;

    // 1. Verify declarative spell rarity tags
    expect(getSpellRarityTier(['evocation'])).toBe('common');
    expect(getSpellRarityTier(['transmutation', 'rarity:uncommon'])).toBe('uncommon');
    expect(getSpellRarityTier(['transmutation', 'rarity:rare'])).toBe('rare');
    expect(getSpellRarityTier(['abjuration', 'rarity:forbidden'])).toBe('forbidden');

    // 2. Configure rival as a level 7 Wizard knowing fireball & haste, then spawn spellbook loot
    const rivalDnd = getDnD35EntityData(state, rivalId);
    state = setDnD35EntityData(state, rivalId, {
      ...rivalDnd,
      tracks: [{ trackId: 'wizard', source: 'class', hitDie: 4, levels: 7, babProgression: 'half' }],
      knownSpells: ['fireball', 'haste'],
      creatureType: 'undead',
      damageReduction: { amount: 5, bypassTags: ['bludgeoning'] },
      spellResistance: 14,
      immunities: ['cold'],
      vulnerabilities: ['fire']
    });

    const dropRes = spawnArcaneCasterSpellbookLoot(state, rivalId, 6, 5);
    expect(dropRes.spellbookEntityId).toBeDefined();
    expect(dropRes.storedSpellIds).toContain('fireball');
    expect(dropRes.storedSpellIds).toContain('haste');
    state = dropRes.state;
    const bookId = dropRes.spellbookEntityId!;
    expect(getStoredSpellsOnSpellbook(state, bookId)).toContain('haste');

    // 3. Transcribe 'haste' (level 3 -> DC 18) into player's spellbook using inkpen + ink_vial
    const [s1, penId] = spawnItem(state, 'inkpen', 5, 5);
    const [s2, inkId] = spawnItem(s1, 'ink_vial', 5, 5);
    state = s2;
    const playerInv = getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined;
    state = addComponent(state, playerId, {
      type: ComponentType.Inventory,
      items: [...(playerInv?.items ?? []), penId, inkId],
      baseCapacity: 30
    });

    const playerDnd = getDnD35EntityData(state, playerId);
    state = setDnD35EntityData(state, playerId, {
      ...playerDnd,
      tracks: [{ trackId: 'wizard', source: 'class', hitDie: 4, levels: 5, babProgression: 'poor' }],
      skillRanks: {
        ...(playerDnd.skillRanks ?? {}),
        spellcraft: 6,
        knowledge_religion: 8,
        use_magic_device: 5
      },
      knownSpells: []
    });

    const prevTurn = state.globalTurn;
    const scribeRes = transcribeSpellFromBook(state, playerId, bookId, {
      spellId: 'haste',
      forcedD20: 15
    });
    expect(scribeRes.dc).toBe(18);
    expect(scribeRes.success).toBe(true);
    state = scribeRes.state;
    expect(getDnD35EntityData(state, playerId).knownSpells).toContain('haste');
    expect(state.globalTurn).toBeGreaterThan(prevTurn);

    // 4. Auto Monster Lore check persists discovered DR/SR/immunities/vulnerabilities onto MemoryComponent
    const loreRes = evaluateAndRecordMonsterLore(state, playerId, rivalId, {
      forcedD20: 18,
      announceInLog: true
    });
    expect(loreRes.success).toBe(true);
    expect(loreRes.revealedTraits.some((t) => t.includes('DR: 5/bludgeoning'))).toBe(true);
    state = loreRes.state;

    const projectedLines = projectDnD35eInspectLoreLines(state, rivalId);
    expect(projectedLines.some((l) => l.value.includes('DR: 5/bludgeoning'))).toBe(true);

    // 5. UMD DC 20 wand activation for non-spell-trigger fighter with UMD ranks
    state = setDnD35EntityData(state, playerId, {
      ...getDnD35EntityData(state, playerId),
      tracks: [{ trackId: 'fighter', source: 'class', hitDie: 10, levels: 3, babProgression: 'full' }]
    });
    const umdRes = validateDnD35eWandActivation(state, playerId);
    expect(typeof umdRes.allowed).toBe('boolean');
  });

  test('4. Physical Corpse Economy, Piety (ReligionComponent) & Active Disguise (IdentityMaskComponent)', () => {
    const { state: initialState, playerId, rivalId } = buildTestDnd35eState();
    let state = initialState;

    // 1. Slaying an entity spawns a physical CorpseComponent with harvestableTags
    const rivalDnd = getDnD35EntityData(state, rivalId);
    state = setDnD35EntityData(state, rivalId, {
      ...rivalDnd,
      creatureType: 'animal'
    });

    const corpseRes = spawnCorpseForSlainEntity(state, rivalId, 6, 5, 10);
    expect(corpseRes.corpseEntityId).toBeDefined();
    state = corpseRes.state;
    const corpseId = corpseRes.corpseEntityId!;
    const corpseComp = getComponent(state, corpseId, ComponentType.Corpse) as CorpseComponent;
    expect(corpseComp.harvestableTags).toContain('pelt');
    expect(corpseComp.harvestableTags).toContain('zombie_husk');

    // Harvest 'pelt' (non-destructive), then tick past decayTurn to verify rot removal
    const harvestPelt = harvestCorpseTag(state, playerId, corpseId, 'pelt');
    expect(harvestPelt.success).toBe(true);
    state = harvestPelt.state;
    expect(harvestCorpseTag(state, playerId, corpseId, 'pelt').success).toBe(false);

    state = { ...state, globalTurn: state.globalTurn + 15 };
    state = tickCorpseDecay(state);
    expect(state.entities.includes(corpseId)).toBe(false);

    // Also verify processDeathSystem automatically drops a corpse
    const nonPlayerId =
      Object.entries(state.campaign.entities).find(([id, t]) => id !== 'player' && t.faction !== 'player')?.[0] ??
      Object.keys(state.campaign.entities)[0]!;
    const [withVictim2, victim2Id] = spawnEntity(state, nonPlayerId, 7, 5);
    state = removeComponent(withVictim2, victim2Id, ComponentType.Player);
    state = addComponent(state, victim2Id, {
      type: ComponentType.Death,
      killerId: playerId
    });
    state = processDeathSystem(state);
    const droppedCorpseOn7_5 = (state.spatialIndex.get('7,5,0') ?? []).find(
      (eid) => getComponent(state, eid, ComponentType.Corpse) !== undefined
    );
    expect(droppedCorpseOn7_5).toBeDefined();

    // 2. ReligionComponent: favor delta, taboo violation, and altar atonement
    const favorRes = recordDeityFavorDelta(state, playerId, 20, 'pelor');
    state = favorRes.state;
    expect(favorRes.favorScore).toBe(20);

    state = recordTabooViolation(state, playerId, 'desecrate_shrine', 15);
    const relAfterTaboo = getComponent(state, playerId, ComponentType.Religion) as ReligionComponent;
    expect(relAfterTaboo.penanceDebt).toBe(15);
    expect(relAfterTaboo.taboosViolated).toContain('desecrate_shrine');

    const atoneRes = atonePenanceAtAltar(state, playerId);
    expect(atoneRes.success).toBe(true);
    expect(atoneRes.remainingPenanceDebt).toBe(0);
    state = atoneRes.state;
    expect((getComponent(state, playerId, ComponentType.Religion) as ReligionComponent).taboosViolated.length).toBe(0);

    // 3. IdentityMaskComponent: faction disguise suppresses hostility until Spot scrutiny blows the disguise
    const rivalFaction =
      (getComponent(state, rivalId, ComponentType.Faction)?.factionId as string | undefined) ?? 'monsters';
    state = addComponent(state, rivalId, {
      type: ComponentType.Faction,
      factionId: rivalFaction
    });
    state = removeComponent(state, rivalId, ComponentType.Attitude);
    state = applyIdentityMask(state, playerId, rivalFaction, 18);
    expect(isDisguiseSuppressingHostility(state, rivalId, playerId)).toBe(true);
    expect(isHostile(state, rivalId, playerId)).toBe(false);

    // High observer Spot roll (20 + 4 familiarity > 18) twice reaches 100 suspicion and blows the disguise
    const scrutiny1 = evaluateDisguiseSuspicion(state, playerId, { forcedObserverSpotRoll: 20 });
    expect(scrutiny1.suspicion).toBeGreaterThanOrEqual(50);
    expect(scrutiny1.blown).toBe(false);
    state = scrutiny1.state;

    const scrutiny2 = evaluateDisguiseSuspicion(state, playerId, { forcedObserverSpotRoll: 20 });
    expect(scrutiny2.blown).toBe(true);
    state = scrutiny2.state;
    expect(getComponent(state, playerId, ComponentType.IdentityMask)).toBeUndefined();
    expect(isHostile(state, rivalId, playerId)).toBe(true);
  });

  test('5. Template-spawned structural doors, magic +1 effectiveMaxHp repair/break DC, divine-only Cleric spellbook exclusion, elemental corpse suppression, and harvest/pray/disguise_kit verbs', () => {
    const { state: initialState, playerId, rivalId } = buildTestDnd35eState();
    let state = initialState;

    // 1. Template-spawned structural door hydrates StructuralComponent and syncs Renderable glyph on open/close
    state = {
      ...state,
      campaign: {
        ...state.campaign,
        entities: {
          ...state.campaign.entities,
          oak_door: {
            id: 'oak_door',
            name: 'Oak Door',
            glyph: '+',
            fg: '#d35400',
            bg: 'transparent',
            isActor: false,
            tags: ['door', 'solid', 'opaque'],
            structural: {
              materialId: 'wood',
              thicknessInches: 2,
              hp: 20,
              maxHp: 20,
              isDoor: true,
              isOpen: false,
              breakDc: 18
            }
          }
        }
      }
    };
    const [sDoor, oakDoorId] = spawnEntity(state, 'oak_door', 6, 6);
    state = sDoor;
    const spawnedDoorComp = getComponent(state, oakDoorId, ComponentType.Structural) as StructuralComponent | undefined;
    expect(spawnedDoorComp?.isDoor).toBe(true);
    expect(spawnedDoorComp?.maxHp).toBe(20);
    state = openStructuralDoor(state, playerId, oakDoorId).state;
    expect((getComponent(state, oakDoorId, ComponentType.Renderable) as RenderableComponent | undefined)?.glyph).toBe('/');
    state = closeStructuralDoor(state, playerId, oakDoorId).state;
    expect((getComponent(state, oakDoorId, ComponentType.Renderable) as RenderableComponent | undefined)?.glyph).toBe('+');

    // 2. Magic +1 shield (base maxHp 10 + 10 = effectiveMaxHp 20): repair restores full 20 HP and Break DC -2 applies at <= 10 HP (50% of effectiveMaxHp)
    const [sShield, magicShieldId] = createEntity(state);
    state = addComponent(sShield, magicShieldId, {
      type: ComponentType.Structural,
      materialTag: 'wood',
      hardness: 5,
      hp: 0,
      maxHp: 10,
      breakDc: 20,
      objectSize: 'small',
      enhancementBonus: 1,
      ruined: true
    });
    const repairedShield = repairRuinedItem(state, playerId, magicShieldId);
    expect(repairedShield.success).toBe(true);
    state = repairedShield.state;
    expect((getComponent(state, magicShieldId, ComponentType.Structural) as StructuralComponent).hp).toBe(20);

    // Damage shield to 9 HP (45% of effectiveMaxHp 20, though >50% of base maxHp 10) -> Break DC drops by -2
    state = addComponent(state, magicShieldId, {
      ...(getComponent(state, magicShieldId, ComponentType.Structural) as StructuralComponent),
      hp: 9
    });
    const shieldBreak = resolveSrdBreakObjectCheck(state, playerId, magicShieldId, { forcedD20: 10 });
    // Base Break DC 20 - 2 (<= 50% of effectiveMaxHp 20) = 18
    expect(shieldBreak.effectiveDc).toBe(18);

    // 3. Divine-only Cleric does NOT drop an arcane wizards_spellbook on death and cannot transcribe arcane spells
    const clericDnd = getDnD35EntityData(state, rivalId);
    state = setDnD35EntityData(state, rivalId, {
      ...clericDnd,
      tracks: [{ trackId: 'cleric', classId: 'cleric', source: 'class', hitDie: 8, levels: 5, babProgression: 'medium' }],
      knownSpells: ['cure_light_wounds']
    });
    const clericDrop = spawnArcaneCasterSpellbookLoot(state, rivalId, 6, 5);
    expect(clericDrop.spellbookEntityId).toBeUndefined();

    // 4. Elemental and incorporeal creatures do NOT spawn physical corpses on death
    state = setDnD35EntityData(state, rivalId, {
      ...getDnD35EntityData(state, rivalId),
      creatureType: 'elemental',
      subtypes: ['fire', 'extraplanar']
    });
    expect(spawnCorpseForSlainEntity(state, rivalId, 6, 5).corpseEntityId).toBeUndefined();

    state = setDnD35EntityData(state, rivalId, {
      ...getDnD35EntityData(state, rivalId),
      creatureType: 'undead',
      subtypes: ['incorporeal']
    });
    expect(spawnCorpseForSlainEntity(state, rivalId, 6, 5).corpseEntityId).toBeUndefined();

    // 5. Verbs: 'harvest' on beast corpse spawns yield item into inventory; 'pray' on consecrated altar; 'apply' with disguise_kit
    state = setDnD35EntityData(state, rivalId, {
      ...getDnD35EntityData(state, rivalId),
      creatureType: 'animal',
      subtypes: []
    });
    const beastCorpseRes = spawnCorpseForSlainEntity(state, rivalId, 6, 5);
    expect(beastCorpseRes.corpseEntityId).toBeDefined();
    state = beastCorpseRes.state;
    const beastCorpseId = beastCorpseRes.corpseEntityId!;
    expect(getValidVerbsForTarget(state, playerId, { type: 'entity', entityId: beastCorpseId })).toContain('harvest');

    const beforeInvCount = (getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent | undefined)?.items.length ?? 0;
    const harvestVerbRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'harvest',
      target: { type: 'entity', entityId: beastCorpseId }
    });
    expect(harvestVerbRes.success).toBe(true);
    state = harvestVerbRes.state;
    const afterInvCount = (getComponent(state, playerId, ComponentType.Inventory) as InventoryComponent).items.length;
    expect(afterInvCount).toBe(beforeInvCount + 1);

    // Consecrated altar with 'deity:pelor' tag projects 'pray' and grants Pelor favor
    const [sAltar, altarId] = createEntity(state);
    state = addComponent(sAltar, altarId, { type: ComponentType.Position, x: 5, y: 6 });
    state = addComponent(state, altarId, { type: ComponentType.Tags, tags: ['altar', 'divine', 'deity:pelor'] });
    expect(getValidVerbsForTarget(state, playerId, { type: 'entity', entityId: altarId })).toContain('pray');
    const prayRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'pray',
      target: { type: 'entity', entityId: altarId }
    });
    expect(prayRes.success).toBe(true);
    state = prayRes.state;
    expect((getComponent(state, playerId, ComponentType.Religion) as ReligionComponent).deityOrPatronId).toBe('pelor');

    // Disguise kit projects 'apply' and applies IdentityMaskComponent
    const [sKit, disguiseKitId] = spawnItem(state, 'disguise_kit', 5, 5);
    state = sKit;
    expect(getValidVerbsForTarget(state, playerId, { type: 'item', itemEntityId: disguiseKitId })).toContain('apply');
    const applyDisguiseRes = processApplyIntent(state, {
      type: IntentType.Apply,
      entityId: playerId,
      verb: 'apply',
      target: { type: 'item', itemEntityId: disguiseKitId }
    });
    expect(applyDisguiseRes.success).toBe(true);
    expect(getComponent(applyDisguiseRes.state, playerId, ComponentType.IdentityMask)).toBeDefined();
  });
});

