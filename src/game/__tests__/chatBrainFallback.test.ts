// The chat brain interface: the fallback chain (replyWithFallback) and claudeBrain as a 1:1 wrapper of askClaude.
// Nothing here calls Claude: fetch is stubbed and the fake brains answer by script.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fallbackChain, replyWithFallback, type BrainCapabilities, type BrainRequest, type ChatBrain } from '../chatBrain';
import { askClaude, claudeBrain, claudeStatus } from '../claudeBrain';

const req = (mode: 'teacher' = 'teacher'): BrainRequest => ({
  history: [{ from: 'me', text: '你好', t: 1 }], situation: {}, mode, role: 'Mugi',
});

/** A scripted brain: counts its replies, fails with `fail`, is unavailable when `ok` is false. */
function fake(id: string, over: { ok?: boolean; fail?: string; teacher?: boolean; reply?: string } = {}) {
  const calls = { reply: 0 };
  const caps: BrainCapabilities = { streaming: false, teacher: over.teacher ?? true, needsServer: false };
  const brain: ChatBrain = {
    id, label: id, capabilities: caps,
    available: () => over.ok ?? true,
    reply: async () => {
      calls.reply++;
      if (over.fail) throw new Error(over.fail);
      return { text: over.reply ?? `${id} 回` };
    },
  };
  return { brain, calls };
}

describe('replyWithFallback: the chain', () => {
  it('uses the first brain that answers, and reports no error', async () => {
    const a = fake('a', { reply: 'A 的回覆' }), b = fake('b');
    const onError = vi.fn();
    const got = await replyWithFallback([a.brain, b.brain], req(), { onError });
    expect(got.brain).toBe(a.brain);
    expect(got.reply.text).toBe('A 的回覆');
    expect(onError).not.toHaveBeenCalled();
    expect(b.calls.reply).toBe(0);
  });

  it('a failing brain is reported (brain and message) and the next one answers', async () => {
    const a = fake('a', { fail: 'boom' }), b = fake('b', { reply: 'B 接手' });
    const onError = vi.fn();
    const got = await replyWithFallback([a.brain, b.brain], req(), { onError });
    expect(onError).toHaveBeenCalledWith(a.brain, 'boom');
    expect(got.brain).toBe(b.brain);
    expect(got.reply.text).toBe('B 接手');
  });

  it('an unavailable brain is skipped without a call', async () => {
    const a = fake('a', { ok: false }), b = fake('b');
    const got = await replyWithFallback([a.brain, b.brain], req());
    expect(a.calls.reply).toBe(0);
    expect(got.brain).toBe(b.brain);
  });

  it('teacher mode skips a brain that cannot teach', async () => {
    const plain = fake('plain', { teacher: false }), teacher = fake('teacher', { reply: '老師回' });
    const got = await replyWithFallback([plain.brain, teacher.brain], req('teacher'));
    expect(plain.calls.reply).toBe(0);
    expect(got.reply.text).toBe('老師回');
  });

  it('a chain of one teaching brain answers in teacher mode, and a failing one is the error the player sees', async () => {
    const claude = fake('claude', { reply: '老師回' });
    expect((await replyWithFallback([claude.brain], req('teacher'))).reply.text).toBe('老師回');
    const broken = fake('claude', { fail: 'Claude 掛了' });
    await expect(replyWithFallback([broken.brain], req('teacher'))).rejects.toThrow('Claude 掛了');
  });

  it('when nothing answers, the last failure is thrown; an empty chain says so', async () => {
    const a = fake('a', { fail: 'boom' });
    await expect(replyWithFallback([a.brain], req())).rejects.toThrow('boom');
    await expect(replyWithFallback([fake('x', { ok: false }).brain], req())).rejects.toThrow('沒有可用的對話引擎');
  });
});

describe('the chain and the Claude brain', () => {
  it('the chain is Claude alone: there is no offline brain to fall back to', () => {
    expect(fallbackChain()).toEqual([claudeBrain]);
  });

  it('capabilities: Claude streams and teaches', () => {
    expect(claudeBrain.capabilities).toEqual({ streaming: true, teacher: true, needsServer: true });
    expect(claudeBrain.label).toBe('Claude');
  });
});

describe('claudeBrain: a 1:1 wrapper of askClaude', () => {
  const sse = (...parts: string[]) => parts.map((t) => `data: ${JSON.stringify({ type: 'delta', text: t })}\n\n`).join('');
  const done = (text: string) => `data: ${JSON.stringify({ type: 'done', text })}\n\n`;
  afterEach(() => vi.unstubAllGlobals());

  /** the status endpoint says `ok`; the chat endpoint streams `body` (or fails with `fail`) */
  function stubServer(ok: boolean, body = '', fail?: string) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/chat/status') return new Response(JSON.stringify({ ok, model: 'claude-test' }), { status: 200 });
      if (fail) throw new TypeError(fail);
      return new Response(body, { status: 200 });
    }));
  }

  it('available follows the status read (the key is set)', async () => {
    stubServer(true);
    await claudeStatus();
    expect(await claudeBrain.available()).toBe(true);
    stubServer(false);
    await claudeStatus();
    expect(await claudeBrain.available()).toBe(false);
  });

  it('every field of the Claude reply comes through unchanged (teacher mode: tip, tipEn, tipRaw, tipRewrite, spoken, segments, sent)', async () => {
    const reply = '{"segments":[{"lang":"en","text":"学校に行きました","gloss":"去了學校"}],"tip":"要說 学校に行きました，去哪裡要用「<en>に</en>」。","tone":"happy"}';
    stubServer(true, sse(reply.slice(0, 30), reply.slice(30)) + done(reply));
    await claudeStatus();
    const direct = await askClaude({ history: req().history, role: 'Mugi', mode: 'teacher', context: {} });
    const wrapped = await claudeBrain.reply({ ...req(), situation: {} });
    expect(wrapped).toEqual({
      text: direct.text, tone: direct.tone, spoken: direct.spoken, segments: direct.segments,
      tip: direct.tip, tipEn: direct.tipEn, tipRaw: direct.tipRaw, tipRewrite: direct.tipRewrite, sent: direct.sent,
    });
    expect(wrapped.tip).toBeTruthy();
    expect(wrapped.sent).toBe(reply.replace(/"tip":"[^"]*"/, '"tip":""'));
  });

  it('the streamed text reaches onDelta through the request', async () => {
    stubServer(true, sse('{"segments":[{"lang":"en","text":"嗨呀","gloss":""}],"tip":"","tone":"happy"}') + done('{"segments":[{"lang":"en","text":"嗨呀","gloss":""}],"tip":"","tone":"happy"}'));
    await claudeStatus();
    const seen: string[] = [];
    await claudeBrain.reply({ ...req(), onDelta: (t) => seen.push(t) });
    expect(seen[seen.length - 1]).toBe('嗨呀');
  });

  it('a failing server makes the chain fail with the Claude error (there is nothing else to answer)', async () => {
    stubServer(true, '', '連不上 Claude');
    await claudeStatus();
    const onError = vi.fn();
    await expect(replyWithFallback(fallbackChain(), req(), { onError })).rejects.toThrow('連不上 Claude');
    expect(onError).toHaveBeenCalledWith(claudeBrain, '連不上 Claude');
  });

  it('with no key the chain has no brain to answer and says so', async () => {
    stubServer(false);
    await claudeStatus();
    await expect(replyWithFallback(fallbackChain(), req())).rejects.toThrow('沒有可用的對話引擎');
  });
});
