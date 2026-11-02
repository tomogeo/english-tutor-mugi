import { afterEach, describe, expect, it, vi } from 'vitest';
import { onReply, type ReplyEvent } from '../replyBus';
import type { ChatLine } from '../chatTypes';
import { CHAT_HISTORY_MAX, CHAT_MAX_MESSAGE_CHARS } from '../claudeProtocol';
import { canonicalReplyJson } from '../replyJson';
import {
  ReplyJsonParser, askClaude, markWindowReset, parseSSEData, splitTip, takeSSEEvents, timeOfDayText, toApiMessages, topicSent,
  userChatLine, CHAT_LEAD_TURN,
} from '../claudeBrain';

/** the text of a reply as SSE delta events, cut every `size` characters */
const sseOf = (text: string, size = 9) => {
  let out = '';
  for (let i = 0; i < text.length; i += size) out += `data: ${JSON.stringify({ type: 'delta', text: text.slice(i, i + size) })}\n\n`;
  return out;
};

/** her reply: two Japanese segments with glosses, and the text the bubble shows for it */
const REPLY = '{"segments":[{"lang":"en","text":"学校に行きました","gloss":"去了學校"},{"lang":"en","text":"楽しかった？","gloss":"好玩嗎？"}],"tip":"","tone":"happy"}';
const SHOWN = '学校に行きました（去了學校） 楽しかった？（好玩嗎？）';

/** feed a text to a parser in chunks of the given size; returns every voiced segment in order and the parser */
function feed(text: string, size: number) {
  const p = new ReplyJsonParser();
  const voiced: { text: string; lang: string }[] = [];
  for (let i = 0; i < text.length; i += size) voiced.push(...p.push(text.slice(i, i + size)));
  voiced.push(...p.finish());
  return { p, voiced };
}

const teacher = { history: [{ from: 'me' as const, text: '嗨', t: 1 }], role: 'Mugi' as const, mode: 'teacher' as const, context: {} };

describe('ReplyJsonParser: her JSON is read while it arrives', () => {
  it('the visible text grows with every chunk size and ends as the whole reply', () => {
    for (const size of [1, 2, 3, 5, 7, 40, 1000]) {
      const p = new ReplyJsonParser();
      let last = 0;
      for (let i = 0; i < REPLY.length; i += size) {
        p.push(REPLY.slice(i, i + size));
        expect(p.visible.length).toBeGreaterThanOrEqual(last);
        last = p.visible.length;
      }
      p.finish();
      expect(p.visible).toBe(SHOWN);
    }
  });

  it('escapes, unicode escapes, brackets and commas split across chunks change nothing in the end', () => {
    const raw = '{"segments":[{"lang":"en","text":"he said \\"はい\\" \\u3042","gloss":"說 \\"好\\", 括號(x)"}],"tip":"","tone":"happy"}';
    const want = 'he said "はい" あ（說 "好", 括號(x)）';
    for (const size of [1, 2, 3, 4, 5, 6, 11]) {
      const p = new ReplyJsonParser();
      for (let i = 0; i < raw.length; i += size) {
        p.push(raw.slice(i, i + size));
        expect(p.visible).not.toContain('\\'); // a half-written escape never shows
      }
      p.finish();
      expect(p.visible).toBe(want);
    }
  });

  it('a segment is voiced only once the next one has started, never while it is being written', () => {
    const p = new ReplyJsonParser();
    expect(p.push('{"segments":[{"lang":"en","text":"学校に行きました","gloss":"去了學校"}')).toEqual([]);
    expect(p.push(',{"lang":"en","text":"楽')).toEqual([{ text: '学校に行きました', lang: 'en' }]);
    expect(p.push('しかった？","gloss":"好玩嗎？"}],"tip":"","tone":"happy"}')).toEqual([{ text: '楽しかった？', lang: 'en' }]);
    expect(p.finish()).toEqual([]);
  });

  it('the whole reply in one push: every segment is voiced at once, the array having closed', () => {
    const { voiced } = feed(REPLY, REPLY.length);
    expect(voiced).toEqual([{ text: '学校に行きました', lang: 'en' }, { text: '楽しかった？', lang: 'en' }]);
  });

  it('every chunk size voices the same segments in the same order', () => {
    const want = feed(REPLY, REPLY.length).voiced;
    for (const size of [1, 2, 3, 5, 7, 13]) expect(feed(REPLY, size).voiced).toEqual(want);
  });

  it('a cut reply voices its complete segments, and the cut one as far as it reads when the stream ends', () => {
    const cut = '{"segments":[{"lang":"en","text":"はい","gloss":"好"},{"lang":"en","text":"いいえ';
    const { voiced, p } = feed(cut, 4);
    expect(voiced).toEqual([{ text: 'はい', lang: 'en' }, { text: 'いいえ', lang: 'en' }]);
    expect(p.visible).toBe('はい（好） いいえ');
  });

  it('the tip and the tone come through the stream', () => {
    const { p } = feed('{"segments":[{"lang":"en","text":"はい","gloss":"好"}],"tip":"要說 <en>はい</en>。","tone":"agree"}', 3);
    expect(p.fields.tip).toBe('要說 <en>はい</en>。');
    expect(p.fields.tone).toBe('agree');
  });

  it('an empty segments array reads as an empty reply with its tip', () => {
    const { p, voiced } = feed('{"segments":[],"tip":"這句要說…","tone":"ask"}', 5);
    expect(voiced).toEqual([]);
    expect(p.visible).toBe('');
    expect(p.fields.tip).toBe('這句要說…');
  });

  it('a Chinese segment is shown, and the parser reports its lang (the caller keeps only the Japanese for the voice)', () => {
    const { p, voiced } = feed('{"segments":[{"lang":"zh","text":"好呀","gloss":""},{"lang":"en","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}', 6);
    expect(p.visible).toBe('好呀 はい（好）');
    expect(voiced.map((s) => s.lang)).toEqual(['zh', 'en']);
  });
});

describe('splitTip: the tip with its <en> tags', () => {
  it('the label goes, the <en> tags go, the Japanese inside is kept as plain text', () => {
    expect(splitTip('小提醒：要說 <en>学校に行きました</en>，去哪裡要用「に」喔。').text).toBe('要說 学校に行きました，去哪裡要用「に」喔。');
  });

  it('collects each <en> inside the tip as a target, trimmed, in order; the spaces inside the text stay', () => {
    const t = splitTip('小提醒：要說 <en> 学校に行きました </en>，不要說 <en>学校へ行きました</en>。');
    expect(t.targets).toEqual(['学校に行きました', '学校へ行きました']);
    expect(t.text).toBe('要說  学校に行きました ，不要說 学校へ行きました。');
  });

  it('empty targets are dropped; a tip with no <en> has no targets', () => {
    expect(splitTip('小提醒：<en>  </en>只是說明。').targets).toEqual([]);
    expect(splitTip('只有說明').targets).toEqual([]);
  });
});

describe('askClaude: the reply is read from the stream and ends on the reply bus', () => {
  const collect = () => {
    const events: ReplyEvent[] = [];
    const off = onReply((e) => events.push(e));
    return { events, off };
  };
  const args = { history: [{ from: 'me' as const, text: '嗨', t: 1 }], role: 'Mugi' as const, mode: 'teacher' as const, context: {} };

  afterEach(() => vi.unstubAllGlobals());

  it('emits done after a streamed reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseOf('{"segments":[{"lang":"en","text":"好呀","gloss":""}],"tip":"","tone":"happy"}'), { status: 200 })));
    const { events, off } = collect();
    const r = await askClaude(args);
    off();
    expect(r.text).toBe('好呀');
    expect(r.tone).toBe('happy');
    // teacher mode: the done event carries the Japanese only
    expect(events[events.length - 1]).toEqual({ type: 'done', id: expect.any(Number), text: '好呀' });
  });

  it('emits error on an HTTP failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ message: 'API 金鑰無效' }), { status: 401 })));
    const { events, off } = collect();
    await expect(askClaude(args)).rejects.toThrow('API 金鑰無效');
    off();
    expect(events[events.length - 1]).toMatchObject({ type: 'error', message: 'API 金鑰無效' });
  });

  it('emits error when the connection cannot be made', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const { events, off } = collect();
    await expect(askClaude(args)).rejects.toThrow();
    off();
    expect(events[events.length - 1]).toMatchObject({ type: 'error' });
  });

  it('streams only the Japanese, returns the tip separately, and the done event carries the spoken text only', async () => {
    const reply = '{"segments":[{"lang":"en","text":"そうなんだ！","gloss":"這樣啊！"}],"tip":"小提醒：要說 <en>学校</en>。","tone":"happy"}';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseOf(reply), { status: 200 })));
    const { events, off } = collect();
    const r = await askClaude(teacher);
    off();
    expect(r.text).toBe('そうなんだ！（這樣啊！）');
    expect(r.tip).toBe('要說 学校。'); // the label the model may write in front of the tip is dropped (the bubble says 小提醒)
    expect(r.spoken).toBe('そうなんだ！');
    expect(r.tone).toBe('happy');
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.every((e) => e.type === 'delta' && e.lang === 'en')).toBe(true);
    expect(deltas.map((e) => (e.type === 'delta' ? e.text : '')).join('')).toBe('そうなんだ！');
    expect(events[events.length - 1]).toEqual({ type: 'done', id: expect.any(Number), text: 'そうなんだ！' });
  });

  it('a teacher reply with no segments and only a tip voices nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseOf('{"segments":[],"tip":"小提醒：這句要說…","tone":"ask"}'), { status: 200 })));
    const { events, off } = collect();
    await expect(askClaude(teacher)).rejects.toThrow('Claude 沒有回覆內容');
    off();
    expect(events[events.length - 1]).toMatchObject({ type: 'error' });
  });
});

describe('the stored reply: sent back as JSON, merged and fitted for the request', () => {
  const A = '{"segments":[{"lang":"en","text":"はい","gloss":"好"}],"tip":"","tone":"happy"}';
  const B = '{"segments":[{"lang":"en","text":"いいえ","gloss":"不"}],"tip":"","tone":"sad"}';

  it('two of her replies in a row go up as one JSON reply (no two JSON objects joined by a newline)', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '嗨', t: 1 },
      { from: 'her', text: 'はい（好）', t: 2, sent: A },
      { from: 'her', text: 'いいえ（不）', t: 3, sent: B },
      { from: 'me', text: 'x', t: 4 },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '{"segments":[{"lang":"en","text":"はい","gloss":"好"},{"lang":"en","text":"いいえ","gloss":"不"}],"tip":"","tone":"sad"}' },
      { role: 'user', content: 'x' },
    ]);
  });

  it('an old save (plain text, no sent) next to a JSON reply is joined with a newline, as before', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '嗨', t: 1 },
      { from: 'her', text: '舊的回覆', t: 2 },
      { from: 'her', text: 'はい（好）', t: 3, sent: A },
      { from: 'me', text: 'x', t: 4 },
    ]);
    expect(msgs[1].content).toBe(`舊的回覆\n${A}`);
  });

  it('a topic line in the JSON form goes up as a reply with its Japanese and gloss', () => {
    expect(topicSent('学校', '學校')).toBe('{"segments":[{"lang":"en","text":"学校","gloss":"學校"}],"tip":"","tone":"happy"}');
    const msgs = toApiMessages([{ from: 'me', text: '嗨', t: 0 }, { from: 'her', text: '学校（學校）', t: 1, sent: topicSent('学校', '學校'), topic: true }, { from: 'me', text: 'x', t: 2 }]);
    expect(msgs[1].content).toBe(topicSent('学校', '學校'));
  });

  it('the same history gives the same request text every time (the cache prefix stays put)', () => {
    const history: ChatLine[] = [
      { from: 'me', text: '嗨', t: 1 },
      { from: 'her', text: 'はい（好）', t: 2, sent: A },
      { from: 'her', text: 'いいえ（不）', t: 3, sent: B },
    ];
    expect(JSON.stringify(toApiMessages(history))).toBe(JSON.stringify(toApiMessages(history)));
  });

  it('a long stored reply is cut by its oldest segments: the request text stays valid JSON within the limit', () => {
    const many = canonicalReplyJson({
      segments: Array.from({ length: 30 }, (_, i) => ({ lang: 'en' as const, text: `${'あ'.repeat(100)}${i}`, gloss: '' })),
      tip: '',
      tone: 'happy',
    });
    const msgs = toApiMessages([{ from: 'me', text: '嗨', t: 1 }, { from: 'her', text: '很長', t: 2, sent: many }, { from: 'me', text: 'x', t: 3 }]);
    const content = msgs[1].content;
    expect(content.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGE_CHARS);
    const j = JSON.parse(content) as { segments: { text: string }[]; tone: string };
    expect(j.segments.length).toBeLessThan(30);
    expect(j.segments[j.segments.length - 1].text.endsWith('29')).toBe(true); // the newest stays
    expect(j.tone).toBe('happy');
  });
});

describe('SSE parsing', () => {
  it('splits events on blank lines and keeps the unfinished tail', () => {
    const { events, rest } = takeSSEEvents('data: {"type":"delta","text":"你"}\n\ndata: {"type":"delta","text":"好"}\n\ndata: {"ty');
    expect(events).toEqual([{ type: 'delta', text: '你' }, { type: 'delta', text: '好' }]);
    expect(rest).toBe('data: {"ty');
  });

  it('joins an event that arrives across several chunks', () => {
    let buf = '';
    const got: string[] = [];
    for (const chunk of ['data: {"type":"del', 'ta","text":"嗨', '"}\n', '\ndata: {"type":"done","text":"嗨"}\n\n']) {
      buf += chunk;
      const r = takeSSEEvents(buf);
      buf = r.rest;
      for (const e of r.events) got.push(JSON.stringify(e));
    }
    expect(got).toEqual(['{"type":"delta","text":"嗨"}', '{"type":"done","text":"嗨"}']);
  });

  it('parses done / error and ignores junk', () => {
    expect(parseSSEData('{"type":"error","message":"連不上 Claude"}')).toEqual({ type: 'error', message: '連不上 Claude' });
    expect(parseSSEData('{"type":"done","text":"x","usage":{}}')).toEqual({ type: 'done', text: 'x' });
    expect(parseSSEData('not json')).toBeNull();
    expect(parseSSEData('{"type":"other"}')).toBeNull();
  });
});

describe('request shaping', () => {
  it('sends the last lines, starting with the user, each within the length limit', () => {
    const msgs = toApiMessages([
      { from: 'her', text: '早', t: 1 },
      { from: 'me', text: 'x'.repeat(2500), t: 2 },
      { from: 'her', text: '好', t: 3 },
      { from: 'me', text: '  ', t: 4 },
      { from: 'me', text: '再見', t: 5 },
    ]);
    // her opening line now gets CHAT_LEAD_TURN in front instead of being dropped
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    expect(msgs[0].content).toBe(CHAT_LEAD_TURN);
    expect(msgs[1].content).toBe('早');
    expect(msgs[2].content.length).toBe(2000);
    expect(msgs[4].content).toBe('再見');
  });

  it('formats the time of day for the prefix', () => {
    expect(timeOfDayText(21, 0)).toBe('晚上 21 點');
    expect(timeOfDayText(9, 30)).toBe('早上 9 點 半');
  });
});

describe('history stays byte-identical for the prompt cache', () => {
  /** one turn as the tutor screen does it: push her line, send, then push her reply */
  function turns(texts: string[], hourOf: (i: number) => number, count = texts.length) {
    let chat: ChatLine[] = [];
    const reqs: { role: 'user' | 'assistant'; content: string }[][] = [];
    for (let i = 0; i < count; i++) {
      const ctx = { timeOfDay: timeOfDayText(hourOf(i)) };
      chat = markWindowReset([...chat, userChatLine(texts[i % texts.length], ctx, 'teacher', i)].slice(-60));
      reqs.push(toApiMessages(chat));
      chat = [...chat, { from: 'her', text: `回覆${i}`, t: i }];
    }
    return reqs;
  }

  it('re-sends every earlier turn exactly as it was first sent', () => {
    const reqs = turns(['嗨', '你在做什麼', '好喔'], (i) => 9 + i);
    expect(JSON.stringify(reqs[1].slice(0, reqs[0].length))).toBe(JSON.stringify(reqs[0]));
    expect(JSON.stringify(reqs[2].slice(0, reqs[1].length))).toBe(JSON.stringify(reqs[1]));
    expect(reqs[2].map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    // each turn keeps the situation it was sent with, even though the clock moved on
    expect(reqs[2][0].content).toBe('［情境：早上 9 點］［模式：英語老師］嗨');
    expect(reqs[2][4].content).toBe('［情境：中午 11 點］［模式：英語老師］好喔');
  });

  it('uses the stored sent string when there is one, the plain text otherwise', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '嗨', sent: '［情境：x］嗨', t: 1 },
      { from: 'her', text: '嗨嗨', t: 2 },
      { from: 'me', text: 'old', t: 3 },
    ]);
    expect(msgs.map((m) => m.content)).toEqual(['［情境：x］嗨', '嗨嗨', 'old']);
  });

  it('window: grows, resets to the newest 20 lines past the maximum, and never sends more than the maximum', () => {
    const reqs = turns(['第幾句'], () => 20, 30);
    const lens = reqs.map((r) => r.length);
    expect(Math.max(...lens)).toBeLessThanOrEqual(CHAT_HISTORY_MAX);
    // the reset lands on turn 21 (index 20): 41 lines, the window restarts at the newest 20 (opening with her), so CHAT_LEAD_TURN is added in front
    expect(lens[20]).toBe(21);
    expect(lens[19]).toBe(39); // just before the reset: 39 messages, all of them still in the window
    let resets = 0;
    for (let i = 1; i < reqs.length; i++) {
      if (JSON.stringify(reqs[i].slice(0, reqs[i - 1].length)) !== JSON.stringify(reqs[i - 1])) resets++;
    }
    expect(resets).toBe(1);
  });

  it('a window reset is only ever recorded as a flag on a line, so an old save without flags still works', () => {
    const plain: ChatLine[] = Array.from({ length: 45 }, (_, i) => ({ from: i % 2 ? 'her' : 'me', text: `句${i}`, t: i }));
    const marked = markWindowReset(plain);
    expect(marked.filter((l) => l.win).length).toBe(1);
    expect(marked.find((l) => l.win)?.text).toBe('句25');
    expect(plain.some((l) => l.win)).toBe(false);
    expect(markWindowReset(marked)).toBe(marked);
  });
});

describe('tip lines in the request', () => {
  it('a tip is not sent back: her preceding message goes up without it (no <tip> in the history)', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '我昨天去學校', t: 1 },
      { from: 'her', text: '<en>そうなんだ</en>', t: 2 },
      { from: 'her', text: '小提醒：要說 学校に行きました。', t: 3, tip: true },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: '我昨天去學校' },
      { role: 'assistant', content: '<en>そうなんだ</en>' },
    ]);
    expect(JSON.stringify(msgs)).not.toContain('<tip>');
  });

  it('tips the model wrote in Japanese do not come back and pull the next tips into Japanese', () => {
    const chat: ChatLine[] = [
      { from: 'me', text: '句1', t: 1 },
      { from: 'her', text: '<en>そうなんだ</en>', t: 2 },
      { from: 'her', text: '「数が好き」の「数」だけだと意味があいまいです。', t: 3, tip: true },
      { from: 'me', text: '句2', t: 4 },
    ];
    expect(toApiMessages(chat).map((m) => m.content)).toEqual(['句1', '<en>そうなんだ</en>', '句2']);
  });

  it('stays byte-identical across turns: an earlier turn with its tip is an exact prefix of the next request', () => {
    let chat: ChatLine[] = [];
    const reqs: { role: 'user' | 'assistant'; content: string }[][] = [];
    for (let i = 0; i < 3; i++) {
      chat = markWindowReset([...chat, userChatLine(`句${i}`, {}, 'teacher', i)].slice(-60));
      reqs.push(toApiMessages(chat));
      expect(JSON.stringify(toApiMessages(chat))).toBe(JSON.stringify(reqs[i]));
      chat = [...chat, { from: 'her', text: `回覆${i}`, t: i }, { from: 'her', text: `提醒${i}`, t: i, tip: true }];
    }
    expect(JSON.stringify(reqs[2].slice(0, reqs[1].length))).toBe(JSON.stringify(reqs[1]));
    expect(JSON.stringify(reqs[1].slice(0, reqs[0].length))).toBe(JSON.stringify(reqs[0]));
    expect(reqs[1][1].content).toBe('回覆0'); // the tip (提醒0) is not sent back
  });

  it('a window that starts on a tip line drops it rather than leaving a stray message', () => {
    const msgs = toApiMessages([
      { from: 'her', text: '提醒', t: 1, tip: true },
      { from: 'me', text: '嗨', t: 2 },
    ]);
    expect(msgs).toEqual([{ role: 'user', content: '嗨' }]);
  });
});
