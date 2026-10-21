import { useRef } from 'react';
import { applyEase } from '../../core/animation/ease';
import type { Ease } from '../../core/model/types';

const SIZE = 140;
const PAD = 20;

interface Props {
  ease: Ease | undefined;
  onChange: (ease: Ease) => void;
}

/** イージング曲線をドラッグで編集する（ベジェ曲線の 2 つの制御点） */
export function EaseEditor({ ease, onChange }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const bezier: [number, number, number, number] =
    typeof ease === 'object' ? ease.bezier : [0.25, 0.1, 0.25, 1];
  const inner = SIZE - PAD * 2;
  const toX = (x: number) => PAD + x * inner;
  const toY = (y: number) => PAD + (1 - y) * inner;

  // 現在の曲線（プリセットの場合もその形を表示する）
  const points: string[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40;
    const y =
      typeof ease === 'object' || ease === undefined
        ? applyEase({ bezier }, x)
        : applyEase(ease, x);
    points.push(`${toX(x)},${toY(y)}`);
  }

  const drag = (index: 0 | 1) => (e: React.PointerEvent<SVGCircleElement>) => {
    const svg = ref.current;
    if (!svg) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = [...bezier] as [number, number, number, number];
    const move = (ev: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (ev.clientX - rect.left - PAD) / inner));
      const y = Math.min(1.5, Math.max(-0.5, 1 - (ev.clientY - rect.top - PAD) / inner));
      const next = [...start] as [number, number, number, number];
      next[index * 2] = Math.round(x * 100) / 100;
      next[index * 2 + 1] = Math.round(y * 100) / 100;
      onChange({ bezier: next });
    };
    const target = e.currentTarget;
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  const custom = typeof ease === 'object';
  return (
    <svg ref={ref} className="ease-editor" width={SIZE} height={SIZE} aria-label="イージング曲線">
      <rect x={PAD} y={PAD} width={inner} height={inner} className="ease-frame" />
      <polyline points={points.join(' ')} className="ease-curve" />
      {custom && (
        <>
          <line
            x1={toX(0)}
            y1={toY(0)}
            x2={toX(bezier[0])}
            y2={toY(bezier[1])}
            className="ease-arm"
          />
          <line
            x1={toX(1)}
            y1={toY(1)}
            x2={toX(bezier[2])}
            y2={toY(bezier[3])}
            className="ease-arm"
          />
          <circle
            cx={toX(bezier[0])}
            cy={toY(bezier[1])}
            r={6}
            className="ease-handle"
            onPointerDown={drag(0)}
          />
          <circle
            cx={toX(bezier[2])}
            cy={toY(bezier[3])}
            r={6}
            className="ease-handle"
            onPointerDown={drag(1)}
          />
        </>
      )}
    </svg>
  );
}
