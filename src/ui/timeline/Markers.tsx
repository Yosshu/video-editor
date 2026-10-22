import { moveMarker, removeMarker, updateMarker } from '../../app/markerActions';
import { formatTimecode } from '../../core/model/time';
import type { BeatGrid, Marker, Rational } from '../../core/model/types';
import { beatsInRange, framesPerBeat, MARKER_COLORS } from '../../core/timeline/markers';
import { playback } from '../../engine/playback/Playback';
import { setPlayhead } from '../../state/store';
import { openContextMenu } from '../../state/ui';
import { t } from '../../i18n';

const DEFAULT_COLOR = MARKER_COLORS[0].value;

function renameMarker(m: Marker): void {
  const label = window.prompt(t('マーカーの名前'), m.label ?? '');
  if (label !== null) updateMarker(m.id, { label: label.trim() });
}

/** 時間目盛りの上のマーカー（クリックで移動、ドラッグで位置を変更） */
export function RulerMarkers({
  markers,
  ppf,
  fps,
}: {
  markers: Marker[];
  ppf: number;
  fps: Rational;
}) {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, m: Marker) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    let to = m.frame;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (!dragged && Math.abs(ev.clientX - x0) < 3) return;
      dragged = true;
      to = Math.max(0, m.frame + Math.round((ev.clientX - x0) / ppf));
      el.style.left = `${to * ppf}px`;
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (ev.type === 'pointercancel') {
        el.style.left = `${m.frame * ppf}px`;
        return;
      }
      if (dragged) moveMarker(m.id, to);
      playback.pause();
      setPlayhead(dragged ? to : m.frame);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <>
      {markers.map((m) => (
        <div
          key={m.id}
          className="tl-marker"
          style={{ left: m.frame * ppf, color: m.color ?? DEFAULT_COLOR }}
          title={
            m.label
              ? t(
                  '{0}（{1}）：ドラッグで移動、ダブルクリックで名前を変更',
                  m.label,
                  formatTimecode(m.frame, fps),
                )
              : t('{0}：ドラッグで移動、ダブルクリックで名前を変更', formatTimecode(m.frame, fps))
          }
          data-testid="marker"
          onPointerDown={(e) => onPointerDown(e, m)}
          onDoubleClick={(e) => {
            e.stopPropagation();
            renameMarker(m);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openContextMenu(e.clientX, e.clientY, [
              { label: t('名前を変更…'), action: () => renameMarker(m) },
              ...MARKER_COLORS.map((c) => ({
                label: t(
                  '色：{0}{1}',
                  t(c.label),
                  (m.color ?? DEFAULT_COLOR) === c.value ? t('（現在）') : '',
                ),
                action: () => updateMarker(m.id, { color: c.value }),
              })),
              'separator' as const,
              { label: t('マーカーを削除'), action: () => removeMarker(m.id) },
            ]);
          }}
        >
          <span className="tl-marker-flag" />
          {m.label && <span className="tl-marker-label">{m.label}</span>}
        </div>
      ))}
    </>
  );
}

/** トラック全体に引くマーカーの線 */
export function MarkerLines({
  markers,
  ppf,
  height,
}: {
  markers: Marker[];
  ppf: number;
  height: number;
}) {
  return (
    <>
      {markers.map((m) => (
        <div
          key={m.id}
          className="tl-marker-line"
          style={{ left: m.frame * ppf, height, borderColor: m.color ?? DEFAULT_COLOR }}
        />
      ))}
    </>
  );
}

/** BPM グリッドの線（見えている範囲だけ描く） */
export function BeatGridLines({
  grid,
  fps,
  ppf,
  from,
  to,
  height,
}: {
  grid: BeatGrid;
  fps: Rational;
  ppf: number;
  from: number;
  to: number;
  height: number;
}) {
  // 拍の間隔が狭すぎるときは小節の頭だけ描く
  const beatPx = framesPerBeat(grid, fps) * ppf;
  const beats = beatsInRange(grid, fps, Math.max(0, from), to).filter((b) => b.bar || beatPx >= 6);
  return (
    <>
      {beats.map((b) => (
        <div
          key={b.index}
          className={`tl-beat ${b.bar ? 'bar' : ''}`}
          style={{ left: b.frame * ppf, height }}
        />
      ))}
    </>
  );
}
