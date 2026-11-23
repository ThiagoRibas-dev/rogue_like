import type { JSX, TargetedKeyboardEvent } from 'preact';
import { useState } from 'preact/hooks';
import { useRovingFocus } from './focus_hooks.ts';

/** Hierarchical node rendered inside `<TreeList />`. */
export interface TreeNodeData {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | undefined;
  readonly meta?: string | undefined;
  readonly children?: ReadonlyArray<TreeNodeData> | undefined;
}

interface FlattenedTreeNode {
  readonly node: TreeNodeData;
  readonly depth: number;
  readonly hasChildren: boolean;
  readonly isExpanded: boolean;
}

/** Props for `<TreeList />`. */
export interface TreeListProps {
  readonly nodes: ReadonlyArray<TreeNodeData>;
  readonly selectedId?: string | null | undefined;
  readonly onSelect?: ((nodeId: string) => void) | undefined;
  readonly ariaLabel?: string | undefined;
  readonly className?: string | undefined;
}

function flattenVisibleTree(
  nodes: ReadonlyArray<TreeNodeData>,
  expandedIds: Readonly<Record<string, boolean>>,
  depth: number,
  out: FlattenedTreeNode[]
): void {
  for (const node of nodes) {
    const hasChildren = Boolean(node.children && node.children.length > 0);
    const isExpanded = expandedIds[node.id] !== false;
    out.push({ node, depth, hasChildren, isExpanded });
    if (hasChildren && isExpanded && node.children) {
      flattenVisibleTree(node.children, expandedIds, depth + 1, out);
    }
  }
}

/**
 * Keyboard-navigable hierarchical tree list (Nemesis ranks & Phase 44 Dialogue Editor).
 */
export function TreeList({
  nodes,
  selectedId,
  onSelect,
  ariaLabel = 'Hierarchy tree',
  className
}: TreeListProps): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const flat: FlattenedTreeNode[] = [];
  flattenVisibleTree(nodes, expandedIds, 0, flat);

  const selectedIndex = selectedId
    ? Math.max(
        0,
        flat.findIndex((f) => f.node.id === selectedId)
      )
    : 0;

  const toggleExpand = (nodeId: string, force?: boolean): void => {
    setExpandedIds((prev) => {
      const current = prev[nodeId] !== false;
      const next = force !== undefined ? force : !current;
      return { ...prev, [nodeId]: next };
    });
  };

  const roving = useRovingFocus({
    count: flat.length,
    orientation: 'vertical',
    controlledIndex: selectedId ? selectedIndex : undefined,
    onActivate: (idx) => {
      const target = flat[idx];
      if (target) onSelect?.(target.node.id);
    }
  });

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLUListElement>): void => {
    const current = flat[roving.activeIndex];
    if (current?.hasChildren) {
      if (event.key === 'ArrowRight' && !current.isExpanded) {
        event.preventDefault();
        toggleExpand(current.node.id, true);
        return;
      }
      if (event.key === 'ArrowLeft' && current.isExpanded) {
        event.preventDefault();
        toggleExpand(current.node.id, false);
        return;
      }
    }
    roving.handleKeyDown(event);
  };

  return (
    <ul
      className={className ? `ui-tree ${className}` : 'ui-tree'}
      role="tree"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      {flat.map((entry, idx) => {
        const isSelected = selectedId !== undefined ? entry.node.id === selectedId : idx === roving.activeIndex;
        return (
          <li key={entry.node.id} role="none">
            <button
              type="button"
              role="treeitem"
              className="ui-tree__row"
              aria-selected={isSelected}
              aria-expanded={entry.hasChildren ? entry.isExpanded : undefined}
              tabIndex={roving.getTabIndex(idx)}
              style={{ paddingLeft: `calc(${entry.depth} * var(--ui-space-4) + var(--ui-space-2))` }}
              onClick={() => {
                roving.setActiveIndex(idx);
                if (entry.hasChildren) toggleExpand(entry.node.id);
                onSelect?.(entry.node.id);
              }}
            >
              <span>{entry.hasChildren ? (entry.isExpanded ? '▾' : '▸') : '•'}</span>
              {entry.node.icon ? <span>{entry.node.icon}</span> : null}
              <span style={{ flex: 1 }}>{entry.node.label}</span>
              {entry.node.meta ? <span className="ui-field__hint">{entry.node.meta}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
