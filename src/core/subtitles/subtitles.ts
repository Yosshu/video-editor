/**
 * 字幕ファイル（SRT・WebVTT）の読み込み。
 * 時刻と文字だけを取り出す（位置や色の指定は使わない）
 */

export interface SubtitleCue {
  /** 表示を始める時刻（秒） */
  start: number;
  /** 表示を終える時刻（秒） */
  end: number;
  text: string;
}

/** 00:01:02,345 / 01:02.345 / 1:02:03.4 などを秒にする */
function parseTimestamp(src: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[,.](\d{1,3}))?$/.exec(src.trim());
  if (!m) return null;
  const [, h = '0', min, s, frac = '0'] = m;
  return Number(h) * 3600 + Number(min) * 60 + Number(s) + Number(frac.padEnd(3, '0')) / 1000;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

/** 書式のタグ（<i>、<c.red>、{\an8} など）を取り除き、文字参照を戻す */
function cleanText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (all, name: string) => {
      if (name[0] === '#') {
        const code =
          name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENTITIES[name.toLowerCase()] ?? all;
    })
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** SRT・WebVTT の文字列から字幕を取り出す（時刻の順） */
export function parseSubtitles(src: string): SubtitleCue[] {
  const text = src.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: SubtitleCue[] = [];
  for (const block of text.split(/\n[ \t]*\n/)) {
    const lines = block.split('\n');
    const timing = lines.findIndex((line) => line.includes('-->'));
    // 時刻のない部分（WEBVTT の見出し、NOTE・STYLE など）は飛ばす
    if (timing < 0) continue;
    const [from, rest] = lines[timing].split('-->');
    const start = parseTimestamp(from);
    // WebVTT は時刻の後ろに位置などの指定が続くことがある
    const end = parseTimestamp(rest.trim().split(/\s+/)[0] ?? '');
    if (start === null || end === null || end <= start) continue;
    const body = cleanText(lines.slice(timing + 1).join('\n'));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export const SUBTITLE_ACCEPT = '.srt,.vtt';

export function isSubtitleFileName(name: string): boolean {
  return /\.(srt|vtt)$/i.test(name);
}
