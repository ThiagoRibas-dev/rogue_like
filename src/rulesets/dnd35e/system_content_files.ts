import type { RulesetSystemFileDescriptor } from '../../types/ruleset.types.ts';

const ARCHETYPE_IDS: ReadonlyArray<string> = [
  'player',
  'default_creature',
  'kobold',
  'goblin',
  'orc',
  'hobgoblin',
  'bugbear',
  'dire_rat',
  'wolf',
  'dire_wolf',
  'skeleton',
  'zombie',
  'ghoul',
  'owlbear',
  'ogre',
  'minotaur',
  'troll',
  'ettin',
  'hill_giant',
  'flesh_golem',
  'clay_golem',
  'stone_golem',
  'iron_golem',
  'mind_flayer',
  'marilith',
  'balor',
  'pit_fiend',
  'gnoll',
  'giant_fire_beetle',
  'black_bear',
  'giant_spider',
  'giant_centipede',
  'stirge',
  'ghast',
  'wight',
  'shadow',
  'gelatinous_cube',
  'rust_monster',
  'gargoyle',
  'displacer_beast',
  'basilisk',
  'medusa',
  'manticore',
  'wraith',
  'mummy',
  'beholder',
  'stone_giant',
  'frost_giant',
  'fire_giant',
  'dire_bear',
  'chimera'
];

const CLASS_IDS: ReadonlyArray<string> = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'wizard',
  'arcane_archer',
  'assassin',
  'blackguard',
  'dragon_disciple',
  'duelist',
  'dwarven_defender',
  'eldritch_knight',
  'loremaster',
  'mystic_theurge',
  'shadowdancer'
];

const FEAT_IDS: ReadonlyArray<string> = [
  'power_attack',
  'cleave',
  'combat_reflexes',
  'improved_initiative',
  'blind_fight',
  'weapon_focus_bite',
  'weapon_focus_greatclub',
  'toughness',
  'iron_will',
  'alertness',
  'track'
];

const SPELL_IDS: ReadonlyArray<string> = [
  'magic_missile',
  'fireball',
  'cure_light_wounds',
  'ray_of_enfeeblement',
  'burning_hands'
];

const TEMPLATE_IDS: ReadonlyArray<string> = [
  'celestial',
  'fiendish',
  'half_dragon_red',
  'half_dragon_black',
  'half_dragon_gold',
  'half_dragon_silver',
  'half_fiend',
  'half_celestial',
  'skeleton',
  'zombie',
  'lich',
  'vampire',
  'ghost'
];

const RACE_IDS: ReadonlyArray<string> = [
  'human',
  'dwarf',
  'elf',
  'gnome',
  'half_elf',
  'half_orc',
  'halfling',
  'drow',
  'duergar',
  'svirfneblin',
  'tiefling',
  'aasimar',
  'goblin',
  'kobold',
  'orc',
  'hobgoblin',
  'bugbear'
];

/**
 * Canonical list of System Content JSON file descriptors for the `dnd35e` ruleset cartridge.
 * Multiple descriptors sharing the same `key` are shallow-merged by `loader.ts`, `tests/helpers.ts`, and `run-validator.ts`.
 */
export const DND35E_SYSTEM_CONTENT_FILES: ReadonlyArray<RulesetSystemFileDescriptor> = [
  { key: 'archetypes', filename: 'archetypes.json' },
  ...ARCHETYPE_IDS.map((id) => ({ key: 'archetypes', filename: `archetypes/${id}.json` })),
  { key: 'classes', filename: 'classes.json' },
  ...CLASS_IDS.map((id) => ({ key: 'classes', filename: `classes/${id}.json` })),
  { key: 'domains', filename: 'domains.json' },
  { key: 'skills', filename: 'skills.json' },
  { key: 'feats', filename: 'feats.json' },
  ...FEAT_IDS.map((id) => ({ key: 'feats', filename: `feats/${id}.json` })),
  { key: 'spells', filename: 'spells.json' },
  ...SPELL_IDS.map((id) => ({ key: 'spells', filename: `spells/${id}.json` })),
  { key: 'templates', filename: 'templates.json' },
  ...TEMPLATE_IDS.map((id) => ({ key: 'templates', filename: `templates/${id}.json` })),
  { key: 'races', filename: 'races.json' },
  ...RACE_IDS.map((id) => ({ key: 'races', filename: `races/${id}.json` })),
  { key: 'creatureTypes', filename: 'creature_types.json' },
  { key: 'dragonFamilies', filename: 'dragon_families.json' }
];
