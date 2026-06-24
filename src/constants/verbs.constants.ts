/**
 * Canonical interaction verbs supported by the engine's ApplyIntent pipeline.
 */
export type Verb =
  | 'apply'
  | 'throw'
  | 'kick'
  | 'open'
  | 'close'
  | 'lock'
  | 'unlock'
  | 'dip'
  | 'zap'
  | 'ignite'
  | 'read'
  | 'eat'
  | 'drink'
  | 'impact'
  | 'barter'
  | 'intimidate'
  | 'persuade'
  | 'spare'
  | 'humiliate'
  | 'recruit'
  | 'brand'
  | 'ransom'
  | 'gift'
  | 'apologize'
  | 'argue';

/**
 * Read-only array of all valid interaction verbs in the game engine.
 */
export const VERBS: ReadonlyArray<Verb> = [
  'apply',
  'throw',
  'kick',
  'open',
  'close',
  'lock',
  'unlock',
  'dip',
  'zap',
  'ignite',
  'read',
  'eat',
  'drink',
  'impact',
  'barter',
  'intimidate',
  'persuade',
  'spare',
  'humiliate',
  'recruit',
  'brand',
  'ransom',
  'gift',
  'apologize',
  'argue'
];
