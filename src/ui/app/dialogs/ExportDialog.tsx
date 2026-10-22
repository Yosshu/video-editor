import { useEffect, useRef, useState } from 'react';
import type { AudioCodec, QualityLevel, VideoCodec } from 'mediabunny';
import { baseName, chooseSaveTarget, deliver, type SaveTarget } from '../../../app/exportActions';
import { formatTimecode, fpsValue } from '../../../core/model/time';
import { sceneDuration } from '../../../core/timeline/ops';
import {
  AUDIO_CODECS,
  CONTAINERS,
  detectCodecSupport,
  evenSize,
  VIDEO_CODECS,
  type CodecSupport,
  type ContainerFormat,
} from '../../../engine/export/codecs';
import {
  ExportCanceledError,
  exportVideo,
  renderStill,
  type ExportProgress,
} from '../../../engine/export/exporter';
import { exportGif, exportPngSequence } from '../../../engine/export/sequences';
import { exportWav } from '../../../engine/export/wav';
import { playback } from '../../../engine/playback/Playback';
import { currentScene, getState, notify, useEditor } from '../../../state/store';
import { closeDialog } from '../../../state/ui';
import { Dialog } from '../../common/Dialog';
import { formatBytes } from '../../common/format';
import { t } from '../../../i18n';

const QUALITIES: { value: QualityLevel; label: string }[] = [
  { value: 'very-high', label: '最高' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '標準' },
  { value: 'low', label: '低（ファイルサイズ小）' },
];

const SCALES = [1, 0.75, 0.5, 0.25];

/** 書き出す形式（動画のほか、GIF と連番 PNG） */
type OutputFormat = ContainerFormat | 'gif' | 'png';

const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  ...CONTAINERS.map((c) => ({ value: c.value, label: c.label })),
  { value: 'gif', label: 'GIF（アニメーション）' },
  { value: 'png', label: '連番 PNG（ZIP）' },
];

/** GIF のコマの速さの候補（GIF は 1/100 秒単位なので 50 まで） */
const GIF_FPS = [10, 12, 15, 20, 25, 30, 50];

/** 保存先へ順に書き込む口と、書き終えたときの処理 */
function targetWriter(target: SaveTarget, mime: string) {
  const parts: Uint8Array[] = [];
  let position = 0;
  return {
    write:
      target.kind === 'file'
        ? async (data: Uint8Array) => {
            await target.writable.write({
              type: 'write',
              position,
              data: data as Uint8Array<ArrayBuffer>,
            });
            position += data.length;
          }
        : async (data: Uint8Array) => {
            parts.push(data);
          },
    abort: async () => {
      if (target.kind === 'file') await target.writable.abort().catch(() => undefined);
    },
    /** 完了の知らせの文を返す */
    finish: async (): Promise<string> => {
      if (target.kind === 'file') {
        await target.writable.close();
        return t('「{0}」に保存しました。', target.name);
      }
      const blob = new Blob(parts as BlobPart[], { type: mime });
      deliver(blob, target.name);
      return t('「{0}」（{1}）をダウンロードしました。', target.name, formatBytes(blob.size));
    },
  };
}

type Phase =
  | { kind: 'settings' }
  | { kind: 'running'; label: string; progress: ExportProgress | null }
  | { kind: 'done'; message: string };

function formatSeconds(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s >= 60 ? t('{0}分{1}秒', Math.floor(s / 60), s % 60) : t('{0}秒', s);
}

export function ExportDialog() {
  const settings = useEditor((s) => s.project.settings);
  // 書き出すのはメインのシーン
  const scene = useEditor(
    (s) => s.project.scenes.find((x) => x.id === s.project.rootSceneId) ?? currentScene(s),
  );
  const duration = sceneDuration(scene);
  const [support, setSupport] = useState<CodecSupport | null>(null);
  const [format, setFormat] = useState<OutputFormat>('mp4');
  const [transparent, setTransparent] = useState(false);
  const [gifFps, setGifFps] = useState(() => Math.min(15, Math.round(fpsValue(settings.fps))));
  const [videoCodec, setVideoCodec] = useState<VideoCodec | ''>('');
  const [audioCodec, setAudioCodec] = useState<AudioCodec | ''>('');
  const [withAudio, setWithAudio] = useState(true);
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState<QualityLevel>('high');
  const [rangeMode, setRangeMode] = useState<'all' | 'custom'>('all');
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(duration);
  const [phase, setPhase] = useState<Phase>({ kind: 'settings' });
  const abortRef = useRef<AbortController | null>(null);

  const width = evenSize(scene.width * scale);
  const height = evenSize(scene.height * scale);

  useEffect(() => {
    let alive = true;
    void detectCodecSupport(width, height, fpsValue(settings.fps), settings.sampleRate).then(
      (s) => {
        if (!alive) return;
        setSupport(s);
        // 使える形式を初期値にする
        const preferred: ContainerFormat = s.video.mp4.length > 0 ? 'mp4' : 'webm';
        setFormat((f) => (f === 'gif' || f === 'png' || s.video[f].length > 0 ? f : preferred));
      },
    );
    return () => {
      alive = false;
    };
  }, [width, height, settings.fps, settings.sampleRate]);

  const container = format === 'mp4' || format === 'webm' ? format : null;
  const videoOptions =
    support && container
      ? VIDEO_CODECS[container].filter((c) => support.video[container].includes(c.value))
      : [];
  const audioOptions =
    support && container
      ? AUDIO_CODECS[container].filter((c) => support.audio[container].includes(c.value))
      : [];
  const vCodec = videoOptions.some((c) => c.value === videoCodec)
    ? (videoCodec as VideoCodec)
    : videoOptions[0]?.value;
  const aCodec = audioOptions.some((c) => c.value === audioCodec)
    ? (audioCodec as AudioCodec)
    : audioOptions[0]?.value;
  const start = rangeMode === 'all' ? 0 : Math.max(0, Math.min(rangeStart, duration));
  const end = rangeMode === 'all' ? duration : Math.max(start, Math.min(rangeEnd, duration));
  const running = phase.kind === 'running';
  // 透明にできるのは GIF・連番 PNG と、WebM の VP8・VP9
  const canTransparent =
    format === 'gif' ||
    format === 'png' ||
    (format === 'webm' && (vCodec === 'vp9' || vCodec === 'vp8'));
  const useTransparent = canTransparent && transparent;

  const run = async (
    label: string,
    task: (signal: AbortSignal, onProgress: (p: ExportProgress) => void) => Promise<string>,
  ) => {
    playback.pause();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase({ kind: 'running', label, progress: null });
    let last = 0;
    try {
      const message = await task(controller.signal, (p) => {
        const now = performance.now();
        if (now - last > 100 || p.done === p.total) {
          last = now;
          setPhase({ kind: 'running', label, progress: p });
        }
      });
      setPhase({ kind: 'done', message });
    } catch (e) {
      if (e instanceof ExportCanceledError) {
        setPhase({ kind: 'settings' });
        notify(t('書き出しを中止しました。'));
      } else {
        console.error(e);
        setPhase({ kind: 'settings' });
        notify(
          t('書き出しに失敗しました：{0}', e instanceof Error ? e.message : String(e)),
          'error',
        );
      }
    } finally {
      abortRef.current = null;
    }
  };

  const startVideo = async () => {
    if (!vCodec || !container) return;
    const info = CONTAINERS.find((c) => c.value === container)!;
    const target = await chooseSaveTarget(
      `${baseName()}${info.extension}`,
      t('{0} 動画', info.label),
      info.mime,
      info.extension,
    );
    if (!target) return;
    const { project } = getState();
    await run(t('動画を書き出しています'), async (signal, onProgress) => {
      const blob = await exportVideo(
        project,
        scene,
        {
          format: container,
          videoCodec: vCodec,
          audioCodec: withAudio && aCodec ? aCodec : null,
          width,
          height,
          quality,
          startFrame: start,
          endFrame: end,
          transparent: useTransparent,
        },
        target.kind === 'file' ? { kind: 'file', writable: target.writable } : { kind: 'memory' },
        onProgress,
        signal,
      );
      if (blob) {
        deliver(blob, target.name);
        return t('「{0}」（{1}）をダウンロードしました。', target.name, formatBytes(blob.size));
      }
      return t('「{0}」に保存しました。', target.name);
    });
  };

  const startWav = async () => {
    const target = await chooseSaveTarget(`${baseName()}.wav`, t('WAV 音声'), 'audio/wav', '.wav');
    if (!target) return;
    const { project } = getState();
    await run(t('音声を書き出しています'), async (signal, onProgress) => {
      const out = targetWriter(target, 'audio/wav');
      try {
        await exportWav(project, scene, start, end, out.write, onProgress, signal);
      } catch (e) {
        await out.abort();
        throw e;
      }
      return out.finish();
    });
  };

  const startGif = async () => {
    const target = await chooseSaveTarget(`${baseName()}.gif`, t('GIF 画像'), 'image/gif', '.gif');
    if (!target) return;
    const { project } = getState();
    await run(t('GIF を書き出しています'), async (signal, onProgress) => {
      const out = targetWriter(target, 'image/gif');
      try {
        await exportGif(
          project,
          scene,
          {
            width,
            height,
            startFrame: start,
            endFrame: end,
            transparent: useTransparent,
            fps: gifFps,
          },
          out.write,
          onProgress,
          signal,
        );
      } catch (e) {
        await out.abort();
        throw e;
      }
      return out.finish();
    });
  };

  const startPng = async () => {
    const base = baseName();
    const target = await chooseSaveTarget(
      `${base}_png.zip`,
      t('連番 PNG（ZIP）'),
      'application/zip',
      '.zip',
    );
    if (!target) return;
    const { project } = getState();
    await run(t('連番 PNG を書き出しています'), async (signal, onProgress) => {
      const out = targetWriter(target, 'application/zip');
      try {
        await exportPngSequence(
          project,
          scene,
          {
            width,
            height,
            startFrame: start,
            endFrame: end,
            transparent: useTransparent,
            baseName: base,
          },
          out,
          onProgress,
          signal,
        );
      } catch (e) {
        await out.abort();
        throw e;
      }
      return out.finish();
    });
  };

  const startExport = () =>
    void (format === 'gif' ? startGif() : format === 'png' ? startPng() : startVideo());

  const saveStill = async () => {
    const state = getState();
    const frame = state.playhead;
    const target = await chooseSaveTarget(
      `${baseName()}_${frame}.png`,
      t('PNG 画像'),
      'image/png',
      '.png',
    );
    if (!target) return;
    await run(t('静止画を保存しています'), async () => {
      const blob = await renderStill(state.project, scene, frame);
      if (target.kind === 'file') {
        await target.writable.write(blob);
        await target.writable.close();
        return t('「{0}」に保存しました。', target.name);
      }
      deliver(blob, target.name);
      return t('「{0}」をダウンロードしました。', target.name);
    });
  };

  const close = () => {
    if (running) {
      if (!window.confirm(t('書き出しを中止しますか？'))) return;
      abortRef.current?.abort();
      return;
    }
    closeDialog();
  };

  const progress = phase.kind === 'running' ? phase.progress : null;
  const ratio = progress ? progress.done / Math.max(1, progress.total) : 0;
  const remaining = progress && ratio > 0 ? (progress.elapsedMs / ratio) * (1 - ratio) : null;

  return (
    <Dialog
      title={t('書き出し')}
      onClose={close}
      modal={running}
      width={540}
      footer={
        phase.kind === 'settings' ? (
          <>
            <button
              type="button"
              onClick={() => void saveStill()}
              title={t('再生位置のフレームを PNG で保存')}
            >
              {t('静止画（PNG）')}
            </button>
            <button type="button" onClick={() => void startWav()} disabled={duration === 0}>
              {t('音声のみ（WAV）')}
            </button>
            <span className="spacer" />
            <button type="button" onClick={close}>
              {t('閉じる')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={(container !== null && !vCodec) || end <= start}
              onClick={startExport}
            >
              {t('書き出し開始')}
            </button>
          </>
        ) : phase.kind === 'running' ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            {t('中止')}
          </button>
        ) : (
          <button type="button" className="primary" onClick={closeDialog}>
            {t('閉じる')}
          </button>
        )
      }
    >
      {phase.kind === 'settings' && (
        <div className="form-grid">
          <label htmlFor="ex-format">{t('形式')}</label>
          <select
            id="ex-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as OutputFormat)}
          >
            {OUTPUT_FORMATS.map((c) => (
              <option
                key={c.value}
                value={c.value}
                disabled={
                  !!support &&
                  (c.value === 'mp4' || c.value === 'webm') &&
                  support.video[c.value].length === 0
                }
              >
                {t(c.label)}
              </option>
            ))}
          </select>
          {container && (
            <>
              <label htmlFor="ex-vcodec">{t('映像')}</label>
              <select
                id="ex-vcodec"
                value={vCodec ?? ''}
                onChange={(e) => setVideoCodec(e.target.value as VideoCodec)}
                disabled={!support}
              >
                {!support && <option>{t('確認中…')}</option>}
                {support && videoOptions.length === 0 && (
                  <option value="">{t('この環境では使えません')}</option>
                )}
                {videoOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
              <label htmlFor="ex-acodec">{t('音声')}</label>
              <div className="inline">
                <input
                  type="checkbox"
                  aria-label={t('音声を含める')}
                  checked={withAudio}
                  onChange={(e) => setWithAudio(e.target.checked)}
                />
                <select
                  id="ex-acodec"
                  value={aCodec ?? ''}
                  onChange={(e) => setAudioCodec(e.target.value as AudioCodec)}
                  disabled={!withAudio || !support}
                >
                  {support && audioOptions.length === 0 && (
                    <option value="">{t('この環境では使えません')}</option>
                  )}
                  {audioOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {t(c.label)}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          {format === 'gif' && (
            <>
              <label htmlFor="ex-gif-fps">{t('コマの速さ')}</label>
              <select
                id="ex-gif-fps"
                value={gifFps}
                onChange={(e) => setGifFps(Number(e.target.value))}
              >
                {GIF_FPS.map((f) => (
                  <option key={f} value={f}>
                    {f} fps
                  </option>
                ))}
              </select>
            </>
          )}
          <label htmlFor="ex-transparent">{t('背景')}</label>
          <label
            className="inline"
            title={
              canTransparent
                ? undefined
                : t('透明にできるのは WebM（VP8・VP9）・GIF・連番 PNG です')
            }
          >
            <input
              id="ex-transparent"
              type="checkbox"
              checked={useTransparent}
              disabled={!canTransparent}
              onChange={(e) => setTransparent(e.target.checked)}
            />
            {t('透明にする')}
          </label>
          <label htmlFor="ex-size">{t('解像度')}</label>
          <select id="ex-size" value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {evenSize(scene.width * s)} × {evenSize(scene.height * s)}
                {s === 1 ? t('（そのまま）') : `（${s * 100}%）`}
              </option>
            ))}
          </select>
          {container && (
            <>
              <label htmlFor="ex-quality">{t('画質')}</label>
              <select
                id="ex-quality"
                value={quality}
                onChange={(e) => setQuality(e.target.value as QualityLevel)}
              >
                {QUALITIES.map((q) => (
                  <option key={q.value} value={q.value}>
                    {t(q.label)}
                  </option>
                ))}
              </select>
            </>
          )}
          <span>{t('範囲')}</span>
          <div className="range-options">
            <label>
              <input
                type="radio"
                name="ex-range"
                checked={rangeMode === 'all'}
                onChange={() => setRangeMode('all')}
              />
              {t('全体（{0}）', formatTimecode(duration, settings.fps))}
            </label>
            <label>
              <input
                type="radio"
                name="ex-range"
                checked={rangeMode === 'custom'}
                onChange={() => setRangeMode('custom')}
              />
              {t('指定')}
            </label>
            {rangeMode === 'custom' && (
              <div className="inline">
                <input
                  type="number"
                  aria-label={t('開始フレーム')}
                  min={0}
                  max={duration}
                  value={rangeStart}
                  onChange={(e) => setRangeStart(Number(e.target.value))}
                />
                <span>〜</span>
                <input
                  type="number"
                  aria-label={t('終了フレーム')}
                  min={0}
                  max={duration}
                  value={rangeEnd}
                  onChange={(e) => setRangeEnd(Number(e.target.value))}
                />
                <span className="dim">{t('フレーム')}</span>
              </div>
            )}
          </div>
          {duration === 0 && (
            <p className="hint form-wide">{t('タイムラインにオブジェクトがありません。')}</p>
          )}
          {!window.showSaveFilePicker && (
            <p className="hint form-wide">
              {t(
                'このブラウザではファイルを直接保存できないため、書き出し後にダウンロードします（長い動画はメモリを多く使います）。',
              )}
            </p>
          )}
        </div>
      )}
      {phase.kind === 'running' && (
        <div className="export-progress">
          <p>{phase.label}…</p>
          <progress value={ratio} max={1} aria-label={t('進捗')} />
          <p className="dim">
            {Math.floor(ratio * 100)}%{progress ? `（${progress.done} / ${progress.total}）` : ''}
            {remaining !== null ? t(' ・ 残り約 {0}', formatSeconds(remaining)) : ''}
          </p>
        </div>
      )}
      {phase.kind === 'done' && <p data-testid="export-done">{phase.message}</p>}
    </Dialog>
  );
}
