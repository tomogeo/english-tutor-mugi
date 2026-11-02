// @vitest-environment jsdom
// QA: the browser storage of the tutor (localStorage chat per character) and the custom picture (IndexedDB), with a fake
// IndexedDB that can hold corrupted records. Nothing leaves the test.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTutorChat, writeTutorChat, clearTutorChat, TUTOR_CHAT_KEEP, tutorChatKey, loadTutor, writeTutor, DEFAULT_TUTOR } from '../game/tutor';
import { loadCustomArt, saveCustomArt, artKeyOf } from '../game/customArt';
import type { ChatLine } from '../game/chatTypes';

describe('chat history in localStorage', () => {
  beforeEach(() => localStorage.clear());

  it('each character has its own key; Mugi keeps the original key', () => {
    expect(tutorChatKey('mugi')).toBe('mugien.tutor.chat.v1');
    expect(tutorChatKey('yui')).not.toBe(tutorChatKey('yuma'));
    writeTutorChat([{ from: 'me', text: 'hi', t: 1 }], 'yui');
    expect(loadTutorChat('mugi')).toEqual([]);
    expect(loadTutorChat('yui')).toHaveLength(1);
  });

  it('a corrupted value is an empty chat, not a crash', () => {
    localStorage.setItem(tutorChatKey('yui'), '{not json');
    expect(loadTutorChat('yui')).toEqual([]);
    localStorage.setItem(tutorChatKey('yui'), '{"a":1}');
    expect(loadTutorChat('yui')).toEqual([]);
  });

  it('lines without a valid from or text are dropped on load', () => {
    localStorage.setItem(tutorChatKey('mugi'), JSON.stringify([{ from: 'x', text: 'a', t: 1 }, { from: 'me', t: 2 }, { from: 'me', text: 'ok', t: 3 }]));
    expect(loadTutorChat('mugi').map((l) => l.text)).toEqual(['ok']);
  });

  it('only the newest TUTOR_CHAT_KEEP lines are kept on write', () => {
    const lines: ChatLine[] = Array.from({ length: TUTOR_CHAT_KEEP + 5 }, (_, i) => ({ from: 'me', text: `l${i}`, t: i }));
    writeTutorChat(lines, 'mugi');
    const back = loadTutorChat('mugi');
    expect(back.length).toBe(TUTOR_CHAT_KEEP);
    expect(back[0].text).toBe('l5');
  });

  it('clear removes only that character', () => {
    writeTutorChat([{ from: 'me', text: 'a', t: 1 }], 'mugi');
    writeTutorChat([{ from: 'me', text: 'b', t: 1 }], 'yui');
    clearTutorChat('yui');
    expect(loadTutorChat('mugi')).toHaveLength(1);
    expect(loadTutorChat('yui')).toEqual([]);
  });

  it('the settings save round-trips and a broken save loads the defaults', () => {
    writeTutor({ ...DEFAULT_TUTOR, activeId: 'yui' });
    expect(loadTutor().activeId).toBe('yui');
    localStorage.setItem('mugien.tutor.v1', '{broken');
    expect(loadTutor().activeId).toBe('mugi');
  });
});

// ---------- a fake IndexedDB, just enough for mugien-art (store 'art' and 'background')

type Rec = Map<string, unknown>;
function fakeIndexedDB(seed: Record<string, Record<string, unknown>> = {}, failOpen = false) {
  const stores: Record<string, Rec> = {};
  for (const [name, data] of Object.entries(seed)) stores[name] = new Map(Object.entries(data));
  const db = {
    objectStoreNames: { contains: (n: string) => n in stores },
    createObjectStore: (n: string) => { stores[n] ??= new Map(); },
    transaction: (name: string) => {
      const rec = stores[name];
      const tx: Record<string, unknown> = {};
      const store = {
        get: (k: string) => { return { result: rec?.get(k) as unknown }; },
        put: (v: unknown, k: string) => { rec?.set(k, v); return { result: undefined as unknown }; },
        delete: (k: string) => { rec?.delete(k); return { result: undefined as unknown }; },
      };
      queueMicrotask(() => (tx.oncomplete as (() => void) | undefined)?.());
      return Object.assign(tx, { objectStore: () => store });
    },
    close: () => {},
  };
  return {
    stores,
    open: () => {
      const req: Record<string, unknown> = { result: db };
      queueMicrotask(() => {
        if (failOpen) { (req.onerror as () => void)?.(); return; }
        (req.onsuccess as () => void)?.();
      });
      return req;
    },
  };
}

describe('custom picture storage (IndexedDB, faked)', () => {
  it('a corrupted record (not an object, bad mode, no frames) reads as no custom art', async () => {
    for (const bad of ['text', 42, { mode: 'movie', frames: [] }, { mode: 'single', frames: 'x' }, { mode: 'single', frames: [{ id: 1, viseme: null, blob: new Blob() }] }]) {
      const fake = fakeIndexedDB({ art: { [artKeyOf('yui')]: bad } });
      vi.stubGlobal('indexedDB', { open: fake.open });
      await expect(loadCustomArt('yui')).resolves.toBeNull();
    }
    vi.unstubAllGlobals();
  });

  it('a frame with an unknown shape is dropped, the valid frame stays', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const rec = { mode: 'single', frames: [{ id: 'a', viseme: 'zz', blob }, { id: 'b', viseme: 'a', blob }] };
    vi.stubGlobal('indexedDB', { open: fakeIndexedDB({ art: { [artKeyOf('yui')]: rec } }).open });
    const art = await loadCustomArt('yui');
    expect(art?.frames.map((f) => f.id)).toEqual(['b']);
    vi.unstubAllGlobals();
  });

  it('the legacy record moves to character 1 and is removed from the old key', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    const legacy = { mode: 'single', frames: [{ id: 'old', viseme: null, blob }] };
    const fake = fakeIndexedDB({ art: { custom: legacy } });
    vi.stubGlobal('indexedDB', { open: fake.open });
    const art = await loadCustomArt('mugi');
    expect(art?.frames[0].id).toBe('old');
    // give the queued writes a turn to run
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.stores.art.has(artKeyOf('mugi'))).toBe(true);
    expect(fake.stores.art.has('custom')).toBe(false);
    vi.unstubAllGlobals();
  });

  it('the legacy record is NOT taken over by another character', async () => {
    const blob = new Blob(['x'], { type: 'image/png' });
    vi.stubGlobal('indexedDB', { open: fakeIndexedDB({ art: { custom: { mode: 'single', frames: [{ id: 'old', viseme: null, blob }] } } }).open });
    await expect(loadCustomArt('yui')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('a refused database open (failOpen) reads as no art and a save throws the Chinese message', async () => {
    vi.stubGlobal('indexedDB', { open: fakeIndexedDB({}, true).open });
    await expect(loadCustomArt('yui')).resolves.toBeNull();
    await expect(saveCustomArt({ mode: 'single', frames: [{ id: 'x', viseme: null, blob: new Blob(['x']) }] }, 'yui')).rejects.toThrow('無法儲存圖片');
    vi.unstubAllGlobals();
  });
});
