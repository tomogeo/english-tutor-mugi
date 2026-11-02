// 人設圖片 (custom character picture): the player's own picture of her, instead of the hamster. Stored only in this device's
// IndexedDB (database `mugien-art`), never sent anywhere. Two modes: one picture (it bobs while she speaks), or 2–6 frames, each
// tied to a mouth shape (a e i o u m) and shown while that shape is voiced. The pure rules (frameFor, canUseFrames) are
// tested with plain objects; the IndexedDB and image paths are thin wrappers around the browser APIs.
import { useEffect, useState } from 'react';
import type { VisemeCode } from './visemes';
import { imageSizeRefusal } from './imageSize';

export type CustomArtMode = 'single' | 'frames';
export type CustomArtFrame = { id: string; viseme: VisemeCode | null; blob: Blob };
export type CustomArt = { mode: CustomArtMode; frames: CustomArtFrame[] };

/** the frames' shapes, in the order the picker lists them */
export const CUSTOM_SHAPES: readonly VisemeCode[] = ['a', 'e', 'i', 'o', 'u', 'm'];
export const CUSTOM_MAX_FRAMES = 6;
export const CUSTOM_MIN_FRAMES = 2;
export const CUSTOM_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const ACCEPT_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const MAX_SIDE = 1024;

const DB_NAME = 'mugien-art';
/** version 2 adds the background store (game/tutorBackground); the art store is kept as it was */
const DB_VERSION = 2;
const STORE = 'art';
export const BACKGROUND_STORE = 'background';
const KEY = 'custom';

// ---------- the rules (pure) ----------

/** frame mode needs at least two frames; with one picture the portrait shows it as a single picture */
export function canUseFrames(art: CustomArt): boolean {
  return art.mode === 'frames' && art.frames.length >= CUSTOM_MIN_FRAMES;
}

/**
 * The frame to show for a mouth shape (null = silent). Single mode: its one picture. Frames: the shape's own frame, else the
 * `a` frame, else the first frame; silent: the `m` frame, else the first frame. null when there are no frames.
 */
export function frameFor(art: CustomArt, viseme: VisemeCode | null): CustomArtFrame | null {
  const frames = art.frames;
  if (!frames.length) return null;
  if (art.mode === 'single') return frames[0];
  const of = (v: VisemeCode) => frames.find((f) => f.viseme === v) ?? null;
  if (viseme === null) return of('m') ?? frames[0];
  // e, i and u without their own frame use the closed frame: when no clip timeline is known the mouth follows the loudness, which
  // mostly moves between the e, o and a bands, so mapping e to the open frame kept a two-frame set open for a whole line
  if (viseme === 'e' || viseme === 'i' || viseme === 'u') return of(viseme) ?? of('m') ?? of('a') ?? frames[0];
  return of(viseme) ?? of('a') ?? frames[0];
}

/** the first shape no frame uses yet (the next frame's default), null when all six are taken */
export function nextFreeShape(frames: CustomArtFrame[]): VisemeCode | null {
  return CUSTOM_SHAPES.find((s) => !frames.some((f) => f.viseme === s)) ?? null;
}

// ---------- IndexedDB (every call wrapped; reads fall back to "no custom art") ----------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      // keeps what is there: each store is only created when it is missing
      for (const name of [STORE, BACKGROUND_STORE]) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

/** runs one request on one of the mugien-art stores ('art' or 'background'); the database is opened and closed around it */
export async function withArtStore<T>(store: string, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** a stored record, checked field by field (a broken record counts as no custom art) */
function parseStored(raw: unknown): CustomArt | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.mode !== 'single' && o.mode !== 'frames') return null;
  if (!Array.isArray(o.frames)) return null;
  const frames: CustomArtFrame[] = [];
  for (const f of o.frames) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const viseme = r.viseme === null || CUSTOM_SHAPES.includes(r.viseme as VisemeCode) ? (r.viseme as VisemeCode | null) : undefined;
    if (typeof r.id !== 'string' || viseme === undefined || !(r.blob instanceof Blob)) continue;
    frames.push({ id: r.id, viseme, blob: r.blob });
  }
  if (!frames.length) return null;
  return { mode: o.mode, frames: frames.slice(0, CUSTOM_MAX_FRAMES) };
}

/** the record key of a character's picture: one per character id (人物). The one record of older saves (KEY) is character 1's. */
export function artKeyOf(characterId: string): string {
  return `${KEY}:${characterId}`;
}

/**
 * The saved picture(s) of a character; null when there are none or the storage cannot be read. Character 1 (Mugi) takes over the
 * one record older saves kept under KEY: it is copied to her own key and the old record is removed (only when it exists).
 */
export async function loadCustomArt(characterId: string = 'mugi'): Promise<CustomArt | null> {
  try {
    const own = parseStored(await withArtStore(STORE, 'readonly', (s) => s.get(artKeyOf(characterId))));
    if (own || characterId !== 'mugi') return own;
    const legacy = await withArtStore(STORE, 'readonly', (s) => s.get(KEY));
    const art = parseStored(legacy);
    if (!art) return null;
    await withArtStore(STORE, 'readwrite', (s) => s.put(legacy, artKeyOf('mugi')));
    await withArtStore(STORE, 'readwrite', (s) => s.delete(KEY));
    return art;
  } catch {
    return null;
  }
}

/** saves the picture(s) of a character, replacing what is stored. Throws a Chinese message when the browser refuses the storage. */
export async function saveCustomArt(art: CustomArt, characterId: string = 'mugi'): Promise<void> {
  const record = {
    mode: art.mode,
    frames: art.frames.map((f) => ({ id: f.id, viseme: f.viseme, blob: f.blob })),
  };
  try {
    await withArtStore(STORE, 'readwrite', (s) => s.put(record, artKeyOf(characterId)));
  } catch {
    throw new Error('無法儲存圖片，請確認瀏覽器允許這個網站使用儲存空間');
  }
}

/** removes the stored picture(s) of a character: back to her built-in picture. Throws a Chinese message when the storage refuses. */
export async function clearCustomArt(characterId: string = 'mugi'): Promise<void> {
  try {
    await withArtStore(STORE, 'readwrite', (s) => s.delete(artKeyOf(characterId)));
  } catch {
    throw new Error('無法清除圖片，請再試一次');
  }
}

// ---------- image intake ----------

/**
 * Checks and prepares a picture for storage: PNG, JPEG, WebP or GIF (first frame) only, at most 15 MB; decoded, scaled so the
 * longest side is at most 1024 px, and written as WebP (quality 0.9; PNG when the browser cannot write WebP). Transparency is
 * kept. Throws a Chinese message for a picture it will not take.
 */
export async function prepareImage(file: File): Promise<Blob> {
  if (!ACCEPT_TYPES.includes(file.type)) throw new Error('只能選 PNG、JPG、WebP 或 GIF 圖片');
  if (file.size > MAX_INPUT_BYTES) throw new Error('圖片超過 15 MB，請換一張小一點的圖');
  // the size the header declares is checked before the browser decodes anything (imageSize.ts)
  const refusal = imageSizeRefusal(new Uint8Array(await file.arrayBuffer()));
  if (refusal) throw new Error(refusal);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('讀不到這張圖');
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('讀不到這張圖');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const webp = await canvasBlob(canvas, 'image/webp', 0.9);
    if (webp && webp.type === 'image/webp') return webp;
    const png = await canvasBlob(canvas, 'image/png');
    if (!png) throw new Error('無法處理這張圖');
    return png;
  } finally {
    bitmap.close?.();
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

// ---------- object URLs for the view ----------

/** a fresh id for a new frame */
export function newFrameId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * An object URL per frame (by frame id) for the picture's blobs. Made when the picture changes, revoked when it is replaced or
 * the view unmounts. Until the URLs are made, the map is empty (a frame without a URL is not drawn).
 */
export function useArtUrls(art: CustomArt | null): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!art) { setUrls({}); return; }
    const made: Record<string, string> = {};
    for (const f of art.frames) made[f.id] = URL.createObjectURL(f.blob);
    setUrls(made);
    return () => { for (const u of Object.values(made)) URL.revokeObjectURL(u); };
  }, [art]);
  return urls;
}

/** what the portrait draws: the picture for a mouth shape (null = silent), and every URL to preload */
export type CustomPortrait = {
  mode: CustomArtMode;
  pictureFor: (viseme: VisemeCode | null) => string | null;
  urls: string[];
};

/** the portrait's view of the picture; null when there is no usable picture (the hamster stays) */
export function customPortraitOf(art: CustomArt | null, urls: Record<string, string>): CustomPortrait | null {
  if (!art || !art.frames.length) return null;
  // a frames picture with one frame is shown as a single picture
  const view: CustomArt = { mode: canUseFrames(art) ? 'frames' : 'single', frames: art.frames };
  return {
    mode: view.mode,
    pictureFor: (viseme) => {
      const f = frameFor(view, viseme);
      return f ? urls[f.id] ?? null : null;
    },
    urls: art.frames.map((f) => urls[f.id]).filter((u): u is string => !!u),
  };
}

/** a built-in character's two pictures (Lily, Ethan): the open picture while she speaks, the closed one when silent */
export function filePortrait(open: string, closed: string): CustomPortrait {
  // open only for the widest shapes (a, o); closed for e, i, u, m and silence. The loudness fallback (device voice, cloud clips)
  // mostly moves between the e, o and a bands, so this split is what makes the mouth flap
  return { mode: 'frames', pictureFor: (viseme) => (viseme === 'a' || viseme === 'o' ? open : closed), urls: [open, closed] };
}
