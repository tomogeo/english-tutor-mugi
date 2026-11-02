// QA: the client's request window (game/claudeBrain.ts) against the server's request parser (server/claudeChat.ts parseChatBody).
// Every window the client can build must pass the server's validation, at every size around the limits.
import { describe, expect, it } from 'vitest';
import {
  markIdleReset, markPersonaReset, markWindowReset, personaKey, toApiMessages, chatWindowStart, CHAT_LEAD_TURN,
} from '../game/claudeBrain';
import { CHAT_HISTORY_MAX, CHAT_IDLE_KEEP, CHAT_IDLE_RESET_MS, CHAT_MAX_MESSAGES, CHAT_MAX_MESSAGE_CHARS } from '../game/claudeProtocol';
import { userChatLine } from '../game/claudeBrain';
import type { ChatLine } from '../game/chatTypes';
import { parseChatBody } from '../../server/claudeChat';

const NOW = 1_800_000_000_000;
const me = (text: string, t = NOW): ChatLine => ({ from: 'me', text, t, sent: `［模式：英語老師］${text}` });
const her = (text: string, t = NOW): ChatLine => ({
  from: 'her', text, t, sent: `{"segments":[{"lang":"en","text":"${text}","gloss":"x"}],"tip":"","tone":"happy"}`,
});
const tip = (t = NOW): ChatLine => ({ from: 'her', text: '小提醒', t, tip: true });

/** the body a request would carry for this chat (what streamClaude sends, minus fetch) */
function bodyOf(lines: ChatLine[]) {
  return JSON.stringify({ messages: toApiMessages(lines), role: 'Mugi', mode: 'teacher', context: {}, providers: ['anthropic'] });
}

describe('request window boundaries', () => {
  it('39 lines keep the window; the 40th restarts it at the newest 20', () => {
    let lines: ChatLine[] = [];
    for (let i = 0; i < CHAT_HISTORY_MAX; i++) lines.push(i % 2 ? her(`h${i}`) : me(`m${i}`));
    expect(markWindowReset(lines)).toBe(lines);
    lines = [...lines, me('extra')];
    const reset = markWindowReset(lines);
    expect(chatWindowStart(reset)).toBe(reset.length - 20);
    expect(toApiMessages(reset).length).toBeLessThanOrEqual(CHAT_MAX_MESSAGES);
  });

  it('a window that opens with her line gets the fixed lead turn in front', () => {
    const lines = [her('開場'), me('你好'), her('こんにちは'), me('謝謝')];
    const out = toApiMessages(lines);
    expect(out[0]).toEqual({ role: 'user', content: CHAT_LEAD_TURN });
    expect(out[1].role).toBe('assistant');
  });

  it('every client window at every size passes the server parser (never more than 40 messages, ends with the user)', () => {
    const failures: string[] = [];
    for (let n = 1; n <= 90; n++) {
      // a chat that alternates, with a tip after some of her replies, sent turn by turn like TutorView.send does
      let lines: ChatLine[] = [];
      for (let i = 0; i < n; i++) {
        const mine = { ...me(`問題${i}`, NOW + i), pk: '' };
        lines = markWindowReset(markPersonaReset([...markIdleReset(lines, NOW + i), mine].slice(-60), ''));
        try {
          parseChatBody(bodyOf(lines));
        } catch (e) {
          failures.push(`turn ${i + 1}: ${(e as Error).message}`);
        }
        lines = [...lines, her(`回答${i}`, NOW + i), ...(i % 3 === 0 ? [tip(NOW + i)] : [])];
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('idle reset (1 hour)', () => {
  it('after an hour the next request keeps exactly CHAT_IDLE_KEEP non-tip lines', () => {
    const lines: ChatLine[] = [];
    for (let i = 0; i < 12; i++) lines.push(i % 2 ? her(`h${i}`, NOW) : me(`m${i}`, NOW));
    const later = NOW + CHAT_IDLE_RESET_MS + 1;
    const reset = markIdleReset(lines, later);
    const kept = lines.slice(chatWindowStart(reset));
    expect(kept.filter((l) => !l.tip).length).toBe(CHAT_IDLE_KEEP);
  });

  it('exactly one hour is not idle; a tip does not count as the last exchange', () => {
    const lines = [me('a', NOW), her('b', NOW)];
    expect(markIdleReset(lines, NOW + CHAT_IDLE_RESET_MS)).toBe(lines);
    // a tip after the last real exchange does not count: the 5 kept lines are the newest non-tip ones (c..g, index 2)
    const longer = [me('a', NOW), her('b', NOW), me('c', NOW), her('d', NOW), me('e', NOW), her('f', NOW), me('g', NOW), tip(NOW + CHAT_IDLE_RESET_MS + 5)];
    expect(chatWindowStart(markIdleReset(longer, NOW + CHAT_IDLE_RESET_MS + 10))).toBe(2);
  });
});

describe('persona and name change', () => {
  it('a different key on the new line restarts the window; the same key does not', () => {
    const old = { ...me('a'), pk: personaKey('', '') };
    const lines = [old, { ...her('b'), pk: personaKey('', '') }];
    const same = markPersonaReset([...lines, { ...me('c'), pk: '' }], '');
    expect(same[same.length - 1].win).toBeUndefined();
    const changedKey = personaKey('親切的老師', 'Mugi');
    const changed = markPersonaReset([...lines, { ...me('c'), pk: changedKey }], changedKey);
    expect(changed[changed.length - 1].win).toBe(true);
  });

  it('a name change alone changes the key; the default name keeps the persona-only key', () => {
    expect(personaKey('', 'Mugi')).toBe(personaKey('', undefined));
    expect(personaKey('', '小春')).not.toBe(personaKey('', 'Mugi'));
    expect(personaKey('同一段', '小春')).not.toBe(personaKey('同一段', 'Mugi'));
  });

  it('old saves (no pk) never trigger a persona reset', () => {
    const lines: ChatLine[] = [me('a'), her('b'), me('c')];
    expect(markPersonaReset(lines, 'abcd1234')).toBe(lines);
  });
});

describe('message text sent to the server', () => {
  it('a 2000-character message keeps its end (the time/mode prefix is added on top, so the tail is at risk)', () => {
    const text = '字'.repeat(1990) + 'END';
    const line = userChatLine(text, { timeOfDay: '晚上 9 點' }, 'teacher', NOW);
    const sent = toApiMessages([line])[0].content;
    // the prefix makes the sent form longer than 2000: the cut must not silently drop the player's own last words
    expect(line.sent!.length).toBeGreaterThan(CHAT_MAX_MESSAGE_CHARS);
    expect(sent.endsWith('END')).toBe(true);
  });

  it('a cut never leaves half a surrogate pair (emoji) at the end', () => {
    const emojiRun = 'a' + '😀'.repeat(1200); // 2401 UTF-16 units: the 2000-unit cut lands inside a pair
    const sent = toApiMessages([{ from: 'me', text: emojiRun, t: NOW }])[0].content;
    const last = sent.charCodeAt(sent.length - 1);
    expect(last >= 0xd800 && last <= 0xdbff).toBe(false); // a lone high surrogate would be sent as invalid unicode
  });

  it('an emoji message of 1200 emoji (1200 characters) is accepted by the server', () => {
    const body = JSON.stringify({ messages: [{ role: 'user', content: '😀'.repeat(1200) }], role: 'Mugi', mode: 'teacher', context: {} });
    expect(() => parseChatBody(body)).not.toThrow();
  });

  it('a whitespace-only message is refused by the server and not sent by the client', () => {
    expect(toApiMessages([{ from: 'me', text: '   ', t: NOW }])).toEqual([]);
    expect(() => parseChatBody(JSON.stringify({ messages: [{ role: 'user', content: '   ' }], role: 'Mugi', mode: 'teacher', context: {} }))).toThrow();
  });
});

describe('her long replies sent back to the server', () => {
  it('a reply JSON over 2000 characters is fitted: still valid JSON, at most 2000 characters', async () => {
    const { fitReplyJson, isReplyJson } = await import('../game/replyJson');
    const segs = Array.from({ length: 300 }, (_, i) => ({ lang: 'en' as const, text: `これは文章${i}です、とても長い文章です`, gloss: `這是第${i}句很長的中文說明文字` }));
    const big = JSON.stringify({ segments: segs, tip: '', tone: 'explain' });
    expect(big.length).toBeGreaterThan(CHAT_MAX_MESSAGE_CHARS);
    const fitted = fitReplyJson(big, CHAT_MAX_MESSAGE_CHARS);
    expect(fitted.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGE_CHARS);
    expect(isReplyJson(fitted)).toBe(true);
    expect(() => JSON.parse(fitted)).not.toThrow();
  });

  it('a long reply stored as its JSON reaches the server within the length limit', () => {
    const segs = Array.from({ length: 300 }, (_, i) => ({ lang: 'en', text: `文章${i}です`, gloss: `說明${i}` }));
    const line: ChatLine = { from: 'her', text: 'x', t: NOW, sent: JSON.stringify({ segments: segs, tip: '', tone: 'explain' }) };
    const out = toApiMessages([me('問'), line, me('下一句')]);
    expect(out[1].content.length).toBeLessThanOrEqual(CHAT_MAX_MESSAGE_CHARS);
    expect(() => parseChatBody(JSON.stringify({ messages: out, role: 'Mugi', mode: 'teacher', context: {} }))).not.toThrow();
  });
});
