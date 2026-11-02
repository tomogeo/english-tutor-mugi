import { describe, expect, it } from 'vitest';
import type { ChatLine } from '../chatTypes';
import { toApiMessages, userChatLine, markWindowReset, CHAT_LEAD_TURN } from '../claudeBrain';
import { POCKET_TOPICS } from '../pocketTopics';
import { CHAT_KEEP, CHAT_MAX_MESSAGES } from '../claudeProtocol';

const topic = POCKET_TOPICS[0];

describe('toApiMessages: her consecutive lines are one assistant message', () => {
  it('merges her reply and a 開話題 topic that follow each other', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '嗨', t: 1 },
      { from: 'her', text: '嗨！', t: 2 },
      { from: 'her', text: topic.zh, t: 3, sent: topic.zh },
      { from: 'me', text: '好呀', t: 4 },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: `嗨！\n${topic.zh}` },
      { role: 'user', content: '好呀' },
    ]);
  });

  it('a topic line first in the window gets CHAT_LEAD_TURN in front (the request starts with the user)', () => {
    const msgs = toApiMessages([
      { from: 'her', text: topic.zh, t: 1, sent: topic.zh },
      { from: 'me', text: '好', t: 2 },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: CHAT_LEAD_TURN },
      { role: 'assistant', content: topic.zh },
      { role: 'user', content: '好' },
    ]);
  });
});

describe('the window opens with her line', () => {
  it('her 開話題 first, then my reply: CHAT_LEAD_TURN, her opening, my reply', () => {
    const msgs = toApiMessages([
      { from: 'her', text: topic.zh, t: 1, sent: topic.zh },
      { from: 'me', text: '好呀', t: 2 },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: CHAT_LEAD_TURN },
      { role: 'assistant', content: topic.zh },
      { role: 'user', content: '好呀' },
    ]);
  });

  it('is the same on every call (JSON-identical)', () => {
    const history: ChatLine[] = [
      { from: 'her', text: topic.zh, t: 1, sent: topic.zh },
      { from: 'me', text: '好呀', t: 2 },
    ];
    expect(JSON.stringify(toApiMessages(history))).toBe(JSON.stringify(toApiMessages(history)));
  });

  it('opening with me: no CHAT_LEAD_TURN is added', () => {
    const msgs = toApiMessages([
      { from: 'me', text: '嗨', t: 1 },
      { from: 'her', text: '嗨！', t: 2 },
      { from: 'me', text: '好', t: 3 },
    ]);
    expect(msgs).toEqual([
      { role: 'user', content: '嗨' },
      { role: 'assistant', content: '嗨！' },
      { role: 'user', content: '好' },
    ]);
    expect(msgs.some((m) => m.content === CHAT_LEAD_TURN)).toBe(false);
  });

  // Before: 40 raw lines (no window) opening with her gave 39 messages with her opening dropped (no CHAT_LEAD_TURN).
  // After: the chat grows through markWindowReset; the window is at most CHAT_HISTORY_MAX lines, so CHAT_LEAD_TURN fits.
  it('a chat grown line by line (her runs and tips included): ≤ CHAT_MAX_MESSAGES, starts with user, one window keeps its first message and prefix', () => {
    let chat: ChatLine[] = [];
    let prev: { role: string; content: string }[] | null = null;
    let windowFirst: string | null = null;
    for (let i = 0; i < 150; i++) {
      const isHer = i % 2 === 0;
      const tip = isHer && i > 0 && i % 14 === 0;
      const line: ChatLine = isHer
        ? { from: 'her', text: `她${i}`, t: i, sent: `她${i}`, ...(tip ? { tip: true } : {}) }
        : { from: 'me', text: `我${i}`, t: i };
      const pushed = [...chat, line];
      chat = markWindowReset(pushed);
      const reset = chat.some((l, j) => l.win && !pushed[j]?.win);
      const req = toApiMessages(chat);
      expect(req.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGES);
      expect(req[0].role).toBe('user');
      if (reset) prev = null;
      if (prev) {
        expect(req[0].content).toBe(windowFirst);
        expect(JSON.stringify(req.slice(0, prev.length - 1))).toBe(JSON.stringify(prev.slice(0, -1)));
      } else windowFirst = req[0].content;
      prev = req;
    }
  });

  it('her line opens the window: CHAT_LEAD_TURN is the first message of every request until the first reset', () => {
    let chat: ChatLine[] = [];
    let resetSeen = false;
    for (let i = 0; i < 60 && !resetSeen; i++) {
      const line: ChatLine = i % 2 === 0 ? { from: 'her', text: `她${i}`, t: i, sent: `她${i}` } : { from: 'me', text: `我${i}`, t: i };
      const pushed = [...chat, line];
      chat = markWindowReset(pushed);
      resetSeen = chat.some((l, j) => l.win && !pushed[j]?.win);
      if (!resetSeen) expect(toApiMessages(chat)[0].content).toBe(CHAT_LEAD_TURN);
    }
    expect(resetSeen).toBe(true);
  });
});

describe('a topic line is sent as it was stored', () => {
  it('chat mode: the Chinese line', () => {
    const line: ChatLine = { from: 'her', text: topic.zh, t: 1, sent: topic.zh };
    expect(toApiMessages([{ from: 'me', text: '嗨', t: 0 }, line, { from: 'me', text: 'x', t: 2 }])[1].content).toBe(topic.zh);
  });

  it('teacher mode: the Japanese in <en> followed by its Chinese in brackets', () => {
    const sent = `<en>${topic.en}</en>（${topic.jaZh}）`;
    const line: ChatLine = { from: 'her', text: `${topic.en}（${topic.jaZh}）`, t: 1, sent };
    const msgs = toApiMessages([{ from: 'me', text: '嗨', t: 0 }, line, { from: 'me', text: 'x', t: 2 }]);
    expect(msgs[1]).toEqual({ role: 'assistant', content: sent });
  });
});

describe('byte-stable with topics in the history', () => {
  it('an earlier request is an exact prefix of the next one after a topic and a reply', () => {
    let chat: ChatLine[] = [];
    const reqs: { role: string; content: string }[][] = [];
    const ctx = { timeOfDay: '早上 9 點' };
    for (let i = 0; i < 3; i++) {
      chat = markWindowReset([...chat, userChatLine(`句${i}`, ctx, 'chat', i)].slice(-CHAT_KEEP));
      reqs.push(toApiMessages(chat));
      chat = [...chat, { from: 'her', text: `回覆${i}`, t: i }];
      const t = POCKET_TOPICS[i + 1];
      chat = [...chat, { from: 'her', text: t.zh, t: i, sent: t.zh }];
    }
    expect(JSON.stringify(reqs[1].slice(0, reqs[0].length))).toBe(JSON.stringify(reqs[0]));
    expect(JSON.stringify(reqs[2].slice(0, reqs[1].length))).toBe(JSON.stringify(reqs[1]));
  });
});
