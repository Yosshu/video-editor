import { useSyncExternalStore } from 'react';
import { onPeaksChange, peekPeaks, type Peaks } from '../../engine/audio/waveform';
import { onThumbnailChange, peekThumbnail } from '../../engine/media/thumbnails';
import { useEditor } from '../../state/store';

/** 素材のサムネイル URL（作成中・なしは null） */
export function useThumbnail(assetId: string | undefined): string | null {
  const ready = useEditor((s) => (assetId ? s.assetStatus[assetId] === 'ready' : false));
  const url = useSyncExternalStore(onThumbnailChange, () =>
    assetId && ready ? peekThumbnail(assetId) : undefined,
  );
  return url ?? null;
}

/** 素材の波形データ（計算中・なしは null） */
export function usePeaks(assetId: string | undefined, enabled: boolean): Peaks | null {
  const ready = useEditor((s) => (assetId ? s.assetStatus[assetId] === 'ready' : false));
  const peaks = useSyncExternalStore(onPeaksChange, () =>
    assetId && ready && enabled ? peekPeaks(assetId) : undefined,
  );
  return peaks ?? null;
}
