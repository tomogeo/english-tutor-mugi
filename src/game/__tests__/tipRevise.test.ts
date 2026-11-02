// The background rewrite of a Japanese 小提醒 (claudeBrain.reviseTip / replaceTipLine + tipsBook.updateTip), and the tip
// of her reply JSON as the stream reads it. fetch is mocked: nothing calls the server or Claude.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatLine } from '../chatTypes';
import { ReplyJsonParser, parseSSEData, replaceTipLine, reviseTip, askClaude, splitTip } from '../claudeBrain';
import { onReply, type ReplyEvent } from '../replyBus';
import { addTip, loadTips, updateTip } from '../tipsBook';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('the done event carries the rewrite flag', () => {
  it('reads tipRewrite only when it is true', () => {
    expect(parseSSEData('{"type":"done","text":"x","tipRewrite":true}')).toEqual({ type: 'done', text: 'x', tipRewrite: true });
    expect(parseSSEData('{"type":"done","text":"x"}')).toEqual({ type: 'done', text: 'x' });
  });
});

describe('the tip keeps its <en> tags in the reply and the tip text does not', () => {
  it('the parser reads the tip with its tags; splitTip gives the plain text and the targets', () => {
    const p = new ReplyJsonParser();
    p.push('{"segments":[{"lang":"en","text":"そうなんだ","gloss":"這樣啊"}],"tip":"要說 <en>学校[がっこう]に行[い]きました</en>，去哪裡。","tone":"happy"}');
    p.finish();
    expect(p.fields.tip).toBe('要說 <en>学校[がっこう]に行[い]きました</en>，去哪裡。');
    expect(splitTip(p.fields.tip)).toEqual({ text: '要說 学校[がっこう]に行[い]きました，去哪裡。', targets: ['学校[がっこう]に行[い]きました'] });
  });
});

describe('askClaude reports the rewrite only with a tip', () => {
  const sse = (...parts: string[]) => parts.map((t) => `data: ${JSON.stringify({ type: 'delta', text: t })}\n\n`).join('');
  const teacher = { history: [{ from: 'me' as const, text: '嗨', t: 1 }], role: 'Mugi' as const, mode: 'teacher' as const, context: {} };
  const collect = () => { const events: ReplyEvent[] = []; const off = onReply((e) => events.push(e)); return { events, off }; };

  it('a done text with Japanese prose in the tip sets tipRewrite and tipRaw', async () => {
    const doneText = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":"這樣啊！"}],"tip":"要說 <en>学校[がっこう]に行[い]きました</en>，去哪裡要用「<en>に</en>」喔。","tone":"happy"}';
    const done = `data: ${JSON.stringify({ type: 'done', text: doneText, tipRewrite: true })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(doneText) + done, { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.tipRewrite).toBe(true);
    expect(r.tipRaw).toBe('要說 <en>学校[がっこう]に行[い]きました</en>，去哪裡要用「<en>に</en>」喔。');
  });

  it('no flag when the server did not ask for a rewrite', async () => {
    const doneText = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":"這樣啊！"}],"tip":"要說 <en>学校[がっこう]に行[い]きました</en>。","tone":"happy"}';
    const done = `data: ${JSON.stringify({ type: 'done', text: doneText })}\n\n`;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(doneText) + done, { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.tipRewrite).toBeUndefined();
    expect(r.tipRaw).toBeUndefined();
  });
});

describe('reviseTip (background, one request, never blocking)', () => {
  it('posts the tip to /api/chat/fix-tip and returns the rewritten text and targets', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, tip: '要說 <en>学校[がっこう]に行[い]きました</en>。' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await reviseTip('<en>学校に行きました</en>、「に」が大事です。');
    expect(r).toEqual({ text: '要說 学校[がっこう]に行[い]きました。', targets: ['学校[がっこう]に行[い]きました'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat/fix-tip');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ tip: '<en>学校に行きました</en>、「に」が大事です。' });
  });

  it('a refusal from the server keeps the original (null) and only warns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, message: '仍是英文' }), { status: 200 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await reviseTip('<en>行きましょう</en>')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('an HTTP failure keeps the original (null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: '沒有金鑰' }), { status: 503 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await reviseTip('<en>行きましょう</en>')).toBeNull();
    warn.mockRestore();
  });

  it('a network error keeps the original (null)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await reviseTip('<en>行きましょう</en>')).toBeNull();
    warn.mockRestore();
  });

  it('a request that never answers times out after the limit and keeps the original (null)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {}))); // never settles, ignores the abort
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const pending = reviseTip('<en>行きましょう</en>', 10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await pending).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
    warn.mockRestore();
  });
});

describe('the rewritten tip replaces the original in place', () => {
  it('replaceTipLine changes only the tip line that matches by time and old text; the same objects elsewhere', () => {
    const me: ChatLine = { from: 'me', text: '嗨', t: 1 };
    const her: ChatLine = { from: 'her', text: '回覆', t: 2 };
    const tip: ChatLine = { from: 'her', text: '學校に行きました', t: 3, tip: true };
    const out = replaceTipLine([me, her, tip], 3, '學校に行きました', '要說 学校[がっこう]に行[い]きました。');
    expect(out[0]).toBe(me);
    expect(out[1]).toBe(her);
    expect(out[2]).toEqual({ ...tip, text: '要說 学校[がっこう]に行[い]きました。' });
    // a line with another time or old text is not touched
    expect(replaceTipLine([tip], 4, '學校に行きました', 'x')[0]).toBe(tip);
  });

  it('the tips notebook entry keeps its id when updated, and the new text and targets are stored', () => {
    const entry = addTip({ text: '學校に行きました', targets: ['学校に行きました'], said: '嗨', role: 'Mugi' });
    expect(entry).not.toBeNull();
    const id = entry!.id;
    updateTip(id, { text: '要說 学校[がっこう]に行[い]きました。', targets: ['学校[がっこう]に行[い]きました'] });
    const after = loadTips().find((t) => t.id === id);
    expect(after?.text).toBe('要說 学校[がっこう]に行[い]きました。');
    expect(after?.targets).toEqual(['学校[がっこう]に行[い]きました']);
    expect(loadTips().filter((t) => t.id === id)).toHaveLength(1);
  });
});
