import { canEncodeAudio, canEncodeVideo, type AudioCodec, type VideoCodec } from 'mediabunny';

export type ContainerFormat = 'mp4' | 'webm';

export const CONTAINERS: {
  value: ContainerFormat;
  label: string;
  extension: string;
  mime: string;
}[] = [
  { value: 'mp4', label: 'MP4', extension: '.mp4', mime: 'video/mp4' },
  { value: 'webm', label: 'WebM', extension: '.webm', mime: 'video/webm' },
];

export const VIDEO_CODECS: Record<ContainerFormat, { value: VideoCodec; label: string }[]> = {
  mp4: [
    { value: 'avc', label: 'H.264（互換性重視）' },
    { value: 'hevc', label: 'H.265 / HEVC' },
    { value: 'av1', label: 'AV1（高圧縮）' },
    { value: 'vp9', label: 'VP9' },
  ],
  webm: [
    { value: 'vp9', label: 'VP9' },
    { value: 'av1', label: 'AV1（高圧縮）' },
    { value: 'vp8', label: 'VP8' },
  ],
};

export const AUDIO_CODECS: Record<ContainerFormat, { value: AudioCodec; label: string }[]> = {
  mp4: [
    { value: 'aac', label: 'AAC' },
    { value: 'opus', label: 'Opus' },
  ],
  webm: [{ value: 'opus', label: 'Opus' }],
};

export interface CodecSupport {
  video: Record<ContainerFormat, VideoCodec[]>;
  audio: Record<ContainerFormat, AudioCodec[]>;
}

/** 指定した解像度・フレームレートで使えるコーデックを調べる */
export async function detectCodecSupport(
  width: number,
  height: number,
  frameRate: number,
  sampleRate: number,
): Promise<CodecSupport> {
  const videoOk = new Map<VideoCodec, boolean>();
  const audioOk = new Map<AudioCodec, boolean>();
  const allVideo = [...new Set(Object.values(VIDEO_CODECS).flatMap((l) => l.map((c) => c.value)))];
  const allAudio = [...new Set(Object.values(AUDIO_CODECS).flatMap((l) => l.map((c) => c.value)))];
  await Promise.all([
    ...allVideo.map(async (c) =>
      videoOk.set(c, await canEncodeVideo(c, { width, height, frameRate }).catch(() => false)),
    ),
    ...allAudio.map(async (c) =>
      audioOk.set(
        c,
        await canEncodeAudio(c, { numberOfChannels: 2, sampleRate }).catch(() => false),
      ),
    ),
  ]);
  const pick = <T>(list: { value: T }[], ok: Map<T, boolean>) =>
    list.filter((c) => ok.get(c.value)).map((c) => c.value);
  return {
    video: { mp4: pick(VIDEO_CODECS.mp4, videoOk), webm: pick(VIDEO_CODECS.webm, videoOk) },
    audio: { mp4: pick(AUDIO_CODECS.mp4, audioOk), webm: pick(AUDIO_CODECS.webm, audioOk) },
  };
}

/** H.264 などは幅・高さが偶数である必要がある */
export function evenSize(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}
