import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TIPS_KEY, TIPS_MAX, addTip, loadTips, normalizeEn, onTips, removeTip, resetTipsCacheForTest, sameEn, unmasteredCount, updateTip,
} from '../tipsBook';

/** an in-memory localStorage stand-in */
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

const base = { text: '小提醒：要說 学校に行きました', targets: ['学校に行きました'], said: '我去學校了', role: 'Mugi' };

describe('tipsBook storage', () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal('localStorage', store.api);
    resetTipsCacheForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTipsCacheForTest();
  });

  it('adds a tip with defaults and persists it under the versioned key', () => {
    const e = addTip(base);
    expect(e).not.toBeNull();
    expect(e!.tries).toBe(0);
    expect(e!.mastered).toBe(false);
    expect(typeof e!.at).toBe('number');
    expect(e!.id.length).toBeGreaterThan(0);
    expect(TIPS_KEY).toBe('mugien.tips.v1');
    const raw = store.m.get(TIPS_KEY)!;
    expect(JSON.parse(raw)).toHaveLength(1);
    expect(loadTips()).toEqual([e]);
  });

  it('newest first, and ids are distinct', () => {
    const a = addTip({ ...base, text: 'A' })!;
    const b = addTip({ ...base, text: 'B' })!;
    expect(loadTips().map((x) => x.text)).toEqual(['B', 'A']);
    expect(a.id).not.toBe(b.id);
  });

  it('skips an exact duplicate (same text and targets) that is not mastered, but allows it once mastered', () => {
    const a = addTip(base)!;
    expect(addTip(base)).toBeNull();
    expect(addTip({ ...base, said: '別的話' })).toBeNull();
    expect(loadTips()).toHaveLength(1);
    updateTip(a.id, { mastered: true });
    expect(addTip(base)).not.toBeNull();
    expect(loadTips()).toHaveLength(2);
  });

  it('a different target list is not a duplicate', () => {
    addTip(base);
    expect(addTip({ ...base, targets: ['学校へ行きました'] })).not.toBeNull();
  });

  it('updateTip patches fields but never the id; unknown ids are ignored', () => {
    const e = addTip(base)!;
    updateTip(e.id, { tries: 2, lastResult: 'ng', id: 'hacked' } as never);
    const [got] = loadTips();
    expect(got.id).toBe(e.id);
    expect(got.tries).toBe(2);
    expect(got.lastResult).toBe('ng');
    updateTip('nope', { mastered: true });
    expect(loadTips()).toHaveLength(1);
  });

  it('removeTip deletes one entry', () => {
    const a = addTip({ ...base, text: 'A' })!;
    addTip({ ...base, text: 'B' });
    removeTip(a.id);
    expect(loadTips().map((x) => x.text)).toEqual(['B']);
    removeTip('missing');
    expect(loadTips()).toHaveLength(1);
  });

  it('onTips notifies on change and the unsubscribe stops it', () => {
    const seen: number[] = [];
    const off = onTips((list) => seen.push(list.length));
    const e = addTip(base)!;
    updateTip(e.id, { tries: 1 });
    off();
    removeTip(e.id);
    expect(seen).toEqual([1, 1]);
  });

  it('unmasteredCount counts only tips still being practised', () => {
    expect(unmasteredCount()).toBe(0);
    const a = addTip({ ...base, text: 'A' })!;
    addTip({ ...base, text: 'B' });
    expect(unmasteredCount()).toBe(2);
    updateTip(a.id, { mastered: true });
    expect(unmasteredCount()).toBe(1);
  });

  it('caps at TIPS_MAX: the oldest mastered go first, then the oldest of the rest', () => {
    const first = addTip({ ...base, text: 'first' })!;
    updateTip(first.id, { mastered: true });
    for (let i = 0; i < TIPS_MAX; i++) addTip({ ...base, text: `t${i}`, targets: [`目標${i}`] });
    const list = loadTips();
    expect(list).toHaveLength(TIPS_MAX);
    expect(list.some((x) => x.id === first.id)).toBe(false);
    expect(list.some((x) => x.text === 't0')).toBe(true);
  });

  it('caps by dropping the oldest unmastered when nothing is mastered', () => {
    for (let i = 0; i < TIPS_MAX + 1; i++) addTip({ ...base, text: `t${i}`, targets: [`目標${i}`] });
    const list = loadTips();
    expect(list).toHaveLength(TIPS_MAX);
    expect(list.some((x) => x.text === 't0')).toBe(false);
    expect(list[0].text).toBe(`t${TIPS_MAX}`);
  });

  it('reads back a stored list after a cache reset, and ignores junk in storage', () => {
    addTip(base);
    resetTipsCacheForTest();
    expect(loadTips()).toHaveLength(1);
    store.m.set(TIPS_KEY, '{not json');
    resetTipsCacheForTest();
    expect(loadTips()).toEqual([]);
    store.m.set(TIPS_KEY, JSON.stringify([{ nope: true }, 3]));
    resetTipsCacheForTest();
    expect(loadTips()).toEqual([]);
  });

  it('works with no storage at all (the book lives in memory)', () => {
    vi.unstubAllGlobals();
    resetTipsCacheForTest();
    const e = addTip(base);
    expect(e).not.toBeNull();
    expect(loadTips()).toHaveLength(1);
    updateTip(e!.id, { mastered: true });
    expect(unmasteredCount()).toBe(0);
  });

  it('a throwing storage does not throw to the caller', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('denied'); },
      clear: () => {},
    });
    resetTipsCacheForTest();
    expect(() => addTip(base)).not.toThrow();
    expect(loadTips()).toHaveLength(1);
  });
});

describe('normalizeEn / sameEn', () => {
  it('ignores punctuation, case and whitespace', () => {
    expect(sameEn('I went to school.', 'i went to school')).toBe(true);
    expect(sameEn('"Yes!"', 'yes')).toBe(true);
    expect(sameEn('Good   morning', 'Good morning')).toBe(true);
    expect(sameEn('Hello, world!', 'Helloworld')).toBe(true);
  });

  it('a curly apostrophe and a straight one are the same; a missing one too', () => {
    expect(sameEn('I’m fine.', "I'm fine")).toBe(true);
    expect(sameEn("I'm fine", 'Im fine')).toBe(true);
  });

  it('NFKC folds full-width letters and digits', () => {
    expect(sameEn('ＡＢＣ１２３', 'abc123')).toBe(true);
  });

  it('tense, articles and prepositions still count', () => {
    expect(sameEn('I went to school', 'I go to school')).toBe(false);
    expect(sameEn('I saw a cat', 'I saw the cat')).toBe(false);
    expect(normalizeEn('In the park')).toBe('inthepark');
  });
});
