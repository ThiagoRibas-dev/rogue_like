/**
 * Canonical interaction verbs supported by the engine's ApplyIntent pipeline.
 */
export type Verb =
  | 'apply'
  | 'attack'
  | 'throw'
  | 'kick'
  | 'shove'
  | 'talk'
  | 'open'
  | 'close'
  | 'lock'
  | 'unlock'
  | 'search'
  | 'disarm'
  | 'feint'
  | 'heal'
  | 'dip'
  | 'zap'
  | 'ignite'
  | 'read'
  | 'eat'
  | 'drink'
  | 'impact'
  | 'barter'
  | 'buy'
  | 'sell'
  | 'appraise'
  | 'haggle'
  | 'intimidate'
  | 'persuade'
  | 'spare'
  | 'humiliate'
  | 'recruit'
  | 'brand'
  | 'ransom'
  | 'gift'
  | 'apologize'
  | 'argue'
  | 'command'
  | 'order_attack'
  | 'order_defend'
  | 'order_follow'
  | 'order_hold'
  | 'order_target'
  | 'charge'
  | 'harvest'
  | 'pray'
  | 'mine'
  | 'chop'
  | 'build'
  | 'craft';

/**
 * Read-only array of all valid interaction verbs in the game engine.
 */
export const VERBS: ReadonlyArray<Verb> = [
  'apply',
  'attack',
  'throw',
  'kick',
  'shove',
  'talk',
  'open',
  'close',
  'lock',
  'unlock',
  'search',
  'disarm',
  'feint',
  'heal',
  'dip',
  'zap',
  'ignite',
  'read',
  'eat',
  'drink',
  'impact',
  'barter',
  'buy',
  'sell',
  'appraise',
  'haggle',
  'intimidate',
  'persuade',
  'spare',
  'humiliate',
  'recruit',
  'brand',
  'ransom',
  'gift',
  'apologize',
  'argue',
  'command',
  'order_attack',
  'order_defend',
  'order_follow',
  'order_hold',
  'order_target',
  'charge',
  'harvest',
  'pray',
  'mine',
  'chop',
  'build',
  'craft'
];
