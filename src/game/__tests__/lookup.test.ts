// 速查 (lookup): the prompt, the request to the model, reply parsing, the level badge, the history and the
// one-minute rate limit. The Anthropic client and fetch are mocked: nothing calls Claude.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  LOOKUP_HISTORY_MAX, LOOKUP_KEY, addLookup, askLookup, clearLookups, enText, levelBadge, loadLookups, normalizeLevel, parseLookupText,
  resetLookupCacheForTest, saveLookups, stripEnTags, type LookupEntry,
} from '../lookup';
import {
  LOOKUP_MAX_TOKENS, LOOKUP_MODEL, LOOKUP_PER_MINUTE, lookupAnswer, parseLookupBody, takeLookupSlot,
} from '../../../server/claudeChat.ts';
import { LOOKUP_SYSTEM, systemPrompt } from '../../../server/prompts.ts';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    m,
    api: {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => m.clear(),
    },
  };
}

/** a client whose beta.messages.create answers with one text block */
function clientReturning(text: string) {
  const create = vi.fn(async () => ({ content: [{ type: 'text', text }] }));
  const client = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client, create };
}

const entry = (i: number): LookupEntry => ({ id: `e${i}`, q: `q${i}`, at: i, answer: { items: [], grammar: [], examples: [] } });

beforeEach(() => {
  const store = fakeStorage();
  vi.stubGlobal('localStorage', store.api);
  resetLookupCacheForTest();
  clearLookups();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the lookup prompt', () => {
  it('is a stable constant with no persona', () => {
    expect(LOOKUP_SYSTEM).not.toMatch(/Mugi/);
    expect(LOOKUP_SYSTEM).not.toBe(systemPrompt('Mugi'));
    expect(LOOKUP_SYSTEM).toContain('"items"');
    expect(LOOKUP_SYSTEM).toContain('CEFR');
    expect(LOOKUP_SYSTEM).toContain('<en>');
  });
});

describe('the request to the model', () => {
  it('uses claude-haiku-5-5, 700 tokens, no thinking, the stable prompt and the question as the only message', async () => {
    const { client, create } = clientReturning('{"items":[],"grammar":[],"examples":[],"message":"ok"}');
    await lookupAnswer(client, '這句話英文怎麼說');
    expect(LOOKUP_MODEL).toBe('claude-haiku-5-5');
    expect(LOOKUP_MAX_TOKENS).toBe(700);
    const [body, opts] = create.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.max_tokens).toBe(700);
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.system).toBe(LOOKUP_SYSTEM);
    expect(body.messages).toEqual([{ role: 'user', content: '這句話英文怎麼說' }]);
    expect(opts).toEqual({ timeout: 20_000 });
  });

  it('parses the reply: every en field keeps its <en> tags, the levels are CEFR', async () => {
    const reply = JSON.stringify({
      items: [{ en: '<en>go to school</en>', zh: '去學校', level: 'A1' }],
      grammar: [{ point: '<en>used to + V</en>', level: 'B1', explain: '過去常常' }],
      examples: [{ en: 'I went to school.', zh: '我去了學校' }],
    });
    const { client } = clientReturning(reply);
    const r = await lookupAnswer(client, '去學校');
    expect(r.answer?.items[0].en).toBe('<en>go to school</en>');
    expect(r.answer?.examples[0].en).toBe('<en>I went to school.</en>');
    expect(r.answer?.grammar[0].level).toBe('B1');
    expect(r.raw).toBe(reply);
  });

  it('returns the raw text when the reply is not readable JSON', async () => {
    const { client } = clientReturning('抱歉，我無法用 JSON 回覆');
    const r = await lookupAnswer(client, 'x');
    expect(r.answer).toBeNull();
    expect(r.raw).toBe('抱歉，我無法用 JSON 回覆');
  });
});

describe('reply parsing', () => {
  it('reads plain JSON and wraps a bare English en in <en>', () => {
    const a = parseLookupText('{"items":[{"en":"thank you","zh":"謝謝","level":"A1"}],"grammar":[],"examples":[]}');
    expect(a?.items[0]).toEqual({ en: '<en>thank you</en>', zh: '謝謝', level: 'A1' });
  });

  it('strips code fences and text around the JSON', () => {
    const fenced = '```json\n{"items":[],"grammar":[],"examples":[],"message":"你好"}\n```';
    expect(parseLookupText(fenced)?.message).toBe('你好');
    expect(parseLookupText(`好的：${fenced}`)?.message).toBe('你好');
  });

  it('returns null for bad JSON, empty objects and empty text', () => {
    expect(parseLookupText('{"items":[')).toBeNull();
    expect(parseLookupText('{"items":[],"grammar":[],"examples":[],"message":""}')).toBeNull();
    expect(parseLookupText('   ')).toBeNull();
  });

  it('keeps Chinese fields free of <en> tags', () => {
    const a = parseLookupText('{"items":[{"en":"<en>go</en>","zh":"<en>去</en>去","level":"A1"}]}');
    expect(a?.items[0].zh).toBe('去去');
    expect(stripEnTags('<en>x</en>y')).toBe('xy');
  });

  it('speech and display drop the tags', () => {
    expect(enText('<en>I go to school.</en>')).toBe('I go to school.');
  });
});

describe('CEFR level', () => {
  it('normalises to A1…C2 or 其他', () => {
    expect(normalizeLevel('B2')).toBe('B2');
    expect(normalizeLevel('a1')).toBe('A1');
    expect(normalizeLevel(' C1 ')).toBe('C1');
    expect(normalizeLevel('其他')).toBe('其他');
    expect(normalizeLevel('C3')).toBe('其他');
    expect(normalizeLevel('N4')).toBe('其他');
    expect(normalizeLevel(undefined)).toBe('其他');
  });

  it('shows as 「B1」 or 「其他」', () => {
    expect(levelBadge('B1')).toBe('「B1」');
    expect(levelBadge('其他')).toBe('「其他」');
  });
});

describe('lookup history', () => {
  it('puts a new lookup first and caps the list', () => {
    let list: LookupEntry[] = [];
    for (let i = 0; i < LOOKUP_HISTORY_MAX + 5; i++) list = addLookup(list, entry(i));
    expect(list).toHaveLength(LOOKUP_HISTORY_MAX);
    expect(list[0].id).toBe(`e${LOOKUP_HISTORY_MAX + 4}`);
    expect(list[list.length - 1].id).toBe('e5');
  });

  it('saves to localStorage under the lookup key and loads it back', () => {
    saveLookups([entry(1), entry(2)]);
    resetLookupCacheForTest();
    expect(loadLookups().map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(JSON.parse(localStorage.getItem(LOOKUP_KEY) ?? '[]')).toHaveLength(2);
  });

  it('ignores broken storage', () => {
    localStorage.setItem(LOOKUP_KEY, '{not json');
    resetLookupCacheForTest();
    expect(loadLookups()).toEqual([]);
  });

  it('clears', () => {
    saveLookups([entry(1)]);
    expect(clearLookups()).toEqual([]);
    resetLookupCacheForTest();
    expect(loadLookups()).toEqual([]);
  });
});

describe('request validation and rate limit', () => {
  it('accepts a question up to 200 characters and rejects empty or longer ones', () => {
    expect(parseLookupBody(JSON.stringify({ q: ' 去學校 ' }))).toBe('去學校');
    expect(() => parseLookupBody(JSON.stringify({ q: '   ' }))).toThrow();
    expect(() => parseLookupBody(JSON.stringify({ q: 'あ'.repeat(201) }))).toThrow();
    expect(parseLookupBody(JSON.stringify({ q: 'あ'.repeat(200) }))).toHaveLength(200);
    expect(() => parseLookupBody('nope')).toThrow();
  });

  it('allows a fixed number of lookups per minute', () => {
    const times: number[] = [];
    for (let i = 0; i < LOOKUP_PER_MINUTE; i++) expect(takeLookupSlot(1000, times)).toBe(true);
    expect(takeLookupSlot(1000, times)).toBe(false);
    expect(takeLookupSlot(61_000, times)).toBe(true);
  });
});

describe('askLookup (client)', () => {
  it('posts the question and returns the answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, answer: { items: [], grammar: [], examples: [], message: 'x' }, raw: '' })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await askLookup('去學校');
    expect(r).toMatchObject({ ok: true, answer: { message: 'x' } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/lookup');
    expect(JSON.parse(String(init.body))).toEqual({ q: '去學校' });
  });

  it('returns the server message on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'rate_limit', message: '查詢太頻繁，稍後再試' }), { status: 429 })));
    expect(await askLookup('x')).toEqual({ ok: false, message: '查詢太頻繁，稍後再試' });
  });

  it('does not call the server for an empty question', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await askLookup('  ')).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('removeLookup', () => {
  it('drops only the entry with that id and keeps the order of the rest', async () => {
    const { removeLookup } = await import('../lookup');
    const mk = (id: string) => ({ id, q: id, at: 0, answer: null });
    expect(removeLookup([mk('a'), mk('b'), mk('c')], 'b').map((e) => e.id)).toEqual(['a', 'c']);
    expect(removeLookup([mk('a')], 'zz').map((e) => e.id)).toEqual(['a']);
  });
});
