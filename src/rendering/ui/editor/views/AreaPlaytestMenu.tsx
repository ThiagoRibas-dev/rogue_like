import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Button } from '../../primitives/Button.tsx';

const MENU_ESTIMATED_WIDTH = 224;
const MENU_ESTIMATED_HEIGHT = 96;
const MENU_VIEWPORT_MARGIN = 8;

/** Props for `<AreaPlaytestMenu />`. */
export interface AreaPlaytestMenuProps {
  readonly areaId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly walkable: boolean;
  readonly onSelectPlaytest: (areaId: string, x: number, y: number, z: number) => void;
  readonly onClose: () => void;
}

/**
 * Floating right-click context menu for static map cells offering "Playtest from Here" at `(x, y, z)`.
 */
export function AreaPlaytestMenu({
  areaId,
  x,
  y,
  z,
  clientX,
  clientY,
  walkable,
  onSelectPlaytest,
  onClose
}: AreaPlaytestMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const win = window;
    const handleOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    win.addEventListener('mousedown', handleOutside);
    win.addEventListener('keydown', handleKey);
    return (): void => {
      win.removeEventListener('mousedown', handleOutside);
      win.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const maxLeft =
    typeof window !== 'undefined' ? Math.max(MENU_VIEWPORT_MARGIN, window.innerWidth - MENU_ESTIMATED_WIDTH) : clientX;
  const maxTop =
    typeof window !== 'undefined'
      ? Math.max(MENU_VIEWPORT_MARGIN, window.innerHeight - MENU_ESTIMATED_HEIGHT)
      : clientY;
  const clampedLeft = Math.max(MENU_VIEWPORT_MARGIN, Math.min(clientX, maxLeft));
  const clampedTop = Math.max(MENU_VIEWPORT_MARGIN, Math.min(clientY, maxTop));

  return (
    <div
      ref={menuRef}
      role="menu"
      className="ui-editor-playtest-menu"
      style={{ left: `${clampedLeft}px`, top: `${clampedTop}px` }}
    >
      <div className="ui-editor-playtest-menu__header">
        Tile ({x}, {y}, Z={z})
      </div>
      {!walkable ? (
        <div className="ui-editor-playtest-menu__blocked">Blocked: non-walkable tile.</div>
      ) : (
        <Button size="sm" variant="primary" onClick={() => onSelectPlaytest(areaId, x, y, z)}>
          ▶ Playtest from Here
        </Button>
      )}
    </div>
  );
}
