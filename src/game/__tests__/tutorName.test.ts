// The tutor's name and subtitle, and her saved figure view: the first prompt line carries the name, the request body
// carries it (Claude and ChatGPT), the persona key covers it, and the settings keep the subtitle and the figure view.
// Nothing here calls Claude: the upstream is a fetch stub, and the ChatGPT request is converted, not sent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatRequest, parseChatBody, parseName } from '../../../server/claudeChat.ts';
import { responsesBody } from '../../../server/llm/openaiProvider.ts';
import { defaultPersona, systemPrompt } from '../../../server/prompts.ts';
import { NAME_MAX_CHARS, nameText } from '../claudeProtocol';
import { askClaude, markPersonaReset, personaKey } from '../claudeBrain';
import type { ChatLine } from '../chatTypes';
import {
  DEFAULT_TUTOR, FIGURE_SCALE_MAX, FIGURE_SCALE_MIN, TUTOR_DEFAULT_NAME, TUTOR_KEY, TUTOR_SUBTITLE_MAX, cleanFigureView, cleanTutorSubtitle,
  figureViewStart, figureViewToSave, loadTutor, migrateTutor,
} from '../tutor';
import { TUTOR_CHARACTER } from '../tutorCharacters';

const base = { messages: [{ role: 'user', content: '嗨' }], role: 'Mugi', mode: 'teacher', context: {} };
const FIRST_LINE = (name: string) => `你是「${name}」，一位住在使用者身邊、專門教他英語的家教。你正在和使用者一對一練習英語會話。`;

/** the HTTP status and message of a refused request (parseName / parseChatBody throw them) */
function refusal(fn: () => unknown): { status: number; message: string } | null {
  try { fn(); } catch (e) { return e as { status: number; message: string }; }
  return null;
}

// ---------------------------------------------------------------- the prompt

describe('the first prompt line carries her name', () => {
  it('names her with the given name, in the first line', () => {
    expect(systemPrompt('Mugi', undefined, 'ミオ').split('\n')[0]).toBe(FIRST_LINE('ミオ'));
    expect(systemPrompt('Mugi').split('\n')[0]).toBe(FIRST_LINE('Mugi'));
    expect(systemPrompt('Mugi', undefined, 'ミオ')).not.toContain('Mugi');
  });
  it('the default name (or none) with no persona is one stable string', () => {
    expect(systemPrompt('Mugi', undefined, 'Mugi')).toBe(systemPrompt('Mugi'));
    expect(systemPrompt('Mugi')).toBe(systemPrompt('Mugi'));
  });
  it('the hamster lives in the default personality only: a persona or a name keeps the rules without it', () => {
    expect(systemPrompt('Mugi')).toContain('倉鼠');
    expect(systemPrompt('Mugi', '冷靜沉穩的老師', 'ミオ')).not.toContain('倉鼠');
    expect(systemPrompt('Mugi', undefined, 'ミオ')).toContain(defaultPersona('Mugi'));
  });
  it('the rules after the personality line are the same whatever the name is', () => {
    const tail = (s: string) => s.slice(s.indexOf('\n你同時是使用者的英語會話夥伴'));
    expect(tail(systemPrompt('Mugi', undefined, 'ミオ'))).toBe(tail(systemPrompt('Mugi')));
  });
});

// ---------------------------------------------------------------- the name on the server

describe('the name of a chat body (server)', () => {
  it('nameText removes every control character, trims, and makes < and > full-width', () => {
    expect(nameText('  ミ\u0007オ\n\t ')).toBe('ミオ');
    expect(nameText('<b>x</b>')).toBe('＜b＞x＜/b＞');
  });
  it('parseName: absent or null is no name; 1 to 16 characters are kept; empty, blank or longer is a 400', () => {
    expect(parseName(undefined)).toBeUndefined();
    expect(parseName(null)).toBeUndefined();
    expect(parseName('ミオ')).toBe('ミオ');
    expect(parseName('あ'.repeat(NAME_MAX_CHARS))).toBe('あ'.repeat(NAME_MAX_CHARS));
    expect(refusal(() => parseName(''))).toMatchObject({ status: 400, message: '名字需為 1～16 個字' });
    expect(refusal(() => parseName('  \u0007 \n '))).toMatchObject({ status: 400, message: '名字需為 1～16 個字' });
    expect(refusal(() => parseName('あ'.repeat(NAME_MAX_CHARS + 1)))).toMatchObject({ status: 400, message: '名字需為 1～16 個字' });
    expect(refusal(() => parseName(42))).toMatchObject({ status: 400 });
  });
  it('the chat body carries the name when there is one, and none when there is not', () => {
    expect(parseChatBody(JSON.stringify({ ...base, name: ' ミオ ' })).name).toBe('ミオ');
    expect(parseChatBody(JSON.stringify(base))).not.toHaveProperty('name');
    expect(refusal(() => parseChatBody(JSON.stringify({ ...base, name: 'あ'.repeat(17) })))).toMatchObject({ status: 400 });
  });
  it('the Claude request puts the name in its system block; the ChatGPT request carries the same text as instructions', () => {
    const body = parseChatBody(JSON.stringify({ ...base, name: 'ミオ' }));
    const req = chatRequest(body, 'claude-haiku-5-5');
    expect(req.system).toEqual([{ type: 'text', text: systemPrompt('Mugi', undefined, 'ミオ'), cache_control: { type: 'ephemeral' } }]);
    expect(responsesBody(req).instructions).toBe(systemPrompt('Mugi', undefined, 'ミオ'));
    expect(responsesBody(chatRequest(parseChatBody(JSON.stringify(base)), 'gpt-test')).instructions).toBe(systemPrompt('Mugi'));
  });
});

// ---------------------------------------------------------------- the name on the phone

describe('the name sent with each chat request (phone)', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const sse = (text: string) => `data: ${JSON.stringify({ type: 'delta', text })}\n\n` + `data: ${JSON.stringify({ type: 'done', text })}\n\n`;
  const reply = '{"segments":[{"lang":"en","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}';
  const teacher = { history: [{ from: 'me' as const, text: '嗨', t: 1 }], role: 'Mugi' as const, mode: 'teacher' as const, context: {} };

  it('sends the saved name with the chat request', async () => {
    store.set(TUTOR_KEY, JSON.stringify({ name: 'ミオ', sttLang: 'en-US' }));
    const fetchMock = vi.fn(async () => new Response(sse(reply), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await askClaude(teacher);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.name).toBe('ミオ');
  });
  it('sends the default name when none was set', async () => {
    const fetchMock = vi.fn(async () => new Response(sse(reply), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await askClaude(teacher);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.name).toBe(TUTOR_DEFAULT_NAME);
  });
});

describe('the persona key covers the name', () => {
  it('a new name starts the request window at the new line, like a new personality', () => {
    const k1 = personaKey(undefined, 'Mugi'), k2 = personaKey(undefined, 'ミオ');
    const lines: ChatLine[] = [
      { from: 'me', text: '嗨', t: 1, pk: k1 },
      { from: 'her', text: 'はい', t: 2, pk: k1 },
      { from: 'me', text: '又', t: 3, pk: k2 },
    ];
    const out = markPersonaReset(lines, k2);
    expect(out.map((l) => !!l.win)).toEqual([false, false, true]);
  });
});

// ---------------------------------------------------------------- subtitle and figure view (settings)

describe('the subtitle', () => {
  it('defaults to the character’s subtitle, and is cleaned and cut to the limit', () => {
    expect(DEFAULT_TUTOR.characters[0].subtitle).toBe(TUTOR_CHARACTER.subtitle);
    expect(cleanTutorSubtitle('  副標\u0007  ')).toBe('副標');
    expect(cleanTutorSubtitle('   ')).toBe(TUTOR_CHARACTER.subtitle);
    expect(cleanTutorSubtitle(42)).toBe(TUTOR_CHARACTER.subtitle);
    expect(cleanTutorSubtitle('一二三四五六七八九十一二三四五六七八')).toHaveLength(TUTOR_SUBTITLE_MAX);
  });
  it('an older save has no subtitle: the default one', () => {
    expect(migrateTutor({ name: 'Mugi' }).characters[0].subtitle).toBe('倉鼠・英語家教');
    expect(migrateTutor({ subtitle: 'ミオの部屋' }).characters[0].subtitle).toBe('ミオの部屋');
  });
});

describe('the figure view', () => {
  it('is cleaned: finite numbers, the scale kept in 0.5 to 3; anything else is no saved view', () => {
    expect(FIGURE_SCALE_MIN).toBe(0.5);
    expect(FIGURE_SCALE_MAX).toBe(3);
    expect(cleanFigureView({ scale: 0.1, x: 0, y: 0 })).toEqual({ scale: 0.5, x: 0, y: 0 });
    expect(cleanFigureView({ scale: 9, x: 4, y: -2 })).toEqual({ scale: 3, x: 4, y: -2 });
    expect(cleanFigureView({ scale: 'a', x: 0, y: 0 })).toBeNull();
    expect(cleanFigureView({ scale: 2, x: 0 })).toBeNull();
    expect(cleanFigureView(null)).toBeNull();
  });
  it('an older save has none: null, and it comes back through loadTutor', () => {
    expect(migrateTutor({}).characters[0].figureView).toBeNull();
    const store = new Map<string, string>([[TUTOR_KEY, JSON.stringify({ name: 'Mugi', figureView: { scale: 2, x: 10, y: -4 } })]]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} });
    expect(loadTutor().characters[0].figureView).toEqual({ scale: 2, x: 10, y: -4 });
    vi.unstubAllGlobals();
  });
  it('the identity view is no saved view; any other view is kept', () => {
    expect(figureViewToSave({ scale: 1, x: 0, y: 0 })).toBeNull();
    expect(figureViewToSave({ scale: 1.5, x: 3, y: 4 })).toEqual({ scale: 1.5, x: 3, y: 4 });
    expect(figureViewToSave({ scale: 4, x: 0, y: 0 })).toEqual({ scale: 3, x: 0, y: 0 });
  });
  it('a custom picture starts from the saved view; the hamster (or nothing saved) starts at the default framing', () => {
    expect(figureViewStart(true, { scale: 2, x: 10, y: -4 })).toEqual({ scale: 2, x: 10, y: -4 });
    expect(figureViewStart(true, null)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(figureViewStart(false, { scale: 2, x: 10, y: -4 })).toEqual({ scale: 1, x: 0, y: 0 });
  });
});
