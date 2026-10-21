import { createRenderTarget, deleteRenderTarget, type RenderTarget } from './gl';

/** 描画先（テクスチャ＋フレームバッファ）を大きさごとに使い回す */
export class RenderTargetPool {
  private free = new Map<string, RenderTarget[]>();
  private inUse = new Set<RenderTarget>();

  constructor(private gl: WebGL2RenderingContext) {}

  acquire(width: number, height: number): RenderTarget {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const key = `${w}x${h}`;
    const list = this.free.get(key);
    const target = list?.pop() ?? createRenderTarget(this.gl, w, h);
    this.inUse.add(target);
    return target;
  }

  release(target: RenderTarget): void {
    if (!this.inUse.delete(target)) return;
    const key = `${target.width}x${target.height}`;
    const list = this.free.get(key) ?? [];
    list.push(target);
    this.free.set(key, list);
  }

  /** フレームの終わりに、使われずに残っている描画先を減らす */
  trim(maxPerSize = 2): void {
    for (const [key, list] of this.free) {
      while (list.length > maxPerSize) deleteRenderTarget(this.gl, list.pop()!);
      if (list.length === 0) this.free.delete(key);
    }
  }

  dispose(): void {
    for (const list of this.free.values()) for (const t of list) deleteRenderTarget(this.gl, t);
    for (const t of this.inUse) deleteRenderTarget(this.gl, t);
    this.free.clear();
    this.inUse.clear();
  }
}
