import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POCKET_TOPICS, nextPocketTopic } from '../pocketTopics';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    api: {
      getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
      setItem: (k: string, v: string) => { m.set(k, String(v)); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => m.clear(),
    },
  };
}

/** a deterministic rng so the shuffle is repeatable */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x80000000;
  };
}

describe('pocket topics', () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
    vi.stubGlobal('localStorage', store.api);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('has exactly 100 distinct topics, each with English and its Chinese meaning', () => {
    expect(POCKET_TOPICS.length).toBe(100);
    expect(new Set(POCKET_TOPICS.map((t) => t.en)).size).toBe(100);
    for (const t of POCKET_TOPICS) {
      expect(t.zh.length).toBeGreaterThan(0);
      expect(t.en).toMatch(/^[A-Z][\p{L}0-9 ,.'’?!-]+$/u);
      expect(t.zh).toMatch(/\p{Script=Han}/u);
    }
  });

  it('the first 100 picks are all distinct, before any repeat', () => {
    const rng = seeded(7);
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(nextPocketTopic(rng).zh);
    expect(seen.size).toBe(100);
  });

  it('never repeats the topic just used, not even across round boundaries', () => {
    const rng = seeded(42);
    let prev = '';
    for (let i = 0; i < 450; i++) {
      const cur = nextPocketTopic(rng).zh;
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });

  it('keeps the remaining bag in storage, so a reload continues the same round', () => {
    const picks = new Set<string>();
    picks.add(nextPocketTopic(seeded(3)).zh);
    picks.add(nextPocketTopic(() => 0.5).zh);
    for (let i = 0; i < 98; i++) picks.add(nextPocketTopic(() => 0.5).zh);
    expect(picks.size).toBe(100);
  });
});
