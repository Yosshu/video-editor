import {
  ALL_FORMATS,
  BlobSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { Asset } from '../../core/model/types';
import { t } from '../../i18n';

export class MediaOpenError extends Error {}

/** 動画・音声ファイルの読み込み口 */
export interface MediaSourceHandle {
  input: Input;
  videoTrack: InputVideoTrack | null;
  audioTrack: InputAudioTrack | null;
  /** 音声のサンプリングレートとチャンネル数（音声がなければ 0） */
  audioSampleRate: number;
  audioChannels: number;
  duration: number;
  rotation: 0 | 90 | 180 | 270;
  displayWidth: number;
  displayHeight: number;
  dispose(): void;
}

export async function openMediaSource(file: Blob): Promise<MediaSourceHandle> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new MediaOpenError(t('対応していない形式のファイルです。'));
    let videoTrack = await input.getPrimaryVideoTrack();
    let audioTrack = await input.getPrimaryAudioTrack();
    if (videoTrack && !(await videoTrack.canDecode())) {
      const codec = (await videoTrack.getCodec()) ?? t('不明');
      throw new MediaOpenError(
        t(
          'この動画のコーデック（{0}）はこのブラウザでは読み込めません。H.264 / VP9 / AV1 などに変換してからお試しください。',
          codec,
        ),
      );
    }
    if (audioTrack && !(await audioTrack.canDecode())) audioTrack = null;
    if (!videoTrack && !audioTrack)
      throw new MediaOpenError(t('映像・音声が見つかりませんでした。'));
    const tracks = [videoTrack, audioTrack].filter(
      (t): t is InputVideoTrack | InputAudioTrack => !!t,
    );
    const duration = await input.computeDuration(tracks);
    const rotation = videoTrack ? await videoTrack.getRotation() : 0;
    const displayWidth = videoTrack ? await videoTrack.getDisplayWidth() : 0;
    const displayHeight = videoTrack ? await videoTrack.getDisplayHeight() : 0;
    if (videoTrack && (displayWidth <= 0 || displayHeight <= 0)) videoTrack = null;
    const audioSampleRate = audioTrack ? await audioTrack.getSampleRate() : 0;
    const audioChannels = audioTrack ? await audioTrack.getNumberOfChannels() : 0;
    return {
      input,
      videoTrack,
      audioTrack,
      audioSampleRate,
      audioChannels,
      duration,
      rotation,
      displayWidth,
      displayHeight,
      dispose: () => input.dispose(),
    };
  } catch (e) {
    input.dispose();
    if (e instanceof MediaOpenError) throw e;
    throw new MediaOpenError(
      t('ファイルを読み込めませんでした。壊れているか、対応していない形式の可能性があります。'),
    );
  }
}

/** 素材情報（Asset）に保存するメタデータ */
export async function describeMedia(
  handle: MediaSourceHandle,
): Promise<Pick<Asset, 'kind' | 'durationSec' | 'width' | 'height' | 'video' | 'audio'>> {
  const { videoTrack, audioTrack } = handle;
  const info: Pick<Asset, 'kind' | 'durationSec' | 'width' | 'height' | 'video' | 'audio'> = {
    kind: videoTrack ? 'video' : 'audio',
    durationSec: handle.duration,
  };
  if (videoTrack) {
    info.width = handle.displayWidth;
    info.height = handle.displayHeight;
    let frameRate: number | undefined;
    try {
      frameRate = (await videoTrack.computePacketStats(60)).averagePacketRate;
    } catch {
      frameRate = undefined;
    }
    info.video = {
      codec:
        (await videoTrack.getCodecParameterString()) ?? (await videoTrack.getCodec()) ?? undefined,
      ...(frameRate && Number.isFinite(frameRate)
        ? { frameRate: Math.round(frameRate * 1000) / 1000 }
        : {}),
    };
  }
  if (audioTrack) {
    info.audio = {
      sampleRate: await audioTrack.getSampleRate(),
      channels: await audioTrack.getNumberOfChannels(),
      codec:
        (await audioTrack.getCodecParameterString()) ?? (await audioTrack.getCodec()) ?? undefined,
    };
  }
  return info;
}
