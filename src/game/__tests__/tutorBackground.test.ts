import { afterEach, describe, expect, it, vi } from 'vitest';
import { backgroundRefusal, loadBackgroundPicture, saveBackgroundPicture } from '../tutorBackground';

// a small fake of the IndexedDB calls the storage makes: open (with the upgrade), and one transaction per call
function fakeIndexedDb(existing: string[]) {
  const stores = new Map<string, Map<string, unknown>>(existing.map((n) => [n, new Map()]));
  const created: string[] = [];
  const opened: [string, number][] = [];
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => { stores.set(n, new Map()); created.push(n); },
    close: () => {},
    transaction: (name: string) => {
      const data = stores.get(name) ?? new Map<string, unknown>();
      const tx: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: unknown; objectStore: () => unknown } = {
        objectStore: () => ({
          get: (k: string) => ({ result: data.get(k) }),
          put: (v: unknown, k: string) => { data.set(k, v); return { result: undefined }; },
          delete: (k: string) => { data.delete(k); return { result: undefined }; },
        }),
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  globalThis.indexedDB = {
    open: (name: string, version: number) => {
      opened.push([name, version]);
      const req: { result?: unknown; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void } = {};
      req.result = db;
      setTimeout(() => { req.onupgradeneeded?.(); req.onsuccess?.(); }, 0);
      return req;
    },
  } as unknown as IDBFactory;
  return { stores, created, opened };
}

afterEach(() => {
  delete (globalThis as { indexedDB?: unknown }).indexedDB;
  vi.unstubAllGlobals();
});

describe('backgroundRefusal (what the picker refuses)', () => {
  it('SVG is refused with its own message', () => {
    expect(backgroundRefusal({ type: 'image/svg+xml', size: 10 })).toBe('SVG 圖不收，請換成 PNG、JPG 或 WebP');
  });

  it('other types are refused; PNG, JPEG and WebP are taken', () => {
    expect(backgroundRefusal({ type: 'image/gif', size: 10 })).toMatch(/PNG、JPG 或 WebP/);
    expect(backgroundRefusal({ type: 'application/pdf', size: 10 })).not.toBeNull();
    for (const t of ['image/png', 'image/jpeg', 'image/webp']) expect(backgroundRefusal({ type: t, size: 10 })).toBeNull();
  });

  it('a file over 15 MB is refused', () => {
    expect(backgroundRefusal({ type: 'image/png', size: 16 * 1024 * 1024 })).toMatch(/15 MB/);
  });
});

describe('the background picture in IndexedDB (mugien-art, version 2)', () => {
  it('opens version 2 and adds the background store, keeping the art store as it was', async () => {
    const fake = fakeIndexedDb(['art']);
    await loadBackgroundPicture('b1');
    expect(fake.opened).toEqual([['mugien-art', 2]]);
    expect(fake.created).toEqual(['background']);
    expect(fake.stores.has('art')).toBe(true);
  });

  it('saves and reads back the picture', async () => {
    const fake = fakeIndexedDb(['art', 'background']);
    const pic = new Blob(['pic'], { type: 'image/webp' });
    await saveBackgroundPicture(pic, 'b1');
    expect(fake.stores.get('background')?.get('b1')).toBe(pic);
    expect(await loadBackgroundPicture('b1')).toBe(pic);
    expect(await loadBackgroundPicture('b2')).toBeNull();
  });

  it('the older single picture (key picture) becomes the background custom: moved to its own record, the old one removed', async () => {
    const fake = fakeIndexedDb(['art', 'background']);
    const old = new Blob(['old'], { type: 'image/webp' });
    fake.stores.get('background')!.set('picture', old);
    expect(await loadBackgroundPicture('custom')).toBe(old);
    expect(fake.stores.get('background')?.get('custom')).toBe(old);
    expect(fake.stores.get('background')?.has('picture')).toBe(false);
    // a later read of another id does not find it, and the custom one is read from its own record
    expect(await loadBackgroundPicture('b1')).toBeNull();
    expect(await loadBackgroundPicture('custom')).toBe(old);
  });

  it('a storage that cannot be read gives no picture (the classroom stays)', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await loadBackgroundPicture('b1')).toBeNull();
  });
});
