interface SplitterProps {
  direction: 'vertical' | 'horizontal';
  /** ドラッグ量（px）を受け取る。vertical は横方向、horizontal は縦方向の移動量 */
  onDrag: (delta: number) => void;
  label: string;
  /** グリッド上の配置 */
  area: string;
}

/** パネルの境目。ドラッグして大きさを変える */
export function Splitter({ direction, onDrag, label, area }: SplitterProps) {
  return (
    <div
      className={`splitter splitter-${direction}`}
      role="separator"
      aria-orientation={direction}
      aria-label={label}
      style={{ gridArea: area }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        let last = direction === 'vertical' ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const pos = direction === 'vertical' ? ev.clientX : ev.clientY;
          onDrag(pos - last);
          last = pos;
        };
        const up = () => {
          el.removeEventListener('pointermove', move);
          el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      }}
    />
  );
}
