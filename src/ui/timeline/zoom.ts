import { getState, useEditor } from '../../state/store';
import { MAX_PX_PER_FRAME, MIN_PX_PER_FRAME } from './geometry';

/** タイムラインの拡大率を factor 倍にする */
export function zoomTimeline(factor: number): void {
  const next = getState().pxPerFrame * factor;
  useEditor.setState({ pxPerFrame: Math.min(MAX_PX_PER_FRAME, Math.max(MIN_PX_PER_FRAME, next)) });
}
