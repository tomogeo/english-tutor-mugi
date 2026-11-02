// askClaude uses the server's done text as the reply when it has one (the server fixes readings and a Japanese tip before
// it sends done). Without a done text the streamed copy is used, as before.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onReply, type ReplyEvent } from '../replyBus';
import { askClaude } from '../claudeBrain';

/** the stream of her reply: the JSON text cut into the given deltas */
const sse = (...parts: string[]) => parts.map((t) => `data: ${JSON.stringify({ type: 'delta', text: t })}\n\n`).join('');
const done = (text: string, extra: Record<string, unknown> = {}) => `data: ${JSON.stringify({ type: 'done', text, ...extra })}\n\n`;
const collect = () => {
  const events: ReplyEvent[] = [];
  const off = onReply((e) => events.push(e));
  return { events, off };
};

const streamedJa = '{"segments":[{"lang":"en","text":"学校に行きました","gloss":"去了學校"}],"tip":"","tone":"happy"}';
const doneJa = '{"segments":[{"lang":"en","text":"学校[がっこう]に行[い]きました","gloss":"去了學校"}],"tip":"","tone":"happy"}';

describe('askClaude: the done text is the reply as shown', () => {
  afterEach(() => vi.unstubAllGlobals());
  const teacher = { history: [{ from: 'me' as const, text: '嗨', t: 1 }], role: 'Mugi' as const, mode: 'teacher' as const, context: {} };

  it('readings added by the server show up in the reply, the voice still gets the streamed Japanese', async () => {
    const body = sse(streamedJa.slice(0, 40), streamedJa.slice(40)) + done(doneJa);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { events, off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.text).toBe('学校[がっこう]に行[い]きました（去了學校）');
    expect(r.spoken).toBe('学校[がっこう]に行[い]きました');
    expect(r.tone).toBe('happy');
    expect(r.segments.filter((s) => s.lang === 'en').map((s) => s.text)).toEqual(['学校[がっこう]に行[い]きました']);
    const deltas = events.filter((e) => e.type === 'delta').map((e) => (e.type === 'delta' ? e.text : '')).join('');
    expect(deltas).toBe('学校に行きました');
    expect(events[events.length - 1]).toEqual({ type: 'done', id: expect.any(Number), text: '学校[がっこう]に行[い]きました' });
  });

  it('the reply stored for the history is the done JSON (tip left out)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(streamedJa) + done(doneJa), { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.sent).toBe(doneJa);
  });

  it('a repaired tip from the server replaces the streamed one, and its Japanese targets are collected', async () => {
    const doneTip = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":"這樣啊！"}],"tip":"要說 <en>学校[がっこう]に行[い]きました</en>，去哪裡要用「<en>に</en>」喔。","tone":"happy"}';
    const body = sse('{"segments":[{"lang":"en","text":"そうなんだ！","gloss":"這樣啊！"}],"tip":"學校に行きました"}') + done(doneTip, { tipRewrite: true });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.tip).toBe('要說 学校[がっこう]に行[い]きました，去哪裡要用「に」喔。');
    expect(r.tipEn).toEqual(['学校[がっこう]に行[い]きました', 'に']);
  });

  it('a tip missing from the done text leaves no tip, even though the stream had one', async () => {
    const streamedTip = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":""}],"tip":"學校に行きました","tone":"happy"}';
    const doneNoTip = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":""}],"tip":"","tone":"happy"}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(streamedTip) + done(doneNoTip), { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.tip).toBeUndefined();
    expect(r.tipEn).toBeUndefined();
  });

  it('without a done text (older server) the streamed copy is used', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse(streamedJa), { status: 200 })));
    const { off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.text).toBe('学校に行きました（去了學校）');
  });
});
