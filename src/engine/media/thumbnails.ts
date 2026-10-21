import { VideoSampleSink } from 'mediabunny';
import { assetRegistry } from './registry';

const HEIGHT = 48;
const cache = new Map<string, Promise<string | null>>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function onThumbnailChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function render(
  draw: (ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) => void,
  srcW: number,
  srcH: number,
  type: 'image/png' | 'image/jpeg',
): Promise<string> {
  const h = HEIGHT;
  const w = Math.max(1, Math.round((srcW / srcH) * h));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  draw(ctx, w, h);
  const blob = await canvas.convertToBlob({ type, quality: 0.8 });
  return URL.createObjectURL(blob);
}

async function create(assetId: string): Promise<string | null> {
  const image = assetRegistry.getImage(assetId);
  if (image) {
    return render(
      (ctx, w, h) => ctx.drawImage(image, 0, 0, w, h),
      image.width,
      image.height,
      'image/png',
    );
  }
  const media = assetRegistry.getMedia(assetId);
  if (!media?.videoTrack) return null;
  const sink = new VideoSampleSink(media.videoTrack);
  const sample = await sink.getSample(Math.min(1, media.duration * 0.1));
  if (!sample) return null;
  try {
    return await render(
      (ctx, w, h) => sample.draw(ctx, 0, 0, w, h),
      media.displayWidth,
      media.displayHeight,
      'image/jpeg',
    );
  } finally {
    sample.close();
  }
}

/** 素材のサムネイル（object URL）。まだなければ作り始めて null を返す */
export function peekThumbnail(assetId: string): string | null | undefined {
  const entry = cache.get(assetId) as
    (Promise<string | null> & { value?: string | null }) | undefined;
  if (!entry) {
    if (!assetRegistry.has(assetId)) return undefined;
    const p = create(assetId).catch(() => null) as Promise<string | null> & {
      value?: string | null;
    };
    cache.set(assetId, p);
    void p.then((v) => {
      p.value = v;
      notify();
    });
    return undefined;
  }
  return entry.value;
}

/** 素材が差し替えられたときにサムネイルを作り直す */
assetRegistry.onChange((assetId) => {
  const entry = cache.get(assetId) as
    (Promise<string | null> & { value?: string | null }) | undefined;
  if (!entry) return;
  cache.delete(assetId);
  if (entry.value) URL.revokeObjectURL(entry.value);
  notify();
});
