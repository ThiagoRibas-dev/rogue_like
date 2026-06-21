import type { GameState } from '../game-state.types.ts';
import type { GameEvent } from '../events.types.ts';

import type { WaitIntent, ToggleEngineModeIntent, TogglePauseIntent, SetRTwPSpeedIntent } from './core.intents.ts';

import type { MoveIntent, ChangeAreaIntent } from './movement.intents.ts';

import type { ApplyIntent, InteractIntent, SayIntent } from './interaction.intents.ts';

import type {
  MeleeAttackIntent,
  ToggleTargetingIntent,
  MoveTargetIntent,
  FireAimedIntent,
  UseAbilityIntent
} from './combat.intents.ts';

import type { PickUpIntent, DropIntent, EquipItemIntent, UnequipItemIntent } from './inventory.intents.ts';

import type {
  ToggleInventoryIntent,
  ToggleFactionsIntent,
  ToggleSettingsIntent,
  StartDialogueIntent,
  SelectDialogueOptionIntent,
  CloseDialogueIntent,
  ToggleQuestsIntent,
  ToggleInvestigationIntent,
  ToggleDebugIntent,
  ToggleDossierIntent,
  AskAboutIntent,
  GossipIntent
} from './ui.intents.ts';

import type { ToggleRotatedIntent, Toggle3DIntent, SetZoomLevelIntent } from './camera.intents.ts';

import type {
  DebugRevealMapIntent,
  DebugGodModeIntent,
  DebugSpawnEntityIntent,
  DebugFastForwardSchemesIntent,
  DebugPromoteIntent
} from './debug.intents.ts';

import type { ToggleInspectIntent, MoveInspectIntent } from './inspect.intents.ts';

export type Intent =
  | MoveIntent
  | WaitIntent
  | ChangeAreaIntent
  | DebugRevealMapIntent
  | DebugGodModeIntent
  | DebugSpawnEntityIntent
  | DebugFastForwardSchemesIntent
  | DebugPromoteIntent
  | ToggleTargetingIntent
  | MoveTargetIntent
  | FireAimedIntent
  | MeleeAttackIntent
  | PickUpIntent
  | DropIntent
  | EquipItemIntent
  | UnequipItemIntent
  | ToggleInventoryIntent
  | ToggleFactionsIntent
  | ToggleSettingsIntent
  | UseAbilityIntent
  | ToggleEngineModeIntent
  | TogglePauseIntent
  | SetRTwPSpeedIntent
  | ToggleInspectIntent
  | MoveInspectIntent
  | ToggleRotatedIntent
  | Toggle3DIntent
  | SetZoomLevelIntent
  | StartDialogueIntent
  | SelectDialogueOptionIntent
  | CloseDialogueIntent
  | ToggleQuestsIntent
  | ToggleInvestigationIntent
  | ToggleDebugIntent
  | ToggleDossierIntent
  | AskAboutIntent
  | GossipIntent
  | ApplyIntent
  | InteractIntent
  | SayIntent;

export interface ActionResult {
  readonly state: GameState;
  readonly success: boolean;
  readonly events?: ReadonlyArray<GameEvent>;
  readonly energyCost: number;
}
