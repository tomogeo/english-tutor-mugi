import { describe, expect, it } from 'vitest';
import type { ChatLine } from '../chatTypes';
import { CHAT_IDLE_RESET_MS } from '../claudeProtocol';
import {
  CHAT_LEAD_TURN, isTopicLine, markIdleReset, markPersonaReset, markWindowReset, personaKey, toApiMessages,
} from '../claudeBrain';

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 27, 12, 0);

function me(text: string, t: number): ChatLine {
  return { from: 'me', text, t, sent: text };
}
function her(text: string, t: number): ChatLine {
  return { from: 'her', text, t };
}
function tip(text: string, t: number): ChatLine {
  return { from: 'her', text, t, tip: true };
}
function topic(text: string, t: number): ChatLine {
  return { from: 'her', text, t, sent: `<en>${text}</en>`, topic: true };
}
/** alternating me / her lines, the newest one at time `last` */
function alternating(n: number, last: number): ChatLine[] {
  return Array.from({ length: n }, (_, i) => {
    const t = last - (n - 1 - i) * 1000;
    return i % 2 === 0 ? me(`m${i}`, t) : her(`h${i}`, t);
  });
}
function winIndexes(lines: ChatLine[]): number[] {
  return lines.flatMap((l, i) => (l.win ? [i] : []));
}
type Msg = { role: 'user' | 'assistant'; content: string };

describe('markIdleReset', () => {
  it('leaves the chat alone when the last real line is 59 minutes old', () => {
    const lines = alternating(10, NOW - 59 * MIN);
    const out = markIdleReset(lines, NOW);
    expect(winIndexes(out)).toEqual(winIndexes(lines));
    expect(out).toEqual(lines);
  });

  it('after 61 minutes the request starts at the 5th line from the end, and only those 5 plus the new line are sent', () => {
    const lines = alternating(10, NOW - 61 * MIN);
    const flagged = markIdleReset(lines, NOW);
    expect(winIndexes(flagged)).toEqual([5]);
    const messages = toApiMessages(markWindowReset([...flagged, me('新句子', NOW)]));
    expect(messages).toEqual<Msg[]>([
      { role: 'user', content: CHAT_LEAD_TURN },
      { role: 'assistant', content: 'h5' },
      { role: 'user', content: 'm6' },
      { role: 'assistant', content: 'h7' },
      { role: 'user', content: 'm8' },
      { role: 'assistant', content: 'h9' },
      { role: 'user', content: '新句子' },
    ]);
  });

  it('does not count tips as part of the 5 lines', () => {
    const real = (k: number) => NOW - 61 * MIN - (9 - k) * 1000;
    const lines: ChatLine[] = [
      me('a0', real(0)), her('a1', real(1)), me('a2', real(2)), her('a3', real(3)),
      tip('TIP', real(3) + 500),
      me('a4', real(4)), her('a5', real(5)), me('a6', real(6)), her('a7', real(7)), me('a8', real(8)), her('a9', real(9)),
    ];
    const flagged = markIdleReset(lines, NOW);
    // a5 is the 5th real line from the end (a9, a8, a7, a6, a5), at index 6 (the tip sits at index 4)
    expect(winIndexes(flagged)).toEqual([6]);
    const messages = toApiMessages(markWindowReset([...flagged, me('新句子', NOW)]));
    expect(messages.map((m) => m.content)).toEqual([CHAT_LEAD_TURN, 'a5', 'a6', 'a7', 'a8', 'a9', '新句子']);
    expect(messages.some((m) => m.content.includes('TIP'))).toBe(false);
  });

  it('counts a 開話題 line as one of the 5 lines, but measures idle time from the last real line', () => {
    const lines: ChatLine[] = [
      me('p0', NOW - 4 * 60 * MIN),
      me('L0', NOW - 3 * 60 * MIN),
      her('L1', NOW - 2 * 60 * MIN),
      me('L2', NOW - 2 * 60 * MIN),
      her('L3', NOW - 2 * 60 * MIN),
      topic('TOPIC', NOW),
    ];
    const flagged = markIdleReset(lines, NOW);
    // from the end: TOPIC (1), L3 (2), L2 (3), L1 (4), L0 (5)
    expect(winIndexes(flagged)).toEqual([1]);
    const messages = toApiMessages(markWindowReset([...flagged, me('新句子', NOW)]));
    expect(messages[0]).toEqual({ role: 'user', content: 'L0' });
    expect(messages.some((m) => m.content.includes('<en>TOPIC</en>'))).toBe(true);
    expect(messages.some((m) => m.content.includes('p0'))).toBe(false);
  });

  it('leaves the chat alone when it holds only 開話題 lines', () => {
    const lines = [topic('T1', NOW - 2 * 60 * MIN), topic('T2', NOW - 2 * 60 * MIN)];
    expect(markIdleReset(lines, NOW)).toBe(lines);
  });

  it('leaves the chat alone when there are fewer than 5 non-tip lines', () => {
    const lines = alternating(4, NOW - 2 * 60 * MIN);
    expect(markIdleReset(lines, NOW)).toBe(lines);
  });

  it('leaves the chat alone when an existing window start is already further back than the computed line', () => {
    const lines = alternating(8, NOW - 2 * 60 * MIN).map((l, i) => (i === 6 ? { ...l, win: true } : l));
    expect(markIdleReset(lines, NOW)).toBe(lines);
  });

  it('keeps the request prefix stable over several short-gap turns after a reset', () => {
    let lines = alternating(10, NOW - 2 * 60 * MIN);
    let now = NOW;
    let prev: Msg[] | null = null;
    for (let round = 0; round < 4; round++) {
      now += MIN; // short gaps: every turn is one minute after the last
      const history = markWindowReset([...markIdleReset(lines, now), me(`第${round}句`, now)].slice(-60));
      const messages = toApiMessages(history);
      if (prev) expect(messages.slice(0, prev.length)).toEqual(prev);
      prev = messages;
      lines = [...history, her(`她${round}`, now)];
    }
    // the window opens with her line h5, so the fixed lead turn goes in front of it
    expect(prev?.[0]).toEqual({ role: 'user', content: CHAT_LEAD_TURN });
    expect(prev?.[1]).toEqual({ role: 'assistant', content: 'h5' });
  });
});

describe('isTopicLine', () => {
  it('is true for a line flagged topic', () => {
    expect(isTopicLine({ from: 'her', text: 'x', t: NOW, topic: true })).toBe(true);
  });

  it('is true for an old-format 開話題 line (her, sent starting with <en>, not a tip)', () => {
    expect(isTopicLine({ from: 'her', text: 'x', t: NOW, sent: '<en>x</en>（x）' })).toBe(true);
  });

  it('is false for her ordinary reply (no sent)', () => {
    expect(isTopicLine(her('こんにちは', NOW))).toBe(false);
  });

  it('is false for a tip line', () => {
    expect(isTopicLine(tip('小提醒', NOW))).toBe(false);
    expect(isTopicLine({ from: 'her', text: 'x', t: NOW, tip: true, sent: '<en>x</en>' })).toBe(false);
  });

  it('CHAT_IDLE_RESET_MS is one hour', () => {
    expect(CHAT_IDLE_RESET_MS).toBe(60 * MIN);
  });
});

function keyed(l: ChatLine, pk: string): ChatLine {
  return { ...l, pk };
}

describe('personaKey', () => {
  it('is empty for the default (undefined, empty, blank)', () => {
    expect(personaKey(undefined)).toBe('');
    expect(personaKey('')).toBe('');
    expect(personaKey('  ')).toBe('');
  });

  it('is the same for the same text (trimmed) and different for different text', () => {
    expect(personaKey('溫柔的老師')).toBe(personaKey('溫柔的老師'));
    expect(personaKey('  溫柔的老師\n')).toBe(personaKey('溫柔的老師'));
    expect(personaKey('溫柔的老師')).not.toBe(personaKey('嚴格的老師'));
    expect(personaKey('溫柔的老師')).not.toBe('');
  });

  it('is 8 hex digits', () => {
    expect(personaKey('abc')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('covers her name too: a changed name is a changed key, even with the same personality', () => {
    expect(personaKey('溫柔的老師', 'ミオ')).not.toBe(personaKey('溫柔的老師', 'Mugi'));
    expect(personaKey(undefined, 'ミオ')).not.toBe(personaKey(undefined, 'Mugi'));
    expect(personaKey(undefined, 'ミオ')).not.toBe('');
    expect(personaKey('溫柔的老師', 'ミオ')).toBe(personaKey('溫柔的老師', '  ミオ  '));
  });

  it('the default name keeps the persona-only key, so chats under the default name are not restarted', () => {
    expect(personaKey(undefined, 'Mugi')).toBe('');
    expect(personaKey('溫柔的老師', 'Mugi')).toBe(personaKey('溫柔的老師'));
    expect(personaKey('溫柔的老師', undefined)).toBe(personaKey('溫柔的老師'));
  });
});

describe('markPersonaReset', () => {
  it('restarts the window at the new line when the previous line was sent under another persona', () => {
    const k1 = personaKey('A'), k2 = personaKey('B');
    const lines = [keyed(me('m0', NOW - 2000), k1), keyed(her('h0', NOW - 1000), k1), keyed(me('m1', NOW), k2)];
    const out = markPersonaReset(lines, k2);
    expect(winIndexes(out)).toEqual([2]);
    expect(out).not.toBe(lines);
  });

  it('returns the same array when the previous line has the same key', () => {
    const k = personaKey('A');
    const lines = [keyed(me('m0', NOW - 1000), k), keyed(me('m1', NOW), k)];
    expect(markPersonaReset(lines, k)).toBe(lines);
  });

  it('returns the same array when no earlier line has a pk (old saves)', () => {
    const lines = [me('m0', NOW - 1000), her('h0', NOW - 500), keyed(me('m1', NOW), personaKey('B'))];
    expect(markPersonaReset(lines, personaKey('B'))).toBe(lines);
  });

  it('returns the same array for a single line', () => {
    const lines = [keyed(me('m0', NOW), personaKey('B'))];
    expect(markPersonaReset(lines, personaKey('B'))).toBe(lines);
  });

  it('looks past lines without pk to the newest line that has one', () => {
    const k1 = personaKey('A'), k2 = personaKey('B');
    // the newest pk-bearing line before the new one is keyed k2 (same as the new line): no reset
    const same = [keyed(me('m0', NOW - 3000), k1), keyed(her('h0', NOW - 2000), k2), me('old', NOW - 1500), keyed(me('m1', NOW), k2)];
    expect(markPersonaReset(same, k2)).toBe(same);
    // the newest pk-bearing line is k1 while an older one is k2: reset
    const diff = [keyed(me('m0', NOW - 3000), k2), keyed(her('h0', NOW - 2000), k1), me('old', NOW - 1500), keyed(me('m1', NOW), k2)];
    expect(winIndexes(markPersonaReset(diff, k2))).toEqual([3]);
  });

  it('changes only the last line', () => {
    const k1 = personaKey('A'), k2 = personaKey('B');
    const lines = [keyed(me('m0', NOW - 2000), k1), keyed(her('h0', NOW - 1000), k1), keyed(me('m1', NOW), k2)];
    const out = markPersonaReset(lines, k2);
    expect(out.slice(0, 2)).toEqual(lines.slice(0, 2));
    expect(out[2]).toEqual({ ...lines[2], win: true });
  });

  it('counts tip lines with pk like the other lines', () => {
    const k1 = personaKey('A'), k2 = personaKey('B');
    const tipped = [keyed(me('m0', NOW - 2000), k1), { ...tip('小提醒', NOW - 1500), pk: k2 }, keyed(me('m1', NOW), k2)];
    // the newest pk-bearing line before the new one is the tip (k2): no reset
    expect(markPersonaReset(tipped, k2)).toBe(tipped);
    const tipOld = [{ ...tip('小提醒', NOW - 2000), pk: k1 }, keyed(me('m1', NOW), k2)];
    expect(winIndexes(markPersonaReset(tipOld, k2))).toEqual([1]);
  });

  it('a request window built after a persona change starts at the new line and sends nothing older', () => {
    const k1 = personaKey('A'), k2 = personaKey('B');
    const lines: ChatLine[] = [
      keyed(me('舊1', NOW - 3000), k1), keyed(her('舊回1', NOW - 2500), k1),
    ];
    const newLine = keyed(me('新句子', NOW), k2);
    const history = markWindowReset(markPersonaReset([...lines, newLine], k2));
    const messages = toApiMessages(history);
    expect(messages).toEqual<Msg[]>([{ role: 'user', content: '新句子' }]);
    expect(messages.some((m) => m.content.includes('舊'))).toBe(false);
  });
});
