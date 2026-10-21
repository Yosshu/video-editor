// E2E テスト用の小さな素材ファイルをブラウザ内で生成する。
// 使い方: node scripts/generate-fixtures.mjs
// （WebCodecs は安全なコンテキストでしか使えないため localhost のURLを横取りして使う）
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const bundle = await readFile(
  `${root}node_modules/mediabunny/dist/bundles/mediabunny.min.mjs`,
  'utf-8',
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('http://localhost:9999/**', (route) => {
  const url = route.request().url();
  if (url.endsWith('/mediabunny.mjs')) {
    return route.fulfill({ body: bundle, contentType: 'text/javascript' });
  }
  return route.fulfill({
    body: '<!doctype html><title>fixtures</title>',
    contentType: 'text/html',
  });
});
await page.goto('http://localhost:9999/');

const files = await page.evaluate(async () => {
  const mb = await import('http://localhost:9999/mediabunny.mjs');
  const toBase64 = (buf) => {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  };

  // 2 秒・30fps・320x180。前半 1 秒は赤、後半 1 秒は青。白い帯が左から右へ動く。
  async function makeVideo(format, videoCodec, audioCodec, rotation = 0) {
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d');
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format, target });
    const video = new mb.CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: 1_000_000,
      keyFrameInterval: 0.5,
    });
    output.addVideoTrack(video, { frameRate: 30, rotation });
    const audio = new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128_000 });
    output.addAudioTrack(audio);
    await output.start();
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i < 30 ? '#ff0000' : '#0000ff';
      ctx.fillRect(0, 0, 320, 180);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect((i / 60) * 300, 150, 20, 30);
      await video.add(i / 30, 1 / 30);
    }
    const sr = 48000;
    const ac = new OfflineAudioContext(2, sr * 2, sr);
    const buf = ac.createBuffer(2, sr * 2, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    }
    await audio.add(buf);
    await output.finalize();
    return toBase64(target.buffer);
  }

  const result = {};
  result['sample-vp9-opus.webm'] = await makeVideo(new mb.WebMOutputFormat(), 'vp9', 'opus');
  // 回転メタデータ（時計回り 90 度）付きの MP4。表示上は 180x320 の縦長になる
  result['sample-rotated90.mp4'] = await makeVideo(new mb.Mp4OutputFormat(), 'vp9', 'opus', 90);

  // 64x64 の PNG（左半分が緑、右半分が透明）
  const c = new OffscreenCanvas(64, 64);
  const cx = c.getContext('2d');
  cx.fillStyle = '#00ff00';
  cx.fillRect(0, 0, 32, 64);
  result['image-green-half.png'] = toBase64(
    await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
  return result;
});

for (const [name, b64] of Object.entries(files)) {
  await writeFile(`${root}tests/fixtures/${name}`, Buffer.from(b64, 'base64'));
  console.log('wrote', name);
}

// 1 秒・44.1kHz・モノラルの 1kHz サイン波（WAV）
{
  const sr = 44100;
  const n = sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(Math.round(0.5 * 32767 * Math.sin((2 * Math.PI * 1000 * i) / sr)), 44 + i * 2);
  await writeFile(`${root}tests/fixtures/tone-1khz.wav`, buf);
  console.log('wrote tone-1khz.wav');
}

await browser.close();
