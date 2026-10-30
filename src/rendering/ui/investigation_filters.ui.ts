import {
  INVESTIGATION_FILTERS,
  type InvestigationFilterId
} from '../../constants/investigation_filter.constants.ts';

/**
 * Renders the investigation board filter chip toolbar.
 *
 * Chips are rebuilt in place inside a fixed-height, non-wrapping toolbar so
 * changing the active filter never reflows the suspect or clue panes.
 *
 * @param container The toolbar element.
 * @param activeId The currently active filter id.
 * @param onSelect Invoked with the chosen filter id when a chip is clicked.
 */
export function renderInvestigationFilterBar(
  container: HTMLElement,
  activeId: InvestigationFilterId,
  onSelect: (id: InvestigationFilterId) => void
): void {
  container.replaceChildren();

  for (const filter of INVESTIGATION_FILTERS) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = filter.id === activeId ? 'chip active' : 'chip';
    chip.dataset.filterId = filter.id;
    chip.textContent = filter.label;
    chip.setAttribute('aria-pressed', String(filter.id === activeId));

    chip.addEventListener('click', () => {
      onSelect(filter.id);
    });

    container.appendChild(chip);
  }
}
