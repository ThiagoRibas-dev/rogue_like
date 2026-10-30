import { type EntityId, type GameState, UIMode } from '../../types/game-state.types.ts';
import {
  ComponentType,
  type Component,
  type FighterComponent,
  type KnowledgeItem,
  type MemoryComponent,
  type RenderableComponent
} from '../../types/components.types.ts';
import { getComponent } from '../../core/ecs.ts';
import {
  INVESTIGATION_EMPTY_CLUES,
  INVESTIGATION_EMPTY_CLUES_FILTERED,
  INVESTIGATION_EMPTY_SUSPECTS,
  INVESTIGATION_EMPTY_SUSPECTS_FILTERED,
  getInvestigationFilter,
  type InvestigationFilterDefinition,
  type InvestigationFilterId
} from '../../constants/investigation_filter.constants.ts';
import { renderInvestigationFilterBar } from './investigation_filters.ui.ts';

/**
 * Active filter chip. Held in module scope because the board is fully re-rendered
 * on every `PresentationDomain.Modals` dirty frame, so instance state would reset.
 */
let activeFilter: InvestigationFilterId = 'all';

/** A clue paired with the knowledge item that describes it. */
interface DiscoveredClue {
  readonly clueId: string;
  readonly item: KnowledgeItem | undefined;
}

/**
 * Renders the Investigation Board UI panel.
 * Displays known suspects and discovered clues, narrowed by the active filter chip.
 *
 * @param state The current GameState.
 */
export function renderInvestigationBoard(state: GameState): void {
  const overlay = document.getElementById('investigation-overlay');
  const suspectsList = document.getElementById('investigation-suspects');
  const cluesList = document.getElementById('investigation-clues');
  const filterBar = document.getElementById('investigation-filters');

  if (!overlay || !suspectsList || !cluesList) return;

  if (state.uiMode !== UIMode.Investigation) {
    overlay.classList.add('hidden');
    return;
  }

  overlay.classList.remove('hidden');
  suspectsList.replaceChildren();
  cluesList.replaceChildren();

  const filter = getInvestigationFilter(activeFilter);
  if (filterBar !== null) {
    renderInvestigationFilterBar(filterBar, filter.id, (id) => {
      activeFilter = id;
      renderInvestigationBoard(state);
    });
  }

  renderSuspectsPane(state, suspectsList, filter);
  renderCluesPane(state, cluesList, filter);
}

/**
 * Renders the suspects pane, honouring the active filter.
 *
 * @param state The current GameState.
 * @param list The suspects container.
 * @param filter The active filter definition.
 */
function renderSuspectsPane(
  state: GameState,
  list: HTMLElement,
  filter: InvestigationFilterDefinition
): void {
  const actorIds = state.investigation.knownActors;
  if (actorIds.length === 0) {
    list.appendChild(buildEmptyState(INVESTIGATION_EMPTY_SUSPECTS));
    return;
  }

  const visibleActors = actorIds.filter((actorId) => matchesSuspectFilter(state, actorId, filter));
  if (visibleActors.length === 0) {
    list.appendChild(buildEmptyState(INVESTIGATION_EMPTY_SUSPECTS_FILTERED));
    return;
  }

  for (const actorId of visibleActors) {
    const details = resolveSuspectDetails(state, actorId);

    const item = document.createElement('div');
    item.className = 'investigation-item suspect-item';

    const name = document.createElement('div');
    name.className = 'suspect-name';
    name.textContent = details.name;

    const status = document.createElement('div');
    status.className = details.isAlive ? 'suspect-status alive' : 'suspect-status dead';
    status.textContent = details.isAlive ? 'At Large' : 'Neutralized';

    item.appendChild(name);
    item.appendChild(status);
    list.appendChild(item);
  }
}

/**
 * Renders the clues pane, honouring the active filter.
 *
 * @param state The current GameState.
 * @param list The clues container.
 * @param filter The active filter definition.
 */
function renderCluesPane(state: GameState, list: HTMLElement, filter: InvestigationFilterDefinition): void {
  const clues = collectDiscoveredClues(state);
  if (clues.length === 0) {
    list.appendChild(buildEmptyState(INVESTIGATION_EMPTY_CLUES));
    return;
  }

  const visibleClues = clues.filter(
    (clue) => !filter.filtersClues || matchesKnowledgeFilter(clue.item, filter)
  );
  if (visibleClues.length === 0) {
    list.appendChild(buildEmptyState(INVESTIGATION_EMPTY_CLUES_FILTERED));
    return;
  }

  for (const clue of visibleClues) {
    const item = document.createElement('div');
    item.className = 'investigation-item clue-item';

    const clueId = document.createElement('div');
    clueId.className = 'clue-id';
    clueId.textContent = `Evidence: ${clue.clueId}`;

    const description = document.createElement('div');
    description.className = 'clue-desc';
    description.textContent = clue.item?.description ?? 'Ties a minion to a mastermind...';

    item.appendChild(clueId);
    item.appendChild(description);
    list.appendChild(item);
  }
}

/**
 * Collects the player's discovered clues from their Memory component.
 *
 * @param state The current GameState.
 * @returns Discovered clues paired with their knowledge items.
 */
function collectDiscoveredClues(state: GameState): ReadonlyArray<DiscoveredClue> {
  for (const entityId of state.entities) {
    if (getComponent(state, entityId, ComponentType.Player) === undefined) continue;

    const memory = getComponent(state, entityId, ComponentType.Memory) as MemoryComponent | undefined;
    if (memory === undefined) return [];

    return Object.entries(memory.knowledge).map(([clueId, item]) => ({ clueId, item }));
  }
  return [];
}

/**
 * Tests whether a known actor satisfies the active filter's suspect predicate.
 *
 * @param state The current GameState.
 * @param actorId The suspect entity id.
 * @param filter The active filter definition.
 * @returns True when the suspect should be displayed.
 */
function matchesSuspectFilter(
  state: GameState,
  actorId: EntityId,
  filter: InvestigationFilterDefinition
): boolean {
  if (!filter.filtersSuspects) return true;

  // `All` is the only chip that filters trivia without a component predicate.
  const requiredComponent = filter.suspectComponent;
  if (requiredComponent === undefined) return true;

  const components = getSuspectComponents(state, actorId);
  if (components === undefined) return false;
  return components[requiredComponent] !== undefined;
}

/**
 * Tests whether a knowledge item satisfies the active filter's clue predicate.
 *
 * @param item The knowledge item, when one is recorded for the clue.
 * @param filter The active filter definition.
 * @returns True when the clue should be displayed.
 */
function matchesKnowledgeFilter(item: KnowledgeItem | undefined, filter: InvestigationFilterDefinition): boolean {
  if (filter.id === 'all') return true;
  if (item === undefined) return false;
  if (filter.knowledgeTypes.includes(item.type)) return true;
  return item.tags.some((tag) => filter.knowledgeTags.includes(tag));
}

/**
 * Resolves a suspect's display name and liveness from live or cold-storage components.
 *
 * @param state The current GameState.
 * @param actorId The suspect entity id.
 * @returns The display name and whether the suspect is still alive.
 */
function resolveSuspectDetails(state: GameState, actorId: EntityId): { name: string; isAlive: boolean } {
  const components = getSuspectComponents(state, actorId);
  if (components === undefined) {
    return { name: 'Deceased Suspect', isAlive: false };
  }

  const renderable = components[ComponentType.Renderable] as RenderableComponent | undefined;
  const fighter = components[ComponentType.Fighter] as FighterComponent | undefined;

  let name = 'A Shadowy Figure';
  if (renderable !== undefined) {
    name = renderable.glyph === '@' ? 'The Mastermind' : `Suspect (${renderable.glyph})`;
  }

  return { name, isAlive: fighter !== undefined && fighter.hp > 0 };
}

/**
 * Returns an actor's component record from live state or persistent storage.
 *
 * @param state The current GameState.
 * @param actorId The actor entity id.
 * @returns The component record, or undefined when the actor is unknown.
 */
function getSuspectComponents(state: GameState, actorId: EntityId): Readonly<Record<string, Component>> | undefined {
  const active = state.components.get(actorId);
  if (active !== undefined) return active;
  return state.persistentEntities.get(actorId)?.components;
}

/**
 * Builds an empty-state placeholder element.
 *
 * @param text The message to display.
 * @returns The constructed element.
 */
function buildEmptyState(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = 'investigation-empty';
  element.textContent = text;
  return element;
}
