import { describe, expect, it } from 'vitest';
import { isSubtitleFileName, parseSubtitles } from './subtitles';

describe('字幕ファイル', () => {
  it('SRT を読む（番号・改行・書式のタグ）', () => {
    const srt = [
      '\uFEFF1',
      '00:00:01,000 --> 00:00:02,500',
      'こんにちは',
      '',
      '2',
      '00:00:03,000 --> 00:00:04,250',
      '<i>2 行目</i>の',
      '{\\an8}字幕 &amp; テスト',
      '',
      '',
    ].join('\r\n');
    expect(parseSubtitles(srt)).toEqual([
      { start: 1, end: 2.5, text: 'こんにちは' },
      { start: 3, end: 4.25, text: '2 行目の\n字幕 & テスト' },
    ]);
  });

  it('WebVTT を読む（見出し・NOTE・位置の指定・時の省略）', () => {
    const vtt = `WEBVTT - 説明

NOTE これはメモ

STYLE
::cue { color: red }

intro
00:01.500 --> 00:03.000 position:10% align:start
<v 話し手>はじめまして</v>

01:00:00.000 --> 01:00:01.000
<c.yellow>終わり</c>
`;
    expect(parseSubtitles(vtt)).toEqual([
      { start: 1.5, end: 3, text: 'はじめまして' },
      { start: 3600, end: 3601, text: '終わり' },
    ]);
  });

  it('壊れた字幕や空の字幕は飛ばし、時刻の順に並べる', () => {
    const srt = `1
00:00:05,000 --> 00:00:06,000
後

2
00:00:02,000 --> 00:00:01,000
逆順

3
abc --> def
壊れた時刻

4
00:00:01,000 --> 00:00:02,000
先

5
00:00:07,000 --> 00:00:08,000
<b></b>
`;
    expect(parseSubtitles(srt).map((c) => c.text)).toEqual(['先', '後']);
  });

  it('拡張子で字幕ファイルを見分ける', () => {
    expect(isSubtitleFileName('a.SRT')).toBe(true);
    expect(isSubtitleFileName('b.vtt')).toBe(true);
    expect(isSubtitleFileName('c.txt')).toBe(false);
  });
});
