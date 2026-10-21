import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeContextMenu, useUi } from '../../state/ui';

export function ContextMenu() {
  const menu = useUi((s) => s.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) return;
    // 画面からはみ出さない位置に調整する
    const rect = ref.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 4);
    const y = Math.min(menu.y, window.innerHeight - rect.height - 4);
    setPos({ x: Math.max(4, x), y: Math.max(4, y) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeContextMenu();
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', closeContextMenu);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', closeContextMenu);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      style={{
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((item, i) =>
        item === 'separator' ? (
          <div key={i} className="context-separator" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            className="context-item"
            disabled={item.disabled}
            onClick={() => {
              closeContextMenu();
              item.action();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>
  );
}
