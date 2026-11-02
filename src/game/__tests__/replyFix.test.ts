// The whole-reply fixes (server/replyFix.ts): an English phrase left outside <en> in a Chinese 小提醒 is wrapped, an English
// 小提醒 (when Chinese was asked for) is kept and marked for the rewrite, and a cut reply is read as far as it goes. Nothing here
// calls Claude.
import { describe, expect, it, vi } from 'vitest';
import { fixReplyJson, isChineseTip, needsTipRewrite, wrapEnglish } from '../../../server/replyFix.ts';
import { canonicalReplyJson } from '../replyJson';

/** a reply in the canonical JSON form, as the server stores it */
const reply = (segments: { lang: 'en' | 'zh'; text: string; gloss: string }[], tip: string, tone?: 'happy') =>
  canonicalReplyJson({ segments, tip, tone });

describe('wrapEnglish', () => {
  it('wraps an English phrase of two or more words and keeps the Chinese outside', () => {
    expect(wrapEnglish('要說 I went to school，昨天的事用過去式。')).toBe('要說 <en>I went to school</en>，昨天的事用過去式。');
  });
  it('leaves text that is already inside <en> alone', () => {
    expect(wrapEnglish('要說 <en>I went to school.</en>，昨天的事。')).toBe('要說 <en>I went to school.</en>，昨天的事。');
  });
  it('a lone English word (a grammar term) is not wrapped', () => {
    expect(wrapEnglish('過去式要用 went 喔。')).toBe('過去式要用 went 喔。');
  });
  it('plain Chinese is unchanged', () => {
    expect(wrapEnglish('要用過去式表示昨天的事。')).toBe('要用過去式表示昨天的事。');
  });
});

describe('fixReplyJson: the reply as it is shown and stored', () => {
  it('a reply with no tip comes back unchanged', async () => {
    const raw = reply([{ lang: 'en', text: 'Oh nice! Was it fun?', gloss: '不錯耶！好玩嗎？' }], '', 'happy');
    const out = await fixReplyJson(raw);
    expect(out).toEqual({ json: raw, tipRewrite: false });
  });

  it('the key order and the spacing are the canonical ones', async () => {
    const out = await fixReplyJson('{ "tone": "happy", "tip": "", "segments": [ {"gloss":"好","text":"Sure.","lang":"en"} ] }');
    expect(out.json).toBe('{"segments":[{"lang":"en","text":"Sure.","gloss":"好"}],"tip":"","tone":"happy"}');
  });

  it('a Chinese 小提醒 with an unwrapped English sentence: the English is wrapped, the Chinese stays, no rewrite', async () => {
    const log = vi.fn();
    const out = await fixReplyJson(reply([{ lang: 'en', text: 'I see!', gloss: '這樣啊！' }], '要說 I went to the park，昨天的事要用過去式喔。', 'happy'), { log });
    const j = JSON.parse(out.json) as { tip: string };
    expect(j.tip).toBe('要說 <en>I went to the park</en>，昨天的事要用過去式喔。');
    expect(out.tipRewrite).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('wrapped'));
  });

  it('a 小提醒 written in English (Chinese was asked for) is kept as it is and marked for the background rewrite', async () => {
    const tip = 'Say <en>I went to the park.</en> Use the past tense for yesterday.';
    const out = await fixReplyJson(reply([{ lang: 'en', text: 'I see!', gloss: '這樣啊！' }], tip, 'happy'));
    const j = JSON.parse(out.json) as { tip: string };
    expect(j.tip).toBe(tip);
    expect(out.tipRewrite).toBe(true);
  });

  it('with the English tip language, an English 小提醒 is kept and never rewritten', async () => {
    const tip = 'Say <en>I went to the park.</en> Use the past tense for yesterday.';
    const out = await fixReplyJson(reply([{ lang: 'en', text: 'I see!', gloss: '這樣啊！' }], tip, 'happy'), { tipLang: 'en' });
    expect(JSON.parse(out.json).tip).toBe(tip);
    expect(out.tipRewrite).toBe(false);
  });

  it('a reply with a Chinese segment keeps its Chinese text', async () => {
    const raw = reply([{ lang: 'zh', text: '好呀', gloss: '' }], '', 'happy');
    expect((await fixReplyJson(raw)).json).toBe(raw);
  });

  it('an invalid tone is left out, the rest is kept', async () => {
    const out = await fixReplyJson('{"segments":[{"lang":"en","text":"Sure.","gloss":"好"}],"tip":"","tone":"explode"}');
    expect(out.json).toBe('{"segments":[{"lang":"en","text":"Sure.","gloss":"好"}],"tip":""}');
  });

  it('a segment in an unknown language (an old Japanese save) is dropped', async () => {
    const out = await fixReplyJson('{"segments":[{"lang":"ja","text":"はい","gloss":"好"},{"lang":"en","text":"Yes.","gloss":"好"}],"tip":""}');
    expect(JSON.parse(out.json).segments).toEqual([{ lang: 'en', text: 'Yes.', gloss: '好' }]);
  });

  it('an empty reply comes back as an empty reply (the client then reports that there is no reply)', async () => {
    const log = vi.fn();
    const out = await fixReplyJson('', { log });
    expect(out).toEqual({ json: '{"segments":[],"tip":""}', tipRewrite: false });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('no readable JSON'));
  });
});

describe('fixReplyJson: a cut reply (the output limit) is read as far as it goes', () => {
  it('keeps the complete segments and what reads of the cut one, writing valid JSON back', async () => {
    const log = vi.fn();
    const cut = '{"segments":[{"lang":"en","text":"I went to school.","gloss":"我去了學校。"},{"lang":"en","text":"It was fu';
    const out = await fixReplyJson(cut, { log });
    const j = JSON.parse(out.json) as { segments: { text: string }[]; tip: string };
    expect(j.segments.map((s) => s.text)).toEqual(['I went to school.', 'It was fu']);
    expect(j.tip).toBe('');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('cut'));
  });

  it('a reply cut inside the tip keeps the segments and the tip so far', async () => {
    const cut = '{"segments":[{"lang":"en","text":"Sure.","gloss":"好"}],"tip":"要說 ';
    const j = JSON.parse((await fixReplyJson(cut)).json) as { segments: unknown[]; tip: string };
    expect(j.segments).toHaveLength(1);
    expect(j.tip).toBe('要說');
  });
});

describe('needsTipRewrite', () => {
  it('a Chinese explanation quoting English is not rewritten', () => {
    expect(needsTipRewrite('你說 "I am Taiwanese" 很好，自然又清楚。另外 "go to game" 要改成 "play games" 比較自然。')).toBe(false);
    expect(needsTipRewrite('要說 <en>I went to school yesterday.</en>，昨天的事要用過去式 went。')).toBe(false);
  });
  it('a tip written in English is rewritten', () => {
    expect(needsTipRewrite('You should say "I like math" here. "Number" alone sounds a bit unclear.')).toBe(true);
  });
  it('a tip of only Chinese is left alone', () => {
    expect(needsTipRewrite('這句說得很好！')).toBe(false);
  });
  it('isChineseTip is true for a wrapped Chinese tip', () => {
    expect(isChineseTip(wrapEnglish('注意這句要說 I went to school，昨天要用過去式才對。'))).toBe(true);
  });
  it('isChineseTip is false for an English tip', () => {
    expect(isChineseTip('Say <en>I went to school.</en> Use the past tense.')).toBe(false);
  });
});
