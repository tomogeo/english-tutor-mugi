import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { chatRequest, parseChatBody, describeError, parseJudge, parseJudgeBody, parseFixTipBody, rewriteTip, TIP_FIX_MODEL, TIP_FIX_TIMEOUT_MS } from '../../../server/claudeChat.ts';
import { JUDGE_PROMPT, TIP_FIX_SYSTEM, reminderPrompt, systemPrompt } from '../../../server/prompts.ts';
import { userTurn } from '../claudeProtocol';

const ok = { messages: [{ role: 'user', content: '嗨' }], role: 'Mugi', mode: 'teacher', context: { timeOfDay: '晚上 9 點' } };

describe('chat request validation (server)', () => {
  it('accepts a well-formed body', () => {
    const b = parseChatBody(JSON.stringify(ok));
    expect(b.role).toBe('Mugi');
    expect(b.mode).toBe('teacher');
    expect(b.context.timeOfDay).toBe('晚上 9 點');
  });

  it('rejects a body whose last message is not the user', () => {
    const body = { ...ok, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] };
    expect(() => parseChatBody(JSON.stringify(body))).toThrow();
  });

  it('rejects too many messages and over-long messages', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'x' }));
    expect(() => parseChatBody(JSON.stringify({ ...ok, messages: many }))).toThrow();
    expect(() => parseChatBody(JSON.stringify({ ...ok, messages: [{ role: 'user', content: 'x'.repeat(2001) }] }))).toThrow();
  });

  it('rejects unknown role / mode and non-JSON', () => {
    expect(() => parseChatBody(JSON.stringify({ ...ok, role: 'Eve' }))).toThrow();
    expect(() => parseChatBody(JSON.stringify({ ...ok, mode: 'boss' }))).toThrow();
    expect(() => parseChatBody(JSON.stringify({ ...ok, mode: 'chat' }))).toThrow(); // the teacher mode is the only one
    expect(() => parseChatBody('{nope')).toThrow();
  });

  it('maps upstream failures to player-facing messages', () => {
    expect(describeError(new Error('boom'))).toEqual({ status: 500, message: 'boom' });
  });
});

describe('prompts (server)', () => {
  it('system prompt is stable and describes the JSON reply fields and the Japanese rules', () => {
    expect(systemPrompt('Mugi')).toBe(systemPrompt('Mugi'));
    expect(systemPrompt('Mugi')).toContain('segments');
    expect(systemPrompt('Mugi')).toContain('gloss');
    expect(systemPrompt('Mugi')).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('puts the time and the teacher mode in front of the last user message', () => {
    expect(userTurn('嗨', { timeOfDay: '晚上 9 點' }, 'teacher')).toBe('［情境：晚上 9 點］［模式：英語老師］嗨');
    expect(userTurn('嗨', {}, 'teacher')).toBe('［模式：英語老師］嗨');
  });

  it('the system block is the stable prompt with its own breakpoint; no top-level marker on the volatile tail', () => {
    const body = parseChatBody(JSON.stringify({
      ...ok,
      messages: [
        { role: 'user', content: '［情境：晚上 9 點］嗨' },
        { role: 'assistant', content: '嗨' },
        { role: 'user', content: '你好' },
      ],
    }));
    const req = chatRequest(body, 'claude-test');
    expect(req.cache_control).toBeUndefined();
    expect(req.system).toEqual([{ type: 'text', text: systemPrompt('Mugi'), cache_control: { type: 'ephemeral' } }]);
    expect(req.model).toBe('claude-test');
  });

  it('the breakpoint sits on the message before the newest user turn, and the newest turn has none', () => {
    const body = parseChatBody(JSON.stringify({
      ...ok,
      messages: [
        { role: 'user', content: '嗨' },
        { role: 'assistant', content: '嗨呀' },
        { role: 'user', content: '你好' },
      ],
    }));
    const msgs = chatRequest(body, 'claude-test').messages as Array<{ role: string; content: unknown }>;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].content).toBe('嗨');
    expect(msgs[1].content).toEqual([{ type: 'text', text: '嗨呀', cache_control: { type: 'ephemeral' } }]);
    expect(JSON.stringify(msgs[2].content)).not.toContain('cache_control');
  });

  it('a single user message has no breakpoint in the messages (only the system block is cached)', () => {
    const body = parseChatBody(JSON.stringify(ok));
    const msgs = chatRequest(body, 'claude-test').messages as Array<{ content: unknown }>;
    expect(JSON.stringify(msgs)).not.toContain('cache_control');
  });
});

describe('volatile reminder and cache prefix (server, no Claude call)', () => {
  const textOf = (c: unknown): string => (typeof c === 'string' ? c : (c as Array<{ text: string }>).map((b) => b.text).join(''));
  const turn = (messages: { role: 'user' | 'assistant'; content: string }[]) =>
    chatRequest(parseChatBody(JSON.stringify({ ...ok, messages })), 'claude-test');

  it('the reminder is appended to the newest user message only', () => {
    const req = turn([
      { role: 'user', content: '第一句' },
      { role: 'assistant', content: '好' },
      { role: 'user', content: '第二句' },
    ]);
    const msgs = req.messages as Array<{ content: unknown }>;
    expect(textOf(msgs[0].content)).toBe('第一句');
    expect(textOf(msgs[1].content)).toBe('好');
    expect(textOf(msgs[2].content)).toBe(`第二句\n\n<reminder>${reminderPrompt()}</reminder>`);
  });

  it('the body history is never changed: the reminder exists only in the upstream copy', () => {
    const body = parseChatBody(JSON.stringify({ ...ok, messages: [{ role: 'user', content: '第一句' }, { role: 'assistant', content: '好' }, { role: 'user', content: '第二句' }] }));
    chatRequest(body, 'claude-test');
    expect(body.messages.map((m) => m.content)).toEqual(['第一句', '好', '第二句']);
  });

  it('two consecutive requests: the system block and every message before the newest user turn are the same text', () => {
    const first = turn([{ role: 'user', content: '嗨' }]);
    const second = turn([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '嗨呀' },
      { role: 'user', content: '你好嗎' },
    ]);
    expect(first.system).toEqual(second.system);
    // the first newest turn is no longer newest in the second request: its reminder is not sent again, the text is the same
    const a1 = first.messages as Array<{ content: unknown }>;
    const a2 = second.messages as Array<{ content: unknown }>;
    expect(textOf(a2[0].content)).toBe(textOf(a1[0].content).replace(/\n\n<reminder>[\s\S]*<\/reminder>$/, ''));
    expect(textOf(a2[1].content)).toBe('嗨呀');
  });

  it('the stable history keeps its text from turn to turn; the breakpoint moves to the new end of it', () => {
    const t2 = turn([
      { role: 'user', content: '甲' }, { role: 'assistant', content: '乙' }, { role: 'user', content: '丙' },
    ]);
    const t3 = turn([
      { role: 'user', content: '甲' }, { role: 'assistant', content: '乙' }, { role: 'user', content: '丙' },
      { role: 'assistant', content: '丁' }, { role: 'user', content: '戊' },
    ]);
    const m2 = t2.messages as Array<{ content: unknown }>;
    const m3 = t3.messages as Array<{ content: unknown }>;
    // request 2's stable history 甲 乙 is the start of request 3's history: same text, so the cached prefix can be read
    expect(textOf(m3[0].content)).toBe(textOf(m2[0].content));
    expect(textOf(m3[1].content)).toBe(textOf(m2[1].content));
    // each request breaks its cache at the end of its stable history (before its newest user turn)
    expect(JSON.stringify(m2[1].content)).toContain('cache_control');
    expect(JSON.stringify(m3[3].content)).toContain('cache_control');
    expect(JSON.stringify(m3[1].content)).not.toContain('cache_control');
    expect(t2.system).toEqual(t3.system);
  });

  it('the system prompt is identical across turns and carries no volatile rule', () => {
    const a = systemPrompt('Mugi');
    expect(turn([{ role: 'user', content: '嗨' }]).system).toEqual([{ type: 'text', text: a, cache_control: { type: 'ephemeral' } }]);
    expect(a).not.toContain('<reminder>');
    expect(a).not.toContain('寫完之前逐項檢查');
  });
});

describe('judge (小提醒 practice, server)', () => {
  it('parses a clean single-line JSON reply', () => {
    expect(parseJudge('{"ok":true,"feedback":"很好！"}')).toEqual({ ok: true, feedback: '很好！' });
    expect(parseJudge('{"ok":false,"feedback":"「に」漏掉了"}')).toEqual({ ok: false, feedback: '「に」漏掉了' });
  });

  it('finds the first {…} inside surrounding text or a code fence', () => {
    expect(parseJudge('好的，結果如下：\n```json\n{"ok":true,"feedback":"讚"}\n```')).toEqual({ ok: true, feedback: '讚' });
  });

  it('falls back to a failed judgement when the text is not usable', () => {
    const fail = { ok: false, feedback: '判斷失敗，請再試一次' };
    expect(parseJudge('')).toEqual(fail);
    expect(parseJudge('我不確定')).toEqual(fail);
    expect(parseJudge('{nope')).toEqual(fail);
    expect(parseJudge('{"ok":"yes","feedback":"x"}')).toEqual(fail);
  });

  it('fills a missing feedback with a short default', () => {
    expect(parseJudge('{"ok":true}')).toEqual({ ok: true, feedback: '完全正確！' });
    expect(parseJudge('{"ok":false,"feedback":"  "}')).toEqual({ ok: false, feedback: '和目標句不一樣' });
  });

  it('validates the body: target and said are required strings up to 200 characters', () => {
    expect(parseJudgeBody(JSON.stringify({ target: ' 学校に行きました ', said: '学校に行きました' }))).toEqual({ target: '学校に行きました', said: '学校に行きました' });
    expect(() => parseJudgeBody('{nope')).toThrow();
    expect(() => parseJudgeBody(JSON.stringify({ target: '', said: 'a' }))).toThrow();
    expect(() => parseJudgeBody(JSON.stringify({ target: 'a' }))).toThrow();
    expect(() => parseJudgeBody(JSON.stringify({ target: 1, said: 'a' }))).toThrow();
    expect(() => parseJudgeBody(JSON.stringify({ target: 'a'.repeat(201), said: 'a' }))).toThrow();
    expect(() => parseJudgeBody(JSON.stringify({ target: 'a', said: 'a'.repeat(201) }))).toThrow();
  });

  it('the judge prompt is stable and asks for the one-line JSON', () => {
    expect(JUDGE_PROMPT).toContain('{"ok":true|false');
    expect(JUDGE_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('tip rewrite (server, mocked client: nothing calls Claude)', () => {
  const clientReturning = (text: string) => {
    const create = vi.fn(async () => ({ content: [{ type: 'text', text }] }));
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  };

  it('uses claude-haiku-5-5, max_tokens 300, no thinking, the fixed system prompt, and a 10 s timeout', async () => {
    const { client, create } = clientReturning('<tip>要說 <en>I went to school.</en>。</tip>');
    await rewriteTip(client, 'Say <en>I went to school.</en> Use the past tense.');
    expect(TIP_FIX_MODEL).toBe('claude-haiku-5-5');
    expect(TIP_FIX_TIMEOUT_MS).toBe(10_000);
    const [body, opts] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(300);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toBe(TIP_FIX_SYSTEM);
    expect(body.messages).toEqual([{ role: 'user', content: 'Say <en>I went to school.</en> Use the past tense.' }]);
    expect(opts).toEqual({ timeout: 10_000 });
  });

  it('returns the rewritten tip with its English wrapped in <en>, when it is Chinese', async () => {
    const { client } = clientReturning('<tip>要說 I went to school，昨天的事要用過去式。</tip>');
    expect(await rewriteTip(client, 'x')).toBe('要說 <en>I went to school</en>，昨天的事要用過去式。');
  });

  it('returns null when the rewrite still reads as English (the caller keeps the original)', async () => {
    const { client } = clientReturning('<tip>Say I went to school. Use the past tense.</tip>');
    expect(await rewriteTip(client, 'x')).toBeNull();
  });

  it('returns null for an empty reply', async () => {
    const { client } = clientReturning('   ');
    expect(await rewriteTip(client, 'x')).toBeNull();
  });

  it('validates the fix-tip body: tip is a non-empty string up to 1000 characters', () => {
    expect(parseFixTipBody('{"tip":"  要說 <en>行きましょう</en>。  "}')).toBe('要說 <en>行きましょう</en>。');
    expect(() => parseFixTipBody('{"tip":""}')).toThrow();
    expect(() => parseFixTipBody(JSON.stringify({ tip: 'x'.repeat(1001) }))).toThrow();
    expect(() => parseFixTipBody('{nope')).toThrow();
  });
});
