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
  | 'impact';

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
  'impact'
];
